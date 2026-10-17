//! The real watcher on temp folders (inotify on Linux, FSEvents on macOS, …).

use super::*;
use std::fs;
use std::sync::mpsc::Receiver;

fn hub() -> (WatchHub, Receiver<WatchEvent>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let hub = WatchHub::new(Arc::new(move |e| {
        let _ = tx.lock().unwrap().send(e);
    }));
    (hub, rx)
}

/// Collects events until `done` says so (or the time is up).
fn wait_for(
    rx: &Receiver<WatchEvent>,
    limit: Duration,
    mut done: impl FnMut(&[WatchEvent]) -> bool,
) -> Vec<WatchEvent> {
    let end = Instant::now() + limit;
    let mut got = Vec::new();
    while Instant::now() < end {
        if let Ok(e) = rx.recv_timeout(Duration::from_millis(50)) {
            got.push(e);
            if done(&got) {
                break;
            }
        }
    }
    got
}

fn upserted_names(events: &[WatchEvent]) -> Vec<String> {
    events
        .iter()
        .flat_map(|e| match e {
            WatchEvent::Changes { upserted, .. } => {
                upserted.iter().map(|u| u.name.clone()).collect()
            }
            _ => Vec::new(),
        })
        .collect()
}

fn removed_paths(events: &[WatchEvent]) -> Vec<String> {
    events
        .iter()
        .flat_map(|e| match e {
            WatchEvent::Changes { removed, .. } => removed.clone(),
            _ => Vec::new(),
        })
        .collect()
}

#[test]
fn create_rename_delete_arrive_in_under_a_second() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("Ordner äö 😀");
    fs::create_dir(&dir).unwrap();
    let (hub, rx) = hub();
    let st = hub.set_dirs(std::slice::from_ref(&dir), false).unwrap();
    assert_eq!(st[0].mode, WatchMode::Native);
    assert_eq!(st[0].dir, dir.to_string_lossy());

    let start = Instant::now();
    fs::write(dir.join("neu – datei.txt"), b"hello").unwrap();
    let got = wait_for(&rx, Duration::from_secs(3), |g| {
        upserted_names(g).contains(&"neu – datei.txt".to_string())
    });
    assert!(
        start.elapsed() < Duration::from_secs(1),
        "{:?}",
        start.elapsed()
    );
    let WatchEvent::Changes {
        dir: d, upserted, ..
    } = &got[0]
    else {
        panic!("{got:?}")
    };
    assert_eq!(d, &dir.to_string_lossy());
    assert_eq!(upserted[0].size, Some(5));

    fs::rename(dir.join("neu – datei.txt"), dir.join("umbenannt.txt")).unwrap();
    let got = wait_for(&rx, Duration::from_secs(3), |g| {
        upserted_names(g).contains(&"umbenannt.txt".to_string()) && !removed_paths(g).is_empty()
    });
    assert_eq!(
        removed_paths(&got),
        vec![dir.join("neu – datei.txt").to_string_lossy().into_owned()]
    );

    fs::remove_file(dir.join("umbenannt.txt")).unwrap();
    let got = wait_for(&rx, Duration::from_secs(3), |g| {
        !removed_paths(g).is_empty()
    });
    assert_eq!(
        removed_paths(&got),
        vec![dir.join("umbenannt.txt").to_string_lossy().into_owned()]
    );
}

#[test]
fn changes_below_a_subfolder_only_touch_that_child() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    fs::create_dir(dir.join("sub")).unwrap();
    let (hub, rx) = hub();
    hub.set_dirs(std::slice::from_ref(&dir), false).unwrap();
    fs::write(dir.join("sub").join("deep.txt"), b"x").unwrap();
    // non-recursive: inotify reports nothing for files inside "sub" (or at most "sub" itself)
    let got = wait_for(&rx, Duration::from_millis(800), |_| false);
    for e in &got {
        if let WatchEvent::Changes {
            upserted, removed, ..
        } = e
        {
            assert!(removed.is_empty());
            assert!(upserted.iter().all(|u| u.name == "sub"), "{got:?}");
        }
    }
}

#[test]
fn a_mass_change_becomes_a_rescan() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    let (hub, rx) = hub();
    hub.set_dirs(std::slice::from_ref(&dir), false).unwrap();
    for i in 0..2000 {
        fs::write(dir.join(format!("f{i:05}.txt")), b"").unwrap();
    }
    let got = wait_for(&rx, Duration::from_secs(3), |g| {
        g.iter().any(|e| matches!(e, WatchEvent::Rescan { .. }))
    });
    assert!(
        got.iter().any(|e| matches!(e, WatchEvent::Rescan { .. })),
        "{} events",
        got.len()
    );
    // never 2000 single entries
    assert!(upserted_names(&got).len() <= 2 * batch::MAX_NAMES);
}

#[test]
fn a_deleted_folder_is_gone_and_unwatched_folders_are_quiet() {
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("a");
    let b = tmp.path().join("b");
    fs::create_dir(&a).unwrap();
    fs::create_dir(&b).unwrap();
    let (hub, rx) = hub();
    hub.set_dirs(&[a.clone(), b.clone()], false).unwrap();
    // b is no longer shown
    hub.set_dirs(std::slice::from_ref(&a), false).unwrap();
    fs::write(b.join("x"), b"").unwrap();
    fs::remove_dir(&a).unwrap();
    let got = wait_for(&rx, Duration::from_secs(3), |g| {
        g.iter().any(|e| matches!(e, WatchEvent::Gone { .. }))
    });
    assert!(
        got.contains(&WatchEvent::Gone {
            dir: a.to_string_lossy().into_owned()
        }),
        "{got:?}"
    );
    assert!(got.iter().all(|e| match e {
        WatchEvent::Changes { dir, .. } | WatchEvent::Rescan { dir } | WatchEvent::Gone { dir } =>
            dir == &a.to_string_lossy(),
    }));
}

#[test]
fn limits_and_unusable_folders() {
    let tmp = tempfile::tempdir().unwrap();
    let (hub, _rx) = hub();
    let many: Vec<PathBuf> = (0..=MAX_WATCHED)
        .map(|i| tmp.path().join(i.to_string()))
        .collect();
    assert_eq!(
        hub.set_dirs(&many, false).unwrap_err().code,
        FsErrorCode::TooMany
    );
    let st = hub
        .set_dirs(
            &[
                tmp.path().join("missing"),
                tmp.path().into(),
                tmp.path().into(),
            ],
            false,
        )
        .unwrap();
    assert_eq!(st.len(), 2, "duplicates are watched once");
    assert_eq!(st[0].mode, WatchMode::Off);
    assert_eq!(st[1].mode, WatchMode::Native);
}

#[test]
fn polling_reports_changes_too() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    let (hub, rx) = hub();
    let mut w = hub.watchers.lock().unwrap();
    hub.poller(&mut w)
        .unwrap()
        .watch(&dir, RecursiveMode::NonRecursive)
        .unwrap();
    w.current.push((dir.clone(), WatchMode::Poll));
    drop(w);
    hub.tx
        .send(Msg::Dirs(vec![Watched {
            dir: dir.clone(),
            aliases: aliases_of(&dir),
        }]))
        .unwrap();
    std::thread::sleep(Duration::from_millis(100));
    fs::write(dir.join("polled.txt"), b"1").unwrap();
    let got = wait_for(&rx, POLL_INTERVAL * 3, |g| {
        upserted_names(g).contains(&"polled.txt".to_string())
    });
    assert!(
        upserted_names(&got).contains(&"polled.txt".to_string()),
        "{got:?}"
    );
}
