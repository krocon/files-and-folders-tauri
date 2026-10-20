//! System calls of "change attributes" (design 024 E4/E6), one signature per OS.
//! Nothing here follows a link: Unix works on paths with `AT_SYMLINK_NOFOLLOW`
//! (`fchmodat`, `utimensat`), `lchflags` and `FSOPT_NOFOLLOW` (macOS); Windows opens
//! with `FILE_FLAG_OPEN_REPARSE_POINT`. Unix never opens the entry, so files
//! without read permission and FIFOs work, too.

use std::fs::Metadata;
use std::io;
use std::path::Path;
use std::time::SystemTime;

/// Attributes to set (`Some(true)`), clear (`Some(false)`) or leave (`None`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags {
    pub readonly: Option<bool>,
    pub hidden: Option<bool>,
    pub system: Option<bool>,
    pub archive: Option<bool>,
}

impl Flags {
    pub fn is_empty(&self) -> bool {
        self.readonly.is_none()
            && self.hidden.is_none()
            && self.system.is_none()
            && self.archive.is_none()
    }
}

/// New times (`None` = unchanged).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Times {
    pub accessed: Option<SystemTime>,
    pub modified: Option<SystemTime>,
    pub created: Option<SystemTime>,
}

impl Times {
    pub fn is_empty(&self) -> bool {
        self.accessed.is_none() && self.modified.is_none() && self.created.is_none()
    }
}

#[cfg(unix)]
fn c_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
}

#[cfg(unix)]
fn check(rc: libc::c_int) -> io::Result<()> {
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// `timespec` of a time (negative = before 1970).
#[cfg(unix)]
fn timespec(t: SystemTime) -> libc::timespec {
    let (secs, nanos) = match t.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => (d.as_secs() as i64, d.subsec_nanos()),
        Err(e) => {
            let d = e.duration();
            let (s, n) = (-(d.as_secs() as i64), d.subsec_nanos());
            if n == 0 {
                (s, 0)
            } else {
                (s - 1, 1_000_000_000 - n)
            }
        }
    };
    // SAFETY: an all-zero timespec is valid; fields set below (portable to layouts with padding)
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    ts.tv_sec = secs as libc::time_t;
    ts.tv_nsec = nanos as libc::c_long;
    ts
}

/// Sets the permission bits of an entry that is no link (`lstat` said so).
/// A link (swapped in since then) is never followed: `ErrorKind::Unsupported`.
#[cfg(unix)]
pub fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    let c = c_path(path)?;
    // SAFETY: c is a valid NUL-terminated path for the duration of the call
    let rc = unsafe {
        libc::fchmodat(
            libc::AT_FDCWD,
            c.as_ptr(),
            mode as libc::mode_t,
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    match check(rc) {
        #[cfg(target_os = "linux")]
        Err(e) if e.raw_os_error() == Some(libc::EOPNOTSUPP) => {
            // a link (Linux cannot change its mode) – or a glibc older than 2.32
            // without the flag: then a plain chmod, but only if it is still no link
            if std::fs::symlink_metadata(path)?.file_type().is_symlink() {
                return Err(io::Error::from(io::ErrorKind::Unsupported));
            }
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        }
        other => other,
    }
}

/// Sets access/modification time (Unix) – and the creation time on macOS.
#[cfg(unix)]
pub fn set_times(path: &Path, t: &Times) -> io::Result<()> {
    let c = c_path(path)?;
    if t.accessed.is_some() || t.modified.is_some() {
        let omit = || {
            // SAFETY: as in `timespec`
            let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
            ts.tv_nsec = libc::UTIME_OMIT;
            ts
        };
        let times = [
            t.accessed.map_or_else(omit, timespec),
            t.modified.map_or_else(omit, timespec),
        ];
        // SAFETY: c and times live for the call; times has the two entries utimensat reads
        check(unsafe {
            libc::utimensat(
                libc::AT_FDCWD,
                c.as_ptr(),
                times.as_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        })?;
    }
    if let Some(created) = t.created {
        set_created(&c, created)?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_created(c: &std::ffi::CStr, t: SystemTime) -> io::Result<()> {
    // SAFETY: an all-zero attrlist is valid; the fields that matter are set below
    let mut list: libc::attrlist = unsafe { std::mem::zeroed() };
    list.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    list.commonattr = libc::ATTR_CMN_CRTIME;
    let mut ts = timespec(t);
    // SAFETY: path, list and buffer live for the call; the buffer holds exactly one timespec
    check(unsafe {
        libc::setattrlist(
            c.as_ptr(),
            (&mut list as *mut libc::attrlist).cast(),
            (&mut ts as *mut libc::timespec).cast(),
            std::mem::size_of::<libc::timespec>(),
            libc::FSOPT_NOFOLLOW,
        )
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn set_created(_c: &std::ffi::CStr, _t: SystemTime) -> io::Result<()> {
    // the change is validated before (Linux cannot set a birth time)
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

/// macOS: "hidden" (`UF_HIDDEN`, `lchflags`); the other flags are Windows-only (validated before).
#[cfg(target_os = "macos")]
pub fn set_flags(path: &Path, meta: &Metadata, f: &Flags) -> io::Result<()> {
    use std::os::macos::fs::MetadataExt;
    let Some(hidden) = f.hidden else {
        return Ok(());
    };
    let current = meta.st_flags();
    let flags = if hidden {
        current | libc::UF_HIDDEN
    } else {
        current & !libc::UF_HIDDEN
    };
    if flags == current {
        return Ok(());
    }
    let c = c_path(path)?;
    // SAFETY: c is a valid NUL-terminated path for the duration of the call
    check(unsafe { libc::lchflags(c.as_ptr(), flags) })
}

/// macOS: `UF_HIDDEN` of an entry (properties, design 024 E9).
#[cfg(target_os = "macos")]
pub fn flags_hidden(meta: &Metadata) -> Option<bool> {
    use std::os::macos::fs::MetadataExt;
    Some(meta.st_flags() & libc::UF_HIDDEN != 0)
}

#[cfg(not(target_os = "macos"))]
pub fn flags_hidden(_meta: &Metadata) -> Option<bool> {
    None
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn set_flags(_path: &Path, _meta: &Metadata, f: &Flags) -> io::Result<()> {
    if f.is_empty() {
        Ok(())
    } else {
        Err(io::Error::from(io::ErrorKind::Unsupported)) // validated before
    }
}

/// Windows attributes that `SetFileAttributesW` accepts.
const SETTABLE: u32 = 0x1 // READONLY
    | 0x2 // HIDDEN
    | 0x4 // SYSTEM
    | 0x20 // ARCHIVE
    | 0x100 // TEMPORARY
    | 0x1000 // OFFLINE
    | 0x2000; // NOT_CONTENT_INDEXED

/// The Windows attribute word after the change (pure; `None` = nothing changes).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn win_attributes(current: u32, f: &Flags) -> Option<u32> {
    const NORMAL: u32 = 0x80;
    let mut next = current & SETTABLE;
    for (flag, bit) in [
        (f.readonly, 0x1),
        (f.hidden, 0x2),
        (f.system, 0x4),
        (f.archive, 0x20),
    ] {
        match flag {
            Some(true) => next |= bit,
            Some(false) => next &= !bit,
            None => {}
        }
    }
    if next == current & SETTABLE {
        None
    } else if next == 0 {
        Some(NORMAL) // "no attributes" must be said this way
    } else {
        Some(next)
    }
}

#[cfg(windows)]
pub fn set_flags(path: &Path, meta: &Metadata, f: &Flags) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::SetFileAttributesW;
    let Some(attrs) = win_attributes(meta.file_attributes(), f) else {
        return Ok(());
    };
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: wide is NUL-terminated and lives for the call
    if unsafe { SetFileAttributesW(wide.as_ptr(), attrs) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// Windows: all three times through one handle on the entry itself (folders need
/// backup semantics; a reparse point is opened, never its target).
#[cfg(windows)]
pub fn set_times(path: &Path, t: &Times) -> io::Result<()> {
    use std::os::windows::fs::{FileTimesExt, OpenOptionsExt};
    const FILE_WRITE_ATTRIBUTES: u32 = 0x100;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_WRITE_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let mut times = std::fs::FileTimes::new();
    if let Some(a) = t.accessed {
        times = times.set_accessed(a);
    }
    if let Some(m) = t.modified {
        times = times.set_modified(m);
    }
    if let Some(c) = t.created {
        times = times.set_created(c);
    }
    file.set_times(times)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_attribute_word() {
        let f = |readonly, hidden, system, archive| Flags {
            readonly,
            hidden,
            system,
            archive,
        };
        // archive + directory bit (0x10, not settable): set hidden
        assert_eq!(
            win_attributes(0x30, &f(None, Some(true), None, None)),
            Some(0x22)
        );
        // nothing changes → no call
        assert_eq!(
            win_attributes(0x21, &f(Some(true), None, None, Some(true))),
            None
        );
        // clearing the last attribute → NORMAL
        assert_eq!(
            win_attributes(0x20, &f(None, None, None, Some(false))),
            Some(0x80)
        );
        // NORMAL alone counts as "no attributes"
        assert_eq!(
            win_attributes(0x80, &f(Some(true), None, Some(true), None)),
            Some(0x5)
        );
        // other settable bits stay (not content indexed)
        assert_eq!(
            win_attributes(0x2001, &f(Some(false), None, None, None)),
            Some(0x2000)
        );
    }

    #[cfg(unix)]
    #[test]
    fn timespec_before_1970_keeps_nanoseconds_positive() {
        use std::time::Duration;
        let t = SystemTime::UNIX_EPOCH - Duration::from_millis(1500);
        let ts = timespec(t);
        assert_eq!((ts.tv_sec, ts.tv_nsec), (-2, 500_000_000));
        let ts = timespec(SystemTime::UNIX_EPOCH + Duration::from_millis(2250));
        assert_eq!((ts.tv_sec, ts.tv_nsec), (2, 250_000_000));
    }
}
