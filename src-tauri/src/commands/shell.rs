//! Commands of the shell bar (design 021). `run_shell` is the only way a shell
//! command starts (`JobSpec::Shell` cannot be deserialised, so `start_job`
//! cannot); it is accepted from the main window only and when `shell.enabled`
//! is on in `settings.json`. Commands and output are never logged.

use super::{JobsState, blocking, config_dir, home_dir};
use crate::error::{FsError, FsErrorCode};
use crate::jobs::{JobSpec, ShellLaunch};
use crate::settings;
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
    /// A shell job runs; `notices` are codes for the frontend (e.g. `loginEnvUnavailable`).
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
    pub login_path: bool,
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
        login_path: get("shell.loginPath").as_bool().unwrap_or(true),
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
    let (env, notices) = if cfg.login_path && !kind.is_windows_style() {
        let k = kind.clone();
        let env = blocking("Reading the login environment", move || {
            Ok(shell::env::login_env(&k))
        })
        .await?;
        match env {
            Some(env) => (env, Vec::new()),
            None => (Vec::new(), vec!["loginEnvUnavailable".to_string()]),
        }
    } else {
        (Vec::new(), Vec::new())
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
        if cfg.enabled && cfg.login_path {
            let kind = shell::choose(&cfg.windows_shell);
            if !kind.is_windows_style() {
                let _ = std::thread::Builder::new()
                    .name("fnf-login-env".into())
                    .spawn(move || {
                        shell::env::login_env(&kind);
                    });
            }
        }
        Ok(history::load(&config.join(history::FILE_NAME)))
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
                login_path: true,
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
