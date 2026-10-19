use super::quote::{quote, quote_one};
use super::text::{Decoder, strip_ansi};
use super::*;
use crate::error::FsErrorCode;
use std::ffi::OsStr;
use tempfile::tempdir;

fn posix() -> ShellKind {
    ShellKind::Posix {
        program: "/bin/sh".into(),
        fish: false,
    }
}
fn fish() -> ShellKind {
    ShellKind::Posix {
        program: "/usr/bin/fish".into(),
        fish: true,
    }
}
fn cmd() -> ShellKind {
    ShellKind::Cmd {
        program: r"C:\Windows\System32\cmd.exe".into(),
    }
}
fn pwsh() -> ShellKind {
    ShellKind::PowerShell {
        program: "pwsh.exe".into(),
    }
}
fn cd(t: Option<&str>) -> Option<Builtin> {
    Some(Builtin::Cd {
        target: t.map(str::to_string),
    })
}

#[test]
fn known_posix_shells_only() {
    let ok = |_: &Path| true;
    assert_eq!(
        choose_posix(Some(OsStr::new("/bin/zsh")), ok),
        ShellKind::Posix {
            program: "/bin/zsh".into(),
            fish: false
        }
    );
    assert_eq!(
        choose_posix(Some(OsStr::new("/opt/homebrew/bin/fish")), ok),
        ShellKind::Posix {
            program: "/opt/homebrew/bin/fish".into(),
            fish: true
        }
    );
    // unknown quoting rules, relative, missing, not runnable → /bin/sh
    for s in ["/usr/bin/nu", "/usr/bin/pwsh", "zsh", ""] {
        assert_eq!(
            choose_posix(Some(OsStr::new(s)), ok),
            ShellKind::default(),
            "{s}"
        );
    }
    assert_eq!(choose_posix(None, ok), ShellKind::default());
    assert_eq!(
        choose_posix(Some(OsStr::new("/bin/bash")), |_| false),
        ShellKind::default()
    );
}

#[test]
fn arguments_per_shell() {
    assert_eq!(shell_args(&posix(), "ls -la"), ["-c", "ls -la"]);
    let p = shell_args(&pwsh(), "Get-ChildItem");
    assert_eq!(
        &p[..4],
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]
    );
    assert_eq!(p[4], format!("{POWERSHELL_PREFIX}Get-ChildItem"));
    // the command is kept as typed – only the outer quotes are added (`/S` strips them)
    assert_eq!(
        cmd_raw_args(r#"dir "a b" & echo %x%"#),
        r#"/D /S /C "dir "a b" & echo %x%""#
    );
    assert!(shell_args(&cmd(), "dir").is_empty());
}

#[test]
fn commands_are_one_line() {
    assert_eq!(validate_command("  ls -la ").unwrap(), "ls -la");
    for bad in ["", "   ", "ls\nrm x", "a\rb", "a\0b"] {
        assert_eq!(
            validate_command(bad).unwrap_err().code,
            FsErrorCode::InvalidCommand,
            "{bad:?}"
        );
    }
    assert!(validate_command(&"x".repeat(MAX_COMMAND_BYTES + 1)).is_err());
}

#[test]
fn builtins_posix() {
    assert_eq!(parse_builtin("cd", false), cd(None));
    assert_eq!(parse_builtin("  cd   ", false), cd(None));
    assert_eq!(parse_builtin("cd ~", false), cd(Some("~")));
    assert_eq!(parse_builtin("cd ..", false), cd(Some("..")));
    assert_eq!(parse_builtin("cd ~/Musik", false), cd(Some("~/Musik")));
    assert_eq!(parse_builtin("cd Ünter ordner", false), None); // two words → shell
    assert_eq!(
        parse_builtin("cd 'Ünter ordner'", false),
        cd(Some("Ünter ordner"))
    );
    assert_eq!(parse_builtin("cd \"a b\"", false), cd(Some("a b")));
    assert_eq!(parse_builtin("cd \"$HOME\"", false), None);
    assert_eq!(parse_builtin("cd -", false), Some(Builtin::CdBack));
    assert_eq!(parse_builtin("clear", false), Some(Builtin::Clear));
    assert_eq!(parse_builtin("cls", false), Some(Builtin::Clear));
    for shell in [
        "cd x && make",
        "cd x; ls",
        "cd $HOME",
        "cd *",
        "cd a\\ b",
        "cd `pwd`",
        "cdx",
        "ls",
        "CD x",
        "cd ''",
        "cd 'a'b'",
    ] {
        assert_eq!(parse_builtin(shell, false), None, "{shell}");
    }
}

#[test]
fn builtins_windows() {
    assert_eq!(
        parse_builtin("CD /d D:\\Daten", true),
        cd(Some("D:\\Daten"))
    );
    assert_eq!(parse_builtin("chdir ..", true), cd(Some("..")));
    assert_eq!(
        parse_builtin("cd \"C:\\Program Files\"", true),
        cd(Some("C:\\Program Files"))
    );
    assert_eq!(parse_builtin("D:", true), cd(Some("D:\\")));
    assert_eq!(parse_builtin("CLS", true), Some(Builtin::Clear));
    assert_eq!(parse_builtin("cd %USERPROFILE%", true), None);
    assert_eq!(parse_builtin("cd 'a b'", true), None); // cmd has no single quotes
}

#[test]
fn cd_resolves_and_checks() {
    let t = tempdir().unwrap();
    let r = t.path();
    fs::create_dir_all(r.join("Ünter ordner 📁").join("tief")).unwrap();
    fs::write(r.join("datei.txt"), "x").unwrap();
    let home = r.join("Ünter ordner 📁");
    let sub = r.join("Ünter ordner 📁");
    assert_eq!(resolve_cd(r, Some("Ünter ordner 📁"), None).unwrap(), sub);
    assert_eq!(
        resolve_cd(&sub, Some(".."), None).unwrap(),
        normalize_lexically(r)
    );
    assert_eq!(
        resolve_cd(r, Some(&sub.join("tief").to_string_lossy()), None).unwrap(),
        sub.join("tief")
    );
    assert_eq!(resolve_cd(r, None, Some(&home)).unwrap(), home);
    assert_eq!(resolve_cd(r, Some("~"), Some(&home)).unwrap(), home);
    assert_eq!(
        resolve_cd(r, Some("~/tief"), Some(&home)).unwrap(),
        home.join("tief")
    );
    assert_eq!(
        resolve_cd(r, None, None).unwrap_err().code,
        FsErrorCode::NoHomeDirectory
    );
    assert_eq!(
        resolve_cd(r, Some("fehlt"), None).unwrap_err().code,
        FsErrorCode::NotFound
    );
    assert_eq!(
        resolve_cd(r, Some("datei.txt"), None).unwrap_err().code,
        FsErrorCode::NotADirectory
    );
}

#[cfg(unix)]
#[test]
fn cd_follows_links_to_folders() {
    let t = tempdir().unwrap();
    let r = t.path();
    fs::create_dir(r.join("ziel")).unwrap();
    std::os::unix::fs::symlink(r.join("ziel"), r.join("link")).unwrap();
    std::os::unix::fs::symlink(r.join("weg"), r.join("kaputt")).unwrap();
    // lexical: the panel shows the link path, not the target (no canonicalize)
    assert_eq!(resolve_cd(r, Some("link"), None).unwrap(), r.join("link"));
    assert_eq!(
        resolve_cd(r, Some("kaputt"), None).unwrap_err().code,
        FsErrorCode::NotFound
    );
}

#[test]
fn cwd_must_be_a_real_folder() {
    let t = tempdir().unwrap();
    fs::write(t.path().join("a.zip"), "x").unwrap();
    assert!(check_cwd(&t.path().to_string_lossy()).is_ok());
    assert_eq!(
        check_cwd("relativ").unwrap_err().code,
        FsErrorCode::InvalidPath
    );
    let virtual_path = t.path().join("a.zip").join("inner");
    assert!(check_cwd(&virtual_path.to_string_lossy()).is_err());
    assert_eq!(
        check_cwd(&t.path().join("a.zip").to_string_lossy())
            .unwrap_err()
            .code,
        FsErrorCode::NotADirectory
    );
}

#[test]
fn quoting_posix() {
    let k = posix();
    assert_eq!(
        quote_one("plain-name_1.txt", &k, true).unwrap(),
        "plain-name_1.txt"
    );
    assert_eq!(quote_one("Ünïcødé.txt", &k, true).unwrap(), "Ünïcødé.txt");
    assert_eq!(quote_one("a b", &k, true).unwrap(), "'a b'");
    assert_eq!(quote_one("it's", &k, true).unwrap(), r"'it'\''s'");
    assert_eq!(
        quote_one("$HOME `x` \"q\" !", &k, true).unwrap(),
        "'$HOME `x` \"q\" !'"
    );
    assert_eq!(quote_one("-rf", &k, true).unwrap(), "./-rf");
    assert_eq!(quote_one("-a b", &k, true).unwrap(), "'./-a b'");
    assert_eq!(quote_one("/x/-rf", &k, false).unwrap(), "/x/-rf");
    assert_eq!(quote_one("🎉", &k, true).unwrap(), "'🎉'");
    assert_eq!(
        quote(&["a b".into(), "c".into()], &k, true).unwrap(),
        "'a b' c"
    );
    for bad in ["a\nb", "a\tb", "a\u{1b}[31m", ""] {
        assert_eq!(
            quote_one(bad, &k, true).unwrap_err().code,
            FsErrorCode::UnquotableName
        );
    }
}

#[test]
fn quoting_fish_powershell_cmd() {
    assert_eq!(
        quote_one(r"a\b 'c'", &fish(), true).unwrap(),
        r"'a\\b \'c\''"
    );
    assert_eq!(
        quote_one("it's ‘x’", &pwsh(), true).unwrap(),
        "'it''s ‘‘x’’'"
    );
    assert_eq!(quote_one("-x", &pwsh(), true).unwrap(), r"'.\-x'");
    assert_eq!(
        quote_one(r"C:\Program Files\a b", &cmd(), false).unwrap(),
        r#""C:\Program Files\a b""#
    );
    assert_eq!(quote_one("a^b&c", &cmd(), true).unwrap(), "\"a^b&c\"");
    for bad in ["100%", "hi!", "a\"b"] {
        assert_eq!(
            quote_one(bad, &cmd(), true).unwrap_err().code,
            FsErrorCode::UnquotableName,
            "{bad}"
        );
    }
}

/// Round trip: the quoted name, run by the shell, is exactly the name again.
#[cfg(unix)]
#[test]
fn quoting_round_trip_in_real_shells() {
    let names = [
        "a b",
        "it's",
        "\"double\"",
        "$HOME",
        "`date`",
        "100%",
        "bang!",
        "^caret",
        "-rf",
        "Ünïcødé 🎉",
        "back\\slash",
        "semi;colon&and|pipe",
        "*?[x]",
        "~tilde",
        "#hash",
    ];
    let shells: Vec<(&str, bool)> = [
        ("/bin/sh", false),
        ("/bin/bash", false),
        ("/bin/dash", false),
        ("/usr/bin/zsh", false),
        ("/bin/zsh", false),
        ("/usr/bin/fish", true),
    ]
    .into_iter()
    .filter(|(p, _)| Path::new(p).exists())
    .collect();
    assert!(!shells.is_empty());
    for (program, is_fish) in shells {
        let kind = ShellKind::Posix {
            program: program.into(),
            fish: is_fish,
        };
        for name in names {
            let q = quote_one(name, &kind, false).unwrap();
            let out = std::process::Command::new(program)
                .args(["-c", &format!("printf '%s' {q}")])
                .output()
                .unwrap();
            assert_eq!(String::from_utf8_lossy(&out.stdout), name, "{program}: {q}");
        }
    }
}

#[test]
fn ansi_is_removed_and_line_ends_unified() {
    assert_eq!(strip_ansi("\u{1b}[1;31mrot\u{1b}[0m"), "rot");
    assert_eq!(strip_ansi("a\u{1b}]0;title\u{7}b"), "ab");
    assert_eq!(
        strip_ansi("a\u{1b}]8;;http://x\u{1b}\\link\u{1b}]8;;\u{1b}\\b"),
        "alinkb"
    );
    assert_eq!(strip_ansi("a\u{1b}(Bb\u{1b}=c"), "abc");
    assert_eq!(strip_ansi("eins\r\nzwei\r\r\ndrei"), "eins\nzwei\ndrei");
    assert_eq!(strip_ansi("10%\r50%\r100%\n"), "10%\n50%\n100%\n");
    assert_eq!(strip_ansi("tab\there\u{7}\u{8}"), "tab\there");
    assert_eq!(strip_ansi("ende\r"), "ende\n");
    // split across blocks
    let mut a = text::AnsiStripper::default();
    let mut s = a.push("x\u{1b}[3");
    s.push_str(&a.push("1mrot\r"));
    s.push_str(&a.push("\nweiter"));
    s.push_str(&a.finish());
    assert_eq!(s, "xrot\nweiter");
}

#[test]
fn decoder_keeps_sequences_across_blocks() {
    let bytes = "Grüße 🎉".as_bytes();
    let mut d = Decoder::default();
    let mut out = String::new();
    for b in bytes.chunks(1) {
        out.push_str(&d.push(b));
    }
    out.push_str(&d.finish());
    assert_eq!(out, "Grüße 🎉");
    let mut d = Decoder::default();
    let mut s = d.push(b"ok \xff\xfe end");
    s.push_str(&d.finish());
    if !cfg!(windows) {
        assert_eq!(s, "ok \u{FFFD}\u{FFFD} end");
    }
    let mut d = Decoder::default();
    let mut s = d.push(b"cut \xe2\x82");
    s.push_str(&d.finish());
    assert!(s.starts_with("cut "));
}

#[test]
fn history_dedupes_bounds_and_survives_broken_files() {
    let t = tempdir().unwrap();
    let f = t.path().join("cfg ä").join(history::FILE_NAME);
    assert!(history::load(&f).is_empty());
    history::add(&f, "ls").unwrap();
    history::add(&f, "pwd").unwrap();
    let h = history::add(&f, "ls").unwrap();
    assert_eq!(h, ["ls", "pwd"]);
    for i in 0..150 {
        history::add(&f, &format!("echo {i}")).unwrap();
    }
    let h = history::load(&f);
    assert_eq!(h.len(), history::MAX_ENTRIES);
    assert_eq!(h[0], "echo 149");
    fs::write(&f, "{kaputt").unwrap();
    assert!(history::load(&f).is_empty());
    assert!(
        f.with_file_name(format!("{}.bad", history::FILE_NAME))
            .exists()
    );
    history::add(&f, "neu").unwrap();
    assert_eq!(history::load(&f), ["neu"]);
    history::clear(&f).unwrap();
    history::clear(&f).unwrap(); // missing is fine
    assert!(history::load(&f).is_empty());
}

#[test]
fn login_env_takes_only_wanted_keys() {
    let raw = b"PATH=/opt/homebrew/bin:/usr/bin\0SECRET=x\0LANG=de_DE.UTF-8\0LC_ALL=C\0broken\0MANPATH=/m\0";
    assert_eq!(
        env::parse_env0(raw),
        vec![
            ("PATH".to_string(), "/opt/homebrew/bin:/usr/bin".to_string()),
            ("LANG".into(), "de_DE.UTF-8".into()),
            ("LC_ALL".into(), "C".into()),
            ("MANPATH".into(), "/m".into()),
        ]
    );
}

#[cfg(unix)]
#[test]
fn login_env_is_read_and_times_out() {
    let k = ShellKind::Posix {
        program: "/bin/sh".into(),
        fish: false,
    };
    let env = env::read_login_env(&k, std::time::Duration::from_secs(5)).expect("sh -l works");
    assert!(env.iter().any(|(k, _)| k == "PATH"));
    // a "shell" that hangs: the timeout ends it
    let t = tempdir().unwrap();
    let slow = t.path().join("slow-sh");
    fs::write(&slow, "#!/bin/sh\nsleep 30\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&slow, fs::Permissions::from_mode(0o755)).unwrap();
    let start = std::time::Instant::now();
    let k = ShellKind::Posix {
        program: slow,
        fish: false,
    };
    assert!(env::read_login_env(&k, std::time::Duration::from_millis(300)).is_none());
    assert!(start.elapsed() < std::time::Duration::from_secs(3));
}
