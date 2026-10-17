//! Archives as virtual folders (design 016 E1–E3): ZIP, TAR and TAR.GZ are
//! read into an index (names checked, limits against zip bombs) and listed
//! like a folder under a *virtual path* `…/a.zip/inner/dir` (built with
//! `Path::join`, so the frontend keeps treating paths as opaque strings). A
//! virtual path can never exist on disk: one of its ancestors is a file.
//! Extraction and packing are jobs (`jobs/extract.rs`, `jobs/pack.rs`).
//! Pure std + `zip`/`tar`/`flate2`, without Tauri.

#[cfg(test)]
pub(crate) mod tests;

use crate::error::{FsError, FsErrorCode};
use crate::listing::compare_entries;
use crate::model::{DirEntryDto, DirectoryListing, EntryKind};
use crate::paths::{segments_of, validate_name};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File};
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

/// Entries per archive at most (listing and extraction).
pub const MAX_ENTRIES: usize = 200_000;
/// Sum of the declared (uncompressed) sizes at most.
pub const MAX_TOTAL_SIZE: u64 = 64 << 30;
/// Deflate reaches ~1 032 : 1 at best – more means overlapping entries or lying headers.
pub const MAX_RATIO: u64 = 1100;
/// Allowance on top of the ratio (tiny archives with a few empty-ish files).
pub const RATIO_SLACK: u64 = 1 << 20;
/// Archives whose index is kept (path + size + modification time as key).
const CACHE_SIZE: usize = 4;
/// Path components examined when resolving a virtual path.
const MAX_INNER_DEPTH: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveFormat {
    Zip,
    Tar,
    TarGz,
}

impl ArchiveFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ArchiveFormat::Zip => ".zip",
            ArchiveFormat::Tar => ".tar",
            ArchiveFormat::TarGz => ".tar.gz",
        }
    }
}

/// Format by file name (`.zip`, `.tar`, `.tar.gz`, `.tgz`, without case).
pub fn format_of_name(name: &str) -> Option<ArchiveFormat> {
    let n = name.to_lowercase();
    if n.ends_with(".zip") && n.len() > 4 {
        Some(ArchiveFormat::Zip)
    } else if (n.ends_with(".tar.gz") && n.len() > 7) || (n.ends_with(".tgz") && n.len() > 4) {
        Some(ArchiveFormat::TarGz)
    } else if n.ends_with(".tar") && n.len() > 4 {
        Some(ArchiveFormat::Tar)
    } else {
        None
    }
}

/// The archive name without its extension (`Fotos.tar.gz` → `Fotos`) – folder for "unpack into a subfolder".
pub fn stem_of(name: &str) -> String {
    let lower = name.to_lowercase();
    for ext in [".tar.gz", ".tgz", ".zip", ".tar"] {
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
    /// Position in the archive: ZIP index, or ordinal in the TAR stream.
    pub pos: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveIndex {
    pub format: ArchiveFormat,
    pub entries: Vec<IndexEntry>,
    /// Entries with an unsafe name (not in `entries`).
    pub unsafe_entries: u32,
    pub total_entries: u32,
    pub archive_size: u64,
}

pub(crate) fn archive_error(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveError, message, Some(path))
}

pub(crate) fn too_large(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveTooLarge, message, Some(path))
}

pub(crate) fn zip_error(e: zip::result::ZipError, path: &Path) -> FsError {
    use zip::result::ZipError;
    match e {
        ZipError::Io(io) => FsError::from_io(&io, path),
        ZipError::FileNotFound => {
            FsError::new(FsErrorCode::NotFound, "Not in the archive", Some(path))
        }
        ZipError::UnsupportedArchive(m) => archive_error(format!("Not supported: {m}"), path),
        ZipError::CompressionMethodNotSupported(m) => {
            archive_error(format!("Compression method {m} is not supported"), path)
        }
        ZipError::InvalidPassword => archive_error("Encrypted entries are not supported", path),
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

/// ZIP (DOS) time → ms. DOS times carry no time zone: read as UTC, written as
/// UTC by [`zip_time`] – our own archives round-trip exactly.
fn zip_ms(t: zip::DateTime) -> Option<i64> {
    if !t.is_valid() {
        return None;
    }
    let days = days_from_civil(
        i64::from(t.year()),
        u32::from(t.month()),
        u32::from(t.day()),
    );
    let secs = days * 86_400
        + i64::from(t.hour()) * 3600
        + i64::from(t.minute()) * 60
        + i64::from(t.second());
    Some(secs * 1000)
}

/// Modification time → ZIP time (UTC, 1980–2107; outside: the ZIP default).
pub(crate) fn zip_time(modified: Option<std::time::SystemTime>) -> zip::DateTime {
    let Some(secs) = modified
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
    else {
        return zip::DateTime::default();
    };
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

/// Unpacked bytes an archive of `archive_size` may produce at most.
pub fn unpack_limit(archive_size: u64) -> u64 {
    archive_size
        .saturating_mul(MAX_RATIO)
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
    if total > unpack_limit(index.archive_size) {
        return Err(too_large(BOMB_MESSAGE, path));
    }
    Ok(())
}

fn push_entry(
    index: &mut ArchiveIndex,
    raw: &str,
    kind: EntryType,
    size: u64,
    modified_ms: Option<i64>,
    mode: Option<u32>,
    pos: usize,
) {
    index.total_entries += 1;
    match sanitize(raw) {
        Ok(name) if name.is_empty() => {}
        Ok(name) => index.entries.push(IndexEntry {
            name,
            kind,
            size: if kind == EntryType::Dir { 0 } else { size },
            modified_ms,
            mode,
            pos,
        }),
        Err(_) => index.unsafe_entries += 1,
    }
}

fn too_many(path: &Path) -> FsError {
    too_large(
        format!("The archive has more than {MAX_ENTRIES} entries – refused"),
        path,
    )
}

/// Reads the index of an archive (no data is extracted; TAR.GZ is decompressed
/// once as a stream). Fails on broken archives and on the zip-bomb limits.
pub fn read_index(path: &Path) -> Result<ArchiveIndex, FsError> {
    let format = path
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(format_of_name)
        .ok_or_else(|| archive_error("Not a supported archive (ZIP, TAR, TAR.GZ)", path))?;
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
                let modified = e.last_modified().and_then(zip_ms);
                let mode = e.unix_mode().map(|m| m & 0o777);
                push_entry(&mut index, &name, kind, e.size(), modified, mode, i);
            }
        }
        ArchiveFormat::Tar | ArchiveFormat::TarGz => {
            let mut archive = tar::Archive::new(tar_stream(file, format, meta.len()));
            let entries = archive.entries().map_err(|e| tar_error(&e, path))?;
            for (pos, entry) in entries.enumerate() {
                let entry = entry.map_err(|e| tar_error(&e, path))?;
                if index.total_entries as usize >= MAX_ENTRIES {
                    return Err(too_many(path));
                }
                let header = entry.header();
                let kind = tar_kind(header.entry_type());
                let raw = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
                let modified = header.mtime().ok().map(|s| (s as i64).saturating_mul(1000));
                let mode = header.mode().ok().map(|m| m & 0o777);
                push_entry(&mut index, &raw, kind, entry.size(), modified, mode, pos);
            }
        }
    }
    check_limits(&index, path)?;
    Ok(index)
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
        }),
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
