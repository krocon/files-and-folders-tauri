//! The walker of a disk-usage scan (design 033 E4/E5): reads folders with a few
//! worker threads and adds them to the [`Tree`]. Never follows links, visits each
//! folder (device + inode) once, counts hard-linked files once (Unix), stays on the
//! allowed devices, never opens a file.

use super::tree::{NodeId, NodeKind, Scanned, Tree};
use std::collections::{HashSet, VecDeque};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, RwLock};

/// What the walker may cross and where it starts.
#[derive(Debug, Clone, Default)]
pub struct WalkPlan {
    /// Devices whose folders are scanned (empty = no check, e.g. Windows).
    pub devices: HashSet<u64>,
    /// Scan into other file systems.
    pub cross_filesystems: bool,
    /// Folders left out (macOS: `/System/Volumes/Data`, reached through the firmlinks).
    pub skip: Vec<PathBuf>,
}

/// Counters for the progress report (read by the job thread).
#[derive(Debug, Default)]
pub struct WalkProgress {
    pub entries: AtomicU64,
    pub bytes: AtomicU64,
    /// Folder read last (shown, never logged).
    pub current: Mutex<Option<PathBuf>>,
}

/// How a file system object is identified (injectable for tests).
pub trait Ident: Sync {
    /// Device of an entry (`None`: unknown – no device check).
    fn device(&self, path: &Path, meta: &Metadata) -> Option<u64>;
    /// (device, inode) of a folder or a file with more than one link; `None`: no identity.
    fn inode(&self, path: &Path, meta: &Metadata) -> Option<(u64, u64)>;
    /// Hard links of a file (1 if unknown).
    fn links(&self, meta: &Metadata) -> u64;
    /// Bytes the entry occupies on disk.
    fn allocated(&self, path: &Path, meta: &Metadata) -> u64;
}

/// The real file system.
pub struct RealIdent;

impl Ident for RealIdent {
    #[cfg(unix)]
    fn device(&self, _path: &Path, meta: &Metadata) -> Option<u64> {
        use std::os::unix::fs::MetadataExt;
        Some(meta.dev())
    }
    #[cfg(not(unix))]
    fn device(&self, _path: &Path, _meta: &Metadata) -> Option<u64> {
        None
    }
    #[cfg(unix)]
    fn inode(&self, _path: &Path, meta: &Metadata) -> Option<(u64, u64)> {
        use std::os::unix::fs::MetadataExt;
        Some((meta.dev(), meta.ino()))
    }
    #[cfg(not(unix))]
    fn inode(&self, _path: &Path, _meta: &Metadata) -> Option<(u64, u64)> {
        None
    }
    #[cfg(unix)]
    fn links(&self, meta: &Metadata) -> u64 {
        use std::os::unix::fs::MetadataExt;
        meta.nlink()
    }
    #[cfg(not(unix))]
    fn links(&self, _meta: &Metadata) -> u64 {
        1
    }
    fn allocated(&self, path: &Path, meta: &Metadata) -> u64 {
        crate::platform::disk_usage::allocated(path, meta)
    }
}

fn modified_ms(meta: &Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

struct Queue {
    dirs: VecDeque<(NodeId, PathBuf)>,
    busy: usize,
}

/// Scans the roots of `tree` (its root nodes) to the end or until `cancel`.
/// Returns false if cancelled.
pub fn walk(
    tree: &RwLock<Tree>,
    plan: &WalkPlan,
    ident: &dyn Ident,
    threads: usize,
    cancel: &AtomicBool,
    progress: &WalkProgress,
) -> bool {
    let roots: Vec<(NodeId, PathBuf)> = tree
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .roots()
        .to_vec();
    let seen: Mutex<HashSet<(u64, u64)>> = Mutex::new(HashSet::new());
    let mut start = VecDeque::new();
    for (id, path) in roots {
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_dir() => {
                if let Some(k) = ident.inode(&path, &m) {
                    seen.lock().unwrap_or_else(|e| e.into_inner()).insert(k);
                }
                write(tree).set_dir_self(id, ident.allocated(&path, &m), modified_ms(&m));
                start.push_back((id, path));
            }
            _ => write(tree).mark_unreadable(id),
        }
    }
    let queue = Mutex::new(Queue {
        dirs: start,
        busy: 0,
    });
    let ready = Condvar::new();
    let threads = threads.max(1);
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| worker(tree, plan, ident, cancel, progress, &queue, &ready, &seen));
        }
    });
    !cancel.load(Ordering::Relaxed)
}

fn write(tree: &RwLock<Tree>) -> std::sync::RwLockWriteGuard<'_, Tree> {
    tree.write().unwrap_or_else(|e| e.into_inner())
}

#[allow(clippy::too_many_arguments)]
fn worker(
    tree: &RwLock<Tree>,
    plan: &WalkPlan,
    ident: &dyn Ident,
    cancel: &AtomicBool,
    progress: &WalkProgress,
    queue: &Mutex<Queue>,
    ready: &Condvar,
    seen: &Mutex<HashSet<(u64, u64)>>,
) {
    loop {
        let job = {
            let mut q = queue.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if cancel.load(Ordering::Relaxed) {
                    q.dirs.clear();
                    ready.notify_all();
                    return;
                }
                if let Some(j) = q.dirs.pop_front() {
                    q.busy += 1;
                    break j;
                }
                if q.busy == 0 {
                    ready.notify_all();
                    return;
                }
                q = ready
                    .wait_timeout(q, std::time::Duration::from_millis(50))
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
        };
        let (dir, path) = job;
        let found = read_one(tree, plan, ident, cancel, progress, seen, dir, &path);
        let mut q = queue.lock().unwrap_or_else(|e| e.into_inner());
        q.busy -= 1;
        q.dirs.extend(found);
        ready.notify_all();
    }
}

/// Reads one folder into the tree; returns its subfolders to scan.
#[allow(clippy::too_many_arguments)]
fn read_one(
    tree: &RwLock<Tree>,
    plan: &WalkPlan,
    ident: &dyn Ident,
    cancel: &AtomicBool,
    progress: &WalkProgress,
    seen: &Mutex<HashSet<(u64, u64)>>,
    dir: NodeId,
    path: &Path,
) -> Vec<(NodeId, PathBuf)> {
    *progress.current.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.to_path_buf());
    let read = match fs::read_dir(path) {
        Ok(r) => r,
        Err(_) => {
            write(tree).mark_unreadable(dir);
            return Vec::new();
        }
    };
    let mut entries: Vec<Scanned> = Vec::new();
    // (name, path, own size) of the subfolders – their own size is added when read
    let mut subdirs: Vec<(std::ffi::OsString, PathBuf, u64, Option<i64>)> = Vec::new();
    let mut unreadable = 0u64;
    let mut bytes = 0u64;
    for item in read {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let Ok(item) = item else {
            unreadable += 1;
            continue;
        };
        let child = item.path();
        // never follows a link (lstat)
        let Ok(meta) = fs::symlink_metadata(&child) else {
            unreadable += 1;
            continue;
        };
        let name = item.file_name();
        let ft = meta.file_type();
        if ft.is_symlink() || is_reparse_point(&meta) {
            let a = ident.allocated(&child, &meta);
            bytes += a;
            entries.push(Scanned {
                name,
                kind: NodeKind::Link,
                allocated: a,
                logical: meta.len(),
                modified_ms: modified_ms(&meta),
            });
        } else if ft.is_dir() {
            if plan.skip.iter().any(|s| s == &child) {
                continue;
            }
            let foreign = !plan.devices.is_empty()
                && ident
                    .device(&child, &meta)
                    .is_some_and(|d| !plan.devices.contains(&d));
            if foreign && !plan.cross_filesystems {
                entries.push(Scanned {
                    name,
                    kind: NodeKind::Mount,
                    allocated: 0,
                    logical: 0,
                    modified_ms: modified_ms(&meta),
                });
                continue;
            }
            // bind mounts, macOS firmlinks: the same folder only once
            if let Some(k) = ident.inode(&child, &meta)
                && !seen.lock().unwrap_or_else(|e| e.into_inner()).insert(k)
            {
                continue;
            }
            let a = ident.allocated(&child, &meta);
            let m = modified_ms(&meta);
            subdirs.push((name, child, a, m));
        } else {
            // a file (or another special entry): hard links count once
            let first = if ident.links(&meta) > 1 {
                ident
                    .inode(&child, &meta)
                    .is_none_or(|k| seen.lock().unwrap_or_else(|e| e.into_inner()).insert(k))
            } else {
                true
            };
            let (a, l) = if first {
                (ident.allocated(&child, &meta), meta.len())
            } else {
                (0, 0)
            };
            bytes += a;
            entries.push(Scanned {
                name,
                kind: NodeKind::File,
                allocated: a,
                logical: l,
                modified_ms: modified_ms(&meta),
            });
        }
    }
    progress
        .entries
        .fetch_add((entries.len() + subdirs.len()) as u64, Ordering::Relaxed);
    progress.bytes.fetch_add(bytes, Ordering::Relaxed);
    let mut t = write(tree);
    let first_dir = entries.len();
    let mut all = entries;
    let mut dir_info: Vec<(PathBuf, u64, Option<i64>)> = Vec::with_capacity(subdirs.len());
    for (name, p, a, m) in subdirs {
        dir_info.push((p, a, m));
        all.push(Scanned {
            name,
            kind: NodeKind::Dir,
            allocated: 0,
            logical: 0,
            modified_ms: m,
        });
    }
    let new_ids = t.add_entries(dir, all);
    t.add_unreadable(dir, unreadable);
    let mut out = Vec::with_capacity(new_ids.len());
    for (id, index) in new_ids {
        let (p, a, m) = dir_info[index - first_dir].clone();
        t.set_dir_self(id, a, m);
        out.push((id, p));
    }
    out
}

#[cfg(windows)]
fn is_reparse_point(meta: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_meta: &Metadata) -> bool {
    false
}
