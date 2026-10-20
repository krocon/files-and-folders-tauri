//! Shared loader for small config files of the app config directory (design 022 E2):
//! missing → default, broken → default + the file kept as `<name>.bad`, unreadable →
//! default and not written over. Problems are codes – the frontend translates them.
//! Keep in sync with `src/app/core/config/config.models.ts`.

use crate::fs_atomic::keep_broken_file;
use serde::Serialize;
use std::fs;
use std::io::{self, Read};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWarning {
    /// `broken` (path = the `.bad` file, `None` if it could not be moved aside) | `unreadable`
    pub code: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded<T> {
    pub value: T,
    pub warning: Option<ConfigWarning>,
    /// `false` = a file stayed in place that we could not read or move aside – do not save over it.
    #[serde(skip)]
    pub persist: bool,
}

/// Reads `file` (at most `max_bytes`) and parses it; `default` for a missing or bad file.
pub fn read_config<T>(
    file: &Path,
    max_bytes: u64,
    default: impl FnOnce() -> T,
    parse: impl FnOnce(&str) -> Result<T, String>,
) -> Loaded<T> {
    let read = fs::File::open(file).and_then(|f| {
        let mut bytes = Vec::new();
        f.take(max_bytes + 1).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    let parsed = match read {
        Ok(bytes) if bytes.len() as u64 > max_bytes => None,
        Ok(bytes) => String::from_utf8(bytes)
            .ok()
            .and_then(|text| parse(&text).ok()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Loaded {
                value: default(),
                warning: None,
                persist: true,
            };
        }
        // a read error (rights, a folder in its place) is no broken file: leave it alone
        Err(_) => {
            return Loaded {
                value: default(),
                warning: Some(ConfigWarning {
                    code: "unreadable".into(),
                    path: Some(file.to_string_lossy().into_owned()),
                }),
                persist: false,
            };
        }
    };
    if let Some(value) = parsed {
        return Loaded {
            value,
            warning: None,
            persist: true,
        };
    }
    let bad = keep_broken_file(file);
    Loaded {
        value: default(),
        persist: bad.is_some(),
        warning: Some(ConfigWarning {
            code: "broken".into(),
            path: bad.map(|p| p.to_string_lossy().into_owned()),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn number(text: &str) -> Result<u32, String> {
        text.trim().parse().map_err(|e| format!("{e}"))
    }

    #[test]
    fn missing_ok_broken_and_too_big() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("ü x.json");
        let l = read_config(&file, 10, || 0, number);
        assert_eq!((l.value, l.warning, l.persist), (0, None, true));
        fs::write(&file, "42").unwrap();
        assert_eq!(read_config(&file, 10, || 0, number).value, 42);
        for text in ["nope", "12345678901", "\u{feff}"] {
            fs::write(&file, text).unwrap();
            let l = read_config(&file, 10, || 7, number);
            assert_eq!(l.value, 7, "{text}");
            let w = l.warning.unwrap();
            assert_eq!(w.code, "broken");
            assert!(w.path.unwrap().ends_with("ü x.json.bad"));
            assert!(l.persist && !file.exists());
        }
        fs::write(&file, [0xff, 0xfe]).unwrap();
        assert_eq!(
            read_config(&file, 10, || 0, number).warning.unwrap().code,
            "broken"
        );
    }

    #[test]
    fn a_read_error_leaves_the_file_alone() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("x.json");
        fs::create_dir(&file).unwrap();
        let l = read_config(&file, 10, || 0, number);
        assert_eq!(l.warning.unwrap().code, "unreadable");
        assert!(!l.persist && file.is_dir());
        assert!(!dir.path().join("x.json.bad").exists());
    }
}
