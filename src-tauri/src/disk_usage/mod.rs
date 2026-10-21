//! Disk usage (design 033): a scan of one or more folders (or a whole volume)
//! into a tree kept here; the frontend asks for the levels it shows, deletes
//! through the normal `delete` job and then prunes what is gone.
//! Keep the DTOs in sync with `src/app/core/diskusage/disk-usage.models.ts`.

#[cfg(test)]
mod tests;
pub mod tree;
pub mod walk;

use crate::error::{FsError, FsErrorCode};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
pub use tree::{Crumb, NodeId, NodeKind, SizeMode, TOP, Tree, UsageFile, UsageNode};

/// Scans kept at the same time (least recently used goes first; running ones stay).
pub const MAX_SCANS: usize = 3;
/// Roots of one scan.
pub const MAX_ROOTS: usize = 64;
/// Levels of one view.
pub const MAX_DEPTH: u32 = 6;
/// Children per level of one view.
pub const MAX_CHILDREN: usize = 5000;
/// Files of "largest files".
pub const MAX_LARGEST: usize = 500;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageOptions {
    /// Scan into other file systems (default: stay on the root's).
    #[serde(default)]
    pub cross_filesystems: bool,
    #[serde(default)]
    pub size_mode: SizeMode,
}

/// Scan a folder of an existing scan again and replace its content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rescan {
    pub scan_id: String,
    pub node_id: NodeId,
}

/// Space of the scanned volume (volume scans only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeSpace {
    pub total: u64,
    pub free: u64,
}

/// End of a scan (in `Summary.diskUsage`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageSummary {
    pub complete: bool,
    pub entries: u64,
    pub unreadable: u64,
    pub simplified: bool,
    pub elapsed_ms: u64,
}

/// What `disk_usage_view` returns.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageView {
    pub node: UsageNode,
    pub crumbs: Vec<Crumb>,
    /// The top node is the virtual root of several roots.
    pub virtual_top: bool,
    pub running: bool,
    pub complete: bool,
    pub simplified: bool,
    /// When the scan (or the last rescan) started.
    pub scanned_at_ms: i64,
    pub version: u64,
    pub size_mode: SizeMode,
    pub volume: Option<VolumeSpace>,
    /// Allocated bytes of the whole scan (for "not counted" of a volume).
    pub scanned_allocated: u64,
}

/// One scan: its tree and state.
#[derive(Debug)]
pub struct Scan {
    pub tree: RwLock<Tree>,
    pub running: AtomicBool,
    pub complete: AtomicBool,
    /// A rescan of a part runs.
    pub busy: AtomicBool,
    pub scanned_at_ms: AtomicI64,
    pub volume: Mutex<Option<VolumeSpace>>,
    pub whole_volume: bool,
}

impl Scan {
    pub fn new(tree: Tree, whole_volume: bool) -> Self {
        Scan {
            tree: RwLock::new(tree),
            running: AtomicBool::new(true),
            complete: AtomicBool::new(false),
            busy: AtomicBool::new(false),
            scanned_at_ms: AtomicI64::new(now_ms()),
            volume: Mutex::new(None),
            whole_volume,
        }
    }

    pub fn read(&self) -> std::sync::RwLockReadGuard<'_, Tree> {
        self.tree.read().unwrap_or_else(|e| e.into_inner())
    }

    pub fn write(&self) -> std::sync::RwLockWriteGuard<'_, Tree> {
        self.tree.write().unwrap_or_else(|e| e.into_inner())
    }

    /// The view of `node` (`None` = the top node).
    pub fn view(
        &self,
        node: Option<NodeId>,
        depth: u32,
        min_fraction: f64,
        limit: usize,
    ) -> Result<DiskUsageView, FsError> {
        let t = self.read();
        let id = node.unwrap_or(TOP);
        let depth = depth.clamp(1, MAX_DEPTH);
        let limit = limit.clamp(1, MAX_CHILDREN);
        let node = t
            .view(id, depth, min_fraction, limit)
            .ok_or_else(not_found)?;
        Ok(DiskUsageView {
            node,
            crumbs: t.crumbs(id),
            virtual_top: t.is_virtual(TOP),
            running: self.running.load(Ordering::SeqCst) || self.busy.load(Ordering::SeqCst),
            complete: self.complete.load(Ordering::SeqCst),
            simplified: t.simplified,
            scanned_at_ms: self.scanned_at_ms.load(Ordering::SeqCst),
            version: t.version,
            size_mode: t.mode(),
            volume: *self.volume.lock().unwrap_or_else(|e| e.into_inner()),
            scanned_allocated: t.totals(TOP).map(|x| x.allocated).unwrap_or(0),
        })
    }

    /// Removes the nodes of `paths` that no longer exist; returns the paths that went.
    pub fn prune(&self, paths: &[PathBuf]) -> Vec<PathBuf> {
        // check the file system before taking the lock
        let gone: Vec<&PathBuf> = paths
            .iter()
            .filter(|p| {
                matches!(std::fs::symlink_metadata(p), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
            })
            .collect();
        let mut t = self.write();
        let mut out = Vec::new();
        for p in gone {
            if let Some(id) = t.locate(p)
                && t.remove(id)
            {
                out.push(p.clone());
            }
        }
        out
    }
}

fn not_found() -> FsError {
    FsError::new(
        FsErrorCode::ScanNotFound,
        "The scan is no longer available",
        None,
    )
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// All scans by job id (Tauri state through the `JobManager`).
#[derive(Debug, Default)]
pub struct DiskUsageHub {
    /// Most recently used last.
    scans: Mutex<Vec<(String, Arc<Scan>)>>,
}

impl DiskUsageHub {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<(String, Arc<Scan>)>> {
        self.scans.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Adds a scan; drops the least recently used finished ones beyond [`MAX_SCANS`].
    pub fn insert(&self, id: &str, scan: Arc<Scan>) {
        let mut s = self.lock();
        s.retain(|(i, _)| i != id);
        s.push((id.to_string(), scan));
        while s.len() > MAX_SCANS {
            let Some(pos) = s.iter().position(|(_, sc)| {
                !sc.running.load(Ordering::SeqCst) && !sc.busy.load(Ordering::SeqCst)
            }) else {
                break;
            };
            if pos == s.len() - 1 {
                break; // never the new one
            }
            s.remove(pos);
        }
    }

    pub fn get(&self, id: &str) -> Result<Arc<Scan>, FsError> {
        let mut s = self.lock();
        let pos = s.iter().position(|(i, _)| i == id).ok_or_else(not_found)?;
        let entry = s.remove(pos);
        let scan = entry.1.clone();
        s.push(entry);
        Ok(scan)
    }

    pub fn release(&self, id: &str) -> bool {
        let mut s = self.lock();
        let before = s.len();
        s.retain(|(i, _)| i != id);
        s.len() != before
    }

    pub fn ids(&self) -> Vec<String> {
        self.lock().iter().map(|(i, _)| i.clone()).collect()
    }
}

/// Worker threads of a scan: reading folders waits on I/O, so twice the cores,
/// 4–8 (measured in design 033 E4: 2 cores, warm cache, /usr – 1 thread 0.41 s per
/// 2 threads … 8 threads 0.26 s).
pub fn default_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get() * 2)
        .unwrap_or(4)
        .clamp(4, 8)
}

/// The walk plan for `roots`: their devices, macOS firmlinks.
pub fn plan_for(roots: &[PathBuf], cross_filesystems: bool) -> walk::WalkPlan {
    let mut plan = walk::WalkPlan {
        cross_filesystems,
        ..walk::WalkPlan::default()
    };
    let ident = walk::RealIdent;
    for r in roots {
        if let Ok(m) = std::fs::symlink_metadata(r)
            && let Some(d) = walk::Ident::device(&ident, r, &m)
        {
            plan.devices.insert(d);
        }
        if let Some((dev, skip)) = crate::platform::disk_usage::firmlink_plan(r) {
            plan.devices.insert(dev);
            plan.skip.push(skip);
        }
    }
    plan
}

/// Checks a root (exists, is a folder, no archive path).
pub fn check_root(path: &Path) -> Result<(), FsError> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => Ok(()),
        Ok(_) => Err(FsError::new(
            FsErrorCode::NotADirectory,
            "Not a folder",
            Some(path),
        )),
        Err(e) => Err(FsError::from_io(&e, path)),
    }
}
