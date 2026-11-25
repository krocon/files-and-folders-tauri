//! Job `download` (design 078) with a fake yt-dlp: a shell script that logs its
//! arguments and working folder and prints protocol lines. No network, no real yt-dlp.

use super::download::{EnvProvider, check_target, inside_target};
use super::tests_engine::{Harness, WAIT};
use super::*;
use crate::error::FsErrorCode;
use crate::url_download::{Content, DownloadEnv, DownloadOptions};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tempfile::{TempDir, tempdir};

/// What the fake does depends on the URL (its last argument).
const FAKE: &str = r#"#!/bin/sh
url=""; marker=""
for a in "$@"; do
  url="$a"
  case "$a" in
    --print=before_dl:*) m="${a#--print=before_dl:}"; marker="${m%%|*}";;
  esac
done
{ printf '%s\n' "$@"; echo "==="; } >> "$FAKE_LOG/args"
pwd >> "$FAKE_LOG/cwd"
echo "$PYTHONUTF8/$PYTHONIOENCODING" >> "$FAKE_LOG/env"
name=$(printf '%s' "$url" | sed 's|.*/||')
case "$url" in
  *fail*)
    echo "WARNING: [generic] falling back" >&2
    printf 'ERROR: [generic] Unable to download webpage: \033[31mHTTP Error 404\033[0m: Not Found\n' >&2
    echo "WARNING: later" >&2
    exit 1;;
  *stubborn*)
    trap '' TERM
    sleep 300 &
    echo $! > "$FAKE_LOG/child"
    echo "$marker|item|\"Stubborn\""
    wait;;
  *slow*)
    sleep 300 &
    echo $! > "$FAKE_LOG/child"
    echo "$marker|item|\"Slow\""
    echo "$marker|dl|downloading|10|100|NA|5|9"
    : > "$name.mp4.part"
    wait;;
  *present*)
    echo "$marker|item|\"Schon da\""
    echo "$marker|file|False|\"$name.mp4\"";;
  *outside*)
    : > "$name.mp4"
    echo "$marker|file|True|\"/etc/passwd\""
    echo "$marker|file|True|\"../escape.mp4\""
    echo "$marker|file|True|\"$PWD/sub/../../x.mp4\""
    echo "$marker|file|True|\"$PWD\""
    echo "$marker|file|True|\"$name.mp4\"";;
  *flood*)
    head -c 300000 /dev/zero | tr '\0' 'x'
    printf '\377\376 no utf8\n'
    echo "WRONGMARKER|file|True|\"forged.mp4\""
    echo "$marker|item|\"a\nb\""
    printf 'data' > "$name.mp4"
    echo "$marker|file|True|\"$PWD/$name.mp4\"";;
  *)
    echo "noise that is not ours"
    echo "$marker|item|\"Titel\""
    sleep 0.2
    echo "$marker|dl|downloading|512|1024|NA|100.5|5"
    sleep 0.2
    echo "$marker|dl|finished|1024|1024|NA|100|NA"
    echo "$marker|pp|started|Merger"
    sleep 0.2
    printf 'data' > "$name.mp4"
    echo "$marker|pp|finished|Merger"
    echo "$marker|file|True|\"$name.mp4\"";;
esac
"#;

struct Fake {
    _dir: TempDir,
    log: PathBuf,
    target: PathBuf,
    env: DownloadEnv,
}

fn fake(h: &Harness) -> Fake {
    let dir = tempdir().unwrap();
    let program = dir.path().join("yt-dlp");
    fs::write(&program, FAKE).unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
    let log = dir.path().join("log");
    let target = dir.path().join("Ziel ä 🎬");
    fs::create_dir(&log).unwrap();
    fs::create_dir(&target).unwrap();
    let env = DownloadEnv {
        yt_dlp: Some(program),
        env: vec![("FAKE_LOG".into(), log.to_string_lossy().into_owned())],
        ..DownloadEnv::default()
    };
    set_env(h, env.clone());
    Fake {
        _dir: dir,
        log,
        target,
        env,
    }
}

fn set_env(h: &Harness, env: DownloadEnv) {
    let provider: EnvProvider = Arc::new(move || env.clone());
    h.mgr.set_download_env(provider);
}

fn spec(target: &Path, urls: &[&str]) -> JobSpec {
    JobSpec::Download {
        urls: urls.iter().map(|u| u.to_string()).collect(),
        target_dir: target.to_string_lossy().into_owned(),
        options: DownloadOptions::default(),
    }
}

/// The argument arrays the fake was started with.
fn runs(f: &Fake) -> Vec<Vec<String>> {
    let text = fs::read_to_string(f.log.join("args")).unwrap_or_default();
    text.split("===\n")
        .filter(|r| !r.is_empty())
        .map(|r| r.lines().map(String::from).collect())
        .collect()
}

fn alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks for existence.
    unsafe { libc::kill(pid, 0) == 0 }
}

fn wait_for(what: &str, cond: impl Fn() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !cond() {
        assert!(Instant::now() < deadline, "{what}");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn every_url_runs_alone_in_the_target_folder() {
    let h = Harness::new();
    let f = fake(&h);
    let id = h
        .mgr
        .start(spec(
            &f.target,
            &["https://example.org/a", "https://example.org/v/b"],
        ))
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let s = info.summary.unwrap();
    assert_eq!((s.items_done, s.items_skipped, s.items_failed), (2, 0, 0));
    assert_eq!(s.bytes_done, 2048);
    let d = s.download.unwrap();
    assert_eq!(
        d.files,
        [
            f.target.join("a.mp4").to_string_lossy().into_owned(),
            f.target.join("b.mp4").to_string_lossy().into_owned()
        ]
    );
    assert_eq!((d.file_count, d.present), (2, 0));
    assert_eq!(fs::read_to_string(f.target.join("a.mp4")).unwrap(), "data");

    // one process per URL: `--` and then exactly that URL; never a path option
    let runs = runs(&f);
    assert_eq!(runs.len(), 2);
    for (run, url) in runs
        .iter()
        .zip(["https://example.org/a", "https://example.org/v/b"])
    {
        let n = run.len();
        assert_eq!(&run[n - 2..], ["--", url]);
        assert_eq!(run.iter().filter(|a| a.starts_with("http")).count(), 1);
        assert!(run.contains(&"--ignore-config".to_string()));
        assert!(run.contains(&"--no-exec".to_string()));
        assert!(!run.iter().any(|a| a == "-P" || a.starts_with("--paths")));
        assert!(run[..n - 2].iter().all(|a| a.starts_with("--")));
    }
    // the working folder is the target (the physical path of it)
    let cwd = fs::read_to_string(f.log.join("cwd")).unwrap();
    let canon = fs::canonicalize(&f.target).unwrap();
    assert!(cwd.lines().all(|l| Path::new(l) == canon), "{cwd}");
    assert_eq!(
        fs::read_to_string(f.log.join("env"))
            .unwrap()
            .lines()
            .next(),
        Some("1/utf-8")
    );

    // progress: items, bytes of the current file, the phases, a shortened URL
    let events = h.events.lock().unwrap();
    let progress: Vec<&Progress> = events
        .iter()
        .filter_map(|e| match e {
            JobEvent::Progress { id: i, progress } if *i == id => Some(progress),
            _ => None,
        })
        .collect();
    assert!(progress.iter().any(|p| p.bytes_done == 512
        && p.bytes_total == 1024
        && p.rate_bps == 100
        && p.phase == Some(Phase::Downloading)));
    assert!(progress.iter().any(|p| p.phase == Some(Phase::Processing)));
    assert!(
        progress
            .iter()
            .any(|p| p.current.as_deref() == Some("example.org/…/b"))
    );
    assert!(progress.iter().all(|p| p.items_total == 2));
    let last = progress.last().unwrap();
    assert_eq!(
        (last.items_done, last.phase, &last.current),
        (2, None, &None)
    );
    // the panel hears about the folder after every URL
    let target = f.target.to_string_lossy().into_owned();
    assert!(
        events
            .iter()
            .filter(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.as_slice() == std::slice::from_ref(&target)))
            .count()
            >= 2
    );
    // nothing of the output is passed on as text
    let all = format!("{events:?}");
    assert!(!all.contains("noise that is not ours") && !all.contains("Titel"));
}

#[test]
fn a_failed_url_is_reported_and_only_it_is_retried() {
    let h = Harness::new();
    let f = fake(&h);
    let urls = [
        "https://example.org/a",
        "https://example.org/fail?token=1",
        "https://example.org/c",
    ];
    let id = h.mgr.start(spec(&f.target, &urls)).unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let s = info.summary.unwrap();
    assert_eq!((s.items_done, s.items_failed), (2, 1));
    assert_eq!(s.errors.len(), 1);
    assert_eq!(s.errors[0].path, urls[1]);
    assert_eq!(s.errors[0].error.code, FsErrorCode::DownloadFailed);
    // the last error line, without the escape sequences' control characters
    assert_eq!(
        s.errors[0].error.message,
        "[generic] Unable to download webpage: [31mHTTP Error 404[0m: Not Found"
    );
    assert!(f.target.join("a.mp4").exists() && f.target.join("c.mp4").exists());
    assert!(h.count(|e| matches!(e, JobEvent::ItemFailed { id: i, .. } if *i == id)) == 1);

    // retry: a new job with exactly the failed URL
    wait_for("retry offered", || {
        h.mgr.list().iter().any(|j| j.id == id && j.retry_available)
    });
    let retry = h.mgr.retry_job(&id).unwrap();
    let info = h.finish(&retry);
    let JobSpec::Download { urls: again, .. } = &info.spec else {
        panic!()
    };
    assert_eq!(again, &[urls[1].to_string()]);
    assert_eq!(info.state, JobState::DoneWithErrors);
    assert_eq!(runs(&f).len(), 4);
    assert_eq!(runs(&f)[3].last().map(String::as_str), Some(urls[1]));
}

fn cancel_kills(url: &str) {
    let h = Harness::new();
    let f = fake(&h);
    let id = h
        .mgr
        .start(spec(&f.target, &[url, "https://example.org/never"]))
        .unwrap();
    let child_file = f.log.join("child");
    wait_for("the fake started its child", || {
        fs::read_to_string(&child_file).is_ok_and(|s| s.trim().parse::<i32>().is_ok())
    });
    let child: i32 = fs::read_to_string(&child_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(alive(child));
    // the job is running (not paused: pause is not offered for downloads)
    h.mgr.pause(&id);
    assert!(
        h.mgr
            .list()
            .iter()
            .any(|j| j.id == id && j.state != JobState::Paused)
    );
    let start = Instant::now();
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Cancelled);
    assert!(start.elapsed() < Duration::from_secs(8));
    // the child of the fake (yt-dlp's ffmpeg) is gone too
    wait_for("the child ended", || !alive(child));
    // the second URL never started
    assert_eq!(runs(&f).len(), 1);
    // nothing is offered for retry after a cancel
    assert!(!h.mgr.list().iter().any(|j| j.id == id && j.retry_available));
}

#[test]
fn cancel_ends_the_whole_process_group() {
    cancel_kills("https://example.org/slow");
}

#[test]
fn cancel_kills_a_child_that_ignores_sigterm() {
    cancel_kills("https://example.org/stubborn");
}

#[test]
fn part_files_stay_after_a_cancel() {
    let h = Harness::new();
    let f = fake(&h);
    let id = h
        .mgr
        .start(spec(&f.target, &["https://example.org/slow"]))
        .unwrap();
    wait_for("part file", || f.target.join("slow.mp4.part").exists());
    h.mgr.cancel(&id);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    assert!(f.target.join("slow.mp4.part").exists());
}

#[test]
fn a_file_that_was_there_counts_as_skipped() {
    let h = Harness::new();
    let f = fake(&h);
    fs::write(f.target.join("present.mp4"), "old").unwrap();
    let id = h
        .mgr
        .start(spec(
            &f.target,
            &["https://example.org/present", "https://example.org/a"],
        ))
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let s = info.summary.unwrap();
    assert_eq!((s.items_done, s.items_skipped), (1, 1));
    let d = s.download.unwrap();
    assert_eq!((d.file_count, d.present), (2, 1));
    assert_eq!(
        fs::read_to_string(f.target.join("present.mp4")).unwrap(),
        "old"
    );
}

#[test]
fn reported_paths_outside_the_target_are_dropped() {
    let h = Harness::new();
    let f = fake(&h);
    let id = h
        .mgr
        .start(spec(&f.target, &["https://example.org/outside"]))
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let d = info.summary.unwrap().download.unwrap();
    assert_eq!(
        d.files,
        [f.target.join("outside.mp4").to_string_lossy().into_owned()]
    );
    assert_eq!(d.file_count, 1);

    let t = Path::new("/ziel/ordner");
    let canon = Path::new("/private/ziel/ordner");
    for (reported, want) in [
        ("a.mp4", Some("/ziel/ordner/a.mp4")),
        (
            "Liste [PL1]/01 - a.mp4",
            Some("/ziel/ordner/Liste [PL1]/01 - a.mp4"),
        ),
        ("./a.mp4", Some("/ziel/ordner/a.mp4")),
        ("/ziel/ordner/a.mp4", Some("/ziel/ordner/a.mp4")),
        ("/private/ziel/ordner/a.mp4", Some("/ziel/ordner/a.mp4")),
        ("/ziel/ordner", None),
        ("/private/ziel/ordner", None),
        (".", None),
        ("", None),
        ("../a.mp4", None),
        ("x/../../a.mp4", None),
        ("/ziel/ordner/../a.mp4", None),
        ("/ziel/ordner2/a.mp4", None),
        ("/ziel/a.mp4", None),
        ("/etc/passwd", None),
    ] {
        assert_eq!(
            inside_target(t, Some(canon), reported),
            want.map(PathBuf::from),
            "{reported:?}"
        );
    }
}

#[test]
fn garbage_output_does_not_break_the_job() {
    let h = Harness::new();
    let f = fake(&h);
    let id = h
        .mgr
        .start(spec(&f.target, &["https://example.org/flood"]))
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    let d = info.summary.unwrap().download.unwrap();
    // the forged line with another marker did not count
    assert_eq!(
        d.files,
        [f.target.join("flood.mp4").to_string_lossy().into_owned()]
    );
}

#[test]
fn without_yt_dlp_the_job_fails_as_a_whole() {
    let h = Harness::new();
    let f = fake(&h);
    // no provider result: yt-dlp unknown
    set_env(&h, DownloadEnv::default());
    let info = h.finish(
        &h.mgr
            .start(spec(&f.target, &["https://example.org/a"]))
            .unwrap(),
    );
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::DownloadToolMissing
    );
    // a path that is not there (removed after it was found)
    set_env(
        &h,
        DownloadEnv {
            yt_dlp: Some(PathBuf::from("/nowhere/yt-dlp")),
            ..DownloadEnv::default()
        },
    );
    let id = h
        .mgr
        .start(spec(&f.target, &["https://example.org/a"]))
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::DownloadToolMissing
    );
    // options that need ffmpeg while there is none
    set_env(&h, f.env.clone());
    let id = h
        .mgr
        .start(JobSpec::Download {
            urls: vec!["https://example.org/a".into()],
            target_dir: f.target.to_string_lossy().into_owned(),
            options: DownloadOptions {
                content: Content::Audio,
                ..DownloadOptions::default()
            },
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::DownloadToolMissing
    );
    assert!(runs(&f).is_empty(), "nothing was started");
    // a job that failed as a whole can be retried as it was
    wait_for("retry offered", || {
        h.mgr.list().iter().any(|j| j.id == id && j.retry_available)
    });
}

#[test]
fn what_is_no_plain_url_or_no_local_folder_never_starts() {
    let h = Harness::new();
    let f = fake(&h);
    let start = |urls: &[&str], target: &str, options: DownloadOptions| {
        h.mgr
            .start(JobSpec::Download {
                urls: urls.iter().map(|u| u.to_string()).collect(),
                target_dir: target.into(),
                options,
            })
            .map_err(|e| e.code)
    };
    let t = f.target.to_string_lossy().into_owned();
    let d = DownloadOptions::default;
    let ok = "https://example.org/a";
    for urls in [
        vec![],
        vec!["--exec=touch /tmp/pwned"],
        vec![ok, "--exec=x"],
        vec![ok, "-o"],
        vec!["-o /tmp/x"],
        vec!["ftp://example.org/x"],
        vec!["file:///etc/passwd"],
        vec!["https://user:pw@example.org/"],
        // not in the form the check hands out
        vec!["https://example.org"],
        vec![" https://example.org/a"],
    ] {
        assert_eq!(
            start(&urls, &t, d()),
            Err(FsErrorCode::DownloadInvalidUrl),
            "{urls:?}"
        );
    }
    let many: Vec<String> = (0..=crate::url_download::MAX_URLS)
        .map(|i| format!("https://example.org/{i}"))
        .collect();
    let many: Vec<&str> = many.iter().map(String::as_str).collect();
    assert_eq!(start(&many, &t, d()), Err(FsErrorCode::DownloadInvalidUrl));

    // the target
    let file = f.target.join("datei.zip");
    fs::write(&file, "x").unwrap();
    for (target, want) in [
        (
            file.to_string_lossy().into_owned(),
            FsErrorCode::NotADirectory,
        ),
        // a folder "in" an archive
        (
            file.join("ordner").to_string_lossy().into_owned(),
            FsErrorCode::NotADirectory,
        ),
        (
            f.target.join("fehlt").to_string_lossy().into_owned(),
            FsErrorCode::NotFound,
        ),
        (
            "remote://profil/pfad".to_string(),
            FsErrorCode::RemoteUnsupported,
        ),
        (format!("{t}/../x"), FsErrorCode::InvalidPath),
        ("relativ".to_string(), FsErrorCode::InvalidPath),
        (String::new(), FsErrorCode::InvalidPath),
    ] {
        assert_eq!(start(&[ok], &target, d()), Err(want), "{target:?}");
    }
    // the template and the options
    for template in ["../x", "/etc/x", "C:\\x", "../x.%(ext)s", "$HOME.%(ext)s"] {
        assert_eq!(
            start(
                &[ok],
                &t,
                DownloadOptions {
                    template: template.into(),
                    ..d()
                }
            ),
            Err(FsErrorCode::DownloadInvalidTemplate),
            "{template:?}"
        );
    }
    assert_eq!(
        start(
            &[ok],
            &t,
            DownloadOptions {
                max_height: Some(1),
                ..d()
            }
        ),
        Err(FsErrorCode::DownloadInvalidOptions)
    );
    assert!(runs(&f).is_empty(), "the program never ran");
    assert!(h.mgr.list().is_empty(), "no job was created");
}

#[cfg(unix)]
#[test]
fn a_folder_without_write_permission_is_refused() {
    // as root every folder is writable
    // SAFETY: plain syscall.
    if unsafe { libc::geteuid() } == 0 {
        return;
    }
    let d = tempdir().unwrap();
    let dir = d.path().join("zu");
    fs::create_dir(&dir).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
    let e = check_target(&dir.to_string_lossy()).unwrap_err();
    assert_eq!(e.code, FsErrorCode::PermissionDenied);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(check_target(&dir.to_string_lossy()).is_ok());
    // a link to a folder is a folder to download into
    let link = d.path().join("link");
    std::os::unix::fs::symlink(&dir, &link).unwrap();
    assert_eq!(check_target(&link.to_string_lossy()).unwrap(), link);
}

#[test]
fn an_own_preset_comes_from_the_environment_never_from_the_spec() {
    let h = Harness::new();
    let f = fake(&h);
    let mut env = f.env.clone();
    env.presets = vec![crate::url_download::presets::Preset {
        id: "p720".into(),
        label: "720p".into(),
        args: vec!["--format-sort=res:720".into()],
    }];
    set_env(&h, env);
    let with = |preset: &str| JobSpec::Download {
        urls: vec!["https://example.org/a".into()],
        target_dir: f.target.to_string_lossy().into_owned(),
        options: DownloadOptions {
            preset: Some(preset.into()),
            ..DownloadOptions::default()
        },
    };
    let info = h.finish(&h.mgr.start(with("p720")).unwrap());
    assert_eq!(info.state, JobState::Done);
    assert!(runs(&f)[0].contains(&"--format-sort=res:720".to_string()));
    // an id that is not in the file: the job fails, nothing runs
    let info = h.finish(&h.mgr.start(with("gone")).unwrap());
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        FsErrorCode::DownloadInvalidOptions
    );
    assert_eq!(runs(&f).len(), 1);
}

/// Design 078 E-l: no MCP tool can start a download – the tap takes reading kinds only.
#[test]
fn mcp_cannot_start_a_download() {
    use crate::mcp::jobs::{Collector, JobTap, READ_KINDS};
    assert!(!READ_KINDS.contains(&"download"));
    let h = Harness::new();
    let f = fake(&h);
    let tap = JobTap::default();
    let collector = Collector::new("download", "client", 1, 10, serde_json::Value::Null);
    let e = tap
        .start(
            &h.mgr,
            spec(&f.target, &["https://example.org/a"]),
            collector,
            4,
        )
        .unwrap_err();
    assert_eq!(e.code, "not_available");
    assert!(h.mgr.list().is_empty());
    assert!(runs(&f).is_empty());
}

/// The installed yt-dlp knows every option we pass (its `--help`) and takes their values
/// (`--version` in place of `-- <url>`: the options are parsed, nothing is contacted or
/// downloaded). What a value means to yt-dlp is not checked here – that is the run with
/// a real URL.
/// `cargo test real_yt_dlp_accepts_the_arguments -- --ignored --nocapture`
#[test]
#[ignore = "needs yt-dlp in the PATH"]
fn real_yt_dlp_accepts_the_arguments() {
    use crate::url_download::args::{Mode, build};
    use crate::url_download::presets::{Preset, check_args};
    use crate::url_download::{AudioFormat, Browser, Container};
    let dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .chain([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ])
        .collect();
    let Some(program) = crate::url_download::tools::find_in(&dirs, "yt-dlp") else {
        panic!("yt-dlp not found");
    };
    let env = DownloadEnv {
        yt_dlp: Some(program.clone()),
        ffmpeg: crate::url_download::tools::find_in(&dirs, "ffmpeg"),
        js_runtime: crate::url_download::tools::find_in(&dirs, "deno").map(|p| ("deno".into(), p)),
        env: Vec::new(),
        // every option of the allow list once, with a value its check accepts
        presets: [
            (
                "all1",
                vec![
                    "-f",
                    "bv*[height<=720]+ba/b",
                    "-S",
                    "res:720,ext:mp4:m4a",
                    "-x",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                    "0",
                    "--merge-output-format",
                    "mp4/mkv",
                    "--remux-video",
                    "mkv",
                    "--recode-video",
                    "mp4",
                    "--embed-thumbnail",
                    "--embed-metadata",
                    "--embed-chapters",
                    "--embed-subs",
                    "--write-subs",
                    "--write-auto-subs",
                    "--sub-langs",
                    "en.*,-live_chat",
                    "--sub-format",
                    "srt/best",
                    "--convert-subs",
                    "srt",
                ],
            ),
            (
                "all2",
                vec![
                    "--convert-thumbnails",
                    "jpg",
                    "-r",
                    "2.5M",
                    "-N",
                    "4",
                    "-R",
                    "infinite",
                    "--fragment-retries",
                    "10",
                    "-I",
                    "1:3,7,-5::2",
                    "--max-filesize",
                    "2G",
                    "--min-filesize",
                    "10k",
                    "--sponsorblock-remove",
                    "sponsor,selfpromo",
                    "--sponsorblock-mark",
                    "all",
                    "--mtime",
                    "--no-mtime",
                ],
            ),
        ]
        .into_iter()
        .map(|(id, args)| Preset {
            id: id.into(),
            label: id.into(),
            args: check_args(&args.into_iter().map(String::from).collect::<Vec<_>>()).unwrap(),
        })
        .collect(),
    };
    let d = DownloadOptions::default();
    let cases = [
        d.clone(),
        DownloadOptions {
            max_height: Some(1080),
            container: Container::Mp4,
            playlist: true,
            playlist_subfolder: true,
            subtitles: true,
            sub_langs: "de,en".into(),
            embed_thumbnail: true,
            embed_metadata: true,
            overwrite: true,
            cookies_browser: Some(Browser::Firefox),
            template: "%(upload_date>%Y-%m-%d)s %(title).100B.%(ext)s".into(),
            ..d.clone()
        },
        DownloadOptions {
            content: Content::Audio,
            audio_format: AudioFormat::Mp3,
            ..d.clone()
        },
        DownloadOptions {
            content: Content::Audio,
            audio_format: AudioFormat::Opus,
            ..d.clone()
        },
        DownloadOptions {
            container: Container::Mkv,
            max_height: Some(360),
            ..d.clone()
        },
        DownloadOptions {
            preset: Some("all1".into()),
            ..d.clone()
        },
        DownloadOptions {
            preset: Some("all2".into()),
            ..d.clone()
        },
    ];
    // `--version` checks the values of known options but lets unknown names pass: every
    // option name must also stand in the program's own `--help`
    let help = std::process::Command::new(&program)
        .arg("--help")
        .output()
        .unwrap();
    let help = String::from_utf8_lossy(&help.stdout).into_owned();
    let known: std::collections::HashSet<&str> = help
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|w| w.starts_with("--"))
        .collect();
    assert!(known.len() > 100, "the help lists the options");
    for o in cases {
        let mut args = build(
            &o,
            &env,
            Mode::Job { marker: "MARK" },
            "https://example.org/a",
        )
        .unwrap();
        let n = args.len();
        args.truncate(n - 2); // no `--`, no URL
        for a in &args {
            let name = a.split('=').next().unwrap();
            assert!(
                known.contains(name),
                "{name} is not an option of this yt-dlp"
            );
        }
        args.push("--version".into());
        let out = std::process::Command::new(&program)
            .args(&args)
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        println!(
            "{} → {} {}",
            args.len(),
            String::from_utf8_lossy(&out.stdout).trim(),
            stderr.trim()
        );
        assert!(out.status.success(), "{args:?}\n{stderr}");
        assert!(stderr.trim().is_empty(), "{stderr}");
    }
}

/// Records the protocol lines of a **real** run for the parser fixtures (design 078 §5) –
/// Marc's acceptance, never part of the normal tests: it uses the network.
///
/// ```text
/// FNF_RECORD_URL='https://…' [FNF_RECORD_AUDIO=1] [FNF_RECORD_NAME=video] \
///   cargo test record_protocol_lines -- --ignored --nocapture
/// ```
/// Downloads into a temp folder (removed afterwards) with exactly the arguments of a job
/// and writes `src/url_download/testdata/recorded-<name>.txt`: stdout lines as they are,
/// stderr lines prefixed `E `, the marker replaced by `M`, the temp folder by `/ziel`.
#[test]
#[ignore = "uses the network: set FNF_RECORD_URL"]
fn record_protocol_lines() {
    use crate::url_download::args::{Mode, build};
    use crate::url_download::{AudioFormat, urls};
    let Ok(raw) = std::env::var("FNF_RECORD_URL") else {
        panic!("set FNF_RECORD_URL");
    };
    let url = urls::check_one(raw.trim()).expect("a plain http(s) URL");
    let audio = std::env::var_os("FNF_RECORD_AUDIO").is_some();
    let name = std::env::var("FNF_RECORD_NAME").unwrap_or_else(|_| {
        if audio {
            "audio".into()
        } else {
            "video".into()
        }
    });
    assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    let dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .chain([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ])
        .collect();
    let find = |n: &str| crate::url_download::tools::find_in(&dirs, n);
    let program = find("yt-dlp").expect("yt-dlp in the PATH");
    let env = DownloadEnv {
        yt_dlp: Some(program.clone()),
        ffmpeg: find("ffmpeg"),
        js_runtime: find("deno").map(|p| ("deno".into(), p)),
        ..DownloadEnv::default()
    };
    let options = DownloadOptions {
        content: if audio {
            Content::Audio
        } else {
            Content::Video
        },
        audio_format: if audio {
            AudioFormat::Mp3
        } else {
            AudioFormat::Best
        },
        ..DownloadOptions::default()
    };
    let marker = "FNFRECORDMARKER";
    let args = build(&options, &env, Mode::Job { marker }, &url).unwrap();
    let target = tempdir().unwrap();
    let out = super::download::build_command(&program, &args, target.path(), &env)
        .output()
        .unwrap();
    let place = fs::canonicalize(target.path()).unwrap();
    let clean = |text: &[u8], prefix: &str| -> String {
        String::from_utf8_lossy(text)
            .lines()
            .map(|l| {
                format!(
                    "{prefix}{}\n",
                    l.replace(marker, "M")
                        .replace(&*place.to_string_lossy(), "/ziel")
                        .replace(&*target.path().to_string_lossy(), "/ziel")
                )
            })
            .collect()
    };
    let text = clean(&out.stdout, "") + &clean(&out.stderr, "E ");
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/url_download/testdata")
        .join(format!("recorded-{name}.txt"));
    fs::write(&file, &text).unwrap();
    println!(
        "exit {:?}, {} lines → {}",
        out.status.code(),
        text.lines().count(),
        file.display()
    );
}
