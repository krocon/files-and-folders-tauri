//! Group-files job (design 008 E2): every entry goes to `<root>/<group>/<name>`
//! by copying or moving. The frontend computes the groups; this job checks the
//! group names, creates the group folders (an existing real folder is merged
//! into, a file or link of that name is an error for the group) and hands the
//! pairs to the copy/move engine – conflicts, temp files, cancel and pause as
//! in 005/006.

use super::copy::{self, Mode};
use super::{Control, CopyOptions, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::error::{FsError, FsErrorCode};
use crate::paths::{normalize_lexically, validate_name};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MAX_ITEMS: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupItem {
    pub path: String,
    pub group: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transfer {
    Copy,
    Move,
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn fail(
    summary: &mut Summary,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
    id: &str,
    path: &Path,
    error: FsError,
) {
    summary.items_failed += 1;
    let e = ItemError {
        path: path_string(path),
        error,
    };
    emit(JobEvent::ItemFailed {
        id: id.to_string(),
        error: e.clone(),
    });
    if summary.errors.len() < MAX_REPORTED_ERRORS {
        summary.errors.push(e);
    }
}

/// Creates `root/group` unless it is a real folder already.
fn group_dir(root: &Path, group: &str) -> Result<PathBuf, FsError> {
    validate_name(group)?;
    let dir = root.join(group);
    match fs::symlink_metadata(&dir) {
        Ok(m) if m.is_dir() => Ok(dir),
        Ok(_) => Err(FsError::new(
            FsErrorCode::NotADirectory,
            "An entry with the group's name exists and is not a folder",
            Some(&dir),
        )),
        Err(e) if e.kind() == io::ErrorKind::NotFound => match fs::create_dir(&dir) {
            Ok(()) => Ok(dir),
            // created meanwhile: only a real folder is fine
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                match fs::symlink_metadata(&dir) {
                    Ok(m) if m.is_dir() => Ok(dir),
                    _ => Err(FsError::from_io(&e, &dir)),
                }
            }
            Err(e) => Err(FsError::from_io(&e, &dir)),
        },
        Err(e) => Err(FsError::from_io(&e, &dir)),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    root: &Path,
    items: &[GroupItem],
    transfer: Transfer,
    options: &CopyOptions,
    force_copy: bool,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut summary = Summary::default();
    let root = normalize_lexically(root);
    match fs::metadata(&root) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => {
            summary.error = Some(FsError::new(
                FsErrorCode::NotADirectory,
                "The target is not a folder",
                Some(&root),
            ));
            return (JobState::Failed, summary);
        }
        Err(e) => {
            summary.error = Some(FsError::from_io(&e, &root));
            return (JobState::Failed, summary);
        }
    }
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Planning,
    });
    // one folder per group, in the order the groups first appear
    let mut dirs: Vec<(String, Result<PathBuf, FsError>)> = Vec::new();
    let mut created_any = false;
    let mut pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    for item in items {
        if control.is_cancelled() {
            return (JobState::Cancelled, summary);
        }
        let src = normalize_lexically(Path::new(&item.path));
        let dir = match dirs.iter().find(|(g, _)| *g == item.group) {
            Some((_, d)) => d.clone(),
            None => {
                let d = group_dir(&root, &item.group);
                created_any |= d.is_ok();
                dirs.push((item.group.clone(), d.clone()));
                d
            }
        };
        let dir = match dir {
            Ok(d) => d,
            Err(e) => {
                fail(&mut summary, emit, id, &src, e);
                continue;
            }
        };
        if src.parent() == Some(dir.as_path()) {
            summary.items_skipped += 1; // already in its group
            continue;
        }
        let is_dir = fs::symlink_metadata(&src)
            .map(|m| m.is_dir())
            .unwrap_or(false);
        if is_dir && dir.starts_with(&src) {
            let e = FsError::new(
                FsErrorCode::TargetInsideSource,
                "The group folder lies inside this folder",
                Some(&src),
            );
            fail(&mut summary, emit, id, &src, e);
            continue;
        }
        pairs.push((src, dir));
    }
    if created_any {
        emit(JobEvent::DirsChanged {
            dirs: vec![path_string(&root)],
        });
    }
    if pairs.is_empty() {
        let state = if summary.items_failed > 0 {
            JobState::DoneWithErrors
        } else {
            JobState::Done
        };
        return (state, summary);
    }
    let mode = match transfer {
        Transfer::Copy => Mode::Copy,
        Transfer::Move => Mode::Move { force_copy },
    };
    // a new name only makes sense for a single source – never when grouping
    let options = CopyOptions {
        rename_to: None,
        ..options.clone()
    };
    copy::run_pairs(id, &pairs, &options, mode, summary, control, emit)
}
