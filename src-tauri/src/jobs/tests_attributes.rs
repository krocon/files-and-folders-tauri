//! Tests for the change-attributes job (design 024), driven through the JobManager.

use super::tests_engine::Harness;
use super::*;
use crate::attributes::{ApplyTo, AttrChange, MIN_MS, TimeValue};
use crate::error::FsErrorCode;
use std::fs;
use std::path::Path;
#[cfg(unix)]
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn spec(paths: &[&Path], change: AttrChange, recursive: bool, apply_to: ApplyTo) -> JobSpec {
    JobSpec::Attributes {
        paths: paths.iter().map(|p| s(p)).collect(),
        change,
        recursive,
        apply_to,
    }
}

impl Harness {
    fn attrs(&self, paths: &[&Path], change: AttrChange) -> JobInfo {
        self.attrs_with(paths, change, false, ApplyTo::All)
    }

    fn attrs_with(
        &self,
        paths: &[&Path],
        change: AttrChange,
        recursive: bool,
        apply_to: ApplyTo,
    ) -> JobInfo {
        let id = self
            .mgr
            .start(spec(paths, change, recursive, apply_to))
            .unwrap();
        self.finish(&id)
    }
}

fn modified(t: SystemTime) -> AttrChange {
    AttrChange {
        modified: Some(TimeValue::At {
            ms: t.duration_since(UNIX_EPOCH).unwrap().as_millis() as i64,
        }),
        ..AttrChange::default()
    }
}

fn mtime(p: &Path) -> SystemTime {
    fs::symlink_metadata(p).unwrap().modified().unwrap()
}

#[test]
fn wire_format_kind_and_queue() {
    let spec: JobSpec = serde_json::from_str(
        r#"{"kind":"attributes","paths":["/a"],"change":{"modeSet":8,"accessed":{"type":"now"}}}"#,
    )
    .unwrap();
    assert_eq!(spec.kind(), "attributes");
    assert!(!spec.is_parallel() && !spec.is_helper());
    assert!(
        spec.changed_paths().is_empty(),
        "nothing is moved or deleted"
    );
    let JobSpec::Attributes {
        change,
        recursive,
        apply_to,
        ..
    } = &spec
    else {
        panic!()
    };
    assert_eq!(change.mode_set, 0o10);
    assert!(!recursive);
    assert_eq!(*apply_to, ApplyTo::All);
}

#[test]
fn target_dirs_are_the_folders_of_the_entries() {
    let d = tempdir().unwrap();
    let a = d.path().join("x").join("a");
    let b = d.path().join("x").join("b");
    let c = d.path().join("y");
    let spec = spec(
        &[&a, &b, &c],
        modified(SystemTime::now()),
        false,
        ApplyTo::All,
    );
    let mut want = vec![d.path().join("x"), d.path().to_path_buf()];
    want.sort();
    assert_eq!(spec.target_dirs(), want);
}

#[test]
fn rejects_invalid_requests_before_starting() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let code = |spec: JobSpec| h.mgr.start(spec).unwrap_err().code;
    let ok = modified(SystemTime::now());
    assert_eq!(
        code(spec(&[], ok.clone(), false, ApplyTo::All)),
        FsErrorCode::InvalidPath
    );
    assert_eq!(
        code(spec(
            &[Path::new("relative")],
            ok.clone(),
            false,
            ApplyTo::All
        )),
        FsErrorCode::InvalidPath
    );
    assert_eq!(
        code(spec(
            &[d.path()],
            AttrChange::default(),
            false,
            ApplyTo::All
        )),
        FsErrorCode::InvalidPath,
        "nothing to change"
    );
    let early = AttrChange {
        modified: Some(TimeValue::At { ms: MIN_MS - 1 }),
        ..AttrChange::default()
    };
    assert_eq!(
        code(spec(&[d.path()], early, false, ApplyTo::All)),
        FsErrorCode::InvalidPath
    );
    let many: Vec<String> = (0..=crate::attributes::MAX_ITEMS)
        .map(|i| s(&d.path().join(i.to_string())))
        .collect();
    assert_eq!(
        code(JobSpec::Attributes {
            paths: many,
            change: ok,
            recursive: false,
            apply_to: ApplyTo::All
        }),
        FsErrorCode::TooMany
    );
}

#[test]
fn recursive_changes_on_home_or_root_are_refused() {
    let h = Harness::new();
    let home = tempdir().unwrap();
    h.mgr.set_home(Some(home.path().to_path_buf()));
    let change = modified(SystemTime::now());
    let err = h
        .mgr
        .start(spec(&[home.path()], change.clone(), true, ApplyTo::All))
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::DangerousPath);
    let root = if cfg!(windows) {
        Path::new("C:\\")
    } else {
        Path::new("/")
    };
    let err = h
        .mgr
        .start(spec(&[root], change.clone(), true, ApplyTo::All))
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::DangerousPath);
    // a single change of the home folder itself is allowed
    let info = h.attrs(&[home.path()], change);
    assert_eq!(info.state, JobState::Done);
}

#[test]
fn sets_the_modification_time_of_files_and_folders() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let file = d.path().join("Grüße mit Leerzeichen 🎉.txt");
    let dir = d.path().join("Ordner ä");
    fs::write(&file, "x").unwrap();
    fs::create_dir(&dir).unwrap();
    let t = UNIX_EPOCH + Duration::from_millis(1_234_567_890_123);
    let info = h.attrs(&[&file, &dir], modified(t));
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    assert_eq!(mtime(&file), t);
    assert_eq!(mtime(&dir), t);
    let summary = info.summary.unwrap();
    assert_eq!(summary.items_done, 2);
    // the panel of the folder reloads
    let parent = s(d.path());
    assert!(h.count(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.contains(&parent))) > 0);
}

#[test]
fn accessed_alone_keeps_the_modification_time_and_now_is_one_instant() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let a = d.path().join("a");
    let b = d.path().join("b");
    fs::write(&a, "1").unwrap();
    fs::write(&b, "2").unwrap();
    let old = UNIX_EPOCH + Duration::from_secs(1_000_000_000);
    h.attrs(&[&a, &b], modified(old));
    let accessed = AttrChange {
        accessed: Some(TimeValue::At {
            ms: 1_500_000_000_000,
        }),
        ..AttrChange::default()
    };
    h.attrs(&[&a], accessed);
    let m = fs::metadata(&a).unwrap();
    assert_eq!(m.modified().unwrap(), old, "modification time untouched");
    assert_eq!(
        m.accessed().unwrap(),
        UNIX_EPOCH + Duration::from_millis(1_500_000_000_000)
    );
    let before = SystemTime::now() - Duration::from_secs(1);
    let now = AttrChange {
        modified: Some(TimeValue::Now),
        ..AttrChange::default()
    };
    h.attrs(&[&a, &b], now);
    assert!(mtime(&a) >= before);
    assert_eq!(mtime(&a), mtime(&b), "resolved once for the whole job");
}

#[test]
fn before_1970_works() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let f = d.path().join("alt");
    fs::write(&f, "x").unwrap();
    let change = AttrChange {
        modified: Some(TimeValue::At { ms: -86_400_500 }),
        ..AttrChange::default()
    };
    let info = h.attrs(&[&f], change);
    assert_eq!(info.state, JobState::Done);
    assert_eq!(mtime(&f), UNIX_EPOCH - Duration::from_millis(86_400_500));
}

#[test]
fn missing_entry_fails_alone() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let gone = d.path().join("gone");
    let here = d.path().join("here");
    fs::write(&here, "x").unwrap();
    let t = UNIX_EPOCH + Duration::from_secs(2_000_000_000);
    let info = h.attrs(&[&gone, &here], modified(t));
    assert_eq!(info.state, JobState::DoneWithErrors);
    let summary = info.summary.unwrap();
    assert_eq!((summary.items_done, summary.items_failed), (1, 1));
    assert_eq!(summary.errors[0].error.code, FsErrorCode::NotFound);
    assert_eq!(summary.errors[0].path, s(&gone));
    assert_eq!(mtime(&here), t);
}

#[test]
fn cancelled_run_changes_nothing() {
    let d = tempdir().unwrap();
    let f = d.path().join("f");
    fs::write(&f, "x").unwrap();
    let before = mtime(&f);
    let control = Control::default();
    control.cancel();
    let (state, summary) = attributes::run(
        "j1",
        std::slice::from_ref(&f),
        &modified(UNIX_EPOCH),
        false,
        ApplyTo::All,
        &control,
        &|_| {},
    );
    assert_eq!(state, JobState::Cancelled);
    assert_eq!(summary.items_done, 0);
    assert_eq!(mtime(&f), before);
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};

    fn mode(p: &Path) -> u32 {
        fs::symlink_metadata(p).unwrap().permissions().mode() & 0o7777
    }

    fn chmod(p: &Path, m: u32) {
        fs::set_permissions(p, fs::Permissions::from_mode(m)).unwrap();
    }

    fn bits(set: u32, clear: u32) -> AttrChange {
        AttrChange {
            mode_set: set,
            mode_clear: clear,
            ..AttrChange::default()
        }
    }

    fn is_root() -> bool {
        // SAFETY: geteuid has no preconditions
        unsafe { libc::geteuid() == 0 }
    }

    #[test]
    fn sets_and_clears_only_the_named_bits_of_every_entry() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let a = d.path().join("ä mit Leerzeichen");
        let b = d.path().join("b 📁");
        fs::write(&a, "x").unwrap();
        fs::create_dir(&b).unwrap();
        chmod(&a, 0o644);
        chmod(&b, 0o751);
        let info = h.attrs(&[&a, &b], bits(0o020, 0o004));
        assert_eq!(info.state, JobState::Done);
        assert_eq!(mode(&a), 0o660);
        assert_eq!(mode(&b), 0o771, "others had no read bit – unchanged");
    }

    #[test]
    fn octal_as_full_mask_and_special_bits() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let f = d.path().join("f");
        fs::write(&f, "x").unwrap();
        chmod(&f, 0o777);
        h.attrs(&[&f], bits(0o4640, 0o3137));
        assert_eq!(mode(&f), 0o4640);
        h.attrs(&[&f], bits(0o1000, 0o4000));
        assert_eq!(mode(&f), 0o1640);
    }

    #[test]
    fn a_selected_link_is_reported_and_its_target_left_alone() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let target = d.path().join("ziel");
        fs::write(&target, "x").unwrap();
        chmod(&target, 0o600);
        let link = d.path().join("link");
        symlink(&target, &link).unwrap();
        let dangling = d.path().join("dangling");
        symlink("nowhere", &dangling).unwrap();
        let t_before = mtime(&target);
        let mut change = bits(0o044, 0);
        change.modified = Some(TimeValue::At { ms: 1000 });
        let info = h.attrs(&[&link, &dangling], change);
        assert_eq!(info.state, JobState::DoneWithErrors);
        let summary = info.summary.unwrap();
        assert_eq!(summary.items_failed, 2);
        assert!(
            summary
                .errors
                .iter()
                .all(|e| e.error.code == FsErrorCode::SymlinkSkipped)
        );
        assert_eq!(mode(&target), 0o600);
        assert_eq!(mtime(&target), t_before);
        assert!(
            fs::symlink_metadata(&dangling)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }

    /// `top/` with `f.txt`, `sub/g.txt`, `sub/deep/`, links to a folder and a file outside.
    fn tree() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let d = tempdir().unwrap();
        let top = d.path().join("top ä");
        let outside = d.path().join("outside");
        fs::create_dir_all(top.join("sub").join("deep")).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(top.join("f.txt"), "f").unwrap();
        fs::write(top.join("sub").join("g.txt"), "g").unwrap();
        fs::write(outside.join("o.txt"), "o").unwrap();
        symlink(&outside, top.join("sub").join("to-outside")).unwrap();
        symlink(outside.join("o.txt"), top.join("o-link")).unwrap();
        for p in [&top, &top.join("sub"), &top.join("sub/deep"), &outside] {
            chmod(p, 0o750);
        }
        for p in [
            &top.join("f.txt"),
            &top.join("sub/g.txt"),
            &outside.join("o.txt"),
        ] {
            chmod(p, 0o640);
        }
        (d, top, outside)
    }

    #[test]
    fn recursive_only_folders() {
        let h = Harness::new();
        let (_d, top, outside) = tree();
        let info = h.attrs_with(&[&top], bits(0o005, 0), true, ApplyTo::Dirs);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        for dir in [&top, &top.join("sub"), &top.join("sub/deep")] {
            assert_eq!(mode(dir), 0o755, "{dir:?}");
        }
        assert_eq!(mode(&top.join("f.txt")), 0o640);
        assert_eq!(mode(&top.join("sub/g.txt")), 0o640);
        assert_eq!(mode(&outside), 0o750, "links are not entered");
        assert_eq!(mode(&outside.join("o.txt")), 0o640);
        let summary = info.summary.unwrap();
        assert_eq!(summary.items_done, 3);
        assert_eq!(summary.items_skipped, 2, "two links inside");
    }

    #[test]
    fn recursive_only_files_leaves_the_selected_folder_alone() {
        let h = Harness::new();
        let (_d, top, outside) = tree();
        let info = h.attrs_with(&[&top], bits(0o004, 0o020), true, ApplyTo::Files);
        assert_eq!(info.state, JobState::Done);
        assert_eq!(mode(&top), 0o750);
        assert_eq!(mode(&top.join("f.txt")), 0o644);
        assert_eq!(mode(&top.join("sub/g.txt")), 0o644);
        assert_eq!(mode(&outside.join("o.txt")), 0o640);
        assert_eq!(info.summary.unwrap().items_done, 2);
    }

    #[test]
    fn recursive_everything_and_without_recursion_only_the_folder() {
        let h = Harness::new();
        let (_d, top, _outside) = tree();
        h.attrs_with(&[&top], bits(0o002, 0), false, ApplyTo::All);
        assert_eq!(mode(&top), 0o752);
        assert_eq!(mode(&top.join("f.txt")), 0o640, "no recursion");
        let info = h.attrs_with(&[&top], bits(0, 0o002), true, ApplyTo::All);
        assert_eq!(info.summary.unwrap().items_done, 5);
        assert_eq!(mode(&top), 0o750);
    }

    #[test]
    fn nested_selection_is_changed_once() {
        let h = Harness::new();
        let (_d, top, _outside) = tree();
        let sub = top.join("sub");
        let info = h.attrs_with(&[&top, &sub], bits(0o001, 0), true, ApplyTo::Dirs);
        assert_eq!(info.summary.unwrap().items_done, 3);
    }

    #[test]
    fn owner_can_open_a_locked_folder_again_and_lock_it_from_the_inside_out() {
        if is_root() {
            return; // root ignores permissions – the order would not matter
        }
        let h = Harness::new();
        let (_d, top, _outside) = tree();
        let sub = top.join("sub");
        chmod(&sub, 0o000);
        // u+rx: the folder first, then its contents
        let info = h.attrs_with(&[&top], bits(0o500, 0), true, ApplyTo::All);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        assert_eq!(mode(&sub), 0o500);
        assert_eq!(mode(&sub.join("g.txt")), 0o740);
        // u-x: contents first, the folder last
        chmod(&sub, 0o700);
        let info = h.attrs_with(&[&sub], bits(0, 0o100), true, ApplyTo::All);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        chmod(&sub, 0o700);
        assert_eq!(mode(&sub.join("deep")), 0o650);
    }

    #[test]
    fn unreadable_folder_is_reported_without_root() {
        if is_root() {
            return;
        }
        let h = Harness::new();
        let (_d, top, _outside) = tree();
        let sub = top.join("sub");
        chmod(&sub, 0o000);
        let info = h.attrs_with(&[&top], bits(0o004, 0), true, ApplyTo::Files);
        chmod(&sub, 0o750);
        assert_eq!(info.state, JobState::DoneWithErrors);
        let summary = info.summary.unwrap();
        assert_eq!(summary.errors[0].error.code, FsErrorCode::PermissionDenied);
        assert_eq!(mode(&top.join("f.txt")), 0o644);
    }

    #[test]
    fn a_file_without_read_permission_and_a_fifo() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let f = d.path().join("locked");
        fs::write(&f, "x").unwrap();
        chmod(&f, 0o000);
        let fifo = d.path().join("fifo");
        let c = std::ffi::CString::new(s(&fifo)).unwrap();
        // SAFETY: valid path
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        let mut change = bits(0o600, 0);
        change.modified = Some(TimeValue::At { ms: 5000 });
        let info = h.attrs(&[&f, &fifo], change);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        assert_eq!(mode(&f), 0o600);
        assert_eq!(mtime(&fifo), UNIX_EPOCH + Duration::from_secs(5));
    }

    #[test]
    fn cancel_during_a_large_tree() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let top = d.path().join("big");
        for i in 0..40 {
            let sub = top.join(format!("d{i}"));
            fs::create_dir_all(&sub).unwrap();
            for j in 0..50 {
                fs::write(sub.join(format!("f{j}")), "").unwrap();
            }
        }
        let id = h
            .mgr
            .start(spec(&[&top], bits(0o001, 0), true, ApplyTo::All))
            .unwrap();
        h.mgr.cancel(&id);
        let info = h.finish(&id);
        assert!(matches!(info.state, JobState::Cancelled | JobState::Done));
        if info.state == JobState::Cancelled {
            assert!(info.summary.unwrap().items_done < 2041);
        }
    }

    #[test]
    fn link_in_the_selection_and_its_folder_with_mode_and_times() {
        // the `apply` check right before the change also catches a link selected without recursion
        let h = Harness::new();
        let d = tempdir().unwrap();
        let dir = d.path().join("echt");
        fs::create_dir(&dir).unwrap();
        let link = d.path().join("zu-echt");
        symlink(&dir, &link).unwrap();
        chmod(&dir, 0o700);
        let info = h.attrs_with(&[&link], bits(0o070, 0), true, ApplyTo::All);
        assert_eq!(info.state, JobState::DoneWithErrors);
        assert_eq!(mode(&dir), 0o700);
    }

    // --- external review 20.10.2026 ---

    /// #1a: `link/` must not make the system follow the selected link.
    #[test]
    fn a_trailing_separator_still_names_the_link() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let target = d.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("f"), "x").unwrap();
        chmod(&target.join("f"), 0o644);
        symlink(&target, d.path().join("link")).unwrap();
        for raw in [
            format!("{}/link/", s(d.path())),
            format!("{}/link/.", s(d.path())),
        ] {
            let id = h
                .mgr
                .start(JobSpec::Attributes {
                    paths: vec![raw],
                    change: bits(0o002, 0),
                    recursive: true,
                    apply_to: ApplyTo::All,
                })
                .unwrap();
            let info = h.finish(&id);
            assert_eq!(info.state, JobState::DoneWithErrors, "{:?}", info.summary);
            assert_eq!(
                info.summary.unwrap().errors[0].error.code,
                FsErrorCode::SymlinkSkipped
            );
        }
        assert_eq!(mode(&target.join("f")), 0o644, "the link was followed");
    }

    /// #1b/#1c: `..` behind a link leads elsewhere than checked – refused, nothing changes.
    #[test]
    fn dotdot_behind_a_link_is_refused() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let other = d.path().join("other");
        fs::create_dir_all(other.join("deep")).unwrap();
        fs::write(other.join("f"), "x").unwrap();
        chmod(&other.join("f"), 0o644);
        let proj = d.path().join("proj");
        fs::create_dir(&proj).unwrap();
        symlink(other.join("deep"), proj.join("link")).unwrap();
        let home = d.path().join("home");
        fs::create_dir_all(home.join("sub")).unwrap();
        chmod(&home, 0o755);
        symlink(home.join("sub"), proj.join("to-home-sub")).unwrap();
        h.mgr.set_home(Some(home.clone()));
        for raw in [
            format!("{}/link/..", s(&proj)),
            format!("{}/to-home-sub/..", s(&proj)),
        ] {
            let err = h
                .mgr
                .start(JobSpec::Attributes {
                    paths: vec![raw],
                    change: bits(0o002, 0),
                    recursive: true,
                    apply_to: ApplyTo::All,
                })
                .unwrap_err();
            assert_eq!(err.code, FsErrorCode::InvalidPath);
        }
        assert_eq!(mode(&other.join("f")), 0o644);
        assert_eq!(mode(&home), 0o755, "home changed recursively despite E8");
    }

    /// #2: `x/rootlink/etc` is `/etc` – the danger check looks where the path leads.
    #[test]
    fn a_linked_folder_on_the_way_does_not_hide_a_dangerous_place() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        symlink("/", d.path().join("rootlink")).unwrap();
        let err = h
            .mgr
            .start(spec(
                &[&d.path().join("rootlink").join("etc")],
                bits(0o002, 0),
                true,
                ApplyTo::All,
            ))
            .unwrap_err();
        assert_eq!(err.code, FsErrorCode::DangerousPath);
    }

    /// #3: the walk stays on the file system of the selected folder. Needs a
    /// tmpfs mount (root, e.g. the container); skipped elsewhere. Linux only: `mount(2)` with a
    /// file system type and `umount` exist in this form only there.
    #[cfg(target_os = "linux")]
    #[test]
    fn recursion_stays_on_one_file_system() {
        if !is_root() {
            return;
        }
        let d = tempdir().unwrap();
        let sub = d.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let (c_src, c_dst, c_fs) = (
            std::ffi::CString::new("tmpfs").unwrap(),
            std::ffi::CString::new(s(&sub)).unwrap(),
            std::ffi::CString::new("tmpfs").unwrap(),
        );
        // SAFETY: valid NUL-terminated strings, no data
        let rc = unsafe {
            libc::mount(
                c_src.as_ptr(),
                c_dst.as_ptr(),
                c_fs.as_ptr(),
                0,
                std::ptr::null(),
            )
        };
        if rc != 0 {
            return; // no permission to mount (container without CAP_SYS_ADMIN)
        }
        struct Unmount(std::ffi::CString);
        impl Drop for Unmount {
            fn drop(&mut self) {
                // SAFETY: valid path
                unsafe { libc::umount(self.0.as_ptr()) };
            }
        }
        let _unmount = Unmount(c_dst.clone());
        fs::write(sub.join("inner"), "x").unwrap();
        chmod(&sub.join("inner"), 0o644);
        fs::write(d.path().join("outer"), "x").unwrap();
        chmod(&d.path().join("outer"), 0o644);
        let h = Harness::new();
        let info = h.attrs_with(&[d.path()], bits(0o002, 0), true, ApplyTo::Files);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        assert_eq!(mode(&d.path().join("outer")), 0o646);
        assert_eq!(
            mode(&sub.join("inner")),
            0o644,
            "crossed into another file system"
        );
        assert_eq!(info.summary.unwrap().items_skipped, 1, "the mount point");
    }

    /// #5: a folder whose contents cannot be read counts once and stays as it is.
    #[test]
    fn an_unreadable_folder_counts_once_and_stays_unchanged() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let top = d.path().join("top");
        let locked = top.join(crate::jobs::attributes::UNOPENABLE_FOR_TESTS);
        fs::create_dir_all(&locked).unwrap();
        fs::write(top.join("f"), "x").unwrap();
        chmod(&top, 0o750);
        chmod(&locked, 0o750);
        chmod(&top.join("f"), 0o640);
        let info = h.attrs_with(&[&top], bits(0o005, 0), true, ApplyTo::All);
        assert_eq!(info.state, JobState::DoneWithErrors);
        let summary = info.summary.unwrap();
        assert_eq!(summary.items_failed, 1, "{:?}", summary.errors);
        assert_eq!(summary.items_done, 2, "top and f – not the locked folder");
        assert_eq!(mode(&locked), 0o750, "left unchanged");
        assert_eq!(mode(&top), 0o755);
        assert_eq!(
            info.progress.items_done, 3,
            "every entry once in the progress"
        );
    }

    /// #8: u+x u-r – the folder gains x first, its contents follow, then it loses r.
    #[test]
    fn a_change_that_opens_and_closes_a_folder_reaches_its_contents() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let dir = d.path().join("dir");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("f"), "x").unwrap();
        chmod(&dir.join("f"), 0o600);
        chmod(&dir, 0o600);
        let info = h.attrs_with(&[&dir], bits(0o100, 0o400), true, ApplyTo::All);
        chmod(&dir, 0o700);
        assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
        assert_eq!(mode(&dir.join("f")), 0o300, "contents changed");
        assert_eq!(
            info.summary.unwrap().items_done,
            2,
            "the folder counts once"
        );
    }

    /// #8 without root: the final mode of the folder is the asked one.
    #[test]
    fn a_staged_folder_ends_with_the_asked_mode() {
        let h = Harness::new();
        let d = tempdir().unwrap();
        let dir = d.path().join("dir");
        fs::create_dir(&dir).unwrap();
        chmod(&dir, 0o600);
        h.attrs_with(&[&dir], bits(0o100, 0o400), true, ApplyTo::All);
        assert_eq!(mode(&dir), 0o300);
    }
}
