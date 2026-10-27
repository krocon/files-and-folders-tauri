//! Compare two folder trees (design 036 E2): pure std code, no Tauri. Both trees
//! are walked side by side; entries are paired by a key (NFC, optionally without
//! case) and every pair becomes one [`CompareRow`] with a [`CompareStatus`].
//! Links are never followed, folders that exist on one side only are walked
//! as well (each file in them is a row of its own). The job `compare` streams
//! the rows; the job `sync` (`jobs/sync.rs`) executes what the user chose.

use crate::error::{FsError, FsErrorCode};
use crate::jobs::ItemError;
use crate::listing::is_hidden;
use crate::model::EntryKind;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

/// Rows per comparison unless the options say less (the result is a list in a dialog).
pub const MAX_ROWS: u32 = 200_000;
pub const MAX_DEPTH: usize = 256;
/// Largest time tolerance (one day).
pub const MAX_TOLERANCE_SECS: u32 = 86_400;
const MAX_ERRORS: usize = 1000;
const BLOCK: usize = 1024 * 1024;
const MAX_PATTERN_LEN: usize = 4096;

fn default_true() -> bool {
    true
}
fn default_tolerance() -> u32 {
    2
}
/// macOS (APFS/HFS+) and Windows (NTFS) ignore case by default, Linux does not.
pub fn default_ignore_case() -> bool {
    cfg!(any(target_os = "macos", windows))
}
fn default_exclude() -> String {
    ".git; node_modules".into()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareOptions {
    #[serde(default = "default_true")]
    pub recursive: bool,
    /// Byte-wise comparison of files with the same size.
    #[serde(default)]
    pub content: bool,
    /// Only size (and content) count, not the time.
    #[serde(default)]
    pub ignore_date: bool,
    #[serde(default = "default_tolerance")]
    pub tolerance_secs: u32,
    /// Differences of exactly one hour (± tolerance) count as equal (DST, FAT).
    #[serde(default)]
    pub ignore_hour: bool,
    #[serde(default = "default_ignore_case")]
    pub ignore_case: bool,
    #[serde(default)]
    pub hidden: bool,
    /// Glob(s) for file names, `;`-separated; empty / `*` = all files.
    #[serde(default)]
    pub filter: String,
    /// Glob(s) of names that are skipped (folders are not entered).
    #[serde(default = "default_exclude")]
    pub exclude: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_rows: Option<u32>,
}

impl Default for CompareOptions {
    fn default() -> Self {
        Self {
            recursive: true,
            content: false,
            ignore_date: false,
            tolerance_secs: default_tolerance(),
            ignore_hour: false,
            ignore_case: default_ignore_case(),
            hidden: false,
            filter: String::new(),
            exclude: default_exclude(),
            max_rows: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompareStatus {
    Equal,
    LeftNewer,
    RightNewer,
    /// Different, but neither side is newer (or the time is ignored).
    Differs,
    OnlyLeft,
    OnlyRight,
    /// A file on one side, a folder or link on the other.
    KindMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareSide {
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRow {
    /// Relative path for display (`/`-separated, the names of the left side where it has them).
    pub rel: String,
    /// 0 = directly in the compared folders.
    pub depth: u32,
    pub left: Option<CompareSide>,
    pub right: Option<CompareSide>,
    /// Where the entry is – or would be after a copy – on each side (Rust builds every path).
    pub left_path: String,
    pub right_path: String,
    pub status: CompareStatus,
    /// The content was compared (byte-wise).
    pub content_checked: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareStats {
    pub dirs: u64,
    pub files: u64,
    pub rows: u64,
    /// Rows whose status is not `equal`.
    pub differences: u64,
    pub bytes_compared: u64,
    pub truncated: bool,
    /// Unreadable folders/files (the first 1 000).
    pub errors: Vec<ItemError>,
    pub unreadable: u64,
}

/// Compiled options.
pub struct Compiled {
    left: PathBuf,
    right: PathBuf,
    opts: CompareOptions,
    filter: Option<Regex>,
    exclude: Option<Regex>,
    max_rows: u64,
}

/// Checks the options and both roots (folders, not the same, not inside each other).
pub fn compile(left: &Path, right: &Path, opts: &CompareOptions) -> Result<Compiled, FsError> {
    if opts.tolerance_secs > MAX_TOLERANCE_SECS {
        return Err(FsError::new(
            FsErrorCode::InvalidPattern,
            "The time tolerance is too large",
            None,
        ));
    }
    if opts.filter.len() > MAX_PATTERN_LEN || opts.exclude.len() > MAX_PATTERN_LEN {
        return Err(FsError::new(
            FsErrorCode::InvalidPattern,
            "Pattern too long",
            None,
        ));
    }
    let filter = crate::search::glob_set(&opts.filter)?;
    let exclude = crate::search::glob_set(&opts.exclude)?;
    if !opts.exclude.trim().is_empty() && exclude.is_none() {
        return Err(FsError::new(
            FsErrorCode::InvalidPattern,
            "An exclusion would skip every entry",
            None,
        ));
    }
    let left = crate::paths::normalize_lexically(left);
    let right = crate::paths::normalize_lexically(right);
    for root in [&left, &right] {
        let meta = fs::metadata(root).map_err(|e| FsError::from_io(&e, root))?;
        if !meta.is_dir() {
            return Err(FsError::new(
                FsErrorCode::NotADirectory,
                "Not a folder",
                Some(root),
            ));
        }
    }
    if left == right {
        return Err(FsError::new(
            FsErrorCode::SameSourceTarget,
            "Both sides show the same folder",
            Some(&left),
        ));
    }
    if left.starts_with(&right) || right.starts_with(&left) {
        return Err(FsError::new(
            FsErrorCode::TargetInsideSource,
            "One folder lies inside the other",
            Some(&left),
        ));
    }
    let max_rows = u64::from(opts.max_rows.unwrap_or(MAX_ROWS).clamp(1, MAX_ROWS));
    Ok(Compiled {
        left,
        right,
        opts: opts.clone(),
        filter,
        exclude,
        max_rows,
    })
}

/// NFC form of a name.
pub fn nfc(name: &str) -> String {
    icu_normalizer::ComposingNormalizerBorrowed::new_nfc()
        .normalize(name)
        .into_owned()
}

/// Pairing key of a name: NFC, without case if `ignore_case`.
pub fn key(name: &str, ignore_case: bool) -> String {
    let n = nfc(name);
    if ignore_case { n.to_lowercase() } else { n }
}

/// Two relative paths name the same place: every component equal by NFC, without case
/// (used by `sync` to check that a left and a right path belong together).
pub fn same_place(a: &Path, b: &Path) -> bool {
    let ca: Vec<_> = a.components().collect();
    let cb: Vec<_> = b.components().collect();
    ca.len() == cb.len()
        && ca.iter().zip(&cb).all(|(x, y)| {
            key(&x.as_os_str().to_string_lossy(), true)
                == key(&y.as_os_str().to_string_lossy(), true)
        })
}

/// What [`status_of`] needs of one side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts {
    pub kind: EntryKind,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    /// Link target (links only).
    pub target: Option<PathBuf>,
}

/// The time of `l` against `r`: `Some(Less)` = left older; `None` = equal within the rules.
fn time_order(l: Option<i64>, r: Option<i64>, opts: &CompareOptions) -> Option<std::cmp::Ordering> {
    let (Some(l), Some(r)) = (l, r) else {
        return None;
    };
    let tol = i64::from(opts.tolerance_secs) * 1000;
    let d = l - r;
    if d.abs() <= tol {
        return None;
    }
    if opts.ignore_hour && (d.abs() - 3_600_000).abs() <= tol {
        return None;
    }
    Some(d.cmp(&0))
}

/// Status of a pair present on both sides (pure, design 036 E2). `same_content`:
/// `Some` if the content was compared.
pub fn status_of(
    l: &Facts,
    r: &Facts,
    opts: &CompareOptions,
    same_content: Option<bool>,
) -> CompareStatus {
    use EntryKind::*;
    let by_time = || {
        if opts.ignore_date {
            return CompareStatus::Differs;
        }
        match time_order(l.modified_ms, r.modified_ms, opts) {
            Some(std::cmp::Ordering::Greater) => CompareStatus::LeftNewer,
            Some(std::cmp::Ordering::Less) => CompareStatus::RightNewer,
            _ => CompareStatus::Differs,
        }
    };
    match (l.kind, r.kind) {
        (Directory, Directory) => CompareStatus::Equal,
        (Symlink, Symlink) => {
            if l.target.is_some() && l.target == r.target {
                CompareStatus::Equal
            } else {
                by_time()
            }
        }
        (File, File) => {
            if l.size != r.size {
                return by_time();
            }
            match same_content {
                Some(true) => CompareStatus::Equal,
                Some(false) => by_time(),
                None => {
                    if opts.ignore_date || time_order(l.modified_ms, r.modified_ms, opts).is_none()
                    {
                        CompareStatus::Equal
                    } else {
                        by_time()
                    }
                }
            }
        }
        _ => CompareStatus::KindMismatch,
    }
}

/// Byte-wise comparison; `Ok(None)` = cancelled. `bytes` counts what was read (both files).
pub fn same_bytes(
    a: &Path,
    b: &Path,
    cancel: &AtomicBool,
    bytes: &mut u64,
) -> io::Result<Option<bool>> {
    let mut fa = crate::platform::open_regular_file_no_follow(a)?;
    let mut fb = crate::platform::open_regular_file_no_follow(b)?;
    if fa.metadata()?.len() != fb.metadata()?.len() {
        return Ok(Some(false));
    }
    let mut ba = vec![0u8; BLOCK];
    let mut bb = vec![0u8; BLOCK];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        let na = read_full(&mut fa, &mut ba)?;
        let nb = read_full(&mut fb, &mut bb)?;
        *bytes += (na + nb) as u64;
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(Some(false));
        }
        if na == 0 {
            return Ok(Some(true));
        }
    }
}

fn read_full(f: &mut File, buf: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match f.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(n)
}

/// One entry of one side.
#[derive(Debug, Clone)]
struct Entry {
    name: String,
    path: PathBuf,
    meta: Metadata,
}

impl Entry {
    fn kind(&self) -> EntryKind {
        let t = self.meta.file_type();
        if t.is_symlink() {
            EntryKind::Symlink
        } else if t.is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::File
        }
    }

    fn modified_ms(&self) -> Option<i64> {
        self.meta
            .modified()
            .ok()
            .and_then(|t| match t.duration_since(UNIX_EPOCH) {
                Ok(d) => i64::try_from(d.as_millis()).ok(),
                Err(e) => i64::try_from(e.duration().as_millis()).ok().map(|v| -v),
            })
    }

    fn facts(&self) -> Facts {
        let kind = self.kind();
        Facts {
            kind,
            size: (kind == EntryKind::File).then_some(self.meta.len()),
            modified_ms: self.modified_ms(),
            target: if kind == EntryKind::Symlink {
                fs::read_link(&self.path).ok()
            } else {
                None
            },
        }
    }

    fn side(&self) -> CompareSide {
        let kind = self.kind();
        CompareSide {
            path: self.path.to_string_lossy().into_owned(),
            name: self.name.clone(),
            kind,
            size: (kind == EntryKind::File).then_some(self.meta.len()),
            modified_ms: self.modified_ms(),
        }
    }
}

type Pair = (Option<Entry>, Option<Entry>);

/// A folder to walk: its two sides (one may be missing), relative path and depth.
struct Frame {
    pairs: std::vec::IntoIter<Pair>,
    ldir: PathBuf,
    rdir: PathBuf,
    rel: String,
    depth: u32,
}

/// Where rows and progress go: `Some(row)` for a row, `None` after each folder.
pub type Sink<'a> = dyn FnMut(Option<CompareRow>, &CompareStats) + 'a;

impl Compiled {
    pub fn left(&self) -> &Path {
        &self.left
    }
    pub fn right(&self) -> &Path {
        &self.right
    }

    fn keep(&self, e: &Entry) -> bool {
        if !self.opts.hidden && is_hidden(&e.name, &e.meta) {
            return false;
        }
        if self.exclude.as_ref().is_some_and(|re| re.is_match(&e.name)) {
            return false;
        }
        true
    }

    fn passes_filter(&self, e: &Entry) -> bool {
        e.meta.is_dir() || self.filter.as_ref().is_none_or(|re| re.is_match(&e.name))
    }

    fn read(&self, dir: &Path, stats: &mut CompareStats) -> Vec<Entry> {
        let rd = match fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(e) => {
                error(stats, dir, FsError::from_io(&e, dir));
                return Vec::new();
            }
        };
        let mut out = Vec::new();
        for item in rd {
            let Ok(item) = item else {
                continue;
            };
            let path = item.path();
            let name = item.file_name().to_string_lossy().into_owned();
            match fs::symlink_metadata(&path) {
                Ok(meta) => {
                    let e = Entry { name, path, meta };
                    if self.keep(&e) {
                        out.push(e);
                    }
                }
                Err(err) => error(stats, &path, FsError::from_io(&err, &path)),
            }
        }
        out
    }

    /// Pairs the entries of both sides by key, sorted by key; names that collide under
    /// the case-free key on one side are paired exactly (design 036 E1).
    fn pair(&self, left: Vec<Entry>, right: Vec<Entry>) -> Vec<Pair> {
        let ic = self.opts.ignore_case;
        let mut count: HashMap<String, (u32, u32)> = HashMap::new();
        if ic {
            for e in &left {
                count.entry(key(&e.name, true)).or_default().0 += 1;
            }
            for e in &right {
                count.entry(key(&e.name, true)).or_default().1 += 1;
            }
        }
        let key_of = |name: &str| {
            if ic {
                let k = key(name, true);
                if count.get(&k).is_some_and(|(l, r)| *l > 1 || *r > 1) {
                    // exact (still NFC), sorted next to the folded key
                    return format!("{k}\u{0}{}", nfc(name));
                }
                k
            } else {
                nfc(name)
            }
        };
        let mut map: BTreeMap<String, Pair> = BTreeMap::new();
        for e in left {
            let k = key_of(&e.name);
            map.entry(k).or_insert((None, None)).0 = Some(e);
        }
        for e in right {
            let k = key_of(&e.name);
            map.entry(k).or_insert((None, None)).1 = Some(e);
        }
        map.into_values()
            .filter(|(l, r)| {
                // the filter applies to files and links; folders are always walked
                l.as_ref().is_none_or(|e| self.passes_filter(e))
                    && r.as_ref().is_none_or(|e| self.passes_filter(e))
            })
            .collect()
    }

    /// Walks both trees and hands every row to `sink`. Stops at `cancel` and at the row limit.
    pub fn walk(&self, cancel: &AtomicBool, sink: &mut Sink<'_>) -> CompareStats {
        let mut stats = CompareStats::default();
        let l = self.read(&self.left, &mut stats);
        let r = self.read(&self.right, &mut stats);
        stats.dirs += 1;
        let mut stack = vec![Frame {
            pairs: self.pair(l, r).into_iter(),
            ldir: self.left.clone(),
            rdir: self.right.clone(),
            rel: String::new(),
            depth: 0,
        }];
        sink(None, &stats);
        while let Some(frame) = stack.last_mut() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let Some((le, re)) = frame.pairs.next() else {
                stack.pop();
                continue;
            };
            let depth = frame.depth;
            let other = |e: &Option<Entry>, o: &Option<Entry>, dir: &Path| -> PathBuf {
                match (e, o) {
                    (Some(e), _) => e.path.clone(),
                    (None, Some(o)) => dir.join(&o.name),
                    (None, None) => dir.to_path_buf(),
                }
            };
            let lpath = other(&le, &re, &frame.ldir);
            let rpath = other(&re, &le, &frame.rdir);
            let name = le
                .as_ref()
                .or(re.as_ref())
                .map(|e| e.name.clone())
                .unwrap_or_default();
            let rel = if frame.rel.is_empty() {
                name
            } else {
                format!("{}/{}", frame.rel, name)
            };
            let (status, content_checked) = match (&le, &re) {
                (Some(_), None) => (CompareStatus::OnlyLeft, false),
                (None, Some(_)) => (CompareStatus::OnlyRight, false),
                (Some(a), Some(b)) => {
                    let (fa, fb) = (a.facts(), b.facts());
                    let mut same = None;
                    if self.opts.content
                        && fa.kind == EntryKind::File
                        && fb.kind == EntryKind::File
                        && fa.size == fb.size
                    {
                        match same_bytes(&a.path, &b.path, cancel, &mut stats.bytes_compared) {
                            Ok(Some(s)) => same = Some(s),
                            Ok(None) => break, // cancelled
                            Err(e) => error(&mut stats, &a.path, FsError::from_io(&e, &a.path)),
                        }
                    }
                    (status_of(&fa, &fb, &self.opts, same), same.is_some())
                }
                (None, None) => continue,
            };
            let is_dir = |e: &Option<Entry>| e.as_ref().is_some_and(|e| e.meta.is_dir());
            if !is_dir(&le) && !is_dir(&re) {
                stats.files += 1;
            }
            stats.rows += 1;
            if status != CompareStatus::Equal {
                stats.differences += 1;
            }
            let row = CompareRow {
                rel: rel.clone(),
                depth,
                left: le.as_ref().map(Entry::side),
                right: re.as_ref().map(Entry::side),
                left_path: lpath.to_string_lossy().into_owned(),
                right_path: rpath.to_string_lossy().into_owned(),
                status,
                content_checked,
            };
            sink(Some(row), &stats);
            if stats.rows >= self.max_rows {
                stats.truncated = true;
                break;
            }
            // folders on both sides or on one side are walked; a folder against a file is not
            let walk = self.opts.recursive
                && status != CompareStatus::KindMismatch
                && (is_dir(&le) || is_dir(&re))
                && (depth as usize) + 1 < MAX_DEPTH;
            if walk {
                let l = le
                    .as_ref()
                    .map(|e| self.read(&e.path, &mut stats))
                    .unwrap_or_default();
                let r = re
                    .as_ref()
                    .map(|e| self.read(&e.path, &mut stats))
                    .unwrap_or_default();
                stats.dirs += 1;
                let pairs = self.pair(l, r);
                sink(None, &stats);
                stack.push(Frame {
                    pairs: pairs.into_iter(),
                    ldir: lpath,
                    rdir: rpath,
                    rel,
                    depth: depth + 1,
                });
            }
        }
        stats
    }
}

fn error(stats: &mut CompareStats, path: &Path, error: FsError) {
    stats.unreadable += 1;
    if stats.errors.len() < MAX_ERRORS {
        stats.errors.push(ItemError {
            path: path.to_string_lossy().into_owned(),
            error,
        });
    }
}

#[cfg(test)]
mod tests;
