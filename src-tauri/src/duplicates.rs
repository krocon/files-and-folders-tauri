//! Duplicate files (design 016 E6): walk the roots with `search::walk` (files
//! only, links never followed, cycle-safe, excludes/hidden as in the search),
//! group by size (and name), drop second names of the same file (hard links,
//! nested roots), then compare a partial SHA-256 of the first and last 64 KiB,
//! and for larger files the full SHA-256. Pure std + `sha2`, without Tauri.
//! Keep in sync with `src/app/core/search/search.models.ts`.

use crate::error::{FsError, FsErrorCode};
use crate::listing::stat_entry;
use crate::platform::{file_id, open_regular_file};
use crate::search::{self, Kinds, NameMode, SearchCriteria, SearchHit, SearchStats};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

/// Files compared at most by default and at most at all.
pub const DEFAULT_MAX_FILES: u32 = 500_000;
pub const MAX_FILES: u32 = 2_000_000;
/// Head and tail of the partial hash.
pub const PART: u64 = 64 * 1024;
const BLOCK: usize = 64 * 1024;

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
}

impl DuplicateCriteria {
    fn search(&self) -> SearchCriteria {
        SearchCriteria {
            roots: self.roots.clone(),
            name: String::new(),
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
    Ok(search::compile(&c.search())?.with_max_hits(c.max_files()))
}

/// What the walk and the comparison report while they run.
pub enum Report<'a> {
    Stats(&'a SearchStats),
}

pub struct DupResult {
    /// Groups (each ≥ 2 files, sorted by path), most wasted bytes first; `group` is set.
    pub groups: Vec<Vec<SearchHit>>,
    pub stats: SearchStats,
    pub unreadable: Vec<FsError>,
    pub cancelled: bool,
}

struct Candidate {
    path: PathBuf,
    size: u64,
    name_key: String,
}

fn cancelled(cancel: &AtomicBool) -> bool {
    cancel.load(Ordering::Relaxed)
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
    if cancelled(cancel) {
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
        if cancelled(cancel) {
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

/// Finds the duplicates. `report` gets the statistics now and then (walk, hashing).
pub fn find(
    criteria: &DuplicateCriteria,
    cancel: &AtomicBool,
    report: &mut dyn FnMut(Report<'_>),
) -> Result<DupResult, FsError> {
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
    let mut last = Instant::now();
    let walked = search::walk(&compiled, cancel, &mut |hit, s| {
        if let Some(h) = hit
            && !h.entry.lossy_name
        {
            let path = PathBuf::from(&h.entry.path);
            if seen_paths.insert(path.clone()) {
                candidates.push(Candidate {
                    size: h.entry.size.unwrap_or(0),
                    name_key: if criteria.same_name {
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
    stats.unreadable = walked.stats.unreadable + unreadable.len() as u64;
    unreadable.extend(walked.unreadable);
    let done = |stats: SearchStats, cancelled: bool, groups| DupResult {
        groups,
        stats,
        unreadable: Vec::new(),
        cancelled,
    };
    if cancelled(cancel) {
        return Ok(DupResult {
            unreadable,
            ..done(stats, true, Vec::new())
        });
    }

    // 1. same size (and name)
    let mut by_size: HashMap<(u64, &str), Vec<usize>> = HashMap::new();
    for (i, c) in candidates.iter().enumerate() {
        by_size.entry((c.size, &c.name_key)).or_default().push(i);
    }
    let mut groups: Vec<Vec<usize>> = by_size.into_values().filter(|g| g.len() > 1).collect();

    // 2. the same file under two names is no copy (hard links, nested roots)
    let mut lost: Vec<FsError> = Vec::new();
    groups = groups
        .into_iter()
        .map(|g| {
            let mut ids = HashSet::new();
            g.into_iter()
                .filter(|&i| match std::fs::symlink_metadata(&candidates[i].path) {
                    Ok(m) => file_id(&m).is_none_or(|id| ids.insert(id)),
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::NotFound {
                            lost.push(FsError::from_io(&e, &candidates[i].path));
                        }
                        false
                    }
                })
                .collect::<Vec<_>>()
        })
        .filter(|g| g.len() > 1)
        .collect();

    if criteria.compare == Compare::Content {
        // 3. head + tail
        stats.bytes_to_hash = groups
            .iter()
            .flatten()
            .map(|&i| candidates[i].size.min(2 * PART))
            .sum();
        report(Report::Stats(&stats));
        let mut hashed = 0u64;
        let mut last = Instant::now();
        groups = regroup(groups, |i| {
            if cancelled(cancel) {
                return None;
            }
            let c = &candidates[i];
            let r = partial_hash(&c.path, c.size, cancel);
            hashed += c.size.min(2 * PART);
            if last.elapsed().as_millis() >= 250 {
                stats.bytes_hashed = hashed;
                report(Report::Stats(&stats));
                last = Instant::now();
            }
            match r {
                Ok(h) => Some(h),
                Err(e) => {
                    if !cancelled(cancel) && e.kind() != std::io::ErrorKind::NotFound {
                        lost.push(FsError::from_io(&e, &c.path));
                    }
                    None
                }
            }
        });
        // 4. the whole file where head + tail did not cover it
        let full: u64 = groups
            .iter()
            .flatten()
            .map(|&i| candidates[i].size)
            .filter(|&s| s > 2 * PART)
            .sum();
        stats.bytes_to_hash = hashed + full;
        stats.bytes_hashed = hashed;
        report(Report::Stats(&stats));
        groups = regroup(groups, |i| {
            let c = &candidates[i];
            if c.size <= 2 * PART {
                return Some([0u8; 32]); // the partial hash was the whole file
            }
            if cancelled(cancel) {
                return None;
            }
            let r = full_hash(&c.path, cancel, &mut |n| {
                hashed += n;
                if last.elapsed().as_millis() >= 250 {
                    stats.bytes_hashed = hashed;
                    report(Report::Stats(&stats));
                    last = Instant::now();
                }
            });
            match r {
                Ok(h) => Some(h),
                Err(e) => {
                    if !cancelled(cancel) && e.kind() != std::io::ErrorKind::NotFound {
                        lost.push(FsError::from_io(&e, &c.path));
                    }
                    None
                }
            }
        });
        stats.bytes_hashed = hashed;
    }
    stats.unreadable += lost.len() as u64;
    unreadable.extend(lost);
    if cancelled(cancel) {
        stats.elapsed_ms = start.elapsed().as_millis() as u64;
        return Ok(DupResult {
            unreadable,
            ..done(stats, true, Vec::new())
        });
    }

    // most wasted bytes first, then the larger files, then by the first path
    for g in &mut groups {
        g.sort_by(|&a, &b| candidates[a].path.cmp(&candidates[b].path));
    }
    groups.sort_by(|a, b| {
        let wasted = |g: &Vec<usize>| candidates[g[0]].size * (g.len() as u64 - 1);
        wasted(b)
            .cmp(&wasted(a))
            .then(candidates[b[0]].size.cmp(&candidates[a[0]].size))
            .then(candidates[a[0]].path.cmp(&candidates[b[0]].path))
    });
    let mut out: Vec<Vec<SearchHit>> = Vec::new();
    for g in groups {
        let n = out.len() as u32 + 1;
        let hits: Vec<SearchHit> = g
            .iter()
            .filter_map(|&i| {
                let p = &candidates[i].path;
                let entry = stat_entry(p)?;
                Some(SearchHit {
                    entry,
                    dir: p
                        .parent()
                        .map(|d| d.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    group: Some(n),
                })
            })
            .collect();
        if hits.len() > 1 {
            out.push(hits);
        }
    }
    stats.groups = out.len() as u64;
    stats.hits = out.iter().map(|g| g.len() as u64).sum();
    stats.elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(DupResult {
        unreadable,
        ..done(stats, false, out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn criteria(root: &Path) -> DuplicateCriteria {
        DuplicateCriteria {
            roots: vec![root.to_string_lossy().into_owned()],
            compare: Compare::Content,
            same_name: false,
            min_size: None,
            include_hidden: false,
            excludes: vec![],
            max_files: None,
            skip_virtual_fs: true,
        }
    }

    fn run(c: &DuplicateCriteria) -> DupResult {
        find(c, &AtomicBool::new(false), &mut |_| {}).unwrap()
    }

    fn names(r: &DupResult) -> Vec<Vec<String>> {
        r.groups
            .iter()
            .map(|g| g.iter().map(|h| h.entry.name.clone()).collect())
            .collect()
    }

    /// Big files that agree in head and tail but differ in the middle.
    fn big(fill: u8, middle: u8) -> Vec<u8> {
        let mut v = vec![fill; 3 * PART as usize];
        v[PART as usize + 100] = middle;
        v
    }

    #[test]
    fn known_duplicates_are_grouped() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("a/ünter ordner")).unwrap();
        fs::create_dir_all(r.join("b")).unwrap();
        fs::write(r.join("a/eins.txt"), "hallo welt").unwrap();
        fs::write(r.join("a/ünter ordner/zwei 🎉.txt"), "hallo welt").unwrap();
        fs::write(r.join("b/drei.txt"), "hallo welt").unwrap();
        fs::write(r.join("b/anders.txt"), "hallo wElt").unwrap(); // same size, other content
        fs::write(r.join("b/leer1"), "").unwrap();
        fs::write(r.join("b/leer2"), "").unwrap(); // empty files are ignored
        fs::write(r.join("a/big1.bin"), big(7, 1)).unwrap();
        fs::write(r.join("b/big2.bin"), big(7, 1)).unwrap();
        fs::write(r.join("b/big3.bin"), big(7, 2)).unwrap(); // same head + tail, other middle
        let res = run(&criteria(r));
        assert!(!res.cancelled);
        assert_eq!(
            names(&res),
            vec![
                vec!["big1.bin".to_string(), "big2.bin".into()],
                vec!["eins.txt".into(), "zwei 🎉.txt".into(), "drei.txt".into()],
            ]
        );
        assert_eq!(res.groups[0][0].group, Some(1));
        assert_eq!(res.groups[1][2].group, Some(2));
        assert_eq!(res.stats.groups, 2);
        assert_eq!(res.stats.hits, 5);
        assert!(
            res.stats.bytes_hashed > 6 * PART,
            "the big files were hashed fully"
        );
    }

    #[test]
    fn size_only_and_same_name() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("x")).unwrap();
        fs::write(r.join("a.txt"), "1234").unwrap();
        fs::write(r.join("x/A.TXT"), "abcd").unwrap();
        fs::write(r.join("x/b.txt"), "wxyz").unwrap();
        let mut c = criteria(r);
        c.compare = Compare::Size;
        assert_eq!(run(&c).stats.hits, 3);
        c.same_name = true;
        assert_eq!(
            names(&run(&c)),
            vec![vec!["a.txt".to_string(), "A.TXT".into()]]
        );
        c.compare = Compare::Content;
        assert!(run(&c).groups.is_empty(), "same name, other content");
    }

    #[cfg(unix)]
    #[test]
    fn hard_links_and_symlinks_are_not_copies() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::write(r.join("orig"), "inhalt").unwrap();
        fs::hard_link(r.join("orig"), r.join("hard")).unwrap();
        std::os::unix::fs::symlink(r.join("orig"), r.join("link")).unwrap();
        assert!(run(&criteria(r)).groups.is_empty());
        fs::write(r.join("kopie"), "inhalt").unwrap();
        let res = run(&criteria(r));
        assert_eq!(res.groups.len(), 1);
        assert_eq!(
            res.groups[0].len(),
            2,
            "one name of the hard-linked file + the copy"
        );
    }

    #[test]
    fn nested_roots_count_each_file_once() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("sub")).unwrap();
        fs::write(r.join("sub/a"), "x").unwrap();
        fs::write(r.join("sub/b"), "y").unwrap();
        let mut c = criteria(r);
        c.roots.push(r.join("sub").to_string_lossy().into_owned());
        assert!(run(&c).groups.is_empty());
    }

    #[test]
    fn many_files_and_cancel() {
        many_files(10);
    }

    /// Acceptance criterion of prompt 016 (100 000 files, ~30 s mostly for creating them):
    /// `cargo test --manifest-path src-tauri/Cargo.toml many_files_100k -- --ignored`.
    #[test]
    #[ignore]
    fn many_files_100k_and_cancel() {
        many_files(100);
    }

    /// `folders` × 1 000 files, every 1 000th file has the same content.
    fn many_files(folders: u32) {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        for f in 0..folders {
            let dir = r.join(format!("d{f:03}"));
            fs::create_dir(&dir).unwrap();
            for i in 0..1000 {
                let n = f * 1000 + i;
                let content = if n % 1000 == 0 {
                    "dup".to_string()
                } else {
                    format!("{n:08}")
                };
                fs::write(dir.join(format!("f{i}")), content).unwrap();
            }
        }
        let res = run(&criteria(r));
        assert_eq!(res.stats.files_scanned, u64::from(folders) * 1000);
        assert_eq!(res.groups.len(), 1);
        assert_eq!(res.groups[0].len(), folders as usize);
        // cancelled while walking: quickly, and no groups
        let cancel = AtomicBool::new(false);
        let mut reports = 0;
        let start = Instant::now();
        let res = find(&criteria(r), &cancel, &mut |_| {
            reports += 1;
            cancel.store(true, Ordering::Relaxed);
        })
        .unwrap();
        // the first report comes after 250 ms at the latest
        assert!(res.cancelled || reports == 0);
        assert!(start.elapsed().as_secs() < 5);
        let cancel = AtomicBool::new(true);
        let res = find(&criteria(r), &cancel, &mut |_| {}).unwrap();
        assert!(res.cancelled);
        assert!(res.groups.is_empty());
    }

    #[test]
    fn max_files_is_checked() {
        let d = tempfile::tempdir().unwrap();
        let mut c = criteria(d.path());
        c.max_files = Some(MAX_FILES + 1);
        assert!(find(&c, &AtomicBool::new(false), &mut |_| {}).is_err());
        c.max_files = None;
        c.roots = vec!["/does/not/exist/fnf".into()];
        assert_eq!(
            find(&c, &AtomicBool::new(false), &mut |_| {})
                .err()
                .unwrap()
                .code,
            FsErrorCode::NotFound
        );
    }
}
