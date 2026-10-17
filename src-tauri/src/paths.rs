//! Platform-aware path helpers. All logic uses `std::path` – never string
//! manipulation with hard-coded separators.

use crate::error::{FsError, FsErrorCode};
use crate::model::PathSegment;
use std::path::{Component, Path, PathBuf};

/// Validates a path coming from the frontend.
///
/// Rules: must not be empty, must not contain NUL bytes and must be absolute.
/// `.`/`..` components are resolved lexically (without touching the file
/// system, so symlinks are not resolved and Windows paths do not get the
/// `\\?\` prefix that `canonicalize` would add).
pub fn validate_input_path(raw: &str) -> Result<PathBuf, FsError> {
    if raw.trim().is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Path is empty",
            None,
        ));
    }
    if raw.contains('\0') {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Path contains a NUL byte",
            None,
        ));
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Path must be absolute",
            Some(&path),
        ));
    }
    Ok(normalize_lexically(&path))
}

/// Expands a leading `~` (`~`, `~/x`, `~\\x`) with `home`. `~user` is not supported.
pub fn expand_tilde(raw: &str, home: &Path) -> Result<PathBuf, FsError> {
    let trimmed = raw.trim();
    let Some(rest) = trimmed.strip_prefix('~') else {
        return Ok(PathBuf::from(trimmed));
    };
    if rest.is_empty() {
        return Ok(home.to_path_buf());
    }
    let rest = rest
        .strip_prefix('/')
        .or_else(|| rest.strip_prefix(std::path::MAIN_SEPARATOR))
        .ok_or_else(|| {
            FsError::new(
                FsErrorCode::InvalidPath,
                "Only ~ for your own home folder is supported",
                None,
            )
        })?;
    Ok(home.join(rest))
}

/// Resolves `.` and `..` lexically. `..` never climbs above the root.
pub fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                // `pop` is a no-op at the root, which is what we want.
                let at_root = out.parent().is_none();
                if !at_root {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn parent_of(path: &Path) -> Option<PathBuf> {
    path.parent().map(Path::to_path_buf)
}

/// Builds breadcrumb segments from the root down to `path` itself.
pub fn segments_of(path: &Path) -> Vec<PathSegment> {
    let mut segs: Vec<PathSegment> = path
        .ancestors()
        .map(|p| PathSegment {
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.to_string_lossy().into_owned()),
            path: p.to_string_lossy().into_owned(),
        })
        .collect();
    segs.reverse();
    segs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(parts: &[&str]) -> PathBuf {
        // Build an absolute path on the current platform without assuming '/'.
        let mut p = std::env::temp_dir()
            .ancestors()
            .last()
            .unwrap()
            .to_path_buf();
        for part in parts {
            p.push(part);
        }
        p
    }

    #[test]
    fn rejects_empty_relative_and_nul() {
        assert_eq!(
            validate_input_path("").unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        assert_eq!(
            validate_input_path("   ").unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        assert_eq!(
            validate_input_path("relative/dir").unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        let with_nul = format!("{}\0x", abs(&["a"]).display());
        assert_eq!(
            validate_input_path(&with_nul).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
    }

    #[test]
    fn accepts_absolute_unicode_path_with_spaces() {
        let p = abs(&["Ordner mit Leerzeichen", "Ünïcödé 日本語"]);
        let v = validate_input_path(p.to_str().unwrap()).unwrap();
        assert_eq!(v, p);
    }

    #[test]
    fn normalizes_dot_components_without_escaping_root() {
        let root = abs(&[]);
        let p = abs(&["a", "b"]).join("..").join(".").join("c");
        assert_eq!(normalize_lexically(&p), abs(&["a", "c"]));
        let escape = root.join("..").join("..").join("x");
        assert_eq!(normalize_lexically(&escape), abs(&["x"]));
    }

    #[test]
    fn expands_tilde_for_the_own_home_only() {
        let home = abs(&["home", "jörg"]);
        assert_eq!(expand_tilde("~", &home).unwrap(), home);
        assert_eq!(
            expand_tilde(" ~/Mein Ordner ", &home).unwrap(),
            home.join("Mein Ordner")
        );
        assert_eq!(
            expand_tilde("~other/x", &home).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        let plain = abs(&["x"]);
        assert_eq!(expand_tilde(plain.to_str().unwrap(), &home).unwrap(), plain);
    }

    #[test]
    fn parent_and_segments() {
        let p = abs(&["a", "b c", "ä"]);
        assert_eq!(parent_of(&p), Some(abs(&["a", "b c"])));
        assert_eq!(parent_of(&abs(&[])), None);

        let segs = segments_of(&p);
        assert_eq!(segs.len(), 4);
        assert_eq!(segs[0].path, abs(&[]).to_string_lossy());
        assert_eq!(segs[2].name, "b c");
        assert_eq!(segs[3].name, "ä");
        assert_eq!(segs[3].path, p.to_string_lossy());
    }
}
