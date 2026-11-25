//! Clean-folders job (design 008 E3, 077 E6): deletes what `find_empty_dirs`
//! listed – after deciding everything again.
//!
//! A listed **file** (delete pattern) goes on its own, if it still is a file
//! matching the pattern. Of the listed **folders** the job looks at the topmost
//! ones: a folder goes only as a whole, and only if the walk of the scan
//! ([`plan_tree`]) says *now* that its whole tree holds nothing but empty
//! folders and extras – with the same rules (links, other file systems, hidden
//! files, size limits). The trash then gets that one folder; a permanent delete
//! removes the fresh plan folder by folder, never recursively. A folder that
//! got content stays untouched: of its listed children only really empty ones
//! may still go (it is not gutted, unless `junk_dirs_beside_content`).
//!
//! Every entry must lie inside a start folder (the start folder itself only
//! with `include_roots`), with no link on the way, and is no root/home/system path.

use super::delete::trash_one;
use super::report::Reporter;
use super::{Control, DeleteMode, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::clean::{CleanItem, CleanKind, CleanOptions, Matcher, TreePlan, merge_roots, plan_tree};
use crate::error::{FsError, FsErrorCode};
use crate::fileops::check_danger;
use crate::paths::normalize_lexically;
use crate::platform::remove_below;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

const MAX_LIVE_ERRORS: u64 = 100;

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn left(path: &Path, why: &str) -> FsError {
    FsError::new(
        FsErrorCode::Io,
        format!("{why} – left in place"),
        Some(path),
    )
}

/// Checks where an entry lies: inside a start folder (the start folder itself
/// only as a folder with `include_roots`), no dangerous path, and every folder
/// between the start folder and the entry is a real folder (no link).
fn locate<'r>(
    kind: CleanKind,
    path: &Path,
    roots: &'r [PathBuf],
    o: &CleanOptions,
    home: Option<&Path>,
) -> Result<&'r Path, FsError> {
    let root = roots.iter().find(|r| path.starts_with(r)).ok_or_else(|| {
        FsError::new(
            FsErrorCode::InvalidPath,
            "Outside the start folders",
            Some(path),
        )
    })?;
    if path == root.as_path() && !(o.include_roots && kind == CleanKind::Dir) {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "The start folder itself is not deleted",
            Some(path),
        ));
    }
    check_danger(path, home, false)?;
    let mut p = path.parent();
    while let Some(dir) = p {
        if dir == root.as_path() || !dir.starts_with(root) {
            break;
        }
        match fs::symlink_metadata(dir) {
            Ok(meta) if meta.is_dir() => {}
            _ => return Err(left(path, "A folder on the way changed")),
        }
        p = dir.parent();
    }
    Ok(root)
}

/// A listed file: still a file matching a delete pattern → removed. Returns its size.
fn remove_file(
    path: &Path,
    roots: &[PathBuf],
    o: &CleanOptions,
    m: &Matcher,
    home: Option<&Path>,
    mode: DeleteMode,
) -> Result<u64, FsError> {
    let root = locate(CleanKind::File, path, roots, o, home)?;
    let meta = fs::symlink_metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !meta.is_file() || !m.matches(name) {
        return Err(left(path, "The entry changed"));
    }
    if mode == DeleteMode::Trash {
        trash_one(path)?;
    } else {
        let rel = path.strip_prefix(root).unwrap_or(Path::new(""));
        remove_below(root, rel, false, &[]).map_err(|e| FsError::from_io(&e, path))?;
    }
    Ok(meta.len())
}

/// A topmost listed folder: decided again as a whole tree, then removed.
fn remove_tree(
    path: &Path,
    roots: &[PathBuf],
    o: &CleanOptions,
    m: &Matcher,
    home: Option<&Path>,
    mode: DeleteMode,
    cancel: &AtomicBool,
) -> Result<TreePlan, FsError> {
    let root = locate(CleanKind::Dir, path, roots, o, home)?;
    if !o.empty_dirs {
        return Err(left(path, "The entry changed"));
    }
    let Some(plan) = plan_tree(path, root, o, m, cancel)? else {
        return Err(left(path, "The folder is not empty any more"));
    };
    // only a start folder goes with nothing but extras inside; any other folder
    // lies next to content that stays (design 077 E3)
    if plan.soft && path != root && !o.junk_dirs_beside_content {
        return Err(left(path, "Only extras inside, next to content"));
    }
    if mode == DeleteMode::Trash {
        // one trash entry for the whole folder; by path: the walk right before is
        // the guard (design 008, residual risk)
        trash_one(path)?;
        return Ok(plan);
    }
    // the fresh plan, children first; relative to the start folder, never through a
    // link on the way (review 008 #3); never remove_dir_all: something new inside
    // makes this fail
    for (dir, junk) in &plan.dirs {
        let rel = dir.strip_prefix(root).unwrap_or(Path::new(""));
        remove_below(root, rel, true, junk).map_err(|e| FsError::from_io(&e, dir))?;
    }
    Ok(plan)
}

/// How a listed folder ended.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Outcome {
    /// Gone – with everything below it.
    Removed,
    Stayed,
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    roots: &[PathBuf],
    items: &[CleanItem],
    mode: DeleteMode,
    options: &CleanOptions,
    home: Option<&Path>,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut rep = Reporter::new(id, emit);
    let mut summary = Summary::default();
    let fail_job = |mut summary: Summary, e: FsError| {
        summary.error = Some(e);
        (JobState::Failed, summary)
    };
    let roots = match merge_roots(roots) {
        Ok(r) => r,
        Err(e) => return fail_job(summary, e),
    };
    let m = match Matcher::new(options) {
        Ok(m) => m,
        Err(e) => return fail_job(summary, e),
    };
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    // files first (in the order they came), then folders – parents before their
    // children: a parent that goes takes its listed children along
    let mut files: Vec<PathBuf> = Vec::new();
    let mut dirs: Vec<PathBuf> = Vec::new();
    for it in items {
        let p = normalize_lexically(Path::new(&it.path));
        match it.kind {
            CleanKind::File => files.push(p),
            CleanKind::Dir => dirs.push(p),
        }
    }
    dirs.sort_by_key(|p| p.components().count());
    rep.progress.items_total = items.len() as u64;
    rep.tick(true);
    let never = AtomicBool::new(false);
    let mut outcome: HashMap<PathBuf, Outcome> = HashMap::new();
    let mut cancelled = false;
    let work = files
        .iter()
        .map(|p| (CleanKind::File, p))
        .chain(dirs.iter().map(|p| (CleanKind::Dir, p)));
    for (kind, path) in work {
        if control.is_cancelled() || !control.wait_while_paused() {
            cancelled = true;
            break;
        }
        rep.progress.current = Some(path_string(path));
        let result: Result<u64, FsError> = match kind {
            CleanKind::File => remove_file(path, &roots, options, &m, home, mode),
            CleanKind::Dir => {
                if outcome.contains_key(path) {
                    // listed twice
                    rep.progress.items_done += 1;
                    summary.items_skipped += 1;
                    continue;
                }
                // the nearest listed folder above decides: gone → this one is gone with it
                let above = path
                    .ancestors()
                    .skip(1)
                    .find_map(|a| outcome.get(a).copied());
                if above == Some(Outcome::Removed) {
                    outcome.insert(path.clone(), Outcome::Removed);
                    summary.items_done += 1;
                    rep.progress.items_done += 1;
                    rep.tick(false);
                    continue;
                }
                let r = remove_tree(path, &roots, options, &m, home, mode, &never);
                outcome.insert(
                    path.clone(),
                    if r.is_ok() {
                        Outcome::Removed
                    } else {
                        Outcome::Stayed
                    },
                );
                r.map(|plan| plan.bytes)
            }
        };
        match result {
            Ok(bytes) => {
                summary.items_done += 1;
                summary.bytes_done = summary.bytes_done.saturating_add(bytes);
                if let Some(parent) = path.parent() {
                    rep.dir_changed(path_string(parent));
                }
            }
            Err(error) => {
                summary.items_failed += 1;
                let e = ItemError {
                    path: path_string(path),
                    error,
                };
                if summary.items_failed <= MAX_LIVE_ERRORS {
                    rep.item_failed(e.clone());
                }
                if summary.errors.len() < MAX_REPORTED_ERRORS {
                    summary.errors.push(e);
                }
            }
        }
        rep.progress.items_done += 1;
        rep.tick(false);
    }
    rep.progress.current = None;
    rep.tick(true);
    rep.flush_dirs();
    let state = if cancelled || control.is_cancelled() {
        JobState::Cancelled
    } else if summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, summary)
}
