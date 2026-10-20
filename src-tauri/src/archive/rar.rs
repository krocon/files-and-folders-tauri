//! RAR archives (design 025 E2/E3): a thin, safe layer over the UnRAR library
//! (`unrar-ng-sys`, vendored UnRAR C++ source, unRAR licence – `docs/licenses.md`).
//!
//! The only `unsafe` code of the archive module. Rules:
//! - the library never writes a file: data is only *tested* (`RAR_TEST`) and
//!   handed to our sink through the `UCM_PROCESSDATA` callback – names, links,
//!   targets and temporary files are ours (`jobs/extract.rs`);
//! - the password goes in only through `UCM_NEEDPASSWORDW` (wide characters,
//!   no ANSI code page) and is never logged;
//! - other volumes are never opened (`UCM_CHANGEVOLUME*` → abort), dictionaries
//!   above [`super::MAX_DICT`] are refused before any data is decoded;
//! - the callback never unwinds into C++ (`catch_unwind`), every handle is
//!   closed (`Drop`), and all calls into the library are serialised
//!   ([`LOCK`]): its error handler is a global object.

use super::secrets::Secret;
use super::{EntryType, MAX_DICT};
use crate::error::{FsError, FsErrorCode};
use std::os::raw::{c_int, c_uint};
use std::path::Path;
use std::sync::Mutex;
use unrar_ng_sys as ffi;

/// One call into the library at a time.
static LOCK: Mutex<()> = Mutex::new(());

const HOST_UNIX: c_uint = 3;
const S_IFMT: u32 = 0o170000;
const S_IFREG: u32 = 0o100000;
const S_IFDIR: u32 = 0o040000;
const S_IFLNK: u32 = 0o120000;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
/// Seconds between 1601-01-01 and 1970-01-01.
const FILETIME_UNIX_DIFF_MS: i64 = 11_644_473_600_000;

/// What the library tells about one entry.
#[derive(Debug, Clone)]
pub(crate) struct RarHeader {
    pub name: String,
    pub kind: EntryType,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub mode: Option<u32>,
    pub encrypted: bool,
    /// Part of a multi-volume archive (never extracted).
    pub split: bool,
    /// Dictionary size in bytes.
    pub dict: u64,
}

/// State the callback sees (behind the `UserData` pointer).
struct State {
    /// NUL-terminated wide password, if known.
    password: Option<Vec<ffi::WCHAR>>,
    /// The library asked for a password and none was known.
    password_missing: bool,
    /// Data sink of the entry being tested (a `*mut &mut dyn FnMut`), or null.
    sink: *mut std::ffi::c_void,
    /// The sink refused data (cancel, limit, write error).
    sink_stopped: bool,
}

type SinkFn<'a> = &'a mut dyn FnMut(&[u8]) -> bool;

extern "C" fn callback(
    msg: ffi::UINT,
    user: ffi::LPARAM,
    p1: ffi::LPARAM,
    p2: ffi::LPARAM,
) -> c_int {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // SAFETY: `user` is the `State` boxed in `RarArchive`, alive while its handle is
        // open; `p1`/`p2` are what UnRAR documents for each message.
        unsafe { on_message(msg, user, p1, p2) }
    }));
    r.unwrap_or(-1)
}

unsafe fn on_message(msg: ffi::UINT, user: ffi::LPARAM, p1: ffi::LPARAM, p2: ffi::LPARAM) -> c_int {
    if user == 0 {
        return -1;
    }
    // SAFETY: see `callback`.
    let state = unsafe { &mut *(user as *mut State) };
    match msg {
        ffi::UCM_PROCESSDATA => {
            if state.sink.is_null() {
                return 1;
            }
            let len = usize::try_from(p2).unwrap_or(0);
            let chunk: &[u8] = if len == 0 || p1 == 0 {
                &[]
            } else {
                // SAFETY: UnRAR passes `Count` valid bytes at `Addr`.
                unsafe { std::slice::from_raw_parts(p1 as *const u8, len) }
            };
            // SAFETY: `sink` points to a live `&mut dyn FnMut` during `RARProcessFileW`.
            let sink = unsafe { &mut *(state.sink as *mut SinkFn<'_>) };
            if sink(chunk) {
                1
            } else {
                state.sink_stopped = true;
                -1
            }
        }
        ffi::UCM_NEEDPASSWORDW => match &state.password {
            Some(pw) => {
                let cap = usize::try_from(p2).unwrap_or(0);
                if p1 == 0 || pw.len() > cap {
                    return -1;
                }
                // SAFETY: the buffer holds `cap` wide characters; `pw` ends with NUL.
                unsafe {
                    std::ptr::copy_nonoverlapping(pw.as_ptr(), p1 as *mut ffi::WCHAR, pw.len());
                }
                1
            }
            None => {
                state.password_missing = true;
                -1
            }
        },
        // the ANSI variant follows a refused wide request: never answer it
        ffi::UCM_NEEDPASSWORD => -1,
        // never open another volume, never accept a dictionary above the library limit
        ffi::UCM_CHANGEVOLUME | ffi::UCM_CHANGEVOLUMEW | ffi::UCM_LARGEDICT => -1,
        _ => 0,
    }
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<ffi::WCHAR> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
fn to_wide(s: &str) -> Vec<ffi::WCHAR> {
    s.chars()
        .map(|c| c as u32 as ffi::WCHAR)
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn from_wide(buf: &[ffi::WCHAR]) -> String {
    let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

#[cfg(not(windows))]
fn from_wide(buf: &[ffi::WCHAR]) -> String {
    buf.iter()
        .take_while(|c| **c != 0)
        .map(|c| char::from_u32(*c as u32).unwrap_or('\u{fffd}'))
        .collect()
}

fn rar_error(code: c_int, path: &Path, encrypted: bool) -> FsError {
    let (c, m) = match code {
        ffi::ERAR_MISSING_PASSWORD => (
            FsErrorCode::ArchivePasswordRequired,
            "The archive is encrypted – a password is needed",
        ),
        ffi::ERAR_BAD_PASSWORD => (FsErrorCode::ArchivePasswordWrong, "Wrong password"),
        // RAR 4 has no password check: a wrong one shows as broken data
        ffi::ERAR_BAD_DATA if encrypted => (
            FsErrorCode::ArchivePasswordWrong,
            "Wrong password (or a broken archive)",
        ),
        ffi::ERAR_NO_MEMORY => (FsErrorCode::ArchiveTooLarge, "Not enough memory to unpack"),
        ffi::ERAR_LARGE_DICT => (
            FsErrorCode::ArchiveTooLarge,
            "The archive needs a dictionary that is too large – refused",
        ),
        ffi::ERAR_EOPEN => (FsErrorCode::NotFound, "The archive cannot be opened"),
        ffi::ERAR_UNKNOWN_FORMAT => (
            FsErrorCode::ArchiveError,
            "Not a RAR archive (unknown format)",
        ),
        ffi::ERAR_EREFERENCE => (
            FsErrorCode::ArchiveError,
            "The entry refers to another one that is not available",
        ),
        _ => (FsErrorCode::ArchiveError, "Broken RAR archive"),
    };
    FsError::new(c, m, Some(path))
}

fn time_of(h: &ffi::HeaderDataEx) -> Option<i64> {
    let (lo, hi) = (h.mtime_low, h.mtime_high);
    let ft = (u64::from(hi) << 32) | u64::from(lo);
    if ft != 0 {
        return i64::try_from(ft / 10_000)
            .ok()
            .map(|ms| ms - FILETIME_UNIX_DIFF_MS);
    }
    super::dos_local_ms(h.file_time)
}

fn header_of(h: &ffi::HeaderDataEx) -> RarHeader {
    let flags = h.flags;
    let attr = h.file_attr;
    let host = h.host_os;
    let redir = h.redir_type;
    let unix = host == HOST_UNIX;
    let split = flags & (ffi::RHDF_SPLITBEFORE | ffi::RHDF_SPLITAFTER) != 0;
    let kind = if flags & ffi::RHDF_DIRECTORY != 0 {
        EntryType::Dir
    } else if redir != 0
        || (unix && attr & S_IFMT == S_IFLNK)
        || (!unix && attr & FILE_ATTRIBUTE_REPARSE_POINT != 0)
    {
        EntryType::Link
    } else if (unix && attr & S_IFMT != 0 && attr & S_IFMT != S_IFREG && attr & S_IFMT != S_IFDIR)
        || split
    {
        EntryType::Other
    } else {
        EntryType::File
    };
    let name_w = h.filename_w;
    RarHeader {
        name: from_wide(&name_w),
        kind,
        size: (u64::from(h.unp_size_high) << 32) | u64::from(h.unp_size),
        modified_ms: time_of(h),
        mode: unix.then_some(attr & 0o777),
        encrypted: flags & ffi::RHDF_ENCRYPTED != 0,
        split,
        dict: u64::from(h.dict_size).saturating_mul(1024),
    }
}

/// An open RAR archive (list or extract mode).
pub(crate) struct RarArchive<'p> {
    handle: *const ffi::Handle,
    state: Box<State>,
    path: &'p Path,
    /// Extract mode: skipping a solid entry decodes it as well.
    extract: bool,
    /// Headers encrypted (names need the password).
    pub header_encrypted: bool,
}

// SAFETY: the handle is used by one thread at a time (`&mut self`), calls are serialised.
unsafe impl Send for RarArchive<'_> {}

impl Drop for RarArchive<'_> {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // SAFETY: a handle returned by `RAROpenArchiveEx`, closed once.
            unsafe { ffi::RARCloseArchive(self.handle) };
        }
    }
}

impl<'p> RarArchive<'p> {
    /// Opens `path`; `extract` = mode for testing data, else listing.
    pub(crate) fn open(
        path: &'p Path,
        password: Option<&Secret>,
        extract: bool,
    ) -> Result<Self, FsError> {
        let mut state = Box::new(State {
            password: password.map(|p| to_wide(p.expose())),
            password_missing: false,
            sink: std::ptr::null_mut(),
            sink_stopped: false,
        });
        #[cfg(unix)]
        let narrow = {
            use std::os::unix::ffi::OsStrExt;
            std::ffi::CString::new(path.as_os_str().as_bytes())
                .map_err(|_| FsError::new(FsErrorCode::InvalidPath, "Invalid path", Some(path)))?
        };
        #[cfg(windows)]
        let wide: Vec<ffi::WCHAR> = {
            use std::os::windows::ffi::OsStrExt;
            path.as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        };
        let mode = if extract {
            ffi::RAR_OM_EXTRACT
        } else {
            ffi::RAR_OM_LIST
        };
        let mut data = ffi::OpenArchiveDataEx {
            #[cfg(unix)]
            archive_name: narrow.as_ptr(),
            #[cfg(windows)]
            archive_name: std::ptr::null(),
            #[cfg(unix)]
            archive_name_w: std::ptr::null(),
            #[cfg(windows)]
            archive_name_w: wide.as_ptr(),
            open_mode: mode,
            open_result: 0,
            comment_buffer: std::ptr::null_mut(),
            comment_buffer_size: 0,
            comment_size: 0,
            comment_state: 0,
            flags: 0,
            callback: Some(callback),
            user_data: &mut *state as *mut State as ffi::LPARAM,
            op_flags: 0,
            comment_buffer_w: std::ptr::null_mut(),
            mark_of_the_web: std::ptr::null_mut(),
            reserved: [0; 23],
        };
        let handle = {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // SAFETY: `data` and the name buffers live across the call; the state box
            // outlives the handle (both owned by the returned value).
            unsafe { ffi::RAROpenArchiveEx((&raw mut data).cast_const()) }
        };
        let flags = data.flags;
        let result = data.open_result as c_int;
        let archive = RarArchive {
            handle,
            state,
            path,
            extract,
            header_encrypted: flags & ffi::ROADF_ENCHEADERS != 0,
        };
        if archive.handle.is_null() || result != ffi::ERAR_SUCCESS {
            let code = if result == ffi::ERAR_SUCCESS {
                ffi::ERAR_EOPEN
            } else {
                result
            };
            let missing = archive.state.password_missing;
            return Err(if missing || code == ffi::ERAR_MISSING_PASSWORD {
                rar_error(ffi::ERAR_MISSING_PASSWORD, path, true)
            } else {
                rar_error(code, path, archive.header_encrypted)
            });
        }
        if flags & ffi::ROADF_VOLUME != 0 && flags & ffi::ROADF_FIRSTVOLUME == 0 {
            return Err(FsError::new(
                FsErrorCode::ArchiveError,
                "Not the first part of a multi-part RAR archive – multi-part archives are not supported",
                Some(path),
            ));
        }
        Ok(archive)
    }

    /// The next header, `None` at the end.
    pub(crate) fn next_header(&mut self) -> Result<Option<RarHeader>, FsError> {
        let mut h = Box::<ffi::HeaderDataEx>::default();
        let code = {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // SAFETY: open handle, `h` is a properly laid out header (asserted in the sys crate).
            unsafe { ffi::RARReadHeaderEx(self.handle, (&raw mut *h).cast_const()) }
        };
        match code {
            ffi::ERAR_SUCCESS => {
                let header = header_of(&h);
                // in extract mode even a skipped (solid) entry is decoded: check every one
                if self.extract && header.dict > MAX_DICT {
                    return Err(FsError::new(
                        FsErrorCode::ArchiveTooLarge,
                        "The archive needs a dictionary larger than 1 GiB – refused",
                        Some(self.path),
                    ));
                }
                Ok(Some(header))
            }
            ffi::ERAR_END_ARCHIVE => Ok(None),
            _ if self.state.password_missing => {
                Err(rar_error(ffi::ERAR_MISSING_PASSWORD, self.path, true))
            }
            c => Err(rar_error(c, self.path, self.header_encrypted)),
        }
    }

    /// Skips the data of the current entry.
    pub(crate) fn skip(&mut self) -> Result<(), FsError> {
        let code = {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // SAFETY: open handle; no names are passed.
            unsafe {
                ffi::RARProcessFileW(
                    self.handle,
                    ffi::RAR_SKIP,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            }
        };
        if code == ffi::ERAR_SUCCESS {
            Ok(())
        } else {
            Err(rar_error(code, self.path, self.header_encrypted))
        }
    }

    /// Decodes (tests) the current entry and hands its data to `sink`
    /// (`false` from the sink aborts: `Ok(false)`). Checks the dictionary first.
    pub(crate) fn test_into(
        &mut self,
        header: &RarHeader,
        sink: &mut dyn FnMut(&[u8]) -> bool,
    ) -> Result<bool, FsError> {
        if header.dict > MAX_DICT {
            return Err(FsError::new(
                FsErrorCode::ArchiveTooLarge,
                "The entry needs a dictionary larger than 1 GiB – refused",
                Some(self.path),
            ));
        }
        let mut sink_ref: SinkFn<'_> = sink;
        self.state.sink = &mut sink_ref as *mut SinkFn<'_> as *mut std::ffi::c_void;
        self.state.sink_stopped = false;
        self.state.password_missing = false;
        let code = {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // SAFETY: open handle in extract mode; the sink pointer stays valid during the call.
            unsafe {
                ffi::RARProcessFileW(
                    self.handle,
                    ffi::RAR_TEST,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            }
        };
        self.state.sink = std::ptr::null_mut();
        if self.state.sink_stopped {
            return Ok(false);
        }
        if self.state.password_missing {
            return Err(rar_error(ffi::ERAR_MISSING_PASSWORD, self.path, true));
        }
        match code {
            ffi::ERAR_SUCCESS => Ok(true),
            c => Err(rar_error(c, self.path, header.encrypted)),
        }
    }
}

/// Every header of a RAR archive (list mode) plus "headers encrypted".
pub(crate) fn headers(
    path: &Path,
    password: Option<&Secret>,
    limit: usize,
) -> Result<(Vec<RarHeader>, bool), FsError> {
    let mut a = RarArchive::open(path, password, false)?;
    let mut out = Vec::new();
    while let Some(h) = a.next_header()? {
        out.push(h);
        if out.len() > limit {
            return Err(super::too_many(path));
        }
        a.skip()?;
    }
    Ok((out, a.header_encrypted))
}

#[cfg(test)]
pub(crate) fn dll_version() -> c_int {
    // SAFETY: no arguments, no state.
    unsafe { ffi::RARGetDllVersion() }
}
