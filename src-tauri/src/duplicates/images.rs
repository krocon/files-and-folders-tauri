//! Decoding images for the similar-image search and the thumbnails (design 042 E6).
//!
//! Foreign images are hostile: the file is at most [`MAX_BYTES`], the header is read
//! first and images over [`MAX_SIDE`] px or [`MAX_PIXELS`] are refused **before** any
//! pixel is decoded; the decoder runs with `image::Limits` and inside `catch_unwind`.
//! A broken image is an error for that file only – the search goes on.

use super::phash;
use crate::error::{FsError, FsErrorCode};
use crate::platform::open_regular_file;
use image::{DynamicImage, ImageReader, Limits, imageops::FilterType};
use std::io::{Cursor, Read};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::sync::{Condvar, Mutex, OnceLock};

/// Extensions the search looks at (lower case). The format itself is guessed from the bytes.
pub const IMAGE_EXT: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "bmp", "tif", "tiff",
];
/// Images we cannot decode without a system library – counted, not read.
pub const UNSUPPORTED_EXT: &[&str] = &["heic", "heif", "avif"];

/// Largest image file read.
pub const MAX_BYTES: u64 = crate::preview::MAX_IMAGE_BYTES;
/// Longest side accepted.
pub const MAX_SIDE: u32 = 16_384;
/// Most pixels accepted (≈ 64 MP: a 61-MP camera fits; RGBA ≤ 256 MiB).
pub const MAX_PIXELS: u64 = 64_000_000;
/// What a decoder may allocate.
pub const MAX_ALLOC: u64 = 320 << 20;

/// Fingerprint of an image: size in pixels and its pHash.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageFp {
    pub width: u32,
    pub height: u32,
    pub hash: u64,
}

/// Lower-case extension of a file name, without the dot.
pub fn extension(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    (!stem.is_empty()).then(|| ext.to_lowercase())
}

pub fn is_image_name(name: &str) -> bool {
    extension(name).is_some_and(|e| IMAGE_EXT.contains(&e.as_str()))
}

pub fn is_unsupported_image_name(name: &str) -> bool {
    extension(name).is_some_and(|e| UNSUPPORTED_EXT.contains(&e.as_str()))
}

fn bad(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::UnsupportedImage, message, Some(path))
}

fn limits() -> Limits {
    let mut l = Limits::default();
    l.max_image_width = Some(MAX_SIDE);
    l.max_image_height = Some(MAX_SIDE);
    l.max_alloc = Some(MAX_ALLOC);
    l
}

/// Reads the file (bounded) – regular files only, no devices or FIFOs.
fn read_file(path: &Path) -> Result<Vec<u8>, FsError> {
    let mut f = open_regular_file(path).map_err(|e| FsError::from_io(&e, path))?;
    let len = f.metadata().map_err(|e| FsError::from_io(&e, path))?.len();
    if len > MAX_BYTES {
        return Err(bad(
            format!("The image is too large (over {} MiB)", MAX_BYTES >> 20),
            path,
        ));
    }
    let mut data = Vec::with_capacity(len as usize);
    f.by_ref()
        .take(MAX_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| FsError::from_io(&e, path))?;
    if data.len() as u64 > MAX_BYTES {
        return Err(bad("The image grew while it was read", path));
    }
    Ok(data)
}

/// Decodes bytes of an image with all limits (`path` only for the messages).
pub fn decode_bytes(data: &[u8], path: &Path) -> Result<DynamicImage, FsError> {
    let reader = || -> Result<ImageReader<Cursor<&[u8]>>, FsError> {
        let mut r = ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| FsError::from_io(&e, path))?;
        if r.format().is_none() {
            return Err(bad("Not an image format that can be read", path));
        }
        r.limits(limits());
        Ok(r)
    };
    let outcome = catch_unwind(AssertUnwindSafe(|| -> Result<DynamicImage, FsError> {
        let (w, h) = reader()?
            .into_dimensions()
            .map_err(|e| bad(format!("The image cannot be read ({e})"), path))?;
        if w == 0 || h == 0 {
            return Err(bad("The image is empty", path));
        }
        if w > MAX_SIDE || h > MAX_SIDE || u64::from(w) * u64::from(h) > MAX_PIXELS {
            return Err(bad(
                format!("The image is too large ({w} × {h} pixels)"),
                path,
            ));
        }
        reader()?
            .decode()
            .map_err(|e| bad(format!("The image cannot be read ({e})"), path))
    }));
    outcome.unwrap_or_else(|_| Err(bad("The image cannot be read (decoder failure)", path)))
}

/// At most this many images are read and decoded at once in the whole app – search
/// workers and thumbnails share it (review 042 #4: each may hold the file and the
/// decoder's allocation).
pub const MAX_DECODES: usize = 4;

struct Permits {
    used: Mutex<usize>,
    freed: Condvar,
}

fn permits() -> &'static Permits {
    static P: OnceLock<Permits> = OnceLock::new();
    P.get_or_init(|| Permits {
        used: Mutex::new(0),
        freed: Condvar::new(),
    })
}

struct Permit;

impl Permit {
    fn take() -> Permit {
        let p = permits();
        let mut used = p.used.lock().unwrap_or_else(|e| e.into_inner());
        while *used >= MAX_DECODES {
            used = p.freed.wait(used).unwrap_or_else(|e| e.into_inner());
        }
        *used += 1;
        Permit
    }
}

impl Drop for Permit {
    fn drop(&mut self) {
        let p = permits();
        let mut used = p.used.lock().unwrap_or_else(|e| e.into_inner());
        *used -= 1;
        p.freed.notify_one();
    }
}

/// Decodes the image file at `path` with all limits.
pub fn decode(path: &Path) -> Result<DynamicImage, FsError> {
    let _permit = Permit::take();
    decode_bytes(&read_file(path)?, path)
}

/// Grey values vary less than this (standard deviation of the 32 × 32 image): the picture
/// is (almost) one colour – its pHash is noise and would match every other flat picture
/// (review 042 #2).
pub const MIN_CONTRAST: f64 = 3.0;

/// pHash of a decoded image.
pub fn phash_of(img: &DynamicImage) -> u64 {
    phash_and_contrast(img).0
}

/// pHash and the contrast (standard deviation of the grey values) of a decoded image.
pub fn phash_and_contrast(img: &DynamicImage) -> (u64, f64) {
    // a cheap reduction first (big photos), then a proper filter down to 32 × 32
    let small = if img.width() > 512 || img.height() > 512 {
        img.thumbnail(256, 256)
    } else {
        img.clone()
    };
    let grey = image::imageops::resize(
        &small.to_luma8(),
        phash::SIDE as u32,
        phash::SIDE as u32,
        FilterType::Triangle,
    );
    let px = grey.as_raw();
    let n = px.len() as f64;
    let mean = px.iter().map(|&v| f64::from(v)).sum::<f64>() / n;
    let var = px
        .iter()
        .map(|&v| (f64::from(v) - mean).powi(2))
        .sum::<f64>()
        / n;
    (phash::phash_of_grey(px), var.sqrt())
}

/// Fingerprint of the image file at `path` – any picture (comic pages may be blank).
pub fn fingerprint(path: &Path) -> Result<ImageFp, FsError> {
    fingerprint_with(path, false)
}

/// Fingerprint of a photo for the similar-image search: flat pictures (one colour, blank
/// scans) are refused – they would all look alike.
pub fn photo_fingerprint(path: &Path) -> Result<ImageFp, FsError> {
    fingerprint_with(path, true)
}

fn fingerprint_with(path: &Path, need_contrast: bool) -> Result<ImageFp, FsError> {
    let img = decode(path)?;
    let (hash, contrast) = phash_and_contrast(&img);
    if need_contrast && contrast < MIN_CONTRAST {
        return Err(bad(
            "The image is (almost) one colour – it cannot be compared by its look",
            path,
        ));
    }
    Ok(ImageFp {
        width: img.width(),
        height: img.height(),
        hash,
    })
}

/// Distance of two image fingerprints, `None` if their shapes differ (crop, rotation).
pub fn distance(a: &ImageFp, b: &ImageFp) -> Option<u32> {
    if phash::aspect_differs((a.width, a.height), (b.width, b.height)) {
        return None;
    }
    Some(phash::hamming(a.hash, b.hash))
}

#[cfg(test)]
pub(crate) mod testimg {
    //! Generated test pictures: a smooth "photo" (gradients, discs, a stripe).
    use image::{ImageBuffer, ImageFormat, Rgb, RgbImage};
    use std::io::Cursor;

    pub fn photo(w: u32, h: u32, variant: u32) -> RgbImage {
        ImageBuffer::from_fn(w, h, |x, y| {
            let (fx, fy) = (f64::from(x) / f64::from(w), f64::from(y) / f64::from(h));
            let v = f64::from(variant);
            let (cx, cy) = (
                0.3 + 0.4 * ((v * 0.7).sin() * 0.5 + 0.5),
                0.35 + 0.1 * v.cos(),
            );
            let d = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
            let disc = if d < 0.18 { 110.0 } else { 0.0 };
            let stripe = if (fx * (3.0 + v)).fract() < 0.2 {
                40.0
            } else {
                0.0
            };
            let r = 40.0 + 150.0 * fx + disc;
            let g = 30.0 + 120.0 * fy + stripe;
            let b = 90.0 + 60.0 * (1.0 - fx) * fy + disc / 2.0;
            Rgb([r.min(255.0) as u8, g.min(255.0) as u8, b.min(255.0) as u8])
        })
    }

    pub fn jpeg(img: &RgbImage, quality: u8) -> Vec<u8> {
        let mut out = Vec::new();
        let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
        img.write_with_encoder(enc).unwrap();
        out
    }

    pub fn encode(img: &RgbImage, format: ImageFormat) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, format).unwrap();
        out.into_inner()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::testimg::*;
    use super::*;
    use image::ImageFormat;
    use std::fs;

    /// A tiny PNG whose header claims `w` × `h` pixels (IHDR CRC fixed up).
    pub(crate) fn png_claiming(w: u32, h: u32) -> Vec<u8> {
        let mut png = encode(&photo(4, 4, 1), ImageFormat::Png);
        png[16..20].copy_from_slice(&w.to_be_bytes());
        png[20..24].copy_from_slice(&h.to_be_bytes());
        let crc = crc32fast::hash(&png[12..29]);
        png[29..33].copy_from_slice(&crc.to_be_bytes());
        png
    }

    fn fp(dir: &Path, name: &str, data: &[u8]) -> Result<ImageFp, FsError> {
        let p = dir.join(name);
        fs::write(&p, data).unwrap();
        fingerprint(&p)
    }

    #[test]
    fn same_photo_in_other_quality_and_size_is_close() {
        let d = tempfile::tempdir().unwrap();
        let big = photo(1200, 900, 1);
        let a = fp(d.path(), "a ä.jpg", &jpeg(&big, 95)).unwrap();
        assert_eq!((a.width, a.height), (1200, 900));
        let low = fp(d.path(), "low.jpg", &jpeg(&big, 35)).unwrap();
        let small_img = image::imageops::resize(&big, 600, 450, FilterType::Lanczos3);
        let small = fp(d.path(), "small.png", &encode(&small_img, ImageFormat::Png)).unwrap();
        let webp = fp(d.path(), "w.webp", &encode(&big, ImageFormat::WebP)).unwrap();
        let bmp = fp(d.path(), "b.bmp", &encode(&small_img, ImageFormat::Bmp)).unwrap();
        let tif = fp(d.path(), "t.tiff", &encode(&small_img, ImageFormat::Tiff)).unwrap();
        let gif = fp(d.path(), "g.gif", &encode(&small_img, ImageFormat::Gif)).unwrap();
        for (name, other) in [
            ("q35", low),
            ("50 %", small),
            ("webp", webp),
            ("bmp", bmp),
            ("tiff", tif),
            ("gif", gif),
        ] {
            let dist = distance(&a, &other).unwrap();
            assert!(dist <= 6, "{name}: {dist}");
        }
        // another photo: far
        let other = fp(d.path(), "o.jpg", &jpeg(&photo(1200, 900, 4), 95)).unwrap();
        assert!(
            distance(&a, &other).unwrap() > 12,
            "{:?}",
            distance(&a, &other)
        );
        // mirrored: not the same
        let flipped = image::imageops::flip_horizontal(&big);
        let m = fp(d.path(), "m.jpg", &jpeg(&flipped, 95)).unwrap();
        assert!(distance(&a, &m).unwrap() > 8, "{:?}", distance(&a, &m));
        // rotated: other shape
        let rot = image::imageops::rotate90(&big);
        let r = fp(d.path(), "r.jpg", &jpeg(&rot, 95)).unwrap();
        assert_eq!(distance(&a, &r), None);
    }

    #[test]
    fn hostile_images_are_errors_not_crashes() {
        let d = tempfile::tempdir().unwrap();
        let code = |name: &str, data: &[u8]| fp(d.path(), name, data).unwrap_err().code;
        assert_eq!(code("empty.jpg", b""), FsErrorCode::UnsupportedImage);
        assert_eq!(
            code("text.jpg", b"hello, not an image"),
            FsErrorCode::UnsupportedImage
        );
        let good = jpeg(&photo(300, 200, 2), 90);
        // a cut JPEG: the decoder fills the rest (grey) – fine, as long as nothing crashes
        let _ = fp(d.path(), "cut.jpg", &good[..good.len() / 3]);
        let png = encode(&photo(300, 200, 2), ImageFormat::Png);
        assert_eq!(
            code("cut.png", &png[..png.len() / 3]),
            FsErrorCode::UnsupportedImage
        );
        // a PNG header (valid CRC) claiming 100 000 × 100 000 pixels: refused before decoding
        let e = fp(d.path(), "huge.png", &png_claiming(100_000, 100_000)).unwrap_err();
        assert_eq!(e.code, FsErrorCode::UnsupportedImage);
        // 9000 × 9000 = 81 MP: within the side limit, over the pixel limit
        let e = fp(d.path(), "81mp.png", &png_claiming(9_000, 9_000)).unwrap_err();
        assert!(e.message.contains("too large"), "{}", e.message);
        // a GIF with a giant logical screen
        let mut gif = encode(&photo(4, 4, 1), ImageFormat::Gif);
        gif[6..8].copy_from_slice(&65_535u16.to_le_bytes());
        gif[8..10].copy_from_slice(&65_535u16.to_le_bytes());
        assert!(fp(d.path(), "screen.gif", &gif).is_err());
        // a folder, a missing file
        fs::create_dir(d.path().join("dir.jpg")).unwrap();
        assert!(fingerprint(&d.path().join("dir.jpg")).is_err());
        assert_eq!(
            fingerprint(&d.path().join("missing.jpg")).unwrap_err().code,
            FsErrorCode::NotFound
        );
    }

    /// Review 042 #2: flat pictures get no fingerprint in the photo search.
    #[test]
    fn flat_images_are_not_compared() {
        let d = tempfile::tempdir().unwrap();
        let black = image::RgbImage::from_pixel(400, 300, image::Rgb([0, 0, 0]));
        let white = image::RgbImage::from_pixel(400, 300, image::Rgb([250, 250, 250]));
        for (name, img) in [("black.png", &black), ("white.png", &white)] {
            let p = d.path().join(name);
            fs::write(&p, encode(img, ImageFormat::Png)).unwrap();
            let e = photo_fingerprint(&p).unwrap_err();
            assert!(e.message.contains("one colour"), "{}", e.message);
            assert!(fingerprint(&p).is_ok(), "comic pages may be blank");
        }
        let p = d.path().join("photo.jpg");
        fs::write(&p, jpeg(&photo(400, 300, 1), 90)).unwrap();
        assert!(photo_fingerprint(&p).is_ok());
    }

    #[test]
    fn too_big_files_are_not_read() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("big.jpg");
        fs::File::create(&p)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert!(fingerprint(&p).unwrap_err().message.contains("too large"));
    }

    #[test]
    fn names() {
        assert!(is_image_name("IMG_1.JPG") && is_image_name("a.b.webp"));
        assert!(!is_image_name(".jpg") && !is_image_name("x.txt") && !is_image_name("jpg"));
        assert!(is_unsupported_image_name("IMG_1.HEIC") && !is_unsupported_image_name("a.png"));
    }
}
