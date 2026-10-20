//! "Downloaded from the internet" marks (external review 025 #6): Windows
//! Mark-of-the-Web (`Zone.Identifier` stream) and macOS quarantine
//! (`com.apple.quarantine`). A file taken out of a marked archive gets the
//! archive's mark, so Office's protected view, SmartScreen and Gatekeeper
//! still apply (the 7-Zip flaw CVE-2025-0411 was a missing propagation).
//! Linux has no such mark: no-op.

use std::path::Path;

/// The mark of an archive, to be copied onto what is extracted from it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginMark(#[allow(dead_code)] Vec<u8>);

/// Largest mark copied (both are a few hundred bytes).
#[cfg(any(windows, target_os = "macos"))]
const MAX_MARK: usize = 64 * 1024;

#[cfg(windows)]
fn stream(path: &Path) -> std::path::PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(":Zone.Identifier");
    std::path::PathBuf::from(s)
}

/// The mark of `archive`, if it has one.
#[cfg(windows)]
pub fn read(archive: &Path) -> Option<OriginMark> {
    use std::io::Read;
    let f = std::fs::File::open(stream(archive)).ok()?;
    let mut data = Vec::new();
    f.take(MAX_MARK as u64 + 1).read_to_end(&mut data).ok()?;
    (!data.is_empty() && data.len() <= MAX_MARK).then_some(OriginMark(data))
}

/// Puts `mark` on `file` (best effort: a failure leaves the file unmarked).
#[cfg(windows)]
pub fn apply(file: &Path, mark: &OriginMark) {
    let _ = std::fs::write(stream(file), &mark.0);
}

/// Puts `mark` on the open `file` at `path` (before it gets its final name and mode).
#[cfg(windows)]
pub fn apply_open(_file: &std::fs::File, path: &Path, mark: &OriginMark) {
    apply(path, mark);
}

#[cfg(target_os = "macos")]
const QUARANTINE: &std::ffi::CStr = c"com.apple.quarantine";

#[cfg(target_os = "macos")]
fn c_path(path: &Path) -> Option<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes()).ok()
}

#[cfg(target_os = "macos")]
pub fn read(archive: &Path) -> Option<OriginMark> {
    let p = c_path(archive)?;
    let mut buf = vec![0u8; MAX_MARK];
    // SAFETY: valid C strings, a buffer of `buf.len()` bytes; position 0, no options.
    let n = unsafe {
        libc::getxattr(
            p.as_ptr(),
            QUARANTINE.as_ptr(),
            buf.as_mut_ptr().cast(),
            buf.len(),
            0,
            0,
        )
    };
    let n = usize::try_from(n).ok().filter(|n| *n > 0)?;
    buf.truncate(n);
    Some(OriginMark(buf))
}

#[cfg(target_os = "macos")]
pub fn apply(file: &Path, mark: &OriginMark) {
    let Some(p) = c_path(file) else {
        return;
    };
    // SAFETY: valid C strings and a buffer of `mark.0.len()` bytes; never follows a link.
    unsafe {
        libc::setxattr(
            p.as_ptr(),
            QUARANTINE.as_ptr(),
            mark.0.as_ptr().cast(),
            mark.0.len(),
            0,
            libc::XATTR_NOFOLLOW,
        );
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn read(_archive: &Path) -> Option<OriginMark> {
    None
}

/// Through the descriptor: works even if the new file is read-only already.
#[cfg(target_os = "macos")]
pub fn apply_open(file: &std::fs::File, _path: &Path, mark: &OriginMark) {
    use std::os::fd::AsRawFd;
    // SAFETY: an open descriptor, a valid C string and a buffer of `mark.0.len()` bytes.
    unsafe {
        libc::fsetxattr(
            file.as_raw_fd(),
            QUARANTINE.as_ptr(),
            mark.0.as_ptr().cast(),
            mark.0.len(),
            0,
            0,
        );
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn apply(_file: &Path, _mark: &OriginMark) {}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn apply_open(_file: &std::fs::File, _path: &Path, _mark: &OriginMark) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_are_copied_where_the_os_has_them() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a.zip");
        let f = d.path().join("f.txt");
        std::fs::write(&a, b"x").unwrap();
        std::fs::write(&f, b"y").unwrap();
        // an unmarked archive gives nothing to copy
        assert_eq!(read(&a), None);
        #[cfg(any(windows, target_os = "macos"))]
        {
            let mark = OriginMark(b"[ZoneTransfer]\r\nZoneId=3\r\n".to_vec());
            apply(&a, &mark);
            let got = read(&a).expect("mark written");
            apply(&f, &got);
            assert_eq!(read(&f), Some(mark));
        }
    }
}
