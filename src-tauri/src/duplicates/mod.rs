//! Duplicate files (design 016 E6, extended by 042).
//!
//! **Exact** (default): walk the roots with `search::walk` (files only, links never
//! followed, cycle-safe, excludes/hidden/name glob as in the search), group by size (and
//! name if asked), then by a partial SHA-256 of the first and last 64 KiB and, for larger
//! files, the full SHA-256; "paranoid" compares the bytes within each group as well.
//!
//! **Units** (042 E4): names of the same file (hard links, nested roots) form one unit –
//! hashed once, shown with `same_as`, never a copy of each other. A group needs ≥ 2 units.
//!
//! **Similar images / comics** (042 E6/E7): a perceptual hash per unit (decoded in a small
//! worker pool), grouped by distance to a group centre ([`phash::cluster`]).
//!
//! Hashes and fingerprints go into the in-memory [`cache`] (042 E3).
//! Keep in sync with `src/app/core/search/search.models.ts`.

pub mod cache;
pub mod comic;
pub mod images;
pub mod phash;
pub mod thumbs;

use crate::error::{FsError, FsErrorCode};
use crate::jobs::Control;
use crate::listing::stat_entry;
use crate::paths::parent_names;
use crate::platform::{file_identity, file_stamp, open_regular_file};
use crate::search::{self, Kinds, NameMode, SearchCriteria, SearchHit, SearchStats};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Files compared at most by default and at most at all.
pub const DEFAULT_MAX_FILES: u32 = 500_000;
pub const MAX_FILES: u32 = 2_000_000;
/// Head and tail of the partial hash.
pub const PART: u64 = 64 * 1024;
const BLOCK: usize = 64 * 1024;
/// Similarity threshold (differing bits of 64): default and largest allowed.
pub const DEFAULT_THRESHOLD: u8 = 8;
pub const MAX_THRESHOLD: u8 = 16;
/// Worker threads for decoding images (the app must stay responsive).
const MAX_WORKERS: usize = 4;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Compare {
    /// Same size is enough (fast, a hint only).
    Size,
    /// Same size and the same content (SHA-256).
    #[default]
    Content,
}

/// What counts as a duplicate (design 042).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DupMode {
    /// The same bytes.
    #[default]
    Exact,
    /// Images that look alike (perceptual hash).
    SimilarImages,
    /// Comic book archives with the same pages.
    Comics,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCriteria {
    pub roots: Vec<String>,
    #[serde(default)]
    pub compare: Compare,
    /// Also the same name (without case).
    #[serde(default)]
    pub same_name: bool,
    /// Smaller files are ignored (default 1: empty files are all "equal").
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub excludes: Vec<String>,
    #[serde(default)]
    pub max_files: Option<u32>,
    #[serde(default = "yes")]
    pub skip_virtual_fs: bool,
    #[serde(default)]
    pub mode: DupMode,
    /// Name globs (`*.jpg;*.png`), empty = every file.
    #[serde(default)]
    pub name: String,
    /// Exact mode: compare the bytes within each hash group as well.
    #[serde(default)]
    pub paranoid: bool,
    /// Similar images/comics: differing bits allowed (0–[`MAX_THRESHOLD`]).
    #[serde(default)]
    pub threshold: Option<u8>,
}

impl Default for DuplicateCriteria {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            compare: Compare::Content,
            same_name: false,
            min_size: None,
            include_hidden: false,
            excludes: Vec::new(),
            max_files: None,
            skip_virtual_fs: true,
            mode: DupMode::Exact,
            name: String::new(),
            paranoid: false,
            threshold: None,
        }
    }
}

impl DuplicateCriteria {
    fn search(&self) -> SearchCriteria {
        SearchCriteria {
            roots: self.roots.clone(),
            name: self.name.clone(),
            name_mode: NameMode::Glob,
            case_sensitive: false,
            whole_name: true,
            kinds: Kinds {
                files: true,
                dirs: false,
                links: false,
            },
            // a size filter also drops everything that is not a regular file
            min_size: Some(self.min_size.unwrap_or(1)),
            max_size: None,
            modified_from_ms: None,
            modified_to_ms: None,
            include_hidden: self.include_hidden,
            follow_links: false,
            max_depth: None,
            excludes: self.excludes.clone(),
            content: None,
            max_hits: None,
            skip_virtual_fs: self.skip_virtual_fs,
        }
    }

    pub fn max_files(&self) -> u64 {
        u64::from(
            self.max_files
                .unwrap_or(DEFAULT_MAX_FILES)
                .clamp(1, MAX_FILES),
        )
    }

    pub fn threshold(&self) -> u32 {
        u32::from(
            self.threshold
                .unwrap_or(DEFAULT_THRESHOLD)
                .min(MAX_THRESHOLD),
        )
    }
}

/// Checks the criteria without touching the file system.
pub fn compile(c: &DuplicateCriteria) -> Result<search::Compiled, FsError> {
    if c.max_files.is_some_and(|m| m > MAX_FILES) {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            format!("Too many files (max. {MAX_FILES})"),
            None,
        ));
    }
    if c.threshold.is_some_and(|t| t > MAX_THRESHOLD) {
        return Err(FsError::new(
            FsErrorCode::InvalidPattern,
            format!("The similarity threshold is at most {MAX_THRESHOLD}"),
            None,
        ));
    }
    Ok(search::compile(&c.search())?.with_max_hits(c.max_files()))
}

/// What the walk and the comparison report while they run.
pub enum Report<'a> {
    Stats(&'a SearchStats),
}

pub struct DupResult {
    /// Groups (each ≥ 2 files), most wasted bytes first (exact) or largest group first
    /// (similar); `group` is set.
    pub groups: Vec<Vec<SearchHit>>,
    pub stats: SearchStats,
    pub unreadable: Vec<FsError>,
    pub cancelled: bool,
}

struct Candidate {
    path: PathBuf,
    size: u64,
    /// Position in the walk (rule "first found").
    order: u32,
    name_key: String,
}

/// One physical file: its first name and further names (hard links).
struct Unit {
    primary: usize,
    aliases: Vec<usize>,
    links: u32,
    key: cache::Key,
}

/// A group member: unit index and distance to the group centre (similar modes).
type Member = (usize, Option<u32>);

fn cancelled(control: &Control) -> bool {
    control.is_cancelled()
}

/// Hash of `size`, head and tail (the whole file up to 2 × [`PART`]).
fn partial_hash(path: &Path, size: u64, cancel: &AtomicBool) -> std::io::Result<[u8; 32]> {
    let mut f = open_regular_file(path)?;
    let mut h = Sha256::new();
    h.update(size.to_le_bytes());
    let mut buf = vec![0u8; PART as usize];
    let head = size.min(PART) as usize;
    f.read_exact(&mut buf[..head])?;
    h.update(&buf[..head]);
    if size > 2 * PART {
        f.seek(SeekFrom::Start(size - PART))?;
        f.read_exact(&mut buf)?;
        h.update(&buf);
    } else if size > PART {
        let rest = (size - PART) as usize;
        f.read_exact(&mut buf[..rest])?;
        h.update(&buf[..rest]);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(std::io::Error::other("cancelled"));
    }
    Ok(h.finalize().into())
}

/// Full SHA-256 in blocks (cancel between blocks); `done` counts the bytes.
fn full_hash(
    path: &Path,
    cancel: &AtomicBool,
    done: &mut dyn FnMut(u64),
) -> std::io::Result<[u8; 32]> {
    let mut f = open_regular_file(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; BLOCK];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(std::io::Error::other("cancelled"));
        }
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        done(n as u64);
    }
    Ok(h.finalize().into())
}

/// Fills `buf` as far as the file goes (short reads are normal).
fn read_full(f: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match f.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

/// Byte-by-byte comparison of two files (regular files only), in blocks; `done` counts
/// the bytes read from **both** files. Cancel between blocks is an error.
/// Also used by the job that deletes copies right before each delete (042 E5).
pub fn same_content(
    a: &Path,
    b: &Path,
    cancel: &AtomicBool,
    done: &mut dyn FnMut(u64),
) -> std::io::Result<bool> {
    let mut fa = open_regular_file(a)?;
    let mut fb = open_regular_file(b)?;
    let (ma, mb) = (fa.metadata()?, fb.metadata()?);
    // the opened files themselves (no race with the path checks): one file is no copy
    if crate::platform::file_id(&ma).is_some_and(|id| Some(id) == crate::platform::file_id(&mb)) {
        return Err(std::io::Error::other("both names open the same file"));
    }
    if ma.len() != mb.len() {
        return Ok(false);
    }
    let mut ba = vec![0u8; BLOCK];
    let mut bb = vec![0u8; BLOCK];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(std::io::Error::other("cancelled"));
        }
        let na = read_full(&mut fa, &mut ba)?;
        let nb = read_full(&mut fb, &mut bb)?;
        done((na + nb) as u64);
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}

/// Splits every group by `key`; groups with one member are dropped.
fn regroup<K: std::hash::Hash + Eq>(
    groups: Vec<Vec<usize>>,
    mut key: impl FnMut(usize) -> Option<K>,
) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    for g in groups {
        let mut by: HashMap<K, Vec<usize>> = HashMap::new();
        for i in g {
            if let Some(k) = key(i) {
                by.entry(k).or_default().push(i);
            }
        }
        out.extend(by.into_values().filter(|v| v.len() > 1));
    }
    out
}

/// Error of a file that went away or could not be read (gone = no error).
fn note(lost: &mut Vec<FsError>, e: &std::io::Error, path: &Path, cancel: &AtomicBool) {
    if !cancel.load(Ordering::Relaxed) && e.kind() != std::io::ErrorKind::NotFound {
        lost.push(FsError::from_io(e, path));
    }
}

/// Makes units of the candidates `idx` (names of one file together), in walk order.
/// Files that vanished are dropped; unreadable ones are reported.
fn make_units(
    candidates: &[Candidate],
    idx: &[usize],
    units: &mut Vec<Unit>,
    lost: &mut Vec<FsError>,
    cancel: &AtomicBool,
) -> Vec<usize> {
    let mut by_id: HashMap<(u64, u64), usize> = HashMap::new();
    // the same share mounted twice: other device, same file number, size and time (review 042 #1)
    let mut by_mount: HashMap<(u64, u64, i128), usize> = HashMap::new();
    let mut out = Vec::new();
    let mut sorted = idx.to_vec();
    sorted.sort_by_key(|&i| candidates[i].order);
    for i in sorted {
        let c = &candidates[i];
        let meta = match std::fs::symlink_metadata(&c.path) {
            Ok(m) => m,
            Err(e) => {
                note(lost, &e, &c.path, cancel);
                continue;
            }
        };
        // without an identity (odd file systems) the file is its own unit
        let identity = file_identity(&c.path);
        let stamp = file_stamp(&c.path);
        let id = identity.map_or((u64::MAX, i as u64), |x| x.id);
        let mount_key = stamp
            .filter(|s| s.id.1 != 0)
            .and_then(|s| s.modified_ns.map(|m| (s.id.1, s.size, m)));
        let same = by_id
            .get(&id)
            .or_else(|| mount_key.and_then(|k| by_mount.get(&k)))
            .copied();
        if let Some(u) = same {
            units[u].aliases.push(i);
            continue;
        }
        let u = units.len();
        units.push(Unit {
            primary: i,
            aliases: Vec::new(),
            links: identity.map_or(1, |x| x.links),
            key: cache::Key {
                id,
                size: meta.len(),
                modified_ns: stamp.and_then(|s| s.modified_ns),
                changed_ns: stamp.and_then(|s| s.changed_ns),
                path: c.path.clone(),
            },
        });
        by_id.insert(id, u);
        if let Some(k) = mount_key {
            by_mount.insert(k, u);
        }
        out.push(u);
    }
    out
}

/// Runs `f` for every item in a few worker threads; `progress(done)` is called on this
/// thread about every 250 ms. Items not started before a cancel give `None`.
fn parallel_map<T: Sync, R: Send>(
    items: &[T],
    cancel: &AtomicBool,
    f: impl Fn(&T) -> R + Sync,
    progress: &mut dyn FnMut(usize),
) -> Vec<Option<R>> {
    let workers = std::thread::available_parallelism()
        .map_or(1, |n| (n.get() / 2).max(1))
        .min(MAX_WORKERS)
        .min(items.len().max(1));
    let next = AtomicUsize::new(0);
    let mut out: Vec<Option<R>> = (0..items.len()).map(|_| None).collect();
    std::thread::scope(|s| {
        let (tx, rx) = mpsc::channel::<(usize, R)>();
        for _ in 0..workers {
            let tx = tx.clone();
            let (next, f) = (&next, &f);
            s.spawn(move || {
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= items.len() {
                        break;
                    }
                    if tx.send((i, f(&items[i]))).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);
        let mut done = 0;
        let mut last = Instant::now();
        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok((i, r)) => {
                    out[i] = Some(r);
                    done += 1;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            if last.elapsed() >= Duration::from_millis(250) {
                progress(done);
                last = Instant::now();
            }
        }
        progress(done);
    });
    out
}

/// Finds the duplicates. `report` gets the statistics now and then (walk, hashing).
pub fn find(
    criteria: &DuplicateCriteria,
    control: &Control,
    report: &mut dyn FnMut(Report<'_>),
) -> Result<DupResult, FsError> {
    let cancel = control.cancel_flag();
    let compiled = compile(criteria)?;
    let bad = compiled.check_roots();
    if bad.len() == compiled.roots().len() {
        return Err(bad.into_iter().next().unwrap_or_else(|| {
            FsError::new(FsErrorCode::InvalidPath, "No folder to search in", None)
        }));
    }
    let start = Instant::now();
    let mut stats = SearchStats::default();
    let mut unreadable: Vec<FsError> = bad;
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();
    let mut unsupported = 0u64;
    let mut last = Instant::now();
    let walked = search::walk(&compiled, cancel, &mut |hit, s| {
        if let Some(h) = hit
            && !h.entry.lossy_name
        {
            let keep = match criteria.mode {
                DupMode::Exact => true,
                DupMode::SimilarImages => {
                    if images::is_unsupported_image_name(&h.entry.name) {
                        unsupported += 1;
                    }
                    images::is_image_name(&h.entry.name)
                }
                DupMode::Comics => comic::is_comic_name(&h.entry.name),
            };
            let path = PathBuf::from(&h.entry.path);
            if keep && seen_paths.insert(path.clone()) {
                candidates.push(Candidate {
                    size: h.entry.size.unwrap_or(0),
                    order: u32::try_from(candidates.len()).unwrap_or(u32::MAX),
                    name_key: if criteria.same_name && criteria.mode == DupMode::Exact {
                        h.entry.name.to_lowercase()
                    } else {
                        String::new()
                    },
                    path,
                });
            }
        }
        if last.elapsed().as_millis() >= 250 {
            report(Report::Stats(s));
            last = Instant::now();
        }
    });
    drop(seen_paths);
    stats.dirs_scanned = walked.stats.dirs_scanned;
    stats.files_scanned = walked.stats.files_scanned;
    stats.truncated = walked.stats.truncated;
    stats.skipped_unsupported = unsupported;
    stats.unreadable = walked.stats.unreadable + unreadable.len() as u64;
    unreadable.extend(walked.unreadable);
    let finish = |mut stats: SearchStats, unreadable: Vec<FsError>| {
        stats.elapsed_ms = start.elapsed().as_millis() as u64;
        Ok(DupResult {
            groups: Vec::new(),
            stats,
            unreadable,
            cancelled: true,
        })
    };
    if cancelled(control) {
        return finish(stats, unreadable);
    }

    let mut units: Vec<Unit> = Vec::new();
    let mut lost: Vec<FsError> = Vec::new();
    let mut fingerprints: HashMap<usize, Fingerprint> = HashMap::new();
    let groups: Vec<Vec<Member>> = match criteria.mode {
        DupMode::Exact => exact(
            criteria,
            &candidates,
            &mut units,
            &mut lost,
            &mut stats,
            control,
            report,
        ),
        DupMode::SimilarImages | DupMode::Comics => similar(
            criteria,
            &candidates,
            &mut units,
            &mut lost,
            &mut stats,
            &mut fingerprints,
            control,
            report,
        ),
    };
    stats.unreadable += lost.len() as u64;
    unreadable.extend(lost);
    if cancelled(control) {
        return finish(stats, unreadable);
    }

    let out = hits(
        groups,
        &candidates,
        &units,
        &fingerprints,
        criteria.mode == DupMode::Exact,
    );
    stats.groups = out.len() as u64;
    stats.hits = out.iter().map(|g| g.len() as u64).sum();
    stats.elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(DupResult {
        groups: out,
        stats,
        unreadable,
        cancelled: false,
    })
}

/// Exact mode: size (+ name) → units → partial hash → full hash → (paranoid) bytes.
fn exact(
    criteria: &DuplicateCriteria,
    candidates: &[Candidate],
    units: &mut Vec<Unit>,
    lost: &mut Vec<FsError>,
    stats: &mut SearchStats,
    control: &Control,
    report: &mut dyn FnMut(Report<'_>),
) -> Vec<Vec<Member>> {
    let cancel = control.cancel_flag();
    // 1. same size (and name)
    let mut by_size: HashMap<(u64, &str), Vec<usize>> = HashMap::new();
    for (i, c) in candidates.iter().enumerate() {
        by_size.entry((c.size, &c.name_key)).or_default().push(i);
    }
    let mut size_groups: Vec<Vec<usize>> = by_size.into_values().filter(|g| g.len() > 1).collect();
    size_groups.sort_by_key(|g| candidates[g[0]].order);

    // 2. names of the same file are one unit (hard links, nested roots)
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for g in size_groups {
        if cancelled(control) {
            return Vec::new();
        }
        let u = make_units(candidates, &g, units, lost, cancel);
        if u.len() > 1 {
            groups.push(u);
        }
    }

    if criteria.compare == Compare::Content {
        let size_of = |u: usize| units[u].key.size;
        // 3. head + tail
        stats.bytes_to_hash = groups
            .iter()
            .flatten()
            .map(|&u| size_of(u).min(2 * PART))
            .sum();
        report(Report::Stats(stats));
        let mut hashed = 0u64;
        let mut last = Instant::now();
        groups = regroup(groups, |u| {
            if cancelled(control) {
                return None;
            }
            let unit = &units[u];
            if let Some(h) = cache::get(&unit.key).and_then(|e| e.partial) {
                hashed += unit.key.size.min(2 * PART); // known: counts as done (review 042 #11)
                return Some(h);
            }
            let r = partial_hash(&unit.key.path, unit.key.size, cancel);
            hashed += unit.key.size.min(2 * PART);
            if last.elapsed().as_millis() >= 250 {
                stats.bytes_hashed = hashed;
                report(Report::Stats(stats));
                last = Instant::now();
            }
            match r {
                Ok(h) => {
                    cache::update(&unit.key, |e| e.partial = Some(h));
                    Some(h)
                }
                Err(e) => {
                    note(lost, &e, &unit.key.path, cancel);
                    None
                }
            }
        });
        // 4. the whole file where head + tail did not cover it
        let full: u64 = groups
            .iter()
            .flatten()
            .map(|&u| size_of(u))
            .filter(|&s| s > 2 * PART)
            .sum();
        stats.bytes_to_hash = hashed + full;
        stats.bytes_hashed = hashed;
        report(Report::Stats(stats));
        groups = regroup(groups, |u| {
            let unit = &units[u];
            if unit.key.size <= 2 * PART {
                return Some([0u8; 32]); // the partial hash was the whole file
            }
            if cancelled(control) {
                return None;
            }
            if let Some(h) = cache::get(&unit.key).and_then(|e| e.full) {
                hashed += unit.key.size;
                return Some(h);
            }
            let r = full_hash(&unit.key.path, cancel, &mut |n| {
                hashed += n;
                if last.elapsed().as_millis() >= 250 {
                    stats.bytes_hashed = hashed;
                    report(Report::Stats(stats));
                    last = Instant::now();
                }
            });
            match r {
                Ok(h) => {
                    cache::update(&unit.key, |e| e.full = Some(h));
                    Some(h)
                }
                Err(e) => {
                    note(lost, &e, &unit.key.path, cancel);
                    None
                }
            }
        });
        // 5. paranoid: the bytes, against the first unit of each class
        if criteria.paranoid {
            stats.bytes_to_hash = hashed
                + groups
                    .iter()
                    .map(|g| size_of(g[0]) * 2 * (g.len() as u64 - 1))
                    .sum::<u64>();
            let mut split = Vec::new();
            for g in groups {
                let mut classes: Vec<Vec<usize>> = Vec::new();
                'unit: for u in g {
                    if cancelled(control) {
                        return Vec::new();
                    }
                    for class in &mut classes {
                        let r = same_content(
                            &units[class[0]].key.path,
                            &units[u].key.path,
                            cancel,
                            &mut |n| {
                                hashed += n;
                                if last.elapsed().as_millis() >= 250 {
                                    stats.bytes_hashed = hashed;
                                    report(Report::Stats(stats));
                                    last = Instant::now();
                                }
                            },
                        );
                        match r {
                            Ok(true) => {
                                class.push(u);
                                continue 'unit;
                            }
                            Ok(false) => {}
                            Err(e) => {
                                note(lost, &e, &units[u].key.path, cancel);
                                continue 'unit;
                            }
                        }
                    }
                    classes.push(vec![u]);
                }
                split.extend(classes.into_iter().filter(|c| c.len() > 1));
            }
            groups = split;
        }
        stats.bytes_hashed = hashed;
    }
    groups
        .into_iter()
        .map(|g| g.into_iter().map(|u| (u, None)).collect())
        .collect()
}

/// Fingerprint of `key`'s file (from the cache or read now). A panic in a decoder or the
/// archive code of a hostile file is an error for that file only (review 042 #5).
fn fingerprint_cached(
    key: &cache::Key,
    comics: bool,
    control: &Control,
) -> Result<Fingerprint, FsError> {
    let read = || -> Result<Fingerprint, FsError> {
        let hit = cache::get(key);
        if comics {
            if let Some(fp) = hit.and_then(|e| e.comic) {
                return Ok(Fingerprint::Comic(fp));
            }
            let fp = comic::fingerprint(&key.path, control)?;
            cache::update(key, |e| e.comic = Some(fp.clone()));
            Ok(Fingerprint::Comic(fp))
        } else {
            if let Some(fp) = hit.and_then(|e| e.image) {
                return Ok(Fingerprint::Image(fp));
            }
            let fp = images::photo_fingerprint(&key.path)?;
            cache::update(key, |e| e.image = Some(fp));
            Ok(Fingerprint::Image(fp))
        }
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(read)).unwrap_or_else(|_| {
        Err(FsError::new(
            FsErrorCode::UnsupportedImage,
            "The file cannot be read (internal error while reading it)",
            Some(&key.path),
        ))
    })
}

/// Distance between the looks of two files (`None`: never similar) – for the job that
/// removes similar copies (review 042 #2: the copy must look like the file that stays,
/// not only like the group's centre).
pub fn similar_distance(
    keep: &Path,
    copy: &Path,
    comics: bool,
    control: &Control,
) -> Result<Option<u32>, FsError> {
    let key = |p: &Path| -> Result<cache::Key, FsError> {
        let meta = std::fs::symlink_metadata(p).map_err(|e| FsError::from_io(&e, p))?;
        let stamp = file_stamp(p);
        Ok(cache::Key {
            id: stamp.map_or((u64::MAX, 0), |s| s.id),
            size: meta.len(),
            modified_ns: stamp.and_then(|s| s.modified_ns),
            changed_ns: stamp.and_then(|s| s.changed_ns),
            path: p.to_path_buf(),
        })
    };
    let a = fingerprint_cached(&key(keep)?, comics, control)?;
    let b = fingerprint_cached(&key(copy)?, comics, control)?;
    Ok(match (&a, &b) {
        (Fingerprint::Image(x), Fingerprint::Image(y)) => images::distance(x, y),
        (Fingerprint::Comic(x), Fingerprint::Comic(y)) => comic::distance(x, y),
        _ => None,
    })
}

/// Fingerprint of a unit in the similar modes.
enum Fingerprint {
    Image(images::ImageFp),
    Comic(comic::ComicFp),
}

impl Fingerprint {
    fn dims(&self) -> (u32, u32) {
        match self {
            Fingerprint::Image(f) => (f.width, f.height),
            Fingerprint::Comic(f) => (f.width, f.height),
        }
    }
}

/// Similar images / comics: units → fingerprints (cache, worker pool) → [`phash::cluster`].
#[allow(clippy::too_many_arguments)]
fn similar(
    criteria: &DuplicateCriteria,
    candidates: &[Candidate],
    units: &mut Vec<Unit>,
    lost: &mut Vec<FsError>,
    stats: &mut SearchStats,
    fingerprints: &mut HashMap<usize, Fingerprint>,
    control: &Control,
    report: &mut dyn FnMut(Report<'_>),
) -> Vec<Vec<Member>> {
    let cancel = control.cancel_flag();
    let all: Vec<usize> = (0..candidates.len()).collect();
    let list = make_units(candidates, &all, units, lost, cancel);
    stats.images_total = list.len() as u64;
    report(Report::Stats(stats));
    let comics = criteria.mode == DupMode::Comics;
    let keys: Vec<&cache::Key> = list.iter().map(|&u| &units[u].key).collect();
    let results = parallel_map(
        &keys,
        cancel,
        |key| fingerprint_cached(key, comics, control),
        &mut |done| {
            stats.images_done = done as u64;
            report(Report::Stats(stats));
        },
    );
    if cancelled(control) {
        return Vec::new();
    }
    let mut items: Vec<(usize, Fingerprint)> = Vec::new();
    for (u, r) in list.into_iter().zip(results) {
        match r {
            Some(Ok(fp)) => items.push((u, fp)),
            Some(Err(e)) if e.code == FsErrorCode::NotFound => {}
            Some(Err(e)) => lost.push(e),
            None => {}
        }
    }
    let size_of = |u: usize| units[u].key.size;
    let path_of = |u: usize| &units[u].key.path;
    let groups = phash::cluster(
        &items,
        |a, b| {
            let pixels = |(w, h): (u32, u32)| u64::from(w) * u64::from(h);
            pixels(b.1.dims())
                .cmp(&pixels(a.1.dims()))
                .then(size_of(b.0).cmp(&size_of(a.0)))
                .then(path_of(a.0).cmp(path_of(b.0)))
        },
        |a, b| match (&a.1, &b.1) {
            (Fingerprint::Image(x), Fingerprint::Image(y)) => images::distance(x, y),
            (Fingerprint::Comic(x), Fingerprint::Comic(y)) => comic::distance(x, y),
            _ => None,
        },
        criteria.threshold(),
        Some(&|it: &(usize, Fingerprint)| match &it.1 {
            Fingerprint::Image(f) => f.hash,
            // the comic distance is the largest page distance: ≥ the title page's
            Fingerprint::Comic(c) => c.hashes.first().copied().unwrap_or(0),
        }),
        &|| cancelled(control),
    );
    let out = groups
        .into_iter()
        .map(|g| g.into_iter().map(|(i, d)| (items[i].0, Some(d))).collect())
        .collect();
    for (u, fp) in items {
        fingerprints.insert(u, fp);
    }
    out
}

/// The hits of the groups: units in member order (exact: by path), each primary name
/// followed by its aliases (`same_as`). Exact groups: most wasted bytes first.
fn hits(
    mut groups: Vec<Vec<Member>>,
    candidates: &[Candidate],
    units: &[Unit],
    fingerprints: &HashMap<usize, Fingerprint>,
    exact: bool,
) -> Vec<Vec<SearchHit>> {
    let primary_path = |u: usize| &candidates[units[u].primary].path;
    if exact {
        for g in &mut groups {
            g.sort_by(|a, b| primary_path(a.0).cmp(primary_path(b.0)));
        }
        let size = |g: &Vec<Member>| units[g[0].0].key.size;
        groups.sort_by(|a, b| {
            let wasted = |g: &Vec<Member>| size(g) * (g.len() as u64 - 1);
            wasted(b)
                .cmp(&wasted(a))
                .then(size(b).cmp(&size(a)))
                .then(primary_path(a[0].0).cmp(primary_path(b[0].0)))
        });
    }
    let mut out: Vec<Vec<SearchHit>> = Vec::new();
    for g in groups {
        let n = out.len() as u32 + 1;
        let mut list: Vec<SearchHit> = Vec::new();
        let mut real_units = 0;
        for (u, distance) in g {
            let unit = &units[u];
            // the first name that still exists leads (review 042 #13)
            let mut primary = String::new();
            let mut first = true;
            for i in std::iter::once(unit.primary).chain(unit.aliases.iter().copied()) {
                let c = &candidates[i];
                let Some(entry) = stat_entry(&c.path) else {
                    continue;
                };
                let dir = c.path.parent();
                let (width, height, pages) = match fingerprints.get(&u) {
                    Some(Fingerprint::Image(f)) => (Some(f.width), Some(f.height), None),
                    Some(Fingerprint::Comic(f)) => (Some(f.width), Some(f.height), Some(f.pages)),
                    None => (None, None, None),
                };
                list.push(SearchHit {
                    entry,
                    dir: dir
                        .map(|d| d.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    rel_dir: String::new(),
                    parent_names: dir.map(parent_names).unwrap_or_default(),
                    group: Some(n),
                    order: Some(c.order),
                    same_as: (!first).then(|| primary.clone()),
                    links: (unit.links > 1).then_some(unit.links),
                    width,
                    height,
                    pages,
                    distance: distance.map(|d| d as u8),
                });
                if first {
                    real_units += 1;
                    primary = c.path.to_string_lossy().into_owned();
                }
                first = false;
            }
        }
        if real_units > 1 {
            out.push(list);
        }
    }
    out
}

#[cfg(test)]
mod tests;
