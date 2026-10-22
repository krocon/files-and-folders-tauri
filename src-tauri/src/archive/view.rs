//! Files opened from an archive (design 025 E5): F3, the quick view and Enter
//! work on a copy of the entry in a private folder of the app –
//! `<app cache>/archive-view/run-<pid>-<ms>/<n>/<name>`. The copy is extracted
//! by the same code as F5 (`jobs/extract.rs`: names, links, limits, password),
//! set read-only (nothing is written back) and reused while the archive is
//! unchanged. The folder of this run goes when the app ends ([`cleanup`]),
//! those of earlier runs older than [`STALE`] when it starts ([`init`]).

use super::{EntryType, archive_error, index_of, resolve, too_large};
use crate::error::{FsError, FsErrorCode};
use crate::jobs::{ConflictDefault, Control, CopyOptions, JobEvent, JobState, Summary, extract};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Entries larger than this are not extracted for F3 / the quick view.
pub const PREVIEW_LIMIT: u64 = 256 << 20;
/// Entries larger than this are not copied for Enter (the cache is no place for them – F5).
pub const OPEN_LIMIT: u64 = 4 << 30;
/// Copies kept per run at most (oldest go first).
const MAX_BYTES: u64 = 2 << 30;
const MAX_FILES: usize = 256;
/// Folders of earlier runs older than this are removed at start.
pub const STALE: Duration = Duration::from_secs(3 * 24 * 3600);
const RUN_PREFIX: &str = "run-";

pub(crate) type Key = (PathBuf, u64, Option<SystemTime>, Vec<String>);

struct Copy {
    key: Key,
    /// `<run>/<n>` – removed with the copy.
    dir: PathBuf,
    file: PathBuf,
    size: u64,
}

#[derive(Default)]
struct Cache {
    /// Parent of the run folders (`<app cache>/archive-view`), if known.
    base: Option<PathBuf>,
    run: Option<PathBuf>,
    next: u64,
    copies: VecDeque<Copy>,
    bytes: u64,
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache::default()))
}

fn lock() -> std::sync::MutexGuard<'static, Cache> {
    cache().lock().unwrap_or_else(|e| e.into_inner())
}

/// A folder only we may enter (0700 on Unix); fails if it exists already.
fn create_private_dir(dir: &Path) -> io::Result<()> {
    #[cfg_attr(not(unix), allow(unused_mut))] // the mode is set on Unix only
    let mut b = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(dir)
}

/// Removes a folder tree without following links (read-only copies included).
pub(crate) fn remove_tree(dir: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(dir)?;
    if !meta.is_dir() {
        return fs::remove_file(dir);
    }
    for e in fs::read_dir(dir)? {
        let e = e?;
        let p = e.path();
        let ft = e.file_type()?;
        if ft.is_dir() {
            remove_tree(&p)?;
        } else {
            #[cfg(windows)]
            if let Ok(m) = fs::symlink_metadata(&p) {
                let mut perm = m.permissions();
                if perm.readonly() {
                    #[allow(clippy::permissions_set_readonly_false)]
                    perm.set_readonly(false);
                    let _ = fs::set_permissions(&p, perm);
                }
            }
            fs::remove_file(&p)?;
        }
    }
    fs::remove_dir(dir)
}

/// Sets the parent of the run folders and removes stale runs of earlier starts.
pub fn init(base: &Path) {
    let _ = fs::create_dir_all(base);
    if let Ok(entries) = fs::read_dir(base) {
        let now = SystemTime::now();
        for e in entries.flatten() {
            let name = e.file_name();
            let stale = e
                .metadata()
                .ok()
                .filter(|m| m.is_dir())
                .and_then(|m| m.modified().ok())
                .and_then(|t| now.duration_since(t).ok())
                .is_some_and(|age| age > STALE);
            if stale && name.to_string_lossy().starts_with(RUN_PREFIX) {
                let _ = remove_tree(&e.path());
            }
        }
    }
    let mut c = lock();
    c.base = Some(base.to_path_buf());
}

/// Removes the copies of this run (app exit).
pub fn cleanup() {
    let mut c = lock();
    if let Some(run) = c.run.take() {
        let _ = remove_tree(&run);
    }
    c.copies.clear();
    c.bytes = 0;
}

/// The folder of this run (created on first use).
fn run_dir(c: &mut Cache) -> Result<PathBuf, FsError> {
    if let Some(r) = &c.run
        && r.is_dir()
    {
        return Ok(r.clone());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let base = match &c.base {
        Some(b) => b.clone(),
        // no app cache folder (tests, odd systems): a fresh private folder in the temp dir
        None => std::env::temp_dir(),
    };
    let _ = fs::create_dir_all(&base);
    for attempt in 0..16u32 {
        let dir = base.join(format!(
            "{RUN_PREFIX}{}-{}-{attempt}",
            std::process::id(),
            stamp
        ));
        match create_private_dir(&dir) {
            Ok(()) => {
                c.run = Some(dir.clone());
                return Ok(dir);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(FsError::from_io(&e, &dir)),
        }
    }
    Err(FsError::new(
        FsErrorCode::Io,
        "No folder for files opened from archives",
        None,
    ))
}

/// A fresh private folder inside this run's folder for a short-lived extraction
/// (comic pages for the duplicate search, design 042 E7). The caller removes it with
/// [`remove_tree`]; whatever is left goes with the run folder at exit.
pub(crate) fn scratch_dir() -> Result<PathBuf, FsError> {
    let mut c = lock();
    let run = run_dir(&mut c)?;
    c.next += 1;
    let dir = run.join(format!("s{}", c.next));
    create_private_dir(&dir).map_err(|e| FsError::from_io(&e, &dir))?;
    Ok(dir)
}

fn evict(c: &mut Cache) {
    while c.copies.len() > MAX_FILES || (c.bytes > MAX_BYTES && c.copies.len() > 1) {
        if let Some(old) = c.copies.pop_front() {
            c.bytes = c.bytes.saturating_sub(old.size);
            let _ = remove_tree(&old.dir);
        }
    }
}

/// A copy made before for `key` (moved to the end of the LRU), or a fresh folder for
/// a new one – shared with server files (design 034 §4.5).
pub(crate) enum Slot {
    Hit(PathBuf),
    Fresh(PathBuf),
}

pub(crate) fn slot_for(key: &Key) -> Result<Slot, FsError> {
    let mut c = lock();
    if let Some(i) = c.copies.iter().position(|x| x.key == *key) {
        let hit = c.copies.remove(i).expect("position is valid");
        let fresh =
            fs::symlink_metadata(&hit.file).is_ok_and(|m| m.is_file() && m.len() == hit.size);
        if fresh {
            let file = hit.file.clone();
            c.copies.push_back(hit);
            return Ok(Slot::Hit(file));
        }
        c.bytes = c.bytes.saturating_sub(hit.size);
        let _ = remove_tree(&hit.dir);
    }
    let run = run_dir(&mut c)?;
    c.next += 1;
    let dir = run.join(c.next.to_string());
    create_private_dir(&dir).map_err(|e| FsError::from_io(&e, &dir))?;
    Ok(Slot::Fresh(dir))
}

/// Keeps a finished copy (read-only) in the cache.
pub(crate) fn keep(key: Key, dir: PathBuf, file: &Path, size: u64) {
    if let Ok(m) = fs::metadata(file) {
        let mut perm = m.permissions();
        perm.set_readonly(true);
        let _ = fs::set_permissions(file, perm);
    }
    let mut c = lock();
    c.bytes += size;
    c.copies.push_back(Copy {
        key,
        dir,
        file: file.to_path_buf(),
        size,
    });
    evict(&mut c);
}

/// How a view extraction ended.
pub enum Outcome {
    Done(PathBuf, Summary),
    Cancelled(Summary),
}

/// Extracts the entry at the virtual `path` into this run's folder (or finds
/// the copy made before). `max` = largest entry accepted.
pub fn materialize(
    path: &Path,
    max: u64,
    id: &str,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> Result<Outcome, FsError> {
    let (archive, inner) = resolve(path)
        .ok_or_else(|| FsError::new(FsErrorCode::NotFound, "Not inside an archive", Some(path)))?;
    if inner.is_empty() {
        return Err(FsError::new(
            FsErrorCode::NotAFile,
            "This is the archive itself",
            Some(path),
        ));
    }
    let index = index_of(&archive)?;
    let entry = index
        .entries
        .iter()
        .filter(|e| e.name == inner)
        .find(|e| e.kind != EntryType::Dir)
        .ok_or_else(|| {
            let dir = index.entries.iter().any(|e| e.name.starts_with(&inner));
            if dir {
                FsError::new(FsErrorCode::NotAFile, "A folder in the archive", Some(path))
            } else {
                FsError::new(FsErrorCode::NotFound, "Not in the archive", Some(path))
            }
        })?;
    match entry.kind {
        EntryType::File => {}
        EntryType::Link | EntryType::Other => {
            return Err(extract::unsafe_entry(
                "Links and special files in archives are not opened",
                path,
            ));
        }
        EntryType::Dir => unreachable!("filtered above"),
    }
    if entry.size > max {
        return Err(too_large(
            format!(
                "Too large to show from the archive (over {} MiB) – extract it first (F5)",
                max >> 20
            ),
            path,
        ));
    }
    let meta = fs::metadata(&archive).map_err(|e| FsError::from_io(&e, &archive))?;
    let key: Key = (
        crate::paths::normalize_lexically(&archive),
        meta.len(),
        meta.modified().ok(),
        inner.clone(),
    );
    let dir = {
        let mut c = lock();
        if let Some(i) = c.copies.iter().position(|x| x.key == key) {
            let hit = c.copies.remove(i).expect("position is valid");
            let fresh =
                fs::symlink_metadata(&hit.file).is_ok_and(|m| m.is_file() && m.len() == hit.size);
            if fresh {
                let file = hit.file.clone();
                c.copies.push_back(hit);
                return Ok(Outcome::Done(file, Summary::default()));
            }
            c.bytes = c.bytes.saturating_sub(hit.size);
            let _ = remove_tree(&hit.dir);
        }
        let run = run_dir(&mut c)?;
        c.next += 1;
        let dir = run.join(c.next.to_string());
        create_private_dir(&dir).map_err(|e| FsError::from_io(&e, &dir))?;
        dir
    };
    let options = CopyOptions {
        conflict_default: ConflictDefault::Overwrite,
        rename_to: None,
    };
    let entries = [path.to_string_lossy().into_owned()];
    let (state, summary) =
        extract::run(id, &archive, &entries, &dir, false, &options, control, emit);
    let name = inner.last().expect("inner is not empty");
    let file = dir.join(name);
    match state {
        JobState::Done if file.is_file() => {
            if let Ok(m) = fs::metadata(&file) {
                let mut perm = m.permissions();
                perm.set_readonly(true);
                let _ = fs::set_permissions(&file, perm);
            }
            let mut c = lock();
            c.bytes += entry.size;
            c.copies.push_back(Copy {
                key,
                dir,
                file: file.clone(),
                size: entry.size,
            });
            evict(&mut c);
            Ok(Outcome::Done(file, summary))
        }
        JobState::Cancelled => {
            let _ = remove_tree(&dir);
            Ok(Outcome::Cancelled(summary))
        }
        _ => {
            let _ = remove_tree(&dir);
            let error = summary
                .error
                .clone()
                .or_else(|| summary.errors.first().map(|e| e.error.clone()))
                .unwrap_or_else(|| archive_error("The entry could not be extracted", path));
            Err(error)
        }
    }
}

/// The running preview extraction per slot (`viewer`, `quick`): a new request
/// cancels the previous one of its slot (external review 025 #5).
pub(crate) fn preview_control(slot: &str) -> Arc<Control> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<Control>>>> = OnceLock::new();
    let mut m = RUNNING
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let control = Arc::new(Control::default());
    if let Some(old) = m.insert(slot.to_string(), control.clone()) {
        old.cancel();
    }
    control
}

/// The copy for F3 / the quick view (≤ [`PREVIEW_LIMIT`]), without a job. A
/// newer request of the same `slot` cancels this one.
pub fn for_preview(path: &Path, slot: Option<&str>) -> Result<PathBuf, FsError> {
    let control = match slot {
        Some(s) => preview_control(s),
        None => Arc::new(Control::default()),
    };
    match materialize(path, PREVIEW_LIMIT, "view", &control, &|_| {})? {
        Outcome::Done(p, _) => Ok(p),
        Outcome::Cancelled(_) => Err(FsError::new(
            FsErrorCode::Io,
            "Replaced by a newer preview",
            Some(path),
        )),
    }
}

/// Job `viewEntry` (Enter on a file in an archive): the copy's path in `Summary.view_path`.
pub fn run_job(
    id: &str,
    path: &Path,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    match materialize(path, OPEN_LIMIT, id, control, emit) {
        Ok(Outcome::Done(file, mut summary)) => {
            summary.view_path = Some(file.to_string_lossy().into_owned());
            (JobState::Done, summary)
        }
        Ok(Outcome::Cancelled(summary)) => (JobState::Cancelled, summary),
        Err(e) => (
            JobState::Failed,
            Summary {
                error: Some(e),
                ..Summary::default()
            },
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// External review 025 #5: a newer preview of a slot cancels the running one.
    #[test]
    fn a_newer_preview_cancels_the_older_one_of_its_slot() {
        let first = preview_control("test-slot");
        let other = preview_control("test-other");
        let second = preview_control("test-slot");
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled() && !other.is_cancelled());
    }
}
