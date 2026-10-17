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
    let e = h
        .mgr
        .start(JobSpec::Group {
            root: "/tmp".into(),
            items: vec![GroupItem {
                path: "/".into(),
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
    list.push(crate::clean::CleanItem {
        path: s(&root.join("..").join("leer daneben")),
        kind: CleanKind::Dir,
        junk: 0,
    });
    let id = h.clean(std::slice::from_ref(&root), list, o);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let sum = info.summary.unwrap();
    assert_eq!(sum.items_failed, 6, "{:?}", sum.errors);
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
