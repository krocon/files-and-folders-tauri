//! Shell bar (design 021): the pure parts – which shell runs a command, what is
//! handled without a shell (`cd`, `clear`), quoting of inserted names, output
//! cleaning, the login environment and the history file. No Tauri here; the job
//! is `jobs/shell.rs`, processes are `platform/process.rs`, commands `commands/shell.rs`.
//!
//! Security (design 021 E1): the command string only ever comes from the shell
//! field of the frontend via `run_shell`; it is passed as **one** argument to the
//! shell and never combined with paths or names here.

pub mod env;
pub mod history;
pub mod quote;
pub mod text;

use crate::error::{FsError, FsErrorCode};
use crate::paths::normalize_lexically;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

/// Longest command line accepted (bytes).
pub const MAX_COMMAND_BYTES: usize = 32 * 1024;

/// POSIX shells whose quoting rules we know (design 021 E4); others → `/bin/sh`.
const KNOWN_POSIX: [&str; 8] = ["sh", "bash", "zsh", "dash", "ksh", "mksh", "fish", "yash"];

/// The shell a command runs in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellKind {
    /// `<program> -c <command>`; `fish` has its own quoting inside `'…'`.
    Posix { program: PathBuf, fish: bool },
    /// `cmd.exe /D /S /C "<command>"`.
    Cmd { program: PathBuf },
    /// `pwsh`/`powershell -NoLogo -NoProfile -NonInteractive -Command <command>`.
    PowerShell { program: PathBuf },
}

impl Default for ShellKind {
    fn default() -> Self {
        ShellKind::Posix {
            program: PathBuf::from("/bin/sh"),
            fish: false,
        }
    }
}

impl ShellKind {
    pub fn program(&self) -> &Path {
        match self {
            ShellKind::Posix { program, .. }
            | ShellKind::Cmd { program }
            | ShellKind::PowerShell { program } => program,
        }
    }

    pub fn is_windows_style(&self) -> bool {
        !matches!(self, ShellKind::Posix { .. })
    }
}

/// macOS/Linux: `$SHELL` if it is a known POSIX shell and `usable` says it can be
/// run, else `/bin/sh`.
pub fn choose_posix(shell_env: Option<&OsStr>, usable: impl Fn(&Path) -> bool) -> ShellKind {
    if let Some(s) = shell_env {
        let p = Path::new(s);
        let base = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if p.is_absolute() && KNOWN_POSIX.contains(&base) && usable(p) {
            return ShellKind::Posix {
                program: p.to_path_buf(),
                fish: base == "fish",
            };
        }
    }
    ShellKind::default()
}

/// The shell of this platform; `windows_shell` is the setting `shell.windowsShell`.
pub fn choose(windows_shell: &str) -> ShellKind {
    #[cfg(windows)]
    {
        let system = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32");
        if windows_shell == "powershell" {
            let program = find_in_path("pwsh.exe").unwrap_or_else(|| {
                system
                    .join("WindowsPowerShell")
                    .join("v1.0")
                    .join("powershell.exe")
            });
            return ShellKind::PowerShell { program };
        }
        let program = std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| system.join("cmd.exe"));
        ShellKind::Cmd { program }
    }
    #[cfg(not(windows))]
    {
        let _ = windows_shell;
        choose_posix(std::env::var_os("SHELL").as_deref(), is_executable)
    }
}

#[cfg(windows)]
fn find_in_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

/// PowerShell: UTF-8 output instead of the OEM code page (design 021 E5).
pub const POWERSHELL_PREFIX: &str = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ";

/// The raw command line after `cmd.exe` (`/S` strips exactly the outer quotes,
/// so the command stays as typed).
pub fn cmd_raw_args(command: &str) -> String {
    format!("/D /S /C \"{command}\"")
}

/// Arguments for `program` (Windows `cmd` uses [`cmd_raw_args`] via `raw_arg`).
pub fn shell_args(kind: &ShellKind, command: &str) -> Vec<String> {
    match kind {
        ShellKind::Posix { .. } => vec!["-c".into(), command.into()],
        ShellKind::Cmd { .. } => Vec::new(),
        ShellKind::PowerShell { .. } => vec![
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            format!("{POWERSHELL_PREFIX}{command}"),
        ],
    }
}

/// Environment changes for every command (design 021 E4): no pager, no colours.
pub const ENV_SET: [(&str, &str); 4] = [
    ("TERM", "dumb"),
    ("NO_COLOR", "1"),
    ("PAGER", "cat"),
    ("GIT_PAGER", "cat"),
];
pub const ENV_REMOVE: [&str; 2] = ["CLICOLOR", "CLICOLOR_FORCE"];

/// Checks the typed command: not empty, not too long, one line, no NUL.
pub fn validate_command(command: &str) -> Result<&str, FsError> {
    let invalid = |m: &str| FsError::new(FsErrorCode::InvalidCommand, m, None);
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(invalid("The command is empty"));
    }
    if command.len() > MAX_COMMAND_BYTES {
        return Err(invalid("The command is too long"));
    }
    if command.contains(['\n', '\r', '\0']) {
        return Err(invalid("The command must be a single line"));
    }
    Ok(trimmed)
}

/// What the shell bar does itself instead of starting a shell (design 021 E11).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Builtin {
    /// `cd` (`None` = home).
    Cd { target: Option<String> },
    /// `cd -`: back in the panel history.
    CdBack,
    /// `clear` / `cls`: empty the output.
    Clear,
}

/// Characters that make an argument something only the shell can interpret.
const SPECIAL: &[char] = &[
    ';', '&', '|', '<', '>', '$', '`', '*', '?', '(', ')', '{', '}', '[', ']', '!', '"', '\'', '%',
    '^', '#',
];

/// Recognises a line that is exactly `cd` with at most one plain or fully quoted
/// argument (or `clear`/`cls`). Everything else goes to the shell – `cd x && make`
/// changes nothing in the panel, as in a real shell.
pub fn parse_builtin(line: &str, windows: bool) -> Option<Builtin> {
    let line = line.trim();
    let eq = |a: &str, b: &str| {
        if windows {
            a.eq_ignore_ascii_case(b)
        } else {
            a == b
        }
    };
    if eq(line, "clear") || eq(line, "cls") {
        return Some(Builtin::Clear);
    }
    if windows && is_drive(line) {
        return Some(Builtin::Cd {
            target: Some(format!("{line}\\")),
        });
    }
    // cmd.exe also takes `cd..` and `cd\` without a space
    let glued = windows
        && line.len() > 2
        && line.is_char_boundary(2)
        && line[..2].eq_ignore_ascii_case("cd")
        && line[2..].starts_with(['.', '\\']);
    let (word, rest) = if glued {
        (&line[..2], line[2..].trim())
    } else {
        match line.find(char::is_whitespace) {
            Some(i) => (&line[..i], line[i..].trim()),
            None => (line, ""),
        }
    };
    if !(eq(word, "cd") || (windows && eq(word, "chdir"))) {
        return None;
    }
    let mut rest = rest;
    if windows
        && let Some(r) = rest.strip_prefix("/d").or_else(|| rest.strip_prefix("/D"))
        && (r.is_empty() || r.starts_with(char::is_whitespace))
    {
        rest = r.trim();
    }
    if !windows && (rest == "--" || rest.starts_with("-- ")) {
        rest = rest[2..].trim();
    }
    if rest.is_empty() {
        return Some(Builtin::Cd { target: None });
    }
    if rest == "-" {
        return Some(Builtin::CdBack);
    }
    let quotes: &[char] = if windows { &['"'] } else { &['"', '\''] };
    for &q in quotes {
        if rest.len() >= 2 && rest.starts_with(q) && rest.ends_with(q) {
            let inner = &rest[1..rest.len() - 1];
            // a quoted `~…` is a literal name in a shell – let the shell do it
            if inner.contains(q) || inner.is_empty() || inner.starts_with('~') {
                return None;
            }
            // inside "…" a POSIX shell still expands `$`, `` ` `` and `\`
            if q == '"' && !windows && inner.contains(['$', '`', '\\']) {
                return None;
            }
            return Some(Builtin::Cd {
                target: Some(inner.to_string()),
            });
        }
    }
    if rest.contains(char::is_whitespace) || rest.contains(SPECIAL) {
        return None;
    }
    // `~user` is another user's home: the shell knows it
    if rest.starts_with('~') && rest != "~" && !rest.starts_with("~/") && !rest.starts_with("~\\") {
        return None;
    }
    // a backslash escapes in POSIX shells: let the shell decide
    if !windows && rest.contains('\\') {
        return None;
    }
    Some(Builtin::Cd {
        target: Some(rest.to_string()),
    })
}

fn is_drive(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

/// Resolves a `cd` target against the working folder (lexically, no `canonicalize`)
/// and checks that it is a folder.
pub fn resolve_cd(
    cwd: &Path,
    target: Option<&str>,
    home: Option<&Path>,
) -> Result<PathBuf, FsError> {
    let need_home = || {
        home.map(Path::to_path_buf)
            .ok_or_else(|| FsError::new(FsErrorCode::NoHomeDirectory, "No home directory", None))
    };
    let path = match target {
        None | Some("~") => need_home()?,
        Some(t) => {
            let rest = t.strip_prefix("~/").or_else(|| {
                if cfg!(windows) {
                    t.strip_prefix("~\\")
                } else {
                    None
                }
            });
            match rest {
                Some(r) => need_home()?.join(r),
                None => {
                    let p = Path::new(t);
                    if p.is_absolute() {
                        p.to_path_buf()
                    } else {
                        cwd.join(p)
                    }
                }
            }
        }
    };
    let path = normalize_lexically(&path);
    let meta = fs::metadata(&path).map_err(|e| FsError::from_io(&e, &path))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "Not a folder",
            Some(&path),
        ));
    }
    Ok(path)
}

/// The working folder: absolute, an existing real folder (archive paths are virtual
/// and fail here).
pub fn check_cwd(cwd: &str) -> Result<PathBuf, FsError> {
    let p = crate::paths::validate_input_path(cwd)?;
    let meta = fs::metadata(&p).map_err(|e| FsError::from_io(&e, &p))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "Not a folder",
            Some(&p),
        ));
    }
    Ok(p)
}

#[cfg(test)]
mod tests;
