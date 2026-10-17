//! "Show in Finder/Explorer/file manager" and "Terminal here" (design 011 E2).
//! Narrow functions with one signature per OS; the path is validated by the
//! command layer. Programs get argument arrays – nothing goes to a shell.

use crate::error::{FsError, FsErrorCode};
use crate::tools::{ProgramSpec, ResolvedContext, expand, spawn_detached, spawn_error};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Opens the system file manager with `path` selected.
pub fn reveal(path: &Path) -> Result<(), FsError> {
    reveal_impl(path)
}

/// Opens a terminal in `dir` – `custom` (from `tools.json`, `{dir}` allowed) or the OS default.
pub fn open_terminal(dir: &Path, custom: Option<&ProgramSpec>) -> Result<(), FsError> {
    if let Some(spec) = custom {
        let ctx = ResolvedContext {
            dir: Some(dir.to_path_buf()),
            ..ResolvedContext::default()
        };
        let mut cmd = Command::new(&spec.program);
        for a in &spec.args {
            cmd.arg(expand(a, None, &ctx)?);
        }
        cmd.current_dir(dir);
        return spawn_detached(cmd, &spec.program);
    }
    terminal_impl(dir)
}

/// `file://` URI with everything but unreserved characters and `/` percent-encoded
/// (also `,` – `dbus-send` splits arrays at commas).
pub fn file_uri(path: &Path) -> String {
    #[cfg(unix)]
    let bytes = {
        use std::os::unix::ffi::OsStrExt;
        path.as_os_str().as_bytes().to_vec()
    };
    #[cfg(not(unix))]
    let bytes = path.to_string_lossy().replace('\\', "/").into_bytes();
    let mut out = String::from("file://");
    for b in bytes {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Looks `name` up in `path_var` (like the shell would, without a shell).
pub fn find_in_path(name: &str, path_var: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.is_absolute() {
        return std::fs::symlink_metadata(candidate)
            .is_ok()
            .then(|| candidate.to_path_buf());
    }
    std::env::split_paths(path_var?)
        .map(|d| d.join(name))
        // symlink_metadata: Windows app execution aliases (wt.exe) are reparse points
        .find(|p| std::fs::symlink_metadata(p).is_ok_and(|m| !m.is_dir()))
}

/// Arguments that make a known terminal start in `dir` (besides `current_dir`).
pub fn terminal_args(program: &str, dir: &Path) -> Vec<OsString> {
    let name = Path::new(program)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let joined = |flag: &str| {
        let mut a = OsString::from(flag);
        a.push(dir);
        vec![a]
    };
    let pair = |flag: &str| vec![OsString::from(flag), dir.as_os_str().to_os_string()];
    match name.as_str() {
        "gnome-terminal" | "mate-terminal" | "xfce4-terminal" | "kgx" | "ptyxis" | "foot"
        | "terminator" => joined("--working-directory="),
        "konsole" => pair("--workdir"),
        "tilix" => pair("-w"),
        "alacritty" => pair("--working-directory"),
        "kitty" => pair("--directory"),
        "wezterm" => {
            let mut a = vec![OsString::from("start")];
            a.extend(pair("--cwd"));
            a
        }
        _ => Vec::new(), // x-terminal-emulator, xterm, $TERMINAL …: current_dir only
    }
}

/// Linux terminals to try, in order (design 011 E2): `$TERMINAL`, the Debian
/// alternative, the desktop's own, then common ones.
pub fn linux_terminals(desktop: &str, env_terminal: Option<&str>) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    if let Some(t) = env_terminal.map(str::trim).filter(|t| !t.is_empty()) {
        list.push(t.to_string());
    }
    list.push("x-terminal-emulator".into());
    let d = desktop.to_ascii_lowercase();
    let own: &[&str] = if d.contains("kde") {
        &["konsole"]
    } else if d.contains("gnome") || d.contains("unity") || d.contains("ubuntu") {
        &["kgx", "ptyxis", "gnome-terminal"]
    } else if d.contains("xfce") {
        &["xfce4-terminal"]
    } else if d.contains("mate") {
        &["mate-terminal"]
    } else {
        &[]
    };
    list.extend(own.iter().map(|s| s.to_string()));
    for t in [
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "mate-terminal",
        "tilix",
        "terminator",
        "alacritty",
        "kitty",
        "wezterm",
        "foot",
        "xterm",
    ] {
        if !list.iter().any(|l| l == t) {
            list.push(t.into());
        }
    }
    list
}

/// Windows: Windows Terminal unless the path contains `;` – `wt` treats `;` as a
/// command separator even inside an argument, a folder name could start other commands.
/// Returns (program, args, needs a new console).
pub fn windows_terminal_plan(dir: &Path, wt_available: bool) -> (String, Vec<OsString>, bool) {
    if wt_available && !dir.to_string_lossy().contains(';') {
        (
            "wt.exe".into(),
            vec![OsString::from("-d"), dir.as_os_str().to_os_string()],
            false,
        )
    } else {
        ("cmd.exe".into(), Vec::new(), true)
    }
}

#[cfg(target_os = "macos")]
fn not_started(program: &str, status: std::process::ExitStatus) -> FsError {
    FsError::new(
        FsErrorCode::Io,
        format!("\"{program}\" failed ({status})"),
        None,
    )
}

// ---- macOS ----

#[cfg(target_os = "macos")]
fn reveal_impl(path: &Path) -> Result<(), FsError> {
    let status = Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| spawn_error(&e, "open"))?;
    if status.success() {
        Ok(())
    } else {
        Err(not_started("open -R", status))
    }
}

#[cfg(target_os = "macos")]
fn terminal_impl(dir: &Path) -> Result<(), FsError> {
    let status = Command::new("open")
        .args(["-a", "Terminal"])
        .arg(dir)
        .status()
        .map_err(|e| spawn_error(&e, "open"))?;
    if status.success() {
        Ok(())
    } else {
        Err(not_started("open -a Terminal", status))
    }
}

// ---- Windows ----

#[cfg(windows)]
fn reveal_impl(path: &Path) -> Result<(), FsError> {
    use std::os::windows::process::CommandExt;
    let p = path.to_string_lossy();
    if p.contains('"') {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "The path contains a quote",
            Some(path),
        ));
    }
    // Explorer only understands `/select,"<path>"` as one raw argument;
    // its exit code is 1 even on success, so it is not checked.
    let mut cmd = Command::new("explorer.exe");
    cmd.raw_arg(format!("/select,\"{p}\""));
    spawn_detached(cmd, "explorer.exe")
}

#[cfg(windows)]
fn terminal_impl(dir: &Path) -> Result<(), FsError> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let path = std::env::var_os("PATH");
    let wt = find_in_path("wt.exe", path.as_deref()).is_some();
    let (program, args, new_console) = windows_terminal_plan(dir, wt);
    let mut cmd = Command::new(&program);
    cmd.args(&args).current_dir(dir);
    if new_console {
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    spawn_detached(cmd, &program)
}

// ---- Linux and other Unix ----

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_impl(path: &Path) -> Result<(), FsError> {
    // freedesktop FileManager1 (Nautilus, Dolphin, Nemo, Thunar …)
    let shown = Command::new("dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--reply-timeout=3000",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:{}", file_uri(path)))
        .arg("string:")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if shown {
        return Ok(());
    }
    // no FileManager1 service: open the parent folder with the default app
    let folder = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    open::that_detached(folder).map_err(|e| spawn_error(&e, "xdg-open"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn terminal_impl(dir: &Path) -> Result<(), FsError> {
    let path = std::env::var_os("PATH");
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let env_terminal = std::env::var("TERMINAL").ok();
    for name in linux_terminals(&desktop, env_terminal.as_deref()) {
        let Some(program) = find_in_path(&name, path.as_deref()) else {
            continue;
        };
        let mut cmd = Command::new(&program);
        cmd.args(terminal_args(&name, dir)).current_dir(dir);
        return spawn_detached(cmd, &name);
    }
    Err(FsError::new(
        FsErrorCode::ProgramNotFound,
        "No terminal program found (set \"terminal\" in tools.json or $TERMINAL)",
        None,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uris_are_percent_encoded() {
        assert_eq!(
            file_uri(Path::new("/a b/ä,c#?.txt")),
            "file:///a%20b/%C3%A4%2Cc%23%3F.txt"
        );
    }

    #[test]
    fn terminal_arguments_per_program() {
        let d = Path::new("/a b;c");
        let s = |v: Vec<OsString>| {
            v.into_iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            s(terminal_args("/usr/bin/gnome-terminal", d)),
            ["--working-directory=/a b;c"]
        );
        assert_eq!(s(terminal_args("konsole", d)), ["--workdir", "/a b;c"]);
        assert_eq!(s(terminal_args("wezterm", d)), ["start", "--cwd", "/a b;c"]);
        assert!(terminal_args("xterm", d).is_empty());
        assert!(terminal_args("x-terminal-emulator", d).is_empty());
    }

    #[test]
    fn linux_terminal_order() {
        let kde = linux_terminals("KDE", None);
        assert_eq!(&kde[..2], ["x-terminal-emulator", "konsole"]);
        let gnome = linux_terminals("ubuntu:GNOME", Some("alacritty"));
        assert_eq!(
            &gnome[..5],
            [
                "alacritty",
                "x-terminal-emulator",
                "kgx",
                "ptyxis",
                "gnome-terminal"
            ]
        );
        assert_eq!(gnome.iter().filter(|t| *t == "gnome-terminal").count(), 1);
        assert_eq!(
            linux_terminals("", Some("  ")).last().map(String::as_str),
            Some("xterm")
        );
    }

    #[test]
    fn windows_terminal_never_gets_a_semicolon() {
        let (p, a, nc) = windows_terminal_plan(Path::new("C:\\a b"), true);
        assert_eq!((p.as_str(), a.len(), nc), ("wt.exe", 2, false));
        let (p, a, nc) = windows_terminal_plan(Path::new("C:\\x; new-tab calc"), true);
        assert_eq!((p.as_str(), a.len(), nc), ("cmd.exe", 0, true));
        assert_eq!(
            windows_terminal_plan(Path::new("C:\\a"), false).0,
            "cmd.exe"
        );
    }

    #[test]
    fn path_lookup() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("myterm"), "").unwrap();
        std::fs::create_dir(dir.path().join("adir")).unwrap();
        let pv = std::env::join_paths([dir.path()]).unwrap();
        assert_eq!(
            find_in_path("myterm", Some(&pv)),
            Some(dir.path().join("myterm"))
        );
        assert_eq!(find_in_path("adir", Some(&pv)), None);
        assert_eq!(find_in_path("missing", Some(&pv)), None);
        assert_eq!(find_in_path("myterm", None), None);
    }

    #[test]
    fn a_custom_terminal_gets_the_folder_as_argument() {
        let dir = tempfile::tempdir().unwrap();
        let spec = ProgramSpec {
            program: "fnf-no-such-terminal-011".into(),
            args: vec!["--cwd={dir}".into()],
        };
        let e = open_terminal(dir.path(), Some(&spec)).unwrap_err();
        assert_eq!(e.code, FsErrorCode::ProgramNotFound);
    }
}
