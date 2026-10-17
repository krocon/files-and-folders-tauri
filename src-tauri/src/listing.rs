//! Directory listing. Pure std code without Tauri so it can be unit-tested.

use crate::error::{FsError, FsErrorCode};
use crate::model::{DirEntryDto, DirectoryListing, EntryKind};
use crate::paths::{parent_of, segments_of};
use std::cmp::Ordering;
use std::fs::{self, Metadata};
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Reads `dir` (one level, not recursive) and returns sorted entries:
/// directories (incl. symlinks to directories) first, then by name
/// case-insensitively.
///
/// Errors on individual entries do not fail the whole listing; such entries
/// are returned with [`EntryKind::Unknown`] and counted in
/// `unreadable_entries`.
pub fn list_directory(dir: &Path) -> Result<DirectoryListing, FsError> {
    let meta = fs::metadata(dir).map_err(|e| FsError::from_io(&e, dir))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "Path is not a directory",
            Some(dir),
        ));
    }

    let read = fs::read_dir(dir).map_err(|e| FsError::from_io(&e, dir))?;
    let mut entries = Vec::new();
    let mut unreadable = 0usize;

    for item in read {
        let Ok(item) = item else {
            unreadable += 1;
            continue;
        };
        let os_name = item.file_name();
        let lossy_name = os_name.to_str().is_none();
        let name = os_name.to_string_lossy().into_owned();
        let path = item.path();

        let dto = match fs::symlink_metadata(&path) {
            Ok(link_meta) => entry_from_metadata(name, &path, &link_meta, lossy_name),
            Err(_) => {
                unreadable += 1;
                unknown_entry(name, &path, lossy_name)
            }
        };
        entries.push(dto);
    }

    entries.sort_by(compare_entries);

    Ok(DirectoryListing {
        path: dir.to_string_lossy().into_owned(),
        parent: parent_of(dir).map(|p| p.to_string_lossy().into_owned()),
        segments: segments_of(dir),
        entries,
        unreadable_entries: unreadable,
    })
}

/// One entry as [`list_directory`] would return it (watcher deltas, dropped
/// paths). `None` if nothing exists at `path` (a dangling link does exist);
/// an entry that cannot be read comes back as [`EntryKind::Unknown`].
pub fn stat_entry(path: &Path) -> Option<DirEntryDto> {
    let os_name = path.file_name()?;
    let lossy_name = os_name.to_str().is_none();
    let name = os_name.to_string_lossy().into_owned();
    match fs::symlink_metadata(path) {
        Ok(meta) => Some(entry_from_metadata(name, path, &meta, lossy_name)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => Some(unknown_entry(name, path, lossy_name)),
    }
}

/// Paths dropped onto the window (design 012 E6), described like listing entries.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribedPaths {
    pub entries: Vec<DirEntryDto>,
    /// The common folder of all entries, `None` if they come from several folders.
    pub parent: Option<String>,
    /// Paths that do not exist (any more).
    pub missing: usize,
}

/// Describes validated, absolute paths; missing ones are counted, not failed.
pub fn describe_paths(paths: &[std::path::PathBuf]) -> DescribedPaths {
    let mut entries = Vec::new();
    let mut missing = 0;
    let mut parent: Option<Option<std::path::PathBuf>> = None;
    for p in paths {
        let Some(entry) = stat_entry(p) else {
            missing += 1;
            continue;
        };
        if entries.iter().any(|e: &DirEntryDto| e.path == entry.path) {
            continue;
        }
        let this = parent_of(p);
        parent = match parent {
            None => Some(this),
            Some(prev) if prev == this => Some(prev),
            Some(_) => Some(None),
        };
        entries.push(entry);
    }
    DescribedPaths {
        entries,
        parent: parent.flatten().map(|p| p.to_string_lossy().into_owned()),
        missing,
    }
}

fn unknown_entry(name: String, path: &Path, lossy_name: bool) -> DirEntryDto {
    DirEntryDto {
        hidden: is_dot_name(&name),
        name,
        path: path.to_string_lossy().into_owned(),
        kind: EntryKind::Unknown,
        target_kind: None,
        size: None,
        modified_ms: None,
        lossy_name,
    }
}

pub(crate) fn entry_from_metadata(
    name: String,
    path: &Path,
    link_meta: &Metadata,
    lossy_name: bool,
) -> DirEntryDto {
    let file_type = link_meta.file_type();
    let (kind, target_kind, effective_meta) = if file_type.is_symlink() {
        match fs::metadata(path) {
            Ok(target) => {
                let tk = if target.is_dir() {
                    EntryKind::Directory
                } else {
                    EntryKind::File
                };
                (EntryKind::Symlink, Some(tk), Some(target))
            }
            Err(_) => (EntryKind::Symlink, None, None),
        }
    } else if file_type.is_dir() {
        (EntryKind::Directory, None, None)
    } else {
        (EntryKind::File, None, None)
    };

    let meta_for_size = effective_meta.as_ref().unwrap_or(link_meta);
    let size = if meta_for_size.is_file() {
        Some(meta_for_size.len())
    } else {
        None
    };
    let modified_ms = link_meta
        .modified()
        .ok()
        .and_then(|t| match t.duration_since(UNIX_EPOCH) {
            Ok(d) => i64::try_from(d.as_millis()).ok(),
            Err(e) => i64::try_from(e.duration().as_millis()).ok().map(|v| -v),
        });

    DirEntryDto {
        hidden: is_hidden(&name, link_meta),
        name,
        path: path.to_string_lossy().into_owned(),
        kind,
        target_kind,
        size,
        modified_ms,
        lossy_name,
    }
}

fn is_dot_name(name: &str) -> bool {
    name.starts_with('.')
}

/// Hidden = dot-file on every platform, plus the platform's native flag
/// (Windows `FILE_ATTRIBUTE_HIDDEN`, macOS `UF_HIDDEN`).
pub(crate) fn is_hidden(name: &str, meta: &Metadata) -> bool {
    is_dot_name(name) || native_hidden_flag(meta)
}

#[cfg(windows)]
fn native_hidden_flag(meta: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(target_os = "macos")]
fn native_hidden_flag(meta: &Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    const UF_HIDDEN: u32 = 0x8000;
    meta.st_flags() & UF_HIDDEN != 0
}

#[cfg(not(any(windows, target_os = "macos")))]
fn native_hidden_flag(_meta: &Metadata) -> bool {
    false
}

fn compare_entries(a: &DirEntryDto, b: &DirEntryDto) -> Ordering {
    b.is_navigable_dir()
        .cmp(&a.is_navigable_dir())
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.name.cmp(&b.name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn names(l: &DirectoryListing) -> Vec<&str> {
        l.entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn stat_entry_matches_the_listing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("Ordner äöü 😀")).unwrap();
        fs::write(root.join("d a.txt"), b"abc").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("d a.txt"), root.join("link")).unwrap();
            std::os::unix::fs::symlink(root.join("missing"), root.join("dangling")).unwrap();
        }
        let l = list_directory(root).unwrap();
        for e in &l.entries {
            assert_eq!(
                stat_entry(Path::new(&e.path)).as_ref(),
                Some(e),
                "{}",
                e.name
            );
        }
        assert_eq!(stat_entry(&root.join("gone")), None);
        #[cfg(unix)]
        {
            let d = stat_entry(&root.join("dangling")).unwrap();
            assert_eq!((d.kind, d.target_kind), (EntryKind::Symlink, None));
        }
    }

    #[test]
    fn describe_paths_finds_the_common_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("a b.txt"), b"1").unwrap();
        fs::write(root.join("sub").join("c.txt"), b"1").unwrap();
        let d = describe_paths(&[root.join("a b.txt"), root.join("sub"), root.join("gone")]);
        assert_eq!(d.entries.len(), 2);
        assert_eq!(d.missing, 1);
        assert_eq!(d.parent.as_deref(), Some(root.to_string_lossy().as_ref()));
        let d = describe_paths(&[root.join("a b.txt"), root.join("sub").join("c.txt")]);
        assert_eq!(d.parent, None);
        let d = describe_paths(&[root.join("a b.txt"), root.join("a b.txt")]);
        assert_eq!(d.entries.len(), 1);
        assert_eq!(describe_paths(&[]).parent, None);
    }

    #[test]
    fn lists_files_and_dirs_sorted_dirs_first() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("zeta dir")).unwrap();
        fs::create_dir(root.join("Alpha")).unwrap();
        File::create(root.join("b.txt"))
            .unwrap()
            .write_all(b"hello")
            .unwrap();
        File::create(root.join("A.md")).unwrap();

        let l = list_directory(root).unwrap();
        assert_eq!(names(&l), vec!["Alpha", "zeta dir", "A.md", "b.txt"]);
        assert_eq!(l.unreadable_entries, 0);
        assert_eq!(l.path, root.to_string_lossy());

        let b = l.entries.iter().find(|e| e.name == "b.txt").unwrap();
        assert_eq!(b.kind, EntryKind::File);
        assert_eq!(b.size, Some(5));
        assert!(b.modified_ms.is_some());
        assert_eq!(Path::new(&b.path), root.join("b.txt"));

        let d = l.entries.iter().find(|e| e.name == "Alpha").unwrap();
        assert_eq!(d.kind, EntryKind::Directory);
        assert_eq!(d.size, None);
    }

    #[test]
    fn handles_unicode_and_spaces() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Größe & Maße – 日本語 😀");
        fs::create_dir(&dir).unwrap();
        File::create(dir.join("Übersicht März.txt")).unwrap();

        let l = list_directory(&dir).unwrap();
        assert_eq!(names(&l), vec!["Übersicht März.txt"]);
        assert!(!l.entries[0].lossy_name);
        assert_eq!(l.segments.last().unwrap().name, "Größe & Maße – 日本語 😀");
        assert_eq!(l.parent.as_deref(), Some(&*tmp.path().to_string_lossy()));
    }

    #[test]
    fn empty_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let l = list_directory(tmp.path()).unwrap();
        assert!(l.entries.is_empty());
    }

    #[test]
    fn marks_dot_files_hidden() {
        let tmp = tempfile::tempdir().unwrap();
        File::create(tmp.path().join(".secret")).unwrap();
        File::create(tmp.path().join("visible")).unwrap();
        let l = list_directory(tmp.path()).unwrap();
        let hidden: Vec<_> = l
            .entries
            .iter()
            .map(|e| (e.name.as_str(), e.hidden))
            .collect();
        assert_eq!(hidden, vec![(".secret", true), ("visible", false)]);
    }

    #[test]
    fn not_found_and_not_a_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("missing");
        assert_eq!(
            list_directory(&missing).unwrap_err().code,
            FsErrorCode::NotFound
        );

        let file = tmp.path().join("file.txt");
        File::create(&file).unwrap();
        assert_eq!(
            list_directory(&file).unwrap_err().code,
            FsErrorCode::NotADirectory
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_to_dirs_files_and_dangling() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("real dir")).unwrap();
        File::create(root.join("real.txt"))
            .unwrap()
            .write_all(b"abc")
            .unwrap();
        symlink(root.join("real dir"), root.join("link-dir")).unwrap();
        symlink(root.join("real.txt"), root.join("link-file")).unwrap();
        symlink(root.join("nowhere"), root.join("link-dangling")).unwrap();

        let l = list_directory(root).unwrap();
        let get = |n: &str| l.entries.iter().find(|e| e.name == n).unwrap();
        assert_eq!(get("link-dir").kind, EntryKind::Symlink);
        assert_eq!(get("link-dir").target_kind, Some(EntryKind::Directory));
        assert!(get("link-dir").is_navigable_dir());
        assert_eq!(get("link-file").target_kind, Some(EntryKind::File));
        assert_eq!(get("link-file").size, Some(3));
        assert_eq!(get("link-dangling").target_kind, None);
        assert!(!get("link-dangling").is_navigable_dir());
        // Symlinked directory is sorted together with directories.
        assert_eq!(&names(&l)[..2], &["link-dir", "real dir"]);
    }

    #[cfg(unix)]
    #[test]
    fn permission_denied_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let locked = tmp.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let result = list_directory(&locked);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        // Running as root bypasses permission checks; only assert when denied.
        if let Err(e) = result {
            assert_eq!(e.code, FsErrorCode::PermissionDenied);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn non_utf8_names_are_flagged_lossy() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let tmp = tempfile::tempdir().unwrap();
        let raw = OsStr::from_bytes(b"bad\xffname");
        File::create(tmp.path().join(raw)).unwrap();
        let l = list_directory(tmp.path()).unwrap();
        assert!(l.entries[0].lossy_name);
        assert!(l.entries[0].name.contains('\u{FFFD}'));
    }
}

#[cfg(test)]
mod perf {
    /// Manual measurement: `FNF_PERF_DIR=/big/dir cargo test --release perf -- --ignored --nocapture`
    #[test]
    #[ignore = "manual performance measurement"]
    fn perf_list_big_directory() {
        let Ok(dir) = std::env::var("FNF_PERF_DIR") else {
            return;
        };
        let start = std::time::Instant::now();
        let listing = super::list_directory(std::path::Path::new(&dir)).unwrap();
        let listed = start.elapsed();
        let json = serde_json::to_string(&listing).unwrap();
        println!(
            "list_directory: {} entries in {:?}, JSON {} KB in {:?}",
            listing.entries.len(),
            listed,
            json.len() / 1024,
            start.elapsed() - listed
        );
    }
}
