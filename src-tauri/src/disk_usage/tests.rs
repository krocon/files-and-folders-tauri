//! Tests of the tree (pure) and the walker (temp folders) – design 033.

use super::tree::*;
use super::walk::{self, Ident, RealIdent, WalkPlan, WalkProgress};
use super::*;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::sync::atomic::AtomicBool;
use tempfile::tempdir;

const MIB: u64 = 1024 * 1024;

fn file(name: &str, size: u64) -> Scanned {
    Scanned {
        name: OsString::from(name),
        kind: NodeKind::File,
        allocated: size,
        logical: size,
        modified_ms: Some(1000),
    }
}

fn dir(name: &str) -> Scanned {
    Scanned {
        name: OsString::from(name),
        kind: NodeKind::Dir,
        allocated: 0,
        logical: 0,
        modified_ms: Some(2000),
    }
}

fn names(n: &UsageNode) -> Vec<(NodeKind, String, u64)> {
    n.children
        .as_ref()
        .unwrap()
        .iter()
        .map(|c| (c.kind, c.name.clone(), c.allocated))
        .collect()
}

fn root() -> PathBuf {
    std::env::temp_dir().join("wurzel ä")
}

// ---- tree ----

#[test]
fn keeps_the_largest_and_all_big_files_and_aggregates_the_rest() {
    let mut t = Tree::new(&[root()], SizeMode::Allocated);
    let mut entries: Vec<Scanned> = (0..20).map(|i| file(&format!("f{i:02}"), 10 + i)).collect();
    entries.push(file("gross.iso", 3 * MIB));
    entries.push(file("auch gross.bin", 2 * MIB));
    entries.push(dir("sub"));
    let dirs = t.add_entries(TOP, entries);
    assert_eq!(dirs.len(), 1);
    assert_eq!(dirs[0].1, 22, "index of the entry in the input");
    let tot = t.totals(TOP).unwrap();
    assert_eq!(tot.files, 22);
    assert_eq!(tot.dirs, 1);
    assert_eq!(tot.allocated, 5 * MIB + (10..30).sum::<u64>());
    let v = t.view(TOP, 1, 0.0, 1000).unwrap();
    let ch = names(&v);
    assert_eq!(ch[0], (NodeKind::File, "gross.iso".into(), 3 * MIB));
    assert_eq!(ch[1], (NodeKind::File, "auch gross.bin".into(), 2 * MIB));
    // 16 kept in all (2 big + 14 small), 6 smallest aggregated
    let files = ch.iter().filter(|c| c.0 == NodeKind::File).count();
    assert_eq!(files, 16);
    let agg = ch.iter().find(|c| c.0 == NodeKind::Files).unwrap();
    assert_eq!(agg.2, (10..16).sum::<u64>());
    assert_eq!(
        v.children.as_ref().unwrap().last().unwrap().kind,
        NodeKind::Files
    );
}

#[test]
fn big_files_beyond_the_per_folder_count_are_kept() {
    let mut t = Tree::new(&[root()], SizeMode::Allocated);
    let entries: Vec<Scanned> = (0..40).map(|i| file(&format!("big{i}"), MIB + i)).collect();
    t.add_entries(TOP, entries);
    let v = t.view(TOP, 1, 0.0, 1000).unwrap();
    assert_eq!(v.children.unwrap().len(), 40);
    assert_eq!(t.largest(TOP, 100).len(), 40);
}

#[test]
fn views_sort_by_size_and_fold_small_children_and_the_overflow() {
    let mut t = Tree::new(&[root()], SizeMode::Logical);
    let ids = t.add_entries(TOP, vec![dir("a"), dir("b"), dir("c"), dir("d")]);
    let id = |i: usize| ids.iter().find(|(_, x)| *x == i).unwrap().0;
    t.add_entries(id(0), vec![file("x", 100)]);
    t.add_entries(id(1), vec![file("y", 800)]);
    t.add_entries(id(2), vec![file("z", 50)]);
    t.add_entries(id(3), vec![file("w", 50)]);
    let v = t.view(TOP, 2, 0.1, 1000).unwrap();
    let ch = v.children.as_ref().unwrap();
    assert_eq!(ch[0].name, "b");
    assert_eq!(ch[1].name, "a");
    assert_eq!(ch[0].children.as_ref().unwrap()[0].name, "y");
    // c and d are below 10 % of 1000 → one rest
    assert_eq!(ch[2].kind, NodeKind::Rest);
    assert_eq!((ch[2].files, ch[2].logical), (2, 100));
    let v = t.view(TOP, 1, 0.0, 1).unwrap();
    let ch = v.children.unwrap();
    assert_eq!(ch.len(), 2);
    assert_eq!((ch[1].kind, ch[1].files), (NodeKind::Rest, 3));
    // files have no children
    assert!(
        t.view(id(1), 3, 0.0, 10).unwrap().children.unwrap()[0]
            .children
            .is_none()
    );
}

#[test]
fn largest_files_are_exact_with_paths_relative_to_the_node() {
    let r = root();
    let mut t = Tree::new(std::slice::from_ref(&r), SizeMode::Allocated);
    let ids = t.add_entries(TOP, vec![dir("eins"), file("oben", 5 * MIB)]);
    let eins = ids[0].0;
    let sub = t.add_entries(eins, vec![dir("zwei 📁"), file("klein", 10)])[0].0;
    t.add_entries(
        sub,
        vec![file("tief.mkv", 9 * MIB), file("mittel", 2 * MIB)],
    );
    let l = t.largest(TOP, 2);
    assert_eq!(l.len(), 2);
    assert_eq!(l[0].name, "tief.mkv");
    assert_eq!(
        l[0].dir,
        Path::new("eins").join("zwei 📁").to_string_lossy()
    );
    assert_eq!(l[0].dir_id, sub);
    assert_eq!(
        PathBuf::from(&l[0].path),
        r.join("eins").join("zwei 📁").join("tief.mkv")
    );
    assert_eq!(l[1].name, "oben");
    assert_eq!(l[1].dir, "");
    let l = t.largest(eins, 10);
    assert_eq!(
        l.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
        ["tief.mkv", "mittel", "klein"]
    );
    assert_eq!(l[0].dir, "zwei 📁");
}

#[test]
fn removing_corrects_the_totals_up_to_the_top() {
    let mut t = Tree::new(&[root()], SizeMode::Allocated);
    let a = t.add_entries(TOP, vec![dir("a"), file("f", 7)])[0].0;
    t.set_dir_self(a, 4096, None);
    let b = t.add_entries(a, vec![dir("b")])[0].0;
    t.add_entries(b, vec![file("g", 100), file("h", 1)]);
    assert_eq!(t.totals(TOP).unwrap().allocated, 4096 + 108);
    let g = t.locate(&root().join("a").join("b").join("g")).unwrap();
    assert!(t.remove(g));
    assert_eq!(t.totals(b).unwrap().allocated, 1);
    assert_eq!(t.totals(TOP).unwrap().files, 2);
    assert!(t.remove(a));
    let tot = t.totals(TOP).unwrap();
    assert_eq!((tot.allocated, tot.files, tot.dirs), (7, 1, 0));
    assert!(t.totals(b).is_none(), "removed with its folder");
    assert!(!t.remove(TOP), "roots stay");
    assert!(t.locate(&root().join("a")).is_none());
}

#[test]
fn several_roots_get_a_virtual_top_node() {
    let (r1, r2) = (root().join("eins"), root().join("zwei"));
    let mut t = Tree::new(&[r1.clone(), r2.clone()], SizeMode::Allocated);
    assert!(t.is_virtual(TOP));
    assert_eq!(t.path_of(TOP), None);
    let (id1, id2) = (t.roots()[0].0, t.roots()[1].0);
    assert_eq!(t.path_of(id2), Some(r2.clone()));
    let x = t.add_entries(id2, vec![dir("x")])[0].0;
    t.add_entries(id1, vec![file("a", 30)]);
    t.add_entries(x, vec![file("b", 70)]);
    assert_eq!(t.totals(TOP).unwrap().allocated, 100);
    assert_eq!(
        t.locate(&r2.join("x").join("b")).map(|n| t.kind(n)),
        Some(Some(NodeKind::File))
    );
    assert_eq!(
        t.locate(&r1.join("..").join("eins").join("a")),
        t.locate(&r1.join("a"))
    );
    let crumbs: Vec<String> = t.crumbs(x).into_iter().map(|c| c.name).collect();
    assert_eq!(crumbs, ["", "zwei", "x"]);
    let v = t.view(TOP, 1, 0.0, 10).unwrap();
    assert_eq!(v.path, None);
    assert_eq!(v.children.unwrap()[0].name, "zwei");
    let single = Tree::new(std::slice::from_ref(&r1), SizeMode::Allocated);
    assert!(!single.is_virtual(TOP));
    assert_eq!(single.path_of(TOP), Some(r1));
}

#[test]
fn the_node_limit_simplifies_but_keeps_the_totals() {
    let mut t = Tree::new(&[root()], SizeMode::Allocated);
    t.set_max_nodes(5);
    let entries: Vec<Scanned> = (0..10).map(|i| file(&format!("f{i}"), MIB + i)).collect();
    t.add_entries(TOP, entries);
    let dirs = t.add_entries(TOP, vec![dir("spät")]);
    assert!(dirs.is_empty());
    assert!(t.simplified);
    let tot = t.totals(TOP).unwrap();
    assert_eq!((tot.files, tot.dirs), (10, 1));
    assert_eq!(tot.allocated, 10 * MIB + 45);
    assert!(t.len() <= 5);
}

#[test]
fn grafting_replaces_a_folder_and_its_totals() {
    let r = root();
    let mut t = Tree::new(std::slice::from_ref(&r), SizeMode::Allocated);
    let a = t.add_entries(TOP, vec![dir("a"), file("bleibt", 5)])[0].0;
    t.add_entries(a, vec![file("alt", 100), dir("weg")]);
    let mut fresh = Tree::new(&[r.join("a")], SizeMode::Allocated);
    let neu = fresh.add_entries(TOP, vec![dir("neu"), file("frisch", 40)])[0].0;
    fresh.add_entries(neu, vec![file("tief", 2)]);
    t.graft(a, &fresh);
    let tot = t.totals(TOP).unwrap();
    assert_eq!((tot.allocated, tot.files, tot.dirs), (47, 3, 2));
    assert_eq!(t.totals(a).unwrap().allocated, 42);
    assert!(t.locate(&r.join("a").join("alt")).is_none());
    assert!(t.locate(&r.join("a").join("neu").join("tief")).is_some());
    assert_eq!(names(&t.view(a, 1, 0.0, 9).unwrap())[0].1, "frisch");
}

// ---- walker ----

fn scan_with(roots: &[PathBuf], plan: &WalkPlan, ident: &dyn Ident, threads: usize) -> Tree {
    let tree = RwLock::new(Tree::new(roots, SizeMode::Logical));
    let progress = WalkProgress::default();
    assert!(walk::walk(
        &tree,
        plan,
        ident,
        threads,
        &AtomicBool::new(false),
        &progress
    ));
    let mut t = tree.into_inner().unwrap();
    t.sort_children();
    t
}

fn scan(root: &Path) -> Tree {
    scan_with(
        &[root.to_path_buf()],
        &plan_for(&[root.to_path_buf()], false),
        &RealIdent,
        4,
    )
}

fn sample(dir: &Path) -> PathBuf {
    let r = dir.join("Wurzel ä");
    fs::create_dir_all(r.join("Unter ordner 📁/tief")).unwrap();
    fs::create_dir_all(r.join("leer")).unwrap();
    fs::write(r.join("a.txt"), vec![1u8; 1000]).unwrap();
    fs::write(r.join("Unter ordner 📁/b"), vec![1u8; 24]).unwrap();
    fs::write(r.join("Unter ordner 📁/tief/c 📄"), vec![1u8; 3000]).unwrap();
    fs::write(r.join(".versteckt"), vec![1u8; 5]).unwrap();
    r
}

#[test]
fn walks_a_tree_with_unicode_names() {
    let d = tempdir().unwrap();
    let r = sample(d.path());
    let t = scan(&r);
    let tot = t.totals(TOP).unwrap();
    assert_eq!((tot.files, tot.dirs, tot.logical), (4, 3, 4029));
    assert_eq!(tot.unreadable, 0);
    let v = t.view(TOP, 2, 0.0, 100).unwrap();
    let ch = v.children.as_ref().unwrap();
    assert_eq!(ch[0].name, "Unter ordner 📁");
    assert_eq!(ch[0].logical, 3024);
    assert_eq!(ch[0].children.as_ref().unwrap()[0].name, "tief");
    assert!(
        ch.iter().any(|c| c.name == ".versteckt"),
        "hidden entries count"
    );
    assert!(v.modified_ms.is_some());
    // the same result with one thread
    let one = scan_with(
        std::slice::from_ref(&r),
        &plan_for(std::slice::from_ref(&r), false),
        &RealIdent,
        1,
    );
    assert_eq!(one.totals(TOP), t.totals(TOP));
}

#[cfg(unix)]
#[test]
fn allocated_size_reflects_blocks_and_sparse_files() {
    let d = tempdir().unwrap();
    let f = fs::File::create(d.path().join("sparse")).unwrap();
    f.set_len(50 * MIB).unwrap();
    fs::write(d.path().join("voll"), vec![1u8; 100_000]).unwrap();
    let tree = RwLock::new(Tree::new(&[d.path().to_path_buf()], SizeMode::Allocated));
    walk::walk(
        &tree,
        &WalkPlan::default(),
        &RealIdent,
        2,
        &AtomicBool::new(false),
        &WalkProgress::default(),
    );
    let t = tree.into_inner().unwrap();
    let sparse = t.locate(&d.path().join("sparse")).unwrap();
    let st = t.totals(sparse).unwrap();
    assert_eq!(st.logical, 50 * MIB);
    assert!(st.allocated < MIB, "a sparse file takes (almost) no blocks");
    let voll = t.totals(t.locate(&d.path().join("voll")).unwrap()).unwrap();
    assert!(voll.allocated >= 100_000);
}

#[cfg(unix)]
#[test]
fn hard_links_count_once_and_links_are_never_followed() {
    use std::os::unix::fs::symlink;
    let d = tempdir().unwrap();
    let r = d.path().join("r");
    fs::create_dir_all(r.join("sub")).unwrap();
    fs::write(r.join("sub/original"), vec![1u8; 10_000]).unwrap();
    fs::hard_link(r.join("sub/original"), r.join("zweiter name")).unwrap();
    let outside = d.path().join("gross");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("x"), vec![1u8; 500_000]).unwrap();
    symlink(&outside, r.join("link auf ordner")).unwrap();
    symlink(outside.join("x"), r.join("link auf datei")).unwrap();
    symlink(d.path().join("fehlt"), r.join("dangling")).unwrap();
    symlink(&r, r.join("sub/zyklus")).unwrap();
    let t = scan(&r);
    let tot = t.totals(TOP).unwrap();
    assert!(
        tot.logical < 12_000,
        "neither the target nor the second name: {tot:?}"
    );
    assert_eq!(tot.dirs, 1);
    let link = t.locate(&r.join("link auf ordner")).unwrap();
    assert_eq!(t.kind(link), Some(NodeKind::Link));
    assert!(t.children(link).is_empty());
}

#[cfg(unix)]
#[test]
fn unreadable_folders_are_counted_and_marked() {
    use std::os::unix::fs::PermissionsExt;
    let d = tempdir().unwrap();
    let locked = d.path().join("gesperrt");
    fs::create_dir(&locked).unwrap();
    fs::write(locked.join("f"), "x").unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    let t = scan(d.path());
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    let id = t.locate(&locked).unwrap();
    // root reads it anyway – then the file is counted instead
    if t.totals(TOP).unwrap().files == 0 {
        assert!(t.is_unreadable(id));
        assert_eq!(t.totals(TOP).unwrap().unreadable, 1);
    }
}

#[test]
fn a_missing_root_is_unreadable() {
    let d = tempdir().unwrap();
    let gone = d.path().join("weg");
    let t = scan_with(&[gone], &WalkPlan::default(), &RealIdent, 2);
    assert!(t.is_unreadable(TOP));
}

#[cfg(target_os = "linux")]
#[test]
fn non_utf8_names_keep_their_exact_path() {
    use std::os::unix::ffi::OsStrExt;
    let d = tempdir().unwrap();
    let name = std::ffi::OsStr::from_bytes(b"kaputt\xff");
    fs::write(d.path().join(name), vec![1u8; 10]).unwrap();
    let t = scan(d.path());
    let v = t.view(TOP, 1, 0.0, 10).unwrap();
    let c = &v.children.unwrap()[0];
    assert!(c.lossy_name);
    assert_eq!(t.path_of(c.id).unwrap(), d.path().join(name));
}

/// Devices by path prefix, inodes from the real file system.
struct FakeIdent {
    devices: Vec<(PathBuf, u64)>,
}

impl Ident for FakeIdent {
    fn device(&self, path: &Path, _meta: &fs::Metadata) -> Option<u64> {
        Some(
            self.devices
                .iter()
                .filter(|(p, _)| path.starts_with(p))
                .max_by_key(|(p, _)| p.as_os_str().len())
                .map(|(_, d)| *d)
                .unwrap_or(1),
        )
    }
    fn inode(&self, path: &Path, meta: &fs::Metadata) -> Option<(u64, u64)> {
        RealIdent.inode(path, meta)
    }
    fn links(&self, meta: &fs::Metadata) -> u64 {
        RealIdent.links(meta)
    }
    fn allocated(&self, _path: &Path, meta: &fs::Metadata) -> u64 {
        if meta.is_dir() { 0 } else { meta.len() }
    }
}

#[test]
fn stays_on_the_allowed_devices_and_skips_the_data_volume() {
    let d = tempdir().unwrap();
    let r = d.path().join("root");
    fs::create_dir_all(r.join("Users/marc")).unwrap();
    fs::create_dir_all(r.join("mnt/stick")).unwrap();
    fs::create_dir_all(r.join("System/Volumes/Data/Users")).unwrap();
    fs::write(r.join("Users/marc/doc"), vec![1u8; 100]).unwrap();
    fs::write(r.join("mnt/stick/film"), vec![1u8; 1000]).unwrap();
    fs::write(r.join("System/Volumes/Data/Users/doppelt"), vec![1u8; 100]).unwrap();
    // like macOS: / = 1, the data volume (and the firmlinked /Users) = 2, a stick = 3
    let ident = FakeIdent {
        devices: vec![
            (r.join("Users"), 2),
            (r.join("System/Volumes/Data"), 2),
            (r.join("mnt/stick"), 3),
        ],
    };
    let mut plan = WalkPlan {
        devices: [1, 2].into_iter().collect(),
        cross_filesystems: false,
        skip: vec![r.join("System/Volumes/Data")],
    };
    let t = scan_with(std::slice::from_ref(&r), &plan, &ident, 3);
    assert_eq!(t.totals(TOP).unwrap().logical, 100, "only /Users/marc/doc");
    let stick = t.locate(&r.join("mnt/stick")).unwrap();
    assert_eq!(t.kind(stick), Some(NodeKind::Mount));
    assert!(t.locate(&r.join("System/Volumes/Data")).is_none());
    // one device only: /Users is a foreign file system
    plan.devices = [1].into_iter().collect();
    let t = scan_with(std::slice::from_ref(&r), &plan, &ident, 3);
    assert_eq!(t.totals(TOP).unwrap().logical, 0);
    assert_eq!(
        t.kind(t.locate(&r.join("Users")).unwrap()),
        Some(NodeKind::Mount)
    );
    // crossing allowed: the stick counts
    plan.cross_filesystems = true;
    let t = scan_with(std::slice::from_ref(&r), &plan, &ident, 3);
    assert_eq!(t.totals(TOP).unwrap().logical, 1100);
}

#[cfg(unix)]
#[test]
fn the_same_folder_is_visited_once() {
    // two roots, one inside the other, given as they are: the inner folder counts once
    let d = tempdir().unwrap();
    let r = sample(d.path());
    let inner = r.join("Unter ordner 📁");
    let t = scan_with(&[r.clone(), inner], &WalkPlan::default(), &RealIdent, 3);
    assert_eq!(t.totals(TOP).unwrap().logical, 4029);
}

#[test]
fn stops_when_cancelled() {
    let d = tempdir().unwrap();
    let r = sample(d.path());
    let tree = RwLock::new(Tree::new(&[r], SizeMode::Allocated));
    let done = walk::walk(
        &tree,
        &WalkPlan::default(),
        &RealIdent,
        2,
        &AtomicBool::new(true),
        &WalkProgress::default(),
    );
    assert!(!done);
}

#[test]
fn reports_progress() {
    let d = tempdir().unwrap();
    let r = sample(d.path());
    let tree = RwLock::new(Tree::new(&[r], SizeMode::Allocated));
    let p = WalkProgress::default();
    walk::walk(
        &tree,
        &WalkPlan::default(),
        &RealIdent,
        2,
        &AtomicBool::new(false),
        &p,
    );
    assert_eq!(p.entries.load(std::sync::atomic::Ordering::Relaxed), 7);
    assert!(p.current.lock().unwrap().is_some());
}

#[test]
fn prune_removes_only_what_is_gone() {
    let d = tempdir().unwrap();
    let r = sample(d.path());
    let scan = Scan::new(scan(&r), false);
    fs::remove_file(r.join("a.txt")).unwrap();
    fs::remove_dir_all(r.join("Unter ordner 📁")).unwrap();
    let n = scan.prune(&[
        r.join("a.txt"),
        r.join("Unter ordner 📁"),
        r.join(".versteckt"), // still there
        r.join("nie gescannt"),
    ]);
    assert_eq!(n, 2);
    let tot = scan.read().totals(TOP).unwrap();
    assert_eq!((tot.files, tot.dirs, tot.logical), (1, 1, 5));
    let v = scan.view(None, 1, 0.0, 10).unwrap();
    assert!(v.version > 0);
    assert_eq!(v.crumbs.len(), 1);
}

#[test]
fn the_hub_keeps_three_finished_scans_and_never_drops_running_ones() {
    let hub = DiskUsageHub::default();
    let mk = |running: bool| {
        let s = Scan::new(Tree::new(&[root()], SizeMode::Allocated), false);
        s.running
            .store(running, std::sync::atomic::Ordering::SeqCst);
        std::sync::Arc::new(s)
    };
    hub.insert("j1", mk(false));
    hub.insert("j2", mk(true));
    hub.insert("j3", mk(false));
    hub.get("j1").unwrap(); // j1 is used again: j3 is the oldest finished now
    hub.insert("j4", mk(false));
    assert_eq!(hub.ids(), ["j2", "j1", "j4"]);
    assert_eq!(
        hub.get("j3").unwrap_err().code,
        crate::error::FsErrorCode::ScanNotFound
    );
    assert!(hub.release("j2"));
    assert!(!hub.release("j2"));
}

#[test]
fn check_root_wants_an_existing_folder() {
    let d = tempdir().unwrap();
    fs::write(d.path().join("f"), "x").unwrap();
    assert!(check_root(d.path()).is_ok());
    assert_eq!(
        check_root(&d.path().join("f")).unwrap_err().code,
        crate::error::FsErrorCode::NotADirectory
    );
    assert_eq!(
        check_root(&d.path().join("x")).unwrap_err().code,
        crate::error::FsErrorCode::NotFound
    );
}

#[cfg(unix)]
#[test]
fn volume_root_climbs_while_the_device_stays() {
    let d = tempdir().unwrap();
    let r = crate::platform::disk_usage::volume_root(d.path());
    assert!(d.path().starts_with(&r));
    assert_eq!(crate::platform::disk_usage::volume_root(&r), r);
}

#[test]
fn wire_format() {
    let mut t = Tree::new(&[root()], SizeMode::Allocated);
    t.add_entries(TOP, vec![file("a", 1)]);
    let v = serde_json::to_value(t.view(TOP, 1, 0.0, 9).unwrap()).unwrap();
    assert_eq!(v["kind"], "dir");
    assert_eq!(v["children"][0]["kind"], "file");
    assert_eq!(v["children"][0]["modifiedMs"], 1000);
    assert_eq!(v["children"][0]["lossyName"], false);
    assert!(v["children"][0].get("children").is_none());
    let o: DiskUsageOptions =
        serde_json::from_str(r#"{"crossFilesystems":true,"sizeMode":"logical"}"#).unwrap();
    assert_eq!(o.size_mode, SizeMode::Logical);
    assert_eq!(DiskUsageOptions::default().size_mode, SizeMode::Allocated);
}

/// Measurement for design 033 E4 (not part of `cargo test`):
/// `cargo test --release --lib disk_usage::tests::measure -- --ignored --nocapture`
/// (`FNF_MEASURE_DIR=<folder>` measures a real folder instead of a generated tree).
#[test]
#[ignore]
fn measure() {
    let d = tempdir().unwrap();
    let root = match std::env::var_os("FNF_MEASURE_DIR") {
        Some(p) => PathBuf::from(p),
        None => {
            let r = d.path().join("gen");
            for a in 0..100 {
                for b in 0..20 {
                    let dir = r.join(format!("a{a}/b{b}"));
                    fs::create_dir_all(&dir).unwrap();
                    for f in 0..100 {
                        fs::write(dir.join(format!("f{f}.dat")), [0u8; 10]).unwrap();
                    }
                }
            }
            r
        }
    };
    println!("node: {} B", Tree::node_size());
    for threads in [1, 2, 4, 8] {
        // drop the page cache influence: the first run warms it, the rest compare
        let start = std::time::Instant::now();
        let tree = RwLock::new(Tree::new(std::slice::from_ref(&root), SizeMode::Allocated));
        walk::walk(
            &tree,
            &plan_for(std::slice::from_ref(&root), false),
            &RealIdent,
            threads,
            &AtomicBool::new(false),
            &WalkProgress::default(),
        );
        let t = tree.into_inner().unwrap();
        let tot = t.totals(TOP).unwrap();
        println!(
            "threads {threads}: {:?} for {} files, {} dirs, {} nodes",
            start.elapsed(),
            tot.files,
            tot.dirs,
            t.len()
        );
    }
}
