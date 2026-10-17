//! Commands of design 012: folder watching and dropped paths.

use crate::error::{FsError, FsErrorCode};
use crate::listing::{self, DescribedPaths};
use crate::paths::validate_input_path;
use crate::watch::{WatchEvent, WatchHub, WatchStatus};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

/// At most this many dropped paths are described.
pub const MAX_DROPPED: usize = 10_000;

type Subscribers = Arc<Mutex<HashMap<String, Channel<WatchEvent>>>>;

pub struct WatchState {
    hub: WatchHub,
    subscribers: Subscribers,
}

impl Default for WatchState {
    fn default() -> Self {
        let subscribers: Subscribers = Arc::default();
        let sink_subs = subscribers.clone();
        let hub = WatchHub::new(Arc::new(move |event: WatchEvent| {
            // channels of closed webviews fail – drop them
            sink_subs
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|_, ch| ch.send(event.clone()).is_ok());
        }));
        Self { hub, subscribers }
    }
}

/// Receives the watch events of this webview.
#[tauri::command]
pub fn subscribe_watch<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    on_event: Channel<WatchEvent>,
) {
    app.state::<WatchState>()
        .subscribers
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(webview.label().to_string(), on_event);
}

/// Watches exactly these folders (the visible ones of both panels).
#[tauri::command]
pub async fn watch_dirs<R: Runtime>(
    app: AppHandle<R>,
    dirs: Vec<String>,
    poll_network: bool,
) -> Result<Vec<WatchStatus>, FsError> {
    let dirs = dirs
        .iter()
        .map(|d| validate_input_path(d))
        .collect::<Result<Vec<_>, _>>()?;
    // statfs on a hanging network mount may block
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<WatchState>().hub.set_dirs(&dirs, poll_network)
    })
    .await
    .map_err(|e| FsError::new(FsErrorCode::Io, format!("Watch task failed: {e}"), None))?
}

/// Describes paths dropped onto the window (absolute, existing ones).
#[tauri::command]
pub async fn describe_paths(paths: Vec<String>) -> Result<DescribedPaths, FsError> {
    if paths.len() > MAX_DROPPED {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            format!("At most {MAX_DROPPED} items can be dropped at once"),
            None,
        ));
    }
    let paths = paths
        .iter()
        .map(|p| validate_input_path(p))
        .collect::<Result<Vec<_>, _>>()?;
    tauri::async_runtime::spawn_blocking(move || listing::describe_paths(&paths))
        .await
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("Describe task failed: {e}"), None))
}
