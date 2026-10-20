//! Change-attributes job (design 024): applies one change to the selected
//! entries and – if asked – to the contents of selected folders. Links are never
//! followed or changed: a selected link is reported (`symlink_skipped`), links
//! inside folders are counted as skipped (E4). Folders are changed after their
//! contents unless the change gives the owner the access needed to read them (E7).

use super::report::Reporter;
use super::{Control, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::attributes::{ApplyTo, AttrChange, Resolved, symlink_skipped};
use crate::error::FsError;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const MAX_LIVE_ERRORS: u64 = 100;

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[cfg(unix)]
fn mode_of(meta: &Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;
    meta.mode() & crate::attributes::MODE_MASK
}

#[cfg(not(unix))]
fn mode_of(_meta: &Metadata) -> u32 {
    0
}

/// One step of the walk through a folder (explicit stack, no recursion).
enum Step {
    /// Look into a folder; `meta` from `symlink_metadata`.
    Enter(PathBuf, Metadata),
    /// Change the folder itself after its contents.
    Leave(PathBuf),
}

struct Run<'a, 'e> {
    change: &'a AttrChange,
    resolved: Resolved,
    apply_to: ApplyTo,
    control: &'a Control,
    rep: Reporter<'e>,
    summary: Summary,
}

impl Run<'_, '_> {
    fn stopped(&self) -> bool {
        self.control.is_cancelled() || !self.control.wait_while_paused()
    }

    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        let e = ItemError {
            path: path_string(path),
            error,
        };
        if self.summary.items_failed <= MAX_LIVE_ERRORS {
            self.rep.item_failed(e.clone());
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(e);
        }
        self.step_done();
    }

    fn step_done(&mut self) {
        self.rep.progress.items_done += 1;
        self.rep.tick(false);
    }

    /// Changes one entry (checked again right before: no link, filter).
    fn apply(&mut self, path: &Path) {
        self.rep.progress.current = Some(path_string(path));
        let meta = match fs::symlink_metadata(path) {
            Ok(m) => m,
            Err(e) => return self.fail(path, FsError::from_io(&e, path)),
        };
        if meta.file_type().is_symlink() {
            return self.fail(path, symlink_skipped(path));
        }
        if !self.apply_to.matches(meta.is_dir()) {
            return;
        }
        match self.resolved.apply(path, &meta) {
            Ok(()) => {
                self.summary.items_done += 1;
                if let Some(parent) = path.parent() {
                    self.rep.dir_changed(path_string(parent));
                }
                self.step_done();
            }
            Err(e) => self.fail(path, e),
        }
    }

    /// The folder and everything below it.
    fn walk(&mut self, root: PathBuf, meta: Metadata) {
        let mut stack = vec![Step::Enter(root, meta)];
        while let Some(step) = stack.pop() {
            if self.stopped() {
                return;
            }
            let (dir, meta) = match step {
                Step::Leave(dir) => {
                    self.apply(&dir);
                    continue;
                }
                Step::Enter(dir, meta) => (dir, meta),
            };
            let first =
                self.apply_to.matches(true) && self.change.owner_gains_access(mode_of(&meta));
            if first {
                self.apply(&dir);
            } else {
                stack.push(Step::Leave(dir.clone()));
            }
            let entries = match fs::read_dir(&dir) {
                Ok(rd) => rd,
                Err(e) => {
                    self.fail(&dir, FsError::from_io(&e, &dir));
                    continue;
                }
            };
            let mut dirs = Vec::new();
            for entry in entries {
                if self.stopped() {
                    return;
                }
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => {
                        self.fail(&dir, FsError::from_io(&e, &dir));
                        continue;
                    }
                };
                let path = entry.path();
                let meta = match fs::symlink_metadata(&path) {
                    Ok(m) => m,
                    Err(e) => {
                        self.fail(&path, FsError::from_io(&e, &path));
                        continue;
                    }
                };
                if meta.file_type().is_symlink() {
                    self.summary.items_skipped += 1; // like chmod -R: not entered, not changed
                } else if meta.is_dir() {
                    dirs.push(Step::Enter(path, meta));
                } else if self.apply_to.matches(false) {
                    self.apply(&path);
                }
            }
            // the first sub-folder is popped first
            stack.extend(dirs.into_iter().rev());
        }
    }
}

pub fn run(
    id: &str,
    paths: &[PathBuf],
    change: &AttrChange,
    recursive: bool,
    apply_to: ApplyTo,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let mut run = Run {
        change,
        resolved: change.resolve(SystemTime::now()),
        apply_to,
        control,
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
    };
    // a folder brings what lies below it (search results can hold both)
    let paths = if recursive {
        super::drop_nested(paths)
    } else {
        paths.to_vec()
    };
    // without recursion the total is known; with it, only the count grows (E7)
    run.rep.progress.items_total = if recursive { 0 } else { paths.len() as u64 };
    run.rep.tick(true);
    for path in &paths {
        if run.stopped() {
            break;
        }
        match fs::symlink_metadata(path) {
            Ok(meta) if recursive && meta.is_dir() => run.walk(path.clone(), meta),
            Ok(_) => run.apply(path),
            Err(e) => run.fail(path, FsError::from_io(&e, path)),
        }
    }
    run.rep.progress.current = None;
    run.rep.tick(true);
    run.rep.flush_dirs();
    let summary = run.summary;
    let state = if control.is_cancelled() {
        JobState::Cancelled
    } else if summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, summary)
}
