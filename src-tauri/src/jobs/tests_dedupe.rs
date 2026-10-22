//! Tests of the job `dedupe` (design 042 E5): only checked copies go, a changed file to
//! keep stops its group, hard links and changed contents are left alone.

use super::dedupe::{DedupeAction, DedupeGroup, DedupeVerify};
use super::expect::ExpectedEntry;
use super::tests_engine::Harness;
use super::*;
use crate::error::FsErrorCode;
use crate::listing::stat_entry;
use crate::model::EntryKind;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};
use tempfile::tempdir;

/// What the result showed for `p` (now).
fn shown(p: &Path) -> ExpectedEntry {
    let e = stat_entry(p).unwrap();
    ExpectedEntry {
        path: p.to_string_lossy().into_owned(),
        kind: EntryKind::File,
        size: e.size,
        modified_ms: e.modified_ms,
    }
}

fn group(keep: &Path, remove: &[&Path]) -> DedupeGroup {
    DedupeGroup {
        keep: shown(keep),
        remove: remove.iter().map(|p| shown(p)).collect(),
    }
}

impl Harness {
    fn dedupe(
        &self,
        groups: Vec<DedupeGroup>,
        action: DedupeAction,
        target_dir: Option<&Path>,
        verify: DedupeVerify,
    ) -> JobInfo {
        let id = self
            .mgr
            .start(JobSpec::Dedupe {
                groups,
                action,
                target_dir: target_dir.map(|d| d.to_string_lossy().into_owned()),
                verify,
                allow_dangerous: false,
            })
            .unwrap();
        self.finish(&id)
    }
}

fn codes(info: &JobInfo) -> Vec<(String, FsErrorCode)> {
    let s = info.summary.as_ref().unwrap();
    s.errors
        .iter()
        .map(|e| {
            (
                Path::new(&e.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                e.error.code,
            )
        })
        .collect()
}

/// Sets the mtime of `p` one hour back (a change the size does not show).
fn touch_back(p: &Path) {
    let t = SystemTime::now() - Duration::from_secs(3600);
    fs::File::options()
        .write(true)
        .open(p)
        .unwrap()
        .set_modified(t)
        .unwrap();
}

#[test]
fn deletes_only_checked_copies() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let r = d.path();
    let (keep, a, b) = (
        r.join("Original ä.jpg"),
        r.join("Kopie von a.jpg"),
        r.join("x 🎉.bin"),
    );
    for p in [&keep, &a, &b] {
        fs::write(p, "same content").unwrap();
    }
    let info = h.dedupe(
        vec![group(&keep, &[&a, &b])],
        DedupeAction::Permanent,
        None,
        DedupeVerify::Content,
    );
    assert_eq!(info.state, JobState::Done);
    assert!(keep.exists() && !a.exists() && !b.exists());
    let s = info.summary.unwrap();
    assert_eq!((s.items_done, s.bytes_done), (2, 24));
}

/// Acceptance criterion: a kept file changed in between stops its group.
#[test]
fn a_changed_file_to_keep_stops_its_group() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let r = d.path();
    let (k1, c1, k2, c2) = (r.join("k1"), r.join("c1"), r.join("k2"), r.join("c2"));
    for p in [&k1, &c1, &k2, &c2] {
        fs::write(p, "abc").unwrap();
    }
    let groups = vec![group(&k1, &[&c1]), group(&k2, &[&c2])];
    touch_back(&k1); // changed after the search
    let info = h.dedupe(groups, DedupeAction::Permanent, None, DedupeVerify::Content);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert!(c1.exists(), "group 1 is left alone");
    assert!(!c2.exists(), "group 2 goes on");
    assert_eq!(
        codes(&info),
        vec![("c1".into(), FsErrorCode::DuplicateChanged)]
    );
    // the file to keep is gone: nothing of its group is deleted
    fs::write(&c2, "abc").unwrap();
    let g = group(&k2, &[&c2]);
    fs::remove_file(&k2).unwrap();
    let info = h.dedupe(
        vec![g],
        DedupeAction::Permanent,
        None,
        DedupeVerify::Unchanged,
    );
    assert!(c2.exists());
    assert_eq!(
        codes(&info),
        vec![("c2".into(), FsErrorCode::DuplicateChanged)]
    );
}

#[test]
fn other_content_hard_links_and_changed_copies_stay() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let r = d.path();
    let keep = r.join("keep");
    fs::write(&keep, "abcdef").unwrap();
    // same size and mtime as shown, but other bytes (written before the "search")
    let other = r.join("other");
    fs::write(&other, "abcdeX").unwrap();
    let hard = r.join("hard");
    fs::hard_link(&keep, &hard).unwrap();
    let later = r.join("later");
    fs::write(&later, "abcdef").unwrap();
    let groups = vec![group(&keep, &[&other, &hard, &later])];
    touch_back(&later); // changed after the search
    let info = h.dedupe(groups, DedupeAction::Permanent, None, DedupeVerify::Content);
    assert!(keep.exists() && other.exists() && hard.exists() && later.exists());
    let mut c = codes(&info);
    c.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        c,
        vec![
            ("hard".into(), FsErrorCode::DuplicateChanged),
            ("later".into(), FsErrorCode::DuplicateChanged),
            ("other".into(), FsErrorCode::DuplicateChanged),
        ]
    );
}

#[test]
fn similar_mode_checks_only_unchanged() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let r = d.path();
    let (keep, small) = (r.join("IMG.jpg"), r.join("IMG klein.jpg"));
    fs::write(&keep, "big picture").unwrap();
    fs::write(&small, "small").unwrap();
    let info = h.dedupe(
        vec![group(&keep, &[&small])],
        DedupeAction::Permanent,
        None,
        DedupeVerify::Unchanged,
    );
    assert_eq!(info.state, JobState::Done);
    assert!(!small.exists());
    // the same in content mode would have refused
    fs::write(&small, "small").unwrap();
    let info = h.dedupe(
        vec![group(&keep, &[&small])],
        DedupeAction::Permanent,
        None,
        DedupeVerify::Content,
    );
    assert!(small.exists());
    assert_eq!(
        codes(&info),
        vec![("IMG klein.jpg".into(), FsErrorCode::DuplicateChanged)]
    );
}

#[test]
fn move_into_a_folder_never_replaces() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let r = d.path();
    let store = r.join("Ablage ä");
    fs::create_dir(&store).unwrap();
    fs::write(store.join("a.txt"), "already here").unwrap();
    fs::create_dir(r.join("sub")).unwrap();
    let (keep, a) = (r.join("keep.txt"), r.join("sub/a.txt"));
    fs::write(&keep, "same").unwrap();
    fs::write(&a, "same").unwrap();
    let info = h.dedupe(
        vec![group(&keep, &[&a])],
        DedupeAction::Move,
        Some(&store),
        DedupeVerify::Content,
    );
    assert_eq!(info.state, JobState::Done);
    assert!(!a.exists());
    assert_eq!(
        fs::read_to_string(store.join("a.txt")).unwrap(),
        "already here"
    );
    assert_eq!(fs::read_to_string(store.join("a (1).txt")).unwrap(), "same");
}

#[test]
fn trash_by_default() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let (keep, c) = (d.path().join("k"), d.path().join("c"));
    fs::write(&keep, "x").unwrap();
    fs::write(&c, "x").unwrap();
    let info = h.dedupe(
        vec![group(&keep, &[&c])],
        DedupeAction::Trash,
        None,
        DedupeVerify::Content,
    );
    // the container may have no trash: then it is an error, never a permanent delete
    if info.state == JobState::Done {
        assert!(!c.exists());
    } else {
        assert!(c.exists());
        assert_eq!(codes(&info)[0].1, FsErrorCode::TrashFailed);
    }
}

#[test]
fn invalid_specs_are_refused() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let (k, c) = (d.path().join("k"), d.path().join("c"));
    fs::write(&k, "x").unwrap();
    fs::write(&c, "x").unwrap();
    let start = |groups, action, target: Option<String>| {
        h.mgr.start(JobSpec::Dedupe {
            groups,
            action,
            target_dir: target,
            verify: DedupeVerify::Content,
            allow_dangerous: false,
        })
    };
    // nothing to delete
    assert!(start(vec![group(&k, &[])], DedupeAction::Trash, None).is_err());
    // the file to keep is also a copy (of itself)
    assert!(start(vec![group(&k, &[&k])], DedupeAction::Trash, None).is_err());
    // one file in two groups
    assert!(
        start(
            vec![group(&k, &[&c]), group(&c, &[&k])],
            DedupeAction::Trash,
            None
        )
        .is_err()
    );
    // move without a folder
    assert!(start(vec![group(&k, &[&c])], DedupeAction::Move, None).is_err());
    // a folder is no duplicate
    let mut g = group(&k, &[&c]);
    g.remove[0].kind = EntryKind::Directory;
    assert!(start(vec![g], DedupeAction::Trash, None).is_err());
    // a server path
    let mut g = group(&k, &[&c]);
    g.remove[0].path = "remote://p1/x".into();
    assert!(start(vec![g], DedupeAction::Permanent, None).is_err());
    // `..` in a path
    let mut g = group(&k, &[&c]);
    g.remove[0].path = format!("{}/../c", d.path().display());
    assert!(start(vec![g], DedupeAction::Permanent, None).is_err());
    assert!(c.exists() && k.exists());
}

#[test]
fn cancel_during_the_comparison() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let keep = d.path().join("keep");
    let data = vec![7u8; 64 << 20];
    fs::write(&keep, &data).unwrap();
    let copies: Vec<_> = (0..4).map(|i| d.path().join(format!("c{i}"))).collect();
    for c in &copies {
        fs::write(c, &data).unwrap();
    }
    let refs: Vec<&Path> = copies.iter().map(|p| p.as_path()).collect();
    let id = h
        .mgr
        .start(JobSpec::Dedupe {
            groups: vec![group(&keep, &refs)],
            action: DedupeAction::Permanent,
            target_dir: None,
            verify: DedupeVerify::Content,
            allow_dangerous: false,
        })
        .unwrap();
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Cancelled);
    assert!(keep.exists());
    let left = copies.iter().filter(|c| c.exists()).count();
    assert!(left >= 3, "stopped early ({left} left)");
}

#[test]
fn spec_json() {
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"dedupe","groups":[{"keep":{"path":"/a","kind":"file","size":1},"remove":[{"path":"/b","kind":"file","size":1,"modifiedMs":5}]}],"action":"move","targetDir":"/t","verify":"unchanged"}"#,
    )
    .unwrap();
    match spec {
        JobSpec::Dedupe {
            groups,
            action,
            target_dir,
            verify,
            allow_dangerous,
        } => {
            assert_eq!(groups[0].remove[0].modified_ms, Some(5));
            assert_eq!(action, DedupeAction::Move);
            assert_eq!(target_dir.as_deref(), Some("/t"));
            assert_eq!(verify, DedupeVerify::Unchanged);
            assert!(!allow_dangerous);
        }
        _ => panic!("not dedupe"),
    }
}
