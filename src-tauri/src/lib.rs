//! Files and Folders – Tauri backend.
//!
//! Module overview:
//! - [`error`]        structured, serialisable file-system errors
//! - [`model`]        DTOs shared with the Angular frontend (keep in sync with `src/app/core/fs/fs.models.ts`)
//! - [`paths`]        platform-aware path helpers (validation, parent, breadcrumbs)
//! - [`listing`]      directory listing logic (pure, unit-tested, no Tauri dependency)
//! - [`session`]      session file (tabs, panels, favourites; pure, unit-tested)
//! - [`window_state`] window geometry restore/capture
//! - [`keymap`]       user override of the keyboard shortcuts
//! - [`fs_atomic`]    atomic writes of config files
//! - [`dirsize`]      recursive folder size (no symlinks, cancellable)
//! - [`opener`]       open files with the default app (checked)
//! - [`commands`]     thin Tauri command layer

pub mod commands;
pub mod dirsize;
pub mod error;
pub mod fs_atomic;
pub mod keymap;
pub mod listing;
pub mod model;
pub mod opener;
pub mod paths;
pub mod session;
pub mod window_state;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::SessionState::default())
        .manage(commands::KeymapState::default())
        .manage(commands::DirSizeJobs::default())
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
            commands::save_session,
            commands::load_keymap_override,
            commands::save_keymap_override,
            commands::resolve_location,
            commands::calc_dir_size,
            commands::cancel_dir_size,
            commands::open_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Cmd+Q / quit from the menu does not send CloseRequested
            if let RunEvent::ExitRequested { .. } = event {
                commands::save_on_close(app);
            }
        });
}
