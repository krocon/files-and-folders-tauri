//! Import of the configuration of files-and-folders-mr (design 026): find its `assets`
//! folder, read the user files (`<area>/custom/…`), translate them into our formats and
//! report what cannot be transferred (reason codes – the frontend translates). Planning
//! against the current state is the frontend's (it knows the catalog and the defaults);
//! [`apply`] writes the planned parts with a backup of every replaced file.
//! Keep in sync with `src/app/core/mrimport/mr-import.models.ts`.

pub mod keys;
#[cfg(test)]
mod tests;

use crate::buttons::{self, Sets};
use crate::error::{FsError, FsErrorCode};
use crate::filetypes::{self, FileType};
use crate::fs_atomic::backup_copy;
use crate::keymap::{self, Bindings};
use crate::settings::{self, ConfigFiles, SettingsWarning};
use crate::tools::{self, Tool};
use keys::{MrOs, map_action, never_fired, translate_shortcut};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// Folders of the areas inside mr's `assets`.
pub const AREAS: [&str; 7] = [
    "shortcut", "button", "filetype", "search", "tool", "color", "setup",
];
/// Size limit of one JSON file of mr.
pub const MAX_JSON_BYTES: u64 = 1024 * 1024;
/// Same as a theme import (`themes.rs`).
pub const MAX_COLOR_BYTES: u64 = 256 * 1024;
pub const MAX_COLOR_FILES: usize = 50;
/// Search for a packed `assets` folder: depth and folders looked at.
const MAX_SEARCH_DEPTH: usize = 4;
const MAX_SEARCH_DIRS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrSkipped {
    /// What it was in mr, e.g. `cmd+alt+up → NAVIGATE_BACK`.
    pub item: String,
    pub reason: String,
}

/// One area: the file read, a read problem (`broken`, `too_big`), what was translated,
/// how many entries equal mr's defaults, and what cannot be transferred.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrArea<T> {
    pub file: String,
    pub error: Option<String>,
    pub items: T,
    pub unchanged: u32,
    pub skipped: Vec<MrSkipped>,
}

impl<T: Default> MrArea<T> {
    fn new(file: &Path) -> Self {
        Self {
            file: file.to_string_lossy().into_owned(),
            error: None,
            items: T::default(),
            unchanged: 0,
            skipped: Vec::new(),
        }
    }

    fn failed(file: &Path, error: &str) -> Self {
        Self {
            error: Some(error.into()),
            ..Self::new(file)
        }
    }

    fn skip(&mut self, item: impl Into<String>, reason: &str) {
        self.skipped.push(MrSkipped {
            item: item.into(),
            reason: reason.into(),
        });
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrShortcut {
    /// Our action id.
    pub id: String,
    /// Our notation (`Mod+Shift+F5`), checked by the frontend.
    pub shortcut: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MrPattern {
    pub label: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MrColorFile {
    pub name: String,
    pub path: String,
}

/// What was found; `None` = the area's file does not exist.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrScan {
    pub root: String,
    /// `osx` | `windows` | `linux`: the files read for shortcuts and tools.
    pub os: String,
    pub shortcuts: Option<MrArea<Vec<MrShortcut>>>,
    pub buttons: Option<MrArea<Sets>>,
    pub file_types: Option<MrArea<Vec<FileType>>>,
    pub search: Option<MrArea<Vec<MrPattern>>>,
    pub tools: Option<MrArea<Vec<Tool>>>,
    pub colors: Option<MrArea<Vec<MrColorFile>>>,
    pub setup: Option<MrArea<Map<String, Value>>>,
}

// ---- finding mr's assets folder (E2) ----

fn is_assets(dir: &Path) -> bool {
    AREAS.iter().any(|a| dir.join(a).is_dir())
}

/// The `assets` folder for what the user typed: the folder itself, a known place below
/// it, the parent of an area folder, or a bounded search (packed app).
pub fn locate(path: &Path) -> Option<PathBuf> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name == "custom" || name == "defaults" {
        let parent = path.parent()?;
        if AREAS.iter().any(|a| parent.ends_with(a)) {
            return parent
                .parent()
                .filter(|p| is_assets(p))
                .map(Path::to_path_buf);
        }
    }
    if AREAS.contains(&name)
        && let Some(parent) = path.parent().filter(|p| is_assets(p))
    {
        return Some(parent.to_path_buf());
    }
    let candidates = [
        "",
        "assets",
        "src/assets",
        "apps/fnf-api/src/assets",
        "apps/fnf-api/assets",
        "fnf-api/src/assets",
    ];
    for c in candidates {
        let dir = if c.is_empty() {
            path.to_path_buf()
        } else {
            path.join(c)
        };
        if is_assets(&dir) {
            return Some(dir);
        }
    }
    search_assets(path)
}

/// Breadth-first, no symlinks, without `node_modules`/`.git`, bounded.
fn search_assets(root: &Path) -> Option<PathBuf> {
    let mut level = vec![root.to_path_buf()];
    let mut seen = 0usize;
    for _ in 0..MAX_SEARCH_DEPTH {
        let mut next = Vec::new();
        for dir in level {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            let mut subdirs: Vec<PathBuf> = entries
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                .map(|e| e.path())
                .filter(|p| {
                    let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    n != "node_modules" && n != ".git"
                })
                .collect();
            subdirs.sort();
            for sub in subdirs {
                seen += 1;
                if seen > MAX_SEARCH_DIRS {
                    return None;
                }
                if sub.file_name().is_some_and(|n| n == "assets") && is_assets(&sub) {
                    return Some(sub);
                }
                next.push(sub);
            }
        }
        level = next;
    }
    None
}

// ---- reading ----

/// `Ok(None)` = no file; errors are reason codes (`too_big`, `broken`, `unreadable`).
fn read_json(file: &Path, max: u64) -> Result<Option<Value>, &'static str> {
    let f = match fs::File::open(file) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("unreadable"),
    };
    let mut bytes = Vec::new();
    f.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "unreadable")?;
    if bytes.len() as u64 > max {
        return Err("too_big");
    }
    let text = String::from_utf8(bytes).map_err(|_| "broken")?;
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map(Some)
        .map_err(|_| "broken")
}

/// The custom file of an area; `None` = missing, `Err` = an area with the read problem.
fn custom_file<T: Default>(file: &Path) -> Option<Result<Value, MrArea<T>>> {
    match read_json(file, MAX_JSON_BYTES) {
        Ok(None) => None,
        Ok(Some(v)) => Some(Ok(v)),
        Err(e) => Some(Err(MrArea::failed(file, e))),
    }
}

/// mr's defaults beside it – a broken or missing one counts as none.
fn defaults_file(file: &Path) -> Option<Value> {
    read_json(file, MAX_JSON_BYTES).ok().flatten()
}

/// Reads everything mr kept in `assets` (`os` = the files of shortcuts and tools).
pub fn scan(assets: &Path, os: MrOs) -> MrScan {
    MrScan {
        root: assets.to_string_lossy().into_owned(),
        os: os.name().into(),
        shortcuts: scan_shortcuts(assets, os),
        buttons: scan_buttons(assets, os),
        file_types: scan_file_types(assets),
        search: scan_search(assets),
        tools: scan_tools(assets, os),
        colors: scan_colors(assets),
        setup: scan_setup(assets),
    }
}

/// [`locate`] + [`scan`] for a path typed by the user.
pub fn scan_path(path: &Path, os: MrOs) -> Result<MrScan, FsError> {
    let meta = fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "Not a folder",
            Some(path),
        ));
    }
    let assets = locate(path).ok_or_else(|| {
        FsError::new(
            FsErrorCode::NotFound,
            "No configuration of Files and Folders (mr) found in this folder",
            Some(path),
        )
    })?;
    Ok(scan(&assets, os))
}

fn object(v: Value) -> Option<Map<String, Value>> {
    match v {
        Value::Object(m) => Some(m),
        _ => None,
    }
}

/// E4: only entries that differ from mr's defaults; ids and notation translated.
fn scan_shortcuts(assets: &Path, os: MrOs) -> Option<MrArea<Vec<MrShortcut>>> {
    let file = assets
        .join("shortcut/custom")
        .join(format!("{}.json", os.name()));
    let custom = match custom_file(&file)? {
        Ok(v) => v,
        Err(area) => return Some(area),
    };
    let Some(custom) = object(custom) else {
        return Some(MrArea::failed(&file, "broken"));
    };
    let defaults = defaults_file(
        &assets
            .join("shortcut/defaults")
            .join(format!("{}.json", os.name())),
    )
    .and_then(object)
    .unwrap_or_default();
    let mut area: MrArea<Vec<MrShortcut>> = MrArea::new(&file);
    let custom: BTreeMap<String, Value> = custom.into_iter().collect();
    for (key, id) in &custom {
        let Some(id) = id.as_str() else {
            area.skip(key.clone(), "invalid");
            continue;
        };
        if defaults.get(key).and_then(Value::as_str) == Some(id) {
            area.unchanged += 1;
            continue;
        }
        let item = format!("{key} → {id}");
        let new_id = match map_action(id) {
            Ok(n) => n,
            Err(reason) => {
                area.skip(item, reason);
                continue;
            }
        };
        if never_fired(key) {
            area.skip(item, "never_fired");
            continue;
        }
        match translate_shortcut(key, os) {
            Ok(shortcut) => area.items.push(MrShortcut {
                id: new_id,
                shortcut,
                source: item,
            }),
            Err(reason) => area.skip(item, reason),
        }
    }
    let defaults: BTreeMap<String, Value> = defaults.into_iter().collect();
    for (key, id) in defaults {
        // only what still exists is worth a word (a removed SAVE_CONFIG is no news)
        let id = id.as_str().unwrap_or("");
        if !custom.contains_key(&key) && map_action(id).is_ok() {
            area.skip(format!("{key} → {id}"), "removed");
        }
    }
    Some(area)
}

/// E5: sets that differ from mr's defaults; `cmd` is the main modifier's set.
fn scan_buttons(assets: &Path, os: MrOs) -> Option<MrArea<Sets>> {
    let file = assets.join("button/custom/data.json");
    let custom = match custom_file(&file)? {
        Ok(v) => v,
        Err(area) => return Some(area),
    };
    let Some(custom) = object(custom) else {
        return Some(MrArea::failed(&file, "broken"));
    };
    let defaults = defaults_file(&assets.join("button/defaults/data.json"))
        .and_then(object)
        .unwrap_or_default();
    let mut area: MrArea<Sets> = MrArea::new(&file);
    let custom: BTreeMap<String, Value> = custom.into_iter().collect();
    for (set, ids) in custom {
        if defaults.get(&set) == Some(&ids) {
            area.unchanged += 1;
            continue;
        }
        let target = match set.as_str() {
            "default" | "shift" | "alt" => set.clone(),
            "cmd" if os == MrOs::Osx => "cmd".into(),
            "cmd" => "ctrl".into(),
            _ => {
                area.skip(set, "invalid");
                continue;
            }
        };
        let Some(ids) = ids.as_array() else {
            area.skip(set, "invalid");
            continue;
        };
        let mut kept: Vec<String> = Vec::new();
        for id in ids {
            let id = id.as_str().unwrap_or("");
            match map_action(id) {
                Ok(new) if kept.contains(&new) => {}
                Ok(_) if kept.len() == buttons::MAX_SLOTS => {
                    area.skip(format!("{set}: {id}"), "too_many")
                }
                Ok(new) => kept.push(new),
                Err(reason) => area.skip(format!("{set}: {id}"), reason),
            }
        }
        area.items.insert(target, kept);
    }
    Some(area)
}

#[derive(Deserialize)]
struct RawCategory {
    #[serde(default)]
    label: Value,
    #[serde(default)]
    extensions: Vec<Value>,
}

/// mr `[{label, extensions}]` → checked categories; what `bound` drops is reported.
fn categories(list: Vec<Value>, area: &mut MrArea<Vec<FileType>>) -> Vec<FileType> {
    let mut out: Vec<FileType> = Vec::new();
    for v in list {
        let Ok(raw) = serde_json::from_value::<RawCategory>(v) else {
            area.skip("?", "invalid");
            continue;
        };
        let label = raw.label.as_str().unwrap_or("").to_string();
        let candidate = FileType {
            label: label.clone(),
            extensions: raw
                .extensions
                .iter()
                .filter_map(|e| e.as_str().map(String::from))
                .collect(),
            icon: None,
            color: None,
        };
        let mut next = out.clone();
        next.push(candidate);
        let bounded = filetypes::bound(next);
        if bounded.len() > out.len() {
            out = bounded;
        } else {
            area.skip(if label.is_empty() { "?".into() } else { label }, "invalid");
        }
    }
    out
}

/// E6: the whole list, unless it equals mr's defaults.
fn scan_file_types(assets: &Path) -> Option<MrArea<Vec<FileType>>> {
    let file = assets.join("filetype/custom/data.json");
    let custom = match custom_file(&file)? {
        Ok(v) => v,
        Err(area) => return Some(area),
    };
    let Value::Array(list) = custom else {
        return Some(MrArea::failed(&file, "broken"));
    };
    let mut area: MrArea<Vec<FileType>> = MrArea::new(&file);
    let defaults = defaults_file(&assets.join("filetype/defaults/data.json"));
    if defaults.as_ref().and_then(Value::as_array) == Some(&list) {
        area.unchanged = list.len() as u32;
        return Some(area);
    }
    area.items = categories(list, &mut area);
    Some(area)
}

/// E3/E7: mr wrote own patterns over its shipped file (`search/defaults`, the folders are
/// swapped in mr); `search/custom` only when that is missing.
fn scan_search(assets: &Path) -> Option<MrArea<Vec<MrPattern>>> {
    let own = assets.join("search/defaults/data.json");
    let file = if own.exists() {
        own
    } else {
        assets.join("search/custom/data.json")
    };
    let custom = match custom_file(&file)? {
        Ok(v) => v,
        Err(area) => return Some(area),
    };
    let Value::Array(list) = custom else {
        return Some(MrArea::failed(&file, "broken"));
    };
    let mut area: MrArea<Vec<MrPattern>> = MrArea::new(&file);
    let mut ft: MrArea<Vec<FileType>> = MrArea::new(&file);
    // mr shipped its search patterns as copies of its file types: those count as defaults
    let mut ignored: MrArea<Vec<FileType>> = MrArea::new(&file);
    let shipped: Vec<(String, Vec<String>)> =
        match defaults_file(&assets.join("filetype/defaults/data.json")) {
            Some(Value::Array(d)) => categories(d, &mut ignored),
            _ => Vec::new(),
        }
        .into_iter()
        .map(|c| (c.label.to_lowercase(), sorted(c.extensions)))
        .collect();
    for c in categories(list, &mut ft) {
        if shipped.contains(&(c.label.to_lowercase(), sorted(c.extensions.clone()))) {
            area.unchanged += 1;
        } else if c.extensions.is_empty() {
            area.skip(c.label, "invalid");
        } else {
            area.items.push(MrPattern {
                label: c.label,
                extensions: c.extensions,
            });
        }
    }
    area.skipped.extend(ft.skipped);
    Some(area)
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

/// E8: tools that differ from mr's default of the same id, through the existing mr import.
fn scan_tools(assets: &Path, os: MrOs) -> Option<MrArea<Vec<Tool>>> {
    let file = assets
        .join("tool/custom")
        .join(format!("{}.json", os.name()));
    let custom = match custom_file(&file)? {
        Ok(v) => v,
        Err(area) => return Some(area),
    };
    let Value::Array(list) = custom else {
        return Some(MrArea::failed(&file, "broken"));
    };
    let defaults = defaults_file(
        &assets
            .join("tool/defaults")
            .join(format!("{}.json", os.name())),
    );
    let defaults = defaults.as_ref().and_then(Value::as_array);
    let mut area: MrArea<Vec<Tool>> = MrArea::new(&file);
    for v in list.into_iter().take(tools::MAX_TOOLS) {
        if defaults.is_some_and(|d| d.contains(&v)) {
            area.unchanged += 1;
            continue;
        }
        let name = v
            .get("label")
            .or_else(|| v.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_string();
        match tools::from_mr_value(v) {
            Ok(t) if area.items.iter().any(|o| o.id == t.id) => area.skip(name, "invalid"),
            Ok(t) => area.items.push(t),
            Err(reason) => area.skip(name, reason),
        }
    }
    Some(area)
}

/// E9: own colour files (no links), unless equal to mr's file of the same name.
fn scan_colors(assets: &Path) -> Option<MrArea<Vec<MrColorFile>>> {
    let dir = assets.join("color/custom");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("json"))
        })
        .collect();
    if files.is_empty() {
        return None;
    }
    files.sort();
    let mut area: MrArea<Vec<MrColorFile>> = MrArea::new(&dir);
    for (i, file) in files.into_iter().enumerate() {
        let stem = file
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if i >= MAX_COLOR_FILES {
            area.skip(stem, "too_many");
            continue;
        }
        let value = match read_json(&file, MAX_COLOR_BYTES) {
            Ok(Some(v)) => v,
            Ok(None) => continue,
            Err(reason) => {
                area.skip(stem, reason);
                continue;
            }
        };
        let file_name = file.file_name().unwrap_or_default();
        let defaults = read_json(
            &assets.join("color/defaults").join(file_name),
            MAX_COLOR_BYTES,
        )
        .ok()
        .flatten();
        if defaults.as_ref() == Some(&value) {
            area.unchanged += 1;
            continue;
        }
        if !value.get("colors").is_some_and(Value::is_object) {
            area.skip(stem, "invalid");
            continue;
        }
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .filter(|n| !n.trim().is_empty())
            .map(String::from)
            .unwrap_or(stem);
        area.items.push(MrColorFile {
            name,
            path: file.to_string_lossy().into_owned(),
        });
    }
    Some(area)
}

/// E10: two switches have an equivalent; `false` is mr's default and not transferred.
fn scan_setup(assets: &Path) -> Option<MrArea<Map<String, Value>>> {
    let file = assets.join("setup/data.json");
    let custom = match custom_file(&file)? {
        Ok(v) => v,
        Err(area) => return Some(area),
    };
    let Some(custom) = object(custom) else {
        return Some(MrArea::failed(&file, "broken"));
    };
    let mut area: MrArea<Map<String, Value>> = MrArea::new(&file);
    let custom: BTreeMap<String, Value> = custom.into_iter().collect();
    for (key, value) in custom {
        let on = value.as_bool() == Some(true);
        match key.as_str() {
            "condensedPresentationStyle" if on => {
                area.items
                    .insert("view.density".into(), Value::from("condensed"));
            }
            "loadFolderSizeAfterSelection" if on => {
                area.items
                    .insert("behavior.spaceCalcSize".into(), Value::Bool(true));
            }
            k if on && k.starts_with("open") && k.ends_with("InNewWindow") => {
                area.skip(k, "not_applicable")
            }
            _ => area.unchanged += 1,
        }
    }
    Some(area)
}

// ---- writing (E11) ----

/// The parts to write, planned by the frontend against the current state.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MrApply {
    #[serde(default)]
    pub keymap: Option<Bindings>,
    #[serde(default)]
    pub buttons: Option<Sets>,
    #[serde(default)]
    pub file_types: Option<Vec<FileType>>,
    /// Only the keys to set; merged into `settings.json`.
    #[serde(default)]
    pub settings: Option<Map<String, Value>>,
    /// The `assets` folder of the scan: Rust reads the tools there again – programs and
    /// arguments never come from the frontend (CLAUDE.md §4, external tools).
    #[serde(default)]
    pub tools_from: Option<String>,
    #[serde(default)]
    pub tools_replace: bool,
    /// Colours follow through the theme import: only back up `themes.json`.
    #[serde(default)]
    pub backup_themes: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrApplyReport {
    /// Bundle parts written (`keymap`, `buttons`, `fileTypes`, `settings`, `tools`).
    pub imported: Vec<String>,
    pub warnings: Vec<SettingsWarning>,
    /// Paths of the backups made.
    pub backups: Vec<String>,
}

/// Backs up every file to be replaced, then writes the parts through the bundle import
/// (checked per module, atomic). A part whose backup failed is not written.
pub fn apply(files: &ConfigFiles, plan: MrApply, os: MrOs) -> MrApplyReport {
    let mut report = MrApplyReport {
        imported: Vec::new(),
        warnings: Vec::new(),
        backups: Vec::new(),
    };
    let mut bundle: Map<String, Value> = Map::new();
    let backed_up = |part: &str, report: &mut MrApplyReport| -> bool {
        let file = files.path_of(part);
        match backup_copy(file) {
            Ok(b) => {
                report
                    .backups
                    .extend(b.map(|p| p.to_string_lossy().into_owned()));
                true
            }
            Err(_) => {
                report
                    .warnings
                    .push(SettingsWarning::new("part_failed", Some(part), Some(file)));
                false
            }
        }
    };
    if let Some(b) = plan.keymap
        && backed_up("keymap", &mut report)
    {
        bundle.insert("keymap".into(), json(keymap::bound(b)));
    }
    if let Some(s) = plan.buttons
        && backed_up("buttons", &mut report)
    {
        bundle.insert("buttons".into(), json(buttons::bound(s)));
    }
    if let Some(c) = plan.file_types
        && backed_up("fileTypes", &mut report)
    {
        bundle.insert("fileTypes".into(), json(filetypes::bound(c)));
    }
    if let Some(keys) = plan.settings
        && backed_up("settings", &mut report)
    {
        let mut current = settings::load(&files.settings).settings;
        current.extend(keys);
        bundle.insert("settings".into(), Value::Object(current));
    }
    if let Some(root) = plan.tools_from {
        let list = Some(PathBuf::from(root))
            .filter(|a| is_assets(a))
            .and_then(|a| scan_tools(&a, os))
            .filter(|area| area.error.is_none())
            .map(|area| area.items)
            .ok_or_else(|| "no tools".to_string());
        let existing = match fs::read_to_string(&files.tools) {
            Ok(t) => Ok(Some(t)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        };
        match existing
            .map_err(|e| e.to_string())
            .and_then(|text| tools::merge_file(text.as_deref(), list?, plan.tools_replace))
        {
            Ok(v) => {
                if backed_up("tools", &mut report) {
                    bundle.insert("tools".into(), v);
                }
            }
            // a hand-edited file we cannot read is not replaced
            Err(_) => report.warnings.push(SettingsWarning::new(
                "part_skipped",
                Some("tools"),
                Some(&files.tools),
            )),
        }
    }
    if plan.backup_themes {
        backed_up("themes", &mut report);
    }
    let parts: Vec<String> = bundle.keys().cloned().collect();
    if let Ok(r) = settings::import(files, &bundle, &parts) {
        report.imported = r.imported;
        report.warnings.extend(r.warnings);
    }
    report
}

fn json<T: Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

/// Sizes of a plan before it reaches the modules (they bound again).
pub fn plan_ok(plan: &MrApply) -> bool {
    plan.keymap
        .as_ref()
        .is_none_or(|b| b.len() <= keymap::MAX_ACTIONS)
        && plan
            .buttons
            .as_ref()
            .is_none_or(|s| s.len() <= buttons::SETS.len())
        && plan
            .file_types
            .as_ref()
            .is_none_or(|c| c.len() <= filetypes::MAX_CATEGORIES)
        && plan
            .settings
            .as_ref()
            .is_none_or(|m| m.len() <= settings::MAX_UNKNOWN_KEYS)
        && plan.tools_from.as_ref().is_none_or(|p| p.len() <= 4096)
}
