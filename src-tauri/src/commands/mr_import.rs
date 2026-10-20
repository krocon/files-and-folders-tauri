//! Commands of design 026: read the configuration of files-and-folders-mr and write
//! the parts the user chose (with backups).

use crate::commands::{blocking, config_dir, reload_tools, resolve_input, unblock_imported};
use crate::error::{FsError, FsErrorCode};
use crate::mr_import::{self, MrApply, MrApplyReport, MrScan, keys::MrOs};
use crate::settings::ConfigFiles;
use tauri::{AppHandle, Runtime};

/// Finds mr's `assets` folder at or below `path` and translates what it contains.
#[tauri::command]
pub async fn scan_old_config<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<MrScan, FsError> {
    let path = resolve_input(&app, &path)?;
    blocking("Reading the old configuration", move || {
        mr_import::scan_path(&path, MrOs::current())
    })
    .await
}

/// Writes the planned parts into the app config directory (backups first); the
/// frontend reloads its stores afterwards.
#[tauri::command]
pub async fn apply_old_config<R: Runtime>(
    app: AppHandle<R>,
    plan: MrApply,
) -> Result<MrApplyReport, FsError> {
    if !mr_import::plan_ok(&plan) {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            "The import is too big",
            None,
        ));
    }
    if let Some(root) = &plan.tools_from {
        resolve_input(&app, root)?;
    }
    let files = ConfigFiles::in_dir(&config_dir(&app)?);
    let report = blocking("Importing the old configuration", move || {
        Ok(mr_import::apply(&files, plan, MrOs::current()))
    })
    .await?;
    unblock_imported(&app, &report.imported);
    if report.imported.iter().any(|p| p == "tools") {
        reload_tools(&app).await;
    }
    Ok(report)
}
