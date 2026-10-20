//! User file type categories (`filetypes.json` in the app config directory, design
//! 022 E4): replace the built-in categories (icons, colours, mark presets). Also reads
//! the mr format (a bare array of `{label, extensions}`). Rust bounds shape and size
//! and normalises the extensions; the frontend checks icons against its list.
//! Keep in sync with `src/app/core/config/config.models.ts`.

use crate::config_file::{Loaded, read_config};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "filetypes.json";
pub const VERSION: u32 = 1;
pub const MAX_CATEGORIES: usize = 100;
pub const MAX_LABEL_CHARS: usize = 64;
pub const MAX_EXTENSIONS: usize = 200;
/// Including the leading dot.
pub const MAX_EXTENSION_CHARS: usize = 33;
pub const MAX_FILE_BYTES: u64 = 512 * 1024;
/// Icon colour groups (`IconColorGroup` in the frontend).
pub const COLORS: [&str; 8] = [
    "folder",
    "document",
    "image",
    "video",
    "audio",
    "archive",
    "code",
    "executable",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileType {
    pub label: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileTypesFile {
    version: u32,
    categories: Vec<FileType>,
}

/// `JPG`, `*.jpg`, ` .Jpg ` → `.jpg`; `None` if it is no plain extension.
pub fn normalize_extension(raw: &str) -> Option<String> {
    let t = raw.trim();
    let t = t.strip_prefix('*').unwrap_or(t);
    let t = t.strip_prefix('.').unwrap_or(t).to_lowercase();
    let ok = !t.is_empty()
        && t.chars().count() < MAX_EXTENSION_CHARS
        && !t
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "/\\*?:".contains(c));
    ok.then(|| format!(".{t}"))
}

fn icon_ok(icon: &str) -> bool {
    icon.len() <= 43
        && icon.strip_prefix("fa-").is_some_and(|rest| {
            !rest.is_empty()
                && rest
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

/// Drops what is too big or has the wrong shape; the first category of a label wins.
pub fn bound(categories: Vec<FileType>) -> Vec<FileType> {
    let mut out: Vec<FileType> = Vec::new();
    for c in categories {
        let label = c.label.trim().to_string();
        let taken = out
            .iter()
            .any(|o| o.label.to_lowercase() == label.to_lowercase());
        if label.is_empty() || label.chars().count() > MAX_LABEL_CHARS || taken {
            continue;
        }
        let mut extensions: Vec<String> = Vec::new();
        for e in c.extensions.iter().filter_map(|e| normalize_extension(e)) {
            if !extensions.contains(&e) && extensions.len() < MAX_EXTENSIONS {
                extensions.push(e);
            }
        }
        out.push(FileType {
            label,
            extensions,
            icon: c.icon.filter(|i| icon_ok(i)),
            color: c.color.filter(|x| COLORS.contains(&x.as_str())),
        });
        if out.len() == MAX_CATEGORIES {
            break;
        }
    }
    out
}

fn parse(text: &str) -> Result<Option<Vec<FileType>>, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let categories = if value.is_array() {
        // mr `filetype/custom/data.json`
        serde_json::from_value::<Vec<FileType>>(value).map_err(|e| e.to_string())?
    } else {
        let file: FileTypesFile = serde_json::from_value(value).map_err(|e| e.to_string())?;
        if file.version != VERSION {
            return Err(format!("unsupported version {}", file.version));
        }
        file.categories
    };
    Ok(Some(bound(categories)))
}

/// `None` = no user file (the built-in categories apply).
pub fn load(file: &Path) -> Loaded<Option<Vec<FileType>>> {
    read_config(file, MAX_FILE_BYTES, || None, parse)
}

/// `None` removes the user file (back to the built-in categories).
pub fn save(file: &Path, categories: Option<Vec<FileType>>) -> io::Result<()> {
    match categories {
        None => match fs::remove_file(file) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
        Some(c) => {
            let data = FileTypesFile {
                version: VERSION,
                categories: bound(c),
            };
            let json = serde_json::to_vec_pretty(&data).map_err(io::Error::other)?;
            write_atomic(file, &json)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn ft(label: &str, ext: &[&str]) -> FileType {
        FileType {
            label: label.into(),
            extensions: ext.iter().map(|s| s.to_string()).collect(),
            icon: None,
            color: None,
        }
    }

    #[test]
    fn round_trip_and_reset() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("cfg ü 😀").join(FILE_NAME);
        let mut comics = ft("Comics 📚", &[".cbz", ".cbr"]);
        comics.icon = Some("fa-book".into());
        comics.color = Some("document".into());
        save(&file, Some(vec![comics.clone()])).unwrap();
        let l = load(&file);
        assert_eq!(l.warning, None);
        assert_eq!(l.value, Some(vec![comics]));
        save(&file, None).unwrap();
        assert!(!file.exists());
        save(&file, None).unwrap(); // already gone: fine
        assert_eq!(load(&file).value, None);
    }

    #[test]
    fn reads_the_mr_format() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::write(
            &file,
            r#"[{"label":"movies","extensions":[".avi",".MKV"]},{"label":"audio","extensions":["mp3"]}]"#,
        )
        .unwrap();
        let l = load(&file);
        assert!(l.warning.is_none());
        let v = l.value.unwrap();
        assert_eq!(v[0].extensions, [".avi", ".mkv"]);
        assert_eq!(v[1].extensions, [".mp3"]);
    }

    #[test]
    fn normalises_extensions() {
        assert_eq!(normalize_extension(" *.JPG ").as_deref(), Some(".jpg"));
        assert_eq!(normalize_extension("tar.gz").as_deref(), Some(".tar.gz"));
        assert_eq!(normalize_extension("ä").as_deref(), Some(".ä"));
        for bad in ["", ".", "*", "a b", "a/b", "a\\b", "a?", "c:", "x\u{0}"] {
            assert_eq!(normalize_extension(bad), None, "{bad:?}");
        }
        assert!(normalize_extension(&"x".repeat(MAX_EXTENSION_CHARS)).is_none());
        assert!(normalize_extension(&"x".repeat(MAX_EXTENSION_CHARS - 1)).is_some());
    }

    #[test]
    fn bounds_labels_extensions_icons_and_colours() {
        let mut a = ft(" Bilder ", &["jpg", ".JPG", "a b", "png"]);
        a.icon = Some("fa-picture-o".into());
        a.color = Some("image".into());
        let mut b = ft("Gifs", &["gif"]);
        b.icon = Some("fa fa-x\" onload".into());
        let mut c = ft("Other", &[]);
        c.icon = Some("fa-".into());
        c.color = Some("red".into());
        let many: Vec<String> = (0..MAX_EXTENSIONS + 5).map(|i| format!("e{i}")).collect();
        let d = FileType {
            label: "Many".into(),
            extensions: many,
            icon: None,
            color: None,
        };
        let out = bound(vec![
            a,
            ft("BILDER", &["x"]),
            b,
            ft("", &["x"]),
            ft(&"n".repeat(65), &[]),
            c,
            d,
        ]);
        assert_eq!(out.len(), 4);
        assert_eq!(out[0].label, "Bilder");
        assert_eq!(out[0].extensions, [".jpg", ".png"]);
        assert_eq!(out[0].icon.as_deref(), Some("fa-picture-o"));
        assert_eq!(out[0].color.as_deref(), Some("image"));
        assert_eq!(out[1].label, "Gifs");
        assert_eq!(out[1].icon, None);
        assert_eq!((out[2].icon.as_ref(), out[2].color.as_ref()), (None, None));
        assert_eq!(out[3].extensions.len(), MAX_EXTENSIONS);
        let lots: Vec<FileType> = (0..MAX_CATEGORIES + 3)
            .map(|i| ft(&format!("c{i}"), &[]))
            .collect();
        assert_eq!(bound(lots).len(), MAX_CATEGORIES);
    }

    #[test]
    fn broken_files_are_kept_aside() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        for text in [
            "{",
            r#"{"version":2,"categories":[]}"#,
            r#"{"version":1}"#,
            r#"[{"extensions":[]}]"#,
            r#""x""#,
        ] {
            fs::write(&file, text).unwrap();
            let l = load(&file);
            assert_eq!(l.value, None, "{text}");
            assert_eq!(l.warning.unwrap().code, "broken", "{text}");
        }
    }
}
