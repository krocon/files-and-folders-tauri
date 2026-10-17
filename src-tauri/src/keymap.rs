//! User override of the keyboard shortcuts (`keymap.json` in the app config
//! directory). Rust checks only shape and size; the frontend validates action
//! ids and shortcut syntax and reports problems (design 002, D1/D5).
//! Keep in sync with `src/app/core/actions/keymap-api.ts`.

use crate::fs_atomic::{keep_broken_file, write_atomic};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "keymap.json";
pub const VERSION: u32 = 1;
pub const MAX_ACTIONS: usize = 500;
pub const MAX_SHORTCUTS: usize = 8;
pub const MAX_ID_LEN: usize = 64;
pub const MAX_SHORTCUT_LEN: usize = 64;

/// Action id → shortcuts. An empty list = the action has no shortcut.
pub type Bindings = BTreeMap<String, Vec<String>>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct OverrideFile {
    version: u32,
    #[serde(default)]
    bindings: Bindings,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedOverride {
    pub bindings: Bindings,
    pub warning: Option<String>,
    /// `false` = a broken file could not be moved aside – do not save over it.
    #[serde(skip)]
    pub persist: bool,
}

/// Loads the override. Missing file → empty; broken file → empty + warning,
/// kept as `keymap.json.bad`.
pub fn load(file: &Path) -> LoadedOverride {
    let failure = match fs::read_to_string(file) {
        Ok(text) => match parse(&text) {
            Ok(bindings) => {
                return LoadedOverride {
                    bindings,
                    warning: None,
                    persist: true,
                };
            }
            Err(reason) => format!("The keyboard shortcut file was invalid ({reason})"),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return LoadedOverride {
                bindings: Bindings::new(),
                warning: None,
                persist: true,
            };
        }
        Err(e) => format!("The keyboard shortcut file could not be read ({e})"),
    };
    match keep_broken_file(file) {
        Some(bad) => LoadedOverride {
            bindings: Bindings::new(),
            warning: Some(format!(
                "{failure}; the default shortcuts are used. The old file was kept as {}.",
                bad.display()
            )),
            persist: true,
        },
        None => LoadedOverride {
            bindings: Bindings::new(),
            warning: Some(format!(
                "{failure}; the default shortcuts are used and changes are not saved in this session."
            )),
            persist: false,
        },
    }
}

fn parse(text: &str) -> Result<Bindings, String> {
    let file: OverrideFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(bound(file.bindings))
}

/// Drops oversized entries (shape and size only).
pub fn bound(bindings: Bindings) -> Bindings {
    bindings
        .into_iter()
        .filter(|(id, _)| !id.is_empty() && id.len() <= MAX_ID_LEN)
        .take(MAX_ACTIONS)
        .map(|(id, shortcuts)| {
            let kept: Vec<String> = shortcuts
                .into_iter()
                .filter(|s| !s.trim().is_empty() && s.len() <= MAX_SHORTCUT_LEN)
                .take(MAX_SHORTCUTS)
                .collect();
            (id, kept)
        })
        .collect()
}

pub fn save(file: &Path, bindings: Bindings) -> io::Result<()> {
    let data = OverrideFile {
        version: VERSION,
        bindings: bound(bindings),
    };
    let json = serde_json::to_vec_pretty(&data).map_err(io::Error::other)?;
    write_atomic(file, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn b(pairs: &[(&str, &[&str])]) -> Bindings {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect()))
            .collect()
    }

    #[test]
    fn round_trip_including_empty_lists() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("cfg ä/keymap.json");
        let bindings = b(&[
            ("OPEN_COPY_DLG", &["F5", "Mod+C"]),
            ("OPEN_DELETE_DLG", &[]),
        ]);
        save(&file, bindings.clone()).unwrap();
        let loaded = load(&file);
        assert_eq!(loaded.warning, None);
        assert_eq!(loaded.bindings, bindings);
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.contains("\"version\": 1"));
    }

    #[test]
    fn missing_file_is_empty_without_warning() {
        let dir = tempdir().unwrap();
        let loaded = load(&dir.path().join("keymap.json"));
        assert!(loaded.bindings.is_empty() && loaded.warning.is_none() && loaded.persist);
    }

    #[test]
    fn broken_file_gives_a_warning_and_is_kept() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("keymap.json");
        for text in [
            "{",
            r#"{"version":2}"#,
            r#"{"version":1,"bindings":{"A":"F5"}}"#,
        ] {
            fs::write(&file, text).unwrap();
            let loaded = load(&file);
            assert!(loaded.bindings.is_empty(), "{text}");
            assert!(
                loaded.warning.as_deref().unwrap().contains("invalid"),
                "{text}"
            );
            assert_eq!(
                fs::read_to_string(dir.path().join("keymap.json.bad")).unwrap(),
                text
            );
        }
    }

    #[test]
    fn oversized_entries_are_dropped() {
        let long = "x".repeat(MAX_SHORTCUT_LEN + 1);
        let id = "I".repeat(MAX_ID_LEN + 1);
        let many: Vec<&str> = (0..20).map(|_| "F1").collect();
        let out = bound(b(&[
            ("A", &[&long, "F5", " "]),
            (&id, &["F6"]),
            ("B", &many),
        ]));
        assert_eq!(out["A"], vec!["F5".to_string()]);
        assert!(!out.contains_key(&id));
        assert_eq!(out["B"].len(), MAX_SHORTCUTS);
        let lots: Bindings = (0..MAX_ACTIONS + 10)
            .map(|i| (format!("A{i}"), vec![]))
            .collect();
        assert_eq!(bound(lots).len(), MAX_ACTIONS);
    }
}
