//! Files in the system clipboard: one signature per OS. Runs on the main thread
//! (GTK needs it, AppKit prefers it). Returns the paths as the clipboard gives
//! them – unchecked, `crate::clipboard_files::checked` does that. At most
//! `MAX_PASTED + 1` entries are read, so the limit is reported, not allocated.

use crate::clipboard_files::MAX_PASTED;
use crate::error::FsError;

/// One more than allowed: enough for `checked` to say "too many".
const LIMIT: usize = MAX_PASTED + 1;

/// The files copied in Finder (`public.file-url` of every pasteboard item). A file
/// reference URL (`file:///.file/id=…`) becomes its path through `NSURL`.
#[cfg(target_os = "macos")]
pub fn file_paths() -> Result<Vec<String>, FsError> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    let board = NSPasteboard::generalPasteboard();
    let Some(items) = board.pasteboardItems() else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for item in items.iter().take(LIMIT) {
        // SAFETY: a constant of AppKit, valid for the life of the process
        let file_url = unsafe { NSPasteboardTypeFileURL };
        let Some(text) = item.stringForType(file_url) else {
            continue;
        };
        let Some(url) = NSURL::URLWithString(&text) else {
            continue;
        };
        if !url.isFileURL() {
            continue;
        }
        if let Some(path) = url.path() {
            out.push(path.to_string());
        }
    }
    Ok(out)
}

/// The files copied in Explorer (`CF_HDROP`).
#[cfg(windows)]
pub fn file_paths() -> Result<Vec<String>, FsError> {
    use crate::error::FsErrorCode;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

    const CF_HDROP: u32 = 15;
    // SAFETY: a plain query without pointers
    if unsafe { IsClipboardFormatAvailable(CF_HDROP) } == 0 {
        return Ok(Vec::new());
    }
    // SAFETY: no owner window is needed for reading; closed below on every path
    if unsafe { OpenClipboard(std::ptr::null_mut()) } == 0 {
        return Err(FsError::new(
            FsErrorCode::Io,
            "The clipboard is in use by another program",
            None,
        ));
    }
    let mut out = Vec::new();
    // SAFETY: the clipboard is open; the handle belongs to the clipboard and stays
    // valid until `CloseClipboard`. `DragQueryFileW` writes at most `cch` units.
    unsafe {
        let drop: HDROP = GetClipboardData(CF_HDROP);
        if !drop.is_null() {
            let count = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0) as usize;
            for i in 0..count.min(LIMIT) {
                let len = DragQueryFileW(drop, i as u32, std::ptr::null_mut(), 0);
                let mut buf = vec![0u16; len as usize + 1];
                let got = DragQueryFileW(drop, i as u32, buf.as_mut_ptr(), buf.len() as u32);
                buf.truncate(got as usize);
                out.push(OsString::from_wide(&buf).to_string_lossy().into_owned());
            }
        }
        CloseClipboard();
    }
    Ok(out)
}

/// The files copied in Files/Nautilus, Dolphin, Thunar …: `x-special/gnome-copied-files`,
/// else `text/uri-list`. GTK turns the URIs into file names (percent-decoding).
#[cfg(target_os = "linux")]
pub fn file_paths() -> Result<Vec<String>, FsError> {
    let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
    let copied = gtk::gdk::Atom::intern("x-special/gnome-copied-files");
    let mut uris: Vec<String> = clipboard
        .wait_for_contents(&copied)
        .map(|data| {
            let bytes = data.data();
            crate::clipboard_files::uris_in(&String::from_utf8_lossy(&bytes))
                .into_iter()
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if uris.is_empty() {
        uris = clipboard
            .wait_for_uris()
            .iter()
            .map(|u| u.to_string())
            .collect();
    }
    Ok(uris
        .iter()
        .filter_map(|uri| gtk::glib::filename_from_uri(uri).ok())
        .map(|(path, _host)| path.to_string_lossy().into_owned())
        .take(LIMIT)
        .collect())
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub fn file_paths() -> Result<Vec<String>, FsError> {
    let _ = LIMIT;
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whatever the clipboard holds right now: reading never fails or panics, and
    /// what comes back are absolute paths, at most one more than the limit.
    #[cfg(target_os = "macos")]
    #[test]
    fn reading_the_clipboard_gives_absolute_paths() {
        let paths = file_paths().unwrap();
        assert!(paths.len() <= LIMIT);
        assert!(paths.iter().all(|p| p.starts_with('/')));
    }
}
