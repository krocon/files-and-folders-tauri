//! Finding yt-dlp, ffmpeg and a JavaScript runtime (design 078 E-a): the setting (an
//! absolute path) → the folders of the start `PATH` (login `PATH` + the usual places,
//! design 061). Nothing is downloaded, installed or updated. The status for the dialog
//! runs `--version` with a time limit; what the program prints is cut to a version.

use serde::Serialize;
use serde_json::{Map, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// A PyInstaller binary unpacks itself on its first start.
pub const YT_DLP_TIMEOUT: Duration = Duration::from_secs(20);
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
/// A yt-dlp older than this gets a hint (sites change, old versions break).
pub const OUTDATED_DAYS: i64 = 90;
pub const MIN_DENO: [u32; 3] = [2, 3, 0];
pub const MIN_NODE: [u32; 3] = [22, 0, 0];
const MAX_VERSION_OUTPUT: u64 = 4096;
pub const MAX_SETTING_PATH: usize = 1024;

/// The three settings (`download.*Path`); empty = search.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolSettings {
    pub yt_dlp: String,
    pub ffmpeg: String,
    pub js_runtime: String,
}

pub fn tool_settings(stored: &Map<String, Value>) -> ToolSettings {
    let text = |key: &str| {
        stored
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| s.len() <= MAX_SETTING_PATH && !s.chars().any(char::is_control))
            .unwrap_or("")
            .to_string()
    };
    ToolSettings {
        yt_dlp: text("download.ytDlpPath"),
        ffmpeg: text("download.ffmpegPath"),
        js_runtime: text("download.jsRuntimePath"),
    }
}

#[cfg(unix)]
fn is_program(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_program(p: &Path) -> bool {
    p.is_file()
}

/// `name` in the first of `dirs` that has it (Windows: `name.exe`).
pub fn find_in(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    dirs.iter()
        .filter(|d| d.is_absolute())
        .map(|d| d.join(&file))
        .find(|p| is_program(p))
}

/// The folders of `PATH` in `env` (the start environment), else of the app's own `PATH`.
pub fn path_dirs(env: &[(String, String)]) -> Vec<PathBuf> {
    let path = env
        .iter()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| std::ffi::OsString::from(v))
        .or_else(|| std::env::var_os("PATH"))
        .unwrap_or_default();
    std::env::split_paths(&path).collect()
}

/// One program: where it is, and whether the user named the place.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Found {
    pub path: Option<PathBuf>,
    /// The setting names a path (found or not) – nothing was searched.
    pub configured: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Located {
    pub yt_dlp: Found,
    pub ffmpeg: Found,
    pub js_runtime: Found,
    /// `deno` | `node`
    pub js_name: Option<String>,
}

fn configured(setting: &str) -> Option<Found> {
    if setting.is_empty() {
        return None;
    }
    let p = PathBuf::from(setting);
    Some(Found {
        path: (p.is_absolute() && is_program(&p)).then_some(p),
        configured: true,
    })
}

fn search(dirs: &[PathBuf], name: &str) -> Found {
    Found {
        path: find_in(dirs, name),
        configured: false,
    }
}

/// `deno` unless the file is called like node.
fn runtime_name(p: &Path) -> String {
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if stem.starts_with("node") {
        "node".into()
    } else {
        "deno".into()
    }
}

pub fn locate(settings: &ToolSettings, dirs: &[PathBuf]) -> Located {
    let yt_dlp = configured(&settings.yt_dlp).unwrap_or_else(|| search(dirs, "yt-dlp"));
    let ffmpeg = configured(&settings.ffmpeg).unwrap_or_else(|| search(dirs, "ffmpeg"));
    let (js_runtime, js_name) = match configured(&settings.js_runtime) {
        Some(f) => {
            let name = f.path.as_deref().map(runtime_name);
            (f, name)
        }
        None => {
            let deno = search(dirs, "deno");
            if deno.path.is_some() {
                (deno, Some("deno".to_string()))
            } else {
                let node = search(dirs, "node");
                let name = node.path.is_some().then(|| "node".to_string());
                (node, name)
            }
        }
    };
    Located {
        yt_dlp,
        ffmpeg,
        js_runtime,
        js_name,
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolState {
    Ok,
    #[default]
    Missing,
    /// Found, but below the version yt-dlp needs (JavaScript runtime).
    TooOld,
    /// Found, but it did not start or did not answer `--version` in time.
    Failed,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub state: ToolState,
    pub version: Option<String>,
    pub path: Option<String>,
    /// JavaScript runtime: `deno` | `node`.
    pub name: Option<String>,
    /// The path comes from the settings.
    pub configured: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTools {
    pub yt_dlp: ToolStatus,
    pub ffmpeg: ToolStatus,
    pub js_runtime: ToolStatus,
    /// The version date of yt-dlp is older than [`OUTDATED_DAYS`].
    pub yt_dlp_outdated: bool,
}

/// The first line a program prints for its version argument, `None` when it does not
/// start, fails or takes longer than `timeout` (then it is killed).
pub fn run_version(
    program: &Path,
    arg: &str,
    env: &[(String, String)],
    timeout: Duration,
) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.arg(arg)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for (k, v) in env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let stdout = child.stdout.take()?;
    // the reader hands its bytes over a channel: a grandchild that keeps the pipe open
    // must not make us wait beyond the time limit
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("fnf-tool-version".into())
        .spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.take(MAX_VERSION_OUTPUT).read_to_end(&mut bytes);
            let _ = tx.send(bytes);
        })
        .ok()?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    if !status.success() {
        return None;
    }
    let bytes = rx.recv_timeout(Duration::from_secs(1)).ok()?;
    String::from_utf8_lossy(&bytes)
        .lines()
        .next()
        .map(str::to_string)
}

/// The version in a first line: `2026.11.23`, `ffmpeg version 9.1 Copyright …`,
/// `deno 2.9.8 (stable, …)`, `v24.21.0`. Cut to harmless characters.
pub fn parse_version(line: &str) -> Option<String> {
    let word = line.split_whitespace().find(|w| {
        w.trim_start_matches(['v', 'n', 'N'])
            .starts_with(|c: char| c.is_ascii_digit())
    })?;
    let v: String = word
        .trim_start_matches('v')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '_' | '-'))
        .take(40)
        .collect();
    (!v.is_empty()).then_some(v)
}

/// The leading numbers of a version (`2.9.8` → `[2, 9, 8]`, `n7.1-12-g…` → `[7, 1]`).
pub fn version_numbers(v: &str) -> Vec<u32> {
    let mut out = Vec::new();
    for part in v
        .trim_start_matches(|c: char| !c.is_ascii_digit())
        .split('.')
        .take(4)
    {
        let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
        let Ok(n) = digits.parse() else {
            break;
        };
        out.push(n);
        if digits.len() != part.len() {
            break;
        }
    }
    out
}

fn at_least(v: &str, min: [u32; 3]) -> bool {
    let mut n = version_numbers(v);
    n.resize(3, 0);
    n[..3] >= min[..]
}

/// Days since 1970-01-01 of a civil date (Howard Hinnant's algorithm).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn today_days() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() / 86_400) as i64)
        .unwrap_or(0)
}

/// yt-dlp's version is its release date (`2026.11.23`, nightly `2026.11.23.232815`).
pub fn outdated(version: &str, today: i64) -> bool {
    let n = version_numbers(version);
    let [y, m, d, ..] = n.as_slice() else {
        return false;
    };
    if !(2000..=9999).contains(y) || !(1..=12).contains(m) || !(1..=31).contains(d) {
        return false;
    }
    today - days_from_civil(i64::from(*y), i64::from(*m), i64::from(*d)) > OUTDATED_DAYS
}

fn status(
    found: &Found,
    name: Option<&str>,
    arg: &str,
    env: &[(String, String)],
    timeout: Duration,
    min: Option<[u32; 3]>,
) -> ToolStatus {
    let Some(path) = &found.path else {
        return ToolStatus {
            configured: found.configured,
            name: name.map(str::to_string),
            ..ToolStatus::default()
        };
    };
    let version = run_version(path, arg, env, timeout)
        .as_deref()
        .and_then(parse_version);
    let state = match (&version, min) {
        (None, _) => ToolState::Failed,
        (Some(v), Some(min)) if !at_least(v, min) => ToolState::TooOld,
        _ => ToolState::Ok,
    };
    ToolStatus {
        state,
        version,
        path: Some(path.to_string_lossy().into_owned()),
        name: name.map(str::to_string),
        configured: found.configured,
    }
}

/// Runs the version checks (blocks; a few hundred milliseconds, at worst the time limits).
pub fn probe(located: &Located, env: &[(String, String)], today: i64) -> DownloadTools {
    let yt_dlp = status(
        &located.yt_dlp,
        None,
        "--version",
        env,
        YT_DLP_TIMEOUT,
        None,
    );
    let ffmpeg = status(
        &located.ffmpeg,
        None,
        "-version",
        env,
        VERSION_TIMEOUT,
        None,
    );
    let js_name = located.js_name.as_deref();
    let js_runtime = status(
        &located.js_runtime,
        js_name,
        "--version",
        env,
        VERSION_TIMEOUT,
        Some(if js_name == Some("node") {
            MIN_NODE
        } else {
            MIN_DENO
        }),
    );
    let yt_dlp_outdated = yt_dlp
        .version
        .as_deref()
        .is_some_and(|v| outdated(v, today));
    DownloadTools {
        yt_dlp,
        ffmpeg,
        js_runtime,
        yt_dlp_outdated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_cut_to_versions() {
        for (line, want) in [
            ("2026.11.23", Some("2026.11.23")),
            ("2026.11.23.232815", Some("2026.11.23.232815")),
            (
                "ffmpeg version 9.1 Copyright (c) 2000-2026 the FFmpeg developers",
                Some("9.1"),
            ),
            (
                "ffmpeg version n7.1-12-gabc Copyright",
                Some("n7.1-12-gabc"),
            ),
            (
                "deno 2.9.8 (stable, release, aarch64-apple-darwin)",
                Some("2.9.8"),
            ),
            ("v24.21.0", Some("24.21.0")),
            ("2026.11.23<script>alert(1)</script>", Some("2026.11.23")),
            ("no version here", None),
            ("", None),
        ] {
            assert_eq!(parse_version(line).as_deref(), want, "{line:?}");
        }
        let long = format!("1.{}", "2".repeat(500));
        assert_eq!(parse_version(&long).unwrap().len(), 40);
        assert_eq!(version_numbers("2.9.8"), [2, 9, 8]);
        assert_eq!(version_numbers("n7.1-12-gabc"), [7, 1]);
        assert_eq!(version_numbers("24.21.0"), [24, 21, 0]);
        assert_eq!(version_numbers("x"), Vec::<u32>::new());
        assert!(at_least("2.3.0", MIN_DENO));
        assert!(at_least("2.9.8", MIN_DENO));
        assert!(at_least("3", MIN_DENO));
        assert!(!at_least("2.2.12", MIN_DENO));
        assert!(!at_least("1.46.3", MIN_DENO));
        assert!(at_least("22.0.0", MIN_NODE));
        assert!(!at_least("20.18.1", MIN_NODE));
    }

    #[test]
    fn an_old_yt_dlp_is_outdated() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2026, 11, 25), 20_782);
        let today = days_from_civil(2026, 11, 25);
        assert!(!outdated("2026.11.23", today));
        assert!(!outdated("2026.08.27", today), "90 days");
        assert!(outdated("2026.08.26", today), "91 days");
        assert!(outdated("2025.01.15.232815", today));
        // not a date: no hint
        assert!(!outdated("9.1", today));
        assert!(!outdated("0.0.0", today));
        assert!(!outdated("", today));
    }

    #[test]
    fn settings_are_read_defensively() {
        let mut m = Map::new();
        assert_eq!(tool_settings(&m), ToolSettings::default());
        m.insert("download.ytDlpPath".into(), Value::from("  /opt/yt-dlp  "));
        m.insert("download.ffmpegPath".into(), Value::from(7));
        m.insert("download.jsRuntimePath".into(), Value::from("/x\n/y"));
        let s = tool_settings(&m);
        assert_eq!(s.yt_dlp, "/opt/yt-dlp");
        assert_eq!(s.ffmpeg, "");
        assert_eq!(s.js_runtime, "");
    }

    #[cfg(unix)]
    mod unix {
        use super::super::*;
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        use tempfile::tempdir;

        fn program(dir: &Path, name: &str, script: &str) -> PathBuf {
            let p = dir.join(name);
            fs::write(&p, format!("#!/bin/sh\n{script}\n")).unwrap();
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
            p
        }

        #[test]
        fn programs_are_found_in_the_path_folders_in_order() {
            let d = tempdir().unwrap();
            let (a, b, c) = (d.path().join("a"), d.path().join("b ü"), d.path().join("c"));
            for x in [&a, &b, &c] {
                fs::create_dir(x).unwrap();
            }
            program(&b, "yt-dlp", "echo 2026.11.23");
            program(&c, "yt-dlp", "echo 2020.01.01");
            program(&c, "node", "echo v24.0.0");
            // not executable, a folder, a relative entry: skipped
            fs::write(a.join("yt-dlp"), "x").unwrap();
            fs::create_dir(a.join("ffmpeg")).unwrap();
            let dirs = vec![PathBuf::from("rel"), a.clone(), b.clone(), c.clone()];
            let l = locate(&ToolSettings::default(), &dirs);
            assert_eq!(l.yt_dlp.path, Some(b.join("yt-dlp")));
            assert!(!l.yt_dlp.configured);
            assert_eq!(l.ffmpeg.path, None);
            // no deno: node
            assert_eq!(l.js_runtime.path, Some(c.join("node")));
            assert_eq!(l.js_name.as_deref(), Some("node"));
            program(&a, "deno", "echo deno 2.9.8");
            let l = locate(&ToolSettings::default(), &dirs);
            assert_eq!(l.js_name.as_deref(), Some("deno"));
            assert_eq!(
                path_dirs(&[("PATH".into(), format!("{}:{}", a.display(), b.display()))]),
                [a, b]
            );
        }

        #[test]
        fn a_setting_wins_and_is_not_searched_around() {
            let d = tempdir().unwrap();
            let bin = d.path().join("bin");
            fs::create_dir(&bin).unwrap();
            program(&bin, "yt-dlp", "echo 2026.11.23");
            let own = program(d.path(), "my-ytdlp", "echo 2026.01.01");
            let node = program(d.path(), "nodejs", "echo v22.1.0");
            let dirs = vec![bin.clone()];
            let l = locate(
                &ToolSettings {
                    yt_dlp: own.to_string_lossy().into_owned(),
                    ffmpeg: "/nowhere/ffmpeg".into(),
                    js_runtime: node.to_string_lossy().into_owned(),
                },
                &dirs,
            );
            assert_eq!(l.yt_dlp.path, Some(own));
            assert!(l.yt_dlp.configured);
            // a wrong setting is "missing", not silently replaced
            assert_eq!(l.ffmpeg.path, None);
            assert!(l.ffmpeg.configured);
            assert_eq!(l.js_name.as_deref(), Some("node"));
            // a relative setting is never run
            let l = locate(
                &ToolSettings {
                    yt_dlp: "yt-dlp".into(),
                    ..ToolSettings::default()
                },
                &dirs,
            );
            assert_eq!(l.yt_dlp.path, None);
        }

        #[test]
        fn the_status_runs_the_version_checks() {
            let d = tempdir().unwrap();
            let dir = d.path().to_path_buf();
            program(&dir, "yt-dlp", "echo 2020.01.01");
            program(
                &dir,
                "ffmpeg",
                "[ \"$1\" = -version ] && echo 'ffmpeg version 9.1 Copyright'",
            );
            program(&dir, "deno", "echo 'deno 1.46.3 (release)'");
            let l = locate(&ToolSettings::default(), std::slice::from_ref(&dir));
            let t = probe(&l, &[], days_from_civil(2026, 11, 25));
            assert_eq!(t.yt_dlp.state, ToolState::Ok);
            assert_eq!(t.yt_dlp.version.as_deref(), Some("2020.01.01"));
            assert!(t.yt_dlp_outdated);
            assert_eq!(t.ffmpeg.state, ToolState::Ok);
            assert_eq!(t.ffmpeg.version.as_deref(), Some("9.1"));
            assert_eq!(t.js_runtime.state, ToolState::TooOld);
            assert_eq!(t.js_runtime.name.as_deref(), Some("deno"));
            // nothing there
            let t = probe(&Located::default(), &[], 0);
            assert_eq!(t.yt_dlp.state, ToolState::Missing);
            assert_eq!(t.ffmpeg.state, ToolState::Missing);
            assert!(!t.yt_dlp_outdated);
            let json = serde_json::to_value(&t).unwrap();
            assert_eq!(json["ytDlp"]["state"], "missing");
            assert_eq!(json["jsRuntime"]["state"], "missing");
        }

        #[test]
        fn a_program_that_fails_or_hangs_is_reported() {
            let d = tempdir().unwrap();
            let bad = program(d.path(), "bad", "exit 3");
            let silent = program(d.path(), "silent", "exit 0");
            let slow = program(d.path(), "slow", "sleep 30");
            let t = Duration::from_secs(5);
            assert_eq!(run_version(&bad, "--version", &[], t), None);
            assert_eq!(run_version(&silent, "--version", &[], t), None);
            assert_eq!(
                run_version(Path::new("/nowhere/x"), "--version", &[], t),
                None
            );
            let start = Instant::now();
            assert_eq!(
                run_version(&slow, "--version", &[], Duration::from_millis(200)),
                None
            );
            assert!(start.elapsed() < Duration::from_secs(5));
            let f = Found {
                path: Some(bad),
                configured: true,
            };
            let s = status(&f, None, "--version", &[], t, None);
            assert_eq!(s.state, ToolState::Failed);
            assert!(s.configured);
        }
    }
}
