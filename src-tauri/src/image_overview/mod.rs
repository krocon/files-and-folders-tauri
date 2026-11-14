//! The image overview (design 074): the images of a folder (optionally below it) and
//! their thumbnails over the `fnfthumb` scheme.
//!
//! An overview is opened for a folder; Rust collects its images ([`crate::collect`] with
//! `only_images`), keeps them as [`thumbs::Source`]s under a random id and sends them to
//! the frontend in parts. A thumbnail URL names only `<id>.<index>.<step>` – Rust serves
//! nothing it did not list itself for an overview that is still open (E3). At most
//! [`MAX_OPEN`] overviews are kept; the oldest is dropped. Thumbnails are made by a LIFO
//! [`pool::Pool`] and kept in [`thumbs::Cache`].

pub mod pool;
pub mod thumbs;

use crate::collect::{self, CollectOptions};
use crate::error::{FsError, FsErrorCode};
use crate::images::{ImageKind, kind_of};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, UNIX_EPOCH};
use thumbs::{Cache, MAX_CACHE_BYTES, STEPS, Source};

/// URI scheme of the thumbnails (`fnfthumb://localhost/<id>.<index>.<step>?v=<mtime>`).
pub const SCHEME: &str = "fnfthumb";
/// Overviews kept open (one shown, one being replaced).
pub const MAX_OPEN: usize = 2;
/// Items per event (Comic Commander 004: one big IPC message is slow).
pub const CHUNK: usize = 2000;
/// Folder levels when "include subfolders" is on.
pub const RECURSIVE_DEPTH: u32 = collect::MAX_DEPTH;

/// An image as the frontend sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewItem {
    /// Position in the overview: the `index` of its thumbnail URL.
    pub index: u32,
    /// Full path (opaque for the frontend).
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
    /// Path below the overview's folder, OS separators – display only.
    pub rel: String,
    /// The folder the image is in (opaque).
    pub dir: String,
    pub kind: ImageKind,
}

/// What an overview reports while it collects.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OverviewEvent {
    /// The next part (in Rust's order: depth first, by name).
    #[serde(rename_all = "camelCase")]
    Items { items: Vec<OverviewItem> },
    /// All parts sent.
    #[serde(rename_all = "camelCase")]
    Done {
        /// A limit stopped the walk (20 000 images, 500 000 entries).
        truncated: bool,
        unreadable: Vec<FsError>,
        unreadable_more: u64,
    },
    /// Closed before it was complete.
    Cancelled,
}

struct Overview {
    id: String,
    sources: RwLock<Vec<Source>>,
    cancel: AtomicBool,
    /// Thumbnails that failed (index, step) → HTTP status; not tried again.
    failed: Mutex<HashMap<(u32, u8), u16>>,
}

type Key = (String, u32, u8);
/// Bytes of a JPEG or an HTTP status.
pub type Answer = Arc<Result<Vec<u8>, u16>>;

struct Hub {
    open: Mutex<VecDeque<Arc<Overview>>>,
    counter: AtomicU64,
    pool: Pool,
}

type Pool = pool::Pool<Key, Answer>;

static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Sets the cache folder (`<app cache>/thumbs`) and tidies it in the background.
pub fn init(app_cache: &Path) {
    let dir = app_cache.join("thumbs");
    let _ = CACHE_DIR.set(dir.clone());
    let _ = std::thread::Builder::new()
        .name("fnf-thumbs-clean".into())
        .spawn(move || Cache::new(dir, MAX_CACHE_BYTES).clean());
}

fn hub() -> &'static Hub {
    static HUB: OnceLock<Hub> = OnceLock::new();
    HUB.get_or_init(|| {
        let dir = CACHE_DIR
            .get()
            .cloned()
            .unwrap_or_else(|| std::env::temp_dir().join("fnf-thumbs"));
        let cache = Arc::new(Cache::new(dir, MAX_CACHE_BYTES));
        // leave cores for the UI and the other jobs (E5)
        let threads = std::thread::available_parallelism()
            .map_or(2, |n| n.get().saturating_sub(1))
            .clamp(1, 4);
        Hub {
            open: Mutex::new(VecDeque::new()),
            counter: AtomicU64::new(0),
            pool: Pool::new(threads, move |key: &Key| Arc::new(make(&cache, key))),
        }
    })
}

fn find(id: &str) -> Option<Arc<Overview>> {
    hub()
        .open
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|o| o.id == id)
        .cloned()
}

fn status_of(e: &FsError, kind: ImageKind) -> u16 {
    match e.code {
        FsErrorCode::NotFound => 404,
        FsErrorCode::UnsupportedImage if kind == ImageKind::Unsupported => 415,
        _ => 422,
    }
}

/// Work of the pool: one thumbnail.
fn make(cache: &Cache, (id, index, step): &Key) -> Result<Vec<u8>, u16> {
    let Some(o) = find(id) else {
        return Err(404);
    };
    if let Some(s) = o
        .failed
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&(*index, *step))
    {
        return Err(*s);
    }
    let src = {
        let sources = o.sources.read().unwrap_or_else(|e| e.into_inner());
        sources.get(*index as usize).cloned()
    };
    let Some(src) = src else {
        return Err(404);
    };
    if src.kind == ImageKind::Unsupported {
        return Err(415);
    }
    cache.get(&src, usize::from(*step)).map_err(|e| {
        let status = status_of(&e, src.kind);
        o.failed
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((*index, *step), status);
        status
    })
}

/// Registers a new overview and returns its id; the oldest beyond [`MAX_OPEN`] is closed.
pub fn register() -> String {
    let h = hub();
    let n = h.counter.fetch_add(1, Ordering::Relaxed);
    let id = crate::preview::random_token(n);
    let o = Arc::new(Overview {
        id: id.clone(),
        sources: RwLock::new(Vec::new()),
        cancel: AtomicBool::new(false),
        failed: Mutex::new(HashMap::new()),
    });
    let mut open = h.open.lock().unwrap_or_else(|e| e.into_inner());
    open.push_back(o);
    while open.len() > MAX_OPEN {
        if let Some(old) = open.pop_front() {
            old.cancel.store(true, Ordering::Relaxed);
        }
    }
    id
}

/// Closes an overview: collecting stops, its thumbnails are no longer served.
pub fn close(id: &str) {
    let mut open = hub().open.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(i) = open.iter().position(|o| o.id == id)
        && let Some(o) = open.remove(i)
    {
        o.cancel.store(true, Ordering::Relaxed);
    }
}

/// Collects the images of overview `id` below `root` and reports them (blocking).
pub fn fill(
    id: &str,
    root: &Path,
    recursive: bool,
    emit: &dyn Fn(OverviewEvent),
) -> Result<(), FsError> {
    let Some(o) = find(id) else {
        emit(OverviewEvent::Cancelled);
        return Ok(());
    };
    let options = CollectOptions {
        max_depth: if recursive { RECURSIVE_DEPTH } else { 1 },
        only_images: true,
    };
    let tree = collect::collect_files_cancellable(root, &options, &o.cancel)?;
    if tree.cancelled || o.cancel.load(Ordering::Relaxed) {
        emit(OverviewEvent::Cancelled);
        return Ok(());
    }
    let mut sources = Vec::with_capacity(tree.files.len());
    let mut items = Vec::with_capacity(tree.files.len());
    for (i, f) in tree.files.into_iter().enumerate() {
        let Some(kind) = kind_of(&f.name) else {
            continue;
        };
        let path = PathBuf::from(&f.path);
        let dir = path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        sources.push(Source {
            path,
            size: f.size,
            modified: f
                .modified_ms
                .and_then(|ms| u64::try_from(ms).ok())
                .map(|ms| UNIX_EPOCH + Duration::from_millis(ms)),
            kind,
        });
        items.push(OverviewItem {
            index: u32::try_from(i).unwrap_or(u32::MAX),
            path: f.path,
            name: f.name,
            size: f.size,
            modified_ms: f.modified_ms,
            rel: f.rel,
            dir,
            kind,
        });
    }
    *o.sources.write().unwrap_or_else(|e| e.into_inner()) = sources;
    for part in items.chunks(CHUNK) {
        if o.cancel.load(Ordering::Relaxed) {
            emit(OverviewEvent::Cancelled);
            return Ok(());
        }
        emit(OverviewEvent::Items {
            items: part.to_vec(),
        });
    }
    emit(OverviewEvent::Done {
        truncated: tree.truncated,
        unreadable: tree.unreadable,
        unreadable_more: tree.unreadable_more,
    });
    Ok(())
}

/// Reads `/<id>.<index>.<step>` (the query `?v=` is not part of the path).
pub fn parse(uri_path: &str) -> Option<(String, u32, u8)> {
    let mut parts = uri_path.trim_start_matches('/').split('.');
    let id = parts.next()?;
    let index = parts.next()?.parse().ok()?;
    let step: u8 = parts.next()?.parse().ok()?;
    let valid_id = id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit());
    (parts.next().is_none() && valid_id && usize::from(step) < STEPS.len())
        .then(|| (id.to_owned(), index, step))
}

/// Asks for a thumbnail; `done` runs on a pool thread (404 for anything unknown).
pub fn request(uri_path: &str, done: impl FnOnce(Answer) + Send + 'static) {
    match parse(uri_path) {
        Some(key) => hub().pool.request(key, done),
        None => done(Arc::new(Err(404))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::duplicates::images::testimg::{jpeg, photo};
    use std::fs;
    use std::sync::mpsc;

    /// The hub is global: tests that open overviews run one at a time.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn events(id: &str, root: &Path, recursive: bool) -> Vec<OverviewEvent> {
        let got = Mutex::new(Vec::new());
        fill(id, root, recursive, &|e| got.lock().unwrap().push(e)).unwrap();
        got.into_inner().unwrap()
    }

    fn ask(path: &str) -> Answer {
        let (tx, rx) = mpsc::channel();
        request(path, move |a| tx.send(a).unwrap());
        rx.recv_timeout(Duration::from_secs(20)).unwrap()
    }

    #[test]
    fn overview_lists_images_and_serves_only_its_own() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("Fotos ä 🙂");
        fs::create_dir_all(root.join("Tag 1")).unwrap();
        fs::write(root.join("b.jpg"), jpeg(&photo(400, 300, 1), 85)).unwrap();
        fs::write(root.join("Tag 1/a.jpg"), jpeg(&photo(300, 400, 2), 85)).unwrap();
        fs::write(root.join("notes.txt"), "x").unwrap();
        fs::write(root.join("kaputt.png"), "not a png").unwrap();
        fs::write(root.join("i.heic"), "x").unwrap();

        let id = register();
        let flat = events(&id, &root, false);
        let OverviewEvent::Items { items } = &flat[0] else {
            panic!("items first: {flat:?}");
        };
        let names: Vec<_> = items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["b.jpg", "i.heic", "kaputt.png"]);
        assert_eq!(items[1].kind, ImageKind::Unsupported);
        assert_eq!(PathBuf::from(&items[0].dir), root);
        assert!(matches!(
            flat[1],
            OverviewEvent::Done {
                truncated: false,
                ..
            }
        ));

        let ok = ask(&format!("/{id}.0.0"));
        let img = image::load_from_memory(ok.as_ref().as_ref().unwrap()).unwrap();
        assert_eq!(img.width(), 160);
        assert_eq!(*ask(&format!("/{id}.1.0")), Err(415), "HEIC: placeholder");
        assert_eq!(*ask(&format!("/{id}.2.0")), Err(422), "broken");
        assert_eq!(*ask(&format!("/{id}.2.0")), Err(422), "remembered");
        assert_eq!(*ask(&format!("/{id}.9.0")), Err(404), "no such index");
        assert_eq!(*ask(&format!("/{id}.0.4")), Err(404), "no such step");
        assert_eq!(*ask("/../../etc/passwd"), Err(404));
        assert_eq!(
            *ask(&format!("/{}.0.0", "0".repeat(32))),
            Err(404),
            "unknown id"
        );

        let id2 = register();
        let deep = events(&id2, &root, true);
        let OverviewEvent::Items { items } = &deep[0] else {
            panic!();
        };
        // by name, upper case first: the folder "Tag 1" before "b.jpg"
        assert_eq!(
            items[0].rel,
            Path::new("Tag 1").join("a.jpg").to_string_lossy()
        );
        assert_eq!(items[1].name, "b.jpg");
        assert_eq!(items[1].index, 1);

        close(&id);
        assert_eq!(*ask(&format!("/{id}.0.0")), Err(404), "closed");
        close(&id2);
    }

    #[test]
    fn only_the_newest_overviews_stay_open() {
        let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let ids: Vec<String> = (0..=MAX_OPEN).map(|_| register()).collect();
        assert!(find(&ids[0]).is_none());
        for id in &ids[1..] {
            assert!(find(id).is_some());
            close(id);
        }
        let d = tempfile::tempdir().unwrap();
        assert_eq!(events(&ids[0], d.path(), false), [OverviewEvent::Cancelled]);
    }

    #[test]
    fn paths_of_the_scheme() {
        let id = "a".repeat(32);
        assert_eq!(parse(&format!("/{id}.12.3")), Some((id.clone(), 12, 3)));
        assert_eq!(parse(&format!("/{id}.12.3.4")), None);
        assert_eq!(parse(&format!("/{id}.-1.0")), None);
        assert_eq!(parse("/xyz.1.0"), None);
        assert_eq!(parse(""), None);
    }
}
