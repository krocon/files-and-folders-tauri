//! Retry of failed tasks (design 048): what a finished task left undone, kept only in
//! memory (like the rename undo log). A task that failed as a whole runs again as it
//! was; a task that ended with errors runs again with only what failed:
//!
//! - copy/move (local and server): the exact pairs *source → target* the runner noted
//!   ([`Notes`]) – never flat into the target folder; a move also removes the source
//!   folders that are empty afterwards;
//! - list jobs (delete, rename, group, …): the items whose path (or target path) failed,
//!   taken from `Summary.errors` – only when that list is complete.
//!
//! Errors that say "this is something else now" (`not_found`, `changed_since_listing`,
//! `duplicate_changed`) or that a retry cannot fix are never retried: a retry must not
//! touch what the first run refused to touch.

use super::transfer::Loc;
use super::{DeleteMode, ItemError, JobSpec, JobState, Summary, checksum};
use crate::error::FsErrorCode;
use crate::platform::file_id;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

/// Pairs a copy/move job notes at most; beyond that the job offers no retry.
pub const MAX_RETRY_ITEMS: usize = 100_000;
/// Finished tasks whose retry plan is kept (the oldest drops out).
pub const RETRY_LOG_SIZE: usize = 50;

pub type FileId = Option<(u64, u64)>;
/// Source folders removed after a retry when empty (with the id they had).
pub type Cleanup = Vec<(Loc, FileId)>;

/// One failed entry of a copy or move: the source and its exact target path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryPair {
    pub src: Loc,
    pub dst: Loc,
    /// Device + inode of the source when it was planned (local): a move retries only
    /// while the path still names this entry.
    pub id: FileId,
    /// The copy arrived, only removing the source failed (move).
    pub copied: bool,
}

#[derive(Debug, Default)]
struct NotesInner {
    pairs: Vec<RetryPair>,
    cleanup: Vec<(Loc, FileId)>,
    seen: HashSet<Loc>,
    overflow: bool,
}

/// What a copy/move runner noted while it ran (lives in the job's `Control`).
#[derive(Debug, Default)]
pub struct Notes(Mutex<NotesInner>);

/// The notes of one finished run.
#[derive(Debug, Default)]
pub struct Noted {
    pub pairs: Vec<RetryPair>,
    pub cleanup: Vec<(Loc, FileId)>,
    pub overflow: bool,
}

impl Notes {
    fn lock(&self) -> MutexGuard<'_, NotesInner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Notes a failed pair; `cleanup` = source folders between the entry and its
    /// top-level source (move), removed after a retry when empty.
    pub fn pair(&self, pair: RetryPair, cleanup: Vec<(Loc, FileId)>) {
        let mut n = self.lock();
        if n.pairs.len() >= MAX_RETRY_ITEMS {
            n.overflow = true;
            return;
        }
        n.pairs.push(pair);
        self.add_cleanup(&mut n, cleanup);
    }

    /// Folders to remove when empty after a retry (kept from an earlier run).
    pub fn cleanup(&self, dirs: Vec<(Loc, FileId)>) {
        let mut n = self.lock();
        self.add_cleanup(&mut n, dirs);
    }

    fn add_cleanup(&self, n: &mut NotesInner, dirs: Vec<(Loc, FileId)>) {
        for (d, id) in dirs {
            if n.seen.len() >= MAX_RETRY_ITEMS {
                n.overflow = true;
                return;
            }
            if n.seen.insert(d.clone()) {
                n.cleanup.push((d, id));
            }
        }
    }

    pub fn take(&self) -> Noted {
        let mut n = self.lock();
        let inner = std::mem::take(&mut *n);
        Noted {
            pairs: inner.pairs,
            cleanup: inner.cleanup,
            overflow: inner.overflow,
        }
    }
}

/// The source folders between `src` and its top-level source `top` (both included
/// when `src` lies below `top`; empty when `src` is the top itself).
pub fn chain(src: &Loc, top: &Loc) -> Vec<Loc> {
    let mut out = Vec::new();
    if src == top || !src.starts_with(top) {
        return out;
    }
    let mut cur = src.parent();
    while let Some(p) = cur {
        if !p.starts_with(top) {
            break;
        }
        let at_top = p == *top;
        cur = p.parent();
        out.push(p);
        if at_top {
            break;
        }
    }
    out
}

/// How the retry runs besides its (normal, visible) spec.
#[derive(Debug, PartialEq, Eq)]
pub enum RetryExtra {
    /// Copy/move: exactly these pairs below `root` (the original target folder).
    Pairs {
        root: Loc,
        pairs: Vec<RetryPair>,
        cleanup: Vec<(Loc, FileId)>,
    },
    /// Permanent delete of failed entries: afterwards remove these folders when empty.
    Cleanup { dirs: Vec<(Loc, FileId)> },
    /// Extract: only the entries (inner names) that failed – at their usual place.
    ExtractOnly { inner: Vec<Vec<String>> },
}

/// What `retry_job` starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryPlan {
    pub spec: JobSpec,
    pub extra: Option<Arc<RetryExtra>>,
}

impl RetryPlan {
    fn whole(spec: &JobSpec) -> Self {
        Self {
            spec: spec.clone(),
            extra: None,
        }
    }
    fn part(spec: JobSpec) -> Self {
        Self { spec, extra: None }
    }
}

/// Errors a retry must leave alone: the entry is something else now, or retrying cannot help.
fn retryable(e: &ItemError) -> bool {
    !matches!(
        e.error.code,
        FsErrorCode::NotFound
            | FsErrorCode::ChangedSinceListing
            | FsErrorCode::DuplicateChanged
            | FsErrorCode::InvalidPath
            | FsErrorCode::UnsafeEntry
            | FsErrorCode::SymlinkSkipped
            | FsErrorCode::SameSourceTarget
            | FsErrorCode::TargetInsideSource
            | FsErrorCode::DangerousPath
    )
}

/// `path` is `item` or lies below it (server paths by profile + components).
fn at_or_below(path: &str, item: &str) -> bool {
    if crate::remote::is_remote(path) || crate::remote::is_remote(item) {
        return match (
            crate::remote::RemotePath::parse(path),
            crate::remote::RemotePath::parse(item),
        ) {
            (Ok(p), Ok(i)) => p.starts_with(&i),
            _ => false,
        };
    }
    crate::paths::normalize_lexically(Path::new(path))
        .starts_with(crate::paths::normalize_lexically(Path::new(item)))
}

fn same(path: &str, item: &str) -> bool {
    at_or_below(path, item) && at_or_below(item, path)
}

/// The retry of a finished task, `None` = nothing to retry. `noted` = what the
/// copy/move runner noted. Called right after the run (stats the disk for the
/// snapshot a delete retry compares against).
pub fn build(
    spec: &JobSpec,
    state: JobState,
    summary: &Summary,
    noted: Noted,
) -> Option<RetryPlan> {
    if spec.is_helper() || matches!(spec, JobSpec::Simulate { .. }) {
        return None;
    }
    match state {
        JobState::Failed => Some(RetryPlan::whole(spec)),
        JobState::DoneWithErrors => partial(spec, summary, noted),
        _ => None,
    }
}

fn partial(spec: &JobSpec, summary: &Summary, noted: Noted) -> Option<RetryPlan> {
    // the error list of list jobs must be complete – a cut list would lose entries silently
    let complete = summary.errors.len() as u64 >= summary.items_failed;
    let failed: Vec<&str> = summary
        .errors
        .iter()
        .filter(|e| retryable(e))
        .map(|e| e.path.as_str())
        .collect();
    let any_failed = |item: &str| failed.iter().any(|f| at_or_below(f, item));
    let exactly = |item: &str| failed.iter().any(|f| same(f, item));
    let list = |ok: bool| if ok && complete { Some(()) } else { None };
    match spec {
        // one archive / one list file: all or nothing
        JobSpec::Pack { .. }
        | JobSpec::ArchiveAdd { .. }
        | JobSpec::ArchiveDelete { .. }
        | JobSpec::ArchiveMkdir { .. }
        | JobSpec::VerifyChecksums { .. }
        | JobSpec::ViewEntry { .. }
        | JobSpec::Checksum {
            output: checksum::ChecksumOutput::List { .. },
            ..
        } => Some(RetryPlan::whole(spec)),
        JobSpec::Copy {
            target_dir,
            background,
            options,
            ..
        } => {
            let (root, pairs, _) = pairs_of(target_dir, noted)?;
            Some(RetryPlan {
                spec: JobSpec::Copy {
                    sources: sources_of(&pairs),
                    target_dir: target_dir.clone(),
                    background: *background,
                    options: super::CopyOptions {
                        conflict_default: options.conflict_default,
                        rename_to: None,
                    },
                },
                extra: Some(Arc::new(RetryExtra::Pairs {
                    root,
                    pairs,
                    cleanup: Vec::new(),
                })),
            })
        }
        JobSpec::Move {
            target_dir,
            background,
            options,
            allow_dangerous,
            ..
        } => {
            let (root, pairs, cleanup) = pairs_of(target_dir, noted)?;
            Some(RetryPlan {
                spec: JobSpec::Move {
                    sources: sources_of(&pairs),
                    target_dir: target_dir.clone(),
                    background: *background,
                    options: super::CopyOptions {
                        conflict_default: options.conflict_default,
                        rename_to: None,
                    },
                    allow_dangerous: *allow_dangerous,
                    // the pairs carry the file ids of the first run – stricter than a listing
                    expected: Vec::new(),
                },
                extra: Some(Arc::new(RetryExtra::Pairs {
                    root,
                    pairs,
                    cleanup,
                })),
            })
        }
        JobSpec::Delete {
            paths,
            mode,
            background,
            allow_dangerous,
            expected,
        } => {
            list(true)?;
            let (paths, dirs) = match mode {
                DeleteMode::Trash => (
                    paths.iter().filter(|p| exactly(p)).cloned().collect(),
                    Vec::new(),
                ),
                DeleteMode::Permanent => deep_failed(paths, &failed),
            };
            if paths.is_empty() {
                return None;
            }
            // what is there now – a retry leaves alone whatever changes before it runs
            let expected = paths
                .iter()
                .filter_map(|p| snapshot(p).or_else(|| find_expected(expected, p)))
                .collect();
            Some(RetryPlan {
                spec: JobSpec::Delete {
                    paths,
                    mode: *mode,
                    background: *background,
                    allow_dangerous: *allow_dangerous,
                    expected,
                },
                extra: (!dirs.is_empty()).then(|| Arc::new(RetryExtra::Cleanup { dirs })),
            })
        }
        JobSpec::Rename { items, undo_of } => {
            let items: Vec<_> = items.iter().filter(|i| exactly(&i.path)).cloned().collect();
            list(!items.is_empty())?;
            Some(RetryPlan::part(JobSpec::Rename {
                items,
                undo_of: undo_of.clone(),
            }))
        }
        JobSpec::Group {
            root,
            subdir,
            items,
            transfer,
            options,
        } => {
            let base = match subdir {
                Some(s) => Path::new(root).join(s),
                None => PathBuf::from(root),
            };
            let items: Vec<_> = items
                .iter()
                .filter(|i| {
                    let target = Path::new(&i.path)
                        .file_name()
                        .map(|n| base.join(&i.group).join(n));
                    any_failed(&i.path) || target.is_some_and(|t| any_failed(&t.to_string_lossy()))
                })
                .cloned()
                .collect();
            list(!items.is_empty())?;
            Some(RetryPlan::part(JobSpec::Group {
                root: root.clone(),
                subdir: subdir.clone(),
                items,
                transfer: *transfer,
                options: options.clone(),
            }))
        }
        JobSpec::Clean {
            roots,
            items,
            mode,
            options,
        } => {
            let items: Vec<_> = items.iter().filter(|i| exactly(&i.path)).cloned().collect();
            list(!items.is_empty())?;
            Some(RetryPlan::part(JobSpec::Clean {
                roots: roots.clone(),
                items,
                mode: *mode,
                options: options.clone(),
            }))
        }
        JobSpec::Sync {
            left,
            right,
            ops,
            delete_mode,
        } => {
            let ops: Vec<_> = ops
                .iter()
                .filter(|o| any_failed(&o.left.path) || any_failed(&o.right.path))
                .cloned()
                .collect();
            list(!ops.is_empty())?;
            Some(RetryPlan::part(JobSpec::Sync {
                left: left.clone(),
                right: right.clone(),
                ops,
                delete_mode: *delete_mode,
            }))
        }
        JobSpec::Dedupe {
            groups,
            action,
            target_dir,
            verify,
            threshold,
            allow_dangerous,
        } => {
            let groups: Vec<_> = groups
                .iter()
                .filter_map(|g| {
                    let remove: Vec<_> = g
                        .remove
                        .iter()
                        .filter(|e| exactly(&e.path))
                        .cloned()
                        .collect();
                    (!remove.is_empty()).then(|| super::dedupe::DedupeGroup {
                        keep: g.keep.clone(),
                        remove,
                    })
                })
                .collect();
            list(!groups.is_empty())?;
            Some(RetryPlan::part(JobSpec::Dedupe {
                groups,
                action: *action,
                target_dir: target_dir.clone(),
                verify: *verify,
                threshold: *threshold,
                allow_dangerous: *allow_dangerous,
            }))
        }
        JobSpec::Link {
            sources,
            target_dir,
            options,
        } => {
            let sources: Vec<_> = sources.iter().filter(|s| exactly(s)).cloned().collect();
            list(!sources.is_empty())?;
            let mut options = options.clone();
            if sources.len() != 1 {
                options.rename_to = None;
            }
            Some(RetryPlan::part(JobSpec::Link {
                sources,
                target_dir: target_dir.clone(),
                options,
            }))
        }
        JobSpec::Checksum {
            paths,
            base_dir,
            algo,
            output,
        } => {
            let retry = failed_below(paths, &failed);
            list(!retry.is_empty())?;
            Some(RetryPlan::part(JobSpec::Checksum {
                paths: retry,
                base_dir: base_dir.clone(),
                algo: *algo,
                output: output.clone(),
            }))
        }
        JobSpec::Attributes {
            paths,
            change,
            recursive,
            apply_to,
        } => {
            let retry = failed_below(paths, &failed);
            list(!retry.is_empty())?;
            Some(RetryPlan::part(JobSpec::Attributes {
                paths: retry,
                change: change.clone(),
                recursive: *recursive,
                apply_to: *apply_to,
            }))
        }
        JobSpec::Extract { archive, .. } => {
            let archive = Path::new(archive);
            let mut inner: Vec<Vec<String>> = Vec::new();
            for f in &failed {
                if let Some(i) = crate::archive::inner_of(archive, Path::new(f))
                    && !i.is_empty()
                    && !inner.contains(&i)
                {
                    inner.push(i);
                }
            }
            list(!inner.is_empty())?;
            Some(RetryPlan {
                spec: spec.clone(),
                extra: Some(Arc::new(RetryExtra::ExtractOnly { inner })),
            })
        }
        JobSpec::Search { .. }
        | JobSpec::Compare { .. }
        | JobSpec::Duplicates { .. }
        | JobSpec::Count { .. }
        | JobSpec::DirSize { .. }
        | JobSpec::DiskUsage { .. }
        | JobSpec::Simulate { .. }
        | JobSpec::Shell { .. } => None,
    }
}

/// The noted pairs of a copy/move (nested ones dropped: the outer pair brings them).
fn pairs_of(target_dir: &str, noted: Noted) -> Option<(Loc, Vec<RetryPair>, Cleanup)> {
    if noted.overflow || noted.pairs.is_empty() {
        return None;
    }
    let root = Loc::parse(target_dir).ok()?;
    let all = noted.pairs;
    let mut pairs: Vec<RetryPair> = Vec::with_capacity(all.len());
    let mut seen: HashSet<Loc> = HashSet::new();
    let dirs: HashSet<Loc> = all.iter().map(|p| p.src.clone()).collect();
    for p in all {
        // below another noted source (a folder that is retried as a whole)
        let mut up = p.src.parent();
        let mut nested = false;
        while let Some(u) = up {
            if dirs.contains(&u) {
                nested = true;
                break;
            }
            up = u.parent();
        }
        // the target must stay inside the original target folder
        if nested || !p.dst.starts_with(&root) || p.dst == root || !seen.insert(p.src.clone()) {
            continue;
        }
        pairs.push(p);
    }
    (!pairs.is_empty()).then_some((root, pairs, noted.cleanup))
}

fn sources_of(pairs: &[RetryPair]) -> Vec<String> {
    pairs.iter().map(|p| p.src.display()).collect()
}

/// The failed paths at or below the selection (nested ones dropped).
fn failed_below(selection: &[String], failed: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = failed
        .iter()
        .filter(|f| selection.iter().any(|s| at_or_below(f, s)))
        .map(|f| f.to_string())
        .collect();
    out.sort();
    out.dedup();
    let keep: Vec<bool> = out
        .iter()
        .map(|p| !out.iter().any(|o| o != p && at_or_below(p, o)))
        .collect();
    out.into_iter()
        .zip(keep)
        .filter_map(|(p, k)| k.then_some(p))
        .collect()
}

/// Permanent delete: the failed entries below the selection and, for each, the
/// folders up to its selected path (removed afterwards when empty).
fn deep_failed(selection: &[String], failed: &[&str]) -> (Vec<String>, Vec<(Loc, FileId)>) {
    let paths = failed_below(selection, failed);
    let mut dirs: Vec<(Loc, FileId)> = Vec::new();
    let mut seen: HashSet<Loc> = HashSet::new();
    for p in &paths {
        let Some(top) = selection.iter().find(|s| at_or_below(p, s)) else {
            continue;
        };
        let (Ok(pl), Ok(tl)) = (Loc::parse(p), Loc::parse(top)) else {
            continue;
        };
        for d in chain(&pl, &tl) {
            if seen.insert(d.clone()) {
                let id = local_id(&d);
                dirs.push((d, id));
            }
        }
    }
    (paths, dirs)
}

fn local_id(l: &Loc) -> FileId {
    match l {
        Loc::Local(p) => std::fs::symlink_metadata(p).ok().and_then(|m| file_id(&m)),
        Loc::Remote(_) => None,
    }
}

/// A local entry as it is now (kind always, size and time for files).
fn snapshot(path: &str) -> Option<super::expect::ExpectedEntry> {
    if crate::remote::is_remote(path) {
        return None;
    }
    let p = Path::new(path);
    let meta = std::fs::symlink_metadata(p).ok()?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let e = crate::listing::entry_from_metadata(name, p, &meta, false);
    Some(super::expect::ExpectedEntry {
        path: path.to_string(),
        kind: e.kind,
        size: e.size,
        modified_ms: e.modified_ms,
    })
}

fn find_expected(
    expected: &[super::expect::ExpectedEntry],
    path: &str,
) -> Option<super::expect::ExpectedEntry> {
    expected.iter().find(|e| same(&e.path, path)).cloned()
}

/// Removes the folders that are empty now, deepest first – never a link, never a
/// folder that is not the one noted (local: same device + inode). Server folders
/// through `remove_dir` (servers refuse non-empty folders as well). Returns the
/// folders whose content changed.
pub fn remove_empty_dirs(
    dirs: &[(Loc, FileId)],
    hub: Option<&crate::remote::Hub>,
) -> (Vec<String>, Vec<(Loc, FileId)>) {
    let mut sorted: Vec<&(Loc, FileId)> = dirs.iter().collect();
    // deeper paths are longer than their parents
    sorted.sort_by_key(|(d, _)| std::cmp::Reverse(d.display().len()));
    let mut changed: Vec<String> = Vec::new();
    let mut left: Vec<(Loc, FileId)> = Vec::new();
    for (d, id) in sorted {
        let removed = match d {
            Loc::Local(p) => match std::fs::symlink_metadata(p) {
                Ok(m)
                    if m.is_dir()
                        && !m.file_type().is_symlink()
                        && (id.is_none() || file_id(&m) == *id) =>
                {
                    std::fs::remove_dir(p).is_ok()
                }
                Ok(_) => continue,  // something else now: not ours
                Err(_) => continue, // gone already
            },
            Loc::Remote(r) => match hub {
                Some(h) => h
                    .with(r.profile(), |c| c.remove_dir(r.server_path()))
                    .is_ok(),
                None => false,
            },
        };
        if removed {
            if let Some(parent) = d.parent() {
                changed.push(parent.display());
            }
        } else {
            left.push((d.clone(), *id));
        }
    }
    changed.sort();
    changed.dedup();
    (changed, left)
}

/// The log of retry plans (newest last).
#[derive(Default)]
pub struct RetryLog(Mutex<std::collections::VecDeque<(String, RetryPlan)>>);

impl RetryLog {
    fn lock(&self) -> MutexGuard<'_, std::collections::VecDeque<(String, RetryPlan)>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Stores a plan; returns the ids of the plans that dropped out.
    pub fn push(&self, id: &str, plan: RetryPlan) -> Vec<String> {
        let mut log = self.lock();
        log.push_back((id.to_string(), plan));
        let mut dropped = Vec::new();
        while log.len() > RETRY_LOG_SIZE {
            if let Some((old, _)) = log.pop_front() {
                dropped.push(old);
            }
        }
        dropped
    }

    pub fn take(&self, id: &str) -> Option<RetryPlan> {
        let mut log = self.lock();
        let pos = log.iter().position(|(j, _)| j == id)?;
        log.remove(pos).map(|(_, p)| p)
    }

    pub fn put_back(&self, id: &str, plan: RetryPlan) {
        self.lock().push_back((id.to_string(), plan));
    }

    pub fn forget(&self, ids: &[String]) {
        let set: HashMap<&str, ()> = ids.iter().map(|i| (i.as_str(), ())).collect();
        self.lock().retain(|(j, _)| !set.contains_key(j.as_str()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(p: &str) -> Loc {
        Loc::Local(PathBuf::from(p))
    }

    #[test]
    fn chain_lists_the_folders_up_to_the_top_source() {
        assert_eq!(
            chain(&l("/s/A/B/f.mp3"), &l("/s/A")),
            vec![l("/s/A/B"), l("/s/A")]
        );
        assert!(chain(&l("/s/A"), &l("/s/A")).is_empty());
        assert!(chain(&l("/x/f"), &l("/s/A")).is_empty());
    }

    #[test]
    fn nested_pairs_and_targets_outside_the_root_are_dropped() {
        let p = |s: &str, d: &str| RetryPair {
            src: l(s),
            dst: l(d),
            id: None,
            copied: false,
        };
        let noted = Noted {
            pairs: vec![
                p("/s/A/B", "/t/A/B"),
                p("/s/A/B/f", "/t/A/B/f"),
                p("/s/A/g", "/t/A/g"),
                p("/s/A/h", "/elsewhere/h"),
            ],
            cleanup: Vec::new(),
            overflow: false,
        };
        let (root, pairs, _) = pairs_of("/t", noted).unwrap();
        assert_eq!(root, l("/t"));
        let srcs: Vec<String> = pairs.iter().map(|p| p.src.display()).collect();
        assert_eq!(srcs, vec!["/s/A/B".to_string(), "/s/A/g".to_string()]);
        let over = Noted {
            overflow: true,
            ..Noted::default()
        };
        assert!(pairs_of("/t", over).is_none());
    }

    #[test]
    fn failed_below_keeps_only_the_outermost_failed_paths() {
        let sel = vec!["/a".to_string(), "/b".to_string()];
        let out = failed_below(&sel, &["/a/x/1", "/a/x", "/c/z", "/b"]);
        assert_eq!(out, vec!["/a/x".to_string(), "/b".to_string()]);
    }

    #[test]
    fn notes_stop_at_the_limit() {
        let n = Notes::default();
        n.pair(
            RetryPair {
                src: l("/a"),
                dst: l("/b"),
                id: None,
                copied: false,
            },
            vec![(l("/x"), None), (l("/x"), None)],
        );
        let t = n.take();
        assert_eq!(t.pairs.len(), 1);
        assert_eq!(t.cleanup.len(), 1, "a folder is noted once");
        assert!(!t.overflow);
        assert!(n.take().pairs.is_empty(), "taken");
    }
}
