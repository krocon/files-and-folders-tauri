//! Quick file operations that never overwrite anything (design 006 E8):
//! create a folder (also nested), create an empty file, rename one entry.
//! Pure std, no Tauri – unit-tested with temp folders.

use crate::error::{FsError, FsErrorCode};
use crate::paths::{Danger, danger_of, validate_name};
use crate::platform::rename_noreplace;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

pub(crate) fn already_exists(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::AlreadyExists,
        "A file or folder with this name exists already",
        Some(path),
    )
}

fn named(mut e: FsError, path: &Path) -> FsError {
    e.path = Some(path.to_string_lossy().into_owned());
    e
}

/// Refuses root, home and system paths unless the user confirmed twice.
pub fn check_danger(path: &Path, home: Option<&Path>, allow: bool) -> Result<(), FsError> {
    match danger_of(path, home) {
        Some(d) if !allow => Err(FsError::new(
            FsErrorCode::DangerousPath,
            match d {
                Danger::Root => "This is a drive or volume root",
                Danger::Home => "This is your home folder",
                Danger::System => "This is a system folder",
            },
            Some(path),
        )),
        _ => Ok(()),
    }
}

/// Splits `a/b/c` (also `a\b\c` on Windows) into validated segments.
fn segments(name: &str) -> Result<Vec<&str>, FsError> {
    let parts: Vec<&str> = name
        .split(|c| c == '/' || (cfg!(windows) && c == '\\'))
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidName,
            "The name is empty",
            None,
        ));
    }
    for p in &parts {
        validate_name(p)?;
    }
    Ok(parts)
}

/// Creates `parent/name`; `name` may be nested (`a/b/c`). Returns the topmost
/// new path below `parent` (gets the cursor). Fails if the full path exists.
pub fn make_dir(parent: &Path, name: &str) -> Result<PathBuf, FsError> {
    let parts = segments(name)?;
    let meta = fs::metadata(parent).map_err(|e| FsError::from_io(&e, parent))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "Not a folder",
            Some(parent),
        ));
    }
    let full = parts.iter().fold(parent.to_path_buf(), |p, s| p.join(s));
    if exists(&full) {
        return Err(already_exists(&full));
    }
    if let Some(up) = full.parent() {
        fs::create_dir_all(up).map_err(|e| FsError::from_io(&e, up))?;
    }
    fs::create_dir(&full).map_err(|e| FsError::from_io(&e, &full))?;
    Ok(parent.join(parts[0]))
}

/// Creates an empty file; never replaces an existing one.
pub fn create_file(parent: &Path, name: &str) -> Result<PathBuf, FsError> {
    validate_name(name).map_err(|e| named(e, parent))?;
    let path = parent.join(name);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| FsError::from_io(&e, &path))?;
    Ok(path)
}

/// True if the folder holds an entry spelled exactly `name` (not just
/// case-insensitively equal).
fn has_exact_entry(dir: &Path, name: &str) -> io::Result<bool> {
    for entry in fs::read_dir(dir)? {
        if entry?.file_name() == name {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Renames one entry inside its folder. Never overwrites; a change of case
/// only (`a.txt` → `A.txt`) goes through a temporary name, because
/// case-insensitive file systems see both names as the same entry.
pub fn rename_entry(
    path: &Path,
    new_name: &str,
    home: Option<&Path>,
    allow_dangerous: bool,
) -> Result<PathBuf, FsError> {
    validate_name(new_name).map_err(|e| named(e, path))?;
    check_danger(path, home, allow_dangerous)?;
    let Some(parent) = path.parent() else {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "A root cannot be renamed",
            Some(path),
        ));
    };
    fs::symlink_metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    let old_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let target = parent.join(new_name);
    if old_name == new_name {
        return Ok(target);
    }
    let case_only = old_name.to_lowercase() == new_name.to_lowercase();
    if case_only && exists(&target) {
        return rename_same_entry(path, parent, new_name);
    }
    rename_noreplace(path, &target).map_err(|e| {
        if e.kind() == io::ErrorKind::AlreadyExists {
            already_exists(&target)
        } else {
            FsError::from_io(&e, path)
        }
    })?;
    Ok(target)
}

/// Renames `path` to `new_name` in `parent` when the file system sees both
/// names as the **same** entry (case change on APFS/NTFS/FAT, another Unicode
/// normalisation on APFS). Fails with `already_exists` if `new_name` is spelled
/// exactly like another entry. Never replaces anything.
pub fn rename_same_entry(path: &Path, parent: &Path, new_name: &str) -> Result<PathBuf, FsError> {
    let target = parent.join(new_name);
    if has_exact_entry(parent, new_name).map_err(|e| FsError::from_io(&e, parent))? {
        return Err(already_exists(&target));
    }
    // APFS and NTFS change the case directly (it is the same entry – nothing to replace)
    fs::rename(path, &target).map_err(|e| FsError::from_io(&e, path))?;
    if has_exact_entry(parent, new_name).unwrap_or(true) {
        return Ok(target);
    }
    // the file system kept the old spelling: go through a unique temporary name
    let tmp = unique_temp(parent);
    rename_noreplace(path, &tmp).map_err(|e| FsError::from_io(&e, path))?;
    if let Err(e) = rename_noreplace(&tmp, &target) {
        let _ = rename_noreplace(&tmp, path); // put it back
        return Err(FsError::from_io(&e, &target));
    }
    Ok(target)
}

/// A name in `dir` that no other rename uses (process id, time, counter).
pub fn unique_temp(dir: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    dir.join(format!(
        ".fnf-rename-{}-{}-{}",
        std::process::id(),
        nanos,
        SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn make_dir_simple_nested_and_existing() {
        let t = tempdir().unwrap();
        let p = make_dir(t.path(), "Ünï Ordner").unwrap();
        assert_eq!(p, t.path().join("Ünï Ordner"));
        assert!(p.is_dir());
        let p = make_dir(t.path(), "a/b/c").unwrap();
        assert_eq!(p, t.path().join("a"));
        assert!(t.path().join("a/b/c").is_dir());
        // a exists, a/d is new
        assert_eq!(make_dir(t.path(), "a/d").unwrap(), t.path().join("a"));
        assert_eq!(
            make_dir(t.path(), "a/b/c").unwrap_err().code,
            FsErrorCode::AlreadyExists
        );
        assert_eq!(
            make_dir(t.path(), "x/../y").unwrap_err().code,
            FsErrorCode::InvalidName
        );
        assert_eq!(
            make_dir(t.path(), "/").unwrap_err().code,
            FsErrorCode::InvalidName
        );
        fs::write(t.path().join("f"), "x").unwrap();
        assert_eq!(
            make_dir(t.path(), "f").unwrap_err().code,
            FsErrorCode::AlreadyExists
        );
        assert_eq!(
            make_dir(&t.path().join("f"), "z").unwrap_err().code,
            FsErrorCode::NotADirectory
        );
    }

    #[test]
    fn create_file_never_overwrites() {
        let t = tempdir().unwrap();
        let p = create_file(t.path(), "neu.txt").unwrap();
        assert_eq!(fs::read(&p).unwrap().len(), 0);
        fs::write(&p, "inhalt").unwrap();
        assert_eq!(
            create_file(t.path(), "neu.txt").unwrap_err().code,
            FsErrorCode::AlreadyExists
        );
        assert_eq!(fs::read_to_string(&p).unwrap(), "inhalt");
        assert_eq!(
            create_file(t.path(), "a/b").unwrap_err().code,
            FsErrorCode::InvalidName
        );
    }

    #[test]
    fn rename_plain_existing_and_case_only() {
        let t = tempdir().unwrap();
        let a = t.path().join("a.txt");
        fs::write(&a, "A").unwrap();
        fs::write(t.path().join("b.txt"), "B").unwrap();
        assert_eq!(
            rename_entry(&a, "b.txt", None, false).unwrap_err().code,
            FsErrorCode::AlreadyExists
        );
        assert_eq!(fs::read_to_string(t.path().join("b.txt")).unwrap(), "B");
        let up = rename_entry(&a, "A.txt", None, false).unwrap();
        assert_eq!(up, t.path().join("A.txt"));
        assert!(has_exact_entry(t.path(), "A.txt").unwrap());
        assert!(!has_exact_entry(t.path(), "a.txt").unwrap());
        assert_eq!(fs::read_to_string(&up).unwrap(), "A");
        let c = rename_entry(&up, "c ü.txt", None, false).unwrap();
        assert_eq!(fs::read_to_string(c).unwrap(), "A");
        assert_eq!(
            rename_entry(&t.path().join("c ü.txt"), "x/y", None, false)
                .unwrap_err()
                .code,
            FsErrorCode::InvalidName
        );
        assert_eq!(
            rename_entry(&t.path().join("fehlt"), "y", None, false)
                .unwrap_err()
                .code,
            FsErrorCode::NotFound
        );
    }

    /// On a case-sensitive file system `a` and `A` are different entries –
    /// renaming one onto the other must not overwrite.
    #[cfg(target_os = "linux")]
    #[test]
    fn rename_case_only_does_not_overwrite_a_distinct_entry() {
        let t = tempdir().unwrap();
        fs::write(t.path().join("a"), "klein").unwrap();
        fs::write(t.path().join("A"), "GROSS").unwrap();
        assert_eq!(
            rename_entry(&t.path().join("a"), "A", None, false)
                .unwrap_err()
                .code,
            FsErrorCode::AlreadyExists
        );
        assert_eq!(fs::read_to_string(t.path().join("A")).unwrap(), "GROSS");
    }

    #[cfg(unix)]
    #[test]
    fn rename_refuses_dangerous_paths() {
        let home = Path::new("/home/someone");
        assert_eq!(
            check_danger(home, Some(home), false).unwrap_err().code,
            FsErrorCode::DangerousPath
        );
        assert!(check_danger(home, Some(home), true).is_ok());
        assert_eq!(
            rename_entry(Path::new("/etc"), "x", None, false)
                .unwrap_err()
                .code,
            FsErrorCode::DangerousPath
        );
    }
}
