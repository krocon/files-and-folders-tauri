use super::*;
use crate::archive::tests::{E, make_tar, make_zip};
use crate::archive::{read_index, virtual_path};

use tempfile::tempdir;

fn names(path: &Path) -> Vec<String> {
    let p = path.to_string_lossy();
    let format = if p.ends_with(".gz") {
        ArchiveFormat::TarGz
    } else if p.contains("tar") {
        ArchiveFormat::Tar
    } else {
        ArchiveFormat::Zip
    };
    let mut v: Vec<String> = crate::archive::read_index_as(
        path,
        format,
        std::time::Instant::now() + std::time::Duration::from_secs(30),
    )
    .unwrap()
    .entries
    .iter()
    .map(|e| e.name.join("/"))
    .collect();
    v.sort();
    v
}

fn tick_all() -> impl FnMut(u64) -> bool {
    |_| true
}

fn new_file(dir: &Path, name: &str, data: &[u8], inner: &[&str]) -> NewEntry {
    let p = dir.join(name);
    fs::write(&p, data).unwrap();
    NewEntry {
        name: inner.iter().map(|s| s.to_string()).collect(),
        source: Some(p),
        len: data.len() as u64,
        mode: 0o644,
        modified: Some(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000)),
    }
}

fn dir_entry(inner: &[&str]) -> NewEntry {
    NewEntry {
        name: inner.iter().map(|s| s.to_string()).collect(),
        source: None,
        len: 0,
        mode: 0o755,
        modified: None,
    }
}

/// CRC and raw (compressed) bytes of every entry – unchanged entries must be bit-identical.
fn zip_raw(path: &Path) -> Vec<(String, u32, Vec<u8>)> {
    let mut za = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
    let mut out = Vec::new();
    for i in 0..za.len() {
        let mut f = za.by_index_raw(i).unwrap();
        let mut raw = Vec::new();
        f.read_to_end(&mut raw).unwrap();
        out.push((f.name().unwrap().into_owned(), f.crc32(), raw));
    }
    out
}

#[test]
fn zip_add_delete_keeps_the_rest_bit_identical() {
    let d = tempdir().unwrap();
    let a = d.path().join("a.zip");
    make_zip(
        &a,
        &[
            E::File("keep.txt", b"keep me"),
            E::Dir("dir/"),
            E::File("dir/gone.txt", b"bye"),
            E::File("dir/stay.txt", &[7u8; 5000]),
        ],
    );
    let before = zip_raw(&a);
    let tmp = d.path().join(".t.part");
    let change = Change {
        remove: vec![vec!["dir".into(), "gone.txt".into()]],
        add: vec![
            new_file(
                d.path(),
                "src.txt",
                b"neu \xc3\xa4",
                &["dir", "grüße 🎉.txt"],
            ),
            dir_entry(&["leer"]),
        ],
    };
    rewrite(&a, ArchiveFormat::Zip, &change, None, &tmp, &mut tick_all()).unwrap();
    assert_eq!(
        names(&tmp),
        vec![
            "dir",
            "dir/grüße 🎉.txt",
            "dir/stay.txt",
            "keep.txt",
            "leer"
        ]
    );
    let after = zip_raw(&tmp);
    for b in before.iter().filter(|b| b.0 != "dir/gone.txt") {
        assert!(after.contains(b), "{} changed", b.0);
    }
    let mut za = zip::ZipArchive::new(File::open(&tmp).unwrap()).unwrap();
    let mut s = String::new();
    za.by_name("dir/grüße 🎉.txt")
        .unwrap()
        .read_to_string(&mut s)
        .unwrap();
    assert_eq!(s, "neu ä");
}

#[test]
fn zip_keeps_encrypted_entries_and_encrypts_new_ones() {
    let d = tempdir().unwrap();
    let a = d.path().join("aes.zip");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/archive/testdata/zip-aes.zip"),
        &a,
    )
    .unwrap();
    let pw = Secret::new("geheim");
    let tmp = d.path().join(".t.part");
    let change = Change {
        remove: vec![],
        add: vec![new_file(d.path(), "x", b"secret new", &["neu.txt"])],
    };
    rewrite(
        &a,
        ArchiveFormat::Zip,
        &change,
        Some(&pw),
        &tmp,
        &mut tick_all(),
    )
    .unwrap();
    let mut za = zip::ZipArchive::new(File::open(&tmp).unwrap()).unwrap();
    assert!(za.by_name("neu.txt").is_err(), "needs the password");
    let mut s = String::new();
    za.by_name_decrypt("neu.txt", b"geheim")
        .unwrap()
        .read_to_string(&mut s)
        .unwrap();
    assert_eq!(s, "secret new");
    let mut old = String::new();
    za.by_name_decrypt("Ünïcödé dir/grüße.txt", b"geheim")
        .unwrap()
        .read_to_string(&mut old)
        .unwrap();
    assert!(!old.is_empty());
}

#[test]
fn tar_and_tgz_round_trip_with_unicode_names() {
    for gz in [false, true] {
        let d = tempdir().unwrap();
        let a = d.path().join(if gz { "a.tar.gz" } else { "a.tar" });
        let long = format!("{}/file.txt", "x".repeat(150)); // a GNU long name
        make_tar(
            &a,
            &[
                E::File("keep.txt", b"keep"),
                E::Dir("old/"),
                E::File("old/x.txt", b"x"),
            ],
            gz,
        );
        let format = if gz {
            ArchiveFormat::TarGz
        } else {
            ArchiveFormat::Tar
        };
        let tmp = d.path().join(".t.part");
        let change = Change {
            remove: vec![vec!["old".into()]],
            add: vec![
                dir_entry(&["Ördner 📁"]),
                new_file(d.path(), "s1", b"umlaut", &["Ördner 📁", "ä ö ü.txt"]),
                new_file(d.path(), "s2", &[1u8; 70_000], &[&long]),
            ],
        };
        rewrite(&a, format, &change, None, &tmp, &mut tick_all()).unwrap();
        let tmp2 = d.path().join(if gz { "b.tar.gz" } else { "b.tar" });
        fs::rename(&tmp, &tmp2).unwrap();
        assert_eq!(
            names(&tmp2),
            vec![
                "keep.txt".to_string(),
                long.clone(),
                "Ördner 📁".into(),
                "Ördner 📁/ä ö ü.txt".into()
            ]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
        );
        // a second rewrite keeps the long name and the new entries byte for byte
        let tmp3 = d.path().join(".t3.part");
        let change = Change {
            remove: vec![vec!["keep.txt".into()]],
            add: vec![],
        };
        rewrite(&tmp2, format, &change, None, &tmp3, &mut tick_all()).unwrap();
        let fresh = d.path().join(if gz { "c.tar.gz" } else { "c.tar" });
        fs::rename(&tmp3, &fresh).unwrap();
        let mut stream = tar_stream(File::open(&fresh).unwrap(), format, 1 << 30);
        let mut ar = tar::Archive::new(&mut stream);
        let mut found = 0;
        for e in ar.entries().unwrap() {
            let mut e = e.unwrap();
            let p = e.path().unwrap().to_string_lossy().into_owned();
            if p == long {
                let mut v = Vec::new();
                e.read_to_end(&mut v).unwrap();
                assert_eq!(v, vec![1u8; 70_000]);
                found += 1;
            }
        }
        assert_eq!(found, 1);
    }
}

#[test]
fn cancel_stops_and_the_original_is_untouched() {
    let d = tempdir().unwrap();
    let a = d.path().join("big.tar");
    let big = vec![3u8; 8 << 20];
    make_tar(&a, &[E::File("big.bin", &big)], false);
    let orig = fs::read(&a).unwrap();
    let tmp = d.path().join(".t.part");
    let mut n = 0u64;
    let mut tick = |b: u64| {
        n += b;
        n < (2 << 20)
    };
    let change = Change {
        remove: vec![],
        add: vec![dir_entry(&["x"])],
    };
    assert!(matches!(
        rewrite(&a, ArchiveFormat::Tar, &change, None, &tmp, &mut tick),
        Err(Fail::Cancelled)
    ));
    assert_eq!(fs::read(&a).unwrap(), orig);
}

#[test]
fn what_cannot_be_judged_is_refused() {
    let d = tempdir().unwrap();
    // unsafe names
    let a = d.path().join("slip.zip");
    make_zip(&a, &[E::File("../evil.txt", b"x"), E::File("ok.txt", b"y")]);
    assert_eq!(writable(&a).unwrap_err().code, FsErrorCode::ArchiveReadOnly);
    // two entries of one name
    let a = d.path().join("dup.tar");
    make_tar(&a, &[E::File("x.txt", b"1"), E::File("x.txt", b"2")], false);
    assert_eq!(writable(&a).unwrap_err().code, FsErrorCode::ArchiveReadOnly);
    // data before the ZIP (self-extracting)
    let ok = d.path().join("ok.zip");
    make_zip(&ok, &[E::File("a.txt", b"a")]);
    let sfx = d.path().join("sfx.zip");
    let mut f = File::create(&sfx).unwrap();
    f.write_all(&[0u8; 4096]).unwrap();
    f.write_all(&fs::read(&ok).unwrap()).unwrap();
    drop(f);
    if read_index(&sfx).is_ok() {
        assert_eq!(
            writable(&sfx).unwrap_err().code,
            FsErrorCode::ArchiveReadOnly
        );
    }
    // 7z and RAR
    let seven = d.path().join("s.7z");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/archive/testdata/sevenzip-solid.7z"),
        &seven,
    )
    .unwrap();
    assert_eq!(
        writable(&seven).unwrap_err().code,
        FsErrorCode::ArchiveReadOnly
    );
    // a link to an archive
    #[cfg(unix)]
    {
        let link = d.path().join("link.zip");
        std::os::unix::fs::symlink(&ok, &link).unwrap();
        assert_eq!(
            writable(&link).unwrap_err().code,
            FsErrorCode::ArchiveReadOnly
        );
    }
    assert!(writable(&ok).is_ok());
    let _ = virtual_path(&ok, &["a.txt".into()]);
}
