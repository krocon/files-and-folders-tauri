//! Commands of the starter menu (design 032): load and save `starter.json`, run an
//! entry by id. Program and arguments come only from the file – the frontend never
//! sends a program to run.

use crate::commands::{ToolContextInput, blocking, config_dir, home_dir, launch_tool};
use crate::config_file::ConfigWarning;
use crate::error::{FsError, FsErrorCode};
use crate::starter::{self, StarterItem, StarterKind, StarterProblem};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// The entries as last loaded or saved, and whether the file may be written.
#[derive(Default)]
pub struct StarterState {
    pub(crate) items: Mutex<Option<Vec<StarterItem>>>,
    pub(crate) write_blocked: Mutex<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedStarter {
    pub items: Vec<StarterItem>,
    pub warning: Option<ConfigWarning>,
    pub problems: Vec<StarterProblem>,
    /// Path of `starter.json` (may not exist yet).
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedStarter {
    /// False: nothing was written, see `problems`.
    pub saved: bool,
    pub items: Vec<StarterItem>,
    pub problems: Vec<StarterProblem>,
}

/// What a starter entry works on (paths are checked like for the tools).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterContextInput {
    /// Marked entries (else the cursor) in display order – for `%S`.
    #[serde(default)]
    pub files: Vec<String>,
    /// The entry under the cursor – for `%P%N`, `%N`, …
    pub cursor: Option<String>,
    pub dir: Option<String>,
    pub target_dir: Option<String>,
}

/// What running an entry did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum StarterRun {
    /// `count` processes were started.
    Started { count: usize },
    /// A folder entry: the frontend opens `path` in the active panel.
    Folder { path: String },
}

fn set<T>(m: &Mutex<T>, value: T) {
    *m.lock().unwrap_or_else(|e| e.into_inner()) = value;
}

fn file_path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, FsError> {
    Ok(config_dir(app)?.join(starter::FILE_NAME))
}

/// (Re)loads `starter.json`; a missing file is an empty menu.
#[tauri::command]
pub async fn load_starter<R: Runtime>(app: AppHandle<R>) -> Result<LoadedStarter, FsError> {
    let file = file_path(&app)?;
    let home = home_dir(&app).ok();
    let path = file.to_string_lossy().into_owned();
    let loaded = blocking("Loading the starter menu", move || Ok(starter::load(&file))).await?;
    let state = app.state::<StarterState>();
    set(&state.write_blocked, !loaded.persist);
    set(&state.items, Some(loaded.value.clone()));
    Ok(LoadedStarter {
        problems: starter::problems(&loaded.value, home.as_deref()),
        items: loaded.value,
        warning: loaded.warning,
        file: Some(path),
    })
}

/// Replaces `starter.json` – only if no entry has a problem (else `saved: false`).
#[tauri::command]
pub async fn save_starter<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<StarterItem>,
) -> Result<SavedStarter, FsError> {
    if starter::count(&items) > starter::MAX_ITEMS {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            format!("Too many entries (max. {})", starter::MAX_ITEMS),
            None,
        ));
    }
    let file = file_path(&app)?;
    let state = app.state::<StarterState>();
    if *state.write_blocked.lock().unwrap_or_else(|e| e.into_inner()) {
        return Err(FsError::new(
            FsErrorCode::Io,
            "The existing file could not be read or moved aside; not overwriting it.",
            Some(&file),
        ));
    }
    let home = home_dir(&app).ok();
    let items = starter::sanitize(items);
    let problems = starter::problems(&items, home.as_deref());
    if !problems.is_empty() {
        return Ok(SavedStarter {
            saved: false,
            items,
            problems,
        });
    }
    let target = file.clone();
    let saved = blocking("Saving the starter menu", move || {
        starter::save(&target, items).map_err(|e| FsError::from_io(&e, &target))
    })
    .await?;
    set(&state.items, Some(saved.clone()));
    Ok(SavedStarter {
        saved: true,
        items: saved,
        problems: Vec::new(),
    })
}

/// Runs the entry `id`: a program starts (like a tool, no shell), a folder entry returns
/// its path. Default-app launchers report an executable like Enter (`executable`).
#[tauri::command]
pub async fn run_starter<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    context: StarterContextInput,
    allow_executable: Option<bool>,
) -> Result<StarterRun, FsError> {
    let items = {
        let cached = app
            .state::<StarterState>()
            .items
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        match cached {
            Some(items) => items,
            None => load_starter(app.clone()).await?.items,
        }
    };
    let unknown = || {
        FsError::new(
            FsErrorCode::UnknownTool,
            format!("There is no starter entry \"{id}\""),
            None,
        )
    };
    let item = starter::find(&items, &id).ok_or_else(unknown)?.clone();
    let home = home_dir(&app).ok();
    let invalid = |code: &str| {
        FsError::new(
            FsErrorCode::InvalidPath,
            format!("{}: the entry is invalid ({code})", item.label),
            None,
        )
    };
    match item.kind {
        StarterKind::Folder => {
            let path = starter::folder_target(&item, home.as_deref()).map_err(invalid)?;
            Ok(StarterRun::Folder {
                path: path.to_string_lossy().into_owned(),
            })
        }
        StarterKind::Program => {
            let tool = starter::to_tool(&item, home.as_deref()).map_err(invalid)?;
            // `%P%N` & co. mean the cursor file; only `%S` takes all marked entries
            let files = if starter::uses_all_files(&item) {
                context.files
            } else {
                context
                    .cursor
                    .or_else(|| context.files.into_iter().next())
                    .into_iter()
                    .collect()
            };
            let ctx = ToolContextInput {
                files,
                dir: context.dir,
                target_dir: context.target_dir,
            };
            let count = launch_tool(&app, tool, ctx, allow_executable.unwrap_or(false)).await?;
            Ok(StarterRun::Started { count })
        }
        StarterKind::Submenu | StarterKind::Separator => Err(unknown()),
    }
}
