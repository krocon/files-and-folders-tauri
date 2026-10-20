//! System calls of "change attributes" (design 024 E4/E6), one signature per OS.
//! Nothing here follows a link.
//!
//! Unix (external review #4): the walk holds a descriptor of every folder it is
//! in ([`Dir`]) and works relative to it – `fstatat`, `openat(O_NOFOLLOW |
//! O_DIRECTORY)` (and the opened folder must be the one `fstatat` saw: device +
//! inode), `fdopendir`, `fchmodat`/`utimensat(AT_SYMLINK_NOFOLLOW)`,
//! `setattrlistat(FSOPT_NOFOLLOW)` (macOS: hidden flag, creation time). A folder
//! swapped for a link after it was looked at is never entered, and no folder on the
//! way is resolved again by name. The entry itself is never opened, so files
//! without read permission and FIFOs work, too.
//!
//! Windows (external review #4/#7): one handle on the entry itself
//! (`FILE_FLAG_OPEN_REPARSE_POINT`, std adds `\\?\` for long paths), attributes
//! and times in one `SetFileInformationByHandle(FileBasicInfo)`.

use std::ffi::{OsStr, OsString};
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

/// What an entry is, seen without following a link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Dir,
    /// A symbolic link (Windows: also a junction).
    Link,
    Other,
}

/// What the walk needs to know about an entry (links not followed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stat {
    pub kind: Kind,
    /// Unix permission bits incl. setuid/setgid/sticky (0 on Windows).
    pub mode: u32,
    /// Device and inode (Unix; 0 on Windows – a mount point there is a junction, i.e. a link).
    pub dev: u64,
    pub ino: u64,
    /// Windows attribute word (0 elsewhere).
    pub attrs: u32,
    /// macOS `st_flags` (0 elsewhere).
    pub flags: u32,
}

impl Stat {
    pub fn id(&self) -> (u64, u64) {
        (self.dev, self.ino)
    }
}

/// One change of one entry; `mode: None` = permissions unchanged.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Apply {
    pub mode: Option<u32>,
    pub flags: Flags,
    pub times: Times,
}

impl Apply {
    pub fn is_empty(&self) -> bool {
        self.mode.is_none() && self.flags.is_empty() && self.times.is_empty()
    }
}

/// The error for "this is a link (now)" – the caller reports `symlink_skipped`.
fn is_link() -> io::Error {
    io::Error::from(io::ErrorKind::Unsupported)
}

/// "Another entry than the one looked at" (swapped meanwhile).
#[cfg_attr(not(unix), allow(dead_code))]
fn changed() -> io::Error {
    io::Error::other("The entry was replaced while it was being changed")
}

#[cfg(unix)]
pub use unix::Dir;

#[cfg(unix)]
mod unix {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::{OsStrExt, OsStringExt};

    fn c_name(name: &OsStr) -> io::Result<CString> {
        CString::new(name.as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
    }

    fn check(rc: libc::c_int) -> io::Result<()> {
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn errno() -> *mut libc::c_int {
        // SAFETY: returns the calling thread's errno location
        unsafe { libc::__errno_location() }
    }

    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
    fn errno() -> *mut libc::c_int {
        // SAFETY: returns the calling thread's errno location
        unsafe { libc::__error() }
    }

    // mode_t, dev_t and ino_t differ per OS (u16/u32, i32/u64)
    #[allow(clippy::useless_conversion, clippy::unnecessary_cast)]
    fn stat_of(st: &libc::stat) -> Stat {
        let kind = match st.st_mode & libc::S_IFMT {
            libc::S_IFDIR => Kind::Dir,
            libc::S_IFLNK => Kind::Link,
            _ => Kind::Other,
        };
        #[cfg(target_os = "macos")]
        let flags = st.st_flags;
        #[cfg(not(target_os = "macos"))]
        let flags = 0;
        Stat {
            kind,
            mode: u32::from(st.st_mode) & crate::attributes::MODE_MASK,
            dev: st.st_dev as u64,
            ino: st.st_ino as u64,
            attrs: 0,
            flags,
        }
    }

    /// An open folder; everything below it is reached relative to it.
    pub struct Dir {
        fd: OwnedFd,
    }

    impl Dir {
        fn from_raw(fd: libc::c_int) -> io::Result<Dir> {
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: fd was just opened and is owned by nobody else
            Ok(Dir {
                fd: unsafe { OwnedFd::from_raw_fd(fd) },
            })
        }

        /// The folder that holds selected entries, by its path (the folder the
        /// panel lists – a linked folder on the way is meant). Only used as the
        /// base of `*at` calls, so Linux needs no read permission (`O_PATH`).
        pub fn open(path: &Path) -> io::Result<Dir> {
            let c = c_name(path.as_os_str())?;
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let flags = libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC;
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC;
            // SAFETY: c is a valid NUL-terminated path for the call
            Dir::from_raw(unsafe { libc::open(c.as_ptr(), flags) })
        }

        /// The entry `name` in this folder (`fstatat`, link not followed).
        pub fn stat(&self, name: &OsStr) -> io::Result<Stat> {
            let c = c_name(name)?;
            // SAFETY: an all-zero stat is valid; it is filled by the call
            let mut st: libc::stat = unsafe { std::mem::zeroed() };
            // SAFETY: fd is open, c and st live for the call
            check(unsafe {
                libc::fstatat(
                    self.fd.as_raw_fd(),
                    c.as_ptr(),
                    &mut st,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            })?;
            Ok(stat_of(&st))
        }

        /// Opens the sub-folder `name` – never through a link (`O_NOFOLLOW`), and
        /// only if it is still the folder `seen` describes (device + inode).
        pub fn open_child(&self, name: &OsStr, seen: &Stat) -> io::Result<Dir> {
            let c = c_name(name)?;
            let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
            // SAFETY: fd is open, c lives for the call
            let dir = match Dir::from_raw(unsafe {
                libc::openat(self.fd.as_raw_fd(), c.as_ptr(), flags)
            }) {
                Ok(d) => d,
                // a link (ELOOP) or no folder any more (ENOTDIR): swapped meanwhile
                Err(e) if matches!(e.raw_os_error(), Some(libc::ELOOP | libc::ENOTDIR)) => {
                    return Err(is_link());
                }
                Err(e) => return Err(e),
            };
            // SAFETY: as above
            let mut st: libc::stat = unsafe { std::mem::zeroed() };
            // SAFETY: the new fd is open, st lives for the call
            check(unsafe { libc::fstat(dir.fd.as_raw_fd(), &mut st) })?;
            if stat_of(&st).id() != seen.id() {
                return Err(changed());
            }
            Ok(dir)
        }

        /// The names in this folder (without `.` and `..`).
        pub fn names(&self) -> io::Result<Vec<OsString>> {
            // fdopendir takes over a descriptor of its own (closedir closes it)
            // SAFETY: fd is open
            let dup = unsafe { libc::fcntl(self.fd.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
            if dup < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: dup is an open descriptor of a folder
            let dir = unsafe { libc::fdopendir(dup) };
            if dir.is_null() {
                let e = io::Error::last_os_error();
                // SAFETY: dup is still ours when fdopendir failed
                unsafe { libc::close(dup) };
                return Err(e);
            }
            let mut names = Vec::new();
            let result = loop {
                // SAFETY: errno is the calling thread's; reset to tell end from error
                unsafe { *errno() = 0 };
                // SAFETY: dir is an open DIR stream
                let ent = unsafe { libc::readdir(dir) };
                if ent.is_null() {
                    // SAFETY: as above
                    let err = unsafe { *errno() };
                    break if err == 0 {
                        Ok(())
                    } else {
                        Err(io::Error::from_raw_os_error(err))
                    };
                }
                // SAFETY: d_name of a returned entry is NUL-terminated
                let name = unsafe { CStr::from_ptr((*ent).d_name.as_ptr()) }.to_bytes();
                if name != b"." && name != b".." {
                    names.push(OsString::from_vec(name.to_vec()));
                }
            };
            // SAFETY: dir is open; closing it closes dup
            unsafe { libc::closedir(dir) };
            result.map(|()| names)
        }

        /// Changes the entry `name` (no link: `seen` says so, the calls do not follow one).
        /// Order: flags, permissions, times – setting the times last keeps them.
        pub fn apply(&self, name: &OsStr, seen: &Stat, a: &Apply) -> io::Result<()> {
            let c = c_name(name)?;
            if !a.flags.is_empty() {
                self.set_flags(&c, seen, &a.flags)?;
            }
            if let Some(mode) = a.mode {
                self.set_mode(&c, mode)?;
            }
            if !a.times.is_empty() {
                self.set_times(&c, &a.times)?;
            }
            Ok(())
        }

        fn set_mode(&self, c: &CStr, mode: u32) -> io::Result<()> {
            let fd = self.fd.as_raw_fd();
            // SAFETY: fd is open, c lives for the call
            let rc = unsafe {
                libc::fchmodat(
                    fd,
                    c.as_ptr(),
                    mode as libc::mode_t,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            match check(rc) {
                #[cfg(target_os = "linux")]
                Err(e) if e.raw_os_error() == Some(libc::EOPNOTSUPP) => {
                    // a link (Linux cannot change its mode) – or a glibc older than 2.32
                    // without the flag: then without it, but only if it is still no link
                    let mut st: libc::stat = unsafe { std::mem::zeroed() };
                    // SAFETY: fd is open, c and st live for the call
                    check(unsafe {
                        libc::fstatat(fd, c.as_ptr(), &mut st, libc::AT_SYMLINK_NOFOLLOW)
                    })?;
                    if stat_of(&st).kind == Kind::Link {
                        return Err(is_link());
                    }
                    // SAFETY: as above
                    check(unsafe { libc::fchmodat(fd, c.as_ptr(), mode as libc::mode_t, 0) })
                }
                other => other,
            }
        }

        fn set_times(&self, c: &CStr, t: &Times) -> io::Result<()> {
            if t.accessed.is_some() || t.modified.is_some() {
                let omit = || {
                    // SAFETY: an all-zero timespec is valid
                    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
                    ts.tv_nsec = libc::UTIME_OMIT;
                    ts
                };
                let times = [
                    t.accessed.map_or_else(omit, timespec),
                    t.modified.map_or_else(omit, timespec),
                ];
                // SAFETY: fd is open; c and times live for the call; times has the two entries
                check(unsafe {
                    libc::utimensat(
                        self.fd.as_raw_fd(),
                        c.as_ptr(),
                        times.as_ptr(),
                        libc::AT_SYMLINK_NOFOLLOW,
                    )
                })?;
            }
            if let Some(created) = t.created {
                self.set_created(c, created)?;
            }
            Ok(())
        }

        /// macOS: one common attribute (`setattrlistat`, link not followed).
        #[cfg(target_os = "macos")]
        fn set_attr<T>(&self, c: &CStr, attr: libc::attrgroup_t, value: &mut T) -> io::Result<()> {
            // SAFETY: an all-zero attrlist is valid; the fields that matter are set below
            let mut list: libc::attrlist = unsafe { std::mem::zeroed() };
            list.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
            list.commonattr = attr;
            // SAFETY: fd is open; c, list and value live for the call; the buffer holds one value
            check(unsafe {
                libc::setattrlistat(
                    self.fd.as_raw_fd(),
                    c.as_ptr(),
                    (&mut list as *mut libc::attrlist).cast(),
                    (value as *mut T).cast(),
                    std::mem::size_of::<T>(),
                    libc::FSOPT_NOFOLLOW,
                )
            })
        }

        #[cfg(target_os = "macos")]
        fn set_created(&self, c: &CStr, t: SystemTime) -> io::Result<()> {
            let mut ts = timespec(t);
            self.set_attr(c, libc::ATTR_CMN_CRTIME, &mut ts)
        }

        #[cfg(not(target_os = "macos"))]
        fn set_created(&self, _c: &CStr, _t: SystemTime) -> io::Result<()> {
            // validated before (Linux cannot set a birth time)
            Err(io::Error::from(io::ErrorKind::Unsupported))
        }

        /// macOS: "hidden" (`UF_HIDDEN` through `ATTR_CMN_FLAGS`); the other flags are
        /// Windows-only (validated before).
        #[cfg(target_os = "macos")]
        fn set_flags(&self, c: &CStr, seen: &Stat, f: &Flags) -> io::Result<()> {
            let Some(hidden) = f.hidden else {
                return Ok(());
            };
            let current = seen.flags;
            let mut flags: u32 = if hidden {
                current | libc::UF_HIDDEN
            } else {
                current & !libc::UF_HIDDEN
            };
            if flags == current {
                return Ok(());
            }
            self.set_attr(c, libc::ATTR_CMN_FLAGS, &mut flags)
        }

        #[cfg(not(target_os = "macos"))]
        fn set_flags(&self, _c: &CStr, _seen: &Stat, f: &Flags) -> io::Result<()> {
            if f.is_empty() {
                Ok(())
            } else {
                Err(io::Error::from(io::ErrorKind::Unsupported)) // validated before
            }
        }
    }

    /// `timespec` of a time (negative = before 1970).
    pub(super) fn timespec(t: SystemTime) -> libc::timespec {
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
}

#[cfg(unix)]
#[cfg(test)]
use unix::timespec;

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

/// 100-ns intervals since 1601-01-01 (Windows `FILETIME`, pure). 0 means "leave
/// unchanged" to `SetFileInformationByHandle` – the earliest settable time is
/// therefore 1 ms after 1601-01-01 (`attributes::MIN_MS`, external review #6).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn filetime(t: SystemTime) -> i64 {
    const UNIX_EPOCH_AS_FILETIME: i128 = 116_444_736_000_000_000;
    let nanos: i128 = match t.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i128,
        Err(e) => -(e.duration().as_nanos() as i128),
    };
    // floor division: 1 ns before an interval belongs to the interval before
    (UNIX_EPOCH_AS_FILETIME + nanos.div_euclid(100)) as i64
}

#[cfg(windows)]
pub use windows::Dir;

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    use std::path::PathBuf;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_BASIC_INFO, FileBasicInfo, GetFileInformationByHandleEx, SetFileInformationByHandle,
    };

    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const FILE_WRITE_ATTRIBUTES: u32 = 0x100;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    /// A folder by its path (Windows has no `*at` calls in its documented API);
    /// every change goes through a handle on the entry itself.
    pub struct Dir {
        path: PathBuf,
    }

    impl Dir {
        pub fn open(path: &Path) -> io::Result<Dir> {
            if !std::fs::metadata(path)?.is_dir() {
                return Err(io::Error::from(io::ErrorKind::NotADirectory));
            }
            Ok(Dir {
                path: path.to_path_buf(),
            })
        }

        pub fn stat(&self, name: &OsStr) -> io::Result<Stat> {
            let m = std::fs::symlink_metadata(self.path.join(name))?;
            // std counts symbolic links and junctions as links
            let kind = if m.file_type().is_symlink() {
                Kind::Link
            } else if m.is_dir() {
                Kind::Dir
            } else {
                Kind::Other
            };
            Ok(Stat {
                kind,
                mode: 0,
                dev: 0,
                ino: 0,
                attrs: m.file_attributes(),
                flags: 0,
            })
        }

        pub fn open_child(&self, name: &OsStr, _seen: &Stat) -> io::Result<Dir> {
            if self.stat(name)?.kind != Kind::Dir {
                return Err(is_link());
            }
            Ok(Dir {
                path: self.path.join(name),
            })
        }

        pub fn names(&self) -> io::Result<Vec<OsString>> {
            std::fs::read_dir(&self.path)?
                .map(|e| e.map(|e| e.file_name()))
                .collect()
        }

        /// Attributes and times in one call on a handle of the entry itself.
        pub fn apply(&self, name: &OsStr, seen: &Stat, a: &Apply) -> io::Result<()> {
            if a.mode.is_some() {
                // validated before; not `Unsupported` – that reads as "a link"
                return Err(io::Error::from(io::ErrorKind::InvalidInput));
            }
            if a.flags.is_empty() && a.times.is_empty() {
                return Ok(());
            }
            let file = std::fs::OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(self.path.join(name))?;
            let handle = file.as_raw_handle() as _;
            let mut info = FILE_BASIC_INFO::default();
            let size = std::mem::size_of::<FILE_BASIC_INFO>() as u32;
            // SAFETY: the handle is open; info is a FILE_BASIC_INFO of `size` bytes
            if unsafe {
                GetFileInformationByHandleEx(
                    handle,
                    FileBasicInfo,
                    (&mut info as *mut FILE_BASIC_INFO).cast(),
                    size,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            // a link or junction swapped in since `seen` – never changed
            if (info.FileAttributes ^ seen.attrs) & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return Err(is_link());
            }
            let ft = |t: Option<SystemTime>| t.map_or(0, filetime); // 0 = unchanged
            let next = FILE_BASIC_INFO {
                CreationTime: ft(a.times.created),
                LastAccessTime: ft(a.times.accessed),
                LastWriteTime: ft(a.times.modified),
                ChangeTime: 0,
                FileAttributes: win_attributes(info.FileAttributes, &a.flags).unwrap_or(0),
            };
            if next.FileAttributes == 0 && a.times.is_empty() {
                return Ok(()); // the attributes are already as asked
            }
            // SAFETY: the handle is open; next is a FILE_BASIC_INFO of `size` bytes
            if unsafe {
                SetFileInformationByHandle(
                    handle,
                    FileBasicInfo,
                    (&next as *const FILE_BASIC_INFO).cast(),
                    size,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }
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

    #[test]
    fn filetime_counts_from_1601_and_never_hits_zero() {
        use std::time::Duration;
        assert_eq!(filetime(SystemTime::UNIX_EPOCH), 116_444_736_000_000_000);
        assert_eq!(
            filetime(SystemTime::UNIX_EPOCH + Duration::from_millis(1)),
            116_444_736_000_010_000
        );
        assert_eq!(
            filetime(SystemTime::UNIX_EPOCH - Duration::from_nanos(150)),
            116_444_735_999_999_998
        );
        // the earliest time the dialog accepts is no "leave unchanged" (0)
        let min = crate::attributes::time_of_ms(crate::attributes::MIN_MS);
        assert_eq!(filetime(min), 10_000, "1 ms after 1601-01-01");
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

    /// External review #4: a folder swapped for a link (or another folder) after
    /// it was looked at is never opened; no change follows a link.
    #[cfg(unix)]
    #[test]
    fn a_folder_swapped_after_the_look_is_not_entered() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let d = tempfile::tempdir().unwrap();
        let outside = d.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o700)).unwrap();
        let sub = d.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let dir = Dir::open(d.path()).unwrap();
        let name = OsStr::new("sub");
        let seen = dir.stat(name).unwrap();
        assert_eq!(seen.kind, Kind::Dir);
        // swapped: a link to another folder
        std::fs::remove_dir(&sub).unwrap();
        symlink(&outside, &sub).unwrap();
        let err = dir.open_child(name, &seen).err().unwrap();
        assert_eq!(err.kind(), io::ErrorKind::Unsupported, "{err}");
        let now = dir.stat(name).unwrap();
        assert_eq!(now.kind, Kind::Link);
        let a = Apply {
            mode: Some(0o777),
            ..Apply::default()
        };
        assert!(dir.apply(name, &now, &a).is_err(), "no mode on a link");
        let mode = std::fs::metadata(&outside).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "the link's target is untouched");
        // swapped: another folder under the same name
        std::fs::remove_file(&sub).unwrap();
        std::fs::create_dir(&sub).unwrap();
        let keep = d.path().join("keep-inode-busy");
        std::fs::create_dir(&keep).unwrap();
        let fresh = dir.stat(name).unwrap();
        if fresh.id() != seen.id() {
            assert!(dir.open_child(name, &seen).is_err(), "another folder");
        }
        assert!(dir.open_child(name, &fresh).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn names_of_a_folder_with_unicode_and_without_dot_entries() {
        let d = tempfile::tempdir().unwrap();
        for n in ["a b", "Ünï 🎉", ".hidden"] {
            std::fs::write(d.path().join(n), "").unwrap();
        }
        let parent = Dir::open(d.path().parent().unwrap()).unwrap();
        let name = d.path().file_name().unwrap();
        let seen = parent.stat(name).unwrap();
        let mut names = parent.open_child(name, &seen).unwrap().names().unwrap();
        names.sort();
        let mut want: Vec<OsString> = ["a b", "Ünï 🎉", ".hidden"].map(OsString::from).into();
        want.sort();
        assert_eq!(names, want);
    }
}
