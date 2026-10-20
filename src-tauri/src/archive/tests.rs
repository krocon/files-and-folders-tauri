//! Tests of the archive index, names, limits and listing (design 016). The
//! builders below are used by `jobs/tests_archive.rs` as well.

use super::*;
use std::io::Write;
use tempfile::tempdir;

/// One entry of a test archive.
pub(crate) enum E<'a> {
    File(&'a str, &'a [u8]),
    Dir(&'a str),
    Link(&'a str, &'a str),
}

/// A ZIP with raw entry names (unsafe names on purpose).
pub(crate) fn make_zip(path: &Path, entries: &[E<'_>]) {
    let mut z = zip::ZipWriter::new(File::create(path).unwrap());
    let o = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for e in entries {
        match e {
            E::File(n, data) => {
                z.start_file(*n, o).unwrap();
                z.write_all(data).unwrap();
            }
            E::Dir(n) => z.add_directory(*n, o).unwrap(),
            E::Link(n, target) => z.add_symlink(*n, *target, o).unwrap(),
        }
    }
    z.finish().unwrap();
}

/// A TAR (or TAR.GZ) with raw names – written into the header bytes, so `..`
/// and absolute names get through (the `tar` builder refuses them).
pub(crate) fn make_tar(path: &Path, entries: &[E<'_>], gz: bool) {
    let mut data: Vec<u8> = Vec::new();
    {
        let mut b = tar::Builder::new(&mut data);
        for e in entries {
            let mut h = tar::Header::new_gnu();
            let (name, body, kind): (&str, &[u8], tar::EntryType) = match e {
                E::File(n, d) => (n, d, tar::EntryType::Regular),
                E::Dir(n) => (n, b"", tar::EntryType::Directory),
                E::Link(n, t) => {
                    h.set_link_name(t).unwrap();
                    (n, b"", tar::EntryType::Symlink)
                }
            };
            let raw = &mut h.as_gnu_mut().unwrap().name;
            raw.fill(0);
            raw[..name.len()].copy_from_slice(name.as_bytes());
            h.set_entry_type(kind);
            h.set_size(body.len() as u64);
            h.set_mode(0o640);
            h.set_mtime(1_700_000_000);
            h.set_cksum();
            b.append(&h, body).unwrap();
        }
        b.finish().unwrap();
    }
    let mut f = File::create(path).unwrap();
    if gz {
        let mut enc = flate2::write::GzEncoder::new(f, flate2::Compression::default());
        enc.write_all(&data).unwrap();
        enc.finish().unwrap();
    } else {
        f.write_all(&data).unwrap();
    }
}

fn names(l: &DirectoryListing) -> Vec<(&str, EntryKind)> {
    l.entries
        .iter()
        .map(|e| (e.name.as_str(), e.kind))
        .collect()
}

#[test]
fn formats_by_name() {
    assert_eq!(format_of_name("a.ZIP"), Some(ArchiveFormat::Zip));
    assert_eq!(format_of_name("a.tar"), Some(ArchiveFormat::Tar));
    assert_eq!(format_of_name("a.tar.gz"), Some(ArchiveFormat::TarGz));
    assert_eq!(format_of_name("a.tgz"), Some(ArchiveFormat::TarGz));
    assert_eq!(format_of_name(".zip"), None);
    assert_eq!(format_of_name("a.gz"), None);
    assert_eq!(stem_of("Fotos 2024.tar.gz"), "Fotos 2024");
    assert_eq!(stem_of("x.ZIP"), "x");
    assert_eq!(stem_of("x.tgz"), "x");
}

#[test]
fn unsafe_names_are_refused() {
    assert_eq!(sanitize("a/b/c.txt").unwrap(), ["a", "b", "c.txt"]);
    assert_eq!(sanitize("./a//b/").unwrap(), ["a", "b"]);
    assert_eq!(
        sanitize("a\\b.txt").unwrap(),
        ["a", "b.txt"],
        "backslash = separator"
    );
    assert_eq!(sanitize("Ünïcödé 🎉/x").unwrap(), ["Ünïcödé 🎉", "x"]);
    assert!(sanitize("./").unwrap().is_empty());
    for bad in [
        "../evil.txt",
        "a/../../evil",
        "a\\..\\..\\evil",
        "/etc/passwd",
        "\\\\server\\share\\x",
        "C:\\Windows\\x",
        "C:x",
        "a/b:stream",
        "a\0b",
        "a/\u{1}b",
        "..",
    ] {
        assert!(sanitize(bad).is_err(), "{bad:?} must be refused");
    }
}

#[test]
fn zip_times_round_trip() {
    let t = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    let z = zip_time(Some(t));
    assert_eq!(zip_ms(z), Some(1_700_000_000_000));
    assert_eq!(days_from_civil(1970, 1, 1), 0);
    assert_eq!(civil_from_days(19_000), (2022, 1, 8));
}

#[test]
fn zip_with_unicode_names_and_implicit_folders_lists_like_a_folder() {
    let d = tempdir().unwrap();
    let z = d.path().join("Ärchiv 📦.zip");
    make_zip(
        &z,
        &[
            E::File("Bücher/Über alles.txt", b"hallo"),
            E::File("Bücher/Unter ordner/tief.txt", b"12345678"),
            E::Dir("leer/"),
            E::File("wurzel.txt", b"x"),
            E::File(".versteckt", b""),
            E::File("../zip-slip.txt", b"evil"),
            E::File("/abs.txt", b"evil"),
            E::Link("link", "/etc/passwd"),
        ],
    );
    let l = list(&z, &[]).unwrap();
    assert_eq!(
        names(&l),
        vec![
            ("Bücher", EntryKind::Directory),
            ("leer", EntryKind::Directory),
            (".versteckt", EntryKind::File),
            ("link", EntryKind::Symlink),
            ("wurzel.txt", EntryKind::File),
        ]
    );
    let info = l.archive.as_ref().unwrap();
    assert_eq!(info.unsafe_entries, 2);
    assert_eq!(info.entries, 8);
    assert_eq!(info.inner, "");
    assert_eq!(l.path, z.to_string_lossy());
    assert_eq!(l.parent.as_deref(), Some(&*d.path().to_string_lossy()));
    let buecher = &l.entries[0];
    assert_eq!(
        buecher.size,
        Some(13),
        "folder size = sum of the files below"
    );
    assert_eq!(buecher.path, z.join("Bücher").to_string_lossy());
    assert!(l.entries[2].hidden);

    let inner = list(&z, &["Bücher".into()]).unwrap();
    assert_eq!(
        names(&inner),
        vec![
            ("Unter ordner", EntryKind::Directory),
            ("Über alles.txt", EntryKind::File)
        ]
    );
    assert_eq!(inner.parent.as_deref(), Some(&*z.to_string_lossy()));
    assert_eq!(inner.archive.as_ref().unwrap().inner, "Bücher");
    let segs: Vec<&str> = inner.segments.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(&segs[segs.len() - 2..], ["Ärchiv 📦.zip", "Bücher"]);
    assert_eq!(
        list(&z, &["fehlt".into()]).unwrap_err().code,
        FsErrorCode::NotFound
    );
}

#[test]
fn virtual_paths_resolve_through_list_directory() {
    let d = tempdir().unwrap();
    fs::create_dir(d.path().join("echt.zip")).unwrap(); // a folder named like an archive stays a folder
    let t = d.path().join("a.tar.gz");
    make_tar(&t, &[E::File("x/y/z.txt", b"tar")], true);
    let l = list_directory_or_archive(&t.join("x")).unwrap();
    assert_eq!(names(&l), vec![("y", EntryKind::Directory)]);
    assert_eq!(l.archive.as_ref().unwrap().format, ArchiveFormat::TarGz);
    let l = list_directory_or_archive(&t.join("x").join("y")).unwrap();
    assert_eq!(l.entries[0].size, Some(3));
    let real = list_directory_or_archive(&d.path().join("echt.zip")).unwrap();
    assert!(real.archive.is_none());
    assert_eq!(
        resolve(&t.join("x/y")),
        Some((t.clone(), vec!["x".to_string(), "y".into()]))
    );
    assert_eq!(resolve(&d.path().join("echt.zip/nix")), None);
    assert_eq!(resolve(&d.path().join("fehlt/x")), None);
    fs::write(d.path().join("text.txt"), "x").unwrap();
    assert_eq!(
        list_directory_or_archive(&d.path().join("text.txt"))
            .unwrap_err()
            .code,
        FsErrorCode::NotADirectory
    );
    assert_eq!(
        inner_of(&t, &t.join("x").join("y")),
        Some(vec!["x".to_string(), "y".into()])
    );
    assert_eq!(inner_of(&t, d.path()), None);
}

#[test]
fn tar_names_and_links_are_checked() {
    let d = tempdir().unwrap();
    let t = d.path().join("a.tar");
    make_tar(
        &t,
        &[
            E::Dir("ordner/"),
            E::File("ordner/datei.txt", b"inhalt"),
            E::File("../../böse.txt", b"evil"),
            E::File("/etc/cron.d/x", b"evil"),
            E::Link("ordner/link", "/etc"),
        ],
        false,
    );
    let index = read_index(&t).unwrap();
    assert_eq!(index.unsafe_entries, 2);
    assert_eq!(index.total_entries, 5);
    let link = index
        .entries
        .iter()
        .find(|e| e.name == ["ordner", "link"])
        .unwrap();
    assert_eq!(link.kind, EntryType::Link);
    assert_eq!(index.entries[1].modified_ms, Some(1_700_000_000_000));
    assert_eq!(index.entries[1].mode, Some(0o640));
}

#[test]
fn broken_archives_are_errors() {
    let d = tempdir().unwrap();
    let z = d.path().join("kaputt.zip");
    fs::write(&z, b"PK\x03\x04 not really").unwrap();
    assert_eq!(read_index(&z).unwrap_err().code, FsErrorCode::ArchiveError);
    let t = d.path().join("kaputt.tgz");
    fs::write(&t, b"\x1f\x8b\x08 not gzip").unwrap();
    assert_eq!(read_index(&t).unwrap_err().code, FsErrorCode::ArchiveError);
}

fn entry(size: u64) -> IndexEntry {
    IndexEntry {
        name: vec!["x".into()],
        kind: EntryType::File,
        size,
        modified_ms: None,
        mode: None,
        pos: 0,
        encrypted: false,
    }
}

#[test]
fn zip_bombs_are_refused() {
    let d = tempdir().unwrap();
    // 8 MiB of zeros deflate to ~8 KiB (≈ 1 000 : 1): a legal archive
    let ok = d.path().join("zeros.zip");
    make_zip(&ok, &[E::File("zeros.bin", &vec![0u8; 8 << 20])]);
    assert!(read_index(&ok).is_ok());
    // declared sizes far beyond what the archive can hold (overlapping entries, lying headers)
    let p = Path::new("/x.zip");
    let mut index = ArchiveIndex {
        format: ArchiveFormat::Zip,
        entries: vec![entry(1 << 30), entry(1 << 30)],
        unsafe_entries: 0,
        total_entries: 2,
        archive_size: 42_000,
        name_bytes: 0,
        encrypted: false,
    };
    assert_eq!(
        check_limits(&index, p).unwrap_err().code,
        FsErrorCode::ArchiveTooLarge
    );
    index.archive_size = 2 << 20; // 2 GiB from 2 MiB: ~1 000 : 1, allowed
    assert!(check_limits(&index, p).is_ok());
    // absolute limit, whatever the ratio
    index.archive_size = 1 << 40;
    index.entries = vec![entry(MAX_TOTAL_SIZE), entry(1)];
    assert_eq!(
        check_limits(&index, p).unwrap_err().code,
        FsErrorCode::ArchiveTooLarge
    );
    // a gzip stream is cut once it produces more than its limit
    let mut r = LimitedReader {
        inner: io::repeat(0),
        read: 0,
        limit: 1000,
    };
    let err = io::copy(&mut r, &mut io::sink()).unwrap_err();
    assert_eq!(tar_error(&err, p).code, FsErrorCode::ArchiveTooLarge);
    assert_eq!(unpack_limit(1), MAX_RATIO + RATIO_SLACK);
    assert_eq!(unpack_limit(u64::MAX), MAX_TOTAL_SIZE);
}

#[test]
fn too_many_entries_are_refused() {
    let d = tempdir().unwrap();
    let t = d.path().join("viele.tar");
    // only the header count matters: MAX_ENTRIES + 1 empty files
    let names: Vec<String> = (0..=MAX_ENTRIES).map(|i| format!("{i}")).collect();
    let entries: Vec<E<'_>> = names.iter().map(|n| E::File(n, b"")).collect();
    make_tar(&t, &entries, false);
    assert_eq!(
        read_index(&t).unwrap_err().code,
        FsErrorCode::ArchiveTooLarge
    );
}

#[test]
fn the_cache_notices_a_changed_archive() {
    let d = tempdir().unwrap();
    let z = d.path().join("c.zip");
    make_zip(&z, &[E::File("eins", b"1")]);
    assert_eq!(list(&z, &[]).unwrap().entries.len(), 1);
    make_zip(&z, &[E::File("eins", b"1"), E::File("zwei", b"22")]);
    // another size → another key
    assert_eq!(list(&z, &[]).unwrap().entries.len(), 2);
}

/// A PAX record `"<len> key=value\n"` (the length counts itself).
fn pax_record(key: &str, value: &str) -> Vec<u8> {
    let body = format!(" {key}={value}\n");
    let mut len = body.len() + 1;
    while format!("{len}").len() + body.len() != len {
        len += 1;
    }
    format!("{len}{body}").into_bytes()
}

fn meta_header(kind: tar::EntryType, name: &str, size: usize) -> tar::Header {
    let mut h = tar::Header::new_ustar();
    h.set_path(name).unwrap();
    h.set_entry_type(kind);
    h.set_size(size as u64);
    h.set_mode(0o644);
    h.set_cksum();
    h
}

/// The long name of [`make_meta_tar`] (GNU `L` header).
pub(crate) const LONG_NAME: &str = "lang/ein sehr langer Ordnername mit Ümlauten und mehr als hundert Zeichen damit der Header nicht reicht/datei.txt";

/// A TAR with the metadata headers of real archives: a PAX global header
/// (`g`), a PAX local header (`x`) carrying the path, and a GNU long name (`L`).
pub(crate) fn make_meta_tar(path: &Path) {
    let mut data: Vec<u8> = Vec::new();
    {
        let mut b = tar::Builder::new(&mut data);
        let global = pax_record("comment", "made by a test");
        b.append(
            &meta_header(
                tar::EntryType::XGlobalHeader,
                "pax_global_header",
                global.len(),
            ),
            &global[..],
        )
        .unwrap();
        let local = pax_record("path", "pax/über lange Wege.txt");
        b.append(
            &meta_header(tar::EntryType::XHeader, "PaxHeaders/x", local.len()),
            &local[..],
        )
        .unwrap();
        let mut h = tar::Header::new_ustar();
        h.set_path("short-ignored.txt").unwrap();
        h.set_size(3);
        h.set_mode(0o644);
        h.set_cksum();
        b.append(&h, &b"pax"[..]).unwrap();
        let mut h = tar::Header::new_gnu();
        h.set_size(4);
        h.set_mode(0o644);
        b.append_data(&mut h, LONG_NAME, &b"lang"[..]).unwrap();
        b.finish().unwrap();
    }
    fs::write(path, data).unwrap();
}

/// Review 016 #1: a 400 KB TAR.GZ whose GNU long name unpacks to ~400 MB – it is
/// refused at the header, nothing of it is read into memory.
#[test]
fn a_huge_long_name_header_is_refused_without_reading_it() {
    let d = tempdir().unwrap();
    let p = d.path().join("longname.tgz");
    fs::write(&p, include_bytes!("testdata/longname-400k.tgz")).unwrap();
    let start = std::time::Instant::now();
    let err = read_index(&p).unwrap_err();
    assert_eq!(err.code, FsErrorCode::ArchiveError, "{err:?}");
    assert!(err.message.contains("header"), "{}", err.message);
    assert!(start.elapsed() < std::time::Duration::from_secs(3));
}

/// Review 016 #1: the same for PAX headers (`x`) above the limit.
#[test]
fn a_huge_pax_header_is_refused() {
    let d = tempdir().unwrap();
    let p = d.path().join("pax.tar");
    let mut data: Vec<u8> = Vec::new();
    {
        let mut b = tar::Builder::new(&mut data);
        let big = pax_record("comment", &"x".repeat(80 << 10));
        b.append(
            &meta_header(tar::EntryType::XHeader, "PaxHeaders/x", big.len()),
            &big[..],
        )
        .unwrap();
        let mut h = tar::Header::new_ustar();
        h.set_path("a.txt").unwrap();
        h.set_size(0);
        h.set_cksum();
        b.append(&h, io::empty()).unwrap();
        b.finish().unwrap();
    }
    fs::write(&p, data).unwrap();
    assert_eq!(read_index(&p).unwrap_err().code, FsErrorCode::ArchiveError);
}

/// Review 016 #2: PAX/GNU metadata headers are no entries; their names apply.
#[test]
fn tar_metadata_headers_are_not_entries() {
    let d = tempdir().unwrap();
    let p = d.path().join("meta.tar");
    make_meta_tar(&p);
    let index = read_index(&p).unwrap();
    let names: Vec<String> = index.entries.iter().map(|e| e.name.join("/")).collect();
    assert_eq!(names, vec!["pax/über lange Wege.txt", LONG_NAME]);
    assert_eq!(index.total_entries, 2);
    assert_eq!(index.unsafe_entries, 0);
    assert_eq!(index.entries[0].size, 3);
    assert_eq!(index.entries[1].size, 4);
}

/// Review 016 #1: indexing a TAR stream stops at its deadline (a huge TAR.GZ
/// must not hold a worker for minutes).
#[test]
fn tar_indexing_has_a_deadline() {
    let d = tempdir().unwrap();
    let t = d.path().join("a.tgz");
    make_tar(&t, &[E::File("a.txt", b"a"), E::File("b.txt", b"b")], true);
    let err = read_index_until(&t, std::time::Instant::now()).unwrap_err();
    assert_eq!(err.code, FsErrorCode::ArchiveTooLarge, "{err:?}");
    assert!(read_index(&t).is_ok());
}
