//! Jobs with a server side (design 034 E4) against the in-process test servers.

use super::tests_engine::{Harness, tree};
use super::*;
use crate::error::FsErrorCode;
use crate::remote::profiles::RemoteKind;
use crate::remote::testserver::{connected, global_hub, put, start_ftp, start_sftp};
use std::fs;
use std::path::Path;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn r(id: &str, path: &str) -> String {
    format!("remote://{id}{path}")
}

impl Harness {
    fn copy_any(&self, sources: &[String], target: &str, options: CopyOptions) -> String {
        self.mgr
            .start(JobSpec::Copy {
                sources: sources.to_vec(),
                target_dir: target.to_string(),
                background: false,
                options,
            })
            .unwrap()
    }
    fn move_any(&self, sources: &[String], target: &str) -> Result<String, crate::error::FsError> {
        self.mgr.start(JobSpec::Move {
            sources: sources.to_vec(),
            target_dir: target.to_string(),
            background: false,
            options: CopyOptions::default(),
            allow_dangerous: false,
            expected: Vec::new(),
        })
    }
}

fn round_trip(kind: RemoteKind, port: u16, root: &Path) {
    let h = Harness::new();
    let id = connected(kind, port);
    let (_d, src, dst) = tree();
    // up
    let job = h.copy_any(&[s(&src)], &r(&id, "/"), CopyOptions::default());
    let info = h.finish(&job);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        fs::read_to_string(root.join("Quelle ä/a.txt")).unwrap(),
        "alpha"
    );
    assert_eq!(
        fs::read(root.join("Quelle ä/Unter ordner 📁/b.bin"))
            .unwrap()
            .len(),
        200_000
    );
    assert!(root.join("Quelle ä/leer").is_dir());
    // the time came along
    let local = fs::metadata(src.join("a.txt")).unwrap().modified().unwrap();
    let remote = fs::metadata(root.join("Quelle ä/a.txt"))
        .unwrap()
        .modified()
        .unwrap();
    let diff = local
        .duration_since(remote)
        .unwrap_or_else(|e| e.duration());
    assert!(
        diff.as_secs() < 2 || kind != RemoteKind::Sftp,
        "mtime kept over SFTP"
    );
    // down
    let job = h.copy_any(&[r(&id, "/Quelle ä")], &s(&dst), CopyOptions::default());
    assert_eq!(h.finish(&job).state, JobState::Done);
    assert_eq!(
        fs::read_to_string(dst.join("Quelle ä/a.txt")).unwrap(),
        "alpha"
    );
    assert_eq!(
        fs::read(dst.join("Quelle ä/Unter ordner 📁/b.bin")).unwrap(),
        vec![7u8; 200_000]
    );
    // conflict: ask, overwrite
    fs::write(src.join("a.txt"), "neu").unwrap();
    let job = h.copy_any(
        &[s(&src.join("a.txt"))],
        &r(&id, "/Quelle ä"),
        CopyOptions::default(),
    );
    let c = h.conflict(&job);
    assert_eq!(c.source_meta.size, Some(3));
    assert_eq!(c.target_meta.size, Some(5));
    assert_eq!(c.suggested_name, "a (1).txt");
    h.mgr
        .resolve_conflict(&job, c.conflict_id, Decision::Overwrite, false);
    assert_eq!(h.finish(&job).state, JobState::Done);
    assert_eq!(
        fs::read_to_string(root.join("Quelle ä/a.txt")).unwrap(),
        "neu"
    );
    // conflict: rename
    let job = h.copy_any(
        &[s(&src.join("a.txt"))],
        &r(&id, "/Quelle ä"),
        CopyOptions::default(),
    );
    let c = h.conflict(&job);
    h.mgr.resolve_conflict(
        &job,
        c.conflict_id,
        Decision::Rename { new_name: None },
        false,
    );
    assert_eq!(h.finish(&job).state, JobState::Done);
    assert!(root.join("Quelle ä/a (1).txt").is_file());
    // server → server on the same server (copy) and move = rename
    let job = h.copy_any(
        &[r(&id, "/Quelle ä/a.txt")],
        &r(&id, "/Quelle ä/leer"),
        CopyOptions::default(),
    );
    assert_eq!(h.finish(&job).state, JobState::Done);
    assert_eq!(
        fs::read_to_string(root.join("Quelle ä/leer/a.txt")).unwrap(),
        "neu"
    );
    let job = h
        .move_any(&[r(&id, "/Quelle ä/leer")], &r(&id, "/"))
        .unwrap();
    assert_eq!(h.finish(&job).state, JobState::Done);
    assert!(root.join("leer/a.txt").is_file() && !root.join("Quelle ä/leer").exists());
    // move server → local removes the sources
    let job = h.move_any(&[r(&id, "/leer")], &s(&dst)).unwrap();
    assert_eq!(h.finish(&job).state, JobState::Done);
    assert!(dst.join("leer/a.txt").is_file() && !root.join("leer").exists());
    // no temporary files anywhere
    for dir in [root, dst.as_path()] {
        assert!(
            super::tests_engine::walk(dir)
                .iter()
                .all(|p| !p.to_string_lossy().contains(".part"))
        );
    }
    // delete on the server: no trash, then permanently (recursive)
    let err = h
        .mgr
        .start(JobSpec::Delete {
            paths: vec![r(&id, "/Quelle ä")],
            mode: DeleteMode::Trash,
            background: false,
            allow_dangerous: false,
            expected: Vec::new(),
        })
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteUnsupported);
    let job = h
        .mgr
        .start(JobSpec::Delete {
            paths: vec![r(&id, "/Quelle ä")],
            mode: DeleteMode::Permanent,
            background: false,
            allow_dangerous: false,
            expected: Vec::new(),
        })
        .unwrap();
    let info = h.finish(&job);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert!(!root.join("Quelle ä").exists());
}

#[test]
fn sftp_up_down_conflicts_move_delete() {
    let srv = start_sftp(11, None);
    round_trip(RemoteKind::Sftp, srv.port, srv.root.path());
}

#[test]
fn ftp_up_down_conflicts_move_delete() {
    let srv = start_ftp(false);
    round_trip(RemoteKind::Ftp, srv.port, srv.root.path());
}

#[test]
fn ftps_up_and_down() {
    let srv = start_ftp(true);
    let h = Harness::new();
    let id = connected(RemoteKind::FtpsExplicit, srv.port);
    let (_d, src, dst) = tree();
    let job = h.copy_any(&[s(&src)], &r(&id, "/"), CopyOptions::default());
    assert_eq!(h.finish(&job).state, JobState::Done);
    let job = h.copy_any(
        &[r(&id, "/Quelle ä/a.txt")],
        &s(&dst),
        CopyOptions::default(),
    );
    assert_eq!(h.finish(&job).state, JobState::Done);
    assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "alpha");
}

#[test]
fn root_and_home_need_a_second_confirmation() {
    let srv = start_sftp(12, None);
    put(srv.root.path(), "x/y.txt", b"1");
    let id = connected(RemoteKind::Sftp, srv.port);
    let h = Harness::new();
    for path in ["/", "/x/.."] {
        let e = h
            .mgr
            .start(JobSpec::Delete {
                paths: vec![r(&id, path)],
                mode: DeleteMode::Permanent,
                background: false,
                allow_dangerous: false,
                expected: Vec::new(),
            })
            .unwrap_err();
        assert!(
            matches!(
                e.code,
                FsErrorCode::DangerousPath | FsErrorCode::InvalidPath
            ),
            "{e:?}"
        );
    }
    // mixing places in one job is refused
    let e = h
        .move_any(&[r(&id, "/x"), "/tmp/a".into()], "/tmp")
        .unwrap_err();
    assert_eq!(e.code, FsErrorCode::InvalidPath);
}

#[test]
fn a_changed_entry_is_left_alone() {
    let srv = start_sftp(13, None);
    put(srv.root.path(), "f.txt", b"12345");
    let id = connected(RemoteKind::Sftp, srv.port);
    let h = Harness::new();
    let job = h
        .mgr
        .start(JobSpec::Delete {
            paths: vec![r(&id, "/f.txt")],
            mode: DeleteMode::Permanent,
            background: false,
            allow_dangerous: false,
            expected: vec![expect::ExpectedEntry {
                path: r(&id, "/f.txt"),
                kind: crate::model::EntryKind::File,
                size: Some(3),
                modified_ms: None,
            }],
        })
        .unwrap();
    let info = h.finish(&job);
    assert!(srv.root.path().join("f.txt").exists());
    let s = info.summary.unwrap();
    assert_eq!(s.errors[0].error.code, FsErrorCode::ChangedSinceListing);
}

#[test]
fn cancel_leaves_no_part_files() {
    let srv = start_sftp(14, None);
    let id = connected(RemoteKind::Sftp, srv.port);
    let dir = tempfile::tempdir().unwrap();
    let big = dir.path().join("groß.bin");
    fs::write(&big, vec![1u8; 64 << 20]).unwrap();
    let h = Harness::new();
    let job = h.copy_any(&[s(&big)], &r(&id, "/"), CopyOptions::default());
    // cancel as soon as bytes flow
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let info = h.mgr.list().into_iter().find(|j| j.id == job).unwrap();
        if info.progress.bytes_done > 0 || info.state.is_finished() {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    h.mgr.cancel(&job);
    let info = h.finish(&job);
    if info.state == JobState::Cancelled {
        let names: Vec<String> = fs::read_dir(srv.root.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.is_empty(), "{names:?}");
    }
}

#[test]
fn count_and_view_on_a_server() {
    let srv = start_ftp(false);
    put(srv.root.path(), "d/a.txt", b"abc");
    put(srv.root.path(), "d/e/b.txt", b"12345");
    let id = connected(RemoteKind::Ftp, srv.port);
    let h = Harness::new();
    let job = h
        .mgr
        .start(JobSpec::Count {
            paths: vec![r(&id, "/d")],
        })
        .unwrap();
    let ds = h.finish(&job).summary.unwrap().dir_size.unwrap();
    assert_eq!((ds.files, ds.dirs, ds.bytes), (2, 2, 8));
    let job = h
        .mgr
        .start(JobSpec::ViewEntry {
            path: r(&id, "/d/e/b.txt"),
        })
        .unwrap();
    let info = h.finish(&job);
    let view = info.summary.unwrap().view_path.unwrap();
    assert_eq!(fs::read(&view).unwrap(), b"12345");
    // the same file again: from the cache
    let again = crate::remote::view::for_preview(&r(&id, "/d/e/b.txt"), None).unwrap();
    assert_eq!(again.to_string_lossy(), view);
    let _ = global_hub();
}
