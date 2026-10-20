//! Pre-check of a 7z header before `sevenz-rust2` reads it (external review
//! 025 #1/#2). The crate unpacks a compressed ("encoded") header completely
//! and allocates one entry per declared file *before* our limits can look at
//! the result: a 20 KB archive could demand gigabytes. Here the start header
//! and the encoded-header description are parsed by hand (7zFormat.txt), the
//! unpacked size is capped at [`MAX_HEADER`], and – for the usual LZMA/LZMA2
//! header without encryption – the header is unpacked here (bounded) to read
//! the number of files and refuse more than [`super::MAX_ENTRIES`].
//! Upstream note: `Archive::read` should take limits (header size, files).

use super::{MAX_ENTRIES, too_large};
use crate::error::FsError;
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// Largest unpacked header accepted (a 200 000-entry archive needs ~30 MiB).
pub const MAX_HEADER: u64 = 64 << 20;
/// Largest stored (packed or plain) header read into memory for the check.
const MAX_STORED_HEADER: u64 = 64 << 20;
const SIGNATURE: [u8; 6] = [b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C];

const K_END: u8 = 0x00;
const K_HEADER: u8 = 0x01;
const K_ARCHIVE_PROPERTIES: u8 = 0x02;
const K_ADDITIONAL_STREAMS: u8 = 0x03;
const K_MAIN_STREAMS: u8 = 0x04;
const K_FILES_INFO: u8 = 0x05;
const K_PACK_INFO: u8 = 0x06;
const K_UNPACK_INFO: u8 = 0x07;
const K_SUBSTREAMS_INFO: u8 = 0x08;
const K_SIZE: u8 = 0x09;
const K_CRC: u8 = 0x0A;
const K_FOLDER: u8 = 0x0B;
const K_CODERS_UNPACK_SIZE: u8 = 0x0C;
const K_NUM_UNPACK_STREAM: u8 = 0x0D;
const K_ENCODED_HEADER: u8 = 0x17;

const ID_LZMA: &[u8] = &[0x03, 0x01, 0x01];
const ID_LZMA2: &[u8] = &[0x21];

/// What the check found.
#[derive(Debug, PartialEq, Eq)]
pub enum HeaderCheck {
    /// Number of files (if it could be read without a password).
    Files(Option<u64>),
}

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

fn broken() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "broken 7z header")
}

impl<'a> Cursor<'a> {
    fn byte(&mut self) -> io::Result<u8> {
        let b = *self.data.get(self.pos).ok_or_else(broken)?;
        self.pos += 1;
        Ok(b)
    }

    fn bytes(&mut self, n: u64) -> io::Result<&'a [u8]> {
        let n = usize::try_from(n).map_err(|_| broken())?;
        let end = self.pos.checked_add(n).ok_or_else(broken)?;
        let s = self.data.get(self.pos..end).ok_or_else(broken)?;
        self.pos = end;
        Ok(s)
    }

    /// 7z variable-length number.
    fn number(&mut self) -> io::Result<u64> {
        let first = self.byte()?;
        let mut mask = 0x80u8;
        let mut value = 0u64;
        for i in 0..8 {
            if first & mask == 0 {
                let high = u64::from(first & mask.wrapping_sub(1));
                return Ok(value | (high << (8 * i)));
            }
            value |= u64::from(self.byte()?) << (8 * i);
            mask >>= 1;
        }
        Ok(value)
    }

    /// A count that also bounds work and memory here.
    fn count(&mut self, max: u64) -> io::Result<u64> {
        let n = self.number()?;
        if n > max {
            return Err(broken());
        }
        Ok(n)
    }

    fn bit_vector(&mut self, n: u64) -> io::Result<Vec<bool>> {
        let mut out = Vec::with_capacity(usize::try_from(n).unwrap_or(0).min(1 << 20));
        let mut b = 0u8;
        let mut mask = 0u8;
        for _ in 0..n {
            if mask == 0 {
                b = self.byte()?;
                mask = 0x80;
            }
            out.push(b & mask != 0);
            mask >>= 1;
        }
        Ok(out)
    }

    /// Digests: "all defined" byte (+ vector), then a CRC per defined one.
    fn digests(&mut self, n: u64) -> io::Result<Vec<bool>> {
        let all = self.byte()?;
        let defined = if all == 0 {
            self.bit_vector(n)?
        } else {
            vec![true; usize::try_from(n).map_err(|_| broken())?]
        };
        let crcs = defined.iter().filter(|d| **d).count() as u64;
        self.bytes(crcs.checked_mul(4).ok_or_else(broken)?)?;
        Ok(defined)
    }
}

/// One coder of a folder.
struct Coder {
    id: Vec<u8>,
    props: Vec<u8>,
    outs: u64,
}

struct Folder {
    coders: Vec<Coder>,
    /// Unpack sizes of all coder outputs.
    unpack_sizes: Vec<u64>,
}

struct StreamsInfo {
    pack_pos: u64,
    pack_sizes: Vec<u64>,
    folders: Vec<Folder>,
}

const MAX_ITEMS: u64 = 4 * MAX_ENTRIES as u64;

fn folder(c: &mut Cursor<'_>) -> io::Result<Folder> {
    let n = c.count(64)?;
    let mut coders = Vec::new();
    let (mut ins, mut outs) = (0u64, 0u64);
    for _ in 0..n {
        let flag = c.byte()?;
        if flag & 0x80 != 0 {
            return Err(broken()); // alternative methods: never written by 7-Zip
        }
        let id = c.bytes(u64::from(flag & 0x0F))?.to_vec();
        let (i, o) = if flag & 0x10 != 0 {
            (c.count(64)?, c.count(64)?)
        } else {
            (1, 1)
        };
        let props = if flag & 0x20 != 0 {
            let len = c.count(1 << 16)?;
            c.bytes(len)?.to_vec()
        } else {
            Vec::new()
        };
        ins += i;
        outs += o;
        coders.push(Coder { id, props, outs: o });
    }
    let bind_pairs = outs.checked_sub(1).ok_or_else(broken)?;
    for _ in 0..bind_pairs {
        c.number()?;
        c.number()?;
    }
    let packed = ins.checked_sub(bind_pairs).ok_or_else(broken)?;
    if packed > 1 {
        for _ in 0..packed {
            c.number()?;
        }
    }
    Ok(Folder {
        coders,
        unpack_sizes: Vec::new(),
    })
}

fn streams_info(c: &mut Cursor<'_>) -> io::Result<StreamsInfo> {
    let mut info = StreamsInfo {
        pack_pos: 0,
        pack_sizes: Vec::new(),
        folders: Vec::new(),
    };
    let mut folder_crc: Vec<bool> = Vec::new();
    loop {
        match c.byte()? {
            K_END => return Ok(info),
            K_PACK_INFO => {
                info.pack_pos = c.number()?;
                let n = c.count(MAX_ITEMS)?;
                loop {
                    match c.byte()? {
                        K_END => break,
                        K_SIZE => {
                            for _ in 0..n {
                                info.pack_sizes.push(c.number()?);
                            }
                        }
                        K_CRC => {
                            c.digests(n)?;
                        }
                        _ => return Err(broken()),
                    }
                }
            }
            K_UNPACK_INFO => {
                if c.byte()? != K_FOLDER {
                    return Err(broken());
                }
                let n = c.count(MAX_ITEMS)?;
                if c.byte()? != 0 {
                    return Err(broken()); // "external": not used by 7-Zip
                }
                for _ in 0..n {
                    info.folders.push(folder(c)?);
                }
                if c.byte()? != K_CODERS_UNPACK_SIZE {
                    return Err(broken());
                }
                for f in &mut info.folders {
                    let outs: u64 = f.coders.iter().map(|c| c.outs).sum();
                    for _ in 0..outs {
                        f.unpack_sizes.push(c.number()?);
                    }
                }
                folder_crc = vec![false; info.folders.len()];
                loop {
                    match c.byte()? {
                        K_END => break,
                        K_CRC => folder_crc = c.digests(n)?,
                        _ => return Err(broken()),
                    }
                }
            }
            K_SUBSTREAMS_INFO => {
                let mut streams = vec![1u64; info.folders.len()];
                loop {
                    match c.byte()? {
                        K_END => break,
                        K_NUM_UNPACK_STREAM => {
                            for s in &mut streams {
                                *s = c.count(MAX_ITEMS)?;
                            }
                        }
                        K_SIZE => {
                            for s in &streams {
                                for _ in 1..*s {
                                    c.number()?;
                                }
                            }
                        }
                        K_CRC => {
                            let n: u64 = streams
                                .iter()
                                .zip(folder_crc.iter().chain(std::iter::repeat(&false)))
                                .map(|(s, known)| if *s == 1 && *known { 0 } else { *s })
                                .sum();
                            c.digests(n)?;
                        }
                        _ => return Err(broken()),
                    }
                }
            }
            _ => return Err(broken()),
        }
    }
}

/// The number of files in a plain header (`kHeader …`), `None` without `kFilesInfo`.
fn files_in_header(data: &[u8]) -> io::Result<Option<u64>> {
    let mut c = Cursor { data, pos: 0 };
    if c.byte()? != K_HEADER {
        return Err(broken());
    }
    loop {
        match c.byte()? {
            K_END => return Ok(None),
            K_ARCHIVE_PROPERTIES => loop {
                if c.byte()? == K_END {
                    break;
                }
                let len = c.number()?;
                c.bytes(len)?;
            },
            K_ADDITIONAL_STREAMS | K_MAIN_STREAMS => {
                streams_info(&mut c)?;
            }
            K_FILES_INFO => return Ok(Some(c.number()?)),
            _ => return Err(broken()),
        }
    }
}

fn lzma_reader<'a>(
    coder: &Coder,
    input: impl Read + 'a,
    size: u64,
) -> io::Result<Box<dyn Read + 'a>> {
    if coder.id == ID_LZMA {
        let props = *coder.props.first().ok_or_else(broken)?;
        let dict = coder
            .props
            .get(1..5)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .ok_or_else(broken)?;
        let r = lzma_rust2::LzmaReader::new_with_props(input, size, props, dict, None)
            .map_err(|_| broken())?;
        Ok(Box::new(r))
    } else {
        let b = u32::from(*coder.props.first().ok_or_else(broken)? & 0x3F);
        if b > 40 {
            return Err(broken());
        }
        let dict = if b == 40 {
            u32::MAX
        } else {
            (2 | (b & 1)) << (b / 2 + 11)
        };
        Ok(Box::new(lzma_rust2::Lzma2Reader::new(input, dict, None)))
    }
}

fn check_inner(path: &Path) -> io::Result<Result<HeaderCheck, String>> {
    let file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut r = BufReader::new(file);
    let mut start = [0u8; 32];
    r.read_exact(&mut start)?;
    if start[..6] != SIGNATURE {
        return Err(broken()); // the crate reports the bad signature itself
    }
    let off = u64::from_le_bytes(start[12..20].try_into().map_err(|_| broken())?);
    let size = u64::from_le_bytes(start[20..28].try_into().map_err(|_| broken())?);
    if size == 0 {
        return Ok(Ok(HeaderCheck::Files(Some(0))));
    }
    let pos = 32u64.checked_add(off).ok_or_else(broken)?;
    if size > MAX_STORED_HEADER || pos.checked_add(size).is_none_or(|e| e > len) {
        // beyond the file: broken (or the crate's own search for the end header)
        return Err(broken());
    }
    r.seek(SeekFrom::Start(pos))?;
    let mut header = Vec::new();
    r.by_ref().take(size).read_to_end(&mut header)?;
    match header.first() {
        Some(&K_HEADER) => {
            let files = files_in_header(&header)?;
            Ok(Ok(HeaderCheck::Files(files)))
        }
        Some(&K_ENCODED_HEADER) => {
            let mut c = Cursor {
                data: &header,
                pos: 1,
            };
            let info = streams_info(&mut c)?;
            let unpacked: u64 = info
                .folders
                .iter()
                .flat_map(|f| f.unpack_sizes.iter())
                .copied()
                .max()
                .unwrap_or(0);
            if unpacked > MAX_HEADER {
                return Ok(Err(format!(
                    "The 7z header would unpack to {} MiB (at most {} MiB) – refused",
                    unpacked >> 20,
                    MAX_HEADER >> 20
                )));
            }
            let [f] = info.folders.as_slice() else {
                return Ok(Ok(HeaderCheck::Files(None)));
            };
            let [coder] = f.coders.as_slice() else {
                // AES (+ LZMA) – encrypted names: the size cap is all we can check here
                return Ok(Ok(HeaderCheck::Files(None)));
            };
            if coder.id != ID_LZMA && coder.id != ID_LZMA2 {
                return Ok(Ok(HeaderCheck::Files(None)));
            }
            let packed = *info.pack_sizes.first().ok_or_else(broken)?;
            let at = 32u64
                .checked_add(info.pack_pos)
                .filter(|p| p.checked_add(packed).is_some_and(|e| e <= len))
                .ok_or_else(broken)?;
            r.seek(SeekFrom::Start(at))?;
            let out = *f.unpack_sizes.last().ok_or_else(broken)?;
            let mut dec = lzma_reader(coder, r.by_ref().take(packed), out)?.take(out);
            let mut plain = Vec::new();
            dec.read_to_end(&mut plain)?;
            match plain.first() {
                Some(&K_HEADER) => Ok(Ok(HeaderCheck::Files(files_in_header(&plain)?))),
                // nested encoded headers are not written by 7-Zip: leave them to the crate
                _ => Ok(Ok(HeaderCheck::Files(None))),
            }
        }
        _ => Err(broken()),
    }
}

/// Refuses a 7z whose header would unpack beyond [`MAX_HEADER`] or declares
/// more than [`MAX_ENTRIES`] files. Malformed headers pass: the crate reports them.
pub fn check(path: &Path) -> Result<HeaderCheck, FsError> {
    match check_inner(path) {
        Ok(Ok(HeaderCheck::Files(Some(n)))) if n > MAX_ENTRIES as u64 => Err(too_large(
            format!("The archive declares {n} entries (at most {MAX_ENTRIES}) – refused"),
            path,
        )),
        Ok(Ok(c)) => Ok(c),
        Ok(Err(message)) => Err(too_large(message, path)),
        Err(e)
            if e.kind() == io::ErrorKind::NotFound
                || e.kind() == io::ErrorKind::PermissionDenied =>
        {
            Err(FsError::from_io(&e, path))
        }
        Err(_) => Ok(HeaderCheck::Files(None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_decode_like_7zip() {
        let n = |b: &[u8]| Cursor { data: b, pos: 0 }.number().unwrap();
        assert_eq!(n(&[0x05]), 5);
        assert_eq!(n(&[0x80, 0xFF]), 0xFF);
        assert_eq!(n(&[0x81, 0x00]), 0x100);
        assert_eq!(n(&[0xC0, 0x34, 0x12]), 0x1234);
        assert_eq!(n(&[0xFF, 1, 0, 0, 0, 0, 0, 0, 0]), 1);
    }
}
