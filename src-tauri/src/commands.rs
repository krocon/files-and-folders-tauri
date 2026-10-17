//! Tauri command layer. Kept thin: validate input, resolve defaults, run the
//! blocking file-system work off the async runtime threads.

use crate::error::{FsError, FsErrorCode};
use crate::keymap::{self, Bindings, LoadedOverride};
use crate::listing;
use crate::model::DirectoryListing;
use crate::paths::validate_input_path;
use crate::session::{self, LoadOutcome, LoadedSession, Session, WindowGeometry};
use crate::window_state;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// Label of the only window.
pub const MAIN_WINDOW: &str = "main";

/// Lists a directory. `path = None` lists the current user's home directory.
#[tauri::command]
pub async fn list_directory<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
) -> Result<DirectoryListing, FsError> {
    let dir = resolve_dir(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || listing::list_directory(&dir))
        .await
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("Listing task failed: {e}"), None))?
}

fn resolve_dir<R: Runtime>(app: &AppHandle<R>, path: Option<String>) -> Result<PathBuf, FsError> {
    match path {
        Some(p) => validate_input_path(&p),
        None => app.path().home_dir().map_err(|e| {
            FsError::new(
                FsErrorCode::NoHomeDirectory,
                format!("Home directory could not be determined: {e}"),
                None,
            )
        }),
    }
}

/// Session file, last known session and window geometry (managed state).
#[derive(Default)]
pub struct SessionState {
    inner: Mutex<SessionInner>,
    /// Serialises writes of the file (temp name is per process) and holds the
    /// sequence number of the last written snapshot – older ones are skipped.
    write: Mutex<u64>,
}

#[derive(Default)]
struct SessionInner {
    file: Option<PathBuf>,
    /// Result of loading in `setup`, handed to the first `load_session` call.
    pending: Option<LoadOutcome>,
    last: Session,
    /// Incremented for every snapshot handed to `write`.
    seq: u64,
}

/// Called from `setup`: loads the file, restores the window geometry and
/// shows the window (it starts hidden to avoid a visible jump).
pub fn init_session<R: Runtime>(app: &AppHandle<R>) {
    let file = app
        .path()
        .app_config_dir()
        .ok()
        .map(|d| d.join(session::FILE_NAME));
    let outcome = file.as_deref().map(session::load).unwrap_or(LoadOutcome {
        session: Session::default(),
        warning: Some(
            "The app config directory is not available; the session is not saved.".into(),
        ),
        persist: false,
    });
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if let Some(geom) = outcome.session.window {
            window_state::restore(&window, &geom);
        }
        let _ = window.show();
    }
    let state = app.state::<SessionState>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.file = if outcome.persist { file } else { None };
    inner.last = outcome.session.clone();
    inner.pending = Some(outcome);
}

/// The saved session with missing tab paths replaced (see `session::resolve_missing_paths`).
#[tauri::command]
pub async fn load_session<R: Runtime>(app: AppHandle<R>) -> Result<LoadedSession, FsError> {
    let (outcome, file) = {
        let state = app.state::<SessionState>();
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        (inner.pending.take(), inner.file.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let LoadOutcome {
            mut session,
            warning,
            ..
        } = outcome.unwrap_or_else(|| match &file {
            Some(f) => session::load(f),
            None => LoadOutcome {
                session: Session::default(),
                warning: None,
                persist: false,
            },
        });
        let adjusted = session::resolve_missing_paths(&mut session);
        session.window = None;
        LoadedSession {
            session,
            warning,
            adjusted,
        }
    })
    .await
    .map_err(|e| {
        FsError::new(
            FsErrorCode::Io,
            format!("Loading the session failed: {e}"),
            None,
        )
    })
}

/// Stores the session (sanitised) together with the current window geometry.
#[tauri::command]
pub async fn save_session<R: Runtime>(app: AppHandle<R>, session: Session) -> Result<(), FsError> {
    let (session, file, seq) = remember(&app, session);
    let Some(file) = file else { return Ok(()) };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || write(&handle, &file, &session, seq))
        .await
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("Saving the session failed: {e}"),
                None,
            )
        })?
}

/// Window is closing or the app exits: write the last session with the final geometry.
/// Runs on the main thread – the window getters answer directly there.
pub fn save_on_close<R: Runtime>(app: &AppHandle<R>) {
    let last = {
        let state = app.state::<SessionState>();
        let inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.last.clone()
    };
    let (session, file, seq) = remember(app, last);
    if let Some(file) = file {
        let _ = write(app, &file, &session, seq);
    }
}

/// Sanitises, adds the window geometry and records the snapshot as the latest.
/// The window getters run **without** holding the state lock: off the main
/// thread they wait for the event loop, which may itself be waiting for the
/// lock in `save_on_close` (deadlock otherwise).
fn remember<R: Runtime>(
    app: &AppHandle<R>,
    mut session: Session,
) -> (Session, Option<PathBuf>, u64) {
    session::sanitize(&mut session);
    let state = app.state::<SessionState>();
    let previous: Option<WindowGeometry> = {
        let inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.last.window
    };
    session.window = app
        .get_webview_window(MAIN_WINDOW)
        .and_then(|w| window_state::capture(&w, previous))
        .or(previous);
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.seq += 1;
    inner.last = session.clone();
    (session, inner.file.clone(), inner.seq)
}

fn write<R: Runtime>(
    app: &AppHandle<R>,
    file: &std::path::Path,
    session: &Session,
    seq: u64,
) -> Result<(), FsError> {
    let state = app.state::<SessionState>();
    let mut written = state.write.lock().unwrap_or_else(|e| e.into_inner());
    if seq <= *written {
        return Ok(()); // a newer snapshot is already on disk
    }
    session::save(file, session).map_err(|e| FsError::from_io(&e, file))?;
    *written = seq;
    Ok(())
}

/// Whether the keymap override may be written (false after a broken file could not be moved aside).
#[derive(Default)]
pub struct KeymapState {
    write_blocked: Mutex<bool>,
}

fn keymap_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(keymap::FILE_NAME))
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("App config directory not available: {e}"),
                None,
            )
        })
}

/// The user's shortcut override (empty if there is none).
#[tauri::command]
pub async fn load_keymap_override<R: Runtime>(
    app: AppHandle<R>,
) -> Result<LoadedOverride, FsError> {
    let file = keymap_file(&app)?;
    let loaded = tauri::async_runtime::spawn_blocking(move || keymap::load(&file))
        .await
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("Loading the shortcuts failed: {e}"),
                None,
            )
        })?;
    let state = app.state::<KeymapState>();
    *state
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = !loaded.persist;
    Ok(loaded)
}

/// Replaces the user's shortcut override.
#[tauri::command]
pub async fn save_keymap_override<R: Runtime>(
    app: AppHandle<R>,
    bindings: Bindings,
) -> Result<(), FsError> {
    let file = keymap_file(&app)?;
    let blocked = *app
        .state::<KeymapState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if blocked {
        return Err(FsError::new(
            FsErrorCode::Io,
            "The existing shortcut file could not be moved aside; not overwriting it.",
            Some(&file),
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        keymap::save(&file, bindings).map_err(|e| FsError::from_io(&e, &file))
    })
    .await
    .map_err(|e| {
        FsError::new(
            FsErrorCode::Io,
            format!("Saving the shortcuts failed: {e}"),
            None,
        )
    })?
}
