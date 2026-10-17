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
//! - [`fileops`]      create folder/file, rename (never overwrite)
//! - [`jobs`]         job engine: copy, move, delete, count, folder size; queue, progress, conflicts, cancel/pause
//! - [`commands`]     thin Tauri command layer

pub mod commands;
pub mod dirsize;
pub mod error;
pub mod fileops;
pub mod fs_atomic;
pub mod jobs;
pub mod keymap;
pub mod listing;
pub mod model;
pub mod opener;
pub mod paths;
pub mod platform;
pub mod session;
pub mod window_state;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::SessionState::default())
        .manage(commands::KeymapState::default())
        .manage(commands::JobsState::default())
        .setup(|app| {
            commands::init_session(app.handle());
            app.state::<commands::JobsState>()
                .manager
                .set_home(app.path().home_dir().ok());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != commands::MAIN_WINDOW {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let jobs = window.state::<commands::JobsState>();
                if jobs.must_ask_before_quit() {
                    // running jobs: the frontend asks, `cancel_all_and_quit` closes
                    api.prevent_close();
                    jobs.manager.request_quit();
                    return;
                }
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
            commands::open_file,
            commands::make_dir,
            commands::create_file,
            commands::rename_entry,
            commands::check_paths,
            commands::subscribe_jobs,
            commands::start_job,
            commands::cancel_job,
            commands::pause_job,
            commands::resume_job,
            commands::resolve_conflict,
            commands::list_jobs,
            commands::clear_finished_jobs,
            commands::cancel_all_and_quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Cmd+Q / quit from the menu does not send CloseRequested
            if let RunEvent::ExitRequested { api, .. } = event {
                let jobs = app.state::<commands::JobsState>();
                if jobs.must_ask_before_quit() {
                    api.prevent_exit();
                    jobs.manager.request_quit();
                    return;
                }
                commands::save_on_close(app);
            }
        });
}
