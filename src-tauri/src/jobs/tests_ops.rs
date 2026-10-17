//! Tests for the operations of design 006: move (same volume and the copy +
//! delete path), copy options, delete (permanent, trash), count.

use super::tests_engine::{Harness, no_temp_files, tree};
use super::*;
use crate::error::FsErrorCode;
use std::fs;
use std::path::Path;
use std::sync::atomic::Ordering;
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

impl Harness {
    fn start_move(&self, sources: &[&Path], target: &Path, options: CopyOptions) -> String {
        self.mgr
            .start(JobSpec::Move {
                sources: sources.iter().map(|p| s(p)).collect(),
                target_dir: s(target),
                background: false,
                options,
                allow_dangerous: false,
            })
            .unwrap()
    }

    fn start_copy(&self, sources: &[&Path], target: &Path, options: CopyOptions) -> String {
        self.mgr
            .start(JobSpec::Copy {
                sources: sources.iter().map(|p| s(p)).collect(),
                target_dir: s(target),
                background: false,
                options,
            })
            .unwrap()
    }

    fn delete(&self, paths: &[&Path], mode: DeleteMode) -> String {
        self.mgr
            .start(JobSpec::Delete {
                paths: paths.iter().map(|p| s(p)).collect(),
                mode,
                background: false,
                allow_dangerous: false,
            })
            .unwrap()
    }

    fn answer(&self, id: &str, c: &Conflict, d: Decision, all: bool) {
        self.mgr.resolve_conflict(id, c.conflict_id, d, all);
    }
}

#[cfg(unix)]
fn ino(p: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(p).unwrap().ino()
}

#[test]
fn move_on_the_same_volume_renames_whole_entries() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    #[cfg(unix)]
    let before = ino(&src.join("a.txt"));
    let id = h.start_move(&[&src], &dst, CopyOptions::default());
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert!(!src.exists());
    let out = dst.join("Quelle ä");
    assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "alpha");
    assert!(out.join("leer").is_dir());
    #[cfg(unix)]
    assert_eq!(ino(&out.join("a.txt")), before, "renamed, not copied");
    // both folders reload
    let parent = s(src.parent().unwrap());
    assert!(
        h.count(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.contains(&parent))) >= 1
    );
}

#[test]
fn move_merges_into_an_existing_folder_and_asks_per_file() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    let out = dst.join("Quelle ä");
    fs::create_dir_all(out.join("Unter ordner 📁")).unwrap();
    fs::write(out.join("a.txt"), "alt").unwrap();
    fs::write(out.join("bleibt.txt"), "x").unwrap();
    let id = h.start_move(&[&src], &dst, CopyOptions::default());
    let c = h.conflict(&id);
    assert_eq!(c.kind, ConflictKind::Exists);
    assert!(c.target.ends_with("a.txt"));
    h.answer(&id, &c, Decision::Overwrite, false);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "alpha");
    assert_eq!(fs::read_to_string(out.join("bleibt.txt")).unwrap(), "x");
    assert_eq!(
        fs::read(out.join("Unter ordner 📁/b.bin")).unwrap().len(),
        200_000
    );
    assert!(out.join("leer").is_dir());
    assert!(!src.exists(), "emptied source folders are removed");
}

#[test]
fn move_skip_keeps_the_source_and_its_folder() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    let out = dst.join("Quelle ä");
    fs::create_dir(&out).unwrap();
    fs::write(out.join("a.txt"), "alt").unwrap();
    let id = h.start_move(&[&src], &dst, CopyOptions::default());
    let c = h.conflict(&id);
    h.answer(&id, &c, Decision::Skip, false);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(info.summary.unwrap().items_skipped, 1);
    assert_eq!(fs::read_to_string(src.join("a.txt")).unwrap(), "alpha");
    assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "alt");
    assert!(!src.join("Unter ordner 📁").exists());
    assert!(!src.join("leer").exists());
    assert!(out.join("Unter ordner 📁/b.bin").exists());
}

#[test]
fn move_across_volumes_copies_then_deletes_the_source() {
    let h = Harness::new();
    h.mgr.force_copy_on_move.store(true, Ordering::SeqCst);
    let (_d, src, dst) = tree();
    #[cfg(unix)]
    let before = ino(&src.join("a.txt"));
    let id = h.start_move(&[&src], &dst, CopyOptions::default());
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(!src.exists());
    let out = dst.join("Quelle ä");
    assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "alpha");
    assert_eq!(
        fs::read(out.join("Unter ordner 📁/b.bin")).unwrap().len(),
        200_000
    );
    assert!(out.join("leer").is_dir());
    #[cfg(unix)]
    assert_ne!(ino(&out.join("a.txt")), before, "copied");
    assert!(no_temp_files(&dst));
    assert_eq!(info.progress.bytes_done, 200_005);
}

/// Cancelling in the middle of a move never leaves a file in neither place.
#[test]
fn move_across_volumes_cancelled_midway_loses_nothing() {
    let h = Harness::new();
    h.mgr.force_copy_on_move.store(true, Ordering::SeqCst);
    let d = tempdir().unwrap();
    let src = d.path().join("q");
    fs::create_dir(&src).unwrap();
    let names: Vec<String> = (b'a'..=b'z')
        .map(|c| format!("{}.txt", c as char))
        .collect();
    for n in &names {
        fs::write(src.join(n), n.as_bytes()).unwrap();
    }
    let dst = d.path().join("z");
    fs::create_dir_all(dst.join("q")).unwrap();
    fs::write(dst.join("q/m.txt"), "alt").unwrap();
    let id = h.start_move(&[&src], &dst, CopyOptions::default());
    let c = h.conflict(&id);
    assert!(c.target.ends_with("m.txt"));
    h.mgr.cancel(&id);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    for n in &names {
        let here = src.join(n);
        let there = dst.join("q").join(n);
        if n == "m.txt" {
            assert_eq!(fs::read_to_string(&here).unwrap(), "m.txt");
            assert_eq!(fs::read_to_string(&there).unwrap(), "alt");
            continue;
        }
        let in_src = here.exists();
        let in_dst = there.exists();
        assert!(in_src ^ in_dst, "{n}: src {in_src} dst {in_dst}");
        let p = if in_src { here } else { there };
        assert_eq!(fs::read_to_string(p).unwrap(), *n);
    }
    assert!(!src.join("a.txt").exists() && src.join("z.txt").exists());
    assert!(no_temp_files(d.path()));
}

#[test]
fn move_refuses_onto_itself_into_itself_and_dangerous_paths() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    let id = h.start_move(&[&src.join("a.txt")], &src, CopyOptions::default());
    assert_eq!(
        h.finish(&id).summary.unwrap().error.unwrap().code,
        FsErrorCode::SameSourceTarget
    );
    let id = h.start_move(&[&src], &src.join("leer"), CopyOptions::default());
    assert_eq!(
        h.finish(&id).summary.unwrap().error.unwrap().code,
        FsErrorCode::TargetInsideSource
    );
    assert!(src.join("a.txt").exists());
    h.mgr.set_home(Some(src.clone()));
    let err = h
        .mgr
        .start(JobSpec::Move {
            sources: vec![s(&src)],
            target_dir: s(&dst),
            background: false,
            options: CopyOptions::default(),
            allow_dangerous: false,
        })
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::DangerousPath);
    let err = h
        .mgr
        .start(JobSpec::Delete {
            paths: vec![s(&src)],
            mode: DeleteMode::Permanent,
            background: false,
            allow_dangerous: false,
        })
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::DangerousPath);
    let id = h
        .mgr
        .start(JobSpec::Move {
            sources: vec![s(&src)],
            target_dir: s(&dst),
            background: false,
            options: CopyOptions::default(),
            allow_dangerous: true,
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
}

#[cfg(unix)]
#[test]
fn move_takes_the_link_not_its_target() {
    for force in [false, true] {
        let h = Harness::new();
        h.mgr.force_copy_on_move.store(force, Ordering::SeqCst);
        let (_d, src, dst) = tree();
        let link = src.join("link");
        std::os::unix::fs::symlink(src.join("a.txt"), &link).unwrap();
        let id = h.start_move(&[&link], &dst, CopyOptions::default());
        assert_eq!(h.finish(&id).state, JobState::Done);
        assert!(!link.exists() && fs::symlink_metadata(&link).is_err());
        assert_eq!(fs::read_link(dst.join("link")).unwrap(), src.join("a.txt"));
        assert!(src.join("a.txt").exists());
    }
}

#[test]
fn copy_options_conflict_default_and_new_name() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    fs::write(dst.join("a.txt"), "alt").unwrap();
    let skip = CopyOptions {
        conflict_default: ConflictDefault::Skip,
        rename_to: None,
    };
    let id = h.start_copy(&[&src.join("a.txt")], &dst, skip);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(info.summary.unwrap().items_skipped, 1);
    assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "alt");
    let rename = CopyOptions {
        conflict_default: ConflictDefault::Rename,
        rename_to: None,
    };
    let id = h.start_copy(&[&src.join("a.txt")], &dst, rename);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(fs::read_to_string(dst.join("a (1).txt")).unwrap(), "alpha");

    // copy under a new name into the same folder
    let named = |n: &str| CopyOptions {
        conflict_default: ConflictDefault::Ask,
        rename_to: Some(n.into()),
    };
    let id = h.start_copy(&[&src.join("a.txt")], &src, named("Kopie ä.txt"));
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(
        fs::read_to_string(src.join("Kopie ä.txt")).unwrap(),
        "alpha"
    );
    let id = h.start_copy(&[&src.join("a.txt")], &src, named("a.txt"));
    assert_eq!(
        h.finish(&id).summary.unwrap().error.unwrap().code,
        FsErrorCode::SameSourceTarget
    );
    let id = h.start_copy(&[&src.join("a.txt")], &src, named("x/y"));
    assert_eq!(
        h.finish(&id).summary.unwrap().error.unwrap().code,
        FsErrorCode::InvalidName
    );
    let two = [src.join("a.txt"), src.join("leer")];
    let id = h.start_copy(&[&two[0], &two[1]], &dst, named("z"));
    assert_eq!(
        h.finish(&id).summary.unwrap().error.unwrap().code,
        FsErrorCode::InvalidName
    );
    // a folder under a new name
    let id = h.start_copy(&[&src], &dst, named("Neu"));
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert!(dst.join("Neu/Unter ordner 📁/b.bin").exists());
}

#[test]
fn move_with_a_new_name_in_the_same_folder_renames() {
    for force in [false, true] {
        let h = Harness::new();
        h.mgr.force_copy_on_move.store(force, Ordering::SeqCst);
        let (_d, src, _dst) = tree();
        let opts = CopyOptions {
            conflict_default: ConflictDefault::Ask,
            rename_to: Some("b.txt".into()),
        };
        let id = h.start_move(&[&src.join("a.txt")], &src, opts);
        assert_eq!(h.finish(&id).state, JobState::Done);
        assert!(!src.join("a.txt").exists());
        assert_eq!(fs::read_to_string(src.join("b.txt")).unwrap(), "alpha");
    }
}

#[test]
fn delete_permanently_removes_the_tree_but_never_follows_links() {
    let h = Harness::new();
    let (d, src, _dst) = tree();
    let outside = d.path().join("draußen.txt");
    fs::write(&outside, "bleibt").unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&outside, src.join("link")).unwrap();
        std::os::unix::fs::symlink(d.path(), src.join("Unter ordner 📁/zurück")).unwrap();
    }
    let id = h.delete(&[&src], DeleteMode::Permanent);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(!src.exists());
    assert_eq!(fs::read_to_string(&outside).unwrap(), "bleibt");
    assert_eq!(info.progress.items_done, info.progress.items_total);
    assert!(info.progress.items_total >= 5);
}

#[cfg(unix)]
#[test]
fn delete_permanently_asks_for_write_protected_entries() {
    use std::os::unix::fs::PermissionsExt;
    let h = Harness::new();
    let d = tempdir().unwrap();
    let root = d.path().join("r");
    fs::create_dir_all(root.join("ro_dir")).unwrap();
    fs::write(root.join("ro_dir/f"), "x").unwrap();
    fs::write(root.join("ro.txt"), "x").unwrap();
    fs::set_permissions(root.join("ro.txt"), fs::Permissions::from_mode(0o444)).unwrap();
    fs::set_permissions(root.join("ro_dir"), fs::Permissions::from_mode(0o555)).unwrap();
    let id = h.delete(&[&root], DeleteMode::Permanent);
    let c = h.conflict(&id);
    assert_eq!(c.kind, ConflictKind::ReadOnly);
    assert!(c.source.ends_with("ro.txt"));
    h.answer(&id, &c, Decision::Skip, false);
    let c = h.conflict(&id);
    assert!(c.source.ends_with("ro_dir"));
    let asked_at = h.events.lock().unwrap().len();
    h.answer(&id, &c, Decision::Overwrite, false);
    let info = h.finish(&id);
    // the panel reloads after the entries are gone, not only when the job started
    let parent = s(d.path());
    assert!(
        h.events.lock().unwrap()[asked_at..]
            .iter()
            .any(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.contains(&parent)))
    );
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(root.join("ro.txt").exists());
    assert!(!root.join("ro_dir").exists());
    assert_eq!(info.summary.unwrap().items_skipped, 2); // ro.txt and its folder
}

#[test]
fn delete_cancelled_while_asking_keeps_the_rest() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let a = d.path().join("a.txt");
    let b = d.path().join("b.txt");
    fs::write(&a, "a").unwrap();
    fs::write(&b, "b").unwrap();
    let mut p = fs::metadata(&b).unwrap().permissions();
    p.set_readonly(true);
    fs::set_permissions(&b, p).unwrap();
    let id = h.delete(&[&a, &b], DeleteMode::Permanent);
    let c = h.conflict(&id);
    assert!(c.source.ends_with("b.txt"));
    h.answer(&id, &c, Decision::Cancel, false);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    assert!(!a.exists());
    assert!(b.exists());
}

/// freedesktop trash in a private XDG_DATA_HOME on the same file system.
#[cfg(target_os = "linux")]
#[test]
fn delete_to_the_trash() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let data = d.path().join("data");
    fs::create_dir(&data).unwrap();
    // SAFETY: the only test that reads or writes this variable
    unsafe { std::env::set_var("XDG_DATA_HOME", &data) };
    let f = d.path().join("weg ä.txt");
    fs::write(&f, "x").unwrap();
    let dir = d.path().join("Ordner");
    fs::create_dir(&dir).unwrap();
    fs::write(dir.join("in.txt"), "y").unwrap();
    let id = h.delete(&[&f, &dir], DeleteMode::Trash);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(!f.exists() && !dir.exists());
    let files = data.join("Trash/files");
    assert_eq!(fs::read_to_string(files.join("weg ä.txt")).unwrap(), "x");
    assert_eq!(
        fs::read_to_string(files.join("Ordner/in.txt")).unwrap(),
        "y"
    );
    // a missing entry is an error of its own, the job goes on
    let id = h.delete(&[&f], DeleteMode::Trash);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
}

#[test]
fn count_files_folders_and_bytes() {
    let h = Harness::new();
    let (_d, src, _dst) = tree();
    let id = h
        .mgr
        .start(JobSpec::Count {
            paths: vec![s(&src), s(&src.join("a.txt"))],
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let size = info.summary.unwrap().dir_size.unwrap();
    // src: a.txt, b.bin + folders src, Unter ordner, leer; plus a.txt again
    assert_eq!(size.files, 3);
    assert_eq!(size.dirs, 3);
    assert_eq!(size.bytes, 200_010);
}

/// Review 006 #1: folders the move never reached (cancel) or could not create
/// stay in the source – an empty folder must not vanish from both places.
#[test]
fn move_keeps_source_folders_that_did_not_arrive() {
    for force in [false, true] {
        let h = Harness::new();
        h.mgr.force_copy_on_move.store(force, Ordering::SeqCst);
        let d = tempdir().unwrap();
        let q = d.path().join("q");
        fs::create_dir_all(q.join("zz")).unwrap();
        fs::write(q.join("m.txt"), "neu").unwrap();
        let z = d.path().join("z");
        fs::create_dir_all(z.join("q")).unwrap();
        fs::write(z.join("q/m.txt"), "alt").unwrap();
        let id = h.start_move(&[&q], &z, CopyOptions::default());
        let c = h.conflict(&id);
        h.mgr.cancel(&id);
        let _ = c;
        assert_eq!(h.finish(&id).state, JobState::Cancelled);
        assert!(
            q.join("zz").is_dir() || z.join("q/zz").is_dir(),
            "force {force}"
        );
        assert_eq!(fs::read_to_string(q.join("m.txt")).unwrap(), "neu");
    }
    // the target of a folder is a file: the source folder stays
    let h = Harness::new();
    let d = tempdir().unwrap();
    let q = d.path().join("q");
    fs::create_dir_all(q.join("zz")).unwrap();
    let z = d.path().join("z");
    fs::create_dir_all(z.join("q")).unwrap();
    fs::write(z.join("q/zz"), "datei").unwrap();
    let id = h.start_move(&[&q], &z, CopyOptions::default());
    assert_eq!(h.finish(&id).state, JobState::DoneWithErrors);
    assert!(q.join("zz").is_dir());
}

/// Review 006 #2: a folder replaced by a link while the job waits is never
/// followed – nothing outside the tree is deleted.
#[cfg(unix)]
#[test]
fn delete_does_not_follow_a_folder_swapped_for_a_link() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let a = d.path().join("a");
    fs::create_dir_all(a.join("sub")).unwrap();
    fs::write(a.join("sub/x"), "x").unwrap();
    fs::write(a.join("0-ro.txt"), "ro").unwrap();
    let mut p = fs::metadata(a.join("0-ro.txt")).unwrap().permissions();
    p.set_readonly(true);
    fs::set_permissions(a.join("0-ro.txt"), p).unwrap();
    let outside = d.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("x"), "bleibt").unwrap();
    let id = h.delete(&[&a], DeleteMode::Permanent);
    let c = h.conflict(&id);
    // swap while asking
    fs::remove_dir_all(a.join("sub")).unwrap();
    std::os::unix::fs::symlink(&outside, a.join("sub")).unwrap();
    h.answer(&id, &c, Decision::Overwrite, false);
    h.finish(&id);
    assert_eq!(fs::read_to_string(outside.join("x")).unwrap(), "bleibt");
}

/// Review 006 #2 for a move across volumes: the source is deleted only if
/// its path still names the copied entry.
#[cfg(unix)]
#[test]
fn move_across_volumes_never_deletes_through_a_swapped_folder() {
    let h = Harness::new();
    h.mgr.force_copy_on_move.store(true, Ordering::SeqCst);
    let d = tempdir().unwrap();
    let q = d.path().join("q");
    fs::create_dir_all(q.join("sub")).unwrap();
    fs::write(q.join("a.txt"), "a").unwrap();
    fs::write(q.join("sub/x"), "x").unwrap();
    let z = d.path().join("z");
    fs::create_dir_all(z.join("q")).unwrap();
    fs::write(z.join("q/a.txt"), "alt").unwrap();
    let outside = d.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("x"), "bleibt").unwrap();
    let id = h.start_move(&[&q], &z, CopyOptions::default());
    let c = h.conflict(&id); // a.txt comes before sub
    fs::remove_dir_all(q.join("sub")).unwrap();
    std::os::unix::fs::symlink(&outside, q.join("sub")).unwrap();
    h.answer(&id, &c, Decision::Skip, false);
    h.finish(&id);
    assert_eq!(fs::read_to_string(outside.join("x")).unwrap(), "bleibt");
}

/// Review 006 #4: a panicking job ends as failed instead of running forever.
#[test]
fn a_panicking_job_fails_and_the_engine_goes_on() {
    let h = Harness::new();
    let id = h
        .mgr
        .start(JobSpec::Simulate {
            items: 1,
            item_ms: manager::PANIC_FOR_TESTS,
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Failed);
    assert!(h.mgr.wait_idle(std::time::Duration::from_secs(5)));
    let (_d, src, dst) = tree();
    let id = h.start_copy(&[&src], &dst, CopyOptions::default());
    assert_eq!(h.finish(&id).state, JobState::Done);
}

// ---- multi-rename (design 007) ----

fn rename_items(dir: &Path, pairs: &[(&str, &str)]) -> Vec<RenameItem> {
    pairs
        .iter()
        .map(|(a, b)| RenameItem {
            path: s(&dir.join(a)),
            new_name: b.to_string(),
            expect: None,
        })
        .collect()
}

#[test]
fn rename_job_swap_undo_and_undo_of_undo() {
    let h = Harness::new();
    let t = tempdir().unwrap();
    let d = t.path();
    fs::write(d.join("a"), "A").unwrap();
    fs::write(d.join("b"), "B").unwrap();
    let id = h
        .mgr
        .start(JobSpec::Rename {
            items: rename_items(d, &[("a", "b"), ("b", "a")]),
            undo_of: None,
        })
        .unwrap();
    let job = h.finish(&id);
    assert_eq!(job.state, JobState::Done);
    assert_eq!(fs::read_to_string(d.join("a")).unwrap(), "B");
    assert!(h.mgr.list().iter().any(|j| j.id == id && j.undo_available));
    assert!(h.events.lock().unwrap().iter().any(|e| matches!(
        e,
        JobEvent::UndoAvailable { id: i, available: true } if *i == id
    )));
    assert!(no_temp_files(d));
    assert_eq!(
        fs::read_dir(d).unwrap().count(),
        2,
        "no temporary names left"
    );
    // undo the last rename (no id given)
    let undo = h.mgr.undo_rename(None).unwrap();
    assert_eq!(h.finish(&undo).state, JobState::Done);
    assert_eq!(fs::read_to_string(d.join("a")).unwrap(), "A");
    assert!(
        !h.mgr
            .list()
            .iter()
            .find(|j| j.id == id)
            .unwrap()
            .undo_available
    );
    assert_eq!(
        h.mgr.undo_rename(Some(&id)).unwrap_err().code,
        FsErrorCode::UndoUnavailable
    );
    // the undo itself can be undone
    let redo = h.mgr.undo_rename(Some(&undo)).unwrap();
    assert_eq!(h.finish(&redo).state, JobState::Done);
    assert_eq!(fs::read_to_string(d.join("a")).unwrap(), "B");
}

#[test]
fn rename_undo_reports_changed_entries_and_renames_the_rest() {
    let h = Harness::new();
    let t = tempdir().unwrap();
    let d = t.path();
    for n in ["x", "y"] {
        fs::write(d.join(n), n).unwrap();
    }
    let id = h
        .mgr
        .start(JobSpec::Rename {
            items: rename_items(d, &[("x", "x2"), ("y", "y2")]),
            undo_of: None,
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
    fs::remove_file(d.join("x2")).unwrap(); // changed meanwhile
    let undo = h.mgr.undo_rename(Some(&id)).unwrap();
    let job = h.finish(&undo);
    assert_eq!(job.state, JobState::DoneWithErrors);
    let sum = job.summary.unwrap();
    assert_eq!((sum.items_done, sum.items_failed), (1, 1));
    assert_eq!(sum.errors[0].error.code, FsErrorCode::NotFound);
    assert!(d.join("y").exists());
    // a job without undo_of refuses everything when one pair is bad
    let bad = h
        .mgr
        .start(JobSpec::Rename {
            items: rename_items(d, &[("y", "z"), ("fehlt", "q")]),
            undo_of: None,
        })
        .unwrap();
    let job = h.finish(&bad);
    assert_eq!(job.state, JobState::Failed);
    assert!(d.join("y").exists() && !d.join("z").exists());
    assert!(!job.undo_available);
    assert!(
        h.mgr
            .start(JobSpec::Rename {
                items: vec![],
                undo_of: None
            })
            .is_err()
    );
}

/// Review R1: b was replaced after the rename – undo must not rename the new b.
#[test]
fn rename_undo_leaves_a_replaced_entry_alone() {
    let h = Harness::new();
    let t = tempdir().unwrap();
    let d = t.path();
    fs::write(d.join("a"), "alt").unwrap();
    fs::write(d.join("k"), "k").unwrap();
    let id = h
        .mgr
        .start(JobSpec::Rename {
            items: rename_items(d, &[("a", "b"), ("k", "k2")]),
            undo_of: None,
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
    fs::remove_file(d.join("b")).unwrap();
    fs::write(d.join("other"), "neu").unwrap();
    fs::rename(d.join("other"), d.join("b")).unwrap(); // a new entry named b
    let undo = h.mgr.undo_rename(Some(&id)).unwrap();
    let job = h.finish(&undo);
    assert_eq!(job.state, JobState::DoneWithErrors);
    let sum = job.summary.unwrap();
    assert_eq!((sum.items_done, sum.items_failed), (1, 1));
    assert_eq!(sum.errors[0].error.code, FsErrorCode::UndoUnavailable);
    assert!(
        sum.errors[0]
            .error
            .message
            .contains("changed since the rename")
    );
    assert_eq!(fs::read_to_string(d.join("b")).unwrap(), "neu");
    assert!(!d.join("a").exists());
    assert!(d.join("k").exists());
}

/// Review R7: the frontend cannot switch on the partial (undo) mode.
#[test]
fn rename_undo_of_is_not_accepted_from_the_frontend() {
    let spec: JobSpec =
        serde_json::from_str(r#"{"kind":"rename","items":[],"undoOf":"job-1"}"#).unwrap();
    assert_eq!(
        spec,
        JobSpec::Rename {
            items: vec![],
            undo_of: None
        }
    );
    let v = serde_json::to_value(JobSpec::Rename {
        items: vec![],
        undo_of: Some("job-1".into()),
    })
    .unwrap();
    assert_eq!(v["undoOf"], "job-1"); // still shown in the task list
}

#[test]
fn rename_undo_log_keeps_the_last_jobs() {
    let h = Harness::new();
    let t = tempdir().unwrap();
    let d = t.path();
    fs::write(d.join("n0"), "").unwrap();
    let mut ids = Vec::new();
    for i in 0..(manager::UNDO_LOG_SIZE + 2) {
        let id = h
            .mgr
            .start(JobSpec::Rename {
                items: rename_items(d, &[(&format!("n{i}"), &format!("n{}", i + 1))]),
                undo_of: None,
            })
            .unwrap();
        assert_eq!(h.finish(&id).state, JobState::Done);
        ids.push(id);
    }
    let jobs = h.mgr.list();
    let available = |id: &str| jobs.iter().find(|j| j.id == id).unwrap().undo_available;
    assert!(!available(&ids[0]) && !available(&ids[1]));
    assert!(available(&ids[2]) && available(ids.last().unwrap()));
}
