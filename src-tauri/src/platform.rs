//! Platform functions with one signature per OS (CLAUDE.md §4).
//! Submodules: [`volumes`] (drives, mount points), [`desktop`] (file manager, terminal).

pub mod clock;
pub mod desktop;
pub mod io_hints;
pub mod os_drag;
pub mod process;
pub mod volumes;

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

/// Deletes `rel` below `root` – a file, or (`dir`) an empty folder after the
/// `junk` files directly inside it – without following a link in any path part
/// below `root` (review 008 #3). `rel` = "" means `root` itself, which then
/// must not be a link; `root` itself may be reached through a link otherwise
/// (the panel's path). Unix: every folder is opened with
/// `O_NOFOLLOW | O_DIRECTORY` relative to the previous one and the entry is
/// removed with `unlinkat` – a folder swapped for a link after the check makes
/// this fail instead of deleting elsewhere. Elsewhere: by path (the check right
/// before stays the only guard).
pub fn remove_below(
    root: &Path,
    rel: &Path,
    dir: bool,
    junk: &[std::ffi::OsString],
) -> io::Result<()> {
    use std::path::Component;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(n) => parts.push(n),
            _ => return Err(io::Error::from(io::ErrorKind::InvalidInput)),
        }
    }
    let (base, parts) = match parts.split_last() {
        Some(_) => (root, parts),
        None => match (root.parent(), root.file_name()) {
            (Some(p), Some(n)) => (p, vec![n]),
            _ => return Err(io::Error::from(io::ErrorKind::InvalidInput)),
        },
    };
    remove_at(base, &parts, dir, junk)
}

#[cfg(unix)]
fn remove_at(
    base: &Path,
    parts: &[&std::ffi::OsStr],
    dir: bool,
    junk: &[std::ffi::OsString],
) -> io::Result<()> {
    use std::ffi::{CString, OsStr};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::os::unix::ffi::OsStrExt;
    let c = |s: &OsStr| {
        CString::new(s.as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
    };
    let open = |at: RawFd, name: &CString, follow: bool| -> io::Result<OwnedFd> {
        let mut flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC;
        if !follow {
            flags |= libc::O_NOFOLLOW;
        }
        // SAFETY: a valid NUL-terminated name; the fd is checked and owned
        let fd = unsafe { libc::openat(at, name.as_ptr(), flags) };
        if fd < 0 {
            Err(io::Error::last_os_error())
        } else {
            // SAFETY: a fresh descriptor nobody else owns
            Ok(unsafe { OwnedFd::from_raw_fd(fd) })
        }
    };
    let unlink = |at: RawFd, name: &CString, flags: libc::c_int| -> io::Result<()> {
        // SAFETY: a valid descriptor and NUL-terminated name
        if unsafe { libc::unlinkat(at, name.as_ptr(), flags) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    };
    let (last, folders) = parts
        .split_last()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let mut cur = open(libc::AT_FDCWD, &c(base.as_os_str())?, true)?;
    for f in folders {
        cur = open(cur.as_raw_fd(), &c(f)?, false)?;
    }
    let name = c(last)?;
    if !dir {
        return unlink(cur.as_raw_fd(), &name, 0);
    }
    let inner = open(cur.as_raw_fd(), &name, false)?;
    for j in junk {
        // flags 0: never a folder; a link would only lose itself
        unlink(inner.as_raw_fd(), &c(j)?, 0)?;
    }
    drop(inner);
    unlink(cur.as_raw_fd(), &name, libc::AT_REMOVEDIR)
}

#[cfg(not(unix))]
fn remove_at(
    base: &Path,
    parts: &[&std::ffi::OsStr],
    dir: bool,
    junk: &[std::ffi::OsString],
) -> io::Result<()> {
    let mut path = base.to_path_buf();
    path.extend(parts);
    if !dir {
        return fs::remove_file(&path);
    }
    for j in junk {
        fs::remove_file(path.join(j))?;
    }
    fs::remove_dir(&path)
}

/// Opens a regular file for reading without ever blocking on it: Unix opens with
/// `O_NONBLOCK` (a FIFO or device swapped in after the listing does not hang),
/// then checks the opened handle (`fstat`) – anything but a regular file is
/// refused. Elsewhere: a plain open plus the same check.
pub fn open_regular_file(path: &Path) -> io::Result<fs::File> {
    open_regular(path, false)
}

/// [`open_regular_file`] that also refuses a link as the last component (Unix
/// `O_NOFOLLOW`): packing must not follow a link swapped in after the planning
/// (review 016 #5). Windows: a plain open (links were reported at planning).
pub fn open_regular_file_no_follow(path: &Path) -> io::Result<fs::File> {
    open_regular(path, true)
}

fn open_regular(path: &Path, no_follow: bool) -> io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut flags = libc::O_NONBLOCK | libc::O_NOCTTY;
        if no_follow {
            flags |= libc::O_NOFOLLOW;
        }
        options.custom_flags(flags);
    }
    #[cfg(not(unix))]
    let _ = no_follow;
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    Ok(file)
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

/// What tells an entry apart from a new one under the same name later (undo,
/// design 007 review R1). Unix: device + inode + birth time (inode numbers are
/// reused at once after a delete; without a birth time – file system or kernel
/// without `statx` btime – device + inode alone). Elsewhere (Windows – std
/// offers no stable file index): size + modification time as a fallback.
/// None of these change on a rename.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntryStamp(u64, u64, u128);

fn nanos(t: io::Result<std::time::SystemTime>) -> u128 {
    t.ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos())
}

pub fn entry_stamp(meta: &Metadata) -> EntryStamp {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        EntryStamp(meta.dev(), meta.ino(), nanos(meta.created()))
    }
    #[cfg(not(unix))]
    {
        EntryStamp(meta.len(), 0, nanos(meta.modified()))
    }
}

/// Number of hard links of an entry (`None` where std does not tell – Windows).
/// Two names of one inode look like "the same entry" to a case check.
pub fn link_count(meta: &Metadata) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(meta.nlink())
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

/// Calls a `get*_r` function with a buffer that doubles on `ERANGE` (up to 1 MiB).
#[cfg(unix)]
fn with_name_buffer(
    start: usize,
    mut call: impl FnMut(&mut [libc::c_char]) -> (libc::c_int, Option<String>),
) -> Option<String> {
    const MAX: usize = 1024 * 1024;
    let mut len = start.max(1);
    loop {
        let mut buf = vec![0 as libc::c_char; len];
        let (rc, name) = call(&mut buf);
        if rc == libc::ERANGE && len < MAX {
            len = (len * 2).min(MAX);
            continue;
        }
        return if rc == 0 { name } else { None };
    }
}

/// Login name of a user id (`getpwuid_r`), `None` if unknown.
#[cfg(unix)]
pub fn user_name(uid: u32) -> Option<String> {
    user_name_with(uid, 16 * 1024)
}

#[cfg(unix)]
fn user_name_with(uid: u32, start: usize) -> Option<String> {
    with_name_buffer(start, |buf| {
        // SAFETY: zeroed passwd is a valid out-parameter; buf outlives the read of pw_name
        let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let rc =
            unsafe { libc::getpwuid_r(uid, &mut pwd, buf.as_mut_ptr(), buf.len(), &mut result) };
        if rc != 0 || result.is_null() || pwd.pw_name.is_null() {
            return (rc, None);
        }
        // SAFETY: getpwuid_r succeeded, pw_name points into buf (NUL-terminated)
        let name = unsafe { std::ffi::CStr::from_ptr(pwd.pw_name) };
        (0, Some(name.to_string_lossy().into_owned()))
    })
}

/// Group name of a group id (`getgrgid_r`), `None` if unknown.
#[cfg(unix)]
pub fn group_name(gid: u32) -> Option<String> {
    group_name_with(gid, 16 * 1024)
}

#[cfg(unix)]
fn group_name_with(gid: u32, start: usize) -> Option<String> {
    with_name_buffer(start, |buf| {
        // SAFETY: as in `user_name_with`
        let mut grp: libc::group = unsafe { std::mem::zeroed() };
        let mut result: *mut libc::group = std::ptr::null_mut();
        let rc =
            unsafe { libc::getgrgid_r(gid, &mut grp, buf.as_mut_ptr(), buf.len(), &mut result) };
        if rc != 0 || result.is_null() || grp.gr_name.is_null() {
            return (rc, None);
        }
        // SAFETY: getgrgid_r succeeded, gr_name points into buf
        let name = unsafe { std::ffi::CStr::from_ptr(grp.gr_name) };
        (0, Some(name.to_string_lossy().into_owned()))
    })
}

/// Windows file attributes (`FILE_ATTRIBUTE_*`).
#[cfg(windows)]
pub fn file_attributes(meta: &Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Review 009 #6: a FIFO (or a device) never blocks the reader – it is refused.
    #[cfg(unix)]
    #[test]
    fn open_regular_file_refuses_fifos_without_blocking() {
        let t = tempdir().unwrap();
        let fifo = t.path().join("pipe");
        let c = std::ffi::CString::new(fifo.to_string_lossy().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        let start = std::time::Instant::now();
        assert!(open_regular_file(&fifo).is_err());
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
        let file = t.path().join("f.txt");
        fs::write(&file, b"abc").unwrap();
        let mut s = String::new();
        use std::io::Read;
        open_regular_file(&file)
            .unwrap()
            .read_to_string(&mut s)
            .unwrap();
        assert_eq!(s, "abc");
        assert!(open_regular_file(t.path()).is_err(), "a folder is no file");
    }

    /// Review 016 #5: packing never follows a link swapped in after planning.
    #[cfg(unix)]
    #[test]
    fn open_regular_file_no_follow_refuses_links() {
        let t = tempdir().unwrap();
        let secret = t.path().join("geheim.txt");
        fs::write(&secret, b"secret").unwrap();
        let file = t.path().join("datei.txt");
        fs::write(&file, b"abc").unwrap();
        assert!(open_regular_file_no_follow(&file).is_ok());
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&secret, &file).unwrap();
        assert!(open_regular_file_no_follow(&file).is_err());
        assert!(
            open_regular_file(&file).is_ok(),
            "the plain open still follows"
        );
    }

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

    #[test]
    fn entry_stamp_survives_a_rename_but_not_a_replacement() {
        let t = tempdir().unwrap();
        let (a, b) = (t.path().join("a"), t.path().join("b"));
        fs::write(&a, "A").unwrap();
        let before = entry_stamp(&fs::symlink_metadata(&a).unwrap());
        fs::rename(&a, &b).unwrap();
        assert_eq!(entry_stamp(&fs::symlink_metadata(&b).unwrap()), before);
        fs::remove_file(&b).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&b, "neu!").unwrap(); // may get the same inode number
        assert_ne!(entry_stamp(&fs::symlink_metadata(&b).unwrap()), before);
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

    /// Review 008 #3: a folder on the way swapped for a link after the check –
    /// the delete must not reach through it.
    #[cfg(unix)]
    #[test]
    fn remove_below_never_follows_a_link_on_the_way() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("start");
        let outside = t.path().join("outside");
        fs::create_dir_all(root.join("a/leer")).unwrap();
        fs::write(root.join("a/x.bak"), "x").unwrap();
        fs::create_dir_all(outside.join("leer")).unwrap();
        fs::write(outside.join("x.bak"), "keep").unwrap();
        fs::write(outside.join("leer/.DS_Store"), "keep").unwrap();
        // swap `a` for a link to `outside`
        fs::rename(root.join("a"), t.path().join("a old")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("a")).unwrap();
        let junk = [std::ffi::OsString::from(".DS_Store")];
        assert!(remove_below(&root, Path::new("a/x.bak"), false, &[]).is_err());
        assert!(remove_below(&root, Path::new("a/leer"), true, &junk).is_err());
        // the link itself is no folder to remove either
        assert!(remove_below(&root, Path::new("a"), true, &[]).is_err());
        assert!(outside.join("x.bak").exists());
        assert!(outside.join("leer/.DS_Store").exists());
        assert!(root.join("a").exists());
        // the real thing works: file, folder with junk, the start folder itself
        let real = t.path().join("a old");
        fs::write(real.join("leer/.DS_Store"), "x").unwrap();
        remove_below(&real, Path::new("x.bak"), false, &[]).unwrap();
        remove_below(&real, Path::new("leer"), true, &junk).unwrap();
        assert!(!real.join("x.bak").exists() && !real.join("leer").exists());
        remove_below(&real, Path::new(""), true, &[]).unwrap();
        assert!(!real.exists());
        // `..` or an absolute part is refused
        assert!(remove_below(&root, Path::new("../outside/x.bak"), false, &[]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn review6_names_grow_the_buffer_on_erange() {
        // 8 bytes are too small for any passwd/group record: ERANGE → retry
        assert_eq!(user_name_with(0, 8).as_deref(), Some("root"));
        let g = group_name_with(0, 8);
        assert!(g.is_some());
        assert_eq!(g, group_name(0));
        assert_eq!(user_name_with(u32::MAX - 7, 8), None);
    }
}
