//! Collect the files below a folder (design 045 E1, "group series by season").
//! Pure std, writes nothing.
//!
//! Rules (as in `clean.rs`): symbolic links are never followed and never listed,
//! other file systems are not entered, hidden entries (dot names – also macOS
//! `._*` AppleDouble files – and the platform's hidden flag) are skipped,
//! unreadable folders are reported and never fatal. Names that are not UTF-8
//! cannot be addressed again by the frontend and are skipped.
//!
//! Residual risk (review 045, same as `clean.rs`): between `symlink_metadata` and
//! `read_dir` a folder could be swapped for a link by someone with write access below
//! the start folder; paths stay lexically below it. The walk only lists – the `group`
//! job checks every source again (`check_danger`) before it moves anything.
//!
//! Keep in sync with `src/app/core/folders/folders.models.ts` (`TreeFile`, `FileTree`).

use crate::error::{FsError, FsErrorCode};
use crate::listing::is_hidden;
use crate::platform::file_id;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

/// Files listed at most (`truncated`).
pub const MAX_FILES: usize = 20_000;
/// Entries looked at before the walk stops (`truncated`).
pub const MAX_VISITED: u64 = 500_000;
/// Folder levels below the start folder, default and at most.
pub const DEFAULT_DEPTH: u32 = 8;
pub const MAX_DEPTH: u32 = 16;
/// Unreadable folders reported by name (further ones are counted).
pub const MAX_UNREADABLE: usize = 1000;

fn default_depth() -> u32 {
    DEFAULT_DEPTH
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectOptions {
    /// 1 = only the files of the start folder; clamped to `1..=MAX_DEPTH`.
    #[serde(default = "default_depth")]
    pub max_depth: u32,
}

impl Default for CollectOptions {
    fn default() -> Self {
        CollectOptions {
            max_depth: DEFAULT_DEPTH,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeFile {
    /// Full path (opaque for the frontend).
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
    /// Names of the folders between the start folder and the file (`[]` = directly in it).
    pub dirs: Vec<String>,
    /// Full path of the first folder below the start folder (`None` for `dirs = []`).
    pub top: Option<String>,
    /// Path relative to the start folder with the OS separators – for display only.
    pub rel: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTree {
    /// Depth first, entries of a folder sorted by name.
    pub files: Vec<TreeFile>,
    pub unreadable: Vec<FsError>,
    pub unreadable_more: u64,
    /// The walk stopped at a limit; what was found is listed.
    pub truncated: bool,
    /// The walk was cancelled; then `files` is empty.
    pub cancelled: bool,
    pub visited: u64,
}

struct Limits {
    files: usize,
    visited: u64,
}

struct Walk<'a> {
    root: &'a Path,
    depth: u32,
    dev: Option<u64>,
    cancel: &'a AtomicBool,
    limits: Limits,
    tree: FileTree,
}

fn ms(meta: &fs::Metadata) -> Option<i64> {
    let d = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(d.as_millis()).ok()
}

impl Walk<'_> {
    fn unreadable(&mut self, path: &Path, e: &std::io::Error) {
        if self.tree.unreadable.len() < MAX_UNREADABLE {
            self.tree.unreadable.push(FsError::from_io(e, path));
        } else {
            self.tree.unreadable_more += 1;
        }
    }

    fn stop(&self) -> bool {
        self.tree.truncated || self.tree.cancelled
    }

    /// Walks `dir`; `dirs` = its names below the start folder.
    fn dir(&mut self, dir: &Path, dirs: &mut Vec<String>) {
        let rd = match fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(e) => {
                self.unreadable(dir, &e);
                return;
            }
        };
        let mut entries: Vec<(String, PathBuf)> = Vec::new();
        for entry in rd {
            if self.cancel.load(Ordering::Relaxed) {
                self.tree.cancelled = true;
                return;
            }
            self.tree.visited += 1;
            if self.tree.visited > self.limits.visited {
                self.tree.truncated = true;
                return;
            }
            match entry {
                Ok(e) => {
                    // a name that is not UTF-8 could not be addressed again
                    if let Ok(name) = e.file_name().into_string() {
                        entries.push((name, e.path()));
                    }
                }
                Err(e) => self.unreadable(dir, &e),
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, path) in entries {
            if self.stop() {
                return;
            }
            // links not followed: a link is neither a file nor a folder here
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if is_hidden(&name, &meta) {
                continue;
            }
            if meta.is_dir() {
                let same_fs = self.dev.is_none() || file_id(&meta).map(|f| f.0) == self.dev;
                if same_fs && (dirs.len() as u32) + 1 < self.depth {
                    dirs.push(name);
                    self.dir(&path, dirs);
                    dirs.pop();
                }
            } else if meta.is_file() {
                if self.tree.files.len() >= self.limits.files {
                    self.tree.truncated = true;
                    return;
                }
                let rel: PathBuf = dirs.iter().chain(std::iter::once(&name)).collect();
                self.tree.files.push(TreeFile {
                    path: path.to_string_lossy().into_owned(),
                    name,
                    size: meta.len(),
                    modified_ms: ms(&meta),
                    dirs: dirs.clone(),
                    top: dirs
                        .first()
                        .map(|d| self.root.join(d).to_string_lossy().into_owned()),
                    rel: rel.to_string_lossy().into_owned(),
                });
            }
        }
    }
}

/// Lists the files below `root` (design 045 E1); stops early once `cancel` is set.
pub fn collect_files_cancellable(
    root: &Path,
    o: &CollectOptions,
    cancel: &AtomicBool,
) -> Result<FileTree, FsError> {
    collect_with(
        root,
        o,
        cancel,
        Limits {
            files: MAX_FILES,
            visited: MAX_VISITED,
        },
    )
}

pub fn collect_files(root: &Path, o: &CollectOptions) -> Result<FileTree, FsError> {
    collect_files_cancellable(root, o, &AtomicBool::new(false))
}

fn collect_with(
    root: &Path,
    o: &CollectOptions,
    cancel: &AtomicBool,
    limits: Limits,
) -> Result<FileTree, FsError> {
    // the start folder itself may be reached through a link (the panel's path)
    let meta = fs::metadata(root).map_err(|e| FsError::from_io(&e, root))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "The start folder is not a folder",
            Some(root),
        ));
    }
    let mut walk = Walk {
        root,
        depth: o.max_depth.clamp(1, MAX_DEPTH),
        dev: file_id(&meta).map(|f| f.0),
        cancel,
        limits,
        tree: FileTree::default(),
    };
    walk.dir(root, &mut Vec::new());
    if walk.tree.cancelled {
        walk.tree.files.clear();
        walk.tree.truncated = true;
    }
    Ok(walk.tree)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rels(t: &FileTree) -> Vec<String> {
        t.files
            .iter()
            .map(|f| {
                f.dirs
                    .iter()
                    .chain(std::iter::once(&f.name))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .collect()
    }

    fn tree() -> (tempfile::TempDir, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Die Kirche bleibt im Dorf");
        let rel = root.join("Die.Kirche.S01E01 Grüße 🎬");
        fs::create_dir_all(rel.join("Sample")).unwrap();
        fs::write(rel.join("b.s01e01.mkv"), "12345").unwrap();
        fs::write(rel.join("a.s01e01.nfo"), "x").unwrap();
        fs::write(rel.join("Sample/b-sample.mkv"), "x").unwrap();
        fs::write(root.join("direkt.mkv"), "x").unwrap();
        fs::create_dir_all(root.join("leer")).unwrap();
        (t, root)
    }

    #[test]
    fn files_with_folder_names_top_and_rel() {
        let (_t, root) = tree();
        let t = collect_files(&root, &CollectOptions::default()).unwrap();
        assert_eq!(
            rels(&t),
            [
                "Die.Kirche.S01E01 Grüße 🎬/Sample/b-sample.mkv",
                "Die.Kirche.S01E01 Grüße 🎬/a.s01e01.nfo",
                "Die.Kirche.S01E01 Grüße 🎬/b.s01e01.mkv",
                "direkt.mkv",
            ]
        );
        let f = &t.files[2];
        assert_eq!(f.size, 5);
        assert!(f.modified_ms.is_some());
        assert_eq!(
            PathBuf::from(&f.path),
            root.join("Die.Kirche.S01E01 Grüße 🎬/b.s01e01.mkv")
        );
        assert_eq!(
            f.top.as_deref().map(PathBuf::from),
            Some(root.join("Die.Kirche.S01E01 Grüße 🎬"))
        );
        assert_eq!(
            PathBuf::from(&f.rel),
            Path::new("Die.Kirche.S01E01 Grüße 🎬").join("b.s01e01.mkv")
        );
        let direct = &t.files[3];
        assert!(direct.dirs.is_empty() && direct.top.is_none());
        assert!(!t.truncated && !t.cancelled);
    }

    #[test]
    fn depth_limits_the_folders() {
        let (_t, root) = tree();
        let t = collect_files(&root, &CollectOptions { max_depth: 1 }).unwrap();
        assert_eq!(rels(&t), ["direkt.mkv"]);
        let t = collect_files(&root, &CollectOptions { max_depth: 2 }).unwrap();
        assert_eq!(t.files.len(), 3, "{:?}", rels(&t)); // not the Sample folder
        // 0 is clamped to 1, huge values to MAX_DEPTH
        let t = collect_files(&root, &CollectOptions { max_depth: 0 }).unwrap();
        assert_eq!(t.files.len(), 1);
    }

    #[test]
    fn hidden_entries_are_skipped() {
        let (_t, root) = tree();
        fs::write(root.join("._direkt.mkv"), "x").unwrap(); // macOS AppleDouble
        fs::write(root.join(".DS_Store"), "x").unwrap();
        fs::create_dir(root.join(".versteckt")).unwrap();
        fs::write(root.join(".versteckt/x.s01e09.mkv"), "x").unwrap();
        let t = collect_files(&root, &CollectOptions::default()).unwrap();
        assert_eq!(t.files.len(), 4, "{:?}", rels(&t));
    }

    #[cfg(unix)]
    #[test]
    fn links_are_never_followed_nor_listed() {
        let (t, root) = tree();
        let outside = t.path().join("draußen");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("fremd.s09e09.mkv"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link zum Ordner")).unwrap();
        std::os::unix::fs::symlink(root.join("direkt.mkv"), root.join("link.mkv")).unwrap();
        std::os::unix::fs::symlink(root.join("fehlt"), root.join("kaputt.mkv")).unwrap();
        let tree = collect_files(&root, &CollectOptions::default()).unwrap();
        assert_eq!(tree.files.len(), 4, "{:?}", rels(&tree));
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_start_folder_is_walked() {
        let (t, root) = tree();
        let link = t.path().join("Verknüpfung");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        let tree = collect_files(&link, &CollectOptions::default()).unwrap();
        assert_eq!(tree.files.len(), 4);
        assert!(tree.files[0].path.starts_with(&*link.to_string_lossy()));
    }

    #[test]
    fn limits_truncate_and_cancel_clears() {
        let (_t, root) = tree();
        let t = collect_with(
            &root,
            &CollectOptions::default(),
            &AtomicBool::new(false),
            Limits {
                files: 2,
                visited: MAX_VISITED,
            },
        )
        .unwrap();
        assert!(t.truncated);
        assert_eq!(t.files.len(), 2);
        let t = collect_with(
            &root,
            &CollectOptions::default(),
            &AtomicBool::new(false),
            Limits {
                files: MAX_FILES,
                visited: 2,
            },
        )
        .unwrap();
        assert!(t.truncated);
        let t =
            collect_files_cancellable(&root, &CollectOptions::default(), &AtomicBool::new(true))
                .unwrap();
        assert!(t.cancelled && t.files.is_empty());
    }

    #[test]
    fn the_start_folder_is_checked() {
        let (_t, root) = tree();
        let e = collect_files(&root.join("direkt.mkv"), &CollectOptions::default()).unwrap_err();
        assert_eq!(e.code, FsErrorCode::NotADirectory);
        let e = collect_files(&root.join("fehlt"), &CollectOptions::default()).unwrap_err();
        assert_eq!(e.code, FsErrorCode::NotFound);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_folders_are_reported() {
        use std::os::unix::fs::PermissionsExt;
        let (_t, root) = tree();
        let locked = root.join("gesperrt");
        fs::create_dir(&locked).unwrap();
        fs::write(locked.join("x.s01e05.mkv"), "x").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let t = collect_files(&root, &CollectOptions::default()).unwrap();
        let readable = fs::read_dir(&locked).is_ok();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        if readable {
            return; // running as root: permissions do not apply
        }
        assert_eq!(t.unreadable.len(), 1);
        assert_eq!(t.files.len(), 4);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn names_that_are_not_utf8_are_skipped() {
        use std::os::unix::ffi::OsStrExt;
        let (_t, root) = tree();
        let bad = std::ffi::OsStr::from_bytes(b"kaputt\xff.s01e02.mkv");
        fs::write(root.join(bad), "x").unwrap();
        let t = collect_files(&root, &CollectOptions::default()).unwrap();
        assert_eq!(t.files.len(), 4);
    }
}
