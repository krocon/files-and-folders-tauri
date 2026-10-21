//! Delete on a server (design 034 E4): always permanent – servers have no trash.
//! Plans first (recursive listing, links are removed as links, never followed),
//! then removes children before their folder. Errors are collected per entry.

use super::report::Reporter;
use super::{Control, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::error::FsError;
use crate::model::EntryKind;
use crate::remote::{Hub, RemotePath};

const MAX_LIVE_ERRORS: u64 = 100;

enum Step {
    File(RemotePath),
    Dir(RemotePath),
}

fn fail(rep: &Reporter<'_>, summary: &mut Summary, path: String, error: FsError) {
    summary.items_failed += 1;
    let item = ItemError { path, error };
    if summary.items_failed <= MAX_LIVE_ERRORS {
        rep.item_failed(item.clone());
    }
    if summary.errors.len() < MAX_REPORTED_ERRORS {
        summary.errors.push(item);
    }
}

pub fn run(
    hub: &Hub,
    id: &str,
    paths: &[RemotePath],
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut rep = Reporter::new(id, emit);
    let mut summary = Summary::default();
    rep.emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Planning,
    });
    // plan: depth first; a folder's children come before the folder
    let mut steps: Vec<Step> = Vec::new();
    for top in paths {
        let meta = match hub.with(top.profile(), |c| c.stat(top.server_path())) {
            Ok(Some(m)) => m,
            Ok(None) => continue, // gone already: nothing to do
            Err(e) => {
                fail(&rep, &mut summary, top.to_string(), e);
                continue;
            }
        };
        if meta.kind != EntryKind::Directory {
            steps.push(Step::File(top.clone()));
            continue;
        }
        // iterative post-order walk
        let mut stack: Vec<(RemotePath, bool)> = vec![(top.clone(), false)];
        while let Some((dir, expanded)) = stack.pop() {
            if control.is_cancelled() {
                rep.flush_dirs();
                return (JobState::Cancelled, summary);
            }
            if expanded {
                steps.push(Step::Dir(dir));
                continue;
            }
            stack.push((dir.clone(), true));
            match hub.with(dir.profile(), |c| c.list(dir.server_path())) {
                Ok(l) => {
                    for e in l.entries {
                        match dir.join(&e.name) {
                            Ok(p) if e.kind == EntryKind::Directory => stack.push((p, false)),
                            Ok(p) => steps.push(Step::File(p)),
                            Err(err) => fail(&rep, &mut summary, format!("{dir}/{}", e.name), err),
                        }
                    }
                }
                Err(e) => fail(&rep, &mut summary, dir.to_string(), e),
            }
        }
    }
    rep.progress.items_total = steps.len() as u64;
    rep.emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    rep.tick(true);
    let mut failed_dirs: Vec<RemotePath> = Vec::new();
    let mut cancelled = false;
    for step in &steps {
        if control.is_cancelled() || !control.wait_while_paused() {
            cancelled = true;
            break;
        }
        let (path, is_dir) = match step {
            Step::File(p) => (p, false),
            Step::Dir(p) => (p, true),
        };
        rep.progress.current = Some(path.to_string());
        if let Some(parent) = path.parent() {
            rep.dir_changed(parent.to_string());
        }
        // a folder whose child could not go stays (and is no error of its own)
        if is_dir && failed_dirs.iter().any(|d| d.starts_with(path)) {
            summary.items_skipped += 1;
        } else {
            let r = hub.with(path.profile(), |c| {
                if is_dir {
                    c.remove_dir(path.server_path())
                } else {
                    c.remove_file(path.server_path())
                }
            });
            match r {
                Ok(()) => summary.items_done += 1,
                Err(e) => {
                    if let Some(parent) = path.parent() {
                        failed_dirs.push(parent);
                    }
                    fail(&rep, &mut summary, path.to_string(), e);
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
