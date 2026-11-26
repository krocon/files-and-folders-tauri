//! Files in the system clipboard: copied in Finder, Explorer or Files and pasted
//! into a panel (`PASTE_FILES`). Pure checks without Tauri; reading the
//! clipboard lives in `platform::clipboard`, the command in `commands::clipboard`.
//!
//! What the clipboard holds is foreign data: every path is checked like a path
//! from the frontend, and nothing is copied here – the command only describes
//! the entries, the copy dialog and the job engine do the rest.

use crate::error::{FsError, FsErrorCode};
use crate::paths::validate_input_path;
use std::path::PathBuf;

/// At most this many entries are pasted at once (as for dropped paths, 012).
pub const MAX_PASTED: usize = 10_000;

/// The URIs of an `x-special/gnome-copied-files` or `text/uri-list` text: one per
/// line, without the leading `copy`/`cut` line, comments (`#`) and empty lines.
pub fn uris_in(text: &str) -> Vec<&str> {
    text.lines()
        .map(|line| line.trim_matches(['\r', '\0', ' ']))
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter(|line| !matches!(*line, "copy" | "cut"))
        .collect()
}

/// The paths of a clipboard: absolute ones, `..` resolved lexically. What is not a
/// usable path (relative, NUL, a server or archive address) is counted, not
/// failed – the rest can still be pasted.
pub fn checked(raw: &[String]) -> Result<(Vec<PathBuf>, usize), FsError> {
    if raw.len() > MAX_PASTED {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            format!("At most {MAX_PASTED} items can be pasted at once"),
            None,
        ));
    }
    let mut refused = 0;
    let mut paths = Vec::with_capacity(raw.len());
    for p in raw {
        match validate_input_path(p) {
            Ok(path) => paths.push(path),
            Err(_) => refused += 1,
        }
    }
    Ok((paths, refused))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copied_files_of_gnome_lose_the_operation_line() {
        let text = "copy\nfile:///home/u/a%20b.txt\nfile:///home/u/Ordner\n";
        assert_eq!(
            uris_in(text),
            vec!["file:///home/u/a%20b.txt", "file:///home/u/Ordner"]
        );
        assert_eq!(uris_in("cut\nfile:///x"), vec!["file:///x"]);
    }

    #[test]
    fn a_uri_list_has_comments_crlf_and_a_trailing_nul() {
        let text = "# from Files\r\nfile:///a\r\n\r\nfile:///b\0";
        assert_eq!(uris_in(text), vec!["file:///a", "file:///b"]);
        assert!(uris_in("").is_empty());
    }

    #[test]
    fn paths_are_checked_like_input_and_bad_ones_counted() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("Grüße mit Leerzeichen 🎉.txt");
        let raw = vec![
            a.to_string_lossy().into_owned(),
            "relative/b".to_string(),
            "remote://profile/x".to_string(),
            String::new(),
            format!("{}/sub/../c", dir.path().display()),
        ];
        let (paths, refused) = checked(&raw).unwrap();
        assert_eq!(paths, vec![a, dir.path().join("c")]);
        assert_eq!(refused, 3);
    }

    #[test]
    fn too_many_entries_are_refused_before_any_check() {
        let many = vec!["/a".to_string(); MAX_PASTED + 1];
        assert_eq!(checked(&many).unwrap_err().code, FsErrorCode::TooMany);
        assert_eq!(checked(&[]).unwrap(), (Vec::new(), 0));
    }
}
