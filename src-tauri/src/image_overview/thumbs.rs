//! Thumbnails of the image overview on disk (design 074 E4).
//!
//! Sizes come in steps ([`STEPS`], longest side); one decode writes the three small steps
//! at once (scaled from the largest down), the large step 3 is made only when asked for.
//! Files live under `<app cache>/thumbs/<xx>/<key>.jpg`, the key hashes path, size,
//! modification time and step – a changed image gets a new file. The folder is kept below
//! a byte limit: on start and after every [`CLEAN_EVERY`] new files the oldest go.

use crate::error::{FsError, FsErrorCode};
use crate::images::{ImageKind, decode_upright};
use image::DynamicImage;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Longest side of each step in pixels.
pub const STEPS: [u32; 4] = [160, 320, 640, 2048];
/// Steps made together from one decode.
const SMALL_STEPS: usize = 3;
/// Default size limit of the cache folder.
pub const MAX_CACHE_BYTES: u64 = 1 << 30;
/// New files between two clean-ups.
pub const CLEAN_EVERY: u32 = 500;
const QUALITY: u8 = 80;

/// An image of an overview as Rust listed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source {
    pub path: PathBuf,
    pub size: u64,
    pub modified: Option<SystemTime>,
    pub kind: ImageKind,
}

fn fnv64(parts: &[&[u8]]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for b in *part {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        // separator, so ("ab", "c") ≠ ("a", "bc")
        h ^= 0xff;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn scaled(img: &DynamicImage, side: u32) -> DynamicImage {
    if img.width().max(img.height()) <= side {
        img.clone()
    } else {
        img.thumbnail(side, side)
    }
}

fn jpeg(img: &DynamicImage, path: &Path) -> Result<Vec<u8>, FsError> {
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, QUALITY)
        .encode_image(&img.to_rgb8())
        .map_err(|e| {
            FsError::new(
                FsErrorCode::UnsupportedImage,
                format!("No thumbnail ({e})"),
                Some(path),
            )
        })?;
    Ok(out)
}

/// The thumbnail folder.
pub struct Cache {
    dir: PathBuf,
    limit: u64,
    written: AtomicU32,
}

impl Cache {
    pub fn new(dir: PathBuf, limit: u64) -> Self {
        Cache {
            dir,
            limit,
            written: AtomicU32::new(0),
        }
    }

    /// Where the thumbnail of `src` in `step` lives.
    pub fn file_of(&self, src: &Source, step: usize) -> PathBuf {
        let nanos = src
            .modified
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_nanos());
        let key = fnv64(&[
            src.path.as_os_str().as_encoded_bytes(),
            &src.size.to_le_bytes(),
            &nanos.to_le_bytes(),
            &(step as u32).to_le_bytes(),
        ]);
        let hex = format!("{key:016x}");
        self.dir.join(&hex[..2]).join(format!("{hex}.jpg"))
    }

    /// The JPEG of `src` in `step` – from the folder or made now.
    pub fn get(&self, src: &Source, step: usize) -> Result<Vec<u8>, FsError> {
        let step = step.min(STEPS.len() - 1);
        if let Ok(bytes) = fs::read(self.file_of(src, step)) {
            return Ok(bytes);
        }
        let img = decode_upright(&src.path, src.kind)?;
        let mut wanted = Vec::new();
        let mut new_files = 0;
        if step >= SMALL_STEPS {
            wanted = jpeg(&scaled(&img, STEPS[step]), &src.path)?;
            new_files += u32::from(self.store(&self.file_of(src, step), &wanted));
        } else {
            // largest first, each smaller one from the one before (cheap)
            let mut current = img;
            for s in (0..SMALL_STEPS).rev() {
                current = scaled(&current, STEPS[s]);
                let file = self.file_of(src, s);
                if s != step && file.exists() {
                    continue;
                }
                let bytes = jpeg(&current, &src.path)?;
                new_files += u32::from(self.store(&file, &bytes));
                if s == step {
                    wanted = bytes;
                }
            }
        }
        if new_files > 0 {
            let before = self.written.fetch_add(new_files, Ordering::Relaxed);
            if before / CLEAN_EVERY != (before + new_files) / CLEAN_EVERY {
                self.clean();
            }
        }
        Ok(wanted)
    }

    /// Writes a file atomically; false if the cache folder cannot be written (the
    /// thumbnail is still shown, just not kept).
    fn store(&self, file: &Path, bytes: &[u8]) -> bool {
        let Some(dir) = file.parent() else {
            return false;
        };
        if fs::create_dir_all(dir).is_err() {
            return false;
        }
        let tmp = file.with_extension(format!("tmp{}", std::process::id()));
        let ok = fs::File::create(&tmp)
            .and_then(|mut f| f.write_all(bytes))
            .and_then(|()| fs::rename(&tmp, file))
            .is_ok();
        if !ok {
            let _ = fs::remove_file(&tmp);
        }
        ok
    }

    /// Removes the oldest files until the folder is below 90 % of its limit.
    pub fn clean(&self) {
        let Ok(subdirs) = fs::read_dir(&self.dir) else {
            return;
        };
        let mut files: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
        for sub in subdirs.flatten() {
            let Ok(entries) = fs::read_dir(sub.path()) else {
                continue;
            };
            for e in entries.flatten() {
                if let Ok(meta) = e.metadata()
                    && meta.is_file()
                {
                    let when = meta.modified().unwrap_or(UNIX_EPOCH);
                    files.push((when, meta.len(), e.path()));
                }
            }
        }
        let mut total: u64 = files.iter().map(|f| f.1).sum();
        if total <= self.limit {
            return;
        }
        let target = self.limit / 10 * 9;
        files.sort_by_key(|f| f.0);
        for (_, len, path) in files {
            if total <= target {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total -= len;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::duplicates::images::testimg::{jpeg as test_jpeg, photo};

    fn source(path: &Path) -> Source {
        let meta = fs::metadata(path).unwrap();
        Source {
            path: path.to_path_buf(),
            size: meta.len(),
            modified: meta.modified().ok(),
            kind: crate::images::kind_of(&path.file_name().unwrap().to_string_lossy()).unwrap(),
        }
    }

    #[test]
    fn steps_written_together_and_read_back() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("Foto ä 🙂.jpg");
        fs::write(&p, test_jpeg(&photo(1200, 800, 1), 90)).unwrap();
        let cache = Cache::new(d.path().join("thumbs"), MAX_CACHE_BYTES);
        let src = source(&p);
        let b = cache.get(&src, 1).unwrap();
        let img = image::load_from_memory(&b).unwrap();
        assert_eq!((img.width(), img.height()), (320, 214));
        for s in 0..3 {
            assert!(cache.file_of(&src, s).exists(), "step {s} written");
        }
        assert!(
            !cache.file_of(&src, 3).exists(),
            "the large step only on demand"
        );
        // a small image is never blown up
        let big = image::load_from_memory(&cache.get(&src, 3).unwrap()).unwrap();
        assert_eq!((big.width(), big.height()), (1200, 800));
        // from the folder: the same bytes, even after the source is gone
        fs::remove_file(&p).unwrap();
        assert_eq!(cache.get(&src, 1).unwrap(), b);
    }

    #[test]
    fn a_changed_image_gets_a_new_file() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.png");
        fs::write(
            &p,
            crate::duplicates::images::testimg::encode(&photo(50, 40, 2), image::ImageFormat::Png),
        )
        .unwrap();
        let cache = Cache::new(d.path().join("thumbs"), MAX_CACHE_BYTES);
        let a = source(&p);
        let mut b = a.clone();
        b.size += 1;
        assert_ne!(cache.file_of(&a, 0), cache.file_of(&b, 0));
        assert_ne!(cache.file_of(&a, 0), cache.file_of(&a, 1));
    }

    #[test]
    fn broken_and_unsupported_images_are_errors() {
        let d = tempfile::tempdir().unwrap();
        let cache = Cache::new(d.path().join("thumbs"), MAX_CACHE_BYTES);
        let p = d.path().join("kaputt.jpg");
        fs::write(&p, b"\xFF\xD8 not really a jpeg").unwrap();
        assert!(cache.get(&source(&p), 0).is_err());
        let h = d.path().join("x.heic");
        fs::write(&h, "x").unwrap();
        let e = cache.get(&source(&h), 0).unwrap_err();
        assert_eq!(e.code, FsErrorCode::UnsupportedImage);
    }

    #[test]
    fn clean_removes_the_oldest_down_to_ninety_percent() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("thumbs");
        let cache = Cache::new(dir.clone(), 1000);
        for (i, name) in ["aa/1.jpg", "aa/2.jpg", "bb/3.jpg", "cc/4.jpg"]
            .iter()
            .enumerate()
        {
            let f = dir.join(name);
            fs::create_dir_all(f.parent().unwrap()).unwrap();
            fs::write(&f, vec![0u8; 400]).unwrap();
            let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000 + i as u64);
            fs::File::options()
                .write(true)
                .open(&f)
                .unwrap()
                .set_modified(t)
                .unwrap();
        }
        cache.clean();
        assert!(!dir.join("aa/1.jpg").exists());
        assert!(!dir.join("aa/2.jpg").exists());
        // 1600 → 1200 → 800 ≤ 900: the two newest stay
        assert!(dir.join("bb/3.jpg").exists());
        assert!(dir.join("cc/4.jpg").exists());
    }
}
