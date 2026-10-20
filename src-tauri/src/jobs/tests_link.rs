//! Tests for the link job (design 031 E9): absolute and relative links, never
//! replacing a name, free names, validation and errors per entry.

use super::tests_engine::Harness;
use super::*;
use crate::error::FsErrorCode;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

impl Harness {
    fn link(&self, sources: &[&Path], target: &Path, options: LinkOptions) -> String {
        self.mgr
            .start(JobSpec::Link {
                sources: sources.iter().map(|p| s(p)).collect(),
                target_dir: s(target),
                options,
            })
            .unwrap()
    }
}

/// `Quelle ä/` with a file, a folder and an emoji name; an empty `Ziel 📁/`.
fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let d = tempdir().unwrap();
    let src = d.path().join("Quelle ä");
    let dst = d.path().join("Ziel 📁");
    fs::create_dir_all(src.join("Ordner mit Leerzeichen")).unwrap();
    fs::write(src.join("Ordner mit Leerzeichen/in.txt"), "drin").unwrap();
    fs::write(src.join("Grüße 🎉.txt"), "hallo").unwrap();
    fs::create_dir_all(&dst).unwrap();
    (d, src, dst)
}

fn rel() -> LinkOptions {
    LinkOptions {
        relative: true,
        ..LinkOptions::default()
    }
}

#[cfg(unix)]
#[test]
fn absolute_links_to_files_and_folders() {
    let h = Harness::new();
    let (_d, src, dst) = setup();
    let file = src.join("Grüße 🎉.txt");
    let dir = src.join("Ordner mit Leerzeichen");
    let id = h.link(&[&file, &dir], &dst, LinkOptions::default());
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    let summary = info.summary.unwrap();
    assert_eq!(summary.items_done, 2);
    assert_eq!(fs::read_link(dst.join("Grüße 🎉.txt")).unwrap(), file);
    assert_eq!(
        fs::read_to_string(dst.join("Ordner mit Leerzeichen/in.txt")).unwrap(),
        "drin"
    );
    assert!(
        fs::symlink_metadata(dst.join("Ordner mit Leerzeichen"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    // the panels showing the target reload
    assert!(
        h.count(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.contains(&s(&dst)))) > 0
    );
}

#[cfg(unix)]
#[test]
fn relative_links_point_to_the_source() {
    let h = Harness::new();
    let (_d, src, dst) = setup();
    let file = src.join("Grüße 🎉.txt");
    let id = h.link(&[&file], &dst, rel());
    assert_eq!(h.finish(&id).state, JobState::Done);
    let link = dst.join("Grüße 🎉.txt");
    assert_eq!(
        fs::read_link(&link).unwrap(),
        PathBuf::from("../Quelle ä/Grüße 🎉.txt")
    );
    assert_eq!(fs::read_to_string(&link).unwrap(), "hallo");
    // the tree moves as a whole: the relative link still works
    let moved = dst.parent().unwrap().join("verschoben");
    fs::create_dir(&moved).unwrap();
    fs::rename(&src, moved.join("Quelle ä")).unwrap();
    fs::rename(&dst, moved.join("Ziel 📁")).unwrap();
    assert_eq!(
        fs::read_to_string(moved.join("Ziel 📁/Grüße 🎉.txt")).unwrap(),
        "hallo"
    );
}

#[cfg(unix)]
#[test]
fn relative_link_through_a_linked_folder_is_refused() {
    let h = Harness::new();
    let (d, src, _dst) = setup();
    // `via` → `deep/a/b`: lexically `via/../Quelle ä` is `Quelle ä`, physically `deep/a/Quelle ä`
    let deep = d.path().join("deep/a/b");
    fs::create_dir_all(&deep).unwrap();
    let via = d.path().join("via");
    std::os::unix::fs::symlink(&deep, &via).unwrap();
    let file = src.join("Grüße 🎉.txt");
    let id = h.link(&[&file], &via, rel());
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let summary = info.summary.unwrap();
    assert_eq!(
        summary.errors[0].error.code,
        FsErrorCode::RelativeLinkImpossible
    );
    assert!(
        fs::symlink_metadata(deep.join("Grüße 🎉.txt")).is_err(),
        "nothing made"
    );
    // absolute works there
    let id = h.link(&[&file], &via, LinkOptions::default());
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(
        fs::read_to_string(deep.join("Grüße 🎉.txt")).unwrap(),
        "hallo"
    );
}

#[cfg(unix)]
#[test]
fn an_existing_name_is_never_replaced() {
    let h = Harness::new();
    let (_d, src, dst) = setup();
    let file = src.join("Grüße 🎉.txt");
    fs::write(dst.join("Grüße 🎉.txt"), "bleibt").unwrap();
    let id = h.link(&[&file], &dst, LinkOptions::default());
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let summary = info.summary.unwrap();
    assert_eq!(summary.errors[0].error.code, FsErrorCode::AlreadyExists);
    assert_eq!(
        fs::read_to_string(dst.join("Grüße 🎉.txt")).unwrap(),
        "bleibt"
    );
    assert!(
        !fs::symlink_metadata(dst.join("Grüße 🎉.txt"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    // keep both: a free name, the original stays
    let both = LinkOptions {
        keep_both: true,
        ..LinkOptions::default()
    };
    let id = h.link(&[&file], &dst, both.clone());
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(fs::read_link(dst.join("Grüße 🎉 (1).txt")).unwrap(), file);
    let id = h.link(&[&file], &dst, both);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert!(dst.join("Grüße 🎉 (2).txt").exists());
    assert_eq!(
        fs::read_to_string(dst.join("Grüße 🎉.txt")).unwrap(),
        "bleibt"
    );
}

#[cfg(unix)]
#[test]
fn link_next_to_the_source_under_a_new_name() {
    let h = Harness::new();
    let (_d, src, _dst) = setup();
    let file = src.join("Grüße 🎉.txt");
    let options = LinkOptions {
        rename_to: Some("Verweis.txt".into()),
        relative: true,
        ..LinkOptions::default()
    };
    let id = h.link(&[&file], &src, options);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(
        fs::read_link(src.join("Verweis.txt")).unwrap(),
        PathBuf::from("Grüße 🎉.txt")
    );
    // the same name in the same folder: exists
    let id = h.link(&[&file], &src, LinkOptions::default());
    let info = h.finish(&id);
    assert_eq!(
        info.summary.unwrap().errors[0].error.code,
        FsErrorCode::AlreadyExists
    );
}

#[cfg(unix)]
#[test]
fn dangling_sources_are_linked_missing_ones_fail_per_entry() {
    let h = Harness::new();
    let (d, src, dst) = setup();
    let dangling = src.join("ins Leere");
    std::os::unix::fs::symlink(d.path().join("gibt es nicht"), &dangling).unwrap();
    let missing = src.join("fehlt.txt");
    let in_archive = src.join("a.zip/inner.txt");
    let file = src.join("Grüße 🎉.txt");
    let id = h.link(
        &[&dangling, &missing, &in_archive, &file],
        &dst,
        LinkOptions::default(),
    );
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let summary = info.summary.unwrap();
    assert_eq!(summary.items_done, 2);
    assert_eq!(summary.items_failed, 2);
    assert!(
        summary
            .errors
            .iter()
            .all(|e| e.error.code == FsErrorCode::NotFound
                || e.error.code == FsErrorCode::NotADirectory),
        "{:?}",
        summary.errors
    );
    assert_eq!(fs::read_link(dst.join("ins Leere")).unwrap(), dangling);
    assert!(dst.join("Grüße 🎉.txt").exists());
}

#[test]
fn the_target_must_be_a_real_folder() {
    let h = Harness::new();
    let (_d, src, dst) = setup();
    let file = src.join("Grüße 🎉.txt");
    for target in [file.clone(), dst.join("fehlt"), src.join("a.zip")] {
        let id = h.link(&[&file], &target, LinkOptions::default());
        let info = h.finish(&id);
        assert_eq!(info.state, JobState::Failed, "{target:?}");
        assert!(info.summary.unwrap().error.is_some());
    }
}

#[test]
fn validation_before_the_start() {
    let h = Harness::new();
    let (_d, src, dst) = setup();
    let file = s(&src.join("Grüße 🎉.txt"));
    let start = |sources: Vec<String>, target: String, options: LinkOptions| {
        h.mgr.start(JobSpec::Link {
            sources,
            target_dir: target,
            options,
        })
    };
    let code = |r: Result<String, FsError>| r.unwrap_err().code;
    assert_eq!(
        code(start(vec![], s(&dst), LinkOptions::default())),
        FsErrorCode::InvalidPath
    );
    assert_eq!(
        code(start(
            vec!["relativ.txt".into()],
            s(&dst),
            LinkOptions::default()
        )),
        FsErrorCode::InvalidPath
    );
    assert_eq!(
        code(start(
            vec![file.clone()],
            "ziel".into(),
            LinkOptions::default()
        )),
        FsErrorCode::InvalidPath
    );
    let renamed = |name: &str| LinkOptions {
        rename_to: Some(name.into()),
        ..LinkOptions::default()
    };
    assert_eq!(
        code(start(vec![file.clone()], s(&dst), renamed("a/b"))),
        FsErrorCode::InvalidName
    );
    assert_eq!(
        code(start(
            vec![file.clone(), s(&src.join("Ordner mit Leerzeichen"))],
            s(&dst),
            renamed("x")
        )),
        FsErrorCode::InvalidName
    );
    let many = vec![file; link::MAX_ITEMS + 1];
    assert_eq!(
        code(start(many, s(&dst), LinkOptions::default())),
        FsErrorCode::TooMany
    );
}

#[test]
fn wire_format_and_kind() {
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"link","sources":["/a"],"targetDir":"/b","options":{"relative":true,"renameTo":"x","keepBoth":true}}"#,
    )
    .unwrap();
    assert_eq!(spec.kind(), "link");
    assert!(!spec.is_parallel() && !spec.is_helper());
    assert_eq!(spec.target_dirs(), vec![PathBuf::from("/b")]);
    assert!(spec.changed_paths().is_empty());
    let JobSpec::Link { options, .. } = &spec else {
        panic!()
    };
    assert!(options.relative && options.keep_both);
    let spec: JobSpec =
        serde_json::from_str(r#"{"kind":"link","sources":["/a"],"targetDir":"/b"}"#).unwrap();
    let JobSpec::Link { options, .. } = &spec else {
        panic!()
    };
    assert_eq!(options, &LinkOptions::default());
    let e = FsError::new(FsErrorCode::LinkNotPermitted, "x", None);
    assert_eq!(
        serde_json::to_value(&e).unwrap()["code"],
        "link_not_permitted"
    );
    let e = FsError::new(FsErrorCode::RelativeLinkImpossible, "x", None);
    assert_eq!(
        serde_json::to_value(&e).unwrap()["code"],
        "relative_link_impossible"
    );
}

#[cfg(unix)]
#[test]
fn many_links_and_cancel() {
    let h = Harness::new();
    let (_d, src, dst) = setup();
    let names: Vec<PathBuf> = (0..2000).map(|i| src.join(format!("f{i}.txt"))).collect();
    for n in &names {
        fs::write(n, "x").unwrap();
    }
    let refs: Vec<&Path> = names.iter().map(|p| p.as_path()).collect();
    let id = h.link(&refs, &dst, rel());
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(info.summary.unwrap().items_done, 2000);
    assert_eq!(info.progress.items_total, 2000);
    // cancelled while it waits behind another job: nothing is made
    let other = dst.join("zwei");
    fs::create_dir(&other).unwrap();
    let blocker = h
        .mgr
        .start(JobSpec::Simulate {
            items: 20,
            item_ms: 20,
        })
        .unwrap();
    let id = h.link(&refs, &other, LinkOptions::default());
    h.mgr.cancel(&id);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    h.finish(&blocker);
    assert_eq!(fs::read_dir(&other).unwrap().count(), 0);
}
