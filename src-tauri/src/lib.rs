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
//! - [`jobs`]         job engine: copy, move, delete, multi-rename (+ undo), count, folder size; queue, progress, conflicts, cancel/pause
//! - [`preview`]      bounded file preview (type by content, encodings), image scheme `fnfpreview`
//! - [`properties`]   properties of an entry (times, permissions/attributes, owner, link)
//! - [`rename_presets`] multi-rename presets file
//! - [`themes`]       colour schemes file, import/export of scheme files
//! - [`tools`]        external tools: config (`tools.json`), placeholders, start without a shell
//! - [`platform`]     per-OS code: no-replace rename, volumes, file manager, terminal
//! - [`watch`]        watching the shown folders (debounced, incremental, polling fallback)
//! - [`search`]       recursive search: criteria, name/content matching, cycle-safe walk (design 009)
//! - [`about`]        data for the About dialog (version, platform; design 017)
//! - [`archive`]      archives as virtual folders: ZIP/TAR/TAR.GZ index, name checks, zip-bomb limits (design 016)
//! - [`duplicates`]   duplicate files: size → partial hash → full SHA-256 (design 016)
//! - [`app_menu`]     native menu bar from the frontend's menu model (design 014)
//! - [`commands`]     thin Tauri command layer

pub mod about;
pub mod app_menu;
pub mod archive;
pub mod clean;
pub mod commands;
pub mod dirsize;
pub mod duplicates;
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
pub mod preview;
pub mod properties;
pub mod rename_presets;
pub mod search;
pub mod session;
pub mod settings;
pub mod shell;
pub mod themes;
pub mod tools;
pub mod watch;
pub mod window_state;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::SessionState::default())
        .manage(commands::KeymapState::default())
        .manage(commands::JobsState::default())
        .manage(commands::PresetsState::default())
        .manage(commands::ThemesState::default())
        .manage(commands::SettingsState::default())
        .manage(commands::CleanScanState::default())
        .manage(commands::ToolsState::default())
        .manage(commands::PreviewState::default())
        .manage(commands::MenuState::default())
        .on_menu_event(|app, event| commands::forward_menu_event(app, event.id().as_ref()))
        .manage(commands::watch::WatchState::default())
        .manage(commands::shell::ShellState::default())
        .register_asynchronous_uri_scheme_protocol(preview::SCHEME, |ctx, request, responder| {
            let state = ctx.app_handle().state::<commands::PreviewState>();
            // at most MAX_CONCURRENT_IMAGES reads (and threads) at once, else 503
            let Some(slot) = state.slots.try_acquire() else {
                responder.respond(commands::preview_busy_response());
                return;
            };
            let tokens = state.tokens.clone();
            let path = request.uri().path().to_owned();
            // reading an image may take a moment: never on the main/runtime thread
            std::thread::spawn(move || {
                let _slot = slot;
                responder.respond(commands::preview_response(&tokens, &path))
            });
        })
        .setup(|app| {
            commands::init_session(app.handle());
            app.state::<commands::JobsState>()
                .manager
                .set_home(app.path().home_dir().ok());
            // folders a job writes into: the watcher holds their reloads back until it
            // ends and pauses polling there (design 029 E8)
            {
                let handle = app.handle().clone();
                app.state::<commands::JobsState>()
                    .manager
                    .set_target_guard(std::sync::Arc::new(move |dirs| {
                        let token = handle
                            .state::<commands::watch::WatchState>()
                            .hub()
                            .busy(dirs);
                        let handle = handle.clone();
                        Box::new(move || {
                            handle
                                .state::<commands::watch::WatchState>()
                                .hub()
                                .release(token)
                        })
                    }));
            }
            // Windows: a watched folder keeps itself and its parents from being
            // renamed or deleted – pause the watches below what a job changes (review 012 #3)
            if cfg!(windows) {
                let handle = app.handle().clone();
                app.state::<commands::JobsState>()
                    .manager
                    .set_fs_guard(std::sync::Arc::new(move |paths| {
                        let state = handle.state::<commands::watch::WatchState>();
                        let paused = state.hub().pause_under(paths);
                        let handle = handle.clone();
                        Box::new(move || {
                            handle
                                .state::<commands::watch::WatchState>()
                                .hub()
                                .resume(&paused)
                        })
                    }));
            }
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
            commands::shell::run_shell,
            commands::shell::shell_quote,
            commands::shell::load_shell_history,
            commands::shell::clear_shell_history,
            commands::get_app_info,
            commands::load_session,
            commands::save_session,
            commands::load_settings,
            commands::save_settings,
            commands::export_settings,
            commands::import_settings,
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
            commands::cancel_all_and_quit,
            commands::plan_rename,
            commands::create_folders,
            commands::find_empty_dirs,
            commands::cancel_clean_scan,
            commands::undo_rename,
            commands::load_rename_presets,
            commands::save_rename_presets,
            commands::list_volumes,
            commands::reveal_in_file_manager,
            commands::open_terminal,
            commands::load_tools,
            commands::run_tool,
            commands::open_tools_config,
            commands::read_preview,
            commands::get_properties,
            commands::load_themes,
            commands::save_themes,
            commands::import_theme,
            commands::export_theme,
            commands::set_app_menu,
            commands::set_menu_enabled,
            commands::subscribe_menu,
            commands::close_main_window,
            commands::watch::subscribe_watch,
            commands::watch::watch_dirs,
            commands::watch::describe_paths
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
