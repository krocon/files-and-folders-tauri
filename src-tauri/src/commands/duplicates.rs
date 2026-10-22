//! Commands of the duplicate search (design 042). The search itself is the job
//! `duplicates`, deleting copies the job `dedupe` (`start_job`); these are the helpers.

use crate::commands::blocking;
use crate::duplicates::thumbs;
use crate::error::{FsError, FsErrorCode};
use crate::paths::{normalize_lexically, validate_input_path};
use crate::rename_presets::{self, LoadedPresets, RenamePresets};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// File of the rule sets (same shape as `rename-presets.json`: `last` + named sets).
pub const RULES_FILE: &str = "duplicate-rules.json";
/// Paths and folders of one `classify_paths` call.
pub const MAX_CLASSIFY_PATHS: usize = 2_000_000;
pub const MAX_CLASSIFY_FOLDERS: usize = 32;

fn too_many(what: &str) -> FsError {
    FsError::new(FsErrorCode::TooMany, format!("Too many {what}"), None)
}

/// `result[i][j]`: path `i` lies in folder `j` (or below) – rule "in folder X" (E2a).
/// Purely lexical (no file system access): both sides are normalised, links are not
/// resolved – the rule compares the paths the user sees.
#[tauri::command]
pub async fn classify_paths(
    paths: Vec<String>,
    folders: Vec<String>,
) -> Result<Vec<Vec<bool>>, FsError> {
    if paths.len() > MAX_CLASSIFY_PATHS {
        return Err(too_many("paths"));
    }
    if folders.len() > MAX_CLASSIFY_FOLDERS {
        return Err(too_many("folders"));
    }
    let folders: Vec<PathBuf> = folders
        .iter()
        .map(|f| validate_input_path(f).map(|p| normalize_lexically(&p)))
        .collect::<Result<_, _>>()?;
    blocking("Classifying paths", move || {
        Ok(paths
            .iter()
            .map(|p| {
                let p = normalize_lexically(std::path::Path::new(p));
                folders.iter().map(|f| p.starts_with(f)).collect()
            })
            .collect())
    })
    .await
}

/// Thumbnail tokens (`fnfpreview` scheme) for images or comics; `None` where none can
/// be made (not an image, broken, too large).
#[tauri::command]
pub async fn duplicate_thumbnails(
    paths: Vec<String>,
    max_px: u32,
) -> Result<Vec<Option<String>>, FsError> {
    if paths.len() > thumbs::MAX_PATHS {
        return Err(too_many("thumbnails"));
    }
    let paths: Vec<PathBuf> = paths
        .iter()
        .map(|p| validate_input_path(p))
        .collect::<Result<_, _>>()?;
    blocking("Making thumbnails", move || {
        Ok(paths
            .iter()
            .map(|p| thumbs::thumbnail(p, max_px).ok())
            .collect())
    })
    .await
}

/// Whether the rule file may be written (false after a broken file could not be moved aside).
#[derive(Default)]
pub struct DupRulesState {
    write_blocked: Mutex<bool>,
}

fn rules_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(RULES_FILE))
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("App config directory not available: {e}"),
                None,
            )
        })
}

#[tauri::command]
pub async fn load_duplicate_rules<R: Runtime>(app: AppHandle<R>) -> Result<LoadedPresets, FsError> {
    let file = rules_file(&app)?;
    let loaded = blocking("Loading the rule sets", move || {
        Ok(rename_presets::load_named(&file, "duplicate rules"))
    })
    .await?;
    *app.state::<DupRulesState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = !loaded.persist;
    Ok(loaded)
}

#[tauri::command]
pub async fn save_duplicate_rules<R: Runtime>(
    app: AppHandle<R>,
    rules: RenamePresets,
) -> Result<(), FsError> {
    let file = rules_file(&app)?;
    let blocked = *app
        .state::<DupRulesState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if blocked {
        return Err(FsError::new(
            FsErrorCode::Io,
            "The existing rules file could not be moved aside; not overwriting it.",
            Some(&file),
        ));
    }
    blocking("Saving the rule sets", move || {
        rename_presets::save(&file, rules).map_err(|e| FsError::from_io(&e, &file))
    })
    .await
}
