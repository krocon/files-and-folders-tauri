//! Clean-folders job (design 008 E3): deletes what `find_empty_dirs` listed –
//! after checking every entry again. An entry is deleted only if it still lies
//! inside a start folder, no path part below the start folder is a link, it is
//! no root/home/system path, a folder is a real folder that holds nothing but
//! junk files *now*, and a file still is a file matching the pattern. Children
//! come before their parents; a folder that kept something stays.

use super::delete::trash_one;
use super::report::Reporter;
use super::{Control, DeleteMode, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::clean::{CleanItem, CleanKind, CleanOptions, Matcher, check_roots};
use crate::error::{FsError, FsErrorCode};
use crate::fileops::check_danger;
use crate::paths::normalize_lexically;
use crate::platform::remove_below;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

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

/// Checks one entry against the start folders and the disk; returns its start
/// folder and the junk files to remove with a folder.
fn verify<'r>(
    item: &CleanItem,
    path: &Path,
    roots: &'r [PathBuf],
    o: &CleanOptions,
    m: &Matcher,
    home: Option<&Path>,
) -> Result<(&'r Path, Vec<PathBuf>), FsError> {
    let root = roots.iter().find(|r| path.starts_with(r)).ok_or_else(|| {
        FsError::new(
            FsErrorCode::InvalidPath,
            "Outside the start folders",
            Some(path),
        )
    })?;
    if path == root.as_path() && !(o.include_roots && item.kind == CleanKind::Dir) {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "The start folder itself is not deleted",
            Some(path),
        ));
    }
    check_danger(path, home, false)?;
    // every folder between the start folder and the entry is a real folder (no link)
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
    let meta = fs::symlink_metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    match item.kind {
        CleanKind::File => {
            if !meta.is_file() || !m.matches(name) {
                return Err(left(path, "The entry changed"));
            }
            Ok((root, Vec::new()))
        }
        CleanKind::Dir => {
            if !meta.is_dir() || !o.empty_dirs {
                return Err(left(path, "The entry changed"));
            }
            let mut junk = Vec::new();
            for entry in fs::read_dir(path).map_err(|e| FsError::from_io(&e, path))? {
                let entry = entry.map_err(|e| FsError::from_io(&e, path))?;
                let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
                let name = entry.file_name();
                match name.to_str() {
                    Some(n) if is_file && m.is_junk(n) => junk.push(entry.path()),
                    _ => return Err(left(path, "The folder is not empty any more")),
                }
            }
            Ok((root, junk))
        }
    }
}

fn remove(
    item: &CleanItem,
    path: &Path,
    root: &Path,
    junk: &[PathBuf],
    mode: DeleteMode,
) -> Result<(), FsError> {
    if mode == DeleteMode::Trash {
        // by path: the check right before is the guard (design 008, residual risk)
        return trash_one(path).map_err(|e| FsError::new(FsErrorCode::Io, e, Some(path)));
    }
    // relative to the start folder, never through a link on the way (review 008 #3);
    // never remove_dir_all: something new inside makes this fail
    let rel = path.strip_prefix(root).unwrap_or(Path::new(""));
    let junk: Vec<OsString> = junk
        .iter()
        .filter_map(|j| j.file_name().map(|n| n.to_os_string()))
        .collect();
    remove_below(root, rel, item.kind == CleanKind::Dir, &junk)
        .map_err(|e| FsError::from_io(&e, path))
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
    let roots = match check_roots(roots) {
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
    // children before parents, whatever order arrived (stable: deeper first)
    let mut order: Vec<(usize, PathBuf)> = items
        .iter()
        .enumerate()
        .map(|(i, it)| (i, normalize_lexically(Path::new(&it.path))))
        .collect();
    order.sort_by_key(|(_, p)| std::cmp::Reverse(p.components().count()));
    rep.progress.items_total = items.len() as u64;
    rep.tick(true);
    let mut cancelled = false;
    for (i, path) in &order {
        if control.is_cancelled() || !control.wait_while_paused() {
            cancelled = true;
            break;
        }
        let item = &items[*i];
        rep.progress.current = Some(path_string(path));
        let result = verify(item, path, &roots, options, &m, home)
            .and_then(|(root, junk)| remove(item, path, root, &junk, mode));
        match result {
            Ok(()) => {
                summary.items_done += 1;
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
