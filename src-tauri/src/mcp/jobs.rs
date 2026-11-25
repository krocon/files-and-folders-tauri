//! Jobs of a client (design 071 E8). The long reading tools run as normal jobs through
//! [`JobManager::start`] – the same validation as for the window, visible in "Tasks".
//! A tap on the job events collects their results for the tool; the client that
//! started a job (or whose proposal the user confirmed) may ask about it and cancel it.

use super::McpError;
use super::limits::{KEPT_OWNERS, KEPT_RESULTS};
use crate::compare::{CompareRow, CompareStats};
use crate::jobs::{JobEvent, JobManager, JobSpec, JobState, Progress, Summary};
use crate::search::{SearchHit, SearchStats};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::ThreadId;
use std::time::{Duration, Instant};

/// The only job kinds a tool may start: they read. Everything that changes files is
/// started by the window after the user confirmed a proposal.
pub const READ_KINDS: [&str; 5] = ["search", "duplicates", "compare", "diskUsage", "checksum"];

/// What a job of a client produced so far.
#[derive(Debug, Default)]
pub struct Collected {
    pub hits: Vec<SearchHit>,
    pub rows: Vec<CompareRow>,
    pub search_stats: Option<SearchStats>,
    pub compare_stats: Option<CompareStats>,
    pub progress: Progress,
    pub finished: Option<(JobState, Summary)>,
    /// More arrived than `limit` (the rest was dropped).
    pub truncated: bool,
}

#[derive(Debug)]
pub struct Collector {
    pub kind: &'static str,
    pub client: String,
    pub connection: u64,
    /// Hits / rows kept.
    pub limit: usize,
    pub data: Mutex<Collected>,
    /// The collector has all it keeps: the job may stop.
    pub full: AtomicBool,
    /// The tool built this answer already (`diskUsage` releases its scan after reading).
    pub result: Mutex<Option<serde_json::Value>>,
    /// What the tool needs to build the answer later (`get_job`).
    pub shape: serde_json::Value,
}

impl Collector {
    pub fn new(
        kind: &'static str,
        client: &str,
        connection: u64,
        limit: usize,
        shape: serde_json::Value,
    ) -> Arc<Self> {
        Arc::new(Self {
            kind,
            client: client.to_string(),
            connection,
            limit,
            data: Mutex::new(Collected::default()),
            full: AtomicBool::new(false),
            result: Mutex::new(None),
            shape,
        })
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Collected> {
        self.data.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn finished(&self) -> Option<JobState> {
        self.lock().finished.as_ref().map(|(s, _)| *s)
    }

    fn on_event(&self, event: &JobEvent) {
        let mut d = self.lock();
        match event {
            JobEvent::SearchHits { hits, stats, .. } => {
                let room = self.limit.saturating_sub(d.hits.len());
                if hits.len() > room {
                    d.truncated = true;
                    self.full.store(true, Ordering::SeqCst);
                }
                d.hits.extend(hits.iter().take(room).cloned());
                d.search_stats = Some(stats.clone());
            }
            JobEvent::CompareRows { rows, stats, .. } => {
                let room = self.limit.saturating_sub(d.rows.len());
                if rows.len() > room {
                    d.truncated = true;
                    self.full.store(true, Ordering::SeqCst);
                }
                d.rows.extend(rows.iter().take(room).cloned());
                // the unreadable entries are paths the client did not ask for
                let mut stats = stats.clone();
                stats.errors.clear();
                d.compare_stats = Some(stats);
            }
            JobEvent::Progress { progress, .. } => {
                d.progress = Progress {
                    current: None,
                    dest_bytes: HashMap::new(),
                    ..progress.clone()
                };
            }
            JobEvent::Finished { state, summary, .. } => {
                d.finished = Some((*state, summary.as_ref().clone()));
            }
            _ => {}
        }
    }
}

fn event_job(event: &JobEvent) -> Option<&str> {
    match event {
        JobEvent::State { id, .. }
        | JobEvent::Progress { id, .. }
        | JobEvent::Finished { id, .. }
        | JobEvent::SearchHits { id, .. }
        | JobEvent::CompareRows { id, .. } => Some(id),
        _ => None,
    }
}

#[derive(Default)]
struct TapInner {
    /// A tool on that thread is inside `JobManager::start` – the `added` event of
    /// its job arrives on the same thread before `start` returns. One claim per
    /// thread (review #8): calls of several clients never take each other's job.
    claims: HashMap<ThreadId, Arc<Collector>>,
    collectors: HashMap<String, Arc<Collector>>,
    /// Newest last, for dropping old results.
    order: VecDeque<String>,
    /// Job id → connection: who may ask about it and cancel it. Not the name – a
    /// client states its name itself (review #6).
    owners: VecDeque<(String, u64)>,
}

/// Listens to all job events and keeps what belongs to jobs of clients.
#[derive(Default)]
pub struct JobTap {
    inner: Mutex<TapInner>,
    /// Counting the running jobs of a connection and starting one more is one step.
    starting: Mutex<()>,
}

impl JobTap {
    fn lock(&self) -> std::sync::MutexGuard<'_, TapInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Called for every event of the job engine (any thread). Never blocks, never
    /// calls back into the engine.
    pub fn on_event(&self, event: &JobEvent) {
        if let JobEvent::Added { job } = event {
            let mut inner = self.lock();
            if let Some(collector) = inner.claims.remove(&std::thread::current().id()) {
                inner.collectors.insert(job.id.clone(), collector);
                inner.order.push_back(job.id.clone());
            }
            return;
        }
        let Some(id) = event_job(event) else {
            return;
        };
        let collector = self.lock().collectors.get(id).cloned();
        if let Some(c) = collector {
            c.on_event(event);
        }
    }

    /// Starts a **reading** job for a client. Refuses every other kind – this is the
    /// only place a tool starts a job – and a job beyond `max_running` unfinished ones
    /// of the same connection.
    pub fn start(
        &self,
        manager: &Arc<JobManager>,
        spec: JobSpec,
        collector: Arc<Collector>,
        max_running: usize,
    ) -> Result<String, McpError> {
        if !READ_KINDS.contains(&spec.kind()) {
            return Err(McpError::new(
                "not_available",
                "This kind of job cannot be started over MCP",
            ));
        }
        let connection = collector.connection;
        let me = std::thread::current().id();
        let _one = self.starting.lock().unwrap_or_else(|e| e.into_inner());
        if self.running_of(connection).len() >= max_running {
            return Err(McpError::new(
                "limit_exceeded",
                "Too many jobs of this client are running – wait for them or cancel one",
            ));
        }
        self.lock().claims.insert(me, collector);
        let started = manager.start(spec);
        let mut inner = self.lock();
        // the claim is taken by `added`; a refused start leaves it
        inner.claims.remove(&me);
        let id = started?;
        Self::own(&mut inner, &id, connection);
        while inner.order.len() > KEPT_RESULTS {
            // drop the oldest finished result; running ones stay
            let pos = inner.order.iter().position(|j| {
                inner
                    .collectors
                    .get(j)
                    .is_none_or(|c| c.finished().is_some())
            });
            match pos {
                Some(p) => {
                    if let Some(j) = inner.order.remove(p) {
                        inner.collectors.remove(&j);
                    }
                }
                None => break,
            }
        }
        Ok(id)
    }

    fn own(inner: &mut TapInner, id: &str, connection: u64) {
        inner.owners.retain(|(j, _)| j != id);
        inner.owners.push_back((id.to_string(), connection));
        while inner.owners.len() > KEPT_OWNERS {
            inner.owners.pop_front();
        }
    }

    /// A job the window started for a confirmed proposal of a connection.
    pub fn adopt(&self, id: &str, connection: u64) {
        Self::own(&mut self.lock(), id, connection);
    }

    pub fn owner(&self, id: &str) -> Option<u64> {
        self.lock()
            .owners
            .iter()
            .find(|(j, _)| j == id)
            .map(|(_, c)| *c)
    }

    pub fn owned_by(&self, connection: u64) -> Vec<String> {
        self.lock()
            .owners
            .iter()
            .filter(|(_, c)| *c == connection)
            .map(|(j, _)| j.clone())
            .collect()
    }

    pub fn collector(&self, id: &str) -> Option<Arc<Collector>> {
        self.lock().collectors.get(id).cloned()
    }

    /// Unfinished jobs a connection started.
    pub fn running_of(&self, connection: u64) -> Vec<String> {
        self.lock()
            .collectors
            .iter()
            .filter(|(_, c)| c.connection == connection && c.finished().is_none())
            .map(|(j, _)| j.clone())
            .collect()
    }
}

/// How waiting for a job ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waited {
    Finished,
    /// Still running after the time limit.
    Running,
    Cancelled,
}

/// Waits until the job finished, the time is up or the call was cancelled. A full
/// collector or a cancelled call stops the job. `tick` runs about once a second.
pub fn wait(
    manager: &Arc<JobManager>,
    id: &str,
    collector: &Collector,
    timeout: Duration,
    cancel: &AtomicBool,
    mut tick: impl FnMut(&Progress),
) -> Waited {
    let deadline = Instant::now() + timeout;
    let mut last_tick = Instant::now();
    let mut stopped = false;
    loop {
        if collector.finished().is_some() {
            return Waited::Finished;
        }
        if cancel.load(Ordering::SeqCst) {
            manager.cancel(id);
            return Waited::Cancelled;
        }
        if collector.full.load(Ordering::SeqCst) && !stopped {
            manager.cancel(id);
            stopped = true;
        }
        if Instant::now() >= deadline {
            return Waited::Running;
        }
        if last_tick.elapsed() >= Duration::from_secs(1) {
            last_tick = Instant::now();
            tick(&collector.lock().progress);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::DeleteMode;

    fn manager_with(tap: &Arc<JobTap>) -> Arc<JobManager> {
        let t = tap.clone();
        JobManager::new(Arc::new(move |e: &JobEvent| t.on_event(e)))
    }

    fn collector(limit: usize) -> Arc<Collector> {
        Collector::new("search", "client", 1, limit, serde_json::Value::Null)
    }

    fn search(root: &std::path::Path) -> JobSpec {
        serde_json::from_value(serde_json::json!({
            "kind": "search",
            "criteria": { "roots": [root.to_string_lossy()], "name": "*.txt" }
        }))
        .unwrap()
    }

    #[test]
    fn only_reading_jobs_start() {
        let tap = Arc::new(JobTap::default());
        let m = manager_with(&tap);
        let tmp = tempfile::tempdir().unwrap();
        let victim = tmp.path().join("keep.txt");
        std::fs::write(&victim, "x").unwrap();
        let p = victim.to_string_lossy().into_owned();
        let refused = [
            JobSpec::Delete {
                paths: vec![p.clone()],
                mode: DeleteMode::Permanent,
                background: false,
                allow_dangerous: false,
                expected: Vec::new(),
            },
            JobSpec::Shell {
                cwd: tmp.path().to_string_lossy().into_owned(),
                command: "rm -rf .".into(),
                launch: Default::default(),
            },
            JobSpec::Copy {
                sources: vec![p.clone()],
                target_dir: tmp.path().to_string_lossy().into_owned(),
                background: false,
                options: Default::default(),
            },
            JobSpec::DirSize { path: p.clone() },
        ];
        for spec in refused {
            let kind = spec.kind();
            let e = tap.start(&m, spec, collector(10), 9).unwrap_err();
            assert_eq!(e.code, "not_available", "{kind}");
        }
        assert!(m.list().is_empty(), "nothing was started");
        assert!(victim.exists());
    }

    #[test]
    fn a_search_is_collected_and_owned() {
        let tap = Arc::new(JobTap::default());
        let m = manager_with(&tap);
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..5 {
            std::fs::write(tmp.path().join(format!("f{i}.txt")), "x").unwrap();
        }
        std::fs::write(tmp.path().join("other.md"), "x").unwrap();
        let c = collector(100);
        let id = tap.start(&m, search(tmp.path()), c.clone(), 9).unwrap();
        let cancel = AtomicBool::new(false);
        let w = wait(&m, &id, &c, Duration::from_secs(20), &cancel, |_| {});
        assert_eq!(w, Waited::Finished);
        assert_eq!(c.lock().hits.len(), 5);
        assert!(!c.lock().truncated);
        assert_eq!(tap.owner(&id), Some(1));
        assert_eq!(tap.owned_by(1), vec![id.clone()]);
        assert!(tap.owned_by(2).is_empty());
        assert!(tap.running_of(1).is_empty());
    }

    #[test]
    fn a_full_collector_keeps_the_limit() {
        let tap = Arc::new(JobTap::default());
        let m = manager_with(&tap);
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..50 {
            std::fs::write(tmp.path().join(format!("f{i}.txt")), "x").unwrap();
        }
        let c = collector(7);
        let id = tap.start(&m, search(tmp.path()), c.clone(), 9).unwrap();
        let w = wait(
            &m,
            &id,
            &c,
            Duration::from_secs(20),
            &AtomicBool::new(false),
            |_| {},
        );
        assert_eq!(w, Waited::Finished);
        let d = c.lock();
        assert_eq!(d.hits.len(), 7);
        assert!(d.truncated);
    }

    /// E8: giving up the call stops its job.
    #[test]
    fn a_cancelled_call_cancels_its_job() {
        let tap = Arc::new(JobTap::default());
        let m = manager_with(&tap);
        let tmp = tempfile::tempdir().unwrap();
        for d in 0..40 {
            let dir = tmp.path().join(format!("d{d}"));
            std::fs::create_dir(&dir).unwrap();
            for i in 0..50 {
                std::fs::write(dir.join(format!("f{i}.txt")), "x").unwrap();
            }
        }
        let c = collector(100_000);
        let id = tap.start(&m, search(tmp.path()), c.clone(), 9).unwrap();
        let cancel = AtomicBool::new(true);
        let w = wait(&m, &id, &c, Duration::from_secs(20), &cancel, |_| {});
        // the search may have been faster than the cancel – then it is simply finished
        assert!(matches!(w, Waited::Cancelled | Waited::Finished));
        let info = m
            .wait_finished(&id, Duration::from_secs(20))
            .expect("the job ends");
        assert!(info.state.is_finished());
        if w == Waited::Cancelled {
            assert!(
                matches!(info.state, JobState::Cancelled | JobState::Done),
                "{:?}",
                info.state
            );
        }
        assert!(tap.running_of(1).is_empty());
    }

    /// Review #8: starts from several threads at once – every job gets its own
    /// collector and owner, and the limit holds.
    #[test]
    fn concurrent_starts_keep_their_jobs_apart_and_the_limit() {
        let tap = Arc::new(JobTap::default());
        let m = manager_with(&tap);
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
        let root = tmp.path().to_path_buf();
        let threads: Vec<_> = (0..4u64)
            .map(|conn| {
                let (tap, m, root) = (tap.clone(), m.clone(), root.clone());
                std::thread::spawn(move || {
                    let mut mine = Vec::new();
                    for _ in 0..3 {
                        let c = Collector::new(
                            "search",
                            "same name",
                            conn,
                            10,
                            serde_json::Value::Null,
                        );
                        let id = tap.start(&m, search(&root), c.clone(), 1000).unwrap();
                        mine.push((id, c));
                    }
                    (conn, mine)
                })
            })
            .collect();
        for t in threads {
            let (conn, mine) = t.join().unwrap();
            for (id, c) in mine {
                let kept = tap
                    .collector(&id)
                    .expect("every started job has a collector");
                assert!(
                    Arc::ptr_eq(&kept, &c),
                    "job {id} got the collector of another call"
                );
                assert_eq!(tap.owner(&id), Some(conn));
            }
        }
        // the limit: nothing starts beyond it
        let c = Collector::new("search", "x", 99, 10, serde_json::Value::Null);
        let e = tap.start(&m, search(&root), c, 0).unwrap_err();
        assert_eq!(e.code, "limit_exceeded");
        assert!(tap.owned_by(99).is_empty());
    }

    #[test]
    fn a_job_of_the_window_is_not_collected() {
        let tap = Arc::new(JobTap::default());
        let m = manager_with(&tap);
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
        let id = m.start(search(tmp.path())).unwrap();
        assert!(tap.collector(&id).is_none());
        assert!(tap.owner(&id).is_none());
        m.wait_finished(&id, Duration::from_secs(20));
    }

    #[test]
    fn a_refused_start_leaves_no_claim() {
        let tap = Arc::new(JobTap::default());
        let m = manager_with(&tap);
        let bad: JobSpec = serde_json::from_value(serde_json::json!({
            "kind": "search", "criteria": { "roots": ["relative"], "name": "*" }
        }))
        .unwrap();
        assert!(tap.start(&m, bad, collector(10), 9).is_err());
        // the next job of the window must not fall into the stale claim
        let tmp = tempfile::tempdir().unwrap();
        let id = m.start(search(tmp.path())).unwrap();
        assert!(tap.collector(&id).is_none());
        m.wait_finished(&id, Duration::from_secs(20));
    }
}
