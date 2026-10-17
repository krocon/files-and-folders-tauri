//! File preview for the viewer (F3) and the quick view (design 010 E2/E3).
//! Reads at most a bounded head of a file, never the whole thing; contents are
//! never logged. Images are not sent over IPC: `read_preview` registers a token
//! and the WebView fetches the bytes from the `fnfpreview` scheme ([`ImageTokens`]).

pub mod detect;
pub mod encoding;

use crate::error::{FsError, FsErrorCode};
use detect::Format;
use encoding::Encoding;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Bytes read to detect the type.
pub const HEAD_BYTES: usize = 8 * 1024;
pub const DEFAULT_TEXT_BYTES: u64 = 1024 * 1024;
pub const MIN_TEXT_BYTES: u64 = 4 * 1024;
pub const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;
pub const DEFAULT_HEX_BYTES: u64 = 4 * 1024;
pub const MAX_HEX_BYTES: u64 = 64 * 1024;
/// Largest image the scheme serves.
pub const MAX_IMAGE_BYTES: u64 = 256 * 1024 * 1024;
/// Image tokens kept (the oldest is dropped).
pub const MAX_TOKENS: usize = 16;
/// Name of the URI scheme for images.
pub const SCHEME: &str = "fnfpreview";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PreviewOptions {
    /// `None`/`"auto"` = detect.
    pub encoding: Option<String>,
    /// `None`/`"auto"`, `"text"` (show as text even if binary) or `"hex"`.
    pub mode: Option<String>,
    pub max_text_bytes: Option<u64>,
    pub hex_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
    #[serde(rename_all = "camelCase")]
    Text {
        size: u64,
        format: Format,
        encoding: &'static str,
        text: String,
        truncated: bool,
        lossy: bool,
        ext_mismatch: bool,
    },
    #[serde(rename_all = "camelCase")]
    Image {
        size: u64,
        format: Format,
        token: String,
        ext_mismatch: bool,
    },
    #[serde(rename_all = "camelCase")]
    Binary {
        size: u64,
        format: Format,
        bytes: Vec<u8>,
        truncated: bool,
        ext_mismatch: bool,
    },
    Directory,
    /// FIFO, socket, device – never opened (a read would block).
    Other,
}

fn extension(path: &Path) -> Option<&str> {
    path.extension().and_then(|e| e.to_str())
}

/// Opens a regular file for reading; never blocks on a FIFO swapped in after the check.
fn open_regular(path: &Path) -> Result<File, FsError> {
    let mut opts = fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NONBLOCK);
    }
    let file = opts.open(path).map_err(|e| FsError::from_io(&e, path))?;
    let meta = file.metadata().map_err(|e| FsError::from_io(&e, path))?;
    if !meta.is_file() {
        return Err(FsError::new(
            FsErrorCode::NotAFile,
            "Not a regular file",
            Some(path),
        ));
    }
    Ok(file)
}

/// Reads up to `limit` bytes (fewer at the end of the file).
fn read_up_to(file: &mut File, limit: u64, path: &Path) -> Result<Vec<u8>, FsError> {
    let mut buf = Vec::with_capacity(limit.min(MAX_TEXT_BYTES) as usize);
    file.take(limit)
        .read_to_end(&mut buf)
        .map_err(|e| FsError::from_io(&e, path))?;
    Ok(buf)
}

/// Preview of `path` (symlinks are followed). `register_image` returns the token
/// under which the image can be fetched.
pub fn read_preview(
    path: &Path,
    opts: &PreviewOptions,
    register_image: impl FnOnce(&Path) -> String,
) -> Result<Preview, FsError> {
    let meta = fs::metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    if meta.is_dir() {
        return Ok(Preview::Directory);
    }
    if !meta.is_file() {
        return Ok(Preview::Other);
    }
    let encoding = match opts.encoding.as_deref() {
        None | Some("auto") | Some("") => None,
        Some(id) => Some(Encoding::from_id(id).ok_or_else(|| {
            FsError::new(FsErrorCode::Io, format!("Unknown encoding: {id}"), None)
        })?),
    };
    let mode = opts.mode.as_deref().unwrap_or("auto");
    let text_limit = opts
        .max_text_bytes
        .unwrap_or(DEFAULT_TEXT_BYTES)
        .clamp(MIN_TEXT_BYTES, MAX_TEXT_BYTES);
    let hex_limit = opts
        .hex_bytes
        .unwrap_or(DEFAULT_HEX_BYTES)
        .clamp(16, MAX_HEX_BYTES);

    let mut file = open_regular(path)?;
    let size = meta.len();
    let mut data = read_up_to(&mut file, HEAD_BYTES as u64, path)?;
    let format = detect::classify(&data);
    let ext_mismatch = detect::ext_mismatch(&format, extension(path));

    let as_text = match mode {
        "text" => true,
        "hex" => false,
        _ => format.family == detect::Family::Text || format.id == "svg",
    };
    if mode == "auto" && format.displayable_image {
        return Ok(Preview::Image {
            size,
            format,
            token: register_image(path),
            ext_mismatch,
        });
    }
    if as_text {
        if (data.len() as u64) < text_limit && data.len() == HEAD_BYTES {
            let more = read_up_to(&mut file, text_limit - data.len() as u64, path)?;
            data.extend_from_slice(&more);
        }
        data.truncate(text_limit as usize);
        let truncated = (data.len() as u64) < size;
        let enc = encoding.unwrap_or_else(|| encoding::detect(&data, truncated));
        let (text, lossy) = encoding::decode(&data, enc, truncated);
        return Ok(Preview::Text {
            size,
            format,
            encoding: enc.id(),
            text,
            truncated,
            lossy,
            ext_mismatch,
        });
    }
    if (data.len() as u64) < hex_limit && data.len() == HEAD_BYTES {
        let more = read_up_to(&mut file, hex_limit - data.len() as u64, path)?;
        data.extend_from_slice(&more);
    }
    data.truncate(hex_limit as usize);
    Ok(Preview::Binary {
        size,
        format,
        truncated: (data.len() as u64) < size,
        bytes: data,
        ext_mismatch,
    })
}

// ---- images over the `fnfpreview` scheme (design 010 E3) ----

/// Token → path of images that `read_preview` recognised; at most [`MAX_TOKENS`].
#[derive(Debug, Default)]
pub struct ImageTokens {
    inner: Mutex<(u64, VecDeque<(String, PathBuf)>)>,
}

impl ImageTokens {
    pub fn issue(&self, path: &Path) -> String {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.0 += 1;
        let token = random_token(guard.0);
        guard.1.push_back((token.clone(), path.to_path_buf()));
        while guard.1.len() > MAX_TOKENS {
            guard.1.pop_front();
        }
        token
    }

    pub fn resolve(&self, token: &str) -> Option<PathBuf> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .1
            .iter()
            .find(|(t, _)| t == token)
            .map(|(_, p)| p.clone())
    }
}

/// 128 unpredictable bits without a crate: SipHash with the process' random keys.
fn random_token(counter: u64) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let part = |salt: u64| {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(counter);
        h.write_u128(nanos);
        h.write_u64(salt);
        h.finish()
    };
    format!("{:016x}{:016x}", part(1), part(2))
}

/// Bytes and MIME type of an image token; checks the file again (still a regular
/// file, within the limit, still an image by content).
pub fn serve_image(tokens: &ImageTokens, token: &str) -> Option<(Vec<u8>, &'static str)> {
    let path = tokens.resolve(token)?;
    let meta = fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let mut file = open_regular(&path).ok()?;
    let data = read_up_to(&mut file, MAX_IMAGE_BYTES, &path).ok()?;
    let format = detect::classify(&data[..data.len().min(HEAD_BYTES)]);
    if !format.displayable_image {
        return None;
    }
    Some((data, format.mime?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0";

    fn no_image(_: &Path) -> String {
        panic!("not an image")
    }

    fn opts() -> PreviewOptions {
        PreviewOptions::default()
    }

    #[test]
    fn text_with_umlauts_and_unicode_name() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("Brief ä 🎉.txt");
        fs::write(&p, "Grüße\nZeile 2").unwrap();
        match read_preview(&p, &opts(), no_image).unwrap() {
            Preview::Text {
                text,
                encoding,
                truncated,
                lossy,
                ext_mismatch,
                size,
                ..
            } => {
                assert_eq!(text, "Grüße\nZeile 2");
                assert_eq!(encoding, "utf-8");
                assert!(!truncated && !lossy && !ext_mismatch);
                assert_eq!(size, 15);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn huge_sparse_file_reads_only_the_limit() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("big.log");
        let f = File::create(&p).unwrap();
        fs::write(&p, "a".repeat(20_000)).unwrap();
        f.set_len(2 * 1024 * 1024 * 1024).unwrap(); // 2 GiB, the rest is NUL
        let o = PreviewOptions {
            max_text_bytes: Some(16 * 1024),
            ..opts()
        };
        match read_preview(&p, &o, no_image).unwrap() {
            Preview::Text {
                text,
                truncated,
                size,
                ..
            } => {
                assert_eq!(text.len(), 16 * 1024);
                assert!(truncated);
                assert_eq!(size, 2 * 1024 * 1024 * 1024);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn default_limit_is_one_mib_and_clamped() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("long.txt");
        fs::write(&p, "x".repeat(3 * 1024 * 1024)).unwrap();
        let len = |o: &PreviewOptions| match read_preview(&p, o, no_image).unwrap() {
            Preview::Text { text, .. } => text.len() as u64,
            other => panic!("{other:?}"),
        };
        assert_eq!(len(&opts()), DEFAULT_TEXT_BYTES);
        let tiny = PreviewOptions {
            max_text_bytes: Some(1),
            ..opts()
        };
        assert_eq!(len(&tiny), MIN_TEXT_BYTES);
    }

    #[test]
    fn binary_becomes_hex_of_the_first_kib() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("data.bin");
        let bytes: Vec<u8> = (0..20_000u32).map(|i| (i % 256) as u8).collect();
        fs::write(&p, &bytes).unwrap();
        match read_preview(&p, &opts(), no_image).unwrap() {
            Preview::Binary {
                bytes: b,
                truncated,
                format,
                ..
            } => {
                assert_eq!(b.len() as u64, DEFAULT_HEX_BYTES);
                assert_eq!(&b[..], &bytes[..b.len()]);
                assert!(truncated);
                assert_eq!(format.id, "binary");
            }
            other => panic!("{other:?}"),
        }
        // explicit hex view of a text file; text view of a binary file
        let t = dir.path().join("t.txt");
        fs::write(&t, "abc").unwrap();
        let hex = PreviewOptions {
            mode: Some("hex".into()),
            ..opts()
        };
        assert!(matches!(
            read_preview(&t, &hex, no_image).unwrap(),
            Preview::Binary {
                truncated: false,
                ..
            }
        ));
        let text = PreviewOptions {
            mode: Some("text".into()),
            ..opts()
        };
        assert!(matches!(
            read_preview(&p, &text, no_image).unwrap(),
            Preview::Text { .. }
        ));
    }

    #[test]
    fn png_named_txt_is_an_image_with_mismatch() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("bild.txt");
        fs::write(&p, PNG).unwrap();
        let tokens = ImageTokens::default();
        match read_preview(&p, &opts(), |p| tokens.issue(p)).unwrap() {
            Preview::Image {
                token,
                ext_mismatch,
                format,
                ..
            } => {
                assert!(ext_mismatch);
                assert_eq!(format.id, "png");
                let (bytes, mime) = serve_image(&tokens, &token).unwrap();
                assert_eq!(bytes, PNG);
                assert_eq!(mime, "image/png");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn encodings_utf16_and_1252() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("u16.txt");
        let mut b = vec![0xFF, 0xFE];
        for u in "Größe".encode_utf16() {
            b.extend_from_slice(&u.to_le_bytes());
        }
        fs::write(&p, &b).unwrap();
        assert!(matches!(
            read_preview(&p, &opts(), no_image).unwrap(),
            Preview::Text { ref text, encoding: "utf-16le", .. } if text == "Größe"
        ));
        let w = dir.path().join("1252.txt");
        fs::write(&w, [0x80, 0x20, 0xE4]).unwrap();
        assert!(matches!(
            read_preview(&w, &opts(), no_image).unwrap(),
            Preview::Text { ref text, encoding: "windows-1252", .. } if text == "€ ä"
        ));
        let forced = PreviewOptions {
            encoding: Some("latin-1".into()),
            ..opts()
        };
        assert!(matches!(
            read_preview(&w, &forced, no_image).unwrap(),
            Preview::Text {
                encoding: "latin-1",
                ..
            }
        ));
        let bad = PreviewOptions {
            encoding: Some("klingon".into()),
            ..opts()
        };
        assert_eq!(
            read_preview(&w, &bad, no_image).unwrap_err().code,
            FsErrorCode::Io
        );
    }

    #[test]
    fn empty_file_folder_missing() {
        let dir = tempdir().unwrap();
        let e = dir.path().join("leer.txt");
        fs::write(&e, "").unwrap();
        assert!(matches!(
            read_preview(&e, &opts(), no_image).unwrap(),
            Preview::Text { ref text, truncated: false, .. } if text.is_empty()
        ));
        assert_eq!(
            read_preview(dir.path(), &opts(), no_image).unwrap(),
            Preview::Directory
        );
        assert_eq!(
            read_preview(&dir.path().join("gone"), &opts(), no_image)
                .unwrap_err()
                .code,
            FsErrorCode::NotFound
        );
    }

    #[cfg(unix)]
    #[test]
    fn links_fifos() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("t.txt");
        fs::write(&target, "via link").unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(matches!(
            read_preview(&link, &opts(), no_image).unwrap(),
            Preview::Text { ref text, .. } if text == "via link"
        ));
        let dangling = dir.path().join("dangling");
        std::os::unix::fs::symlink(dir.path().join("nothing"), &dangling).unwrap();
        assert_eq!(
            read_preview(&dangling, &opts(), no_image).unwrap_err().code,
            FsErrorCode::NotFound
        );
        let fifo = dir.path().join("pipe");
        let c = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o644) }, 0);
        assert_eq!(
            read_preview(&fifo, &opts(), no_image).unwrap(),
            Preview::Other
        );
    }

    #[test]
    fn tokens_are_checked_again_and_limited() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.png");
        fs::write(&p, PNG).unwrap();
        let tokens = ImageTokens::default();
        let t = tokens.issue(&p);
        assert_eq!(t.len(), 32);
        assert!(serve_image(&tokens, &t).is_some());
        assert!(serve_image(&tokens, "0123").is_none());
        fs::write(&p, "now text").unwrap(); // swapped after the preview
        assert!(serve_image(&tokens, &t).is_none());
        let first = tokens.issue(&p);
        for _ in 0..MAX_TOKENS {
            assert_ne!(tokens.issue(&p), first);
        }
        assert!(tokens.resolve(&first).is_none());
    }

    #[test]
    fn options_wire_format() {
        let o: PreviewOptions =
            serde_json::from_str(r#"{"encoding":"utf-8","maxTextBytes":5000,"mode":"hex"}"#)
                .unwrap();
        assert_eq!(o.max_text_bytes, Some(5000));
        let json = serde_json::to_value(Preview::Directory).unwrap();
        assert_eq!(json["kind"], "directory");
    }
}
