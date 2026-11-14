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
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
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

/// A unique temp name next to `file` (review 074 #2: workers must not share one).
fn temp_name(file: &Path) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    file.with_extension(format!("tmp{}-{n}", std::process::id()))
}

/// A whole JPEG: starts with SOI, ends with EOI (a cut or empty file is a miss).
fn complete_jpeg(bytes: &[u8]) -> bool {
    bytes.len() > 4 && bytes.starts_with(&[0xFF, 0xD8]) && bytes.ends_with(&[0xFF, 0xD9])
}

/// Two lower-case hex digits: the names of the cache's subfolders.
fn is_bucket(name: &str) -> bool {
    name.len() == 2
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A file the cache wrote: `<16 hex>.jpg` or one of its temp files.
fn is_cache_file(name: &str) -> bool {
    let (stem, ext) = name.split_once('.').unwrap_or((name, ""));
    stem.len() == 16
        && stem.bytes().all(|b| b.is_ascii_hexdigit())
        && (ext == "jpg" || ext.starts_with("tmp"))
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

/// The JPEG of `src` in `step`, made now and not kept (no cache folder).
pub fn make(src: &Source, step: usize) -> Result<Vec<u8>, FsError> {
    let step = step.min(STEPS.len() - 1);
    let img = decode_upright(&src.path, src.kind)?;
    jpeg(&scaled(&img, STEPS[step]), &src.path)
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
        // SHA-256 (review 074): chosen file names cannot make two thumbnails collide
        let mut h = Sha256::new();
        let path = src.path.as_os_str().as_encoded_bytes();
        h.update((path.len() as u64).to_le_bytes());
        h.update(path);
        h.update(src.size.to_le_bytes());
        h.update(nanos.to_le_bytes());
        h.update((step as u32).to_le_bytes());
        let hex: String = h.finalize()[..8]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        self.dir.join(&hex[..2]).join(format!("{hex}.jpg"))
    }

    /// The JPEG of `src` in `step` – from the folder or made now.
    pub fn get(&self, src: &Source, step: usize) -> Result<Vec<u8>, FsError> {
        let step = step.min(STEPS.len() - 1);
        let file = self.file_of(src, step);
        if let Ok(bytes) = fs::read(&file) {
            if complete_jpeg(&bytes) {
                return Ok(bytes);
            }
            let _ = fs::remove_file(&file);
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
                if s != step && fs::read(&file).is_ok_and(|b| complete_jpeg(&b)) {
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
        let tmp = temp_name(file);
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
        // only our own `<xx>` folders (real folders, never links) and our own files (review 074 #3)
        for sub in subdirs.flatten() {
            let real_dir = sub.file_type().is_ok_and(|t| t.is_dir());
            if !real_dir || !is_bucket(&sub.file_name().to_string_lossy()) {
                continue;
            }
            let Ok(entries) = fs::read_dir(sub.path()) else {
                continue;
            };
            for e in entries.flatten() {
                if !is_cache_file(&e.file_name().to_string_lossy()) {
                    continue;
                }
                if let Ok(meta) = e.metadata() // DirEntry::metadata does not follow links
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
        for (i, name) in [
            "aa/0000000000000001.jpg",
            "aa/0000000000000002.jpg",
            "bb/0000000000000003.jpg",
            "cc/0000000000000004.jpg",
        ]
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
        assert!(!dir.join("aa/0000000000000001.jpg").exists());
        assert!(!dir.join("aa/0000000000000002.jpg").exists());
        // 1600 → 1200 → 800 ≤ 900: the two newest stay
        assert!(dir.join("bb/0000000000000003.jpg").exists());
        assert!(dir.join("cc/0000000000000004.jpg").exists());
    }

    #[test]
    fn a_broken_cache_file_is_a_miss() {
        // review 074 #2: a truncated or empty file must never be served (immutable in the WebView)
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.jpg");
        fs::write(&p, test_jpeg(&photo(400, 300, 4), 85)).unwrap();
        let cache = Cache::new(d.path().join("thumbs"), MAX_CACHE_BYTES);
        let src = source(&p);
        let good = cache.get(&src, 0).unwrap();
        fs::write(cache.file_of(&src, 0), b"").unwrap();
        assert_eq!(cache.get(&src, 0).unwrap(), good, "empty file: made again");
        fs::write(cache.file_of(&src, 0), &good[..good.len() / 2]).unwrap();
        assert_eq!(cache.get(&src, 0).unwrap(), good, "cut file: made again");
        assert_eq!(
            fs::read(cache.file_of(&src, 0)).unwrap(),
            good,
            "and stored again"
        );
    }

    #[test]
    fn temp_names_differ_per_write() {
        // review 074 #2: two workers writing the same thumbnail must not share a temp file
        let f = Path::new("/c/ab/abcd.jpg");
        assert_ne!(temp_name(f), temp_name(f));
    }

    #[cfg(unix)]
    #[test]
    fn clean_touches_only_its_own_files() {
        // review 074 #3: no links followed, only `<xx>/*.jpg` and temp files removed
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("thumbs");
        let outside = d.path().join("outside");
        fs::create_dir_all(dir.join("aa")).unwrap();
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("00000000000000aa.jpg"), vec![0u8; 900]).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("bb")).unwrap();
        fs::write(dir.join("notes/keep.jpg"), vec![0u8; 900]).unwrap();
        fs::write(dir.join("aa/readme.txt"), vec![0u8; 900]).unwrap();
        fs::write(dir.join("aa/0000000000000001.jpg"), vec![0u8; 900]).unwrap();
        Cache::new(dir.clone(), 100).clean();
        assert!(outside.join("00000000000000aa.jpg").exists());
        assert!(dir.join("notes/keep.jpg").exists());
        assert!(dir.join("aa/readme.txt").exists());
        assert!(!dir.join("aa/0000000000000001.jpg").exists());
    }
}
