//! Job tests of design 025: extracting 7z/RAR/encrypted ZIP, passwords,
//! packing 7z and encrypted ZIP, the `viewEntry` job and the view cache.

use super::tests_engine::Harness;
use super::*;
use crate::archive::secrets::{self, Secret};
use crate::archive::tests_formats::fixture;
use crate::archive::{self, view};
use crate::error::FsErrorCode;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

impl Harness {
    fn unpack(&self, archive: &Path, entries: &[PathBuf], target: &Path) -> JobInfo {
        let id = self
            .mgr
            .start(JobSpec::Extract {
                archive: s(archive),
                entries: entries.iter().map(|p| s(p)).collect(),
                target_dir: s(target),
                into_subfolder: false,
                options: CopyOptions::default(),
            })
            .unwrap();
        self.finish(&id)
    }

    fn pack_pw(
        &self,
        sources: &[PathBuf],
        target: &Path,
        name: &str,
        format: ArchiveFormat,
        pw: Option<&str>,
    ) -> JobInfo {
        let id = self
            .mgr
            .start(JobSpec::Pack {
                sources: sources.iter().map(|p| s(p)).collect(),
                target_dir: s(target),
                name: name.into(),
                format,
                level: Some(5),
                password: pw.map(Secret::new),
            })
            .unwrap();
        self.finish(&id)
    }
}

fn job_error(info: &JobInfo) -> FsErrorCode {
    info.summary.as_ref().unwrap().error.as_ref().unwrap().code
}

/// Files below `dir`, relative and sorted.
fn tree(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            let rel = p
                .strip_prefix(dir)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let m = fs::symlink_metadata(&p).unwrap();
            if m.is_dir() {
                out.push(format!("{rel}/"));
                stack.push(p);
            } else if m.file_type().is_symlink() {
                out.push(format!("{rel} -> link"));
            } else {
                out.push(rel);
            }
        }
    }
    out.sort();
    out
}

#[test]
fn a_7zip_archive_extracts_whole_and_in_parts() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "sevenzip-solid.7z");
    let all = d.path().join("all");
    fs::create_dir(&all).unwrap();
    let info = h.unpack(&a, &[], &all);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        tree(&all),
        vec![
            "empty.txt",
            "leer/",
            "Ünïcödé dir/",
            "Ünïcödé dir/grüße.txt",
            "Ünïcödé dir/sub/",
            "Ünïcödé dir/sub/deep.txt",
            "🎉.txt"
        ]
    );
    assert_eq!(
        fs::read(all.join("🎉.txt")).unwrap(),
        "🎉 party\n".as_bytes()
    );
    // one file from the middle of the solid block, and a folder
    let part = d.path().join("part");
    fs::create_dir(&part).unwrap();
    let info = h.unpack(
        &a,
        &[a.join("Ünïcödé dir").join("sub"), a.join("🎉.txt")],
        &part,
    );
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(tree(&part), vec!["sub/", "sub/deep.txt", "🎉.txt"]);
    assert_eq!(fs::read(part.join("sub/deep.txt")).unwrap(), b"tief\n");
}

#[test]
fn seven_zip_slip_and_links_are_never_written() {
    use sevenz_rust2::{ArchiveEntry, ArchiveWriter};
    let h = Harness::new();
    let d = tempdir().unwrap();
    let a = d.path().join("slip.7z");
    let mut w = ArchiveWriter::create(&a).unwrap();
    for (n, data) in [
        ("ok/a.txt", &b"gut"[..]),
        ("../evil.txt", b"evil"),
        ("/tmp/fnf-7z-evil.txt", b"x"),
    ] {
        w.push_archive_entry(ArchiveEntry::new_file(n), Some(data))
            .unwrap();
    }
    let mut link = ArchiveEntry::new_file("ok/link");
    link.has_windows_attributes = true;
    link.windows_attributes = 0x8000 | (0o120777 << 16);
    w.push_archive_entry(link, Some(&b"/etc/passwd"[..]))
        .unwrap();
    w.finish().unwrap();
    let base = d.path().join("base");
    let target = base.join("ziel");
    fs::create_dir_all(&target).unwrap();
    let info = h.unpack(&a, &[], &target);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert_eq!(tree(&base), vec!["ziel/", "ziel/ok/", "ziel/ok/a.txt"]);
    assert!(!Path::new("/tmp/fnf-7z-evil.txt").exists());
    assert!(!d.path().join("evil.txt").exists());
}

#[test]
fn encrypted_entries_need_the_password_before_anything_is_written() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    for (name, pw) in [
        ("zip-aes.zip", "geheim"),
        ("zip-crypto.zip", "geheim"),
        ("sevenzip-enc-data.7z", "geheim"),
    ] {
        let a = fixture(d.path(), name);
        let t = d.path().join(format!("t-{name}"));
        fs::create_dir(&t).unwrap();
        let info = h.unpack(&a, &[], &t);
        assert_eq!(info.state, JobState::Failed, "{name}");
        assert_eq!(
            job_error(&info),
            FsErrorCode::ArchivePasswordRequired,
            "{name}"
        );
        assert!(tree(&t).is_empty(), "{name}: nothing written");
        // a wrong password that slips past the check (stored straight into the store)
        secrets::remember(&a, Secret::new("falsch"));
        let info = h.unpack(&a, &[], &t);
        assert_eq!(info.state, JobState::Failed, "{name}");
        assert_eq!(
            job_error(&info),
            FsErrorCode::ArchivePasswordWrong,
            "{name}"
        );
        assert!(
            tree(&t).iter().all(|p| p.ends_with('/')),
            "{name}: no files with a wrong password (folders may exist)"
        );
        archive::set_password(&a, Secret::new(pw)).unwrap();
        let info = h.unpack(&a, &[], &t);
        assert_eq!(info.state, JobState::Done, "{name}: {:?}", info.summary);
        assert_eq!(
            fs::read(t.join("Ünïcödé dir/grüße.txt")).unwrap(),
            b"hallo welt\n",
            "{name}"
        );
    }
}

#[test]
fn encrypted_7z_names_extract_with_the_password() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "sevenzip-enc-names.7z");
    let t = d.path().join("t");
    fs::create_dir(&t).unwrap();
    let info = h.unpack(&a, &[], &t);
    assert_eq!(job_error(&info), FsErrorCode::ArchivePasswordRequired);
    archive::set_password(&a, Secret::new("geheim")).unwrap();
    let info = h.unpack(&a, &[], &t);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(
        fs::read(t.join("Ünïcödé dir/sub/deep.txt")).unwrap(),
        b"tief\n"
    );
}

#[test]
fn pack_7z_and_encrypted_zip_round_trip() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let src = d.path().join("Quelle ä");
    fs::create_dir_all(src.join("leer")).unwrap();
    fs::create_dir_all(src.join("sub")).unwrap();
    fs::write(src.join("sub/a 🎉.txt"), b"eins").unwrap();
    fs::write(src.join("nullen.bin"), vec![0u8; 300_000]).unwrap();
    fs::write(src.join("leer.txt"), b"").unwrap();
    let out = d.path().join("out");
    fs::create_dir(&out).unwrap();
    for (name, format, pw) in [
        ("p.7z", ArchiveFormat::SevenZ, None),
        ("pw.7z", ArchiveFormat::SevenZ, Some("geheim 🔑")),
        ("pw.zip", ArchiveFormat::Zip, Some("geheim 🔑")),
    ] {
        let info = h.pack_pw(std::slice::from_ref(&src), &out, name, format, pw);
        assert_eq!(info.state, JobState::Done, "{name}: {:?}", info.summary);
        let a = out.join(name);
        if let Some(pw) = pw {
            let needs = match format {
                // 7z: names are encrypted too
                ArchiveFormat::SevenZ => archive::read_index(&a).unwrap_err().code,
                _ => {
                    assert!(archive::read_index(&a).unwrap().encrypted);
                    let t = d.path().join(format!("np-{name}"));
                    fs::create_dir(&t).unwrap();
                    job_error(&h.unpack(&a, &[], &t))
                }
            };
            assert_eq!(needs, FsErrorCode::ArchivePasswordRequired, "{name}");
            archive::set_password(&a, Secret::new(pw)).unwrap();
        }
        let t = d.path().join(format!("x-{name}"));
        fs::create_dir(&t).unwrap();
        let info = h.unpack(&a, &[], &t);
        assert_eq!(info.state, JobState::Done, "{name}: {:?}", info.summary);
        assert_eq!(
            tree(&t),
            vec![
                "Quelle ä/",
                "Quelle ä/leer.txt",
                "Quelle ä/leer/",
                "Quelle ä/nullen.bin",
                "Quelle ä/sub/",
                "Quelle ä/sub/a 🎉.txt"
            ],
            "{name}"
        );
        assert_eq!(fs::read(t.join("Quelle ä/sub/a 🎉.txt")).unwrap(), b"eins");
        assert_eq!(
            fs::read(t.join("Quelle ä/nullen.bin")).unwrap().len(),
            300_000
        );
        // times survive (7z: 100 ns, ZIP: Extended Timestamp – seconds)
        let m = |p: &Path| {
            fs::metadata(p)
                .unwrap()
                .modified()
                .unwrap()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        };
        assert_eq!(
            m(&t.join("Quelle ä/sub/a 🎉.txt")),
            m(&src.join("sub/a 🎉.txt")),
            "{name}"
        );
    }
    // 7-Zip itself opens our encrypted 7z (when it is installed)
    if std::process::Command::new("7z").arg("i").output().is_ok() {
        let o = std::process::Command::new("7z")
            .args(["t", "-pgeheim 🔑"])
            .arg(out.join("pw.7z"))
            .output()
            .unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stdout));
        // the AES-ZIP with a non-ASCII password: 7-Zip for Windows derives the key from
        // the password in another encoding than UTF-8 and fails (CI 22.10.2026) – our
        // own round trip above holds everywhere; interop noted in TODO.md
        if !cfg!(windows) {
            let o = std::process::Command::new("7z")
                .args(["t", "-pgeheim 🔑"])
                .arg(out.join("pw.zip"))
                .output()
                .unwrap();
            assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stdout));
        }
    }
}

#[test]
fn rar_cannot_be_packed_and_only_zip_and_7z_encrypt() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let f = d.path().join("a.txt");
    fs::write(&f, b"a").unwrap();
    let info = h.pack_pw(
        std::slice::from_ref(&f),
        d.path(),
        "a.rar",
        ArchiveFormat::Rar,
        None,
    );
    assert_eq!(info.state, JobState::Failed);
    let info = h.pack_pw(&[f], d.path(), "a.tar", ArchiveFormat::Tar, Some("x"));
    assert_eq!(info.state, JobState::Failed);
    assert!(!d.path().join("a.rar").exists() && !d.path().join("a.tar").exists());
}

#[test]
fn a_password_is_never_sent_back() {
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"pack","sources":["/a"],"targetDir":"/t","name":"a.7z","format":"sevenZ","password":"geheim"}"#,
    )
    .unwrap();
    let JobSpec::Pack {
        password, format, ..
    } = &spec
    else {
        panic!()
    };
    assert_eq!(*format, ArchiveFormat::SevenZ);
    assert_eq!(password.as_ref().unwrap().expose(), "geheim");
    let json = serde_json::to_string(&spec).unwrap();
    assert!(
        !json.contains("geheim") && !json.contains("password"),
        "{json}"
    );
    assert!(!format!("{spec:?}").contains("geheim"));
    let view: JobSpec = serde_json::from_str(r#"{"kind":"viewEntry","path":"/a.zip/x"}"#).unwrap();
    assert_eq!(view.kind(), "viewEntry");
    assert!(view.is_parallel() && !view.is_helper());
}

#[test]
fn view_entry_extracts_a_read_only_copy_once() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "sevenzip-solid.7z");
    let entry = a.join("Ünïcödé dir").join("grüße.txt");
    let id = h.mgr.start(JobSpec::ViewEntry { path: s(&entry) }).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    let copy = PathBuf::from(info.summary.unwrap().view_path.unwrap());
    assert_eq!(copy.file_name().unwrap(), "grüße.txt");
    assert_eq!(fs::read(&copy).unwrap(), b"hallo welt\n");
    assert!(fs::metadata(&copy).unwrap().permissions().readonly());
    // the preview finds the same copy
    assert_eq!(view::for_preview(&entry, None).unwrap(), copy);
    // folders and missing entries are no files to open
    let id = h
        .mgr
        .start(JobSpec::ViewEntry {
            path: s(&a.join("leer")),
        })
        .unwrap();
    assert_eq!(job_error(&h.finish(&id)), FsErrorCode::NotAFile);
    let id = h
        .mgr
        .start(JobSpec::ViewEntry {
            path: s(&a.join("nix")),
        })
        .unwrap();
    assert_eq!(job_error(&h.finish(&id)), FsErrorCode::NotFound);
    // an encrypted entry without the password asks for it
    let e = fixture(d.path(), "zip-aes.zip");
    let id = h
        .mgr
        .start(JobSpec::ViewEntry {
            path: s(&e.join("🎉.txt")),
        })
        .unwrap();
    assert_eq!(
        job_error(&h.finish(&id)),
        FsErrorCode::ArchivePasswordRequired
    );
}

/// A folder opened so its times can be set (Windows needs backup semantics and the
/// right to write attributes; `File::open` of a folder is refused there).
fn open_dir_for_times(dir: &Path) -> fs::File {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_WRITE_ATTRIBUTES: u32 = 0x100;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        fs::OpenOptions::new()
            .access_mode(FILE_WRITE_ATTRIBUTES)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(dir)
            .unwrap()
    }
    #[cfg(not(windows))]
    fs::File::open(dir).unwrap()
}

#[test]
fn the_view_cache_cleans_up_stale_runs() {
    let d = tempdir().unwrap();
    let base = d.path().join("archive-view");
    fs::create_dir_all(base.join("run-1-2-0/1")).unwrap();
    fs::write(base.join("run-1-2-0/1/x.txt"), b"x").unwrap();
    let mut perm = fs::metadata(base.join("run-1-2-0/1/x.txt"))
        .unwrap()
        .permissions();
    perm.set_readonly(true);
    fs::set_permissions(base.join("run-1-2-0/1/x.txt"), perm).unwrap();
    fs::create_dir_all(base.join("other")).unwrap();
    // old enough
    let old = std::time::SystemTime::now() - view::STALE - std::time::Duration::from_secs(60);
    open_dir_for_times(&base.join("run-1-2-0"))
        .set_modified(old)
        .unwrap();
    fs::create_dir_all(base.join("run-3-4-0")).unwrap();
    view::remove_tree(&base.join("does-not-exist")).unwrap_err();
    // `init` changes the global cache base: only check the sweep with a copy of its logic
    super::super::archive::view::init(&base);
    assert!(!base.join("run-1-2-0").exists(), "stale run removed");
    assert!(base.join("run-3-4-0").exists(), "fresh run kept");
    assert!(base.join("other").exists(), "foreign folders kept");
}

#[test]
fn previews_refuse_entries_above_the_limit() {
    let d = tempdir().unwrap();
    let a = d.path().join("gross.zip");
    crate::archive::tests::make_zip(&a, &[crate::archive::tests::E::File("klein.txt", b"k")]);
    // a declared size above the preview limit (the data is not needed for the check)
    let entry = a.join("klein.txt");
    let ok = view::for_preview(&entry, None).unwrap();
    assert_eq!(fs::read(ok).unwrap(), b"k");
    let control = Control::default();
    let r = view::materialize(&entry, 0, "t", &control, &|_| {});
    assert_eq!(r.err().unwrap().code, FsErrorCode::ArchiveTooLarge);
}

#[cfg(feature = "rar")]
mod rar_jobs {
    use super::*;

    #[test]
    fn rar_extracts_and_refuses_slip_links_and_liars() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let a = fixture(d.path(), "rar4-slip.rar");
        let base = d.path().join("base");
        let t = base.join("ziel");
        fs::create_dir_all(&t).unwrap();
        let info = h.unpack(&a, &[], &t);
        assert_eq!(info.state, JobState::DoneWithErrors, "{:?}", info.summary);
        assert_eq!(
            tree(&base),
            vec!["ziel/", "ziel/ok.txt", "ziel/sub/", "ziel/sub/inner.txt"]
        );
        assert_eq!(fs::read(t.join("sub/inner.txt")).unwrap(), b"inner\n");
        let codes: Vec<_> = info
            .summary
            .unwrap()
            .errors
            .iter()
            .map(|e| e.error.code)
            .collect();
        assert!(codes.contains(&FsErrorCode::UnsafeEntry), "{codes:?}");
        // the liar never lands under its name, no temporary files stay
        assert!(!t.join("liar.txt").exists());
        assert!(tree(&base).iter().all(|p| !p.contains(".part")));
    }

    #[test]
    fn rar_with_passwords_and_unicode() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let a = fixture(d.path(), "rar-crypted.rar");
        let t = d.path().join("t");
        fs::create_dir(&t).unwrap();
        assert_eq!(
            job_error(&h.unpack(&a, &[], &t)),
            FsErrorCode::ArchivePasswordRequired
        );
        secrets::remember(&a, Secret::new("falsch"));
        assert_eq!(
            job_error(&h.unpack(&a, &[], &t)),
            FsErrorCode::ArchivePasswordWrong
        );
        archive::set_password(&a, Secret::new("unrar")).unwrap();
        let info = h.unpack(&a, &[], &t);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        assert_eq!(fs::read(t.join(".gitignore")).unwrap().len(), 18);
        let u = fixture(d.path(), "rar-unicode.rar");
        let t2 = d.path().join("t2");
        fs::create_dir(&t2).unwrap();
        let info = h.unpack(&u, &[], &t2);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        assert_eq!(fs::read(t2.join("te…―st✌")).unwrap().len(), 17);
        // a single entry for the view cache
        let v = fixture(d.path(), "rar-version.rar");
        let copy = view::for_preview(&v.join("VERSION"), None).unwrap();
        assert_eq!(fs::read(copy).unwrap().len(), 11);
    }
}

/// External review 025 #4: a file that cannot be written must not leave the
/// rest of its solid block unread (later entries would get wrong data or a
/// "wrong password"). Needs `chattr` (root, ext4/overlay) – skipped elsewhere.
#[test]
fn an_unwritable_entry_does_not_desync_a_solid_block() {
    for (name, pw) in [
        ("sevenzip-solid3.7z", None),
        ("sevenzip-solid3-enc.7z", Some("geheim")),
    ] {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let a = fixture(d.path(), name);
        if let Some(p) = pw {
            archive::set_password(&a, Secret::new(p)).unwrap();
        }
        let t = d.path().join("t");
        fs::create_dir_all(t.join("sub")).unwrap();
        let locked = std::process::Command::new("chattr")
            .arg("+i")
            .arg(t.join("sub"))
            .status()
            .is_ok_and(|s| s.success());
        if !locked {
            eprintln!("chattr not available – skipped");
            return;
        }
        let info = h.unpack(&a, &[], &t);
        let _ = std::process::Command::new("chattr")
            .arg("-i")
            .arg(t.join("sub"))
            .status();
        assert_eq!(
            info.state,
            JobState::DoneWithErrors,
            "{name}: {:?}",
            info.summary
        );
        let sum = info.summary.unwrap();
        assert!(sum.error.is_none(), "{name}: {:?}", sum.error);
        assert!(
            sum.errors
                .iter()
                .all(|e| e.error.code != FsErrorCode::ArchivePasswordWrong
                    && e.error.code != FsErrorCode::ArchiveError),
            "{name}: {:?}",
            sum.errors
        );
        assert_eq!(fs::read(t.join("z.txt")).unwrap().len(), 5000, "{name}");
    }
}

/// Review 025 #5: data that is only skipped stops when the job is cancelled.
#[test]
fn draining_skipped_data_stops_on_cancel() {
    let control = Control::default();
    let mut endless = std::io::repeat(0);
    control.cancel();
    assert!(!extract::drain_for_test(&mut endless, &control).unwrap());
    let fresh = Control::default();
    assert!(extract::drain_for_test(&mut &b"abc"[..], &fresh).unwrap());
}

#[cfg(feature = "rar")]
mod rar_parallel {
    use super::*;

    /// Review 025 #3: a slow (or paused) RAR entry no longer blocks listing another RAR.
    #[test]
    fn a_slow_rar_entry_does_not_block_other_rar_archives() {
        let d = tempdir().unwrap();
        let a = fixture(d.path(), "rar-version.rar");
        let b = d.path().join("other.rar");
        fs::copy(&a, &b).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let t = std::thread::spawn(move || {
            let mut ar = crate::archive::rar::RarArchive::open(&a, None, true, None).unwrap();
            let h = ar.next_header().unwrap().unwrap();
            ar.test_into(&h, &mut |_c| {
                let _ = tx.send(());
                std::thread::sleep(std::time::Duration::from_secs(2));
                true
            })
            .unwrap();
        });
        rx.recv().unwrap(); // the first entry is being decoded
        let start = std::time::Instant::now();
        let (headers, _) = crate::archive::rar::headers(&b, None, 10).unwrap();
        assert_eq!(headers.len(), 1);
        assert!(
            start.elapsed() < std::time::Duration::from_secs(1),
            "listing waited {:?}",
            start.elapsed()
        );
        t.join().unwrap();
    }

    /// Review 025 #5: cancelling reaches data the library only skips.
    #[test]
    fn a_cancelled_rar_test_stops() {
        let d = tempdir().unwrap();
        let a = fixture(d.path(), "rar-version.rar");
        let cancel = std::sync::atomic::AtomicBool::new(true);
        let mut ar = crate::archive::rar::RarArchive::open(&a, None, true, Some(&cancel)).unwrap();
        let h = ar.next_header().unwrap().unwrap();
        assert!(!ar.test_into(&h, &mut |_| true).unwrap());
    }
}
