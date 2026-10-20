//! Native drag source (design 028 E4): one signature per OS. Must run on the
//! main thread; the paths are validated by `crate::os_drag`. Only "copy" is
//! offered (E3) – a move would be done by the other program, unchecked.

use crate::error::{FsError, FsErrorCode};
use std::path::PathBuf;
use tauri::{Runtime, WebviewWindow};

/// Preview image next to the pointer: the app icon (E5), never data from the frontend.
const ICON: &[u8] = include_bytes!("../../icons/32x32.png");

fn start_failed(detail: impl std::fmt::Display) -> FsError {
    FsError::new(
        FsErrorCode::Io,
        format!("The drag could not be started: {detail}"),
        None,
    )
}

/// Starts a system drag of `paths` from `window` (main thread only).
pub fn start<R: Runtime>(window: &WebviewWindow<R>, paths: Vec<PathBuf>) -> Result<(), FsError> {
    start_impl(window, paths)
}

#[cfg(any(target_os = "macos", windows))]
fn start_impl<R: Runtime>(window: &WebviewWindow<R>, paths: Vec<PathBuf>) -> Result<(), FsError> {
    drag::start_drag(
        window,
        drag::DragItem::Files(paths),
        drag::Image::Raw(ICON.to_vec()),
        |_result, _position| {},
        drag::Options {
            skip_animatation_on_cancel_or_failure: false,
            mode: drag::DragMode::Copy,
        },
    )
    .map_err(start_failed)
}

/// Own GTK code instead of the crate's: it builds `file://{path}` without
/// percent-encoding – spaces, `%`, `#` and non-UTF-8 names would break (E4).
#[cfg(target_os = "linux")]
fn start_impl<R: Runtime>(window: &WebviewWindow<R>, paths: Vec<PathBuf>) -> Result<(), FsError> {
    use gtk::gdk;
    use gtk::glib::object::ObjectExt;
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    let window = window.gtk_window().map_err(start_failed)?;
    let uris = file_uris(&paths);
    let targets = gtk::TargetList::new(&[]);
    targets.add_uri_targets(0);

    let data_handler = window.connect_drag_data_get(move |_, _, data, _, _| {
        let refs: Vec<&str> = uris.iter().map(String::as_str).collect();
        data.set_uris(&refs);
    });
    // both handlers go once the drag ends (dropped, cancelled or failed)
    let handlers = Rc::new(RefCell::new(vec![data_handler]));
    let end_handlers = handlers.clone();
    let end_handler = window.connect_drag_end(move |w, _| {
        for id in end_handlers.borrow_mut().drain(..) {
            w.disconnect(id);
        }
    });
    handlers.borrow_mut().push(end_handler);

    let Some(context) =
        window.drag_begin_with_coordinates(&targets, gdk::DragAction::COPY, 1, None, -1, -1)
    else {
        for id in handlers.borrow_mut().drain(..) {
            window.disconnect(id);
        }
        return Err(start_failed("no drag context"));
    };
    if let Some(icon) = icon_pixbuf() {
        context.drag_set_icon_pixbuf(&icon, 0, 0);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn icon_pixbuf() -> Option<gtk::gdk_pixbuf::Pixbuf> {
    use gtk::gdk_pixbuf::prelude::PixbufLoaderExt;
    let loader = gtk::gdk_pixbuf::PixbufLoader::new();
    loader.write(ICON).ok()?;
    loader.close().ok()?;
    loader.pixbuf()
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn start_impl<R: Runtime>(_window: &WebviewWindow<R>, _paths: Vec<PathBuf>) -> Result<(), FsError> {
    Err(start_failed("not supported on this platform"))
}

/// `text/uri-list` entries: percent-encoded `file://` URIs (bytes, not text).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn file_uris(paths: &[PathBuf]) -> Vec<String> {
    paths.iter().map(|p| super::desktop::file_uri(p)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uris_are_percent_encoded() {
        let got = file_uris(&[
            PathBuf::from("/tmp/a b/Grüße %41 #1?.txt"),
            PathBuf::from("/tmp/🎉"),
        ]);
        assert_eq!(
            got,
            vec![
                "file:///tmp/a%20b/Gr%C3%BC%C3%9Fe%20%2541%20%231%3F.txt".to_string(),
                "file:///tmp/%F0%9F%8E%89".to_string(),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_names_keep_their_bytes() {
        use std::os::unix::ffi::OsStrExt;
        let p = PathBuf::from(std::ffi::OsStr::from_bytes(b"/tmp/a\xff"));
        assert_eq!(file_uris(&[p]), vec!["file:///tmp/a%FF".to_string()]);
    }
}
