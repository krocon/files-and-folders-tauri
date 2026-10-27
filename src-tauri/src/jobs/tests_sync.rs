//! Tests for the jobs of design 036: `compare` (streamed rows) and `sync` (folders,
//! copies in both directions, replacing only unchanged targets, deletes, every check).

use super::sync::{Seen, SyncAction, SyncOp, SyncSide};
use super::tests_engine::{Harness, no_temp_files, walk};
use super::*;
use crate::compare::{CompareOptions, CompareRow, CompareSide, CompareStatus};
use crate::error::FsErrorCode;
use crate::model::EntryKind;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime};
use tempfile::{TempDir, tempdir};

const T0: u64 = 1_700_000_000;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn write(path: &Path, content: &[u8], secs: u64) {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).unwrap();
    }
    let mut f = File::create(path).unwrap();
    f.write_all(content).unwrap();
    f.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(secs))
        .unwrap();
}

struct Pair {
    _d: TempDir,
    left: PathBuf,
    right: PathBuf,
}

fn pair() -> Pair {
    let d = tempdir().unwrap();
    let left = d.path().join("links ä");
    let right = d.path().join("rechts 🎉");
    fs::create_dir_all(&left).unwrap();
    fs::create_dir_all(&right).unwrap();
    Pair { _d: d, left, right }
}

fn opts() -> CompareOptions {
    CompareOptions {
        ignore_case: false,
        ..CompareOptions::default()
    }
}

impl Harness {
    fn compare(&self, p: &Pair, options: CompareOptions) -> (JobInfo, Vec<CompareRow>) {
        let id = self
            .mgr
            .start(JobSpec::Compare {
                left: s(&p.left),
                right: s(&p.right),
                options,
            })
            .unwrap();
        let info = self.finish(&id);
        let rows = self
            .events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                JobEvent::CompareRows { id: i, rows, .. } if *i == id => Some(rows.clone()),
                _ => None,
            })
            .flatten()
            .collect();
        (info, rows)
    }

    fn sync(&self, p: &Pair, ops: Vec<SyncOp>, mode: DeleteMode) -> Result<String, FsError> {
        self.mgr.start(JobSpec::Sync {
            left: s(&p.left),
            right: s(&p.right),
            ops,
            delete_mode: mode,
        })
    }
}

fn seen_of(side: &Option<CompareSide>) -> Option<Seen> {
    side.as_ref().map(|c| Seen {
        kind: c.kind,
        size: c.size,
        modified_ms: c.modified_ms,
    })
}

/// The op for a row: Rust names both paths, also the missing side.
fn op(_p: &Pair, row: &CompareRow, action: SyncAction) -> SyncOp {
    SyncOp {
        action,
        left: SyncSide {
            path: row.left_path.clone(),
            seen: seen_of(&row.left),
        },
        right: SyncSide {
            path: row.right_path.clone(),
            seen: seen_of(&row.right),
        },
    }
}

/// What the default "both directions" mode does (the frontend's `sync-logic.ts`).
fn default_ops(p: &Pair, rows: &[CompareRow]) -> Vec<SyncOp> {
    rows.iter()
        .filter_map(|r| match r.status {
            CompareStatus::LeftNewer | CompareStatus::OnlyLeft => {
                Some(op(p, r, SyncAction::CopyToRight))
            }
            CompareStatus::RightNewer | CompareStatus::OnlyRight => {
                Some(op(p, r, SyncAction::CopyToLeft))
            }
            _ => None,
        })
        .collect()
}

fn build(p: &Pair) {
    write(&p.left.join("same.txt"), b"same", T0);
    write(&p.right.join("same.txt"), b"same", T0);
    write(&p.left.join("neu links.txt"), b"L", T0);
    write(&p.right.join("nur rechts.txt"), b"R", T0);
    write(&p.left.join("geändert.txt"), b"new content", T0 + 100);
    write(&p.right.join("geändert.txt"), b"old", T0);
    write(&p.left.join("älter.txt"), b"old", T0);
    write(&p.right.join("älter.txt"), b"newer right", T0 + 100);
    write(&p.left.join("Unter ordner/tief/a 🎉.txt"), b"a", T0);
    write(&p.left.join("nur links/x/y.txt"), b"y", T0);
    fs::create_dir_all(p.left.join("leer links")).unwrap();
    write(&p.right.join("r/s/t.txt"), b"t", T0);
}

#[test]
fn compare_streams_rows_and_reports_stats() {
    let h = Harness::new();
    let p = pair();
    build(&p);
    let (info, rows) = h.compare(&p, opts());
    assert_eq!(info.state, JobState::Done);
    let stats = info.summary.unwrap().compare.unwrap();
    assert_eq!(stats.rows, rows.len() as u64);
    assert!(rows.iter().any(|r| r.rel == "Unter ordner/tief/a 🎉.txt"));
    let st = |rel: &str| rows.iter().find(|r| r.rel == rel).unwrap().status;
    assert_eq!(st("geändert.txt"), CompareStatus::LeftNewer);
    assert_eq!(st("älter.txt"), CompareStatus::RightNewer);
    assert_eq!(st("same.txt"), CompareStatus::Equal);
}

#[test]
fn sync_both_ways_then_compare_shows_only_equal() {
    let h = Harness::new();
    let p = pair();
    build(&p);
    let (_, rows) = h.compare(&p, opts());
    let ops = default_ops(&p, &rows);
    let id = h.sync(&p, ops, DeleteMode::Permanent).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        fs::read(p.right.join("geändert.txt")).unwrap(),
        b"new content"
    );
    assert_eq!(fs::read(p.left.join("älter.txt")).unwrap(), b"newer right");
    assert_eq!(
        fs::read(p.right.join("Unter ordner/tief/a 🎉.txt")).unwrap(),
        b"a"
    );
    assert!(p.right.join("leer links").is_dir());
    assert!(p.left.join("r/s/t.txt").is_file());
    assert!(p.left.join("nur rechts.txt").is_file());
    // times travel with the copies: a second comparison is all `=`
    let (_, rows) = h.compare(&p, opts());
    let diff: Vec<_> = rows
        .iter()
        .filter(|r| r.status != CompareStatus::Equal)
        .collect();
    assert!(diff.is_empty(), "{diff:?}");
    assert!(no_temp_files(&p.left) && no_temp_files(&p.right));
}

#[test]
fn mirror_deletes_the_extra_entries() {
    let h = Harness::new();
    let p = pair();
    build(&p);
    let (_, rows) = h.compare(&p, opts());
    let ops: Vec<SyncOp> = rows
        .iter()
        .filter_map(|r| match r.status {
            // the folder and everything in it: Rust deletes the folder whole only when every
            // entry inside is one of these deletes (review 036 #1)
            CompareStatus::OnlyRight => Some(op(&p, r, SyncAction::DeleteRight)),
            CompareStatus::Equal => None,
            _ => Some(op(&p, r, SyncAction::CopyToRight)),
        })
        .collect();
    let id = h.sync(&p, ops, DeleteMode::Permanent).unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert!(!p.right.join("nur rechts.txt").exists());
    assert!(!p.right.join("r").exists());
    assert_eq!(fs::read(p.right.join("älter.txt")).unwrap(), b"old");
    let (_, rows) = h.compare(&p, opts());
    assert!(rows.iter().all(|r| r.status == CompareStatus::Equal));
}

#[test]
fn a_target_changed_since_the_comparison_is_asked_about() {
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("a.txt"), b"left new", T0 + 100);
    write(&p.right.join("a.txt"), b"right", T0);
    let (_, rows) = h.compare(&p, opts());
    // someone edits the right file after the comparison
    write(&p.right.join("a.txt"), b"edited meanwhile", T0 + 50);
    let id = h
        .sync(&p, default_ops(&p, &rows), DeleteMode::Permanent)
        .unwrap();
    let c = h.conflict(&id);
    assert!(c.target.ends_with("a.txt"));
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Skip, false);
    h.finish(&id);
    assert_eq!(
        fs::read(p.right.join("a.txt")).unwrap(),
        b"edited meanwhile"
    );
}

#[test]
fn a_target_that_appeared_is_asked_about() {
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("a.txt"), b"left", T0);
    let (_, rows) = h.compare(&p, opts());
    write(&p.right.join("a.txt"), b"appeared", T0);
    let id = h
        .sync(&p, default_ops(&p, &rows), DeleteMode::Permanent)
        .unwrap();
    let c = h.conflict(&id);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Cancel, false);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    assert_eq!(fs::read(p.right.join("a.txt")).unwrap(), b"appeared");
}

#[test]
fn changed_sources_and_deletes_are_left_alone() {
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("copy me.txt"), b"x", T0);
    write(&p.right.join("delete me.txt"), b"y", T0);
    let (_, rows) = h.compare(&p, opts());
    let ops = vec![
        op(
            &p,
            rows.iter().find(|r| r.rel == "copy me.txt").unwrap(),
            SyncAction::CopyToRight,
        ),
        op(
            &p,
            rows.iter().find(|r| r.rel == "delete me.txt").unwrap(),
            SyncAction::DeleteRight,
        ),
    ];
    write(&p.left.join("copy me.txt"), b"changed", T0 + 9);
    write(&p.right.join("delete me.txt"), b"changed too", T0 + 9);
    let id = h.sync(&p, ops, DeleteMode::Permanent).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let s = info.summary.unwrap();
    assert_eq!(s.items_failed, 2);
    assert!(
        s.errors
            .iter()
            .all(|e| e.error.code == FsErrorCode::ChangedSinceListing)
    );
    assert!(!p.right.join("copy me.txt").exists());
    assert!(p.right.join("delete me.txt").exists());
}

#[test]
fn deletes_go_to_the_trash_by_default() {
    let h = Harness::new();
    let p = pair();
    write(&p.right.join("weg.txt"), b"y", T0);
    let (_, rows) = h.compare(&p, opts());
    let ops = vec![op(&p, &rows[0], SyncAction::DeleteRight)];
    let spec: JobSpec = serde_json::from_value(serde_json::json!({
        "kind": "sync",
        "left": s(&p.left),
        "right": s(&p.right),
        "ops": ops,
    }))
    .unwrap();
    let JobSpec::Sync { delete_mode, .. } = &spec else {
        panic!()
    };
    assert_eq!(*delete_mode, DeleteMode::Trash);
    let id = h.mgr.start(spec).unwrap();
    let info = h.finish(&id);
    // the container may have no trash: either it went there, or the job says so – never deleted silently
    if info.state == JobState::Done {
        assert!(!p.right.join("weg.txt").exists());
    } else {
        assert!(p.right.join("weg.txt").exists());
    }
}

#[test]
fn ops_outside_the_roots_or_elsewhere_are_refused() {
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("a.txt"), b"x", T0);
    write(&p.left.join("b.txt"), b"x", T0);
    let (_, rows) = h.compare(&p, opts());
    let good = op(&p, &rows[0], SyncAction::CopyToRight);
    let refuse = |ops: Vec<SyncOp>| {
        let e = h.sync(&p, ops, DeleteMode::Permanent).unwrap_err();
        assert_eq!(e.code, FsErrorCode::InvalidPath, "{e:?}");
    };
    // the root itself
    let mut o = good.clone();
    o.right.path = s(&p.right);
    refuse(vec![o]);
    // outside the right root
    let mut o = good.clone();
    o.right.path = s(&p.right.parent().unwrap().join("anderswo.txt"));
    refuse(vec![o]);
    // `..`
    let mut o = good.clone();
    o.right.path = format!("{}/x/../a.txt", s(&p.right));
    refuse(vec![o]);
    // another relative place
    let mut o = good.clone();
    o.right.path = s(&p.right.join("b.txt"));
    refuse(vec![o]);
    // twice the same path
    refuse(vec![good.clone(), good.clone()]);
    // nothing seen at the source
    let mut o = good.clone();
    o.left.seen = None;
    refuse(vec![o]);
    // nothing at all
    refuse(vec![]);
    assert!(!p.right.join("a.txt").exists());
}

#[test]
fn copies_into_a_deleted_folder_are_refused() {
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("d/x.txt"), b"x", T0);
    let (_, rows) = h.compare(&p, opts());
    let dir = rows.iter().find(|r| r.rel == "d").unwrap();
    let file = rows.iter().find(|r| r.rel == "d/x.txt").unwrap();
    let e = h
        .sync(
            &p,
            vec![
                op(&p, dir, SyncAction::DeleteLeft),
                op(&p, file, SyncAction::CopyToRight),
            ],
            DeleteMode::Permanent,
        )
        .unwrap_err();
    assert_eq!(e.code, FsErrorCode::InvalidPath);
    assert!(p.left.join("d/x.txt").exists());
}

#[cfg(unix)]
#[test]
fn never_writes_through_a_link_on_the_way() {
    use std::os::unix::fs::symlink;
    let h = Harness::new();
    let p = pair();
    let outside = p.left.parent().unwrap().join("draußen");
    fs::create_dir_all(&outside).unwrap();
    write(&p.left.join("sub/x.txt"), b"x", T0);
    let (_, rows) = h.compare(&p, opts());
    let ops = default_ops(&p, &rows)
        .into_iter()
        .filter(|o| o.left.path.ends_with("x.txt"))
        .collect::<Vec<_>>();
    // after the comparison, `right/sub` becomes a link to a folder outside
    symlink(&outside, p.right.join("sub")).unwrap();
    let id = h.sync(&p, ops, DeleteMode::Permanent).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert!(!outside.join("x.txt").exists(), "{:?}", walk(&outside));
}

#[test]
fn danger_paths_are_refused_for_deletes() {
    let h = Harness::new();
    let e = h
        .mgr
        .start(JobSpec::Sync {
            left: "/usr".into(),
            right: "/nowhere-fnf".into(),
            ops: vec![SyncOp {
                action: SyncAction::DeleteLeft,
                left: SyncSide {
                    path: "/usr/bin".into(),
                    seen: Some(Seen {
                        kind: EntryKind::Directory,
                        size: None,
                        modified_ms: None,
                    }),
                },
                right: SyncSide {
                    path: "/nowhere-fnf/bin".into(),
                    seen: None,
                },
            }],
            delete_mode: DeleteMode::Permanent,
        })
        .unwrap_err();
    assert_eq!(e.code, FsErrorCode::DangerousPath, "{e:?}");
}

#[test]
fn cancel_while_copying_leaves_no_partial_file() {
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("gross.bin"), &vec![1u8; 64 * 1024 * 1024], T0);
    let (_, rows) = h.compare(&p, opts());
    let id = h
        .sync(&p, default_ops(&p, &rows), DeleteMode::Permanent)
        .unwrap();
    h.mgr.pause(&id);
    thread::sleep(Duration::from_millis(50));
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Cancelled);
    assert!(!p.right.join("gross.bin").exists());
    assert!(no_temp_files(&p.right), "{:?}", walk(&p.right));
}

#[test]
fn cancel_while_comparing() {
    let h = Harness::new();
    let p = pair();
    for i in 0..2000 {
        write(&p.left.join(format!("d{}/f{i}", i % 20)), b"x", T0);
    }
    let id = h
        .mgr
        .start(JobSpec::Compare {
            left: s(&p.left),
            right: s(&p.right),
            options: opts(),
        })
        .unwrap();
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert!(matches!(info.state, JobState::Cancelled | JobState::Done));
}

#[test]
fn compare_and_sync_refuse_servers() {
    let h = Harness::new();
    let e = h
        .mgr
        .start(JobSpec::Compare {
            left: "remote://p1/home".into(),
            right: "/tmp".into(),
            options: opts(),
        })
        .unwrap_err();
    assert_eq!(e.code, FsErrorCode::RemoteUnsupported);
}

#[test]
fn wire_format() {
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"compare","left":"/a","right":"/b","options":{"content":true,"toleranceSecs":0}}"#,
    )
    .unwrap();
    assert!(spec.is_parallel() && spec.is_helper());
    let JobSpec::Compare { options, .. } = spec else {
        panic!()
    };
    assert!(options.content && options.recursive);
    assert_eq!(options.tolerance_secs, 0);
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"sync","left":"/a","right":"/b","deleteMode":"permanent","ops":[{"action":"deleteRight","left":{"path":"/a/x"},"right":{"path":"/b/x","seen":{"kind":"file","size":1,"modifiedMs":5}}}]}"#,
    )
    .unwrap();
    assert_eq!(spec.kind(), "sync");
    assert!(!spec.is_parallel() && !spec.is_helper());
    assert_eq!(spec.changed_paths(), vec![PathBuf::from("/b/x")]);
    let e = serde_json::to_value(JobEvent::CompareRows {
        id: "j".into(),
        rows: vec![],
        stats: Default::default(),
    })
    .unwrap();
    assert_eq!(e["type"], "compareRows");
    assert_eq!(e["stats"]["differences"], 0);
}

fn mirror_ops(p: &Pair, rows: &[CompareRow]) -> Vec<SyncOp> {
    rows.iter()
        .filter_map(|r| match r.status {
            CompareStatus::OnlyRight => Some(op(p, r, SyncAction::DeleteRight)),
            CompareStatus::Equal => None,
            _ => Some(op(p, r, SyncAction::CopyToRight)),
        })
        .collect()
}

#[test]
fn a_folder_with_unseen_content_is_not_deleted_whole() {
    // review 036 #1: `.git` is excluded by default, a hidden file is not shown
    let h = Harness::new();
    let p = pair();
    write(&p.right.join("proj/a.txt"), b"a", T0);
    write(&p.right.join("proj/.git/HEAD"), b"ref", T0);
    write(&p.right.join("proj/.hidden"), b"h", T0);
    write(&p.right.join("weg/x.txt"), b"x", T0);
    let (_, rows) = h.compare(&p, opts());
    assert!(!rows.iter().find(|r| r.rel == "proj").unwrap().complete);
    assert!(rows.iter().find(|r| r.rel == "weg").unwrap().complete);
    let id = h
        .sync(&p, mirror_ops(&p, &rows), DeleteMode::Permanent)
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert!(!p.right.join("proj/a.txt").exists(), "listed entries go");
    assert!(
        p.right.join("proj/.git/HEAD").exists(),
        "unseen entries stay"
    );
    assert!(p.right.join("proj/.hidden").exists());
    assert!(
        !p.right.join("weg").exists(),
        "a fully seen folder goes whole"
    );
}

#[test]
fn a_file_added_to_a_folder_after_the_comparison_keeps_it() {
    let h = Harness::new();
    let p = pair();
    write(&p.right.join("weg/x.txt"), b"x", T0);
    let (_, rows) = h.compare(&p, opts());
    write(&p.right.join("weg/neu.txt"), b"new", T0);
    let id = h
        .sync(&p, mirror_ops(&p, &rows), DeleteMode::Permanent)
        .unwrap();
    h.finish(&id);
    assert!(p.right.join("weg/neu.txt").exists());
    assert!(!p.right.join("weg/x.txt").exists());
}

#[cfg(unix)]
#[test]
fn roots_nested_through_a_link_are_refused() {
    // review 036 #3
    use std::os::unix::fs::symlink;
    let h = Harness::new();
    let d = tempdir().unwrap();
    let left = d.path().join("L");
    fs::create_dir_all(left.join("S")).unwrap();
    let right = d.path().join("R");
    symlink(left.join("S"), &right).unwrap();
    let e = h
        .mgr
        .start(JobSpec::Compare {
            left: s(&left),
            right: s(&right),
            options: opts(),
        })
        .unwrap();
    let info = h.finish(&e);
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::TargetInsideSource
    );
    // and the sync job checks the same, even with lexically fine ops
    write(&left.join("a.txt"), b"a", T0);
    let id = h
        .mgr
        .start(JobSpec::Sync {
            left: s(&left),
            right: s(&right),
            ops: vec![SyncOp {
                action: SyncAction::CopyToRight,
                left: SyncSide {
                    path: s(&left.join("a.txt")),
                    seen: Some(Seen {
                        kind: EntryKind::File,
                        size: Some(1),
                        modified_ms: Some((T0 * 1000) as i64),
                    }),
                },
                right: SyncSide {
                    path: s(&right.join("a.txt")),
                    seen: None,
                },
            }],
            delete_mode: DeleteMode::Permanent,
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Failed);
    assert!(!left.join("S/a.txt").exists());
}

#[test]
fn nfc_and_nfd_names_on_one_side_stay_two_rows() {
    // review 036 #4 (Linux keeps both forms as two files)
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("\u{e9}.txt"), b"nfc", T0);
    write(&p.left.join("e\u{301}.txt"), b"nfd", T0);
    write(&p.right.join("e\u{301}.txt"), b"nfd", T0);
    let (_, rows) = h.compare(&p, opts());
    if fs::read_dir(&p.left).unwrap().count() == 2 {
        assert_eq!(rows.len(), 2, "{rows:?}");
        let both = rows
            .iter()
            .find(|r| r.left.is_some() && r.right.is_some())
            .unwrap();
        assert_eq!(both.left.as_ref().unwrap().name, "e\u{301}.txt");
        assert_eq!(both.status, CompareStatus::Equal);
    }
}

#[cfg(unix)]
#[test]
fn a_delete_of_a_file_the_job_also_copies_is_refused() {
    // review 036 #5: another name of the same file (hard link = like a case-insensitive target)
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("Readme.md"), b"new", T0 + 100);
    write(&p.right.join("Readme.md"), b"old", T0);
    fs::hard_link(p.right.join("Readme.md"), p.right.join("README.md")).unwrap();
    let (_, rows) = h.compare(&p, opts());
    let ops = mirror_ops(&p, &rows);
    assert!(ops.iter().any(|o| o.action == SyncAction::DeleteRight));
    let id = h.sync(&p, ops, DeleteMode::Permanent).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert!(
        p.right.join("README.md").exists(),
        "not deleted: the copy wrote it"
    );
}

#[test]
fn overwrite_for_all_does_not_cover_a_target_changed_since_the_comparison() {
    // review 036 #7
    let h = Harness::new();
    let p = pair();
    write(&p.left.join("a.txt"), b"left a", T0 + 100);
    write(&p.left.join("b.txt"), b"left b", T0 + 100);
    write(&p.right.join("b.txt"), b"right b", T0);
    let (_, rows) = h.compare(&p, opts());
    write(&p.right.join("a.txt"), b"appeared", T0); // a conflict: answer "overwrite all"
    write(&p.right.join("b.txt"), b"edited", T0 + 50); // changed since the comparison
    let id = h
        .sync(&p, default_ops(&p, &rows), DeleteMode::Permanent)
        .unwrap();
    let c = h.conflict(&id);
    assert!(c.target.ends_with("a.txt"));
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Overwrite, true);
    let c2 = h.conflict(&id);
    assert!(c2.target.ends_with("b.txt"), "asked again");
    h.mgr
        .resolve_conflict(&id, c2.conflict_id, Decision::Skip, false);
    h.finish(&id);
    assert_eq!(fs::read(p.right.join("a.txt")).unwrap(), b"left a");
    assert_eq!(fs::read(p.right.join("b.txt")).unwrap(), b"edited");
}
