//! Design 061 E6b: reading the login PATH (fake shells as scripts, marker parser,
//! retry throttle with a passed-in clock, PATH merging).

use super::ShellKind;
use super::env::*;
#[cfg(unix)]
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
#[cfg(unix)]
use tempfile::tempdir;

#[cfg(unix)]
const RUN: &str = "exec /bin/sh -c \"$last\"";

/// A "login shell": runs `profile`, then the script (`$last`) via `tail`.
#[cfg(unix)]
fn fake_shell(dir: &Path, name: &str, profile: &str, tail: &str) -> ShellKind {
    use std::os::unix::fs::PermissionsExt;
    let p = dir.join(name);
    fs::write(
        &p,
        format!("#!/bin/sh\n{profile}\nfor last; do :; done\n{tail}\n"),
    )
    .unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
    ShellKind::Posix {
        program: p,
        fish: false,
    }
}

#[cfg(unix)]
fn read(k: &ShellKind) -> Result<EnvPairs, LoginEnvError> {
    read_login_env(k, LoginMode::Login, Duration::from_secs(10))
}

#[cfg(unix)]
fn has_path(r: &Result<EnvPairs, LoginEnvError>) -> bool {
    r.as_ref().is_ok_and(|e| e.iter().any(|(k, _)| k == "PATH"))
}

/// The cause on Marc's Mac: `.zprofile` prints a warning; a closed stderr pipe killed zsh.
#[cfg(unix)]
#[test]
fn profile_writing_to_stderr() {
    let t = tempdir().unwrap();
    let k = fake_shell(
        t.path(),
        "noisy",
        "echo 'zprofile: not valid in this context' >&2",
        RUN,
    );
    assert!(has_path(&read(&k)));
}

/// Cause 1: a background process keeps stdout open – done at the end marker, fast.
#[cfg(unix)]
#[test]
fn profile_with_background_process() {
    let t = tempdir().unwrap();
    let k = fake_shell(t.path(), "bg", "sleep 30 &", RUN);
    let start = Instant::now();
    assert!(has_path(&read(&k)));
    assert!(
        start.elapsed() < Duration::from_secs(1),
        "{:?}",
        start.elapsed()
    );
}

/// … also one that left the process group (own session, like a daemon).
#[cfg(unix)]
#[test]
fn profile_with_daemon_outside_the_group() {
    let t = tempdir().unwrap();
    let k = fake_shell(
        t.path(),
        "daemon",
        "perl -e 'use POSIX; POSIX::setsid(); exec \"sleep\", \"30\"' &",
        RUN,
    );
    let start = Instant::now();
    assert!(has_path(&read(&k)));
    assert!(
        start.elapsed() < Duration::from_secs(1),
        "{:?}",
        start.elapsed()
    );
}

/// Cause 2: a slow profile (> the old 3 s) is read within the new timeout.
#[cfg(unix)]
#[test]
fn slow_profile_within_the_timeout() {
    let t = tempdir().unwrap();
    let k = fake_shell(t.path(), "slow", "sleep 3.5", RUN);
    assert!(has_path(&read(&k)));
}

/// Noise before and after `env` (banners, `echo` in the profile) does not count.
#[cfg(unix)]
#[test]
fn noise_around_env_is_ignored() {
    let t = tempdir().unwrap();
    let k = fake_shell(
        t.path(),
        "banner",
        "echo 'Welcome!'; printf 'PATH=/from/noise\\nLANG=xx\\n'; printf 'no newline'",
        "/bin/sh -c \"$last\"; echo 'PATH=/after'; echo bye",
    );
    let env = read(&k).unwrap();
    let path = &env.iter().find(|(k, _)| k == "PATH").unwrap().1;
    assert_ne!(path, "/from/noise");
    assert_ne!(path, "/after");
    assert!(!env.iter().any(|(k, v)| k == "LANG" && v == "xx"));
}

/// Cause 3: exit ≠ 0 after a complete `env` still counts.
#[cfg(unix)]
#[test]
fn exit_status_after_env_is_ignored() {
    let t = tempdir().unwrap();
    let k = fake_shell(t.path(), "exit1", "", "/bin/sh -c \"$last\"; exit 1");
    assert!(has_path(&read(&k)));
}

#[cfg(unix)]
#[test]
fn reasons_of_failures() {
    let t = tempdir().unwrap();
    let k = fake_shell(t.path(), "exit3", "exit 3", RUN);
    assert_eq!(read(&k), Err(LoginEnvError::ExitStatus(3)));
    let k = fake_shell(t.path(), "exit0", "exit 0", RUN);
    assert_eq!(read(&k), Err(LoginEnvError::Incomplete));
    // ended normally, but a background process keeps the pipe open
    let k = fake_shell(t.path(), "noeof", "sleep 30 &\nexit 0", RUN);
    let start = Instant::now();
    assert_eq!(read(&k), Err(LoginEnvError::NoEof));
    assert!(start.elapsed() < Duration::from_secs(2));
    let k = fake_shell(
        t.path(),
        "nopath",
        "",
        "exec /bin/sh -c \"$(printf '%s' \"$last\" | sed 's/command env/echo LANG=C/')\"",
    );
    assert_eq!(read(&k), Err(LoginEnvError::NoPath));
    let k = ShellKind::Posix {
        program: t.path().join("missing"),
        fish: false,
    };
    assert_eq!(
        read(&k),
        Err(LoginEnvError::Spawn(std::io::ErrorKind::NotFound))
    );
    let k = ShellKind::Cmd {
        program: "cmd.exe".into(),
    };
    assert_eq!(read(&k), Err(LoginEnvError::NotPosix));
    // the output is bounded
    let k = fake_shell(t.path(), "flood", "yes 0123456789abcdef", RUN);
    assert_eq!(read(&k), Err(LoginEnvError::TooLarge));
}

/// `loginInteractive` passes `-i`; a profile that fails then is read again as `login`.
#[cfg(unix)]
#[test]
fn interactive_mode_and_fallback() {
    let t = tempdir().unwrap();
    let k = fake_shell(t.path(), "needs-i", "[ \"$1\" = -i ] || exit 4", RUN);
    let a = read_with_fallback(&k, LoginMode::LoginInteractive, Duration::from_secs(10));
    assert!(has_path(&a.result));
    assert_eq!(a.mode, LoginMode::LoginInteractive);
    assert_eq!(a.path_entries().map(|n| n > 0), Some(true));
    let k = fake_shell(t.path(), "no-i", "[ \"$1\" = -i ] && exit 4", RUN);
    let a = read_with_fallback(&k, LoginMode::LoginInteractive, Duration::from_secs(10));
    assert!(has_path(&a.result));
    assert_eq!(a.mode, LoginMode::Login);
    // a timeout is not tried twice
    let k = fake_shell(t.path(), "hang", "sleep 30", RUN);
    let a = read_with_fallback(&k, LoginMode::LoginInteractive, Duration::from_millis(300));
    assert_eq!(a.result, Err(LoginEnvError::Timeout));
    assert_eq!(a.mode, LoginMode::LoginInteractive);
}

/// The real shells of the system read without a terminal (`-i -l -c` too; fish if installed).
#[cfg(unix)]
#[test]
fn system_shells() {
    let shells = [
        ("/bin/sh", false),
        ("/bin/bash", false),
        ("/bin/zsh", false),
        ("/usr/bin/fish", true),
        ("/opt/homebrew/bin/fish", true),
        ("/usr/local/bin/fish", true),
    ];
    for (program, fish) in shells {
        if !Path::new(program).is_file() {
            continue;
        }
        let k = ShellKind::Posix {
            program: program.into(),
            fish,
        };
        for mode in [LoginMode::Login, LoginMode::LoginInteractive] {
            let r = read_login_env(&k, mode, Duration::from_secs(10));
            assert!(has_path(&r), "{program} {mode:?}: {:?}", r.err());
        }
    }
}

// ---- marker parser ----

fn feed_all(r: &mut MarkerReader, data: &[u8], step: usize) -> Feed {
    for c in data.chunks(step) {
        match r.push(c) {
            Feed::More => {}
            other => return other,
        }
    }
    Feed::More
}

#[test]
fn marker_reader() {
    let m = "__FNF_ENV_X__";
    let data =
        format!("banner\nPATH=/noise\n{m} not alone\n\n{m}\nPATH=/a:/b\r\nLANG=C\n\n{m}\nafter\n");
    for step in [1, 2, 7, 1000] {
        let mut r = MarkerReader::new(m);
        let Feed::Done(text) = feed_all(&mut r, data.as_bytes(), step) else {
            panic!("step {step}");
        };
        assert_eq!(
            parse_env(&text),
            vec![
                ("PATH".to_string(), "/a:/b".to_string()),
                ("LANG".into(), "C".into())
            ]
        );
    }
    // missing end marker: more is needed
    let mut r = MarkerReader::new(m);
    assert_eq!(r.push(format!("{m}\nPATH=/a\n{m}").as_bytes()), Feed::More);
    assert_eq!(r.push(b"\n"), Feed::Done("PATH=/a\n".into()));
    // CRLF marker lines
    let mut r = MarkerReader::new(m);
    assert_eq!(
        r.push(format!("\r\n{m}\r\nPATH=/c\r\n{m}\r\n").as_bytes()),
        Feed::Done("PATH=/c\r\n".into())
    );
}

#[test]
fn marker_reader_long_lines_and_limit() {
    let m = "__FNF_ENV_Y__";
    let long = "x".repeat(MAX_OUTPUT - 200);
    let mut r = MarkerReader::new(m);
    let data = format!("{m}\nPATH=/p\nLONG={long}\n{m}\n");
    let Feed::Done(text) = feed_all(&mut r, data.as_bytes(), 64 * 1024) else {
        panic!("long line within the limit");
    };
    assert_eq!(
        parse_env(&text),
        vec![("PATH".to_string(), "/p".to_string())]
    );
    let mut r = MarkerReader::new(m);
    let data = format!("{m}\n{}", "y".repeat(MAX_OUTPUT + 1));
    assert_eq!(feed_all(&mut r, data.as_bytes(), 64 * 1024), Feed::TooLarge);
}

#[test]
fn markers_are_random_and_plain() {
    let a = new_marker();
    let b = new_marker();
    assert_ne!(a, b);
    assert!(
        a.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    );
    let s = script(&a);
    assert!(s.contains("command env") && s.matches(&a).count() == 2);
}

#[test]
fn parse_env_keeps_the_first_of_a_key() {
    assert_eq!(
        parse_env("PATH=/a\nPATH=/b\nLC_ALL=C\n"),
        vec![
            ("PATH".to_string(), "/a".to_string()),
            ("LC_ALL".into(), "C".into())
        ]
    );
}

// ---- cache and retry throttle ----

fn kind() -> ShellKind {
    ShellKind::Posix {
        program: "/bin/zsh".into(),
        fish: false,
    }
}

fn attempt(ok: bool) -> Attempt {
    Attempt {
        result: if ok {
            Ok(vec![("PATH".into(), "/a:/b".into())])
        } else {
            Err(LoginEnvError::Timeout)
        },
        mode: LoginMode::LoginInteractive,
        duration: Duration::from_millis(5),
    }
}

#[test]
fn cache_retries_failures_at_most_every_minute() {
    let k = kind();
    let m = LoginMode::LoginInteractive;
    let t0 = Instant::now();
    let mut c = LoginCache::new();
    assert_eq!(c.begin(&k, m, t0), Step::Run);
    // a second caller waits instead of starting another shell
    assert_eq!(c.begin(&k, m, t0), Step::Wait);
    c.finish(&k, m, attempt(false), t0);
    assert_eq!(
        c.begin(&k, m, t0 + Duration::from_secs(59)),
        Step::Use(attempt(false))
    );
    assert_eq!(c.begin(&k, m, t0 + RETRY_AFTER), Step::Run);
    let t1 = t0 + RETRY_AFTER;
    c.finish(&k, m, attempt(true), t1);
    // success is kept
    assert_eq!(
        c.begin(&k, m, t1 + Duration::from_secs(3600)),
        Step::Use(attempt(true))
    );
    assert_eq!(c.last(), Some(&attempt(true)));
    // another mode (setting changed) reads again
    assert_eq!(c.begin(&k, LoginMode::Login, t1), Step::Run);
    // a late answer for the old key does not overwrite
    c.finish(&k, m, attempt(false), t1);
    assert!(c.is_running());
}

#[test]
fn notice_once_and_again_after_a_success() {
    let mut c = LoginCache::new();
    let fail = attempt(false).result;
    let ok = attempt(true).result;
    assert_eq!(c.take_notice(&fail), Some(LoginEnvError::Timeout));
    assert_eq!(c.take_notice(&fail), None);
    assert_eq!(c.take_notice(&fail), None);
    assert_eq!(c.take_notice(&ok), None);
    assert_eq!(c.take_notice(&fail), Some(LoginEnvError::Timeout));
}

#[test]
fn reason_codes_and_modes() {
    let codes: Vec<_> = [
        LoginEnvError::NotPosix,
        LoginEnvError::Spawn(std::io::ErrorKind::NotFound),
        LoginEnvError::Timeout,
        LoginEnvError::NoEof,
        LoginEnvError::ExitStatus(1),
        LoginEnvError::Incomplete,
        LoginEnvError::NoPath,
        LoginEnvError::TooLarge,
    ]
    .iter()
    .map(|e| e.code())
    .collect();
    assert_eq!(
        codes,
        [
            "notPosix",
            "spawn",
            "timeout",
            "noEof",
            "exitStatus",
            "incomplete",
            "noPath",
            "tooLarge"
        ]
    );
    use serde_json::json;
    assert_eq!(LoginMode::from_setting(&json!("off")), None);
    assert_eq!(
        LoginMode::from_setting(&json!("login")),
        Some(LoginMode::Login)
    );
    assert_eq!(
        LoginMode::from_setting(&json!("loginInteractive")),
        Some(LoginMode::LoginInteractive)
    );
    assert_eq!(
        LoginMode::from_setting(&json!(true)),
        Some(LoginMode::LoginInteractive)
    );
    assert_eq!(LoginMode::from_setting(&json!(false)), None);
}

// ---- PATH of a command ----

#[test]
fn merge_path_order_duplicates_and_missing_folders() {
    let fallback = [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/missing"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/odd:dir"),
    ];
    let exists = |p: &Path| p != Path::new("/missing");
    assert_eq!(
        merge_path(
            Some("/login/bin::/usr/bin"),
            &fallback,
            "/usr/bin:/bin:/opt/homebrew/bin",
            exists
        ),
        "/login/bin:/usr/bin:/opt/homebrew/bin:/bin"
    );
    // no login PATH: standard places before the app's PATH
    assert_eq!(
        merge_path(None, &fallback, "/usr/bin:/bin", exists),
        "/opt/homebrew/bin:/usr/bin:/bin"
    );
    assert_eq!(merge_path(None, &[], "", exists), "");
}

#[test]
fn path_helper_and_fallback_dirs() {
    let out = "MANPATH=\"/usr/share/man\"; export MANPATH;\nPATH=\"/usr/local/bin:/usr/bin:/bin\"; export PATH;\n";
    let ph = parse_path_helper(out);
    assert_eq!(
        ph,
        [
            PathBuf::from("/usr/local/bin"),
            "/usr/bin".into(),
            "/bin".into()
        ]
    );
    assert!(parse_path_helper("garbage").is_empty());
    let home = Path::new("/Users/m");
    let mac = fallback_dirs(true, Some(home), &ph);
    assert_eq!(mac[0], PathBuf::from("/usr/local/bin"));
    assert!(mac.contains(&PathBuf::from("/opt/homebrew/bin")));
    assert!(mac.contains(&PathBuf::from("/opt/homebrew/sbin")));
    assert_eq!(mac.last(), Some(&home.join(".cargo").join("bin")));
    assert_eq!(
        fallback_dirs(false, Some(home), &ph),
        [
            home.join(".local").join("bin"),
            home.join(".cargo").join("bin")
        ]
    );
    assert!(fallback_dirs(false, None, &[]).is_empty());
}

#[test]
fn build_env_takes_login_pairs_and_merges_path() {
    let login: EnvPairs = vec![
        ("PATH".into(), "/l".into()),
        ("LANG".into(), "de_DE.UTF-8".into()),
    ];
    let fb = [PathBuf::from("/f")];
    assert_eq!(
        build_env(Some(&login), &fb, "/a", |_| true),
        vec![
            ("LANG".to_string(), "de_DE.UTF-8".to_string()),
            ("PATH".into(), "/l:/f:/a".into())
        ]
    );
    assert_eq!(
        build_env(None, &fb, "/a", |_| true),
        vec![("PATH".to_string(), "/f:/a".to_string())]
    );
}
