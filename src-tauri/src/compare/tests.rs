use super::*;
use std::fs::File;
use std::io::Write;
use std::time::{Duration, SystemTime};
use tempfile::TempDir;

const T0: u64 = 1_700_000_000;

fn write(path: &Path, content: &[u8], secs: u64) {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).unwrap();
    }
    let mut f = File::create(path).unwrap();
    f.write_all(content).unwrap();
    f.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(secs))
        .unwrap();
}

fn facts(kind: EntryKind, size: Option<u64>, secs: i64) -> Facts {
    Facts {
        kind,
        size,
        modified_ms: Some(secs * 1000),
        target: None,
    }
}

fn opts() -> CompareOptions {
    CompareOptions {
        exclude: String::new(),
        ignore_case: false,
        ..CompareOptions::default()
    }
}

#[test]
fn status_table() {
    use CompareStatus::*;
    use EntryKind::*;
    let o = opts();
    let f = |size, secs| facts(File, Some(size), secs);
    let cases: Vec<(Facts, Facts, Option<bool>, CompareStatus)> = vec![
        (f(1, 100), f(1, 100), None, Equal),
        (f(1, 100), f(1, 101), None, Equal),     // within 2 s
        (f(1, 100), f(1, 102), None, Equal),     // exactly 2 s
        (f(1, 103), f(1, 100), None, LeftNewer), // 3 s
        (f(1, 100), f(1, 200), None, RightNewer),
        (f(1, 100), f(2, 100), None, Differs),
        (f(1, 300), f(2, 100), None, LeftNewer),
        (f(1, 100), f(1, 100), Some(false), Differs),
        (f(1, 300), f(1, 100), Some(false), LeftNewer),
        (f(1, 300), f(1, 100), Some(true), Equal),
        (
            facts(Directory, None, 1),
            facts(Directory, None, 900),
            None,
            Equal,
        ),
        (facts(Directory, None, 1), f(1, 1), None, KindMismatch),
        (facts(Symlink, None, 1), f(1, 1), None, KindMismatch),
    ];
    for (i, (l, r, same, want)) in cases.into_iter().enumerate() {
        assert_eq!(status_of(&l, &r, &o, same), want, "case {i}");
    }
}

#[test]
fn hour_offsets_and_ignored_dates() {
    let f = |secs| facts(EntryKind::File, Some(5), secs);
    let mut o = opts();
    assert_eq!(
        status_of(&f(3600), &f(0), &o, None),
        CompareStatus::LeftNewer
    );
    o.ignore_hour = true;
    assert_eq!(status_of(&f(3600), &f(0), &o, None), CompareStatus::Equal);
    assert_eq!(status_of(&f(0), &f(3601), &o, None), CompareStatus::Equal);
    assert_eq!(
        status_of(&f(0), &f(3604), &o, None),
        CompareStatus::RightNewer
    );
    assert_eq!(
        status_of(&f(7200), &f(0), &o, None),
        CompareStatus::LeftNewer
    );
    let mut o = opts();
    o.ignore_date = true;
    assert_eq!(status_of(&f(9999), &f(0), &o, None), CompareStatus::Equal);
    let g = facts(EntryKind::File, Some(6), 9999);
    assert_eq!(status_of(&g, &f(0), &o, None), CompareStatus::Differs);
    o.tolerance_secs = 0;
    o.ignore_date = false;
    assert_eq!(status_of(&f(1), &f(0), &o, None), CompareStatus::LeftNewer);
}

#[test]
fn links_compare_by_target() {
    let link = |t: &str, secs: i64| Facts {
        kind: EntryKind::Symlink,
        size: None,
        modified_ms: Some(secs * 1000),
        target: Some(PathBuf::from(t)),
    };
    let o = opts();
    assert_eq!(
        status_of(&link("a", 1), &link("a", 900), &o, None),
        CompareStatus::Equal
    );
    assert_eq!(
        status_of(&link("a", 900), &link("b", 1), &o, None),
        CompareStatus::LeftNewer
    );
}

#[test]
fn keys_fold_nfc_and_case() {
    let nfd = "Mu\u{0308}ller.txt";
    let nfc_name = "M\u{00fc}ller.txt";
    assert_ne!(nfd, nfc_name);
    assert_eq!(key(nfd, false), key(nfc_name, false));
    assert_ne!(key("A.txt", false), key("a.txt", false));
    assert_eq!(key("A.txt", true), key("a.txt", true));
    assert!(same_place(Path::new("Ä/b"), Path::new("a\u{0308}/B")));
    assert!(!same_place(Path::new("a/b"), Path::new("a/c")));
    assert!(!same_place(Path::new("a/b"), Path::new("a/b/c")));
}

struct Fixture {
    _tmp: TempDir,
    left: PathBuf,
    right: PathBuf,
}

fn fixture() -> Fixture {
    let tmp = TempDir::new().unwrap();
    let left = tmp.path().join("left");
    let right = tmp.path().join("right");
    fs::create_dir_all(&left).unwrap();
    fs::create_dir_all(&right).unwrap();
    Fixture {
        _tmp: tmp,
        left,
        right,
    }
}

fn collect(f: &Fixture, o: &CompareOptions) -> (Vec<CompareRow>, CompareStats) {
    let c = compile(&f.left, &f.right, o).unwrap();
    let mut rows = Vec::new();
    let stats = c.walk(&AtomicBool::new(false), &mut |r, _| {
        if let Some(r) = r {
            rows.push(r);
        }
    });
    (rows, stats)
}

fn status(rows: &[CompareRow], rel: &str) -> CompareStatus {
    rows.iter()
        .find(|r| r.rel == rel)
        .unwrap_or_else(|| {
            panic!(
                "no row {rel}: {:?}",
                rows.iter().map(|r| &r.rel).collect::<Vec<_>>()
            )
        })
        .status
}

#[test]
fn every_category_in_a_tree() {
    let f = fixture();
    write(&f.left.join("same.txt"), b"x", T0);
    write(&f.right.join("same.txt"), b"x", T0);
    write(&f.left.join("new left.txt"), b"x", T0);
    write(&f.right.join("nur rechts ä.txt"), b"x", T0);
    write(&f.left.join("changed.txt"), b"xx", T0 + 100);
    write(&f.right.join("changed.txt"), b"x", T0);
    write(&f.left.join("older.txt"), b"x", T0);
    write(&f.right.join("older.txt"), b"y", T0 + 100);
    write(&f.left.join("sub/deep/a 🎉.txt"), b"a", T0);
    write(&f.right.join("sub/deep/a 🎉.txt"), b"a", T0);
    write(&f.left.join("sub/deep/b.txt"), b"b", T0);
    write(&f.left.join("only/x/y.txt"), b"y", T0);
    fs::create_dir_all(f.right.join("emptyright")).unwrap();
    write(&f.left.join("clash"), b"file", T0);
    write(&f.right.join("clash/inner.txt"), b"in", T0);
    let (rows, stats) = collect(&f, &opts());
    use CompareStatus::*;
    assert_eq!(status(&rows, "same.txt"), Equal);
    assert_eq!(status(&rows, "new left.txt"), OnlyLeft);
    assert_eq!(status(&rows, "nur rechts ä.txt"), OnlyRight);
    assert_eq!(status(&rows, "changed.txt"), LeftNewer);
    assert_eq!(status(&rows, "older.txt"), RightNewer);
    assert_eq!(status(&rows, "sub"), Equal);
    assert_eq!(status(&rows, "sub/deep/a 🎉.txt"), Equal);
    assert_eq!(status(&rows, "sub/deep/b.txt"), OnlyLeft);
    // one-sided folders are walked
    assert_eq!(status(&rows, "only"), OnlyLeft);
    assert_eq!(status(&rows, "only/x/y.txt"), OnlyLeft);
    assert_eq!(status(&rows, "emptyright"), OnlyRight);
    // a file against a folder is not walked
    assert_eq!(status(&rows, "clash"), KindMismatch);
    assert!(!rows.iter().any(|r| r.rel == "clash/inner.txt"));
    // preorder: a folder's row comes before its content
    let pos = |rel: &str| rows.iter().position(|r| r.rel == rel).unwrap();
    assert!(pos("sub") < pos("sub/deep") && pos("sub/deep") < pos("sub/deep/b.txt"));
    assert_eq!(stats.rows, rows.len() as u64);
    assert_eq!(
        stats.differences,
        rows.iter().filter(|r| r.status != Equal).count() as u64
    );
    let row = rows.iter().find(|r| r.rel == "changed.txt").unwrap();
    assert_eq!(row.left.as_ref().unwrap().size, Some(2));
    assert_eq!(row.right.as_ref().unwrap().size, Some(1));
    assert_eq!(row.depth, 0);
    assert_eq!(
        rows.iter()
            .find(|r| r.rel == "sub/deep/b.txt")
            .unwrap()
            .depth,
        2
    );
}

#[test]
fn content_finds_same_size_and_date_with_other_bytes() {
    let f = fixture();
    write(&f.left.join("a.bin"), b"hello", T0);
    write(&f.right.join("a.bin"), b"hallo", T0);
    write(&f.left.join("b.bin"), b"same", T0);
    write(&f.right.join("b.bin"), b"same", T0 + 500);
    let (rows, _) = collect(&f, &opts());
    assert_eq!(status(&rows, "a.bin"), CompareStatus::Equal);
    assert_eq!(status(&rows, "b.bin"), CompareStatus::RightNewer);
    let mut o = opts();
    o.content = true;
    let (rows, stats) = collect(&f, &o);
    assert_eq!(status(&rows, "a.bin"), CompareStatus::Differs);
    assert_eq!(
        status(&rows, "b.bin"),
        CompareStatus::Equal,
        "same bytes, other time"
    );
    assert!(rows.iter().all(|r| r.content_checked));
    assert_eq!(stats.bytes_compared, 18);
}

#[test]
fn big_content_compare_in_blocks() {
    let f = fixture();
    let mut a = vec![7u8; 3 * BLOCK + 17];
    write(&f.left.join("big"), &a, T0);
    *a.last_mut().unwrap() = 8;
    write(&f.right.join("big"), &a, T0);
    let mut o = opts();
    o.content = true;
    let (rows, _) = collect(&f, &o);
    assert_eq!(status(&rows, "big"), CompareStatus::Differs);
}

#[test]
fn nfc_and_nfd_names_are_one_pair() {
    let f = fixture();
    // macOS would normalise the name itself; elsewhere both forms really differ on disk
    write(&f.left.join("Mu\u{0308}ller.txt"), b"x", T0);
    write(&f.right.join("M\u{00fc}ller.txt"), b"x", T0);
    let (rows, _) = collect(&f, &opts());
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0].status, CompareStatus::Equal);
    assert_eq!(rows[0].right.as_ref().unwrap().name, "M\u{00fc}ller.txt");
}

#[cfg(target_os = "linux")]
#[test]
fn case_folding_with_collisions() {
    let f = fixture();
    write(&f.left.join("Readme.TXT"), b"x", T0);
    write(&f.right.join("readme.txt"), b"x", T0);
    let (rows, _) = collect(&f, &opts());
    assert_eq!(rows.len(), 2, "case matters by default on Linux");
    let mut o = opts();
    o.ignore_case = true;
    let (rows, _) = collect(&f, &o);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, CompareStatus::Equal);
    // two names on one side that only differ in case: paired exactly
    write(&f.left.join("readme.txt"), b"y", T0);
    let (rows, _) = collect(&f, &o);
    assert_eq!(rows.len(), 2, "{rows:?}");
    assert_eq!(status(&rows, "readme.txt"), CompareStatus::Equal);
    assert_eq!(status(&rows, "Readme.TXT"), CompareStatus::OnlyLeft);
}

#[cfg(unix)]
#[test]
fn links_are_never_followed() {
    use std::os::unix::fs::symlink;
    let f = fixture();
    write(&f.left.join("target/inner.txt"), b"x", T0);
    symlink("target", f.left.join("dirlink")).unwrap();
    symlink("nowhere", f.right.join("dangling")).unwrap();
    symlink("nowhere", f.left.join("dangling")).unwrap();
    // a loop: left/loop -> left
    symlink(&f.left, f.left.join("loop")).unwrap();
    let (rows, _) = collect(&f, &opts());
    assert_eq!(status(&rows, "dirlink"), CompareStatus::OnlyLeft);
    assert!(!rows.iter().any(|r| r.rel.starts_with("dirlink/")));
    assert!(!rows.iter().any(|r| r.rel.starts_with("loop/")));
    assert_eq!(status(&rows, "dangling"), CompareStatus::Equal);
    assert_eq!(
        rows.iter()
            .find(|r| r.rel == "dirlink")
            .unwrap()
            .left
            .as_ref()
            .unwrap()
            .kind,
        EntryKind::Symlink
    );
}

#[test]
fn filter_exclude_hidden() {
    let f = fixture();
    write(&f.left.join("a.jpg"), b"x", T0);
    write(&f.left.join("a.txt"), b"x", T0);
    write(&f.left.join("sub/b.JPG"), b"x", T0);
    write(&f.left.join(".hidden"), b"x", T0);
    write(&f.left.join("node_modules/x.jpg"), b"x", T0);
    let mut o = opts();
    o.filter = "*.jpg".into();
    o.exclude = ".git; node_modules".into();
    let (rows, _) = collect(&f, &o);
    let rels: Vec<&str> = rows.iter().map(|r| r.rel.as_str()).collect();
    assert_eq!(rels, vec!["a.jpg", "sub", "sub/b.JPG"]);
    let mut o = opts();
    o.hidden = true;
    let (rows, _) = collect(&f, &o);
    assert!(rows.iter().any(|r| r.rel == ".hidden"));
    assert!(rows.iter().any(|r| r.rel == "node_modules/x.jpg"));
    let mut o = opts();
    o.recursive = false;
    let (rows, _) = collect(&f, &o);
    assert!(rows.iter().all(|r| r.depth == 0));
}

#[test]
fn bad_options_and_roots() {
    let f = fixture();
    let mut o = opts();
    o.tolerance_secs = MAX_TOLERANCE_SECS + 1;
    assert!(compile(&f.left, &f.right, &o).is_err());
    let mut o = opts();
    o.exclude = "*".into();
    assert!(compile(&f.left, &f.right, &o).is_err());
    assert_eq!(
        compile(&f.left, &f.left, &opts()).err().unwrap().code,
        FsErrorCode::SameSourceTarget
    );
    fs::create_dir_all(f.left.join("in")).unwrap();
    assert_eq!(
        compile(&f.left, &f.left.join("in"), &opts())
            .err()
            .unwrap()
            .code,
        FsErrorCode::TargetInsideSource
    );
    write(&f.left.join("file"), b"x", T0);
    assert_eq!(
        compile(&f.left.join("file"), &f.right, &opts())
            .err()
            .unwrap()
            .code,
        FsErrorCode::NotADirectory
    );
}

#[test]
fn row_limit_and_cancel() {
    let f = fixture();
    for i in 0..50 {
        write(&f.left.join(format!("f{i:02}")), b"x", T0);
    }
    let mut o = opts();
    o.max_rows = Some(10);
    let (rows, stats) = collect(&f, &o);
    assert_eq!(rows.len(), 10);
    assert!(stats.truncated);
    let c = compile(&f.left, &f.right, &opts()).unwrap();
    let cancel = AtomicBool::new(false);
    let mut n = 0;
    c.walk(&cancel, &mut |r, _| {
        if r.is_some() {
            n += 1;
            if n == 5 {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    });
    assert_eq!(n, 5);
}

#[cfg(unix)]
#[test]
fn unreadable_folders_are_reported() {
    use std::os::unix::fs::PermissionsExt;
    // SAFETY: geteuid has no preconditions
    if unsafe { libc::geteuid() } == 0 {
        return; // root reads everything
    }
    let f = fixture();
    write(&f.left.join("locked/x.txt"), b"x", T0);
    fs::create_dir_all(f.right.join("locked")).unwrap();
    fs::set_permissions(f.left.join("locked"), fs::Permissions::from_mode(0o000)).unwrap();
    let (_, stats) = collect(&f, &opts());
    fs::set_permissions(f.left.join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(stats.unreadable, 1);
}

/// `cargo test -- --ignored compare_large_tree --nocapture`: 100 000 files per side.
#[test]
#[ignore]
fn compare_large_tree() {
    let f = fixture();
    for d in 0..100 {
        for i in 0..1000 {
            let name = format!("d{d:03}/f{i:04}.txt");
            write(&f.left.join(&name), b"x", T0);
            write(&f.right.join(&name), b"x", T0 + (i % 3) as u64 * 10);
        }
    }
    let start = std::time::Instant::now();
    let (rows, stats) = collect(&f, &opts());
    println!(
        "{} rows, {} differences in {:?}",
        rows.len(),
        stats.differences,
        start.elapsed()
    );
    assert_eq!(rows.len(), 100_100);
}

#[test]
fn rows_and_roots_say_whether_everything_was_seen() {
    let f = fixture();
    write(&f.left.join("all/a.txt"), b"a", T0);
    write(&f.left.join("some/.hidden"), b"h", T0);
    write(&f.left.join("some/b.txt"), b"b", T0);
    let (rows, stats) = collect(&f, &opts());
    assert!(stats.root_complete && !stats.root_read_error);
    let row = |rel: &str| rows.iter().find(|r| r.rel == rel).unwrap().clone();
    assert!(row("all").complete);
    assert!(!row("some").complete, "a hidden entry was left out");
    assert!(row("some/b.txt").complete);
    assert!(!row("all").read_error);
    let mut o = opts();
    o.recursive = false;
    let (rows, _) = collect(&f, &o);
    assert!(
        rows.iter().filter(|r| r.rel == "all").all(|r| !r.complete),
        "not walked"
    );
    write(&f.right.join(".top-hidden"), b"x", T0);
    let (_, stats) = collect(&f, &opts());
    assert!(!stats.root_complete);
}

#[cfg(target_os = "linux")]
#[test]
fn names_that_are_not_utf8_are_paired_exactly_and_marked() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let f = fixture();
    write(&f.left.join(OsStr::from_bytes(b"\xff.txt")), b"a", T0);
    write(&f.right.join(OsStr::from_bytes(b"\xfe.txt")), b"b", T0);
    let (rows, _) = collect(&f, &opts());
    assert_eq!(
        rows.len(),
        2,
        "two different names, both shown as \u{fffd}.txt"
    );
    assert!(
        rows.iter()
            .all(|r| r.left.as_ref().or(r.right.as_ref()).unwrap().lossy)
    );
}
