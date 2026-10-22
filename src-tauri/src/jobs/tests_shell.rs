//! Shell job (design 021): real `/bin/sh` processes in temp folders.

use super::tests_engine::{Harness, WAIT};
use super::*;
use crate::shell::ShellKind;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};
use tempfile::tempdir;

fn sh() -> ShellLaunch {
    ShellLaunch {
        kind: ShellKind::Posix {
            program: "/bin/sh".into(),
            fish: false,
        },
        env: Vec::new(),
    }
}

fn start(h: &Harness, cwd: &Path, command: &str) -> String {
    h.mgr
        .start(JobSpec::Shell {
            cwd: cwd.to_string_lossy().into_owned(),
            command: command.into(),
            launch: sh(),
        })
        .unwrap()
}

/// All output of a job per stream, and the total `dropped`.
fn output(h: &Harness, id: &str) -> (String, String, u64) {
    let mut out = String::new();
    let mut err = String::new();
    let mut dropped = 0;
    for e in h.events.lock().unwrap().iter() {
        if let JobEvent::ShellOutput {
            id: i,
            chunks,
            dropped: d,
        } = e
            && i == id
        {
            dropped += d;
            for c in chunks {
                match c.stream {
                    ShellStream::Stdout => out.push_str(&c.text),
                    ShellStream::Stderr => err.push_str(&c.text),
                }
            }
        }
    }
    (out, err, dropped)
}

fn first_output_at(h: &Harness, id: &str, deadline: Instant) -> Option<Instant> {
    while Instant::now() < deadline {
        if h.count(|e| matches!(e, JobEvent::ShellOutput { id: i, .. } if i == id)) > 0 {
            return Some(Instant::now());
        }
        thread::sleep(Duration::from_millis(5));
    }
    None
}

#[test]
fn start_job_cannot_create_a_shell_job() {
    let r: Result<JobSpec, _> =
        serde_json::from_str(r#"{"kind":"shell","cwd":"/","command":"touch /tmp/pwned"}"#);
    assert!(r.is_err());
    // but the info about a running one is sent (without the launch details)
    let v = serde_json::to_value(JobSpec::Shell {
        cwd: "/".into(),
        command: "ls".into(),
        launch: sh(),
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({"kind": "shell", "cwd": "/", "command": "ls"})
    );
    let s = JobSpec::Shell {
        cwd: "/".into(),
        command: "ls".into(),
        launch: sh(),
    };
    assert!(s.is_parallel() && s.is_helper());
    assert_eq!(s.kind(), "shell");
}

#[test]
fn runs_in_the_folder_with_separate_streams_and_exit_code() {
    let t = tempdir().unwrap();
    let dir = t.path().join("Ordner ä 📁");
    fs::create_dir(&dir).unwrap();
    let h = Harness::new();
    let id = start(&h, &dir, "pwd; echo fehler >&2; printf 'Grüße\\n'; exit 3");
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::DoneWithErrors);
    let shell = info.summary.unwrap().shell.unwrap();
    assert_eq!(shell.exit_code, Some(3));
    let (out, err, dropped) = output(&h, &id);
    // `pwd` may print the physical path (macOS: /private/var/… for /var/…)
    let real = fs::canonicalize(&dir).unwrap();
    assert!(
        out == format!("{}\nGrüße\n", dir.display())
            || out == format!("{}\nGrüße\n", real.display()),
        "{out}"
    );
    assert_eq!(err, "fehler\n");
    assert_eq!(dropped, 0);
    // the folder is reported as changed (panels reload)
    let d = dir.to_string_lossy().into_owned();
    assert!(h.count(|e| matches!(e, JobEvent::DirsChanged { dirs } if dirs.contains(&d))) >= 1);
    let id = start(&h, &dir, "true");
    assert_eq!(h.finish(&id).state, JobState::Done);
}

#[test]
fn a_folder_name_is_never_executed() {
    let t = tempdir().unwrap();
    let evil = t.path().join("x\"; touch pwned; \"");
    fs::create_dir(&evil).unwrap();
    let h = Harness::new();
    let id = start(&h, &evil, "ls");
    h.finish(&id);
    assert!(!evil.join("pwned").exists());
    assert!(!t.path().join("pwned").exists());
    let id = start(&h, &evil, "basename \"$PWD\"");
    h.finish(&id);
    assert_eq!(output(&h, &id).0, "x\"; touch pwned; \"\n");
}

#[test]
fn output_streams_before_the_end() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let started = Instant::now();
    let id = start(&h, t.path(), "echo a; sleep 2; echo b");
    let first = first_output_at(&h, &id, started + WAIT).expect("no output");
    assert!(
        first - started < Duration::from_millis(1500),
        "{:?}",
        first - started
    );
    h.finish(&id);
    assert_eq!(output(&h, &id).0, "a\nb\n");
}

#[test]
fn stdin_is_closed_and_there_is_no_terminal() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let started = Instant::now();
    let id = start(&h, t.path(), "cat; read x; tty; echo done");
    h.finish(&id);
    assert!(started.elapsed() < Duration::from_secs(5));
    let (out, _, _) = output(&h, &id);
    assert!(out.contains("not a tty"), "{out}");
    assert!(out.ends_with("done\n"));
    // own session: not the session of the test process
    let id = start(&h, t.path(), "ps -o sid= -p $$");
    h.finish(&id);
    let sid: i32 = output(&h, &id).0.trim().parse().unwrap_or(-1);
    // SAFETY: plain syscall.
    let mine = unsafe { libc::getsid(0) };
    assert_ne!(sid, mine);
}

#[test]
fn cancel_ends_the_whole_group() {
    let t = tempdir().unwrap();
    let pids = t.path().join("pids");
    let h = Harness::new();
    let id = start(
        &h,
        t.path(),
        &format!(
            "sleep 30 & echo $! > '{p}'; sleep 31 & echo $! >> '{p}'; wait",
            p = pids.display()
        ),
    );
    let deadline = Instant::now() + WAIT;
    while fs::read_to_string(&pids)
        .map(|s| s.lines().count())
        .unwrap_or(0)
        < 2
    {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    let started = Instant::now();
    h.mgr.cancel(&id);
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(3));
    thread::sleep(Duration::from_millis(100));
    for pid in fs::read_to_string(&pids).unwrap().lines() {
        let pid: i32 = pid.trim().parse().unwrap();
        // SAFETY: signal 0 only checks; the children were reaped by init or are gone
        let alive = unsafe { libc::kill(pid, 0) } == 0;
        let zombie = fs::read_to_string(format!("/proc/{pid}/stat"))
            .map(|s| s.contains(") Z "))
            .unwrap_or(true);
        assert!(!alive || zombie, "child {pid} still runs");
    }
}

#[test]
fn a_shell_that_ignores_sigterm_is_killed() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let id = start(
        &h,
        t.path(),
        "trap '' TERM; echo ready; while :; do sleep 0.1; done",
    );
    first_output_at(&h, &id, Instant::now() + WAIT).unwrap();
    let started = Instant::now();
    h.mgr.cancel(&id);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(4));
}

#[test]
fn endless_output_is_limited() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let id = start(&h, t.path(), "yes | head -c 8000000; echo ENDE");
    h.finish(&id);
    let (out, _, dropped) = output(&h, &id);
    assert!(dropped > 0, "nothing dropped");
    assert_eq!(out.len() as u64 + dropped, 8_000_000 + 5);
    assert!(out.ends_with("ENDE\n"));
    let biggest = h
        .events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            JobEvent::ShellOutput { chunks, .. } => {
                Some(chunks.iter().map(|c| c.text.len()).sum::<usize>())
            }
            _ => None,
        })
        .max()
        .unwrap();
    assert!(biggest <= shell::MAX_EVENT_BYTES);
}

#[test]
fn background_children_do_not_hold_the_job() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let started = Instant::now();
    let id = start(&h, t.path(), "sleep 5 & echo started");
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Done);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn a_missing_shell_fails_cleanly() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let id = h
        .mgr
        .start(JobSpec::Shell {
            cwd: t.path().to_string_lossy().into_owned(),
            command: "ls".into(),
            launch: ShellLaunch {
                kind: ShellKind::Posix {
                    program: "/no/such/shell".into(),
                    fish: false,
                },
                env: Vec::new(),
            },
        })
        .unwrap();
    let info = h.finish(&id);
    assert_eq!(info.state, JobState::Failed);
    assert_eq!(
        info.summary.unwrap().error.unwrap().code,
        crate::error::FsErrorCode::ProgramNotFound
    );
}

#[test]
fn invalid_specs_are_rejected() {
    let t = tempdir().unwrap();
    fs::write(t.path().join("datei"), "x").unwrap();
    let h = Harness::new();
    let spec = |cwd: &Path, command: &str| JobSpec::Shell {
        cwd: cwd.to_string_lossy().into_owned(),
        command: command.into(),
        launch: sh(),
    };
    assert!(h.mgr.start(spec(&t.path().join("datei"), "ls")).is_err());
    assert!(h.mgr.start(spec(&t.path().join("fehlt"), "ls")).is_err());
    assert!(h.mgr.start(spec(t.path(), "ls\nrm -rf x")).is_err());
    assert!(h.mgr.start(spec(t.path(), "   ")).is_err());
}

#[test]
fn login_env_and_no_colours_reach_the_command() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let mut launch = sh();
    launch.env = vec![("LC_FNF_TEST".into(), "ja".into())];
    let id = h
        .mgr
        .start(JobSpec::Shell {
            cwd: t.path().to_string_lossy().into_owned(),
            command: "echo \"$LC_FNF_TEST $TERM $NO_COLOR $PAGER ${CLICOLOR_FORCE:-unset}\"".into(),
            launch,
        })
        .unwrap();
    h.finish(&id);
    assert_eq!(output(&h, &id).0, "ja dumb 1 cat unset\n");
}

/// Review 021 #1: `yes` floods the pipe – memory stays bounded (backpressure) and Esc ends it at once.
#[test]
fn endless_output_is_cancelled_quickly() {
    let t = tempdir().unwrap();
    let h = Harness::new();
    let id = start(&h, t.path(), "yes");
    thread::sleep(Duration::from_millis(1500));
    let started = Instant::now();
    h.mgr.cancel(&id);
    assert_eq!(h.finish(&id).state, JobState::Cancelled);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
}

/// Review 021 #5: a background process keeps running and is not killed by SIGPIPE
/// when it writes after the job ended.
#[test]
fn background_output_after_the_end_does_not_kill_the_child() {
    let t = tempdir().unwrap();
    let marker = t.path().join("lebt");
    let h = Harness::new();
    let id = start(
        &h,
        t.path(),
        &format!(
            "(sleep 1; echo spaet; sleep 0.3; touch '{}') &",
            marker.display()
        ),
    );
    assert_eq!(h.finish(&id).state, JobState::Done);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !marker.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(marker.exists(), "the background process died on its write");
}
