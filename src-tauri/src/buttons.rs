//! User override of the button bar (`buttons.json` in the app config directory,
//! design 022 E1): per modifier set the action ids of its buttons. A set in the
//! file replaces the built-in set, the others stay built in. Rust checks shape and
//! size only; the frontend knows the action catalog and drops unknown ids.
//! Keep in sync with `src/app/core/config/config.models.ts`.

use crate::config_file::{Loaded, read_config};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "buttons.json";
pub const VERSION: u32 = 1;
pub const SETS: [&str; 5] = ["default", "shift", "ctrl", "alt", "cmd"];
pub const MAX_SLOTS: usize = 10;
pub const MAX_ID_LEN: usize = 64;
pub const MAX_FILE_BYTES: u64 = 64 * 1024;

/// Modifier set → action ids.
pub type Sets = BTreeMap<String, Vec<String>>;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonsOverride {
    #[serde(default)]
    pub sets: Sets,
}

#[derive(Debug, Serialize, Deserialize)]
struct ButtonsFile {
    version: u32,
    #[serde(default)]
    sets: Sets,
}

/// An action id as the catalog writes them (`OPEN_COPY_DLG`).
fn id_ok(id: &str) -> bool {
    let mut chars = id.chars();
    id.len() <= MAX_ID_LEN
        && chars.next().is_some_and(|c| c.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Known sets only; per set valid ids, no duplicates, at most [`MAX_SLOTS`].
pub fn bound(sets: Sets) -> Sets {
    sets.into_iter()
        .filter(|(set, _)| SETS.contains(&set.as_str()))
        .map(|(set, ids)| {
            let mut kept: Vec<String> = Vec::new();
            for id in ids {
                if id_ok(&id) && !kept.contains(&id) && kept.len() < MAX_SLOTS {
                    kept.push(id);
                }
            }
            (set, kept)
        })
        .collect()
}

fn parse(text: &str) -> Result<ButtonsOverride, String> {
    let file: ButtonsFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(ButtonsOverride {
        sets: bound(file.sets),
    })
}

pub fn load(file: &Path) -> Loaded<ButtonsOverride> {
    read_config(file, MAX_FILE_BYTES, ButtonsOverride::default, parse)
}

pub fn save(file: &Path, sets: Sets) -> io::Result<()> {
    let data = ButtonsFile {
        version: VERSION,
        sets: bound(sets),
    };
    let json = serde_json::to_vec_pretty(&data).map_err(io::Error::other)?;
    write_atomic(file, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn sets(pairs: &[(&str, &[&str])]) -> Sets {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect()))
            .collect()
    }

    #[test]
    fn round_trip() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("cfg ä 😀").join(FILE_NAME);
        let s = sets(&[("shift", &["OPEN_VIEW_DLG", "OPEN_COPY_DLG"]), ("alt", &[])]);
        save(&file, s.clone()).unwrap();
        let l = load(&file);
        assert_eq!(l.warning, None);
        assert_eq!(l.value.sets, s);
        assert!(
            fs::read_to_string(&file)
                .unwrap()
                .contains("\"version\": 1")
        );
    }

    #[test]
    fn bounds_sets_ids_and_slots() {
        let many: Vec<String> = (0..MAX_SLOTS + 3).map(|i| format!("A{i}")).collect();
        let mut input = sets(&[
            (
                "default",
                &["OPEN_COPY_DLG", "OPEN_COPY_DLG", "lower", "", "X-Y", "ÄÖ"],
            ),
            ("meta", &["OPEN_COPY_DLG"]),
        ]);
        input.insert("shift".into(), many);
        input.insert(
            "ctrl".into(),
            vec!["A".repeat(MAX_ID_LEN + 1), "B1_".into()],
        );
        let out = bound(input);
        assert_eq!(out["default"], ["OPEN_COPY_DLG"]);
        assert_eq!(out["shift"].len(), MAX_SLOTS);
        assert_eq!(out["ctrl"], ["B1_"]);
        assert!(!out.contains_key("meta"));
    }

    #[test]
    fn broken_files_and_other_versions_are_kept_aside() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        for text in [
            "{",
            r#"{"version":2,"sets":{}}"#,
            r#"{"sets":{}}"#,
            r#"{"version":1,"sets":[]}"#,
            // the mr format is for the import (026), not this file
            r#"{"default":["OPEN_COPY_DLG"]}"#,
        ] {
            fs::write(&file, text).unwrap();
            let l = load(&file);
            assert!(l.value.sets.is_empty(), "{text}");
            assert_eq!(l.warning.unwrap().code, "broken", "{text}");
            assert_eq!(
                fs::read_to_string(dir.path().join("buttons.json.bad")).unwrap(),
                text
            );
        }
    }

    #[test]
    fn missing_file_is_no_override() {
        let dir = tempdir().unwrap();
        let l = load(&dir.path().join(FILE_NAME));
        assert!(l.value.sets.is_empty() && l.warning.is_none() && l.persist);
    }
}
