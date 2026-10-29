//! Recursive folder size (design 003 E7). Never follows symbolic links (no
//! cycles, no counting outside the tree); unreadable subfolders are counted and
//! skipped; can be cancelled; reports progress through a callback.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSize {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    /// Subfolders (or entries) that could not be read.
    pub unreadable: u64,
    pub cancelled: bool,
}

/// Walks `root` iteratively (no recursion depth limit). `progress` is called at
/// most every `interval`.
pub fn dir_size(
    root: &Path,
    cancel: &AtomicBool,
    interval: Duration,
    mut progress: impl FnMut(&DirSize),
) -> DirSize {
    let mut total = DirSize::default();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    let mut last = Instant::now();
    let root_dev = device_of(root);
    while let Some(dir) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            total.cancelled = true;
            return total;
        }
        let Ok(read) = fs::read_dir(&dir) else {
            total.unreadable += 1;
            continue;
        };
        for item in read {
            if cancel.load(Ordering::Relaxed) {
                total.cancelled = true;
                return total;
            }
            let Ok(item) = item else {
                total.unreadable += 1;
                continue;
            };
            match item.file_type() {
                Ok(t) if t.is_symlink() => {
                    // counted as a file of its own size, never followed
                    total.files += 1;
                    if let Ok(m) = fs::symlink_metadata(item.path()) {
                        total.bytes += m.len();
                    }
                }
                Ok(t) if t.is_dir() => {
                    total.dirs += 1;
                    let path = item.path();
                    // stay on the root's file system (no /proc, no network mounts below)
                    if root_dev.is_none() || device_of(&path) == root_dev {
                        stack.push(path);
                    }
                }
                Ok(_) => {
                    total.files += 1;
                    match item.metadata() {
                        Ok(m) => total.bytes += m.len(),
                        Err(_) => total.unreadable += 1,
                    }
                }
                Err(_) => total.unreadable += 1,
            }
        }
        if last.elapsed() >= interval {
            progress(&total);
            last = Instant::now();
        }
    }
    total
}

/// Counts several top-level entries (job `count`: the copy and delete dialogs).
/// Folders are walked with [`dir_size`], files and links count with their own
/// size, missing entries as unreadable. `progress` gets the running total at most
/// every `interval` – also between top-level entries, so many small folders or
/// plain files still show a growing number while the walk is slow.
pub fn count_paths(
    paths: &[PathBuf],
    cancel: &AtomicBool,
    interval: Duration,
    mut progress: impl FnMut(&DirSize),
) -> DirSize {
    let mut total = DirSize::default();
    let mut last = Instant::now();
    for p in paths {
        if cancel.load(Ordering::Relaxed) {
            total.cancelled = true;
            break;
        }
        match fs::symlink_metadata(p) {
            Ok(m) if m.is_dir() => {
                total.dirs += 1;
                let base = total;
                let sub = dir_size(p, cancel, interval, |s| {
                    progress(&DirSize {
                        files: base.files + s.files,
                        dirs: base.dirs + s.dirs,
                        bytes: base.bytes + s.bytes,
                        unreadable: base.unreadable + s.unreadable,
                        cancelled: false,
                    });
                    last = Instant::now();
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
        if last.elapsed() >= interval {
            progress(&total);
            last = Instant::now();
        }
    }
    total
}

#[cfg(unix)]
fn device_of(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(path).ok().map(|m| m.dev())
}

/// Windows: mount points inside a tree are junctions/reparse points, which are
/// never followed (they report as symlinks), so no device check is needed.
#[cfg(not(unix))]
fn device_of(_path: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn run(root: &Path) -> DirSize {
        dir_size(
            root,
            &AtomicBool::new(false),
            Duration::from_secs(60),
            |_| {},
        )
    }

    #[test]
    fn sums_files_and_counts_folders() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("Wurzel ä");
        fs::create_dir_all(root.join("a/b c")).unwrap();
        fs::write(root.join("x.bin"), vec![0u8; 1000]).unwrap();
        fs::write(root.join("a/y"), vec![0u8; 24]).unwrap();
        fs::write(root.join("a/b c/z 📄"), vec![0u8; 1]).unwrap();
        let s = run(&root);
        assert_eq!(
            (s.files, s.dirs, s.bytes, s.unreadable, s.cancelled),
            (3, 2, 1025, 0, false)
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks_and_survives_cycles() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let root = dir.path().join("r");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/f"), vec![0u8; 10]).unwrap();
        symlink(&root, root.join("sub/loop")).unwrap(); // cycle
        let outside = dir.path().join("big");
        fs::write(&outside, vec![0u8; 100_000]).unwrap();
        symlink(&outside, root.join("big-link")).unwrap();
        let s = run(&root);
        assert_eq!(s.dirs, 1);
        assert_eq!(s.files, 3); // f + 2 links
        assert!(
            s.bytes < 1_000,
            "links counted with their own size, not the target"
        );
    }

    #[cfg(unix)]
    #[test]
    fn counts_unreadable_subfolders() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let locked = dir.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::write(locked.join("f"), "x").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let s = run(dir.path());
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(s.dirs, 1);
        // root can read anyway – then the file is counted instead
        assert!(s.unreadable == 1 || s.files == 1);
    }

    #[test]
    fn stops_when_cancelled_and_reports_progress() {
        let dir = tempdir().unwrap();
        for i in 0..5 {
            fs::create_dir(dir.path().join(format!("d{i}"))).unwrap();
        }
        let cancel = AtomicBool::new(true);
        let s = dir_size(dir.path(), &cancel, Duration::ZERO, |_| {});
        assert!(s.cancelled);
        let mut calls = 0;
        let s = dir_size(dir.path(), &AtomicBool::new(false), Duration::ZERO, |_| {
            calls += 1
        });
        assert!(!s.cancelled);
        assert!(calls >= 6);
    }

    #[test]
    fn missing_root_is_unreadable() {
        let dir = tempdir().unwrap();
        let s = run(&dir.path().join("gone"));
        assert_eq!(s.unreadable, 1);
    }

    #[test]
    fn count_paths_sums_entries_and_reports_between_them() {
        let dir = tempdir().unwrap();
        let mut paths = Vec::new();
        for i in 0..5u8 {
            let f = dir.path().join(format!("Film {i}.mkv"));
            fs::write(&f, vec![0u8; 100]).unwrap();
            paths.push(f);
        }
        let folder = dir.path().join("Staffel ä");
        fs::create_dir_all(folder.join("S01")).unwrap();
        fs::write(folder.join("S01/E01.mkv"), vec![0u8; 1000]).unwrap();
        paths.push(folder);
        paths.push(dir.path().join("weg"));
        let mut seen = Vec::new();
        let s = count_paths(&paths, &AtomicBool::new(false), Duration::ZERO, |t| {
            seen.push(t.bytes)
        });
        assert_eq!(
            (s.files, s.dirs, s.bytes, s.unreadable, s.cancelled),
            (6, 2, 1500, 1, false)
        );
        // a growing number while counting, not only at the end
        assert!(seen.len() >= 6, "{seen:?}");
        assert!(seen.windows(2).all(|w| w[0] <= w[1]), "{seen:?}");
        assert_eq!(seen[..5], [100, 200, 300, 400, 500]);

        let s = count_paths(&paths, &AtomicBool::new(true), Duration::ZERO, |_| {});
        assert!(s.cancelled);
        assert_eq!(s.files, 0);
    }
}
