//! Dragging entries out of the window into other programs (design 028).
//!
//! Pure checks without Tauri; the native drag lives in `platform::os_drag`, the
//! command in `commands::os_drag`.

use crate::error::{FsError, FsErrorCode};
use crate::paths::validate_input_path;
use std::collections::HashSet;
use std::path::PathBuf;

/// At most this many entries are dragged at once (as for dropped paths, 012).
pub const MAX_DRAGGED: usize = 10_000;

/// The paths of a drag (design 028 E2): absolute, without `..`, existing (a
/// dangling link counts – it is shown in the list). Virtual paths inside an
/// archive fail here: they do not exist on disk. Duplicates are dropped, the
/// order is kept.
pub fn validate_drag_paths(raw: &[String]) -> Result<Vec<PathBuf>, FsError> {
    if raw.is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Nothing to drag",
            None,
        ));
    }
    if raw.len() > MAX_DRAGGED {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            format!("At most {MAX_DRAGGED} items can be dragged at once"),
            None,
        ));
    }
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(raw.len());
    for p in raw {
        let path = validate_input_path(p)?;
        std::fs::symlink_metadata(&path).map_err(|e| FsError::from_io(&e, &path))?;
        if seen.insert(path.clone()) {
            out.push(path);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn s(p: &std::path::Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn existing_entries_pass_in_order_without_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("Grüße mit Leerzeichen 🎉 %41 #1.txt");
        let b = dir.path().join("Ordner");
        fs::write(&a, "x").unwrap();
        fs::create_dir(&b).unwrap();
        let got = validate_drag_paths(&[s(&b), s(&a), s(&b)]).unwrap();
        assert_eq!(got, vec![b, a]);
    }

    #[test]
    fn dot_dot_is_resolved_lexically() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        fs::write(&a, "x").unwrap();
        let raw = format!("{}/sub/../a", dir.path().display());
        assert_eq!(validate_drag_paths(&[raw]).unwrap(), vec![a]);
    }

    #[test]
    fn empty_relative_missing_and_too_many_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            validate_drag_paths(&[]).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        assert_eq!(
            validate_drag_paths(&["rel/a".into()]).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        assert_eq!(
            validate_drag_paths(&[s(&dir.path().join("gone"))])
                .unwrap_err()
                .code,
            FsErrorCode::NotFound
        );
        let many = vec![s(dir.path()); MAX_DRAGGED + 1];
        assert_eq!(
            validate_drag_paths(&many).unwrap_err().code,
            FsErrorCode::TooMany
        );
    }

    #[test]
    fn a_path_inside_an_archive_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("a.zip");
        fs::write(&zip, "PK").unwrap();
        let inner = crate::archive::virtual_path(&zip, &["x.txt".to_string()]);
        assert!(validate_drag_paths(&[s(&inner)]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_link_may_be_dragged() {
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(dir.path().join("nowhere"), &link).unwrap();
        assert_eq!(validate_drag_paths(&[s(&link)]).unwrap(), vec![link]);
    }
}
