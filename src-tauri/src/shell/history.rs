//! Shell history (design 021 E14): `shell-history.json` in the app config
//! directory, newest first, without duplicates, at most [`MAX_ENTRIES`].
//! Only `run_shell` adds entries; the frontend reads and clears.

use crate::fs_atomic::{keep_broken_file, write_atomic};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "shell-history.json";
pub const VERSION: u32 = 1;
pub const MAX_ENTRIES: usize = 100;
/// As long as a command may be (`run_shell` accepts 32 KiB).
pub const MAX_ENTRY_BYTES: usize = super::MAX_COMMAND_BYTES;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct HistoryFile {
    version: u32,
    entries: Vec<String>,
}

/// Keeps valid, unique entries (the first one wins), at most [`MAX_ENTRIES`].
fn bound(entries: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in entries {
        if e.trim().is_empty() || e.len() > MAX_ENTRY_BYTES || e.contains(['\n', '\r', '\0']) {
            continue;
        }
        if !out.contains(&e) {
            out.push(e);
        }
        if out.len() == MAX_ENTRIES {
            break;
        }
    }
    out
}

/// Missing → empty; broken → empty, the file is kept as `.bad`; unreadable → empty.
pub fn load(file: &Path) -> Vec<String> {
    match fs::read_to_string(file) {
        Ok(text) => match serde_json::from_str::<HistoryFile>(&text) {
            Ok(f) if f.version == VERSION => bound(f.entries),
            _ => {
                keep_broken_file(file);
                Vec::new()
            }
        },
        Err(_) => Vec::new(),
    }
}

fn save(file: &Path, entries: Vec<String>) -> io::Result<()> {
    let data = HistoryFile {
        version: VERSION,
        entries: bound(entries),
    };
    let json = serde_json::to_vec_pretty(&data).map_err(io::Error::other)?;
    write_atomic(file, &json)
}

/// Puts `command` first (an older equal entry moves up). Returns the new list.
pub fn add(file: &Path, command: &str) -> io::Result<Vec<String>> {
    // an unreadable file (rights) is no broken file: do not save over it
    if let Err(e) = fs::read(file)
        && e.kind() != io::ErrorKind::NotFound
    {
        return Err(e);
    }
    let mut entries = load(file);
    entries.retain(|e| e != command);
    entries.insert(0, command.to_string());
    save(file, entries)?;
    Ok(load(file))
}

pub fn clear(file: &Path) -> io::Result<()> {
    match fs::remove_file(file) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}
