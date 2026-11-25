//! Job `download` (design 078): one yt-dlp process per URL, one after the other, in the
//! target folder. The arguments come from [`crate::url_download::args`], the programs
//! from the [`DownloadEnv`] Rust resolved – nothing here comes from the frontend but
//! the checked URLs, the target folder and the typed options.
//!
//! - The process runs without a shell, in its own process group; cancel ends the whole
//!   group (yt-dlp starts `ffmpeg` as a child).
//! - Output is hostile: only lines with this process's marker are read
//!   ([`crate::url_download::progress`]); nothing of it is logged or sent on as text,
//!   except the cleaned last error line of a failed URL and the cleaned title.
//! - Files yt-dlp reports are kept only when they lie in the target folder.
//! - `.part` files stay after a cancel or an error: the next try resumes them.

use super::{Control, ItemError, JobEvent, JobState, Phase, Progress, Summary};
use crate::error::{FsError, FsErrorCode};
use crate::platform::process::{GroupChild, spawn_group};
use crate::shell::text::Decoder;
use crate::tools::spawn_error;
use crate::url_download::args::{self, Mode};
use crate::url_download::progress::{self, ErrorLine, Line, LineSplitter};
use crate::url_download::{DownloadEnv, DownloadOptions, urls};
use serde::Serialize;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// After SIGTERM, SIGKILL follows after this.
pub const KILL_GRACE: Duration = Duration::from_secs(1);
/// After yt-dlp ended, how long children that still hold the pipes are waited for.
pub const LINGER: Duration = Duration::from_millis(500);
/// After a cancel, how long the job waits for the group to be gone.
pub const REAP: Duration = Duration::from_secs(3);
/// Result files listed in the summary (`file_count` has the full number).
pub const MAX_REPORTED_FILES: usize = 500;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const READ_BLOCK: usize = 8 * 1024;
const CHANNEL_BLOCKS: usize = 16;

/// Where the job gets programs, environment and presets from when it starts.
pub type EnvProvider = std::sync::Arc<dyn Fn() -> DownloadEnv + Send + Sync>;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSummary {
    /// The first [`MAX_REPORTED_FILES`] files that arrived (full paths in the target folder).
    pub files: Vec<String>,
    pub file_count: u64,
    /// Files that were there already (not downloaded again).
    pub present: u64,
}

fn failed(e: FsError) -> (JobState, Summary) {
    (
        JobState::Failed,
        Summary {
            error: Some(e),
            ..Summary::default()
        },
    )
}

/// The target must be an existing local folder we may write into (design 078 §3).
pub fn check_target(target: &str) -> Result<PathBuf, FsError> {
    if crate::remote::is_remote(target) {
        return Err(FsError::at(
            FsErrorCode::RemoteUnsupported,
            "Downloads go to a local folder",
            target,
        ));
    }
    let path = crate::paths::validate_job_path(target)?;
    let meta = std::fs::metadata(&path).map_err(|e| FsError::from_io(&e, &path))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "The target is not a folder",
            Some(&path),
        ));
    }
    if !writable(&path, &meta) {
        return Err(FsError::new(
            FsErrorCode::PermissionDenied,
            "The target folder cannot be written to",
            Some(&path),
        ));
    }
    Ok(path)
}

#[cfg(unix)]
fn writable(path: &Path, _meta: &std::fs::Metadata) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `c` is a valid NUL-terminated path.
    unsafe { libc::access(c.as_ptr(), libc::W_OK | libc::X_OK) == 0 }
}

#[cfg(not(unix))]
fn writable(_path: &Path, meta: &std::fs::Metadata) -> bool {
    !meta.permissions().readonly()
}

/// A path yt-dlp reported → the path in the target folder, `None` when it lies outside
/// (or is the folder itself). Lexical: yt-dlp prints paths relative to its working
/// folder (the target) or absolute ones – those may name the folder by its physical
/// path (`canon`, e.g. `/private/var/…` for `/var/…` on macOS).
pub fn inside_target(target: &Path, canon: Option<&Path>, reported: &str) -> Option<PathBuf> {
    let p = Path::new(reported);
    if p.components().any(|c| c == Component::ParentDir) {
        return None;
    }
    let target = crate::paths::normalize_lexically(target);
    let abs = if p.is_absolute() {
        crate::paths::normalize_lexically(p)
    } else {
        crate::paths::normalize_lexically(&target.join(p))
    };
    if abs != target && abs.starts_with(&target) {
        return Some(abs);
    }
    let rest = abs.strip_prefix(canon?).ok()?;
    (!rest.as_os_str().is_empty()).then(|| target.join(rest))
}

enum Msg {
    Out(Vec<u8>),
    Err(Vec<u8>),
    Eof,
}

fn reader(
    wrap: fn(Vec<u8>) -> Msg,
    mut pipe: impl Read + Send + 'static,
    tx: mpsc::SyncSender<Msg>,
) {
    let _ = std::thread::Builder::new()
        .name("fnf-download-pipe".into())
        .spawn(move || {
            let mut buf = vec![0u8; READ_BLOCK];
            let mut done = false;
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        // keep reading (and dropping) until EOF: a closed pipe would kill
                        // the writer with SIGPIPE
                        if !done && tx.send(wrap(buf[..n].to_vec())).is_err() {
                            done = true;
                        }
                    }
                }
            }
            let _ = tx.send(Msg::Eof);
        });
}

/// The program with its arguments, working folder and environment – no shell.
pub fn build_command(program: &Path, args: &[String], target: &Path, env: &DownloadEnv) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(target);
    for (k, v) in &env.env {
        cmd.env(k, v);
    }
    // an app started from the Finder has no locale: yt-dlp would drop every non-ASCII
    // character of a title
    cmd.env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8");
    cmd
}

/// What one URL came to.
#[derive(Debug, Default)]
struct Outcome {
    ok: bool,
    cancelled: bool,
    /// (`false` = was there already, path as reported)
    files: Vec<(Option<bool>, String)>,
    bytes: u64,
    error: Option<String>,
    spawn: Option<FsError>,
}

struct Live<'a> {
    id: &'a str,
    emit: &'a (dyn Fn(JobEvent) + Send + Sync),
    progress: Progress,
    last: Option<Instant>,
}

impl Live<'_> {
    fn send(&mut self, force: bool) {
        if force || self.last.is_none_or(|t| t.elapsed() >= PROGRESS_INTERVAL) {
            self.last = Some(Instant::now());
            (self.emit)(JobEvent::Progress {
                id: self.id.to_string(),
                progress: self.progress.clone(),
            });
        }
    }
}

fn handle(line: Line, out: &mut Outcome, live: &mut Live<'_>) {
    match line {
        Line::Item { .. } => {
            live.progress.phase = Some(Phase::Downloading);
            live.progress.bytes_done = 0;
            live.progress.bytes_total = 0;
            live.progress.rate_bps = 0;
            live.send(true);
        }
        Line::Download {
            finished,
            done,
            total,
            speed,
        } => {
            let done = done.unwrap_or(0);
            live.progress.phase = Some(Phase::Downloading);
            live.progress.bytes_done = done;
            // an estimate may lie below what has arrived
            live.progress.bytes_total = total.map_or(0, |t| t.max(done));
            live.progress.rate_bps = speed.unwrap_or(0);
            if finished {
                out.bytes = out.bytes.saturating_add(total.unwrap_or(done).max(done));
            }
            live.send(finished);
        }
        Line::Post { finished } => {
            if !finished && live.progress.phase != Some(Phase::Processing) {
                live.progress.phase = Some(Phase::Processing);
                live.progress.rate_bps = 0;
                live.send(true);
            }
        }
        Line::File { real, path } => {
            if out.files.len() < 100_000 {
                out.files.push((real, path));
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_one(
    program: &Path,
    url: &str,
    target: &Path,
    options: &DownloadOptions,
    env: &DownloadEnv,
    control: &Control,
    live: &mut Live<'_>,
) -> Result<Outcome, FsError> {
    let marker = crate::shell::env::new_marker();
    let args = args::build(options, env, Mode::Job { marker: &marker }, url)?;
    let cmd = build_command(program, &args, target, env);
    let mut out = Outcome::default();
    let mut g: GroupChild = match spawn_group(cmd) {
        Ok(g) => g,
        Err(e) => {
            out.spawn = Some(spawn_error(&e, "yt-dlp"));
            return Ok(out);
        }
    };
    let (tx, rx) = mpsc::sync_channel(CHANNEL_BLOCKS);
    if let Some(o) = g.child.stdout.take() {
        reader(Msg::Out, o, tx.clone());
    }
    if let Some(e) = g.child.stderr.take() {
        reader(Msg::Err, e, tx.clone());
    }
    drop(tx);

    let (mut dec_out, mut dec_err) = (Decoder::default(), Decoder::default());
    let (mut split_out, mut split_err) = (LineSplitter::default(), LineSplitter::default());
    let mut error = ErrorLine::default();
    let mut open_pipes = 2;
    let mut status = None;
    let mut exited_at: Option<Instant> = None;
    let mut term_at: Option<Instant> = None;
    let mut killed = false;
    // a protocol line may arrive on either stream; what is not ours on stderr may be the reason
    let mut on_out = |text: &str, out: &mut Outcome, live: &mut Live<'_>| {
        split_out.push(text, |l| {
            if let Some(line) = progress::parse(&marker, l) {
                handle(line, out, live);
            }
        });
    };
    let mut on_err = |text: &str, out: &mut Outcome, live: &mut Live<'_>| {
        split_err.push(text, |l| match progress::parse(&marker, l) {
            Some(line) => handle(line, out, live),
            None => error.push(l),
        });
    };
    loop {
        if control.is_cancelled() && term_at.is_none() {
            g.terminate();
            term_at = Some(Instant::now());
        }
        if let Some(t) = term_at
            && !killed
            && t.elapsed() >= KILL_GRACE
        {
            g.kill();
            killed = true;
        }
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(Msg::Out(bytes)) => on_out(&dec_out.push(&bytes), &mut out, live),
            Ok(Msg::Err(bytes)) => on_err(&dec_err.push(&bytes), &mut out, live),
            Ok(Msg::Eof) => open_pipes -= 1,
            Err(mpsc::RecvTimeoutError::Disconnected) => open_pipes = 0,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if status.is_none()
            && let Ok(Some(s)) = g.child.try_wait()
        {
            status = Some(s);
            exited_at = Some(Instant::now());
        }
        if let Some(t) = exited_at
            && (open_pipes == 0 || t.elapsed() >= LINGER)
        {
            break;
        }
    }
    let cancelled = control.is_cancelled();
    if !cancelled {
        // what already arrived (at most CHANNEL_BLOCKS)
        loop {
            match rx.try_recv() {
                Ok(Msg::Out(bytes)) => on_out(&dec_out.push(&bytes), &mut out, live),
                Ok(Msg::Err(bytes)) => on_err(&dec_err.push(&bytes), &mut out, live),
                Ok(Msg::Eof) => {}
                Err(_) => break,
            }
        }
        on_out(&(dec_out.finish() + "\n"), &mut out, live);
        on_err(&(dec_err.finish() + "\n"), &mut out, live);
    }
    // nothing of ours runs on: whatever is left of the group ends now (after a cancel
    // these are the children that survived SIGTERM)
    g.kill();
    if cancelled {
        let deadline = Instant::now() + REAP;
        while g.group_alive() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    out.cancelled = cancelled;
    out.ok = !cancelled && status.is_some_and(|s| s.success());
    if !out.ok && !cancelled {
        out.error = error.take();
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    urls_in: &[String],
    target_dir: &str,
    options: &DownloadOptions,
    env: &DownloadEnv,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let Some(program) = env.yt_dlp.clone() else {
        return failed(FsError::new(
            FsErrorCode::DownloadToolMissing,
            "yt-dlp was not found",
            None,
        ));
    };
    let target = match check_target(target_dir) {
        Ok(t) => t,
        Err(e) => return failed(e),
    };
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let mut live = Live {
        id,
        emit,
        progress: Progress {
            items_total: urls_in.len() as u64,
            ..Progress::default()
        },
        last: None,
    };
    let mut summary = Summary::default();
    let mut dl = DownloadSummary::default();
    let mut cancelled = false;
    let canon = std::fs::canonicalize(&target).ok();
    for (i, url) in urls_in.iter().enumerate() {
        if control.is_cancelled() {
            cancelled = true;
            break;
        }
        live.progress.items_done = i as u64;
        live.progress.current = Some(urls::display(url));
        live.progress.phase = Some(Phase::Downloading);
        live.progress.bytes_done = 0;
        live.progress.bytes_total = 0;
        live.progress.rate_bps = 0;
        live.send(true);
        let out = match run_one(&program, url, &target, options, env, control, &mut live) {
            Ok(o) => o,
            // the options or the preset are not valid (any more): nothing can run
            Err(e) => return failed(e),
        };
        if let Some(e) = out.spawn {
            // yt-dlp itself does not start: the other URLs would fail the same way
            let e = if e.code == FsErrorCode::ProgramNotFound {
                FsError::new(FsErrorCode::DownloadToolMissing, e.message, None)
            } else {
                e
            };
            return failed(e);
        }
        summary.bytes_done = summary.bytes_done.saturating_add(out.bytes);
        let mut arrived = 0u64;
        let mut present = 0u64;
        for (real, reported) in &out.files {
            // a path outside the target is not ours to show (and never to act on)
            let Some(path) = inside_target(&target, canon.as_deref(), reported) else {
                continue;
            };
            arrived += 1;
            if *real == Some(false) {
                present += 1;
            }
            dl.file_count += 1;
            if dl.files.len() < MAX_REPORTED_FILES {
                dl.files.push(path.to_string_lossy().into_owned());
            }
        }
        dl.present += present;
        emit(JobEvent::DirsChanged {
            dirs: vec![target.to_string_lossy().into_owned()],
        });
        if out.cancelled {
            cancelled = true;
            break;
        }
        if out.ok {
            if arrived > 0 && arrived == present {
                summary.items_skipped += 1;
            } else {
                summary.items_done += 1;
            }
        } else {
            summary.items_failed += 1;
            let error = ItemError {
                path: url.clone(),
                error: FsError::at(
                    FsErrorCode::DownloadFailed,
                    out.error.unwrap_or_default(),
                    url,
                ),
            };
            emit(JobEvent::ItemFailed {
                id: id.to_string(),
                error: error.clone(),
            });
            if summary.errors.len() < super::MAX_REPORTED_ERRORS {
                summary.errors.push(error);
            }
        }
        live.progress.items_done = i as u64 + 1;
    }
    live.progress.current = None;
    live.progress.phase = None;
    live.progress.bytes_done = 0;
    live.progress.bytes_total = 0;
    live.progress.rate_bps = 0;
    live.send(true);
    summary.download = Some(dl);
    let state = if cancelled {
        JobState::Cancelled
    } else if summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, summary)
}
