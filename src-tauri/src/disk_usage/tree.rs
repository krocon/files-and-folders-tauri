//! The scanned tree (design 033 E4): an arena of nodes in Rust; the frontend
//! only asks for the levels it shows. Folder totals grow while the scan runs –
//! every added batch is added along the parent chain – so partial results can
//! be shown at any time.
//!
//! Files are kept as nodes only if they are among the [`KEEP_PER_DIR`] largest
//! of their folder or at least [`KEEP_MIN_BYTES`]; the rest of a folder is one
//! aggregate ("n smaller files"). "Largest files" is therefore exact for every
//! file of at least 1 MiB.

use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

pub type NodeId = u32;
/// The top node: the single root, or the virtual root of several roots.
pub const TOP: NodeId = 0;
/// Files kept per folder regardless of their size.
pub const KEEP_PER_DIR: usize = 16;
/// Files at least this big are always kept (exact "largest files").
pub const KEEP_MIN_BYTES: u64 = 1024 * 1024;
/// Hard limit of nodes (≈ 136 B + name each, design 033 E4: ≈ 0.5 GB at most).
/// Beyond it files only add to their folder's sums, and further folders are counted
/// but neither kept nor read – their content is missing (`simplified`).
pub const MAX_NODES: usize = 3_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Dir,
    File,
    /// A symbolic link (or Windows reparse point) – counted with its own size, never followed.
    Link,
    /// A folder on another file system – not scanned.
    Mount,
    /// View only: the files of a folder that are not kept one by one.
    Files,
    /// View only: entries below the view's size threshold.
    Rest,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SizeMode {
    /// Blocks on disk (design 033 E6).
    #[default]
    Allocated,
    /// The size the file reports.
    Logical,
}

/// Sizes and counts of a node; for a folder the whole subtree (incl. itself).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Totals {
    pub allocated: u64,
    pub logical: u64,
    /// Files (and links) in the subtree.
    pub files: u64,
    /// Folders in the subtree, without the node itself.
    pub dirs: u64,
    /// Unreadable folders/entries in the subtree.
    pub unreadable: u64,
    /// Newest modification time in the subtree (ms), `i64::MIN` = none.
    pub newest_ms: i64,
}

impl Totals {
    fn empty() -> Self {
        Totals {
            newest_ms: i64::MIN,
            ..Totals::default()
        }
    }

    fn add(&mut self, o: &Totals) {
        self.allocated += o.allocated;
        self.logical += o.logical;
        self.files += o.files;
        self.dirs += o.dirs;
        self.unreadable += o.unreadable;
        self.newest_ms = self.newest_ms.max(o.newest_ms);
    }

    fn sub(&mut self, o: &Totals) {
        self.allocated = self.allocated.saturating_sub(o.allocated);
        self.logical = self.logical.saturating_sub(o.logical);
        self.files = self.files.saturating_sub(o.files);
        self.dirs = self.dirs.saturating_sub(o.dirs);
        self.unreadable = self.unreadable.saturating_sub(o.unreadable);
    }

    pub fn size(&self, mode: SizeMode) -> u64 {
        match mode {
            SizeMode::Allocated => self.allocated,
            SizeMode::Logical => self.logical,
        }
    }
}

/// The small files of a folder that are not kept as nodes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Small {
    count: u64,
    allocated: u64,
    logical: u64,
}

#[derive(Debug)]
struct Node {
    name: Box<OsStr>,
    parent: NodeId,
    kind: NodeKind,
    removed: bool,
    /// The folder could not be read (its content is missing).
    unreadable: bool,
    totals: Totals,
    /// Own modification time (ms).
    modified_ms: Option<i64>,
    children: Vec<NodeId>,
    small: Small,
}

/// One entry of a folder as the walker read it.
#[derive(Debug, Clone)]
pub struct Scanned {
    pub name: OsString,
    pub kind: NodeKind,
    pub allocated: u64,
    pub logical: u64,
    pub modified_ms: Option<i64>,
}

#[derive(Debug)]
pub struct Tree {
    nodes: Vec<Node>,
    /// Full path of each root node (the top node and, with several roots, its children).
    roots: Vec<(NodeId, PathBuf)>,
    mode: SizeMode,
    /// Changes with every update – the frontend skips a repaint for the same version.
    pub version: u64,
    /// Nodes were left out because of [`MAX_NODES`].
    pub simplified: bool,
    max_nodes: usize,
}

/// A node as the frontend sees it (Rust ↔ `disk-usage.models.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageNode {
    pub id: NodeId,
    pub name: String,
    /// `None`: the virtual root and the view-only aggregates.
    pub path: Option<String>,
    pub kind: NodeKind,
    pub allocated: u64,
    pub logical: u64,
    pub files: u64,
    pub dirs: u64,
    pub unreadable: u64,
    pub modified_ms: Option<i64>,
    /// The name is not valid Unicode (shown with replacement characters).
    pub lossy_name: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<UsageNode>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Crumb {
    pub id: NodeId,
    pub name: String,
}

/// A kept file of a subtree ("largest files").
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageFile {
    pub id: NodeId,
    pub name: String,
    pub path: String,
    /// Folder of the file relative to the asked node (`""` = the node itself), display only.
    pub dir: String,
    /// The folder node (to navigate to).
    pub dir_id: NodeId,
    /// Folders from the top node down to `dir_id` (nesting in the basket, review 033 #9).
    pub ancestors: Vec<NodeId>,
    pub allocated: u64,
    pub logical: u64,
    pub modified_ms: Option<i64>,
    pub lossy_name: bool,
}

fn display_name(name: &OsStr) -> (String, bool) {
    match name.to_str() {
        Some(s) => (s.to_string(), false),
        None => (name.to_string_lossy().into_owned(), true),
    }
}

/// The name a root is shown with: its last component, or the whole path (`/`, `C:\`).
pub fn root_name(path: &Path) -> OsString {
    path.file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| path.as_os_str().to_os_string())
}

impl Tree {
    /// A tree for `roots` (already without nested ones). One root is the top node;
    /// several get a virtual top node ("selection") with the roots as children.
    pub fn new(roots: &[PathBuf], mode: SizeMode) -> Self {
        let mut t = Tree {
            nodes: Vec::new(),
            roots: Vec::new(),
            mode,
            version: 0,
            simplified: false,
            max_nodes: MAX_NODES,
        };
        if roots.len() == 1 {
            t.push(root_name(&roots[0]), TOP, NodeKind::Dir, None);
            t.roots.push((TOP, roots[0].clone()));
        } else {
            t.push(OsString::new(), TOP, NodeKind::Dir, None);
            for r in roots {
                let id = t.push(root_name(r), TOP, NodeKind::Dir, None);
                t.nodes[TOP as usize].children.push(id);
                t.roots.push((id, r.clone()));
            }
        }
        t
    }

    #[cfg(test)]
    pub fn set_max_nodes(&mut self, n: usize) {
        self.max_nodes = n;
    }

    /// Bytes of one node without its name and child list (for the memory estimate).
    pub fn node_size() -> usize {
        std::mem::size_of::<Node>()
    }

    pub fn mode(&self) -> SizeMode {
        self.mode
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Root nodes with their paths (what the walker starts with).
    pub fn roots(&self) -> &[(NodeId, PathBuf)] {
        &self.roots
    }

    pub fn is_virtual(&self, id: NodeId) -> bool {
        id == TOP && self.roots.first().is_some_and(|(r, _)| *r != TOP)
    }

    fn push(
        &mut self,
        name: OsString,
        parent: NodeId,
        kind: NodeKind,
        modified_ms: Option<i64>,
    ) -> NodeId {
        let id = self.nodes.len() as NodeId;
        let mut totals = Totals::empty();
        totals.newest_ms = modified_ms.unwrap_or(i64::MIN);
        self.nodes.push(Node {
            name: name.into_boxed_os_str(),
            parent,
            kind,
            removed: false,
            unreadable: false,
            totals,
            modified_ms,
            children: Vec::new(),
            small: Small::default(),
        });
        id
    }

    fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize).filter(|n| !n.removed)
    }

    pub fn totals(&self, id: NodeId) -> Option<Totals> {
        self.node(id).map(|n| n.totals)
    }

    pub fn kind(&self, id: NodeId) -> Option<NodeKind> {
        self.node(id).map(|n| n.kind)
    }

    pub fn parent(&self, id: NodeId) -> Option<NodeId> {
        self.node(id).filter(|_| id != TOP).map(|n| n.parent)
    }

    pub fn children(&self, id: NodeId) -> &[NodeId] {
        self.node(id).map(|n| n.children.as_slice()).unwrap_or(&[])
    }

    /// Adds `delta` to `id` and every node above it.
    fn add_up(&mut self, mut id: NodeId, delta: &Totals) {
        loop {
            self.nodes[id as usize].totals.add(delta);
            if id == TOP {
                break;
            }
            id = self.nodes[id as usize].parent;
        }
    }

    fn sub_up(&mut self, mut id: NodeId, delta: &Totals) {
        loop {
            self.nodes[id as usize].totals.sub(delta);
            if id == TOP {
                break;
            }
            id = self.nodes[id as usize].parent;
        }
    }

    /// Own size of a folder (its directory entry), added once when it is read.
    pub fn set_dir_self(&mut self, dir: NodeId, allocated: u64, modified_ms: Option<i64>) {
        if self.nodes[dir as usize].removed {
            return;
        }
        let delta = Totals {
            allocated,
            newest_ms: modified_ms.unwrap_or(i64::MIN),
            ..Totals::empty()
        };
        self.nodes[dir as usize].modified_ms = modified_ms;
        self.add_up(dir, &delta);
        self.version += 1;
    }

    /// Entries of `dir` that could not be read (the folder itself could).
    pub fn add_unreadable(&mut self, dir: NodeId, count: u64) {
        if count == 0 || self.nodes[dir as usize].removed {
            return;
        }
        let delta = Totals {
            unreadable: count,
            ..Totals::empty()
        };
        self.add_up(dir, &delta);
        self.version += 1;
    }

    /// The folder could not be read.
    pub fn mark_unreadable(&mut self, dir: NodeId) {
        if self.nodes[dir as usize].removed {
            return;
        }
        self.nodes[dir as usize].unreadable = true;
        let delta = Totals {
            unreadable: 1,
            ..Totals::empty()
        };
        self.add_up(dir, &delta);
        self.version += 1;
    }

    /// Adds the content of `dir`; returns the new folder nodes (to scan next) with
    /// the index of their entry in `entries`. Folders left out because of
    /// [`MAX_NODES`] are missing there.
    pub fn add_entries(&mut self, dir: NodeId, entries: Vec<Scanned>) -> Vec<(NodeId, usize)> {
        // a folder removed (pruned, replaced by a rescan) while the walker read it: its
        // content belongs nowhere – counting it would inflate the live folders above (review 033 #3)
        if self.nodes[dir as usize].removed {
            return Vec::new();
        }
        let mode = self.mode;
        let mut delta = Totals::empty();
        let mut new_dirs = Vec::new();
        let mut entries: Vec<(usize, Scanned)> = entries.into_iter().enumerate().collect();
        // largest files first: the first KEEP_PER_DIR (and all big ones) stay nodes
        entries.sort_by_key(|(_, e)| {
            Reverse(match mode {
                SizeMode::Allocated => e.allocated,
                SizeMode::Logical => e.logical,
            })
        });
        let mut kept_files = 0usize;
        for (index, e) in entries {
            let full = self.nodes.len() >= self.max_nodes;
            match e.kind {
                NodeKind::Dir | NodeKind::Mount => {
                    if full {
                        self.simplified = true;
                        // the content is lost; the folder still counts
                        delta.dirs += 1;
                        continue;
                    }
                    let id = self.push(e.name, dir, e.kind, e.modified_ms);
                    self.nodes[dir as usize].children.push(id);
                    delta.dirs += 1;
                    if e.kind == NodeKind::Dir {
                        new_dirs.push((id, index));
                    }
                }
                NodeKind::File | NodeKind::Link => {
                    delta.allocated += e.allocated;
                    delta.logical += e.logical;
                    delta.files += 1;
                    if let Some(m) = e.modified_ms {
                        delta.newest_ms = delta.newest_ms.max(m);
                    }
                    let size = match mode {
                        SizeMode::Allocated => e.allocated,
                        SizeMode::Logical => e.logical,
                    };
                    let keep = kept_files < KEEP_PER_DIR || size >= KEEP_MIN_BYTES;
                    if keep && !full {
                        kept_files += 1;
                        let id = self.push(e.name, dir, e.kind, e.modified_ms);
                        let n = &mut self.nodes[id as usize];
                        n.totals.allocated = e.allocated;
                        n.totals.logical = e.logical;
                        n.totals.files = 1;
                        self.nodes[dir as usize].children.push(id);
                    } else {
                        if keep {
                            self.simplified = true;
                        }
                        let s = &mut self.nodes[dir as usize].small;
                        s.count += 1;
                        s.allocated += e.allocated;
                        s.logical += e.logical;
                    }
                }
                NodeKind::Files | NodeKind::Rest => {}
            }
        }
        self.add_up(dir, &delta);
        self.version += 1;
        new_dirs
    }

    /// Children sorted by size (largest first), name as tie-breaker.
    pub fn sort_children(&mut self) {
        let mode = self.mode;
        for i in 0..self.nodes.len() {
            if self.nodes[i].children.len() < 2 {
                continue;
            }
            let mut ch = std::mem::take(&mut self.nodes[i].children);
            ch.sort_by(|a, b| {
                let (na, nb) = (&self.nodes[*a as usize], &self.nodes[*b as usize]);
                nb.totals
                    .size(mode)
                    .cmp(&na.totals.size(mode))
                    .then_with(|| na.name.cmp(&nb.name))
            });
            self.nodes[i].children = ch;
        }
    }

    /// Full path of a node; `None` for the virtual root.
    pub fn path_of(&self, id: NodeId) -> Option<PathBuf> {
        let mut names: Vec<&OsStr> = Vec::new();
        let mut cur = id;
        loop {
            if let Some((_, p)) = self.roots.iter().find(|(r, _)| *r == cur) {
                let mut path = p.clone();
                for n in names.iter().rev() {
                    path.push(n);
                }
                return Some(path);
            }
            if cur == TOP {
                return None;
            }
            let n = self.nodes.get(cur as usize)?;
            names.push(&n.name);
            cur = n.parent;
        }
    }

    /// The node of `path` (below a root, matched name by name), if it is kept.
    pub fn locate(&self, path: &Path) -> Option<NodeId> {
        let path = crate::paths::normalize_lexically(path);
        for (root, rp) in &self.roots {
            let Ok(rest) = path.strip_prefix(rp) else {
                continue;
            };
            let mut cur = *root;
            for comp in rest.components() {
                let name = comp.as_os_str();
                cur = *self
                    .children(cur)
                    .iter()
                    .find(|c| self.nodes[**c as usize].name.as_ref() == name)?;
            }
            return self.node(cur).map(|_| cur);
        }
        None
    }

    /// Ancestors from the top node down to `id` (incl. both).
    pub fn crumbs(&self, id: NodeId) -> Vec<Crumb> {
        let mut out = Vec::new();
        let mut cur = id;
        while let Some(n) = self.nodes.get(cur as usize) {
            out.push(Crumb {
                id: cur,
                name: display_name(&n.name).0,
            });
            if cur == TOP {
                break;
            }
            cur = n.parent;
        }
        out.reverse();
        out
    }

    fn usage_node(&self, id: NodeId) -> UsageNode {
        let n = &self.nodes[id as usize];
        let (name, lossy) = display_name(&n.name);
        let path = self.path_of(id);
        // a folder above with a non-Unicode name makes the path lossy too (review 033 #7)
        let lossy_name = lossy || path.as_ref().is_some_and(|p| p.to_str().is_none());
        UsageNode {
            id,
            name,
            path: path.map(|p| p.to_string_lossy().into_owned()),
            kind: n.kind,
            allocated: n.totals.allocated,
            logical: n.totals.logical,
            files: n.totals.files,
            dirs: n.totals.dirs,
            unreadable: n.totals.unreadable,
            modified_ms: n.modified_ms,
            lossy_name,
            children: None,
        }
    }

    fn aggregate(
        id: NodeId,
        kind: NodeKind,
        count: u64,
        allocated: u64,
        logical: u64,
    ) -> UsageNode {
        UsageNode {
            id,
            name: String::new(),
            path: None,
            kind,
            allocated,
            logical,
            files: count,
            dirs: 0,
            unreadable: 0,
            modified_ms: None,
            lossy_name: false,
            children: None,
        }
    }

    /// `id` with its children down to `depth` levels. Per level at most `limit`
    /// children; children below `min_fraction` of the shown node's size and those
    /// over the limit become one `rest` aggregate; a folder's small files are a
    /// `files` aggregate. Children are sorted by size (largest first).
    pub fn view(
        &self,
        id: NodeId,
        depth: u32,
        min_fraction: f64,
        limit: usize,
    ) -> Option<UsageNode> {
        self.node(id)?;
        let base = self.nodes[id as usize].totals.size(self.mode);
        let threshold = (base as f64 * min_fraction.clamp(0.0, 1.0)) as u64;
        Some(self.view_rec(id, depth, threshold, limit.max(1)))
    }

    fn view_rec(&self, id: NodeId, depth: u32, threshold: u64, limit: usize) -> UsageNode {
        let mut out = self.usage_node(id);
        let n = &self.nodes[id as usize];
        if depth == 0 || !matches!(n.kind, NodeKind::Dir) {
            return out;
        }
        let mode = self.mode;
        let mut kids: Vec<NodeId> = n
            .children
            .iter()
            .copied()
            .filter(|c| !self.nodes[*c as usize].removed)
            .collect();
        kids.sort_by(|a, b| {
            let (na, nb) = (&self.nodes[*a as usize], &self.nodes[*b as usize]);
            nb.totals
                .size(mode)
                .cmp(&na.totals.size(mode))
                .then_with(|| na.name.cmp(&nb.name))
        });
        let mut children = Vec::new();
        let (mut rest_n, mut rest_a, mut rest_l) = (0u64, 0u64, 0u64);
        for c in kids {
            let t = self.nodes[c as usize].totals;
            if children.len() < limit && (t.size(mode) >= threshold || threshold == 0) {
                children.push(self.view_rec(c, depth - 1, threshold, limit));
            } else {
                rest_n += 1;
                rest_a += t.allocated;
                rest_l += t.logical;
            }
        }
        if n.small.count > 0 {
            children.push(Self::aggregate(
                id,
                NodeKind::Files,
                n.small.count,
                n.small.allocated,
                n.small.logical,
            ));
        }
        if rest_n > 0 {
            children.push(Self::aggregate(id, NodeKind::Rest, rest_n, rest_a, rest_l));
        }
        out.children = Some(children);
        out
    }

    /// The `limit` largest kept files below `id` (exact for files ≥ [`KEEP_MIN_BYTES`]).
    pub fn largest(&self, id: NodeId, limit: usize) -> Vec<UsageFile> {
        if self.node(id).is_none() || limit == 0 {
            return Vec::new();
        }
        let mode = self.mode;
        let mut heap: BinaryHeap<Reverse<(u64, NodeId)>> = BinaryHeap::new();
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            for c in &self.nodes[cur as usize].children {
                let n = &self.nodes[*c as usize];
                if n.removed {
                    continue;
                }
                match n.kind {
                    NodeKind::Dir => stack.push(*c),
                    NodeKind::File | NodeKind::Link => {
                        heap.push(Reverse((n.totals.size(mode), *c)));
                        if heap.len() > limit {
                            heap.pop();
                        }
                    }
                    _ => {}
                }
            }
        }
        let mut files: Vec<(u64, NodeId)> = heap.into_iter().map(|Reverse(x)| x).collect();
        files.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        let base = self.path_of(id);
        files
            .into_iter()
            .map(|(_, f)| {
                let n = &self.nodes[f as usize];
                let (name, lossy) = display_name(&n.name);
                let path = self.path_of(f).unwrap_or_default();
                let lossy_name = lossy || path.to_str().is_none();
                let dir = path
                    .parent()
                    .and_then(|p| match &base {
                        Some(b) => p.strip_prefix(b).ok().map(|r| r.to_path_buf()),
                        None => Some(p.to_path_buf()),
                    })
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                UsageFile {
                    id: f,
                    name,
                    path: path.to_string_lossy().into_owned(),
                    dir,
                    dir_id: n.parent,
                    ancestors: self.crumbs(n.parent).into_iter().map(|c| c.id).collect(),
                    allocated: n.totals.allocated,
                    logical: n.totals.logical,
                    modified_ms: n.modified_ms,
                    lossy_name,
                }
            })
            .collect()
    }

    /// Removes a node (and its subtree) and corrects the totals above it.
    /// Root nodes stay (they only become empty).
    pub fn remove(&mut self, id: NodeId) -> bool {
        if self.node(id).is_none() || self.roots.iter().any(|(r, _)| *r == id) || id == TOP {
            return false;
        }
        let n = &self.nodes[id as usize];
        let mut delta = n.totals;
        let parent = n.parent;
        if matches!(n.kind, NodeKind::Dir | NodeKind::Mount) {
            delta.dirs += 1; // the folder itself counts in its parent
        }
        self.sub_up(parent, &delta);
        self.nodes[parent as usize].children.retain(|c| *c != id);
        let mut stack = vec![id];
        while let Some(c) = stack.pop() {
            self.nodes[c as usize].removed = true;
            stack.extend(self.nodes[c as usize].children.iter().copied());
        }
        self.version += 1;
        true
    }

    /// Replaces the content of folder `id` with the content of `other` (its single
    /// root = the same folder, scanned again).
    pub fn graft(&mut self, id: NodeId, other: &Tree) -> bool {
        if self.node(id).is_none() {
            return false;
        }
        // nodes are never freed: a rescan may not grow the arena past the limit (review 033 #5)
        if self.nodes.len() + other.nodes.len() > self.max_nodes {
            return false;
        }
        // drop the old content
        let old = std::mem::take(&mut self.nodes[id as usize].children);
        let mut old_totals = self.nodes[id as usize].totals;
        old_totals.newest_ms = i64::MIN;
        self.sub_up(id, &old_totals);
        let mut stack = old;
        while let Some(c) = stack.pop() {
            self.nodes[c as usize].removed = true;
            stack.extend(std::mem::take(&mut self.nodes[c as usize].children));
        }
        let src = &other.nodes[TOP as usize];
        self.nodes[id as usize].small = src.small;
        self.nodes[id as usize].unreadable = src.unreadable;
        self.nodes[id as usize].totals = Totals::empty();
        let mut fresh = src.totals;
        // the parent's newest time may stay higher – only sizes and counts matter
        self.add_up(id, &{
            fresh.newest_ms = src.totals.newest_ms;
            fresh
        });
        self.nodes[id as usize].totals = src.totals;
        // copy the subtree with new ids
        let mut stack: Vec<(NodeId, NodeId)> = src.children.iter().map(|c| (*c, id)).collect();
        while let Some((oc, parent)) = stack.pop() {
            let on = &other.nodes[oc as usize];
            if on.removed {
                continue;
            }
            let nid = self.nodes.len() as NodeId;
            self.nodes.push(Node {
                name: on.name.clone(),
                parent,
                kind: on.kind,
                removed: false,
                unreadable: on.unreadable,
                totals: on.totals,
                modified_ms: on.modified_ms,
                children: Vec::new(),
                small: on.small,
            });
            self.nodes[parent as usize].children.push(nid);
            stack.extend(on.children.iter().map(|c| (*c, nid)));
        }
        self.simplified |= other.simplified;
        self.sort_children();
        self.version += 1;
        true
    }

    /// Whether `id` is a folder whose content could not be read.
    pub fn is_unreadable(&self, id: NodeId) -> bool {
        self.node(id).is_some_and(|n| n.unreadable)
    }
}
