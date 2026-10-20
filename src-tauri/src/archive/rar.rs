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
//! - the callback never unwinds into C++ (`catch_unwind`) and checks the
//!   cancel flag on every chunk (also for data that is only skipped);
//! - every handle is closed (`Drop`); only opening is serialised ([`LOCK`]:
//!   it resets and reads UnRAR's global error handler) – reading and decoding
//!   run per handle in parallel, so a long or paused extraction never blocks
//!   listing another RAR (external review 025 #3).

use super::secrets::Secret;
use super::{EntryType, MAX_DICT};
use crate::error::{FsError, FsErrorCode};
use std::os::raw::{c_int, c_uint};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use unrar_ng_sys as ffi;
use zeroize::Zeroizing;

/// Opening touches UnRAR's global error handler: one at a time.
static LOCK: Mutex<()> = Mutex::new(());
/// UnRAR's password buffer holds 512 wide characters including the NUL.
pub const MAX_PASSWORD_CHARS: usize = 511;

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

/// A password in UnRAR's wide characters (NUL-terminated), wiped on drop.
type WidePassword = Zeroizing<Vec<ffi::WCHAR>>;

/// The password as UnRAR wants it; `None` if it is too long for UnRAR.
pub(crate) fn wide_password(secret: &Secret) -> Option<WidePassword> {
    let w = Zeroizing::new(to_wide(secret.expose()));
    (w.len() <= MAX_PASSWORD_CHARS + 1).then_some(w)
}

/// State the callback sees (behind the `UserData` pointer).
struct State {
    /// NUL-terminated wide password, if known (wiped on drop).
    password: Option<WidePassword>,
    /// The library asked for a password and none was known.
    password_missing: bool,
    /// Data sink of the entry being tested (a `*mut &mut dyn FnMut`), or null = drop the data.
    sink: *mut std::ffi::c_void,
    /// The sink refused data (cancel, limit, write error) or the job was cancelled.
    sink_stopped: bool,
    /// Cancel flag of the job, checked on every chunk (null = none).
    cancel: *const AtomicBool,
}

type SinkFn<'a> = &'a mut dyn FnMut(&[u8]) -> bool;

extern "C" fn callback(
    msg: ffi::UINT,
    user: ffi::LPARAM,
    p1: ffi::LPARAM,
    p2: ffi::LPARAM,
) -> c_int {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // SAFETY: `user` is the `State` of a `RarArchive` (from `Box::into_raw`), alive
        // while its handle is open and only touched through this raw pointer while the
        // library runs; `p1`/`p2` are what UnRAR documents for each message.
        unsafe { on_message(msg, user, p1, p2) }
    }));
    r.unwrap_or(-1)
}

unsafe fn on_message(msg: ffi::UINT, user: ffi::LPARAM, p1: ffi::LPARAM, p2: ffi::LPARAM) -> c_int {
    if user == 0 {
        return -1;
    }
    let state = user as *mut State;
    match msg {
        ffi::UCM_PROCESSDATA => {
            // SAFETY: see `callback`; the flag outlives the operation (borrowed by the archive).
            let cancelled = unsafe {
                let c = (*state).cancel;
                !c.is_null() && (*c).load(Ordering::SeqCst)
            };
            if cancelled {
                // SAFETY: see `callback`.
                unsafe { (*state).sink_stopped = true };
                return -1;
            }
            // SAFETY: see `callback`.
            let sink = unsafe { (*state).sink };
            if sink.is_null() {
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
            let sink = unsafe { &mut *(sink as *mut SinkFn<'_>) };
            if sink(chunk) {
                1
            } else {
                // SAFETY: see `callback`.
                unsafe { (*state).sink_stopped = true };
                -1
            }
        }
        ffi::UCM_NEEDPASSWORDW => {
            // SAFETY: see `callback`.
            let pw = unsafe { (*state).password.as_ref() };
            match pw {
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
                    // SAFETY: see `callback`.
                    unsafe { (*state).password_missing = true };
                    -1
                }
            }
        }
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
    /// From `Box::into_raw`: the library and we only go through this pointer
    /// (no `Box` that could invalidate it – external review 025 #10).
    state: *mut State,
    path: &'p Path,
    /// Extract mode: skipping a solid entry decodes it as well.
    extract: bool,
    /// Headers encrypted (names need the password).
    pub header_encrypted: bool,
    /// Solid archive: an entry can only be reached by decoding the ones before it.
    pub solid: bool,
}

// SAFETY: one thread at a time (`&mut self`); UnRAR handles are independent.
unsafe impl Send for RarArchive<'_> {}

impl Drop for RarArchive<'_> {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: a handle returned by `RAROpenArchiveEx`, closed once.
            unsafe { ffi::RARCloseArchive(self.handle) };
        }
        // SAFETY: from `Box::into_raw` in `open`, freed once, after the handle is gone.
        drop(unsafe { Box::from_raw(self.state) });
    }
}

impl<'p> RarArchive<'p> {
    /// Opens `path`; `extract` = mode for testing data, else listing. `cancel`
    /// is checked on every chunk the library decodes.
    pub(crate) fn open(
        path: &'p Path,
        password: Option<&Secret>,
        extract: bool,
        cancel: Option<&'p AtomicBool>,
    ) -> Result<Self, FsError> {
        let password = match password {
            Some(p) => Some(wide_password(p).ok_or_else(|| password_too_long(path))?),
            None => None,
        };
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
        let state = Box::into_raw(Box::new(State {
            password,
            password_missing: false,
            sink: std::ptr::null_mut(),
            sink_stopped: false,
            cancel: cancel.map_or(std::ptr::null(), |c| c as *const AtomicBool),
        }));
        // owns the state from here (and the handle once there is one)
        let mut archive = RarArchive {
            handle: std::ptr::null(),
            state,
            path,
            extract,
            header_encrypted: false,
            solid: false,
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
            user_data: state as ffi::LPARAM,
            op_flags: 0,
            comment_buffer_w: std::ptr::null_mut(),
            mark_of_the_web: std::ptr::null_mut(),
            reserved: [0; 23],
        };
        archive.handle = {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            // SAFETY: `data` and the name buffers live across the call; the state
            // outlives the handle (both freed in `Drop`).
            unsafe { ffi::RAROpenArchiveEx((&raw mut data).cast_const()) }
        };
        let flags = data.flags;
        let result = data.open_result as c_int;
        archive.header_encrypted = flags & ffi::ROADF_ENCHEADERS != 0;
        archive.solid = flags & ffi::ROADF_SOLID != 0;
        if archive.handle.is_null() || result != ffi::ERAR_SUCCESS {
            let code = if result == ffi::ERAR_SUCCESS {
                ffi::ERAR_EOPEN
            } else {
                result
            };
            // SAFETY: no library call runs.
            let missing = unsafe { (*archive.state).password_missing };
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

    fn missing_password(&self) -> bool {
        // SAFETY: no library call runs while `&self` is borrowed.
        unsafe { (*self.state).password_missing }
    }

    /// The next header, `None` at the end.
    pub(crate) fn next_header(&mut self) -> Result<Option<RarHeader>, FsError> {
        let mut h = Box::<ffi::HeaderDataEx>::default();
        // SAFETY: open handle, `h` is a properly laid out header (asserted in the sys crate).
        let code = unsafe { ffi::RARReadHeaderEx(self.handle, (&raw mut *h).cast_const()) };
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
            _ if self.missing_password() => {
                Err(rar_error(ffi::ERAR_MISSING_PASSWORD, self.path, true))
            }
            c => Err(rar_error(c, self.path, self.header_encrypted)),
        }
    }

    /// Skips the data of the current entry. In a solid archive (extract mode)
    /// the library has to decode it anyway: then it is tested into nothing, so
    /// that cancelling reaches it (external review 025 #5). `Ok(false)` = cancelled.
    pub(crate) fn skip(&mut self, header: &RarHeader) -> Result<bool, FsError> {
        if self.extract && self.solid {
            return self.process(header, None);
        }
        // SAFETY: open handle; no names are passed.
        let code = unsafe {
            ffi::RARProcessFileW(
                self.handle,
                ffi::RAR_SKIP,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if code == ffi::ERAR_SUCCESS {
            Ok(true)
        } else {
            Err(rar_error(code, self.path, self.header_encrypted))
        }
    }

    /// Decodes (tests) the current entry and hands its data to `sink`
    /// (`false` from the sink or a cancel aborts: `Ok(false)`). Checks the dictionary first.
    pub(crate) fn test_into(
        &mut self,
        header: &RarHeader,
        sink: &mut dyn FnMut(&[u8]) -> bool,
    ) -> Result<bool, FsError> {
        self.process(header, Some(sink))
    }

    fn process(&mut self, header: &RarHeader, sink: Option<SinkFn<'_>>) -> Result<bool, FsError> {
        if header.dict > MAX_DICT {
            return Err(FsError::new(
                FsErrorCode::ArchiveTooLarge,
                "The entry needs a dictionary larger than 1 GiB – refused",
                Some(self.path),
            ));
        }
        let mut sink_ref: Option<SinkFn<'_>> = sink;
        let sink_ptr = match sink_ref.as_mut() {
            Some(s) => s as *mut SinkFn<'_> as *mut std::ffi::c_void,
            None => std::ptr::null_mut(),
        };
        // SAFETY: no library call runs; the pointers stay valid during the call below.
        unsafe {
            (*self.state).sink = sink_ptr;
            (*self.state).sink_stopped = false;
            (*self.state).password_missing = false;
        }
        // SAFETY: open handle in extract mode; the sink pointer stays valid during the call.
        let code = unsafe {
            ffi::RARProcessFileW(
                self.handle,
                ffi::RAR_TEST,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        // SAFETY: the call is over.
        let (stopped, missing) = unsafe {
            (*self.state).sink = std::ptr::null_mut();
            ((*self.state).sink_stopped, (*self.state).password_missing)
        };
        if stopped {
            return Ok(false);
        }
        if missing {
            return Err(rar_error(ffi::ERAR_MISSING_PASSWORD, self.path, true));
        }
        match code {
            ffi::ERAR_SUCCESS => Ok(true),
            c => Err(rar_error(c, self.path, header.encrypted)),
        }
    }
}

/// UnRAR takes at most [`MAX_PASSWORD_CHARS`] characters (external review 025 #11).
pub(crate) fn password_too_long(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::ArchivePasswordWrong,
        format!("RAR passwords have at most {MAX_PASSWORD_CHARS} characters"),
        Some(path),
    )
}

/// Every header of a RAR archive (list mode) plus "headers encrypted".
pub(crate) fn headers(
    path: &Path,
    password: Option<&Secret>,
    limit: usize,
) -> Result<(Vec<RarHeader>, bool), FsError> {
    let mut a = RarArchive::open(path, password, false, None)?;
    let mut out = Vec::new();
    while let Some(h) = a.next_header()? {
        a.skip(&h)?;
        out.push(h);
        if out.len() > limit {
            return Err(super::too_many(path));
        }
    }
    Ok((out, a.header_encrypted))
}

#[cfg(test)]
pub(crate) fn dll_version() -> c_int {
    // SAFETY: no arguments, no state.
    unsafe { ffi::RARGetDllVersion() }
}
