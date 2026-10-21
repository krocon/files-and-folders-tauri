//! Tauri command layer. Kept thin: validate input, resolve defaults, run the
//! blocking file-system work off the async runtime threads.

pub mod config;
pub mod disk_usage;
pub mod mr_import;
pub mod os_drag;
pub mod shell;
pub mod starter;
pub mod watch;

use crate::error::{FsError, FsErrorCode};
use crate::fileops;
use crate::jobs::rename::{self, RenameItem, RenamePlan};
use crate::jobs::{Decision, JobEvent, JobInfo, JobManager, JobSpec};
use crate::keymap::{self, Bindings, LoadedOverride};
use crate::model::DirectoryListing;
use crate::opener;
use crate::paths::{Danger, expand_tilde, validate_input_path};
use crate::rename_presets::{self, LoadedPresets, RenamePresets};
use crate::session::{self, LoadOutcome, LoadedSession, Session, WindowGeometry};
use crate::themes::{self, LoadedThemes, ThemesFile};
use crate::window_state;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

/// Label of the only window.
pub const MAIN_WINDOW: &str = "main";

/// Name, version and platform for the About dialog (design 017).
#[tauri::command(async)]
pub fn get_app_info<R: Runtime>(app: AppHandle<R>) -> crate::about::AppInfo {
    let info = app.package_info();
    crate::about::app_info(&info.name, &info.version.to_string())
}

/// Lists a directory. `path = None` lists the current user's home directory.
#[tauri::command]
pub async fn list_directory<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
) -> Result<DirectoryListing, FsError> {
    let dir = resolve_dir(&app, path)?;
    // a folder that hangs is listed once, further requests wait for it (design 029 E6)
    crate::listing_gate::global().list(dir, list_dir).await
}

fn list_dir(dir: &std::path::Path) -> Result<DirectoryListing, FsError> {
    crate::test_slow::listing(dir);
    let mut listing = crate::archive::list_directory_or_archive(dir)?;
    // the frontend caches listings of network drives (design 030 E6); one statfs
    listing.network = listing.archive.is_none()
        && (crate::watch::netfs::is_network(dir) || crate::test_slow::is_network(dir));
    Ok(listing)
}

pub(crate) fn home_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    app.path().home_dir().map_err(|e| {
        FsError::new(
            FsErrorCode::NoHomeDirectory,
            format!("Home directory could not be determined: {e}"),
            None,
        )
    })
}

/// Validates a path from the frontend; a leading `~` means the home folder.
pub(crate) fn resolve_input<R: Runtime>(app: &AppHandle<R>, raw: &str) -> Result<PathBuf, FsError> {
    if raw.trim_start().starts_with('~') {
        let expanded = expand_tilde(raw, &home_dir(app)?)?;
        return validate_input_path(&expanded.to_string_lossy());
    }
    validate_input_path(raw)
}

fn resolve_dir<R: Runtime>(app: &AppHandle<R>, path: Option<String>) -> Result<PathBuf, FsError> {
    match path {
        Some(p) => resolve_input(app, &p),
        None => home_dir(app),
    }
}

/// Where a typed location leads: a folder, or a file's folder with the file selected.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub dir: String,
    pub select: Option<String>,
}

/// Resolves a path typed by the user (`~` allowed): folder → itself, file → its folder.
#[tauri::command]
pub async fn resolve_location<R: Runtime>(
    app: AppHandle<R>,
    input: String,
) -> Result<Location, FsError> {
    let path = resolve_input(&app, &input)?;
    tauri::async_runtime::spawn_blocking(move || location_of(&path))
        .await
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("Resolving failed: {e}"), None))?
}

/// A typed path → folder (+ file to select). A folder inside an archive is
/// refused with a clear message: it is no target (archives are read-only) and
/// typed virtual paths are not navigated (review 016 #7).
fn location_of(path: &std::path::Path) -> Result<Location, FsError> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => {
            if crate::archive::resolve(path).is_some() {
                return Err(FsError::new(
                    FsErrorCode::ArchiveError,
                    "A folder inside an archive cannot be typed or used as a target (archives are read-only) – open the archive in the panel",
                    Some(path),
                ));
            }
            return Err(FsError::from_io(&e, path));
        }
    };
    if meta.is_dir() {
        return Ok(Location {
            dir: path.to_string_lossy().into_owned(),
            select: None,
        });
    }
    let parent = crate::paths::parent_of(path)
        .ok_or_else(|| FsError::new(FsErrorCode::NotADirectory, "No parent folder", Some(path)))?;
    Ok(Location {
        dir: parent.to_string_lossy().into_owned(),
        select: Some(path.to_string_lossy().into_owned()),
    })
}

/// Opens a file with the default application; executables only with `allow_executable`.
#[tauri::command]
pub async fn open_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    allow_executable: bool,
) -> Result<(), FsError> {
    let file = resolve_input(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        opener::check_openable(&file, allow_executable)?;
        opener::open_with_default_app(&file)
    })
    .await
    .map_err(|e| FsError::new(FsErrorCode::Io, format!("Opening failed: {e}"), None))?
}

// ---- preview and properties (design 010) ----

/// Image tokens of the `fnfpreview` scheme (shared with the protocol handler).
#[derive(Default, Clone)]
pub struct PreviewState {
    pub tokens: Arc<crate::preview::ImageTokens>,
    /// Image requests served at the same time (review 2).
    pub slots: Arc<crate::preview::ServeSlots>,
}

/// Bounded preview of a file (text, image token, hex); never reads more than the limits.
#[tauri::command]
pub async fn read_preview<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, PreviewState>,
    path: String,
    options: Option<crate::preview::PreviewOptions>,
) -> Result<crate::preview::Preview, FsError> {
    let file = resolve_input(&app, &path)?;
    let tokens = state.tokens.clone();
    let options = options.unwrap_or_default();
    blocking("Reading the preview", move || {
        // a file inside an archive: its copy in the view cache (design 025 E5)
        let file = if std::fs::symlink_metadata(&file).is_err()
            && crate::archive::resolve(&file).is_some()
        {
            crate::archive::view::for_preview(&file, options.image_slot.as_deref())?
        } else {
            file
        };
        crate::preview::read_preview(&file, &options, |p, slot| tokens.issue_in(p, slot))
    })
    .await
}

/// Checks a password for an archive and keeps it in memory for this run (design 025 E4).
/// Never logged, never stored on disk.
#[tauri::command]
pub async fn set_archive_password<R: Runtime>(
    app: AppHandle<R>,
    archive: String,
    password: crate::archive::secrets::Secret,
) -> Result<(), FsError> {
    let file = resolve_input(&app, &archive)?;
    blocking("Checking the password", move || {
        crate::archive::set_password(&file, password)
    })
    .await
}

/// Properties of a file or folder (read only).
#[tauri::command]
pub async fn get_properties<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<crate::properties::Properties, FsError> {
    let file = resolve_input(&app, &path)?;
    blocking("Reading the properties", move || {
        crate::properties::properties(&file)
    })
    .await
}

/// Answer of the `fnfpreview` scheme when all serve slots are taken (review 2).
pub fn preview_busy_response() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(503)
        .header("Cache-Control", "no-store")
        .header("Retry-After", "1")
        .body(Vec::new())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

/// Answer of the `fnfpreview` scheme: the image of a token or 404 (design 010 E3).
pub fn preview_response(
    tokens: &crate::preview::ImageTokens,
    uri_path: &str,
) -> tauri::http::Response<Vec<u8>> {
    let token = uri_path.trim_start_matches('/');
    let builder = tauri::http::Response::builder()
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store");
    let valid = token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit());
    match valid
        .then(|| crate::preview::serve_image(tokens, token))
        .flatten()
    {
        Some((bytes, mime)) => {
            let builder = builder.status(200).header("Content-Type", mime);
            let builder = if mime == "image/svg+xml" {
                builder.header(
                    "Content-Security-Policy",
                    "default-src 'none'; style-src 'unsafe-inline'",
                )
            } else {
                builder
            };
            builder.body(bytes)
        }
        None => builder.status(404).body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

// ---- quick operations (design 006 E8) ----

pub(crate) async fn blocking<T: Send + 'static>(
    what: &str,
    f: impl FnOnce() -> Result<T, FsError> + Send + 'static,
) -> Result<T, FsError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("{what} failed: {e}"), None))?
}

/// Creates a folder (`a/b/c` allowed); returns the topmost new path.
#[tauri::command]
pub async fn make_dir<R: Runtime>(
    app: AppHandle<R>,
    parent: String,
    name: String,
) -> Result<String, FsError> {
    let parent = resolve_input(&app, &parent)?;
    blocking("Creating the folder", move || {
        fileops::make_dir(&parent, &name).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// Creates several folders (Multi-MkDir, design 008 E4); a result per name.
#[tauri::command]
pub async fn create_folders<R: Runtime>(
    app: AppHandle<R>,
    parent: String,
    names: Vec<String>,
) -> Result<fileops::CreatedFolders, FsError> {
    let parent = resolve_input(&app, &parent)?;
    blocking("Creating the folders", move || {
        fileops::create_folders(&parent, &names)
    })
    .await
}

/// Cancel tokens of running clean-folders searches, by the frontend's scan id
/// (review 008 #2). A cancel that arrives before its search leaves a set token.
#[derive(Default)]
pub struct CleanScanState {
    tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// Most search ids kept; a cancel without its search is the only way to grow.
const MAX_SCAN_TOKENS: usize = 64;

impl CleanScanState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.tokens.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The token of `id` (a cancel may have come first).
    pub fn begin(&self, id: &str) -> Arc<AtomicBool> {
        self.lock().entry(id.to_string()).or_default().clone()
    }

    pub fn end(&self, id: &str) {
        self.lock().remove(id);
    }

    pub fn cancel(&self, id: &str) {
        let mut tokens = self.lock();
        if !tokens.contains_key(id) && tokens.len() >= MAX_SCAN_TOKENS {
            tokens.retain(|_, t| !t.load(Ordering::SeqCst));
        }
        tokens
            .entry(id.to_string())
            .or_default()
            .store(true, Ordering::SeqCst);
    }
}

/// Lists empty folders (and pattern files) below the start folders; writes nothing
/// (design 008 E3). `scan_id` lets `cancel_clean_scan` stop it early.
#[tauri::command]
pub async fn find_empty_dirs<R: Runtime>(
    app: AppHandle<R>,
    scan_id: String,
    roots: Vec<String>,
    options: crate::clean::CleanOptions,
) -> Result<crate::clean::CleanScan, FsError> {
    let roots = roots
        .iter()
        .map(|r| resolve_input(&app, r))
        .collect::<Result<Vec<_>, _>>()?;
    let token = app.state::<CleanScanState>().begin(&scan_id);
    let result = blocking("Searching empty folders", move || {
        crate::clean::find_empty_dirs_cancellable(&roots, &options, &token)
    })
    .await;
    app.state::<CleanScanState>().end(&scan_id);
    result
}

/// Stops the search `scan_id` (a newer one started, the dialog closed).
#[tauri::command(async)]
pub fn cancel_clean_scan<R: Runtime>(app: AppHandle<R>, scan_id: String) {
    app.state::<CleanScanState>().cancel(&scan_id);
}

/// Creates an empty file (never overwrites).
#[tauri::command]
pub async fn create_file<R: Runtime>(
    app: AppHandle<R>,
    parent: String,
    name: String,
) -> Result<String, FsError> {
    let parent = resolve_input(&app, &parent)?;
    blocking("Creating the file", move || {
        fileops::create_file(&parent, &name).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// Renames one entry in its folder (never overwrites); returns the new path.
#[tauri::command]
pub async fn rename_entry<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    new_name: String,
    allow_dangerous: bool,
) -> Result<String, FsError> {
    let path = resolve_input(&app, &path)?;
    let home = home_dir(&app).ok();
    blocking("Renaming", move || {
        fileops::rename_entry(&path, &new_name, home.as_deref(), allow_dangerous)
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCheck {
    pub path: String,
    pub danger: Option<Danger>,
}

/// Which of the paths are a root, the home folder or a system folder (second confirmation).
#[tauri::command(async)]
pub fn check_paths<R: Runtime>(
    app: AppHandle<R>,
    paths: Vec<String>,
) -> Result<Vec<PathCheck>, FsError> {
    let home = home_dir(&app).ok();
    // like the jobs: also where the path really leads (external review #2)
    let mut check = crate::paths::DangerCheck::new(home.as_deref());
    paths
        .into_iter()
        .map(|p| {
            let v = validate_input_path(&p)?;
            Ok(PathCheck {
                danger: check.of(&v),
                path: p,
            })
        })
        .collect()
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

// ---- multi-rename (design 007) ----

/// Checks multi-rename pairs against each other and the disk (writes nothing).
#[tauri::command]
pub async fn plan_rename<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<RenameItem>,
) -> Result<RenamePlan, FsError> {
    if items.len() > rename::MAX_ITEMS {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            format!("Too many entries (max. {})", rename::MAX_ITEMS),
            None,
        ));
    }
    let home = home_dir(&app).ok();
    blocking("Checking the names", move || {
        Ok(rename::plan(&items, home.as_deref()))
    })
    .await
}

/// Undoes a rename job (`None` = the last one); returns the id of the undo job.
#[tauri::command(async)]
pub fn undo_rename<R: Runtime>(
    app: AppHandle<R>,
    job_id: Option<String>,
) -> Result<String, FsError> {
    app.state::<JobsState>()
        .manager
        .undo_rename(job_id.as_deref())
}

/// Whether the presets file may be written (false after a broken file could not be moved aside).
#[derive(Default)]
pub struct PresetsState {
    write_blocked: Mutex<bool>,
}

fn presets_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(rename_presets::FILE_NAME))
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("App config directory not available: {e}"),
                None,
            )
        })
}

#[tauri::command]
pub async fn load_rename_presets<R: Runtime>(app: AppHandle<R>) -> Result<LoadedPresets, FsError> {
    let file = presets_file(&app)?;
    let loaded = blocking("Loading the presets", move || {
        Ok(rename_presets::load(&file))
    })
    .await?;
    *app.state::<PresetsState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = !loaded.persist;
    Ok(loaded)
}

#[tauri::command]
pub async fn save_rename_presets<R: Runtime>(
    app: AppHandle<R>,
    presets: RenamePresets,
) -> Result<(), FsError> {
    let file = presets_file(&app)?;
    let blocked = *app
        .state::<PresetsState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if blocked {
        return Err(FsError::new(
            FsErrorCode::Io,
            "The existing presets file could not be moved aside; not overwriting it.",
            Some(&file),
        ));
    }
    blocking("Saving the presets", move || {
        rename_presets::save(&file, presets).map_err(|e| FsError::from_io(&e, &file))
    })
    .await
}

// ---- OS integration and external tools (design 011) ----

/// Drives / volumes / mount points; a dead network mount is `reachable: false`, never a hang.
#[tauri::command]
pub async fn list_volumes() -> Result<Vec<crate::platform::volumes::Volume>, FsError> {
    blocking("Listing the drives", || {
        Ok(crate::platform::volumes::list_volumes(
            crate::platform::volumes::DEFAULT_TIMEOUT,
        ))
    })
    .await
}

fn existing(path: &std::path::Path) -> Result<std::fs::Metadata, FsError> {
    std::fs::symlink_metadata(path).map_err(|e| FsError::from_io(&e, path))
}

fn existing_dir(path: &std::path::Path) -> Result<(), FsError> {
    let meta = std::fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    if meta.is_dir() {
        Ok(())
    } else {
        Err(FsError::new(
            FsErrorCode::NotADirectory,
            "This is not a folder",
            Some(path),
        ))
    }
}

/// Shows the entry in Finder / Explorer / the desktop's file manager.
#[tauri::command]
pub async fn reveal_in_file_manager<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<(), FsError> {
    let path = resolve_input(&app, &path)?;
    blocking("Showing in the file manager", move || {
        existing(&path)?;
        crate::platform::desktop::reveal(&path)
    })
    .await
}

/// Effective tools configuration (defaults + `tools.json`), loaded once and on `load_tools`.
#[derive(Default)]
pub struct ToolsState {
    config: Mutex<Option<crate::tools::ToolsConfig>>,
}

fn tools_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(crate::tools::FILE_NAME))
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("App config directory not available: {e}"),
                None,
            )
        })
}

/// The current configuration (loaded from the file the first time).
async fn tools_config<R: Runtime>(app: &AppHandle<R>) -> crate::tools::ToolsConfig {
    if let Some(c) = app
        .state::<ToolsState>()
        .config
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
    {
        return c;
    }
    reload_tools(app).await
}

pub(crate) async fn reload_tools<R: Runtime>(app: &AppHandle<R>) -> crate::tools::ToolsConfig {
    let file = tools_file(app).ok();
    let config = tauri::async_runtime::spawn_blocking(move || match file {
        Some(f) => crate::tools::load(&f),
        None => crate::tools::ToolsConfig {
            tools: crate::tools::defaults(),
            ..Default::default()
        },
    })
    .await
    .unwrap_or_default();
    *app.state::<ToolsState>()
        .config
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(config.clone());
    config
}

/// Opens a terminal in `dir` (custom terminal from `tools.json`, else the OS default).
#[tauri::command]
pub async fn open_terminal<R: Runtime>(app: AppHandle<R>, dir: String) -> Result<(), FsError> {
    let dir = resolve_input(&app, &dir)?;
    let custom = tools_config(&app).await.terminal;
    blocking("Opening the terminal", move || {
        existing_dir(&dir)?;
        crate::platform::desktop::open_terminal(&dir, custom.as_ref())
    })
    .await
}

/// (Re)loads `tools.json`; the frontend gets labels and shortcuts, never sends programs.
#[tauri::command]
pub async fn load_tools<R: Runtime>(
    app: AppHandle<R>,
) -> Result<crate::tools::LoadedTools, FsError> {
    let config = reload_tools(&app).await;
    Ok(crate::tools::LoadedTools {
        tools: config.tools.iter().map(Into::into).collect(),
        warnings: config.warnings,
        file: tools_file(&app)
            .ok()
            .map(|f| f.to_string_lossy().into_owned()),
    })
}

/// What a tool works on: paths from the panels (checked here).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolContextInput {
    #[serde(default)]
    pub files: Vec<String>,
    pub dir: Option<String>,
    pub target_dir: Option<String>,
}

/// Starts the configured tool `tool_id` – program and arguments come only from the
/// configuration. Returns the number of started processes. A tool that hands files
/// to the default app (F4 `edit` = `xdg-open` …) reports an executable like Enter
/// does (`executable`); the frontend asks and repeats with `allow_executable`.
#[tauri::command]
pub async fn run_tool<R: Runtime>(
    app: AppHandle<R>,
    tool_id: String,
    context: ToolContextInput,
    allow_executable: Option<bool>,
) -> Result<usize, FsError> {
    let config = tools_config(&app).await;
    let tool = config.find(&tool_id).cloned().ok_or_else(|| {
        FsError::new(
            FsErrorCode::UnknownTool,
            format!("There is no tool \"{tool_id}\""),
            None,
        )
    })?;
    launch_tool(&app, tool, context, allow_executable.unwrap_or(false)).await
}

/// Checks the context paths and starts `tool` (shared by the tools and the starter
/// menu, design 032); returns the number of started processes.
pub(crate) async fn launch_tool<R: Runtime>(
    app: &AppHandle<R>,
    tool: crate::tools::Tool,
    context: ToolContextInput,
    allow_executable: bool,
) -> Result<usize, FsError> {
    let app = app.clone();
    if context.files.len() > crate::tools::MAX_FILE_LIMIT as usize {
        return Err(FsError::new(
            FsErrorCode::TooManyFiles,
            "Too many entries",
            None,
        ));
    }
    let files = context
        .files
        .iter()
        .map(|f| resolve_input(&app, f))
        .collect::<Result<Vec<_>, _>>()?;
    let dir = context
        .dir
        .as_deref()
        .map(|d| resolve_input(&app, d))
        .transpose()?;
    let target_dir = context
        .target_dir
        .as_deref()
        .map(|d| resolve_input(&app, d))
        .transpose()?;
    let home = home_dir(&app).ok();
    blocking("Starting the tool", move || {
        for f in &files {
            existing(f)?;
        }
        for d in dir.iter().chain(target_dir.iter()) {
            existing_dir(d)?;
        }
        crate::tools::check_default_app_files(&tool, &files, allow_executable)?;
        let ctx = crate::tools::ResolvedContext {
            files,
            dir,
            target_dir,
            home,
        };
        let plan = crate::tools::plan(&tool, &ctx)?;
        for inv in &plan {
            // a missing working folder would look like a missing program
            if let Some(cwd) = &inv.cwd {
                existing_dir(cwd)?;
            }
        }
        for inv in &plan {
            crate::tools::spawn_detached(crate::tools::command(inv), &inv.program)?;
        }
        Ok(plan.len())
    })
    .await
}

/// Creates `tools.json` with the defaults if it is missing and opens it with the
/// default app; returns its path.
#[tauri::command]
pub async fn open_tools_config<R: Runtime>(app: AppHandle<R>) -> Result<String, FsError> {
    let file = tools_file(&app)?;
    blocking("Opening the tools file", move || {
        if !file.exists() {
            crate::fs_atomic::write_atomic(&file, crate::tools::default_file_text().as_bytes())
                .map_err(|e| FsError::from_io(&e, &file))?;
        }
        opener::open_with_default_app(&file)?;
        Ok(file.to_string_lossy().into_owned())
    })
    .await
}

// ---- colour schemes (design 013) ----

/// Whether `themes.json` may be written (false after a broken file could not be moved aside).
#[derive(Default)]
pub struct ThemesState {
    write_blocked: Mutex<bool>,
}

fn themes_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(themes::FILE_NAME))
        .map_err(|e| {
            FsError::new(
                FsErrorCode::Io,
                format!("App config directory not available: {e}"),
                None,
            )
        })
}

/// The user's colour schemes and the selection (defaults if there is no file).
#[tauri::command]
pub async fn load_themes<R: Runtime>(app: AppHandle<R>) -> Result<LoadedThemes, FsError> {
    let file = themes_file(&app)?;
    let loaded = blocking("Loading the colour schemes", move || {
        Ok(themes::load(&file))
    })
    .await?;
    *app.state::<ThemesState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = !loaded.persist;
    Ok(loaded)
}

/// Replaces `themes.json` (checked and bounded, written atomically).
#[tauri::command]
pub async fn save_themes<R: Runtime>(app: AppHandle<R>, file: ThemesFile) -> Result<(), FsError> {
    let path = themes_file(&app)?;
    let blocked = *app
        .state::<ThemesState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if blocked {
        return Err(FsError::new(
            FsErrorCode::Io,
            "The existing colour scheme file could not be moved aside; not overwriting it.",
            Some(&path),
        ));
    }
    blocking("Saving the colour schemes", move || {
        themes::save(&path, file).map_err(|e| FsError::from_io(&e, &path))
    })
    .await
}

/// Reads a colour scheme file (≤ 256 KiB JSON object) for the import.
#[tauri::command]
pub async fn import_theme<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<serde_json::Value, FsError> {
    let path = resolve_input(&app, &path)?;
    blocking("Importing the colour scheme", move || themes::import(&path)).await
}

/// Writes `<name>.theme.json` into `dir` (never overwrites); returns the path.
#[tauri::command]
pub async fn export_theme<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    name: String,
    theme: serde_json::Value,
) -> Result<String, FsError> {
    let dir = resolve_input(&app, &dir)?;
    blocking("Exporting the colour scheme", move || {
        themes::export(&dir, &name, &theme).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// Colours the native window frame like the app's tab bar: title bar background
/// (`#rrggbb`, macOS with `titleBarStyle: Transparent`) and light/dark frame (all OS).
#[tauri::command]
pub async fn set_window_chrome<R: Runtime>(
    app: AppHandle<R>,
    color: String,
    dark: bool,
) -> Result<(), FsError> {
    let (r, g, b) = themes::parse_hex_rgb(&color)
        .ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "Not a #rrggbb colour", None))?;
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return Ok(());
    };
    let io = |e: tauri::Error| FsError::new(FsErrorCode::Io, e.to_string(), None);
    window
        .set_theme(Some(if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }))
        .map_err(io)?;
    window
        .set_background_color(Some(tauri::window::Color(r, g, b, 255)))
        .map_err(io)
}

// ---- settings (design 015) ----

/// Whether `settings.json` may be written (false: newer version, or a broken file stayed in place).
#[derive(Default)]
pub struct SettingsState {
    write_blocked: Mutex<bool>,
}

pub(crate) fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, FsError> {
    app.path().app_config_dir().map_err(|e| {
        FsError::new(
            FsErrorCode::Io,
            format!("App config directory not available: {e}"),
            None,
        )
    })
}

/// The user's settings (only values that differ from the defaults) and load warnings.
#[tauri::command]
pub async fn load_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<crate::settings::LoadedSettings, FsError> {
    let file = config_dir(&app)?.join(crate::settings::FILE_NAME);
    let loaded = blocking("Loading the settings", move || {
        Ok(crate::settings::load(&file))
    })
    .await?;
    *app.state::<SettingsState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = !loaded.persist;
    Ok(loaded)
}

/// Replaces `settings.json` (sanitised against the schema, written atomically).
#[tauri::command]
pub async fn save_settings<R: Runtime>(
    app: AppHandle<R>,
    settings: serde_json::Map<String, serde_json::Value>,
) -> Result<Vec<crate::settings::SettingsWarning>, FsError> {
    let path = config_dir(&app)?.join(crate::settings::FILE_NAME);
    let blocked = *app
        .state::<SettingsState>()
        .write_blocked
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if blocked {
        return Ok(vec![crate::settings::SettingsWarning {
            code: "not_saved".into(),
            key: None,
            path: Some(path.to_string_lossy().into_owned()),
        }]);
    }
    blocking("Saving the settings", move || {
        crate::settings::save(&path, settings).map_err(|e| FsError::from_io(&e, &path))
    })
    .await
}

/// Writes all settings files as one bundle into `dir` (never overwrites); returns the path.
#[tauri::command]
pub async fn export_settings<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
) -> Result<String, FsError> {
    let files = crate::settings::ConfigFiles::in_dir(&config_dir(&app)?);
    let dir = resolve_input(&app, &dir)?;
    blocking("Exporting the settings", move || {
        crate::settings::export(&files, &dir).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// Imports the chosen parts of a settings bundle; the frontend reloads its stores afterwards.
#[tauri::command]
pub async fn import_settings<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    parts: Vec<String>,
) -> Result<crate::settings::ImportReport, FsError> {
    if parts.len() > crate::settings::PARTS.len() {
        return Err(FsError::new(FsErrorCode::TooMany, "Too many parts", None));
    }
    let files = crate::settings::ConfigFiles::in_dir(&config_dir(&app)?);
    let path = resolve_input(&app, &path)?;
    let report = blocking("Importing the settings", move || {
        let bundle = crate::settings::read_bundle(&path)?;
        crate::settings::import(&files, &bundle, &parts)
    })
    .await?;
    unblock_imported(&app, &report.imported);
    Ok(report)
}

/// The imported files are fine to write again (a broken one was replaced).
pub(crate) fn unblock_imported<R: Runtime>(app: &AppHandle<R>, imported: &[String]) {
    let unblock = |m: &Mutex<bool>| *m.lock().unwrap_or_else(|e| e.into_inner()) = false;
    for part in imported {
        match part.as_str() {
            "settings" => unblock(&app.state::<SettingsState>().write_blocked),
            "themes" => unblock(&app.state::<ThemesState>().write_blocked),
            "keymap" => unblock(&app.state::<KeymapState>().write_blocked),
            "renamePresets" => unblock(&app.state::<PresetsState>().write_blocked),
            "buttons" => unblock(&app.state::<config::ButtonsState>().write_blocked),
            "fileTypes" => unblock(&app.state::<config::FileTypesState>().write_blocked),
            "starter" => {
                let state = app.state::<starter::StarterState>();
                unblock(&state.write_blocked);
                // the next run reads the imported file
                *state.items.lock().unwrap_or_else(|e| e.into_inner()) = None;
            }
            _ => {}
        }
    }
}

// ---- jobs (design 005) ----

/// The job manager and the channels of the frontends listening to it.
pub struct JobsState {
    pub manager: Arc<JobManager>,
    /// One channel per webview (label): a reloaded page replaces its old channel –
    /// `Channel::send` does not fail for a page that is gone.
    subscribers: Arc<Mutex<HashMap<String, Channel<JobEvent>>>>,
    /// Set once the user confirmed quitting – lets the next close/exit through.
    pub quitting: AtomicBool,
}

impl Default for JobsState {
    fn default() -> Self {
        let subscribers: Arc<Mutex<HashMap<String, Channel<JobEvent>>>> = Arc::default();
        let sink_subs = subscribers.clone();
        let manager = JobManager::new(Arc::new(move |event: &JobEvent| {
            // channels of closed webviews fail – drop them
            sink_subs
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|_, ch| ch.send(event.clone()).is_ok());
        }));
        Self {
            manager,
            subscribers,
            quitting: AtomicBool::new(false),
        }
    }
}

impl JobsState {
    /// True if closing/exiting must wait for the user's answer.
    pub fn must_ask_before_quit(&self) -> bool {
        !self.quitting.load(Ordering::SeqCst) && self.manager.active_count() > 0
    }
}

/// Subscribes to job events; returns the current jobs (state after a reload).
#[tauri::command(async)]
pub fn subscribe_jobs<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    on_event: Channel<JobEvent>,
) -> Vec<JobInfo> {
    let state = app.state::<JobsState>();
    state
        .subscribers
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(webview.label().to_string(), on_event);
    state.manager.list()
}

#[tauri::command(async)]
pub fn start_job<R: Runtime>(app: AppHandle<R>, spec: JobSpec) -> Result<String, FsError> {
    app.state::<JobsState>().manager.start(spec)
}

#[tauri::command(async)]
pub fn cancel_job<R: Runtime>(app: AppHandle<R>, id: String) {
    app.state::<JobsState>().manager.cancel(&id);
}

#[tauri::command(async)]
pub fn pause_job<R: Runtime>(app: AppHandle<R>, id: String) {
    app.state::<JobsState>().manager.pause(&id);
}

#[tauri::command(async)]
pub fn resume_job<R: Runtime>(app: AppHandle<R>, id: String) {
    app.state::<JobsState>().manager.resume(&id);
}

#[tauri::command(async)]
pub fn resolve_conflict<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    conflict_id: u64,
    decision: Decision,
    apply_to_all: bool,
) {
    app.state::<JobsState>()
        .manager
        .resolve_conflict(&id, conflict_id, decision, apply_to_all);
}

#[tauri::command(async)]
pub fn list_jobs<R: Runtime>(app: AppHandle<R>) -> Vec<JobInfo> {
    app.state::<JobsState>().manager.list()
}

#[tauri::command(async)]
pub fn clear_finished_jobs<R: Runtime>(app: AppHandle<R>) {
    app.state::<JobsState>().manager.clear_finished();
}

/// The user confirmed quitting: cancel all jobs, wait for them to clean up
/// their temporary files (max. 5 s), save the session and exit.
#[tauri::command]
pub async fn cancel_all_and_quit<R: Runtime>(app: AppHandle<R>) {
    let manager = {
        let state = app.state::<JobsState>();
        state.quitting.store(true, Ordering::SeqCst);
        state.manager.clone()
    };
    manager.cancel_all();
    let _ = tauri::async_runtime::spawn_blocking(move || manager.wait_idle(Duration::from_secs(5)))
        .await;
    save_on_close(&app);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Review 016 #7: a folder inside an archive is never a resolved location (target).
    #[test]
    fn locations_inside_an_archive_are_refused() {
        let d = tempfile::tempdir().unwrap();
        let zip = d.path().join("a.zip");
        crate::archive::tests::make_zip(&zip, &[crate::archive::tests::E::File("o/x.txt", b"x")]);
        let err = location_of(&zip.join("o")).unwrap_err();
        assert_eq!(err.code, FsErrorCode::ArchiveError);
        // the archive file itself is a file: its folder with the archive selected
        let loc = location_of(&zip).unwrap();
        assert_eq!(loc.select.as_deref(), Some(zip.to_string_lossy().as_ref()));
        assert_eq!(
            location_of(&d.path().join("weg")).unwrap_err().code,
            FsErrorCode::NotFound
        );
    }

    #[test]
    fn preview_scheme_serves_only_valid_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.gif");
        std::fs::write(&p, b"GIF89a\x01\0\x01\0").unwrap();
        let tokens = crate::preview::ImageTokens::default();
        let t = tokens.issue(&p);
        let ok = preview_response(&tokens, &format!("/{t}"));
        assert_eq!(ok.status(), 200);
        assert_eq!(ok.headers()["content-type"], "image/gif");
        assert_eq!(ok.headers()["x-content-type-options"], "nosniff");
        assert_eq!(preview_response(&tokens, "/../etc/passwd").status(), 404);
        assert_eq!(
            preview_response(&tokens, &format!("/{}", "0".repeat(32))).status(),
            404
        );
        let svg = dir.path().join("a.svg");
        std::fs::write(&svg, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        let r = preview_response(&tokens, &format!("/{}", tokens.issue(&svg)));
        assert_eq!(r.headers()["content-type"], "image/svg+xml");
        assert!(r.headers().contains_key("content-security-policy"));
    }

    /// Review 008 #2: a cancel reaches a running search and one not started yet.
    #[test]
    fn clean_scan_tokens() {
        let st = CleanScanState::default();
        let a = st.begin("a");
        assert!(!a.load(Ordering::SeqCst));
        st.cancel("a");
        assert!(a.load(Ordering::SeqCst));
        st.end("a");
        st.cancel("b"); // before its search
        assert!(st.begin("b").load(Ordering::SeqCst));
        st.end("b");
        for i in 0..200 {
            st.cancel(&format!("late {i}")); // after the search ended: bounded
        }
        assert!(st.lock().len() <= MAX_SCAN_TOKENS);
    }
}

// ---- application menu (design 014) ----

/// Channel of the menu events and the ids of the current native menu.
#[derive(Default)]
pub struct MenuState {
    channel: Mutex<Option<Channel<crate::app_menu::MenuEvent>>>,
    ids: Mutex<std::collections::HashSet<String>>,
}

/// Installs the native menu bar (macOS, or `FNF_NATIVE_MENU=1`). Returns false when
/// this platform uses the in-app menu bar – the frontend then shows its own.
///
/// The four menu/window commands stay synchronous on purpose (design 029 E11): they
/// change the native menu or the window, the main thread is the safe place for that
/// on macOS, and they do no file I/O. Every other command is `async`.
#[tauri::command]
pub fn set_app_menu<R: Runtime>(
    app: AppHandle<R>,
    spec: crate::app_menu::MenuSpec,
) -> Result<bool, FsError> {
    crate::app_menu::validate_spec(&spec)
        .map_err(|m| FsError::new(FsErrorCode::InvalidMenu, m, None))?;
    if !crate::app_menu::native_menu_wanted() {
        return Ok(false);
    }
    let menu = crate::app_menu::build_menu(&app, &spec)
        .map_err(|e| FsError::new(FsErrorCode::InvalidMenu, e.to_string(), None))?;
    *app.state::<MenuState>()
        .ids
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = crate::app_menu::item_ids(&spec);
    app.set_menu(menu)
        .map_err(|e| FsError::new(FsErrorCode::InvalidMenu, e.to_string(), None))?;
    Ok(true)
}

/// Enables/disables items of the installed native menu without rebuilding it
/// (selection, dialogs and tabs change states often, review 014 #7). Unknown ids
/// (an older spec) are skipped; without a native menu this does nothing.
#[tauri::command]
pub fn set_menu_enabled<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<crate::app_menu::MenuEnabled>,
) -> Result<(), FsError> {
    let wanted = {
        let ids = app
            .state::<MenuState>()
            .ids
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        crate::app_menu::validate_enabled(&items, &ids)
            .map_err(|m| FsError::new(FsErrorCode::InvalidMenu, m, None))?
    };
    if wanted.is_empty() || !crate::app_menu::native_menu_wanted() {
        return Ok(());
    }
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    crate::app_menu::apply_enabled(&menu, &wanted)
        .map_err(|e| FsError::new(FsErrorCode::InvalidMenu, e.to_string(), None))
}

/// Menu events (ids of chosen items) go to this channel.
#[tauri::command]
pub fn subscribe_menu<R: Runtime>(
    app: AppHandle<R>,
    on_event: Channel<crate::app_menu::MenuEvent>,
) {
    *app.state::<MenuState>()
        .channel
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(on_event);
}

/// Called by Tauri for every chosen menu item: forwards ids of our spec only.
pub fn forward_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let state = app.state::<MenuState>();
    if !state
        .ids
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(id)
    {
        return;
    }
    if let Some(channel) = state
        .channel
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        let _ = channel.send(crate::app_menu::MenuEvent { id: id.to_string() });
    }
}

/// Quit from the in-app menu: closes the main window like its close button
/// (running jobs ask first, the session is saved).
#[tauri::command]
pub fn close_main_window<R: Runtime>(app: AppHandle<R>) -> Result<(), FsError> {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(w) => w
            .close()
            .map_err(|e| FsError::new(FsErrorCode::Io, e.to_string(), None)),
        None => Ok(()),
    }
}

/// Design 029 E11: synchronous commands run on the main thread in Tauri 2 – one
/// slow call there freezes the whole window. Only the menu/window commands may.
#[cfg(test)]
mod command_rules {
    const SOURCES: [(&str, &str); 8] = [
        ("commands.rs", include_str!("commands.rs")),
        (
            "commands/disk_usage.rs",
            include_str!("commands/disk_usage.rs"),
        ),
        ("commands/config.rs", include_str!("commands/config.rs")),
        ("commands/watch.rs", include_str!("commands/watch.rs")),
        ("commands/shell.rs", include_str!("commands/shell.rs")),
        ("commands/os_drag.rs", include_str!("commands/os_drag.rs")),
        ("commands/starter.rs", include_str!("commands/starter.rs")),
        (
            "commands/mr_import.rs",
            include_str!("commands/mr_import.rs"),
        ),
    ];
    const MAIN_THREAD: [&str; 4] = [
        "set_app_menu",
        "set_menu_enabled",
        "subscribe_menu",
        "close_main_window",
    ];

    /// The name of a synchronous command declared at `lines[i]`, if it is one.
    fn sync_command(lines: &[&str], i: usize) -> Option<String> {
        let attr = lines[i].trim();
        if !attr.starts_with("#[tauri::command") || attr.contains("(async") {
            return None;
        }
        // skip further attributes and doc comments between the attribute and the fn
        let decl = lines[i + 1..]
            .iter()
            .map(|l| l.trim())
            .find(|l| !l.starts_with("#[") && !l.starts_with("//") && !l.is_empty())?;
        let rest = decl
            .strip_prefix("pub(crate) ")
            .or_else(|| decl.strip_prefix("pub "))
            .unwrap_or(decl);
        if rest.starts_with("async fn ") {
            return None;
        }
        let rest = rest.strip_prefix("fn ")?;
        Some(
            rest.chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect(),
        )
    }

    #[test]
    fn no_command_runs_on_the_main_thread_unless_allowed() {
        let mut sync = Vec::new();
        for (file, src) in SOURCES {
            let lines: Vec<&str> = src.lines().collect();
            for i in 0..lines.len() {
                if let Some(name) = sync_command(&lines, i)
                    && !MAIN_THREAD.contains(&name.as_str())
                {
                    sync.push(format!("{file}: {name}"));
                }
            }
        }
        assert!(
            sync.is_empty(),
            "make these `async fn` or `#[tauri::command(async)]`: {sync:?}"
        );
    }

    #[test]
    fn the_rule_sees_every_command_file_and_every_spelling() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        for entry in std::fs::read_dir(dir).unwrap() {
            let name = format!("commands/{}", entry.unwrap().file_name().to_string_lossy());
            assert!(
                SOURCES.iter().any(|(f, _)| *f == name),
                "{name} is missing in SOURCES"
            );
        }
        let lines = [
            "#[tauri::command(rename_all = \"snake_case\")]",
            "/// doc",
            "#[allow(clippy::x)]",
            "fn hidden<R: Runtime>() {}",
            "#[tauri::command(async)]",
            "pub fn fine() {}",
            "#[tauri::command]",
            "pub async fn also_fine() {}",
        ];
        assert_eq!(sync_command(&lines, 0).as_deref(), Some("hidden"));
        assert_eq!(sync_command(&lines, 4), None);
        assert_eq!(sync_command(&lines, 6), None);
    }
}

#[cfg(test)]
mod listing_contract {
    #[test]
    fn a_local_listing_says_network_false_on_the_wire() {
        let tmp = tempfile::tempdir().unwrap();
        let l = super::list_dir(tmp.path()).unwrap();
        assert!(!l.network);
        let json = serde_json::to_value(&l).unwrap();
        assert_eq!(json["network"], serde_json::Value::Bool(false));
    }
}
