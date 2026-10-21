//! Job `diskUsage` (design 033): scans folders (or a volume, or a part of an
//! earlier scan again) into a tree kept in the [`DiskUsageHub`]. The scan id is
//! the job id. Progress: entries and allocated bytes so far, the current folder.

use super::{Control, JobEvent, JobState, Progress, Summary};
use crate::disk_usage::walk::{self, RealIdent, WalkProgress};
use crate::disk_usage::{
    self, DiskUsageHub, DiskUsageOptions, DiskUsageSummary, NodeKind, Rescan, Scan, TOP, Tree,
    VolumeSpace,
};
use crate::error::{FsError, FsErrorCode};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

/// Interval of the progress events.
pub const REPORT_EVERY: Duration = Duration::from_millis(200);

fn failed(error: FsError) -> (JobState, Summary) {
    (
        JobState::Failed,
        Summary {
            error: Some(error),
            ..Summary::default()
        },
    )
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    roots: &[String],
    volume: bool,
    rescan: Option<&Rescan>,
    options: &DiskUsageOptions,
    hub: &DiskUsageHub,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let started = Instant::now();
    // what to scan into which tree
    let (scan, tree_roots, graft_into) = match rescan {
        Some(r) => {
            let scan = match hub.get(&r.scan_id) {
                Ok(s) => s,
                Err(e) => return failed(e),
            };
            let path = {
                let t = scan.read();
                match (t.kind(r.node_id), t.path_of(r.node_id)) {
                    (Some(NodeKind::Dir), Some(p)) => p,
                    _ => {
                        return failed(FsError::new(
                            FsErrorCode::ScanNotFound,
                            "The folder is no longer part of the scan",
                            None,
                        ));
                    }
                }
            };
            // never next to the first walk: it still adds to the nodes a graft replaces (review 033 #3)
            if scan.running.load(Ordering::SeqCst) || scan.busy.swap(true, Ordering::SeqCst) {
                return failed(FsError::new(
                    FsErrorCode::ScanBusy,
                    "This scan is being updated",
                    None,
                ));
            }
            (scan, vec![path], Some(r.node_id))
        }
        None => {
            let mut paths: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
            if volume && let Some(first) = paths.first() {
                paths = vec![crate::platform::disk_usage::volume_root(first)];
            }
            let paths = super::drop_nested(&paths);
            let tree = Tree::new(&paths, options.size_mode);
            let scan = Arc::new(Scan::new(tree, volume));
            hub.insert(id, scan.clone());
            (scan, paths, None)
        }
    };
    let plan = disk_usage::plan_for(&tree_roots, options.cross_filesystems);
    // a rescan fills a tree of its own and grafts it when done
    let own =
        graft_into.map(|_| Arc::new(Scan::new(Tree::new(&tree_roots, scan.read().mode()), false)));
    let target: &Scan = own.as_deref().unwrap_or(&scan);
    let progress = WalkProgress::default();
    let report = |progress: &WalkProgress| {
        let current = progress
            .current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
        emit(JobEvent::Progress {
            id: id.to_string(),
            progress: Progress {
                items_done: progress.entries.load(Ordering::Relaxed),
                bytes_done: progress.bytes.load(Ordering::Relaxed),
                current,
                ..Progress::default()
            },
        });
    };
    let done = std::sync::atomic::AtomicBool::new(false);
    let finished = std::thread::scope(|s| {
        let walker = s.spawn(|| {
            let r = walk::walk(
                &target.tree,
                &plan,
                &RealIdent,
                disk_usage::default_threads(),
                control.cancel_flag(),
                &progress,
            );
            done.store(true, Ordering::SeqCst);
            r
        });
        let mut last = Instant::now();
        while !done.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(20));
            if last.elapsed() >= REPORT_EVERY {
                report(&progress);
                last = Instant::now();
            }
        }
        walker.join().unwrap_or(false)
    });
    report(&progress);
    target.write().sort_children();
    let mut too_large = false;
    match graft_into {
        Some(node) => {
            if finished {
                let fresh = target.read();
                too_large = !scan.write().graft(node, &fresh);
            }
            scan.busy.store(false, Ordering::SeqCst);
        }
        None => {
            scan.running.store(false, Ordering::SeqCst);
            scan.complete.store(finished, Ordering::SeqCst);
            if volume
                && let Some(root) = tree_roots.first()
                && let Some((total, free)) = crate::platform::disk_usage::space(root)
            {
                *scan.volume.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(VolumeSpace { total, free });
            }
        }
    }
    let (unreadable, simplified, bytes) = {
        let t = target.read();
        let totals = t.totals(TOP).unwrap_or_default();
        (totals.unreadable, t.simplified, totals.allocated)
    };
    let entries = progress.entries.load(Ordering::Relaxed);
    let summary = Summary {
        items_done: entries,
        bytes_done: bytes,
        disk_usage: Some(DiskUsageSummary {
            complete: finished,
            entries,
            unreadable,
            simplified,
            elapsed_ms: started.elapsed().as_millis() as u64,
        }),
        ..Summary::default()
    };
    if too_large {
        return failed(FsError::new(
            FsErrorCode::TooMany,
            "The scan has grown too large – scan the folder again as a whole",
            None,
        ));
    }
    let state = if finished {
        JobState::Done
    } else {
        JobState::Cancelled
    };
    (state, summary)
}
