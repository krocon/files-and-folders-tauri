//! The name index of the palette (design 043 E2): names, sizes and dates of the
//! entries below the index roots – nothing else, only in memory.
//!
//! Layout: one entry = one slot in parallel arrays (31 bytes) plus its name in one
//! string. A parent always comes before its children, so one pass over the arrays
//! knows the folders above every entry (bits of the words found there, see
//! [`Index::search`]). Updates append new entries and mark removed ones; when a
//! third is removed the hub builds the index again.

use super::query::{Matcher, Query, quick_bonus, score};
use crate::listing::is_hidden;
use regex::Regex;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

pub const NONE: u32 = u32::MAX;
/// Bytes per entry in the arrays (without the name).
pub const ENTRY_BYTES: u64 = 4 + 4 + 2 + 1 + 8 + 4 + 4 + 4;
/// Bytes per entry a query needs ([`Scratch`]) – counted against the limit as well.
pub const SCRATCH_BYTES: u64 = 4 + 1 + 2 + 1;
/// The arrays grow in steps of this many entries (no doubling past the limit).
const GROW: usize = 1 << 15;
/// Cancellation and progress are checked every this many entries.
const CHECK_EVERY: usize = 4096;

const REMOVED: u8 = 1;
const DIR: u8 = 2;
const LINK: u8 = 4;
const ROOT: u8 = 8;

/// What the index walks.
#[derive(Debug, Clone)]
pub struct IndexConfig {
    pub roots: Vec<PathBuf>,
    pub excludes: Option<Regex>,
    pub include_hidden: bool,
    pub max_bytes: u64,
    /// The home folder: the folder names below it count as the path of an entry.
    pub home: Option<PathBuf>,
}

impl IndexConfig {
    pub fn excluded(&self, name: &str) -> bool {
        self.excludes.as_ref().is_some_and(|re| re.is_match(name))
    }

    /// An entry that is not indexed (hidden, excluded).
    pub fn skips(&self, name: &str, meta: &Metadata) -> bool {
        (!self.include_hidden && is_hidden(name, meta)) || self.excluded(name)
    }
}

/// One entry as read from a folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub name: String,
    pub dir: bool,
    pub link: bool,
    pub size: u64,
    pub modified_ms: Option<i64>,
}

impl Item {
    fn from_meta(name: String, meta: &Metadata) -> Self {
        let ft = meta.file_type();
        Self {
            name,
            dir: ft.is_dir(),
            link: ft.is_symlink(),
            size: if ft.is_file() { meta.len() } else { 0 },
            modified_ms: meta.modified().ok().and_then(|t| {
                t.duration_since(UNIX_EPOCH)
                    .ok()
                    .and_then(|d| i64::try_from(d.as_millis()).ok())
            }),
        }
    }
}

/// A hit of [`Index::search`] (resolved to a path by the hub).
#[derive(Debug, Clone)]
pub struct Candidate {
    pub node: u32,
    pub score: i32,
    pub ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Default)]
pub struct SearchResult {
    pub hits: Vec<Candidate>,
    /// All entries that matched (more than `hits` when the limit cut).
    pub matched: u64,
    pub scanned: u64,
    pub cancelled: bool,
}

/// Places with a bonus (recent folders, tabs) and folders a hit must be below (`in:/x`).
#[derive(Debug, Default)]
pub struct SearchCtx {
    pub boosts: Vec<(PathBuf, i16)>,
    pub below: Vec<PathBuf>,
}

#[derive(Debug, Default)]
pub struct Index {
    parent: Vec<u32>,
    name_off: Vec<u32>,
    name_len: Vec<u16>,
    flags: Vec<u8>,
    size: Vec<u64>,
    /// Seconds since the epoch (0 = unknown).
    mtime: Vec<u32>,
    first_child: Vec<u32>,
    next_sibling: Vec<u32>,
    names: String,
    roots: Vec<(PathBuf, u32)>,
    removed: u32,
    dirs: u32,
    pub truncated: bool,
    max_bytes: u64,
}

impl Index {
    pub fn new(max_bytes: u64) -> Self {
        Self {
            max_bytes,
            ..Self::default()
        }
    }

    pub fn len(&self) -> usize {
        self.parent.len()
    }

    pub fn is_empty(&self) -> bool {
        self.parent.is_empty()
    }

    /// Entries that are not removed (roots included).
    pub fn live(&self) -> u64 {
        self.len() as u64 - u64::from(self.removed)
    }

    pub fn removed(&self) -> u32 {
        self.removed
    }

    pub fn dirs(&self) -> u32 {
        self.dirs
    }

    /// Memory of the arrays and names (capacity, not length).
    pub fn bytes(&self) -> u64 {
        self.parent.capacity() as u64 * (ENTRY_BYTES + SCRATCH_BYTES) + self.names.capacity() as u64
    }

    pub fn roots(&self) -> impl Iterator<Item = &Path> {
        self.roots.iter().map(|(p, _)| p.as_path())
    }

    fn reserve(&mut self, name_len: usize) -> bool {
        // the scratch of one query per entry belongs to the limit too (review 043 #7)
        let arrays = |cap: usize| cap as u64 * (ENTRY_BYTES + SCRATCH_BYTES);
        if self.parent.len() == self.parent.capacity() {
            // grow in steps; near the limit in small ones
            let cap = self.parent.capacity();
            let names = self.names.capacity() as u64;
            let Some(add) = [GROW.min(cap.max(1024)), 64]
                .into_iter()
                .find(|add| arrays(cap + add) + names <= self.max_bytes)
            else {
                return false;
            };
            self.parent.reserve_exact(add);
            self.name_off.reserve_exact(add);
            self.name_len.reserve_exact(add);
            self.flags.reserve_exact(add);
            self.size.reserve_exact(add);
            self.mtime.reserve_exact(add);
            self.first_child.reserve_exact(add);
            self.next_sibling.reserve_exact(add);
        }
        if self.names.len() + name_len > self.names.capacity() {
            let cap = self.names.capacity();
            let fixed = arrays(self.parent.capacity());
            let Some(add) = [(cap / 4).max(64 * 1024).max(name_len), name_len]
                .into_iter()
                .find(|add| fixed + (cap + add) as u64 <= self.max_bytes)
            else {
                return false;
            };
            if self.names.len() + name_len > u32::MAX as usize {
                return false;
            }
            self.names.reserve_exact(add);
        }
        true
    }

    /// Adds an entry below `parent` (`NONE` for a root); `None` when the memory limit is reached.
    fn add(&mut self, parent: u32, item: &Item, root: bool) -> Option<u32> {
        if item.name.len() > u16::MAX as usize || !self.reserve(item.name.len()) {
            self.truncated = true;
            return None;
        }
        let i = u32::try_from(self.parent.len())
            .ok()
            .filter(|i| *i != NONE)?;
        self.parent.push(parent);
        self.name_off.push(self.names.len() as u32);
        self.name_len.push(item.name.len() as u16);
        self.names.push_str(&item.name);
        let mut f = 0;
        if item.dir {
            f |= DIR;
            self.dirs += 1;
        }
        if item.link {
            f |= LINK;
        }
        if root {
            f |= ROOT;
        }
        self.flags.push(f);
        self.size.push(item.size);
        self.mtime.push(secs(item.modified_ms));
        self.first_child.push(NONE);
        if parent == NONE {
            self.next_sibling.push(NONE);
        } else {
            let p = parent as usize;
            self.next_sibling.push(self.first_child[p]);
            self.first_child[p] = i;
        }
        Some(i)
    }

    pub fn name(&self, i: u32) -> &str {
        let i = i as usize;
        let off = self.name_off[i] as usize;
        &self.names[off..off + self.name_len[i] as usize]
    }

    pub fn is_dir(&self, i: u32) -> bool {
        self.flags[i as usize] & DIR != 0
    }

    pub fn is_removed(&self, i: u32) -> bool {
        self.flags[i as usize] & REMOVED != 0
    }

    pub fn modified_ms(&self, i: u32) -> Option<i64> {
        match self.mtime[i as usize] {
            0 => None,
            s => Some(i64::from(s) * 1000),
        }
    }

    /// The full path of an entry (a root's name is its path).
    pub fn path_of(&self, i: u32) -> PathBuf {
        let mut chain = Vec::new();
        let mut cur = i;
        while cur != NONE {
            chain.push(cur);
            cur = self.parent[cur as usize];
        }
        let mut path = PathBuf::new();
        for n in chain.into_iter().rev() {
            path.push(self.name(n));
        }
        path
    }

    fn children(&self, i: u32) -> impl Iterator<Item = u32> + '_ {
        let mut cur = self.first_child[i as usize];
        std::iter::from_fn(move || {
            while cur != NONE {
                let c = cur;
                cur = self.next_sibling[c as usize];
                if !self.is_removed(c) {
                    return Some(c);
                }
            }
            None
        })
    }

    fn child(&self, i: u32, name: &str) -> Option<u32> {
        self.children(i).find(|c| self.name(*c) == name)
    }

    /// The entry at `path` (a root or below one).
    pub fn find(&self, path: &Path) -> Option<u32> {
        let (root, node) = self
            .roots
            .iter()
            .filter(|(r, _)| path.starts_with(r))
            .max_by_key(|(r, _)| r.as_os_str().len())?;
        let mut cur = *node;
        for c in path.strip_prefix(root).ok()?.components() {
            cur = self.child(cur, c.as_os_str().to_str()?)?;
        }
        (!self.is_removed(cur)).then_some(cur)
    }

    /// Marks an entry and everything below as removed.
    pub fn remove_subtree(&mut self, i: u32) {
        let mut stack = vec![i];
        while let Some(n) = stack.pop() {
            if self.flags[n as usize] & REMOVED != 0 {
                continue;
            }
            self.flags[n as usize] |= REMOVED;
            self.removed += 1;
            if self.flags[n as usize] & DIR != 0 {
                self.dirs = self.dirs.saturating_sub(1);
            }
            let mut c = self.first_child[n as usize];
            while c != NONE {
                stack.push(c);
                c = self.next_sibling[c as usize];
            }
        }
    }

    // ---- building ---------------------------------------------------------------------

    /// Walks the roots (each once, not across file systems, no links followed).
    pub fn build(config: &IndexConfig, cancel: &AtomicBool) -> Index {
        let mut index = Index::new(config.max_bytes);
        let mut seen: HashSet<PathBuf> = HashSet::new();
        for root in &config.roots {
            if cancel.load(Ordering::Relaxed) || index.truncated {
                break;
            }
            // a root inside another root is covered by that one
            if config
                .roots
                .iter()
                .any(|r| r != root && root.starts_with(r))
                || !seen.insert(root.clone())
            {
                continue;
            }
            index.add_root(root, config, cancel);
        }
        index.shrink();
        index
    }

    fn shrink(&mut self) {
        self.parent.shrink_to_fit();
        self.name_off.shrink_to_fit();
        self.name_len.shrink_to_fit();
        self.flags.shrink_to_fit();
        self.size.shrink_to_fit();
        self.mtime.shrink_to_fit();
        self.first_child.shrink_to_fit();
        self.next_sibling.shrink_to_fit();
        self.names.shrink_to_fit();
    }

    fn add_root(&mut self, root: &Path, config: &IndexConfig, cancel: &AtomicBool) {
        let Ok(meta) = fs::metadata(root) else { return };
        let Some(name) = root.to_str() else { return };
        if !meta.is_dir() {
            return;
        }
        let item = Item {
            name: name.to_string(),
            dir: true,
            link: false,
            size: 0,
            modified_ms: None,
        };
        let Some(node) = self.add(NONE, &item, true) else {
            return;
        };
        self.roots.push((root.to_path_buf(), node));
        let dev = device(&meta);
        self.fill(root.to_path_buf(), node, dev, config, cancel, usize::MAX);
    }

    /// Adds everything below `dir` (node `node`), at most `budget` entries.
    fn fill(
        &mut self,
        dir: PathBuf,
        node: u32,
        dev: Option<u64>,
        config: &IndexConfig,
        cancel: &AtomicBool,
        budget: usize,
    ) -> usize {
        let mut stack = vec![(dir, node)];
        let mut added = 0usize;
        while let Some((dir, node)) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let Ok(items) = read_items(&dir, config) else {
                continue;
            };
            for (item, meta) in items {
                if added >= budget {
                    return added;
                }
                let Some(child) = self.add(node, &item, false) else {
                    return added;
                };
                added += 1;
                if item.dir
                    && !item.link
                    && same_device(dev, &meta)
                    && !crate::search::is_virtual_fs(&dir.join(&item.name))
                {
                    stack.push((dir.join(&item.name), child));
                }
            }
        }
        added
    }

    // ---- updates ----------------------------------------------------------------------

    /// Takes over a fresh listing of `dir` (read with [`read_items`] outside any lock):
    /// gone entries are removed, changed ones updated, new ones added. Returns the new
    /// folders – the caller reads them with [`Index::collect`] and adds them with [`Index::graft`].
    pub fn apply_dir(&mut self, dir: &Path, items: &[(Item, Metadata)]) -> Vec<PathBuf> {
        let Some(node) = self.find(dir) else {
            return Vec::new();
        };
        if !self.is_dir(node) {
            return Vec::new();
        }
        let existing: HashMap<String, u32> = self
            .children(node)
            .map(|c| (self.name(c).to_string(), c))
            .collect();
        let mut keep: HashSet<u32> = HashSet::new();
        let mut new_dirs = Vec::new();
        for (item, _) in items {
            match existing.get(&item.name) {
                Some(&c)
                    if self.is_dir(c) == item.dir
                        && (self.flags[c as usize] & LINK != 0) == item.link =>
                {
                    keep.insert(c);
                    self.size[c as usize] = item.size;
                    self.mtime[c as usize] = secs(item.modified_ms);
                }
                _ => {
                    if let Some(&old) = existing.get(&item.name) {
                        self.remove_subtree(old);
                    }
                    if let Some(c) = self.add(node, item, false) {
                        keep.insert(c);
                        if item.dir && !item.link {
                            new_dirs.push(dir.join(&item.name));
                        }
                    }
                }
            }
        }
        for c in existing.into_values() {
            if !keep.contains(&c) {
                self.remove_subtree(c);
            }
        }
        new_dirs
    }

    /// Reads the subtree of a new folder **outside** any lock (at most `budget` entries,
    /// preorder; the parent is an index into the list, [`NONE`] = `dir` itself). `true` in
    /// the second place: the budget was reached.
    pub fn collect(
        dir: &Path,
        config: &IndexConfig,
        cancel: &AtomicBool,
        budget: usize,
    ) -> (Vec<(u32, Item)>, bool) {
        let dev = fs::metadata(dir).ok().and_then(|m| device(&m));
        let mut out: Vec<(u32, Item)> = Vec::new();
        let mut stack = vec![(dir.to_path_buf(), NONE)];
        while let Some((d, parent)) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let Ok(items) = read_items(&d, config) else {
                continue;
            };
            for (item, meta) in items {
                if out.len() >= budget {
                    return (out, true);
                }
                let enter = item.dir
                    && !item.link
                    && same_device(dev, &meta)
                    && !crate::search::is_virtual_fs(&d.join(&item.name));
                let path = d.join(&item.name);
                out.push((parent, item));
                if enter {
                    stack.push((path, (out.len() - 1) as u32));
                }
            }
        }
        (out, false)
    }

    /// Adds what [`Index::collect`] read below `dir` (if `dir` is still an empty folder of
    /// the index); a cut list makes the index `truncated` – the live walk covers the rest.
    pub fn graft(&mut self, dir: &Path, list: &[(u32, Item)], cut: bool) {
        let Some(node) = self.find(dir) else { return };
        if !self.is_dir(node) || self.children(node).next().is_some() {
            return;
        }
        let mut ids: Vec<u32> = Vec::with_capacity(list.len());
        for (parent, item) in list {
            let p = if *parent == NONE {
                node
            } else {
                ids.get(*parent as usize).copied().unwrap_or(NONE)
            };
            if p == NONE {
                ids.push(NONE);
                continue;
            }
            match self.add(p, item, false) {
                Some(id) => ids.push(id),
                None => return,
            }
        }
        if cut {
            self.truncated = true;
        }
    }

    /// Removes the entry at `path` (gone folder, failed check of a hit).
    pub fn remove_path(&mut self, path: &Path) {
        if let Some(i) = self.find(path)
            && self.flags[i as usize] & ROOT == 0
        {
            self.remove_subtree(i);
        }
    }

    // ---- search -----------------------------------------------------------------------

    /// The best `limit` entries for `q`. Words count in the name and in the folder names
    /// below the home folder (outside: the root's own name); the roots are no hits.
    #[allow(clippy::too_many_arguments)]
    pub fn search(
        &self,
        q: &Query,
        ctx: &SearchCtx,
        home: Option<&Path>,
        limit: usize,
        cancel: &AtomicBool,
        scratch: &mut Scratch,
    ) -> SearchResult {
        let n = self.len();
        let mut out = SearchResult::default();
        let mut m = Matcher::new(q);
        // bits passed to the children, depth, bonus and "below an in:/x folder" – one
        // buffer of the hub, reused by every query (its size is part of the limit)
        let use_below = !ctx.below.is_empty();
        scratch.reset(n, !use_below);
        let Scratch {
            down,
            depth,
            boost,
            below,
        } = scratch;
        for (path, b) in &ctx.boosts {
            if let Some(i) = self.find(path) {
                boost[i as usize] = boost[i as usize].max(*b);
            }
        }
        for path in &ctx.below {
            if let Some(i) = self.find(path) {
                below[i as usize] = true;
            }
        }
        let keep = limit.saturating_mul(3).max(limit + 32);
        let mut heap: BinaryHeap<Reverse<(i32, u32)>> = BinaryHeap::with_capacity(keep + 1);
        for i in 0..n {
            if i % CHECK_EVERY == 0 && cancel.load(Ordering::Relaxed) {
                out.cancelled = true;
                return out;
            }
            let f = self.flags[i];
            if f & REMOVED != 0 {
                continue;
            }
            out.scanned += 1;
            if f & ROOT != 0 {
                down[i] = root_bits(&mut m, Path::new(self.name(i as u32)), home);
                continue;
            }
            let p = self.parent[i] as usize;
            let above = down[p];
            depth[i] = depth[p].saturating_add(1);
            boost[i] = boost[i].max(boost[p]);
            below[i] = below[i] || below[p];
            let name = self.name(i as u32);
            let own = m.bits(name);
            down[i] = above | own;
            let is_dir = f & DIR != 0;
            let size = (!is_dir && f & LINK == 0).then_some(self.size[i]);
            if !below[i]
                || !m.is_hit(
                    own,
                    above,
                    m.folded(),
                    is_dir,
                    size,
                    self.modified_ms(i as u32),
                )
            {
                continue;
            }
            out.matched += 1;
            // a quick rank for the heap; the exact one is computed for the few kept
            let words = (own & q.all_terms()).count_ones() as i32;
            let pre = words * 100 + quick_bonus(q, m.folded(), own)
                - i32::from(depth[i]) * 2
                - (name.len() as i32) / 8
                + i32::from(boost[i]);
            // full: only a better one gets in (no push and pop for most of a broad query)
            if heap.len() >= keep {
                if heap.peek().is_some_and(|Reverse((low, _))| pre <= *low) {
                    continue;
                }
                heap.pop();
            }
            heap.push(Reverse((pre, i as u32)));
        }
        let mut hits: Vec<Candidate> = heap
            .into_iter()
            .map(|Reverse((_, i))| {
                let (s, ranges) = score(
                    q,
                    self.name(i),
                    u32::from(depth[i as usize]),
                    i32::from(boost[i as usize]),
                );
                Candidate {
                    node: i,
                    score: s,
                    ranges,
                }
            })
            .collect();
        hits.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| self.name(a.node).cmp(self.name(b.node)))
        });
        hits.truncate(limit);
        out.hits = hits;
        out
    }

    /// The folders of the index (not links), at most `max` – the Linux watcher watches each.
    pub fn dir_paths(&self, max: usize) -> Vec<PathBuf> {
        (0..self.len() as u32)
            .filter(|&i| {
                let f = self.flags[i as usize];
                f & DIR != 0 && f & (REMOVED | LINK) == 0
            })
            .take(max)
            .map(|i| self.path_of(i))
            .collect()
    }

    pub fn size_of(&self, i: u32) -> u64 {
        self.size[i as usize]
    }
}

/// The buffers of a query over the index (one per hub, reused).
#[derive(Debug, Default)]
pub struct Scratch {
    down: Vec<u32>,
    depth: Vec<u8>,
    boost: Vec<i16>,
    below: Vec<bool>,
}

impl Scratch {
    fn reset(&mut self, n: usize, below: bool) {
        self.down.clear();
        self.down.resize(n, 0);
        self.depth.clear();
        self.depth.resize(n, 0);
        self.boost.clear();
        self.boost.resize(n, 0);
        self.below.clear();
        self.below.resize(n, below);
    }

    /// Gives the memory back (the index was dropped).
    pub fn release(&mut self) {
        *self = Scratch::default();
    }
}

/// Bits of a root: the folder names below the home folder, outside it the root's name
/// (only `in:` words there would be too broad otherwise – every entry would match).
pub fn root_bits(m: &mut Matcher<'_>, root: &Path, home: Option<&Path>) -> u32 {
    let mut bits = 0;
    match home.and_then(|h| root.strip_prefix(h).ok()) {
        Some(rel) => {
            for c in rel.components() {
                if let Some(s) = c.as_os_str().to_str() {
                    bits |= m.bits(s);
                }
            }
        }
        None => {
            if let Some(s) = root.file_name().and_then(|n| n.to_str()) {
                bits |= m.bits(s);
            }
        }
    }
    bits
}

/// The entries of a folder that the index keeps (UTF-8 names, not skipped), with their
/// `lstat` metadata.
pub fn read_items(dir: &Path, config: &IndexConfig) -> std::io::Result<Vec<(Item, Metadata)>> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir)? {
        let Ok(e) = e else { break };
        let Ok(name) = e.file_name().into_string() else {
            continue;
        };
        let Ok(meta) = e.metadata() else { continue };
        if config.skips(&name, &meta) {
            continue;
        }
        out.push((Item::from_meta(name, &meta), meta));
    }
    Ok(out)
}

fn secs(ms: Option<i64>) -> u32 {
    match ms {
        Some(ms) if ms >= 1000 => u32::try_from(ms / 1000).unwrap_or(u32::MAX),
        _ => 0,
    }
}

pub(crate) fn device(meta: &Metadata) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(meta.dev())
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        None
    }
}

pub(crate) fn same_device(dev: Option<u64>, meta: &Metadata) -> bool {
    dev.is_none() || device(meta) == dev
}

#[cfg(test)]
mod tests;
