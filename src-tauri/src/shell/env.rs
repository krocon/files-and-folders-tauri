//! Login environment (design 021 E6, 061 E6b): apps started from the Finder (or
//! some desktop menus) have a minimal `PATH`. The user's login shell is asked
//! (`<shell> [-i] -l -c '<marker>; env; <marker>'`, stdin and stderr null, own
//! session, timeout) and only `PATH`, `MANPATH`, `LANG` and `LC_*` are taken over.
//!
//! - Only the lines between two random markers count (profile output does not
//!   disturb), and reading ends at the end marker – a process the profile left
//!   running with our stdout (ssh-agent …) cannot hold the reader up.
//! - stderr is the null device: a closed pipe there killed shells whose profile
//!   prints a warning (SIGPIPE – the cause of 061 on Marc's Mac).
//! - Success is kept for the app's lifetime; a failure is retried at most every
//!   [`RETRY_AFTER`]. The PATH of a command is login PATH > standard places >
//!   app PATH ([`merge_path`]).
//!
//! Nothing here logs values or paths: debug builds print the reason and duration.

use super::ShellKind;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(10);
/// A failed read is tried again after this long (not for every command).
pub const RETRY_AFTER: Duration = Duration::from_secs(60);
/// Output of the login shell read at most (bytes).
pub const MAX_OUTPUT: usize = 1024 * 1024;
/// After the shell ended without the end marker: how long remaining output may take.
#[cfg(unix)]
const EXIT_GRACE: Duration = Duration::from_millis(300);

/// How the login shell is asked (setting `shell.loginPath`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginMode {
    /// `-l -c`: `.zprofile`/`.bash_profile`/`.profile`.
    Login,
    /// `-i -l -c`: also `.zshrc`/`.bashrc` (where nvm, pnpm, cargo often extend PATH).
    LoginInteractive,
}

impl LoginMode {
    /// The value of `shell.loginPath`: `off` → `None`. The old `true`/`false` still work.
    pub fn from_setting(v: &serde_json::Value) -> Option<LoginMode> {
        match v {
            serde_json::Value::String(s) if s == "login" => Some(LoginMode::Login),
            serde_json::Value::String(s) if s == "loginInteractive" => {
                Some(LoginMode::LoginInteractive)
            }
            serde_json::Value::Bool(true) => Some(LoginMode::LoginInteractive),
            _ => None,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            LoginMode::Login => "login",
            LoginMode::LoginInteractive => "loginInteractive",
        }
    }

    // only the POSIX reader starts a login shell (Windows has none – dead code there, CI)
    #[cfg(unix)]
    fn args(self) -> &'static [&'static str] {
        match self {
            LoginMode::Login => &["-l", "-c"],
            LoginMode::LoginInteractive => &["-i", "-l", "-c"],
        }
    }
}

/// Why the login environment could not be read (the code goes to the frontend).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginEnvError {
    /// No POSIX shell (Windows).
    NotPosix,
    /// The shell could not be started.
    Spawn(std::io::ErrorKind),
    /// The shell did not answer within the timeout.
    Timeout,
    /// The shell ended without the end marker, a process keeps its output open.
    NoEof,
    /// The shell ended with this status (128 + signal) before the end marker.
    ExitStatus(i32),
    /// The shell ended normally without the end marker (e.g. `exit` in the profile).
    Incomplete,
    /// Read, but without `PATH`.
    NoPath,
    /// More than [`MAX_OUTPUT`] bytes without the end marker.
    TooLarge,
}

impl LoginEnvError {
    pub fn code(&self) -> &'static str {
        match self {
            LoginEnvError::NotPosix => "notPosix",
            LoginEnvError::Spawn(_) => "spawn",
            LoginEnvError::Timeout => "timeout",
            LoginEnvError::NoEof => "noEof",
            LoginEnvError::ExitStatus(_) => "exitStatus",
            LoginEnvError::Incomplete => "incomplete",
            LoginEnvError::NoPath => "noPath",
            LoginEnvError::TooLarge => "tooLarge",
        }
    }
}

pub type EnvPairs = Vec<(String, String)>;

/// Keys taken over from the login environment.
pub fn wanted(key: &str) -> bool {
    matches!(key, "PATH" | "MANPATH" | "LANG") || key.starts_with("LC_")
}

/// `env` output → the wanted pairs (first one of a key wins). Lines, not `env -0`:
/// the `env` of older macOS has no `-0` (review 021 #6); the wanted values have no
/// line breaks.
pub fn parse_env(text: &str) -> EnvPairs {
    let mut out: EnvPairs = Vec::new();
    for line in text.lines() {
        if let Some((k, v)) = line.split_once('=')
            && wanted(k)
            && !out.iter().any(|(o, _)| o == k)
        {
            out.push((k.to_string(), v.to_string()));
        }
    }
    out
}

/// A marker nobody types: random per call, only `[A-Z0-9_]` (no quoting in any shell).
pub fn new_marker() -> String {
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    h.write_u32(std::process::id());
    let n = COUNT.fetch_add(1, Ordering::Relaxed);
    format!("__FNF_ENV_{:016X}_{n:X}__", h.finish())
}

/// The script for `-c`: works in sh/bash/zsh/dash/ksh/yash and fish. `command`
/// skips an alias or function named `env`.
pub fn script(marker: &str) -> String {
    format!("printf '\\n%s\\n' {marker}; command env; printf '\\n%s\\n' {marker}")
}

/// What [`MarkerReader::push`] found so far.
#[derive(Debug, PartialEq, Eq)]
pub enum Feed {
    More,
    /// The text between the markers.
    Done(String),
    TooLarge,
}

/// Incremental reader: done as soon as the end marker line arrived. A marker
/// counts only as a whole line (`\r\n` too), so a command line echoed by the
/// profile (`set -v`) does not end it.
pub struct MarkerReader {
    marker: Vec<u8>,
    buf: Vec<u8>,
    /// Start of the first line not looked at yet.
    scanned: usize,
    /// Byte after the begin marker line.
    begin: Option<usize>,
}

impl MarkerReader {
    pub fn new(marker: &str) -> Self {
        MarkerReader {
            marker: marker.as_bytes().to_vec(),
            buf: Vec::new(),
            scanned: 0,
            begin: None,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Feed {
        if self.buf.len() + bytes.len() > MAX_OUTPUT {
            return Feed::TooLarge;
        }
        self.buf.extend_from_slice(bytes);
        while let Some(nl) = self.buf[self.scanned..].iter().position(|&b| b == b'\n') {
            let start = self.scanned;
            let end = start + nl;
            self.scanned = end + 1;
            let line = &self.buf[start..end];
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if line == self.marker.as_slice() {
                match self.begin {
                    None => self.begin = Some(self.scanned),
                    Some(b) => {
                        return Feed::Done(
                            String::from_utf8_lossy(&self.buf[b..start]).into_owned(),
                        );
                    }
                }
            }
        }
        Feed::More
    }
}

#[cfg(unix)]
fn with_path(pairs: EnvPairs) -> Result<EnvPairs, LoginEnvError> {
    if pairs.iter().any(|(k, _)| k == "PATH") {
        Ok(pairs)
    } else {
        Err(LoginEnvError::NoPath)
    }
}

/// Runs the login shell once and reads its environment (blocking).
#[cfg(unix)]
pub fn read_login_env(
    kind: &ShellKind,
    mode: LoginMode,
    timeout: Duration,
) -> Result<EnvPairs, LoginEnvError> {
    use crate::platform::process::spawn_group_quiet;
    use std::io::Read;
    use std::os::fd::AsRawFd;
    use std::os::unix::process::ExitStatusExt;
    use std::process::Command;

    let ShellKind::Posix { program, .. } = kind else {
        return Err(LoginEnvError::NotPosix);
    };
    let marker = new_marker();
    let mut cmd = Command::new(program);
    cmd.args(mode.args()).arg(script(&marker));
    let mut g = spawn_group_quiet(cmd).map_err(|e| LoginEnvError::Spawn(e.kind()))?;
    let Some(mut out) = g.child.stdout.take() else {
        g.kill();
        let _ = g.child.wait();
        return Err(LoginEnvError::Spawn(std::io::ErrorKind::Other));
    };
    let mut reader = MarkerReader::new(&marker);
    let mut chunk = vec![0u8; 64 * 1024];
    let start = Instant::now();
    let mut exited: Option<(Instant, std::process::ExitStatus)> = None;
    let mut eof = false;
    let result = loop {
        if exited.is_none()
            && let Ok(Some(st)) = g.child.try_wait()
        {
            exited = Some((Instant::now(), st));
        }
        if eof {
            std::thread::sleep(Duration::from_millis(10));
        } else if readable(out.as_raw_fd(), 20) {
            match out.read(&mut chunk) {
                Ok(0) => eof = true,
                Ok(n) => match reader.push(&chunk[..n]) {
                    Feed::More => {}
                    Feed::Done(text) => break with_path(parse_env(&text)),
                    Feed::TooLarge => break Err(LoginEnvError::TooLarge),
                },
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => eof = true,
            }
        }
        if let Some((at, st)) = exited
            && (eof || at.elapsed() >= EXIT_GRACE)
        {
            break Err(if !st.success() {
                LoginEnvError::ExitStatus(
                    st.code().unwrap_or_else(|| 128 + st.signal().unwrap_or(0)),
                )
            } else if eof {
                LoginEnvError::Incomplete
            } else {
                LoginEnvError::NoEof
            });
        }
        if start.elapsed() >= timeout {
            break Err(LoginEnvError::Timeout);
        }
    };
    // done or given up: end the whole group (the shell and what its profile started)
    g.kill();
    let _ = g.child.wait();
    result
}

#[cfg(not(unix))]
pub fn read_login_env(
    _kind: &ShellKind,
    _mode: LoginMode,
    _timeout: Duration,
) -> Result<EnvPairs, LoginEnvError> {
    Err(LoginEnvError::NotPosix)
}

/// Waits up to `ms` until `fd` can be read (or is closed).
#[cfg(unix)]
fn readable(fd: std::os::fd::RawFd, ms: i32) -> bool {
    let mut p = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    // SAFETY: one valid `pollfd` on the stack, count 1.
    let r = unsafe { libc::poll(&mut p, 1, ms) };
    r > 0 && p.revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0
}

/// One read (with fallback): result, the mode that produced it, duration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attempt {
    pub result: Result<EnvPairs, LoginEnvError>,
    pub mode: LoginMode,
    pub duration: Duration,
}

impl Attempt {
    /// Entries of the login `PATH` (for the status – never the values).
    pub fn path_entries(&self) -> Option<usize> {
        let pairs = self.result.as_ref().ok()?;
        let path = pairs.iter().find(|(k, _)| k == "PATH")?;
        Some(path.1.split(':').filter(|s| !s.is_empty()).count())
    }
}

/// `loginInteractive` that fails for another reason than the timeout (an
/// interactive profile that breaks without a terminal) is tried once more as `login`.
pub fn read_with_fallback(kind: &ShellKind, mode: LoginMode, timeout: Duration) -> Attempt {
    let start = Instant::now();
    let mut result = read_login_env(kind, mode, timeout);
    let mut used = mode;
    if mode == LoginMode::LoginInteractive
        && matches!(
            &result,
            Err(e) if !matches!(e, LoginEnvError::Timeout | LoginEnvError::NotPosix | LoginEnvError::Spawn(_))
        )
    {
        result = read_login_env(kind, LoginMode::Login, timeout);
        used = LoginMode::Login;
    }
    Attempt {
        result,
        mode: used,
        duration: start.elapsed(),
    }
}

// ---- cache with retry throttle (pure, the clock is passed in) ----

#[derive(Debug, Clone)]
enum CacheState {
    Empty,
    Running,
    Done { attempt: Attempt, at: Instant },
}

/// What a caller of [`LoginCache::begin`] does next.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    Use(Attempt),
    /// Another thread reads right now.
    Wait,
    /// The caller reads and then calls [`LoginCache::finish`].
    Run,
}

/// Success for the app's lifetime; failure until [`RETRY_AFTER`]; one read at a time.
#[derive(Debug)]
pub struct LoginCache {
    key: Option<(ShellKind, LoginMode)>,
    state: CacheState,
    /// The current failure was shown to the user (notice once per run).
    reported: bool,
}

impl Default for LoginCache {
    fn default() -> Self {
        Self::new()
    }
}

impl LoginCache {
    pub const fn new() -> Self {
        LoginCache {
            key: None,
            state: CacheState::Empty,
            reported: false,
        }
    }

    pub fn begin(&mut self, kind: &ShellKind, mode: LoginMode, now: Instant) -> Step {
        let key = (kind.clone(), mode);
        if self.key.as_ref() != Some(&key) {
            self.key = Some(key);
            self.state = CacheState::Empty;
        }
        match &self.state {
            CacheState::Running => Step::Wait,
            CacheState::Done { attempt, at }
                if attempt.result.is_ok() || now.saturating_duration_since(*at) < RETRY_AFTER =>
            {
                Step::Use(attempt.clone())
            }
            _ => {
                self.state = CacheState::Running;
                Step::Run
            }
        }
    }

    pub fn finish(&mut self, kind: &ShellKind, mode: LoginMode, attempt: Attempt, now: Instant) {
        if self.key.as_ref() == Some(&(kind.clone(), mode)) {
            self.state = CacheState::Done { attempt, at: now };
        }
    }

    /// A read that did not finish in time (a waiter gave up): free for the next try.
    pub fn is_running(&self) -> bool {
        matches!(self.state, CacheState::Running)
    }

    /// The failure to show with the command: once, again only after a success.
    pub fn take_notice(
        &mut self,
        result: &Result<EnvPairs, LoginEnvError>,
    ) -> Option<LoginEnvError> {
        match result {
            Ok(_) => {
                self.reported = false;
                None
            }
            Err(e) if !self.reported => {
                self.reported = true;
                Some(e.clone())
            }
            Err(_) => None,
        }
    }

    pub fn last(&self) -> Option<&Attempt> {
        match &self.state {
            CacheState::Done { attempt, .. } => Some(attempt),
            _ => None,
        }
    }
}

static CACHE: Mutex<LoginCache> = Mutex::new(LoginCache::new());
static DONE: Condvar = Condvar::new();

fn lock() -> std::sync::MutexGuard<'static, LoginCache> {
    CACHE.lock().unwrap_or_else(|e| e.into_inner())
}

/// The login environment of `kind` (blocking – call from a worker thread). A read
/// that runs already (warm-up when the bar is shown) is waited for.
pub fn login_env(kind: &ShellKind, mode: LoginMode) -> Result<EnvPairs, LoginEnvError> {
    // the fallback may need two timeouts
    let deadline = Instant::now() + LOGIN_TIMEOUT * 2 + Duration::from_secs(1);
    let mut cache = lock();
    loop {
        match cache.begin(kind, mode, Instant::now()) {
            Step::Use(a) => return a.result,
            Step::Wait => {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    return Err(LoginEnvError::Timeout);
                }
                cache = DONE
                    .wait_timeout(cache, left)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
            Step::Run => {
                drop(cache);
                let attempt = read_with_fallback(kind, mode, LOGIN_TIMEOUT);
                #[cfg(debug_assertions)]
                eprintln!(
                    "login env ({}): {} after {} ms",
                    attempt.mode.code(),
                    attempt.result.as_ref().err().map_or("ok", |e| e.code()),
                    attempt.duration.as_millis()
                );
                let result = attempt.result.clone();
                lock().finish(kind, mode, attempt, Instant::now());
                DONE.notify_all();
                return result;
            }
        }
    }
}

/// See [`LoginCache::take_notice`].
pub fn take_notice(result: &Result<EnvPairs, LoginEnvError>) -> Option<LoginEnvError> {
    lock().take_notice(result)
}

/// The last finished read (for the status action) and whether one runs now.
pub fn last_attempt() -> (Option<Attempt>, bool) {
    let c = lock();
    (c.last().cloned(), c.is_running())
}

// ---- PATH of a command ----

const SEP: char = ':';

/// login PATH > `fallback` (only existing folders) > app PATH; no duplicates, no
/// empty entries.
pub fn merge_path(
    login: Option<&str>,
    fallback: &[PathBuf],
    app: &str,
    exists: impl Fn(&Path) -> bool,
) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut add = |s: &str| {
        if !s.is_empty() && !out.iter().any(|o| o == s) {
            out.push(s.to_string());
        }
    };
    for s in login.unwrap_or("").split(SEP) {
        add(s);
    }
    for p in fallback {
        if let Some(s) = p.to_str()
            && !s.contains(SEP)
            && exists(p)
        {
            add(s);
        }
    }
    for s in app.split(SEP) {
        add(s);
    }
    out.join(&SEP.to_string())
}

/// `path_helper -s` output (`PATH="a:b"; export PATH;`) → its entries.
pub fn parse_path_helper(out: &str) -> Vec<PathBuf> {
    out.lines()
        .filter_map(|l| l.trim().strip_prefix("PATH=\""))
        .filter_map(|rest| rest.split_once('"').map(|(v, _)| v))
        .flat_map(|v| v.split(SEP))
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .collect()
}

/// Standard places for programs when the login shell is not read (or misses them).
pub fn fallback_dirs(macos: bool, home: Option<&Path>, path_helper: &[PathBuf]) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    if macos {
        v.extend(path_helper.iter().cloned());
        for p in ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"] {
            v.push(PathBuf::from(p));
        }
        if let Some(h) = home {
            v.push(h.join(".cargo").join("bin"));
        }
    } else if let Some(h) = home {
        v.push(h.join(".local").join("bin"));
        v.push(h.join(".cargo").join("bin"));
    }
    v
}

/// The entries of `/etc/paths` and `/etc/paths.d` (macOS, read once).
fn system_paths() -> &'static [PathBuf] {
    static PATHS: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();
    PATHS.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("/usr/libexec/path_helper")
                .arg("-s")
                .env_clear()
                .stdin(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| parse_path_helper(&String::from_utf8_lossy(&o.stdout)))
                .unwrap_or_default()
        }
        #[cfg(not(target_os = "macos"))]
        {
            Vec::new()
        }
    })
}

/// The environment a shell command gets: the wanted login pairs, `PATH` merged.
pub fn launch_env(login: Option<&EnvPairs>) -> EnvPairs {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let fallback = fallback_dirs(cfg!(target_os = "macos"), home.as_deref(), system_paths());
    let app = std::env::var("PATH").unwrap_or_default();
    build_env(login, &fallback, &app, |p| p.is_dir())
}

/// Pure part of [`launch_env`].
pub fn build_env(
    login: Option<&EnvPairs>,
    fallback: &[PathBuf],
    app_path: &str,
    exists: impl Fn(&Path) -> bool,
) -> EnvPairs {
    let login_path = login
        .and_then(|l| l.iter().find(|(k, _)| k == "PATH"))
        .map(|(_, v)| v.as_str());
    let mut env: EnvPairs = login
        .map(|l| l.iter().filter(|(k, _)| k != "PATH").cloned().collect())
        .unwrap_or_default();
    env.push((
        "PATH".to_string(),
        merge_path(login_path, fallback, app_path, exists),
    ));
    env
}
