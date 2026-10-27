//! Rewrite ZIP, TAR and TAR.GZ archives (design 035 E2): never in place – the caller
//! names a temporary file next to the archive; entries that stay are copied **unchanged**
//! (ZIP: `raw_copy_file`, no recompression, encrypted ones too; TAR: the byte range of
//! every entry incl. its GNU/PAX headers), new entries are appended. What cannot be
//! judged safely (links as archives, unsafe or duplicate names, data before a ZIP) is
//! refused by [`writable`] before anything is written.

use super::{
    ArchiveFormat, ArchiveIndex, EntryType, TarEntries, archive_error, name_string, read_index,
    sanitize, secrets::Secret, tar_error, tar_stream, zip_error,
};
use crate::error::{FsError, FsErrorCode};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const BLOCK: usize = 1024 * 1024;
/// Compression of new ZIP entries and of a rewritten TAR.GZ (as packing, design 016 E5).
const LEVEL: u32 = 6;

pub fn read_only(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveReadOnly, message, Some(path))
}

/// Checks that `path` can be rewritten and returns its (fresh) index – see the module doc.
pub fn writable(path: &Path) -> Result<ArchiveIndex, FsError> {
    let meta = fs::symlink_metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    if meta.file_type().is_symlink() {
        return Err(read_only(
            "The archive is a link – open its target to change it",
            path,
        ));
    }
    if !meta.is_file() {
        return Err(archive_error("Not a file", path));
    }
    if meta.permissions().readonly() {
        return Err(read_only("The archive is write-protected", path));
    }
    // replacing the file would split its names into two different files (review 035 #9)
    if crate::platform::file_identity(path).is_some_and(|i| i.links > 1) {
        return Err(read_only(
            "The archive has several names (hard links) – it is not rewritten",
            path,
        ));
    }
    let index = read_index(path)?;
    match index.format {
        ArchiveFormat::Zip | ArchiveFormat::Tar | ArchiveFormat::TarGz => {}
        ArchiveFormat::SevenZ => {
            return Err(read_only("7z archives cannot be changed yet", path));
        }
        ArchiveFormat::Rar => {
            return Err(read_only("RAR archives cannot be changed (licence)", path));
        }
    }
    if index.unsafe_entries > 0 {
        return Err(read_only(
            "The archive holds entries with unsafe names – it is not rewritten",
            path,
        ));
    }
    // two entries of one name (in any order; a folder entry twice is harmless)
    let mut files = HashSet::new();
    let mut dirs = HashSet::new();
    for e in &index.entries {
        let dup = if e.kind == EntryType::Dir {
            dirs.insert(&e.name);
            false
        } else {
            !files.insert(&e.name)
        };
        if dup {
            return Err(read_only(
                "The archive holds two entries of the same name – it is not rewritten",
                path,
            ));
        }
    }
    // folders implied by deeper names count as folders too
    let mut implied: HashSet<&[String]> = HashSet::new();
    for e in &index.entries {
        for k in 1..e.name.len() {
            implied.insert(&e.name[..k]);
        }
    }
    if files
        .iter()
        .any(|n| dirs.contains(n) || implied.contains(n.as_slice()))
    {
        return Err(read_only(
            "The archive holds a file and a folder of the same name – it is not rewritten",
            path,
        ));
    }
    match index.format {
        ArchiveFormat::Zip => check_zip(path, index.archive_size)?,
        _ => {
            tar_ranges(path, index.format)?;
        }
    }
    Ok(index)
}

/// What a ZIP must look like to be rewritten (review 035 #1/#4): no data before it, no
/// ZipCrypto entries (`raw_copy_file` drops their encryption flag – they would turn into
/// garbage), entries that do not overlap and together are not larger than the file.
fn check_zip(path: &Path, archive_size: u64) -> Result<(), FsError> {
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let mut za = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| zip_error(e, path))?;
    if za.offset() != 0 {
        return Err(read_only(
            "Data before the ZIP (self-extracting archive) – it is not rewritten",
            path,
        ));
    }
    let mut spans: Vec<(u64, u64)> = Vec::with_capacity(za.len());
    let mut total = 0u64;
    for i in 0..za.len() {
        let f = za.by_index_raw(i).map_err(|e| zip_error(e, path))?;
        if f.encrypted() && !is_aes(&f) {
            return Err(read_only(
                "The ZIP uses the old ZipCrypto encryption – it cannot be rewritten safely",
                path,
            ));
        }
        let start = f.header_start();
        total = total.saturating_add(f.compressed_size());
        spans.push((start, start.saturating_add(f.compressed_size())));
    }
    spans.sort_unstable();
    let overlap = spans.windows(2).any(|w| w[0].1 >= w[1].0);
    if overlap || total > archive_size {
        return Err(read_only(
            "Entries of the ZIP overlap – it is not rewritten",
            path,
        ));
    }
    Ok(())
}

/// The entry carries the WinZip AES extra field (0x9901).
fn is_aes<R: Read>(f: &zip::read::ZipFile<'_, R>) -> bool {
    f.extra_data()
        .is_some_and(|x| x.windows(2).any(|w| w == [0x01, 0x99]))
}

/// Name → (CRC, compressed size, encrypted) of every ZIP entry: the kept entries of a
/// rewritten ZIP must still be what they were (review 035 #1).
pub fn zip_fingerprints(
    path: &Path,
) -> Result<std::collections::HashMap<String, (u32, u64, bool)>, FsError> {
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let mut za = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| zip_error(e, path))?;
    let mut out = std::collections::HashMap::new();
    for i in 0..za.len() {
        let f = za.by_index_raw(i).map_err(|e| zip_error(e, path))?;
        let name = f.name().map_err(|e| zip_error(e, path))?.into_owned();
        out.insert(name, (f.crc32(), f.compressed_size(), f.encrypted()));
    }
    Ok(out)
}

/// A new entry: a folder or the content of a local file.
#[derive(Debug, Clone)]
pub struct NewEntry {
    /// Checked name components inside the archive.
    pub name: Vec<String>,
    /// `None` = a folder.
    pub source: Option<PathBuf>,
    pub len: u64,
    pub mode: u32,
    pub modified: Option<SystemTime>,
}

/// What changes: entries at or below one of `remove` go, `add` is appended.
#[derive(Debug, Clone, Default)]
pub struct Change {
    pub remove: Vec<Vec<String>>,
    pub add: Vec<NewEntry>,
}

impl Change {
    pub fn removes(&self, name: &[String]) -> bool {
        !name.is_empty() && self.remove.iter().any(|r| name.starts_with(r))
    }
}

/// Why rewriting stopped.
#[derive(Debug)]
pub enum Fail {
    Cancelled,
    Error(FsError),
}

impl From<FsError> for Fail {
    fn from(e: FsError) -> Self {
        Fail::Error(e)
    }
}

/// Progress: bytes handled since the last call; `false` = cancel.
pub type Tick<'a> = dyn FnMut(u64) -> bool + 'a;

fn io_fail(e: io::Error, path: &Path) -> Fail {
    if e.kind() == io::ErrorKind::Interrupted && e.to_string() == "cancelled" {
        return Fail::Cancelled;
    }
    Fail::Error(FsError::from_io(&e, path))
}

/// Writes the new archive to `tmp` (which must not exist). The caller removes `tmp` on error.
pub fn rewrite(
    path: &Path,
    format: ArchiveFormat,
    change: &Change,
    password: Option<&Secret>,
    tmp: &Path,
    tick: &mut Tick<'_>,
) -> Result<(), Fail> {
    let out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| Fail::Error(FsError::from_io(&e, tmp)))?;
    let out = BufWriter::new(out);
    let file = match format {
        ArchiveFormat::Zip => rewrite_zip(path, change, password, out, tick)?,
        ArchiveFormat::Tar => {
            let w = rewrite_tar(path, format, change, out, tick)?;
            w.into_inner().map_err(|e| io_fail(e.into_error(), tmp))?
        }
        ArchiveFormat::TarGz => {
            let gz = flate2::write::GzEncoder::new(out, flate2::Compression::new(LEVEL));
            let gz = rewrite_tar(path, format, change, gz, tick)?;
            let w = gz.finish().map_err(|e| io_fail(e, tmp))?;
            w.into_inner().map_err(|e| io_fail(e.into_error(), tmp))?
        }
        ArchiveFormat::SevenZ | ArchiveFormat::Rar => {
            return Err(Fail::Error(read_only("Not changeable", path)));
        }
    };
    file.sync_all().map_err(|e| io_fail(e, tmp))?;
    Ok(())
}

/// Reads a source file, reports progress, stops on cancel and fails if the file is not
/// exactly `left` bytes long (a TAR header promises the size – review 016 #4).
struct Source<'t, 'a> {
    inner: File,
    left: u64,
    tick: &'t mut Tick<'a>,
}

impl Read for Source<'_, '_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.left == 0 {
            // a file that grew while it was added fails instead of being cut (review 035 #3)
            let mut probe = [0u8; 1];
            if self.inner.read(&mut probe)? > 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "The file grew while it was added",
                ));
            }
            return Ok(0);
        }
        let max = buf
            .len()
            .min(usize::try_from(self.left).unwrap_or(usize::MAX));
        let n = self.inner.read(&mut buf[..max])?;
        if n == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "The file became shorter while it was added",
            ));
        }
        self.left -= n as u64;
        if !(self.tick)(n as u64) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        Ok(n)
    }
}

fn open_source<'t, 'a>(e: &NewEntry, tick: &'t mut Tick<'a>) -> Result<Source<'t, 'a>, Fail> {
    let src = e.source.as_ref().expect("a file");
    let f = crate::platform::open_regular_file_no_follow(src)
        .map_err(|err| Fail::Error(FsError::from_io(&err, src)))?;
    Ok(Source {
        inner: f,
        left: e.len,
        tick,
    })
}

fn rewrite_zip(
    path: &Path,
    change: &Change,
    password: Option<&Secret>,
    out: BufWriter<File>,
    tick: &mut Tick<'_>,
) -> Result<File, Fail> {
    let file = File::open(path).map_err(|e| Fail::Error(FsError::from_io(&e, path)))?;
    let mut za = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| zip_error(e, path))?;
    let mut zw = zip::ZipWriter::new(out);
    for i in 0..za.len() {
        let f = za.by_index_raw(i).map_err(|e| zip_error(e, path))?;
        let name = f.name().map_err(|e| zip_error(e, path))?;
        let comps = sanitize(&name).map_err(|why| read_only(why, path))?;
        let bytes = f.compressed_size();
        if !change.removes(&comps) {
            zw.raw_copy_file(f).map_err(|e| zip_error(e, path))?;
        }
        if !tick(bytes) {
            return Err(Fail::Cancelled);
        }
    }
    for e in &change.add {
        let rel = e.name.join("/");
        match &e.source {
            None => {
                let opts = crate::jobs::pack::zip_options(e.modified, e.mode, None);
                zw.add_directory(format!("{rel}/"), opts)
                    .map_err(|err| zip_error(err, path))?;
            }
            Some(_) => {
                let opts = crate::jobs::pack::zip_options(e.modified, e.mode, password)
                    .compression_method(zip::CompressionMethod::Deflated)
                    .compression_level(Some(i64::from(LEVEL)))
                    .large_file(e.len >= u64::from(u32::MAX));
                zw.start_file(rel, opts)
                    .map_err(|err| zip_error(err, path))?;
                let mut src = open_source(e, tick)?;
                io::copy(&mut src, &mut zw).map_err(|err| io_fail(err, path))?;
            }
        }
    }
    zw.set_raw_comment(za.comment().into())
        .map_err(|e| zip_error(e, path))?;
    let w = zw.finish().map_err(|e| zip_error(e, path))?;
    w.into_inner()
        .map_err(|e| Fail::Error(FsError::from_io(e.error(), path)))
}

/// One entry of a TAR stream: its bytes `[start, end)` (headers, data, padding) and name.
struct Range {
    start: u64,
    /// Where the entry's own header starts (`[start, header)` = its GNU/PAX headers).
    header: u64,
    end: u64,
    name: Vec<String>,
}

fn pad(n: u64) -> u64 {
    n.div_ceil(512) * 512
}

/// First pass: where every entry lies in the (unpacked) stream.
fn tar_ranges(path: &Path, format: ArchiveFormat) -> Result<Vec<Range>, FsError> {
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let size = file
        .metadata()
        .map_err(|e| FsError::from_io(&e, path))?
        .len();
    let mut archive = tar::Archive::new(tar_stream(file, format, size));
    let raw = archive.entries().map_err(|e| tar_error(&e, path))?;
    let mut out: Vec<Range> = Vec::new();
    let mut prev = 0u64;
    for item in TarEntries::new(raw) {
        let (_, name, entry) = item.map_err(|e| tar_error(&e, path))?;
        if entry.header().entry_type() == tar::EntryType::Link {
            // a hard link has no data of its own: removing its target would empty it (#5)
            return Err(read_only(
                "The TAR holds hard links – it is not rewritten",
                path,
            ));
        }
        let start_data = entry.raw_file_position();
        if entry.raw_header_position() < prev || start_data < entry.raw_header_position() {
            return Err(read_only("Unexpected TAR layout – not rewritten", path));
        }
        let end = start_data
            .checked_add(pad(entry.size()))
            .ok_or_else(|| read_only("Unexpected TAR layout – not rewritten", path))?;
        let name = sanitize(&name_string(name)).map_err(|why| read_only(why, path))?;
        if entry.raw_header_position() - prev > MAX_PREFIX {
            return Err(read_only("Unexpected TAR layout – not rewritten", path));
        }
        out.push(Range {
            start: prev,
            header: entry.raw_header_position(),
            end,
            name,
        });
        prev = end;
    }
    // anything but zeros after the end marker (a second archive appended) would be lost (#6)
    let mut rest = archive.into_inner();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = rest.read(&mut buf).map_err(|e| tar_error(&e, path))?;
        if n == 0 {
            break;
        }
        if buf[..n].iter().any(|b| *b != 0) {
            return Err(read_only(
                "Data after the end of the TAR – it is not rewritten",
                path,
            ));
        }
    }
    Ok(out)
}

/// Largest run of GNU/PAX headers in front of one entry that a rewrite reads at once.
const MAX_PREFIX: u64 = 16 << 20;

/// The PAX global headers (`g`) among the headers in front of a removed entry – they apply
/// to every later entry and must stay (review 035 #7).
fn global_headers(prefix: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut o = 0usize;
    while o + 512 <= prefix.len() {
        let h = &prefix[o..o + 512];
        let size = std::str::from_utf8(&h[124..136])
            .ok()
            .map(|t| t.trim_matches(|c: char| c == '\0' || c == ' '))
            .and_then(|t| u64::from_str_radix(t, 8).ok())
            .unwrap_or(0);
        let total = 512 + usize::try_from(pad(size)).unwrap_or(usize::MAX);
        let end = o.saturating_add(total).min(prefix.len());
        if h[156] == b'g' {
            out.extend_from_slice(&prefix[o..end]);
        }
        o = o.saturating_add(total);
    }
    out
}

/// Copies `n` bytes from `r` to `w` (or skips them with `w = None`), reporting progress.
fn pass_bytes(
    r: &mut dyn Read,
    w: Option<&mut dyn Write>,
    n: u64,
    buf: &mut [u8],
    tick: &mut Tick<'_>,
    path: &Path,
) -> Result<(), Fail> {
    let mut left = n;
    let mut w = w;
    while left > 0 {
        let max = buf.len().min(usize::try_from(left).unwrap_or(usize::MAX));
        let got = r.read(&mut buf[..max]).map_err(|e| io_fail(e, path))?;
        if got == 0 {
            return Err(Fail::Error(archive_error("The archive ended early", path)));
        }
        if let Some(w) = w.as_mut() {
            w.write_all(&buf[..got]).map_err(|e| io_fail(e, path))?;
        }
        left -= got as u64;
        if !tick(got as u64) {
            return Err(Fail::Cancelled);
        }
    }
    Ok(())
}

fn rewrite_tar<W: Write>(
    path: &Path,
    format: ArchiveFormat,
    change: &Change,
    mut out: W,
    tick: &mut Tick<'_>,
) -> Result<W, Fail> {
    let ranges = tar_ranges(path, format)?;
    // second pass: the same stream again, byte ranges copied or skipped
    let file = File::open(path).map_err(|e| Fail::Error(FsError::from_io(&e, path)))?;
    let size = file
        .metadata()
        .map_err(|e| Fail::Error(FsError::from_io(&e, path)))?
        .len();
    let mut stream = tar_stream(file, format, size);
    let mut buf = vec![0u8; BLOCK];
    for r in &ranges {
        if !change.removes(&r.name) {
            pass_bytes(
                &mut stream,
                Some(&mut out),
                r.end - r.start,
                &mut buf,
                tick,
                path,
            )?;
            continue;
        }
        // removed: only its PAX global headers stay
        let mut prefix = vec![0u8; usize::try_from(r.header - r.start).unwrap_or(0)];
        stream
            .read_exact(&mut prefix)
            .map_err(|e| io_fail(e, path))?;
        out.write_all(&global_headers(&prefix))
            .map_err(|e| io_fail(e, path))?;
        pass_bytes(&mut stream, None, r.end - r.header, &mut buf, tick, path)?;
    }
    let mut b = tar::Builder::new(out);
    for e in &change.add {
        let rel = e.name.join("/");
        let mut h = tar::Header::new_gnu();
        h.set_mode(e.mode);
        h.set_mtime(
            e.modified
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs()),
        );
        match &e.source {
            None => {
                h.set_entry_type(tar::EntryType::Directory);
                h.set_size(0);
                b.append_data(&mut h, format!("{rel}/"), io::empty())
                    .map_err(|err| io_fail(err, path))?;
            }
            Some(_) => {
                h.set_entry_type(tar::EntryType::Regular);
                h.set_size(e.len);
                let src = open_source(e, tick)?;
                b.append_data(&mut h, &rel, src)
                    .map_err(|err| io_fail(err, path))?;
            }
        }
    }
    b.into_inner().map_err(|e| io_fail(e, path))
}

/// Bytes the rewrite reads and writes (for the progress total): the archive (ZIP: the
/// compressed entries; TAR: the unpacked stream – estimated by the entry sizes) plus the
/// new files.
pub fn work_total(index: &ArchiveIndex, change: &Change) -> u64 {
    let base = match index.format {
        ArchiveFormat::Zip => index.archive_size,
        _ => index.entries.iter().map(|e| 512 + pad(e.size)).sum::<u64>(),
    };
    base + change.add.iter().map(|e| e.len).sum::<u64>()
}

#[cfg(test)]
mod tests;
