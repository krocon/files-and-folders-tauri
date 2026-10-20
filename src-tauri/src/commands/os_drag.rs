//! Command of design 028: drag entries out of the window into other programs.

use crate::commands::blocking;
use crate::error::{FsError, FsErrorCode};
use tauri::{Runtime, WebviewWindow};

/// Starts a system drag ("copy") of these entries from the calling window.
/// Paths are checked first (E2); the start runs on the main thread. On Windows
/// the answer comes after the drop (`DoDragDrop` is modal).
#[tauri::command]
pub async fn start_os_drag<R: Runtime>(
    window: WebviewWindow<R>,
    paths: Vec<String>,
) -> Result<(), FsError> {
    let paths = blocking("Checking the dragged items", move || {
        crate::os_drag::validate_drag_paths(&paths)
    })
    .await?;
    let (tx, rx) = std::sync::mpsc::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(crate::platform::os_drag::start(&target, paths));
        })
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("The drag could not be started: {e}"),
                None,
            )
        })?;
    blocking("Starting the drag", move || {
        rx.recv().unwrap_or_else(|_| {
            Err(FsError::new(
                FsErrorCode::Io,
                "The drag could not be started",
                None,
            ))
        })
    })
    .await
}
