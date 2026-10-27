//! Archives as virtual folders (design 016 E1–E3, 025): ZIP, TAR, TAR.GZ, 7z
//! and RAR are read into an index (names checked, limits against zip bombs) and listed
//! like a folder under a *virtual path* `…/a.zip/inner/dir` (built with
//! `Path::join`, so the frontend keeps treating paths as opaque strings). A
//! virtual path can never exist on disk: one of its ancestors is a file.
//! Extraction and packing are jobs (`jobs/extract.rs`, `jobs/pack.rs`).
//! Pure std + `zip`/`tar`/`flate2`/`sevenz-rust2` (+ UnRAR, feature `rar`), without Tauri.
//! Passwords: [`secrets`]; files opened from an archive: [`view`].

#[cfg(feature = "rar")]
pub(crate) mod rar;
pub mod secrets;
pub(crate) mod sevenz;
pub(crate) mod sevenz_header;
#[cfg(test)]
pub(crate) mod tests;
#[cfg(test)]
pub(crate) mod tests_formats;
pub mod view;
pub mod write;

use crate::error::{FsError, FsErrorCode};
use crate::listing::compare_entries;
use crate::model::{DirEntryDto, DirectoryListing, EntryKind};
use crate::paths::{segments_of, validate_name};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File};
use std::io::{self, BufReader, Read, Seek};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

/// Entries per archive at most (listing and extraction).
pub const MAX_ENTRIES: usize = 200_000;
/// Sum of the declared (uncompressed) sizes at most.
pub const MAX_TOTAL_SIZE: u64 = 64 << 30;
/// Deflate reaches ~1 032 : 1 at best – more means overlapping entries or lying headers.
pub const MAX_RATIO: u64 = 1100;
/// 7z (LZMA2, PPMd) and RAR reach ~7 000 : 1 on zeros legitimately (design 025 E3.3).
pub const MAX_RATIO_STRONG: u64 = 20_000;
/// Allowance on top of the ratio (tiny archives with a few empty-ish files).
pub const RATIO_SLACK: u64 = 1 << 20;
/// Largest dictionary / model memory a 7z block or RAR entry may ask for (design 025 E3.4).
pub const MAX_DICT: u64 = 1 << 30;
/// Archives whose index is kept (path + size + modification time as key).
const CACHE_SIZE: usize = 4;
/// Longest TAR metadata header (GNU long name/link, PAX) read into memory (review 016 #1).
pub const MAX_TAR_META: u64 = 64 << 10;
/// Bytes of entry names an index may hold (200 000 entries × long names would fill the RAM).
pub const MAX_NAME_BYTES: usize = 64 << 20;
/// How long indexing a TAR stream may take (a huge TAR.GZ must not hold a worker for minutes).
pub const INDEX_TIME: Duration = Duration::from_secs(30);
/// Path components examined when resolving a virtual path.
const MAX_INNER_DEPTH: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveFormat {
    Zip,
    Tar,
    TarGz,
    /// 7z (design 025): read, extract, pack.
    SevenZ,
    /// RAR (design 025): read and extract only (feature `rar`).
    Rar,
}

impl ArchiveFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ArchiveFormat::Zip => ".zip",
            ArchiveFormat::Tar => ".tar",
            ArchiveFormat::TarGz => ".tar.gz",
            ArchiveFormat::SevenZ => ".7z",
            ArchiveFormat::Rar => ".rar",
        }
    }

    /// Unpacked : packed bytes a legitimate archive of this format reaches at most.
    pub fn max_ratio(self) -> u64 {
        match self {
            ArchiveFormat::Zip | ArchiveFormat::Tar | ArchiveFormat::TarGz => MAX_RATIO,
            ArchiveFormat::SevenZ | ArchiveFormat::Rar => MAX_RATIO_STRONG,
        }
    }
}

/// Format by file name (`.zip`, `.tar`, `.tar.gz`, `.tgz`, `.7z`, `.rar`, without case).
pub fn format_of_name(name: &str) -> Option<ArchiveFormat> {
    let n = name.to_lowercase();
    if n.ends_with(".zip") && n.len() > 4 {
        Some(ArchiveFormat::Zip)
    } else if (n.ends_with(".tar.gz") && n.len() > 7) || (n.ends_with(".tgz") && n.len() > 4) {
        Some(ArchiveFormat::TarGz)
    } else if n.ends_with(".tar") && n.len() > 4 {
        Some(ArchiveFormat::Tar)
    } else if n.ends_with(".7z") && n.len() > 3 {
        Some(ArchiveFormat::SevenZ)
    } else if cfg!(feature = "rar") && n.ends_with(".rar") && n.len() > 4 {
        Some(ArchiveFormat::Rar)
    } else {
        None
    }
}

/// Comic book archives (design 042 E7): `.cbz` = ZIP, `.cbr` = RAR, `.cb7` = 7z, `.cbt` = TAR.
/// Only the duplicate search reads them through [`read_index`]; the panel keeps opening
/// them as files (with the comic reader of the system).
pub fn comic_format(name: &str) -> Option<ArchiveFormat> {
    let n = name.to_lowercase();
    let (stem, ext) = n.rsplit_once('.')?;
    if stem.is_empty() {
        return None;
    }
    match ext {
        "cbz" => Some(ArchiveFormat::Zip),
        "cbt" => Some(ArchiveFormat::Tar),
        "cb7" => Some(ArchiveFormat::SevenZ),
        "cbr" if cfg!(feature = "rar") => Some(ArchiveFormat::Rar),
        _ => None,
    }
}

/// The archive name without its extension (`Fotos.tar.gz` → `Fotos`) – folder for "unpack into a subfolder".
pub fn stem_of(name: &str) -> String {
    let lower = name.to_lowercase();
    for ext in [".tar.gz", ".tgz", ".zip", ".tar", ".7z", ".rar"] {
        if lower.ends_with(ext) && name.len() > ext.len() {
            return name[..name.len() - ext.len()].to_string();
        }
    }
    name.to_string()
}

/// Shown in the panel header (`DirectoryListing.archive`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveInfo {
    /// The archive file itself (a real path).
    pub path: String,
    /// Folder inside the archive, `/`-separated (`""` = root) – display only.
    pub inner: String,
    pub format: ArchiveFormat,
    /// Entries hidden because their name is unsafe (`..`, absolute, drive letter …).
    pub unsafe_entries: u32,
    /// All entries of the archive (incl. unsafe ones).
    pub entries: u32,
    /// Some entry (or the list of names) is encrypted (design 025 E4).
    pub encrypted: bool,
    /// A password for this archive is known (entered this session).
    pub password_known: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryType {
    File,
    Dir,
    /// Symbolic or hard link – listed, never extracted.
    Link,
    /// Device, FIFO, sparse … – listed as a file, never extracted.
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    /// Checked name components (never empty, never `..`).
    pub name: Vec<String>,
    pub kind: EntryType,
    /// Declared uncompressed size.
    pub size: u64,
    pub modified_ms: Option<i64>,
    /// Unix permission bits, if the archive has them.
    pub mode: Option<u32>,
    /// Position in the archive: ZIP/7z index, or ordinal in the TAR/RAR stream.
    pub pos: usize,
    /// The data needs a password (design 025 E4).
    pub encrypted: bool,
}

/// One entry as a format reader sees it, before the name check.
#[derive(Debug, Clone)]
pub(crate) struct RawEntry {
    pub name: String,
    pub kind: EntryType,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub mode: Option<u32>,
    pub pos: usize,
    pub encrypted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveIndex {
    pub format: ArchiveFormat,
    pub entries: Vec<IndexEntry>,
    /// Entries with an unsafe name (not in `entries`).
    pub unsafe_entries: u32,
    pub total_entries: u32,
    pub archive_size: u64,
    /// Bytes of all stored names (bounded by [`MAX_NAME_BYTES`]).
    pub name_bytes: usize,
    /// Some entry is encrypted, or the names are (7z `-mhe`, RAR `-hp`).
    pub encrypted: bool,
}

pub(crate) fn archive_error(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveError, message, Some(path))
}

pub(crate) fn too_large(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveTooLarge, message, Some(path))
}

/// A decoding error of an encrypted entry: almost always a wrong password.
pub(crate) fn password_wrong(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::ArchivePasswordWrong,
        "Wrong password (or a broken archive)",
        Some(path),
    )
}

pub(crate) fn zip_error(e: zip::result::ZipError, path: &Path) -> FsError {
    use zip::result::ZipError;
    match e {
        ZipError::Io(io) => FsError::from_io(&io, path),
        ZipError::FileNotFound => {
            FsError::new(FsErrorCode::NotFound, "Not in the archive", Some(path))
        }
        ZipError::CompressionMethodNotSupported(m) => {
            archive_error(format!("Compression method {m} is not supported"), path)
        }
        ZipError::InvalidPassword => FsError::new(
            FsErrorCode::ArchivePasswordWrong,
            "Wrong password",
            Some(path),
        ),
        ZipError::UnsupportedArchive(m) if m == ZipError::PASSWORD_REQUIRED => FsError::new(
            FsErrorCode::ArchivePasswordRequired,
            "The entry is encrypted – a password is needed",
            Some(path),
        ),
        ZipError::UnsupportedArchive(m) => archive_error(format!("Not supported: {m}"), path),
        other => archive_error(format!("Broken archive: {other}"), path),
    }
}

/// Checks one entry name of an archive (design 016 E3.1). `\` counts as a
/// separator; `.` and empty parts are skipped. Refused: absolute names, `..`,
/// drive letters and `:` (Windows ADS), NUL and control characters, and every
/// part `paths::validate_name` refuses (Windows rules on Windows). `Ok(vec![])`
/// = the root entry (`./`), which is ignored.
pub fn sanitize(raw: &str) -> Result<Vec<String>, &'static str> {
    if raw.contains('\0') {
        return Err("contains a NUL character");
    }
    if raw.starts_with('/') || raw.starts_with('\\') {
        return Err("absolute path");
    }
    let mut out = Vec::new();
    for part in raw.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err("leads out of the target folder (..)");
        }
        if part.contains(':') {
            return Err("drive letter or ':' in the name");
        }
        if part.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}') {
            return Err("control character in the name");
        }
        if validate_name(part).is_err() {
            return Err("name not allowed on this system");
        }
        out.push(part.to_string());
    }
    Ok(out)
}

/// Seconds since the epoch of a civil date in UTC (proleptic Gregorian).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Civil date (UTC) of days since the epoch.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// ZIP (DOS) time → ms. DOS times carry no time zone; the convention (Info-ZIP,
/// 7-Zip, Windows) is local time (design 025 E7). Exact times come from the
/// Extended Timestamp field ([`zip_mtime_ms`]) where there is one.
fn zip_ms(t: zip::DateTime) -> Option<i64> {
    if !t.is_valid() {
        return None;
    }
    let days = days_from_civil(
        i64::from(t.year()),
        u32::from(t.month()),
        u32::from(t.day()),
    );
    let local = days * 86_400
        + i64::from(t.hour()) * 3600
        + i64::from(t.minute()) * 60
        + i64::from(t.second());
    Some(crate::platform::clock::local_to_utc_secs(local) * 1000)
}

/// A packed DOS date/time (RAR 4, `HeaderDataEx.FileTime`) in local time → ms.
#[cfg_attr(not(feature = "rar"), allow(dead_code))]
pub(crate) fn dos_local_ms(dos: u32) -> Option<i64> {
    let (date, time) = ((dos >> 16) as u16, dos as u16);
    let t = zip::DateTime::try_from_msdos(date, time).ok()?;
    zip_ms(t)
}

/// The modification time of a ZIP entry: Extended Timestamp (UTC) if present,
/// else the DOS time as local time.
pub(crate) fn zip_mtime_ms<R: Read>(f: &zip::read::ZipFile<'_, R>) -> Option<i64> {
    let ext = f.extra_data_fields().find_map(|x| match x {
        zip::ExtraField::ExtendedTimestamp(t) => t.mod_time(),
        _ => None,
    });
    match ext {
        Some(secs) => Some(i64::from(secs) * 1000),
        None => f.last_modified().and_then(zip_ms),
    }
}

/// The Extended Timestamp extra field (`0x5455`, modification time only).
pub(crate) fn zip_ext_time(modified: Option<std::time::SystemTime>) -> Option<[u8; 5]> {
    let secs = modified?.duration_since(UNIX_EPOCH).ok()?.as_secs();
    let secs = u32::try_from(secs).ok()?;
    let b = secs.to_le_bytes();
    Some([1, b[0], b[1], b[2], b[3]])
}

/// Modification time → ZIP time (local time, 1980–2107; outside: the ZIP default).
pub(crate) fn zip_time(modified: Option<std::time::SystemTime>) -> zip::DateTime {
    let Some(utc) = modified
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
    else {
        return zip::DateTime::default();
    };
    let secs = utc + crate::platform::clock::local_offset_secs(utc);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rest = secs.rem_euclid(86_400);
    let (h, mi, s) = (
        (rest / 3600) as u8,
        ((rest / 60) % 60) as u8,
        (rest % 60) as u8,
    );
    u16::try_from(y)
        .ok()
        .and_then(|y| zip::DateTime::from_date_and_time(y, m as u8, d as u8, h, mi, s).ok())
        .unwrap_or_default()
}

/// Counts what a reader produced and fails once it exceeds `limit` (TAR.GZ
/// bombs: the gzip stream is decompressed while it is read).
pub(crate) struct LimitedReader<R> {
    pub inner: R,
    pub read: u64,
    pub limit: u64,
}

impl<R: Read> Read for LimitedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        if self.read > self.limit {
            return Err(io::Error::other(BOMB_MESSAGE));
        }
        Ok(n)
    }
}

pub(crate) const BOMB_MESSAGE: &str =
    "The archive unpacks to far more data than it holds (zip bomb?) – refused";

/// Unpacked bytes a Deflate archive (ZIP, TAR.GZ) of `archive_size` may produce at most.
pub fn unpack_limit(archive_size: u64) -> u64 {
    unpack_limit_for(ArchiveFormat::Zip, archive_size)
}

/// Unpacked bytes an archive of `format` and `archive_size` may produce at most.
pub fn unpack_limit_for(format: ArchiveFormat, archive_size: u64) -> u64 {
    archive_size
        .saturating_mul(format.max_ratio())
        .saturating_add(RATIO_SLACK)
        .min(MAX_TOTAL_SIZE)
}

/// Opens the stream of a TAR or TAR.GZ archive (gzip counted against the bomb limit).
pub(crate) fn tar_stream(
    file: File,
    format: ArchiveFormat,
    archive_size: u64,
) -> Box<dyn Read + Send> {
    let buffered = BufReader::new(file);
    match format {
        ArchiveFormat::TarGz => Box::new(LimitedReader {
            inner: flate2::read::MultiGzDecoder::new(buffered),
            read: 0,
            limit: unpack_limit(archive_size),
        }),
        _ => Box::new(buffered),
    }
}

fn check_limits(index: &ArchiveIndex, path: &Path) -> Result<(), FsError> {
    let total: u64 = index
        .entries
        .iter()
        .filter(|e| e.kind == EntryType::File)
        .map(|e| e.size)
        .fold(0u64, u64::saturating_add);
    if total > MAX_TOTAL_SIZE {
        return Err(too_large(
            format!(
                "The archive would unpack to more than {} GiB – refused",
                MAX_TOTAL_SIZE >> 30
            ),
            path,
        ));
    }
    if total > unpack_limit_for(index.format, index.archive_size) {
        return Err(too_large(BOMB_MESSAGE, path));
    }
    Ok(())
}

fn push_entry(index: &mut ArchiveIndex, raw: RawEntry) {
    index.total_entries += 1;
    if raw.encrypted {
        index.encrypted = true;
    }
    match sanitize(&raw.name) {
        Ok(name) if name.is_empty() => {}
        Ok(name) => {
            index.name_bytes += name.iter().map(|n| n.len() + 1).sum::<usize>();
            index.entries.push(IndexEntry {
                name,
                kind: raw.kind,
                size: if raw.kind == EntryType::Dir {
                    0
                } else {
                    raw.size
                },
                modified_ms: raw.modified_ms,
                mode: raw.mode,
                pos: raw.pos,
                encrypted: raw.encrypted,
            })
        }
        Err(_) => index.unsafe_entries += 1,
    }
}

fn names_too_long(index: &ArchiveIndex, path: &Path) -> Result<(), FsError> {
    if index.name_bytes > MAX_NAME_BYTES {
        return Err(too_large(
            format!(
                "The names in the archive exceed {} MiB – refused",
                MAX_NAME_BYTES >> 20
            ),
            path,
        ));
    }
    Ok(())
}

pub(crate) fn too_many(path: &Path) -> FsError {
    too_large(
        format!("The archive has more than {MAX_ENTRIES} entries – refused"),
        path,
    )
}

/// Reads the index of an archive (no data is extracted; TAR.GZ is decompressed
/// once as a stream). Fails on broken archives, on the zip-bomb limits and when
/// a TAR stream takes longer than [`INDEX_TIME`].
pub fn read_index(path: &Path) -> Result<ArchiveIndex, FsError> {
    read_index_until(path, Instant::now() + INDEX_TIME)
}

/// [`read_index`] with an explicit deadline for TAR streams (tests).
pub fn read_index_until(path: &Path, deadline: Instant) -> Result<ArchiveIndex, FsError> {
    let format = path
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| format_of_name(n).or_else(|| comic_format(n)))
        .ok_or_else(|| {
            archive_error("Not a supported archive (ZIP, TAR, TAR.GZ, 7z, RAR)", path)
        })?;
    read_index_as(path, format, deadline)
}

/// [`read_index_until`] for a file whose name does not tell the format (the temporary
/// file of a rewrite, design 035 E2).
pub fn read_index_as(
    path: &Path,
    format: ArchiveFormat,
    deadline: Instant,
) -> Result<ArchiveIndex, FsError> {
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let meta = file.metadata().map_err(|e| FsError::from_io(&e, path))?;
    if !meta.is_file() {
        return Err(archive_error("Not a file", path));
    }
    let mut index = ArchiveIndex {
        format,
        entries: Vec::new(),
        unsafe_entries: 0,
        total_entries: 0,
        archive_size: meta.len(),
        name_bytes: 0,
        encrypted: false,
    };
    match format {
        ArchiveFormat::Zip => {
            let za = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| zip_error(e, path))?;
            if za.len() > MAX_ENTRIES {
                return Err(too_many(path));
            }
            for i in 0..za.len() {
                let e = za.by_index_data(i).map_err(|e| zip_error(e, path))?;
                let name = match e.name() {
                    Ok(n) => n.into_owned(),
                    Err(_) => {
                        index.total_entries += 1;
                        index.unsafe_entries += 1;
                        continue;
                    }
                };
                let kind = if e.is_symlink() {
                    EntryType::Link
                } else if e.is_dir() {
                    EntryType::Dir
                } else if e
                    .unix_mode()
                    .is_some_and(|m| m & 0o170000 != 0 && m & 0o170000 != 0o100000)
                {
                    EntryType::Other
                } else {
                    EntryType::File
                };
                let raw = RawEntry {
                    name,
                    kind,
                    size: e.size(),
                    modified_ms: e.last_modified().and_then(zip_ms),
                    mode: e.unix_mode().map(|m| m & 0o777),
                    pos: i,
                    encrypted: e.encrypted(),
                };
                push_entry(&mut index, raw);
            }
            names_too_long(&index, path)?;
        }
        ArchiveFormat::SevenZ => {
            drop(file);
            let (_, archive, header_encrypted) = sevenz::open(path)?;
            if archive.files.len() > MAX_ENTRIES {
                return Err(too_many(path));
            }
            index.encrypted = header_encrypted;
            for raw in sevenz::raw_entries(&archive) {
                push_entry(&mut index, raw);
            }
            names_too_long(&index, path)?;
        }
        #[cfg(feature = "rar")]
        ArchiveFormat::Rar => {
            drop(file);
            let pw = secrets::get(path);
            let (headers, header_encrypted) = rar::headers(path, pw.as_ref(), MAX_ENTRIES)?;
            index.encrypted = header_encrypted;
            for (pos, h) in headers.into_iter().enumerate() {
                let raw = RawEntry {
                    name: h.name,
                    kind: h.kind,
                    size: h.size,
                    modified_ms: h.modified_ms,
                    mode: h.mode,
                    pos,
                    encrypted: h.encrypted,
                };
                push_entry(&mut index, raw);
                names_too_long(&index, path)?;
            }
        }
        #[cfg(not(feature = "rar"))]
        ArchiveFormat::Rar => {
            return Err(archive_error("RAR support is not built in", path));
        }
        ArchiveFormat::Tar | ArchiveFormat::TarGz => {
            let mut archive = tar::Archive::new(tar_stream(file, format, meta.len()));
            let raw = archive.entries().map_err(|e| tar_error(&e, path))?;
            for item in TarEntries::new(raw) {
                let (pos, name, entry) = item.map_err(|e| tar_error(&e, path))?;
                if index.total_entries as usize >= MAX_ENTRIES {
                    return Err(too_many(path));
                }
                if Instant::now() >= deadline {
                    return Err(too_large(
                        format!(
                            "Listing the archive took longer than {} s – too large to show as a folder (it can still be unpacked)",
                            INDEX_TIME.as_secs()
                        ),
                        path,
                    ));
                }
                let header = entry.header();
                let kind = tar_kind(header.entry_type());
                let raw = name_string(name);
                let raw = RawEntry {
                    name: raw,
                    kind,
                    size: entry.size(),
                    modified_ms: header.mtime().ok().map(|s| (s as i64).saturating_mul(1000)),
                    mode: header.mode().ok().map(|m| m & 0o777),
                    pos,
                    encrypted: false,
                };
                push_entry(&mut index, raw);
                names_too_long(&index, path)?;
            }
        }
    }
    check_limits(&index, path)?;
    Ok(index)
}

/// The real entries of a TAR stream (review 016 #1/#2). The `tar` crate runs in
/// raw mode – its own handling reads GNU long names and PAX headers with
/// `read_all`, without any limit – and the metadata headers are handled here:
/// GNU `L`/`K` and PAX `x`/`g` with at most [`MAX_TAR_META`] bytes, the name
/// from `L` or PAX `path` goes to the next entry; `g`, `K`, volume and
/// multi-volume headers are skipped. Metadata headers are never entries and do
/// not count for `pos` (index and extraction count alike).
pub(crate) struct TarEntries<'a, R: 'a + Read> {
    inner: tar::Entries<'a, R>,
    pos: usize,
}

/// One real TAR entry: position, raw name bytes, the entry (for its data).
pub(crate) type TarItem<'a, R> = (usize, Vec<u8>, tar::Entry<'a, R>);

impl<'a, R: Read> TarEntries<'a, R> {
    pub(crate) fn new(entries: tar::Entries<'a, R>) -> Self {
        Self {
            inner: entries.raw(true),
            pos: 0,
        }
    }
}

fn meta_error(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}

/// The data of a metadata header, at most [`MAX_TAR_META`] bytes.
fn read_meta<R: Read>(entry: &mut tar::Entry<'_, R>) -> io::Result<Vec<u8>> {
    if entry.size() > MAX_TAR_META {
        return Err(meta_error(&format!(
            "metadata header larger than {} KiB – refused",
            MAX_TAR_META >> 10
        )));
    }
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.take(MAX_TAR_META + 1).read_to_end(&mut buf)?;
    Ok(buf)
}

/// The value of `key` in PAX records (`"<len> key=value\n"`); malformed → error.
fn pax_value(mut data: &[u8], key: &[u8]) -> io::Result<Option<Vec<u8>>> {
    let mut found = None;
    while !data.is_empty() {
        let sp = data
            .iter()
            .position(|b| *b == b' ')
            .ok_or_else(|| meta_error("malformed PAX header"))?;
        let len: usize = std::str::from_utf8(&data[..sp])
            .ok()
            .and_then(|s| s.parse().ok())
            .filter(|l| *l > sp + 1 && *l <= data.len())
            .ok_or_else(|| meta_error("malformed PAX header"))?;
        let record = &data[sp + 1..len];
        let record = record.strip_suffix(b"\n").unwrap_or(record);
        if let Some(eq) = record.iter().position(|b| *b == b'=')
            && &record[..eq] == key
        {
            found = Some(record[eq + 1..].to_vec());
        }
        data = &data[len..];
    }
    Ok(found)
}

impl<'a, R: Read> Iterator for TarEntries<'a, R> {
    type Item = io::Result<TarItem<'a, R>>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut long_name: Option<Vec<u8>> = None;
        let mut pax_path: Option<Vec<u8>> = None;
        let mut pending = false;
        loop {
            let mut entry = match self.inner.next() {
                None if pending => {
                    return Some(Err(meta_error("metadata header without an entry")));
                }
                None => return None,
                Some(Err(e)) => return Some(Err(e)),
                Some(Ok(e)) => e,
            };
            let t = entry.header().entry_type();
            let meta = t.is_gnu_longname()
                || t.is_gnu_longlink()
                || t.is_pax_local_extensions()
                || t.is_pax_global_extensions()
                || matches!(t.as_byte(), b'V' | b'M' | b'N');
            if meta {
                let data = match read_meta(&mut entry) {
                    Ok(d) => d,
                    Err(e) => return Some(Err(e)),
                };
                if t.is_gnu_longname() {
                    let end = data.iter().position(|b| *b == 0).unwrap_or(data.len());
                    long_name = Some(data[..end].to_vec());
                    pending = true;
                } else if t.is_pax_local_extensions() {
                    match pax_value(&data, b"path") {
                        Ok(v) => pax_path = v.or(pax_path),
                        Err(e) => return Some(Err(e)),
                    }
                    // raw mode reads the header size: a PAX size (files > 8 GiB) would desync the stream
                    match pax_value(&data, b"size") {
                        Ok(Some(_)) => {
                            return Some(Err(meta_error(
                                "PAX size headers (files over 8 GiB) are not supported",
                            )));
                        }
                        Ok(None) => {}
                        Err(e) => return Some(Err(e)),
                    }
                    pending = true;
                } else if t.is_gnu_longlink() {
                    pending = true;
                }
                continue;
            }
            if t.is_gnu_sparse()
                && entry
                    .header()
                    .as_gnu()
                    .is_some_and(tar::GnuHeader::is_extended)
            {
                return Some(Err(meta_error(
                    "GNU sparse files with extended headers are not supported",
                )));
            }
            let name = pax_path
                .take()
                .or(long_name.take())
                .unwrap_or_else(|| entry.path_bytes().into_owned());
            let pos = self.pos;
            self.pos += 1;
            return Some(Ok((pos, name, entry)));
        }
    }
}

/// A raw TAR name as text without a second copy when it is valid UTF-8.
pub(crate) fn name_string(raw: Vec<u8>) -> String {
    String::from_utf8(raw).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

pub(crate) fn tar_kind(t: tar::EntryType) -> EntryType {
    use tar::EntryType as T;
    match t {
        T::Regular | T::Continuous => EntryType::File,
        T::Directory => EntryType::Dir,
        T::Symlink | T::Link => EntryType::Link,
        _ => EntryType::Other,
    }
}

pub(crate) fn tar_error(e: &io::Error, path: &Path) -> FsError {
    if e.to_string() == BOMB_MESSAGE {
        return too_large(BOMB_MESSAGE, path);
    }
    match e.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied => FsError::from_io(e, path),
        _ => archive_error(format!("Broken archive: {e}"), path),
    }
}

type CacheKey = (PathBuf, u64, Option<std::time::SystemTime>);
type Cache = Mutex<VecDeque<(CacheKey, Arc<ArchiveIndex>)>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(VecDeque::new()))
}

/// [`read_index`] through a small LRU (key: path + size + modification time).
pub fn index_of(path: &Path) -> Result<Arc<ArchiveIndex>, FsError> {
    let meta = fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    let key: CacheKey = (path.to_path_buf(), meta.len(), meta.modified().ok());
    {
        let mut c = cache().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(i) = c.iter().position(|(k, _)| *k == key) {
            let hit = c.remove(i).expect("position is valid");
            let index = hit.1.clone();
            c.push_back(hit);
            return Ok(index);
        }
    }
    // read without the lock: a large TAR.GZ takes a while
    let index = Arc::new(read_index(path)?);
    let mut c = cache().lock().unwrap_or_else(|e| e.into_inner());
    c.retain(|(k, _)| k.0 != key.0);
    c.push_back((key, index.clone()));
    while c.len() > CACHE_SIZE {
        c.pop_front();
    }
    Ok(index)
}

/// Drops the cached index of `path` (after the archive was rewritten, design 035 E2): a new
/// file with the same size and a coarse modification time must not show the old content.
pub fn forget_index(path: &Path) {
    let mut c = cache().lock().unwrap_or_else(|e| e.into_inner());
    c.retain(|(k, _)| k.0 != path);
}

/// Splits a path that leads into an archive: the nearest ancestor (or the path
/// itself) that is a regular file with an archive extension, plus the inner
/// components. `None` if the path is a real entry or no archive is on its way.
pub fn resolve(path: &Path) -> Option<(PathBuf, Vec<String>)> {
    let mut inner: Vec<String> = Vec::new();
    let mut p = path;
    for _ in 0..MAX_INNER_DEPTH {
        match fs::metadata(p) {
            Ok(m) => {
                let is_archive = m.is_file()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .and_then(format_of_name)
                        .is_some();
                if !is_archive {
                    return None;
                }
                inner.reverse();
                return Some((p.to_path_buf(), inner));
            }
            Err(_) => {
                inner.push(p.file_name()?.to_str()?.to_string());
                p = p.parent()?;
            }
        }
    }
    None
}

/// The virtual path of `inner` in `archive`.
pub fn virtual_path(archive: &Path, inner: &[String]) -> PathBuf {
    let mut p = archive.to_path_buf();
    for c in inner {
        p.push(c);
    }
    p
}

/// Inner components of a virtual path (`None` if it does not lie in `archive`).
pub fn inner_of(archive: &Path, virtual_path: &Path) -> Option<Vec<String>> {
    let rest = virtual_path.strip_prefix(archive).ok()?;
    rest.components()
        .map(|c| match c {
            std::path::Component::Normal(s) => s.to_str().map(str::to_string),
            _ => None,
        })
        .collect()
}

#[derive(Default)]
struct Child {
    kind: Option<EntryType>,
    size: u64,
    modified_ms: Option<i64>,
    /// A folder (explicit or implied by deeper entries).
    dir: bool,
}

/// Lists folder `inner` of an archive like a directory (folders first, then by
/// name); folder sizes are the sums of the files below them.
pub fn list(archive: &Path, inner: &[String]) -> Result<DirectoryListing, FsError> {
    let index = index_of(archive)?;
    list_index(archive, &index, inner)
}

pub fn list_index(
    archive: &Path,
    index: &ArchiveIndex,
    inner: &[String],
) -> Result<DirectoryListing, FsError> {
    let here = virtual_path(archive, inner);
    let mut children: BTreeMap<&str, Child> = BTreeMap::new();
    let mut found = inner.is_empty();
    for e in &index.entries {
        if e.name.len() < inner.len() || e.name[..inner.len()] != *inner {
            continue;
        }
        if e.name.len() == inner.len() {
            if e.kind == EntryType::Dir {
                found = true;
            }
            continue;
        }
        found = true;
        let c = children.entry(e.name[inner.len()].as_str()).or_default();
        if e.name.len() == inner.len() + 1 {
            match e.kind {
                EntryType::Dir => {
                    c.dir = true;
                    c.modified_ms = c.modified_ms.or(e.modified_ms);
                }
                kind => {
                    if c.kind.is_none() {
                        c.kind = Some(kind);
                        c.size = e.size;
                        c.modified_ms = e.modified_ms;
                    }
                }
            }
        } else {
            c.dir = true;
            if e.kind == EntryType::File {
                c.size = c.size.saturating_add(e.size);
            }
        }
    }
    if !found {
        return Err(FsError::new(
            FsErrorCode::NotFound,
            "This folder is not in the archive",
            Some(&here),
        ));
    }
    let mut entries: Vec<DirEntryDto> = children
        .into_iter()
        .map(|(name, c)| {
            let (kind, target_kind, size) = if c.dir {
                // a folder wins over a file of the same name (the file is not reachable then)
                (EntryKind::Directory, None, Some(c.size))
            } else {
                match c.kind {
                    Some(EntryType::Link) => (EntryKind::Symlink, None, None),
                    _ => (EntryKind::File, None, Some(c.size)),
                }
            };
            DirEntryDto {
                name: name.to_string(),
                path: here.join(name).to_string_lossy().into_owned(),
                kind,
                target_kind,
                size,
                modified_ms: c.modified_ms,
                hidden: name.starts_with('.'),
                lossy_name: false,
            }
        })
        .collect();
    entries.sort_by(compare_entries);
    let parent = here.parent().map(|p| p.to_string_lossy().into_owned());
    Ok(DirectoryListing {
        path: here.to_string_lossy().into_owned(),
        parent,
        segments: segments_of(&here),
        entries,
        unreadable_entries: 0,
        archive: Some(ArchiveInfo {
            path: archive.to_string_lossy().into_owned(),
            inner: inner.join("/"),
            format: index.format,
            unsafe_entries: index.unsafe_entries,
            entries: index.total_entries,
            encrypted: index.encrypted,
            password_known: secrets::known(archive),
        }),
        network: false,
        remote: None,
    })
}

/// `list_directory` with the archive fallback: a folder as before; an archive
/// file, or a path below one, as a virtual folder.
pub fn list_directory_or_archive(dir: &Path) -> Result<DirectoryListing, FsError> {
    match crate::listing::list_directory(dir) {
        Ok(l) => Ok(l),
        Err(e) if matches!(e.code, FsErrorCode::NotADirectory | FsErrorCode::NotFound) => {
            match resolve(dir) {
                Some((archive, inner)) => list(&archive, &inner),
                None => Err(e),
            }
        }
        Err(e) => Err(e),
    }
}

/// Largest entry read completely to check a password (bigger ones: the
/// password check value only – a wrong password shows when extracting).
const VERIFY_BYTES: u64 = 16 << 20;

/// Checks `secret` against `archive` and remembers it if it fits (design 025 E4):
/// 7z/RAR with encrypted names – the names must decode; encrypted data – the
/// smallest encrypted entry (≤ 16 MiB) must decode with a valid checksum.
pub fn set_password(path: &Path, secret: secrets::Secret) -> Result<(), FsError> {
    // a virtual path (F3 on an entry) stands for its archive
    let resolved;
    let archive = if fs::symlink_metadata(path).is_ok() {
        path
    } else {
        resolved = resolve(path)
            .map(|(a, _)| a)
            .ok_or_else(|| FsError::new(FsErrorCode::NotFound, "Not found", Some(path)))?;
        resolved.as_path()
    };
    let format = archive
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(format_of_name)
        .ok_or_else(|| archive_error("Not a supported archive", archive))?;
    if secret.is_empty() {
        return Err(password_wrong(archive));
    }
    match format {
        ArchiveFormat::Zip => verify_zip(archive, &secret)?,
        ArchiveFormat::SevenZ => verify_7z(archive, &secret)?,
        #[cfg(feature = "rar")]
        ArchiveFormat::Rar => verify_rar(archive, &secret)?,
        // TAR has no encryption: nothing to check
        _ => {}
    }
    secrets::remember(archive, secret);
    Ok(())
}

fn drain_bounded(r: &mut dyn Read, path: &Path) -> Result<(), FsError> {
    let mut limited = r.take(VERIFY_BYTES);
    io::copy(&mut limited, &mut io::sink())
        .map(|_| ())
        .map_err(|_| password_wrong(path))
}

fn verify_zip(path: &Path, secret: &secrets::Secret) -> Result<(), FsError> {
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let mut za = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| zip_error(e, path))?;
    let mut smallest: Option<(usize, u64)> = None;
    for i in 0..za.len().min(MAX_ENTRIES) {
        let e = za.by_index_data(i).map_err(|e| zip_error(e, path))?;
        if e.encrypted() && !e.is_dir() && smallest.is_none_or(|(_, s)| e.size() < s) {
            smallest = Some((i, e.size()));
        }
    }
    let Some((i, size)) = smallest else {
        return Ok(());
    };
    let mut f = za
        .by_index_decrypt(i, secret.expose().as_bytes())
        .map_err(|e| zip_error(e, path))?;
    if size <= VERIFY_BYTES {
        drain_bounded(&mut f, path)?;
    }
    Ok(())
}

fn verify_7z(path: &Path, secret: &secrets::Secret) -> Result<(), FsError> {
    let mut file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    if sevenz_header::check(&mut file, path, Some(secret))?.empty {
        return Ok(()); // nothing in it, nothing encrypted (N4)
    }
    file.seek(io::SeekFrom::Start(0))
        .map_err(|e| FsError::from_io(&e, path))?;
    let mut reader = BufReader::new(file);
    let password = sevenz::password_of(Some(secret));
    let archive = match sevenz_rust2::Archive::read(&mut reader, &password) {
        Ok(a) => a,
        // with a password in play every decoding error of the header means "wrong"
        Err(sevenz_rust2::Error::Io(e, _))
            if matches!(
                e.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
            ) =>
        {
            return Err(FsError::from_io(&e, path));
        }
        Err(sevenz_rust2::Error::BadSignature(_)) => {
            return Err(archive_error("Not a 7z archive", path));
        }
        Err(_) => return Err(password_wrong(path)),
    };
    // the smallest encrypted block holding a file
    let block = archive
        .blocks
        .iter()
        .enumerate()
        .filter(|(_, b)| sevenz::block_encrypted(b))
        .min_by_key(|(_, b)| b.get_unpack_size())
        .map(|(i, _)| i);
    let Some(b) = block else {
        return Ok(());
    };
    sevenz::check_memory(&archive.blocks[b], path)?;
    // a block up to 16 MiB is read completely – every entry's CRC decides (review 025 #8:
    // AES over "copy" has no other check); a bigger one only for its first 16 MiB, a
    // wrong password that slips through fails the CRC when extracting (and is asked again)
    let whole = archive.blocks[b].get_unpack_size() <= VERIFY_BYTES;
    let mut result = Ok(());
    let decoded = sevenz_rust2::BlockDecoder::new(1, b, &archive, &password, &mut reader)
        .for_each_entries(&mut |_e, rd| {
            result = if whole {
                io::copy(rd, &mut io::sink())
                    .map(|_| ())
                    .map_err(|_| password_wrong(path))
            } else {
                drain_bounded(rd, path)
            };
            Ok(whole && result.is_ok())
        });
    if decoded.is_err() {
        return Err(password_wrong(path));
    }
    result
}

#[cfg(feature = "rar")]
fn verify_rar(path: &Path, secret: &secrets::Secret) -> Result<(), FsError> {
    let (headers, _) = rar::headers(path, Some(secret), MAX_ENTRIES)?;
    let mut a = rar::RarArchive::open(path, Some(secret), true, None)?;
    // solid: every entry before the target is decoded too – take the first encrypted
    // one and stop after [`VERIFY_BYTES`] in all (external review 025 #7)
    let candidates = headers
        .iter()
        .enumerate()
        .filter(|(_, h)| h.encrypted && h.kind == EntryType::File && !h.split);
    let target = if a.solid {
        candidates.map(|(i, _)| i).next()
    } else {
        candidates
            .filter(|(_, h)| h.size <= VERIFY_BYTES)
            .min_by_key(|(_, h)| h.size)
            .map(|(i, _)| i)
    };
    let Some(pos) = target else {
        return Ok(());
    };
    let mut budget = VERIFY_BYTES;
    let mut count = |chunk: &[u8]| {
        budget = budget.saturating_sub(chunk.len() as u64);
        budget > 0
    };
    let wrong = |e: FsError| {
        if e.code == FsErrorCode::ArchiveError {
            password_wrong(path)
        } else {
            e
        }
    };
    let mut i = 0usize;
    while let Some(h) = a.next_header()? {
        if i == pos {
            // `Ok(false)` = the budget ran out: as far as decoded, the password fits
            a.test_into(&h, &mut count).map_err(wrong)?;
            return Ok(());
        }
        if a.solid {
            if !a.test_into(&h, &mut count).map_err(wrong)? {
                return Ok(());
            }
        } else {
            a.skip(&h)?;
        }
        i += 1;
    }
    Ok(())
}
