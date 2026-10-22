//! Tests of the duplicate search (design 016 E6, 042).

use super::*;
use std::fs;

fn criteria(root: &Path) -> DuplicateCriteria {
    DuplicateCriteria {
        roots: vec![root.to_string_lossy().into_owned()],
        ..DuplicateCriteria::default()
    }
}

fn run(c: &DuplicateCriteria) -> DupResult {
    find(c, &Control::default(), &mut |_| {}).unwrap()
}

fn names(r: &DupResult) -> Vec<Vec<String>> {
    r.groups
        .iter()
        .map(|g| g.iter().map(|h| h.entry.name.clone()).collect())
        .collect()
}

/// Big files that agree in head and tail but differ in the middle.
fn big(fill: u8, middle: u8) -> Vec<u8> {
    let mut v = vec![fill; 3 * PART as usize];
    v[PART as usize + 100] = middle;
    v
}

#[test]
fn known_duplicates_are_grouped() {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    fs::create_dir_all(r.join("a/ünter ordner")).unwrap();
    fs::create_dir_all(r.join("b")).unwrap();
    fs::write(r.join("a/eins.txt"), "hallo welt").unwrap();
    fs::write(r.join("a/ünter ordner/zwei 🎉.txt"), "hallo welt").unwrap();
    fs::write(r.join("b/drei.txt"), "hallo welt").unwrap();
    fs::write(r.join("b/anders.txt"), "hallo wElt").unwrap(); // same size, other content
    fs::write(r.join("b/leer1"), "").unwrap();
    fs::write(r.join("b/leer2"), "").unwrap(); // empty files are ignored
    fs::write(r.join("a/big1.bin"), big(7, 1)).unwrap();
    fs::write(r.join("b/big2.bin"), big(7, 1)).unwrap();
    fs::write(r.join("b/big3.bin"), big(7, 2)).unwrap(); // same head + tail, other middle
    let res = run(&criteria(r));
    assert!(!res.cancelled);
    assert_eq!(
        names(&res),
        vec![
            vec!["big1.bin".to_string(), "big2.bin".into()],
            vec!["eins.txt".into(), "zwei 🎉.txt".into(), "drei.txt".into()],
        ]
    );
    assert_eq!(res.groups[0][0].group, Some(1));
    // big1.bin in `a`: the folder names come from Rust (P/Q/R in multi-rename)
    let tmp = r.file_name().unwrap().to_string_lossy();
    assert_eq!(
        res.groups[0][0].parent_names[..2],
        ["a".to_string(), tmp.into_owned()]
    );
    assert_eq!(res.groups[1][2].group, Some(2));
    assert_eq!(res.stats.groups, 2);
    assert_eq!(res.stats.hits, 5);
    assert!(
        res.stats.bytes_hashed > 6 * PART,
        "the big files were hashed fully"
    );
}

#[test]
fn size_only_and_same_name() {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    fs::create_dir_all(r.join("x")).unwrap();
    fs::write(r.join("a.txt"), "1234").unwrap();
    fs::write(r.join("x/A.TXT"), "abcd").unwrap();
    fs::write(r.join("x/b.txt"), "wxyz").unwrap();
    let mut c = criteria(r);
    c.compare = Compare::Size;
    assert_eq!(run(&c).stats.hits, 3);
    c.same_name = true;
    assert_eq!(
        names(&run(&c)),
        vec![vec!["a.txt".to_string(), "A.TXT".into()]]
    );
    c.compare = Compare::Content;
    assert!(run(&c).groups.is_empty(), "same name, other content");
}

#[cfg(unix)]
#[test]
fn hard_links_and_symlinks_are_not_copies() {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    fs::write(r.join("orig"), "inhalt").unwrap();
    fs::hard_link(r.join("orig"), r.join("hard")).unwrap();
    std::os::unix::fs::symlink(r.join("orig"), r.join("link")).unwrap();
    assert!(
        run(&criteria(r)).groups.is_empty(),
        "two names of one file are no duplicate"
    );
    fs::write(r.join("kopie"), "inhalt").unwrap();
    let res = run(&criteria(r));
    assert_eq!(res.groups.len(), 1);
    // design 042 E4: the hard link is shown as "the same file", the symlink not at all
    // (which of the two names comes first depends on the order of the folder)
    let g = &res.groups[0];
    let row = |name: &str| g.iter().find(|h| h.entry.name == name).unwrap();
    assert_eq!(
        (row("kopie").same_as.clone(), row("kopie").links),
        (None, None)
    );
    let (orig, hard) = (row("orig"), row("hard"));
    assert_eq!((orig.links, hard.links), (Some(2), Some(2)));
    let (alias, primary) = if orig.same_as.is_some() {
        (orig, hard)
    } else {
        (hard, orig)
    };
    assert_eq!(alias.same_as.as_deref(), Some(primary.entry.path.as_str()));
    assert_eq!(primary.same_as, None);
    // the alias follows its primary name directly
    let pos = |h: &SearchHit| g.iter().position(|x| x.entry.path == h.entry.path).unwrap();
    assert_eq!(pos(alias), pos(primary) + 1);
    assert_eq!(res.stats.hits, 3);
}

#[test]
fn nested_roots_count_each_file_once() {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    fs::create_dir_all(r.join("sub")).unwrap();
    fs::write(r.join("sub/a"), "x").unwrap();
    fs::write(r.join("sub/b"), "y").unwrap();
    let mut c = criteria(r);
    c.roots.push(r.join("sub").to_string_lossy().into_owned());
    assert!(run(&c).groups.is_empty());
}

#[test]
fn many_files_and_cancel() {
    many_files(10);
}

/// Acceptance criterion of prompt 016 (100 000 files, ~30 s mostly for creating them):
/// `cargo test --manifest-path src-tauri/Cargo.toml many_files_100k -- --ignored`.
#[test]
#[ignore]
fn many_files_100k_and_cancel() {
    many_files(100);
}

/// `folders` × 1 000 files, every 1 000th file has the same content.
fn many_files(folders: u32) {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    for f in 0..folders {
        let dir = r.join(format!("d{f:03}"));
        fs::create_dir(&dir).unwrap();
        for i in 0..1000 {
            let n = f * 1000 + i;
            let content = if n % 1000 == 0 {
                "dup".to_string()
            } else {
                format!("{n:08}")
            };
            fs::write(dir.join(format!("f{i}")), content).unwrap();
        }
    }
    let res = run(&criteria(r));
    assert_eq!(res.stats.files_scanned, u64::from(folders) * 1000);
    assert_eq!(res.groups.len(), 1);
    assert_eq!(res.groups[0].len(), folders as usize);
    // cancelled while walking: quickly, and no groups
    let control = Control::default();
    let mut reports = 0;
    let start = Instant::now();
    let res = find(&criteria(r), &control, &mut |_| {
        reports += 1;
        control.cancel();
    })
    .unwrap();
    // the first report comes after 250 ms at the latest
    assert!(res.cancelled || reports == 0);
    assert!(start.elapsed().as_secs() < 5);
    let control = Control::default();
    control.cancel();
    let res = find(&criteria(r), &control, &mut |_| {}).unwrap();
    assert!(res.cancelled);
    assert!(res.groups.is_empty());
}

#[test]
fn max_files_is_checked() {
    let d = tempfile::tempdir().unwrap();
    let mut c = criteria(d.path());
    c.max_files = Some(MAX_FILES + 1);
    assert!(find(&c, &Control::default(), &mut |_| {}).is_err());
    c.max_files = None;
    c.roots = vec![
        d.path()
            .join("does not exist")
            .to_string_lossy()
            .into_owned(),
    ];
    assert_eq!(
        find(&c, &Control::default(), &mut |_| {})
            .err()
            .unwrap()
            .code,
        FsErrorCode::NotFound
    );
}

/// Acceptance criterion of prompt 042: copies under other names, same size other
/// content stays out, the name is no criterion.
#[test]
fn acceptance_copies_under_other_names() {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    fs::create_dir_all(r.join("sub")).unwrap();
    let jpeg = vec![0xA5u8; 5000];
    let mut other = jpeg.clone();
    other[2500] = 0;
    fs::write(r.join("a.jpg"), &jpeg).unwrap();
    fs::write(r.join("Kopie von a.jpg"), &jpeg).unwrap();
    fs::write(r.join("sub/x.bin"), &jpeg).unwrap();
    fs::write(r.join("b.txt"), &other).unwrap();
    let res = run(&criteria(r));
    assert_eq!(
        names(&res),
        vec![vec![
            "Kopie von a.jpg".to_string(),
            "a.jpg".into(),
            "x.bin".into()
        ]]
    );
    // `order` = position in the walk, distinct per file
    let mut orders: Vec<u32> = res.groups[0].iter().map(|h| h.order.unwrap()).collect();
    orders.dedup();
    assert_eq!(orders.len(), 3);
    assert!(
        res.groups[0]
            .iter()
            .all(|h| h.distance.is_none() && h.width.is_none())
    );
    // the name glob limits the files looked at
    let mut c = criteria(r);
    c.name = "*.jpg".into();
    assert_eq!(
        names(&run(&c)),
        vec![vec!["Kopie von a.jpg".to_string(), "a.jpg".into()]]
    );
}

/// Design 042 E3: a second run reads nothing that did not change.
#[test]
fn second_run_uses_the_cache() {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    let data = big(3, 9);
    fs::write(r.join("one"), &data).unwrap();
    fs::write(r.join("two"), &data).unwrap();
    let first = run(&criteria(r));
    assert!(first.stats.bytes_hashed >= 2 * data.len() as u64);
    let second = run(&criteria(r));
    // everything known counts as done (review 042 #11) – the progress reaches 100 %
    assert_eq!(second.stats.bytes_hashed, second.stats.bytes_to_hash);
    assert_eq!(names(&second), names(&first));
    // an in-place edit that keeps size and mtime is still noticed (ctime, review 042 #9)
    #[cfg(unix)]
    {
        let mtime = fs::metadata(r.join("two")).unwrap().modified().unwrap();
        let mut other = data.clone();
        other[PART as usize + 7] ^= 1;
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(r.join("two"), &other).unwrap();
        fs::File::options()
            .write(true)
            .open(r.join("two"))
            .unwrap()
            .set_modified(mtime)
            .unwrap();
        assert!(run(&criteria(r)).groups.is_empty(), "stale hash not used");
        fs::write(r.join("two"), &data).unwrap();
    }
    // a changed file is read again – and is no duplicate any more
    let mut changed = data.clone();
    changed[PART as usize + 100] = 1;
    fs::write(r.join("two"), &changed).unwrap();
    let third = run(&criteria(r));
    assert!(third.stats.bytes_hashed > 0);
    assert!(third.groups.is_empty());
}

/// Paranoid: equal hashes are confirmed byte by byte (here: equal files stay grouped).
#[test]
fn paranoid_compares_the_bytes() {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    for n in ["a", "b", "c"] {
        fs::write(r.join(n), big(4, 4)).unwrap();
    }
    let mut c = criteria(r);
    c.paranoid = true;
    let res = run(&c);
    assert_eq!(
        names(&res),
        vec![vec!["a".to_string(), "b".into(), "c".into()]]
    );
    assert!(
        res.stats.bytes_hashed >= 4 * 3 * PART,
        "two comparisons of both files"
    );
}

#[test]
fn same_content_compares_bytes() {
    let d = tempfile::tempdir().unwrap();
    let (a, b, c) = (d.path().join("a"), d.path().join("b"), d.path().join("c"));
    fs::write(&a, big(1, 1)).unwrap();
    fs::write(&b, big(1, 1)).unwrap();
    fs::write(&c, big(1, 2)).unwrap();
    let no = AtomicBool::new(false);
    let mut n = 0;
    assert!(same_content(&a, &b, &no, &mut |k| n += k).unwrap());
    assert_eq!(n, 2 * 3 * PART);
    assert!(!same_content(&a, &c, &no, &mut |_| {}).unwrap());
    fs::write(&c, "short").unwrap();
    assert!(!same_content(&a, &c, &no, &mut |_| {}).unwrap());
    let yes = AtomicBool::new(true);
    assert!(same_content(&a, &b, &yes, &mut |_| {}).is_err());
    assert!(
        same_content(&a, d.path(), &no, &mut |_| {}).is_err(),
        "a folder"
    );
}

#[cfg(target_os = "linux")]
#[test]
fn non_utf8_names_are_left_out() {
    use std::os::unix::ffi::OsStrExt;
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    fs::write(r.join(std::ffi::OsStr::from_bytes(b"bad\xff")), "x1").unwrap();
    fs::write(r.join("ok"), "x1").unwrap();
    fs::write(r.join("ok2"), "x1").unwrap();
    assert_eq!(
        names(&run(&criteria(r))),
        vec![vec!["ok".to_string(), "ok2".into()]]
    );
}

mod similar {
    use super::super::images::testimg::{encode, jpeg, photo};
    use super::super::images::tests::png_claiming;
    use super::*;
    use image::ImageFormat;
    use std::io::Write;

    /// Acceptance criterion: the same photo as JPEG in two qualities and scaled down is
    /// one group; another photo is not; a broken or huge image does not stop the run.
    #[test]
    fn similar_images_acceptance() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("Urlaub ä")).unwrap();
        let big = photo(1600, 1200, 7);
        fs::write(r.join("Urlaub ä/IMG_1.jpg"), jpeg(&big, 95)).unwrap();
        fs::write(r.join("IMG_1 klein.jpg"), jpeg(&big, 40)).unwrap();
        let small = image::imageops::resize(&big, 400, 300, image::imageops::FilterType::Triangle);
        fs::write(r.join("IMG_1 web.png"), encode(&small, ImageFormat::Png)).unwrap();
        fs::write(r.join("anderes.jpg"), jpeg(&photo(1600, 1200, 2), 95)).unwrap();
        fs::write(r.join("kaputt.jpg"), b"\xff\xd8\xff garbage").unwrap();
        fs::write(r.join("riesig.png"), png_claiming(60_000, 60_000)).unwrap();
        fs::write(r.join("IMG_2.HEIC"), b"heic").unwrap();
        fs::write(r.join("notes.txt"), b"not an image").unwrap();
        let mut c = criteria(r);
        c.mode = DupMode::SimilarImages;
        let res = run(&c);
        assert_eq!(res.groups.len(), 1);
        let g = &res.groups[0];
        let mut found: Vec<&str> = g.iter().map(|h| h.entry.name.as_str()).collect();
        found.sort_unstable();
        assert_eq!(found, ["IMG_1 klein.jpg", "IMG_1 web.png", "IMG_1.jpg"]);
        assert_eq!(
            g[0].entry.name, "IMG_1.jpg",
            "the largest image is the centre"
        );
        assert_eq!(g[0].distance, Some(0));
        assert_eq!((g[0].width, g[0].height), (Some(1600), Some(1200)));
        let web = g.iter().find(|h| h.entry.name == "IMG_1 web.png").unwrap();
        assert_eq!((web.width, web.height), (Some(400), Some(300)));
        assert!(g.windows(2).all(|w| w[0].distance <= w[1].distance));
        assert_eq!(res.stats.unreadable, 2, "broken + huge");
        assert!(
            res.unreadable
                .iter()
                .all(|e| e.code == FsErrorCode::UnsupportedImage)
        );
        assert_eq!(res.stats.skipped_unsupported, 1);
        assert_eq!((res.stats.images_total, res.stats.images_done), (6, 6));
        // strict: only the near-identical one; an impossible threshold is refused
        c.threshold = Some(MAX_THRESHOLD + 1);
        assert!(find(&c, &Control::default(), &mut |_| {}).is_err());
    }

    #[test]
    fn comics_repacked_are_similar() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        let pages: Vec<(String, Vec<u8>)> = (1..=6)
            .map(|i| (format!("{i:02}.jpg"), jpeg(&photo(300, 450, 40 + i), 85)))
            .collect();
        let write = |name: &str, list: &[(String, Vec<u8>)], method| {
            let mut w = zip::ZipWriter::new(fs::File::create(r.join(name)).unwrap());
            let o = zip::write::SimpleFileOptions::default().compression_method(method);
            for (n, data) in list {
                w.start_file(n.as_str(), o).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        };
        write("Heft 1.cbz", &pages, zip::CompressionMethod::Deflated);
        let mut rev = pages.clone();
        rev.reverse();
        write("Heft 1 neu.cbz", &rev, zip::CompressionMethod::Stored);
        let other: Vec<(String, Vec<u8>)> = (1..=6)
            .map(|i| (format!("{i:02}.jpg"), jpeg(&photo(300, 450, 80 + i), 85)))
            .collect();
        write("Heft 2.cbz", &other, zip::CompressionMethod::Deflated);
        write("kein Comic.zip", &pages, zip::CompressionMethod::Deflated);
        let mut c = criteria(r);
        c.mode = DupMode::Comics;
        let res = run(&c);
        assert_eq!(
            names(&res),
            vec![vec!["Heft 1 neu.cbz".to_string(), "Heft 1.cbz".into()]]
        );
        assert!(res.groups[0].iter().all(|h| h.pages == Some(6)));
        // the second run comes from the cache: same answer
        assert_eq!(names(&run(&c)), names(&res));
    }
}

/// Measurement (design 042 E6.6), release build:
/// `cargo test --release --lib similar_speed -- --ignored --nocapture`
/// `FNF_SPEED_N` images of `FNF_SPEED_W` × 3/4 px (default 2 000 × 1024).
#[test]
#[ignore]
fn similar_speed() {
    use super::images::testimg::{jpeg, photo};
    let n: u32 = std::env::var("FNF_SPEED_N")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2_000);
    let w: u32 = std::env::var("FNF_SPEED_W")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1024);
    let d = tempfile::tempdir().unwrap();
    let base = jpeg(&photo(w, w * 3 / 4, 1), 85);
    let other = jpeg(&photo(w, w * 3 / 4, 2), 85);
    for i in 0..n {
        // half of them copies of one picture, half of another (decoding is the cost)
        let data = if i % 2 == 0 { &base } else { &other };
        fs::write(d.path().join(format!("img{i:06}.jpg")), data).unwrap();
    }
    let mut c = criteria(d.path());
    c.mode = DupMode::SimilarImages;
    let start = Instant::now();
    let res = run(&c);
    let first = start.elapsed();
    let start = Instant::now();
    let again = run(&c);
    println!(
        "{n} images {w}×{}: {} groups, first run {first:?} ({:.1} ms/image), cached {:?}",
        w * 3 / 4,
        res.groups.len(),
        first.as_secs_f64() * 1000.0 / f64::from(n),
        start.elapsed()
    );
    assert_eq!(res.groups.len(), 2);
    assert_eq!(again.groups.len(), 2);
}
