//! 7z archives (design 025 E2/E3) through `sevenz-rust2` (pure Rust).
//! Reading the header, mapping entries to the common index, the memory check
//! of a block before it is decoded, and error mapping. Extraction streams a
//! block at a time (`jobs/extract.rs`), packing writes one block per file
//! (`jobs/pack.rs`).

use super::secrets::Secret;
use super::{EntryType, MAX_DICT, RawEntry};
use crate::error::{FsError, FsErrorCode};
use sevenz_rust2::{Archive, Block, EncoderMethod, Password};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// `FILE_ATTRIBUTE_UNIX_EXTENSION`: the high 16 bits hold the Unix mode.
const UNIX_EXTENSION: u32 = 0x8000;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const S_IFMT: u32 = 0o170000;
const S_IFREG: u32 = 0o100000;
const S_IFDIR: u32 = 0o040000;
const S_IFLNK: u32 = 0o120000;
const FILETIME_UNIX_DIFF_MS: i64 = 11_644_473_600_000;

pub(crate) fn password_of(secret: Option<&Secret>) -> Password {
    secret.map_or_else(Password::empty, |s| Password::new(s.expose()))
}

/// Maps a crate error; `encrypted` = a password was in play.
pub(crate) fn map_error(e: sevenz_rust2::Error, path: &Path, encrypted: bool) -> FsError {
    use sevenz_rust2::Error as E;
    match e {
        E::PasswordRequired => FsError::new(
            FsErrorCode::ArchivePasswordRequired,
            "The archive is encrypted – a password is needed",
            Some(path),
        ),
        E::MaybeBadPassword(_) => FsError::new(
            FsErrorCode::ArchivePasswordWrong,
            "Wrong password",
            Some(path),
        ),
        E::ChecksumVerificationFailed if encrypted => FsError::new(
            FsErrorCode::ArchivePasswordWrong,
            "Wrong password (or a broken archive)",
            Some(path),
        ),
        E::Io(io, _) | E::FileOpen(io, _) => match io.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => {
                FsError::from_io(&io, path)
            }
            _ if encrypted => FsError::new(
                FsErrorCode::ArchivePasswordWrong,
                "Wrong password (or a broken archive)",
                Some(path),
            ),
            _ => super::archive_error(format!("Broken archive: {io}"), path),
        },
        E::MaxMemLimited { .. } => super::too_large(
            "The archive needs too much memory to unpack – refused",
            path,
        ),
        E::UnsupportedCompressionMethod(m) => {
            super::archive_error(format!("Compression method {m} is not supported"), path)
        }
        E::ExternalUnsupported | E::Unsupported(_) => {
            super::archive_error("This 7z feature is not supported", path)
        }
        other => super::archive_error(format!("Broken archive: {other:?}"), path),
    }
}

/// Reads the header. Without a password first: header-encrypted archives
/// (`7z -mhe`) need the one in the store (`header_encrypted` = true then).
pub(crate) fn open(path: &Path) -> Result<(BufReader<File>, Archive, bool), FsError> {
    // the crate unpacks the header without limits: check its size and file count first
    super::sevenz_header::check(path)?;
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let mut reader = BufReader::new(file);
    match Archive::read(&mut reader, &Password::empty()) {
        Ok(a) => Ok((reader, a, false)),
        Err(sevenz_rust2::Error::PasswordRequired) => {
            let Some(secret) = super::secrets::get(path) else {
                return Err(map_error(
                    sevenz_rust2::Error::PasswordRequired,
                    path,
                    false,
                ));
            };
            let a = Archive::read(&mut reader, &password_of(Some(&secret)))
                .map_err(|e| map_error(e, path, true))?;
            Ok((reader, a, true))
        }
        Err(e) => Err(map_error(e, path, false)),
    }
}

pub(crate) fn block_encrypted(block: &Block) -> bool {
    block
        .coders
        .iter()
        .any(|c| c.encoder_method_id() == EncoderMethod::ID_AES256_SHA256)
}

fn le_u32(p: &[u8]) -> Option<u64> {
    p.get(..4)
        .map(|b| u64::from(u32::from_le_bytes([b[0], b[1], b[2], b[3]])))
}

/// Dictionary / model memory a coder asks for (LZMA, LZMA2, PPMd), from its properties.
pub(crate) fn memory_need(method: &[u8], props: &[u8]) -> Option<u64> {
    match method {
        id if id == EncoderMethod::ID_LZMA || id == EncoderMethod::ID_PPMD => {
            props.get(1..).and_then(le_u32)
        }
        id if id == EncoderMethod::ID_LZMA2 => props.first().map(|b| {
            let bits = u32::from(*b & 0x3F);
            if bits > 40 {
                u64::MAX
            } else if bits == 40 {
                u64::from(u32::MAX)
            } else {
                u64::from(2 | (bits & 1)) << (bits / 2 + 11)
            }
        }),
        _ => None,
    }
}

/// Refuses blocks whose decoder would allocate more than [`MAX_DICT`] (the
/// crate allows any size: a 4 GiB LZMA dictionary in a tiny archive).
pub(crate) fn check_memory(block: &Block, path: &Path) -> Result<(), FsError> {
    for c in &block.coders {
        if memory_need(c.encoder_method_id(), c.properties()).is_some_and(|n| n > MAX_DICT) {
            return Err(super::too_large(
                "The archive needs a dictionary larger than 1 GiB – refused",
                path,
            ));
        }
    }
    Ok(())
}

fn ms_of(t: sevenz_rust2::NtTime) -> Option<i64> {
    let ft: u64 = t.into();
    if ft == 0 {
        return None;
    }
    i64::try_from(ft / 10_000)
        .ok()
        .map(|ms| ms - FILETIME_UNIX_DIFF_MS)
}

/// The entries of a 7z archive for the common index (anti-items are skipped).
pub(crate) fn raw_entries(archive: &Archive) -> Vec<RawEntry> {
    let mut out = Vec::with_capacity(archive.files.len());
    for (i, e) in archive.files.iter().enumerate() {
        if e.is_anti_item {
            continue;
        }
        let attr = if e.has_windows_attributes {
            e.windows_attributes
        } else {
            0
        };
        let unix = attr & UNIX_EXTENSION != 0;
        let mode = unix.then_some(attr >> 16);
        let fmt = mode.map_or(0, |m| m & S_IFMT);
        let kind = if e.is_directory {
            EntryType::Dir
        } else if fmt == S_IFLNK || (!unix && attr & FILE_ATTRIBUTE_REPARSE_POINT != 0) {
            EntryType::Link
        } else if fmt != 0 && fmt != S_IFREG && fmt != S_IFDIR {
            EntryType::Other
        } else {
            EntryType::File
        };
        let encrypted = archive
            .stream_map
            .file_block_index
            .get(i)
            .copied()
            .flatten()
            .and_then(|b| archive.blocks.get(b))
            .is_some_and(block_encrypted);
        out.push(RawEntry {
            name: e.name.clone(),
            kind,
            size: e.size,
            modified_ms: if e.has_last_modified_date {
                ms_of(e.last_modified_date)
            } else {
                None
            },
            mode: mode.map(|m| m & 0o777),
            pos: i,
            encrypted,
        });
    }
    out
}

/// Modification time → 7z time (100 ns since 1601).
pub(crate) fn nt_time(t: Option<std::time::SystemTime>) -> Option<sevenz_rust2::NtTime> {
    t.and_then(|t| sevenz_rust2::NtTime::try_from(t).ok())
}

/// Unix mode → 7z attributes (Unix extension + Windows read-only/directory bits).
pub(crate) fn attributes(mode: u32, dir: bool) -> u32 {
    let fmt = if dir { S_IFDIR } else { S_IFREG };
    let mut attr = UNIX_EXTENSION | ((fmt | (mode & 0o7777)) << 16);
    if dir {
        attr |= 0x10;
    }
    if mode & 0o200 == 0 {
        attr |= 0x1;
    }
    attr
}
