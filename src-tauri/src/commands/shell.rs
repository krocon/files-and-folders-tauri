//! Commands of the shell bar (design 021). `run_shell` is the only way a shell
//! command starts (`JobSpec::Shell` cannot be deserialised, so `start_job`
//! cannot); it is accepted from the main window only and when `shell.enabled`
//! is on in `settings.json`. Commands and output are never logged.

use super::{JobsState, blocking, config_dir, home_dir};
use crate::error::{FsError, FsErrorCode};
use crate::jobs::{JobSpec, ShellLaunch};
use crate::settings;
use crate::shell::env::{LoginEnvError, LoginMode};
use crate::shell::{self, Builtin, ShellKind, history};
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

pub const MAIN_WINDOW: &str = "main";
pub const MAX_QUOTE_ITEMS: usize = 10_000;

/// Serialises `run_shell` (check "one at a time" and start without a race).
#[derive(Default)]
pub struct ShellState {
    starting: Mutex<()>,
}

/// What `run_shell` did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShellRunResult {
    /// A shell job runs; `notices` are codes for the frontend
    /// (`loginEnvUnavailable:<reason>`, design 061 E6b).
    Started {
        job_id: String,
        notices: Vec<String>,
    },
    /// `cd`: the active panel goes to `path`.
    Navigate { path: String },
    /// `cd -`: the active panel goes back.
    Back,
    /// `clear`/`cls`: the output is emptied.
    Clear,
}

/// The shell settings from the stored values (defaults from the schema).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSettings {
    pub enabled: bool,
    /// `shell.loginPath`: `None` = off (design 061 E6b).
    pub login_path: Option<LoginMode>,
    pub windows_shell: String,
}

pub fn shell_settings(stored: &Map<String, Value>) -> ShellSettings {
    let get = |key: &str| {
        stored.get(key).cloned().unwrap_or_else(|| {
            settings::SCHEMA
                .get(key)
                .map(|s| s.default_value())
                .unwrap_or(Value::Null)
        })
    };
    ShellSettings {
        enabled: get("shell.enabled").as_bool().unwrap_or(true),
        login_path: LoginMode::from_setting(&get("shell.loginPath")),
        windows_shell: get("shell.windowsShell")
            .as_str()
            .unwrap_or("cmd")
            .to_string(),
    }
}

fn read_settings(config: &Path) -> ShellSettings {
    shell_settings(&settings::load(&config.join(settings::FILE_NAME)).settings)
}

fn main_only<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), FsError> {
    if window.label() == MAIN_WINDOW {
        Ok(())
    } else {
        Err(FsError::new(
            FsErrorCode::ShellDisabled,
            "The shell is only available in the main window",
            None,
        ))
    }
}

fn disabled() -> FsError {
    FsError::new(
        FsErrorCode::ShellDisabled,
        "The shell bar is switched off in the settings",
        None,
    )
}

/// Adds a line to the history – a convenience: a write error does not stop the command.
async fn remember(file: PathBuf, line: String) {
    let _ = blocking("Saving the shell history", move || {
        history::add(&file, &line).map_err(|e| FsError::from_io(&e, &file))
    })
    .await;
}

/// Runs one line of the shell bar in `cwd`: `cd`/`clear` itself, else as a shell job.
#[tauri::command]
pub async fn run_shell<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    cwd: String,
    command: String,
) -> Result<ShellRunResult, FsError> {
    main_only(&window)?;
    let config = config_dir(&app)?;
    let home = home_dir(&app).ok();
    let line = shell::validate_command(&command)?.to_string();
    let cfg = {
        let config = config.clone();
        blocking("Reading the settings", move || Ok(read_settings(&config))).await?
    };
    if !cfg.enabled {
        return Err(disabled());
    }
    let cwd_path = {
        let cwd = cwd.clone();
        blocking("Checking the folder", move || shell::check_cwd(&cwd)).await?
    };
    let history_file = config.join(history::FILE_NAME);
    let kind = shell::choose(&cfg.windows_shell);
    if let Some(builtin) = shell::parse_builtin(&line, kind.is_windows_style()) {
        let result = match builtin {
            Builtin::Clear => ShellRunResult::Clear,
            Builtin::CdBack => ShellRunResult::Back,
            Builtin::Cd { target } => {
                let cwd_path = cwd_path.clone();
                let path = blocking("Changing the folder", move || {
                    shell::resolve_cd(&cwd_path, target.as_deref(), home.as_deref())
                })
                .await;
                remember(history_file.clone(), line.clone()).await;
                return path.map(|p| ShellRunResult::Navigate {
                    path: p.to_string_lossy().into_owned(),
                });
            }
        };
        remember(history_file, line).await;
        return Ok(result);
    }
    let (env, notices) = match cfg.login_path {
        Some(mode) if !kind.is_windows_style() => {
            let k = kind.clone();
            blocking("Reading the login environment", move || {
                let result = shell::env::login_env(&k, mode);
                let notice = shell::env::take_notice(&result).map(|e| notice_code(&e));
                Ok((
                    shell::env::launch_env(result.as_ref().ok()),
                    notice.into_iter().collect::<Vec<_>>(),
                ))
            })
            .await?
        }
        _ => (Vec::new(), Vec::new()),
    };
    let job_id = {
        let state = app.state::<ShellState>();
        let _guard = state.starting.lock().unwrap_or_else(|e| e.into_inner());
        let jobs = app.state::<JobsState>();
        let busy = jobs
            .manager
            .list()
            .iter()
            .any(|j| matches!(j.spec, JobSpec::Shell { .. }) && !j.state.is_finished());
        if busy {
            return Err(FsError::new(
                FsErrorCode::ShellBusy,
                "A shell command is still running",
                None,
            ));
        }
        jobs.manager.start(JobSpec::Shell {
            cwd: cwd_path.to_string_lossy().into_owned(),
            command: line.clone(),
            launch: ShellLaunch { kind, env },
        })?
    };
    remember(history_file, line).await;
    Ok(ShellRunResult::Started { job_id, notices })
}

/// Quotes names (`names = true`) or full paths for the shell `run_shell` uses.
#[tauri::command]
pub async fn shell_quote<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<String>,
    names: bool,
) -> Result<String, FsError> {
    if items.len() > MAX_QUOTE_ITEMS {
        return Err(FsError::new(FsErrorCode::TooMany, "Too many entries", None));
    }
    let config = config_dir(&app)?;
    let cfg = blocking("Reading the settings", move || Ok(read_settings(&config))).await?;
    let kind: ShellKind = shell::choose(&cfg.windows_shell);
    shell::quote::quote(&items, &kind, names)
}

/// The history, newest first. Also warms up the login environment in the
/// background (the bar asks for the history when it is shown).
#[tauri::command]
pub async fn load_shell_history<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, FsError> {
    let config: PathBuf = config_dir(&app)?;
    blocking("Loading the shell history", move || {
        let cfg = read_settings(&config);
        if cfg.enabled
            && let Some(mode) = cfg.login_path
        {
            let kind = shell::choose(&cfg.windows_shell);
            if !kind.is_windows_style() {
                let _ = std::thread::Builder::new()
                    .name("fnf-login-env".into())
                    .spawn(move || {
                        let _ = shell::env::login_env(&kind, mode);
                    });
            }
        }
        Ok(history::load(&config.join(history::FILE_NAME)))
    })
    .await
}

/// The notice for a failed read: code and reason, never values (design 061 E6b).
pub fn notice_code(e: &LoginEnvError) -> String {
    format!("loginEnvUnavailable:{}", e.code())
}

/// Status of the login PATH for `SHELL_LOGIN_STATUS` (design 061 E6b): reason,
/// duration, shell program name, number of PATH entries – no values, no paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginEnvStatus {
    /// `off` | `notPosix` | `running` | `ok` | `failed`
    pub state: String,
    pub reason: Option<String>,
    /// The mode that was used (`login` | `loginInteractive`).
    pub mode: Option<String>,
    pub duration_ms: Option<u64>,
    /// File name of the shell program (`zsh`).
    pub shell: String,
    pub path_entries: Option<usize>,
}

pub fn status_of(
    kind: &ShellKind,
    mode: Option<LoginMode>,
    last: Option<&shell::env::Attempt>,
    running: bool,
) -> LoginEnvStatus {
    let shell = kind
        .program()
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let base = LoginEnvStatus {
        state: String::new(),
        reason: None,
        mode: None,
        duration_ms: None,
        shell,
        path_entries: None,
    };
    if kind.is_windows_style() {
        return LoginEnvStatus {
            state: "notPosix".into(),
            ..base
        };
    }
    if mode.is_none() {
        return LoginEnvStatus {
            state: "off".into(),
            ..base
        };
    }
    match last {
        Some(a) if !running => LoginEnvStatus {
            state: if a.result.is_ok() { "ok" } else { "failed" }.into(),
            reason: a.result.as_ref().err().map(|e| e.code().to_string()),
            mode: Some(a.mode.code().into()),
            duration_ms: Some(u64::try_from(a.duration.as_millis()).unwrap_or(u64::MAX)),
            path_entries: a.path_entries(),
            ..base
        },
        _ => LoginEnvStatus {
            state: "running".into(),
            ..base
        },
    }
}

/// Reads the login environment if due (like a command would) and reports how it went.
#[tauri::command]
pub async fn shell_login_status<R: Runtime>(app: AppHandle<R>) -> Result<LoginEnvStatus, FsError> {
    let config = config_dir(&app)?;
    blocking("Reading the login environment", move || {
        let cfg = read_settings(&config);
        let kind = shell::choose(&cfg.windows_shell);
        if let Some(mode) = cfg.login_path
            && !kind.is_windows_style()
        {
            let _ = shell::env::login_env(&kind, mode);
        }
        let (last, running) = shell::env::last_attempt();
        Ok(status_of(&kind, cfg.login_path, last.as_ref(), running))
    })
    .await
}

#[tauri::command]
pub async fn clear_shell_history<R: Runtime>(app: AppHandle<R>) -> Result<(), FsError> {
    let file = config_dir(&app)?.join(history::FILE_NAME);
    blocking("Clearing the shell history", move || {
        history::clear(&file).map_err(|e| FsError::from_io(&e, &file))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_default_to_the_schema() {
        let s = shell_settings(&Map::new());
        assert_eq!(
            s,
            ShellSettings {
                enabled: true,
                login_path: Some(LoginMode::LoginInteractive),
                windows_shell: "cmd".into()
            }
        );
        let mut m = Map::new();
        m.insert("shell.enabled".into(), json!(false));
        m.insert("shell.windowsShell".into(), json!("powershell"));
        let s = shell_settings(&m);
        assert!(!s.enabled);
        assert_eq!(s.windows_shell, "powershell");
    }

    /// Design 061 E6b: the setting as a select; the notice carries the reason, once.
    #[test]
    fn login_path_setting_and_notice() {
        let mut m = Map::new();
        m.insert("shell.loginPath".into(), json!("off"));
        assert_eq!(shell_settings(&m).login_path, None);
        m.insert("shell.loginPath".into(), json!("login"));
        assert_eq!(shell_settings(&m).login_path, Some(LoginMode::Login));
        let mut cache = shell::env::LoginCache::new();
        let fail: Result<shell::env::EnvPairs, _> = Err(LoginEnvError::Timeout);
        let notices: Vec<String> = (0..3)
            .filter_map(|_| cache.take_notice(&fail).map(|e| notice_code(&e)))
            .collect();
        assert_eq!(notices, ["loginEnvUnavailable:timeout"]);
    }

    #[test]
    fn login_status_has_no_values() {
        let zsh = ShellKind::Posix {
            program: "/bin/zsh".into(),
            fish: false,
        };
        let ok = shell::env::Attempt {
            result: Ok(vec![("PATH".into(), "/secret/a:/b".into())]),
            mode: LoginMode::LoginInteractive,
            duration: std::time::Duration::from_millis(420),
        };
        let s = status_of(&zsh, Some(LoginMode::LoginInteractive), Some(&ok), false);
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(
            v,
            json!({"state": "ok", "reason": null, "mode": "loginInteractive", "durationMs": 420,
                   "shell": "zsh", "pathEntries": 2})
        );
        assert!(!v.to_string().contains("secret"));
        let failed = shell::env::Attempt {
            result: Err(LoginEnvError::NoEof),
            mode: LoginMode::Login,
            duration: std::time::Duration::from_secs(10),
        };
        let s = status_of(&zsh, Some(LoginMode::Login), Some(&failed), false);
        assert_eq!(
            (s.state.as_str(), s.reason.as_deref()),
            ("failed", Some("noEof"))
        );
        assert_eq!(status_of(&zsh, None, Some(&ok), false).state, "off");
        assert_eq!(
            status_of(&zsh, Some(LoginMode::Login), None, true).state,
            "running"
        );
        let cmd = ShellKind::Cmd {
            program: r"C:\Windows\System32\cmd.exe".into(),
        };
        assert_eq!(status_of(&cmd, None, None, false).state, "notPosix");
    }

    #[test]
    fn result_wire_format() {
        let v = serde_json::to_value(ShellRunResult::Started {
            job_id: "j1".into(),
            notices: vec![],
        })
        .unwrap();
        assert_eq!(v, json!({"type": "started", "jobId": "j1", "notices": []}));
        let v = serde_json::to_value(ShellRunResult::Navigate { path: "/a".into() }).unwrap();
        assert_eq!(v, json!({"type": "navigate", "path": "/a"}));
        assert_eq!(
            serde_json::to_value(ShellRunResult::Back).unwrap(),
            json!({"type": "back"})
        );
    }
}
