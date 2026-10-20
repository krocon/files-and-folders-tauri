//! Tests of design 025 at the index level: 7z and RAR listing, passwords,
//! dictionary limits, ZIP times, the view cache. Fixtures: `testdata/`
//! (origin in `testdata/README.md`); job-level tests in `jobs/tests_formats.rs`.

use super::*;
use tempfile::tempdir;

/// A fixture copied to a fresh folder (the password store is keyed by path).
pub(crate) fn fixture(dir: &Path, name: &str) -> PathBuf {
    let src = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/archive/testdata")
        .join(name);
    let dst = dir.join(name);
    fs::copy(&src, &dst).unwrap();
    dst
}

fn names(l: &DirectoryListing) -> Vec<(String, EntryKind)> {
    let mut v: Vec<_> = l.entries.iter().map(|e| (e.name.clone(), e.kind)).collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

fn code(r: Result<impl std::fmt::Debug, FsError>) -> FsErrorCode {
    r.unwrap_err().code
}

#[test]
fn seven_zip_and_rar_names() {
    assert_eq!(format_of_name("Fotos.7Z"), Some(ArchiveFormat::SevenZ));
    assert_eq!(format_of_name(".7z"), None);
    #[cfg(feature = "rar")]
    assert_eq!(format_of_name("a.RAR"), Some(ArchiveFormat::Rar));
    assert_eq!(stem_of("Fotos 2024.7z"), "Fotos 2024");
    assert_eq!(stem_of("x.rar"), "x");
    assert_eq!(
        serde_json::to_value(ArchiveFormat::SevenZ).unwrap(),
        "sevenZ"
    );
    assert_eq!(ArchiveFormat::SevenZ.max_ratio(), MAX_RATIO_STRONG);
    assert_eq!(ArchiveFormat::TarGz.max_ratio(), MAX_RATIO);
}

#[test]
fn a_7z_made_by_7zip_lists_like_a_folder() {
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "sevenzip-solid.7z");
    let root = list_directory_or_archive(&a).unwrap();
    let info = root.archive.as_ref().unwrap();
    assert_eq!(info.format, ArchiveFormat::SevenZ);
    assert!(!info.encrypted);
    assert_eq!(
        names(&root),
        vec![
            ("empty.txt".into(), EntryKind::File),
            ("leer".into(), EntryKind::Directory),
            ("Ünïcödé dir".into(), EntryKind::Directory),
            ("🎉.txt".into(), EntryKind::File),
        ]
    );
    let sub = list_directory_or_archive(&a.join("Ünïcödé dir")).unwrap();
    assert_eq!(
        names(&sub),
        vec![
            ("grüße.txt".into(), EntryKind::File),
            ("sub".into(), EntryKind::Directory),
        ]
    );
    let f = sub.entries.iter().find(|e| e.name == "grüße.txt").unwrap();
    assert_eq!(f.size, Some(11));
    assert!(f.modified_ms.is_some());
}

#[test]
fn encrypted_7z_names_need_the_password() {
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "sevenzip-enc-names.7z");
    assert_eq!(
        code(list_directory_or_archive(&a)),
        FsErrorCode::ArchivePasswordRequired
    );
    assert_eq!(
        code(set_password(&a, secrets::Secret::new("falsch"))),
        FsErrorCode::ArchivePasswordWrong
    );
    assert!(!secrets::known(&a));
    set_password(&a, secrets::Secret::new("geheim")).unwrap();
    let root = list_directory_or_archive(&a).unwrap();
    let info = root.archive.as_ref().unwrap();
    assert!(info.encrypted && info.password_known);
    assert_eq!(root.entries.len(), 4);
}

#[test]
fn encrypted_7z_data_lists_without_the_password() {
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "sevenzip-enc-data.7z");
    let root = list_directory_or_archive(&a).unwrap();
    let info = root.archive.as_ref().unwrap();
    assert!(info.encrypted && !info.password_known);
    assert_eq!(
        code(set_password(&a, secrets::Secret::new("falsch"))),
        FsErrorCode::ArchivePasswordWrong
    );
    // a virtual path (F3 on an entry) stands for its archive
    set_password(&a.join("🎉.txt"), secrets::Secret::new("geheim")).unwrap();
    assert!(secrets::known(&a));
}

#[test]
fn zip_aes_and_zipcrypto_passwords_are_checked() {
    let d = tempdir().unwrap();
    for name in ["zip-aes.zip", "zip-crypto.zip"] {
        let a = fixture(d.path(), name);
        let root = list_directory_or_archive(&a).unwrap();
        assert!(root.archive.as_ref().unwrap().encrypted, "{name}");
        assert_eq!(
            code(set_password(&a, secrets::Secret::new("falsch"))),
            FsErrorCode::ArchivePasswordWrong,
            "{name}"
        );
        set_password(&a, secrets::Secret::new("geheim")).unwrap();
        assert!(secrets::known(&a));
    }
    // TAR has no password: accepted (nothing to check), an empty one never
    let t = d.path().join("x.tar");
    tests::make_tar(&t, &[tests::E::File("a", b"a")], false);
    assert_eq!(
        code(set_password(&t, secrets::Secret::new(""))),
        FsErrorCode::ArchivePasswordWrong
    );
}

#[test]
fn seven_zip_entries_go_through_the_name_check() {
    use sevenz_rust2::{ArchiveEntry, ArchiveWriter};
    let d = tempdir().unwrap();
    let a = d.path().join("slip.7z");
    let mut w = ArchiveWriter::create(&a).unwrap();
    for (n, data) in [
        ("ok/inhalt.txt", &b"gut"[..]),
        ("../evil.txt", b"evil"),
        ("/abs.txt", b"abs"),
        ("C:\\evil.txt", b"evil"),
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
    let index = read_index(&a).unwrap();
    assert_eq!(index.unsafe_entries, 3);
    assert_eq!(index.total_entries, 5);
    let ok = list_directory_or_archive(&a.join("ok")).unwrap();
    assert_eq!(
        names(&ok),
        vec![
            ("inhalt.txt".into(), EntryKind::File),
            ("link".into(), EntryKind::Symlink)
        ]
    );
}

#[test]
fn seven_zip_dictionaries_above_one_gib_are_refused() {
    use sevenz_rust2::EncoderMethod as M;
    // LZMA2: byte 40 = 4 GiB − 1, 24 = 16 MiB
    assert_eq!(sevenz::memory_need(M::ID_LZMA2, &[24]), Some(16 << 20));
    assert!(sevenz::memory_need(M::ID_LZMA2, &[38]).unwrap() > MAX_DICT);
    assert_eq!(sevenz::memory_need(M::ID_LZMA2, &[41]), Some(u64::MAX));
    // LZMA / PPMd: little-endian size after the first byte
    let four_gib = [0x5d, 0xff, 0xff, 0xff, 0xff];
    assert!(sevenz::memory_need(M::ID_LZMA, &four_gib).unwrap() > MAX_DICT);
    assert_eq!(
        sevenz::memory_need(M::ID_PPMD, &[6, 0, 0, 0, 1]),
        Some(1 << 24)
    );
    assert_eq!(
        sevenz::memory_need(M::ID_LZMA, &[0x5d]),
        None,
        "short: no claim"
    );
    assert_eq!(sevenz::memory_need(M::ID_COPY, &[]), None);
}

#[test]
fn a_broken_7z_is_an_archive_error() {
    let d = tempdir().unwrap();
    let a = d.path().join("kaputt.7z");
    let mut data = fs::read(fixture(d.path(), "sevenzip-solid.7z")).unwrap();
    let n = data.len();
    data.truncate(n - 20);
    fs::write(&a, data).unwrap();
    assert_eq!(code(read_index(&a)), FsErrorCode::ArchiveError);
    fs::write(&a, b"7z? no").unwrap();
    assert_eq!(code(read_index(&a)), FsErrorCode::ArchiveError);
}

#[test]
fn deflate_ratio_applies_to_zip_and_the_strong_ratio_to_7z() {
    let limit = |f| unpack_limit_for(f, 1000);
    assert_eq!(limit(ArchiveFormat::Zip), 1000 * MAX_RATIO + RATIO_SLACK);
    assert_eq!(
        limit(ArchiveFormat::SevenZ),
        1000 * MAX_RATIO_STRONG + RATIO_SLACK
    );
    assert_eq!(unpack_limit(u64::MAX), MAX_TOTAL_SIZE);
}

/// Design 025 E7: our ZIPs carry the Extended Timestamp – exact to the second
/// whatever the time zone; the DOS time is local time.
#[test]
fn zip_times_come_from_the_extended_timestamp() {
    let d = tempdir().unwrap();
    let t = UNIX_EPOCH + Duration::from_secs(1_700_000_001); // odd second: DOS has 2 s steps
    let ext = zip_ext_time(Some(t)).unwrap();
    assert_eq!(ext[0], 1);
    let a = d.path().join("t.zip");
    {
        let mut z = zip::ZipWriter::new(File::create(&a).unwrap());
        let mut o = zip::write::FullFileOptions::default().last_modified_time(zip_time(Some(t)));
        o.add_extra_field(0x5455, ext, false).unwrap();
        z.start_file("a.txt", o).unwrap();
        std::io::Write::write_all(&mut z, b"x").unwrap();
        z.finish().unwrap();
    }
    let mut za = zip::ZipArchive::new(File::open(&a).unwrap()).unwrap();
    let f = za.by_index(0).unwrap();
    assert_eq!(zip_mtime_ms(&f), Some(1_700_000_001_000));
    // without the field: the DOS time read back as local time (2 s steps)
    let dos = zip_ms(zip_time(Some(t))).unwrap();
    assert_eq!(dos, 1_700_000_000_000);
}

#[cfg(feature = "rar")]
mod rar_tests {
    use super::*;

    #[test]
    fn the_unrar_library_is_linked() {
        assert!(rar::dll_version() >= 8);
    }

    #[test]
    fn a_rar_lists_like_a_folder() {
        let d = tempdir().unwrap();
        let a = fixture(d.path(), "rar-version.rar");
        let root = list_directory_or_archive(&a).unwrap();
        assert_eq!(root.archive.as_ref().unwrap().format, ArchiveFormat::Rar);
        assert_eq!(names(&root), vec![("VERSION".into(), EntryKind::File)]);
        assert_eq!(root.entries[0].size, Some(11));
        let u = fixture(d.path(), "rar-unicode.rar");
        let root = list_directory_or_archive(&u).unwrap();
        assert_eq!(root.entries[0].name, "te…―st✌");
    }

    #[test]
    fn rar_names_go_through_the_name_check() {
        let d = tempdir().unwrap();
        let a = fixture(d.path(), "rar4-slip.rar");
        let index = read_index(&a).unwrap();
        assert_eq!(index.unsafe_entries, 2, "../evil.txt and /abs.txt");
        let root = list(&a, &[]).unwrap();
        assert_eq!(
            names(&root),
            vec![
                ("liar.txt".into(), EntryKind::File),
                ("link".into(), EntryKind::Symlink),
                ("ok.txt".into(), EntryKind::File),
                ("sub".into(), EntryKind::Directory),
            ]
        );
    }

    #[test]
    fn rar_passwords() {
        let d = tempdir().unwrap();
        // encrypted data, open names
        let a = fixture(d.path(), "rar-crypted.rar");
        let root = list_directory_or_archive(&a).unwrap();
        assert!(root.archive.as_ref().unwrap().encrypted);
        assert_eq!(
            code(set_password(&a, secrets::Secret::new("falsch"))),
            FsErrorCode::ArchivePasswordWrong
        );
        set_password(&a, secrets::Secret::new("unrar")).unwrap();
        // encrypted names
        let h = fixture(d.path(), "rar-comment-hpw-password.rar");
        assert_eq!(
            code(list_directory_or_archive(&h)),
            FsErrorCode::ArchivePasswordRequired
        );
        assert_eq!(
            code(set_password(&h, secrets::Secret::new("falsch"))),
            FsErrorCode::ArchivePasswordWrong
        );
        set_password(&h, secrets::Secret::new("password")).unwrap();
        let root = list_directory_or_archive(&h).unwrap();
        assert!(!root.entries.is_empty());
        assert!(root.archive.as_ref().unwrap().password_known);
    }

    #[test]
    fn not_a_rar_is_an_error() {
        let d = tempdir().unwrap();
        let a = d.path().join("x.rar");
        fs::write(&a, b"not a rar at all").unwrap();
        assert_eq!(code(read_index(&a)), FsErrorCode::ArchiveError);
    }
}

/// External review 025 #1/#2: a 7z header that unpacks to gigabytes or declares
/// millions of files is refused before `sevenz-rust2` reads it (`bomb-*.7z`,
/// made by `testdata/make_7z_bombs.py`).
#[test]
fn seven_zip_header_bombs_are_refused_before_reading() {
    let d = tempdir().unwrap();
    let big = fixture(d.path(), "bomb-header.7z");
    let e = read_index(&big).unwrap_err();
    assert_eq!(e.code, FsErrorCode::ArchiveTooLarge, "{e:?}");
    assert!(e.message.contains("header"), "{}", e.message);
    let many = fixture(d.path(), "bomb-files.7z");
    let e = read_index(&many).unwrap_err();
    assert_eq!(e.code, FsErrorCode::ArchiveTooLarge, "{e:?}");
    assert!(e.message.contains("2000000"), "{}", e.message);
    // the password check reads the header too
    assert_eq!(
        set_password(&many, secrets::Secret::new("x"))
            .unwrap_err()
            .code,
        FsErrorCode::ArchiveTooLarge
    );
    // real archives pass, with their file count (plain and encoded headers)
    for (name, n) in [("sevenzip-solid.7z", 7), ("sevenzip-enc-data.7z", 7)] {
        let a = fixture(d.path(), name);
        assert_eq!(
            sevenz_header::check(&a).unwrap(),
            sevenz_header::HeaderCheck::Files(Some(n)),
            "{name}"
        );
    }
    // encrypted names: only the size can be checked
    let h = fixture(d.path(), "sevenzip-enc-names.7z");
    assert_eq!(
        sevenz_header::check(&h).unwrap(),
        sevenz_header::HeaderCheck::Files(None)
    );
}

/// Review 025 #8: a block up to 16 MiB is decoded completely for the check.
#[test]
fn a_wrong_7z_password_fails_on_a_whole_small_solid_block() {
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "sevenzip-solid3-enc.7z");
    assert_eq!(
        set_password(&a, secrets::Secret::new("falsch"))
            .unwrap_err()
            .code,
        FsErrorCode::ArchivePasswordWrong
    );
    set_password(&a, secrets::Secret::new("geheim")).unwrap();
}

#[cfg(feature = "rar")]
#[test]
fn rar_passwords_longer_than_unrar_takes_are_refused_clearly() {
    let d = tempdir().unwrap();
    let a = fixture(d.path(), "rar-crypted.rar");
    let e = set_password(&a, secrets::Secret::new("x".repeat(600))).unwrap_err();
    assert_eq!(e.code, FsErrorCode::ArchivePasswordWrong);
    assert!(e.message.contains("511"), "{}", e.message);
    assert!(!secrets::known(&a));
}
