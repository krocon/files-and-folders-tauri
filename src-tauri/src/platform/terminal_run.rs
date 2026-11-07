//! Runs one planned tool start in a visible terminal window that stays open afterwards
//! (design 072 E9). Terminals have no common way to take an argument array – Terminal.app
//! takes none at all – so Rust writes a small script next to nothing else: every word is
//! quoted here, names are never shell syntax, and the script removes itself when it runs.
//! The window then falls through to the user's shell (`cmd /K` on Windows).

use crate::error::{FsError, FsErrorCode};
use crate::tools::Invocation;
use std::ffi::OsString;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SCRIPT: AtomicU64 = AtomicU64::new(0);

/// A new file in the temp folder: never an existing one or a link (`create_new`), only for
/// this user on Unix.
fn write_script(contents: &[u8], extension: &str) -> io::Result<PathBuf> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let file = std::env::temp_dir().join(format!(
        "fnf-run-{}-{nanos}-{}.{extension}",
        std::process::id(),
        NEXT_SCRIPT.fetch_add(1, Ordering::Relaxed),
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o700);
    }
    options.open(&file)?.write_all(contents)?;
    Ok(file)
}

fn valid_env_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// `'…'`: nothing inside is special in a POSIX shell except `'` itself; works on raw bytes
/// (a Linux name need not be UTF-8).
#[cfg(unix)]
fn posix_quote(text: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    let mut out = vec![b'\''];
    for &b in text.as_bytes() {
        if b == b'\'' {
            out.extend_from_slice(b"'\\''");
        } else {
            out.push(b);
        }
    }
    out.push(b'\'');
    out
}

/// A word as it would be typed: plain when nothing in it is special, else [`posix_quote`].
#[cfg(unix)]
fn posix_word(text: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    let bytes = text.as_bytes();
    let plain = !bytes.is_empty()
        && !bytes.starts_with(b"=")
        && !bytes.starts_with(b"%")
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || b"_@%+=:,./-".contains(b));
    if plain {
        bytes.to_vec()
    } else {
        posix_quote(text)
    }
}

/// The script for `/bin/sh`: shows the command line (`$ node 'a b.js'`), runs it in the folder
/// and shows the exit code. Ctrl+C stops the program, not the script (a trap is reset in the
/// child): the window stays usable either way.
#[cfg(unix)]
pub fn posix_script(inv: &Invocation, env: &[(String, String)]) -> Vec<u8> {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let mut s = b"#!/bin/sh\nrm -f -- \"$0\"\n".to_vec();
    for (key, value) in env.iter().filter(|(k, _)| valid_env_name(k)) {
        s.extend_from_slice(format!("{key}=").as_bytes());
        s.extend(posix_quote(OsStr::new(value)));
        s.extend_from_slice(format!("\nexport {key}\n").as_bytes());
    }
    let mut line = posix_word(OsStr::new(&inv.program));
    for a in &inv.args {
        line.push(b' ');
        line.extend(posix_word(a));
    }
    let mut shown = b"$ ".to_vec();
    shown.extend_from_slice(&line);
    s.extend_from_slice(b"printf '%s\\n' ");
    s.extend(posix_quote(OsStr::from_bytes(&shown)));
    s.extend_from_slice(b"\ntrap : INT\n");
    if let Some(cwd) = &inv.cwd {
        s.extend_from_slice(b"cd -- ");
        s.extend(posix_quote(cwd.as_os_str()));
        s.extend_from_slice(b" && ");
    }
    s.extend(line);
    s.extend_from_slice(
        b"\ncode=$?\ntrap - INT\nprintf '\\n[exit code %s]\\n' \"$code\"\nexec \"${SHELL:-/bin/sh}\" -l\n",
    );
    s
}

fn unquotable(message: &str) -> FsError {
    FsError::new(FsErrorCode::UnquotableName, message, None)
}

/// A word for a batch file: `%` is doubled (the one escape that works in a file, not on the
/// `cmd /K` line); a `"` or a control character has no safe form and is refused.
fn batch_text(text: &std::ffi::OsStr) -> Result<String, FsError> {
    let text = text
        .to_str()
        .ok_or_else(|| unquotable("The name cannot be written to a batch file"))?;
    if text.chars().any(|c| c == '"' || c.is_control()) {
        return Err(unquotable(
            "A quote or a control character cannot be passed safely through cmd.exe",
        ));
    }
    Ok(text.replace('%', "%%"))
}

/// A quoted argument: backslashes before the closing quote would escape it for the program.
fn batch_arg(text: &std::ffi::OsStr) -> Result<String, FsError> {
    let body = batch_text(text)?;
    let trailing = body.len() - body.trim_end_matches('\\').len();
    Ok(format!("\"{body}{}\"", "\\".repeat(trailing)))
}

/// The batch file for `cmd /K` (UTF-8 after `chcp`). The last line deletes the file without
/// the "batch file cannot be found" message.
pub fn batch_script(inv: &Invocation, env: &[(String, String)]) -> Result<String, FsError> {
    let mut s = String::from("@echo off\r\nchcp 65001 >nul\r\n");
    for (key, value) in env.iter().filter(|(k, _)| valid_env_name(k)) {
        s.push_str(&format!(
            "set \"{key}={}\"\r\n",
            batch_text(std::ffi::OsStr::new(value))?
        ));
    }
    if let Some(cwd) = &inv.cwd {
        s.push_str(&format!("cd /d \"{}\"\r\n", batch_text(cwd.as_os_str())?));
    }
    let mut line = format!("\"{}\"", batch_text(std::ffi::OsStr::new(&inv.program))?);
    for a in &inv.args {
        line.push(' ');
        line.push_str(&batch_arg(a)?);
    }
    // every word is in quotes: `&`, `|`, `>` stay text for `echo` as well
    s.push_str(&format!("echo $ {line}\r\n{line}\r\n"));
    s.push_str("echo.\r\necho [exit code %errorlevel%]\r\n(goto) 2>nul & del \"%~f0\"\r\n");
    Ok(s)
}

/// What a Linux terminal needs behind its name to run `script` with `/bin/sh`. An unknown one
/// (`$TERMINAL`, `x-terminal-emulator`) gets the `-e` nearly all of them understand.
pub fn linux_exec_args(program: &str, script: &Path) -> Vec<OsString> {
    let name = Path::new(program)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let command = || vec![OsString::from("/bin/sh"), script.as_os_str().to_os_string()];
    let with = |flags: &[&str]| {
        let mut out: Vec<OsString> = flags.iter().map(OsString::from).collect();
        out.extend(command());
        out
    };
    match name.as_str() {
        "gnome-terminal" | "ptyxis" => with(&["--"]),
        "xfce4-terminal" | "mate-terminal" | "terminator" => with(&["-x"]),
        "wezterm" => with(&["start", "--"]),
        "kitty" | "foot" => command(),
        // takes one string that it splits itself: the script alone (it is executable)
        "tilix" => vec![OsString::from("-e"), script.as_os_str().to_os_string()],
        _ => with(&["-e"]),
    }
}

/// Opens the system's terminal window with `inv` running in it. Of `env` only `PATH` is set:
/// the terminal brings the user's own language and locale (a `LANG` from the app would
/// replace them).
pub fn run_in_terminal(inv: &Invocation, env: &[(String, String)]) -> Result<(), FsError> {
    let env: Vec<(String, String)> = env.iter().filter(|(k, _)| k == "PATH").cloned().collect();
    run_impl(inv, &env)
}

#[cfg(target_os = "macos")]
fn run_impl(inv: &Invocation, env: &[(String, String)]) -> Result<(), FsError> {
    use crate::tools::spawn_error;
    let script = write_script(&posix_script(inv, env), "command")
        .map_err(|e| FsError::from_io(&e, &std::env::temp_dir()))?;
    let status = std::process::Command::new("open")
        .args(["-a", "Terminal"])
        .arg(&script)
        .status();
    let failed = match status {
        Ok(s) if s.success() => return Ok(()),
        Ok(s) => FsError::new(
            FsErrorCode::Io,
            format!("\"open -a Terminal\" failed ({s})"),
            None,
        ),
        Err(e) => spawn_error(&e, "open"),
    };
    let _ = std::fs::remove_file(&script);
    Err(failed)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_impl(inv: &Invocation, env: &[(String, String)]) -> Result<(), FsError> {
    use super::desktop::{find_in_path, linux_terminals};
    let path = std::env::var_os("PATH");
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let env_terminal = std::env::var("TERMINAL").ok();
    let script = write_script(&posix_script(inv, env), "sh")
        .map_err(|e| FsError::from_io(&e, &std::env::temp_dir()))?;
    let mut last = None;
    for name in linux_terminals(&desktop, env_terminal.as_deref()) {
        let Some(program) = find_in_path(&name, path.as_deref()) else {
            continue;
        };
        let mut cmd = std::process::Command::new(&program);
        cmd.args(linux_exec_args(&name, &script));
        if let Some(cwd) = &inv.cwd {
            cmd.current_dir(cwd);
        }
        match crate::tools::spawn_detached(cmd, &name) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
    }
    let _ = std::fs::remove_file(&script);
    Err(last.unwrap_or_else(|| {
        FsError::new(
            FsErrorCode::ProgramNotFound,
            "No terminal program found (set $TERMINAL)",
            None,
        )
    }))
}

#[cfg(windows)]
fn run_impl(inv: &Invocation, env: &[(String, String)]) -> Result<(), FsError> {
    use crate::tools::spawn_error;
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let script = write_script(batch_script(inv, env)?.as_bytes(), "cmd")
        .map_err(|e| FsError::from_io(&e, &std::env::temp_dir()))?;
    let (_, cmd_exe) = super::desktop::system_programs();
    let mut cmd = std::process::Command::new(&cmd_exe);
    // `""path""`: cmd strips the outer pair whatever the path contains. The standard handles
    // stay unset: with a null stdin `/K` would end at once and take the window with it.
    cmd.raw_arg(format!("/K \"\"{}\"\"", script.display()))
        .creation_flags(CREATE_NEW_CONSOLE);
    if let Some(cwd) = &inv.cwd {
        cmd.current_dir(cwd);
    }
    match cmd.spawn() {
        Ok(mut child) => {
            let _ = std::thread::Builder::new()
                .name("fnf-tool-reaper".into())
                .spawn(move || {
                    let _ = child.wait();
                });
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&script);
            Err(spawn_error(&e, "cmd.exe"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv(program: &str, args: &[&str], cwd: Option<&str>) -> Invocation {
        Invocation {
            program: program.into(),
            args: args.iter().map(OsString::from).collect(),
            cwd: cwd.map(PathBuf::from),
        }
    }

    /// Not a word of a hostile name may reach the shell as syntax; the program comes from the
    /// `PATH` in the script, runs in the folder and the script is gone afterwards.
    #[cfg(unix)]
    #[test]
    fn the_script_keeps_hostile_names_as_one_argument_and_removes_itself() {
        use std::os::unix::fs::PermissionsExt;
        let bin = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        let probe = bin.path().join("fnf-probe-072");
        std::fs::write(
            &probe,
            "#!/bin/sh\npwd > where.txt\nfor a; do printf '%s\\n' \"$a\"; done > args.txt\n",
        )
        .unwrap();
        std::fs::set_permissions(&probe, std::fs::Permissions::from_mode(0o755)).unwrap();
        let hostile = "a'b; touch pwned $(touch pwned2) `touch pwned3` \"q\" & | > x.js";
        let run = Invocation {
            cwd: Some(work.path().to_path_buf()),
            ..inv("fnf-probe-072", &[hostile, "two words"], None)
        };
        let env = vec![
            (
                "PATH".to_string(),
                format!("{}:/usr/bin:/bin", bin.path().display()),
            ),
            ("BAD NAME; touch pwned4".to_string(), "x".to_string()),
        ];
        let script = write_script(&posix_script(&run, &env), "sh").unwrap();
        let out = std::process::Command::new("/bin/sh")
            .arg(&script)
            .env("SHELL", "/bin/sh")
            .current_dir(bin.path())
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert!(out.status.success());
        let quoted = hostile.replace('\'', r"'\''");
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            format!("$ fnf-probe-072 '{quoted}' 'two words'\n\n[exit code 0]\n")
        );
        assert!(!script.exists());
        assert_eq!(
            std::fs::read_to_string(work.path().join("args.txt")).unwrap(),
            format!("{hostile}\ntwo words\n")
        );
        let names: Vec<_> = std::fs::read_dir(work.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(!names.iter().any(|n| n.starts_with("pwned")), "{names:?}");
        assert!(!bin.path().join("pwned4").exists());
    }

    /// A program that is not found must not close the window either; its code is shown.
    #[cfg(unix)]
    #[test]
    fn the_window_stays_when_the_program_fails() {
        let script = posix_script(&inv("fnf-no-such-072", &[], Some("/")), &[]);
        let text = String::from_utf8(script.clone()).unwrap();
        assert!(text.ends_with("exec \"${SHELL:-/bin/sh}\" -l\n"));
        assert!(text.contains("cd -- '/' && fnf-no-such-072\n"));
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.sh");
        std::fs::write(&file, script).unwrap();
        let out = std::process::Command::new("/bin/sh")
            .arg(&file)
            .env("SHELL", "/bin/sh")
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).ends_with("\n[exit code 127]\n"));
    }

    #[test]
    fn batch_files_double_percent_and_refuse_what_has_no_safe_form() {
        let text = batch_script(
            &inv(
                "C:\\Program Files\\node.exe",
                &["100% a&b.js", "C:\\dir\\"],
                Some("C:\\my dir"),
            ),
            &[("FOO".into(), "x%y".into())],
        )
        .unwrap();
        assert!(text.contains("set \"FOO=x%%y\"\r\n"), "{text}");
        assert!(text.contains("cd /d \"C:\\my dir\"\r\n"), "{text}");
        let line = "\"C:\\Program Files\\node.exe\" \"100%% a&b.js\" \"C:\\dir\\\\\"";
        assert!(
            text.contains(&format!("echo $ {line}\r\n{line}\r\necho.\r\n")),
            "{text}"
        );
        assert!(text.contains("echo [exit code %errorlevel%]\r\n"), "{text}");
        for bad in ["a\"b", "a\nb", "a\rb"] {
            let e = batch_script(&inv("p", &[bad], None), &[]).unwrap_err();
            assert_eq!(e.code, FsErrorCode::UnquotableName, "{bad:?}");
        }
    }

    #[test]
    fn each_linux_terminal_gets_its_own_way_to_run_a_command() {
        let script = Path::new("/tmp/x y.sh");
        let s = |p: &str| {
            linux_exec_args(p, script)
                .into_iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(s("/usr/bin/gnome-terminal")[0], "--");
        assert_eq!(s("konsole")[0], "-e");
        assert_eq!(s("x-terminal-emulator")[0], "-e");
        assert_eq!(s("xfce4-terminal")[0], "-x");
        assert_eq!(s("wezterm")[..2], ["start", "--"]);
        assert_eq!(s("foot"), ["/bin/sh", "/tmp/x y.sh"]);
        assert_eq!(s("tilix"), ["-e", "/tmp/x y.sh"]);
    }

    /// By hand, opens a real window: `cargo test real_terminal_window -- --ignored`
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "opens a Terminal window"]
    fn real_terminal_window() {
        let work = tempfile::tempdir().unwrap();
        let run = Invocation {
            cwd: Some(work.path().to_path_buf()),
            ..inv("/bin/sh", &["-c", "pwd > marker.txt; echo hello"], None)
        };
        run_in_terminal(&run, &[]).unwrap();
        let marker = work.path().join("marker.txt");
        for _ in 0..200 {
            if marker.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("no marker from the terminal");
    }
}
