//! Delete job (design 006 E6): to the trash (default, one entry after the
//! other) or permanently (children first, links are removed – never followed).
//! Write-protected entries ask before they are deleted permanently.

use super::report::Reporter;
use super::{
    Conflict, ConflictKind, Control, Decision, DeleteMode, FileMeta, ItemError, JobEvent, JobState,
    MAX_REPORTED_ERRORS, Summary,
};
use crate::error::{FsError, FsErrorCode};
use crate::paths::normalize_lexically;
use crate::platform::{file_id, make_writable};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_LIVE_ERRORS: u64 = 100;

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// One step of a permanent delete. Folders appear twice: `Enter` before their
/// content (write protection is checked there) and `Leave` after it.
/// Each step carries the device + inode seen while planning: a path that names
/// another entry by now (a folder swapped for a link) is left alone.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Step {
    Enter(PathBuf, Option<(u64, u64)>),
    Leave(PathBuf, Option<(u64, u64)>),
    Entry(PathBuf, Option<(u64, u64)>),
    /// A folder on another file system (mount point) – never deleted into.
    Mount(PathBuf),
}

fn same_entry(path: &Path, id: Option<(u64, u64)>) -> Option<Metadata> {
    let m = fs::symlink_metadata(path).ok()?;
    (id.is_none() || file_id(&m) == id).then_some(m)
}

fn changed(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::NotFound,
        "The entry changed while deleting – left in place",
        Some(path),
    )
}

struct Del<'a> {
    id: &'a str,
    control: &'a Control,
    rep: Reporter<'a>,
    summary: Summary,
    conflict_seq: u64,
    for_all: Option<Decision>,
    /// Entries left in place (skipped or failed): their folders stay as well.
    kept: Vec<PathBuf>,
    /// Folders of the deleted entries (reported as changed while the job runs).
    parents: Vec<String>,
}

impl Del<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        self.kept.push(path.to_path_buf());
        let item = ItemError {
            path: path_string(path),
            error,
        };
        if self.summary.items_failed <= MAX_LIVE_ERRORS {
            self.rep.item_failed(item.clone());
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(item);
        }
    }

    fn state(&self, state: JobState) {
        self.rep.emit(JobEvent::State {
            id: self.id.to_string(),
            state,
        });
    }

    fn done(&mut self) {
        // after something happened: a reload before the deletion would show the old content
        for p in &self.parents {
            self.rep.dir_changed(p.clone());
        }
        self.rep.progress.items_done += 1;
        self.rep.tick(false);
    }

    /// Asks whether a write-protected entry may be deleted. `None` = cancelled.
    fn ask_read_only(&mut self, path: &Path, meta: &Metadata) -> Option<Decision> {
        if let Some(d) = &self.for_all {
            return Some(d.clone());
        }
        self.conflict_seq += 1;
        let fm = FileMeta {
            size: if meta.is_dir() {
                None
            } else {
                Some(meta.len())
            },
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64),
            is_dir: meta.is_dir(),
        };
        self.rep.emit(JobEvent::Conflict {
            id: self.id.to_string(),
            conflict: Conflict {
                conflict_id: self.conflict_seq,
                kind: ConflictKind::ReadOnly,
                source: path_string(path),
                target: path_string(path),
                source_meta: fm.clone(),
                target_meta: fm,
                suggested_name: String::new(),
            },
        });
        self.state(JobState::WaitingForDecision);
        let answer = self.control.wait_for_decision(self.conflict_seq);
        if !self.control.is_cancelled() {
            self.state(if self.control.is_paused() {
                JobState::Paused
            } else {
                JobState::Running
            });
        }
        let (decision, all) = answer?;
        if all {
            self.for_all = Some(decision.clone());
        }
        Some(decision)
    }
}

fn read_only(meta: &Metadata) -> bool {
    // a link's own permissions mean nothing; deleting it never touches the target
    !meta.file_type().is_symlink() && meta.permissions().readonly()
}

fn remove_entry(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if cfg!(windows) && fs::symlink_metadata(path).is_ok_and(|m| m.is_symlink()) => {
            fs::remove_dir(path).map_err(|_| e)
        }
        r => r,
    }
}

/// Lists the steps for a permanent delete without following links and
/// without entering other file systems.
fn plan(paths: &[PathBuf], control: &Control) -> Option<(Vec<Step>, u64)> {
    let mut steps = Vec::new();
    let mut count = 0;
    for root in paths {
        enum Todo {
            Visit(PathBuf, Option<u64>),
            Leave(PathBuf, Option<(u64, u64)>),
        }
        let mut stack = vec![Todo::Visit(root.clone(), None)];
        while let Some(todo) = stack.pop() {
            if control.is_cancelled() {
                return None;
            }
            match todo {
                Todo::Leave(p, id) => steps.push(Step::Leave(p, id)),
                Todo::Visit(p, parent_dev) => {
                    count += 1;
                    let meta = fs::symlink_metadata(&p).ok();
                    let id = meta.as_ref().and_then(file_id);
                    let is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
                    if !is_dir {
                        steps.push(Step::Entry(p, id));
                        continue;
                    }
                    let dev = id.map(|(d, _)| d);
                    if parent_dev.is_some() && dev.is_some() && parent_dev != dev {
                        steps.push(Step::Mount(p));
                        continue;
                    }
                    steps.push(Step::Enter(p.clone(), id));
                    stack.push(Todo::Leave(p.clone(), id));
                    if let Ok(read) = fs::read_dir(&p) {
                        let mut children: Vec<PathBuf> =
                            read.filter_map(|e| e.ok().map(|e| e.path())).collect();
                        children.sort();
                        children.reverse();
                        stack.extend(children.into_iter().map(|c| Todo::Visit(c, dev)));
                    }
                    // unreadable: removing the folder reports the error
                }
            }
        }
    }
    Some((steps, count))
}

/// Moves one entry to the trash of its volume.
pub(crate) fn trash_one(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Finder keeps "Put Back"; if the user refused to let us control the
        // Finder, NSFileManager still moves it to the trash (without "Put Back").
        match trash::delete(path) {
            Ok(()) => Ok(()),
            Err(first) => {
                if fs::symlink_metadata(path).is_err() {
                    return Ok(()); // it went to the trash after all
                }
                use trash::macos::{DeleteMethod, TrashContextExtMacos};
                let mut ctx = trash::TrashContext::default();
                ctx.set_delete_method(DeleteMethod::NsFileManager);
                ctx.delete(path).map_err(|e| format!("{first}; {e}"))
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(path).map_err(|e| e.to_string())
    }
}

pub fn run(
    id: &str,
    paths: &[PathBuf],
    mode: DeleteMode,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut del = Del {
        id,
        control,
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
        conflict_seq: 0,
        for_all: None,
        kept: Vec::new(),
        parents: Vec::new(),
    };
    // entries below another one go with it (review 009 #5)
    let paths: Vec<PathBuf> = super::drop_nested(paths)
        .iter()
        .map(|p| normalize_lexically(p))
        .collect();
    for p in &paths {
        if p.parent().is_none() {
            del.summary.error = Some(FsError::new(
                FsErrorCode::InvalidPath,
                "A drive or root cannot be deleted",
                Some(p),
            ));
            return (JobState::Failed, del.summary);
        }
    }
    for p in &paths {
        if let Some(parent) = p.parent() {
            let parent = path_string(parent);
            if !del.parents.contains(&parent) {
                del.parents.push(parent);
            }
        }
    }
    let cancelled = match mode {
        DeleteMode::Trash => run_trash(&mut del, &paths),
        DeleteMode::Permanent => run_permanent(&mut del, &paths),
    };
    del.rep.progress.current = None;
    del.rep.tick(true);
    del.rep.flush_dirs();
    let state = if cancelled || control.is_cancelled() {
        JobState::Cancelled
    } else if del.summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, del.summary)
}

fn running_state(del: &Del) {
    del.state(if del.control.is_paused() {
        JobState::Paused
    } else {
        JobState::Running
    });
}

/// Returns true if cancelled.
fn run_trash(del: &mut Del, paths: &[PathBuf]) -> bool {
    del.rep.progress.items_total = paths.len() as u64;
    running_state(del);
    del.rep.tick(true);
    for p in paths {
        if del.control.is_cancelled() || !del.control.wait_while_paused() {
            return true;
        }
        del.rep.progress.current = Some(path_string(p));
        if let Err(e) = fs::symlink_metadata(p) {
            del.fail(p, FsError::from_io(&e, p));
        } else {
            match trash_one(p) {
                Ok(()) => del.summary.items_done += 1,
                Err(msg) => del.fail(
                    p,
                    FsError::new(
                        FsErrorCode::TrashFailed,
                        format!("Could not move to the trash: {msg}"),
                        Some(p),
                    ),
                ),
            }
        }
        del.done();
    }
    false
}

/// Returns true if cancelled.
fn run_permanent(del: &mut Del, paths: &[PathBuf]) -> bool {
    del.state(JobState::Planning);
    let Some((steps, count)) = plan(paths, del.control) else {
        return true;
    };
    del.rep.progress.items_total = count;
    running_state(del);
    del.rep.tick(true);
    let mut skip_below: Option<PathBuf> = None;
    for step in steps {
        if del.control.is_cancelled() || !del.control.wait_while_paused() {
            return true;
        }
        let path = match &step {
            Step::Enter(p, _) | Step::Leave(p, _) | Step::Entry(p, _) | Step::Mount(p) => p.clone(),
        };
        if let Some(s) = &skip_below {
            if path.starts_with(s) {
                if !matches!(step, Step::Leave(..)) {
                    del.summary.items_skipped += 1;
                    del.done();
                }
                continue;
            }
            skip_below = None;
        }
        del.rep.progress.current = Some(path_string(&path));
        match step {
            Step::Mount(p) => {
                del.fail(
                    &p,
                    FsError::new(
                        FsErrorCode::InvalidPath,
                        "A mounted file system – not deleted",
                        Some(&p),
                    ),
                );
                del.done();
            }
            Step::Enter(p, id) => {
                let Some(m) = same_entry(&p, id).filter(|m| m.is_dir()) else {
                    // replaced (e.g. by a link): never go inside
                    del.fail(&p, changed(&p));
                    skip_below = Some(p);
                    del.done();
                    continue;
                };
                // a write-protected folder (Unix; Windows ignores the attribute on folders):
                // its content cannot be removed without asking
                if cfg!(unix) && read_only(&m) {
                    match del.ask_read_only(&p, &m) {
                        None => return true,
                        Some(Decision::Overwrite) => {
                            if let Err(e) = make_writable(&p, &m) {
                                del.fail(&p, FsError::from_io(&e, &p));
                                skip_below = Some(p);
                                del.done();
                            }
                        }
                        Some(Decision::Cancel) => {
                            del.control.cancel();
                            return true;
                        }
                        Some(_) => {
                            del.kept.push(p.clone());
                            del.summary.items_skipped += 1;
                            skip_below = Some(p);
                            del.done();
                        }
                    }
                }
            }
            Step::Leave(p, id) => {
                if same_entry(&p, id).is_none() {
                    del.fail(&p, changed(&p));
                    del.done();
                    continue;
                }
                match fs::remove_dir(&p) {
                    Ok(()) => del.summary.items_done += 1,
                    // something inside stayed on purpose (skipped or failed)
                    Err(_) if del.kept.iter().any(|k| k.starts_with(&p)) => {
                        del.summary.items_skipped += 1;
                    }
                    Err(e) => del.fail(&p, FsError::from_io(&e, &p)),
                }
                del.done();
            }
            Step::Entry(p, id) => {
                match fs::symlink_metadata(&p) {
                    Err(e) => del.fail(&p, FsError::from_io(&e, &p)),
                    Ok(m) if id.is_some() && file_id(&m) != id => del.fail(&p, changed(&p)),
                    Ok(m) => {
                        let mut go = true;
                        if read_only(&m) {
                            match del.ask_read_only(&p, &m) {
                                None => return true,
                                Some(Decision::Overwrite) => {
                                    if cfg!(windows) {
                                        // Windows refuses to delete read-only files
                                        let _ = make_writable(&p, &m);
                                    }
                                }
                                Some(Decision::Cancel) => {
                                    del.control.cancel();
                                    return true;
                                }
                                Some(_) => {
                                    del.kept.push(p.clone());
                                    del.summary.items_skipped += 1;
                                    go = false;
                                }
                            }
                        }
                        if go {
                            match remove_entry(&p) {
                                Ok(()) => del.summary.items_done += 1,
                                Err(e) => del.fail(&p, FsError::from_io(&e, &p)),
                            }
                        }
                    }
                }
                del.done();
            }
        }
    }
    false
}
