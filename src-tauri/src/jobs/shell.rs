//! Shell job (design 021 E3): runs one command of the shell bar with pipes and
//! streams its output as `shellOutput` events – batched (≤ [`MAX_EVENT_BYTES`],
//! at least every [`FLUSH_INTERVAL`]) and flood-protected (beyond
//! [`WINDOW_BUDGET`] per [`WINDOW`] only the end is kept, `dropped` counts the
//! rest). Cancel ends the whole process group. Afterwards the working folder is
//! reported as changed (`dirsChanged`), so panels showing it reload.

use super::{Control, JobEvent, JobState, Summary};
use crate::platform::process::{GroupChild, spawn_group};
use crate::shell::text::{AnsiStripper, Decoder};
use crate::shell::{self, ShellKind};
use crate::tools::spawn_error;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const MAX_EVENT_BYTES: usize = 64 * 1024;
pub const FLUSH_INTERVAL: Duration = Duration::from_millis(50);
pub const WINDOW: Duration = Duration::from_millis(250);
pub const WINDOW_BUDGET: usize = 256 * 1024;
/// Bytes kept from the end of an over-budget window.
pub const TAIL_BYTES: usize = 64 * 1024;
/// After SIGTERM, SIGKILL follows after this.
pub const KILL_GRACE: Duration = Duration::from_secs(1);
/// After the shell ended, how long children that still hold the pipes are waited for.
pub const LINGER: Duration = Duration::from_millis(500);
const READ_BLOCK: usize = 8 * 1024;

/// How the command is started – decided by `run_shell`, never sent by the frontend.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ShellLaunch {
    pub kind: ShellKind,
    /// Taken over from the login shell (`PATH`, `LANG` …).
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellChunk {
    pub stream: ShellStream,
    pub text: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSummary {
    pub exit_code: Option<i32>,
    /// Unix: the signal that ended the shell.
    pub signal: Option<i32>,
}

/// The `Command` for `command` in `cwd` (the folder is never part of the command).
pub fn build_command(cwd: &Path, command: &str, launch: &ShellLaunch) -> Command {
    let mut cmd = Command::new(launch.kind.program());
    match &launch.kind {
        #[cfg(windows)]
        ShellKind::Cmd { .. } => {
            use std::os::windows::process::CommandExt;
            cmd.raw_arg(shell::cmd_raw_args(command));
        }
        kind => {
            cmd.args(shell::shell_args(kind, command));
        }
    }
    cmd.current_dir(cwd);
    for (k, v) in &launch.env {
        cmd.env(k, v);
    }
    for (k, v) in shell::ENV_SET {
        cmd.env(k, v);
    }
    for k in shell::ENV_REMOVE {
        cmd.env_remove(k);
    }
    cmd
}

enum Msg {
    Data(ShellStream, Vec<u8>),
    Eof,
}

fn reader(stream: ShellStream, mut pipe: impl Read + Send + 'static, tx: mpsc::Sender<Msg>) {
    let _ = std::thread::Builder::new()
        .name("fnf-shell-pipe".into())
        .spawn(move || {
            let mut buf = vec![0u8; READ_BLOCK];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(Msg::Data(stream, buf[..n].to_vec())).is_err() {
                            return; // the job is over
                        }
                    }
                }
            }
            let _ = tx.send(Msg::Eof);
        });
}

/// Collects cleaned text and decides what is sent when.
pub struct Batcher<'a> {
    id: &'a str,
    emit: &'a (dyn Fn(JobEvent) + Send + Sync),
    pending: Vec<ShellChunk>,
    pending_bytes: usize,
    last_flush: Instant,
    window_start: Instant,
    window_sent: usize,
    tail: VecDeque<ShellChunk>,
    tail_bytes: usize,
    dropped: u64,
}

impl<'a> Batcher<'a> {
    pub fn new(id: &'a str, emit: &'a (dyn Fn(JobEvent) + Send + Sync)) -> Self {
        let now = Instant::now();
        Self {
            id,
            emit,
            pending: Vec::new(),
            pending_bytes: 0,
            last_flush: now,
            window_start: now,
            window_sent: 0,
            tail: VecDeque::new(),
            tail_bytes: 0,
            dropped: 0,
        }
    }

    fn push_to(list: &mut Vec<ShellChunk>, stream: ShellStream, text: String) {
        match list.last_mut() {
            Some(last) if last.stream == stream => last.text.push_str(&text),
            _ => list.push(ShellChunk { stream, text }),
        }
    }

    pub fn add(&mut self, stream: ShellStream, text: String) {
        if text.is_empty() {
            return;
        }
        self.roll_window();
        if self.tail.is_empty() && self.window_sent + text.len() <= WINDOW_BUDGET {
            self.window_sent += text.len();
            self.pending_bytes += text.len();
            Self::push_to(&mut self.pending, stream, text);
        } else {
            // over budget: keep only the end of this window
            self.tail_bytes += text.len();
            match self.tail.back_mut() {
                Some(last) if last.stream == stream => last.text.push_str(&text),
                _ => self.tail.push_back(ShellChunk { stream, text }),
            }
            while self.tail_bytes > TAIL_BYTES {
                let excess = self.tail_bytes - TAIL_BYTES;
                let Some(front) = self.tail.front_mut() else {
                    break;
                };
                if front.text.len() <= excess {
                    let n = front.text.len();
                    self.tail.pop_front();
                    self.tail_bytes -= n;
                    self.dropped += n as u64;
                } else {
                    let mut cut = excess;
                    while !front.text.is_char_boundary(cut) {
                        cut += 1;
                    }
                    front.text.drain(..cut);
                    self.tail_bytes -= cut;
                    self.dropped += cut as u64;
                }
            }
        }
    }

    fn roll_window(&mut self) {
        if self.window_start.elapsed() < WINDOW {
            return;
        }
        self.window_start = Instant::now();
        self.window_sent = 0;
        self.move_tail();
    }

    fn move_tail(&mut self) {
        while let Some(c) = self.tail.pop_front() {
            self.pending_bytes += c.text.len();
            Self::push_to(&mut self.pending, c.stream, c.text);
        }
        self.tail_bytes = 0;
    }

    /// Sends what is due (`force`: everything, at the end).
    pub fn flush(&mut self, force: bool) {
        self.roll_window();
        if force {
            self.move_tail();
        }
        let due = force
            || self.pending_bytes >= MAX_EVENT_BYTES
            || (self.last_flush.elapsed() >= FLUSH_INTERVAL
                && (!self.pending.is_empty() || self.dropped > 0));
        if !due {
            return;
        }
        self.last_flush = Instant::now();
        let mut chunks = std::mem::take(&mut self.pending);
        self.pending_bytes = 0;
        loop {
            let mut event: Vec<ShellChunk> = Vec::new();
            let mut size = 0;
            while let Some(mut c) = (!chunks.is_empty()).then(|| chunks.remove(0)) {
                let room = MAX_EVENT_BYTES - size;
                if c.text.len() > room {
                    let mut cut = room;
                    while cut > 0 && !c.text.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    if cut == 0 {
                        // not even one character fits: next event
                        chunks.insert(0, c);
                        break;
                    }
                    let rest = c.text.split_off(cut);
                    chunks.insert(
                        0,
                        ShellChunk {
                            stream: c.stream,
                            text: rest,
                        },
                    );
                }
                size += c.text.len();
                if !c.text.is_empty() {
                    event.push(c);
                }
                if size >= MAX_EVENT_BYTES {
                    break;
                }
            }
            let dropped = std::mem::take(&mut self.dropped);
            if !event.is_empty() || dropped > 0 {
                (self.emit)(JobEvent::ShellOutput {
                    id: self.id.to_string(),
                    chunks: event,
                    dropped,
                });
            }
            if chunks.is_empty() {
                break;
            }
        }
    }
}

struct StreamText {
    decoder: Decoder,
    ansi: AnsiStripper,
}

impl StreamText {
    fn new() -> Self {
        Self {
            decoder: Decoder::default(),
            ansi: AnsiStripper::default(),
        }
    }

    fn push(&mut self, bytes: &[u8]) -> String {
        let text = self.decoder.push(bytes);
        self.ansi.push(&text)
    }

    fn finish(&mut self) -> String {
        let rest = self.decoder.finish();
        let mut out = self.ansi.push(&rest);
        out.push_str(&self.ansi.finish());
        out
    }
}

fn summary_of(status: Option<ExitStatus>) -> ShellSummary {
    let Some(status) = status else {
        return ShellSummary::default();
    };
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        status.signal()
    };
    #[cfg(not(unix))]
    let signal = None;
    ShellSummary {
        exit_code: status.code(),
        signal,
    }
}

pub fn run(
    id: &str,
    cwd: &str,
    command: &str,
    launch: &ShellLaunch,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let program = launch.kind.program().to_string_lossy().into_owned();
    let cmd = build_command(Path::new(cwd), command, launch);
    let mut g: GroupChild = match spawn_group(cmd) {
        Ok(g) => g,
        Err(e) => {
            return (
                JobState::Failed,
                Summary {
                    error: Some(spawn_error(&e, &program)),
                    ..Summary::default()
                },
            );
        }
    };
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let (tx, rx) = mpsc::channel();
    if let Some(out) = g.child.stdout.take() {
        reader(ShellStream::Stdout, out, tx.clone());
    }
    if let Some(err) = g.child.stderr.take() {
        reader(ShellStream::Stderr, err, tx.clone());
    }
    drop(tx);

    let mut batcher = Batcher::new(id, emit);
    let mut out = StreamText::new();
    let mut err = StreamText::new();
    let mut open_pipes = 2;
    let mut status: Option<ExitStatus> = None;
    let mut exited_at: Option<Instant> = None;
    let mut term_at: Option<Instant> = None;
    let mut killed = false;
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
            Ok(Msg::Data(stream, bytes)) => {
                let text = match stream {
                    ShellStream::Stdout => out.push(&bytes),
                    ShellStream::Stderr => err.push(&bytes),
                };
                batcher.add(stream, text);
            }
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
        batcher.flush(false);
        if let Some(t) = exited_at
            && (open_pipes == 0 || t.elapsed() >= LINGER)
        {
            break;
        }
    }
    // drain what already arrived
    while let Ok(Msg::Data(stream, bytes)) = rx.try_recv() {
        let text = match stream {
            ShellStream::Stdout => out.push(&bytes),
            ShellStream::Stderr => err.push(&bytes),
        };
        batcher.add(stream, text);
    }
    batcher.add(ShellStream::Stdout, out.finish());
    batcher.add(ShellStream::Stderr, err.finish());
    batcher.flush(true);
    let cancelled = control.is_cancelled();
    if cancelled {
        // children that survived SIGTERM of the group
        g.kill();
    }
    emit(JobEvent::DirsChanged {
        dirs: vec![cwd.to_string()],
    });
    let shell = summary_of(status);
    let state = if cancelled {
        JobState::Cancelled
    } else if shell.exit_code == Some(0) {
        JobState::Done
    } else {
        JobState::DoneWithErrors
    };
    (
        state,
        Summary {
            shell: Some(shell),
            ..Summary::default()
        },
    )
}
