//! Opening files with the default application (design 003 E2). The check is
//! pure and tested; the actual open goes through the `open` crate (argument
//! array, no shell).

use crate::error::{FsError, FsErrorCode};
use std::fs;
use std::path::Path;

/// Extensions treated as executable (case-insensitive).
#[cfg(windows)]
const EXEC_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "com", "ps1", "vbs", "msi", "lnk", "scr",
];
#[cfg(target_os = "macos")]
const EXEC_EXTENSIONS: &[&str] = &["app", "command", "tool", "pkg"];
#[cfg(all(unix, not(target_os = "macos")))]
const EXEC_EXTENSIONS: &[&str] = &["desktop", "appimage", "run", "sh"];

/// Validates that `path` is an existing file that may be opened.
pub fn check_openable(path: &Path, allow_executable: bool) -> Result<(), FsError> {
    let meta = fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    if meta.is_dir() && !is_bundle(path) {
        return Err(FsError::new(
            FsErrorCode::NotAFile,
            "This is a folder, not a file",
            Some(path),
        ));
    }
    if !allow_executable && is_executable(path, &meta) {
        return Err(FsError::new(
            FsErrorCode::Executable,
            "This file is a program; confirm to run it",
            Some(path),
        ));
    }
    Ok(())
}

fn has_exec_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXEC_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// macOS app bundles are folders that open like files.
fn is_bundle(path: &Path) -> bool {
    cfg!(target_os = "macos") && has_exec_extension(path)
}

#[cfg(unix)]
fn is_executable(path: &Path, meta: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    (meta.is_file() && meta.permissions().mode() & 0o111 != 0) || has_exec_extension(path)
}

#[cfg(not(unix))]
fn is_executable(path: &Path, _meta: &fs::Metadata) -> bool {
    has_exec_extension(path)
}

/// Opens with the system's default application, detached from this process.
pub fn open_with_default_app(path: &Path) -> Result<(), FsError> {
    open::that_detached(path).map_err(|e| FsError::from_io(&e, path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn folders_and_missing_paths_are_rejected() {
        let dir = tempdir().unwrap();
        assert_eq!(
            check_openable(dir.path(), false).unwrap_err().code,
            FsErrorCode::NotAFile
        );
        assert_eq!(
            check_openable(&dir.path().join("gone"), false)
                .unwrap_err()
                .code,
            FsErrorCode::NotFound
        );
    }

    #[test]
    fn plain_documents_are_fine() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("Brief ä.txt");
        fs::write(&f, "x").unwrap();
        check_openable(&f, false).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn executables_need_confirmation() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let f = dir.path().join("tool");
        fs::write(&f, "#!/bin/sh").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            check_openable(&f, false).unwrap_err().code,
            FsErrorCode::Executable
        );
        check_openable(&f, true).unwrap();
    }

    #[test]
    fn executable_extensions_need_confirmation() {
        let dir = tempdir().unwrap();
        let f = dir
            .path()
            .join(format!("setup.{}", EXEC_EXTENSIONS[0].to_uppercase()));
        fs::write(&f, "x").unwrap();
        assert_eq!(
            check_openable(&f, false).unwrap_err().code,
            FsErrorCode::Executable
        );
    }
}
