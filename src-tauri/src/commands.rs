//! Tauri command layer. Kept thin: validate input, resolve defaults, run the
//! blocking file-system work off the async runtime threads.

use crate::error::{FsError, FsErrorCode};
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
    /// Serialises writes of the file (temp name is per process).
    write: Mutex<()>,
}

#[derive(Default)]
struct SessionInner {
    file: Option<PathBuf>,
    /// Result of loading in `setup`, handed to the first `load_session` call.
    pending: Option<LoadOutcome>,
    last: Session,
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
    });
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if let Some(geom) = outcome.session.window {
            window_state::restore(&window, &geom);
        }
        let _ = window.show();
    }
    let state = app.state::<SessionState>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.file = file;
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
        } = outcome.unwrap_or_else(|| match &file {
            Some(f) => session::load(f),
            None => LoadOutcome {
                session: Session::default(),
                warning: None,
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
    let (session, file) = remember(&app, session);
    let Some(file) = file else { return Ok(()) };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || write(&handle, &file, &session))
        .await
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("Saving the session failed: {e}"),
                None,
            )
        })?
}

/// Window is closing: write the last session with the final geometry.
pub fn save_on_close<R: Runtime>(app: &AppHandle<R>) {
    let last = {
        let state = app.state::<SessionState>();
        let inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.last.clone()
    };
    let (session, file) = remember(app, last);
    if let Some(file) = file {
        let _ = write(app, &file, &session);
    }
}

fn remember<R: Runtime>(app: &AppHandle<R>, mut session: Session) -> (Session, Option<PathBuf>) {
    session::sanitize(&mut session);
    let state = app.state::<SessionState>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let previous: Option<WindowGeometry> = inner.last.window;
    session.window = app
        .get_webview_window(MAIN_WINDOW)
        .and_then(|w| window_state::capture(&w, previous))
        .or(previous);
    inner.last = session.clone();
    (session, inner.file.clone())
}

fn write<R: Runtime>(
    app: &AppHandle<R>,
    file: &std::path::Path,
    session: &Session,
) -> Result<(), FsError> {
    let state = app.state::<SessionState>();
    let _guard = state.write.lock().unwrap_or_else(|e| e.into_inner());
    session::save(file, session).map_err(|e| FsError::from_io(&e, file))
}
