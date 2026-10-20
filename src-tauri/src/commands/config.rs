//! Commands of design 022: the user files of the button bar and the file type
//! categories, and full screen for Windows/Linux (J14).

use crate::buttons::{self, ButtonsOverride, Sets};
use crate::commands::{MAIN_WINDOW, blocking, config_dir};
use crate::config_file::Loaded;
use crate::error::{FsError, FsErrorCode};
use crate::filetypes::{self, FileType};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// Whether `buttons.json` may be written (false after a file stayed that we could not read or move aside).
#[derive(Default)]
pub struct ButtonsState {
    pub(crate) write_blocked: Mutex<bool>,
}

/// Same for `filetypes.json`.
#[derive(Default)]
pub struct FileTypesState {
    pub(crate) write_blocked: Mutex<bool>,
}

fn set_blocked(m: &Mutex<bool>, blocked: bool) {
    *m.lock().unwrap_or_else(|e| e.into_inner()) = blocked;
}

fn is_blocked(m: &Mutex<bool>) -> bool {
    *m.lock().unwrap_or_else(|e| e.into_inner())
}

fn not_overwriting(file: &Path) -> FsError {
    FsError::new(
        FsErrorCode::Io,
        "The existing file could not be read or moved aside; not overwriting it.",
        Some(file),
    )
}

/// The user's button sets (empty = all built in) and a load problem.
#[tauri::command]
pub async fn load_buttons<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Loaded<ButtonsOverride>, FsError> {
    let file = config_dir(&app)?.join(buttons::FILE_NAME);
    let loaded = blocking("Loading the buttons", move || Ok(buttons::load(&file))).await?;
    set_blocked(&app.state::<ButtonsState>().write_blocked, !loaded.persist);
    Ok(loaded)
}

/// Replaces `buttons.json` (bounded, written atomically).
#[tauri::command]
pub async fn save_buttons<R: Runtime>(app: AppHandle<R>, sets: Sets) -> Result<(), FsError> {
    if sets.len() > buttons::SETS.len() {
        return Err(FsError::new(FsErrorCode::TooMany, "Too many sets", None));
    }
    let file = config_dir(&app)?.join(buttons::FILE_NAME);
    if is_blocked(&app.state::<ButtonsState>().write_blocked) {
        return Err(not_overwriting(&file));
    }
    blocking("Saving the buttons", move || {
        buttons::save(&file, sets).map_err(|e| FsError::from_io(&e, &file))
    })
    .await
}

/// The user's file type categories (`null` = none, the built-in ones apply).
#[tauri::command]
pub async fn load_file_types<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Loaded<Option<Vec<FileType>>>, FsError> {
    let file = config_dir(&app)?.join(filetypes::FILE_NAME);
    let loaded = blocking("Loading the file types", move || Ok(filetypes::load(&file))).await?;
    set_blocked(
        &app.state::<FileTypesState>().write_blocked,
        !loaded.persist,
    );
    Ok(loaded)
}

/// Replaces `filetypes.json`; `null` removes it (back to the built-in categories).
#[tauri::command]
pub async fn save_file_types<R: Runtime>(
    app: AppHandle<R>,
    categories: Option<Vec<FileType>>,
) -> Result<(), FsError> {
    if categories
        .as_ref()
        .is_some_and(|c| c.len() > filetypes::MAX_CATEGORIES)
    {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            format!("Too many file types (max. {})", filetypes::MAX_CATEGORIES),
            None,
        ));
    }
    let file = config_dir(&app)?.join(filetypes::FILE_NAME);
    if is_blocked(&app.state::<FileTypesState>().write_blocked) {
        return Err(not_overwriting(&file));
    }
    blocking("Saving the file types", move || {
        filetypes::save(&file, categories).map_err(|e| FsError::from_io(&e, &file))
    })
    .await
}

/// Full screen on/off for the main window (J14); returns the new state.
/// Rust window API – no capability for the frontend.
#[tauri::command]
pub async fn toggle_fullscreen<R: Runtime>(app: AppHandle<R>) -> Result<bool, FsError> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return Ok(false);
    };
    let io = |e: tauri::Error| FsError::new(FsErrorCode::Io, e.to_string(), None);
    let next = !window.is_fullscreen().map_err(io)?;
    window.set_fullscreen(next).map_err(io)?;
    Ok(next)
}
