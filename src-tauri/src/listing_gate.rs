//! One listing per hanging folder (design 029 E6).
//!
//! `read_dir` on a busy or dead drive can block for a long time and cannot be
//! cancelled. A panel that navigates there again and again would otherwise park
//! one blocking thread per attempt. While a listing of a folder has been running
//! for at least [`JOIN_AFTER`], further requests for the same folder wait for its
//! result instead of starting another one. Younger listings are not shared: a
//! change between the two requests could be missing from the shared result.

use crate::error::{FsError, FsErrorCode};
use crate::model::DirectoryListing;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::async_runtime::{Sender, channel};

pub const JOIN_AFTER: Duration = Duration::from_secs(1);

type ListingResult = Result<DirectoryListing, FsError>;

struct Flight {
    id: u64,
    started: Instant,
    waiters: Vec<Sender<ListingResult>>,
}

#[derive(Default)]
pub struct ListingGate {
    flights: Mutex<HashMap<PathBuf, Flight>>,
    next: AtomicU64,
}

enum Plan {
    Join(tauri::async_runtime::Receiver<ListingResult>),
    Own(u64),
    Alone,
}

/// The gate of the app (process-wide, like the archive cache).
pub fn global() -> &'static ListingGate {
    static GATE: std::sync::OnceLock<ListingGate> = std::sync::OnceLock::new();
    GATE.get_or_init(ListingGate::default)
}

impl ListingGate {
    /// Lists `dir` with `list` on a blocking thread – or waits for a listing of the
    /// same folder that hangs already.
    pub async fn list(
        &'static self,
        dir: PathBuf,
        list: fn(&Path) -> ListingResult,
    ) -> ListingResult {
        let plan = {
            let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
            match flights.get_mut(&dir) {
                Some(f) if f.started.elapsed() >= JOIN_AFTER => {
                    let (tx, rx) = channel(1);
                    f.waiters.push(tx);
                    Plan::Join(rx)
                }
                Some(_) => Plan::Alone,
                None => {
                    let id = self.next.fetch_add(1, Ordering::Relaxed);
                    flights.insert(
                        dir.clone(),
                        Flight {
                            id,
                            started: Instant::now(),
                            waiters: Vec::new(),
                        },
                    );
                    Plan::Own(id)
                }
            }
        };
        let failed =
            |e: String| FsError::new(FsErrorCode::Io, format!("Listing task failed: {e}"), None);
        match plan {
            Plan::Join(mut rx) => rx
                .recv()
                .await
                .unwrap_or_else(|| Err(failed("no result".into()))),
            Plan::Alone => tauri::async_runtime::spawn_blocking(move || list(&dir))
                .await
                .map_err(|e| failed(e.to_string()))?,
            Plan::Own(id) => {
                // the waiters are served from the blocking thread itself: they get the
                // result even if this future were dropped
                tauri::async_runtime::spawn_blocking(move || {
                    let result = std::panic::catch_unwind(|| list(&dir))
                        .unwrap_or_else(|_| Err(failed("panic".into())));
                    let flight = {
                        let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
                        match flights.get(&dir) {
                            Some(f) if f.id == id => flights.remove(&dir),
                            _ => None,
                        }
                    };
                    for w in flight.map(|f| f.waiters).unwrap_or_default() {
                        let _ = w.try_send(result.clone());
                    }
                    result
                })
                .await
                .map_err(|e| failed(e.to_string()))?
            }
        }
    }

    #[cfg(test)]
    fn in_flight(&self) -> usize {
        self.flights.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    static CALLS: AtomicUsize = AtomicUsize::new(0);

    fn slow(dir: &Path) -> ListingResult {
        CALLS.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(JOIN_AFTER + Duration::from_millis(500));
        crate::listing::list_directory(dir)
    }

    #[test]
    fn a_hanging_listing_is_joined_a_young_one_is_not() {
        let gate: &'static ListingGate = Box::leak(Box::default());
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), b"x").unwrap();
        let dir = tmp.path().to_path_buf();
        tauri::async_runtime::block_on(async move {
            let first = tauri::async_runtime::spawn(gate.list(dir.clone(), slow));
            // young: an own listing
            std::thread::sleep(Duration::from_millis(100));
            let young = tauri::async_runtime::spawn(gate.list(dir.clone(), slow));
            // hanging: joins the first
            std::thread::sleep(JOIN_AFTER);
            let joined = tauri::async_runtime::spawn(gate.list(dir.clone(), slow));
            let a = first.await.unwrap().unwrap();
            let b = young.await.unwrap().unwrap();
            let c = joined.await.unwrap().unwrap();
            assert_eq!(a.entries.len(), 1);
            assert_eq!(a, b);
            assert_eq!(a, c);
            assert_eq!(CALLS.load(Ordering::SeqCst), 2, "the third request joined");
            assert_eq!(gate.in_flight(), 0);
        });
    }
}
