//! Minimal text decoding for the viewer (design 010 E2): UTF-8, UTF-16 LE/BE,
//! Windows-1252 and Latin-1 – no crate. Input may be cut at a size limit
//! (`truncated`); an incomplete last character then is not an error.

/// Encodings the viewer offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Windows1252,
    Latin1,
}

impl Encoding {
    pub fn id(self) -> &'static str {
        match self {
            Encoding::Utf8 => "utf-8",
            Encoding::Utf16Le => "utf-16le",
            Encoding::Utf16Be => "utf-16be",
            Encoding::Windows1252 => "windows-1252",
            Encoding::Latin1 => "latin-1",
        }
    }

    /// `None` for an unknown id (`auto` is handled by the caller).
    pub fn from_id(id: &str) -> Option<Encoding> {
        Some(match id.to_ascii_lowercase().as_str() {
            "utf-8" | "utf8" => Encoding::Utf8,
            "utf-16le" => Encoding::Utf16Le,
            "utf-16be" => Encoding::Utf16Be,
            "windows-1252" | "cp1252" => Encoding::Windows1252,
            "latin-1" | "iso-8859-1" => Encoding::Latin1,
            _ => return None,
        })
    }
}

/// Byte order mark at the start: encoding and its length.
pub fn bom(bytes: &[u8]) -> Option<(Encoding, usize)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some((Encoding::Utf8, 3))
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some((Encoding::Utf16Le, 2))
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some((Encoding::Utf16Be, 2))
    } else {
        None
    }
}

/// UTF-16 without BOM: ≥ 90 % of the odd (LE) or even (BE) bytes are zero.
#[allow(clippy::chunks_exact_to_as_chunks)]
pub fn utf16_without_bom(bytes: &[u8]) -> Option<Encoding> {
    let n = bytes.len() / 2;
    if n < 8 {
        return None;
    }
    let zero_odd = bytes
        .chunks_exact(2)
        .filter(|c| c[1] == 0 && c[0] != 0)
        .count();
    let zero_even = bytes
        .chunks_exact(2)
        .filter(|c| c[0] == 0 && c[1] != 0)
        .count();
    if zero_odd * 10 >= n * 9 {
        Some(Encoding::Utf16Le)
    } else if zero_even * 10 >= n * 9 {
        Some(Encoding::Utf16Be)
    } else {
        None
    }
}

/// Valid UTF-8 – an incomplete sequence at the very end counts as valid when `truncated`.
pub fn is_utf8(bytes: &[u8], truncated: bool) -> bool {
    match std::str::from_utf8(bytes) {
        Ok(_) => true,
        Err(e) => truncated && e.error_len().is_none(),
    }
}

/// BOM → UTF-16 heuristic → valid UTF-8 → Windows-1252.
pub fn detect(bytes: &[u8], truncated: bool) -> Encoding {
    if let Some((enc, _)) = bom(bytes) {
        return enc;
    }
    if let Some(enc) = utf16_without_bom(bytes) {
        return enc;
    }
    if is_utf8(bytes, truncated) {
        Encoding::Utf8
    } else {
        Encoding::Windows1252
    }
}

/// Windows-1252 0x80–0x9F (`None` = undefined → U+FFFD).
const CP1252_HIGH: [Option<char>; 32] = [
    Some('\u{20AC}'),
    None,
    Some('\u{201A}'),
    Some('\u{0192}'),
    Some('\u{201E}'),
    Some('\u{2026}'),
    Some('\u{2020}'),
    Some('\u{2021}'),
    Some('\u{02C6}'),
    Some('\u{2030}'),
    Some('\u{0160}'),
    Some('\u{2039}'),
    Some('\u{0152}'),
    None,
    Some('\u{017D}'),
    None,
    None,
    Some('\u{2018}'),
    Some('\u{2019}'),
    Some('\u{201C}'),
    Some('\u{201D}'),
    Some('\u{2022}'),
    Some('\u{2013}'),
    Some('\u{2014}'),
    Some('\u{02DC}'),
    Some('\u{2122}'),
    Some('\u{0161}'),
    Some('\u{203A}'),
    Some('\u{0153}'),
    None,
    Some('\u{017E}'),
    Some('\u{0178}'),
];

/// Decodes `bytes`; a matching BOM is dropped. Returns the text and whether
/// invalid bytes were replaced by U+FFFD.
pub fn decode(bytes: &[u8], enc: Encoding, truncated: bool) -> (String, bool) {
    match enc {
        Encoding::Utf8 => {
            let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
            let body = if truncated { cut_utf8(body) } else { body };
            match std::str::from_utf8(body) {
                Ok(s) => (s.to_owned(), false),
                Err(_) => (String::from_utf8_lossy(body).into_owned(), true),
            }
        }
        Encoding::Utf16Le | Encoding::Utf16Be => decode_utf16(bytes, enc, truncated),
        Encoding::Latin1 => (bytes.iter().map(|&b| b as char).collect(), false),
        Encoding::Windows1252 => {
            let mut lossy = false;
            let text = bytes
                .iter()
                .map(|&b| match b {
                    0x80..=0x9F => CP1252_HIGH[(b - 0x80) as usize].unwrap_or_else(|| {
                        lossy = true;
                        '\u{FFFD}'
                    }),
                    _ => b as char,
                })
                .collect();
            (text, lossy)
        }
    }
}

/// Drops an incomplete UTF-8 sequence at the end (at most 3 bytes).
fn cut_utf8(bytes: &[u8]) -> &[u8] {
    match std::str::from_utf8(bytes) {
        Err(e) if e.error_len().is_none() => &bytes[..e.valid_up_to()],
        _ => bytes,
    }
}

#[allow(clippy::chunks_exact_to_as_chunks)]
fn decode_utf16(bytes: &[u8], enc: Encoding, truncated: bool) -> (String, bool) {
    let le = enc == Encoding::Utf16Le;
    let bom: &[u8] = if le { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] };
    let body = bytes.strip_prefix(bom).unwrap_or(bytes);
    let mut lossy = body.len() % 2 == 1 && !truncated;
    let mut units: Vec<u16> = body
        .chunks_exact(2)
        .map(|c| {
            if le {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        })
        .collect();
    if truncated && units.last().is_some_and(|u| (0xD800..0xDC00).contains(u)) {
        units.pop(); // high surrogate whose partner lies behind the limit
    }
    let text = char::decode_utf16(units)
        .map(|r| {
            r.unwrap_or_else(|_| {
                lossy = true;
                '\u{FFFD}'
            })
        })
        .collect();
    (text, lossy)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(s: &str, le: bool, with_bom: bool) -> Vec<u8> {
        let mut out = Vec::new();
        if with_bom {
            out.extend_from_slice(if le { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
        }
        for u in s.encode_utf16() {
            out.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() });
        }
        out
    }

    #[test]
    fn utf8_with_and_without_bom() {
        let s = "Grüße 🎉 – €";
        assert_eq!(detect(s.as_bytes(), false), Encoding::Utf8);
        assert_eq!(
            decode(s.as_bytes(), Encoding::Utf8, false),
            (s.into(), false)
        );
        let mut b = vec![0xEF, 0xBB, 0xBF];
        b.extend_from_slice(s.as_bytes());
        assert_eq!(detect(&b, false), Encoding::Utf8);
        assert_eq!(decode(&b, Encoding::Utf8, false).0, s);
    }

    #[test]
    fn utf8_cut_inside_a_sequence_is_fine_only_when_truncated() {
        let s = "aä🎉".as_bytes();
        let cut = &s[..s.len() - 1];
        assert!(is_utf8(cut, true));
        assert!(!is_utf8(cut, false));
        assert_eq!(decode(cut, Encoding::Utf8, true), ("aä".into(), false));
        assert!(decode(cut, Encoding::Utf8, false).1);
    }

    #[test]
    fn utf16_both_orders_with_bom_and_le_without() {
        let s = "Hallo Wörld 🎉";
        for le in [true, false] {
            let b = utf16(s, le, true);
            let enc = detect(&b, false);
            assert_eq!(
                enc,
                if le {
                    Encoding::Utf16Le
                } else {
                    Encoding::Utf16Be
                }
            );
            assert_eq!(decode(&b, enc, false), (s.into(), false));
        }
        let plain = utf16("plain ascii text", true, false);
        assert_eq!(detect(&plain, false), Encoding::Utf16Le);
        assert_eq!(
            decode(&plain, Encoding::Utf16Le, false).0,
            "plain ascii text"
        );
    }

    #[test]
    fn utf16_cut_at_odd_byte_or_inside_a_surrogate_pair() {
        let b = utf16("a🎉", true, true);
        assert_eq!(
            decode(&b[..b.len() - 1], Encoding::Utf16Le, true),
            ("a".into(), false)
        );
        assert_eq!(
            decode(&b[..b.len() - 2], Encoding::Utf16Le, true),
            ("a".into(), false)
        );
        assert!(decode(&b[..b.len() - 2], Encoding::Utf16Le, false).1);
    }

    #[test]
    fn windows_1252_and_latin1() {
        // "Größe – 5 €" in Windows-1252
        let b = [
            0x47, 0x72, 0xF6, 0xDF, 0x65, 0x20, 0x96, 0x20, 0x35, 0x20, 0x80,
        ];
        assert_eq!(detect(&b, false), Encoding::Windows1252);
        assert_eq!(
            decode(&b, Encoding::Windows1252, false),
            ("Größe – 5 €".into(), false)
        );
        assert_eq!(
            decode(&b, Encoding::Latin1, false).0.chars().nth(6),
            Some('\u{96}')
        );
        assert_eq!(
            decode(&[0x81], Encoding::Windows1252, false),
            ("\u{FFFD}".into(), true)
        );
    }

    #[test]
    fn ids_round_trip() {
        for e in [
            Encoding::Utf8,
            Encoding::Utf16Le,
            Encoding::Utf16Be,
            Encoding::Windows1252,
            Encoding::Latin1,
        ] {
            assert_eq!(Encoding::from_id(e.id()), Some(e));
        }
        assert_eq!(Encoding::from_id("shift-jis"), None);
    }
}
