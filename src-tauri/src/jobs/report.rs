//! Throttled reporting for a running job: at most one progress event per
//! [`PROGRESS_INTERVAL`] and one "folders changed" event per [`DIRS_INTERVAL`].

use super::{ItemError, JobEvent, Progress};
use std::collections::BTreeSet;
use std::time::{Duration, Instant};

pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
pub const DIRS_INTERVAL: Duration = Duration::from_millis(500);

pub struct Reporter<'a> {
    id: String,
    emit: &'a (dyn Fn(JobEvent) + Send + Sync),
    pub progress: Progress,
    started: Instant,
    last_progress: Option<Instant>,
    changed: BTreeSet<String>,
    last_dirs: Instant,
}

impl<'a> Reporter<'a> {
    pub fn new(id: &str, emit: &'a (dyn Fn(JobEvent) + Send + Sync)) -> Self {
        Self {
            id: id.to_string(),
            emit,
            progress: Progress::default(),
            started: Instant::now(),
            last_progress: None,
            changed: BTreeSet::new(),
            last_dirs: Instant::now(),
        }
    }

    pub fn emit(&self, event: JobEvent) {
        (self.emit)(event);
    }

    /// Sends the progress if the last one is older than the interval (or `force`).
    pub fn tick(&mut self, force: bool) {
        let due = self
            .last_progress
            .is_none_or(|t| t.elapsed() >= PROGRESS_INTERVAL);
        if force || due {
            let secs = self.started.elapsed().as_secs_f64();
            self.progress.rate_bps = if secs > 0.2 {
                (self.progress.bytes_done as f64 / secs) as u64
            } else {
                0
            };
            self.last_progress = Some(Instant::now());
            (self.emit)(JobEvent::Progress {
                id: self.id.clone(),
                progress: self.progress.clone(),
            });
        }
        if !self.changed.is_empty() && (force || self.last_dirs.elapsed() >= DIRS_INTERVAL) {
            self.flush_dirs();
        }
    }

    pub fn dir_changed(&mut self, dir: String) {
        self.changed.insert(dir);
    }

    pub fn flush_dirs(&mut self) {
        if !self.changed.is_empty() {
            let dirs: Vec<String> = std::mem::take(&mut self.changed).into_iter().collect();
            (self.emit)(JobEvent::DirsChanged { dirs });
        }
        self.last_dirs = Instant::now();
    }

    pub fn item_failed(&self, error: ItemError) {
        (self.emit)(JobEvent::ItemFailed {
            id: self.id.clone(),
            error,
        });
    }
}
