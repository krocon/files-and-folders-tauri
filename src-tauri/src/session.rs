//! Session state (tabs of both panels, active side, splitter, favourites, window
//! geometry) stored as one JSON file in the app config directory.
//!
//! Pure std/serde logic without Tauri: loading never fails (broken files fall
//! back to defaults with a warning and are kept as `*.bad`), saving is atomic
//! (temp file in the same directory + rename), and everything coming from the
//! frontend or from disk is bounded by [`sanitize`].
//! Keep in sync with `src/app/core/session/session.models.ts`.

use crate::fs_atomic::{keep_broken_file, write_atomic};
use crate::paths::validate_input_path;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const SESSION_VERSION: u32 = 1;
pub const FILE_NAME: &str = "session.json";

pub const MAX_TABS_PER_PANEL: usize = 50;
pub const MAX_HISTORY: usize = 15;
pub const MAX_FAVORITES: usize = 200;
pub const MAX_RECENT: usize = 20;
pub const MAX_FILTER_TEXT: usize = 1_000;
pub const MAX_TITLE: usize = 255;
/// Longest accepted path/id string (longer ones are dropped, no real path is that long).
pub const MAX_STRING: usize = 32 * 1024;
/// Upper bound for the opaque table state of one tab (serialised JSON bytes).
pub const MAX_TABLE_STATE_BYTES: usize = 64 * 1024;
pub const SPLITTER_MIN: f64 = 0.15;
pub const SPLITTER_MAX: f64 = 0.85;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    #[default]
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub version: u32,
    pub active_side: Side,
    /// Share of the left side, `SPLITTER_MIN ..= SPLITTER_MAX`.
    pub splitter: f64,
    pub favorites: Vec<String>,
    /// Recently visited folders, newest first.
    pub recent: Vec<String>,
    pub panels: Panels,
    /// Shell bar (design 021 E10): visibility and output area.
    pub shell: ShellSession,
    /// Written by Rust only (the frontend never sends it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<WindowGeometry>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            version: SESSION_VERSION,
            active_side: Side::Left,
            splitter: 0.5,
            favorites: Vec::new(),
            recent: Vec::new(),
            panels: Panels::default(),
            shell: ShellSession::default(),
            window: None,
        }
    }
}

pub const SHELL_OUTPUT_MIN: f64 = 60.0;
pub const SHELL_OUTPUT_MAX: f64 = 800.0;
pub const SHELL_OUTPUT_DEFAULT: f64 = 160.0;

/// Shell bar state kept across restarts (design 021 E10) – never the output itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellSession {
    pub visible: bool,
    pub output_open: bool,
    /// Height of the output area in CSS pixels.
    pub output_height: f64,
}

impl Default for ShellSession {
    fn default() -> Self {
        Self {
            visible: false,
            output_open: true,
            output_height: SHELL_OUTPUT_DEFAULT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Panels {
    pub left: PanelSession,
    pub right: PanelSession,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PanelSession {
    pub active_tab: usize,
    pub tabs: Vec<TabSession>,
}

impl Default for PanelSession {
    fn default() -> Self {
        Self {
            active_tab: 0,
            tabs: vec![TabSession::default()],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TabSession {
    pub id: String,
    /// `None` = home directory.
    pub path: Option<String>,
    /// Display name of the folder (last path segment), computed by Rust when listing.
    pub title: String,
    /// Newest first.
    pub history: Vec<String>,
    pub cursor: Option<String>,
    pub hidden_visible: bool,
    pub filter_active: bool,
    pub filter_text: String,
    /// GuiExpert `TableStateIf` (columns, sort, scroll) – opaque here.
    pub table: Option<serde_json::Value>,
}

/// Outer position and inner size in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

/// Result of [`load`]: never an error, at worst defaults plus a warning.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadOutcome {
    pub session: Session,
    pub warning: Option<String>,
    /// `false` = the existing file could neither be used nor moved aside – do not save.
    pub persist: bool,
}

/// A tab path that no longer existed and was replaced on start.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdjustedPath {
    pub from: String,
    /// `None` = home directory.
    pub to: Option<String>,
}

/// Answer of the `load_session` command.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSession {
    pub session: Session,
    pub warning: Option<String>,
    pub adjusted: Vec<AdjustedPath>,
}

/// Loads and sanitises the session file. A missing file yields defaults
/// without warning; an unreadable, unparsable or incompatible file yields
/// defaults with a warning and is kept next to it as `<name>.bad`.
pub fn load(file: &Path) -> LoadOutcome {
    let mut outcome = load_unsanitized(file);
    // defaults too: their tabs need ids
    sanitize(&mut outcome.session);
    outcome
}

fn load_unsanitized(file: &Path) -> LoadOutcome {
    let failure = match fs::read_to_string(file) {
        Ok(text) => match parse(&text) {
            Ok(session) => {
                return LoadOutcome {
                    session,
                    warning: None,
                    persist: true,
                };
            }
            Err(reason) => format!("The saved session was invalid ({reason})"),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return LoadOutcome {
                session: Session::default(),
                warning: None,
                persist: true,
            };
        }
        // e.g. not UTF-8, or locked by another program (Windows)
        Err(e) => format!("The saved session could not be read ({e})"),
    };
    // Never overwrite a file we could not use: move it aside first. If even that
    // fails, this run must not save at all.
    match keep_broken_file(file) {
        Some(bad) => LoadOutcome {
            session: Session::default(),
            warning: Some(format!(
                "{failure}; defaults are used. The old file was kept as {}.",
                bad.display()
            )),
            persist: true,
        },
        None => LoadOutcome {
            session: Session::default(),
            warning: Some(format!(
                "{failure}; defaults are used and changes are not saved in this session."
            )),
            persist: false,
        },
    }
}

fn parse(text: &str) -> Result<Session, String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    match value.get("version").and_then(serde_json::Value::as_u64) {
        Some(v) if v == u64::from(SESSION_VERSION) => {}
        Some(v) => return Err(format!("unsupported version {v}")),
        None => return Err("no version".into()),
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

/// Writes the session atomically (see [`write_atomic`]).
pub fn save(file: &Path, session: &Session) -> io::Result<()> {
    let json = serde_json::to_vec_pretty(session).map_err(io::Error::other)?;
    write_atomic(file, &json)
}

/// Bounds every value so that neither a broken file nor a buggy frontend can
/// produce an unusable state (no tabs, index out of range, huge lists …).
pub fn sanitize(session: &mut Session) {
    session.version = SESSION_VERSION;
    session.shell.output_height = if session.shell.output_height.is_finite() {
        session
            .shell
            .output_height
            .clamp(SHELL_OUTPUT_MIN, SHELL_OUTPUT_MAX)
    } else {
        SHELL_OUTPUT_DEFAULT
    };
    session.splitter = if session.splitter.is_finite() {
        session.splitter.clamp(SPLITTER_MIN, SPLITTER_MAX)
    } else {
        0.5
    };
    let mut seen = HashSet::new();
    session
        .favorites
        .retain(|f| !f.is_empty() && f.len() <= MAX_STRING && seen.insert(f.clone()));
    session.favorites.truncate(MAX_FAVORITES);
    let mut seen_recent = HashSet::new();
    session
        .recent
        .retain(|r| !r.is_empty() && r.len() <= MAX_STRING && seen_recent.insert(r.clone()));
    session.recent.truncate(MAX_RECENT);

    let mut ids = HashSet::new();
    let mut next_id = 0usize;
    for panel in [&mut session.panels.left, &mut session.panels.right] {
        panel.tabs.truncate(MAX_TABS_PER_PANEL);
        if panel.tabs.is_empty() {
            panel.tabs.push(TabSession::default());
        }
        for tab in &mut panel.tabs {
            if tab.id.len() > 64 {
                tab.id.clear();
            }
            if tab.id.is_empty() || !ids.insert(tab.id.clone()) {
                loop {
                    next_id += 1;
                    let candidate = format!("t{next_id}");
                    if ids.insert(candidate.clone()) {
                        tab.id = candidate;
                        break;
                    }
                }
            }
            if tab
                .path
                .as_deref()
                .is_some_and(|p| p.is_empty() || p.len() > MAX_STRING)
            {
                tab.path = None;
            }
            if tab.cursor.as_deref().is_some_and(|c| c.len() > MAX_STRING) {
                tab.cursor = None;
            }
            tab.history
                .retain(|h| !h.is_empty() && h.len() <= MAX_STRING);
            tab.history.truncate(MAX_HISTORY);
            if tab.title.chars().count() > MAX_TITLE {
                tab.title = tab.title.chars().take(MAX_TITLE).collect();
            }
            if tab.filter_text.chars().count() > MAX_FILTER_TEXT {
                tab.filter_text = tab.filter_text.chars().take(MAX_FILTER_TEXT).collect();
            }
            let too_big = tab.table.as_ref().is_some_and(|t| {
                serde_json::to_vec(t).map_or(true, |v| v.len() > MAX_TABLE_STATE_BYTES)
            });
            if too_big || tab.table.as_ref().is_some_and(serde_json::Value::is_null) {
                tab.table = None;
            }
        }
        panel.active_tab = panel.active_tab.min(panel.tabs.len() - 1);
    }
}

/// Replaces tab paths that are no longer directories by the nearest existing
/// parent directory (lexically, symlinks are not resolved), or by the home
/// directory (`None`) if nothing exists. A tab in (or on) an existing archive
/// comes back at the archive's folder with the cursor on the archive – archives
/// are never opened at start-up (a broken or huge one would do it at every
/// start, review 016 #1); that is not reported. Returns every replacement.
pub fn resolve_missing_paths(session: &mut Session) -> Vec<AdjustedPath> {
    let mut adjusted = Vec::new();
    for panel in [&mut session.panels.left, &mut session.panels.right] {
        for tab in &mut panel.tabs {
            let Some(raw) = tab.path.clone() else {
                continue;
            };
            let replacement = match validate_input_path(&raw) {
                Ok(p) => {
                    let found = nearest_existing_dir(&p);
                    if found.as_deref() == Some(p.as_path()) {
                        continue;
                    }
                    if let Some((archive, _)) = crate::archive::resolve(&p)
                        && let Some(folder) = archive.parent()
                    {
                        tab.path = Some(folder.to_string_lossy().into_owned());
                        tab.title = String::new();
                        tab.cursor = Some(archive.to_string_lossy().into_owned());
                        tab.table = tab.table.take().map(drop_scroll);
                        continue;
                    }
                    found
                }
                Err(_) => None,
            };
            let to = replacement.map(|p| p.to_string_lossy().into_owned());
            tab.path = to.clone();
            tab.title = String::new();
            tab.cursor = None;
            tab.table = tab.table.take().map(drop_scroll);
            adjusted.push(AdjustedPath { from: raw, to });
        }
    }
    adjusted
}

/// `path` itself if it is a directory, otherwise the closest ancestor that is.
pub fn nearest_existing_dir(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|p| !p.as_os_str().is_empty() && p.is_dir())
        .map(Path::to_path_buf)
}

/// The scroll position of another folder is meaningless – keep columns and sort.
fn drop_scroll(mut table: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = table.as_object_mut() {
        obj.remove("scroll");
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    /// Defaults as `load` returns them: sanitised, so every tab has a unique id.
    fn defaults() -> Session {
        let mut s = Session::default();
        sanitize(&mut s);
        s
    }

    #[test]
    fn shell_bar_state_is_optional_and_bounded() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        // a session of an older build has no `shell` – defaults
        fs::write(&file, r#"{"version":1,"activeSide":"right"}"#).unwrap();
        let s = load(&file).session;
        assert_eq!(s.shell, ShellSession::default());
        fs::write(
            &file,
            r#"{"version":1,"shell":{"visible":true,"outputOpen":false,"outputHeight":5000}}"#,
        )
        .unwrap();
        let s = load(&file).session;
        assert!(s.shell.visible && !s.shell.output_open);
        assert_eq!(s.shell.output_height, SHELL_OUTPUT_MAX);
        let mut s = defaults();
        s.shell.output_height = f64::NAN;
        sanitize(&mut s);
        assert_eq!(s.shell.output_height, SHELL_OUTPUT_DEFAULT);
    }

    #[test]
    fn loaded_defaults_have_unique_tab_ids() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        fs::write(&file, "garbage").unwrap();
        let s = load(&file).session;
        let (l, r) = (&s.panels.left.tabs[0].id, &s.panels.right.tabs[0].id);
        assert!(!l.is_empty() && !r.is_empty() && l != r);
    }

    fn tab(id: &str, path: Option<&str>) -> TabSession {
        TabSession {
            id: id.into(),
            path: path.map(Into::into),
            ..TabSession::default()
        }
    }

    fn sample() -> Session {
        let mut s = Session {
            active_side: Side::Right,
            splitter: 0.3,
            favorites: vec!["/a".into(), "/Users/jörg/Mein Ordner 📁".into()],
            recent: vec!["/r".into(), "/r".into(), "/s".into()],
            ..Session::default()
        };
        s.panels.left = PanelSession {
            active_tab: 1,
            tabs: vec![tab("a", Some("/x")), tab("b", None)],
        };
        s.panels.left.tabs[0].table =
            Some(json!({"version":1,"sort":[{"property":"size","sortState":"desc"}]}));
        s.panels.left.tabs[0].history = vec!["/y".into()];
        s.window = Some(WindowGeometry {
            x: -100,
            y: 20,
            width: 1200,
            height: 800,
            maximized: false,
        });
        sanitize(&mut s);
        s
    }

    #[test]
    fn round_trip_keeps_everything() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("sub dir/session.json");
        let s = sample();
        save(&file, &s).unwrap();
        let loaded = load(&file);
        assert_eq!(loaded.warning, None);
        assert_eq!(loaded.session, s);
    }

    #[test]
    fn serialises_camel_case_and_snake_case_side() {
        let v = serde_json::to_value(sample()).unwrap();
        assert_eq!(v["activeSide"], "right");
        assert_eq!(v["panels"]["left"]["activeTab"], 1);
        assert_eq!(v["panels"]["left"]["tabs"][0]["hiddenVisible"], false);
        assert_eq!(v["window"]["width"], 1200);
        assert!(
            serde_json::to_value(Session::default())
                .unwrap()
                .get("window")
                .is_none()
        );
    }

    #[test]
    fn missing_file_gives_defaults_without_warning() {
        let dir = tempdir().unwrap();
        let out = load(&dir.path().join("session.json"));
        assert_eq!(out.session, defaults());
        assert_eq!(out.warning, None);
    }

    #[test]
    fn garbage_gives_defaults_with_warning_and_keeps_the_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        fs::write(&file, "{ not json").unwrap();
        let out = load(&file);
        assert_eq!(out.session, defaults());
        assert!(out.warning.as_deref().unwrap().contains("invalid"));
        assert!(!file.exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("session.json.bad")).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn wrong_version_or_wrong_types_are_rejected() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        for text in [
            r#"{"version": 2}"#,
            r#"{"splitter": 0.4}"#,
            r#"{"version": 1, "panels": {"left": {"tabs": "nope"}}}"#,
            "[]",
        ] {
            fs::write(&file, text).unwrap();
            let out = load(&file);
            assert_eq!(out.session, defaults(), "{text}");
            assert!(out.warning.is_some(), "{text}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_file_is_moved_aside_before_defaults_are_used() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        fs::write(&file, b"{\"version\":1,\"favorites\":[\"\xff\"]}").unwrap();
        let out = load(&file);
        assert!(out.persist);
        assert!(
            out.warning
                .as_deref()
                .unwrap()
                .contains("could not be read")
        );
        assert!(dir.path().join("session.json.bad").exists());
        assert!(!file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn broken_file_that_cannot_be_moved_disables_saving() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        fs::write(&file, "garbage").unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();
        let out = load(&file);
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
        if file.exists() {
            // not root: the rename failed, the file must stay untouched and saving is off
            assert!(!out.persist);
            assert_eq!(fs::read_to_string(&file).unwrap(), "garbage");
        }
    }

    #[test]
    fn sanitize_drops_oversized_strings() {
        let huge = "x".repeat(MAX_STRING + 1);
        let mut s = Session {
            favorites: vec![huge.clone(), "/ok".into()],
            ..Session::default()
        };
        s.panels.left.tabs[0].path = Some(huge.clone());
        s.panels.left.tabs[0].cursor = Some(huge.clone());
        s.panels.left.tabs[0].history = vec![huge.clone(), "/h".into()];
        s.panels.left.tabs[0].id = huge;
        sanitize(&mut s);
        assert_eq!(s.favorites, vec!["/ok".to_string()]);
        let t = &s.panels.left.tabs[0];
        assert_eq!((t.path.clone(), t.cursor.clone()), (None, None));
        assert_eq!(t.history, vec!["/h".to_string()]);
        assert!(t.id.len() <= 64);
    }

    #[test]
    fn unknown_fields_are_ignored_and_missing_fields_defaulted() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        fs::write(
            &file,
            r#"{"version":1,"future":true,"panels":{"right":{"tabs":[{"path":"/r","x":1}]}}}"#,
        )
        .unwrap();
        let out = load(&file);
        assert_eq!(out.warning, None);
        assert_eq!(out.session.panels.right.tabs[0].path.as_deref(), Some("/r"));
        assert_eq!(
            out.session.panels.left,
            PanelSession {
                tabs: vec![tab("t1", None)],
                active_tab: 0
            }
        );
        assert_eq!(out.session.splitter, 0.5);
    }

    #[test]
    fn sanitize_bounds_all_values() {
        let mut s = Session {
            splitter: 7.0,
            favorites: vec!["/a".into(), "".into(), "/a".into()],
            ..Session::default()
        };
        s.panels.left = PanelSession {
            active_tab: 99,
            tabs: (0..60)
                .map(|i| tab("dup", Some(&format!("/p{i}"))))
                .collect(),
        };
        s.panels.left.tabs[0].history = (0..30).map(|i| format!("/h{i}")).collect();
        s.panels.left.tabs[0].filter_text = "ä".repeat(2_000);
        s.panels.left.tabs[0].title = "x".repeat(300);
        s.panels.left.tabs[0].path = Some(String::new());
        s.panels.left.tabs[1].table = Some(json!({"custom": "x".repeat(MAX_TABLE_STATE_BYTES)}));
        s.panels.right = PanelSession {
            active_tab: 3,
            tabs: vec![],
        };
        sanitize(&mut s);
        assert_eq!(s.splitter, SPLITTER_MAX);
        assert_eq!(s.favorites, vec!["/a".to_string()]);
        let left = &s.panels.left;
        assert_eq!(left.tabs.len(), MAX_TABS_PER_PANEL);
        assert_eq!(left.active_tab, MAX_TABS_PER_PANEL - 1);
        let ids: HashSet<_> = left.tabs.iter().map(|t| t.id.clone()).collect();
        assert_eq!(ids.len(), MAX_TABS_PER_PANEL, "ids must be unique");
        assert_eq!(left.tabs[0].history.len(), MAX_HISTORY);
        assert_eq!(left.tabs[0].filter_text.chars().count(), MAX_FILTER_TEXT);
        assert_eq!(left.tabs[0].title.len(), MAX_TITLE);
        assert_eq!(left.tabs[0].path, None);
        assert_eq!(left.tabs[1].table, None);
        assert_eq!(s.panels.right.tabs.len(), 1);
        assert_eq!(s.panels.right.active_tab, 0);

        let mut nan = Session {
            splitter: f64::NAN,
            ..Session::default()
        };
        sanitize(&mut nan);
        assert_eq!(nan.splitter, 0.5);
    }

    #[test]
    fn save_leaves_no_temp_file_and_replaces_the_old_one() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        save(&file, &Session::default()).unwrap();
        save(&file, &sample()).unwrap();
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["session.json".to_string()]);
        assert_eq!(load(&file).session, sample());
    }

    #[cfg(unix)]
    #[test]
    fn failed_save_keeps_the_old_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let file = dir.path().join("session.json");
        save(&file, &sample()).unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();
        let result = save(&file, &Session::default());
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
        // root ignores permissions – then the save simply succeeds
        if result.is_err() {
            assert_eq!(load(&file).session, sample());
        }
    }

    #[test]
    fn nearest_existing_dir_climbs_to_an_existing_parent() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("Mein Ordner ä 📁");
        fs::create_dir_all(base.join("kept")).unwrap();
        fs::write(base.join("file.txt"), "x").unwrap();
        assert_eq!(
            nearest_existing_dir(&base.join("kept")),
            Some(base.join("kept"))
        );
        assert_eq!(
            nearest_existing_dir(&base.join("gone/deeper")),
            Some(base.clone())
        );
        assert_eq!(
            nearest_existing_dir(&base.join("file.txt")),
            Some(base.clone())
        );
    }

    #[test]
    fn resolve_missing_paths_reports_replacements() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("base ü");
        fs::create_dir_all(&base).unwrap();
        let exists = base.to_string_lossy().into_owned();
        let gone = base.join("gone").to_string_lossy().into_owned();
        let mut s = Session::default();
        s.panels.left.tabs = vec![
            tab("a", Some(&exists)),
            tab("b", Some(&gone)),
            tab("c", None),
        ];
        s.panels.left.tabs[1].cursor = Some(format!("{gone}/x"));
        s.panels.left.tabs[1].table =
            Some(json!({"version":1,"sort":[],"scroll":{"left":0,"top":500}}));
        s.panels.right.tabs = vec![tab("d", Some("relative/path"))];
        let adjusted = resolve_missing_paths(&mut s);
        assert_eq!(
            adjusted,
            vec![
                AdjustedPath {
                    from: gone.clone(),
                    to: Some(exists.clone())
                },
                AdjustedPath {
                    from: "relative/path".into(),
                    to: None
                },
            ]
        );
        let left = &s.panels.left.tabs;
        assert_eq!(left[0].path.as_deref(), Some(exists.as_str()));
        assert_eq!(left[1].path.as_deref(), Some(exists.as_str()));
        assert_eq!(left[1].cursor, None);
        assert_eq!(left[1].table, Some(json!({"version":1,"sort":[]})));
        assert_eq!(left[2].path, None);
        assert_eq!(s.panels.right.tabs[0].path, None);
    }

    /// E2E 016 + review 016 #1: a tab inside an archive comes back at the folder of the
    /// archive with the cursor on it – a broken or huge archive must not be opened at
    /// every start (crash loop).
    #[test]
    fn tabs_inside_an_archive_reopen_at_its_folder() {
        let dir = tempdir().unwrap();
        let zip = dir.path().join("a ü.zip");
        crate::archive::tests::make_zip(
            &zip,
            &[crate::archive::tests::E::File("ordner/x.txt", b"x")],
        );
        let inside = zip.join("ordner").to_string_lossy().into_owned();
        let gone = dir
            .path()
            .join("weg.zip")
            .join("ordner")
            .to_string_lossy()
            .into_owned();
        let mut s = Session::default();
        s.panels.left.tabs = vec![tab("a", Some(&inside)), tab("b", Some(&gone))];
        s.panels.left.tabs[0].cursor =
            Some(zip.join("ordner/x.txt").to_string_lossy().into_owned());
        let adjusted = resolve_missing_paths(&mut s);
        let folder = dir.path().to_string_lossy().into_owned();
        let left = &s.panels.left.tabs[0];
        assert_eq!(left.path.as_deref(), Some(folder.as_str()));
        assert_eq!(left.cursor.as_deref(), Some(zip.to_string_lossy().as_ref()));
        // the archive file itself is a file, never a folder to open
        s.panels.left.tabs = vec![tab("c", Some(&zip.to_string_lossy()))];
        assert_eq!(resolve_missing_paths(&mut s).len(), 0);
        assert_eq!(s.panels.left.tabs[0].path.as_deref(), Some(folder.as_str()));
        assert_eq!(
            s.panels.left.tabs[0].cursor.as_deref(),
            Some(zip.to_string_lossy().as_ref())
        );
        assert_eq!(
            adjusted.len(),
            1,
            "only the tab of the missing archive moves"
        );
        assert_eq!(adjusted[0].from, gone);
    }
}
