//! Job manager: ids, the serial queue, one thread per running job, the
//! current state of every job (for snapshots after a WebView reload) and the
//! event sink. The lock is never held during file I/O or while sending events.

use super::report::Reporter;
use super::{
    Control, Decision, JobEvent, JobInfo, JobSpec, JobState, Progress, RenameItem, Summary,
    Transfer, clean, copy, delete, group, rename, search,
};
use crate::dirsize::{self, DirSize};
use crate::error::{FsError, FsErrorCode};
use crate::fileops::check_danger;
use crate::paths::validate_input_path;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// Receives every event (the command layer forwards them to the frontend).
pub type Sink = Arc<dyn Fn(&JobEvent) + Send + Sync>;

struct Entry {
    info: JobInfo,
    control: Arc<Control>,
}

#[derive(Default)]
struct Inner {
    jobs: Vec<Entry>,
    next_id: u64,
    serial_busy: bool,
    queue: VecDeque<String>,
    running: usize,
}

pub struct JobManager {
    inner: Mutex<Inner>,
    changed: Condvar,
    sink: Sink,
    /// The user's home folder (moving or deleting it needs a second confirmation).
    home: Mutex<Option<PathBuf>>,
    /// Tests force the copy + delete path of a move (no second volume in CI).
    pub(crate) force_copy_on_move: AtomicBool,
    /// What the last rename jobs did (job id → pairs that undo it), newest last.
    undo_log: Mutex<VecDeque<(String, Vec<RenameItem>)>>,
}

/// Rename jobs that can be undone (design 007 E7).
pub const UNDO_LOG_SIZE: usize = 20;

impl JobManager {
    pub fn new(sink: Sink) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner::default()),
            changed: Condvar::new(),
            sink,
            home: Mutex::new(None),
            force_copy_on_move: AtomicBool::new(false),
            undo_log: Mutex::new(VecDeque::new()),
        })
    }

    pub fn set_home(&self, home: Option<PathBuf>) {
        *self.home.lock().unwrap_or_else(|e| e.into_inner()) = home;
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Validates the spec and queues (or starts) the job. Returns its id.
    pub fn start(self: &Arc<Self>, spec: JobSpec) -> Result<String, FsError> {
        let home = self.home.lock().unwrap_or_else(|e| e.into_inner()).clone();
        validate(&spec, home.as_deref())?;
        let parallel = spec.is_parallel();
        let (id, run_now, info) = {
            let mut inner = self.lock();
            inner.next_id += 1;
            let id = format!("j{}", inner.next_id);
            let run_now = parallel || !inner.serial_busy;
            if !parallel {
                if run_now {
                    inner.serial_busy = true;
                } else {
                    inner.queue.push_back(id.clone());
                }
            }
            let info = JobInfo {
                id: id.clone(),
                spec,
                state: JobState::Queued,
                progress: Progress::default(),
                conflict: None,
                summary: None,
                pause_reason: None,
                undo_available: false,
            };
            inner.jobs.push(Entry {
                info: info.clone(),
                control: Arc::new(Control::default()),
            });
            (id, run_now, info)
        };
        (self.sink)(&JobEvent::Added {
            job: Box::new(info),
        });
        if run_now {
            self.spawn(id.clone());
        }
        Ok(id)
    }

    fn spawn(self: &Arc<Self>, id: String) {
        self.lock().running += 1;
        let me = self.clone();
        let spawned = thread::Builder::new().name(format!("fnf-job-{id}")).spawn({
            let id = id.clone();
            move || me.run(&id)
        });
        if spawned.is_err() {
            // no thread available: report the job as failed and keep the queue moving
            // (`finish` decrements `running`)
            let parallel = self
                .with_job(&id, |e| e.info.spec.is_parallel())
                .unwrap_or(true);
            let summary = Summary {
                error: Some(FsError::new(
                    FsErrorCode::Io,
                    "Could not start a worker thread",
                    None,
                )),
                ..Summary::default()
            };
            self.finish(&id, JobState::Failed, summary, parallel, None);
        }
    }

    fn run(self: &Arc<Self>, id: &str) {
        let Some((spec, control)) = self.with_job(id, |e| (e.info.spec.clone(), e.control.clone()))
        else {
            return;
        };
        let emit = |e: JobEvent| self.record(e);
        let home = self.home.lock().unwrap_or_else(|e| e.into_inner()).clone();
        // rename: the pairs that undo it – filled while it runs, kept after a panic
        let mut undo: Vec<RenameItem> = Vec::new();
        let is_rename = matches!(spec, JobSpec::Rename { .. });
        let work = || -> (JobState, Summary) {
            if control.is_cancelled() {
                (JobState::Cancelled, Summary::default())
            } else if let JobSpec::Rename { items, undo_of } = &spec {
                let partial = undo_of.is_some();
                rename::run(
                    id,
                    items,
                    partial,
                    home.as_deref(),
                    &control,
                    &emit,
                    &mut undo,
                )
            } else {
                let (state, summary) = match &spec {
                    JobSpec::Copy {
                        sources,
                        target_dir,
                        options,
                        ..
                    } => {
                        let sources: Vec<PathBuf> = sources.iter().map(PathBuf::from).collect();
                        let target = PathBuf::from(target_dir);
                        let mode = copy::Mode::Copy;
                        copy::run(id, &sources, &target, options, mode, &control, &emit)
                    }
                    JobSpec::Move {
                        sources,
                        target_dir,
                        options,
                        ..
                    } => {
                        let sources: Vec<PathBuf> = sources.iter().map(PathBuf::from).collect();
                        let target = PathBuf::from(target_dir);
                        let mode = copy::Mode::Move {
                            force_copy: self.force_copy_on_move.load(Ordering::SeqCst),
                        };
                        copy::run(id, &sources, &target, options, mode, &control, &emit)
                    }
                    JobSpec::Delete { paths, mode, .. } => {
                        let paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
                        delete::run(id, &paths, *mode, &control, &emit)
                    }
                    JobSpec::Group {
                        root,
                        items,
                        transfer,
                        options,
                    } => {
                        let force_copy = self.force_copy_on_move.load(Ordering::SeqCst);
                        let root = PathBuf::from(root);
                        group::run(
                            id, &root, items, *transfer, options, force_copy, &control, &emit,
                        )
                    }
                    JobSpec::Clean {
                        roots,
                        items,
                        mode,
                        options,
                    } => {
                        let roots: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
                        clean::run(
                            id,
                            &roots,
                            items,
                            *mode,
                            options,
                            home.as_deref(),
                            &control,
                            &emit,
                        )
                    }
                    JobSpec::Search { criteria } => search::run(id, criteria, &control, &emit),
                    JobSpec::Count { paths } => {
                        let paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
                        run_count(id, &paths, &control, &emit)
                    }
                    JobSpec::DirSize { path } => {
                        run_dir_size(id, &PathBuf::from(path), &control, &emit)
                    }
                    JobSpec::Simulate { items, item_ms } => {
                        run_simulate(id, *items, *item_ms, &control, &emit)
                    }
                    JobSpec::Rename { .. } => unreachable!("handled above"),
                };
                (state, summary)
            }
        };
        // a panic (a bug, or inside a crate such as `trash`) must not leave the job
        // "running" forever and block the serial queue
        let (state, summary) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work))
            .unwrap_or_else(|_| {
                (
                    JobState::Failed,
                    Summary {
                        error: Some(FsError::new(
                            FsErrorCode::Io,
                            "The task stopped because of an internal error",
                            None,
                        )),
                        ..Summary::default()
                    },
                )
            });
        self.finish(
            id,
            state,
            summary,
            spec.is_parallel(),
            is_rename.then_some(undo),
        );
    }

    /// Records the final state and starts the next queued serial job. `parallel`
    /// comes from the spec (the entry may already be removed by `clear_finished`).
    fn finish(
        self: &Arc<Self>,
        id: &str,
        state: JobState,
        summary: Summary,
        parallel: bool,
        undo: Option<Vec<RenameItem>>,
    ) {
        // before "finished": whoever waits for the job sees whether it can be undone
        if let Some(pairs) = undo.filter(|p| !p.is_empty()) {
            self.remember_undo(id, pairs);
        }
        self.record(JobEvent::Finished {
            id: id.to_string(),
            state,
            summary: Box::new(summary),
        });
        let next = {
            let mut inner = self.lock();
            inner.running = inner.running.saturating_sub(1);
            let mut next = None;
            if !parallel {
                inner.serial_busy = false;
                if let Some(n) = inner.queue.pop_front() {
                    inner.serial_busy = true;
                    next = Some(n);
                }
            }
            self.changed.notify_all();
            next
        };
        if let Some(n) = next {
            self.spawn(n);
        }
    }

    /// Updates the stored job info from an event, then forwards it. State
    /// changes are checked under the lock: a finished job keeps its final state,
    /// and "running" while the user paused becomes "paused".
    fn record(&self, event: JobEvent) {
        let forward = {
            let mut inner = self.lock();
            fn find<'a>(inner: &'a mut Inner, id: &str) -> Option<&'a mut Entry> {
                inner.jobs.iter_mut().find(|e| e.info.id == id)
            }
            let forward = match event {
                JobEvent::State { id, state } => match find(&mut inner, &id) {
                    Some(e) if e.info.state.is_finished() => None,
                    Some(e) => {
                        let state = if state == JobState::Running && e.control.is_paused() {
                            JobState::Paused
                        } else {
                            state
                        };
                        e.info.state = state;
                        if state != JobState::WaitingForDecision {
                            e.info.conflict = None;
                        }
                        if state != JobState::Paused {
                            e.info.pause_reason = None;
                        }
                        Some(JobEvent::State { id, state })
                    }
                    None => Some(JobEvent::State { id, state }),
                },
                JobEvent::Progress {
                    ref id,
                    ref progress,
                } => {
                    if let Some(e) = find(&mut inner, id) {
                        e.info.progress = progress.clone();
                    }
                    Some(event)
                }
                JobEvent::Conflict {
                    ref id,
                    ref conflict,
                } => {
                    if let Some(e) = find(&mut inner, id) {
                        e.info.conflict = Some(conflict.clone());
                    }
                    Some(event)
                }
                JobEvent::ItemFailed { ref id, ref error } => {
                    if error.error.code == FsErrorCode::DiskFull
                        && let Some(e) = find(&mut inner, id)
                    {
                        e.info.pause_reason = Some(error.error.clone());
                    }
                    Some(event)
                }
                JobEvent::Finished {
                    ref id,
                    state,
                    ref summary,
                } => {
                    if let Some(e) = find(&mut inner, id) {
                        e.info.state = state;
                        e.info.summary = Some(summary.as_ref().clone());
                        e.info.conflict = None;
                        e.info.pause_reason = None;
                        e.info.progress.current = None;
                    }
                    Some(event)
                }
                other => Some(other),
            };
            self.changed.notify_all();
            forward
        };
        if let Some(event) = forward {
            (self.sink)(&event);
        }
    }

    /// Stores the pairs that undo a finished rename job (the oldest drops out).
    fn remember_undo(&self, id: &str, pairs: Vec<RenameItem>) {
        let dropped = {
            let mut log = self.undo_log.lock().unwrap_or_else(|e| e.into_inner());
            log.push_back((id.to_string(), pairs));
            let mut dropped = Vec::new();
            while log.len() > UNDO_LOG_SIZE {
                if let Some((old, _)) = log.pop_front() {
                    dropped.push(old);
                }
            }
            dropped
        };
        self.set_undo_available(id, true);
        for old in dropped {
            self.set_undo_available(&old, false);
        }
    }

    fn set_undo_available(&self, id: &str, available: bool) {
        {
            let mut inner = self.lock();
            if let Some(e) = inner.jobs.iter_mut().find(|e| e.info.id == id) {
                e.info.undo_available = available;
            }
        }
        (self.sink)(&JobEvent::UndoAvailable {
            id: id.to_string(),
            available,
        });
    }

    /// Undoes a rename job (`None` = the last one) with a new rename job of the
    /// reversed pairs; returns its id. Entries changed since then fail one by one.
    pub fn undo_rename(self: &Arc<Self>, id: Option<&str>) -> Result<String, FsError> {
        let (job, pairs) = {
            let mut log = self.undo_log.lock().unwrap_or_else(|e| e.into_inner());
            let pos = match id {
                Some(id) => log.iter().position(|(j, _)| j == id),
                None => log.len().checked_sub(1),
            };
            pos.and_then(|p| log.remove(p)).ok_or_else(|| {
                FsError::new(
                    FsErrorCode::UndoUnavailable,
                    "There is no rename to undo",
                    None,
                )
            })?
        };
        let spec = JobSpec::Rename {
            // reversed: the last rename is undone first
            items: pairs.iter().rev().cloned().collect(),
            undo_of: Some(job.clone()),
        };
        match self.start(spec) {
            Ok(new_id) => {
                self.set_undo_available(&job, false);
                Ok(new_id)
            }
            Err(e) => {
                let mut log = self.undo_log.lock().unwrap_or_else(|e| e.into_inner());
                log.push_back((job, pairs));
                Err(e)
            }
        }
    }

    fn with_job<T>(&self, id: &str, f: impl FnOnce(&Entry) -> T) -> Option<T> {
        self.lock().jobs.iter().find(|e| e.info.id == id).map(f)
    }

    pub fn cancel(self: &Arc<Self>, id: &str) {
        let queued = {
            let mut inner = self.lock();
            let pos = inner.queue.iter().position(|q| q == id);
            if let Some(p) = pos {
                inner.queue.remove(p);
            }
            if let Some(e) = inner.jobs.iter().find(|e| e.info.id == id) {
                e.control.cancel();
            }
            pos.is_some()
        };
        if queued {
            // never started: finish it here (the running count was never increased)
            self.record(JobEvent::Finished {
                id: id.to_string(),
                state: JobState::Cancelled,
                summary: Box::default(),
            });
        }
    }

    /// Pauses a job. Only a queued, planning or running job shows "paused" at
    /// once; a job waiting for an answer keeps its question and pauses after it.
    pub fn pause(&self, id: &str) {
        let forward = {
            let mut inner = self.lock();
            let Some(e) = inner.jobs.iter_mut().find(|e| e.info.id == id) else {
                return;
            };
            if e.info.state.is_finished() {
                return;
            }
            e.control.set_paused(true);
            if matches!(
                e.info.state,
                JobState::Running | JobState::Planning | JobState::Queued
            ) {
                e.info.state = JobState::Paused;
                Some(JobEvent::State {
                    id: id.to_string(),
                    state: JobState::Paused,
                })
            } else {
                None
            }
        };
        if let Some(event) = forward {
            (self.sink)(&event);
        }
    }

    pub fn resume(&self, id: &str) {
        let forward = {
            let mut inner = self.lock();
            let Some(e) = inner.jobs.iter_mut().find(|e| e.info.id == id) else {
                return;
            };
            e.control.set_paused(false);
            if e.info.state == JobState::Paused {
                e.info.state = JobState::Running;
                e.info.pause_reason = None;
                Some(JobEvent::State {
                    id: id.to_string(),
                    state: JobState::Running,
                })
            } else {
                None
            }
        };
        if let Some(event) = forward {
            (self.sink)(&event);
        }
    }

    /// Passes the answer to the job – only once per conflict (a second click on
    /// another button must not replace the first answer).
    pub fn resolve_conflict(
        &self,
        id: &str,
        conflict_id: u64,
        decision: Decision,
        apply_to_all: bool,
    ) {
        let control = {
            let mut inner = self.lock();
            let Some(entry) = inner.jobs.iter_mut().find(|e| e.info.id == id) else {
                return;
            };
            if entry.info.conflict.as_ref().map(|c| c.conflict_id) != Some(conflict_id) {
                return;
            }
            entry.info.conflict = None;
            entry.control.clone()
        };
        control.answer(conflict_id, decision, apply_to_all);
    }

    pub fn list(&self) -> Vec<JobInfo> {
        self.lock().jobs.iter().map(|e| e.info.clone()).collect()
    }

    /// Removes finished jobs from the list.
    pub fn clear_finished(&self) {
        let ids: Vec<String> = {
            let mut inner = self.lock();
            let ids = inner
                .jobs
                .iter()
                .filter(|e| e.info.state.is_finished())
                .map(|e| e.info.id.clone())
                .collect();
            inner.jobs.retain(|e| !e.info.state.is_finished());
            ids
        };
        if !ids.is_empty() {
            (self.sink)(&JobEvent::Removed { ids });
        }
    }

    /// Jobs not finished yet (queued, running, paused, waiting), without helper
    /// jobs (folder size, count, search – quitting needs no confirmation for them).
    pub fn active_count(&self) -> usize {
        self.lock()
            .jobs
            .iter()
            .filter(|e| !e.info.state.is_finished() && !e.info.spec.is_helper())
            .count()
    }

    pub fn cancel_all(self: &Arc<Self>) {
        let ids: Vec<String> = self
            .lock()
            .jobs
            .iter()
            .filter(|e| !e.info.state.is_finished())
            .map(|e| e.info.id.clone())
            .collect();
        for id in ids {
            self.cancel(&id);
        }
    }

    /// Asks the frontend to confirm quitting while jobs run.
    pub fn request_quit(&self) {
        let running = self.active_count();
        (self.sink)(&JobEvent::QuitRequested { running });
    }

    /// Waits until no job thread runs (e.g. after `cancel_all`). `false` on timeout.
    pub fn wait_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut inner = self.lock();
        while inner.running > 0 || !inner.queue.is_empty() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            inner = self
                .changed
                .wait_timeout(inner, left)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        true
    }

    /// Waits for a job to finish (tests and quitting). `None` on timeout or unknown id.
    pub fn wait_finished(&self, id: &str, timeout: Duration) -> Option<JobInfo> {
        let deadline = Instant::now() + timeout;
        let mut inner = self.lock();
        loop {
            let info = inner
                .jobs
                .iter()
                .find(|e| e.info.id == id)
                .map(|e| e.info.clone())?;
            if info.state.is_finished() {
                return Some(info);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            inner = self
                .changed
                .wait_timeout(inner, left)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }
}

/// Checks paths before a job is accepted (the operation validates again).
fn validate(spec: &JobSpec, home: Option<&Path>) -> Result<(), FsError> {
    let nothing = || FsError::new(FsErrorCode::InvalidPath, "Nothing selected", None);
    match spec {
        JobSpec::Copy {
            sources,
            target_dir,
            ..
        } => {
            if sources.is_empty() {
                return Err(nothing());
            }
            for s in sources {
                validate_input_path(s)?;
            }
            validate_input_path(target_dir)?;
        }
        JobSpec::Move {
            sources,
            target_dir,
            allow_dangerous,
            ..
        } => {
            if sources.is_empty() {
                return Err(nothing());
            }
            for s in sources {
                check_danger(&validate_input_path(s)?, home, *allow_dangerous)?;
            }
            validate_input_path(target_dir)?;
        }
        JobSpec::Delete {
            paths,
            allow_dangerous,
            ..
        } => {
            if paths.is_empty() {
                return Err(nothing());
            }
            for p in paths {
                check_danger(&validate_input_path(p)?, home, *allow_dangerous)?;
            }
        }
        JobSpec::Rename { items, .. } => {
            if items.is_empty() {
                return Err(nothing());
            }
            if items.len() > rename::MAX_ITEMS {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    format!("Too many entries (max. {})", rename::MAX_ITEMS),
                    None,
                ));
            }
            // the job checks names, duplicates and targets itself (file I/O, off this thread)
            for i in items {
                validate_input_path(&i.path)?;
            }
        }
        JobSpec::Group {
            root,
            items,
            transfer,
            ..
        } => {
            if items.is_empty() {
                return Err(nothing());
            }
            if items.len() > group::MAX_ITEMS {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    format!("Too many entries (max. {})", group::MAX_ITEMS),
                    None,
                ));
            }
            validate_input_path(root)?;
            for i in items {
                let p = validate_input_path(&i.path)?;
                if *transfer == Transfer::Move {
                    check_danger(&p, home, false)?;
                }
                // group names are checked per group in the job (an error there fails only that group)
            }
        }
        JobSpec::Clean { roots, items, .. } => {
            if roots.is_empty() || items.is_empty() {
                return Err(nothing());
            }
            if items.len() > crate::clean::MAX_ITEMS {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    format!("Too many entries (max. {})", crate::clean::MAX_ITEMS),
                    None,
                ));
            }
            for r in roots {
                validate_input_path(r)?;
            }
            // each entry is checked again right before it is deleted (inside a root, no link, danger)
            for i in items {
                validate_input_path(&i.path)?;
            }
        }
        JobSpec::Search { criteria } => {
            // patterns and paths only – the roots are read in the job thread
            crate::search::compile(criteria)?;
        }
        JobSpec::Count { paths } => {
            for p in paths {
                validate_input_path(p)?;
            }
        }
        JobSpec::DirSize { path } => {
            validate_input_path(path)?;
        }
        JobSpec::Simulate { .. } => {
            if !cfg!(debug_assertions) {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    "Test jobs exist only in debug builds",
                    None,
                ));
            }
        }
    }
    Ok(())
}

/// Files, folders and bytes of a selection (links count as files, never followed).
fn run_count(
    id: &str,
    paths: &[PathBuf],
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let mut total = DirSize::default();
    let report = |t: &DirSize| {
        emit(JobEvent::Progress {
            id: id.to_string(),
            progress: Progress {
                bytes_done: t.bytes,
                items_done: t.files + t.dirs,
                ..Progress::default()
            },
        });
    };
    for p in paths {
        if control.is_cancelled() {
            total.cancelled = true;
            break;
        }
        match std::fs::symlink_metadata(p) {
            Ok(m) if m.is_dir() => {
                total.dirs += 1;
                let base = total;
                let sub =
                    dirsize::dir_size(p, control.cancel_flag(), Duration::from_millis(100), |s| {
                        report(&DirSize {
                            files: base.files + s.files,
                            dirs: base.dirs + s.dirs,
                            bytes: base.bytes + s.bytes,
                            ..base
                        })
                    });
                total.files += sub.files;
                total.dirs += sub.dirs;
                total.bytes += sub.bytes;
                total.unreadable += sub.unreadable;
                if sub.cancelled {
                    total.cancelled = true;
                    break;
                }
            }
            Ok(m) => {
                total.files += 1;
                total.bytes += m.len();
            }
            Err(_) => total.unreadable += 1,
        }
    }
    report(&total);
    let state = if total.cancelled {
        JobState::Cancelled
    } else {
        JobState::Done
    };
    let summary = Summary {
        items_done: total.files + total.dirs,
        bytes_done: total.bytes,
        dir_size: Some(total),
        ..Summary::default()
    };
    (state, summary)
}

fn run_dir_size(
    id: &str,
    path: &std::path::Path,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    if !path.is_dir() {
        let error = FsError::new(FsErrorCode::NotADirectory, "Not a folder", Some(path));
        return (
            JobState::Failed,
            Summary {
                error: Some(error),
                ..Summary::default()
            },
        );
    }
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let size = dirsize::dir_size(
        path,
        control.cancel_flag(),
        Duration::from_millis(100),
        |p| {
            emit(JobEvent::Progress {
                id: id.to_string(),
                progress: Progress {
                    bytes_done: p.bytes,
                    items_done: p.files + p.dirs,
                    ..Progress::default()
                },
            });
        },
    );
    let state = if size.cancelled {
        JobState::Cancelled
    } else {
        JobState::Done
    };
    let summary = Summary {
        items_done: size.files + size.dirs,
        bytes_done: size.bytes,
        dir_size: Some(size),
        ..Summary::default()
    };
    (state, summary)
}

/// `item_ms` that makes a test job panic (tests of the panic guard).
#[cfg(test)]
pub const PANIC_FOR_TESTS: u32 = 4_242_424;

/// Debug-only test job: `items` steps of `item_ms` each, 1 000 "bytes" per step.
fn run_simulate(
    id: &str,
    items: u32,
    item_ms: u32,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    #[cfg(test)]
    if item_ms == PANIC_FOR_TESTS {
        panic!("simulated failure");
    }
    let mut rep = Reporter::new(id, emit);
    rep.progress.items_total = u64::from(items);
    rep.progress.bytes_total = u64::from(items) * 1000;
    let state = if control.is_paused() {
        JobState::Paused
    } else {
        JobState::Running
    };
    rep.emit(JobEvent::State {
        id: id.to_string(),
        state,
    });
    for i in 0..items {
        if control.is_cancelled() || !control.wait_while_paused() {
            return (
                JobState::Cancelled,
                Summary {
                    items_done: u64::from(i),
                    ..Summary::default()
                },
            );
        }
        if item_ms > 0 {
            thread::sleep(Duration::from_millis(u64::from(item_ms)));
        }
        rep.progress.items_done += 1;
        rep.progress.bytes_done += 1000;
        rep.tick(false);
    }
    rep.tick(true);
    (
        JobState::Done,
        Summary {
            items_done: u64::from(items),
            bytes_done: u64::from(items) * 1000,
            ..Summary::default()
        },
    )
}
