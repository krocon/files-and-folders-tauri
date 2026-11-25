//! Commands of the MCP interface (design 071): the window subscribes to requests,
//! reports its state and answers. Accepted from the main window only. The settings
//! (`mcp.enabled` …) are read by Rust from `settings.json` – `mcp_sync` only says
//! "read them again", it carries no value.

use super::{JobsState, MAIN_WINDOW, blocking, config_dir};
use crate::error::{FsError, FsErrorCode};
use crate::mcp::bridge::{UiEvent, UiReply};
use crate::mcp::state::UiState;
use crate::mcp::{Deps, McpError, McpHub, McpStatus, config};
use std::sync::{Arc, OnceLock};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

#[derive(Default)]
pub struct McpState {
    hub: OnceLock<Arc<McpHub>>,
}

impl McpState {
    pub fn hub(&self) -> Option<&Arc<McpHub>> {
        self.hub.get()
    }
}

fn to_fs(e: McpError) -> FsError {
    let code = if e.code == "limit_exceeded" {
        FsErrorCode::TooMany
    } else {
        FsErrorCode::Io
    };
    FsError::new(code, e.message, None)
}

fn hub_of<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<Arc<McpHub>, FsError> {
    if window.label() != MAIN_WINDOW {
        return Err(FsError::new(
            FsErrorCode::PermissionDenied,
            "MCP is managed from the main window only",
            None,
        ));
    }
    app.state::<McpState>()
        .hub()
        .cloned()
        .ok_or_else(|| FsError::new(FsErrorCode::Io, "MCP is not ready", None))
}

/// Creates the hub (off) and applies the stored settings in the background: with
/// `mcp.enabled` the socket appears, without it nothing listens.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let Ok(config_dir) = config_dir(app) else {
        return;
    };
    let paths = app.path();
    // the app's own folders are never visible to a client (settings, connections, caches)
    let denied = [
        paths.app_config_dir(),
        paths.app_data_dir(),
        paths.app_local_data_dir(),
        paths.app_cache_dir(),
        paths.app_log_dir(),
    ]
    .into_iter()
    .filter_map(Result::ok)
    .collect();
    let socket = if cfg!(unix) {
        config::socket_path_for_app()
    } else {
        Err(McpError::new(
            "unsupported",
            "MCP is not available on this platform yet",
        ))
    };
    let jobs = app.state::<JobsState>();
    let hub = McpHub::new(
        Deps {
            jobs: jobs.manager.clone(),
            home: paths.home_dir().ok(),
            config_dir,
            denied,
            socket,
        },
        jobs.mcp_tap.clone(),
    );
    if app.state::<McpState>().hub.set(hub.clone()).is_err() {
        return;
    }
    // reading the settings and binding the socket: not on the main thread
    let _ = std::thread::Builder::new()
        .name("fnf-mcp-init".into())
        .spawn(move || {
            hub.sync();
        });
}

/// The app ends: close the connections and remove the socket.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(hub) = app.state::<McpState>().hub() {
        hub.shutdown();
    }
}

/// Requests to the window and status changes go to this channel (one window).
#[tauri::command(async)]
pub fn subscribe_mcp<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    on_event: Channel<UiEvent>,
) -> Result<McpStatus, FsError> {
    let hub = hub_of(&app, &window)?;
    hub.bridge
        .set_sink(Some(Arc::new(move |event| on_event.send(event).is_ok())));
    Ok(hub.status())
}

/// The settings changed: read `settings.json` again and apply the `mcp.*` values.
#[tauri::command]
pub async fn mcp_sync<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<McpStatus, FsError> {
    let hub = hub_of(&app, &window)?;
    blocking("Applying the MCP settings", move || Ok(hub.sync())).await
}

/// The window reports its panels (ignored while MCP is off).
#[tauri::command(async)]
pub fn mcp_publish_state<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: UiState,
) -> Result<(), FsError> {
    let hub = hub_of(&app, &window)?;
    match hub.publish_state(state) {
        Err(e) if e.code != "mcp_disabled" => Err(to_fs(e)),
        _ => Ok(()),
    }
}

/// The window's answer to a request of `subscribe_mcp`.
#[tauri::command(async)]
pub fn mcp_reply<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    id: u64,
    reply: UiReply,
) -> Result<(), FsError> {
    hub_of(&app, &window)?.bridge.reply(id, reply);
    Ok(())
}

#[tauri::command(async)]
pub fn mcp_status<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<McpStatus, FsError> {
    Ok(hub_of(&app, &window)?.status())
}

/// "Disconnect": one connection, or all (`connection` = null).
#[tauri::command(async)]
pub fn mcp_disconnect<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    connection: Option<u64>,
) -> Result<(), FsError> {
    hub_of(&app, &window)?.disconnect(connection);
    Ok(())
}
