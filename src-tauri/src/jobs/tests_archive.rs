//! Tests of the archive jobs (design 016): extract (zip slip, links, limits,
//! conflicts, cancel), pack (round trip ZIP/TAR/TAR.GZ, conflicts) and the
//! duplicate search job.

use super::tests_engine::Harness;
use super::*;
use crate::archive::tests::{E, make_tar, make_zip};
use crate::duplicates::{Compare, DuplicateCriteria};
use crate::error::FsErrorCode;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

impl Harness {
    fn extract(
        &self,
        archive: &Path,
        entries: &[PathBuf],
        target: &Path,
        into_subfolder: bool,
        conflict_default: ConflictDefault,
    ) -> String {
        self.mgr
            .start(JobSpec::Extract {
                archive: s(archive),
                entries: entries.iter().map(|p| s(p)).collect(),
                target_dir: s(target),
                into_subfolder,
                options: CopyOptions {
                    conflict_default,
                    rename_to: None,
                },
            })
            .unwrap()
    }

    fn pack(
        &self,
        sources: &[PathBuf],
        target: &Path,
        name: &str,
        format: ArchiveFormat,
    ) -> String {
        self.mgr
            .start(JobSpec::Pack {
                sources: sources.iter().map(|p| s(p)).collect(),
                target_dir: s(target),
                name: name.into(),
                format,
                level: None,
                password: None,
            })
            .unwrap()
    }
}

/// Files below `dir` (relative, sorted) – to see that nothing landed elsewhere.
fn files_below(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).unwrap() {
            let e = e.unwrap();
            let p = e.path();
            let rel = p
                .strip_prefix(dir)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let ft = e.file_type().unwrap();
            if ft.is_dir() {
                out.push(format!("{rel}/"));
                stack.push(p);
            } else if ft.is_symlink() {
                out.push(format!("{rel} -> link"));
            } else {
                out.push(rel);
            }
        }
    }
    out.sort();
    out
}

fn codes(info: &JobInfo) -> Vec<FsErrorCode> {
    info.summary
        .as_ref()
        .unwrap()
        .errors
        .iter()
        .map(|e| e.error.code)
        .collect()
}

#[test]
fn zip_slip_archive_is_refused_and_the_rest_extracted() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let base = d.path().join("base");
    let target = base.join("ziel");
    fs::create_dir_all(&target).unwrap();
    let z = d.path().join("slip.zip");
    make_zip(
        &z,
        &[
            E::File("ok/inhalt.txt", b"gut"),
            E::File("../evil.txt", b"evil"),
            E::File("../../evil2.txt", b"evil"),
            E::File("/tmp/fnf-abs-evil.txt", b"evil"),
            E::File("ok\\..\\..\\evil3.txt", b"evil"),
            E::File("C:\\evil4.txt", b"evil"),
            E::Link("ok/link", "/etc/passwd"),
        ],
    );
    let info = h.finish(&h.extract(&z, &[], &target, false, ConflictDefault::Ask));
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert_eq!(files_below(&target), vec!["ok/", "ok/inhalt.txt"]);
    assert_eq!(
        files_below(&base),
        vec!["ziel/", "ziel/ok/", "ziel/ok/inhalt.txt"]
    );
    assert!(!d.path().join("evil.txt").exists());
    assert!(!Path::new("/tmp/fnf-abs-evil.txt").exists());
    let c = codes(&info);
    assert!(c.iter().all(|c| *c == FsErrorCode::UnsafeEntry), "{c:?}");
    // the link and the five unsafe names
    assert_eq!(info.summary.as_ref().unwrap().items_failed, 6);
    assert_eq!(fs::read(target.join("ok/inhalt.txt")).unwrap(), b"gut");
}

#[test]
fn tar_slip_and_links_are_refused() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let target = d.path().join("ziel");
    fs::create_dir(&target).unwrap();
    for gz in [false, true] {
        let t = d.path().join(if gz { "a.tgz" } else { "a.tar" });
        make_tar(
            &t,
            &[
                E::Dir("ordner/"),
                // a link first, then a file "through" it: must never leave the target
                E::Link("ordner/weg", "../../.."),
                E::File("ordner/weg/evil.txt", b"evil"),
                E::File("../tar-evil.txt", b"evil"),
                E::File("ordner/datei ä.txt", b"inhalt"),
            ],
            gz,
        );
        let info = h.finish(&h.extract(&t, &[], &target, true, ConflictDefault::Ask));
        assert_eq!(info.state, JobState::DoneWithErrors);
        let sub = target.join("a");
        assert!(sub.join("ordner/datei ä.txt").is_file());
        // the link was not created; `ordner/weg/evil.txt` made `weg` a real folder inside the target
        let weg = fs::symlink_metadata(sub.join("ordner/weg")).unwrap();
        assert!(weg.is_dir() && !weg.file_type().is_symlink());
        assert_eq!(
            files_below(d.path())
                .iter()
                .filter(|f| f.contains("evil"))
                .count(),
            1
        );
        assert!(sub.join("ordner/weg/evil.txt").is_file());
        assert!(!d.path().join("tar-evil.txt").exists());
        fs::remove_dir_all(&sub).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn a_link_in_the_target_is_never_followed() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let target = d.path().join("ziel");
    let outside = d.path().join("draußen");
    fs::create_dir_all(&target).unwrap();
    fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, target.join("ok")).unwrap();
    let z = d.path().join("a.zip");
    make_zip(
        &z,
        &[E::File("ok/inhalt.txt", b"x"), E::File("frei.txt", b"y")],
    );
    let info = h.finish(&h.extract(&z, &[], &target, false, ConflictDefault::Overwrite));
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert_eq!(codes(&info), vec![FsErrorCode::UnsafeEntry]);
    assert!(
        files_below(&outside).is_empty(),
        "nothing written through the link"
    );
    assert!(target.join("frei.txt").is_file());
}

#[test]
fn selected_entries_go_under_their_own_name() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let target = d.path().join("ziel 🎯");
    fs::create_dir(&target).unwrap();
    let t = d.path().join("Bücher.tar.gz");
    make_tar(
        &t,
        &[
            E::File("Bücher/Über alles.txt", b"1"),
            E::File("Bücher/Unter ordner/tief.txt", b"22"),
            E::File("andere/x.txt", b"333"),
            E::File("wurzel.txt", b"4444"),
        ],
        true,
    );
    let entries = [
        t.join("Bücher").join("Unter ordner"),
        t.join("andere").join("x.txt"),
    ];
    let info = h.finish(&h.extract(&t, &entries, &target, false, ConflictDefault::Ask));
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        files_below(&target),
        vec!["Unter ordner/", "Unter ordner/tief.txt", "x.txt"]
    );
    assert_eq!(info.progress.bytes_total, 5);
    // a missing entry is an error, the job goes on
    let info = h.finish(&h.extract(&t, &[t.join("fehlt")], &target, false, ConflictDefault::Ask));
    assert_eq!(codes(&info), vec![FsErrorCode::NotFound]);
    // an entry of another archive is refused before anything happens
    let other = d.path().join("x.zip");
    let id = h
        .mgr
        .start(JobSpec::Extract {
            archive: s(&t),
            entries: vec![s(&other.join("a"))],
            target_dir: s(&target),
            into_subfolder: false,
            options: CopyOptions::default(),
        })
        .unwrap();
    assert_eq!(h.finish(&id).state, JobState::Failed);
}

#[test]
fn existing_targets_ask_and_are_never_overwritten_silently() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let target = d.path().join("ziel");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("a.txt"), "alt").unwrap();
    let z = d.path().join("a.zip");
    make_zip(&z, &[E::File("a.txt", b"neu")]);

    // ask → skip
    let id = h.extract(&z, &[], &target, false, ConflictDefault::Ask);
    let c = h.conflict(&id);
    assert_eq!(c.target, s(&target.join("a.txt")));
    assert_eq!(c.source_meta.size, Some(3));
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Skip, false);
    assert_eq!(h.finish(&id).summary.unwrap().items_skipped, 1);
    assert_eq!(fs::read_to_string(target.join("a.txt")).unwrap(), "alt");

    // ask → rename (suggested name)
    let id = h.extract(&z, &[], &target, false, ConflictDefault::Ask);
    let c = h.conflict(&id);
    h.mgr.resolve_conflict(
        &id,
        c.conflict_id,
        Decision::Rename { new_name: None },
        false,
    );
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(fs::read_to_string(target.join("a (1).txt")).unwrap(), "neu");

    // ask → cancel: nothing changed, no temporary file left
    let id = h.extract(&z, &[], &target, false, ConflictDefault::Ask);
    let c = h.conflict(&id);
    h.mgr.cancel(&id);
    let _ = c;
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    assert_eq!(files_below(&target), vec!["a (1).txt", "a.txt"]);

    // default "overwrite"
    let info = h.finish(&h.extract(&z, &[], &target, false, ConflictDefault::Overwrite));
    assert_eq!(info.state, JobState::Done);
    assert_eq!(fs::read_to_string(target.join("a.txt")).unwrap(), "neu");

    // a folder of the same name: error, never replaced
    fs::create_dir(target.join("b.txt")).unwrap();
    make_zip(&z, &[E::File("b.txt", b"x")]);
    let info = h.finish(&h.extract(&z, &[], &target, false, ConflictDefault::Overwrite));
    assert_eq!(codes(&info), vec![FsErrorCode::NotAFile]);
    assert!(target.join("b.txt").is_dir());
}

/// Sets the declared uncompressed size of every entry of a ZIP (local and central headers).
fn patch_zip_sizes(path: &Path, size: u32) {
    let mut b = fs::read(path).unwrap();
    let mut i = 0;
    while i + 30 < b.len() {
        let off = match &b[i..i + 4] {
            [b'P', b'K', 3, 4] => Some(22),
            [b'P', b'K', 1, 2] => Some(24),
            _ => None,
        };
        if let Some(o) = off {
            b[i + o..i + o + 4].copy_from_slice(&size.to_le_bytes());
        }
        i += 1;
    }
    fs::write(path, b).unwrap();
}

#[test]
fn an_entry_larger_than_declared_is_refused() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let target = d.path().join("ziel");
    fs::create_dir(&target).unwrap();
    let z = d.path().join("lügt.zip");
    make_zip(&z, &[E::File("gross.bin", &vec![7u8; 100_000])]);
    patch_zip_sizes(&z, 10);
    let info = h.finish(&h.extract(&z, &[], &target, false, ConflictDefault::Ask));
    assert_eq!(info.state, JobState::DoneWithErrors);
    let c = codes(&info);
    assert!(
        matches!(
            c[..],
            [FsErrorCode::ArchiveTooLarge] | [FsErrorCode::ArchiveError]
        ),
        "{c:?}"
    );
    assert!(files_below(&target).is_empty(), "no file, no .part left");
}

#[test]
fn level_0_stores_without_compression() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let src = d.path().join("text.txt");
    let text = "abc ".repeat(10_000);
    fs::write(&src, &text).unwrap();
    for (format, name) in [
        (ArchiveFormat::Zip, "s.zip"),
        (ArchiveFormat::TarGz, "s.tar.gz"),
        (ArchiveFormat::SevenZ, "s.7z"),
    ] {
        let id = h
            .mgr
            .start(JobSpec::Pack {
                sources: vec![s(&src)],
                target_dir: s(d.path()),
                name: name.into(),
                format,
                level: Some(0),
                password: None,
            })
            .unwrap();
        let info = h.finish(&id);
        assert_eq!(info.state, JobState::Done, "{format:?}: {:?}", info.summary);
        let back = d.path().join(format!("back-{name}"));
        fs::create_dir(&back).unwrap();
        let info = h.finish(&h.extract(
            &d.path().join(name),
            &[],
            &back,
            false,
            ConflictDefault::Ask,
        ));
        assert_eq!(info.state, JobState::Done, "{format:?}");
        assert_eq!(fs::read_to_string(back.join("text.txt")).unwrap(), text);
    }
    // ZIP: the entry is stored, not deflated
    let mut z = zip::ZipArchive::new(fs::File::open(d.path().join("s.zip")).unwrap()).unwrap();
    assert_eq!(
        z.by_index(0).unwrap().compression(),
        zip::CompressionMethod::Stored
    );
}

#[test]
fn pack_and_extract_round_trip() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let src = d.path().join("Quelle ä");
    fs::create_dir_all(src.join("Unter ordner 📁/tief")).unwrap();
    fs::create_dir_all(src.join("leer")).unwrap();
    fs::write(src.join("a.txt"), "hallo").unwrap();
    let big: Vec<u8> = (0..300_000u32).map(|i| (i * 7 % 251) as u8).collect();
    fs::write(src.join("Unter ordner 📁/tief/b.bin"), &big).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("a.txt", src.join("link")).unwrap();
    let single = d.path().join("einzeln.txt");
    fs::write(&single, "solo").unwrap();
    let out = d.path().join("archive");
    fs::create_dir(&out).unwrap();
    for (format, name) in [
        (ArchiveFormat::Zip, "x.zip"),
        (ArchiveFormat::Tar, "x.tar"),
        (ArchiveFormat::TarGz, "x.tar.gz"),
    ] {
        let info = h.finish(&h.pack(&[src.clone(), single.clone()], &out, name, format));
        let expected = if cfg!(unix) {
            JobState::DoneWithErrors // the link is skipped and reported
        } else {
            JobState::Done
        };
        assert_eq!(info.state, expected, "{format:?}: {:?}", info.summary);
        let archive = out.join(name);
        assert!(archive.is_file());
        assert!(
            !files_below(&out).iter().any(|f| f.contains(".part")),
            "temporary file renamed"
        );
        let back = d.path().join(format!("zurück-{name}"));
        fs::create_dir(&back).unwrap();
        let info = h.finish(&h.extract(&archive, &[], &back, false, ConflictDefault::Ask));
        assert_eq!(info.state, JobState::Done, "{format:?}: {:?}", info.summary);
        assert_eq!(
            files_below(&back),
            vec![
                "Quelle ä/",
                "Quelle ä/Unter ordner 📁/",
                "Quelle ä/Unter ordner 📁/tief/",
                "Quelle ä/Unter ordner 📁/tief/b.bin",
                "Quelle ä/a.txt",
                "Quelle ä/leer/",
                "einzeln.txt",
            ],
            "{format:?}"
        );
        assert_eq!(
            fs::read(back.join("Quelle ä/Unter ordner 📁/tief/b.bin")).unwrap(),
            big
        );
        assert_eq!(
            fs::read_to_string(back.join("einzeln.txt")).unwrap(),
            "solo"
        );
        // the listing of the new archive works as well
        let l = crate::archive::list(&archive, &["Quelle ä".into()]).unwrap();
        assert_eq!(l.entries.len(), 3);
    }
}

#[test]
fn packing_onto_an_existing_archive_asks() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let f = d.path().join("f.txt");
    fs::write(&f, "x").unwrap();
    fs::write(d.path().join("f.zip"), "alt").unwrap();
    let id = h.pack(
        std::slice::from_ref(&f),
        d.path(),
        "f.zip",
        ArchiveFormat::Zip,
    );
    let c = h.conflict(&id);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Skip, false);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(fs::read_to_string(d.path().join("f.zip")).unwrap(), "alt");
    let id = h.pack(
        std::slice::from_ref(&f),
        d.path(),
        "f.zip",
        ArchiveFormat::Zip,
    );
    let c = h.conflict(&id);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Overwrite, false);
    assert_eq!(h.finish(&id).state, JobState::Done);
    assert_eq!(
        crate::archive::list(&d.path().join("f.zip"), &[])
            .unwrap()
            .entries
            .len(),
        1
    );
    // invalid names and levels are refused at once
    let bad = h.mgr.start(JobSpec::Pack {
        sources: vec![s(&f)],
        target_dir: s(d.path()),
        name: "a/b.zip".into(),
        format: ArchiveFormat::Zip,
        level: None,
        password: None,
    });
    assert_eq!(bad.unwrap_err().code, FsErrorCode::InvalidName);
    let bad = h.mgr.start(JobSpec::Pack {
        sources: vec![s(&f)],
        target_dir: s(d.path()),
        name: "b.zip".into(),
        format: ArchiveFormat::Zip,
        level: Some(12),
        password: None,
    });
    assert!(bad.is_err());
    // packing the folder that holds the archive being replaced: it never packs itself
    let id = h.pack(
        &[d.path().to_path_buf()],
        d.path(),
        "f.zip",
        ArchiveFormat::Zip,
    );
    let c = h.conflict(&id);
    h.mgr
        .resolve_conflict(&id, c.conflict_id, Decision::Overwrite, false);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(info.summary.unwrap().items_skipped, 1);
    let index = crate::archive::read_index(&d.path().join("f.zip")).unwrap();
    let names: Vec<String> = index.entries.iter().map(|e| e.name.join("/")).collect();
    assert!(names.iter().any(|n| n.ends_with("/f.txt")), "{names:?}");
    assert!(!names.iter().any(|n| n.ends_with("f.zip")), "{names:?}");
}

#[test]
fn duplicates_job_streams_groups() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    fs::write(d.path().join("a"), "same").unwrap();
    fs::write(d.path().join("b"), "same").unwrap();
    fs::write(d.path().join("c"), "diff").unwrap();
    let id = h
        .mgr
        .start(JobSpec::Duplicates {
            criteria: DuplicateCriteria {
                roots: vec![s(d.path())],
                compare: Compare::Content,
                ..DuplicateCriteria::default()
            },
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(info.summary.unwrap().search.unwrap().groups, 1);
    let hits: Vec<_> = h
        .events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            JobEvent::SearchHits { id: i, hits, .. } if *i == id => Some(hits.clone()),
            _ => None,
        })
        .flatten()
        .collect();
    assert_eq!(hits.len(), 2);
    assert!(hits.iter().all(|h| h.group == Some(1)));
    let json = serde_json::to_value(&hits[0]).unwrap();
    assert_eq!(json["group"], 1);
    let spec: JobSpec = serde_json::from_str(&format!(
        r#"{{"kind":"duplicates","criteria":{{"roots":[{}],"compare":"size"}}}}"#,
        serde_json::to_string(&s(d.path())).unwrap()
    ))
    .unwrap();
    assert!(spec.is_parallel() && spec.is_helper());
}

#[test]
fn wire_format_of_the_archive_jobs() {
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"extract","archive":"/a.zip","entries":["/a.zip/x"],"targetDir":"/t","intoSubfolder":true,"options":{"conflictDefault":"skip"}}"#,
    )
    .unwrap();
    assert_eq!(spec.kind(), "extract");
    assert!(!spec.is_parallel() && !spec.is_helper());
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"pack","sources":["/a"],"targetDir":"/t","name":"a.tar.gz","format":"tarGz","level":9}"#,
    )
    .unwrap();
    let JobSpec::Pack { format, level, .. } = &spec else {
        panic!()
    };
    assert_eq!((*format, *level), (ArchiveFormat::TarGz, Some(9)));
    assert!(spec.changed_paths().is_empty());
}

/// Review 016 #2: entries behind PAX/GNU metadata headers are extracted under
/// their long names (index and extraction count the same positions).
#[test]
fn entries_behind_tar_metadata_headers_are_extracted() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let t = d.path().join("meta.tar");
    crate::archive::tests::make_meta_tar(&t);
    let target = d.path().join("ziel");
    fs::create_dir(&target).unwrap();
    let info = h.finish(&h.extract(&t, &[], &target, false, ConflictDefault::Ask));
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        fs::read(target.join("pax/über lange Wege.txt")).unwrap(),
        b"pax"
    );
    assert_eq!(
        fs::read(target.join(crate::archive::tests::LONG_NAME)).unwrap(),
        b"lang"
    );
    assert_eq!(info.summary.as_ref().unwrap().items_done, 2);
    // a single entry behind the headers
    let one = d.path().join("eins");
    fs::create_dir(&one).unwrap();
    let entry = t.join(crate::archive::tests::LONG_NAME);
    let info = h.finish(&h.extract(&t, &[entry], &one, false, ConflictDefault::Ask));
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(fs::read(one.join("datei.txt")).unwrap(), b"lang");
}

/// The umask of this process (Linux: `/proc/self/status`).
#[cfg(target_os = "linux")]
fn umask() -> u32 {
    let status = fs::read_to_string("/proc/self/status").unwrap();
    let line = status.lines().find(|l| l.starts_with("Umask:")).unwrap();
    u32::from_str_radix(line[6..].trim(), 8).unwrap()
}

/// Review 016 #3: permission bits from the archive go through the umask (like
/// `tar` without `-p`); setuid/setgid/sticky never.
#[cfg(target_os = "linux")]
#[test]
fn extracted_modes_respect_the_umask() {
    use std::os::unix::fs::PermissionsExt;
    let h = Harness::new();
    let d = tempdir().unwrap();
    let t = d.path().join("modes.tar");
    let mut data: Vec<u8> = Vec::new();
    {
        let mut b = tar::Builder::new(&mut data);
        for (name, mode) in [("offen.sh", 0o777), ("suid", 0o4777)] {
            let mut hd = tar::Header::new_gnu();
            hd.set_path(name).unwrap();
            hd.set_size(1);
            hd.set_mode(mode);
            hd.set_cksum();
            b.append(&hd, &b"x"[..]).unwrap();
        }
        b.finish().unwrap();
    }
    fs::write(&t, data).unwrap();
    let target = d.path().join("ziel");
    fs::create_dir(&target).unwrap();
    let info = h.finish(&h.extract(&t, &[], &target, false, ConflictDefault::Ask));
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    let expected = 0o777 & !umask();
    for name in ["offen.sh", "suid"] {
        let mode = fs::metadata(target.join(name))
            .unwrap()
            .permissions()
            .mode()
            & 0o7777;
        assert_eq!(mode, expected, "{name}: {mode:o}");
    }
}
