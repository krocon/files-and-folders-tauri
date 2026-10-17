//! Colour schemes (`themes.json` in the app config directory, design 013 E4):
//! the user's own schemes and the selection (system / fixed). Rust checks shape,
//! size and every value by the kind of its token (colour, length, font list,
//! shadow – review 013 #1); which tokens exist exactly is the frontend's business
//! (it applies only its catalog). Import/export of single scheme files (E5).
//! Keep in sync with `src/app/core/theme/theme.models.ts`.

use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::{keep_broken_file, write_atomic};
use crate::paths::{WINDOWS_RESERVED, validate_name, validate_name_for};
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
/// Length limit of the name part of an exported file (bytes).
pub const MAX_EXPORT_STEM_BYTES: usize = 200;

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

/// A harmless CSS value: short, no declaration/block/markup characters, no
/// control characters (C0 and C1), nothing that loads resources. Same rule as
/// `isSafeValue` in `theme-logic.ts`.
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

/// What a token holds; decides how its value is checked (same rule as
/// `tokenKind` in `theme-logic.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Color,
    Length,
    Font,
    Shadow,
    /// `--fnf-*` of old scheme files: kept (prompt 019), never applied.
    Legacy,
}

/// Layout variables of `styles.scss` that share a theme prefix – never theme tokens.
const LAYOUT_TOKENS: [&str; 6] = [
    "--font-sans",
    "--font-mono",
    "--font-size-xs",
    "--font-size-sm",
    "--font-size-md",
    "--font-size-lg",
];

pub fn token_kind(name: &str) -> Option<TokenKind> {
    if !token_name_ok(name) || LAYOUT_TOKENS.contains(&name) {
        return None;
    }
    if name.starts_with("--fnf-") {
        Some(TokenKind::Legacy)
    } else if name.starts_with("--color-") {
        Some(TokenKind::Color)
    } else if name.starts_with("--shadow-") {
        Some(TokenKind::Shadow)
    } else if name.starts_with("--font-size-") {
        Some(TokenKind::Length)
    } else if name.starts_with("--font-") {
        Some(TokenKind::Font)
    } else {
        None
    }
}

/// A token the app may store: a theme token name and a value of its kind.
pub fn token_ok(name: &str, value: &str) -> bool {
    let v = value.trim();
    value_ok(v)
        && match token_kind(name) {
            Some(TokenKind::Color) => color_ok(v),
            Some(TokenKind::Length) => length_ok(v),
            Some(TokenKind::Font) => font_ok(v),
            Some(TokenKind::Shadow) => shadow_ok(v),
            Some(TokenKind::Legacy) => true,
            None => false,
        }
}

const NAMED_COLORS: [&str; 21] = [
    "black",
    "white",
    "red",
    "green",
    "blue",
    "yellow",
    "orange",
    "gray",
    "grey",
    "silver",
    "maroon",
    "navy",
    "teal",
    "purple",
    "olive",
    "lime",
    "aqua",
    "cyan",
    "fuchsia",
    "magenta",
    "transparent",
];

/// `12`, `1.5`, `.5`, optionally signed and/or with `%` (as `parseColor`).
fn css_number(s: &str) -> bool {
    let s = s.strip_suffix('%').unwrap_or(s);
    let s = s.strip_prefix(['-', '+']).unwrap_or(s);
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    (!int.is_empty() || !frac.is_empty())
        && int.bytes().all(|b| b.is_ascii_digit())
        && frac.bytes().all(|b| b.is_ascii_digit())
        && !(s.contains('.') && frac.is_empty() && int.is_empty())
}

/// `#rgb[a]`, `#rrggbb[aa]`, `rgb()/rgba()` (comma or space syntax), basic names.
fn color_literal(v: &str) -> bool {
    let v = v.trim().to_ascii_lowercase();
    if NAMED_COLORS.contains(&v.as_str()) {
        return true;
    }
    if let Some(hex) = v.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    let Some(inner) = v
        .strip_prefix("rgba(")
        .or_else(|| v.strip_prefix("rgb("))
        .and_then(|r| r.strip_suffix(')'))
    else {
        return false;
    };
    let (channels, alpha) = match inner.split_once('/') {
        Some((c, a)) => (c, Some(a.trim())),
        None => (inner, None),
    };
    let mut parts: Vec<&str> = channels
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|p| !p.is_empty())
        .collect();
    let mut alpha = alpha;
    if alpha.is_none() && parts.len() == 4 {
        alpha = parts.pop();
    }
    parts.len() == 3 && parts.iter().all(|p| css_number(p)) && alpha.is_none_or(css_number)
}

/// `var(--name)` or `var(--name, fallback)`.
fn var_ref(v: &str) -> Option<(&str, Option<&str>)> {
    let inner = v.strip_prefix("var(")?.strip_suffix(')')?;
    let (name, fallback) = match inner.split_once(',') {
        Some((n, f)) => (n.trim(), Some(f.trim()).filter(|f| !f.is_empty())),
        None => (inner.trim(), None),
    };
    if inner.contains(',') && fallback.is_none() {
        return None;
    }
    token_name_ok(name).then_some((name, fallback))
}

fn color_ok(v: &str) -> bool {
    color_literal(v)
        || var_ref(v).is_some_and(|(name, fallback)| {
            name.starts_with("--color-") && fallback.is_none_or(color_literal)
        })
}

/// A font size: px 6–48, pt 5–36, rem/em 0.375–3, % 50–300.
fn length_literal(v: &str) -> bool {
    let units: [(&str, f64, f64); 5] = [
        ("px", 6.0, 48.0),
        ("pt", 5.0, 36.0),
        ("rem", 0.375, 3.0),
        ("em", 0.375, 3.0),
        ("%", 50.0, 300.0),
    ];
    units.iter().any(|(unit, lo, hi)| {
        v.strip_suffix(unit).is_some_and(|n| {
            !n.starts_with(['-', '+'])
                && css_number(n)
                && !n.ends_with('%')
                && n.parse::<f64>().is_ok_and(|x| x >= *lo && x <= *hi)
        })
    })
}

fn length_ok(v: &str) -> bool {
    length_literal(v)
        || var_ref(v).is_some_and(|(name, fallback)| {
            name.starts_with("--font-size-") && fallback.is_none_or(length_literal)
        })
}

fn font_family(f: &str) -> bool {
    let f = f.trim();
    let quoted = (f.len() >= 2 && f.starts_with('\'') && f.ends_with('\''))
        || (f.len() >= 2 && f.starts_with('"') && f.ends_with('"'));
    let name = if quoted { &f[1..f.len() - 1] } else { f };
    let mut chars = name.chars();
    let first_ok = chars
        .next()
        .is_some_and(|c| c.is_alphabetic() || (quoted && c.is_alphanumeric()));
    first_ok
        && name.chars().count() <= 60
        && chars.all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'))
}

/// A list of font family names (at most 12) or `var(--font-…)`.
fn font_ok(v: &str) -> bool {
    if let Some((name, fallback)) = var_ref(v) {
        return name.starts_with("--font-")
            && !name.starts_with("--font-size-")
            && fallback.is_none_or(font_ok);
    }
    let families: Vec<&str> = v.split(',').collect();
    families.len() <= 12 && families.iter().all(|f| font_family(f))
}

/// Splits at `sep` outside of parentheses.
fn split_top(v: &str, sep: impl Fn(char) -> bool) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut depth, mut start) = (0i32, 0usize);
    for (i, c) in v.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            c if depth == 0 && sep(c) => {
                out.push(&v[start..i]);
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    out.push(&v[start..]);
    out
}

/// A shadow offset/blur/spread: `0` or a number with px (|x| ≤ 100) or rem/em (|x| ≤ 6).
fn shadow_length(p: &str) -> bool {
    if p == "0" {
        return true;
    }
    [("px", 100.0), ("rem", 6.0), ("em", 6.0)]
        .iter()
        .any(|(unit, max)| {
            p.strip_suffix(unit).is_some_and(|n| {
                css_number(n)
                    && !n.ends_with('%')
                    && n.parse::<f64>().is_ok_and(|x| x.abs() <= *max)
            })
        })
}

/// `none`, `var(--shadow-…)` or up to 4 shadows of `[inset] x y [blur [spread]] [colour]`.
fn shadow_ok(v: &str) -> bool {
    if v == "none" {
        return true;
    }
    if let Some((name, fallback)) = var_ref(v) {
        return name.starts_with("--shadow-") && fallback.is_none();
    }
    let shadows = split_top(v, |c| c == ',');
    shadows.len() <= 4
        && shadows.iter().all(|s| {
            let (mut lengths, mut colors, mut inset) = (0, 0, 0);
            for part in split_top(s.trim(), char::is_whitespace) {
                if part.is_empty() {
                    continue;
                }
                if part == "inset" {
                    inset += 1;
                } else if shadow_length(part) {
                    lengths += 1;
                } else if color_ok(part) {
                    colors += 1;
                } else {
                    return false;
                }
            }
            (2..=4).contains(&lengths) && colors <= 1 && inset <= 1
        })
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
            .filter(|(k, v)| token_ok(k, v))
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

/// The file name part for an exported scheme (review 013 #9): separators,
/// characters Windows refuses and control characters become `-`, no dots or
/// spaces at the end, a reserved device name gets a `_` in front, at most
/// 200 bytes – so the file can be copied to every system.
pub fn export_stem(name: &str) -> String {
    let mut s: String = name
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    if s.len() > MAX_EXPORT_STEM_BYTES {
        let mut end = MAX_EXPORT_STEM_BYTES;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
    }
    let s = s.trim_end_matches(['.', ' ']).trim_start();
    if s.is_empty() {
        return "theme".into();
    }
    let stem = s.split('.').next().unwrap_or("").trim_end();
    if WINDOWS_RESERVED
        .iter()
        .any(|r| r.eq_ignore_ascii_case(stem))
    {
        format!("_{s}")
    } else {
        s.to_string()
    }
}

/// Writes `<name>.theme.json` into `dir` without overwriting anything
/// (`<name> (2).theme.json` …); returns the path written.
pub fn export(dir: &Path, name: &str, theme: &Value) -> Result<PathBuf, FsError> {
    if name.trim().is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidName,
            "The name is empty",
            None,
        ));
    }
    let stem = export_stem(name);
    let base = stem.as_str();
    let file_name = format!("{base}{EXPORT_SUFFIX}");
    validate_name_for(&file_name, true)?;
    validate_name(&file_name)?;
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
        assert!(!value_ok("a\u{85}b"), "C1 control");
    }

    /// Same cases as `theme-logic.spec.ts` (review 013 #1).
    #[test]
    fn token_values_are_checked_per_kind() {
        for (name, value) in [
            ("--focus-ring-width", "0"),
            ("--font-size-md", "0px"),
            ("--spacing-2", "0"),
            ("--radius-md", "99px"),
            ("--border-width", "0"),
        ] {
            assert!(!token_ok(name, value), "{name}");
        }
        for (name, value) in [
            ("--color-bg", "#fff"),
            ("--color-marked-bg", "transparent"),
            ("--color-backdrop", "rgb(0 0 0 / 25%)"),
            ("--color-list-bg", "var(--color-surface)"),
            ("--color-list-bg", "var(--color-x, #fff)"),
            ("--color-x", "rgba(0, 0, 0, 0.5)"),
            ("--font-size-list", "13px"),
            ("--font-size-list", "0.8125rem"),
            ("--font-size-list", "var(--font-size-sm)"),
            ("--font-list", "system-ui, 'Segoe UI', sans-serif"),
            ("--font-list", "\"JetBrains Mono\", Menlo, monospace"),
            ("--font-list", "var(--font-sans)"),
            ("--shadow-popup", "0 4px 16px rgb(0 0 0 / 18%)"),
            ("--shadow-popup", "none"),
            (
                "--shadow-popup",
                "inset 0 1px 0 #fff, 0 0 2px var(--color-border)",
            ),
            ("--fnf-table-bg-color", "rgb(22, 35, 50)"),
        ] {
            assert!(token_ok(name, value), "{name}: {value}");
        }
        for (name, value) in [
            ("--color-bg", "inherit"),
            ("--color-bg", "10px"),
            ("--color-bg", "var(--font-size-md)"),
            ("--color-bg", "var(--color-x, 10px)"),
            ("--color-bg", "#ggg"),
            ("--font-size-list", "0px"),
            ("--font-size-list", "2px"),
            ("--font-size-list", "500px"),
            ("--font-size-list", "10vw"),
            ("--font-size-list", "calc(1px + 1px)"),
            ("--font-size-list", "var(--color-bg)"),
            ("--font-list", "10px"),
            ("--font-list", "a, , b"),
            ("--font-list", "'a'b'"),
            ("--font-list", "var(--color-bg)"),
            ("--shadow-popup", "4px #000"),
            ("--shadow-popup", "0 4px 999px #000"),
            ("--shadow-popup", "0 4px 16px red blue"),
            ("--shadow-popup", "foo"),
            ("--fnf-x", "url(x)"),
            ("--other", "#fff"),
        ] {
            assert!(!token_ok(name, value), "{name}: {value}");
        }
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
            ("--color-ok".to_string(), " #fff ".to_string()),
            ("--color-evil".to_string(), "url(x)".to_string()),
            ("--focus-ring-width".to_string(), "0".to_string()),
            ("nope".to_string(), "#000".to_string()),
        ]
        .into_iter()
        .collect();
        let many: BTreeMap<String, String> = (0..MAX_TOKENS + 10)
            .map(|i| (format!("--color-t{i}"), "#000".to_string()))
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
        assert_eq!(out.themes[0].tokens["--color-ok"], "#fff");
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

        // names are cleaned instead of refused (review 013 #9)
        let name = |n: &str| {
            export(dir.path(), n, &t)
                .unwrap()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        };
        assert_eq!(name("a/b\\c"), "a-b-c.theme.json");
        assert_eq!(name("x:y*?\"<>|"), "x-y------.theme.json");
        assert_eq!(name("dots... "), "dots.theme.json");
        assert_eq!(name("CON"), "_CON.theme.json");
        assert_eq!(name("tab\there"), "tab-here.theme.json");
        let long = name(&"ä".repeat(300));
        assert!(
            long.len() <= 200 + EXPORT_SUFFIX.len() + 4,
            "{}",
            long.len()
        );
        assert!(long.ends_with(EXPORT_SUFFIX));
        assert_eq!(name(".."), "theme.theme.json");
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
