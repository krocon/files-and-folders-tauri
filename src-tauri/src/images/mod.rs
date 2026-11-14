//! Image files for the image overview (design 074): which names count as images and how
//! a picture is decoded upright. The decoder itself with all limits stays in
//! [`crate::duplicates::images`] (design 042 E6) – both features share its permits.

pub mod raw;

use crate::duplicates::images as decode;
use crate::error::FsError;
use image::DynamicImage;
use std::path::Path;

pub use decode::{IMAGE_EXT, UNSUPPORTED_EXT, extension};

/// Camera raw formats (lower case): a preview JPEG is embedded (E7).
pub const RAW_EXT: &[&str] = &[
    "nef", "nrw", "cr2", "arw", "srf", "sr2", "dng", "orf", "rw2", "pef", "raf",
];

/// What the overview can make of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageKind {
    /// Decoded by the `image` crate.
    Image,
    /// Camera raw: the embedded preview JPEG (E7).
    Raw,
    /// An image we cannot decode (HEIC/AVIF): a placeholder tile, the large view may
    /// still show it (the WebView decodes it on macOS).
    Unsupported,
}

/// The kind of a file by its name, `None` = not an image.
pub fn kind_of(name: &str) -> Option<ImageKind> {
    let ext = extension(name)?;
    let ext = ext.as_str();
    if IMAGE_EXT.contains(&ext) {
        Some(ImageKind::Image)
    } else if RAW_EXT.contains(&ext) {
        Some(ImageKind::Raw)
    } else if UNSUPPORTED_EXT.contains(&ext) {
        Some(ImageKind::Unsupported)
    } else {
        None
    }
}

/// Decodes the picture behind `path` upright (EXIF orientation applied, E6) – for a raw
/// file its embedded preview.
pub fn decode_upright(path: &Path, kind: ImageKind) -> Result<DynamicImage, FsError> {
    match kind {
        ImageKind::Image => decode::decode_oriented(path),
        ImageKind::Raw => raw::decode_preview(path),
        ImageKind::Unsupported => Err(FsError::new(
            crate::error::FsErrorCode::UnsupportedImage,
            "This image format is not supported",
            Some(path),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_by_name() {
        assert_eq!(kind_of("a.JPG"), Some(ImageKind::Image));
        assert_eq!(kind_of("Ä b.webp"), Some(ImageKind::Image));
        assert_eq!(kind_of("_DSC1160.NEF"), Some(ImageKind::Raw));
        assert_eq!(kind_of("x.dng"), Some(ImageKind::Raw));
        assert_eq!(kind_of("IMG_1.HEIC"), Some(ImageKind::Unsupported));
        assert_eq!(kind_of("notes.txt"), None);
        assert_eq!(kind_of(".jpg"), None, "a dot name has no extension");
        assert_eq!(kind_of("jpg"), None);
    }
}
