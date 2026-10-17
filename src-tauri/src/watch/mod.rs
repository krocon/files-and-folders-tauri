//! Watching the folders shown in the panels (design 012 E1–E3).
//!
//! One native watcher (`notify`: inotify / FSEvents / ReadDirectoryChangesW)
//! for all watched folders, non-recursive; a `PollWatcher` when the native one
//! fails (or for network folders, if asked). A single thread debounces the raw
//! events ([`batch`]) and turns them into [`WatchEvent`]s: re-stat'ed entries,
//! a reload, or "folder gone".

pub mod batch;
pub mod netfs;

use crate::error::{FsError, FsErrorCode};
use crate::listing::stat_entry;
use crate::model::DirEntryDto;
use batch::{Batcher, Flush, Touch, classify};
use notify::event::ModifyKind;
use notify::{Config, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// At most this many folders at once (two panels; protection against wrong calls).
pub const MAX_WATCHED: usize = 8;
/// Interval of the polling fallback.
pub const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Folders with more entries are not polled (every poll stats all of them; review 012 #7).
pub const MAX_POLLED_ENTRIES: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchMode {
    Native,
    Poll,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    pub dir: String,
    pub mode: WatchMode,
    /// `network`, or the watcher error.
    pub reason: Option<String>,
    /// The folder's mtime once it is watched: the frontend reloads if it is
    /// newer than its listing (review 012 #6). `None` when off.
    pub modified_ms: Option<i64>,
}

/// Sent to the frontend. Keep in sync with `src/app/core/watch/watch.models.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WatchEvent {
    /// Entries that exist now (new or changed) and paths that are gone.
    Changes {
        dir: String,
        upserted: Vec<DirEntryDto>,
        removed: Vec<String>,
    },
    /// Too many changes or lost events: reload the folder.
    Rescan { dir: String },
    /// The folder itself was deleted or renamed.
    Gone { dir: String },
}

pub type Sink = Arc<dyn Fn(WatchEvent) + Send + Sync>;

/// A watched folder as the debounce thread knows it.
#[derive(Debug, Clone)]
struct Watched {
    dir: PathBuf,
    /// The folder as events may name it (resolved symlinks, `/private` on macOS).
    aliases: Vec<PathBuf>,
    /// Which folder (inode) is watched – `None` where unknown (Windows).
    identity: Option<(u64, u64)>,
}

impl Watched {
    fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
            aliases: aliases_of(dir),
            identity: identity_of(dir),
        }
    }
}

enum Msg {
    Fs(notify::Result<notify::Event>),
    Dirs(Vec<Watched>),
    /// Reload this folder (events were missed while it was paused).
    Rescan(PathBuf),
    Stop,
}

#[derive(Default)]
struct Watchers {
    native: Option<RecommendedWatcher>,
    poll: Option<PollWatcher>,
    /// Folder → how it is watched now.
    current: Vec<(PathBuf, WatchMode)>,
    /// Folders unwatched while a job moves/deletes them or an ancestor (count of jobs).
    paused: HashMap<PathBuf, usize>,
    poll_network: bool,
}

impl Watchers {
    /// The table of the debounce thread: watched, not paused folders.
    fn table(&self) -> Vec<Watched> {
        self.current
            .iter()
            .filter(|(d, m)| *m != WatchMode::Off && !self.paused.contains_key(d))
            .map(|(d, _)| Watched::new(d))
            .collect()
    }
}

/// Owner of the watchers and of the debounce thread.
pub struct WatchHub {
    tx: Sender<Msg>,
    watchers: Arc<Mutex<Watchers>>,
    sink: Sink,
}

impl WatchHub {
    pub fn new(sink: Sink) -> Self {
        let (tx, rx) = mpsc::channel();
        let watchers: Arc<Mutex<Watchers>> = Arc::default();
        let (thread_tx, thread_watchers, thread_sink) =
            (tx.clone(), watchers.clone(), sink.clone());
        std::thread::Builder::new()
            .name("fnf-watch".into())
            .spawn(move || run(rx, thread_tx, thread_watchers, thread_sink))
            .expect("watch thread");
        Self { tx, watchers, sink }
    }

    fn lock(&self) -> MutexGuard<'_, Watchers> {
        self.watchers.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Replaces the set of watched folders; returns how each one is watched.
    pub fn set_dirs(
        &self,
        dirs: &[PathBuf],
        poll_network: bool,
    ) -> Result<Vec<WatchStatus>, FsError> {
        if dirs.len() > MAX_WATCHED {
            return Err(FsError::new(
                FsErrorCode::TooMany,
                format!("At most {MAX_WATCHED} folders can be watched"),
                None,
            ));
        }
        let mut wanted: Vec<PathBuf> = Vec::new();
        for d in dirs {
            if !wanted.contains(d) {
                wanted.push(d.clone());
            }
        }
        let mut w = self.lock();
        w.poll_network = poll_network;
        // unwatch what is no longer shown
        let old = std::mem::take(&mut w.current);
        let mut kept = Vec::new();
        for (dir, mode) in old {
            if wanted.contains(&dir) {
                kept.push((dir, mode));
            } else if !w.paused.contains_key(&dir) {
                unwatch(&mut w, &dir, mode);
            }
        }
        let mut statuses = Vec::new();
        for dir in &wanted {
            let status = match kept.iter().find(|(d, _)| d == dir) {
                Some((_, mode)) => WatchStatus {
                    dir: dir.to_string_lossy().into_owned(),
                    mode: *mode,
                    reason: None,
                    modified_ms: None,
                },
                None if w.paused.contains_key(dir) => WatchStatus {
                    dir: dir.to_string_lossy().into_owned(),
                    mode: WatchMode::Native,
                    reason: None,
                    modified_ms: None,
                },
                None => watch_dir(&self.tx, &mut w, dir, poll_network),
            };
            w.current.push((dir.clone(), status.mode));
            let mut status = status;
            if status.mode != WatchMode::Off {
                status.modified_ms = mtime_ms(dir);
            }
            statuses.push(status);
        }
        // under the lock: the thread sees the tables in the order of the calls (review 012 #1)
        let _ = self.tx.send(Msg::Dirs(w.table()));
        Ok(statuses)
    }

    /// Unwatches the watched folders at or below `paths` while a job moves,
    /// renames or deletes them (Windows keeps a watched folder and its parents
    /// from being renamed; review 012 #3). Returns the paused folders for [`Self::resume`].
    pub fn pause_under(&self, paths: &[PathBuf]) -> Vec<PathBuf> {
        let mut w = self.lock();
        let hit: Vec<(PathBuf, WatchMode)> = w
            .current
            .iter()
            .filter(|(d, m)| *m != WatchMode::Off && paths.iter().any(|p| d.starts_with(p)))
            .cloned()
            .collect();
        let mut paused = Vec::new();
        for (dir, mode) in hit {
            let count = w.paused.entry(dir.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                unwatch(&mut w, &dir, mode);
            }
            paused.push(dir);
        }
        if !paused.is_empty() {
            let _ = self.tx.send(Msg::Dirs(w.table()));
        }
        paused
    }

    /// Watches paused folders again (once no job pauses them any more) and
    /// reloads them – or reports them gone.
    pub fn resume(&self, dirs: &[PathBuf]) {
        let mut w = self.lock();
        let mut rescan = Vec::new();
        let mut gone = Vec::new();
        for dir in dirs {
            let Some(count) = w.paused.get_mut(dir) else {
                continue;
            };
            *count -= 1;
            if *count > 0 {
                continue;
            }
            w.paused.remove(dir);
            let Some(i) = w.current.iter().position(|(d, _)| d == dir) else {
                continue; // no longer shown
            };
            if !dir.is_dir() {
                w.current[i].1 = WatchMode::Off;
                gone.push(dir.clone());
                continue;
            }
            let poll_network = w.poll_network;
            let status = watch_dir(&self.tx, &mut w, dir, poll_network);
            w.current[i].1 = status.mode;
            rescan.push(dir.clone());
        }
        let _ = self.tx.send(Msg::Dirs(w.table()));
        for dir in rescan {
            let _ = self.tx.send(Msg::Rescan(dir));
        }
        drop(w);
        for dir in gone {
            (self.sink)(WatchEvent::Gone {
                dir: dir.to_string_lossy().into_owned(),
            });
        }
    }
}

impl Drop for WatchHub {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
    }
}

fn watch_dir(tx: &Sender<Msg>, w: &mut Watchers, dir: &Path, poll_network: bool) -> WatchStatus {
    let status = |mode, reason: Option<String>| WatchStatus {
        dir: dir.to_string_lossy().into_owned(),
        mode,
        reason,
        modified_ms: None,
    };
    if !dir.is_dir() {
        return status(WatchMode::Off, Some("not a folder".into()));
    }
    let network = netfs::is_network(dir);
    if network && !poll_network {
        return status(WatchMode::Off, Some("network".into()));
    }
    let mut native_error = None;
    if !network {
        match native(tx, w).and_then(|n| n.watch(dir, RecursiveMode::NonRecursive)) {
            Ok(()) => return status(WatchMode::Native, None),
            Err(e) => native_error = Some(e.to_string()),
        }
    }
    if let Some(reason) = poll_limit_reason(dir, MAX_POLLED_ENTRIES) {
        return status(WatchMode::Off, Some(reason));
    }
    match poller(tx, w).and_then(|p| p.watch(dir, RecursiveMode::NonRecursive)) {
        Ok(()) => status(
            WatchMode::Poll,
            Some(native_error.unwrap_or_else(|| "network".into())),
        ),
        Err(e) => status(WatchMode::Off, Some(e.to_string())),
    }
}

/// Why a folder is not polled: too many entries, or it cannot be read.
pub fn poll_limit_reason(dir: &Path, limit: usize) -> Option<String> {
    match std::fs::read_dir(dir) {
        Ok(entries) => (entries.take(limit + 1).count() > limit)
            .then(|| "too many entries to poll".to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            Some("permission denied".into())
        }
        Err(e) => Some(e.to_string()),
    }
}

fn native<'a>(tx: &Sender<Msg>, w: &'a mut Watchers) -> notify::Result<&'a mut RecommendedWatcher> {
    if w.native.is_none() {
        let tx = tx.clone();
        w.native = Some(notify::recommended_watcher(move |res| {
            let _ = tx.send(Msg::Fs(res));
        })?);
    }
    Ok(w.native.as_mut().expect("just created"))
}

fn poller<'a>(tx: &Sender<Msg>, w: &'a mut Watchers) -> notify::Result<&'a mut PollWatcher> {
    if w.poll.is_none() {
        let tx = tx.clone();
        let config = Config::default().with_poll_interval(POLL_INTERVAL);
        w.poll = Some(PollWatcher::new(
            move |res| {
                let _ = tx.send(Msg::Fs(res));
            },
            config,
        )?);
    }
    Ok(w.poll.as_mut().expect("just created"))
}

fn unwatch(w: &mut Watchers, dir: &Path, mode: WatchMode) {
    let _ = match mode {
        WatchMode::Native => w.native.as_mut().map(|n| n.unwatch(dir)),
        WatchMode::Poll => w.poll.as_mut().map(|p| p.unwatch(dir)),
        WatchMode::Off => None,
    };
}

/// The folder and its resolved form (events name real paths on some systems).
/// Only used to match events, never for navigation.
fn aliases_of(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![dir.to_path_buf()];
    if let Ok(real) = std::fs::canonicalize(dir)
        && real != dir
    {
        out.push(real);
    }
    out
}

fn mtime_ms(dir: &Path) -> Option<i64> {
    let modified = std::fs::metadata(dir).ok()?.modified().ok()?;
    let ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis();
    i64::try_from(ms).ok()
}

/// Device and inode of a folder: tells "same folder, attributes changed" from
/// "deleted and created again" (inotify keeps watching the old inode).
#[cfg(unix)]
fn identity_of(dir: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(dir).ok().map(|m| (m.dev(), m.ino()))
}

#[cfg(not(unix))]
fn identity_of(_dir: &Path) -> Option<(u64, u64)> {
    None
}

/// The debounce thread: raw events → batches → [`WatchEvent`]s.
fn run(rx: Receiver<Msg>, tx: Sender<Msg>, watchers: Arc<Mutex<Watchers>>, sink: Sink) {
    let mut batcher = Batcher::default();
    let mut watched: Vec<Watched> = Vec::new();
    loop {
        let timeout = batcher
            .next_deadline()
            .map(|at| at.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(3600));
        match rx.recv_timeout(timeout) {
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Ok(Msg::Dirs(dirs)) => {
                batcher.set_dirs(&dirs.iter().map(|w| w.dir.clone()).collect::<Vec<_>>());
                watched = dirs;
            }
            Ok(Msg::Rescan(dir)) => batcher.touch(&dir, Touch::Rescan, Instant::now()),
            Ok(Msg::Fs(res)) => feed(&mut batcher, &watched, res, Instant::now()),
            Err(RecvTimeoutError::Timeout) => {}
        }
        for flush in batcher.due(Instant::now()) {
            if let Some(event) = resolve(flush, &mut watched, &tx, &watchers) {
                sink(event);
            }
        }
    }
}

fn feed(
    batcher: &mut Batcher,
    watched: &[Watched],
    res: notify::Result<notify::Event>,
    now: Instant,
) {
    let event = match res {
        Ok(event) => event,
        Err(err) => {
            // lost events: reload the folders it names, or all of them
            if err.paths.is_empty() {
                batcher.touch_all(now);
            }
            for p in &err.paths {
                for w in watched
                    .iter()
                    .filter(|w| w.aliases.iter().any(|a| p.starts_with(a)))
                {
                    batcher.touch(&w.dir, Touch::Rescan, now);
                }
            }
            return;
        }
    };
    if event.need_rescan() {
        batcher.touch_all(now);
        return;
    }
    // reading a file (our own preview, other programs) changes nothing that is shown
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    let removes = matches!(
        event.kind,
        EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    );
    for path in &event.paths {
        for w in watched {
            if let Some(mut touch) = classify(&w.aliases, path) {
                if touch == Touch::SelfChanged && removes {
                    touch = Touch::SelfRemoved;
                }
                batcher.touch(&w.dir, touch, now);
            }
        }
    }
}

/// Watches a folder again that was replaced (deleted and created anew) – the
/// old watch hangs on the old inode (review 012 #2).
fn rewatch(tx: &Sender<Msg>, watchers: &Mutex<Watchers>, dir: &Path) {
    let mut w = watchers.lock().unwrap_or_else(|e| e.into_inner());
    if w.paused.contains_key(dir) {
        return;
    }
    let Some(i) = w.current.iter().position(|(d, _)| d == dir) else {
        return;
    };
    let mode = w.current[i].1;
    unwatch(&mut w, dir, mode);
    let poll_network = w.poll_network;
    let status = watch_dir(tx, &mut w, dir, poll_network);
    w.current[i].1 = status.mode;
}

/// Turns a due batch into the event for the frontend (stat'ing the names now).
fn resolve(
    flush: Flush,
    watched: &mut [Watched],
    tx: &Sender<Msg>,
    watchers: &Mutex<Watchers>,
) -> Option<WatchEvent> {
    match flush {
        Flush::Rescan { dir } => Some(WatchEvent::Rescan {
            dir: dir.to_string_lossy().into_owned(),
        }),
        Flush::SelfChanged {
            dir,
            names,
            rescan,
            removed,
        } => {
            let d = dir.to_string_lossy().into_owned();
            if !dir.is_dir() {
                return Some(WatchEvent::Gone { dir: d });
            }
            let now = identity_of(&dir);
            let entry = watched.iter_mut().find(|w| w.dir == dir);
            let same = !removed
                && match &entry {
                    Some(w) => now.is_some() && w.identity == now,
                    None => true,
                };
            if !same {
                rewatch(tx, watchers, &dir);
                if let Some(w) = entry {
                    *w = Watched::new(&dir);
                }
                return Some(WatchEvent::Rescan { dir: d });
            }
            // the same folder, only its attributes/mtime changed (polling reports that)
            if rescan {
                return Some(WatchEvent::Rescan { dir: d });
            }
            changes(&dir, names)
        }
        Flush::Changes { dir, names } => changes(&dir, names),
    }
}

fn changes(dir: &Path, names: Vec<std::ffi::OsString>) -> Option<WatchEvent> {
    let mut upserted = Vec::new();
    let mut removed = Vec::new();
    for name in names {
        let path = dir.join(&name);
        match stat_entry(&path) {
            Some(entry) => upserted.push(entry),
            None => removed.push(path.to_string_lossy().into_owned()),
        }
    }
    if upserted.is_empty() && removed.is_empty() {
        return None;
    }
    Some(WatchEvent::Changes {
        dir: dir.to_string_lossy().into_owned(),
        upserted,
        removed,
    })
}

#[cfg(test)]
mod tests;
