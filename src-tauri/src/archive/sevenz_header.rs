//! Pre-check of a 7z header before `sevenz-rust2` reads it (external review
//! 025 #1/#2 and its re-check B1–B4). The crate unpacks a compressed
//! ("encoded") header completely and allocates one entry per declared file
//! *before* our limits can look at the result. Here, on the same open file:
//!
//! - the start header and the next header are checked against their CRCs; a
//!   zeroed start header is refused (the crate would search the last MiB for a
//!   header without any CRC);
//! - an encoded header may only be LZMA or LZMA2, optionally behind AES-256
//!   (decrypted here with the known password); it is unpacked here, bounded by
//!   [`MAX_HEADER`], and the number of files is read: more than
//!   [`super::MAX_ENTRIES`] is refused;
//! - the parser allocates nothing before it has checked the bytes that must
//!   back it (counts against the remaining header length);
//! - **fail-closed**: whatever this parser cannot judge is refused.
//!
//! Upstream note: `Archive::read` should take limits (header size, files).

use super::secrets::Secret;
use super::{MAX_ENTRIES, archive_error, too_large};
use crate::error::{FsError, FsErrorCode};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;
use zeroize::Zeroizing;

/// Largest unpacked header accepted (200 000 entries need about 22–30 MiB).
pub const MAX_HEADER: u64 = 32 << 20;
const SIGNATURE: [u8; 6] = [b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C];
/// AES key derivation: at most 2^22 SHA-256 rounds (7-Zip writes 19; the crate
/// would allow 24 – 3 min per try with a long password, N2). 0x3F = raw key.
pub(crate) const MAX_AES_CYCLES_POWER: u8 = 22;

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
const ID_AES: &[u8] = &[0x06, 0xF1, 0x07, 0x01];

/// What the check found.
#[derive(Debug, PartialEq, Eq)]
pub struct Checked {
    /// Files the header declares.
    pub files: u64,
    /// The header was encrypted (names need the password).
    pub encrypted_header: bool,
    /// No next header at all: an empty archive.
    pub empty: bool,
}

/// Why the check failed (mapped to an [`FsError`] in [`check`]).
#[derive(Debug)]
enum Refusal {
    /// Anything this parser cannot judge (fail-closed).
    Unknown(&'static str),
    TooLarge(String),
    PasswordRequired,
    PasswordWrong,
    Io(io::Error),
}

impl From<io::Error> for Refusal {
    fn from(e: io::Error) -> Self {
        Refusal::Io(e)
    }
}

type R<T> = Result<T, Refusal>;

fn broken<T>() -> R<T> {
    Err(Refusal::Unknown("malformed header"))
}

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn remaining(&self) -> u64 {
        (self.data.len() - self.pos) as u64
    }

    fn byte(&mut self) -> R<u8> {
        let Some(b) = self.data.get(self.pos) else {
            return broken();
        };
        self.pos += 1;
        Ok(*b)
    }

    fn bytes(&mut self, n: u64) -> R<&'a [u8]> {
        if n > self.remaining() {
            return broken();
        }
        let end = self.pos + n as usize;
        let s = &self.data[self.pos..end];
        self.pos = end;
        Ok(s)
    }

    /// 7z variable-length number.
    fn number(&mut self) -> R<u64> {
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

    /// A count of items that take at least one byte each: never more than the
    /// bytes left (B2 – nothing is allocated for counts the header cannot back).
    fn count(&mut self, max: u64) -> R<u64> {
        let n = self.number()?;
        if n > max || n > self.remaining() {
            return broken();
        }
        Ok(n)
    }

    /// Bit vector of `n` bits; only the number of set bits is kept.
    fn count_bits(&mut self, n: u64) -> R<u64> {
        if n.div_ceil(8) > self.remaining() {
            return broken();
        }
        let mut set = 0u64;
        let full = n / 8;
        for b in self.bytes(full)? {
            set += u64::from(b.count_ones());
        }
        let rest = n % 8;
        if rest > 0 {
            let b = self.byte()?;
            set += u64::from((b >> (8 - rest)).count_ones());
        }
        Ok(set)
    }

    /// Digests of `n` streams: "all defined" byte (+ bits), then 4 bytes per
    /// defined one – checked against the remaining length before anything else.
    fn skip_digests(&mut self, n: u64) -> R<()> {
        let defined = if self.byte()? == 0 {
            self.count_bits(n)?
        } else {
            n
        };
        let len = defined
            .checked_mul(4)
            .ok_or(Refusal::Unknown("malformed header"))?;
        self.bytes(len).map(|_| ())
    }

    /// Digests of `n` folders (n ≤ remaining bytes): which ones are defined.
    fn folder_digests(&mut self, n: u64) -> R<Vec<bool>> {
        if n > self.remaining() {
            return broken();
        }
        let all = self.byte()?;
        let mut defined = Vec::with_capacity(n as usize);
        if all == 0 {
            if n.div_ceil(8) > self.remaining() {
                return broken();
            }
            let mut b = 0u8;
            for i in 0..n {
                if i % 8 == 0 {
                    b = self.byte()?;
                }
                defined.push(b & (0x80 >> (i % 8)) != 0);
            }
        } else {
            defined.resize(n as usize, true);
        }
        let crcs = defined.iter().filter(|d| **d).count() as u64;
        self.bytes(crcs * 4)?;
        Ok(defined)
    }
}

struct Coder {
    id: Vec<u8>,
    props: Vec<u8>,
}

struct Folder {
    coders: Vec<Coder>,
    /// Unpack sizes of all coder outputs (in coder order).
    unpack_sizes: Vec<u64>,
}

#[derive(Default)]
struct StreamsInfo {
    pack_pos: u64,
    pack_sizes: Vec<u64>,
    folders: Vec<Folder>,
}

/// One folder: the number of coder outputs, and the coders themselves only when
/// `keep` (the encoded header) – the main header's folders are only counted (N1).
fn folder(c: &mut Cursor<'_>, keep: bool) -> R<(u64, Option<Folder>)> {
    let n = c.count(32)?;
    let mut coders = Vec::new();
    let (mut ins, mut outs) = (0u64, 0u64);
    for _ in 0..n {
        let flag = c.byte()?;
        if flag & 0x80 != 0 {
            return broken(); // alternative methods: never written by 7-Zip
        }
        let id = c.bytes(u64::from(flag & 0x0F))?;
        let (i, o) = if flag & 0x10 != 0 {
            (c.count(32)?, c.count(32)?)
        } else {
            (1, 1)
        };
        let props = if flag & 0x20 != 0 {
            let len = c.count(1 << 16)?;
            c.bytes(len)?
        } else {
            &[]
        };
        ins += i;
        outs += o;
        if keep {
            coders.push(Coder {
                id: id.to_vec(),
                props: props.to_vec(),
            });
        }
    }
    let Some(bind_pairs) = outs.checked_sub(1) else {
        return broken();
    };
    for _ in 0..bind_pairs {
        c.number()?;
        c.number()?;
    }
    let Some(packed) = ins.checked_sub(bind_pairs) else {
        return broken();
    };
    if packed > 1 {
        for _ in 0..packed {
            c.number()?;
        }
    }
    let kept = keep.then_some(Folder {
        coders,
        unpack_sizes: Vec::new(),
    });
    Ok((outs, kept))
}

/// Streams info. With `keep` (the encoded header: one folder, one pack stream)
/// the folder and pack sizes are returned; otherwise everything is only checked
/// and skipped, with at most [`MAX_ENTRIES`] folders – 7-Zip writes no folder
/// without a file, so more folders than allowed files cannot be a valid archive
/// within the limits (N1: two header bytes per folder must not become 100+ bytes
/// of memory).
fn streams_info(c: &mut Cursor<'_>, keep: bool) -> R<StreamsInfo> {
    let mut info = StreamsInfo::default();
    // per folder: coder outputs (≤ 32 × 32) and whether its CRC is known
    let mut folder_outs: Vec<u16> = Vec::new();
    let mut folder_crc: Vec<bool> = Vec::new();
    let max_folders = if keep { 1 } else { MAX_ENTRIES as u64 };
    loop {
        match c.byte()? {
            K_END => return Ok(info),
            K_PACK_INFO => {
                info.pack_pos = c.number()?;
                let n = c.count(if keep { 1 } else { u64::MAX })?;
                loop {
                    match c.byte()? {
                        K_END => break,
                        K_SIZE => {
                            for _ in 0..n {
                                let size = c.number()?;
                                if keep {
                                    info.pack_sizes.push(size);
                                }
                            }
                        }
                        K_CRC => c.skip_digests(n)?,
                        _ => return broken(),
                    }
                }
            }
            K_UNPACK_INFO => {
                if c.byte()? != K_FOLDER {
                    return broken();
                }
                let n = c.count(max_folders)?;
                if c.byte()? != 0 {
                    return broken(); // "external": never written by 7-Zip
                }
                folder_outs = Vec::with_capacity(n as usize);
                for _ in 0..n {
                    let (outs, f) = folder(c, keep)?;
                    folder_outs.push(u16::try_from(outs).map_err(|_| Refusal::Unknown("coders"))?);
                    info.folders.extend(f);
                }
                if c.byte()? != K_CODERS_UNPACK_SIZE {
                    return broken();
                }
                for (i, outs) in folder_outs.iter().enumerate() {
                    for _ in 0..*outs {
                        let size = c.number()?;
                        if let Some(f) = info.folders.get_mut(i) {
                            f.unpack_sizes.push(size);
                        }
                    }
                }
                folder_crc = vec![false; folder_outs.len()];
                loop {
                    match c.byte()? {
                        K_END => break,
                        K_CRC => folder_crc = c.folder_digests(n)?,
                        _ => return broken(),
                    }
                }
            }
            K_SUBSTREAMS_INFO => {
                let mut streams = vec![1u64; folder_outs.len()];
                loop {
                    match c.byte()? {
                        K_END => break,
                        K_NUM_UNPACK_STREAM => {
                            for s in &mut streams {
                                *s = c.number()?;
                            }
                        }
                        K_SIZE => {
                            for s in &streams {
                                // every size takes a byte: refuse what cannot be there
                                if s.saturating_sub(1) > c.remaining() {
                                    return broken();
                                }
                                for _ in 1..*s {
                                    c.number()?;
                                }
                            }
                        }
                        K_CRC => {
                            let mut n = 0u64;
                            for (i, s) in streams.iter().enumerate() {
                                let known = folder_crc.get(i).copied().unwrap_or(false);
                                if !(*s == 1 && known) {
                                    n = n.saturating_add(*s);
                                }
                            }
                            c.skip_digests(n)?;
                        }
                        _ => return broken(),
                    }
                }
            }
            _ => return broken(),
        }
    }
}

/// The number of files in a plain header (`kHeader …`); 0 without `kFilesInfo`.
fn files_in_header(data: &[u8]) -> R<u64> {
    let mut c = Cursor { data, pos: 0 };
    if c.byte()? != K_HEADER {
        // a nested encoded header: never written by 7-Zip
        return Err(Refusal::Unknown("nested encoded header"));
    }
    loop {
        match c.byte()? {
            K_END => return Ok(0),
            K_ARCHIVE_PROPERTIES => loop {
                if c.byte()? == K_END {
                    break;
                }
                let len = c.number()?;
                c.bytes(len)?;
            },
            K_ADDITIONAL_STREAMS | K_MAIN_STREAMS => {
                streams_info(&mut c, false)?;
            }
            K_FILES_INFO => return c.number(),
            _ => return broken(),
        }
    }
}

fn lzma_reader<'a>(coder: &Coder, input: impl Read + 'a, size: u64) -> R<Box<dyn Read + 'a>> {
    if coder.id == ID_LZMA {
        let (Some(&props), Some(d)) = (coder.props.first(), coder.props.get(1..5)) else {
            return broken();
        };
        let dict = u32::from_le_bytes([d[0], d[1], d[2], d[3]]);
        let r = lzma_rust2::LzmaReader::new_with_props(input, size, props, dict, None)
            .map_err(|_| Refusal::Unknown("LZMA properties"))?;
        Ok(Box::new(r))
    } else {
        let Some(b) = coder.props.first().map(|b| u32::from(*b & 0x3F)) else {
            return broken();
        };
        if b > 40 {
            return broken();
        }
        let dict = if b == 40 {
            u32::MAX
        } else {
            (2 | (b & 1)) << (b / 2 + 11)
        };
        Ok(Box::new(lzma_rust2::Lzma2Reader::new(input, dict, None)))
    }
}

/// A derived AES key, kept for the next check of the same archive (N2: up to
/// 2^22 SHA-256 rounds per check); zeroed when dropped.
struct CachedKey {
    salt: Vec<u8>,
    cycles: u8,
    password: Zeroizing<Vec<u8>>,
    key: Zeroizing<[u8; 32]>,
}

/// The last few derived keys (newest last).
static KEYS: Mutex<Vec<CachedKey>> = Mutex::new(Vec::new());
const KEYS_KEPT: usize = 4;

/// Drops all cached keys (with a forgotten password).
pub(crate) fn forget_keys() {
    KEYS.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// 7-Zip's key derivation: SHA-256 over 2^cycles rounds of salt, UTF-16LE
/// password and a counter – cached per (salt, rounds, password).
fn derived_key(salt: &[u8], cycles: u8, pw: &[u8]) -> Zeroizing<[u8; 32]> {
    derived_key_in(&KEYS, salt, cycles, pw)
}

/// [`derived_key`] with its cache as a parameter (tests use their own: the global
/// one is shared with tests running in parallel).
fn derived_key_in(
    cache: &Mutex<Vec<CachedKey>>,
    salt: &[u8],
    cycles: u8,
    pw: &[u8],
) -> Zeroizing<[u8; 32]> {
    use sha2::Digest;
    {
        let keys = cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(k) = keys
            .iter()
            .find(|k| k.cycles == cycles && k.salt == salt && k.password[..] == *pw)
        {
            return k.key.clone();
        }
    }
    let mut sha = sha2::Sha256::new();
    let mut counter = [0u8; 8];
    for _ in 0..(1u64 << cycles) {
        sha.update(salt);
        sha.update(pw);
        sha.update(counter);
        for b in &mut counter {
            *b = b.wrapping_add(1);
            if *b != 0 {
                break;
            }
        }
    }
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&sha.finalize());
    let mut keys = cache.lock().unwrap_or_else(|e| e.into_inner());
    if keys.len() >= KEYS_KEPT {
        keys.remove(0);
    }
    keys.push(CachedKey {
        salt: salt.to_vec(),
        cycles,
        password: Zeroizing::new(pw.to_vec()),
        key: key.clone(),
    });
    key
}

/// The key rounds (2^n) an AES coder asks for; `None` for unreadable properties.
pub(crate) fn aes_cycles(props: &[u8]) -> Option<u8> {
    props.first().map(|b| b & 0x3F)
}

/// AES-256-CBC with 7-Zip's key derivation (SHA-256 over salt, UTF-16LE
/// password and a counter, 2^n rounds), whole buffer at once.
fn aes_decrypt(props: &[u8], password: &Secret, data: &mut [u8]) -> R<()> {
    use cbc::cipher::{BlockModeDecrypt, KeyIvInit, array::Array};
    let (Some(&b0), Some(&b1)) = (props.first(), props.get(1)) else {
        return broken();
    };
    let cycles = b0 & 0x3F;
    let iv_size = usize::from(((b0 >> 6) & 1) + (b1 & 0x0F));
    let salt_size = usize::from(((b0 >> 7) & 1) + (b1 >> 4));
    let Some(salt) = props.get(2..2 + salt_size) else {
        return broken();
    };
    let Some(iv_bytes) = props.get(2 + salt_size..2 + salt_size + iv_size) else {
        return broken();
    };
    let mut iv = [0u8; 16];
    iv[..iv_size].copy_from_slice(iv_bytes);
    let pw = Zeroizing::new(
        password
            .expose()
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<u8>>(),
    );
    let key = if cycles == 0x3F {
        let mut key = Zeroizing::new([0u8; 32]);
        key[..salt_size].copy_from_slice(salt);
        let n = pw.len().min(32 - salt_size);
        key[salt_size..salt_size + n].copy_from_slice(&pw[..n]);
        key
    } else {
        if cycles > MAX_AES_CYCLES_POWER {
            return Err(Refusal::Unknown("AES work factor"));
        }
        derived_key(salt, cycles, &pw)
    };
    if !data.len().is_multiple_of(16) {
        return broken();
    }
    let mut dec = cbc::Decryptor::<aes::Aes256>::new(&Array::from(*key), &Array::from(iv));
    let (blocks, _) = Array::<u8, _>::slice_as_chunks_mut(data);
    dec.decrypt_blocks(blocks);
    Ok(())
}

fn crc(data: &[u8]) -> u32 {
    let mut h = crc32fast::Hasher::new();
    h.update(data);
    h.finalize()
}

fn check_inner(file: &mut File, password: Option<&Secret>) -> R<Checked> {
    let len = file.metadata()?.len();
    file.seek(SeekFrom::Start(0))?;
    let mut start = [0u8; 32];
    file.read_exact(&mut start)
        .map_err(|_| Refusal::Unknown("too short for a 7z archive"))?;
    if start[..6] != SIGNATURE {
        return Err(Refusal::Unknown("not a 7z archive"));
    }
    let start_crc = u32::from_le_bytes([start[8], start[9], start[10], start[11]]);
    // B1: a zeroed start header makes the crate search the end for a header without
    // any check – never accepted; every start header must match its CRC
    if start_crc == 0 && start[12..32].iter().all(|b| *b == 0) {
        return Err(Refusal::Unknown("missing start header, damaged archive"));
    }
    if crc(&start[12..32]) != start_crc {
        return Err(Refusal::Unknown("start header CRC mismatch"));
    }
    let off = u64::from_le_bytes(start[12..20].try_into().unwrap_or([0; 8]));
    let size = u64::from_le_bytes(start[20..28].try_into().unwrap_or([0; 8]));
    let next_crc = u32::from_le_bytes([start[28], start[29], start[30], start[31]]);
    if size == 0 {
        return Ok(Checked {
            files: 0,
            encrypted_header: false,
            empty: true,
        });
    }
    let Some(pos) = 32u64.checked_add(off) else {
        return broken();
    };
    if size > MAX_HEADER || pos.checked_add(size).is_none_or(|e| e > len) {
        return Err(Refusal::Unknown("header outside the file or too large"));
    }
    file.seek(SeekFrom::Start(pos))?;
    let mut header = Vec::new();
    file.by_ref().take(size).read_to_end(&mut header)?;
    if crc(&header) != next_crc {
        return Err(Refusal::Unknown("header CRC mismatch"));
    }
    match header.first() {
        Some(&K_HEADER) => Ok(Checked {
            files: files_in_header(&header)?,
            encrypted_header: false,
            empty: false,
        }),
        Some(&K_ENCODED_HEADER) => {
            let mut c = Cursor {
                data: &header,
                pos: 1,
            };
            let info = streams_info(&mut c, true)?;
            let ([f], [packed]) = (info.folders.as_slice(), info.pack_sizes.as_slice()) else {
                return Err(Refusal::Unknown("unusual encoded header"));
            };
            // B3: LZMA or LZMA2, optionally behind AES – nothing else
            let lzma = f
                .coders
                .iter()
                .position(|c| c.id == ID_LZMA || c.id == ID_LZMA2);
            let aes = f.coders.iter().position(|c| c.id == ID_AES);
            let (Some(li), true) = (lzma, f.coders.len() == 1 + usize::from(aes.is_some())) else {
                return Err(Refusal::Unknown(
                    "encoded header with an unsupported method",
                ));
            };
            let Some(&out) = f.unpack_sizes.get(li) else {
                return broken();
            };
            if out > MAX_HEADER || *packed > MAX_HEADER {
                return Err(Refusal::TooLarge(format!(
                    "The 7z header would take {} MiB (at most {} MiB) – refused",
                    out.max(*packed) >> 20,
                    MAX_HEADER >> 20
                )));
            }
            let Some(at) = 32u64
                .checked_add(info.pack_pos)
                .filter(|p| p.checked_add(*packed).is_some_and(|e| e <= len))
            else {
                return broken();
            };
            file.seek(SeekFrom::Start(at))?;
            let mut data = Vec::new();
            file.by_ref().take(*packed).read_to_end(&mut data)?;
            if let Some(ai) = aes {
                let Some(pw) = password.filter(|p| !p.is_empty()) else {
                    return Err(Refusal::PasswordRequired);
                };
                aes_decrypt(&f.coders[ai].props, pw, &mut data)?;
            }
            let encrypted = aes.is_some();
            let mut plain = Vec::new();
            // a decoding error is a broken (or wrongly decrypted) header, not I/O (N3)
            let decoded = lzma_reader(&f.coders[li], &data[..], out).and_then(|r| {
                r.take(out)
                    .read_to_end(&mut plain)
                    .map_err(|_| Refusal::Unknown("LZMA data of the header"))
            });
            let files = decoded.and_then(|_| files_in_header(&plain));
            match files {
                Ok(files) => Ok(Checked {
                    files,
                    encrypted_header: encrypted,
                    empty: false,
                }),
                // garbage after decryption: the password does not fit
                Err(_) if encrypted => Err(Refusal::PasswordWrong),
                Err(e) => Err(e),
            }
        }
        _ => Err(Refusal::Unknown("unknown header type")),
    }
}

/// Checks the 7z header on `file` (the handle `sevenz-rust2` will read next,
/// B4). Refuses headers above [`MAX_HEADER`], more than [`MAX_ENTRIES`] files,
/// and – fail-closed – anything it cannot judge. `password` opens AES headers.
pub fn check(file: &mut File, path: &Path, password: Option<&Secret>) -> Result<Checked, FsError> {
    match check_inner(file, password) {
        Ok(c) if c.files > MAX_ENTRIES as u64 => Err(too_large(
            format!(
                "The archive declares {} entries (at most {MAX_ENTRIES}) – refused",
                c.files
            ),
            path,
        )),
        Ok(c) => Ok(c),
        Err(Refusal::TooLarge(m)) => Err(too_large(m, path)),
        Err(Refusal::PasswordRequired) => Err(FsError::new(
            FsErrorCode::ArchivePasswordRequired,
            "The archive is encrypted – a password is needed",
            Some(path),
        )),
        Err(Refusal::PasswordWrong) => Err(super::password_wrong(path)),
        Err(Refusal::Io(e)) => Err(FsError::from_io(&e, path)),
        Err(Refusal::Unknown(why)) => Err(archive_error(
            format!("The 7z header cannot be checked ({why}) – not opened"),
            path,
        )),
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

    /// N1: folders are counted, not kept; more than [`MAX_ENTRIES`] are refused.
    #[test]
    fn many_folders_are_refused() {
        let n = 1_000_000u64;
        let mut d = vec![
            K_HEADER,
            K_MAIN_STREAMS,
            K_UNPACK_INFO,
            K_FOLDER,
            0xE0 | (n >> 24) as u8,
        ];
        d.extend_from_slice(&(n as u32).to_le_bytes()[..3]);
        d.push(0);
        for _ in 0..n {
            d.extend_from_slice(&[0x01, 0x00]);
        }
        d.push(K_CODERS_UNPACK_SIZE);
        d.extend(std::iter::repeat_n(0u8, n as usize));
        d.extend_from_slice(&[K_END, K_END, K_END]);
        assert!(files_in_header(&d).is_err());
    }

    /// N2: more key rounds than 7-Zip ever writes (19) plus margin are refused.
    #[test]
    fn aes_work_factor_is_bounded() {
        let mut data = [0u8; 16];
        let pw = Secret::new("geheim");
        let props = [
            0x40 | 23,
            0x0F,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];
        assert!(matches!(
            aes_decrypt(&props, &pw, &mut data),
            Err(Refusal::Unknown(_))
        ));
    }

    /// N2: a derived key is reused for the same salt, rounds and password only.
    #[test]
    fn derived_keys_are_cached_per_salt_rounds_and_password() {
        // an own cache: the global one is cleared and filled by tests running in parallel
        let cache = Mutex::new(Vec::new());
        let key = |salt: &[u8], cycles, pw: &[u8]| derived_key_in(&cache, salt, cycles, pw);
        let a = key(b"salt-n2", 4, b"g\0e\0");
        assert_eq!(key(b"salt-n2", 4, b"g\0e\0")[..], a[..]);
        assert_eq!(cache.lock().unwrap().len(), 1, "the second call is a hit");
        assert_ne!(key(b"salt-n2", 4, b"x\0")[..], a[..]);
        assert_ne!(key(b"salt-n2", 5, b"g\0e\0")[..], a[..]);
        assert_ne!(key(b"salt-n3", 4, b"g\0e\0")[..], a[..]);
        assert_eq!(cache.lock().unwrap().len(), KEYS_KEPT);
        // full: the oldest goes first
        key(b"salt-n4", 4, b"g\0e\0");
        let keys = cache.lock().unwrap();
        assert_eq!(keys.len(), KEYS_KEPT);
        assert!(
            !keys
                .iter()
                .any(|k| k.salt == b"salt-n2" && k.cycles == 4 && k.password[..] == *b"g\0e\0")
        );
        // the global cache is the same code
        drop(keys);
        assert_eq!(derived_key(b"salt-n2", 4, b"g\0e\0")[..], a[..]);
    }

    /// B2: huge declared counts are refused before anything is allocated.
    #[test]
    fn counts_need_bytes_behind_them() {
        // digests of 2^39 streams, "not all defined", 3 bytes left
        let mut c = Cursor {
            data: &[0x00, 0xFF, 0xFF, 0xFF],
            pos: 0,
        };
        assert!(c.skip_digests(1 << 39).is_err());
        // all defined: 2^39 × 4 CRC bytes cannot be there
        let mut c = Cursor {
            data: &[0x01, 0, 0, 0, 0],
            pos: 0,
        };
        assert!(c.skip_digests(1 << 39).is_err());
        // a count larger than the rest of the header
        let mut c = Cursor {
            data: &[0xC0, 0xFF, 0xFF],
            pos: 0,
        };
        assert!(c.count(u64::MAX).is_err());
        // a real bit vector: 10 bits, 3 set
        let mut c = Cursor {
            data: &[0b1010_0000, 0b0100_0000],
            pos: 0,
        };
        assert_eq!(c.count_bits(10).unwrap(), 3);
    }
}
