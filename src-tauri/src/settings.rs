//! User settings (`settings.json` in the app config directory, design 015 E1/E2):
//! scalar preferences and small remembered lists. The schema is shared with the
//! frontend (`src/app/core/settings/settings-schema.json`, included at compile
//! time). Rust is the boundary: known keys keep only valid values, unknown keys
//! (a newer version) are kept within limits, values equal to the default are
//! dropped. Problems are reported as codes – the frontend translates them.
//! Also the export/import of all settings files as one bundle (E4).
//! Keep in sync with `src/app/core/settings/settings.models.ts`.

use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::{keep_broken_file, write_atomic};
use crate::{buttons, filetypes, keymap, rename_presets, themes, tools};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub const FILE_NAME: &str = "settings.json";
pub const VERSION: u32 = 1;
/// Unknown keys kept from a newer version.
pub const MAX_UNKNOWN_KEYS: usize = 200;
pub const MAX_KEY_LEN: usize = 100;
/// Size limit of one unknown value (serialised).
pub const MAX_UNKNOWN_VALUE_BYTES: usize = 4096;
/// Size limit of `settings.json` when reading.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Size limit of a settings export when importing.
pub const MAX_BUNDLE_BYTES: u64 = 2 * 1024 * 1024;
pub const BUNDLE_FORMAT: &str = "files-and-folders-settings";
pub const BUNDLE_VERSION: u32 = 1;
pub const BUNDLE_FILE_STEM: &str = "files-and-folders-settings";
/// Parts of a bundle (`import_settings` takes a subset).
pub const PARTS: [&str; 7] = [
    "settings",
    "keymap",
    "themes",
    "renamePresets",
    "tools",
    "buttons",
    "fileTypes",
];

const SCHEMA_JSON: &str = include_str!("../../src/app/core/settings/settings-schema.json");

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Spec {
    Bool {
        default: bool,
    },
    Enum {
        values: Vec<String>,
        default: String,
    },
    Int {
        min: i64,
        max: i64,
        default: i64,
    },
    /// A remembered list (recent searches …): an array, bounded in items and bytes.
    Json {
        default: Value,
        #[serde(rename = "maxItems")]
        max_items: usize,
        #[serde(rename = "maxBytes")]
        max_bytes: usize,
    },
}

impl Spec {
    pub fn default_value(&self) -> Value {
        match self {
            Spec::Bool { default } => Value::Bool(*default),
            Spec::Enum { default, .. } => Value::String(default.clone()),
            Spec::Int { default, .. } => Value::from(*default),
            Spec::Json { default, .. } => default.clone(),
        }
    }

    pub fn accepts(&self, v: &Value) -> bool {
        match self {
            Spec::Bool { .. } => v.is_boolean(),
            Spec::Enum { values, .. } => v.as_str().is_some_and(|s| values.iter().any(|x| x == s)),
            Spec::Int { min, max, .. } => v.as_i64().is_some_and(|n| n >= *min && n <= *max),
            Spec::Json {
                max_items,
                max_bytes,
                ..
            } => {
                v.as_array().is_some_and(|a| a.len() <= *max_items)
                    && serde_json::to_vec(v).is_ok_and(|b| b.len() <= *max_bytes)
            }
        }
    }
}

/// The settings schema (key → spec), parsed once.
pub static SCHEMA: LazyLock<BTreeMap<String, Spec>> = LazyLock::new(|| {
    serde_json::from_str(SCHEMA_JSON).expect("settings-schema.json is valid (tested)")
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsWarning {
    /// `broken` | `unreadable` | `newer_version` | `invalid_value` | `unknown_dropped` | `not_saved`;
    /// import: `part_skipped` | `part_failed` (key = part, path = its file)
    pub code: String,
    pub key: Option<String>,
    pub path: Option<String>,
}

impl SettingsWarning {
    pub(crate) fn new(code: &str, key: Option<&str>, path: Option<&Path>) -> Self {
        Self {
            code: code.into(),
            key: key.map(Into::into),
            path: path.map(|p| p.to_string_lossy().into_owned()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSettings {
    /// Only the values that differ from the defaults (plus unknown keys).
    pub settings: Map<String, Value>,
    pub warnings: Vec<SettingsWarning>,
    /// `false` = do not write the file (newer version, or a broken file stayed in place).
    pub persist: bool,
}

/// Keeps valid known values that differ from the default and bounded unknown keys.
pub fn sanitize(input: Map<String, Value>) -> (Map<String, Value>, Vec<SettingsWarning>) {
    let mut out = Map::new();
    let mut warnings = Vec::new();
    let mut unknown = 0usize;
    for (key, value) in input {
        match SCHEMA.get(&key) {
            Some(spec) if spec.accepts(&value) => {
                if value != spec.default_value() {
                    out.insert(key, value);
                }
            }
            Some(_) => warnings.push(SettingsWarning::new("invalid_value", Some(&key), None)),
            None => {
                let small = key.len() <= MAX_KEY_LEN
                    && !key.is_empty()
                    && serde_json::to_vec(&value).is_ok_and(|b| b.len() <= MAX_UNKNOWN_VALUE_BYTES);
                if small && unknown < MAX_UNKNOWN_KEYS {
                    unknown += 1;
                    out.insert(key, value);
                } else {
                    warnings.push(SettingsWarning::new("unknown_dropped", Some(&key), None));
                }
            }
        }
    }
    (out, warnings)
}

#[derive(Debug, Serialize, Deserialize)]
struct SettingsFile {
    version: u32,
    #[serde(default)]
    settings: Map<String, Value>,
}

/// Brings an older file to the current version (v1 is the first one – nothing to do yet).
fn migrate(version: u32, settings: Map<String, Value>) -> Map<String, Value> {
    debug_assert!(version <= VERSION);
    settings
}

enum Parsed {
    Ok(u32, Map<String, Value>),
    Broken,
}

fn parse(text: &str) -> Parsed {
    match serde_json::from_str::<SettingsFile>(text) {
        Ok(f) if f.version >= 1 => Parsed::Ok(f.version, f.settings),
        _ => Parsed::Broken,
    }
}

/// Loads `settings.json`. Missing → defaults; broken → defaults + warning, the file
/// is kept as `settings.json.bad`; newer version → its known values, not written.
pub fn load(file: &Path) -> LoadedSettings {
    let read = fs::File::open(file).and_then(|f| {
        let mut text = String::new();
        f.take(MAX_FILE_BYTES + 1).read_to_string(&mut text)?;
        Ok(text)
    });
    let text = match read {
        Ok(t) => t,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return LoadedSettings {
                settings: Map::new(),
                warnings: Vec::new(),
                persist: true,
            };
        }
        // unreadable (rights, not UTF-8): leave it alone, do not overwrite it
        Err(e) if e.kind() != io::ErrorKind::InvalidData => {
            return LoadedSettings {
                settings: Map::new(),
                warnings: vec![SettingsWarning::new("unreadable", None, Some(file))],
                persist: false,
            };
        }
        Err(_) => String::new(),
    };
    let parsed = if text.len() as u64 > MAX_FILE_BYTES {
        Parsed::Broken
    } else {
        parse(&text)
    };
    match parsed {
        Parsed::Ok(version, raw) => {
            let newer = version > VERSION;
            let raw = if newer { raw } else { migrate(version, raw) };
            let (settings, mut warnings) = sanitize(raw);
            if newer {
                warnings.insert(0, SettingsWarning::new("newer_version", None, Some(file)));
            }
            LoadedSettings {
                settings,
                warnings,
                persist: !newer,
            }
        }
        Parsed::Broken => match keep_broken_file(file) {
            Some(bad) => LoadedSettings {
                settings: Map::new(),
                warnings: vec![SettingsWarning::new("broken", None, Some(&bad))],
                persist: true,
            },
            None => LoadedSettings {
                settings: Map::new(),
                warnings: vec![SettingsWarning::new("broken", None, None)],
                persist: false,
            },
        },
    }
}

/// Sanitises and writes atomically; returns the warnings of the sanitising.
pub fn save(file: &Path, settings: Map<String, Value>) -> io::Result<Vec<SettingsWarning>> {
    let (settings, warnings) = sanitize(settings);
    let data = SettingsFile {
        version: VERSION,
        settings,
    };
    let json = serde_json::to_vec_pretty(&data).map_err(io::Error::other)?;
    write_atomic(file, &json)?;
    Ok(warnings)
}

// ---- export / import of all settings (E4) ----

/// The files of the app config directory that belong to the settings.
pub struct ConfigFiles {
    pub settings: PathBuf,
    pub keymap: PathBuf,
    pub themes: PathBuf,
    pub rename_presets: PathBuf,
    pub tools: PathBuf,
    pub buttons: PathBuf,
    pub file_types: PathBuf,
}

impl ConfigFiles {
    /// The file of a bundle part (see [`PARTS`]).
    pub fn path_of(&self, part: &str) -> &Path {
        match part {
            "keymap" => &self.keymap,
            "themes" => &self.themes,
            "renamePresets" => &self.rename_presets,
            "tools" => &self.tools,
            "buttons" => &self.buttons,
            "fileTypes" => &self.file_types,
            _ => &self.settings,
        }
    }

    pub fn in_dir(dir: &Path) -> Self {
        Self {
            settings: dir.join(FILE_NAME),
            keymap: dir.join(keymap::FILE_NAME),
            themes: dir.join(themes::FILE_NAME),
            rename_presets: dir.join(rename_presets::FILE_NAME),
            tools: dir.join(tools::FILE_NAME),
            buttons: dir.join(buttons::FILE_NAME),
            file_types: dir.join(filetypes::FILE_NAME),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: Vec<String>,
    pub warnings: Vec<SettingsWarning>,
}

fn invalid(message: impl Into<String>, path: Option<&Path>) -> FsError {
    FsError::new(FsErrorCode::InvalidSettings, message, path)
}

/// The bundle as a JSON value: every part as Rust loads it (checked).
pub fn bundle(files: &ConfigFiles) -> Value {
    let mut out = Map::new();
    out.insert("format".into(), BUNDLE_FORMAT.into());
    out.insert("version".into(), BUNDLE_VERSION.into());
    out.insert(
        "settings".into(),
        Value::Object(load(&files.settings).settings),
    );
    out.insert(
        "keymap".into(),
        serde_json::to_value(keymap::load(&files.keymap).bindings).unwrap_or(Value::Null),
    );
    out.insert(
        "themes".into(),
        serde_json::to_value(themes::load(&files.themes).file).unwrap_or(Value::Null),
    );
    out.insert(
        "renamePresets".into(),
        serde_json::to_value(rename_presets::load(&files.rename_presets).presets)
            .unwrap_or(Value::Null),
    );
    // the user's own tools file as it is (if it is a valid one) – not the merged defaults
    let tools = fs::read_to_string(&files.tools)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(|v| tools::check_file(v).is_ok())
        .unwrap_or(Value::Null);
    out.insert("tools".into(), tools);
    // design 022 E10: the button sets of the user file; the categories or null without a user file
    out.insert(
        "buttons".into(),
        // no user file = null (skipped on import, like fileTypes – external review 022/026 #11)
        if files.buttons.exists() {
            serde_json::to_value(buttons::load(&files.buttons).value.sets).unwrap_or(Value::Null)
        } else {
            Value::Null
        },
    );
    out.insert(
        "fileTypes".into(),
        serde_json::to_value(filetypes::load(&files.file_types).value).unwrap_or(Value::Null),
    );
    Value::Object(out)
}

/// Writes the bundle into `dir` as `files-and-folders-settings.json` (never overwrites:
/// ` (2)` … ` (999)`); returns the path.
pub fn export(files: &ConfigFiles, dir: &Path) -> Result<PathBuf, FsError> {
    let meta = fs::metadata(dir).map_err(|e| FsError::from_io(&e, dir))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "The target is not a folder",
            Some(dir),
        ));
    }
    let bytes = serde_json::to_vec_pretty(&bundle(files))
        .map_err(|e| FsError::new(FsErrorCode::Io, format!("Serialising failed: {e}"), None))?;
    for n in 1..=999 {
        let name = if n == 1 {
            format!("{BUNDLE_FILE_STEM}.json")
        } else {
            format!("{BUNDLE_FILE_STEM} ({n}).json")
        };
        let target = dir.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut f) => {
                if let Err(e) = f.write_all(&bytes).and_then(|_| f.sync_all()) {
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
        "Too many exported settings files in this folder",
        Some(dir),
    ))
}

/// Reads a bundle (≤ 2 MiB JSON object with the right `format`/`version`).
pub fn read_bundle(path: &Path) -> Result<Map<String, Value>, FsError> {
    let meta = fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    if !meta.is_file() {
        return Err(FsError::new(
            FsErrorCode::NotAFile,
            "Only a file can be imported",
            Some(path),
        ));
    }
    if meta.len() > MAX_BUNDLE_BYTES {
        return Err(invalid(
            "The file is too big for a settings export",
            Some(path),
        ));
    }
    let mut text = String::new();
    fs::File::open(path)
        .and_then(|f| f.take(MAX_BUNDLE_BYTES + 1).read_to_string(&mut text))
        .map_err(|e| FsError::from_io(&e, path))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| invalid(format!("No JSON: {e}"), Some(path)))?;
    let Value::Object(map) = value else {
        return Err(invalid("No JSON object", Some(path)));
    };
    if map.get("format").and_then(Value::as_str) != Some(BUNDLE_FORMAT) {
        return Err(invalid("Not a settings export", Some(path)));
    }
    match map.get("version").and_then(Value::as_u64) {
        Some(v) if v == u64::from(BUNDLE_VERSION) => Ok(map),
        _ => Err(invalid("Unsupported settings export version", Some(path))),
    }
}

/// Imports the chosen `parts` of a bundle: every part is checked by its module and
/// written atomically. A part that is missing (`null`) or invalid is skipped with a
/// warning `part_skipped` (key = part); the others are imported.
pub fn import(
    files: &ConfigFiles,
    bundle: &Map<String, Value>,
    parts: &[String],
) -> Result<ImportReport, FsError> {
    let mut report = ImportReport {
        imported: Vec::new(),
        warnings: Vec::new(),
    };
    for part in PARTS {
        if !parts.iter().any(|p| p == part) {
            continue;
        }
        let value = bundle.get(part).cloned().unwrap_or(Value::Null);
        let written: Result<bool, io::Error> = match part {
            "settings" => match value {
                Value::Object(m) => save(&files.settings, m).map(|w| {
                    report.warnings.extend(w);
                    true
                }),
                _ => Ok(false),
            },
            "keymap" => match serde_json::from_value::<keymap::Bindings>(value) {
                Ok(b) => keymap::save(&files.keymap, b).map(|_| true),
                Err(_) => Ok(false),
            },
            "themes" => match serde_json::from_value::<themes::ThemesFile>(value) {
                Ok(t) if t.version == themes::VERSION => {
                    themes::save(&files.themes, t).map(|_| true)
                }
                _ => Ok(false),
            },
            "renamePresets" => {
                match serde_json::from_value::<rename_presets::RenamePresets>(value) {
                    Ok(p) if p.version == rename_presets::VERSION => {
                        rename_presets::save(&files.rename_presets, p).map(|_| true)
                    }
                    _ => Ok(false),
                }
            }
            "tools" => {
                if tools::check_file(&value).is_ok() {
                    serde_json::to_vec_pretty(&value)
                        .map_err(io::Error::other)
                        .and_then(|b| write_atomic(&files.tools, &b))
                        .map(|_| true)
                } else {
                    Ok(false)
                }
            }
            "buttons" => match serde_json::from_value::<buttons::Sets>(value) {
                Ok(sets) => buttons::save(&files.buttons, sets).map(|_| true),
                Err(_) => Ok(false),
            },
            "fileTypes" => match serde_json::from_value::<Vec<filetypes::FileType>>(value) {
                Ok(c) => filetypes::save(&files.file_types, Some(c)).map(|_| true),
                Err(_) => Ok(false),
            },
            _ => Ok(false),
        };
        match written {
            Ok(true) => report.imported.push(part.into()),
            Ok(false) => {
                report
                    .warnings
                    .push(SettingsWarning::new("part_skipped", Some(part), None))
            }
            // a write error must not hide what was already imported (review 015 #4):
            // the part is reported with its file, the others go on
            Err(_) => report.warnings.push(SettingsWarning::new(
                "part_failed",
                Some(part),
                Some(files.path_of(part)),
            )),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn map(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn schema_parses_and_defaults_are_valid() {
        assert!(SCHEMA.len() >= 10);
        for (key, spec) in SCHEMA.iter() {
            assert!(spec.accepts(&spec.default_value()), "{key}");
            assert!(key.contains('.') && key.len() <= MAX_KEY_LEN, "{key}");
        }
        assert!(SCHEMA.contains_key("general.language"));
    }

    #[test]
    fn round_trip_keeps_only_changes() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("cfg ä 😀/settings.json");
        let w = save(
            &file,
            map(json!({
                "general.language": "de",
                "view.sizeFormat": "binary",
                "view.folderBrackets": true,
                "search.recent": [{"name": "*.mp3"}]
            })),
        )
        .unwrap();
        assert!(w.is_empty());
        let loaded = load(&file);
        assert!(loaded.warnings.is_empty() && loaded.persist);
        assert_eq!(
            Value::Object(loaded.settings),
            json!({"general.language": "de", "view.folderBrackets": true, "search.recent": [{"name": "*.mp3"}]})
        );
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.contains("\"version\": 1") && !text.contains("sizeFormat"));
    }

    #[test]
    fn invalid_values_fall_back_with_a_warning_per_key() {
        let (out, w) = sanitize(map(json!({
            "general.language": "fr",
            "view.menuBar": "yes",
            "view.density": 3,
            "search.recent": "x",
            "behavior.confirmTrash": false
        })));
        assert_eq!(Value::Object(out), json!({"behavior.confirmTrash": false}));
        let mut keys: Vec<_> = w.iter().map(|w| w.key.clone().unwrap()).collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "general.language",
                "search.recent",
                "view.density",
                "view.menuBar"
            ]
        );
        assert!(w.iter().all(|w| w.code == "invalid_value"));
    }

    #[test]
    fn json_lists_are_bounded() {
        let many: Vec<Value> = (0..11).map(|i| json!({ "n": i })).collect();
        let big = vec![json!("x".repeat(70_000))];
        for v in [Value::Array(many), Value::Array(big)] {
            let (out, w) = sanitize(map(json!({ "search.recent": v })));
            assert!(out.is_empty());
            assert_eq!(w[0].code, "invalid_value");
        }
    }

    #[test]
    fn unknown_keys_are_kept_within_limits() {
        let mut input = map(json!({
            "future.option": {"a": 1},
            "": 1,
            "huge.value": "x".repeat(MAX_UNKNOWN_VALUE_BYTES + 1)
        }));
        for i in 0..MAX_UNKNOWN_KEYS + 5 {
            input.insert(format!("more.k{i:03}"), json!(i));
        }
        let (out, w) = sanitize(input);
        assert_eq!(out.len(), MAX_UNKNOWN_KEYS);
        assert!(out.contains_key("future.option"));
        assert!(!out.contains_key("") && !out.contains_key("huge.value"));
        assert!(w.iter().all(|w| w.code == "unknown_dropped"));
        assert_eq!(w.len(), 2 + 6);
    }

    #[test]
    fn missing_file_gives_defaults_without_warning() {
        let dir = tempdir().unwrap();
        let loaded = load(&dir.path().join("settings.json"));
        assert!(loaded.settings.is_empty() && loaded.warnings.is_empty() && loaded.persist);
    }

    #[test]
    fn broken_file_gives_defaults_a_warning_and_is_kept_as_bad() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("settings.json");
        for text in [
            "{",
            "[]",
            r#"{"settings":{}}"#,
            r#"{"version":0,"settings":{}}"#,
            r#"{"version":1,"settings":[]}"#,
            "\u{feff}nope",
        ] {
            fs::write(&file, text).unwrap();
            let loaded = load(&file);
            assert!(loaded.settings.is_empty() && loaded.persist, "{text}");
            assert_eq!(loaded.warnings.len(), 1, "{text}");
            assert_eq!(loaded.warnings[0].code, "broken");
            let bad = dir.path().join("settings.json.bad");
            assert_eq!(loaded.warnings[0].path.as_deref(), bad.to_str());
            assert_eq!(fs::read_to_string(&bad).unwrap(), text);
            assert!(!file.exists());
        }
    }

    #[test]
    fn non_utf8_and_oversized_files_count_as_broken() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("settings.json");
        fs::write(&file, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(load(&file).warnings[0].code, "broken");
        let mut big = br#"{"version":1,"settings":{"x.y":""#.to_vec();
        big.extend(std::iter::repeat_n(b'a', MAX_FILE_BYTES as usize));
        big.extend(br#""}}"#);
        fs::write(&file, big).unwrap();
        assert_eq!(load(&file).warnings[0].code, "broken");
    }

    #[test]
    fn newer_version_is_read_but_not_written() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("settings.json");
        fs::write(
            &file,
            r#"{"version":7,"settings":{"general.language":"de","view.density":"huge","new.thing":1}}"#,
        )
        .unwrap();
        let loaded = load(&file);
        assert!(!loaded.persist);
        assert_eq!(loaded.warnings[0].code, "newer_version");
        assert_eq!(loaded.settings["general.language"], "de");
        assert_eq!(loaded.settings["new.thing"], 1);
        assert!(!loaded.settings.contains_key("view.density"));
        assert!(file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_file_is_left_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let file = dir.path().join("settings.json");
        fs::write(&file, r#"{"version":1,"settings":{}}"#).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::read(&file).is_ok() {
            return; // root ignores the rights
        }
        let loaded = load(&file);
        assert_eq!(loaded.warnings[0].code, "unreadable");
        assert!(!loaded.persist && file.exists());
    }

    fn config(dir: &Path) -> ConfigFiles {
        ConfigFiles::in_dir(dir)
    }

    #[test]
    fn export_writes_all_parts_and_never_overwrites() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("cfg");
        let files = config(&cfg);
        save(&files.settings, map(json!({"general.language": "de"}))).unwrap();
        let mut b = keymap::Bindings::new();
        b.insert("OPEN_COPY_DLG".into(), vec!["F9".into()]);
        keymap::save(&files.keymap, b).unwrap();
        fs::write(&files.tools, r#"{"version":1,"tools":[]}"#).unwrap();
        let out = dir.path().join("out ü");
        fs::create_dir(&out).unwrap();
        let first = export(&files, &out).unwrap();
        let second = export(&files, &out).unwrap();
        assert!(first.ends_with("files-and-folders-settings.json"));
        assert!(second.ends_with("files-and-folders-settings (2).json"));
        let v: Value = serde_json::from_str(&fs::read_to_string(&first).unwrap()).unwrap();
        assert_eq!(v["format"], BUNDLE_FORMAT);
        assert_eq!(v["settings"]["general.language"], "de");
        assert_eq!(v["keymap"]["OPEN_COPY_DLG"][0], "F9");
        assert_eq!(v["themes"]["version"], 1);
        assert_eq!(v["renamePresets"]["version"], 1);
        assert_eq!(v["tools"]["version"], 1);
        assert!(export(&files, &first).is_err());
    }

    #[test]
    fn import_writes_the_chosen_parts_only() {
        let dir = tempdir().unwrap();
        let src = config(&dir.path().join("a"));
        save(&src.settings, map(json!({"view.density": "spacious"}))).unwrap();
        fs::write(&src.tools, r#"{"version":1,"tools":[]}"#).unwrap();
        let out = export(&src, dir.path()).unwrap();
        let dst = config(&dir.path().join("b"));
        let bundle = read_bundle(&out).unwrap();
        let report = import(
            &dst,
            &bundle,
            &["settings".into(), "keymap".into(), "themes".into()],
        )
        .unwrap();
        assert_eq!(report.imported, ["settings", "keymap", "themes"]);
        assert_eq!(load(&dst.settings).settings["view.density"], "spacious");
        assert!(dst.keymap.exists() && dst.themes.exists());
        assert!(!dst.tools.exists() && !dst.rename_presets.exists());
        // tools only when chosen
        let report = import(&dst, &bundle, &["tools".into()]).unwrap();
        assert_eq!(report.imported, ["tools"]);
        assert!(dst.tools.exists());
    }

    #[test]
    fn a_part_that_cannot_be_written_is_reported_and_the_rest_imported() {
        let dir = tempdir().unwrap();
        let src = config(&dir.path().join("a"));
        save(&src.settings, map(json!({"view.density": "spacious"}))).unwrap();
        let out = export(&src, dir.path()).unwrap();
        let dst = config(&dir.path().join("b"));
        // the keymap file cannot be written: a folder is in its place
        fs::create_dir_all(&dst.keymap).unwrap();
        let bundle = read_bundle(&out).unwrap();
        let report = import(
            &dst,
            &bundle,
            &["settings".into(), "keymap".into(), "themes".into()],
        )
        .unwrap();
        assert_eq!(report.imported, ["settings", "themes"]);
        let w = &report.warnings[0];
        assert_eq!(
            (w.code.as_str(), w.key.as_deref()),
            ("part_failed", Some("keymap"))
        );
        assert!(w.path.as_deref().unwrap().ends_with(keymap::FILE_NAME));
        assert_eq!(load(&dst.settings).settings["view.density"], "spacious");
    }

    #[test]
    fn read_bundle_rejects_a_version_that_only_matches_when_truncated() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("x.json");
        fs::write(
            &f,
            format!(r#"{{"format":"{BUNDLE_FORMAT}","version":4294967297}}"#),
        )
        .unwrap();
        assert!(read_bundle(&f).is_err());
    }

    #[test]
    fn a_bundle_without_own_buttons_does_not_reset_them() {
        // external review 022/026 #11: no user file = null (skipped on import), like fileTypes
        let dir = tempdir().unwrap();
        let files = config(&dir.path().join("cfg"));
        let b = bundle(&files);
        assert_eq!(b["buttons"], Value::Null);
        assert_eq!(b["fileTypes"], Value::Null);
        let mut sets = buttons::Sets::new();
        sets.insert("shift".into(), vec!["OPEN_COPY_DLG".into()]);
        buttons::save(&files.buttons, sets).unwrap();
        assert_eq!(bundle(&files)["buttons"]["shift"][0], "OPEN_COPY_DLG");
    }

    #[test]
    fn import_skips_invalid_parts_and_sanitises_settings() {
        let dir = tempdir().unwrap();
        let dst = config(dir.path());
        let bundle = map(json!({
            "format": BUNDLE_FORMAT, "version": 1,
            "settings": {"general.language": "xx", "view.menuBar": false},
            "keymap": "nope",
            "themes": {"version": 9},
            "tools": {"version": 5, "tools": []}
        }));
        let all: Vec<String> = PARTS.iter().map(|s| s.to_string()).collect();
        let report = import(&dst, &bundle, &all).unwrap();
        assert_eq!(report.imported, ["settings"]);
        let skipped: Vec<_> = report
            .warnings
            .iter()
            .filter(|w| w.code == "part_skipped")
            .map(|w| w.key.clone().unwrap())
            .collect();
        assert_eq!(
            skipped,
            [
                "keymap",
                "themes",
                "renamePresets",
                "tools",
                "buttons",
                "fileTypes"
            ]
        );
        assert!(report.warnings.iter().any(|w| w.code == "invalid_value"));
        assert_eq!(
            Value::Object(load(&dst.settings).settings),
            json!({"view.menuBar": false})
        );
    }

    /// Design 022 E10: buttons and file types travel with the bundle.
    #[test]
    fn buttons_and_file_types_are_exported_and_imported() {
        let dir = tempdir().unwrap();
        let src = config(&dir.path().join("a"));
        let mut sets = buttons::Sets::new();
        sets.insert("shift".into(), vec!["OPEN_VIEW_DLG".into()]);
        buttons::save(&src.buttons, sets.clone()).unwrap();
        let comics = filetypes::FileType {
            label: "Comics".into(),
            extensions: vec![".cbz".into()],
            icon: Some("fa-book".into()),
            color: None,
        };
        filetypes::save(&src.file_types, Some(vec![comics.clone()])).unwrap();
        let out = export(&src, dir.path()).unwrap();
        let bundle = read_bundle(&out).unwrap();
        assert_eq!(bundle["buttons"]["shift"][0], "OPEN_VIEW_DLG");
        assert_eq!(bundle["fileTypes"][0]["label"], "Comics");
        let dst = config(&dir.path().join("b ü"));
        let report = import(&dst, &bundle, &["buttons".into(), "fileTypes".into()]).unwrap();
        assert_eq!(report.imported, ["buttons", "fileTypes"]);
        assert_eq!(buttons::load(&dst.buttons).value.sets, sets);
        assert_eq!(filetypes::load(&dst.file_types).value, Some(vec![comics]));
        // without a user file the part is null and skipped on import
        let empty = config(&dir.path().join("c"));
        let out = export(&empty, &dir.path().join("b ü")).unwrap();
        let bundle = read_bundle(&out).unwrap();
        assert_eq!(bundle["fileTypes"], Value::Null);
        assert_eq!(bundle["buttons"], Value::Null);
        let report = import(&empty, &bundle, &["fileTypes".into()]).unwrap();
        assert!(report.imported.is_empty());
        assert_eq!(report.warnings[0].code, "part_skipped");
    }

    #[test]
    fn read_bundle_rejects_other_files() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("x.json");
        for (text, code) in [
            ("{", FsErrorCode::InvalidSettings),
            ("[1]", FsErrorCode::InvalidSettings),
            (
                r#"{"format":"other","version":1}"#,
                FsErrorCode::InvalidSettings,
            ),
            (
                r#"{"format":"files-and-folders-settings","version":2}"#,
                FsErrorCode::InvalidSettings,
            ),
        ] {
            fs::write(&f, text).unwrap();
            assert_eq!(read_bundle(&f).unwrap_err().code, code, "{text}");
        }
        assert_eq!(
            read_bundle(dir.path()).unwrap_err().code,
            FsErrorCode::NotAFile
        );
        assert_eq!(
            read_bundle(&dir.path().join("missing")).unwrap_err().code,
            FsErrorCode::NotFound
        );
        let big = dir.path().join("big.json");
        fs::write(&big, vec![b' '; MAX_BUNDLE_BYTES as usize + 1]).unwrap();
        assert_eq!(
            read_bundle(&big).unwrap_err().code,
            FsErrorCode::InvalidSettings
        );
    }
}
