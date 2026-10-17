//! File type detection by content (magic bytes) – the extension is only a hint
//! for "the name says something else" (design 010 E2).

use super::encoding;
use serde::Serialize;

/// Broad family of a format; used to compare content and extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Family {
    Text,
    Image,
    Archive,
    Document,
    Media,
    Program,
    Data,
    Binary,
}

/// Detected format (`id` is stable, `label` for the user).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub id: &'static str,
    pub label: &'static str,
    pub mime: Option<&'static str>,
    pub family: Family,
    /// The WebView can show it in an `<img>`.
    pub displayable_image: bool,
}

const fn f(id: &'static str, label: &'static str, mime: &'static str, family: Family) -> Format {
    Format {
        id,
        label,
        mime: Some(mime),
        family,
        displayable_image: false,
    }
}

const fn img(id: &'static str, label: &'static str, mime: &'static str) -> Format {
    Format {
        id,
        label,
        mime: Some(mime),
        family: Family::Image,
        displayable_image: true,
    }
}

pub const TEXT: Format = f("text", "Text", "text/plain", Family::Text);
pub const BINARY: Format = Format {
    id: "binary",
    label: "Binary data",
    mime: None,
    family: Family::Binary,
    displayable_image: false,
};
pub const SVG: Format = img("svg", "SVG image", "image/svg+xml");

/// Format by magic bytes, `None` = no known signature.
pub fn sniff(h: &[u8]) -> Option<Format> {
    let at = |off: usize, sig: &[u8]| h.len() >= off + sig.len() && &h[off..off + sig.len()] == sig;
    let format = if at(0, b"\x89PNG\r\n\x1a\n") {
        img("png", "PNG image", "image/png")
    } else if at(0, &[0xFF, 0xD8, 0xFF]) {
        img("jpeg", "JPEG image", "image/jpeg")
    } else if at(0, b"GIF87a") || at(0, b"GIF89a") {
        img("gif", "GIF image", "image/gif")
    } else if at(0, b"RIFF") && at(8, b"WEBP") {
        img("webp", "WebP image", "image/webp")
    } else if at(0, b"RIFF") && at(8, b"WAVE") {
        f("wav", "WAV audio", "audio/wav", Family::Media)
    } else if at(0, b"BM") && h.len() >= 26 && h[6..10] == [0, 0, 0, 0] {
        img("bmp", "BMP image", "image/bmp")
    } else if at(0, &[0, 0, 1, 0]) && h.len() >= 6 && (h[4] != 0 || h[5] != 0) {
        img("ico", "Icon", "image/x-icon")
    } else if at(4, b"ftyp") && h.len() >= 12 {
        match &h[8..12] {
            b"avif" | b"avis" => img("avif", "AVIF image", "image/avif"),
            b"heic" | b"heix" | b"mif1" | b"heif" | b"msf1" => {
                f("heic", "HEIC image", "image/heic", Family::Image)
            }
            b"qt  " => f("mov", "QuickTime video", "video/quicktime", Family::Media),
            b"M4A " => f("m4a", "MPEG-4 audio", "audio/mp4", Family::Media),
            _ => f("mp4", "MPEG-4 video", "video/mp4", Family::Media),
        }
    } else if at(0, b"II*\0") || at(0, b"MM\0*") {
        f("tiff", "TIFF image", "image/tiff", Family::Image)
    } else if at(0, b"%PDF-") {
        f("pdf", "PDF document", "application/pdf", Family::Document)
    } else if at(0, b"PK\x03\x04") || at(0, b"PK\x05\x06") {
        f("zip", "ZIP archive", "application/zip", Family::Archive)
    } else if at(0, &[0x1F, 0x8B]) {
        f("gzip", "GZIP archive", "application/gzip", Family::Archive)
    } else if at(0, &[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
        f(
            "7z",
            "7-Zip archive",
            "application/x-7z-compressed",
            Family::Archive,
        )
    } else if at(0, b"Rar!\x1a\x07") {
        f("rar", "RAR archive", "application/vnd.rar", Family::Archive)
    } else if at(0, b"BZh") && at(4, &[0x31, 0x41, 0x59, 0x26, 0x53, 0x59]) {
        f(
            "bzip2",
            "BZIP2 archive",
            "application/x-bzip2",
            Family::Archive,
        )
    } else if at(0, &[0xFD, b'7', b'z', b'X', b'Z', 0]) {
        f("xz", "XZ archive", "application/x-xz", Family::Archive)
    } else if at(257, b"ustar") {
        f("tar", "TAR archive", "application/x-tar", Family::Archive)
    } else if at(0, b"\x7fELF") {
        f("elf", "ELF program", "application/x-elf", Family::Program)
    } else if [
        [0xFE, 0xED, 0xFA, 0xCE],
        [0xFE, 0xED, 0xFA, 0xCF],
        [0xCE, 0xFA, 0xED, 0xFE],
        [0xCF, 0xFA, 0xED, 0xFE],
        [0xCA, 0xFE, 0xBA, 0xBE],
    ]
    .iter()
    .any(|s| at(0, s))
    {
        f(
            "macho",
            "Mach-O program",
            "application/x-mach-binary",
            Family::Program,
        )
    } else if at(0, b"MZ") && is_pe(h) {
        f(
            "pe",
            "Windows program",
            "application/vnd.microsoft.portable-executable",
            Family::Program,
        )
    } else if at(0, b"\0asm") {
        f("wasm", "WebAssembly", "application/wasm", Family::Program)
    } else if at(0, b"SQLite format 3\0") {
        f(
            "sqlite",
            "SQLite database",
            "application/vnd.sqlite3",
            Family::Data,
        )
    } else if at(0, b"OggS") {
        f("ogg", "Ogg media", "audio/ogg", Family::Media)
    } else if at(0, b"fLaC") {
        f("flac", "FLAC audio", "audio/flac", Family::Media)
    } else if at(0, &[0x1A, 0x45, 0xDF, 0xA3]) {
        f(
            "mkv",
            "Matroska/WebM video",
            "video/x-matroska",
            Family::Media,
        )
    } else if at(0, b"ID3") || (h.len() >= 2 && h[0] == 0xFF && h[1] & 0xE0 == 0xE0 && h[1] != 0xFF)
    {
        f("mp3", "MP3 audio", "audio/mpeg", Family::Media)
    } else {
        return None;
    };
    Some(format)
}

/// `MZ` alone is too weak (a text may start with it): the PE header must follow.
fn is_pe(h: &[u8]) -> bool {
    if h.len() < 64 {
        return false;
    }
    let off = u32::from_le_bytes([h[60], h[61], h[62], h[63]]) as usize;
    off.checked_add(4)
        .is_some_and(|end| end <= h.len() && &h[off..end] == b"PE\0\0")
}

/// Text or binary, judged on the head of the file.
pub fn looks_binary(h: &[u8]) -> bool {
    if encoding::bom(h).is_some() || encoding::utf16_without_bom(h).is_some() {
        return false;
    }
    if h.contains(&0) {
        return true;
    }
    let control = h
        .iter()
        .filter(|&&b| b < 0x20 && !matches!(b, b'\t' | b'\n' | b'\r' | 0x0C | 0x1B))
        .count();
    control * 10 > h.len()
}

/// Text that is an SVG document (`<svg` after an optional XML declaration, comments, doctype).
pub fn is_svg(h: &[u8]) -> bool {
    let start = encoding::bom(h).map_or(0, |(_, n)| n);
    let Ok(text) = std::str::from_utf8(cut(&h[start..])) else {
        return false;
    };
    let mut rest = text.trim_start();
    loop {
        if rest.starts_with("<svg") {
            return true;
        }
        let close = if rest.starts_with("<?") {
            "?>"
        } else if rest.starts_with("<!--") {
            "-->"
        } else if rest.starts_with("<!") {
            ">"
        } else {
            return false;
        };
        match rest.find(close) {
            Some(i) => rest = rest[i + close.len()..].trim_start(),
            None => return false,
        }
    }
}

fn cut(b: &[u8]) -> &[u8] {
    match std::str::from_utf8(b) {
        Err(e) if e.error_len().is_none() => &b[..e.valid_up_to()],
        _ => b,
    }
}

/// Family the extension promises; `None` for unknown or ambiguous extensions.
pub fn family_of_extension(ext: &str) -> Option<Family> {
    let e = ext.to_ascii_lowercase();
    let family = match e.as_str() {
        "txt" | "text" | "md" | "markdown" | "log" | "csv" | "tsv" | "json" | "xml" | "html"
        | "htm" | "css" | "scss" | "js" | "mjs" | "ts" | "rs" | "py" | "java" | "c" | "h"
        | "cpp" | "hpp" | "go" | "rb" | "php" | "sh" | "bat" | "ps1" | "ini" | "cfg" | "conf"
        | "toml" | "yaml" | "yml" | "sql" | "srt" | "nfo" => Family::Text,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "avif" | "svg" | "tif"
        | "tiff" | "heic" | "heif" => Family::Image,
        "zip" | "gz" | "tgz" | "7z" | "rar" | "bz2" | "xz" | "tar" => Family::Archive,
        "pdf" => Family::Document,
        "mp3" | "ogg" | "oga" | "flac" | "wav" | "mp4" | "m4a" | "m4v" | "mov" | "mkv" | "webm" => {
            Family::Media
        }
        "exe" | "dll" | "so" | "dylib" | "wasm" => Family::Program,
        "sqlite" | "sqlite3" | "db" => Family::Data,
        _ => return None,
    };
    Some(family)
}

/// Content and extension disagree (e.g. `bild.txt` is a PNG).
pub fn ext_mismatch(content: &Format, ext: Option<&str>) -> bool {
    ext.and_then(family_of_extension)
        .is_some_and(|fam| fam != content.family)
}

/// Format of a file head: magic bytes, then text/binary, SVG.
pub fn classify(h: &[u8]) -> Format {
    // a text BOM wins (UTF-16 LE `FF FE` would look like an MP3 frame sync)
    if encoding::bom(h).is_some() {
        return if is_svg(h) { SVG } else { TEXT };
    }
    if let Some(format) = sniff(h) {
        return format;
    }
    if looks_binary(h) {
        BINARY
    } else if is_svg(h) {
        SVG
    } else {
        TEXT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        v.resize(64, 0);
        v
    }

    #[test]
    fn magic_bytes() {
        assert_eq!(classify(&png()).id, "png");
        assert_eq!(classify(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]).id, "jpeg");
        assert_eq!(classify(b"GIF89a\x01\0").id, "gif");
        assert_eq!(classify(b"RIFF\0\0\0\0WEBPVP8 ").id, "webp");
        assert_eq!(classify(b"%PDF-1.7\n").family, Family::Document);
        assert_eq!(classify(b"PK\x03\x04\x14\0").id, "zip");
        assert_eq!(classify(b"\x7fELF\x02\x01").family, Family::Program);
        assert_eq!(classify(b"\0\0\0\x18ftypavif").id, "avif");
        assert_eq!(classify(b"\0\0\0\x18ftypisom").id, "mp4");
        assert!(classify(&png()).displayable_image);
        assert!(!classify(b"II*\0\x08\0").displayable_image);
    }

    #[test]
    fn weak_signatures_need_more_than_two_letters() {
        assert_eq!(
            classify(b"BMW fahren ist schoen und so weiter, ja ja").id,
            "text"
        );
        assert_eq!(
            classify(b"MZ is how the text begins, nothing more here ................ x").id,
            "text"
        );
        let mut pe = b"MZ".to_vec();
        pe.resize(0x80, 0);
        pe[60] = 0x40;
        pe[0x40..0x44].copy_from_slice(b"PE\0\0");
        assert_eq!(classify(&pe).id, "pe");
    }

    #[test]
    fn text_versus_binary() {
        assert_eq!(classify("Grüße\r\n\tTab".as_bytes()).id, "text");
        assert_eq!(classify(b"abc\0def").id, "binary");
        assert_eq!(classify(&[1, 2, 3, 4, 5, 6, b'a']).id, "binary");
        assert_eq!(classify(&[0xFF, 0xFE, b'a', 0, b'b', 0]).id, "text"); // UTF-16 BOM
        assert_eq!(classify(b"").id, "text");
        assert_eq!(classify(b"\x1b[31mred\x1b[0m").id, "text"); // ANSI colours
    }

    #[test]
    fn svg_after_declaration_and_comments() {
        assert!(is_svg(
            b"<?xml version=\"1.0\"?>\n<!-- x -->\n<!DOCTYPE svg>\n<svg xmlns=\"\">"
        ));
        assert!(is_svg(b"  <svg>"));
        assert!(!is_svg(b"<html><svg>"));
        assert_eq!(classify(b"<svg viewBox='0 0 1 1'/>").id, "svg");
    }

    #[test]
    fn extension_mismatch() {
        assert!(ext_mismatch(&classify(&png()), Some("txt")));
        assert!(ext_mismatch(&classify(b"just text"), Some("PNG")));
        assert!(!ext_mismatch(&classify(&png()), Some("png")));
        assert!(!ext_mismatch(&classify(&png()), None));
        assert!(!ext_mismatch(&classify(b"PK\x03\x04"), Some("docx"))); // unknown ext
        assert!(ext_mismatch(&classify(b"a\0b"), Some("txt")));
        assert!(!ext_mismatch(&SVG, Some("svg")));
    }
}
