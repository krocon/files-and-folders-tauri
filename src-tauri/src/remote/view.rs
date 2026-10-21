//! Server files for F3, the quick view and Enter (design 034 §4.5): downloaded into
//! the app's view cache (the archive cache of design 025 E5 – same limits, LRU and
//! clean-up), read-only, reused while size and mtime on the server are unchanged.

use super::{RemotePath, hub};
use crate::archive::view::{
    Key, OPEN_LIMIT, PREVIEW_LIMIT, Slot, keep, preview_control, remove_tree, slot_for,
};
use crate::error::{FsError, FsErrorCode};
use crate::jobs::{Control, JobEvent, JobState, Progress, Summary};
use crate::model::EntryKind;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

/// Downloads `raw` (≤ `max` bytes) into the cache; `Ok(None)` = cancelled.
pub fn materialize(
    raw: &str,
    max: u64,
    control: &Control,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<Option<PathBuf>, FsError> {
    let path = RemotePath::parse(raw)?;
    let hub = hub()?;
    let Some(name) = path.name().map(str::to_string) else {
        return Err(FsError::at(FsErrorCode::NotAFile, "A folder", raw));
    };
    let meta = hub
        .with(path.profile(), |c| c.stat_follow(path.server_path()))?
        .ok_or_else(|| FsError::at(FsErrorCode::NotFound, "Not found", raw))?;
    if meta.kind != EntryKind::File {
        return Err(FsError::at(FsErrorCode::NotAFile, "Not a file", raw));
    }
    let size = meta.size.unwrap_or(0);
    if size > max {
        return Err(FsError::at(
            FsErrorCode::TooManyFiles,
            format!(
                "Too large to show from the server (over {} MiB) – copy it first (F5)",
                max >> 20
            ),
            raw,
        ));
    }
    let mtime = meta
        .modified_ms
        .map(|ms| UNIX_EPOCH + Duration::from_millis(ms.max(0) as u64));
    let key: Key = (PathBuf::from(path.to_string()), size, mtime, Vec::new());
    let dir = match slot_for(&key)? {
        Slot::Hit(file) => return Ok(Some(file)),
        Slot::Fresh(dir) => dir,
    };
    let file = dir.join(
        crate::paths::validate_name(&name)
            .map(|_| name.clone())
            .unwrap_or_else(|_| "file".into()),
    );
    let mut done = 0u64;
    let r = crate::jobs::transfer::download(hub, &path, &file, control, &mut |n| {
        done += n;
        progress(done, size);
    });
    match r {
        Ok(true) => {
            keep(key, dir, &file, size);
            Ok(Some(file))
        }
        Ok(false) => {
            let _ = remove_tree(&dir);
            Ok(None)
        }
        Err(e) => {
            let _ = remove_tree(&dir);
            Err(e)
        }
    }
}

/// The copy for F3 / the quick view (a newer request of the same slot cancels this one).
pub fn for_preview(raw: &str, slot: Option<&str>) -> Result<PathBuf, FsError> {
    let control = match slot {
        Some(s) => preview_control(s),
        None => Arc::new(Control::default()),
    };
    materialize(raw, PREVIEW_LIMIT, &control, &mut |_, _| {})?
        .ok_or_else(|| FsError::at(FsErrorCode::Io, "Replaced by a newer preview", raw))
}

/// Job `viewEntry` on a server file (Enter): the copy's path in `Summary.view_path`.
pub fn run_job(
    id: &str,
    raw: &str,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let mut last = std::time::Instant::now();
    let r = materialize(raw, OPEN_LIMIT, control, &mut |done, total| {
        if last.elapsed() >= Duration::from_millis(100) {
            last = std::time::Instant::now();
            emit(JobEvent::Progress {
                id: id.to_string(),
                progress: Progress {
                    bytes_done: done,
                    bytes_total: total,
                    items_total: 1,
                    ..Progress::default()
                },
            });
        }
    });
    match r {
        Ok(Some(file)) => (
            JobState::Done,
            Summary {
                items_done: 1,
                view_path: Some(file.to_string_lossy().into_owned()),
                ..Summary::default()
            },
        ),
        Ok(None) => (JobState::Cancelled, Summary::default()),
        Err(e) => (
            JobState::Failed,
            Summary {
                error: Some(e),
                ..Summary::default()
            },
        ),
    }
}
