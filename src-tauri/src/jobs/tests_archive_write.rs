//! Tests of the archive write jobs (design 035): add (copy and move) with conflicts, delete,
//! create a folder; the original stays untouched on cancel, error or a change meanwhile.

use super::tests_engine::{Harness, walk};
use super::*;
use crate::archive::tests::{E, make_tar, make_zip};
use crate::archive::{read_index, virtual_path};
use crate::error::FsErrorCode;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn names(path: &Path) -> Vec<String> {
    let mut v: Vec<String> = read_index(path)
        .unwrap()
        .entries
        .iter()
        .map(|e| e.name.join("/"))
        .collect();
    v.sort();
    v
}

fn inner(archive: &Path, parts: &[&str]) -> String {
    s(&virtual_path(
        archive,
        &parts.iter().map(|p| p.to_string()).collect::<Vec<_>>(),
    ))
}

fn no_temp(dir: &Path) -> bool {
    walk(dir)
        .iter()
        .all(|p| !p.to_string_lossy().contains(".fnf-"))
}

impl Harness {
    fn add(&self, sources: &[&Path], target: &str, mv: bool, conflict: ConflictDefault) -> String {
        self.mgr
            .start(JobSpec::ArchiveAdd {
                sources: sources.iter().map(|p| s(p)).collect(),
                target_dir: target.into(),
                options: CopyOptions {
                    conflict_default: conflict,
                    rename_to: None,
                },
                move_sources: mv,
            })
            .unwrap()
    }
}

#[test]
fn copy_a_folder_with_umlauts_into_a_tar_and_a_file_into_a_zip_subfolder() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let tar = d.path().join("a.tar");
    make_tar(&tar, &[E::File("x.txt", b"x")], false);
    let src = d.path().join("Ördner 📁");
    fs::create_dir_all(src.join("tief")).unwrap();
    fs::write(src.join("tief/grüße.txt"), "hallo").unwrap();
    fs::write(src.join("a b.txt"), "ab").unwrap();
    let id = h.add(&[&src], &s(&tar), false, ConflictDefault::Ask);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        names(&tar),
        vec![
            "x.txt",
            "Ördner 📁",
            "Ördner 📁/a b.txt",
            "Ördner 📁/tief",
            "Ördner 📁/tief/grüße.txt"
        ]
    );
    assert!(src.exists(), "copied, not moved");
    assert!(no_temp(d.path()));
    // the panel inside the archive reloads
    let vdir = s(&tar);
    assert!(h.count(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.contains(&vdir))) >= 1);

    let zip = d.path().join("b.zip");
    make_zip(&zip, &[E::Dir("sub/"), E::File("sub/old.txt", b"old")]);
    let f = d.path().join("neu.txt");
    fs::write(&f, "neu").unwrap();
    let id = h.add(&[&f], &inner(&zip, &["sub"]), false, ConflictDefault::Ask);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(names(&zip), vec!["sub", "sub/neu.txt", "sub/old.txt"]);
}

#[test]
fn a_conflict_with_an_entry_asks_like_copying() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let zip = d.path().join("a.zip");
    make_zip(
        &zip,
        &[E::File("a.txt", b"old a"), E::File("b.txt", b"old b")],
    );
    let src = d.path().join("src");
    fs::create_dir(&src).unwrap();
    fs::write(src.join("a.txt"), "new a").unwrap();
    fs::write(src.join("b.txt"), "new b").unwrap();
    let id = h.add(
        &[&src.join("a.txt"), &src.join("b.txt")],
        &s(&zip),
        false,
        ConflictDefault::Ask,
    );
    let c = h.conflict(&id);
    assert!(c.target.ends_with("a.txt"));
    assert_eq!(c.target_meta.size, Some(5));
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Overwrite, false);
    let c = h.conflict(&id);
    assert!(c.target.ends_with("b.txt"));
    h.mgr.resolve_conflict(
        &id,
        c.conflict_id,
        Decision::Rename { new_name: None },
        false,
    );
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(names(&zip), vec!["a.txt", "b (1).txt", "b.txt"]);
    let mut za = zip::ZipArchive::new(fs::File::open(&zip).unwrap()).unwrap();
    let mut t = String::new();
    std::io::Read::read_to_string(&mut za.by_name("a.txt").unwrap(), &mut t).unwrap();
    assert_eq!(t, "new a");
    // skip for all
    let id = h.add(
        &[&src.join("a.txt")],
        &s(&zip),
        false,
        ConflictDefault::Skip,
    );
    let info = h.finish(&id);
    assert_eq!(info.summary.unwrap().items_skipped, 1);
}

#[test]
fn delete_entries_and_create_a_folder() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let tgz = d.path().join("a.tar.gz");
    make_tar(
        &tgz,
        &[
            E::File("keep.txt", b"k"),
            E::Dir("dir/"),
            E::File("dir/x.txt", b"x"),
            E::File("dir/y.txt", b"y"),
        ],
        true,
    );
    let id = h
        .mgr
        .start(JobSpec::ArchiveDelete {
            paths: vec![inner(&tgz, &["dir"])],
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(names(&tgz), vec!["keep.txt"]);
    let id = h
        .mgr
        .start(JobSpec::ArchiveMkdir {
            parent: s(&tgz),
            name: "Neu 🎉".into(),
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(names(&tgz), vec!["Neu 🎉", "keep.txt"]);
    // the same name again: refused, archive unchanged
    let before = fs::read(&tgz).unwrap();
    let id = h
        .mgr
        .start(JobSpec::ArchiveMkdir {
            parent: s(&tgz),
            name: "keep.txt".into(),
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::AlreadyExists
    );
    assert_eq!(fs::read(&tgz).unwrap(), before);
    // a bad name never reaches the job
    assert!(
        h.mgr
            .start(JobSpec::ArchiveMkdir {
                parent: s(&tgz),
                name: "../x".into(),
            })
            .is_err()
    );
}

#[test]
fn moving_in_removes_only_what_went_in() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let zip = d.path().join("a.zip");
    make_zip(&zip, &[E::File("src/b.txt", b"there")]);
    let src = d.path().join("src");
    fs::create_dir(&src).unwrap();
    fs::write(src.join("a.txt"), "a").unwrap();
    fs::write(src.join("b.txt"), "b").unwrap();
    let id = h.add(&[&src], &s(&zip), true, ConflictDefault::Skip);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(!src.join("a.txt").exists(), "moved");
    assert!(src.join("b.txt").exists(), "skipped – stays");
    assert!(src.exists(), "not empty");
    // "src" was only implied by its entry: merged, no folder entry added
    assert_eq!(names(&zip), vec!["src/a.txt", "src/b.txt"]);
}

#[test]
fn cancel_mid_rewrite_leaves_the_original_and_no_temp_file() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let zip = d.path().join("big.zip");
    make_zip(&zip, &[E::File("small.txt", b"s")]);
    let big = d.path().join("big.bin");
    fs::write(&big, vec![9u8; 96 << 20]).unwrap();
    let before = fs::read(&zip).unwrap();
    let id = h.add(&[&big], &s(&zip), false, ConflictDefault::Ask);
    h.mgr.pause(&id);
    thread::sleep(Duration::from_millis(50));
    h.mgr.cancel(&id);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    assert_eq!(fs::read(&zip).unwrap(), before);
    assert!(no_temp(d.path()), "{:?}", walk(d.path()));
}

#[cfg(unix)]
#[test]
fn permissions_of_the_archive_are_kept() {
    use std::os::unix::fs::PermissionsExt;
    let h = Harness::new();
    let d = tempdir().unwrap();
    let zip = d.path().join("a.zip");
    make_zip(&zip, &[E::File("a.txt", b"a")]);
    fs::set_permissions(&zip, fs::Permissions::from_mode(0o640)).unwrap();
    let id = h
        .mgr
        .start(JobSpec::ArchiveMkdir {
            parent: s(&zip),
            name: "x".into(),
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(
        fs::metadata(&zip).unwrap().permissions().mode() & 0o777,
        0o640
    );
}

#[test]
fn seven_z_and_rar_get_a_clear_answer() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let seven = d.path().join("s.7z");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/archive/testdata/sevenzip-solid.7z"),
        &seven,
    )
    .unwrap();
    let id = h
        .mgr
        .start(JobSpec::ArchiveMkdir {
            parent: s(&seven),
            name: "x".into(),
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Failed);
    let e = info.summary.unwrap().error.unwrap();
    assert_eq!(e.code, FsErrorCode::ArchiveReadOnly);
    assert!(e.message.contains("7z"));
}

#[test]
fn an_encrypted_zip_needs_its_password_for_new_files() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let zip = d.path().join("aes.zip");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/archive/testdata/zip-aes.zip"),
        &zip,
    )
    .unwrap();
    let f = d.path().join("neu.txt");
    fs::write(&f, "n").unwrap();
    let id = h.add(&[&f], &s(&zip), false, ConflictDefault::Ask);
    let info = h.finish(&id);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::ArchivePasswordRequired
    );
    crate::archive::secrets::remember(&zip, crate::archive::secrets::Secret::new("geheim"));
    let id = h.add(&[&f], &s(&zip), false, ConflictDefault::Ask);
    assert_eq!(h.finish(&id).state, JobState::Done);
    let mut za = zip::ZipArchive::new(fs::File::open(&zip).unwrap()).unwrap();
    assert!(za.by_name_decrypt("neu.txt", b"geheim").is_ok());
    crate::archive::secrets::forget(&zip);
    // deleting needs no password (entries are copied raw)
    let id = h
        .mgr
        .start(JobSpec::ArchiveDelete {
            paths: vec![inner(&zip, &["neu.txt"])],
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Done);
}

#[test]
fn the_lock_refuses_a_second_writer() {
    let d = tempdir().unwrap();
    let zip = d.path().join("a.zip");
    make_zip(&zip, &[E::File("a.txt", b"a")]);
    let held = super::archive_write::archive_of(&[&s(&zip)]).unwrap();
    let h = Harness::new();
    // hold the lock through a waiting conflict question of the first job
    let f = d.path().join("a.txt");
    fs::write(&f, "new").unwrap();
    let first = h
        .mgr
        .start(JobSpec::ArchiveAdd {
            sources: vec![s(&f)],
            target_dir: s(&zip),
            options: CopyOptions::default(),
            move_sources: false,
        })
        .unwrap();
    let c = h.conflict(&first);
    // a second job started at once (as "start now" does) finds the archive busy
    let run = super::archive_write::run(
        "x",
        super::archive_write::Op::Mkdir {
            parent: &s(&held),
            name: "n",
        },
        &Control::default(),
        &|_| {},
    );
    assert_eq!(run.0, JobState::Failed);
    assert_eq!(run.1.error.unwrap().code, FsErrorCode::ArchiveBusy);
    h.mgr
        .resolve_conflict(&first, c.conflict_id, Decision::Skip, false);
    h.finish(&first);
}

#[test]
fn an_archive_cannot_be_added_to_itself_and_a_missing_folder_is_an_error() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let zip = d.path().join("a.zip");
    make_zip(&zip, &[E::File("a.txt", b"a")]);
    let id = h.add(&[&zip], &s(&zip), false, ConflictDefault::Ask);
    assert_eq!(
        h.finish(&id).summary.unwrap().error.unwrap().code,
        FsErrorCode::TargetInsideSource
    );
    let f = d.path().join("f.txt");
    fs::write(&f, "f").unwrap();
    let id = h.add(
        &[&f],
        &inner(&zip, &["gibt es nicht"]),
        false,
        ConflictDefault::Ask,
    );
    assert_eq!(h.finish(&id).state, JobState::Failed);
    let _: PathBuf = zip;
}
