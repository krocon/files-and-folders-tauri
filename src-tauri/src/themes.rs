//! Colour schemes (`themes.json` in the app config directory, design 013 E4):
//! the user's own schemes and the selection (system / fixed). Rust checks only
//! shape, size and that values are harmless CSS values – which tokens exist is
//! the frontend's business. Import/export of single scheme files (E5).
//! Keep in sync with `src/app/core/theme/theme.models.ts`.

use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::{keep_broken_file, write_atomic};
use crate::paths::validate_name;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "themes.json";
pub const VERSION: u32 = 1;
pub const MAX_THEMES: usize = 50;
pub const MAX_TOKENS: usize = 300;
pub const MAX_NAME_LEN: usize = 100;
pub const MAX_ID_LEN: usize = 64;
pub const MAX_TOKEN_NAME_LEN: usize = 80;
pub const MAX_VALUE_LEN: usize = 200;
/// Size limit of a scheme file to import.
pub const MAX_IMPORT_BYTES: u64 = 256 * 1024;
/// Suffix of exported files (`<name>.theme.json`).
pub const EXPORT_SUFFIX: &str = ".theme.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    /// `"system"` (follow `prefers-color-scheme`) or `"fixed"`.
    pub mode: String,
    /// The scheme for `fixed`.
    pub theme: String,
    /// The schemes `system` uses for light and dark.
    pub light: String,
    pub dark: String,
}

impl Default for Selection {
    fn default() -> Self {
        Self {
            mode: "system".into(),
            theme: "light".into(),
            light: "light".into(),
            dark: "dark".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub dark: bool,
    #[serde(default)]
    pub tokens: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemesFile {
    #[serde(default = "version")]
    pub version: u32,
    #[serde(default)]
    pub selection: Selection,
    #[serde(default)]
    pub themes: Vec<UserTheme>,
}

fn version() -> u32 {
    VERSION
}

impl Default for ThemesFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            selection: Selection::default(),
            themes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedThemes {
    pub file: ThemesFile,
    pub warning: Option<String>,
    /// `false` = a broken file could not be moved aside – do not save over it.
    #[serde(skip)]
    pub persist: bool,
}

/// `[a-z0-9-]`, 1–64 characters.
pub fn id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `--` + `[a-z0-9-]`, at most 80 characters.
pub fn token_name_ok(name: &str) -> bool {
    name.len() > 2
        && name.len() <= MAX_TOKEN_NAME_LEN
        && name.starts_with("--")
        && name[2..]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A harmless CSS value: short, no declaration/block/markup characters, nothing
/// that loads resources. Same rule as `isSafeValue` in `theme-logic.ts`.
pub fn value_ok(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > MAX_VALUE_LEN {
        return false;
    }
    if v.chars()
        .any(|c| matches!(c, ';' | '{' | '}' | '<' | '>' | '\\' | '@') || c.is_control())
    {
        return false;
    }
    let lower = v.to_ascii_lowercase();
    !["url(", "expression(", "image(", "image-set(", "element("]
        .iter()
        .any(|bad| lower.contains(bad))
}

fn short(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= max
}

/// Drops what is too big or has the wrong shape; the first scheme of an id wins.
pub fn bound(f: ThemesFile) -> ThemesFile {
    let mut themes: Vec<UserTheme> = Vec::new();
    for t in f.themes {
        let name = t.name.trim().to_string();
        if !id_ok(&t.id) || !short(&name, MAX_NAME_LEN) || themes.iter().any(|q| q.id == t.id) {
            continue;
        }
        let tokens: BTreeMap<String, String> = t
            .tokens
            .into_iter()
            .filter(|(k, v)| token_name_ok(k) && value_ok(v))
            .map(|(k, v)| (k, v.trim().to_string()))
            .take(MAX_TOKENS)
            .collect();
        themes.push(UserTheme {
            id: t.id,
            name,
            dark: t.dark,
            tokens,
        });
        if themes.len() == MAX_THEMES {
            break;
        }
    }
    let d = Selection::default();
    let pick = |s: String, fallback: String| if id_ok(&s) { s } else { fallback };
    let s = f.selection;
    ThemesFile {
        version: VERSION,
        selection: Selection {
            mode: if s.mode == "fixed" { s.mode } else { d.mode },
            theme: pick(s.theme, d.theme),
            light: pick(s.light, d.light),
            dark: pick(s.dark, d.dark),
        },
        themes,
    }
}

fn parse(text: &str) -> Result<ThemesFile, String> {
    let file: ThemesFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(bound(file))
}

/// Missing file → defaults; broken file (parse/version) → defaults + warning,
/// kept as `.bad`; unreadable file → defaults + warning, untouched, not saved over.
pub fn load(file: &Path) -> LoadedThemes {
    let failure = match fs::read_to_string(file) {
        Ok(text) => match parse(&text) {
            Ok(f) => {
                return LoadedThemes {
                    file: f,
                    warning: None,
                    persist: true,
                };
            }
            Err(reason) => format!("The colour scheme file was invalid ({reason})"),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return LoadedThemes {
                file: ThemesFile::default(),
                warning: None,
                persist: true,
            };
        }
        Err(e) => {
            return LoadedThemes {
                file: ThemesFile::default(),
                warning: Some(format!(
                    "The colour scheme file could not be read ({e}); changes are not saved in this session."
                )),
                persist: false,
            };
        }
    };
    match keep_broken_file(file) {
        Some(bad) => LoadedThemes {
            file: ThemesFile::default(),
            warning: Some(format!(
                "{failure}; the old file was kept as {}.",
                bad.display()
            )),
            persist: true,
        },
        None => LoadedThemes {
            file: ThemesFile::default(),
            warning: Some(format!("{failure}; changes are not saved in this session.")),
            persist: false,
        },
    }
}

pub fn save(file: &Path, themes: ThemesFile) -> io::Result<()> {
    let json = serde_json::to_vec_pretty(&bound(themes)).map_err(io::Error::other)?;
    write_atomic(file, &json)
}

/// Reads a scheme file to import: a regular file of at most 256 KiB holding a
/// JSON object. The frontend normalises the content (own or old format).
pub fn import(path: &Path) -> Result<Value, FsError> {
    let meta = fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    if !meta.is_file() {
        return Err(FsError::new(
            FsErrorCode::NotAFile,
            "Only a file can be imported as a colour scheme",
            Some(path),
        ));
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            format!(
                "The file is too big for a colour scheme (max. {} KiB)",
                MAX_IMPORT_BYTES / 1024
            ),
            Some(path),
        ));
    }
    let mut text = String::new();
    fs::File::open(path)
        .and_then(|f| f.take(MAX_IMPORT_BYTES + 1).read_to_string(&mut text))
        .map_err(|e| FsError::from_io(&e, path))?;
    let value: Value = serde_json::from_str(&text).map_err(|e| {
        FsError::new(
            FsErrorCode::InvalidPath,
            format!("The file is not a colour scheme (no JSON: {e})"),
            Some(path),
        )
    })?;
    if !value.is_object() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "The file is not a colour scheme (no JSON object)",
            Some(path),
        ));
    }
    Ok(value)
}

/// Writes `<name>.theme.json` into `dir` without overwriting anything
/// (`<name> (2).theme.json` …); returns the path written.
pub fn export(dir: &Path, name: &str, theme: &Value) -> Result<PathBuf, FsError> {
    let base = name.trim();
    if base.is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidName,
            "The name is empty",
            None,
        ));
    }
    validate_name(&format!("{base}{EXPORT_SUFFIX}"))?;
    if !theme.is_object() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Only a colour scheme object can be exported",
            None,
        ));
    }
    let meta = fs::metadata(dir).map_err(|e| FsError::from_io(&e, dir))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "The target is not a folder",
            Some(dir),
        ));
    }
    let bytes = serde_json::to_vec_pretty(theme)
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("Serialising failed: {e}"), None))?;
    for n in 1..=999 {
        let file_name = if n == 1 {
            format!("{base}{EXPORT_SUFFIX}")
        } else {
            format!("{base} ({n}){EXPORT_SUFFIX}")
        };
        let target = dir.join(&file_name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut f) => {
                let written = f.write_all(&bytes).and_then(|_| f.sync_all());
                if let Err(e) = written {
                    drop(f);
                    let _ = fs::remove_file(&target);
                    return Err(FsError::from_io(&e, &target));
                }
                return Ok(target);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(FsError::from_io(&e, &target)),
        }
    }
    Err(FsError::new(
        FsErrorCode::AlreadyExists,
        "Too many exported files of this name",
        Some(dir),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn theme(id: &str, tokens: &[(&str, &str)]) -> UserTheme {
        UserTheme {
            id: id.into(),
            name: format!("Name {id}"),
            dark: true,
            tokens: tokens
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    #[test]
    fn round_trip() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("cfg ä ü").join(FILE_NAME);
        let f = ThemesFile {
            version: VERSION,
            selection: Selection {
                mode: "fixed".into(),
                theme: "user-mein-schema".into(),
                light: "light".into(),
                dark: "dark".into(),
            },
            themes: vec![theme(
                "user-mein-schema",
                &[
                    ("--color-bg", "#101010"),
                    ("--color-text", "var(--color-muted)"),
                ],
            )],
        };
        save(&file, f.clone()).unwrap();
        let loaded = load(&file);
        assert_eq!(loaded.warning, None);
        assert_eq!(loaded.file, f);
    }

    #[test]
    fn missing_and_broken_files() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        let l = load(&file);
        assert_eq!(l.file, ThemesFile::default());
        assert!(l.warning.is_none() && l.persist);
        for text in ["{", r#"{"version":2}"#, r#"{"version":1,"themes":{}}"#] {
            fs::write(&file, text).unwrap();
            let l = load(&file);
            assert!(l.warning.as_deref().unwrap().contains("invalid"), "{text}");
            assert!(l.persist);
            assert_eq!(
                fs::read_to_string(dir.path().join(format!("{FILE_NAME}.bad"))).unwrap(),
                text
            );
        }
    }

    #[test]
    fn read_errors_leave_the_file_alone() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::create_dir(&file).unwrap();
        let l = load(&file);
        assert!(!l.persist);
        assert!(l.warning.as_deref().unwrap().contains("could not be read"));
        assert!(file.is_dir());
    }

    #[test]
    fn values_are_checked() {
        for ok in [
            "#fff",
            "rgb(0 0 0 / 25%)",
            "var(--color-surface)",
            "0 4px 16px rgb(0 0 0 / 18%)",
            "system-ui, 'Segoe UI', sans-serif",
            "13px",
        ] {
            assert!(value_ok(ok), "{ok}");
        }
        for bad in [
            "",
            "  ",
            "red; background: blue",
            "url(https://example.com/x.png)",
            "URL(x)",
            "image-set(x)",
            "}body{color:red",
            "<script>",
            "\\66 ff",
            "@import x",
            "a\nb",
            &"x".repeat(MAX_VALUE_LEN + 1),
        ] {
            assert!(!value_ok(bad), "{bad}");
        }
        assert!(token_name_ok("--color-bg") && token_name_ok("--fnf-table-bg-color"));
        for bad in ["--", "color-bg", "--Color", "--a b", "--ä"] {
            assert!(!token_name_ok(bad), "{bad}");
        }
    }

    #[test]
    fn limits() {
        let mut themes: Vec<UserTheme> = (0..MAX_THEMES + 5)
            .map(|i| theme(&format!("t{i}"), &[]))
            .collect();
        themes.insert(0, theme("Bad Id", &[]));
        themes.insert(1, theme("t0", &[("--dupe", "#000")]));
        themes.insert(
            2,
            UserTheme {
                name: "  ".into(),
                ..theme("empty-name", &[])
            },
        );
        themes[1].tokens = [
            ("--ok".to_string(), " #fff ".to_string()),
            ("--evil".to_string(), "url(x)".to_string()),
            ("nope".to_string(), "#000".to_string()),
        ]
        .into_iter()
        .collect();
        let many: BTreeMap<String, String> = (0..MAX_TOKENS + 10)
            .map(|i| (format!("--t{i}"), "#000".to_string()))
            .collect();
        themes[4].tokens = many;
        let out = bound(ThemesFile {
            version: 9,
            selection: Selection {
                mode: "weird".into(),
                theme: "../x".into(),
                light: "light".into(),
                dark: "".into(),
            },
            themes,
        });
        assert_eq!(out.version, VERSION);
        assert_eq!(out.selection, Selection::default());
        assert_eq!(out.themes.len(), MAX_THEMES);
        assert_eq!(out.themes[0].id, "t0");
        assert_eq!(out.themes[0].tokens.len(), 1);
        assert_eq!(out.themes[0].tokens["--ok"], "#fff");
        assert_eq!(out.themes[1].tokens.len(), MAX_TOKENS);
        assert_eq!(out.themes.iter().filter(|t| t.id == "t0").count(), 1);
        assert!(!out.themes.iter().any(|t| t.id == "empty-name"));
    }

    #[test]
    fn import_reads_small_json_objects_only() {
        let dir = tempdir().unwrap();
        let good = dir.path().join("Mein Schema ☕.theme.json");
        fs::write(
            &good,
            r##"{"name":"x","colors":{"--fnf-table-bg-color":"#fff"}}"##,
        )
        .unwrap();
        assert_eq!(import(&good).unwrap()["name"], "x");

        let arr = dir.path().join("arr.json");
        fs::write(&arr, "[1]").unwrap();
        assert_eq!(import(&arr).unwrap_err().code, FsErrorCode::InvalidPath);
        let text = dir.path().join("t.json");
        fs::write(&text, "nope").unwrap();
        assert_eq!(import(&text).unwrap_err().code, FsErrorCode::InvalidPath);
        let big = dir.path().join("big.json");
        fs::write(&big, vec![b' '; MAX_IMPORT_BYTES as usize + 1]).unwrap();
        assert!(import(&big).unwrap_err().message.contains("too big"));
        assert_eq!(import(dir.path()).unwrap_err().code, FsErrorCode::NotAFile);
        assert_eq!(
            import(&dir.path().join("missing.json")).unwrap_err().code,
            FsErrorCode::NotFound
        );
    }

    #[test]
    fn export_never_overwrites() {
        let dir = tempdir().unwrap();
        let t = json!({"name": "Mein Schema", "dark": false, "tokens": {"--color-bg": "#fff"}});
        let a = export(dir.path(), "Mein Schema", &t).unwrap();
        assert_eq!(a.file_name().unwrap(), "Mein Schema.theme.json");
        let b = export(dir.path(), "Mein Schema", &t).unwrap();
        assert_eq!(b.file_name().unwrap(), "Mein Schema (2).theme.json");
        let back: Value = serde_json::from_slice(&fs::read(&a).unwrap()).unwrap();
        assert_eq!(back, t);

        assert_eq!(
            export(dir.path(), "a/b", &t).unwrap_err().code,
            FsErrorCode::InvalidName
        );
        assert_eq!(
            export(dir.path(), "  ", &t).unwrap_err().code,
            FsErrorCode::InvalidName
        );
        assert_eq!(
            export(&a, "x", &t).unwrap_err().code,
            FsErrorCode::NotADirectory
        );
        assert_eq!(
            export(&dir.path().join("missing"), "x", &t)
                .unwrap_err()
                .code,
            FsErrorCode::NotFound
        );
        assert_eq!(
            export(dir.path(), "x", &json!([1])).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
    }
}
