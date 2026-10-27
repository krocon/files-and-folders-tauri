use super::*;
use std::fs;
use std::sync::mpsc::Receiver;
use tempfile::tempdir;

fn touch(root: &Path, rel: &str) -> PathBuf {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(&p, rel.as_bytes()).unwrap();
    p
}

fn tree() -> tempfile::TempDir {
    let t = tempdir().unwrap();
    for rel in [
        "Docs/2025/Invoice-0815.pdf",
        "Docs/2024/Invoice-0700.pdf",
        "Downloads/invoice_2025_03.pdf",
        "Downloads/photo.jpg",
        "Projects/app/node_modules/invoice 2025.js",
    ] {
        touch(t.path(), rel);
    }
    t
}

fn hub_for(home: &Path, config: PaletteConfig) -> Hub {
    let hub = Hub::new(Some(home.to_path_buf()));
    hub.configure_with_delay(config, Duration::ZERO).unwrap();
    hub
}

fn wait_for(hub: &Hub, state: IndexState) -> IndexStatus {
    let start = Instant::now();
    loop {
        let s = hub.status();
        if s.state == state {
            return s;
        }
        assert!(
            start.elapsed() < Duration::from_secs(20),
            "index never got {state:?}: {s:?}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn request(text: &str) -> PaletteRequest {
    PaletteRequest {
        text: text.into(),
        places: vec![],
        recent: vec![],
        limit: None,
        tz_offset_minutes: 0,
        now_ms: None,
        detached: false,
    }
}

fn start(hub: &Hub, req: PaletteRequest) -> (u64, Receiver<PaletteEvent>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let id = hub.query(
        req,
        Arc::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        }),
    );
    (id, rx)
}

/// All hits until `Done` (the hits, the stats).
fn collect(rx: &Receiver<PaletteEvent>) -> (Vec<PaletteHit>, QueryStats) {
    let mut hits = Vec::new();
    loop {
        match rx.recv_timeout(Duration::from_secs(10)).expect("an event") {
            PaletteEvent::Hits { hits: h, .. } => hits.extend(h),
            PaletteEvent::Done { stats, .. } => return (hits, stats),
        }
    }
}

fn rels(hits: &[PaletteHit], home: &Path) -> Vec<String> {
    hits.iter()
        .map(|h| {
            Path::new(&h.entry.path)
                .strip_prefix(home)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect()
}

#[test]
fn acceptance_from_the_index() {
    let t = tree();
    let hub = hub_for(t.path(), PaletteConfig::default());
    let status = wait_for(&hub, IndexState::Ready);
    assert!(status.entries >= 9, "{status:?}");
    assert!(status.bytes > 0 && status.bytes <= status.max_bytes);
    let (_, rx) = start(&hub, request("invoice 2025"));
    let (hits, stats) = collect(&rx);
    assert_eq!(
        rels(&hits, t.path()),
        vec![
            "Downloads/invoice_2025_03.pdf",
            "Docs/2025/Invoice-0815.pdf"
        ]
    );
    assert!(hits.iter().all(|h| h.source == Source::Index));
    assert_eq!(stats.index, IndexState::Ready);
    assert!(stats.first_hit_ms.is_some());
    // the hit is a search hit as well: folder and parent names
    assert_eq!(hits[0].dir, t.path().join("Downloads").to_string_lossy());
    assert_eq!(hits[0].parent_names[0], "Downloads");
    assert_eq!(hits[0].ranges, vec![[0, 7], [8, 12]]);
    hub.stop();
}

#[test]
fn without_index_the_live_walk_finds_them() {
    let t = tree();
    let hub = hub_for(
        t.path(),
        PaletteConfig {
            index: false,
            ..PaletteConfig::default()
        },
    );
    assert_eq!(hub.status().state, IndexState::Off);
    let (_, rx) = start(&hub, request("invoice 2025"));
    let (hits, stats) = collect(&rx);
    let mut got = rels(&hits, t.path());
    got.sort();
    assert_eq!(
        got,
        vec![
            "Docs/2025/Invoice-0815.pdf",
            "Downloads/invoice_2025_03.pdf"
        ]
    );
    assert!(hits.iter().all(|h| h.source == Source::Live));
    assert_eq!(stats.index, IndexState::Off);
    hub.stop();
}

#[test]
fn places_outside_the_roots_are_walked_and_ranked_up() {
    let t = tree();
    let other = tempdir().unwrap();
    touch(other.path(), "invoice 2025 elsewhere.pdf");
    let hub = hub_for(t.path(), PaletteConfig::default());
    wait_for(&hub, IndexState::Ready);
    let mut req = request("invoice 2025");
    req.places = vec![other.path().to_string_lossy().into_owned()];
    req.recent = vec![t.path().join("Docs").to_string_lossy().into_owned()];
    let (_, rx) = start(&hub, req);
    let (hits, _) = collect(&rx);
    assert_eq!(hits.len(), 3);
    // the recent folder wins over the better name
    assert!(
        hits[0].entry.path.ends_with("Invoice-0815.pdf"),
        "{:?}",
        hits.iter().map(|h| &h.entry.name).collect::<Vec<_>>()
    );
    assert!(
        hits.iter()
            .any(|h| h.source == Source::Live && h.entry.name == "invoice 2025 elsewhere.pdf")
    );
    hub.stop();
}

#[test]
fn stale_hits_are_dropped_and_removed() {
    let t = tree();
    let hub = hub_for(t.path(), PaletteConfig::default());
    wait_for(&hub, IndexState::Ready);
    fs::remove_file(t.path().join("Downloads/invoice_2025_03.pdf")).unwrap();
    let (_, rx) = start(&hub, request("invoice 2025"));
    let (hits, stats) = collect(&rx);
    assert_eq!(rels(&hits, t.path()), vec!["Docs/2025/Invoice-0815.pdf"]);
    assert_eq!(stats.stale, 1);
    hub.stop();
}

#[test]
fn a_new_query_cancels_the_old_one() {
    let t = tree();
    let slow = tempdir().unwrap();
    for i in 0..20 {
        touch(slow.path(), &format!("d{i}/file {i}.txt"));
    }
    let hub = hub_for(
        t.path(),
        PaletteConfig {
            index: false,
            ..PaletteConfig::default()
        },
    );
    // the first query walks a slow place (50 ms per folder)
    *live::SLOW.lock().unwrap() = Some((slow.path().to_path_buf(), Duration::from_millis(50)));
    let mut req = request("file");
    req.places = vec![slow.path().to_string_lossy().into_owned()];
    let (first, rx1) = start(&hub, req);
    std::thread::sleep(Duration::from_millis(80));
    let (second, rx2) = start(&hub, request("invoice 2025"));
    assert!(second > first);
    let (hits, _) = collect(&rx2);
    assert_eq!(hits.len(), 2);
    // the first one was cancelled: it never ends with `Done`
    let mut done = false;
    while let Ok(e) = rx1.recv_timeout(Duration::from_millis(300)) {
        done |= matches!(e, PaletteEvent::Done { .. });
    }
    assert!(!done);
    // a late cancel of the old id leaves the newest query alone
    let (_, rx3) = start(&hub, request("invoice"));
    hub.cancel(Some(first));
    let (hits, _) = collect(&rx3);
    assert!(!hits.is_empty());
    *live::SLOW.lock().unwrap() = None;
    hub.stop();
}

#[test]
fn a_detached_query_runs_beside_the_palette() {
    let t = tree();
    let hub = hub_for(
        t.path(),
        PaletteConfig {
            index: false,
            ..PaletteConfig::default()
        },
    );
    let mut req = request("invoice 2025");
    req.detached = true;
    let (_, rx1) = start(&hub, req);
    let (_, rx2) = start(&hub, request("photo"));
    hub.cancel(None);
    // the detached one is neither cancelled by the next query nor by a cancel
    let (hits, _) = collect(&rx1);
    assert_eq!(hits.len(), 2);
    drop(rx2);
    hub.stop();
}

#[test]
fn limit_and_truncation() {
    let t = tempdir().unwrap();
    for i in 0..50 {
        touch(t.path(), &format!("many/file {i}.txt"));
    }
    let hub = hub_for(t.path(), PaletteConfig::default());
    wait_for(&hub, IndexState::Ready);
    let mut req = request("file");
    req.limit = Some(10);
    let (_, rx) = start(&hub, req);
    let (hits, stats) = collect(&rx);
    assert_eq!(hits.len(), 10);
    assert_eq!(stats.matched, 50);
    assert!(stats.truncated);
    hub.stop();
}

#[test]
fn path_mode_completes_in_the_typed_folder() {
    let t = tree();
    let hub = hub_for(
        t.path(),
        PaletteConfig {
            index: false,
            ..PaletteConfig::default()
        },
    );
    let typed = format!("{}{}Do", t.path().display(), std::path::MAIN_SEPARATOR);
    let (_, rx) = start(&hub, request(&typed));
    let (hits, _) = collect(&rx);
    let names: Vec<&str> = hits.iter().map(|h| h.entry.name.as_str()).collect();
    assert_eq!(names, vec!["Docs", "Downloads"]);
    assert_eq!(hits[0].ranges, vec![[0, 2]]);
    assert!(hits.iter().all(|h| h.source == Source::Path));
    // a trailing separator lists the folder
    let typed = format!(
        "{}{}Docs{}",
        t.path().display(),
        std::path::MAIN_SEPARATOR,
        std::path::MAIN_SEPARATOR
    );
    let (_, rx) = start(&hub, request(&typed));
    let (hits, _) = collect(&rx);
    assert_eq!(hits.len(), 2);
    // `~` is the home folder
    let (_, rx) = start(&hub, request("~/Down"));
    let (hits, _) = collect(&rx);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].entry.name, "Downloads");
    hub.stop();
}

#[test]
fn actions_and_empty_queries_search_nothing() {
    let t = tree();
    let hub = hub_for(
        t.path(),
        PaletteConfig {
            index: false,
            ..PaletteConfig::default()
        },
    );
    for text in ["> copy", "", "   ", "is:dir"] {
        let (_, rx) = start(&hub, request(text));
        let (hits, stats) = collect(&rx);
        assert!(hits.is_empty(), "{text}");
        assert_eq!(stats.scanned, 0, "{text}");
    }
    hub.stop();
}

#[test]
fn archive_roots_only_when_chosen() {
    let t = tree();
    let zip = t.path().join("Archive.zip");
    {
        let f = fs::File::create(&zip).unwrap();
        let mut w = zip::ZipWriter::new(f);
        w.start_file(
            "inside/invoice 2025 zipped.pdf",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        std::io::Write::write_all(&mut w, b"x").unwrap();
        w.finish().unwrap();
    }
    let hub = hub_for(t.path(), PaletteConfig::default());
    wait_for(&hub, IndexState::Ready);
    // an archive tab is a place – but not entered
    let mut req = request("invoice 2025");
    req.places = vec![zip.to_string_lossy().into_owned()];
    let (_, rx) = start(&hub, req.clone());
    let (hits, _) = collect(&rx);
    assert!(!hits.iter().any(|h| h.entry.name.contains("zipped")));
    // chosen as a root in the settings: searched live
    let roots = vec![
        t.path().to_string_lossy().into_owned(),
        zip.to_string_lossy().into_owned(),
    ];
    hub.configure_with_delay(
        PaletteConfig {
            roots,
            ..PaletteConfig::default()
        },
        Duration::ZERO,
    )
    .unwrap();
    wait_for(&hub, IndexState::Ready);
    let (_, rx) = start(&hub, req);
    let (hits, _) = collect(&rx);
    assert!(
        hits.iter()
            .any(|h| h.entry.name == "invoice 2025 zipped.pdf"),
        "{hits:?}"
    );
    hub.stop();
}

#[cfg(unix)]
#[test]
fn settings_are_checked() {
    let hub = Hub::new(Some(PathBuf::from("/home/u")));
    // a bad root or exclusion is left out and named – the rest still works (review 043 #9)
    let s = hub
        .check(PaletteConfig {
            roots: vec!["relative/x".into(), "/data".into()],
            excludes: vec!["*".into()],
            ..PaletteConfig::default()
        })
        .unwrap();
    assert_eq!(s.index.roots, vec![PathBuf::from("/data")]);
    assert!(s.index.excludes.is_none());
    assert_eq!(s.problems, vec!["relative/x".to_string(), "*".to_string()]);
    // too many roots: refused as a whole
    let many = (0..100).map(|i| format!("/r{i}")).collect();
    assert!(
        hub.configure(PaletteConfig {
            roots: many,
            ..PaletteConfig::default()
        })
        .is_err()
    );
    // the memory limit is clamped
    let s = hub
        .check(PaletteConfig {
            max_memory_mb: 1,
            ..PaletteConfig::default()
        })
        .unwrap();
    assert_eq!(s.index.max_bytes, u64::from(MIN_MEMORY_MB) << 20);
    // no roots: the home folder; `~` is expanded
    assert_eq!(s.index.roots, vec![PathBuf::from("/home/u")]);
    let s = hub
        .check(PaletteConfig {
            roots: vec!["~/Docs".into()],
            ..PaletteConfig::default()
        })
        .unwrap();
    assert_eq!(s.index.roots, vec![PathBuf::from("/home/u/Docs")]);
    hub.stop();
}

#[test]
fn watcher_paths_map_back_to_the_root() {
    let roots = vec![(PathBuf::from("/tmp/x"), PathBuf::from("/private/tmp/x"))];
    assert_eq!(
        original_path(Path::new("/private/tmp/x/a/b"), &roots),
        Some(PathBuf::from("/tmp/x/a/b"))
    );
    assert_eq!(
        original_path(Path::new("/tmp/x/a"), &roots),
        Some(PathBuf::from("/tmp/x/a"))
    );
    assert_eq!(original_path(Path::new("/elsewhere"), &roots), None);
}

#[test]
fn watcher_events_below_skipped_names_are_ignored() {
    let t = tree();
    let hub = Hub::new(Some(t.path().to_path_buf()));
    let s = hub.check(PaletteConfig::default()).unwrap();
    assert!(touches_skipped(
        &t.path().join("Projects/app/node_modules/x/y.js"),
        &s.index
    ));
    assert!(touches_skipped(&t.path().join(".cache/a"), &s.index));
    assert!(!touches_skipped(
        &t.path().join("Docs/2025/new.pdf"),
        &s.index
    ));
    assert!(touches_skipped(Path::new("/outside/root"), &s.index));
}

#[test]
fn changes_are_taken_over() {
    let t = tree();
    let hub = hub_for(t.path(), PaletteConfig::default());
    wait_for(&hub, IndexState::Ready);
    touch(t.path(), "Docs/2025/invoice later.pdf");
    // a panel watcher reports the folder (the own watcher may as well)
    hub.send(Cmd::Dirs(vec![t.path().join("Docs/2025")]));
    let start_at = Instant::now();
    loop {
        let (_, rx) = start(&hub, request("invoice later"));
        let (hits, _) = collect(&rx);
        if hits.iter().any(|h| h.source == Source::Index) {
            break;
        }
        assert!(
            start_at.elapsed() < Duration::from_secs(10),
            "never taken over"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    // a gone folder leaves the index (the folder and its file) – without a query's check
    let before = hub.status().entries;
    hub.send(Cmd::Gone(t.path().join("Docs/2024")));
    let start_at = Instant::now();
    while hub.status().entries != before - 2 {
        assert!(
            start_at.elapsed() < Duration::from_secs(5),
            "{} → {}",
            before,
            hub.status().entries
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    hub.stop();
}

#[test]
fn clear_and_rebuild() {
    let t = tree();
    let hub = hub_for(t.path(), PaletteConfig::default());
    wait_for(&hub, IndexState::Ready);
    hub.clear();
    wait_for(&hub, IndexState::Waiting);
    hub.rebuild();
    wait_for(&hub, IndexState::Ready);
    hub.configure_with_delay(
        PaletteConfig {
            index: false,
            ..PaletteConfig::default()
        },
        Duration::ZERO,
    )
    .unwrap();
    wait_for(&hub, IndexState::Off);
    hub.stop();
}

/// Time to the first hit with a cold and a warm start (`--ignored`, design 043 E2).
#[test]
#[ignore]
fn bench_first_hit() {
    let t = tempdir().unwrap();
    for d in 0..200 {
        for f in 0..250 {
            touch(
                t.path(),
                &format!("dir {d}/sub {}/file_{f}_{}.txt", d % 7, 2000 + f % 30),
            );
        }
    }
    let hub = hub_for(t.path(), PaletteConfig::default());
    let built = wait_for(&hub, IndexState::Ready);
    println!(
        "index: {} entries, {} KiB, built in {} ms",
        built.entries,
        built.bytes >> 10,
        built.build_ms
    );
    for text in ["file 2025", "file_17_2017", "sub 3 file_1"] {
        let (_, rx) = start(&hub, request(text));
        let (hits, stats) = collect(&rx);
        println!(
            "{text:>16}: {} hits, first after {:?} ms, all {} ms",
            hits.len(),
            stats.first_hit_ms,
            stats.elapsed_ms
        );
    }
    hub.stop();
}
