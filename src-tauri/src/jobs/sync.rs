//! Folder sync job (design 036 E4): executes the actions the user chose in the
//! comparison – in this order: create folders, copy (temp + rename via the copy
//! engine), delete (trash by default). Every operation names both paths and what the
//! comparison saw on each side; right before a step the job checks that
//!
//! * both paths lie strictly below their root and name the same relative place,
//! * no component between the root and the entry is a symbolic link,
//! * the source (or the entry to delete) is still what the comparison saw, and the
//!   target too – a target that changed or appeared is asked about, never replaced
//!   silently.
//!
//! The lexical checks run in [`check_ops`] when the job is accepted as well.

use super::expect::{self, ExpectedEntry};
use super::{
    Control, DeleteMode, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary, copy, delete,
};
use crate::error::{FsError, FsErrorCode};
use crate::model::EntryKind;
use crate::paths::normalize_lexically;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MAX_OPS: usize = 200_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncAction {
    CopyToRight,
    CopyToLeft,
    DeleteLeft,
    DeleteRight,
}

/// What the comparison saw of an entry (`None` in [`SyncSide::seen`] = nothing there).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seen {
    pub kind: EntryKind,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSide {
    pub path: String,
    #[serde(default)]
    pub seen: Option<Seen>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOp {
    pub action: SyncAction,
    pub left: SyncSide,
    pub right: SyncSide,
}

impl SyncOp {
    /// (source, target) of a copy; (entry, other side) of a delete.
    fn sides(&self) -> (&SyncSide, &SyncSide) {
        match self.action {
            SyncAction::CopyToRight | SyncAction::DeleteLeft => (&self.left, &self.right),
            SyncAction::CopyToLeft | SyncAction::DeleteRight => (&self.right, &self.left),
        }
    }
    fn is_copy(&self) -> bool {
        matches!(
            self.action,
            SyncAction::CopyToRight | SyncAction::CopyToLeft
        )
    }
}

fn invalid(message: &str, path: Option<&Path>) -> FsError {
    FsError::new(FsErrorCode::InvalidPath, message, path)
}

/// `path` relative to `root`; `None` if it is not strictly below it.
fn below<'a>(root: &Path, path: &'a Path) -> Option<&'a Path> {
    path.strip_prefix(root)
        .ok()
        .filter(|rel| rel.components().next().is_some())
}

/// Lexical checks of all operations (no file system): every path strictly below its root,
/// left and right the same relative place, one operation per path, nothing copied into,
/// out of or onto a path that is deleted in the same job, the seen values present where
/// they must be. Paths are expected normalised (`JobManager` did that).
pub fn check_ops(left: &Path, right: &Path, ops: &[SyncOp]) -> Result<(), FsError> {
    if ops.is_empty() {
        return Err(invalid("Nothing to synchronise", None));
    }
    if ops.len() > MAX_OPS {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            format!("Too many operations (max. {MAX_OPS})"),
            None,
        ));
    }
    if left == right || left.starts_with(right) || right.starts_with(left) {
        return Err(FsError::new(
            FsErrorCode::TargetInsideSource,
            "One folder lies inside the other",
            Some(left),
        ));
    }
    let mut seen_paths: HashSet<&Path> = HashSet::new();
    let mut deleted: Vec<&Path> = Vec::new();
    for op in ops {
        let lp = Path::new(&op.left.path);
        let rp = Path::new(&op.right.path);
        let (Some(lrel), Some(rrel)) = (below(left, lp), below(right, rp)) else {
            return Err(invalid(
                "A path lies outside the compared folders",
                Some(lp),
            ));
        };
        if !crate::compare::same_place(lrel, rrel) {
            return Err(invalid(
                "Left and right path name different places",
                Some(lp),
            ));
        }
        for p in [lp, rp] {
            if !seen_paths.insert(p) {
                return Err(invalid("Two operations for one path", Some(p)));
            }
        }
        let (src, dst) = op.sides();
        if src.seen.is_none() {
            return Err(invalid(
                "The comparison saw nothing to work on",
                Some(Path::new(&src.path)),
            ));
        }
        if !op.is_copy() {
            deleted.push(Path::new(&src.path));
        } else if dst
            .seen
            .as_ref()
            .is_some_and(|s| s.kind == EntryKind::Directory)
            && src
                .seen
                .as_ref()
                .is_some_and(|s| s.kind != EntryKind::Directory)
        {
            return Err(FsError::new(
                FsErrorCode::NotAFile,
                "A folder cannot be replaced by a file",
                Some(Path::new(&dst.path)),
            ));
        }
    }
    for op in ops.iter().filter(|o| o.is_copy()) {
        for p in [Path::new(&op.left.path), Path::new(&op.right.path)] {
            if deleted.iter().any(|d| p.starts_with(d)) {
                return Err(invalid(
                    "An entry would be copied into or out of a deleted folder",
                    Some(p),
                ));
            }
        }
    }
    Ok(())
}

/// No component between `root` (exclusive) and `path` (exclusive) is a link or a file;
/// missing components are fine (they are created). `Err` explains the first bad one.
fn no_link_on_the_way(root: &Path, path: &Path) -> Result<(), FsError> {
    let Some(rel) = below(root, path) else {
        return Err(invalid(
            "A path lies outside the compared folders",
            Some(path),
        ));
    };
    let mut cur = root.to_path_buf();
    let comps: Vec<_> = rel.components().collect();
    for c in &comps[..comps.len().saturating_sub(1)] {
        cur.push(c);
        match fs::symlink_metadata(&cur) {
            Ok(m) if m.is_dir() => {}
            Ok(_) => {
                return Err(FsError::new(
                    FsErrorCode::NotADirectory,
                    "A link or file lies on the way – not followed",
                    Some(&cur),
                ));
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(FsError::from_io(&e, &cur)),
        }
    }
    Ok(())
}

/// Creates the missing folders from below `root` down to `dir` (inclusive), one by one;
/// an existing component must be a real folder.
fn ensure_dir(root: &Path, dir: &Path, created: &mut Vec<PathBuf>) -> Result<(), FsError> {
    let Some(rel) = below(root, dir) else {
        return if dir == root {
            Ok(())
        } else {
            Err(invalid(
                "A path lies outside the compared folders",
                Some(dir),
            ))
        };
    };
    let mut cur = root.to_path_buf();
    for c in rel.components() {
        cur.push(c);
        match fs::symlink_metadata(&cur) {
            Ok(m) if m.is_dir() => {}
            Ok(_) => {
                return Err(FsError::new(
                    FsErrorCode::NotADirectory,
                    "A link or file with the folder's name exists",
                    Some(&cur),
                ));
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => match fs::create_dir(&cur) {
                Ok(()) => created.push(cur.clone()),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    if !fs::symlink_metadata(&cur).is_ok_and(|m| m.is_dir()) {
                        return Err(FsError::from_io(&e, &cur));
                    }
                }
                Err(e) => return Err(FsError::from_io(&e, &cur)),
            },
            Err(e) => return Err(FsError::from_io(&e, &cur)),
        }
    }
    Ok(())
}

/// The folders must not be nested through a link or mount (review 036 #3).
fn check_physical(left: &Path, right: &Path) -> Result<(), FsError> {
    crate::compare::check_physical(left, right)
}

/// `path` is not one of the files the copy phase read or wrote (same device + inode).
fn not_copied(path: &Path, copied: &HashSet<(u64, u64)>) -> Result<(), FsError> {
    match crate::platform::file_identity(path) {
        Some(i) if copied.contains(&i.id) => Err(FsError::new(
            FsErrorCode::ChangedSinceListing,
            "The same file is copied in this job – not deleted",
            Some(path),
        )),
        _ => Ok(()),
    }
}

/// Entries a folder may hold to be deleted as a whole: every entry below it must be a delete
/// of this job and still what the comparison saw – hidden, excluded, filtered or new entries
/// keep the folder (review 036 #1). Links are not followed.
fn all_seen_below(dir: &Path, seen: &HashMap<PathBuf, &Seen>) -> Result<(), FsError> {
    let unseen = |p: &Path| {
        FsError::new(
            FsErrorCode::ChangedSinceListing,
            "The folder holds entries the comparison did not show – left in place",
            Some(p),
        )
    };
    let mut stack = vec![dir.to_path_buf()];
    let mut visited = 0usize;
    while let Some(d) = stack.pop() {
        let rd = fs::read_dir(&d).map_err(|e| FsError::from_io(&e, &d))?;
        for item in rd {
            let item = item.map_err(|e| FsError::from_io(&e, &d))?;
            let p = item.path();
            visited += 1;
            if visited > seen.len() {
                return Err(unseen(dir));
            }
            let Some(s) = seen.get(&p) else {
                return Err(unseen(&p));
            };
            still_seen(&p, s)?;
            let m = fs::symlink_metadata(&p).map_err(|e| FsError::from_io(&e, &p))?;
            if m.is_dir() {
                stack.push(p);
            }
        }
    }
    Ok(())
}

fn expected(path: &str, seen: &Seen) -> ExpectedEntry {
    ExpectedEntry {
        path: path.to_string(),
        kind: seen.kind,
        size: seen.size,
        modified_ms: seen.modified_ms,
    }
}

/// The entry is still what the comparison saw (and exists).
fn still_seen(path: &Path, seen: &Seen) -> Result<(), FsError> {
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(e) => return Err(FsError::from_io(&e, path)),
    }
    match expect::changed(path, &expected(&path.to_string_lossy(), seen)) {
        None => Ok(()),
        Some(why) => Err(FsError::new(
            FsErrorCode::ChangedSinceListing,
            format!("Changed since the comparison: {why}"),
            Some(path),
        )),
    }
}

struct Report<'a> {
    id: &'a str,
    emit: &'a (dyn Fn(JobEvent) + Send + Sync),
    summary: Summary,
}

impl Report<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        let e = ItemError {
            path: path.to_string_lossy().into_owned(),
            error,
        };
        if self.summary.items_failed <= 100 {
            (self.emit)(JobEvent::ItemFailed {
                id: self.id.to_string(),
                error: e.clone(),
            });
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(e);
        }
    }
}

/// Adds what `b` did to `a` (the copy and the delete phase of one job).
fn merge(a: &mut Summary, b: Summary) {
    a.items_done += b.items_done;
    a.items_skipped += b.items_skipped;
    a.items_failed += b.items_failed;
    a.bytes_done += b.bytes_done;
    for e in b.errors {
        if a.errors.len() < MAX_REPORTED_ERRORS {
            a.errors.push(e);
        }
    }
    if a.error.is_none() {
        a.error = b.error;
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    left: &Path,
    right: &Path,
    ops: &[SyncOp],
    mode: DeleteMode,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let left = normalize_lexically(left);
    let right = normalize_lexically(right);
    let mut rep = Report {
        id,
        emit,
        summary: Summary::default(),
    };
    if let Err(e) = check_ops(&left, &right, ops).and_then(|()| check_physical(&left, &right)) {
        rep.summary.error = Some(e);
        return (JobState::Failed, rep.summary);
    }
    for root in [&left, &right] {
        match fs::metadata(root) {
            Ok(m) if m.is_dir() => {}
            Ok(_) => {
                rep.summary.error = Some(FsError::new(
                    FsErrorCode::NotADirectory,
                    "Not a folder",
                    Some(root),
                ));
                return (JobState::Failed, rep.summary);
            }
            Err(e) => {
                rep.summary.error = Some(FsError::from_io(&e, root));
                return (JobState::Failed, rep.summary);
            }
        }
    }
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Planning,
    });
    let root_of = |p: &Path| -> PathBuf {
        if p.starts_with(&left) {
            left.clone()
        } else {
            right.clone()
        }
    };

    // 1. folders: shallow first
    let mut dir_ops: Vec<&SyncOp> = ops
        .iter()
        .filter(|o| {
            o.is_copy()
                && o.sides()
                    .0
                    .seen
                    .as_ref()
                    .is_some_and(|s| s.kind == EntryKind::Directory)
        })
        .collect();
    dir_ops.sort_by_key(|o| Path::new(&o.sides().1.path).components().count());
    let mut created: Vec<PathBuf> = Vec::new();
    for op in dir_ops {
        if control.is_cancelled() {
            return (JobState::Cancelled, rep.summary);
        }
        let (src, dst) = op.sides();
        let (sp, dp) = (Path::new(&src.path), Path::new(&dst.path));
        let check = no_link_on_the_way(&root_of(sp), sp)
            .and_then(|()| no_link_on_the_way(&root_of(dp), dp))
            .and_then(|()| still_seen(sp, src.seen.as_ref().expect("checked")))
            .and_then(|()| ensure_dir(&root_of(dp), dp, &mut created));
        match check {
            Ok(()) => rep.summary.items_done += 1,
            Err(e) => rep.fail(sp, e),
        }
    }

    // 2. files and links
    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut replace: HashMap<PathBuf, ExpectedEntry> = HashMap::new();
    for op in ops.iter().filter(|o| o.is_copy()) {
        let (src, dst) = op.sides();
        if src
            .seen
            .as_ref()
            .is_some_and(|s| s.kind == EntryKind::Directory)
        {
            continue;
        }
        if control.is_cancelled() {
            return (JobState::Cancelled, rep.summary);
        }
        let (sp, dp) = (PathBuf::from(&src.path), PathBuf::from(&dst.path));
        let check = no_link_on_the_way(&root_of(&sp), &sp)
            .and_then(|()| no_link_on_the_way(&root_of(&dp), &dp))
            .and_then(|()| still_seen(&sp, src.seen.as_ref().expect("checked")))
            .and_then(|()| match dp.parent() {
                Some(parent) => ensure_dir(&root_of(&dp), parent, &mut created),
                None => Err(invalid("No folder", Some(&dp))),
            });
        if let Err(e) = check {
            rep.fail(&sp, e);
            continue;
        }
        if let Some(seen) = &dst.seen
            && seen.kind != EntryKind::Directory
        {
            replace.insert(dp.clone(), expected(&dst.path, seen));
        }
        targets.push((sp, dp));
    }
    if !created.is_empty() {
        let mut dirs: Vec<String> = created
            .iter()
            .filter_map(|p| p.parent())
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        dirs.sort();
        dirs.dedup();
        emit(JobEvent::DirsChanged { dirs });
    }
    // what the copies read and write – a delete must never hit the same file under another
    // name (case-insensitive or normalising target with `ignore_case` off, review 036 #5)
    let copied: HashSet<(u64, u64)> = targets
        .iter()
        .flat_map(|(s, d)| [s, d])
        .filter_map(|p| crate::platform::file_identity(p).map(|i| i.id))
        .collect();
    let mut state = JobState::Done;
    if !targets.is_empty() {
        let before = std::mem::take(&mut rep.summary);
        // checked again right before each file: a link swapped in after planning (review 036 #6)
        let roots = (left.clone(), right.clone());
        let guard = move |dst: &Path| {
            let root = if dst.starts_with(&roots.0) {
                &roots.0
            } else {
                &roots.1
            };
            no_link_on_the_way(root, dst)
        };
        let (s, summary) =
            copy::run_targets(id, &targets, replace, Some(&guard), before, control, emit);
        rep.summary = summary;
        if s == JobState::Cancelled || s == JobState::Failed {
            return (s, rep.summary);
        }
        state = s;
    }

    // 3. deletes, per side (nested ones go with their folder)
    for side_root in [&left, &right] {
        let side_ops: Vec<&SyncOp> = ops
            .iter()
            .filter(|o| !o.is_copy() && Path::new(&o.sides().0.path).starts_with(side_root))
            .collect();
        // what the comparison saw of every entry to delete on this side
        let seen: HashMap<PathBuf, &Seen> = side_ops
            .iter()
            .filter_map(|o| {
                let e = o.sides().0;
                e.seen.as_ref().map(|s| (PathBuf::from(&e.path), s))
            })
            .collect();
        let mut paths: Vec<PathBuf> = Vec::new();
        for op in side_ops {
            let (entry, _) = op.sides();
            let p = PathBuf::from(&entry.path);
            if control.is_cancelled() {
                return (JobState::Cancelled, rep.summary);
            }
            let check = no_link_on_the_way(side_root, &p)
                .and_then(|()| still_seen(&p, entry.seen.as_ref().expect("checked")))
                .and_then(|()| not_copied(&p, &copied))
                .and_then(|()| {
                    if entry
                        .seen
                        .as_ref()
                        .is_some_and(|s| s.kind == EntryKind::Directory)
                    {
                        all_seen_below(&p, &seen)
                    } else {
                        Ok(())
                    }
                });
            match check {
                Ok(()) => paths.push(p),
                Err(e) if e.code == FsErrorCode::NotFound => rep.summary.items_skipped += 1,
                Err(e) => rep.fail(&p, e),
            }
        }
        if paths.is_empty() {
            continue;
        }
        let (s, summary) = delete::run(id, &paths, mode, control, emit);
        merge(&mut rep.summary, summary);
        match s {
            JobState::Cancelled => return (s, rep.summary),
            JobState::Failed | JobState::DoneWithErrors => state = JobState::DoneWithErrors,
            _ => {}
        }
    }
    if rep.summary.items_failed > 0 && state == JobState::Done {
        state = JobState::DoneWithErrors;
    }
    (state, rep.summary)
}
