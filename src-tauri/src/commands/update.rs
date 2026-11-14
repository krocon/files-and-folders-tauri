//! Commands of the update check (design 075): one request to a fixed GitHub URL, the
//! state file `update-check.json`, opening the release page. The frontend never sends
//! a URL that is fetched; a page to open is checked against our release prefix.

use crate::commands::{blocking, config_dir};
use crate::error::{FsError, FsErrorCode};
use crate::update_check::{self, UpdateInfo, UpdateState};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

/// One writer of `update-check.json` at a time.
static STATE_LOCK: Mutex<()> = Mutex::new(());

fn state_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    Ok(config_dir(app)?.join(update_check::FILE_NAME))
}

fn change_state(file: PathBuf, f: impl FnOnce(&mut UpdateState)) -> Result<(), FsError> {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = update_check::load_state(&file);
    f(&mut state);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| FsError::from_io(&e, dir))?;
    }
    update_check::save_state(&file, &state).map_err(|e| FsError::from_io(&e, &file))
}

/// Asks GitHub for the latest published release and compares it with this version.
/// Every attempt is recorded as `lastCheck` (E7), also a failed one.
#[tauri::command]
pub async fn check_for_update<R: Runtime>(app: AppHandle<R>) -> Result<UpdateInfo, FsError> {
    let current = app.package_info().version.to_string();
    let now = update_check::now_ms();
    if let Ok(file) = state_file(&app) {
        // a state that cannot be written must not stop the check
        let _ = blocking("Saving the update state", move || {
            change_state(file, |s| s.last_check = Some(now))
        })
        .await;
    }
    let body = update_check::fetch(update_check::LATEST_URL, &current, true).await?;
    blocking("Reading the release", move || {
        update_check::evaluate(&current, &body, now)
    })
    .await
}

#[tauri::command]
pub async fn load_update_state<R: Runtime>(app: AppHandle<R>) -> Result<UpdateState, FsError> {
    let file = state_file(&app)?;
    blocking("Loading the update state", move || {
        Ok(update_check::load_state(&file))
    })
    .await
}

/// Remembers a version whose hint is not shown again; `None` forgets it.
#[tauri::command]
pub async fn skip_update_version<R: Runtime>(
    app: AppHandle<R>,
    version: Option<String>,
) -> Result<(), FsError> {
    let skipped = update_check::skip_version(version.as_deref())?;
    let file = state_file(&app)?;
    blocking("Saving the update state", move || {
        change_state(file, |s| s.skipped = skipped)
    })
    .await
}

/// Opens the release page in the default browser – only a page of our releases (E10).
#[tauri::command]
pub async fn open_release_page(url: Option<String>) -> Result<(), FsError> {
    let url = update_check::safe_release_url(url.as_deref());
    blocking("Opening the release page", move || {
        open::that_detached(&url).map_err(|e| {
            FsError::new(
                FsErrorCode::ProgramNotFound,
                format!("No browser: {e}"),
                None,
            )
        })
    })
    .await
}
