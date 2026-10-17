//! Files and Folders – Tauri backend.
//!
//! Module overview:
//! - [`error`]        structured, serialisable file-system errors
//! - [`model`]        DTOs shared with the Angular frontend (keep in sync with `src/app/core/fs/fs.models.ts`)
//! - [`paths`]        platform-aware path helpers (validation, parent, breadcrumbs)
//! - [`listing`]      directory listing logic (pure, unit-tested, no Tauri dependency)
//! - [`session`]      session file (tabs, panels, favourites; pure, unit-tested)
//! - [`window_state`] window geometry restore/capture
//! - [`commands`]     thin Tauri command layer

pub mod commands;
pub mod error;
pub mod listing;
pub mod model;
pub mod paths;
pub mod session;
pub mod window_state;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::SessionState::default())
        .setup(|app| {
            commands::init_session(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == commands::MAIN_WINDOW
                && matches!(event, WindowEvent::CloseRequested { .. })
            {
                commands::save_on_close(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::load_session,
            commands::save_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
