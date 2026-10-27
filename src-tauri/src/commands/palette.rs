//! Commands of the universal palette (design 043): settings, status and queries.
//! Hits stream over the channel of each query; a new query cancels the running one.

use crate::error::{FsError, FsErrorCode};
use crate::palette::{self, Hub, IndexStatus, PaletteConfig, PaletteEvent, PaletteRequest};
use std::sync::Arc;
use tauri::ipc::Channel;

fn hub() -> Result<&'static Hub, FsError> {
    palette::hub().ok_or_else(|| FsError::new(FsErrorCode::Io, "The palette is not ready", None))
}

/// Takes over the settings (index on/off, roots, exclusions, memory, system search).
#[tauri::command]
pub async fn palette_configure(config: PaletteConfig) -> Result<IndexStatus, FsError> {
    let h = hub()?;
    // looks at the roots (archive or folder?) – file system work, not on the runtime thread
    tauri::async_runtime::spawn_blocking(move || h.configure(config))
        .await
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("Palette task failed: {e}"), None))?
}

#[tauri::command]
pub async fn palette_status() -> Result<IndexStatus, FsError> {
    Ok(hub()?.status())
}

/// Starts a query; returns its id at once – the hits and the end come as events.
#[tauri::command]
pub async fn palette_query(
    request: PaletteRequest,
    on_event: Channel<PaletteEvent>,
) -> Result<u64, FsError> {
    if request.text.len() > 4 * crate::palette::query::MAX_QUERY_LEN {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "The query is too long",
            None,
        ));
    }
    Ok(hub()?.query(
        request,
        Arc::new(move |e| {
            let _ = on_event.send(e);
        }),
    ))
}

/// Cancels query `id` if it still runs (the palette was closed); `None` = the running one.
#[tauri::command]
pub async fn palette_cancel(id: Option<u64>) -> Result<(), FsError> {
    hub()?.cancel(id);
    Ok(())
}

/// Builds the index again now.
#[tauri::command]
pub async fn palette_rebuild() -> Result<IndexStatus, FsError> {
    let h = hub()?;
    h.rebuild();
    Ok(h.status())
}

/// Drops the index from memory (it is built again on "Rebuild" or the next start).
#[tauri::command]
pub async fn palette_clear() -> Result<IndexStatus, FsError> {
    let h = hub()?;
    h.clear();
    Ok(h.status())
}
