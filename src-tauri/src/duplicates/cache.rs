//! Hash cache of the duplicate search (design 042 E3): in memory only, for this run of
//! the app, at most [`MAX_ENTRIES`]. A second search over the same folders reads only
//! what changed.
//!
//! The key is the file's identity (device + inode / volume + file index), size,
//! modification time and path – any change is a miss. A stale entry cannot lose data:
//! the job that deletes copies compares the bytes again right before (E5).

use super::comic::ComicFp;
use super::images::ImageFp;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

pub const MAX_ENTRIES: usize = 400_000;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Key {
    pub id: (u64, u64),
    pub size: u64,
    pub modified_ns: Option<i128>,
    /// Unix ctime: an in-place edit that keeps size and mtime (`touch -r`, `rsync --inplace -t`)
    /// still changes it (review 042 #9).
    pub changed_ns: Option<i128>,
    pub path: PathBuf,
}

/// What is known about a file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Entry {
    /// SHA-256 of size + head + tail.
    pub partial: Option<[u8; 32]>,
    /// SHA-256 of the whole file.
    pub full: Option<[u8; 32]>,
    pub image: Option<ImageFp>,
    pub comic: Option<ComicFp>,
}

#[derive(Default)]
struct Cache {
    map: HashMap<Key, (Entry, u64)>,
    tick: u64,
}

fn lock() -> MutexGuard<'static, Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE
        .get_or_init(|| Mutex::new(Cache::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// What is known for `key` (and marks it as used).
pub fn get(key: &Key) -> Option<Entry> {
    let mut c = lock();
    c.tick += 1;
    let tick = c.tick;
    c.map.get_mut(key).map(|(e, used)| {
        *used = tick;
        e.clone()
    })
}

/// Changes (or creates) the entry of `key`.
pub fn update(key: &Key, f: impl FnOnce(&mut Entry)) {
    let mut c = lock();
    c.tick += 1;
    let tick = c.tick;
    let slot = c
        .map
        .entry(key.clone())
        .or_insert_with(|| (Entry::default(), tick));
    f(&mut slot.0);
    slot.1 = tick;
    if c.map.len() > MAX_ENTRIES {
        evict(&mut c);
    }
}

/// Drops the least recently used tenth.
fn evict(c: &mut Cache) {
    let mut ticks: Vec<u64> = c.map.values().map(|(_, t)| *t).collect();
    let cut = ticks.len() / 10;
    let (_, &mut limit, _) = ticks.select_nth_unstable(cut);
    c.map.retain(|_, (_, t)| *t > limit);
}

pub fn len() -> usize {
    lock().map.len()
}

#[cfg(test)]
pub fn clear() {
    lock().map.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u64) -> Key {
        Key {
            id: (u64::MAX - 7, n),
            size: 3,
            modified_ns: None,
            changed_ns: None,
            path: PathBuf::from(format!("/cache-test/{n}")),
        }
    }

    #[test]
    fn hit_miss_and_bound() {
        let k = key(1);
        assert_eq!(get(&k), None);
        update(&k, |e| e.partial = Some([1; 32]));
        update(&k, |e| e.full = Some([2; 32]));
        let e = get(&k).unwrap();
        assert_eq!((e.partial, e.full), (Some([1; 32]), Some([2; 32])));
        // any other size, time, id or path is another file
        assert_eq!(
            get(&Key {
                size: 4,
                ..k.clone()
            }),
            None
        );
        assert_eq!(
            get(&Key {
                modified_ns: Some(0),
                ..k.clone()
            }),
            None
        );
        assert_eq!(
            get(&Key {
                changed_ns: Some(1),
                ..k.clone()
            }),
            None
        );
        assert_eq!(
            get(&Key {
                id: (1, 1),
                ..k.clone()
            }),
            None
        );
        assert_eq!(
            get(&Key {
                path: "/cache-test/other".into(),
                ..k.clone()
            }),
            None
        );
    }

    #[test]
    fn eviction_keeps_the_recent_ones() {
        let mut c = Cache::default();
        for n in 0..100u64 {
            c.tick += 1;
            c.map.insert(key(n), (Entry::default(), c.tick));
        }
        evict(&mut c);
        assert_eq!(c.map.len(), 89);
        assert!(!c.map.contains_key(&key(0)) && c.map.contains_key(&key(99)));
    }
}
