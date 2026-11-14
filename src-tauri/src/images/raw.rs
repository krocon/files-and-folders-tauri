//! Preview of camera raw files (design 074 E7): the JPEG the camera embedded.
//!
//! Most raw formats (NEF, CR2, ARW, DNG, ORF, RW2, PEF …) are TIFF files; their IFDs
//! point to one or more embedded JPEGs. We walk the IFD chain (IFD0, next IFDs,
//! SubIFDs) with a small reader of our own, take the largest JPEG and decode it with the
//! limits of [`crate::duplicates::images`]. Fuji RAF has a fixed header with the JPEG's
//! offset. Foreign files are hostile, so the reader fails closed: every offset and length
//! is checked against the file size before it is read, at most [`MAX_IFDS`] IFDs with
//! at most [`MAX_ENTRIES`] entries each, no IFD twice (cycles), JPEGs at most
//! [`MAX_BYTES`](crate::duplicates::images::MAX_BYTES).

use crate::duplicates::images as decode;
use crate::error::{FsError, FsErrorCode};
use crate::platform::open_regular_file;
use image::DynamicImage;
use image::metadata::Orientation;
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// IFDs looked at per file.
pub const MAX_IFDS: usize = 64;
/// Entries of one IFD.
pub const MAX_ENTRIES: u16 = 1000;
/// Embedded JPEGs tried per file, largest first (review 074 #1).
pub const MAX_TRIES: usize = 3;
/// SubIFD offsets taken from one entry.
const MAX_SUB_IFDS: u32 = 16;
/// An embedded JPEG smaller than this is no preview worth showing.
const MIN_JPEG: u32 = 128;

const TAG_NEW_SUBFILE: u16 = 0x00FE;
const TAG_COMPRESSION: u16 = 0x0103;
const TAG_STRIP_OFFSETS: u16 = 0x0111;
const TAG_ORIENTATION: u16 = 0x0112;
const TAG_STRIP_BYTES: u16 = 0x0117;
const TAG_SUB_IFDS: u16 = 0x014A;
const TAG_JPEG_OFFSET: u16 = 0x0201;
const TAG_JPEG_BYTES: u16 = 0x0202;

fn bad(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::UnsupportedImage, message, Some(path))
}

/// A part of the file that holds a JPEG.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub offset: u64,
    pub len: u32,
}

/// What the IFDs tell: the JPEGs and the orientation of IFD0.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct RawInfo {
    pub jpegs: Vec<Span>,
    /// EXIF orientation value (1–8) of IFD0, if set.
    pub orientation: Option<u8>,
}

struct Reader<'a> {
    f: &'a mut File,
    len: u64,
    little: bool,
    path: &'a Path,
}

impl Reader<'_> {
    fn bytes(&mut self, offset: u64, n: usize) -> Result<Vec<u8>, FsError> {
        let end = offset.checked_add(n as u64);
        if end.is_none_or(|e| e > self.len) {
            return Err(bad("The raw file points outside itself", self.path));
        }
        self.f
            .seek(SeekFrom::Start(offset))
            .map_err(|e| FsError::from_io(&e, self.path))?;
        let mut buf = vec![0; n];
        self.f
            .read_exact(&mut buf)
            .map_err(|e| FsError::from_io(&e, self.path))?;
        Ok(buf)
    }

    fn u16(&self, b: &[u8]) -> u16 {
        let a = [b[0], b[1]];
        if self.little {
            u16::from_le_bytes(a)
        } else {
            u16::from_be_bytes(a)
        }
    }

    fn u32(&self, b: &[u8]) -> u32 {
        let a = [b[0], b[1], b[2], b[3]];
        if self.little {
            u32::from_le_bytes(a)
        } else {
            u32::from_be_bytes(a)
        }
    }

    /// The single numeric value of an entry (SHORT or LONG, count 1), else `None`.
    fn single(&self, entry: &[u8]) -> Option<u32> {
        let kind = self.u16(&entry[2..4]);
        let count = self.u32(&entry[4..8]);
        match (kind, count) {
            (3, 1) => Some(u32::from(self.u16(&entry[8..10]))),
            (4 | 13, 1) => Some(self.u32(&entry[8..12])),
            _ => None,
        }
    }

    /// The offsets of a SubIFDs entry (LONG or IFD, at most [`MAX_SUB_IFDS`]).
    fn offsets(&mut self, entry: &[u8]) -> Result<Vec<u64>, FsError> {
        let kind = self.u16(&entry[2..4]);
        let count = self.u32(&entry[4..8]);
        if !matches!(kind, 4 | 13) || count == 0 || count > MAX_SUB_IFDS {
            return Ok(Vec::new());
        }
        let data = if count == 1 {
            entry[8..12].to_vec()
        } else {
            let at = u64::from(self.u32(&entry[8..12]));
            self.bytes(at, count as usize * 4)?
        };
        Ok(data
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| u64::from(self.u32(c)))
            .collect())
    }
}

/// Reads the IFDs of a TIFF-based raw file (or the header of a RAF).
pub fn inspect(path: &Path) -> Result<RawInfo, FsError> {
    let mut f = open_regular_file(path).map_err(|e| FsError::from_io(&e, path))?;
    let len = f.metadata().map_err(|e| FsError::from_io(&e, path))?.len();
    let mut head = [0u8; 16];
    if len < 16 {
        return Err(bad("The raw file is too short", path));
    }
    f.read_exact(&mut head)
        .map_err(|e| FsError::from_io(&e, path))?;
    if &head[..15] == b"FUJIFILMCCD-RAW" {
        return raf(&mut f, len, path);
    }
    let little = match &head[..2] {
        b"II" => true,
        b"MM" => false,
        _ => return Err(bad("Not a raw format that can be read", path)),
    };
    let mut r = Reader {
        f: &mut f,
        len,
        little,
        path,
    };
    // 42 = TIFF; Olympus ORF uses 0x4F52/0x5352, Panasonic RW2 0x55
    if !matches!(r.u16(&head[2..4]), 42 | 0x4F52 | 0x5352 | 0x55) {
        return Err(bad("Not a raw format that can be read", path));
    }
    let first = u64::from(r.u32(&head[4..8]));
    let mut info = RawInfo::default();
    let mut queue = vec![(first, true)];
    let mut seen = HashSet::new();
    while let Some((at, is_first)) = queue.pop() {
        if at == 0 || !seen.insert(at) {
            continue;
        }
        if seen.len() > MAX_IFDS {
            return Err(bad("The raw file has too many IFDs", path));
        }
        let head = r.bytes(at, 2)?;
        let count = r.u16(&head);
        if count == 0 || count > MAX_ENTRIES {
            return Err(bad("The raw file has a broken IFD", path));
        }
        let table = r.bytes(at + 2, usize::from(count) * 12 + 4)?;
        let (mut jpeg_at, mut jpeg_len) = (None, None);
        let (mut strip_at, mut strip_len, mut compression, mut subfile) = (None, None, None, None);
        for entry in table[..usize::from(count) * 12].as_chunks::<12>().0 {
            match r.u16(&entry[..2]) {
                TAG_JPEG_OFFSET => jpeg_at = r.single(entry),
                TAG_JPEG_BYTES => jpeg_len = r.single(entry),
                TAG_STRIP_OFFSETS => strip_at = r.single(entry),
                TAG_STRIP_BYTES => strip_len = r.single(entry),
                TAG_COMPRESSION => compression = r.single(entry),
                TAG_NEW_SUBFILE => subfile = r.single(entry),
                TAG_ORIENTATION if is_first => {
                    info.orientation = r.single(entry).and_then(|v| u8::try_from(v).ok());
                }
                TAG_SUB_IFDS => {
                    for o in r.offsets(entry)? {
                        queue.push((o, false));
                    }
                }
                _ => {}
            }
        }
        if let (Some(o), Some(l)) = (jpeg_at, jpeg_len) {
            info.jpegs.push(Span {
                offset: u64::from(o),
                len: l,
            });
        }
        // a JPEG strip: old-style JPEG (6), or a reduced-size image in new-style JPEG (7)
        // – the full-size raw data of a DNG is lossless JPEG (7, subfile 0): not a preview
        let preview_strip =
            compression == Some(6) || (compression == Some(7) && subfile == Some(1));
        if let (true, Some(o), Some(l)) = (preview_strip, strip_at, strip_len) {
            info.jpegs.push(Span {
                offset: u64::from(o),
                len: l,
            });
        }
        let next = u64::from(r.u32(&table[usize::from(count) * 12..]));
        queue.push((next, false));
    }
    info.jpegs
        .retain(|s| s.len >= MIN_JPEG && s.offset + u64::from(s.len) <= len);
    // several IFDs may point at the same bytes: each span once (review 074 #1)
    let mut unique = HashSet::new();
    info.jpegs.retain(|s| unique.insert((s.offset, s.len)));
    Ok(info)
}

/// Fuji RAF: big-endian offset/length of the JPEG at bytes 84/88 of the header.
fn raf(f: &mut File, len: u64, path: &Path) -> Result<RawInfo, FsError> {
    let mut r = Reader {
        f,
        len,
        little: false,
        path,
    };
    let b = r.bytes(84, 8)?;
    let span = Span {
        offset: u64::from(r.u32(&b[..4])),
        len: r.u32(&b[4..8]),
    };
    let ok = span.len >= MIN_JPEG && span.offset + u64::from(span.len) <= len;
    Ok(RawInfo {
        jpegs: if ok { vec![span] } else { Vec::new() },
        orientation: None,
    })
}

/// Reads a span that must be a JPEG (starts with `FF D8`).
fn read_jpeg(path: &Path, span: Span) -> Result<Vec<u8>, FsError> {
    if u64::from(span.len) > decode::MAX_BYTES {
        return Err(bad("The embedded preview is too large", path));
    }
    let mut f = open_regular_file(path).map_err(|e| FsError::from_io(&e, path))?;
    let len = f.metadata().map_err(|e| FsError::from_io(&e, path))?.len();
    let mut r = Reader {
        f: &mut f,
        len,
        little: true,
        path,
    };
    let data = r.bytes(span.offset, span.len as usize)?;
    if data.len() < 2 || data[..2] != [0xFF, 0xD8] {
        return Err(bad("The embedded preview is not a JPEG", path));
    }
    Ok(data)
}

fn orientation(v: Option<u8>) -> Orientation {
    v.and_then(Orientation::from_exif)
        .unwrap_or(Orientation::NoTransforms)
}

/// The spans worth a try: the [`MAX_TRIES`] largest (a broken one costs a full decode).
pub fn candidates(info: &RawInfo) -> Vec<Span> {
    let mut spans = info.jpegs.clone();
    spans.sort_by_key(|s| std::cmp::Reverse(s.len));
    spans.truncate(MAX_TRIES);
    spans
}

/// Decodes the largest embedded JPEG of a raw file, turned like the raw (IFD0).
pub fn decode_preview(path: &Path) -> Result<DynamicImage, FsError> {
    let info = inspect(path)?;
    let mut last = bad("The raw file has no embedded preview", path);
    for span in candidates(&info) {
        let attempt = read_jpeg(path, span)
            .and_then(|data| decode::with_permit(|| decode::decode_bytes(&data, path)));
        match attempt {
            Ok(mut img) => {
                img.apply_orientation(orientation(info.orientation));
                return Ok(img);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::duplicates::images::testimg::{jpeg, photo};
    use std::fs;

    /// Builds a little-endian TIFF: IFD0 (orientation, SubIFD) → SubIFD (JPEG offset/length).
    fn tiff(jpg: &[u8], orientation: u16) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"II");
        b.extend_from_slice(&42u16.to_le_bytes());
        b.extend_from_slice(&8u32.to_le_bytes());
        let entry = |b: &mut Vec<u8>, tag: u16, kind: u16, value: u32| {
            b.extend_from_slice(&tag.to_le_bytes());
            b.extend_from_slice(&kind.to_le_bytes());
            b.extend_from_slice(&1u32.to_le_bytes());
            b.extend_from_slice(&value.to_le_bytes());
        };
        // IFD0 at 8: 2 entries → 2 + 24 + 4 = 30 bytes → SubIFD at 38
        b.extend_from_slice(&2u16.to_le_bytes());
        entry(&mut b, TAG_ORIENTATION, 3, u32::from(orientation));
        entry(&mut b, TAG_SUB_IFDS, 4, 38);
        b.extend_from_slice(&0u32.to_le_bytes());
        // SubIFD at 38: 2 entries → JPEG at 38 + 30 = 68
        b.extend_from_slice(&2u16.to_le_bytes());
        entry(&mut b, TAG_JPEG_OFFSET, 4, 68);
        entry(&mut b, TAG_JPEG_BYTES, 4, jpg.len() as u32);
        b.extend_from_slice(&0u32.to_le_bytes());
        assert_eq!(b.len(), 68);
        b.extend_from_slice(jpg);
        b
    }

    #[test]
    fn embedded_jpeg_turned_by_ifd0() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("Foto ä 🙂.NEF");
        fs::write(&p, tiff(&jpeg(&photo(300, 200, 1), 85), 6)).unwrap();
        let info = inspect(&p).unwrap();
        assert_eq!(info.orientation, Some(6));
        assert_eq!(info.jpegs.len(), 1);
        let img = decode_preview(&p).unwrap();
        // orientation 6 = 90° clockwise: width and height swap
        assert_eq!((img.width(), img.height()), (200, 300));
    }

    #[test]
    fn hostile_files_fail_closed() {
        let d = tempfile::tempdir().unwrap();
        let jpg = jpeg(&photo(64, 48, 2), 80);
        // the JPEG length points past the end of the file
        let mut b = tiff(&jpg, 1);
        b.truncate(b.len() - 10);
        let p = d.path().join("cut.nef");
        fs::write(&p, &b).unwrap();
        assert!(inspect(&p).unwrap().jpegs.is_empty());
        assert!(decode_preview(&p).is_err());
        // an IFD whose next offset is itself: a cycle, visited once
        let mut b = Vec::new();
        b.extend_from_slice(b"II");
        b.extend_from_slice(&42u16.to_le_bytes());
        b.extend_from_slice(&8u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&TAG_ORIENTATION.to_le_bytes());
        b.extend_from_slice(&3u16.to_le_bytes());
        b.extend_from_slice(&1u32.to_le_bytes());
        b.extend_from_slice(&1u32.to_le_bytes());
        b.extend_from_slice(&8u32.to_le_bytes());
        let p = d.path().join("loop.dng");
        fs::write(&p, &b).unwrap();
        assert_eq!(inspect(&p).unwrap().jpegs, Vec::new());
        // an IFD offset outside the file
        let mut b = b"II".to_vec();
        b.extend_from_slice(&42u16.to_le_bytes());
        b.extend_from_slice(&999_999u32.to_le_bytes());
        b.extend_from_slice(&[0; 8]);
        let p = d.path().join("far.cr2");
        fs::write(&p, &b).unwrap();
        assert!(inspect(&p).is_err());
        // not a raw at all
        let p = d.path().join("text.arw");
        fs::write(&p, "hello, this is not a raw file").unwrap();
        assert!(inspect(&p).is_err());
        // a span that is not a JPEG is skipped with an error, never decoded as something else
        let mut b = tiff(&jpg, 1);
        b[68] = 0;
        let p = d.path().join("nojpeg.pef");
        fs::write(&p, &b).unwrap();
        assert!(decode_preview(&p).is_err());
    }

    #[test]
    fn too_many_ifds_are_refused() {
        // a chain of MAX_IFDS + 1 empty-ish IFDs (one entry each)
        let mut b = b"II".to_vec();
        b.extend_from_slice(&42u16.to_le_bytes());
        b.extend_from_slice(&8u32.to_le_bytes());
        for i in 0..=MAX_IFDS {
            let at = 8 + i * 18;
            b.extend_from_slice(&1u16.to_le_bytes());
            b.extend_from_slice(&0x0100u16.to_le_bytes());
            b.extend_from_slice(&3u16.to_le_bytes());
            b.extend_from_slice(&1u32.to_le_bytes());
            b.extend_from_slice(&1u32.to_le_bytes());
            let next = if i == MAX_IFDS { 0 } else { at + 18 };
            b.extend_from_slice(&(next as u32).to_le_bytes());
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("many.orf");
        fs::write(&p, &b).unwrap();
        assert!(inspect(&p).is_err());
    }

    #[test]
    fn fuji_raf_header() {
        let jpg = jpeg(&photo(80, 60, 3), 80);
        let mut b = b"FUJIFILMCCD-RAW 0201".to_vec();
        b.resize(84, 0);
        b.extend_from_slice(&100u32.to_be_bytes());
        b.extend_from_slice(&(jpg.len() as u32).to_be_bytes());
        b.resize(100, 0);
        b.extend_from_slice(&jpg);
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("x.RAF");
        fs::write(&p, &b).unwrap();
        let img = decode_preview(&p).unwrap();
        assert_eq!((img.width(), img.height()), (80, 60));
    }

    #[test]
    fn spans_are_deduplicated_and_only_the_largest_few_tried() {
        // review 074 #1: 64 IFDs pointing at the same bytes must not mean 128 decodes
        let jpg = jpeg(&photo(64, 48, 5), 80);
        let mut b = tiff(&jpg, 1);
        // IFD0 points at the same JPEG too: patch its SubIFD entry into a JPEG offset …
        b[22..24].copy_from_slice(&TAG_JPEG_OFFSET.to_le_bytes());
        b[30..34].copy_from_slice(&68u32.to_le_bytes());
        // … and add the length right after (replaces the orientation entry)
        b[10..12].copy_from_slice(&TAG_JPEG_BYTES.to_le_bytes());
        b[12..14].copy_from_slice(&4u16.to_le_bytes());
        b[18..22].copy_from_slice(&(jpg.len() as u32).to_le_bytes());
        // the old SubIFD (same JPEG) is now the next IFD of IFD0
        b[34..38].copy_from_slice(&38u32.to_le_bytes());
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("twice.nef");
        fs::write(&p, &b).unwrap();
        let info = inspect(&p).unwrap();
        assert_eq!(info.jpegs.len(), 1, "same span once: {:?}", info.jpegs);
        let many = RawInfo {
            jpegs: (0..10)
                .map(|i| Span {
                    offset: 1000 + i,
                    len: 200 + i as u32,
                })
                .collect(),
            orientation: None,
        };
        let tried = candidates(&many);
        assert_eq!(tried.len(), MAX_TRIES);
        assert_eq!(tried[0].len, 209, "largest first");
    }
}
