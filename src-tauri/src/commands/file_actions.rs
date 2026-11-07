//! Commands of the double-click actions (design 072): load and save `file-actions.json`,
//! run a rule by id. Program and arguments come only from the file – the frontend never
//! sends a program to run.

use crate::commands::shell::tool_env;
use crate::commands::{ToolContextInput, blocking, config_dir, home_dir, launch_tool_with_env};
use crate::config_file::ConfigWarning;
use crate::error::{FsError, FsErrorCode};
use crate::file_actions::{self, FileActionProblem, FileActionRule};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// The rules as last loaded or saved, and whether the file may be written.
#[derive(Default)]
pub struct FileActionsState {
    pub(crate) rules: Mutex<Option<Vec<FileActionRule>>>,
    pub(crate) write_blocked: Mutex<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFileActions {
    pub rules: Vec<FileActionRule>,
    pub warning: Option<ConfigWarning>,
    pub problems: Vec<FileActionProblem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFileActions {
    /// False: nothing was written, see `problems`.
    pub saved: bool,
    pub rules: Vec<FileActionRule>,
    pub problems: Vec<FileActionProblem>,
}

fn set<T>(m: &Mutex<T>, value: T) {
    *m.lock().unwrap_or_else(|e| e.into_inner()) = value;
}

fn file_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, FsError> {
    Ok(config_dir(app)?.join(file_actions::FILE_NAME))
}

/// (Re)loads `file-actions.json`; a missing file means no rules.
#[tauri::command]
pub async fn load_file_actions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<LoadedFileActions, FsError> {
    let file = file_path(&app)?;
    let home = home_dir(&app).ok();
    let loaded = blocking("Loading the double-click actions", move || {
        Ok(file_actions::load(&file))
    })
    .await?;
    let state = app.state::<FileActionsState>();
    set(&state.write_blocked, !loaded.persist);
    set(&state.rules, Some(loaded.value.clone()));
    Ok(LoadedFileActions {
        problems: file_actions::problems(&loaded.value, home.as_deref()),
        rules: loaded.value,
        warning: loaded.warning,
    })
}

/// Replaces `file-actions.json` – only if no rule has a problem (else `saved: false`).
#[tauri::command]
pub async fn save_file_actions<R: Runtime>(
    app: AppHandle<R>,
    rules: Vec<FileActionRule>,
) -> Result<SavedFileActions, FsError> {
    if rules.len() > file_actions::MAX_RULES {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            format!("Too many rules (max. {})", file_actions::MAX_RULES),
            None,
        ));
    }
    let file = file_path(&app)?;
    let state = app.state::<FileActionsState>();
    if *state
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner())
    {
        return Err(FsError::new(
            FsErrorCode::Io,
            "The existing file could not be read or moved aside; not overwriting it.",
            Some(&file),
        ));
    }
    let home = home_dir(&app).ok();
    let rules = file_actions::sanitize(rules);
    let problems = file_actions::problems(&rules, home.as_deref());
    if !problems.is_empty() {
        return Ok(SavedFileActions {
            saved: false,
            rules,
            problems,
        });
    }
    let target = file.clone();
    let saved = blocking("Saving the double-click actions", move || {
        file_actions::save(&target, rules).map_err(|e| FsError::from_io(&e, &target))
    })
    .await?;
    set(&state.rules, Some(saved.clone()));
    Ok(SavedFileActions {
        saved: true,
        rules: saved,
        problems: Vec::new(),
    })
}

/// Runs rule `id` on `file` without a shell, in the file's folder and with the login `PATH`
/// (an app started from the Finder would not find `node` otherwise). A default-app launcher
/// reports an executable like Enter (`executable`); returns the number of started processes.
#[tauri::command]
pub async fn run_file_action<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    file: String,
    target_dir: Option<String>,
    allow_executable: Option<bool>,
) -> Result<usize, FsError> {
    let rules = {
        let cached = app
            .state::<FileActionsState>()
            .rules
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        match cached {
            Some(rules) => rules,
            None => load_file_actions(app.clone()).await?.rules,
        }
    };
    let rule = rules.iter().find(|r| r.id == id).ok_or_else(|| {
        FsError::new(
            FsErrorCode::UnknownTool,
            format!("There is no double-click action \"{id}\""),
            None,
        )
    })?;
    let home = home_dir(&app).ok();
    let tool = file_actions::to_tool(rule, home.as_deref()).map_err(|code| {
        FsError::new(
            FsErrorCode::InvalidPath,
            format!("{}: the rule is invalid ({code})", rule.command),
            None,
        )
    })?;
    let config = config_dir(&app)?;
    let env = blocking("Reading the login environment", move || {
        Ok(tool_env(&config))
    })
    .await?;
    let dir = Path::new(&file)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().into_owned());
    let ctx = ToolContextInput {
        files: vec![file],
        dir,
        target_dir,
    };
    launch_tool_with_env(
        &app,
        tool,
        ctx,
        allow_executable.unwrap_or(false),
        env,
        rule.terminal,
    )
    .await
}
