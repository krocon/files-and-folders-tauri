//! Login environment (design 021 E6): apps started from the Finder (or some
//! desktop menus) have a minimal `PATH`. The user's login shell is asked once
//! (`<shell> -l -c env`, stdin closed, own session, timeout) and only
//! `PATH`, `MANPATH`, `LANG` and `LC_*` are taken over. Cached for the app's
//! lifetime; on failure the app's own environment is used.

use super::ShellKind;
use crate::platform::process::spawn_group;
use std::io::Read;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(3);

/// Keys taken over from the login environment.
pub fn wanted(key: &str) -> bool {
    matches!(key, "PATH" | "MANPATH" | "LANG") || key.starts_with("LC_")
}

/// `env` output → the wanted pairs. Lines, not `env -0`: the `env` of older macOS
/// has no `-0` (review 021 #6); the wanted values have no line breaks.
pub fn parse_env(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let (k, v) = line.split_once('=')?;
            wanted(k).then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

/// Runs the login shell and reads its environment; `None` on error or timeout.
pub fn read_login_env(kind: &ShellKind, timeout: Duration) -> Option<Vec<(String, String)>> {
    let ShellKind::Posix { program, .. } = kind else {
        return None;
    };
    let mut cmd = Command::new(program);
    cmd.args(["-l", "-c", "env"]);
    let mut g = spawn_group(cmd).ok()?;
    let mut out = g.child.stdout.take()?;
    // stderr is not read: drop it so the shell never blocks on a full pipe
    drop(g.child.stderr.take());
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = std::thread::Builder::new()
        .name("fnf-login-env-read".into())
        .spawn(move || {
            let mut buf = Vec::new();
            let _ = (&mut out).take(1024 * 1024).read_to_end(&mut buf);
            let _ = tx.send(buf);
        });
    let start = Instant::now();
    loop {
        match g.child.try_wait() {
            Ok(Some(status)) => {
                // a process started by the profile (ssh-agent …) may keep the pipe open
                let rest = timeout
                    .saturating_sub(start.elapsed())
                    .max(Duration::from_millis(200));
                let buf = rx.recv_timeout(rest).ok();
                g.kill();
                let pairs = parse_env(&String::from_utf8_lossy(&buf?));
                return (status.success() && pairs.iter().any(|(k, _)| k == "PATH"))
                    .then_some(pairs);
            }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                g.kill();
                let _ = g.child.wait();
                return None;
            }
        }
    }
}

/// `None` = not read yet; `Some(None)` = read and failed.
type Cached = Option<(ShellKind, Option<Vec<(String, String)>>)>;
static CACHE: Mutex<Cached> = Mutex::new(None);

/// The login environment of `kind`, read once (blocking – call from a worker thread).
pub fn login_env(kind: &ShellKind) -> Option<Vec<(String, String)>> {
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((k, env)) = cache.as_ref()
        && k == kind
    {
        return env.clone();
    }
    let env = read_login_env(kind, LOGIN_TIMEOUT);
    *cache = Some((kind.clone(), env.clone()));
    env
}
