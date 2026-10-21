//! Tests for the checksum jobs (design 039): list file, one file per file, show,
//! verify with mismatches, missing files and hostile names; validation.

use super::checksum::{ChecksumOutput, ProblemKind};
use super::tests_engine::Harness;
use super::*;
use crate::checksum::Algo;
use crate::error::FsErrorCode;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

impl Harness {
    fn checksum(&self, paths: &[&Path], base: &Path, algo: Algo, output: ChecksumOutput) -> String {
        self.mgr
            .start(JobSpec::Checksum {
                paths: paths.iter().map(|p| s(p)).collect(),
                base_dir: s(base),
                algo,
                output,
            })
            .unwrap()
    }

    fn verify(&self, file: &Path) -> JobInfo {
        let id = self
            .mgr
            .start(JobSpec::VerifyChecksums { file: s(file) })
            .unwrap();
        self.finish(&id)
    }
}

/// `Daten ä/` with `abc.txt`, `Grüße 🎉.txt` and `sub dir/tief.bin`.
fn setup() -> (tempfile::TempDir, PathBuf) {
    let d = tempdir().unwrap();
    let base = d.path().join("Daten ä");
    fs::create_dir_all(base.join("sub dir")).unwrap();
    fs::write(base.join("abc.txt"), "abc").unwrap();
    fs::write(base.join("Grüße 🎉.txt"), "hallo").unwrap();
    fs::write(base.join("sub dir/tief.bin"), [0u8, 1, 2, 255]).unwrap();
    (d, base)
}

fn list(name: &str) -> ChecksumOutput {
    ChecksumOutput::List {
        name: name.into(),
        overwrite: false,
    }
}

#[test]
fn a_list_file_with_relative_names_that_verifies() {
    let h = Harness::new();
    let (_d, base) = setup();
    let id = h.checksum(
        &[
            &base.join("abc.txt"),
            &base.join("Grüße 🎉.txt"),
            &base.join("sub dir"),
        ],
        &base,
        Algo::Sha256,
        list("CHECKSUMS.sha256"),
    );
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    let text = fs::read_to_string(base.join("CHECKSUMS.sha256")).unwrap();
    let names: Vec<&str> = text.lines().map(|l| &l[66..]).collect();
    assert_eq!(names, vec!["Grüße 🎉.txt", "abc.txt", "sub dir/tief.bin"]);
    assert!(text.contains(&format!("{ABC_SHA256}  abc.txt\n")));
    assert_eq!(
        info.summary.unwrap().checksums.unwrap().file.as_deref(),
        Some(s(&base.join("CHECKSUMS.sha256")).as_str())
    );

    let v = h.verify(&base.join("CHECKSUMS.sha256"));
    assert_eq!(v.state, JobState::Done, "{:?}", v.summary);
    let cs = v.summary.unwrap().checksums.unwrap();
    assert_eq!((cs.ok, cs.problems.len()), (3, 0));

    // a second list over the same folder never hashes itself, and never overwrites unasked
    let again = h.checksum(&[&base], &base, Algo::Sha256, list("CHECKSUMS.sha256"));
    let info = h.finish(&again);
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::AlreadyExists
    );
    let id = h.checksum(
        &[&base],
        &base,
        Algo::Sha256,
        ChecksumOutput::List {
            name: "CHECKSUMS.sha256".into(),
            overwrite: true,
        },
    );
    assert_eq!(h.finish(&id).state, JobState::Done);
    let text = fs::read_to_string(base.join("CHECKSUMS.sha256")).unwrap();
    assert_eq!(text.lines().count(), 3, "{text}");
}

#[test]
fn verify_reports_changed_missing_broken_and_hostile_lines() {
    let h = Harness::new();
    let (d, base) = setup();
    fs::write(d.path().join("secret"), "s").unwrap();
    let md5 = "900150983cd24fb0d6963f7d28e17f72";
    let lines = [
        format!("{md5}  abc.txt"),      // ok
        format!("{md5} *Grüße 🎉.txt"), // other content: mismatch
        format!("{md5}  gone.txt"),     // missing
        "kaputt".to_string(),           // invalid
        format!("{md5}  ../secret"),    // refused
        format!("{md5}  /etc/passwd"),  // refused
        String::new(),
        "# comment".into(),
    ];
    let file = base.join("liste.md5");
    fs::write(&file, lines.join("\n")).unwrap();
    let v = h.verify(&file);
    assert_eq!(v.state, JobState::DoneWithErrors, "{:?}", v.summary);
    let summary = v.summary.unwrap();
    let cs = summary.checksums.unwrap();
    assert_eq!(cs.algo, Some(Algo::Md5));
    assert_eq!(
        (cs.ok, cs.mismatched, cs.missing, cs.invalid, cs.refused),
        (1, 1, 1, 1, 2)
    );
    assert_eq!(summary.items_failed, 5);
    let kinds: Vec<ProblemKind> = cs.problems.iter().map(|p| p.kind).collect();
    assert_eq!(
        kinds,
        vec![
            ProblemKind::Mismatch,
            ProblemKind::Missing,
            ProblemKind::Invalid,
            ProblemKind::Refused,
            ProblemKind::Refused
        ]
    );
    assert_eq!(
        cs.problems[0].path.as_deref(),
        Some(s(&base.join("Grüße 🎉.txt")).as_str())
    );
}

#[test]
fn one_file_per_file_skips_existing_ones_and_show_reports_digests() {
    let h = Harness::new();
    let (_d, base) = setup();
    let abc = base.join("abc.txt");
    fs::write(base.join("Grüße 🎉.txt.sha256"), "old").unwrap();
    let id = h.checksum(
        &[&abc, &base.join("Grüße 🎉.txt")],
        &base,
        Algo::Sha256,
        ChecksumOutput::PerFile { overwrite: false },
    );
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done, "{:?}", info.summary);
    let summary = info.summary.unwrap();
    assert_eq!((summary.items_done, summary.items_skipped), (1, 1));
    assert_eq!(
        fs::read_to_string(base.join("abc.txt.sha256")).unwrap(),
        format!("{ABC_SHA256}  abc.txt\n")
    );
    assert_eq!(
        fs::read_to_string(base.join("Grüße 🎉.txt.sha256")).unwrap(),
        "old"
    );
    // the new file checks out
    let v = h.verify(&base.join("abc.txt.sha256"));
    assert_eq!(v.summary.unwrap().checksums.unwrap().ok, 1);

    let id = h.checksum(&[&abc], &base, Algo::Md5, ChecksumOutput::Show);
    let info = h.finish(&id);
    let cs = info.summary.unwrap().checksums.unwrap();
    assert_eq!(cs.digests.len(), 1);
    assert_eq!(cs.digests[0].hex, "900150983cd24fb0d6963f7d28e17f72");
    assert!(!base.join("abc.txt.md5").exists());
}

#[cfg(unix)]
#[test]
fn links_are_never_followed() {
    let h = Harness::new();
    let (d, base) = setup();
    fs::write(d.path().join("outside.txt"), "x").unwrap();
    std::os::unix::fs::symlink(d.path().join("outside.txt"), base.join("link.txt")).unwrap();
    std::os::unix::fs::symlink(d.path(), base.join("loop")).unwrap();
    let id = h.checksum(&[&base], &base, Algo::Sha1, list("SHA1SUMS"));
    let info = h.finish(&id);
    let summary = info.summary.unwrap();
    assert_eq!((summary.items_done, summary.items_skipped), (3, 2));
    let text = fs::read_to_string(base.join("SHA1SUMS")).unwrap();
    assert!(
        !text.contains("link.txt") && !text.contains("loop"),
        "{text}"
    );
}

#[test]
fn validation_refuses_lists_outside_their_folder_and_bad_names() {
    let h = Harness::new();
    let (d, base) = setup();
    let start = |paths: Vec<String>, name: &str| {
        h.mgr.start(JobSpec::Checksum {
            paths,
            base_dir: s(&base),
            algo: Algo::Sha256,
            output: list(name),
        })
    };
    let outside = s(&d.path().join("x"));
    assert_eq!(
        start(vec![outside], "a.sha256").unwrap_err().code,
        FsErrorCode::InvalidPath
    );
    assert_eq!(
        start(vec![s(&base.join("abc.txt"))], "../a.sha256")
            .unwrap_err()
            .code,
        FsErrorCode::InvalidName
    );
    assert_eq!(
        start(vec![], "a.sha256").unwrap_err().code,
        FsErrorCode::InvalidPath
    );
    assert!(
        h.mgr
            .start(JobSpec::VerifyChecksums {
                file: "relative.sha256".into()
            })
            .is_err()
    );
}

#[test]
fn cancel_stops_a_long_hash() {
    let h = Harness::new();
    let d = tempdir().unwrap();
    let big = d.path().join("big.bin");
    let f = fs::File::create(&big).unwrap();
    f.set_len(512 * 1024 * 1024).unwrap(); // sparse: cheap on disk, slow to hash
    let id = h.checksum(&[&big], d.path(), Algo::Sha512, ChecksumOutput::Show);
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Cancelled);
}
