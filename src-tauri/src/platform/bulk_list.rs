//! Folder listing with `getattrlistbulk(2)` on macOS (design 030 E7).
//!
//! `read_dir` + one `lstat` per entry costs one server round trip per file on
//! SMB/AFP/NFS mounts. `getattrlistbulk` returns name, type, mtime, flags and size
//! of many entries per call. The result must be identical to
//! [`crate::listing::list_directory_std`]; any problem returns `None` and the
//! caller lists the portable way.
//!
//! The buffer parser ([`parse_entries`]) and the conversion ([`raw_to_dto`]) are
//! plain code tested on every Unix with hand-built buffers; only [`list`] calls
//! the system and exists on macOS alone.

use crate::model::{DirEntryDto, EntryKind};
use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

// Values from <sys/attr.h> / <sys/vnode.h> / <sys/stat.h>, here so that the
// parser builds and is tested on every platform.
pub const ATTR_BIT_MAP_COUNT: u16 = 5;
pub const ATTR_CMN_NAME: u32 = 0x0000_0001;
pub const ATTR_CMN_OBJTYPE: u32 = 0x0000_0008;
pub const ATTR_CMN_MODTIME: u32 = 0x0000_0400;
pub const ATTR_CMN_FLAGS: u32 = 0x0004_0000;
pub const ATTR_CMN_ERROR: u32 = 0x2000_0000;
pub const ATTR_CMN_RETURNED_ATTRS: u32 = 0x8000_0000;
pub const ATTR_FILE_DATALENGTH: u32 = 0x0000_0200;
pub const VREG: u32 = 1;
pub const VDIR: u32 = 2;
pub const VLNK: u32 = 5;
pub const UF_HIDDEN: u32 = 0x0000_8000;

/// The attributes requested per entry (common, file).
pub const COMMON_ATTRS: u32 = ATTR_CMN_RETURNED_ATTRS
    | ATTR_CMN_NAME
    | ATTR_CMN_ERROR
    | ATTR_CMN_OBJTYPE
    | ATTR_CMN_MODTIME
    | ATTR_CMN_FLAGS;
pub const FILE_ATTRS: u32 = ATTR_FILE_DATALENGTH;

/// One entry as `getattrlistbulk` packs it; `None` = attribute not returned.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RawEntry {
    pub name: Vec<u8>,
    pub error: u32,
    pub objtype: Option<u32>,
    /// `timespec` (seconds, nanoseconds).
    pub modtime: Option<(i64, i64)>,
    pub flags: Option<u32>,
    pub data_length: Option<u64>,
}

/// Cursor over one packed entry; every read is bounds-checked (a broken buffer is an
/// error, never undefined behaviour).
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
    end: usize,
}

impl Reader<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let next = self.pos.checked_add(N).ok_or("overflow")?;
        if next > self.end {
            return Err(format!("attribute beyond the entry at {}", self.pos));
        }
        let mut out = [0u8; N];
        out.copy_from_slice(&self.buf[self.pos..next]);
        self.pos = next;
        Ok(out)
    }

    fn u32(&mut self) -> Result<u32, String> {
        self.take::<4>().map(u32::from_ne_bytes)
    }

    fn i32(&mut self) -> Result<i32, String> {
        self.take::<4>().map(i32::from_ne_bytes)
    }

    fn i64(&mut self) -> Result<i64, String> {
        self.take::<8>().map(i64::from_ne_bytes)
    }
}

/// Reads `count` entries from a buffer filled by `getattrlistbulk` with
/// [`COMMON_ATTRS`] / [`FILE_ATTRS`]. Layout per entry (getattrlistbulk(2)):
/// `u32 length`, `attribute_set_t returned` (5 × u32), `u32 error` if returned
/// (directly after `returned`, as in the man page's example), then the common
/// attributes in bit order – name (`attrreference_t`, offset relative to the
/// reference itself, length including the NUL), objtype (u32), modtime
/// (`timespec`, 2 × 64 bit), flags (u32) – then the file attributes: data length
/// (`off_t`). Only attributes whose bit is set in `returned` are present.
pub fn parse_entries(buf: &[u8], count: usize) -> Result<Vec<RawEntry>, String> {
    let mut out = Vec::with_capacity(count);
    let mut start = 0usize;
    for _ in 0..count {
        let mut head = Reader {
            buf,
            pos: start,
            end: buf.len(),
        };
        let length = head.u32()? as usize;
        let end = start.checked_add(length).ok_or("overflow")?;
        if length < 24 || end > buf.len() {
            return Err(format!("bad entry length {length} at {start}"));
        }
        let mut r = Reader {
            buf,
            pos: head.pos,
            end,
        };
        let common = r.u32()?;
        let _vol = r.u32()?;
        let _dir = r.u32()?;
        let file = r.u32()?;
        let _fork = r.u32()?;
        let mut e = RawEntry::default();
        if common & ATTR_CMN_ERROR != 0 {
            e.error = r.u32()?;
        }
        if common & ATTR_CMN_NAME != 0 {
            let at = r.pos;
            let offset = r.i32()?;
            let len = r.u32()? as usize;
            let from = isize::try_from(at)
                .ok()
                .and_then(|a| a.checked_add(offset as isize))
                .and_then(|v| usize::try_from(v).ok())
                .ok_or("bad name offset")?;
            let to = from.checked_add(len).ok_or("overflow")?;
            if from < start || to > end {
                return Err(format!("name outside the entry at {start}"));
            }
            let mut name = &buf[from..to];
            if let Some(nul) = name.iter().position(|&b| b == 0) {
                name = &name[..nul];
            }
            e.name = name.to_vec();
        }
        if common & ATTR_CMN_OBJTYPE != 0 {
            e.objtype = Some(r.u32()?);
        }
        if common & ATTR_CMN_MODTIME != 0 {
            e.modtime = Some((r.i64()?, r.i64()?));
        }
        if common & ATTR_CMN_FLAGS != 0 {
            e.flags = Some(r.u32()?);
        }
        if file & ATTR_FILE_DATALENGTH != 0 {
            e.data_length = u64::try_from(r.i64()?).ok();
        }
        out.push(e);
        start = end;
    }
    Ok(out)
}

/// Milliseconds since the epoch like `listing` computes them from `SystemTime`
/// (truncated towards zero on both sides of 1970).
pub fn timespec_ms(sec: i64, nsec: i64) -> Option<i64> {
    let ns = i128::from(sec) * 1_000_000_000 + i128::from(nsec);
    let ms = if ns >= 0 {
        ns / 1_000_000
    } else {
        -((-ns) / 1_000_000)
    };
    i64::try_from(ms).ok()
}

/// The panel's entry for one raw entry of `dir`; `true` = it could not be read.
pub fn raw_to_dto(dir: &Path, raw: &RawEntry) -> (DirEntryDto, bool) {
    let os_name = OsStr::from_bytes(&raw.name);
    let lossy_name = std::str::from_utf8(&raw.name).is_err();
    let name = os_name.to_string_lossy().into_owned();
    let path = dir.join(os_name);
    // links need their target; entries the kernel reported with an error get the
    // portable way's own stat – identical to it by construction (review 030 #4)
    let objtype = raw.objtype.filter(|_| raw.error == 0).unwrap_or(VLNK);
    if objtype == VLNK {
        return match std::fs::symlink_metadata(&path) {
            Ok(meta) => (
                crate::listing::entry_from_metadata(name, &path, &meta, lossy_name),
                false,
            ),
            Err(_) => (crate::listing::unknown_entry(name, &path, lossy_name), true),
        };
    }
    let kind = if objtype == VDIR {
        EntryKind::Directory
    } else {
        EntryKind::File
    };
    let size = (objtype == VREG).then_some(raw.data_length).flatten();
    let hidden = name.starts_with('.') || raw.flags.is_some_and(|f| f & UF_HIDDEN != 0);
    (
        DirEntryDto {
            hidden,
            name,
            path: path.to_string_lossy().into_owned(),
            kind,
            target_kind: None,
            size,
            modified_ms: raw.modtime.and_then(|(s, n)| timespec_ms(s, n)),
            lossy_name,
        },
        false,
    )
}

/// Lists `dir` with `getattrlistbulk`; `None` on any problem (the caller falls back).
#[cfg(target_os = "macos")]
pub fn list(dir: &Path) -> Option<crate::model::DirectoryListing> {
    use std::ffi::CString;

    struct Fd(libc::c_int);
    impl Drop for Fd {
        fn drop(&mut self) {
            // SAFETY: our own descriptor, closed once
            unsafe {
                libc::close(self.0);
            }
        }
    }

    let c = CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: a valid NUL-terminated path
    let fd = unsafe {
        libc::open(
            c.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return None;
    }
    let fd = Fd(fd);
    // SAFETY: plain C struct, all-zero is valid
    let mut request: libc::attrlist = unsafe { std::mem::zeroed() };
    request.bitmapcount = ATTR_BIT_MAP_COUNT;
    request.commonattr = COMMON_ATTRS;
    request.fileattr = FILE_ATTRS;
    // 8-byte aligned buffer, 256 KiB
    let mut words = vec![0u64; 32 * 1024];
    let bytes = words.len() * 8;
    let mut entries = Vec::new();
    let mut unreadable = 0usize;
    loop {
        // SAFETY: valid descriptor, request and a buffer of `bytes` bytes
        let n = unsafe {
            libc::getattrlistbulk(
                fd.0,
                (&mut request as *mut libc::attrlist).cast(),
                words.as_mut_ptr().cast(),
                bytes,
                0,
            )
        };
        if n < 0 {
            return None;
        }
        if n == 0 {
            break;
        }
        // SAFETY: the buffer is `bytes` long and initialised (zeroed, then filled)
        let buf = unsafe { std::slice::from_raw_parts(words.as_ptr().cast::<u8>(), bytes) };
        for raw in parse_entries(buf, n as usize).ok()? {
            let (dto, bad) = raw_to_dto(dir, &raw);
            unreadable += usize::from(bad);
            entries.push(dto);
        }
    }
    drop(fd);
    Some(crate::listing::assemble(dir, entries, unreadable))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Packs entries the way getattrlistbulk does (4-byte aligned fields, name data at the end).
    fn pack(entries: &[RawEntry], with_error: bool) -> Vec<u8> {
        let mut buf = Vec::new();
        for e in entries {
            let mut common = ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_NAME;
            if with_error {
                common |= ATTR_CMN_ERROR;
            }
            if e.objtype.is_some() {
                common |= ATTR_CMN_OBJTYPE;
            }
            if e.modtime.is_some() {
                common |= ATTR_CMN_MODTIME;
            }
            if e.flags.is_some() {
                common |= ATTR_CMN_FLAGS;
            }
            let file = if e.data_length.is_some() {
                ATTR_FILE_DATALENGTH
            } else {
                0
            };
            let mut body = Vec::new();
            for v in [common, 0, 0, file, 0] {
                body.extend_from_slice(&v.to_ne_bytes());
            }
            if with_error {
                body.extend_from_slice(&e.error.to_ne_bytes());
            }
            let name_ref_at = 4 + body.len();
            body.extend_from_slice(&[0u8; 8]); // patched below
            if let Some(t) = e.objtype {
                body.extend_from_slice(&t.to_ne_bytes());
            }
            if let Some((s, n)) = e.modtime {
                body.extend_from_slice(&s.to_ne_bytes());
                body.extend_from_slice(&n.to_ne_bytes());
            }
            if let Some(f) = e.flags {
                body.extend_from_slice(&f.to_ne_bytes());
            }
            if let Some(d) = e.data_length {
                body.extend_from_slice(&(d as i64).to_ne_bytes());
            }
            let name_at = 4 + body.len();
            body.extend_from_slice(&e.name);
            body.push(0);
            while (4 + body.len()) % 4 != 0 {
                body.push(0);
            }
            let offset = (name_at - name_ref_at) as i32;
            let len = (e.name.len() + 1) as u32;
            body[name_ref_at - 4..name_ref_at].copy_from_slice(&offset.to_ne_bytes());
            body[name_ref_at..name_ref_at + 4].copy_from_slice(&len.to_ne_bytes());
            let total = (4 + body.len()) as u32;
            buf.extend_from_slice(&total.to_ne_bytes());
            buf.extend_from_slice(&body);
        }
        buf
    }

    fn file(name: &str, size: u64) -> RawEntry {
        RawEntry {
            name: name.as_bytes().to_vec(),
            error: 0,
            objtype: Some(VREG),
            modtime: Some((1_700_000_000, 123_456_789)),
            flags: Some(0),
            data_length: Some(size),
        }
    }

    #[test]
    fn reads_what_it_packed_with_and_without_error_field() {
        let dir = RawEntry {
            name: "Ordner ä".as_bytes().to_vec(),
            objtype: Some(VDIR),
            modtime: Some((1, 0)),
            flags: Some(UF_HIDDEN),
            ..RawEntry::default()
        };
        let entries = vec![file("Tatort 😀.mkv", 15 << 30), dir, file("", 0)];
        for with_error in [true, false] {
            let buf = pack(&entries, with_error);
            assert_eq!(parse_entries(&buf, 3).unwrap(), entries);
        }
    }

    #[test]
    fn missing_attributes_stay_none_and_errors_are_kept() {
        let e = RawEntry {
            name: b"kaputt".to_vec(),
            error: 13,
            ..RawEntry::default()
        };
        let got = parse_entries(&pack(std::slice::from_ref(&e), true), 1).unwrap();
        assert_eq!(got, vec![e]);
    }

    #[test]
    fn broken_buffers_are_errors() {
        let buf = pack(&[file("a", 1)], true);
        assert!(
            parse_entries(&buf, 2).is_err(),
            "more entries than in the buffer"
        );
        assert!(parse_entries(&buf[..buf.len() - 4], 1).is_err(), "cut off");
        let mut bad = buf.clone();
        bad[0..4].copy_from_slice(&8u32.to_ne_bytes());
        assert!(parse_entries(&bad, 1).is_err(), "too short");
        let mut far = buf.clone();
        // name offset points outside the entry
        far[4 + 20 + 4..4 + 20 + 8].copy_from_slice(&10_000i32.to_ne_bytes());
        assert!(parse_entries(&far, 1).is_err());
        assert!(parse_entries(&[], 0).unwrap().is_empty());
    }

    #[test]
    fn timespec_like_system_time() {
        assert_eq!(
            timespec_ms(1_700_000_000, 123_456_789),
            Some(1_700_000_000_123)
        );
        assert_eq!(timespec_ms(0, 999_999), Some(0));
        assert_eq!(timespec_ms(-2, 500_000_000), Some(-1500));
        let t = std::time::UNIX_EPOCH - std::time::Duration::from_nanos(1_000_500_000);
        let std_ms =
            -(i64::try_from(std::time::UNIX_EPOCH.duration_since(t).unwrap().as_millis()).unwrap());
        assert_eq!(timespec_ms(-2, 999_500_000), Some(std_ms));
    }

    #[test]
    fn raw_entries_become_the_same_dtos_as_the_portable_listing() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        std::fs::write(d.join("a ä.txt"), b"12345").unwrap();
        std::fs::create_dir(d.join(".versteckt")).unwrap();
        std::os::unix::fs::symlink(d.join("a ä.txt"), d.join("link")).unwrap();
        std::os::unix::fs::symlink(d.join("weg"), d.join("dangling")).unwrap();
        let portable = crate::listing::list_directory_std(d).unwrap();
        let mut converted = Vec::new();
        for e in &portable.entries {
            let p = Path::new(&e.path);
            let meta = std::fs::symlink_metadata(p).unwrap();
            let objtype = if meta.file_type().is_symlink() {
                VLNK
            } else if meta.is_dir() {
                VDIR
            } else {
                VREG
            };
            use std::os::unix::fs::MetadataExt;
            let raw = RawEntry {
                name: e.name.as_bytes().to_vec(),
                error: 0,
                objtype: Some(objtype),
                modtime: Some((meta.mtime(), meta.mtime_nsec())),
                flags: Some(0),
                data_length: (objtype == VREG).then_some(meta.len()),
            };
            let (dto, bad) = raw_to_dto(d, &raw);
            assert!(!bad);
            converted.push(dto);
        }
        let assembled = crate::listing::assemble(d, converted, 0);
        assert_eq!(assembled, portable);
        // an entry with an error is unknown and counted
        let (dto, bad) = raw_to_dto(
            d,
            &RawEntry {
                name: b"x".to_vec(),
                error: 5,
                ..RawEntry::default()
            },
        );
        assert!(bad);
        assert_eq!(dto.kind, EntryKind::Unknown);
    }

    #[test]
    fn non_utf8_names_are_lossy() {
        let (dto, _) = raw_to_dto(
            Path::new("/x"),
            &RawEntry {
                name: vec![b'a', 0xff, b'b'],
                objtype: Some(VREG),
                data_length: Some(1),
                ..RawEntry::default()
            },
        );
        assert!(dto.lossy_name);
        assert_eq!(dto.name, "a\u{fffd}b");
    }

    /// Every bulk entry must pass Rust's check of E5 against `lstat` (review 030 #5).
    #[cfg(target_os = "macos")]
    fn assert_passes_the_check(entries: &[DirEntryDto]) {
        for e in entries {
            let exp = crate::jobs::expect::ExpectedEntry {
                path: e.path.clone(),
                kind: e.kind,
                size: e.size,
                modified_ms: e.modified_ms,
            };
            assert_eq!(
                crate::jobs::expect::changed(Path::new(&e.path), &exp),
                None,
                "{} would be refused as changed",
                e.name
            );
        }
    }

    /// macOS: the bulk listing equals the portable one (run on the Mac: `cargo test bulk_list`).
    #[cfg(target_os = "macos")]
    #[test]
    fn bulk_equals_portable_on_macos() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        std::fs::write(d.join("a ä 😀.txt"), b"12345").unwrap();
        std::fs::write(d.join(".dot"), b"").unwrap();
        std::fs::create_dir(d.join("Ordner")).unwrap();
        std::os::unix::fs::symlink(d.join("Ordner"), d.join("link-dir")).unwrap();
        std::os::unix::fs::symlink(d.join("weg"), d.join("dangling")).unwrap();
        for i in 0..3000 {
            std::fs::write(d.join(format!("f{i:05}")), b"x").unwrap();
        }
        let bulk = list(d).expect("getattrlistbulk works on APFS");
        let portable = crate::listing::list_directory_std(d).unwrap();
        assert_eq!(bulk, portable);
        assert_passes_the_check(&bulk.entries);
    }

    /// Speed on a real folder (e.g. an SMB share). The first listing of a round is the
    /// only cold one (macOS caches what it read), so the way to measure cold goes first:
    /// `FNF_BENCH_FIRST=bulk|portable` (default bulk). Compare two folders of similar size
    /// that were not opened before, one per way:
    /// `FNF_BENCH_FIRST=bulk FNF_BENCH_DIR=/Volumes/share/a cargo test --release --lib listing_speed -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn listing_speed() {
        let dir = std::path::PathBuf::from(std::env::var("FNF_BENCH_DIR").expect("FNF_BENCH_DIR"));
        let bulk_first = std::env::var("FNF_BENCH_FIRST").map_or(true, |v| v != "portable");
        let time = |bulk: bool| {
            let t = std::time::Instant::now();
            let n = if bulk {
                #[cfg(target_os = "macos")]
                {
                    list(&dir).map(|l| l.entries.len())
                }
                #[cfg(not(target_os = "macos"))]
                {
                    None::<usize>
                }
            } else {
                Some(
                    crate::listing::list_directory_std(&dir)
                        .unwrap()
                        .entries
                        .len(),
                )
            };
            (t.elapsed(), n)
        };
        for round in 1..=3 {
            let order = if bulk_first {
                [true, false]
            } else {
                [false, true]
            };
            let results: Vec<String> = order
                .iter()
                .map(|&bulk| {
                    let (d, n) = time(bulk);
                    let name = if bulk { "bulk" } else { "portable" };
                    let cold = if round == 1 && bulk == order[0] {
                        " (cold)"
                    } else {
                        ""
                    };
                    format!("{name}{cold} {d:?} ({n:?} entries)")
                })
                .collect();
            println!("round {round}: {}", results.join(" · "));
        }
        // on this share too: the same entries, and they pass the check of E5
        #[cfg(target_os = "macos")]
        if let Some(bulk) = list(&dir) {
            let portable = crate::listing::list_directory_std(&dir).unwrap();
            assert_eq!(bulk.entries, portable.entries, "bulk differs from portable");
            assert_passes_the_check(&bulk.entries);
        }
    }
}
