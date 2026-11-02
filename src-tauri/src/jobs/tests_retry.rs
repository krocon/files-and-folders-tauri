//! Retry of failed tasks (design 048): real copies and moves in temp folders, driven
//! through the JobManager; the plans of list jobs as pure checks of `retry::build`.

use super::retry::{self, Noted, RetryExtra};
use super::tests_engine::{Harness, no_temp_files};
use super::*;
use crate::error::FsErrorCode;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn info(h: &Harness, id: &str) -> JobInfo {
    h.mgr.list().into_iter().find(|j| j.id == id).unwrap()
}

fn start_move(h: &Harness, sources: &[&Path], target: &Path) -> String {
    h.mgr
        .start(JobSpec::Move {
            sources: sources.iter().map(|p| s(p)).collect(),
            target_dir: s(target),
            background: false,
            options: CopyOptions::default(),
            allow_dangerous: false,
            expected: Vec::new(),
        })
        .unwrap()
}

fn start_copy(h: &Harness, sources: &[&Path], target: &Path) -> String {
    h.mgr
        .start(JobSpec::Copy {
            sources: sources.iter().map(|p| s(p)).collect(),
            target_dir: s(target),
            background: false,
            options: CopyOptions::default(),
        })
        .unwrap()
}

fn conflicts_of(h: &Harness, id: &str) -> usize {
    h.count(|e| matches!(e, JobEvent::Conflict { id: j, .. } if j == id))
}

/// Marc's screenshot (acceptance 1): a move of three sources into a folder, one deep
/// file fails (here: a folder blocks its name). The retry moves only that file into
/// its exact sub folder and removes the emptied source folders up to the source.
fn deep_move(force_copy: bool) {
    let h = Harness::new();
    h.mgr.force_copy_on_move.store(force_copy, Ordering::SeqCst);
    let d = tempdir().unwrap();
    let src = d.path().join("__todo");
    let a = src.join("Andreas Franz");
    let deep = a.join("Julia Durant 19 – Der Panther").join("ungekürzt");
    fs::create_dir_all(&deep).unwrap();
    fs::write(deep.join("Der Panther - 081.mp3"), "81").unwrap();
    fs::write(deep.join("Der Panther - 082.mp3"), "82").unwrap();
    fs::write(a.join("cover.jpg"), "jpg").unwrap();
    let c = src.join("Christie 📚");
    fs::create_dir_all(&c).unwrap();
    fs::write(c.join("x.mp3"), "x").unwrap();
    let single = src.join("einzeln.txt");
    fs::write(&single, "e").unwrap();
    let target = d.path().join("_todo_hoerbuch");
    let blocked = target
        .join("Andreas Franz")
        .join("Julia Durant 19 – Der Panther")
        .join("ungekürzt")
        .join("Der Panther - 082.mp3");
    fs::create_dir_all(&blocked).unwrap();

    let id = start_move(&h, &[&a, &c, &single], &target);
    let first = h.finish(&id);
    assert_eq!(first.state, JobState::DoneWithErrors);
    assert_eq!(first.summary.as_ref().unwrap().items_failed, 1);
    assert!(info(&h, &id).retry_available);
    assert!(
        h.count(|e| matches!(
            e,
            JobEvent::RetryAvailable {
                available: true,
                ..
            }
        )) >= 1
    );
    assert!(!c.exists() && !single.exists(), "the other sources moved");
    assert!(deep.join("Der Panther - 082.mp3").is_file());

    // the cause is gone (the network is back)
    fs::remove_dir(&blocked).unwrap();
    let rid = h.mgr.retry_job(&id).unwrap();
    let again = h.finish(&rid);
    assert_eq!(again.state, JobState::Done, "{:?}", again.summary);
    let JobSpec::Move { sources, .. } = &again.spec else {
        panic!("a move")
    };
    assert_eq!(sources, &vec![s(&deep.join("Der Panther - 082.mp3"))]);
    assert_eq!(
        fs::read_to_string(&blocked).unwrap(),
        "82",
        "exact sub folder"
    );
    assert!(
        !target.join("Der Panther - 082.mp3").exists(),
        "never flat into the target"
    );
    assert!(!a.exists(), "emptied source folders are gone");
    assert!(src.is_dir(), "the folder of the sources stays");
    assert_eq!(
        fs::read_to_string(target.join("Christie 📚/x.mp3")).unwrap(),
        "x"
    );
    assert!(no_temp_files(d.path()));
    // E1: the old row stays, without retry; a second retry is refused
    assert!(!info(&h, &id).retry_available);
    let e = h.mgr.retry_job(&id).unwrap_err();
    assert_eq!(e.code, FsErrorCode::RetryUnavailable);
    assert!(!info(&h, &rid).retry_available, "nothing left to retry");
}

#[test]
fn move_retry_puts_deep_files_into_their_exact_sub_folder_copy_and_delete() {
    deep_move(true);
}

#[test]
fn move_retry_puts_deep_files_into_their_exact_sub_folder_rename() {
    deep_move(false);
}

/// Acceptance 2 + 3: a copy with one done, one skipped (conflict → skip) and one failed
/// file retries only the failed one – no conflict question, the skipped file is untouched.
#[test]
fn copy_retry_copies_only_the_failed_file_never_the_skipped_or_done_ones() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let src = d.path().join("Quelle");
    fs::create_dir(&src).unwrap();
    fs::write(src.join("a skip.txt"), "new a").unwrap();
    fs::write(src.join("b fail.txt"), "b").unwrap();
    fs::write(src.join("c done.txt"), "c").unwrap();
    let target = d.path().join("Ziel");
    fs::create_dir_all(target.join("Quelle/b fail.txt")).unwrap(); // blocks b
    fs::write(target.join("Quelle/a skip.txt"), "old a").unwrap();

    let id = start_copy(&h, &[&src], &target);
    let c = h.conflict(&id);
    assert!(c.target.ends_with("a skip.txt"));
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Skip, false);
    let first = h.finish(&id);
    assert_eq!(first.state, JobState::DoneWithErrors);
    let sum = first.summary.unwrap();
    assert_eq!((sum.items_skipped, sum.items_failed), (1, 1));

    fs::remove_dir(target.join("Quelle/b fail.txt")).unwrap();
    let rid = h.mgr.retry_job(&id).unwrap();
    let again = h.finish(&rid);
    assert_eq!(again.state, JobState::Done, "{:?}", again.summary);
    assert_eq!(again.summary.unwrap().items_done, 1, "only the failed file");
    assert_eq!(
        conflicts_of(&h, &rid),
        0,
        "no question for done or skipped files"
    );
    assert_eq!(
        fs::read_to_string(target.join("Quelle/b fail.txt")).unwrap(),
        "b"
    );
    assert_eq!(
        fs::read_to_string(target.join("Quelle/a skip.txt")).unwrap(),
        "old a"
    );
    assert!(src.join("b fail.txt").is_file(), "a copy keeps its source");
}

/// Acceptance 4: a target folder that could not be created – the retry brings the
/// whole folder with its content.
#[test]
fn copy_retry_brings_a_whole_folder_that_could_not_be_created() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let src = d.path().join("A");
    fs::create_dir_all(src.join("sub/tief")).unwrap();
    fs::write(src.join("sub/k.txt"), "k").unwrap();
    fs::write(src.join("sub/tief/l.txt"), "l").unwrap();
    fs::write(src.join("ok.txt"), "ok").unwrap();
    let target = d.path().join("T");
    fs::create_dir_all(target.join("A")).unwrap();
    fs::write(target.join("A/sub"), "a file blocks the folder").unwrap();

    let id = start_copy(&h, &[&src], &target);
    let first = h.finish(&id);
    assert_eq!(first.state, JobState::DoneWithErrors);
    fs::remove_file(target.join("A/sub")).unwrap();
    let rid = h.mgr.retry_job(&id).unwrap();
    let again = h.finish(&rid);
    assert_eq!(again.state, JobState::Done, "{:?}", again.summary);
    assert_eq!(fs::read_to_string(target.join("A/sub/k.txt")).unwrap(), "k");
    assert_eq!(
        fs::read_to_string(target.join("A/sub/tief/l.txt")).unwrap(),
        "l"
    );
    assert_eq!(conflicts_of(&h, &rid), 0, "ok.txt is not copied again");
}

/// Acceptance 5: a task that failed as a whole runs again as it was.
#[test]
fn a_failed_task_is_retried_as_a_whole() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let src = d.path().join("f.txt");
    fs::write(&src, "f").unwrap();
    let target = d.path().join("NAS nicht da");
    let id = start_copy(&h, &[&src], &target);
    let first = h.finish(&id);
    assert_eq!(first.state, JobState::Failed);
    assert!(info(&h, &id).retry_available);
    fs::create_dir(&target).unwrap(); // mounted now
    let rid = h.mgr.retry_job(&id).unwrap();
    let again = h.finish(&rid);
    assert_eq!(again.state, JobState::Done);
    assert_eq!(again.spec, first.spec, "the same task");
    assert_eq!(fs::read_to_string(target.join("f.txt")).unwrap(), "f");
}

#[test]
fn done_and_cancelled_tasks_offer_no_retry() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let src = d.path().join("f.txt");
    fs::write(&src, "f").unwrap();
    let target = d.path().join("T");
    fs::create_dir(&target).unwrap();
    let id = start_copy(&h, &[&src], &target);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert!(!info(&h, &id).retry_available);
    assert_eq!(
        h.mgr.retry_job(&id).unwrap_err().code,
        FsErrorCode::RetryUnavailable
    );
    let plan = retry::build(
        &info(&h, &id).spec,
        JobState::Cancelled,
        &Summary::default(),
        Noted::default(),
    );
    assert!(plan.is_none(), "E2: no retry after cancel");
}

/// A move retry never moves an entry that replaced the failed one meanwhile.
#[cfg(unix)]
#[test]
fn move_retry_leaves_a_replaced_source_alone() {
    let h = Harness::new();
    h.mgr.force_copy_on_move.store(true, Ordering::SeqCst);
    let d = tempdir().unwrap();
    let src = d.path().join("S");
    fs::create_dir_all(src.join("sub")).unwrap();
    fs::write(src.join("sub/f.txt"), "old").unwrap();
    let target = d.path().join("T");
    fs::create_dir_all(target.join("S/sub/f.txt")).unwrap();
    let id = start_move(&h, &[&src], &target);
    assert_eq!(h.finish(&id).state, JobState::DoneWithErrors);
    // another file takes the name (new inode)
    fs::write(d.path().join("other"), "someone else's").unwrap();
    fs::rename(d.path().join("other"), src.join("sub/f.txt")).unwrap();
    fs::remove_dir(target.join("S/sub/f.txt")).unwrap();
    let rid = h.mgr.retry_job(&id).unwrap();
    let again = h.finish(&rid);
    assert_eq!(again.state, JobState::DoneWithErrors);
    assert_eq!(
        fs::read_to_string(src.join("sub/f.txt")).unwrap(),
        "someone else's",
        "left in place"
    );
    assert!(!target.join("S/sub/f.txt").exists());
    assert!(src.join("sub").is_dir(), "its folder stays");
    assert!(
        !info(&h, &rid).retry_available,
        "a changed entry is never retried"
    );
}

/// A move whose copy arrived but whose source could not be removed: the retry only
/// removes the source (no conflict about its own copy).
#[cfg(unix)]
#[test]
fn move_retry_removes_the_source_of_an_arrived_copy() {
    use std::os::unix::fs::PermissionsExt;
    if unsafe { libc::geteuid() } == 0 {
        return; // root ignores the missing write permission
    }
    let h = Harness::new();
    h.mgr.force_copy_on_move.store(true, Ordering::SeqCst);
    let d = tempdir().unwrap();
    let src = d.path().join("S");
    let locked = src.join("gesperrt");
    fs::create_dir_all(&locked).unwrap();
    fs::write(locked.join("f.txt"), "f").unwrap();
    let target = d.path().join("T");
    fs::create_dir(&target).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
    let id = start_move(&h, &[&src], &target);
    let first = h.finish(&id);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(first.state, JobState::DoneWithErrors, "{:?}", first.summary);
    assert!(
        target.join("S/gesperrt/f.txt").is_file(),
        "the copy arrived"
    );
    let rid = h.mgr.retry_job(&id).unwrap();
    let again = h.finish(&rid);
    assert_eq!(again.state, JobState::Done, "{:?}", again.summary);
    assert_eq!(conflicts_of(&h, &rid), 0);
    assert!(!src.exists(), "source and its emptied folders are gone");
    assert_eq!(
        fs::read_to_string(target.join("S/gesperrt/f.txt")).unwrap(),
        "f"
    );
}

#[test]
fn clear_finished_forgets_the_retry() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let id = start_copy(&h, &[&d.path().join("x")], &d.path().join("missing"));
    assert_eq!(h.finish(&id).state, JobState::Failed);
    h.mgr.clear_finished();
    assert_eq!(
        h.mgr.retry_job(&id).unwrap_err().code,
        FsErrorCode::RetryUnavailable
    );
}

fn err(path: &Path, code: FsErrorCode) -> ItemError {
    ItemError {
        path: s(path),
        error: crate::error::FsError::new(code, "x", Some(path)),
    }
}

fn with_errors(errors: Vec<ItemError>) -> Summary {
    Summary {
        items_failed: errors.len() as u64,
        errors,
        ..Summary::default()
    }
}

/// Permanent delete: only the failed entries, then the emptied folders up to the
/// selection – a foreign file put into such a folder keeps it (and itself) alive.
#[test]
fn delete_retry_removes_failed_entries_and_only_emptied_folders() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let sel = d.path().join("Auswahl");
    let deep = sel.join("a/b");
    fs::create_dir_all(&deep).unwrap();
    fs::write(deep.join("x.bin"), "x").unwrap();
    let other = d.path().join("Zweite");
    fs::create_dir_all(other.join("c")).unwrap();
    fs::write(other.join("c/y.bin"), "y").unwrap();
    let spec = JobSpec::Delete {
        paths: vec![s(&sel), s(&other)],
        mode: DeleteMode::Permanent,
        background: false,
        allow_dangerous: false,
        expected: Vec::new(),
    };
    let summary = with_errors(vec![
        err(&deep.join("x.bin"), FsErrorCode::TimedOut),
        err(&other.join("c/y.bin"), FsErrorCode::PermissionDenied),
        err(&d.path().join("gone"), FsErrorCode::NotFound),
    ]);
    let plan = retry::build(&spec, JobState::DoneWithErrors, &summary, Noted::default()).unwrap();
    let JobSpec::Delete {
        paths, expected, ..
    } = &plan.spec
    else {
        panic!()
    };
    assert_eq!(
        paths,
        &vec![s(&deep.join("x.bin")), s(&other.join("c/y.bin"))]
    );
    assert_eq!(expected.len(), 2, "a snapshot of what is there now");
    let Some(RetryExtra::Cleanup { dirs }) = plan.extra.as_deref() else {
        panic!("cleanup")
    };
    assert_eq!(dirs.len(), 5, "a/b, a, Auswahl, c, Zweite");
    // someone puts a file into `Zweite` before the retry runs
    fs::write(other.join("fremd.txt"), "nicht meins").unwrap();
    let id = h
        .mgr
        .start(JobSpec::Simulate {
            items: 0,
            item_ms: 0,
        })
        .unwrap();
    h.finish(&id);
    h.mgr.remember_retry_for_tests(&id, plan);
    let rid = h.mgr.retry_job(&id).unwrap();
    assert_eq!(h.finish(&rid).state, JobState::Done);
    assert!(!sel.exists(), "emptied up to the selection");
    assert!(!other.join("c").exists());
    assert_eq!(
        fs::read_to_string(other.join("fremd.txt")).unwrap(),
        "nicht meins"
    );
}

/// A delete retry leaves a file alone that changed after the first run.
#[test]
fn delete_retry_leaves_a_file_alone_that_changed_since() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let f = d.path().join("f.txt");
    fs::write(&f, "1").unwrap();
    let spec = JobSpec::Delete {
        paths: vec![s(&f)],
        mode: DeleteMode::Trash,
        background: false,
        allow_dangerous: false,
        expected: Vec::new(),
    };
    let summary = with_errors(vec![err(&f, FsErrorCode::TrashFailed)]);
    let plan = retry::build(&spec, JobState::DoneWithErrors, &summary, Noted::default()).unwrap();
    fs::write(&f, "changed content").unwrap();
    let id = h
        .mgr
        .start(JobSpec::Simulate {
            items: 0,
            item_ms: 0,
        })
        .unwrap();
    h.finish(&id);
    h.mgr.remember_retry_for_tests(&id, plan);
    let rid = h.mgr.retry_job(&id).unwrap();
    let done = h.finish(&rid);
    assert_eq!(done.state, JobState::DoneWithErrors);
    assert_eq!(
        done.summary.unwrap().errors[0].error.code,
        FsErrorCode::ChangedSinceListing
    );
    assert!(f.exists());
}

#[test]
fn list_jobs_retry_only_their_failed_items() {
    let d = Path::new("/d");
    // rename: the failed item
    let spec = JobSpec::Rename {
        items: vec![
            RenameItem {
                path: "/d/a".into(),
                new_name: "A".into(),
                expect: None,
            },
            RenameItem {
                path: "/d/b".into(),
                new_name: "B".into(),
                expect: None,
            },
        ],
        undo_of: None,
    };
    let sum = with_errors(vec![err(&d.join("b"), FsErrorCode::PermissionDenied)]);
    let plan = retry::build(&spec, JobState::DoneWithErrors, &sum, Noted::default()).unwrap();
    let JobSpec::Rename { items, .. } = &plan.spec else {
        panic!()
    };
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].path, "/d/b");
    // a cut error list: no partial retry (entries would be lost silently)
    let mut cut = sum.clone();
    cut.items_failed = 1001;
    assert!(retry::build(&spec, JobState::DoneWithErrors, &cut, Noted::default()).is_none());
    // only "changed" errors: nothing to retry
    let changed = with_errors(vec![err(&d.join("b"), FsErrorCode::NotFound)]);
    assert!(retry::build(&spec, JobState::DoneWithErrors, &changed, Noted::default()).is_none());

    // group: an error at the target path counts for its item
    let spec = JobSpec::Group {
        root: "/r".into(),
        subdir: None,
        items: vec![
            GroupItem {
                path: "/d/x 01.mp3".into(),
                group: "x".into(),
            },
            GroupItem {
                path: "/d/y 01.mp3".into(),
                group: "y".into(),
            },
        ],
        transfer: Transfer::Move,
        options: CopyOptions::default(),
    };
    let sum = with_errors(vec![err(Path::new("/r/y/y 01.mp3"), FsErrorCode::TimedOut)]);
    let plan = retry::build(&spec, JobState::DoneWithErrors, &sum, Noted::default()).unwrap();
    let JobSpec::Group { items, .. } = &plan.spec else {
        panic!()
    };
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].group, "y");

    // link: the failed source; the new name only stays for a single source
    let spec = JobSpec::Link {
        sources: vec!["/d/a".into(), "/d/b".into()],
        target_dir: "/t".into(),
        options: LinkOptions::default(),
    };
    let sum = with_errors(vec![err(&d.join("a"), FsErrorCode::AlreadyExists)]);
    let plan = retry::build(&spec, JobState::DoneWithErrors, &sum, Noted::default()).unwrap();
    assert!(
        matches!(&plan.spec, JobSpec::Link { sources, .. } if sources == &vec!["/d/a".to_string()])
    );

    // attributes / checksums: the failed paths below the selection
    let spec = JobSpec::Attributes {
        paths: vec!["/d".into()],
        change: crate::attributes::AttrChange::default(),
        recursive: true,
        apply_to: crate::attributes::ApplyTo::default(),
    };
    let sum = with_errors(vec![
        err(Path::new("/d/s/1"), FsErrorCode::PermissionDenied),
        err(Path::new("/d/s"), FsErrorCode::PermissionDenied),
    ]);
    let plan = retry::build(&spec, JobState::DoneWithErrors, &sum, Noted::default()).unwrap();
    assert!(
        matches!(&plan.spec, JobSpec::Attributes { paths, .. } if paths == &vec!["/d/s".to_string()])
    );

    // a whole-archive job runs again as it was
    let spec = JobSpec::ArchiveDelete {
        paths: vec!["/d/a.zip/x".into()],
    };
    let plan = retry::build(&spec, JobState::DoneWithErrors, &sum, Noted::default()).unwrap();
    assert_eq!(plan.spec, spec);
    // helper jobs never
    let spec = JobSpec::Count {
        paths: vec!["/d".into()],
    };
    assert!(retry::build(&spec, JobState::Failed, &sum, Noted::default()).is_none());
}

#[test]
fn dedupe_retry_keeps_the_kept_file_and_only_failed_copies() {
    let e = |p: &str| super::expect::ExpectedEntry {
        path: p.into(),
        kind: crate::model::EntryKind::File,
        size: Some(1),
        modified_ms: Some(1),
    };
    let spec = JobSpec::Dedupe {
        groups: vec![
            dedupe::DedupeGroup {
                keep: e("/d/keep"),
                remove: vec![e("/d/c1"), e("/d/c2")],
            },
            dedupe::DedupeGroup {
                keep: e("/d/k2"),
                remove: vec![e("/d/c3")],
            },
        ],
        action: dedupe::DedupeAction::Trash,
        target_dir: None,
        verify: dedupe::DedupeVerify::default(),
        threshold: None,
        allow_dangerous: false,
    };
    let sum = with_errors(vec![
        err(Path::new("/d/c2"), FsErrorCode::TrashFailed),
        err(Path::new("/d/c3"), FsErrorCode::DuplicateChanged),
    ]);
    let plan = retry::build(&spec, JobState::DoneWithErrors, &sum, Noted::default()).unwrap();
    let JobSpec::Dedupe { groups, .. } = &plan.spec else {
        panic!()
    };
    assert_eq!(groups.len(), 1, "a changed copy is never retried");
    assert_eq!(groups[0].keep.path, "/d/keep");
    assert_eq!(groups[0].remove.len(), 1);
    assert_eq!(groups[0].remove[0].path, "/d/c2");
}

#[test]
fn the_retry_log_is_bounded() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let mut ids = Vec::new();
    for _ in 0..retry::RETRY_LOG_SIZE + 1 {
        let id = start_copy(&h, &[&d.path().join("x")], &d.path().join("missing"));
        h.finish(&id);
        ids.push(id);
    }
    assert!(!info(&h, &ids[0]).retry_available, "the oldest dropped out");
    assert!(info(&h, ids.last().unwrap()).retry_available);
    let _ = PathBuf::new();
}
