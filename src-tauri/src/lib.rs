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
//! - [`starter`]      starter menu (`starter.json`, TC placeholders, design 032)
//! - [`tools`]        external tools: config (`tools.json`), placeholders, start without a shell
//! - [`platform`]     per-OS code: no-replace rename, volumes, file manager, terminal
//! - [`watch`]        watching the shown folders (debounced, incremental, polling fallback)
//! - [`search`]       recursive search: criteria, name/content matching, cycle-safe walk (design 009)
//! - [`about`]        data for the About dialog (version, platform; design 017)
//! - [`archive`]      archives as virtual folders: ZIP/TAR/TAR.GZ/7z/RAR index, name checks, zip-bomb limits,
//!   passwords, view cache (designs 016, 025)
//! - [`duplicates`]   duplicate files: size → partial hash → full SHA-256 (design 016)
//! - [`app_menu`]     native menu bar from the frontend's menu model (design 014)
//! - [`buttons`], [`filetypes`] user files of the button bar and the file type categories (design 022)
//! - [`checksum`] checksums: hashing, GNU/BSD checksum files, hostile names (design 039)
//! - [`diff`] comparing two files: text side by side, binary byte by byte (design 037)
//! - [`folder_memory`] cursor, marks and scroll of the last folders per tab (design 027)
//! - [`config_file`]  shared loader of small config files (missing / broken → `.bad` / unreadable)
//! - [`remote`]       server connections FTP/FTPS/SFTP: profiles, keychain, trust, protocols (design 034)
//! - [`secret`]       secret texts (passwords) – never printed or serialised
//! - [`commands`]     thin Tauri command layer

pub mod about;
pub mod app_menu;
pub mod archive;
pub mod attributes;
pub mod buttons;
pub mod checksum;
pub mod clean;
pub mod commands;
pub mod compare;
pub mod config_file;
pub mod diff;
pub mod dirsize;
pub mod disk_usage;
pub mod duplicates;
pub mod error;
pub mod fileops;
pub mod filetypes;
pub mod folder_memory;
pub mod fs_atomic;
pub mod jobs;
pub mod keymap;
pub mod listing;
pub mod listing_gate;
pub mod model;
pub mod mr_import;
pub mod opener;
pub mod os_drag;
pub mod palette;
pub mod paths;
pub mod platform;
pub mod preview;
pub mod properties;
pub mod remote;
pub mod rename_presets;
pub mod search;
pub mod secret;
pub mod session;
pub mod settings;
pub mod shell;
pub mod starter;
#[cfg(test)]
pub mod test_paths;
pub mod test_slow;
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
        .manage(commands::duplicates::DupRulesState::default())
        .manage(commands::ThemesState::default())
        .manage(commands::SettingsState::default())
        .manage(commands::CleanScanState::default())
        .manage(commands::ToolsState::default())
        .manage(commands::PreviewState::default())
        .manage(commands::MenuState::default())
        .on_menu_event(|app, event| commands::forward_menu_event(app, event.id().as_ref()))
        .manage(commands::watch::WatchState::default())
        .manage(commands::shell::ShellState::default())
        .manage(commands::config::ButtonsState::default())
        .manage(commands::config::FileTypesState::default())
        .manage(commands::config::FolderMemoryState::default())
        .manage(commands::starter::StarterState::default())
        .manage(commands::remote::RemoteState::default())
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
            // files opened from archives: private cache folder, stale runs removed (design 025 E5)
            if let Ok(dir) = app.path().app_cache_dir() {
                archive::view::init(&dir.join("archive-view"));
            }
            app.state::<commands::JobsState>()
                .manager
                .set_home(app.path().home_dir().ok());
            // the palette's name index (design 043): built in the background, memory only
            palette::init(app.path().home_dir().ok());
            // server connections (design 034): profiles in the config folder, nothing connects yet
            if let Ok(dir) = app.path().app_config_dir() {
                remote::init(dir, app.path().home_dir().ok().as_deref());
            }
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
                        // resuming a polled folder scans it (slow drive!): not on the job
                        // thread, whose end the user waits for (review 029 #1)
                        Box::new(move || {
                            let slot = std::sync::Arc::new(std::sync::Mutex::new(Some(token)));
                            let release = {
                                let (slot, handle) = (slot.clone(), handle.clone());
                                move || {
                                    let token =
                                        slot.lock().unwrap_or_else(|e| e.into_inner()).take();
                                    if let Some(token) = token {
                                        handle
                                            .state::<commands::watch::WatchState>()
                                            .hub()
                                            .release(token);
                                    }
                                }
                            };
                            let spawned = std::thread::Builder::new()
                                .name("fnf-watch-release".into())
                                .spawn(release);
                            if spawned.is_err() {
                                // no thread: release here rather than hold the reloads for ever
                                let token = slot.lock().unwrap_or_else(|e| e.into_inner()).take();
                                if let Some(token) = token {
                                    handle
                                        .state::<commands::watch::WatchState>()
                                        .hub()
                                        .release(token);
                                }
                            }
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
            commands::disk_usage::disk_usage_view,
            commands::disk_usage::disk_usage_largest,
            commands::disk_usage::disk_usage_locate,
            commands::disk_usage::disk_usage_prune,
            commands::disk_usage::disk_usage_release,
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
            commands::start_job_now,
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
            commands::duplicates::classify_paths,
            commands::duplicates::duplicate_thumbnails,
            commands::duplicates::load_duplicate_rules,
            commands::duplicates::save_duplicate_rules,
            commands::list_volumes,
            commands::reveal_in_file_manager,
            commands::open_terminal,
            commands::load_tools,
            commands::run_tool,
            commands::open_tools_config,
            commands::read_preview,
            commands::diff_files,
            commands::get_properties,
            commands::load_themes,
            commands::save_themes,
            commands::import_theme,
            commands::export_theme,
            commands::set_window_chrome,
            commands::set_app_menu,
            commands::set_menu_enabled,
            commands::subscribe_menu,
            commands::close_main_window,
            commands::palette::palette_configure,
            commands::palette::palette_status,
            commands::palette::palette_query,
            commands::palette::palette_cancel,
            commands::palette::palette_rebuild,
            commands::palette::palette_clear,
            commands::watch::subscribe_watch,
            commands::watch::watch_dirs,
            commands::watch::describe_paths,
            commands::os_drag::start_os_drag,
            commands::set_archive_password,
            commands::config::load_buttons,
            commands::config::save_buttons,
            commands::config::load_file_types,
            commands::config::save_file_types,
            commands::config::toggle_fullscreen,
            commands::config::load_folder_memory,
            commands::config::save_folder_memory,
            commands::starter::load_starter,
            commands::starter::save_starter,
            commands::starter::run_starter,
            commands::mr_import::scan_old_config,
            commands::mr_import::apply_old_config,
            commands::remote::load_connections,
            commands::remote::save_connection,
            commands::remote::delete_connection,
            commands::remote::remote_connect,
            commands::remote::remote_trust_host_key,
            commands::remote::remote_trust_certificate,
            commands::remote::remote_disconnect,
            commands::remote::remote_forget_secret,
            commands::remote::remote_parse_url,
            commands::remote::subscribe_remote
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                archive::view::cleanup();
                if let Ok(h) = remote::hub() {
                    h.disconnect_all();
                }
                return;
            }
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
