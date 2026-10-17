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
use notify::{Config, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// At most this many folders at once (two panels; protection against wrong calls).
pub const MAX_WATCHED: usize = 8;
/// Interval of the polling fallback.
pub const POLL_INTERVAL: Duration = Duration::from_secs(2);

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
}

enum Msg {
    Fs(notify::Result<notify::Event>),
    Dirs(Vec<Watched>),
    Stop,
}

#[derive(Default)]
struct Watchers {
    native: Option<RecommendedWatcher>,
    poll: Option<PollWatcher>,
    /// Folder → how it is watched now.
    current: Vec<(PathBuf, WatchMode)>,
}

/// Owner of the watchers and of the debounce thread.
pub struct WatchHub {
    tx: Sender<Msg>,
    watchers: Mutex<Watchers>,
}

impl WatchHub {
    pub fn new(sink: Sink) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("fnf-watch".into())
            .spawn(move || run(rx, sink))
            .expect("watch thread");
        Self {
            tx,
            watchers: Mutex::default(),
        }
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
        let mut w = self.watchers.lock().unwrap_or_else(|e| e.into_inner());
        // unwatch what is no longer shown
        let old = std::mem::take(&mut w.current);
        let mut kept = Vec::new();
        for (dir, mode) in old {
            if wanted.contains(&dir) {
                kept.push((dir, mode));
            } else {
                unwatch(&mut w, &dir, mode);
            }
        }
        let mut statuses = Vec::new();
        let mut table = Vec::new();
        for dir in &wanted {
            let status = match kept.iter().find(|(d, _)| d == dir) {
                Some((_, mode)) => WatchStatus {
                    dir: dir.to_string_lossy().into_owned(),
                    mode: *mode,
                    reason: None,
                },
                None => self.watch(&mut w, dir, poll_network),
            };
            if status.mode != WatchMode::Off {
                table.push(Watched {
                    dir: dir.clone(),
                    aliases: aliases_of(dir),
                });
            }
            w.current.push((dir.clone(), status.mode));
            statuses.push(status);
        }
        drop(w);
        let _ = self.tx.send(Msg::Dirs(table));
        Ok(statuses)
    }

    fn watch(&self, w: &mut Watchers, dir: &Path, poll_network: bool) -> WatchStatus {
        let status = |mode, reason: Option<String>| WatchStatus {
            dir: dir.to_string_lossy().into_owned(),
            mode,
            reason,
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
            match self
                .native(w)
                .and_then(|n| n.watch(dir, RecursiveMode::NonRecursive))
            {
                Ok(()) => return status(WatchMode::Native, None),
                Err(e) => native_error = Some(e.to_string()),
            }
        }
        match self
            .poller(w)
            .and_then(|p| p.watch(dir, RecursiveMode::NonRecursive))
        {
            Ok(()) => status(
                WatchMode::Poll,
                Some(native_error.unwrap_or_else(|| "network".into())),
            ),
            Err(e) => status(WatchMode::Off, Some(e.to_string())),
        }
    }

    fn native<'a>(&self, w: &'a mut Watchers) -> notify::Result<&'a mut RecommendedWatcher> {
        if w.native.is_none() {
            let tx = self.tx.clone();
            w.native = Some(notify::recommended_watcher(move |res| {
                let _ = tx.send(Msg::Fs(res));
            })?);
        }
        Ok(w.native.as_mut().expect("just created"))
    }

    fn poller<'a>(&self, w: &'a mut Watchers) -> notify::Result<&'a mut PollWatcher> {
        if w.poll.is_none() {
            let tx = self.tx.clone();
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
}

impl Drop for WatchHub {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
    }
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

/// The debounce thread: raw events → batches → [`WatchEvent`]s.
fn run(rx: Receiver<Msg>, sink: Sink) {
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
            Ok(Msg::Fs(res)) => feed(&mut batcher, &watched, res, Instant::now()),
            Err(RecvTimeoutError::Timeout) => {}
        }
        for flush in batcher.due(Instant::now()) {
            if let Some(event) = resolve(flush) {
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
    for path in &event.paths {
        for w in watched {
            if let Some(touch) = classify(&w.aliases, path) {
                batcher.touch(&w.dir, touch, now);
            }
        }
    }
}

/// Turns a due batch into the event for the frontend (stat'ing the names now).
fn resolve(flush: Flush) -> Option<WatchEvent> {
    match flush {
        Flush::Rescan { dir } => Some(WatchEvent::Rescan {
            dir: dir.to_string_lossy().into_owned(),
        }),
        Flush::SelfChanged { dir } => {
            let d = dir.to_string_lossy().into_owned();
            Some(if dir.is_dir() {
                WatchEvent::Rescan { dir: d }
            } else {
                WatchEvent::Gone { dir: d }
            })
        }
        Flush::Changes { dir, names } => {
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
    }
}

#[cfg(test)]
mod tests;
