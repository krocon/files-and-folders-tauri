//! Cache hints for large copies (design 029 E10) – best effort, errors are ignored:
//! the copy is correct with or without them.
//!
//! - macOS: `F_NOCACHE` on source and target – a 15 GB copy no longer pushes
//!   everything else out of the unified buffer cache (the whole system got sluggish).
//! - Linux: the source is read sequentially (`POSIX_FADV_SEQUENTIAL`) and the parts
//!   already copied leave the page cache (`POSIX_FADV_DONTNEED`). Dirty pages of the
//!   target cannot be dropped without forcing a sync, so the target gets no hint.
//! - Windows/others: nothing (the system cache manager handles sequential copies).

use std::fs::File;

/// Bytes after which the copied part of the source is dropped from the cache (Linux).
pub const DROP_EVERY: u64 = 8 * 1024 * 1024;

/// Before reading `file` from start to end.
pub fn prepare_read(file: &File) {
    imp::prepare_read(file);
}

/// Before writing `file` from start to end.
pub fn prepare_write(file: &File) {
    imp::prepare_write(file);
}

/// The range `offset..offset + len` of `file` was read and is not needed again.
pub fn done_reading(file: &File, offset: u64, len: u64) {
    imp::done_reading(file, offset, len);
}

#[cfg(target_os = "macos")]
mod imp {
    use std::fs::File;
    use std::os::unix::io::AsRawFd;

    fn no_cache(file: &File) {
        // SAFETY: a valid open descriptor; F_NOCACHE only changes caching
        unsafe {
            libc::fcntl(file.as_raw_fd(), libc::F_NOCACHE, 1);
        }
    }

    pub fn prepare_read(file: &File) {
        no_cache(file);
    }

    pub fn prepare_write(file: &File) {
        no_cache(file);
    }

    pub fn done_reading(_file: &File, _offset: u64, _len: u64) {}
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod imp {
    use std::fs::File;
    use std::os::unix::io::AsRawFd;

    fn advise(file: &File, offset: u64, len: u64, advice: libc::c_int) {
        let (Ok(offset), Ok(len)) = (libc::off_t::try_from(offset), libc::off_t::try_from(len))
        else {
            return;
        };
        // SAFETY: a valid open descriptor; fadvise is only a hint
        unsafe {
            libc::posix_fadvise(file.as_raw_fd(), offset, len, advice);
        }
    }

    pub fn prepare_read(file: &File) {
        advise(file, 0, 0, libc::POSIX_FADV_SEQUENTIAL);
    }

    pub fn prepare_write(_file: &File) {}

    pub fn done_reading(file: &File, offset: u64, len: u64) {
        advise(file, offset, len, libc::POSIX_FADV_DONTNEED);
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
mod imp {
    use std::fs::File;

    pub fn prepare_read(_file: &File) {}
    pub fn prepare_write(_file: &File) {}
    pub fn done_reading(_file: &File, _offset: u64, _len: u64) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn hints_change_nothing_about_the_data() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.bin");
        let data: Vec<u8> = (0..3_000_000u32).map(|i| (i % 253) as u8).collect();
        let mut out = File::create(&p).unwrap();
        prepare_write(&out);
        out.write_all(&data).unwrap();
        drop(out);
        let mut input = File::open(&p).unwrap();
        prepare_read(&input);
        let mut back = Vec::new();
        input.read_to_end(&mut back).unwrap();
        done_reading(&input, 0, back.len() as u64);
        done_reading(&input, u64::MAX, 1); // out of range: ignored
        assert_eq!(back, data);
    }
}
