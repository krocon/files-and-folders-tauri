//! The universal palette (design 043): files and folders for what is typed, from
//! three sources – the name index ([`index`], built in the background, kept fresh by
//! watchers), a bounded live walk over the known places ([`live`]) and optionally the
//! system search ([`system`]). A query streams its hits in batches; every new query
//! cancels the previous one. Nothing here touches file contents, and nothing is
//! written to disk – the index lives in memory only.

pub mod index;
pub mod live;
pub mod query;
pub mod system;

use crate::error::{FsError, FsErrorCode};
use crate::model::DirEntryDto;
use index::{Index, IndexConfig, SearchCtx, read_items};
use query::{Matcher, Mode, Query, fold, parse};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Hits per query at most (the frontend asks for fewer).
pub const MAX_LIMIT: u32 = 2000;
pub const DEFAULT_LIMIT: u32 = 300;
/// The live walk ends after this long (the index answers at once).
pub const LIVE_BUDGET: Duration = Duration::from_millis(1500);
pub const LIVE_MAX_DIRS: u64 = 20_000;
/// A query waits this long for the live walk of the previous one to end.
pub const LIVE_WAIT: Duration = Duration::from_millis(300);
/// Levels below a known place that the live walk visits.
pub const PLACE_DEPTH: u32 = 3;
/// Without a ready index the index roots are walked live this deep.
pub const ROOT_DEPTH: u32 = 8;
pub const SYSTEM_BUDGET: Duration = Duration::from_millis(800);
/// A batch of live hits is sent when it has this many, or after [`BATCH_INTERVAL`].
pub const BATCH_HITS: usize = 100;
pub const BATCH_INTERVAL: Duration = Duration::from_millis(50);
/// Changes reported by watchers are taken over after this pause.
pub const DEBOUNCE: Duration = Duration::from_millis(1500);
/// The index is built again this often (removed entries, missed events).
pub const REBUILD_EVERY: Duration = Duration::from_secs(60 * 60);
/// The first build waits this long after the start (the window comes first).
pub const FIRST_BUILD_DELAY: Duration = Duration::from_secs(3);
/// Linux: a recursive inotify watch needs one watch per folder – only up to this many.
pub const LINUX_MAX_WATCH_DIRS: u32 = 50_000;
/// More changed folders than this at once: build again instead.
pub const MAX_PENDING_DIRS: usize = 10_000;
/// Entries added below one new folder at once (under the write lock).
pub const FILL_BUDGET: usize = 20_000;
pub const MAX_ROOTS: usize = 32;
/// Rank bonus below the most recent folder (minus 10 per step back, 10 folders).
pub const RECENT_BOOST: i16 = 150;
/// Rank bonus below the folder of a tab or a favourite.
pub const PLACE_BOOST: i16 = 80;
pub const MAX_PLACES: usize = 200;
pub const MAX_EXCLUDES: usize = 64;
pub const MIN_MEMORY_MB: u32 = 8;
pub const MAX_MEMORY_MB: u32 = 2048;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Index,
    Live,
    System,
    Path,
}

/// A hit: the entry as a listing shows it plus the fields of a search hit (so all hits
/// can become a result tab, design 009), its rank and the highlighted ranges of the name.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteHit {
    #[serde(flatten)]
    pub entry: DirEntryDto,
    pub dir: String,
    pub rel_dir: String,
    pub parent_names: [String; 3],
    pub score: i32,
    pub source: Source,
    /// UTF-16 ranges `[start, end)` of the words in the name.
    pub ranges: Vec<[u32; 2]>,
}

/// The settings of the palette (from the frontend, design 043 E6).
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PaletteConfig {
    pub index: bool,
    /// Empty = the home folder. Server and archive folders are walked live only.
    pub roots: Vec<String>,
    pub excludes: Vec<String>,
    pub max_memory_mb: u32,
    pub include_hidden: bool,
    pub system_search: bool,
}

impl Default for PaletteConfig {
    fn default() -> Self {
        Self {
            index: true,
            roots: Vec::new(),
            excludes: vec!["node_modules".into(), ".git".into()],
            max_memory_mb: 256,
            include_hidden: false,
            system_search: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteRequest {
    pub text: String,
    /// Folders of the tabs, favourites, recent ones – walked live, ranked up.
    #[serde(default)]
    pub places: Vec<String>,
    /// Recently used folders, most recent first (ranked up most).
    #[serde(default)]
    pub recent: Vec<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub tz_offset_minutes: i32,
    /// For tests; the clock otherwise.
    #[serde(default)]
    pub now_ms: Option<i64>,
    /// Not the palette's query (a result tab asks again): runs beside it.
    #[serde(default)]
    pub detached: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum IndexState {
    /// Switched off in the settings.
    #[default]
    Off,
    /// Configured, the first build has not started yet.
    Waiting,
    Building,
    Ready,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub state: IndexState,
    pub entries: u64,
    pub dirs: u32,
    pub bytes: u64,
    pub max_bytes: u64,
    /// The memory limit was reached: not everything below the roots is in the index.
    pub truncated: bool,
    /// Changes below the roots are watched (not on Linux with very many folders).
    pub watching: bool,
    pub built_at_ms: Option<i64>,
    pub build_ms: u64,
    pub roots: Vec<String>,
    pub system_available: bool,
    /// Search folders and exclusions of the settings that were left out (not usable).
    pub problems: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryStats {
    /// Entries that matched in the index (may exceed the hits sent).
    pub matched: u64,
    pub sent: u32,
    /// Entries looked at (index and live walk).
    pub scanned: u64,
    pub elapsed_ms: u64,
    pub first_hit_ms: Option<u64>,
    /// The hit limit was reached.
    pub truncated: bool,
    /// The live walk ran out of time or folders.
    pub live_exhausted: bool,
    pub index: IndexState,
    pub stale: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PaletteEvent {
    Hits { id: u64, hits: Vec<PaletteHit> },
    Done { id: u64, stats: QueryStats },
}

pub type Emit = Arc<dyn Fn(PaletteEvent) + Send + Sync>;

/// A hit of the index before its check: path, rank, highlighted ranges.
type Found = (PathBuf, i32, Vec<[u32; 2]>);

/// The checked settings.
#[derive(Debug, Clone)]
struct Settings {
    raw: PaletteConfig,
    index: IndexConfig,
    /// Server and archive roots (walked live, explicitly chosen).
    explicit: Vec<String>,
    /// Roots and exclusions left out (shown in the settings).
    problems: Vec<String>,
    /// Each root and its canonical form (watcher events name the latter: `/private/tmp`).
    watch_roots: Vec<(PathBuf, PathBuf)>,
}

enum Cmd {
    Build {
        delay: Duration,
    },
    Clear,
    Dirs(Vec<PathBuf>),
    Gone(PathBuf),
    /// Hits that failed their check: remove them, look at their folders again.
    Stale(Vec<PathBuf>),
    Stop,
}

struct Inner {
    home: Option<PathBuf>,
    index: RwLock<Option<Index>>,
    status: Mutex<IndexStatus>,
    settings: Mutex<Option<Settings>>,
    tx: Mutex<Option<mpsc::Sender<Cmd>>>,
    /// The running query: its id and cancel flag.
    current: Mutex<(u64, Arc<AtomicBool>)>,
    build_cancel: Mutex<Arc<AtomicBool>>,
    next_id: AtomicU64,
    /// The buffers of an index query (one at a time, part of the memory limit).
    scratch: Mutex<index::Scratch>,
    /// A live walk runs (a folder may hang: the next query does without, review 043 #2).
    live_busy: AtomicBool,
    /// Listings of explicitly chosen server folders, for a minute (review 043 #8).
    remote_cache: live::RemoteCache,
}

#[derive(Clone)]
pub struct Hub {
    inner: Arc<Inner>,
}

static HUB: OnceLock<Hub> = OnceLock::new();

/// Creates the hub of the app (setup).
pub fn init(home: Option<PathBuf>) -> &'static Hub {
    HUB.get_or_init(|| Hub::new(home))
}

pub fn hub() -> Option<&'static Hub> {
    HUB.get()
}

/// A watcher event of a panel folder (design 012) – the index looks at it again.
pub fn notice_watch(event: &crate::watch::WatchEvent) {
    let Some(hub) = hub() else { return };
    match event {
        crate::watch::WatchEvent::Changes { dir, .. }
        | crate::watch::WatchEvent::Rescan { dir } => {
            hub.send(Cmd::Dirs(vec![PathBuf::from(dir)]));
        }
        crate::watch::WatchEvent::Gone { dir } => hub.send(Cmd::Gone(PathBuf::from(dir))),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn invalid(message: &str) -> FsError {
    FsError::new(FsErrorCode::InvalidPath, message, None)
}

impl Hub {
    pub fn new(home: Option<PathBuf>) -> Self {
        let status = IndexStatus {
            system_available: system::available(),
            ..IndexStatus::default()
        };
        Self {
            inner: Arc::new(Inner {
                home,
                index: RwLock::new(None),
                status: Mutex::new(status),
                settings: Mutex::new(None),
                tx: Mutex::new(None),
                current: Mutex::new((0, Arc::new(AtomicBool::new(false)))),
                build_cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
                next_id: AtomicU64::new(1),
                scratch: Mutex::new(index::Scratch::default()),
                live_busy: AtomicBool::new(false),
                remote_cache: live::RemoteCache::default(),
            }),
        }
    }

    fn send(&self, cmd: Cmd) {
        if let Some(tx) = self
            .inner
            .tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let _ = tx.send(cmd);
        }
    }

    pub fn status(&self) -> IndexStatus {
        self.inner
            .status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Checks and takes over the settings; the index is built again when what it
    /// walks changed (the first time after [`FIRST_BUILD_DELAY`]).
    pub fn configure(&self, raw: PaletteConfig) -> Result<IndexStatus, FsError> {
        self.configure_with_delay(raw, FIRST_BUILD_DELAY)
    }

    pub fn configure_with_delay(
        &self,
        raw: PaletteConfig,
        first_delay: Duration,
    ) -> Result<IndexStatus, FsError> {
        let settings = self.check(raw)?;
        let mut current = self
            .inner
            .settings
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let first = current.is_none();
        let changed = current.as_ref().is_none_or(|c| {
            c.raw.index != settings.raw.index
                || c.raw.roots != settings.raw.roots
                || c.raw.excludes != settings.raw.excludes
                || c.raw.max_memory_mb != settings.raw.max_memory_mb
                || c.raw.include_hidden != settings.raw.include_hidden
        });
        let enabled = settings.raw.index;
        *current = Some(settings);
        drop(current);
        self.ensure_worker();
        if changed {
            // a build that is running for the old settings stops
            self.inner
                .build_cancel
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .store(true, Ordering::Relaxed);
            if enabled {
                {
                    let mut s = self.inner.status.lock().unwrap_or_else(|e| e.into_inner());
                    if s.state == IndexState::Off {
                        s.state = IndexState::Waiting;
                    }
                }
                self.send(Cmd::Build {
                    delay: if first { first_delay } else { Duration::ZERO },
                });
            } else {
                self.send(Cmd::Clear);
            }
        }
        Ok(self.status())
    }

    /// Checks the settings. A root that is not a usable path and exclusions that would skip
    /// everything are left out and named in `problems` – the rest still works (review 043 #9).
    fn check(&self, raw: PaletteConfig) -> Result<Settings, FsError> {
        if raw.roots.len() > MAX_ROOTS {
            return Err(invalid("Too many search folders"));
        }
        if raw.excludes.len() > MAX_EXCLUDES {
            return Err(invalid("Too many exclusions"));
        }
        let mut roots = Vec::new();
        let mut explicit = Vec::new();
        let mut problems = Vec::new();
        for r in &raw.roots {
            let r = r.trim();
            if r.is_empty() {
                continue;
            }
            if crate::remote::is_remote(r) {
                match crate::remote::RemotePath::parse(r) {
                    Ok(p) => explicit.push(p.to_string()),
                    Err(_) => problems.push(r.to_string()),
                }
                continue;
            }
            let expanded = match &self.inner.home {
                Some(h) => crate::paths::expand_tilde(r, h),
                None => Ok(PathBuf::from(r)),
            };
            let Ok(p) =
                expanded.and_then(|p| crate::paths::validate_input_path(&p.to_string_lossy()))
            else {
                problems.push(r.to_string());
                continue;
            };
            if crate::archive::resolve(&p).is_some() {
                explicit.push(p.to_string_lossy().into_owned());
            } else {
                roots.push(p);
            }
        }
        if roots.is_empty() && explicit.is_empty() {
            roots.extend(self.inner.home.clone());
        }
        let joined = raw
            .excludes
            .iter()
            .map(|e| e.trim())
            .filter(|e| !e.is_empty())
            .collect::<Vec<_>>()
            .join(";");
        let excludes = match crate::search::globs_to_regex(&joined, true)
            .map(|s| crate::search::build(&s, false))
        {
            Some(Ok(re)) => Some(re),
            _ => {
                if !joined.is_empty() {
                    problems.push(joined.clone());
                }
                None
            }
        };
        let mb = raw.max_memory_mb.clamp(MIN_MEMORY_MB, MAX_MEMORY_MB);
        let watch_roots = roots
            .iter()
            .map(|r| {
                (
                    r.clone(),
                    std::fs::canonicalize(r).unwrap_or_else(|_| r.clone()),
                )
            })
            .collect();
        let index = IndexConfig {
            roots,
            excludes,
            include_hidden: raw.include_hidden,
            max_bytes: u64::from(mb) << 20,
            home: self.inner.home.clone(),
        };
        Ok(Settings {
            raw: PaletteConfig {
                max_memory_mb: mb,
                ..raw
            },
            index,
            explicit,
            problems,
            watch_roots,
        })
    }

    fn settings(&self) -> Option<Settings> {
        self.inner
            .settings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn rebuild(&self) {
        if self.settings().is_some_and(|s| s.raw.index) {
            self.inner
                .build_cancel
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .store(true, Ordering::Relaxed);
            self.send(Cmd::Build {
                delay: Duration::ZERO,
            });
        }
    }

    /// Drops the index (it is built again with the next start or "Rebuild").
    pub fn clear(&self) {
        self.inner
            .build_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .store(true, Ordering::Relaxed);
        self.send(Cmd::Clear);
    }

    /// Ends the worker (tests).
    pub fn stop(&self) {
        self.inner
            .build_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .store(true, Ordering::Relaxed);
        self.send(Cmd::Stop);
        *self.inner.tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Cancels query `id` if it is the running one (`None`: whichever runs) – a late cancel
    /// never stops a newer query (review 043 #3).
    pub fn cancel(&self, id: Option<u64>) {
        let cur = self.inner.current.lock().unwrap_or_else(|e| e.into_inner());
        if id.is_none_or(|id| id == cur.0) {
            cur.1.store(true, Ordering::Relaxed);
        }
    }

    fn ensure_worker(&self) {
        let mut tx = self.inner.tx.lock().unwrap_or_else(|e| e.into_inner());
        if tx.is_some() {
            return;
        }
        let (sender, rx) = mpsc::channel();
        *tx = Some(sender.clone());
        let hub = self.clone();
        std::thread::Builder::new()
            .name("fnf-palette-index".into())
            .spawn(move || hub.work(rx, sender))
            .ok();
    }

    // ---- the worker: builds, takes over changes, builds again from time to time ---------

    fn work(&self, rx: mpsc::Receiver<Cmd>, tx: mpsc::Sender<Cmd>) {
        let mut pending: HashSet<PathBuf> = HashSet::new();
        let mut due: Option<Instant> = None;
        let mut next_build: Option<Instant> = None;
        let mut watcher: Option<notify::RecommendedWatcher> = None;
        loop {
            let wake = [due, next_build].into_iter().flatten().min();
            let msg = match wake {
                Some(w) => rx.recv_timeout(w.saturating_duration_since(Instant::now())),
                None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            };
            match msg {
                Ok(Cmd::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Ok(Cmd::Build { delay }) => {
                    pending.clear();
                    due = None;
                    next_build = Some(Instant::now() + delay);
                    if !delay.is_zero() {
                        continue;
                    }
                    next_build = None;
                    drop(watcher.take());
                    if self.build(&tx, &mut watcher) {
                        next_build = Some(Instant::now() + REBUILD_EVERY);
                    }
                }
                Ok(Cmd::Clear) => {
                    pending.clear();
                    due = None;
                    next_build = None;
                    drop(watcher.take());
                    *self.inner.index.write().unwrap_or_else(|e| e.into_inner()) = None;
                    let mut s = self.inner.status.lock().unwrap_or_else(|e| e.into_inner());
                    let enabled = self.settings().is_some_and(|s| s.raw.index);
                    *s = IndexStatus {
                        state: if enabled {
                            IndexState::Waiting
                        } else {
                            IndexState::Off
                        },
                        system_available: s.system_available,
                        ..IndexStatus::default()
                    };
                }
                Ok(Cmd::Dirs(dirs)) => {
                    if self
                        .inner
                        .index
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                        .is_none()
                    {
                        continue;
                    }
                    pending.extend(dirs);
                    if pending.len() > MAX_PENDING_DIRS {
                        pending.clear();
                        due = None;
                        next_build = Some(Instant::now());
                    } else {
                        due = due.or(Some(Instant::now() + DEBOUNCE));
                    }
                }
                Ok(Cmd::Gone(path)) => {
                    if let Some(index) = self
                        .inner
                        .index
                        .write()
                        .unwrap_or_else(|e| e.into_inner())
                        .as_mut()
                    {
                        index.remove_path(&path);
                    }
                    self.refresh_status();
                }
                Ok(Cmd::Stale(paths)) => {
                    if let Some(index) = self
                        .inner
                        .index
                        .write()
                        .unwrap_or_else(|e| e.into_inner())
                        .as_mut()
                    {
                        for p in &paths {
                            index.remove_path(p);
                        }
                    }
                    pending.extend(
                        paths
                            .iter()
                            .filter_map(|p| p.parent().map(Path::to_path_buf)),
                    );
                    due = due.or(Some(Instant::now() + DEBOUNCE));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let now = Instant::now();
                    if next_build.is_some_and(|b| b <= now) {
                        next_build = None;
                        pending.clear();
                        due = None;
                        drop(watcher.take());
                        if self.build(&tx, &mut watcher) {
                            next_build = Some(Instant::now() + REBUILD_EVERY);
                        }
                    } else if due.is_some_and(|d| d <= now) {
                        due = None;
                        let dirs: Vec<PathBuf> = pending.drain().collect();
                        if self.take_over(&dirs) {
                            next_build = Some(Instant::now());
                        }
                    }
                }
            }
        }
    }

    /// Builds the index for the current settings; false when it was cancelled or is off.
    fn build(
        &self,
        tx: &mpsc::Sender<Cmd>,
        watcher: &mut Option<notify::RecommendedWatcher>,
    ) -> bool {
        let Some(settings) = self.settings().filter(|s| s.raw.index) else {
            return false;
        };
        let cancel = Arc::new(AtomicBool::new(false));
        *self
            .inner
            .build_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = cancel.clone();
        {
            let mut s = self.inner.status.lock().unwrap_or_else(|e| e.into_inner());
            s.state = IndexState::Building;
            s.max_bytes = settings.index.max_bytes;
            s.problems = settings.problems.clone();
            s.roots = settings
                .index
                .roots
                .iter()
                .map(|r| r.to_string_lossy().into_owned())
                .collect();
        }
        // the old index and the new one together would exceed the limit: the old one goes
        // first, queries use the live walk meanwhile (review 043 #7)
        {
            let mut guard = self.inner.index.write().unwrap_or_else(|e| e.into_inner());
            if guard
                .as_ref()
                .is_some_and(|i| i.bytes() > settings.index.max_bytes / 2)
            {
                *guard = None;
                self.inner
                    .scratch
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .release();
            }
        }
        let start = Instant::now();
        let index = Index::build(&settings.index, &cancel);
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        let watch_dirs = if cfg!(target_os = "linux") && index.dirs() <= LINUX_MAX_WATCH_DIRS {
            index.dir_paths(LINUX_MAX_WATCH_DIRS as usize)
        } else {
            Vec::new()
        };
        let too_many = cfg!(target_os = "linux") && index.dirs() > LINUX_MAX_WATCH_DIRS;
        *self.inner.index.write().unwrap_or_else(|e| e.into_inner()) = Some(index);
        *watcher = if too_many {
            None
        } else {
            self.watch(&settings, &watch_dirs, tx)
        };
        {
            let mut s = self.inner.status.lock().unwrap_or_else(|e| e.into_inner());
            s.state = IndexState::Ready;
            s.build_ms = start.elapsed().as_millis() as u64;
            s.built_at_ms = Some(now_ms());
            s.watching = watcher.is_some();
        }
        self.refresh_status();
        true
    }

    /// The watcher of the index: recursive over the roots (FSEvents, ReadDirectoryChangesW),
    /// on Linux one inotify watch per indexed folder (`dirs`) – never following links, never
    /// into excluded or other file systems (review 043 #1). Reads and opens are ignored;
    /// a change names the folder to look at again.
    fn watch(
        &self,
        settings: &Settings,
        dirs: &[PathBuf],
        tx: &mpsc::Sender<Cmd>,
    ) -> Option<notify::RecommendedWatcher> {
        use notify::{Config, EventKind, RecursiveMode, Watcher};
        let tx = Mutex::new(tx.clone());
        let filter = settings.index.clone();
        let roots = settings.watch_roots.clone();
        let mut w = notify::RecommendedWatcher::new(
            move |res: notify::Result<notify::Event>| {
                let Ok(event) = res else { return };
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                let dirs: Vec<PathBuf> = event
                    .paths
                    .iter()
                    .filter_map(|p| original_path(p, &roots))
                    .filter(|p| !touches_skipped(p, &filter))
                    .filter_map(|p| p.parent().map(Path::to_path_buf))
                    .collect();
                if !dirs.is_empty() {
                    let _ = tx
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .send(Cmd::Dirs(dirs));
                }
            },
            Config::default().with_follow_symlinks(false),
        )
        .ok()?;
        let mut any = false;
        if cfg!(target_os = "linux") {
            for d in dirs {
                any |= w.watch(d, RecursiveMode::NonRecursive).is_ok();
            }
        } else {
            for r in &settings.index.roots {
                any |= w.watch(r, RecursiveMode::Recursive).is_ok();
            }
        }
        any.then_some(w)
    }

    /// Looks at changed folders again; true when so much is removed that a new build pays.
    /// Everything is read **outside** the lock (a folder may hang, review 043 #4).
    fn take_over(&self, dirs: &[PathBuf]) -> bool {
        let Some(settings) = self.settings() else {
            return false;
        };
        let cancel = AtomicBool::new(false);
        for dir in dirs {
            // folders outside the index (other panel folders) are not read at all
            let known = {
                let guard = self.inner.index.read().unwrap_or_else(|e| e.into_inner());
                match guard.as_ref() {
                    None => return false,
                    Some(i) => i.find(dir).is_some(),
                }
            };
            if !known {
                continue;
            }
            let items = match read_items(dir, &settings.index) {
                Ok(items) => Some(items),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => continue,
            };
            let new_dirs = {
                let mut guard = self.inner.index.write().unwrap_or_else(|e| e.into_inner());
                let Some(index) = guard.as_mut() else {
                    return false;
                };
                match items {
                    None => {
                        index.remove_path(dir);
                        Vec::new()
                    }
                    Some(items) => index.apply_dir(dir, &items),
                }
            };
            for d in new_dirs {
                let (list, cut) = Index::collect(&d, &settings.index, &cancel, FILL_BUDGET);
                let mut guard = self.inner.index.write().unwrap_or_else(|e| e.into_inner());
                if let Some(index) = guard.as_mut() {
                    index.graft(&d, &list, cut);
                }
            }
        }
        self.refresh_status();
        let guard = self.inner.index.read().unwrap_or_else(|e| e.into_inner());
        guard
            .as_ref()
            .is_some_and(|i| u64::from(i.removed()) * 3 > i.len() as u64)
    }

    fn refresh_status(&self) {
        let guard = self.inner.index.read().unwrap_or_else(|e| e.into_inner());
        let mut s = self.inner.status.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(i) = guard.as_ref() {
            s.entries = i.live();
            s.dirs = i.dirs();
            s.bytes = i.bytes();
            s.truncated = i.truncated;
        }
    }

    // ---- queries ------------------------------------------------------------------------

    /// Starts a query (cancelling the running one) and returns its id; the hits come
    /// through `emit`, a `Done` event ends it (not after a cancel).
    /// A `detached` query (the result tab's "search again") neither cancels the palette's
    /// query nor is cancelled by it (review 043 #3).
    pub fn query(&self, req: PaletteRequest, emit: Emit) -> u64 {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let cancel = Arc::new(AtomicBool::new(false));
        if !req.detached {
            let mut cur = self.inner.current.lock().unwrap_or_else(|e| e.into_inner());
            cur.1.store(true, Ordering::Relaxed);
            *cur = (id, cancel.clone());
        }
        let hub = self.clone();
        let flag = cancel.clone();
        let spawned = std::thread::Builder::new()
            .name("fnf-palette-query".into())
            .spawn(move || hub.run(id, req, &flag, &*emit));
        if spawned.is_err() {
            cancel.store(true, Ordering::Relaxed);
        }
        id
    }

    fn run(
        &self,
        id: u64,
        req: PaletteRequest,
        cancel: &AtomicBool,
        emit: &(dyn Fn(PaletteEvent) + Send + Sync),
    ) {
        let start = Instant::now();
        let q = parse(
            &req.text,
            req.now_ms.unwrap_or_else(now_ms),
            req.tz_offset_minutes,
        );
        let limit = req.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize;
        let mut stats = QueryStats {
            index: self.status().state,
            ..QueryStats::default()
        };
        let mut sent = 0usize;
        let mut send = |hits: Vec<PaletteHit>, stats: &mut QueryStats| {
            if hits.is_empty() || cancel.load(Ordering::Relaxed) {
                return;
            }
            stats
                .first_hit_ms
                .get_or_insert(start.elapsed().as_millis() as u64);
            sent += hits.len();
            stats.sent = sent as u32;
            emit(PaletteEvent::Hits { id, hits });
        };
        match q.mode {
            Mode::Actions => {}
            Mode::Path => {
                let hits = self.complete(&q, limit);
                send(hits, &mut stats);
            }
            Mode::Files if !q.searches_files() => {}
            Mode::Files => self.files(&q, &req, limit, start, cancel, &mut stats, &mut send),
        }
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        stats.elapsed_ms = start.elapsed().as_millis() as u64;
        emit(PaletteEvent::Done { id, stats });
    }

    #[allow(clippy::too_many_arguments)]
    fn files(
        &self,
        q: &Query,
        req: &PaletteRequest,
        limit: usize,
        start: Instant,
        cancel: &AtomicBool,
        stats: &mut QueryStats,
        send: &mut dyn FnMut(Vec<PaletteHit>, &mut QueryStats),
    ) {
        let settings = self.settings().unwrap_or_else(|| {
            self.check(PaletteConfig {
                index: false,
                ..PaletteConfig::default()
            })
            .expect("default settings")
        });
        let home = self.inner.home.as_deref();
        let expand = |raw: &str| -> Option<PathBuf> {
            let p = match home {
                Some(h) => crate::paths::expand_tilde(raw, h).ok()?,
                None => PathBuf::from(raw),
            };
            crate::paths::validate_input_path(&p.to_string_lossy()).ok()
        };
        // recent folders first (most recent most), then the other known places
        let mut boosts: Vec<(PathBuf, i16)> = Vec::new();
        for (i, r) in req.recent.iter().take(10).enumerate() {
            if let Some(p) = expand(r) {
                boosts.push((p, RECENT_BOOST - 10 * i as i16));
            }
        }
        for p in req.places.iter().take(MAX_PLACES) {
            if let Some(p) = expand(p)
                && !boosts.iter().any(|(b, _)| *b == p)
            {
                boosts.push((p, PLACE_BOOST));
            }
        }
        let below: Vec<PathBuf> = q.in_paths.iter().filter_map(|p| expand(p)).collect();
        let mut q = q.clone();
        q.in_paths = below
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let ctx = SearchCtx {
            boosts: boosts.clone(),
            below,
        };
        let mut seen: HashSet<String> = HashSet::new();
        let mut covered: Vec<PathBuf> = Vec::new();

        // 1. the index – the best hits at once, each checked against the file system
        let found: Option<Vec<Found>> = {
            let guard = self.inner.index.read().unwrap_or_else(|e| e.into_inner());
            guard.as_ref().map(|index| {
                let mut scratch = self.inner.scratch.lock().unwrap_or_else(|e| e.into_inner());
                let r = index.search(&q, &ctx, home, limit, cancel, &mut scratch);
                stats.matched = r.matched;
                stats.scanned += r.scanned;
                if !index.truncated {
                    covered.extend(index.roots().map(Path::to_path_buf));
                }
                r.hits
                    .into_iter()
                    .map(|c| (index.path_of(c.node), c.score, c.ranges))
                    .collect()
            })
        };
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        if let Some(found) = found {
            let mut hits = Vec::with_capacity(found.len());
            let mut stale = Vec::new();
            let m = Matcher::new(&q);
            for (path, score, ranges) in found {
                match checked_hit(&path, &m) {
                    Some(entry) => {
                        seen.insert(entry.path.clone());
                        hits.push(hit_of(entry, &path, score, Source::Index, ranges));
                    }
                    None => stale.push(path),
                }
            }
            stats.stale = stale.len() as u32;
            if !stale.is_empty() {
                self.send(Cmd::Stale(stale));
            }
            stats.truncated = stats.matched > hits.len() as u64;
            send(hits, stats);
        }
        let room = |stats: &QueryStats| limit.saturating_sub(stats.sent as usize);

        // 2. the system search (optional)
        if settings.raw.system_search && room(stats) > 0 && !cancel.load(Ordering::Relaxed) {
            let roots: Vec<PathBuf> = if settings.index.roots.is_empty() {
                home.map(Path::to_path_buf).into_iter().collect()
            } else {
                settings.index.roots.clone()
            };
            if let Some(word) = q.raw_terms.iter().max_by_key(|t| t.len()) {
                let lines = system::run(word, &roots, Instant::now() + SYSTEM_BUDGET);
                let mut hits = Vec::new();
                let mut m = Matcher::new(&q);
                for line in lines {
                    if hits.len() >= room(stats) || cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Some(hit) =
                        system_hit(&line, &roots, &settings.index, &ctx, &mut m, &q, &mut seen)
                    {
                        hits.push(hit);
                    }
                }
                hits.sort_by_key(|h| std::cmp::Reverse(h.score));
                send(hits, stats);
            }
        }

        // 3. the live walk over the known places (and the roots while the index is not ready)
        if room(stats) == 0 || cancel.load(Ordering::Relaxed) {
            stats.truncated = true;
            return;
        }
        let mut places: Vec<live::Place> = boosts
            .iter()
            .map(|(p, b)| live::Place {
                path: p.to_string_lossy().into_owned(),
                depth: PLACE_DEPTH,
                boost: *b,
                explicit: false,
            })
            .collect();
        if covered.is_empty() && settings.raw.index {
            // the index is building (or truncated): its roots live, deeper
            places.extend(settings.index.roots.iter().map(|r| live::Place {
                path: r.to_string_lossy().into_owned(),
                depth: ROOT_DEPTH,
                boost: 0,
                explicit: false,
            }));
        } else if !settings.raw.index {
            places.extend(settings.index.roots.iter().map(|r| live::Place {
                path: r.to_string_lossy().into_owned(),
                depth: ROOT_DEPTH,
                boost: 0,
                explicit: false,
            }));
        }
        places.extend(settings.explicit.iter().map(|r| live::Place {
            path: r.clone(),
            depth: PLACE_DEPTH,
            boost: 0,
            explicit: true,
        }));
        // one live walk at a time: a folder that hangs blocks only one thread, the next
        // queries answer from the index (review 043 #2)
        let wait_until = Instant::now() + LIVE_WAIT;
        while self
            .inner
            .live_busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
        {
            // the walk of the previous (cancelled) query ends at its next entry – unless it
            // hangs in a folder
            if Instant::now() >= wait_until || cancel.load(Ordering::Relaxed) {
                stats.live_exhausted = true;
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        struct Busy<'a>(&'a AtomicBool);
        impl Drop for Busy<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _busy = Busy(&self.inner.live_busy);
        let budget = live::Budget {
            deadline: start + LIVE_BUDGET,
            max_dirs: LIVE_MAX_DIRS,
            remote_cache: &self.inner.remote_cache,
        };
        let mut batch: Vec<PaletteHit> = Vec::new();
        let mut last = Instant::now();
        let mut left = room(stats);
        let live_stats = live::walk(
            &q,
            &places,
            &covered,
            &settings.index,
            &budget,
            cancel,
            &mut seen,
            &mut |hit| {
                batch.push(hit);
                left = left.saturating_sub(1);
                if batch.len() >= BATCH_HITS || last.elapsed() >= BATCH_INTERVAL || left == 0 {
                    batch.sort_by_key(|h| std::cmp::Reverse(h.score));
                    send(std::mem::take(&mut batch), stats);
                    last = Instant::now();
                }
                left > 0
            },
        );
        batch.sort_by_key(|h| std::cmp::Reverse(h.score));
        send(batch, stats);
        stats.scanned += live_stats.entries;
        stats.live_exhausted = live_stats.exhausted;
        if left == 0 {
            stats.truncated = true;
        }
    }

    /// Path mode: the entries of the typed folder whose names start with (or contain) the
    /// last part. A typed server or archive path is an explicit choice.
    fn complete(&self, q: &Query, limit: usize) -> Vec<PaletteHit> {
        let Some(typed) = q.path.as_deref() else {
            return Vec::new();
        };
        let trailing = typed.ends_with('/') || typed.ends_with('\\') || typed == "~";
        let (dir, prefix): (String, String) = if crate::remote::is_remote(typed) {
            let Ok(p) = crate::remote::RemotePath::parse(typed) else {
                return Vec::new();
            };
            match (trailing, p.parent(), p.name()) {
                (false, Some(parent), Some(name)) => (parent.to_string(), name.to_string()),
                _ => (p.to_string(), String::new()),
            }
        } else {
            let expanded = match &self.inner.home {
                Some(h) => crate::paths::expand_tilde(typed, h),
                None => Ok(PathBuf::from(typed)),
            };
            let Ok(path) =
                expanded.and_then(|p| crate::paths::validate_input_path(&p.to_string_lossy()))
            else {
                return Vec::new();
            };
            match (trailing, path.parent(), path.file_name()) {
                (false, Some(parent), Some(name)) => (
                    parent.to_string_lossy().into_owned(),
                    name.to_string_lossy().into_owned(),
                ),
                _ => (path.to_string_lossy().into_owned(), String::new()),
            }
        };
        let listing = if crate::remote::is_remote(&dir) {
            crate::remote::hub().and_then(|h| h.list_directory(&dir))
        } else {
            crate::archive::list_directory_or_archive(Path::new(&dir))
        };
        let Ok(listing) = listing else {
            return Vec::new();
        };
        let want = fold(&prefix);
        let show_hidden = prefix.starts_with('.');
        let parents = crate::paths::parent_names(Path::new(&listing.path));
        let mut hits: Vec<PaletteHit> = listing
            .entries
            .into_iter()
            .filter(|e| show_hidden || !e.hidden)
            .filter_map(|e| {
                let (folded, map) = query::fold_with_map(&e.name);
                let (score, ranges) = if want.is_empty() {
                    (100, Vec::new())
                } else if folded.starts_with(&want) {
                    let end = map.get(want.len() - 1).map_or(0, |r| r.1);
                    (300, vec![[0, end]])
                } else {
                    let p = folded.find(&want)?;
                    (200, vec![[map[p].0, map[p + want.len() - 1].1]])
                };
                let bonus = if e.is_navigable_dir() { 10 } else { 0 };
                Some(PaletteHit {
                    score: score + bonus - (e.name.chars().count() as i32) / 8,
                    dir: listing.path.clone(),
                    rel_dir: String::new(),
                    parent_names: parents.clone(),
                    source: Source::Path,
                    ranges,
                    entry: e,
                })
            })
            .collect();
        hits.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.entry.name.cmp(&b.entry.name))
        });
        hits.truncate(limit);
        hits
    }
}

/// The entry at `path` as it is now (`lstat`), if it still passes the filters.
fn checked_hit(path: &Path, m: &Matcher<'_>) -> Option<DirEntryDto> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    let name = path.file_name()?.to_str()?.to_string();
    let entry = crate::listing::entry_from_metadata(name, path, &meta, false);
    let is_dir = entry.is_navigable_dir();
    m.query()
        .filters_pass(
            &fold(&entry.name),
            is_dir,
            entry.size.filter(|_| !is_dir),
            entry.modified_ms,
        )
        .then_some(entry)
}

fn hit_of(
    entry: DirEntryDto,
    path: &Path,
    score: i32,
    source: Source,
    ranges: Vec<[u32; 2]>,
) -> PaletteHit {
    let dir = path.parent().unwrap_or(path);
    PaletteHit {
        dir: dir.to_string_lossy().into_owned(),
        rel_dir: String::new(),
        parent_names: crate::paths::parent_names(dir),
        score,
        source,
        ranges,
        entry,
    }
}

/// The path as the index knows it: a watcher may name the canonical root (`/private/tmp`
/// for `/tmp` on macOS) – mapped back to the root as configured (review 043 #10).
fn original_path(p: &Path, roots: &[(PathBuf, PathBuf)]) -> Option<PathBuf> {
    roots.iter().find_map(|(orig, canon)| {
        if p.starts_with(orig) {
            Some(p.to_path_buf())
        } else {
            p.strip_prefix(canon).ok().map(|rest| orig.join(rest))
        }
    })
}

/// Whether a path below a root has a skipped part (excluded name, hidden – also by the
/// flag of the system: `~/Library`, `AppData`).
fn touches_skipped(path: &Path, config: &IndexConfig) -> bool {
    let Some((root, rel)) = config
        .roots
        .iter()
        .find_map(|r| path.strip_prefix(r).ok().map(|rel| (r, rel)))
    else {
        return true;
    };
    let mut at = root.clone();
    for c in rel.components() {
        let name = c.as_os_str().to_string_lossy();
        at.push(c);
        if config.excluded(&name) {
            return true;
        }
        if !config.include_hidden
            && (name.starts_with('.')
                || std::fs::symlink_metadata(&at)
                    .is_ok_and(|m| crate::listing::is_hidden(&name, &m)))
        {
            return true;
        }
    }
    false
}

/// A line of the system search as a hit: absolute, below a root, nothing skipped on the
/// way, existing, and a hit of the whole query.
#[allow(clippy::too_many_arguments)]
fn system_hit(
    line: &Path,
    roots: &[PathBuf],
    config: &IndexConfig,
    ctx: &SearchCtx,
    m: &mut Matcher<'_>,
    q: &Query,
    seen: &mut HashSet<String>,
) -> Option<PaletteHit> {
    if !line.is_absolute()
        || touches_skipped(
            line,
            &IndexConfig {
                roots: roots.to_vec(),
                ..config.clone()
            },
        )
    {
        return None;
    }
    let path = crate::paths::validate_input_path(line.to_str()?).ok()?;
    if path != line || seen.contains(path.to_str()?) {
        return None;
    }
    if !ctx.below.is_empty() && !ctx.below.iter().any(|b| path.starts_with(b)) {
        return None;
    }
    let parent = path.parent()?;
    let above = index::root_bits(m, parent, config.home.as_deref());
    let meta = std::fs::symlink_metadata(&path).ok()?;
    let name = path.file_name()?.to_str()?.to_string();
    if config.skips(&name, &meta) {
        return None;
    }
    let own = m.bits(&name);
    let folded = m.folded().to_string();
    let entry = crate::listing::entry_from_metadata(name, &path, &meta, false);
    let is_dir = entry.is_navigable_dir();
    if !m.is_hit(
        own,
        above,
        &folded,
        is_dir,
        entry.size.filter(|_| !is_dir),
        entry.modified_ms,
    ) {
        return None;
    }
    let depth = config
        .home
        .as_deref()
        .and_then(|h| path.strip_prefix(h).ok())
        .map_or(8, |r| r.components().count() as u32);
    let boost = ctx
        .boosts
        .iter()
        .filter(|(b, _)| path.starts_with(b))
        .map(|(_, v)| *v)
        .max()
        .unwrap_or(0);
    let (score, ranges) = query::score(q, &entry.name, depth, i32::from(boost));
    seen.insert(entry.path.clone());
    Some(hit_of(entry, &path, score, Source::System, ranges))
}

#[cfg(test)]
mod tests;
