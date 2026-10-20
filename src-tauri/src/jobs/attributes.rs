//! Change-attributes job (design 024): applies one change to the selected
//! entries and – if asked – to the contents of selected folders. Links are never
//! followed or changed: a selected link is reported (`symlink_skipped`), links
//! inside folders are counted as skipped (E4). Folders are changed after their
//! contents unless the change gives the owner the access needed to read them (E7).
//!
//! External review (20.10.2026): the walk works relative to open folders
//! (`platform::attributes::Dir`, #4) – a folder swapped for a link after it was
//! looked at is never entered; it stays on the file system of the selected
//! folder (#3, like `clean`); a folder whose contents cannot be read is counted
//! once and left unchanged (#5).

use super::report::Reporter;
use super::{Control, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::attributes::{ApplyTo, AttrChange, FolderOrder, Resolved, symlink_skipped};
use crate::error::{FsError, FsErrorCode};
use crate::platform::attributes::{Apply, Dir, Kind, Stat};
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::SystemTime;

const MAX_LIVE_ERRORS: u64 = 100;

/// A test name that cannot be opened as a folder (no other way to make a
/// folder unreadable for root, who runs the container tests).
#[cfg(test)]
pub const UNOPENABLE_FOR_TESTS: &str = "unopenable-for-tests";

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// An entry of the walk: its folder (open), its name there, its full path (for
/// messages and `dirsChanged`) and what it was when it was looked at.
struct Entry {
    parent: Rc<Dir>,
    name: OsString,
    path: PathBuf,
    seen: Stat,
}

/// One step of the walk through a folder (explicit stack, no recursion).
enum Step {
    /// Look into a folder.
    Enter(Entry),
    /// Change the folder itself after its contents.
    Leave(Entry),
}

struct Run<'a, 'e> {
    change: &'a AttrChange,
    resolved: Resolved,
    apply_to: ApplyTo,
    control: &'a Control,
    rep: Reporter<'e>,
    summary: Summary,
}

fn io_error(e: &io::Error, path: &Path) -> FsError {
    if e.kind() == io::ErrorKind::Unsupported {
        symlink_skipped(path) // a link swapped in since it was looked at
    } else {
        FsError::from_io(e, path)
    }
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

    /// Changes one entry, checked again right before: no link, still the entry
    /// that was looked at, filter. `true` = changed (or filtered out).
    fn apply(&mut self, e: &Entry) -> bool {
        self.rep.progress.current = Some(path_string(&e.path));
        let now = match e.parent.stat(&e.name) {
            Ok(s) => s,
            Err(err) => {
                self.fail(&e.path, FsError::from_io(&err, &e.path));
                return false;
            }
        };
        if now.kind == Kind::Link {
            self.fail(&e.path, symlink_skipped(&e.path));
            return false;
        }
        if now.id() != e.seen.id() {
            self.fail(&e.path, replaced(&e.path));
            return false;
        }
        if !self.apply_to.matches(now.kind == Kind::Dir) {
            self.step_done(); // filtered out: neither done nor failed
            return true;
        }
        let change = self.resolved.for_entry(&now);
        self.set(e, &now, &change)
    }

    fn set(&mut self, e: &Entry, now: &Stat, change: &Apply) -> bool {
        match e.parent.apply(&e.name, now, change) {
            Ok(()) => {
                self.summary.items_done += 1;
                if let Some(parent) = e.path.parent() {
                    self.rep.dir_changed(path_string(parent));
                }
                self.step_done();
                true
            }
            Err(err) => {
                self.fail(&e.path, io_error(&err, &e.path));
                false
            }
        }
    }

    /// Only the bits a folder gains, before its contents (E7, review #8) – not
    /// counted: the full change follows after the contents.
    fn open_up(&mut self, e: &Entry, mode: u32) -> bool {
        let pre = Apply {
            mode: Some(mode),
            ..Apply::default()
        };
        match e.parent.apply(&e.name, &e.seen, &pre) {
            Ok(()) => true,
            Err(err) => {
                self.fail(&e.path, io_error(&err, &e.path));
                false
            }
        }
    }

    /// The names in a folder that was looked at as `e` (opened without following a link).
    fn list(&self, e: &Entry) -> io::Result<(Rc<Dir>, Vec<OsString>)> {
        #[cfg(test)]
        if e.name == UNOPENABLE_FOR_TESTS {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
        let dir = e.parent.open_child(&e.name, &e.seen)?;
        let names = dir.names()?;
        Ok((Rc::new(dir), names))
    }

    /// The folder and everything below it on the same file system.
    fn walk(&mut self, root: Entry) {
        let device = root.seen.dev;
        let mut stack = vec![Step::Enter(root)];
        while let Some(step) = stack.pop() {
            if self.stopped() {
                return;
            }
            let e = match step {
                Step::Leave(e) => {
                    self.apply(&e);
                    continue;
                }
                Step::Enter(e) => e,
            };
            let order = if self.apply_to.matches(true) {
                self.change.folder_order(e.seen.mode)
            } else {
                FolderOrder::After // not changed at all: nothing to open up
            };
            let opened = match order {
                FolderOrder::First => self.apply(&e),
                FolderOrder::Staged(mode) => self.open_up(&e, mode),
                FolderOrder::After => true,
            };
            if !opened {
                continue; // counted once; its contents are not touched
            }
            let (dir, names) = match self.list(&e) {
                Ok(listed) => listed,
                Err(err) => {
                    if let FolderOrder::Staged(_) = order {
                        // do not leave it with only the gained bits: the full change, uncounted
                        if let Ok(now) = e.parent.stat(&e.name) {
                            let _ = e
                                .parent
                                .apply(&e.name, &now, &self.resolved.for_entry(&now));
                        }
                    }
                    // one error for the folder, no `Leave` (review #5): unchanged – unless
                    // `First` changed it already (then it counts as done, too)
                    self.fail(&e.path, io_error(&err, &e.path));
                    continue;
                }
            };
            if order != FolderOrder::First {
                stack.push(Step::Leave(Entry {
                    seen: e.seen,
                    parent: e.parent,
                    name: e.name,
                    path: e.path.clone(),
                }));
            }
            let mut dirs = Vec::new();
            for name in names {
                if self.stopped() {
                    return;
                }
                let path = e.path.join(&name);
                let seen = match dir.stat(&name) {
                    Ok(s) => s,
                    Err(err) => {
                        self.fail(&path, FsError::from_io(&err, &path));
                        continue;
                    }
                };
                let child = Entry {
                    parent: dir.clone(),
                    name,
                    path,
                    seen,
                };
                match seen.kind {
                    // like chmod -R: not entered, not changed
                    Kind::Link => self.summary.items_skipped += 1,
                    // another file system (mount point): not entered, not changed (review #3)
                    Kind::Dir if seen.dev != device => self.summary.items_skipped += 1,
                    Kind::Dir => dirs.push(Step::Enter(child)),
                    Kind::Other => {
                        if self.apply_to.matches(false) {
                            self.apply(&child);
                        }
                    }
                }
            }
            // the first sub-folder is popped first
            stack.extend(dirs.into_iter().rev());
        }
    }

    /// One selected path: looked at in its folder, then changed or walked.
    fn selected(&mut self, path: &Path, recursive: bool, folders: &mut Folders) {
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            let e = FsError::new(
                FsErrorCode::InvalidPath,
                "A drive or root cannot be changed here",
                Some(path),
            );
            return self.fail(path, e);
        };
        let dir = match folders.open(parent) {
            Ok(d) => d,
            Err(err) => return self.fail(path, FsError::from_io(&err, path)),
        };
        let seen = match dir.stat(name) {
            Ok(s) => s,
            Err(err) => return self.fail(path, FsError::from_io(&err, path)),
        };
        let e = Entry {
            parent: dir,
            name: name.to_os_string(),
            path: path.to_path_buf(),
            seen,
        };
        if recursive && seen.kind == Kind::Dir {
            self.walk(e);
        } else {
            self.apply(&e);
        }
    }
}

fn replaced(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::Io,
        "The entry was replaced while it was being changed",
        Some(path),
    )
}

/// The folder of the last selected entry stays open (selections share folders).
#[derive(Default)]
struct Folders {
    last: Option<(PathBuf, Rc<Dir>)>,
}

impl Folders {
    fn open(&mut self, path: &Path) -> io::Result<Rc<Dir>> {
        if let Some((p, d)) = &self.last
            && p == path
        {
            return Ok(d.clone());
        }
        let d = Rc::new(Dir::open(path)?);
        self.last = Some((path.to_path_buf(), d.clone()));
        Ok(d)
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
    let mut folders = Folders::default();
    for path in &paths {
        if run.stopped() {
            break;
        }
        run.selected(path, recursive, &mut folders);
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
