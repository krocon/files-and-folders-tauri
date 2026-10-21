//! Job `diskUsage` through the JobManager (design 033).

use super::tests_engine::{Harness, tree};
use super::*;
use crate::disk_usage::{DiskUsageOptions, NodeKind, Rescan, SizeMode, TOP};
use std::fs;

fn start(h: &Harness, roots: &[&std::path::Path]) -> String {
    h.mgr
        .start(JobSpec::DiskUsage {
            roots: roots
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            volume: false,
            rescan: None,
            options: DiskUsageOptions {
                cross_filesystems: false,
                size_mode: SizeMode::Logical,
            },
        })
        .unwrap()
}

#[test]
fn scans_into_the_hub_with_progress_and_summary() {
    let h = Harness::new();
    let (_d, src, _dst) = tree();
    let id = start(&h, &[&src]);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let s = info.summary.unwrap().disk_usage.unwrap();
    assert!(s.complete);
    assert_eq!(s.entries, 4);
    let scan = h.mgr.disk_usage().get(&id).unwrap();
    let v = scan.view(None, 2, 0.0, 100).unwrap();
    assert!(!v.running && v.complete && !v.virtual_top);
    assert_eq!(v.node.logical, 200_005);
    assert_eq!(v.node.children.as_ref().unwrap()[0].name, "Unter ordner 📁");
    assert_eq!(v.size_mode, SizeMode::Logical);
    assert!(v.volume.is_none());
    assert!(h.count(|e| matches!(e, JobEvent::Progress { id: i, .. } if *i == id)) >= 1);
    // a helper job: quitting does not ask
    assert!(info.spec.is_helper() && info.spec.is_parallel());
}

#[test]
fn nested_roots_are_scanned_once() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    fs::write(dst.join("z"), vec![1u8; 10]).unwrap();
    let inner = src.join("Unter ordner 📁");
    let id = start(&h, &[&src, &inner, &dst]);
    h.finish(&id);
    let v = h
        .mgr
        .disk_usage()
        .get(&id)
        .unwrap()
        .view(None, 1, 0.0, 9)
        .unwrap();
    assert!(v.virtual_top);
    assert_eq!(v.node.logical, 200_015);
    assert_eq!(v.node.children.unwrap().len(), 2);
}

#[test]
fn rescans_a_folder_and_replaces_its_content() {
    let h = Harness::new();
    let (_d, src, _dst) = tree();
    let id = start(&h, &[&src]);
    h.finish(&id);
    let scan = h.mgr.disk_usage().get(&id).unwrap();
    let sub = scan.read().locate(&src.join("Unter ordner 📁")).unwrap();
    fs::write(src.join("Unter ordner 📁/neu"), vec![1u8; 1000]).unwrap();
    fs::write(src.join("a.txt"), "ignored until the next full scan").unwrap();
    let r = h
        .mgr
        .start(JobSpec::DiskUsage {
            roots: vec![],
            volume: false,
            rescan: Some(Rescan {
                scan_id: id.clone(),
                node_id: sub,
            }),
            options: DiskUsageOptions::default(),
        })
        .unwrap();
    assert_eq!(h.finish(&r).state, JobState::Done);
    let t = scan.read();
    assert_eq!(t.totals(TOP).unwrap().logical, 201_005);
    assert!(t.locate(&src.join("Unter ordner 📁/neu")).is_some());
    drop(t);
    assert!(!scan.busy.load(std::sync::atomic::Ordering::SeqCst));
    // a file is no folder to rescan; an unknown scan fails
    let file = scan.read().locate(&src.join("a.txt")).unwrap();
    assert_eq!(scan.read().kind(file), Some(NodeKind::File));
    for rescan in [
        Rescan {
            scan_id: id.clone(),
            node_id: file,
        },
        Rescan {
            scan_id: "j999".into(),
            node_id: 0,
        },
    ] {
        let j = h
            .mgr
            .start(JobSpec::DiskUsage {
                roots: vec![],
                volume: false,
                rescan: Some(rescan),
                options: DiskUsageOptions::default(),
            })
            .unwrap();
        let info = h.finish(&j);
        assert_eq!(info.state, JobState::Failed);
        assert_eq!(
            info.summary.unwrap().error.unwrap().code,
            crate::error::FsErrorCode::ScanNotFound
        );
    }
}

#[test]
fn validation_rejects_bad_roots() {
    let h = Harness::new();
    let (_d, src, dst) = tree();
    let spec = |roots: Vec<String>, volume: bool| JobSpec::DiskUsage {
        roots,
        volume,
        rescan: None,
        options: DiskUsageOptions::default(),
    };
    let s = |p: &std::path::Path| p.to_string_lossy().into_owned();
    let code = |r: Result<String, crate::error::FsError>| r.unwrap_err().code;
    use crate::error::FsErrorCode as C;
    assert_eq!(code(h.mgr.start(spec(vec![], false))), C::InvalidPath);
    assert_eq!(
        code(h.mgr.start(spec(vec![s(&src.join("a.txt"))], false))),
        C::NotADirectory
    );
    assert_eq!(
        code(h.mgr.start(spec(vec![s(&src.join("fehlt"))], false))),
        C::NotFound
    );
    assert_eq!(
        code(h.mgr.start(spec(vec!["relativ".into()], false))),
        C::InvalidPath
    );
    assert_eq!(
        code(h.mgr.start(spec(vec![s(&src), s(&dst)], true))),
        C::TooMany
    );
    let many: Vec<String> = (0..=crate::disk_usage::MAX_ROOTS)
        .map(|_| s(&src))
        .collect();
    assert_eq!(code(h.mgr.start(spec(many, false))), C::TooMany);
    // an archive path is no folder
    let zip = src.join("x.zip");
    fs::write(&zip, "PK").unwrap();
    assert_eq!(
        code(h.mgr.start(spec(vec![s(&zip.join("inner"))], false))),
        C::NotADirectory
    );
}

#[test]
fn cancelling_keeps_the_partial_tree() {
    let h = Harness::new();
    let (_d, src, _dst) = tree();
    for i in 0..300 {
        fs::create_dir_all(src.join(format!("d{i}/e/f"))).unwrap();
    }
    let id = start(&h, &[&src]);
    // cancelled while it runs (cancelled before it ran, no scan exists – `scan_not_found`)
    while h.mgr.disk_usage().get(&id).is_err() {
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert!(matches!(info.state, JobState::Cancelled | JobState::Done));
    let scan = h.mgr.disk_usage().get(&id).unwrap();
    let v = scan.view(None, 1, 0.0, 10).unwrap();
    assert!(!v.running);
    assert_eq!(v.complete, info.state == JobState::Done);
}

#[test]
fn wire_format() {
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"diskUsage","roots":["/a"],"options":{"sizeMode":"logical"}}"#,
    )
    .unwrap();
    assert_eq!(spec.kind(), "diskUsage");
    let JobSpec::DiskUsage {
        volume,
        rescan,
        options,
        ..
    } = &spec
    else {
        panic!()
    };
    assert!(!volume && rescan.is_none() && !options.cross_filesystems);
    let spec: JobSpec =
        serde_json::from_str(r#"{"kind":"diskUsage","rescan":{"scanId":"j3","nodeId":7}}"#)
            .unwrap();
    let JobSpec::DiskUsage { rescan, roots, .. } = &spec else {
        panic!()
    };
    assert!(roots.is_empty());
    assert_eq!(rescan.as_ref().unwrap().node_id, 7);
    let s = Summary {
        disk_usage: Some(crate::disk_usage::DiskUsageSummary::default()),
        ..Summary::default()
    };
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["diskUsage"]["complete"], false);
    assert!(
        serde_json::to_value(Summary::default())
            .unwrap()
            .get("diskUsage")
            .is_none()
    );
}

#[test]
fn a_rescan_waits_for_the_first_walk() {
    let h = Harness::new();
    let scan = std::sync::Arc::new(crate::disk_usage::Scan::new(
        crate::disk_usage::Tree::new(&[std::env::temp_dir()], SizeMode::Allocated),
        false,
    ));
    h.mgr.disk_usage().insert("jX", scan);
    let j = h
        .mgr
        .start(JobSpec::DiskUsage {
            roots: vec![],
            volume: false,
            rescan: Some(Rescan {
                scan_id: "jX".into(),
                node_id: 0,
            }),
            options: DiskUsageOptions::default(),
        })
        .unwrap();
    let info = h.finish(&j);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        crate::error::FsErrorCode::ScanBusy
    );
}
