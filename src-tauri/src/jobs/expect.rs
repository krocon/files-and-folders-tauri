//! "Is it still what the panel showed?" (design 030 E5).
//!
//! A panel may show a listing from the cache or of a network drive that is not
//! watched. Before a delete or move touches a top-level entry, the job compares it
//! with what the panel showed: the kind always; for files also size and mtime
//! (a folder's mtime changes with every entry inside, so only its kind counts).
//! A changed entry is left alone and reported as `changed_since_listing`.

use super::{ItemError, JobEvent};
use crate::error::{FsError, FsErrorCode};
use crate::listing::entry_from_metadata;
use crate::model::EntryKind;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedEntry {
    pub path: String,
    pub kind: EntryKind,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub modified_ms: Option<i64>,
}

/// Why `path` is not what `expected` says – `None` if it still is (or is gone:
/// a missing entry is the job's normal "not found").
pub fn changed(path: &Path, expected: &ExpectedEntry) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let now = entry_from_metadata(name, path, &meta, false);
    if now.kind != expected.kind {
        return Some("it is another kind of entry now".into());
    }
    if now.kind == EntryKind::File {
        if expected.size.is_some() && now.size != expected.size {
            return Some("its size changed".into());
        }
        if expected.modified_ms.is_some() && now.modified_ms != expected.modified_ms {
            return Some("it was modified".into());
        }
    }
    None
}

/// Splits `paths` into the ones to work on and the changed ones (reported as item errors).
/// Stops checking (keeps the rest) once `cancelled` says so – the job then ends as
/// cancelled anyway.
pub fn filter(
    id: &str,
    paths: Vec<PathBuf>,
    expected: &[ExpectedEntry],
    cancelled: &dyn Fn() -> bool,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (Vec<PathBuf>, Vec<ItemError>) {
    if expected.is_empty() {
        return (paths, Vec::new());
    }
    // one lookup per path, not a scan per path (review 030 #6)
    let by_path: std::collections::HashMap<PathBuf, &ExpectedEntry> = expected
        .iter()
        .map(|e| (crate::paths::normalize_lexically(Path::new(&e.path)), e))
        .collect();
    let mut keep = Vec::with_capacity(paths.len());
    let mut skipped = Vec::new();
    for p in paths {
        if cancelled() {
            keep.push(p);
            continue;
        }
        let exp = by_path.get(&crate::paths::normalize_lexically(&p)).copied();
        match exp.and_then(|e| changed(&p, e)) {
            Some(why) => {
                let error = ItemError {
                    path: p.to_string_lossy().into_owned(),
                    error: FsError::new(
                        FsErrorCode::ChangedSinceListing,
                        format!("Left alone: {why} since the folder was listed"),
                        Some(&p),
                    ),
                };
                emit(JobEvent::ItemFailed {
                    id: id.to_string(),
                    error: error.clone(),
                });
                skipped.push(error);
            }
            None => keep.push(p),
        }
    }
    (keep, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn exp(path: &Path) -> ExpectedEntry {
        let meta = fs::symlink_metadata(path).unwrap();
        let e = entry_from_metadata("x".into(), path, &meta, false);
        ExpectedEntry {
            path: path.to_string_lossy().into_owned(),
            kind: e.kind,
            size: e.size,
            modified_ms: e.modified_ms,
        }
    }

    #[test]
    fn unchanged_entries_pass_changed_ones_are_named() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("Bericht ä 😀.txt");
        let d = tmp.path().join("Ordner");
        fs::write(&f, b"abc").unwrap();
        fs::create_dir(&d).unwrap();
        let (ef, ed) = (exp(&f), exp(&d));
        assert_eq!(changed(&f, &ef), None);
        assert_eq!(changed(&d, &ed), None);
        // a folder's content may change: still the same folder
        fs::write(d.join("neu"), b"").unwrap();
        assert_eq!(changed(&d, &ed), None);
        // bigger
        fs::write(&f, b"abcdef").unwrap();
        assert!(changed(&f, &ef).unwrap().contains("size"));
        // same size, other time
        let ef2 = exp(&f);
        let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        fs::File::options()
            .write(true)
            .open(&f)
            .unwrap()
            .set_modified(t)
            .unwrap();
        assert!(changed(&f, &ef2).unwrap().contains("modified"));
        // replaced by a folder
        fs::remove_file(&f).unwrap();
        fs::create_dir(&f).unwrap();
        assert!(changed(&f, &ef).unwrap().contains("kind"));
        // gone: the job's normal "not found"
        assert_eq!(changed(&tmp.path().join("weg"), &ef), None);
    }

    #[test]
    fn filter_keeps_order_and_reports_changed() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        let c = tmp.path().join("c");
        for p in [&a, &b, &c] {
            fs::write(p, b"1").unwrap();
        }
        let expected = vec![exp(&a), exp(&b)];
        fs::write(&b, b"22").unwrap();
        let events = std::sync::Mutex::new(Vec::new());
        let emit = |e: JobEvent| events.lock().unwrap().push(e);
        let (keep, skipped) = filter(
            "j1",
            vec![a.clone(), b.clone(), c.clone()],
            &expected,
            &|| false,
            &emit,
        );
        assert_eq!(keep, vec![a, c], "c had no expectation: kept");
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].error.code, FsErrorCode::ChangedSinceListing);
        assert_eq!(events.lock().unwrap().len(), 1);
    }
}
