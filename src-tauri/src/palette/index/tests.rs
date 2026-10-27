use super::*;
use crate::palette::query::{parse, score};
use std::sync::atomic::AtomicBool;
use tempfile::tempdir;

fn config(root: &Path) -> IndexConfig {
    IndexConfig {
        roots: vec![root.to_path_buf()],
        excludes: crate::search::globs_to_regex("node_modules;.git", true)
            .map(|s| crate::search::build(&s, false).unwrap()),
        include_hidden: false,
        max_bytes: 64 << 20,
        home: Some(root.to_path_buf()),
    }
}

fn touch(root: &Path, rel: &str) -> PathBuf {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(&p, rel.as_bytes()).unwrap();
    p
}

fn names(index: &Index, text: &str, home: &Path) -> Vec<String> {
    let q = parse(text, 0, 0);
    let r = index.search(
        &q,
        &SearchCtx::default(),
        Some(home),
        50,
        &AtomicBool::new(false),
        &mut Scratch::default(),
    );
    r.hits
        .iter()
        .map(|c| {
            index
                .path_of(c.node)
                .strip_prefix(home)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect()
}

fn tree() -> tempfile::TempDir {
    let t = tempdir().unwrap();
    for rel in [
        "Docs/2025/Invoice-0815.pdf",
        "Docs/2024/Invoice-0700.pdf",
        "Downloads/invoice_2025_03.pdf",
        "Downloads/photo.jpg",
        "Projects/app/node_modules/invoice-lib/index.js",
        "Projects/app/.git/invoice",
        "Projects/app/src/invoice.ts",
        ".hidden/invoice 2025.pdf",
    ] {
        touch(t.path(), rel);
    }
    t
}

#[test]
fn acceptance_invoice_2025() {
    let t = tree();
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    let hits = names(&index, "invoice 2025", t.path());
    assert_eq!(
        hits,
        vec![
            "Downloads/invoice_2025_03.pdf",
            "Docs/2025/Invoice-0815.pdf"
        ]
    );
}

#[test]
fn excludes_hidden_and_folders_count_as_path() {
    let t = tree();
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    let hits = names(&index, "invoice", t.path());
    // node_modules, .git and hidden folders are not in the index
    assert!(
        hits.iter()
            .all(|h| !h.contains("node_modules") && !h.contains(".git") && !h.contains(".hidden")),
        "{hits:?}"
    );
    assert!(hits.contains(&"Projects/app/src/invoice.ts".to_string()));
    // a folder hit
    assert_eq!(names(&index, "is:dir 2025", t.path()), vec!["Docs/2025"]);
    // in: only counts folders above
    assert_eq!(
        names(&index, "in:docs invoice 2024", t.path()),
        vec!["Docs/2024/Invoice-0700.pdf"]
    );
    // without `invoice` the folder 2024 is a hit as well (its parent is Docs)
    assert_eq!(
        names(&index, "in:docs 2024", t.path()),
        vec!["Docs/2024", "Docs/2024/Invoice-0700.pdf"]
    );
    // the home folder's own name never matches
    let home_name = t.path().file_name().unwrap().to_string_lossy().to_string();
    assert!(names(&index, &home_name, t.path()).is_empty());
}

#[test]
fn with_hidden_entries_when_asked() {
    let t = tree();
    let mut c = config(t.path());
    c.include_hidden = true;
    let index = Index::build(&c, &AtomicBool::new(false));
    assert!(
        names(&index, "invoice 2025", t.path()).contains(&".hidden/invoice 2025.pdf".to_string())
    );
}

#[test]
fn boosts_and_below() {
    let t = tree();
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    let q = parse("invoice", 0, 0);
    let ctx = SearchCtx {
        boosts: vec![(t.path().join("Docs/2024"), 500)],
        below: vec![],
    };
    let r = index.search(
        &q,
        &ctx,
        Some(t.path()),
        50,
        &AtomicBool::new(false),
        &mut Scratch::default(),
    );
    assert!(index.path_of(r.hits[0].node).ends_with("Invoice-0700.pdf"));
    let ctx = SearchCtx {
        boosts: vec![],
        below: vec![t.path().join("Downloads")],
    };
    let r = index.search(
        &q,
        &ctx,
        Some(t.path()),
        50,
        &AtomicBool::new(false),
        &mut Scratch::default(),
    );
    assert_eq!(r.hits.len(), 1);
    assert!(
        index
            .path_of(r.hits[0].node)
            .ends_with("invoice_2025_03.pdf")
    );
}

#[test]
fn limit_and_matched_count() {
    let t = tempdir().unwrap();
    for i in 0..300 {
        touch(t.path(), &format!("many/file {i}.txt"));
    }
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    let q = parse("file", 0, 0);
    let r = index.search(
        &q,
        &SearchCtx::default(),
        Some(t.path()),
        20,
        &AtomicBool::new(false),
        &mut Scratch::default(),
    );
    assert_eq!(r.hits.len(), 20);
    assert_eq!(r.matched, 300);
    // equal ranks: by name
    let names: Vec<&str> = r.hits.iter().map(|c| index.name(c.node)).collect();
    let mut sorted = names.clone();
    sorted.sort_by_key(|n| (std::cmp::Reverse(score(&q, n, 2, 0).0), n.to_string()));
    assert_eq!(names, sorted);
}

#[test]
fn memory_limit_truncates() {
    let t = tempdir().unwrap();
    for i in 0..3000 {
        touch(t.path(), &format!("d{}/f{i}", i % 10));
    }
    let mut c = config(t.path());
    c.max_bytes = 64 * 1024;
    let index = Index::build(&c, &AtomicBool::new(false));
    assert!(index.truncated);
    assert!(
        index.bytes() <= c.max_bytes,
        "{} > {}",
        index.bytes(),
        c.max_bytes
    );
    assert!(index.len() > 100);
}

#[test]
fn cancel_stops_build_and_search() {
    let t = tree();
    let cancel = AtomicBool::new(true);
    let index = Index::build(&config(t.path()), &cancel);
    assert!(index.len() <= 1);
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    let r = index.search(
        &parse("invoice", 0, 0),
        &SearchCtx::default(),
        None,
        10,
        &cancel,
        &mut Scratch::default(),
    );
    assert!(r.cancelled);
}

#[test]
fn apply_dir_updates_removes_and_adds() {
    let t = tree();
    let c = config(t.path());
    let mut index = Index::build(&c, &AtomicBool::new(false));
    let downloads = t.path().join("Downloads");
    fs::remove_file(downloads.join("invoice_2025_03.pdf")).unwrap();
    touch(t.path(), "Downloads/new invoice 2025.pdf");
    fs::create_dir_all(downloads.join("Sub/Deeper")).unwrap();
    touch(t.path(), "Downloads/Sub/Deeper/invoice 2025 deep.pdf");
    let items = read_items(&downloads, &c).unwrap();
    let new_dirs = index.apply_dir(&downloads, &items);
    assert_eq!(new_dirs, vec![downloads.join("Sub")]);
    for d in &new_dirs {
        let (list, cut) = Index::collect(d, &c, &AtomicBool::new(false), usize::MAX);
        assert!(!cut);
        index.graft(d, &list, cut);
    }
    let hits = names(&index, "invoice 2025", t.path());
    assert!(
        hits.contains(&"Downloads/new invoice 2025.pdf".to_string()),
        "{hits:?}"
    );
    assert!(
        hits.contains(&"Downloads/Sub/Deeper/invoice 2025 deep.pdf".to_string()),
        "{hits:?}"
    );
    assert!(!hits.contains(&"Downloads/invoice_2025_03.pdf".to_string()));
    // a folder replaced by a file: the old subtree is gone
    fs::remove_dir_all(t.path().join("Docs/2025")).unwrap();
    fs::write(t.path().join("Docs/2025"), b"now a file").unwrap();
    let docs = t.path().join("Docs");
    index.apply_dir(&docs, &read_items(&docs, &c).unwrap());
    assert!(
        !names(&index, "invoice 2025", t.path())
            .iter()
            .any(|h| h.starts_with("Docs/2025/"))
    );
    assert!(index.removed() >= 2);
    // remove a path
    index.remove_path(&t.path().join("Downloads/photo.jpg"));
    assert!(names(&index, "photo", t.path()).is_empty());
    // the root itself is never removed
    index.remove_path(t.path());
    assert!(!names(&index, "invoice", t.path()).is_empty());
}

#[test]
fn unicode_names_and_nfd() {
    let t = tempdir().unwrap();
    touch(t.path(), "Fotos/Café de Flore.jpg");
    touch(t.path(), "Fotos/Cafe\u{301} NFD.jpg");
    touch(t.path(), "Fotos/日本語.txt");
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    let mut hits = names(&index, "café", t.path());
    hits.sort();
    assert_eq!(
        hits,
        vec!["Fotos/Cafe\u{301} NFD.jpg", "Fotos/Café de Flore.jpg"]
    );
    assert_eq!(names(&index, "日本", t.path()), vec!["Fotos/日本語.txt"]);
}

#[cfg(unix)]
#[test]
fn links_are_not_followed() {
    let t = tree();
    // a cycle: a link to the root inside the tree
    std::os::unix::fs::symlink(t.path(), t.path().join("Docs/loop")).unwrap();
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    let hits = names(&index, "invoice 2025", t.path());
    assert_eq!(hits.len(), 2, "{hits:?}");
    // the link itself is an entry
    assert_eq!(names(&index, "loop", t.path()), vec!["Docs/loop"]);
}

#[cfg(target_os = "linux")]
#[test]
fn non_utf8_names_are_skipped() {
    use std::os::unix::ffi::OsStrExt;
    let t = tree();
    let bad = t
        .path()
        .join(std::ffi::OsStr::from_bytes(b"bad \xff invoice"));
    fs::create_dir(&bad).unwrap();
    fs::write(bad.join("invoice inside.txt"), b"x").unwrap();
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    assert!(
        !names(&index, "inside", t.path())
            .iter()
            .any(|h| h.contains("inside"))
    );
}

#[test]
fn nested_roots_are_walked_once() {
    let t = tree();
    let mut c = config(t.path());
    c.roots.push(t.path().join("Docs"));
    let index = Index::build(&c, &AtomicBool::new(false));
    assert_eq!(names(&index, "invoice 2025", t.path()).len(), 2);
}

/// Measurement for the design (043 E2): `cargo test --release -- --ignored bench_index --nocapture`.
#[test]
#[ignore]
fn bench_index_one_million() {
    use std::time::Instant;
    let mut index = Index::new(1 << 31);
    let words = [
        "invoice", "report", "photo", "IMG", "notes", "budget", "draft", "final", "copy", "Projekt",
    ];
    let root = Item {
        name: "/home/u".into(),
        dir: true,
        link: false,
        size: 0,
        modified_ms: None,
    };
    let r = index.add(NONE, &root, true).unwrap();
    index.roots.push((PathBuf::from("/home/u"), r));
    let start = Instant::now();
    let mut dirs = vec![r];
    let mut n = 0u64;
    'outer: for d in 0..20_000u32 {
        let parent = dirs[(d as usize * 7) % dirs.len()];
        let dir = Item {
            name: format!("{} {d}", words[d as usize % 10]),
            dir: true,
            link: false,
            size: 0,
            modified_ms: Some(1),
        };
        let di = index.add(parent, &dir, false).unwrap();
        dirs.push(di);
        for f in 0..49u32 {
            let item = Item {
                name: format!(
                    "{}_{}_{:04}.pdf",
                    words[(f as usize + d as usize) % 10],
                    2000 + (f % 30),
                    f * d % 9999
                ),
                dir: false,
                link: false,
                size: u64::from(f) * 1000,
                modified_ms: Some(1_700_000_000_000),
            };
            index.add(di, &item, false).unwrap();
            n += 1;
            if n >= 1_000_000 {
                break 'outer;
            }
        }
    }
    index.shrink();
    println!(
        "built {} entries in {:?}, {} MiB",
        index.len(),
        start.elapsed(),
        index.bytes() >> 20
    );
    for text in [
        "invoice 2025",
        "inv",
        "budget final 2010",
        "zzz",
        "ext:pdf size>40k",
    ] {
        let q = parse(text, 0, 0);
        let start = Instant::now();
        let r = index.search(
            &q,
            &SearchCtx::default(),
            Some(Path::new("/home/u")),
            200,
            &AtomicBool::new(false),
            &mut Scratch::default(),
        );
        println!(
            "{text:>20}: {:>8} matched, {:?}",
            r.matched,
            start.elapsed()
        );
    }
}

#[test]
fn a_new_folder_over_the_budget_makes_the_index_truncated() {
    let t = tree();
    let c = config(t.path());
    let mut index = Index::build(&c, &AtomicBool::new(false));
    assert!(!index.truncated);
    for i in 0..30 {
        touch(t.path(), &format!("Downloads/Big/f{i}.txt"));
    }
    let downloads = t.path().join("Downloads");
    let new_dirs = index.apply_dir(&downloads, &read_items(&downloads, &c).unwrap());
    let (list, cut) = Index::collect(&new_dirs[0], &c, &AtomicBool::new(false), 10);
    assert!(cut);
    assert_eq!(list.len(), 10);
    index.graft(&new_dirs[0], &list, cut);
    assert!(index.truncated);
    assert_eq!(
        names(&index, "f", t.path())
            .iter()
            .filter(|n| n.starts_with("Downloads/Big/"))
            .count(),
        10
    );
    // grafting again (a second event) adds nothing twice
    index.graft(&new_dirs[0], &list, cut);
    assert_eq!(
        names(&index, "f", t.path())
            .iter()
            .filter(|n| n.starts_with("Downloads/Big/"))
            .count(),
        10
    );
}

#[test]
fn the_best_name_survives_the_pre_selection() {
    // review 043 #6: many weaker names near the root, the exact one deep down
    let t = tempdir().unwrap();
    for i in 0..400 {
        touch(t.path(), &format!("a/invoice-{i:03}.pdf"));
    }
    touch(t.path(), "b/c/d/e/f/g/h/invoice.pdf");
    let index = Index::build(&config(t.path()), &AtomicBool::new(false));
    assert_eq!(
        names(&index, "invoice", t.path())[0],
        "b/c/d/e/f/g/h/invoice.pdf"
    );
}
