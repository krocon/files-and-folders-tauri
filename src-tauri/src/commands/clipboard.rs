//! Command of "paste files": what the system clipboard holds as files.

use crate::commands::blocking;
use crate::error::{FsError, FsErrorCode};
use crate::listing::{self, DescribedPaths};
use tauri::{Runtime, WebviewWindow};

fn unreadable() -> FsError {
    FsError::new(FsErrorCode::Io, "The clipboard could not be read", None)
}

/// The files in the system clipboard (copied in Finder, Explorer, Files …),
/// described like dropped paths; empty when it holds no files. Only reads – the
/// copy starts in the window, from the normal dialog. The clipboard is read on
/// the main thread, the entries are looked at on a worker.
#[tauri::command]
pub async fn clipboard_files<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<DescribedPaths, FsError> {
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(crate::platform::clipboard::file_paths());
        })
        .map_err(|_| unreadable())?;
    blocking("Reading the clipboard", move || {
        let raw = rx.recv().unwrap_or_else(|_| Err(unreadable()))?;
        let (paths, refused) = crate::clipboard_files::checked(&raw)?;
        let mut described = listing::describe_paths(&paths);
        described.missing += refused;
        Ok(described)
    })
    .await
}
