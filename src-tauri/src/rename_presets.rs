//! Multi-rename presets (`rename-presets.json` in the app config directory,
//! design 007 E9): the last used settings and named presets. Rust checks only
//! shape and size – the rules are the frontend's business (`serde_json::Value`).
//! Never contains file names. Keep in sync with `src/app/core/rename/rename.models.ts`.

use crate::fs_atomic::{keep_broken_file, write_atomic};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "rename-presets.json";
pub const VERSION: u32 = 1;
pub const MAX_PRESETS: usize = 100;
pub const MAX_NAME_LEN: usize = 100;
/// Serialised size of one set of rules.
pub const MAX_RULES_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub name: String,
    pub rules: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePresets {
    #[serde(default = "version")]
    pub version: u32,
    #[serde(default)]
    pub last: Option<Value>,
    #[serde(default)]
    pub presets: Vec<Preset>,
}

fn version() -> u32 {
    VERSION
}

impl Default for RenamePresets {
    fn default() -> Self {
        Self {
            version: VERSION,
            last: None,
            presets: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPresets {
    pub presets: RenamePresets,
    pub warning: Option<String>,
    /// `false` = a broken file could not be moved aside – do not save over it.
    #[serde(skip)]
    pub persist: bool,
}

fn rules_ok(v: &Value) -> bool {
    v.is_object() && serde_json::to_vec(v).is_ok_and(|b| b.len() <= MAX_RULES_BYTES)
}

/// Drops what is too big or has the wrong shape; the first preset of a name wins.
pub fn bound(p: RenamePresets) -> RenamePresets {
    let mut presets: Vec<Preset> = Vec::new();
    for preset in p.presets {
        let name = preset.name.trim().to_string();
        if name.is_empty()
            || name.chars().count() > MAX_NAME_LEN
            || !rules_ok(&preset.rules)
            || presets.iter().any(|q| q.name == name)
        {
            continue;
        }
        presets.push(Preset {
            name,
            rules: preset.rules,
        });
        if presets.len() == MAX_PRESETS {
            break;
        }
    }
    RenamePresets {
        version: VERSION,
        last: p.last.filter(rules_ok),
        presets,
    }
}

fn parse(text: &str) -> Result<RenamePresets, String> {
    let file: RenamePresets = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(bound(file))
}

/// Missing file → empty; broken file (parse/version) → empty + warning, kept
/// as `.bad`; unreadable file → empty + warning, untouched, not saved over.
pub fn load(file: &Path) -> LoadedPresets {
    load_named(file, "multi-rename presets")
}

/// [`load`] for another file of the same shape (`what` names it in the warnings) – the
/// rule sets of the duplicate search (design 042 E2, `duplicate-rules.json`).
pub fn load_named(file: &Path, what: &str) -> LoadedPresets {
    let failure = match fs::read_to_string(file) {
        Ok(text) => match parse(&text) {
            Ok(presets) => {
                return LoadedPresets {
                    presets,
                    warning: None,
                    persist: true,
                };
            }
            Err(reason) => format!("The {what} file was invalid ({reason})"),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return LoadedPresets {
                presets: RenamePresets::default(),
                warning: None,
                persist: true,
            };
        }
        // a read error is no broken file: leave it alone and do not save over it
        Err(e) => {
            return LoadedPresets {
                presets: RenamePresets::default(),
                warning: Some(format!(
                    "The {what} file could not be read ({e}); changes are not saved in this session."
                )),
                persist: false,
            };
        }
    };
    match keep_broken_file(file) {
        Some(bad) => LoadedPresets {
            presets: RenamePresets::default(),
            warning: Some(format!(
                "{failure}; the old file was kept as {}.",
                bad.display()
            )),
            persist: true,
        },
        None => LoadedPresets {
            presets: RenamePresets::default(),
            warning: Some(format!("{failure}; changes are not saved in this session.")),
            persist: false,
        },
    }
}

pub fn save(file: &Path, presets: RenamePresets) -> io::Result<()> {
    let json = serde_json::to_vec_pretty(&bound(presets)).map_err(io::Error::other)?;
    write_atomic(file, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn round_trip() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("cfg ä").join(FILE_NAME);
        let p = RenamePresets {
            version: VERSION,
            last: Some(json!({"pattern": "[N].[E]"})),
            presets: vec![Preset {
                name: "Filme".into(),
                rules: json!({"pattern": "[N] ([C])"}),
            }],
        };
        save(&file, p.clone()).unwrap();
        let loaded = load(&file);
        assert_eq!(loaded.warning, None);
        assert_eq!(loaded.presets, p);
    }

    #[test]
    fn missing_and_broken_files() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        let l = load(&file);
        assert!(l.presets.presets.is_empty() && l.warning.is_none() && l.persist);
        for text in ["{", r#"{"version":2}"#, r#"{"version":1,"presets":{}}"#] {
            fs::write(&file, text).unwrap();
            let l = load(&file);
            assert!(l.warning.as_deref().unwrap().contains("invalid"), "{text}");
            assert_eq!(
                fs::read_to_string(dir.path().join(format!("{FILE_NAME}.bad"))).unwrap(),
                text
            );
        }
    }

    /// Review R8: a read error (here: a folder in the file's place) is not a
    /// broken file – leave it alone and do not save over it.
    #[test]
    fn read_errors_leave_the_file_alone() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::create_dir(&file).unwrap();
        let l = load(&file);
        assert!(!l.persist);
        assert!(l.warning.as_deref().unwrap().contains("could not be read"));
        assert!(file.is_dir());
        assert!(!dir.path().join(format!("{FILE_NAME}.bad")).exists());
    }

    #[test]
    fn limits() {
        let big = json!({ "pattern": "x".repeat(MAX_RULES_BYTES) });
        let mut presets: Vec<Preset> = (0..MAX_PRESETS + 5)
            .map(|i| Preset {
                name: format!("p{i}"),
                rules: json!({}),
            })
            .collect();
        presets.insert(
            0,
            Preset {
                name: " ".into(),
                rules: json!({}),
            },
        );
        presets.insert(
            1,
            Preset {
                name: "big".into(),
                rules: big.clone(),
            },
        );
        presets.insert(
            2,
            Preset {
                name: "p0".into(),
                rules: json!({"dupe": true}),
            },
        );
        presets.insert(
            3,
            Preset {
                name: "arr".into(),
                rules: json!([1]),
            },
        );
        presets.insert(
            4,
            Preset {
                name: "n".repeat(MAX_NAME_LEN + 1),
                rules: json!({}),
            },
        );
        let out = bound(RenamePresets {
            version: 7,
            last: Some(big),
            presets,
        });
        assert_eq!(out.version, VERSION);
        assert!(out.last.is_none());
        assert_eq!(out.presets.len(), MAX_PRESETS);
        assert_eq!(out.presets[0].name, "p0");
        assert_eq!(out.presets[0].rules, json!({"dupe": true}));
        assert!(out.presets.iter().filter(|p| p.name == "p0").count() == 1);
    }
}
