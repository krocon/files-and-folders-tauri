//! The live source of the palette (design 043 E2a): a breadth-first walk over the
//! known places (tabs, favourites, recent folders) – and the index roots while the
//! index is not ready. Bounded by depth, folders and time; links are never followed,
//! so there are no cycles. Server and archive folders are only walked when they are
//! roots chosen in the settings ([`Place::explicit`]).

use super::index::{IndexConfig, device, root_bits, same_device};
use super::query::{Matcher, Query, score};
use super::{PaletteHit, Source};
use crate::listing::entry_from_metadata;
use crate::model::DirEntryDto;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use std::time::Instant;

/// A folder to walk.
#[derive(Debug, Clone)]
pub struct Place {
    pub path: String,
    /// Levels below the place that are walked (1 = only its entries).
    pub depth: u32,
    pub boost: i16,
    /// A server or archive folder chosen as a root in the settings.
    pub explicit: bool,
}

#[derive(Debug, Default)]
pub struct LiveStats {
    pub dirs: u64,
    pub entries: u64,
    pub matched: u64,
    /// Stopped by the time or folder limit (not by the hit limit).
    pub exhausted: bool,
}

pub struct Budget<'a> {
    pub deadline: Instant,
    pub max_dirs: u64,
    pub remote_cache: &'a RemoteCache,
}

/// Listings of explicitly chosen server folders, kept for [`REMOTE_TTL`]: typing does not
/// list the server again on every key (review 043 #8).
#[derive(Default)]
pub struct RemoteCache(Mutex<HashMap<String, (Instant, Vec<DirEntryDto>)>>);

pub const REMOTE_TTL: Duration = Duration::from_secs(60);
pub const REMOTE_CACHE_DIRS: usize = 2000;

impl RemoteCache {
    fn list(&self, dir: &str) -> Vec<DirEntryDto> {
        if let Some((at, entries)) = self.0.lock().unwrap_or_else(|e| e.into_inner()).get(dir)
            && at.elapsed() < REMOTE_TTL
        {
            return entries.clone();
        }
        let entries = crate::remote::hub()
            .and_then(|h| h.list_directory(dir))
            .map(|l| l.entries)
            .unwrap_or_default();
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, (at, _)| at.elapsed() < REMOTE_TTL);
        if map.len() < REMOTE_CACHE_DIRS {
            map.insert(dir.to_string(), (Instant::now(), entries.clone()));
        }
        entries
    }
}

/// Whether `raw` names a server or archive folder (never walked unless explicit).
pub fn is_virtual(raw: &str) -> bool {
    crate::remote::is_remote(raw) || crate::archive::resolve(Path::new(raw)).is_some()
}

/// Lists one folder – entries and whether a folder may be entered: local with `lstat`
/// (links not followed, no other file system), archives and servers through their own
/// listings.
/// Tests: listings below this prefix take this long (a hanging folder).
#[cfg(test)]
pub static SLOW: Mutex<Option<(std::path::PathBuf, Duration)>> = Mutex::new(None);

fn list(
    dir: &str,
    explicit: bool,
    config: &IndexConfig,
    remote: &RemoteCache,
) -> Vec<(DirEntryDto, bool)> {
    #[cfg(test)]
    {
        let slow = SLOW.lock().unwrap().clone();
        if let Some((_, d)) = slow.filter(|(p, _)| Path::new(dir).starts_with(p)) {
            std::thread::sleep(d);
        }
    }
    let virtual_listing = |entries: Vec<DirEntryDto>| {
        entries
            .into_iter()
            .map(|e| {
                let enter = e.kind == crate::model::EntryKind::Directory;
                (e, enter)
            })
            .collect()
    };
    if explicit && crate::remote::is_remote(dir) {
        return virtual_listing(remote.list(dir));
    }
    if explicit && crate::archive::resolve(Path::new(dir)).is_some() {
        return crate::archive::list_directory_or_archive(Path::new(dir))
            .map(|l| virtual_listing(l.entries))
            .unwrap_or_default();
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let dev = fs::metadata(dir).ok().as_ref().and_then(device);
    let mut out = Vec::new();
    for e in rd {
        let Ok(e) = e else { break };
        let Ok(name) = e.file_name().into_string() else {
            continue;
        };
        let Ok(meta) = e.metadata() else { continue };
        if config.skips(&name, &meta) {
            continue;
        }
        let path = e.path();
        let enter =
            meta.is_dir() && same_device(dev, &meta) && !crate::search::is_virtual_fs(&path);
        out.push((entry_from_metadata(name, &path, &meta, false), enter));
    }
    out
}

/// Walks `places` and calls `emit` for every hit not in `seen`; `emit` returns false to
/// stop. Folders below `covered` (the ready index) are not walked again.
#[allow(clippy::too_many_arguments)]
pub fn walk(
    q: &Query,
    places: &[Place],
    covered: &[PathBuf],
    config: &IndexConfig,
    budget: &Budget<'_>,
    cancel: &AtomicBool,
    seen: &mut HashSet<String>,
    emit: &mut dyn FnMut(PaletteHit) -> bool,
) -> LiveStats {
    let mut stats = LiveStats::default();
    let mut m = Matcher::new(q);
    let home = config.home.as_deref();
    let mut walked: HashSet<String> = HashSet::new();
    // (folder, bits of the names above, depth below the place, levels left, bonus, explicit)
    let mut queue: VecDeque<(String, u32, u32, u32, i16, bool)> = VecDeque::new();
    for p in places {
        // a place on a network drive may hang: only the index answers for it (review 043 #2)
        if p.explicit
            || (!is_virtual(&p.path) && !crate::watch::netfs::is_network(Path::new(&p.path)))
        {
            let bits = if p.explicit {
                0
            } else {
                root_bits(&mut m, Path::new(&p.path), home)
            };
            queue.push_back((p.path.clone(), bits, 0, p.depth, p.boost, p.explicit));
        }
    }
    let below_ok = |path: &str| {
        q.in_paths.is_empty() || q.in_paths.iter().any(|b| Path::new(path).starts_with(b))
    };
    while let Some((dir, above, depth, left, boost, explicit)) = queue.pop_front() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if Instant::now() >= budget.deadline || stats.dirs >= budget.max_dirs {
            stats.exhausted = true;
            break;
        }
        if left == 0 || !walked.insert(dir.clone()) {
            continue;
        }
        if !explicit && covered.iter().any(|c| Path::new(&dir).starts_with(c)) {
            continue;
        }
        stats.dirs += 1;
        let entries = list(&dir, explicit, config, budget.remote_cache);
        let parents = crate::paths::parent_names(Path::new(&dir));
        for (e, enter) in entries {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            stats.entries += 1;
            let own = m.bits(&e.name);
            let folded = m.folded().to_string();
            let is_dir = e.is_navigable_dir();
            if enter {
                queue.push_back((
                    e.path.clone(),
                    above | own,
                    depth + 1,
                    left - 1,
                    boost,
                    explicit,
                ));
            }
            if !below_ok(&e.path)
                || !m.is_hit(
                    own,
                    above,
                    &folded,
                    is_dir,
                    e.size.filter(|_| !is_dir),
                    e.modified_ms,
                )
            {
                continue;
            }
            stats.matched += 1;
            if !seen.insert(e.path.clone()) {
                continue;
            }
            let (s, ranges) = score(q, &e.name, depth + 1, i32::from(boost));
            let hit = PaletteHit {
                entry: e,
                dir: dir.clone(),
                rel_dir: String::new(),
                parent_names: parents.clone(),
                score: s,
                source: Source::Live,
                ranges,
            };
            if !emit(hit) {
                return stats;
            }
        }
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::palette::query::parse;
    use std::time::Duration;
    use tempfile::tempdir;

    fn config(home: &Path) -> IndexConfig {
        IndexConfig {
            roots: vec![],
            excludes: None,
            include_hidden: false,
            max_bytes: 1 << 20,
            home: Some(home.to_path_buf()),
        }
    }

    fn run(
        q: &str,
        places: &[Place],
        covered: &[PathBuf],
        home: &Path,
        ms: u64,
    ) -> (Vec<PaletteHit>, LiveStats) {
        let q = parse(q, 0, 0);
        let mut hits = Vec::new();
        let cache = RemoteCache::default();
        let budget = Budget {
            remote_cache: &cache,
            deadline: Instant::now() + Duration::from_millis(ms),
            max_dirs: 10_000,
        };
        let stats = walk(
            &q,
            places,
            covered,
            &config(home),
            &budget,
            &AtomicBool::new(false),
            &mut HashSet::new(),
            &mut |h| {
                hits.push(h);
                true
            },
        );
        (hits, stats)
    }

    fn place(p: &Path, depth: u32) -> Place {
        Place {
            path: p.to_string_lossy().into_owned(),
            depth,
            boost: 0,
            explicit: false,
        }
    }

    #[test]
    fn finds_in_places_with_the_path_below_home() {
        let t = tempdir().unwrap();
        let docs = t.path().join("Docs/2025");
        fs::create_dir_all(&docs).unwrap();
        fs::write(docs.join("Invoice-0815.pdf"), b"x").unwrap();
        fs::write(docs.join("other.txt"), b"x").unwrap();
        // the place itself is "Docs/2025": its folder names count
        let (hits, _) = run("invoice 2025", &[place(&docs, 2)], &[], t.path(), 2000);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entry.name, "Invoice-0815.pdf");
        assert_eq!(hits[0].dir, docs.to_string_lossy());
        assert_eq!(hits[0].source, Source::Live);
    }

    #[test]
    fn depth_covered_and_seen() {
        let t = tempdir().unwrap();
        fs::create_dir_all(t.path().join("a/b/c")).unwrap();
        fs::write(t.path().join("a/b/c/deep hit.txt"), b"x").unwrap();
        fs::write(t.path().join("a/hit.txt"), b"x").unwrap();
        let (hits, _) = run("hit", &[place(&t.path().join("a"), 1)], &[], t.path(), 2000);
        assert_eq!(hits.len(), 1);
        let (hits, _) = run("hit", &[place(&t.path().join("a"), 3)], &[], t.path(), 2000);
        assert_eq!(hits.len(), 2);
        // shallow hits first (breadth-first)
        assert_eq!(hits[0].entry.name, "hit.txt");
        // below a covered folder nothing is walked
        let (hits, _) = run(
            "hit",
            &[place(&t.path().join("a"), 3)],
            &[t.path().join("a/b")],
            t.path(),
            2000,
        );
        assert_eq!(hits.len(), 1);
        // the same place twice: hits once
        let p = place(&t.path().join("a"), 3);
        let (hits, _) = run("hit", &[p.clone(), p], &[], t.path(), 2000);
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn time_limit() {
        let t = tempdir().unwrap();
        fs::write(t.path().join("x"), b"x").unwrap();
        let (_, stats) = run("x", &[place(t.path(), 3)], &[], t.path(), 0);
        assert!(stats.exhausted);
    }

    #[test]
    fn archives_and_servers_only_when_explicit() {
        let t = tempdir().unwrap();
        let zip = t.path().join("a.zip");
        {
            let f = fs::File::create(&zip).unwrap();
            let mut w = zip::ZipWriter::new(f);
            w.start_file("invoice 2025.pdf", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut w, b"x").unwrap();
            w.finish().unwrap();
        }
        // the archive file itself is a file in the folder – never entered
        let (hits, _) = run("invoice", &[place(t.path(), 3)], &[], t.path(), 2000);
        assert!(hits.is_empty());
        // a place inside the archive (an archive tab) is skipped …
        let inner = place(&zip, 2);
        let (hits, _) = run("invoice", std::slice::from_ref(&inner), &[], t.path(), 2000);
        assert!(hits.is_empty());
        // … unless chosen as a root in the settings
        let (hits, _) = run(
            "invoice",
            &[Place {
                explicit: true,
                ..inner
            }],
            &[],
            t.path(),
            2000,
        );
        assert_eq!(hits.len(), 1);
        // a server folder that is not chosen is skipped without connecting
        let remote = Place {
            path: "remote://nobody/x".into(),
            depth: 2,
            boost: 0,
            explicit: false,
        };
        let (hits, stats) = run("x", &[remote], &[], t.path(), 2000);
        assert!(hits.is_empty());
        assert_eq!(stats.dirs, 0);
    }

    #[cfg(unix)]
    #[test]
    fn links_are_not_followed() {
        let t = tempdir().unwrap();
        fs::create_dir_all(t.path().join("a")).unwrap();
        fs::write(t.path().join("a/hit"), b"x").unwrap();
        std::os::unix::fs::symlink(t.path(), t.path().join("a/loop")).unwrap();
        let (hits, stats) = run("hit", &[place(t.path(), 10)], &[], t.path(), 2000);
        assert_eq!(hits.len(), 1);
        assert_eq!(stats.dirs, 2);
    }
}
