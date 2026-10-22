//! Tests for the jobs of design 008: group files (copy/move into group folders)
//! and clean folders (delete what the scan listed, checked again).

use super::tests_engine::Harness;
use super::*;
use crate::clean::{CleanKind, find_empty_dirs};
use crate::error::FsErrorCode;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn items(src: &Path, pairs: &[(&str, &str)]) -> Vec<GroupItem> {
    pairs
        .iter()
        .map(|(name, group)| GroupItem {
            path: s(&src.join(name)),
            group: group.to_string(),
        })
        .collect()
}

impl Harness {
    fn group(&self, root: &Path, items: Vec<GroupItem>, transfer: Transfer) -> String {
        self.mgr
            .start(JobSpec::Group {
                root: s(root),
                items,
                transfer,
                options: CopyOptions::default(),
            })
            .unwrap()
    }

    fn clean(
        &self,
        roots: &[PathBuf],
        scan_items: Vec<crate::clean::CleanItem>,
        o: CleanOptions,
    ) -> String {
        self.mgr
            .start(JobSpec::Clean {
                roots: roots.iter().map(|r| s(r)).collect(),
                items: scan_items,
                mode: DeleteMode::Permanent,
                options: o,
            })
            .unwrap()
    }
}

fn music() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let d = tempdir().unwrap();
    let src = d.path().join("Quelle ä");
    let dst = d.path().join("Ziel");
    fs::create_dir_all(&src).unwrap();
    fs::create_dir_all(&dst).unwrap();
    for n in [
        "Band - Titel 01.mp3",
        "Band - Titel 02.mp3",
        "Über alles 01.mp3",
        "Über alles 02.mp3",
    ] {
        fs::write(src.join(n), n).unwrap();
    }
    (d, src, dst)
}

#[test]
fn group_copy_and_move_into_new_and_existing_group_folders() {
    let h = Harness::new();
    let (_d, src, dst) = music();
    fs::create_dir(dst.join("Über alles")).unwrap(); // exists: merged into
    fs::write(dst.join("Über alles/bleibt.txt"), "x").unwrap();
    let pairs = [
        ("Band - Titel 01.mp3", "Band - Titel"),
        ("Band - Titel 02.mp3", "Band - Titel"),
        ("Über alles 01.mp3", "Über alles"),
        ("Über alles 02.mp3", "Über alles"),
    ];
    let id = h.group(&dst, items(&src, &pairs), Transfer::Copy);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        fs::read_to_string(dst.join("Band - Titel/Band - Titel 02.mp3")).unwrap(),
        "Band - Titel 02.mp3"
    );
    assert!(dst.join("Über alles/Über alles 01.mp3").is_file());
    assert!(dst.join("Über alles/bleibt.txt").is_file());
    assert!(
        src.join("Band - Titel 01.mp3").is_file(),
        "copy keeps the source"
    );
    // move into the source folder itself; the conflict-free entries just move
    let id = h.group(&src, items(&src, &pairs), Transfer::Move);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(!src.join("Band - Titel 01.mp3").exists());
    assert!(src.join("Band - Titel/Band - Titel 01.mp3").is_file());
    assert!(src.join("Über alles/Über alles 02.mp3").is_file());
    // again: everything is in its group already – skipped, nothing happens
    let again = vec![GroupItem {
        path: s(&src.join("Über alles/Über alles 02.mp3")),
        group: "Über alles".into(),
    }];
    let id = h.group(&src, again, Transfer::Move);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(info.summary.unwrap().items_skipped, 1);
    assert!(src.join("Über alles/Über alles 02.mp3").is_file());
}

#[test]
fn group_conflicts_go_through_the_engine() {
    let h = Harness::new();
    let (_d, src, dst) = music();
    fs::create_dir(dst.join("Band - Titel")).unwrap();
    fs::write(dst.join("Band - Titel/Band - Titel 01.mp3"), "alt").unwrap();
    let pairs = [
        ("Band - Titel 01.mp3", "Band - Titel"),
        ("Band - Titel 02.mp3", "Band - Titel"),
    ];
    let id = h.group(&dst, items(&src, &pairs), Transfer::Move);
    let c = h.conflict(&id);
    assert_eq!(c.kind, ConflictKind::Exists);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Skip, false);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        fs::read_to_string(dst.join("Band - Titel/Band - Titel 01.mp3")).unwrap(),
        "alt"
    );
    assert!(
        src.join("Band - Titel 01.mp3").is_file(),
        "skipped: the source stays"
    );
    assert!(dst.join("Band - Titel/Band - Titel 02.mp3").is_file());
}

#[test]
fn group_errors_per_group_invalid_names_files_links_and_into_itself() {
    let h = Harness::new();
    let (_d, src, dst) = music();
    fs::write(dst.join("Datei"), "x").unwrap(); // a file with the group's name
    fs::create_dir(src.join("Band")).unwrap();
    #[cfg_attr(not(unix), allow(unused_mut))] // a link is added on Unix only
    let mut list = items(
        &src,
        &[
            ("Band - Titel 01.mp3", "a/b"),   // invalid group name
            ("Band - Titel 02.mp3", "Datei"), // name taken by a file
            ("Über alles 01.mp3", ".."),      // invalid
            ("Über alles 02.mp3", "Gut"),     // fine
        ],
    );
    #[cfg(unix)]
    {
        let outside = _d.path().join("draußen");
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, dst.join("Link")).unwrap();
        fs::write(src.join("über link.txt"), "x").unwrap();
        list.push(GroupItem {
            path: s(&src.join("über link.txt")),
            group: "Link".into(),
        });
    }
    let id = h.group(&dst, list, Transfer::Move);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let sum = info.summary.unwrap();
    assert_eq!(sum.items_done, 1);
    assert!(dst.join("Gut/Über alles 02.mp3").is_file());
    assert!(src.join("Band - Titel 01.mp3").is_file() && src.join("Band - Titel 02.mp3").is_file());
    assert!(fs::read_dir(_d.path().join("Ziel")).unwrap().count() >= 2);
    #[cfg(unix)]
    {
        assert_eq!(sum.items_failed, 4);
        assert!(
            src.join("über link.txt").is_file(),
            "never moved through a link"
        );
        assert_eq!(fs::read_dir(_d.path().join("draußen")).unwrap().count(), 0);
    }
    // a folder grouped into itself (source folder as root, group = its own name)
    let id = h.group(&src, items(&src, &[("Band", "Band")]), Transfer::Move);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert_eq!(
        info.summary.unwrap().errors[0].error.code,
        FsErrorCode::TargetInsideSource
    );
    assert!(src.join("Band").is_dir());
}

#[test]
fn group_refuses_dangerous_moves_and_empty_requests() {
    let h = Harness::new();
    let e = h
        .mgr
        .start(JobSpec::Group {
            root: "/tmp".into(),
            items: vec![],
            transfer: Transfer::Copy,
            options: CopyOptions::default(),
        })
        .unwrap_err();
    assert_eq!(e.code, FsErrorCode::InvalidPath);
    // the root of the system drive (`/`, Windows `C:\`) is never moved
    let d = tempdir().unwrap();
    let e = h
        .mgr
        .start(JobSpec::Group {
            root: s(d.path()),
            items: vec![GroupItem {
                path: s(&crate::test_paths::abs("/")),
                group: "x".into(),
            }],
            transfer: Transfer::Move,
            options: CopyOptions::default(),
        })
        .unwrap_err();
    assert_eq!(e.code, FsErrorCode::DangerousPath);
}

// ---- clean ----

fn clean_tree() -> (tempfile::TempDir, PathBuf) {
    let d = tempdir().unwrap();
    let root = d.path().join("Start ü");
    fs::create_dir_all(root.join("a/b/c")).unwrap();
    fs::create_dir_all(root.join("mac 🍏")).unwrap();
    fs::write(root.join("mac 🍏/.DS_Store"), "x").unwrap();
    fs::create_dir_all(root.join("old")).unwrap();
    fs::write(root.join("old/x.bak"), "x").unwrap();
    fs::write(root.join("keep.txt"), "x").unwrap();
    // an empty sibling above the start folder: must survive everything
    fs::create_dir(d.path().join("leer daneben")).unwrap();
    (d, root)
}

fn full_options() -> CleanOptions {
    CleanOptions {
        junk: vec![".DS_Store".into()],
        patterns: vec!["*.bak".into()],
        ..CleanOptions::default()
    }
}

#[test]
fn clean_deletes_children_first_and_nothing_outside_the_start_folder() {
    let h = Harness::new();
    let (d, root) = clean_tree();
    let o = full_options();
    let scan = find_empty_dirs(std::slice::from_ref(&root), &o).unwrap();
    assert_eq!(scan.items.len(), 6, "{:?}", scan.items); // a, b, c, mac, old, x.bak
    // the order does not matter for the job: it sorts children first itself
    let mut list = scan.items.clone();
    list.reverse();
    let id = h.clean(std::slice::from_ref(&root), list, o);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    let mut left: Vec<String> = fs::read_dir(&root)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    left.sort();
    assert_eq!(left, ["keep.txt"]);
    assert!(root.is_dir(), "the start folder stays");
    assert!(
        d.path().join("leer daneben").is_dir(),
        "never above the start folder"
    );
}

#[test]
fn clean_rechecks_every_entry() {
    let h = Harness::new();
    let (d, root) = clean_tree();
    let o = full_options();
    let scan = find_empty_dirs(std::slice::from_ref(&root), &o).unwrap();
    // after the scan: a new file in a/b – b and a stay, c goes
    fs::write(root.join("a/b/neu.txt"), "neu").unwrap();
    let mut list = scan.items.clone();
    // forged entries: outside the start folder, the start folder itself, a file not matching
    list.push(crate::clean::CleanItem {
        path: s(&d.path().join("leer daneben")),
        kind: CleanKind::Dir,
        junk: 0,
    });
    list.push(crate::clean::CleanItem {
        path: s(&root),
        kind: CleanKind::Dir,
        junk: 0,
    });
    list.push(crate::clean::CleanItem {
        path: s(&root.join("keep.txt")),
        kind: CleanKind::File,
        junk: 0,
    });
    // `..` refuses the whole job before it starts (external review #1)
    let mut with_up = list.clone();
    with_up.push(crate::clean::CleanItem {
        path: s(&root.join("..").join("leer daneben")),
        kind: CleanKind::Dir,
        junk: 0,
    });
    let refused = h.mgr.start(JobSpec::Clean {
        roots: vec![s(&root)],
        items: with_up,
        mode: DeleteMode::Permanent,
        options: o.clone(),
    });
    assert_eq!(refused.unwrap_err().code, FsErrorCode::InvalidPath);
    let id = h.clean(std::slice::from_ref(&root), list, o);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let sum = info.summary.unwrap();
    assert_eq!(sum.items_failed, 5, "{:?}", sum.errors);
    assert!(root.join("a/b/neu.txt").is_file());
    assert!(!root.join("a/b/c").exists());
    assert!(root.join("keep.txt").is_file());
    assert!(d.path().join("leer daneben").is_dir());
    assert!(!root.join("old").exists() && !root.join("mac 🍏").exists());
}

#[cfg(unix)]
#[test]
fn clean_never_deletes_through_a_link() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let root = d.path().join("start");
    let outside = d.path().join("outside");
    fs::create_dir_all(outside.join("empty")).unwrap();
    fs::write(outside.join("x.bak"), "x").unwrap();
    fs::create_dir_all(root.join("real/empty")).unwrap();
    fs::write(root.join("real/x.bak"), "x").unwrap();
    let o = CleanOptions {
        patterns: vec!["*.bak".into()],
        ..CleanOptions::default()
    };
    let scan = find_empty_dirs(std::slice::from_ref(&root), &o).unwrap();
    assert_eq!(scan.items.len(), 3);
    // swap the scanned folder for a link to the outside before the job runs
    fs::rename(root.join("real"), d.path().join("moved")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("real")).unwrap();
    let id = h.clean(std::slice::from_ref(&root), scan.items, o);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert!(outside.join("empty").is_dir() && outside.join("x.bak").is_file());
    assert!(root.join("real").is_symlink());
}

#[test]
fn clean_with_the_start_folder_and_cancel() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let root = d.path().join("ganz leer");
    for i in 0..50 {
        fs::create_dir_all(root.join(format!("d{i}/inner"))).unwrap();
    }
    let o = CleanOptions {
        include_roots: true,
        ..CleanOptions::default()
    };
    let scan = find_empty_dirs(std::slice::from_ref(&root), &o).unwrap();
    assert_eq!(scan.items.len(), 101);
    assert_eq!(
        scan.items.last().unwrap().path,
        s(&root),
        "the start folder comes last"
    );
    // cancelled while queued behind a job that waits for a decision: nothing deleted
    let blocker_dir = d.path().join("blocker");
    fs::create_dir(&blocker_dir).unwrap();
    let f = d.path().join("f");
    fs::write(&f, "new").unwrap();
    fs::write(blocker_dir.join("f"), "old").unwrap();
    let first = h.copy(&[&f], &blocker_dir, false);
    let c = h.conflict(&first);
    let id = h.clean(std::slice::from_ref(&root), scan.items.clone(), o.clone());
    h.mgr.cancel(&id);
    h.mgr
        .resolve_conflict(&first, c.conflict_id, Decision::Skip, false);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Cancelled);
    assert_eq!(fs::read_dir(&root).unwrap().count(), 50);
    let id = h.clean(std::slice::from_ref(&root), scan.items, o);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(!root.exists());
    assert!(d.path().is_dir());
}

/// Review 008 #5: a group move cancelled while planning renames nothing.
#[test]
fn group_move_cancelled_while_planning_moves_nothing() {
    let (_d, src, dst) = music();
    let pairs: Vec<(PathBuf, PathBuf)> = ["Band - Titel 01.mp3", "Über alles 01.mp3"]
        .iter()
        .map(|n| (src.join(n), dst.clone()))
        .collect();
    let control = Control::default();
    control.cancel();
    let (state, summary) = copy::run_pairs(
        "j",
        &pairs,
        &CopyOptions::default(),
        copy::Mode::Move { force_copy: false },
        Summary::default(),
        &control,
        &|_| {},
    );
    assert_eq!(state, JobState::Cancelled);
    assert_eq!(summary.items_done, 0);
    assert!(src.join("Band - Titel 01.mp3").exists());
    assert!(!dst.join("Band - Titel 01.mp3").exists());
}

// ---- search (design 009) ----

fn search_spec(root: &Path, name: &str) -> JobSpec {
    let criteria: crate::search::SearchCriteria = serde_json::from_value(serde_json::json!({
        "roots": [s(root)],
        "name": name,
        "maxHits": 100000,
    }))
    .unwrap();
    JobSpec::Search { criteria }
}

#[test]
fn search_streams_batches_and_reports_stats() {
    let d = tempdir().unwrap();
    for i in 0..1200 {
        fs::write(d.path().join(format!("f {i} ü.txt")), b"").unwrap();
    }
    fs::create_dir(d.path().join("sub")).unwrap();
    let h = Harness::new();
    let id = h.mgr.start(search_spec(d.path(), "*.txt")).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let summary = info.summary.unwrap();
    let stats = summary.search.unwrap();
    assert_eq!(stats.hits, 1200);
    assert_eq!(stats.dirs_scanned, 2);
    assert_eq!(summary.items_done, 1200);
    let batches: Vec<(usize, u64)> = h
        .events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            JobEvent::SearchHits { id: i, hits, stats } if *i == id => {
                Some((hits.len(), stats.hits))
            }
            _ => None,
        })
        .collect();
    assert!(batches.len() >= 3, "1200 hits come in batches: {batches:?}");
    assert!(batches.iter().all(|(n, _)| *n <= search::BATCH_HITS));
    assert_eq!(batches.iter().map(|(n, _)| n).sum::<usize>(), 1200);
    assert_eq!(
        batches.last().unwrap().1,
        1200,
        "final batch has the final stats"
    );
    // hits are not kept in the job info (only the spec and the summary)
    assert!(!format!("{:?}", h.mgr.list()).contains("f 1 ü.txt"));
    // helper job: quitting needs no confirmation
    assert_eq!(h.mgr.active_count(), 0);
}

#[test]
fn search_fails_on_bad_pattern_or_missing_root_and_reports_unreadable() {
    let d = tempdir().unwrap();
    let h = Harness::new();
    let JobSpec::Search { mut criteria } = search_spec(d.path(), "(") else {
        panic!()
    };
    criteria.name_mode = crate::search::NameMode::Regex;
    let err = h
        .mgr
        .start(JobSpec::Search {
            criteria: criteria.clone(),
        })
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::InvalidPattern);
    let missing = d.path().join("missing");
    let id = h.mgr.start(search_spec(&missing, "")).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::NotFound
    );
    // one root missing of two: done with errors, the other root is searched
    fs::write(d.path().join("a.txt"), b"").unwrap();
    let JobSpec::Search { mut criteria } = search_spec(d.path(), "a.txt") else {
        panic!()
    };
    criteria.roots.push(s(&missing));
    let id = h.mgr.start(JobSpec::Search { criteria }).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let summary = info.summary.unwrap();
    assert_eq!(summary.items_done, 1);
    assert_eq!(summary.items_failed, 1);
    assert_eq!(summary.errors[0].path, s(&missing));
}

#[test]
fn search_cancel_reacts_fast() {
    let d = tempdir().unwrap();
    for i in 0..40 {
        let sub = d.path().join(format!("d{i}"));
        fs::create_dir(&sub).unwrap();
        for j in 0..250 {
            fs::write(sub.join(format!("{j}.txt")), b"").unwrap();
        }
    }
    let h = Harness::new();
    // content search makes the walk slow enough to cancel in the middle
    let JobSpec::Search { mut criteria } = search_spec(d.path(), "") else {
        panic!()
    };
    criteria.content = Some(crate::search::ContentQuery {
        text: "never".into(),
        case_sensitive: false,
        max_file_size: None,
    });
    let id = h.mgr.start(JobSpec::Search { criteria }).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    let t = std::time::Instant::now();
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert!(t.elapsed() < std::time::Duration::from_millis(200));
    assert!(matches!(info.state, JobState::Cancelled | JobState::Done));
}

/// Review 009 #10: finished helper jobs (search, count, folder size) leave the
/// manager as soon as their end was reported – the list does not grow with
/// every search. Waiting for them still works.
#[test]
fn finished_helper_jobs_are_removed_after_their_end() {
    let d = tempdir().unwrap();
    fs::write(d.path().join("a.txt"), b"").unwrap();
    let h = Harness::new();
    let search = h.mgr.start(search_spec(d.path(), "*.txt")).unwrap();
    let count = h
        .mgr
        .start(JobSpec::Count {
            paths: vec![s(d.path())],
        })
        .unwrap();
    let size = h.mgr.start(JobSpec::DirSize { path: s(d.path()) }).unwrap();
    for id in [&search, &count, &size] {
        assert!(h.finish(id).state.is_finished());
    }
    // `finish` may return before the removal: wait for it
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !h.mgr.list().is_empty() {
        assert!(std::time::Instant::now() < deadline, "{:?}", h.mgr.list());
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let events = h.events.lock().unwrap();
    for id in [&search, &count, &size] {
        let finished = events
            .iter()
            .position(|e| matches!(e, JobEvent::Finished { id: i, .. } if i == id))
            .unwrap();
        let removed = events
            .iter()
            .position(|e| matches!(e, JobEvent::Removed { ids } if ids.contains(id)))
            .expect("removed event");
        assert!(finished < removed, "the end is reported first");
    }
    drop(events);
    assert_eq!(h.finish(&search).summary.unwrap().items_done, 1);
}
