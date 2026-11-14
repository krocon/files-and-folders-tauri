//! Commands of the image overview (design 074): open (images stream over the channel)
//! and close. Thumbnails come over the `fnfthumb` scheme ([`thumb_response`]).

use crate::error::{FsError, FsErrorCode};
use crate::image_overview::{self, Answer, OverviewEvent};
use crate::paths::validate_input_path;
use tauri::ipc::Channel;

/// Opens an overview of the images in `root` (with `recursive` also below it) and returns
/// its id at once – the images and the end come as events.
#[tauri::command]
pub async fn image_overview_open(
    root: String,
    recursive: bool,
    on_event: Channel<OverviewEvent>,
) -> Result<String, FsError> {
    // servers and archives are not in this step (design 074 E17)
    if crate::remote::is_remote(&root) {
        return Err(FsError::new(
            FsErrorCode::RemoteUnsupported,
            "The image overview works on local folders only",
            None,
        ));
    }
    let root = validate_input_path(&root)?;
    let id = image_overview::register();
    let fill_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |e: OverviewEvent| {
            let _ = on_event.send(e);
        };
        if let Err(err) = image_overview::fill(&fill_id, &root, recursive, &emit) {
            // the folder itself could not be read: the end carries the error
            emit(OverviewEvent::Done {
                truncated: false,
                unreadable: vec![err],
                unreadable_more: 0,
            });
            image_overview::close(&fill_id);
        }
    });
    Ok(id)
}

/// Closes an overview: collecting stops, its thumbnails are no longer served.
#[tauri::command]
pub async fn image_overview_close(id: String) -> Result<(), FsError> {
    image_overview::close(&id);
    Ok(())
}

/// Answer of the `fnfthumb` scheme for one thumbnail.
pub fn thumb_response(answer: &Answer) -> tauri::http::Response<Vec<u8>> {
    let builder = tauri::http::Response::builder().header("X-Content-Type-Options", "nosniff");
    match answer.as_ref() {
        Ok(bytes) => builder
            .status(200)
            .header("Content-Type", "image/jpeg")
            // the URL carries `?v=<mtime>`: a changed image has another URL
            .header("Cache-Control", "max-age=31536000, immutable")
            .body(bytes.clone()),
        Err(status) => builder
            .status(*status)
            .header("Cache-Control", "no-store")
            .body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}
