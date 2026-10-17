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
                    stack.push(item.path());
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
}
