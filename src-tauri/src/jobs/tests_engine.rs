//! Engine tests: real copies in temp folders, driven through the JobManager
//! like the frontend does (events, answers, pause, cancel).

use super::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::{TempDir, tempdir};

pub(super) const WAIT: Duration = Duration::from_secs(20);

pub(super) struct Harness {
    pub(super) mgr: Arc<JobManager>,
    pub(super) events: Arc<Mutex<Vec<JobEvent>>>,
}

impl Harness {
    pub(super) fn new() -> Self {
        let events: Arc<Mutex<Vec<JobEvent>>> = Arc::default();
        let sink_events = events.clone();
        let mgr = JobManager::new(Arc::new(move |e: &JobEvent| {
            sink_events.lock().unwrap().push(e.clone())
        }));
        Self { mgr, events }
    }

    pub(super) fn copy(&self, sources: &[&Path], target: &Path, background: bool) -> String {
        self.mgr
            .start(JobSpec::Copy {
                sources: sources
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect(),
                target_dir: target.to_string_lossy().into_owned(),
                background,
                options: CopyOptions::default(),
            })
            .unwrap()
    }

    pub(super) fn finish(&self, id: &str) -> JobInfo {
        self.mgr
            .wait_finished(id, WAIT)
            .expect("job did not finish")
    }

    /// Waits until the job asks a conflict question and returns it.
    pub(super) fn conflict(&self, id: &str) -> Conflict {
        let deadline = Instant::now() + WAIT;
        loop {
            let info = self.mgr.list().into_iter().find(|j| j.id == id).unwrap();
            if let (JobState::WaitingForDecision, Some(c)) = (info.state, info.conflict) {
                return c;
            }
            assert!(Instant::now() < deadline, "no conflict");
            thread::sleep(Duration::from_millis(5));
        }
    }

    pub(super) fn wait_state(&self, id: &str, state: JobState) {
        let deadline = Instant::now() + WAIT;
        while self.mgr.list().iter().find(|j| j.id == id).unwrap().state != state {
            assert!(Instant::now() < deadline, "state {state:?} not reached");
            thread::sleep(Duration::from_millis(5));
        }
    }

    pub(super) fn count(&self, pred: impl Fn(&JobEvent) -> bool) -> usize {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| pred(e))
            .count()
    }
}

/// Source tree: `Quelle ä/` with `a.txt`, `Unter ordner 📁/b.bin`, `leer/`.
pub(super) fn tree() -> (TempDir, PathBuf, PathBuf) {
    let dir = tempdir().unwrap();
    let src = dir.path().join("Quelle ä");
    fs::create_dir_all(src.join("Unter ordner 📁")).unwrap();
    fs::create_dir_all(src.join("leer")).unwrap();
    fs::write(src.join("a.txt"), "alpha").unwrap();
    fs::write(src.join("Unter ordner 📁/b.bin"), vec![7u8; 200_000]).unwrap();
    let dst = dir.path().join("Ziel");
    fs::create_dir(&dst).unwrap();
    (dir, src, dst)
}

pub(super) fn no_temp_files(dir: &Path) -> bool {
    walk(dir)
        .iter()
        .all(|p| !p.to_string_lossy().contains(".part"))
}

pub(super) fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() && !p.is_symlink() {
            out.extend(walk(&p));
        }
        out.push(p);
    }
    out
}

#[test]
fn copies_folders_recursively_with_times_and_progress() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    let old = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000_000);
    fs::File::options()
        .write(true)
        .open(src.join("a.txt"))
        .unwrap()
        .set_modified(old)
        .unwrap();
    let id = h.copy(&[&src], &dst, false);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let out = dst.join("Quelle ä");
    assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "alpha");
    assert_eq!(
        fs::read(out.join("Unter ordner 📁/b.bin")).unwrap().len(),
        200_000
    );
    assert!(out.join("leer").is_dir());
    assert_eq!(
        fs::metadata(out.join("a.txt")).unwrap().modified().unwrap(),
        old
    );
    assert_eq!(info.progress.bytes_done, 200_005);
    assert_eq!(info.progress.bytes_total, 200_005);
    assert_eq!(info.progress.items_done, info.progress.items_total);
    assert!(no_temp_files(&dst));
    assert!(h.count(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.iter().any(|d| d.ends_with("Ziel")))) >= 1);
}

#[test]
fn rejects_target_inside_source_and_copy_onto_itself() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    let inside = src.join("Unter ordner 📁");
    let info = h.finish(&h.copy(&[&src], &inside, false));
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        crate::error::FsErrorCode::TargetInsideSource
    );
    let info = h.finish(&h.copy(&[&src.join("a.txt")], &src, false));
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        crate::error::FsErrorCode::SameSourceTarget
    );
    assert!(fs::read_dir(&dst).unwrap().next().is_none());
}

#[test]
fn conflict_overwrite_skip_rename_and_apply_to_all() {
    let h = Harness::new();
    let dir = tempdir().unwrap();
    let (src, dst) = (dir.path().join("s"), dir.path().join("d"));
    fs::create_dir_all(&src).unwrap();
    fs::create_dir_all(&dst).unwrap();
    for n in ["1.txt", "2.txt", "3.txt", "4.txt"] {
        fs::write(src.join(n), format!("new {n}")).unwrap();
        fs::write(dst.join(n), "old").unwrap();
    }
    let sources: Vec<PathBuf> = ["1.txt", "2.txt", "3.txt", "4.txt"]
        .iter()
        .map(|n| src.join(n))
        .collect();
    let refs: Vec<&Path> = sources.iter().map(PathBuf::as_path).collect();
    let id = h.copy(&refs, &dst, false);

    let c = h.conflict(&id);
    assert!(c.target.ends_with("1.txt"));
    // only the first answer counts (double click)
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Overwrite, false);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Skip, false);
    assert_eq!(c.suggested_name, "1 (1).txt");
    assert_eq!(c.target_meta.size, Some(3));
    let c = h.conflict(&id);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Skip, false);
    let c = h.conflict(&id);
    h.mgr.resolve_conflict(
        &id,
        c.conflict_id,
        Decision::Rename {
            new_name: Some("drei.txt".into()),
        },
        false,
    );
    let c = h.conflict(&id);
    h.mgr.resolve_conflict(
        &id,
        c.conflict_id,
        Decision::Rename { new_name: None },
        true,
    );
    let info = h.finish(&id);

    assert_eq!(info.state, JobState::Done);
    assert_eq!(fs::read_to_string(dst.join("1.txt")).unwrap(), "new 1.txt");
    assert_eq!(fs::read_to_string(dst.join("2.txt")).unwrap(), "old");
    assert_eq!(
        fs::read_to_string(dst.join("drei.txt")).unwrap(),
        "new 3.txt"
    );
    assert_eq!(fs::read_to_string(dst.join("3.txt")).unwrap(), "old");
    assert_eq!(
        fs::read_to_string(dst.join("4 (1).txt")).unwrap(),
        "new 4.txt"
    );
    let s = info.summary.unwrap();
    assert_eq!((s.items_done, s.items_skipped), (3, 1));
}

#[test]
fn apply_to_all_overwrite_if_newer_asks_once() {
    let h = Harness::new();
    let dir = tempdir().unwrap();
    let (src, dst) = (dir.path().join("s"), dir.path().join("d"));
    fs::create_dir_all(&src).unwrap();
    fs::create_dir_all(&dst).unwrap();
    let past = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
    for n in ["a", "b", "c"] {
        fs::write(src.join(n), "src").unwrap();
        fs::write(dst.join(n), "dst").unwrap();
    }
    // "a" in the target is older than the source, "b" and "c" are newer
    fs::File::options()
        .write(true)
        .open(dst.join("a"))
        .unwrap()
        .set_modified(past)
        .unwrap();
    let srcs = [src.join("a"), src.join("b"), src.join("c")];
    let id = h.copy(
        &srcs.iter().map(PathBuf::as_path).collect::<Vec<_>>(),
        &dst,
        false,
    );
    let c = h.conflict(&id);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::OverwriteIfNewer, true);
    let info = h.finish(&id);
    assert_eq!(h.count(|e| matches!(e, JobEvent::Conflict { .. })), 1);
    assert_eq!(fs::read_to_string(dst.join("a")).unwrap(), "src");
    assert_eq!(fs::read_to_string(dst.join("b")).unwrap(), "dst");
    assert_eq!(info.summary.unwrap().items_skipped, 2);
}

#[test]
fn cancel_while_asking_leaves_no_trace() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    fs::write(dst.join("a.txt"), "old").unwrap();
    let id = h.copy(&[&src.join("a.txt")], &dst, false);
    h.conflict(&id);
    let start = Instant::now();
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert!(start.elapsed() < Duration::from_millis(500));
    assert_eq!(info.state, JobState::Cancelled);
    assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "old");
}

#[test]
fn cancel_mid_file_removes_the_partial_copy() {
    let h = Harness::new();
    let dir = tempdir().unwrap();
    let big = dir.path().join("gross.bin");
    fs::write(&big, vec![1u8; 64 * 1024 * 1024]).unwrap();
    let dst = dir.path().join("d");
    fs::create_dir(&dst).unwrap();
    let id = h.copy(&[&big], &dst, false);
    h.mgr.pause(&id); // freeze it somewhere in the middle …
    thread::sleep(Duration::from_millis(50));
    h.mgr.cancel(&id); // … and cancel while paused
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Cancelled);
    assert!(!dst.join("gross.bin").exists());
    assert!(no_temp_files(&dst), "temp file left: {:?}", walk(&dst));
}

#[test]
fn pause_stops_progress_and_resume_finishes() {
    let h = Harness::new();
    let id = h
        .mgr
        .start(JobSpec::Simulate {
            items: 40,
            item_ms: 5,
        })
        .unwrap();
    h.wait_state(&id, JobState::Running);
    h.mgr.pause(&id);
    h.wait_state(&id, JobState::Paused);
    thread::sleep(Duration::from_millis(30));
    let a = h.mgr.list()[0].progress.items_done;
    thread::sleep(Duration::from_millis(80));
    let b = h.mgr.list()[0].progress.items_done;
    assert!(b <= a + 1, "progress while paused: {a} → {b}");
    h.mgr.resume(&id);
    assert_eq!(h.finish(&id).state, JobState::Done);
}

#[test]
fn errors_per_item_are_collected_and_the_job_goes_on() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    // a folder in the target where a file should go → that item fails, the rest is copied
    fs::create_dir_all(dst.join("Quelle ä/a.txt")).unwrap();
    // beside the source (one below it would be dropped: the folder brings it along)
    let missing = src.with_file_name("gibt es nicht");
    let info = h.finish(&h.copy(&[&src, &missing], &dst, false));
    assert_eq!(info.state, JobState::DoneWithErrors);
    let s = info.summary.unwrap();
    assert_eq!(s.items_failed, 2);
    assert_eq!(s.errors.len(), 2);
    assert!(dst.join("Quelle ä/Unter ordner 📁/b.bin").exists());
    assert_eq!(h.count(|e| matches!(e, JobEvent::ItemFailed { .. })), 2);
}

#[cfg(unix)]
#[test]
fn symlinks_are_copied_as_links() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    std::os::unix::fs::symlink("a.txt", src.join("link")).unwrap();
    std::os::unix::fs::symlink(&src, src.join("schleife")).unwrap(); // cycle
    let info = h.finish(&h.copy(&[&src], &dst, false));
    assert_eq!(info.state, JobState::Done);
    let link = dst.join("Quelle ä/link");
    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(fs::read_link(&link).unwrap(), PathBuf::from("a.txt"));
    assert!(
        fs::symlink_metadata(dst.join("Quelle ä/schleife"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[test]
fn serial_queue_runs_one_after_another_background_in_parallel() {
    let h = Harness::new();
    let dir = tempdir().unwrap();
    let f = dir.path().join("f");
    fs::write(&f, "x").unwrap();
    let (d1, d2, d3) = (
        dir.path().join("1"),
        dir.path().join("2"),
        dir.path().join("3"),
    );
    for d in [&d1, &d2, &d3] {
        fs::create_dir(d).unwrap();
    }
    fs::write(d1.join("f"), "old").unwrap(); // the first job waits for a decision …
    let first = h.copy(&[&f], &d1, false);
    let second = h.copy(&[&f], &d2, false);
    let third = h.copy(&[&f], &d3, true);
    let c = h.conflict(&first);
    // … the second waits in the queue, the background job is done already
    assert_eq!(h.finish(&third).state, JobState::Done);
    assert_eq!(
        h.mgr.list().iter().find(|j| j.id == second).unwrap().state,
        JobState::Queued
    );
    h.mgr.cancel(&second); // a queued job can be cancelled before it starts
    h.mgr
        .resolve_conflict(&first, c.conflict_id, Decision::Skip, false);
    assert_eq!(h.finish(&first).state, JobState::Done);
    assert_eq!(h.finish(&second).state, JobState::Cancelled);
    assert!(!d2.join("f").exists());
    assert!(h.mgr.wait_idle(WAIT));
    h.mgr.clear_finished();
    assert!(h.mgr.list().is_empty());
}

/// Three folders and a blocking first job: it waits for a conflict answer and
/// holds the serial slot.
fn blocked_queue(h: &Harness) -> (TempDir, PathBuf, PathBuf, String, Conflict) {
    let dir = tempdir().unwrap();
    let f = dir.path().join("f");
    fs::write(&f, "x").unwrap();
    let d1 = dir.path().join("1");
    fs::create_dir(&d1).unwrap();
    fs::write(d1.join("f"), "old").unwrap();
    let first = h.copy(&[&f], &d1, false);
    let c = h.conflict(&first);
    (dir, f, d1, first, c)
}

#[test]
fn start_now_runs_a_waiting_job_beside_the_running_one() {
    let h = Harness::new();
    let (dir, _f, _d1, first, c) = blocked_queue(&h);
    let (g, k) = (dir.path().join("g"), dir.path().join("k"));
    fs::write(&g, "g").unwrap();
    fs::write(&k, "k").unwrap();
    let (d2, d3) = (dir.path().join("2"), dir.path().join("3"));
    fs::create_dir(&d2).unwrap();
    fs::create_dir(&d3).unwrap();
    let second = h.copy(&[&g], &d2, false);
    let third = h.copy(&[&k], &d3, false);
    h.wait_state(&second, JobState::Queued);
    assert_eq!(h.mgr.start_now(&second, false), StartNow::Started);
    assert_eq!(h.finish(&second).state, JobState::Done);
    assert!(d2.join("g").exists());
    // its end did not free the slot of the blocked job: the third still waits
    thread::sleep(Duration::from_millis(50));
    let state = |id: &str| h.mgr.list().iter().find(|j| j.id == id).unwrap().state;
    assert_eq!(state(&third), JobState::Queued);
    assert_eq!(state(&first), JobState::WaitingForDecision);
    // a running or finished job is not in the queue
    assert_eq!(h.mgr.start_now(&first, false), StartNow::NotQueued);
    assert_eq!(h.mgr.start_now(&second, true), StartNow::NotQueued);
    h.mgr
        .resolve_conflict(&first, c.conflict_id, Decision::Skip, false);
    assert_eq!(h.finish(&first).state, JobState::Done);
    assert_eq!(h.finish(&third).state, JobState::Done);
    assert!(h.mgr.wait_idle(WAIT));
}

#[test]
fn start_now_reports_jobs_on_the_same_paths_and_starts_with_force() {
    let h = Harness::new();
    let (dir, f, _d1, first, c) = blocked_queue(&h);
    let d2 = dir.path().join("2");
    fs::create_dir(&d2).unwrap();
    // the same source as the blocked job
    let second = h.copy(&[&f], &d2, false);
    h.wait_state(&second, JobState::Queued);
    assert_eq!(
        h.mgr.start_now(&second, false),
        StartNow::Overlap {
            with: vec![first.clone()]
        }
    );
    // nothing changed: it still waits
    let state = |id: &str| h.mgr.list().iter().find(|j| j.id == id).unwrap().state;
    assert_eq!(state(&second), JobState::Queued);
    assert_eq!(h.mgr.start_now(&second, true), StartNow::Started);
    assert_eq!(h.finish(&second).state, JobState::Done);
    h.mgr
        .resolve_conflict(&first, c.conflict_id, Decision::Skip, false);
    assert_eq!(h.finish(&first).state, JobState::Done);
    assert!(h.mgr.wait_idle(WAIT));
}

#[test]
fn a_waiting_job_paused_and_resumed_still_waits() {
    let h = Harness::new();
    let (dir, _f, _d1, first, c) = blocked_queue(&h);
    let g = dir.path().join("g");
    fs::write(&g, "g").unwrap();
    let d2 = dir.path().join("2");
    fs::create_dir(&d2).unwrap();
    let second = h.copy(&[&g], &d2, false);
    h.wait_state(&second, JobState::Queued);
    h.mgr.pause(&second);
    h.wait_state(&second, JobState::Paused);
    h.mgr.resume(&second);
    // was "running" although it had not started (it showed no Start now either)
    h.wait_state(&second, JobState::Queued);
    assert!(matches!(
        h.events.lock().unwrap().last(),
        Some(JobEvent::State {
            state: JobState::Queued,
            ..
        })
    ));
    h.mgr
        .resolve_conflict(&first, c.conflict_id, Decision::Skip, false);
    assert_eq!(h.finish(&second).state, JobState::Done);
    assert!(h.mgr.wait_idle(WAIT));
}

#[test]
fn progress_is_throttled() {
    let h = Harness::new();
    let dir = tempdir().unwrap();
    let src = dir.path().join("viele");
    fs::create_dir(&src).unwrap();
    for i in 0..3000 {
        fs::write(src.join(format!("{i}.txt")), "x").unwrap();
    }
    let dst = dir.path().join("d");
    fs::create_dir(&dst).unwrap();
    let start = Instant::now();
    let info = h.finish(&h.copy(&[&src], &dst, false));
    let secs = start.elapsed().as_secs_f64();
    assert_eq!(info.state, JobState::Done);
    let progress = h.count(|e| matches!(e, JobEvent::Progress { .. }));
    let dirs = h.count(|e| matches!(e, JobEvent::DirsChanged { .. }));
    assert!(
        progress as f64 <= secs * 10.0 + 3.0,
        "{progress} progress events in {secs:.2}s"
    );
    assert!(
        dirs as f64 <= secs * 2.0 + 3.0,
        "{dirs} dir events in {secs:.2}s"
    );
}

#[test]
fn dir_size_runs_as_job() {
    let h = Harness::new();
    let (_d, src, _dst) = tree();
    let id = h
        .mgr
        .start(JobSpec::DirSize {
            path: src.to_string_lossy().into_owned(),
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let size = info.summary.unwrap().dir_size.unwrap();
    assert_eq!((size.files, size.dirs, size.bytes), (2, 2, 200_005));
}

#[test]
fn dir_size_does_not_start_duplicate_job_while_running() {
    // The job thread is held at its "running" event until both starts are done – a tiny
    // tree would otherwise be counted before the second start (the test was flaky).
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let sink_gate = gate.clone();
    let mgr = JobManager::new(Arc::new(move |e: &JobEvent| {
        if matches!(
            e,
            JobEvent::State {
                state: JobState::Running,
                ..
            }
        ) {
            let (open, cv) = &*sink_gate;
            let guard = open.lock().unwrap();
            drop(cv.wait_while(guard, |open| !*open).unwrap());
        }
    }));
    let (_d, src, _dst) = tree();
    let path = src.to_string_lossy().into_owned();
    let id1 = mgr.start(JobSpec::DirSize { path: path.clone() }).unwrap();
    // Starting the same path again while running returns the existing id
    let id2 = mgr.start(JobSpec::DirSize { path: path.clone() }).unwrap();
    assert_eq!(id1, id2);
    {
        let (open, cv) = &*gate;
        *open.lock().unwrap() = true;
        cv.notify_all();
    }
    let info = mgr.wait_finished(&id1, WAIT).expect("job did not finish");
    assert_eq!(info.state, JobState::Done);
    // once finished, the same path is calculated anew
    let id3 = mgr.start(JobSpec::DirSize { path }).unwrap();
    assert_ne!(id3, id1);
    assert_eq!(
        mgr.wait_finished(&id3, WAIT)
            .expect("job did not finish")
            .state,
        JobState::Done
    );
}

#[test]
fn invalid_specs_are_refused_before_queueing() {
    let h = Harness::new();
    assert!(
        h.mgr
            .start(JobSpec::Copy {
                sources: vec![],
                target_dir: "/x".into(),
                background: false,
                options: CopyOptions::default(),
            })
            .is_err()
    );
    assert!(
        h.mgr
            .start(JobSpec::Copy {
                sources: vec!["rel".into()],
                target_dir: "/x".into(),
                background: false,
                options: CopyOptions::default(),
            })
            .is_err()
    );
    assert!(h.mgr.list().is_empty());
}

#[test]
fn suggested_names_skip_existing_ones() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("Brief.pdf"), "").unwrap();
    fs::write(dir.path().join("Brief (1).pdf"), "").unwrap();
    assert_eq!(
        copy::suggest_name(&dir.path().join("Brief.pdf")),
        "Brief (2).pdf"
    );
    assert_eq!(
        copy::suggest_name(&dir.path().join(".hidden")),
        ".hidden (1)"
    );
}

#[test]
fn pause_during_a_question_keeps_the_question() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    fs::write(dst.join("a.txt"), "old").unwrap();
    let id = h.copy(
        &[&src.join("a.txt"), &src.join("Unter ordner 📁/b.bin")],
        &dst,
        false,
    );
    let c = h.conflict(&id);
    h.mgr.pause(&id);
    let info = h.mgr.list().into_iter().find(|j| j.id == id).unwrap();
    assert_eq!(info.state, JobState::WaitingForDecision);
    assert!(
        info.conflict.is_some(),
        "pausing must not drop the question"
    );
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Overwrite, false);
    h.wait_state(&id, JobState::Paused); // pauses right after the answer
    h.mgr.resume(&id);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "alpha");
}

#[cfg(unix)]
#[test]
fn special_files_are_reported_not_opened() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    let fifo = src.join("rohr");
    let made = std::process::Command::new("mkfifo").arg(&fifo).status();
    if !made.is_ok_and(|s| s.success()) {
        return; // mkfifo not available
    }
    let info = h.finish(&h.copy(&[&src], &dst, false));
    assert_eq!(info.state, JobState::DoneWithErrors);
    let s = info.summary.unwrap();
    assert_eq!(s.items_failed, 1);
    assert_eq!(s.errors[0].error.code, crate::error::FsErrorCode::NotAFile);
    assert!(dst.join("Quelle ä/a.txt").exists());
}

#[test]
fn long_file_names_copy() {
    let h = Harness::new();
    let dir = tempdir().unwrap();
    let name = "n".repeat(250);
    let src = dir.path().join("s");
    let dst = dir.path().join("d");
    fs::create_dir_all(&src).unwrap();
    fs::create_dir_all(&dst).unwrap();
    fs::write(src.join(&name), "x").unwrap();
    let info = h.finish(&h.copy(&[&src.join(&name)], &dst, false));
    assert_eq!(info.state, JobState::Done);
    assert!(dst.join(&name).exists());
}

#[cfg(unix)]
#[test]
fn overwriting_with_a_link_replaces_the_target_only_when_the_link_exists() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    std::os::unix::fs::symlink("a.txt", src.join("link")).unwrap();
    fs::write(dst.join("link"), "user data").unwrap();
    let id = h.copy(&[&src.join("link")], &dst, false);
    let c = h.conflict(&id);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Overwrite, false);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(
        fs::read_link(dst.join("link")).unwrap(),
        PathBuf::from("a.txt")
    );
    assert!(no_temp_files(&dst));
}

#[test]
fn a_target_that_appears_while_copying_is_not_replaced() {
    let dir = tempdir().unwrap();
    let tmp = dir.path().join("t.part");
    let dst = dir.path().join("x");
    fs::write(&tmp, "new").unwrap();
    fs::write(&dst, "appeared").unwrap();
    let err = copy::place_for_tests(&tmp, &dst).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read_to_string(&dst).unwrap(), "appeared");
}
