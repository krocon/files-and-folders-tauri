//! Folder memory (`folder-memory.json` in the app config directory, design 027):
//! cursor, marks and scroll position of the last folders of every tab, so they
//! survive a restart. Paths are opaque strings from listings – Rust only bounds
//! shape and size (the frontend never applies a mark that is not in the listing).
//! Keep in sync with `src/app/core/memory/folder-memory.models.ts`.

use crate::config_file::{Loaded, read_config};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "folder-memory.json";
pub const VERSION: u32 = 1;
/// Tabs of both sides (2 × `MAX_TABS` of the frontend).
pub const MAX_TABS: usize = 100;
/// Folders per tab (`MAX_FOLDERS` of `tab-memory.ts`).
pub const MAX_FOLDERS: usize = 50;
/// Marks per folder; more are dropped (the newest folders stay complete).
pub const MAX_MARKS: usize = 2_000;
/// A path (or tab id) longer than this is dropped.
pub const MAX_PATH_CHARS: usize = 4_096;
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderState {
    pub path: String,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub marks: Vec<String>,
    #[serde(default)]
    pub scroll_top: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabFolders {
    pub tab_id: String,
    /// Oldest first (the order of the frontend's LRU map).
    #[serde(default)]
    pub folders: Vec<FolderState>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMemory {
    #[serde(default = "version")]
    pub version: u32,
    #[serde(default)]
    pub tabs: Vec<TabFolders>,
}

fn version() -> u32 {
    VERSION
}

impl Default for FolderMemory {
    fn default() -> Self {
        Self {
            version: VERSION,
            tabs: Vec::new(),
        }
    }
}

fn path_ok(p: &str) -> bool {
    !p.is_empty() && !p.contains('\0') && p.chars().count() <= MAX_PATH_CHARS
}

fn bound_folder(f: FolderState) -> Option<FolderState> {
    if !path_ok(&f.path) {
        return None;
    }
    let mut seen = HashSet::new();
    let marks: Vec<String> = f
        .marks
        .into_iter()
        .filter(|m| path_ok(m) && seen.insert(m.clone()))
        .take(MAX_MARKS)
        .collect();
    Some(FolderState {
        path: f.path,
        cursor: f.cursor.filter(|c| path_ok(c)),
        marks,
        scroll_top: if f.scroll_top.is_finite() && f.scroll_top > 0.0 {
            f.scroll_top
        } else {
            0.0
        },
    })
}

/// Drops what is invalid or too much: the first tab of an id wins, a folder that
/// appears twice in a tab keeps its newest (last) entry, the newest folders stay.
pub fn bound(m: FolderMemory) -> FolderMemory {
    let mut ids = HashSet::new();
    let mut tabs = Vec::new();
    for tab in m.tabs {
        if !path_ok(&tab.tab_id) || !ids.insert(tab.tab_id.clone()) {
            continue;
        }
        let mut folders: Vec<FolderState> = Vec::new();
        for f in tab.folders.into_iter().filter_map(bound_folder) {
            folders.retain(|g| g.path != f.path);
            folders.push(f);
        }
        let skip = folders.len().saturating_sub(MAX_FOLDERS);
        folders.drain(..skip);
        if !folders.is_empty() {
            tabs.push(TabFolders {
                tab_id: tab.tab_id,
                folders,
            });
        }
        if tabs.len() == MAX_TABS {
            break;
        }
    }
    FolderMemory {
        version: VERSION,
        tabs,
    }
}

fn parse(text: &str) -> Result<FolderMemory, String> {
    let file: FolderMemory = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(bound(file))
}

/// Missing → empty; broken or too big → empty, kept as `.bad`; unreadable → empty, not written over.
pub fn load(file: &Path) -> Loaded<FolderMemory> {
    read_config(file, MAX_FILE_BYTES, FolderMemory::default, parse)
}

pub fn save(file: &Path, memory: FolderMemory) -> io::Result<()> {
    let json = serde_json::to_vec(&bound(memory)).map_err(io::Error::other)?;
    write_atomic(file, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn folder(path: &str, marks: &[&str]) -> FolderState {
        FolderState {
            path: path.into(),
            cursor: Some(format!("{path}/x")),
            marks: marks.iter().map(|m| (*m).into()).collect(),
            scroll_top: 120.0,
        }
    }

    fn tab(id: &str, folders: Vec<FolderState>) -> TabFolders {
        TabFolders {
            tab_id: id.into(),
            folders,
        }
    }

    #[test]
    fn round_trip_with_unicode_and_spaces() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("cfg ä 😀").join(FILE_NAME);
        let m = FolderMemory {
            version: VERSION,
            tabs: vec![tab(
                "t1",
                vec![folder("/home/ä b", &["/home/ä b/x 😀.txt", "/home/ä b/y"])],
            )],
        };
        save(&file, m.clone()).unwrap();
        let l = load(&file);
        assert_eq!((l.value, l.warning, l.persist), (m, None, true));
    }

    #[test]
    fn missing_broken_and_newer_files() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        let l = load(&file);
        assert!(l.value.tabs.is_empty() && l.warning.is_none() && l.persist);
        for text in ["{", r#"{"version":2}"#, r#"{"version":1,"tabs":{}}"#] {
            fs::write(&file, text).unwrap();
            let l = load(&file);
            assert!(l.value.tabs.is_empty(), "{text}");
            assert_eq!(l.warning.unwrap().code, "broken", "{text}");
            assert_eq!(
                fs::read_to_string(dir.path().join(format!("{FILE_NAME}.bad"))).unwrap(),
                text
            );
        }
    }

    #[test]
    fn bounds_tabs_folders_marks_and_values() {
        let many: Vec<String> = (0..MAX_MARKS + 5).map(|i| format!("/a/{i}")).collect();
        let many_refs: Vec<&str> = many.iter().map(String::as_str).collect();
        let mut folders: Vec<FolderState> = (0..MAX_FOLDERS + 3)
            .map(|i| folder(&format!("/f{i}"), &[]))
            .collect();
        folders.push(folder("/big", &many_refs));
        // the same folder again later: the newer entry wins and moves to the end
        folders.push(FolderState {
            scroll_top: f64::NAN,
            cursor: Some(String::new()),
            ..folder("/f10", &["/f10/a", "/f10/a", "", "x\0y"])
        });
        let mut tabs = vec![
            tab("t1", folders),
            tab("t1", vec![folder("/dup", &[])]),
            tab("", vec![folder("/no-id", &[])]),
            tab("empty", vec![folder("", &[])]),
        ];
        for i in 0..MAX_TABS + 5 {
            tabs.push(tab(&format!("x{i}"), vec![folder("/x", &[])]));
        }
        let b = bound(FolderMemory {
            version: VERSION,
            tabs,
        });
        assert_eq!(b.tabs.len(), MAX_TABS);
        let t1 = &b.tabs[0];
        assert_eq!(t1.tab_id, "t1");
        assert_eq!(t1.folders.len(), MAX_FOLDERS);
        let last = t1.folders.last().unwrap();
        assert_eq!(last.path, "/f10");
        assert_eq!(last.marks, vec!["/f10/a".to_string()]);
        assert_eq!((last.cursor.clone(), last.scroll_top), (None, 0.0));
        let big = &t1.folders[t1.folders.len() - 2];
        assert_eq!((big.path.as_str(), big.marks.len()), ("/big", MAX_MARKS));
        assert!(
            !b.tabs
                .iter()
                .any(|t| t.tab_id.is_empty() || t.tab_id == "empty")
        );
    }

    #[test]
    fn a_too_big_file_is_set_aside() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        let f = fs::File::create(&file).unwrap();
        f.set_len(MAX_FILE_BYTES + 1).unwrap();
        let l = load(&file);
        assert_eq!(l.warning.unwrap().code, "broken");
        assert!(l.persist && !file.exists());
    }
}
