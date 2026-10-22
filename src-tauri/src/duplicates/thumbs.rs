//! Thumbnails for the duplicate group view and the delete confirmation (design 042 E6.5).
//!
//! The image (for a comic: its title page) is decoded with the limits of [`images`],
//! scaled to at most `max_px` and kept as JPEG in memory; the WebView fetches it from
//! the `fnfpreview` scheme with a token `t<32 hex>`. At most [`MAX_THUMBS`] thumbnails /
//! [`MAX_THUMB_BYTES`] are kept (oldest go first). A thumbnail reads no more than the
//! preview of the same file would (`read_preview` accepts any file the user names).

use super::{comic, images};
use crate::error::FsError;
use crate::jobs::Control;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::SystemTime;

pub const MAX_THUMBS: usize = 256;
pub const MAX_THUMB_BYTES: usize = 32 << 20;
pub const MIN_PX: u32 = 32;
pub const MAX_PX: u32 = 256;
/// Paths per `duplicate_thumbnails` call.
pub const MAX_PATHS: usize = 24;

type Key = (PathBuf, u64, Option<SystemTime>, u32);

#[derive(Default)]
struct Store {
    items: VecDeque<(String, Key, Vec<u8>)>,
    bytes: usize,
    counter: u64,
}

fn lock() -> MutexGuard<'static, Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE
        .get_or_init(|| Mutex::new(Store::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// `t` + 32 hex digits.
pub fn is_token(token: &str) -> bool {
    token.len() == 33 && token.starts_with('t') && token[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// The JPEG of a thumbnail token.
pub fn serve(token: &str) -> Option<Vec<u8>> {
    if !is_token(token) {
        return None;
    }
    lock()
        .items
        .iter()
        .find(|(t, _, _)| t == token)
        .map(|(_, _, b)| b.clone())
}

fn key_of(path: &Path, max_px: u32) -> Result<Key, FsError> {
    let meta = std::fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    Ok((path.to_path_buf(), meta.len(), meta.modified().ok(), max_px))
}

/// Decodes the picture behind `path` (a comic's title page).
fn picture(path: &Path) -> Result<image::DynamicImage, FsError> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !comic::is_comic_name(&name) {
        return images::decode(path);
    }
    let index = crate::archive::index_of(path)?;
    let pages = comic::pages(&index);
    let first = pages
        .first()
        .ok_or_else(|| crate::archive::archive_error("No pages (images) in the comic", path))?;
    let (dir, file) = comic::extract_page(path, first, &Control::default())?;
    let img = images::decode(&file);
    let _ = crate::archive::view::remove_tree(&dir);
    img
}

/// A token for the thumbnail of `path` (made now or found in the store).
pub fn thumbnail(path: &Path, max_px: u32) -> Result<String, FsError> {
    let max_px = max_px.clamp(MIN_PX, MAX_PX);
    let key = key_of(path, max_px)?;
    {
        let mut s = lock();
        if let Some(i) = s.items.iter().position(|(_, k, _)| *k == key) {
            let item = s.items.remove(i).expect("position is valid");
            let token = item.0.clone();
            s.items.push_back(item);
            return Ok(token);
        }
    }
    let img = picture(path)?.thumbnail(max_px, max_px).to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80)
        .encode_image(&img)
        .map_err(|e| {
            FsError::new(
                crate::error::FsErrorCode::UnsupportedImage,
                format!("No thumbnail ({e})"),
                Some(path),
            )
        })?;
    let mut s = lock();
    s.counter += 1;
    let token = format!("t{}", crate::preview::random_token(s.counter));
    s.bytes += jpeg.len();
    s.items.push_back((token.clone(), key, jpeg));
    while s.items.len() > MAX_THUMBS || (s.bytes > MAX_THUMB_BYTES && s.items.len() > 1) {
        if let Some((_, _, b)) = s.items.pop_front() {
            s.bytes -= b.len();
        }
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::super::images::testimg::{jpeg, photo};
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn thumbnails_of_images_and_comics() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("Foto ä.jpg");
        fs::write(&p, jpeg(&photo(800, 600, 3), 90)).unwrap();
        let t = thumbnail(&p, 128).unwrap();
        assert!(is_token(&t));
        assert_eq!(thumbnail(&p, 128).unwrap(), t, "found in the store");
        let bytes = serve(&t).unwrap();
        let img = image::load_from_memory(&bytes).unwrap();
        assert_eq!((img.width(), img.height()), (128, 96));
        // a comic: its title page
        let c = d.path().join("Heft.cbz");
        let mut w = zip::ZipWriter::new(fs::File::create(&c).unwrap());
        for i in [2, 1] {
            w.start_file(
                format!("p{i}.jpg"),
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            w.write_all(&jpeg(&photo(200, 300, i), 80)).unwrap();
        }
        w.finish().unwrap();
        let img = image::load_from_memory(&serve(&thumbnail(&c, 64).unwrap()).unwrap()).unwrap();
        assert_eq!(img.height(), 64);
        // not an image, unknown tokens
        let txt = d.path().join("a.txt");
        fs::write(&txt, "hallo").unwrap();
        assert!(thumbnail(&txt, 64).is_err());
        assert_eq!(serve("t0123"), None);
        assert_eq!(serve(&format!("x{}", &t[1..])), None);
    }
}
