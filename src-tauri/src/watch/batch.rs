//! Debouncing of file-system events per watched folder (design 012 E3).
//! Pure logic without `notify` or threads: the caller feeds touches with a
//! timestamp and asks which folders are due.

use std::collections::{BTreeSet, HashMap};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

/// Deliver after this much quiet …
pub const QUIET: Duration = Duration::from_millis(150);
/// … but at the latest this long after the first event of a batch.
pub const MAX_DELAY: Duration = Duration::from_millis(400);
/// More changed names than this in one batch → reload the folder once.
pub const MAX_NAMES: usize = 500;
/// At most one reload per folder within this time (event floods).
pub const RESCAN_GAP: Duration = Duration::from_millis(1500);

/// What an event means for one watched folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Touch {
    /// A direct child changed (also for events deeper below it).
    Child(OsString),
    /// The folder itself (attributes, or an event of unknown kind).
    SelfChanged,
    /// The folder itself was removed or renamed: its watch is lost even if a
    /// new folder of that name exists (and may reuse the inode).
    SelfRemoved,
    /// The watcher lost events or failed – reload.
    Rescan,
}

/// A batch that is due.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Flush {
    /// Re-stat these direct children.
    Changes { dir: PathBuf, names: Vec<OsString> },
    /// Reload the whole folder.
    Rescan { dir: PathBuf },
    /// The folder itself changed: gone, replaced (reload), or only its
    /// attributes (then the children in `names`, or a reload if `rescan`).
    SelfChanged {
        dir: PathBuf,
        names: Vec<OsString>,
        rescan: bool,
        removed: bool,
    },
}

#[derive(Debug, Default)]
struct DirState {
    names: BTreeSet<OsString>,
    rescan: bool,
    self_changed: bool,
    self_removed: bool,
    first: Option<Instant>,
    last: Option<Instant>,
    last_rescan: Option<Instant>,
}

impl DirState {
    fn ready_at(&self) -> Option<Instant> {
        let (first, last) = (self.first?, self.last?);
        let at = (last + QUIET).min(first + MAX_DELAY);
        if self.rescan
            && !self.self_changed
            && let Some(prev) = self.last_rescan
        {
            return Some(at.max(prev + RESCAN_GAP));
        }
        Some(at)
    }
}

/// Pending changes of all watched folders.
#[derive(Debug, Default)]
pub struct Batcher {
    dirs: HashMap<PathBuf, DirState>,
}

impl Batcher {
    /// The watched folders; state of folders that stay is kept.
    pub fn set_dirs(&mut self, dirs: &[PathBuf]) {
        self.dirs.retain(|d, _| dirs.contains(d));
        for d in dirs {
            self.dirs.entry(d.clone()).or_default();
        }
    }

    pub fn touch(&mut self, dir: &Path, touch: Touch, now: Instant) {
        let Some(state) = self.dirs.get_mut(dir) else {
            return;
        };
        state.first.get_or_insert(now);
        state.last = Some(now);
        match touch {
            Touch::Child(name) => {
                if !state.rescan {
                    state.names.insert(name);
                    if state.names.len() > MAX_NAMES {
                        state.rescan = true;
                        state.names.clear();
                    }
                }
            }
            Touch::SelfChanged => state.self_changed = true,
            Touch::SelfRemoved => {
                state.self_changed = true;
                state.self_removed = true;
            }
            Touch::Rescan => {
                state.rescan = true;
                state.names.clear();
            }
        }
    }

    /// Every watched folder must be reloaded (queue overflow without paths).
    pub fn touch_all(&mut self, now: Instant) {
        let dirs: Vec<PathBuf> = self.dirs.keys().cloned().collect();
        for d in dirs {
            self.touch(&d, Touch::Rescan, now);
        }
    }

    /// The earliest time a batch becomes due.
    pub fn next_deadline(&self) -> Option<Instant> {
        self.dirs.values().filter_map(DirState::ready_at).min()
    }

    /// Takes the batches that are due at `now`.
    pub fn due(&mut self, now: Instant) -> Vec<Flush> {
        let mut out = Vec::new();
        for (dir, state) in &mut self.dirs {
            if !state.ready_at().is_some_and(|at| at <= now) {
                continue;
            }
            let flush = if state.self_changed {
                Flush::SelfChanged {
                    dir: dir.clone(),
                    names: std::mem::take(&mut state.names).into_iter().collect(),
                    rescan: state.rescan,
                    removed: state.self_removed,
                }
            } else if state.rescan {
                state.last_rescan = Some(now);
                Flush::Rescan { dir: dir.clone() }
            } else {
                Flush::Changes {
                    dir: dir.clone(),
                    names: std::mem::take(&mut state.names).into_iter().collect(),
                }
            };
            state.names.clear();
            state.rescan = false;
            state.self_changed = false;
            state.self_removed = false;
            state.first = None;
            state.last = None;
            out.push(flush);
        }
        out.sort_by(|a, b| flush_dir(a).cmp(flush_dir(b)));
        out
    }
}

fn flush_dir(f: &Flush) -> &Path {
    match f {
        Flush::Changes { dir, .. } | Flush::Rescan { dir } | Flush::SelfChanged { dir, .. } => dir,
    }
}

/// What an event on `path` means for the watched folder `dir` (or one of its
/// aliases, e.g. the resolved `/private/var/…` on macOS): `None` = unrelated.
pub fn classify(dir_aliases: &[PathBuf], path: &Path) -> Option<Touch> {
    for alias in dir_aliases {
        if path == alias.as_path() {
            return Some(Touch::SelfChanged);
        }
        if let Ok(rest) = path.strip_prefix(alias)
            && let Some(Component::Normal(name)) = rest.components().next()
        {
            if is_own_temp(name) {
                return None;
            }
            return Some(Touch::Child(name.to_os_string()));
        }
    }
    None
}

/// Temp files of our own jobs (copy `.fnf-<job>-<n>.part`, rename
/// `.fnf-rename-…`): never shown, so their events are dropped (review 012 #5).
fn is_own_temp(name: &std::ffi::OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    name.starts_with(".fnf-rename-") || (name.starts_with(".fnf-") && name.ends_with(".part"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    fn batcher(dirs: &[&str]) -> Batcher {
        let mut b = Batcher::default();
        b.set_dirs(&dirs.iter().map(PathBuf::from).collect::<Vec<_>>());
        b
    }

    fn child(n: &str) -> Touch {
        Touch::Child(n.into())
    }

    #[test]
    fn collects_names_until_quiet() {
        let t0 = Instant::now();
        let mut b = batcher(&["/a"]);
        b.touch(Path::new("/a"), child("x.txt"), t0);
        b.touch(Path::new("/a"), child("x.txt"), t0 + ms(50));
        b.touch(Path::new("/a"), child("Ä ö 😀"), t0 + ms(100));
        assert_eq!(b.next_deadline(), Some(t0 + ms(250)));
        assert!(b.due(t0 + ms(200)).is_empty());
        assert_eq!(
            b.due(t0 + ms(250)),
            vec![Flush::Changes {
                dir: "/a".into(),
                names: vec!["x.txt".into(), "Ä ö 😀".into()]
            }]
        );
        assert!(b.next_deadline().is_none());
    }

    #[test]
    fn a_steady_stream_is_delivered_after_max_delay() {
        let t0 = Instant::now();
        let mut b = batcher(&["/a"]);
        for i in 0..10 {
            b.touch(Path::new("/a"), child(&format!("f{i}")), t0 + ms(i * 50));
        }
        assert_eq!(b.next_deadline(), Some(t0 + MAX_DELAY));
        assert_eq!(b.due(t0 + MAX_DELAY).len(), 1);
    }

    #[test]
    fn too_many_names_become_one_rescan_and_floods_are_spaced() {
        let t0 = Instant::now();
        let mut b = batcher(&["/a"]);
        for i in 0..=MAX_NAMES {
            b.touch(Path::new("/a"), child(&format!("f{i}")), t0);
        }
        let now = t0 + QUIET;
        assert_eq!(b.due(now), vec![Flush::Rescan { dir: "/a".into() }]);
        // the flood goes on: the next reload waits for the gap
        for i in 0..=MAX_NAMES {
            b.touch(Path::new("/a"), child(&format!("g{i}")), now + ms(10));
        }
        assert!(b.due(now + ms(500)).is_empty());
        assert_eq!(b.next_deadline(), Some(now + RESCAN_GAP));
        assert_eq!(
            b.due(now + RESCAN_GAP),
            vec![Flush::Rescan { dir: "/a".into() }]
        );
        // small changes after the flood are incremental again, without a gap
        let later = now + RESCAN_GAP + ms(10);
        b.touch(Path::new("/a"), child("one"), later);
        assert_eq!(b.next_deadline(), Some(later + QUIET));
    }

    #[test]
    fn self_change_wins_and_is_not_delayed_by_the_gap() {
        let t0 = Instant::now();
        let mut b = batcher(&["/a", "/b"]);
        b.touch(Path::new("/a"), Touch::Rescan, t0);
        b.due(t0 + QUIET);
        b.touch(Path::new("/a"), child("x"), t0 + ms(200));
        b.touch(Path::new("/a"), Touch::SelfChanged, t0 + ms(200));
        b.touch(Path::new("/b"), child("y"), t0 + ms(200));
        assert_eq!(
            b.due(t0 + ms(350)),
            vec![
                Flush::SelfChanged {
                    dir: "/a".into(),
                    names: vec!["x".into()],
                    rescan: false,
                    removed: false
                },
                Flush::Changes {
                    dir: "/b".into(),
                    names: vec!["y".into()]
                }
            ]
        );
    }

    #[test]
    fn unwatched_folders_are_ignored_and_dropped() {
        let t0 = Instant::now();
        let mut b = batcher(&["/a", "/b"]);
        b.touch(Path::new("/c"), child("x"), t0);
        b.touch(Path::new("/b"), child("x"), t0);
        b.set_dirs(&[PathBuf::from("/a")]);
        assert!(b.due(t0 + ms(1000)).is_empty());
        b.touch_all(t0);
        assert_eq!(b.due(t0 + QUIET), vec![Flush::Rescan { dir: "/a".into() }]);
    }

    #[test]
    fn classify_maps_deeper_paths_to_the_direct_child() {
        let aliases = vec![PathBuf::from("/var/x"), PathBuf::from("/private/var/x")];
        assert_eq!(
            classify(&aliases, Path::new("/var/x/a.txt")),
            Some(child("a.txt"))
        );
        assert_eq!(
            classify(&aliases, Path::new("/private/var/x/sub/deep/file")),
            Some(child("sub"))
        );
        assert_eq!(
            classify(&aliases, Path::new("/var/x")),
            Some(Touch::SelfChanged)
        );
        assert_eq!(classify(&aliases, Path::new("/var/xy/a")), None);
        assert_eq!(classify(&aliases, Path::new("/var")), None);
        assert_eq!(classify(&aliases, Path::new("/var/x/.fnf-3-1.part")), None);
        assert_eq!(
            classify(&aliases, Path::new("/var/x/.fnf-rename-1-2-3")),
            None
        );
        assert_eq!(
            classify(&aliases, Path::new("/var/x/.fnf-notes.txt")),
            Some(child(".fnf-notes.txt"))
        );
    }
}
