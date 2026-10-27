//! The system search as an optional source (design 043 E2c, off by default):
//! Spotlight (`mdfind`) on macOS, `plocate`/`locate` on Linux – started without a
//! shell with a fixed argument list, ended after a deadline, at most
//! [`MAX_LINES`] lines read. Every line is checked by the caller (absolute, below a
//! root, exists, matches the whole query). Windows Search needs COM/OLE DB and is
//! not offered.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const MAX_LINES: usize = 5000;
/// Longer words are cut for the system search (the full query is checked after).
const MAX_WORD: usize = 200;

/// Whether this system has a search the palette can use.
pub fn available() -> bool {
    !program_candidates().is_empty()
}

fn program_candidates() -> Vec<&'static str> {
    let names: &[&str] = if cfg!(target_os = "macos") {
        &["/usr/bin/mdfind"]
    } else if cfg!(target_os = "linux") {
        &[
            "/usr/bin/plocate",
            "/usr/bin/locate",
            "/usr/local/bin/plocate",
        ]
    } else {
        &[]
    };
    names
        .iter()
        .copied()
        .filter(|p| Path::new(p).is_file())
        .collect()
}

/// `*`, `?`, `[`, `]` and `\` as plain characters in a locate pattern.
fn glob_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '*' | '?' | '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The argument lists for one program (no shell; the word is one argument after `--`
/// where the program knows it). `locate` searches its whole database: one run per root
/// with the pattern `<root>/*<word>*` (review 043 #11).
pub fn args_for(program: &str, word: &str, roots: &[PathBuf]) -> Vec<Vec<String>> {
    let word: String = word.chars().take(MAX_WORD).collect();
    if program.ends_with("mdfind") {
        let mut a = Vec::new();
        for r in roots {
            a.push("-onlyin".to_string());
            a.push(r.to_string_lossy().into_owned());
        }
        a.push("-name".to_string());
        a.push(word);
        vec![a]
    } else {
        roots
            .iter()
            .take(4)
            .map(|r| {
                let root = r.to_string_lossy();
                let sep = if root.ends_with(std::path::MAIN_SEPARATOR) {
                    ""
                } else {
                    std::path::MAIN_SEPARATOR_STR
                };
                vec![
                    "--ignore-case".into(),
                    "--limit".into(),
                    MAX_LINES.to_string(),
                    "--".into(),
                    format!("{}{sep}*{}*", glob_escape(&root), glob_escape(&word)),
                ]
            })
            .collect()
    }
}

/// Runs the system search for `word` until `deadline`; the lines are paths (unchecked).
pub fn run(word: &str, roots: &[PathBuf], deadline: Instant) -> Vec<PathBuf> {
    let Some(program) = program_candidates().into_iter().next() else {
        return Vec::new();
    };
    if word.is_empty() {
        return Vec::new();
    }
    let mut lines = Vec::new();
    for args in args_for(program, word, roots) {
        if Instant::now() >= deadline || lines.len() >= MAX_LINES {
            break;
        }
        run_one(program, &args, deadline, &mut lines);
    }
    lines
}

fn run_one(program: &str, args: &[String], deadline: Instant, lines: &mut Vec<PathBuf>) {
    let Ok(mut child) = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    let Some(out) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return;
    };
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        // bytes, not `lines()`: a name that is not UTF-8 must not end the list
        let mut r = BufReader::new(out);
        let mut buf = Vec::new();
        for _ in 0..MAX_LINES {
            buf.clear();
            match r.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if buf.last() == Some(&b'\n') {
                buf.pop();
            }
            let Ok(line) = String::from_utf8(buf.clone()) else {
                continue;
            };
            if tx.send(PathBuf::from(line)).is_err() {
                break;
            }
        }
    });
    while lines.len() < MAX_LINES {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match rx.recv_timeout(left.min(Duration::from_millis(50))) {
            Ok(p) => lines.push(p),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    drop(rx);
    let _ = reader.join();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_are_a_fixed_list() {
        let roots = [PathBuf::from("/home/u")];
        assert_eq!(
            args_for("/usr/bin/mdfind", "invoice; rm -rf", &roots),
            [["-onlyin", "/home/u", "-name", "invoice; rm -rf"]]
        );
        #[cfg(unix)]
        assert_eq!(
            args_for("/usr/bin/plocate", "-x*", &roots),
            [["--ignore-case", "--limit", "5000", "--", "/home/u/*-x\\**"]]
        );
        let long = args_for("/usr/bin/locate", &"a".repeat(500), &roots);
        assert!(long[0][4].len() < 300);
    }

    #[test]
    fn an_empty_word_runs_nothing() {
        assert!(run("", &[], Instant::now() + Duration::from_secs(1)).is_empty());
    }
}
