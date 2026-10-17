//! Platform functions with one signature per OS (CLAUDE.md §4).

use std::fs::{self, Metadata};
use std::io;
use std::path::Path;

/// Renames `from` to `to` but never replaces an existing `to` (atomic where the
/// OS offers it: Linux `renameat2(RENAME_NOREPLACE)`, macOS `renamex_np(RENAME_EXCL)`).
/// Elsewhere – or on file systems without that flag – a regular file is hard-linked
/// (fails atomically if `to` exists) and its old name removed; folders and links
/// fall back to check + rename. Errors with `AlreadyExists` if `to` exists.
pub fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    match native_noreplace(from, to) {
        Some(Ok(())) => return Ok(()),
        Some(Err(e)) if !unsupported(&e) => return Err(e),
        _ => {}
    }
    let meta = fs::symlink_metadata(from)?;
    if meta.is_file() {
        match fs::hard_link(from, to) {
            Ok(()) => {
                if let Err(e) = fs::remove_file(from) {
                    let _ = fs::remove_file(to); // keep exactly one name
                    return Err(e);
                }
                return Ok(());
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(e),
            Err(e) if e.kind() == io::ErrorKind::CrossesDevices => return Err(e),
            Err(_) => {} // no hard links here (FAT, exFAT, some network shares)
        }
    }
    if fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "The target exists",
        ));
    }
    fs::rename(from, to)
}

/// The flag is not supported by this file system or kernel.
#[allow(dead_code)]
fn unsupported(e: &io::Error) -> bool {
    #[cfg(unix)]
    {
        matches!(
            e.raw_os_error(),
            Some(libc::EINVAL) | Some(libc::ENOSYS) | Some(libc::ENOTSUP)
        )
    }
    #[cfg(not(unix))]
    {
        let _ = e;
        true
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn native_noreplace(from: &Path, to: &Path) -> Option<io::Result<()>> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let (Ok(f), Ok(t)) = (
        CString::new(from.as_os_str().as_bytes()),
        CString::new(to.as_os_str().as_bytes()),
    ) else {
        return Some(Err(io::Error::from(io::ErrorKind::InvalidInput)));
    };
    // SAFETY: two valid NUL-terminated paths, AT_FDCWD for both
    let r = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            f.as_ptr(),
            libc::AT_FDCWD,
            t.as_ptr(),
            libc::RENAME_NOREPLACE as _,
        )
    };
    Some(if r == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    })
}

#[cfg(target_os = "macos")]
fn native_noreplace(from: &Path, to: &Path) -> Option<io::Result<()>> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let (Ok(f), Ok(t)) = (
        CString::new(from.as_os_str().as_bytes()),
        CString::new(to.as_os_str().as_bytes()),
    ) else {
        return Some(Err(io::Error::from(io::ErrorKind::InvalidInput)));
    };
    // SAFETY: two valid NUL-terminated paths
    let r = unsafe { libc::renamex_np(f.as_ptr(), t.as_ptr(), libc::RENAME_EXCL) };
    Some(if r == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    })
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
fn native_noreplace(_from: &Path, _to: &Path) -> Option<io::Result<()>> {
    None
}

/// Identity of a file system entry (device + inode) – to notice that a path
/// now names another entry than at planning time (e.g. a folder replaced by a
/// link). `None` where std offers no stable id (Windows).
pub fn file_id(meta: &Metadata) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some((meta.dev(), meta.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        None
    }
}

/// Makes a write-protected entry writable for its owner only (Unix: `u+w`, never
/// world-writable); Windows: clears the read-only attribute.
pub fn make_writable(path: &Path, meta: &Metadata) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode() | 0o200;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
    }
    #[cfg(not(unix))]
    {
        let mut perm = meta.permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        fs::set_permissions(path, perm)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn rename_noreplace_never_replaces() {
        let t = tempdir().unwrap();
        let (a, b) = (t.path().join("a"), t.path().join("b"));
        fs::write(&a, "A").unwrap();
        fs::write(&b, "B").unwrap();
        assert_eq!(
            rename_noreplace(&a, &b).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read_to_string(&b).unwrap(), "B");
        fs::create_dir(t.path().join("d")).unwrap();
        assert!(rename_noreplace(&t.path().join("d"), &b).is_err());
        rename_noreplace(&a, &t.path().join("c")).unwrap();
        assert!(!a.exists());
        rename_noreplace(&t.path().join("d"), &t.path().join("e")).unwrap();
        assert!(t.path().join("e").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn make_writable_adds_owner_write_only() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempdir().unwrap();
        let d = t.path().join("d");
        fs::create_dir(&d).unwrap();
        fs::set_permissions(&d, fs::Permissions::from_mode(0o555)).unwrap();
        make_writable(&d, &fs::metadata(&d).unwrap()).unwrap();
        assert_eq!(
            fs::metadata(&d).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }
}
