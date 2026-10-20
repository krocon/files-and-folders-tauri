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

/// Starts a system drag of `paths` from `window` (main thread only) – only
/// while the primary mouse button is held (design 028 E2, review #1): a drag
/// started after the release would drop at once (Windows) or stick to the
/// pointer, and no code path may start one without the user's gesture.
pub fn start<R: Runtime>(window: &WebviewWindow<R>, paths: Vec<PathBuf>) -> Result<(), FsError> {
    if !primary_button_held(window) {
        return Err(FsError::new(
            FsErrorCode::DragNotHeld,
            "No mouse button is held – the drag was not started",
            None,
        ));
    }
    start_impl(window, paths)
}

#[cfg(windows)]
fn primary_button_held<R: Runtime>(_window: &WebviewWindow<R>) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};
    // SAFETY: plain Win32 queries without pointers
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let key = if swapped { VK_RBUTTON } else { VK_LBUTTON };
    (unsafe { GetAsyncKeyState(i32::from(key)) } as u16 & 0x8000) != 0
}

#[cfg(target_os = "macos")]
fn primary_button_held<R: Runtime>(_window: &WebviewWindow<R>) -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
    }
    // kCGEventSourceStateCombinedSessionState = 0, kCGMouseButtonLeft = 0
    // SAFETY: a plain query without pointers
    unsafe { CGEventSourceButtonState(0, 0) }
}

#[cfg(target_os = "linux")]
fn primary_button_held<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    use gtk::prelude::*;
    let Ok(gtk_window) = window.gtk_window() else {
        return false;
    };
    let (Some(gdk_window), Some(pointer)) = (
        gtk_window.window(),
        gtk_window
            .display()
            .default_seat()
            .and_then(|s| s.pointer()),
    ) else {
        return false;
    };
    let (_, _, _, mask) = gdk_window.device_position(&pointer);
    mask.contains(gtk::gdk::ModifierType::BUTTON1_MASK)
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn primary_button_held<R: Runtime>(_window: &WebviewWindow<R>) -> bool {
    false
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

    // one drag at a time: a second one would add a second `drag-data-get` (review #4)
    if DRAGGING.get() {
        return Err(start_failed("another drag is still running"));
    }
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
        DRAGGING.set(false);
        release_button_in_webview(w);
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
    DRAGGING.set(true);
    if let Some(icon) = icon_pixbuf() {
        context.drag_set_icon_pixbuf(&icon, 0, 0);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
thread_local! {
    /// A GTK drag of ours runs (main thread only).
    static DRAGGING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// WebKitGTK never sees the release of the button that started the drag –
/// the drag took the pointer. Without one, it swallows the next click
/// (review 028 #3, reproduced under Xvfb). A synthetic release ends its press.
#[cfg(target_os = "linux")]
fn release_button_in_webview(window: &gtk::ApplicationWindow) {
    use gtk::glib::translate::{ToGlibPtr, ToGlibPtrMut};
    use gtk::prelude::*;

    fn find_webview(widget: &gtk::Widget) -> Option<gtk::Widget> {
        if widget.type_().name().contains("WebView") {
            return Some(widget.clone());
        }
        let container = widget.downcast_ref::<gtk::Container>()?;
        container.children().iter().find_map(find_webview)
    }
    let Some(webview) = find_webview(window.upcast_ref()) else {
        return;
    };
    let (Some(gdk_window), Some(pointer)) = (
        webview.window(),
        webview.display().default_seat().and_then(|s| s.pointer()),
    ) else {
        return;
    };
    let (_, x, y, mask) = gdk_window.device_position(&pointer);
    let mut event = gtk::gdk::Event::new(gtk::gdk::EventType::ButtonRelease);
    // SAFETY: a fresh GdkEventButton; `window` takes a reference that the
    // event frees with itself
    unsafe {
        let raw: *mut gtk::gdk::ffi::GdkEvent = event.to_glib_none_mut().0;
        let button = raw as *mut gtk::gdk::ffi::GdkEventButton;
        (*button).window = gdk_window.to_glib_full();
        (*button).send_event = 1;
        (*button).time = gtk::current_event_time();
        (*button).x = f64::from(x);
        (*button).y = f64::from(y);
        (*button).state = mask.bits() | gtk::gdk::ffi::GDK_BUTTON1_MASK;
        (*button).button = 1;
    }
    event.set_device(Some(&pointer));
    webview.event(&event);
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
