//! Tauri command layer. Kept thin: validate input, resolve defaults, run the
//! blocking file-system work off the async runtime threads.

use crate::error::{FsError, FsErrorCode};
use crate::listing;
use crate::model::DirectoryListing;
use crate::paths::validate_input_path;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

/// Lists a directory. `path = None` lists the current user's home directory.
#[tauri::command]
pub async fn list_directory<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
) -> Result<DirectoryListing, FsError> {
    let dir = resolve_dir(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || listing::list_directory(&dir))
        .await
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("Listing task failed: {e}"), None))?
}

fn resolve_dir<R: Runtime>(app: &AppHandle<R>, path: Option<String>) -> Result<PathBuf, FsError> {
    match path {
        Some(p) => validate_input_path(&p),
        None => app.path().home_dir().map_err(|e| {
            FsError::new(
                FsErrorCode::NoHomeDirectory,
                format!("Home directory could not be determined: {e}"),
                None,
            )
        }),
    }
}
