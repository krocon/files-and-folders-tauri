//! Pack job (design 016 E5, 025 E4/E6): sources into a new ZIP/7z/TAR/TAR.GZ –
//! ZIP with AES-256 and 7z with AES-256 + encrypted names if a password is
//! given (never ZipCrypto, never RAR). Planned like
//! copying (`copy::walk`, links never followed – they are skipped and
//! reported), written to `.fnf-<job>.part` next to the target and renamed to
//! its name at the end; an existing archive raises the conflict question.
//! An error while an entry's data is written leaves a broken stream: the job
//! fails and the temporary file goes.

use super::ask::Asker;
use super::copy::{self, ItemKind, Plan, Top};
use super::report::Reporter;
use super::{
    Control, Decision, FileMeta, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary,
};
use crate::archive::secrets::Secret;
use crate::archive::{ArchiveFormat, sevenz, zip_ext_time, zip_time};
use crate::error::{FsError, FsErrorCode};
use crate::paths::{normalize_lexically, validate_name};
use crate::platform::{open_regular_file_no_follow, rename_noreplace};
use std::collections::HashSet;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, BufWriter, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const DEFAULT_LEVEL: u32 = 6;

/// Reads a source and counts the bytes; stops on cancel (and waits while paused).
struct Counting<'a, 'b, R> {
    inner: R,
    control: &'a Control,
    rep: &'a mut Reporter<'b>,
    cancelled: bool,
}

impl<R: Read> Read for Counting<'_, '_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.control.is_cancelled() || !self.control.wait_while_paused() {
            self.cancelled = true;
            return Err(io::Error::other("cancelled"));
        }
        let n = self.inner.read(buf)?;
        self.rep.progress.bytes_done += n as u64;
        self.rep.tick(false);
        Ok(n)
    }
}

/// Yields exactly `left` bytes or fails with `UnexpectedEof` (review 016 #4): a
/// TAR header is written before the data, so a file that shrinks while it is
/// read must fail its entry (and the job) instead of desyncing the archive.
struct ExactLen<'r> {
    inner: &'r mut dyn Read,
    left: u64,
}

impl<'r> ExactLen<'r> {
    fn new(inner: &'r mut dyn Read, len: u64) -> Self {
        Self { inner, left: len }
    }
}

impl Read for ExactLen<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.left == 0 {
            return Ok(0);
        }
        let max = buf
            .len()
            .min(usize::try_from(self.left).unwrap_or(usize::MAX));
        let n = self.inner.read(&mut buf[..max])?;
        if n == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "The file became shorter while it was packed",
            ));
        }
        self.left -= n as u64;
        Ok(n)
    }
}

enum Writer {
    /// ZIP and the password for its entries (AES-256).
    Zip(Box<zip::ZipWriter<BufWriter<File>>>, Option<Secret>),
    Tar(Box<tar::Builder<BufWriter<File>>>),
    TarGz(Box<tar::Builder<flate2::write::GzEncoder<BufWriter<File>>>>),
    /// 7z, one block per file (design 025 E6).
    SevenZ(Box<sevenz_rust2::ArchiveWriter<BufWriter<File>>>),
}

/// Options of a ZIP entry: local time + Extended Timestamp (design 025 E7),
/// AES-256 with a password.
fn zip_options<'k>(
    modified: Option<std::time::SystemTime>,
    mode: u32,
    password: Option<&'k Secret>,
) -> zip::write::FullFileOptions<'k, 'static> {
    let mut o = zip::write::FullFileOptions::default()
        .last_modified_time(zip_time(modified))
        .unix_permissions(mode);
    if let Some(ext) = zip_ext_time(modified) {
        // only fails beyond 64 KiB of extra data
        let _ = o.add_extra_field(0x5455, ext, false);
    }
    if let Some(pw) = password {
        o = o.with_aes_encryption(zip::AesMode::Aes256, pw.expose());
    }
    o
}

/// A 7z entry with time and Unix mode.
fn sevenz_entry(
    rel: &str,
    dir: bool,
    mode: u32,
    modified: Option<std::time::SystemTime>,
) -> sevenz_rust2::ArchiveEntry {
    let mut e = if dir {
        sevenz_rust2::ArchiveEntry::new_directory(rel)
    } else {
        sevenz_rust2::ArchiveEntry::new_file(rel)
    };
    if let Some(t) = sevenz::nt_time(modified) {
        e.last_modified_date = t;
        e.has_last_modified_date = true;
    }
    e.windows_attributes = sevenz::attributes(mode, dir);
    e.has_windows_attributes = true;
    e
}

fn sevenz_io(e: sevenz_rust2::Error) -> io::Error {
    match e {
        sevenz_rust2::Error::Io(io, _) | sevenz_rust2::Error::FileOpen(io, _) => io,
        other => io::Error::other(format!("{other:?}")),
    }
}

impl Writer {
    fn add_dir(&mut self, rel: &str, meta: Option<&Metadata>) -> Result<(), FsError> {
        let mode = meta.map_or(0o755, mode_of);
        let modified = meta.and_then(|m| m.modified().ok());
        let tar_dir = |b: &mut dyn FnMut(&mut tar::Header) -> io::Result<()>| {
            let mut h = tar::Header::new_gnu();
            h.set_entry_type(tar::EntryType::Directory);
            h.set_size(0);
            h.set_mode(mode);
            h.set_mtime(secs(modified));
            b(&mut h)
        };
        let io_err = |e: io::Error| FsError::new(FsErrorCode::Io, e.to_string(), None);
        match self {
            Writer::Zip(z, _) => {
                // folders are never encrypted (they have no data)
                let opts = zip_options(modified, mode, None);
                z.add_directory(format!("{rel}/"), opts)
                    .map_err(|e| crate::archive::zip_error(e, Path::new(rel)))
            }
            Writer::SevenZ(w) => w
                .push_archive_entry(sevenz_entry(rel, true, mode, modified), None::<&[u8]>)
                .map(|_| ())
                .map_err(|e| io_err(sevenz_io(e))),
            Writer::Tar(b) => {
                tar_dir(&mut |h| b.append_data(h, format!("{rel}/"), io::empty())).map_err(io_err)
            }
            Writer::TarGz(b) => {
                tar_dir(&mut |h| b.append_data(h, format!("{rel}/"), io::empty())).map_err(io_err)
            }
        }
    }

    fn add_file(
        &mut self,
        rel: &str,
        meta: &Metadata,
        level: u32,
        reader: &mut dyn Read,
    ) -> io::Result<()> {
        let len = meta.len();
        let header = || {
            let mut h = tar::Header::new_gnu();
            h.set_entry_type(tar::EntryType::Regular);
            h.set_size(len);
            h.set_mode(mode_of(meta));
            h.set_mtime(secs(meta.modified().ok()));
            h
        };
        match self {
            Writer::Zip(z, password) => {
                let opts = zip_options(meta.modified().ok(), mode_of(meta), password.as_ref())
                    .compression_method(zip::CompressionMethod::Deflated)
                    .compression_level(Some(i64::from(level)))
                    .large_file(len >= u64::from(u32::MAX));
                z.start_file(rel, opts)
                    .map_err(|e| io::Error::other(e.to_string()))?;
                io::copy(reader, z.as_mut()).map(|_| ())
            }
            Writer::SevenZ(w) => {
                let entry = sevenz_entry(rel, false, mode_of(meta), meta.modified().ok());
                // the size recorded is what was read: a shrinking file stays consistent
                w.push_archive_entry(entry, Some(reader))
                    .map(|_| ())
                    .map_err(sevenz_io)
            }
            // the header promises `len` bytes: a file that shrank fails instead of a broken archive
            Writer::Tar(b) => b.append_data(&mut header(), rel, ExactLen::new(reader, len)),
            Writer::TarGz(b) => b.append_data(&mut header(), rel, ExactLen::new(reader, len)),
        }
    }

    /// Completes the archive (central directory, tar end blocks, gzip trailer).
    fn finish(self) -> io::Result<File> {
        let unbuffer = |w: BufWriter<File>| w.into_inner().map_err(|e| e.into_error());
        match self {
            Writer::Zip(z, _) => z
                .finish()
                .map_err(|e| io::Error::other(e.to_string()))
                .and_then(unbuffer),
            Writer::SevenZ(w) => w.finish().and_then(unbuffer),
            Writer::Tar(b) => b.into_inner().and_then(unbuffer),
            Writer::TarGz(b) => b.into_inner()?.finish().and_then(unbuffer),
        }
    }
}

fn mode_of(m: &Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        m.permissions().mode() & 0o777
    }
    #[cfg(not(unix))]
    {
        if m.is_dir() {
            0o755
        } else if m.permissions().readonly() {
            0o444
        } else {
            0o644
        }
    }
}

/// The `/`-separated name in the archive (`None` for names that are not UTF-8).
fn entry_name(rel: &Path) -> Option<String> {
    let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
    parts.map(|p| p.join("/"))
}

enum Fatal {
    Cancelled,
    Error(FsError),
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    sources: &[PathBuf],
    target_dir: &Path,
    name: &str,
    format: ArchiveFormat,
    level: Option<u32>,
    password: Option<&Secret>,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut rep = Reporter::new(id, emit);
    let mut summary = Summary::default();
    let state = |rep: &Reporter<'_>, s| {
        rep.emit(JobEvent::State {
            id: id.to_string(),
            state: s,
        })
    };
    state(&rep, JobState::Planning);
    let failed = |mut summary: Summary, e: FsError| {
        summary.error = Some(e);
        (JobState::Failed, summary)
    };
    let fail = |summary: &mut Summary, rep: &Reporter<'_>, path: &Path, error: FsError| {
        summary.items_failed += 1;
        let item = ItemError {
            path: path.to_string_lossy().into_owned(),
            error,
        };
        if summary.items_failed <= 100 {
            rep.item_failed(item.clone());
        }
        if summary.errors.len() < MAX_REPORTED_ERRORS {
            summary.errors.push(item);
        }
    };
    if let Err(e) = validate_name(name) {
        return failed(summary, e);
    }
    let password = password.filter(|p| !p.is_empty());
    if format == ArchiveFormat::Rar
        || (password.is_some() && !matches!(format, ArchiveFormat::Zip | ArchiveFormat::SevenZ))
    {
        let e = FsError::new(
            FsErrorCode::InvalidPath,
            if format == ArchiveFormat::Rar {
                "RAR archives cannot be created (licence) – choose ZIP or 7z"
            } else {
                "Only ZIP and 7z can be encrypted"
            },
            None,
        );
        return failed(summary, e);
    }
    match fs::metadata(target_dir) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => {
            let e = FsError::new(
                FsErrorCode::NotADirectory,
                "The target is not a folder",
                Some(target_dir),
            );
            return failed(summary, e);
        }
        Err(e) => return failed(summary, FsError::from_io(&e, target_dir)),
    }

    // plan: every source under its own name (two sources of one name collide – the second fails)
    let mut plan = Plan::default();
    let mut tops = Vec::new();
    let mut names = HashSet::new();
    for src in super::drop_nested(sources) {
        let src = normalize_lexically(&src);
        let Some(top_name) = src.file_name().map(|n| n.to_os_string()) else {
            return failed(
                summary,
                FsError::new(
                    FsErrorCode::InvalidPath,
                    "A drive or root cannot be packed",
                    Some(&src),
                ),
            );
        };
        if !names.insert(top_name.to_string_lossy().to_lowercase()) {
            fail(
                &mut summary,
                &rep,
                &src,
                FsError::new(
                    FsErrorCode::AlreadyExists,
                    "Another entry with this name is packed already",
                    Some(&src),
                ),
            );
            continue;
        }
        match fs::symlink_metadata(&src) {
            Ok(meta) => tops.push(Top {
                src,
                dst: PathBuf::from(top_name),
                meta,
            }),
            Err(e) => fail(&mut summary, &rep, &src, FsError::from_io(&e, &src)),
        }
    }
    if !copy::walk(tops, &mut plan, control) {
        return (JobState::Cancelled, summary);
    }
    summary.items_failed += plan.more_errors;
    for e in std::mem::take(&mut plan.errors) {
        let p = PathBuf::from(&e.path);
        fail(&mut summary, &rep, &p, e.error);
    }

    // the target: ask if it exists
    let mut target = target_dir.join(name);
    let mut overwrite = false;
    let mut asker = Asker::new(None);
    while let Ok(tm) = fs::symlink_metadata(&target) {
        if tm.is_dir() {
            let e = FsError::new(
                FsErrorCode::NotAFile,
                "A folder with this name exists",
                Some(&target),
            );
            return failed(summary, e);
        }
        let source = FileMeta {
            size: Some(plan.bytes_total),
            modified_ms: None,
            is_dir: false,
        };
        let label = name.to_string();
        match asker.ask(id, control, &rep, &label, source, &target, &tm) {
            None => return (JobState::Cancelled, summary),
            Some(Decision::Overwrite | Decision::OverwriteIfNewer) => {
                overwrite = true;
                break;
            }
            Some(Decision::Skip) => {
                summary.items_skipped = plan.items.len() as u64;
                return (JobState::Done, summary);
            }
            Some(Decision::Rename { new_name }) => {
                let n = new_name.unwrap_or_else(|| copy::suggest_name(&target));
                if let Err(e) = validate_name(&n) {
                    return failed(summary, e);
                }
                target = target.with_file_name(n);
            }
            Some(Decision::Cancel) => {
                control.cancel();
                return (JobState::Cancelled, summary);
            }
        }
    }
    let target_norm = normalize_lexically(&target);

    rep.progress.items_total = plan.items.len() as u64;
    rep.progress.bytes_total = plan.bytes_total;
    state(
        &rep,
        if control.is_paused() {
            JobState::Paused
        } else {
            JobState::Running
        },
    );
    rep.tick(true);

    let tmp = target_dir.join(format!(".fnf-{id}.part"));
    let file = match OpenOptions::new().write(true).create_new(true).open(&tmp) {
        Ok(f) => f,
        Err(e) => return failed(summary, FsError::from_io(&e, &target)),
    };
    let level = level.unwrap_or(DEFAULT_LEVEL).clamp(1, 9);
    let mut writer = match format {
        ArchiveFormat::Zip => Writer::Zip(
            Box::new(zip::ZipWriter::new(BufWriter::new(file))),
            password.cloned(),
        ),
        ArchiveFormat::Tar => Writer::Tar(Box::new(tar::Builder::new(BufWriter::new(file)))),
        ArchiveFormat::TarGz => Writer::TarGz(Box::new(tar::Builder::new(
            flate2::write::GzEncoder::new(BufWriter::new(file), flate2::Compression::new(level)),
        ))),
        ArchiveFormat::SevenZ => {
            let made = sevenz_rust2::ArchiveWriter::new(BufWriter::new(file)).map(|mut w| {
                let lzma2 = sevenz_rust2::encoder_options::Lzma2Options::from_level(level);
                match password {
                    Some(pw) => {
                        w.set_content_methods(vec![
                            sevenz_rust2::encoder_options::AesEncoderOptions::new(
                                sevenz::password_of(Some(pw)),
                            )
                            .into(),
                            lzma2.into(),
                        ]);
                        // names are encrypted too (design 025 E4)
                        w.set_encrypt_header(true);
                    }
                    None => {
                        w.set_content_methods(vec![lzma2.into()]);
                        w.set_encrypt_header(false);
                    }
                }
                w
            });
            match made {
                Ok(w) => Writer::SevenZ(Box::new(w)),
                Err(e) => {
                    let _ = fs::remove_file(&tmp);
                    return failed(summary, FsError::from_io(&sevenz_io(e), &target));
                }
            }
        }
        ArchiveFormat::Rar => unreachable!("refused above"),
    };

    let result = (|| -> Result<(), Fatal> {
        for item in &plan.items {
            if control.is_cancelled() || !control.wait_while_paused() {
                return Err(Fatal::Cancelled);
            }
            rep.progress.current = Some(item.src.to_string_lossy().into_owned());
            let size = match item.kind {
                ItemKind::File { size } => size,
                _ => 0,
            };
            let before = rep.progress.bytes_done;
            let done = |rep: &mut Reporter<'_>| {
                rep.progress.bytes_done = before + size;
                rep.progress.items_done += 1;
                rep.tick(false);
            };
            if normalize_lexically(&item.src) == target_norm {
                summary.items_skipped += 1; // the archive being replaced never packs itself
                done(&mut rep);
                continue;
            }
            let Some(rel) = entry_name(&item.dst) else {
                fail(
                    &mut summary,
                    &rep,
                    &item.src,
                    FsError::new(
                        FsErrorCode::InvalidName,
                        "The name is not valid UTF-8 – not packed",
                        Some(&item.src),
                    ),
                );
                done(&mut rep);
                continue;
            };
            match item.kind {
                ItemKind::Symlink => {
                    fail(
                        &mut summary,
                        &rep,
                        &item.src,
                        FsError::new(
                            FsErrorCode::NotAFile,
                            "Links are not packed",
                            Some(&item.src),
                        ),
                    );
                }
                ItemKind::Dir => {
                    let meta = fs::symlink_metadata(&item.src).ok();
                    writer.add_dir(&rel, meta.as_ref()).map_err(Fatal::Error)?;
                    summary.items_done += 1;
                }
                ItemKind::File { .. } => {
                    let opened = open_regular_file_no_follow(&item.src).and_then(|f| {
                        let m = f.metadata()?;
                        Ok((f, m))
                    });
                    let (f, meta) = match opened {
                        Ok(x) => x,
                        Err(e) => {
                            fail(
                                &mut summary,
                                &rep,
                                &item.src,
                                FsError::from_io(&e, &item.src),
                            );
                            done(&mut rep);
                            continue;
                        }
                    };
                    let mut reader = Counting {
                        inner: f.take(meta.len()),
                        control,
                        rep: &mut rep,
                        cancelled: false,
                    };
                    let r = writer.add_file(&rel, &meta, level, &mut reader);
                    if reader.cancelled {
                        return Err(Fatal::Cancelled);
                    }
                    // the stream is broken after a failed entry: the whole job fails
                    r.map_err(|e| Fatal::Error(FsError::from_io(&e, &item.src)))?;
                    summary.items_done += 1;
                }
            }
            done(&mut rep);
        }
        let finished = writer.finish();
        let file = finished.map_err(|e| Fatal::Error(FsError::from_io(&e, &target)))?;
        let _ = file.sync_all();
        Ok(())
    })();

    rep.progress.current = None;
    match result {
        Err(Fatal::Cancelled) => {
            let _ = fs::remove_file(&tmp);
            rep.tick(true);
            return (JobState::Cancelled, summary);
        }
        Err(Fatal::Error(e)) => {
            let _ = fs::remove_file(&tmp);
            return failed(summary, e);
        }
        Ok(()) => {}
    }
    let placed = if overwrite {
        fs::rename(&tmp, &target)
    } else {
        rename_noreplace(&tmp, &target)
    };
    if let Err(e) = placed {
        let _ = fs::remove_file(&tmp);
        let mut err = FsError::from_io(&e, &target);
        if e.kind() == io::ErrorKind::AlreadyExists {
            err.message = "The target appeared while packing".into();
        }
        return failed(summary, err);
    }
    summary.bytes_done = rep.progress.bytes_done;
    rep.dir_changed(target_dir.to_string_lossy().into_owned());
    rep.tick(true);
    rep.flush_dirs();
    let state = if summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, summary)
}

fn secs(t: Option<std::time::SystemTime>) -> u64 {
    t.and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Review 016 #4: a file that shrinks while it is packed must not leave a TAR
    /// whose header promises more data than follows (broken archive).
    #[test]
    fn a_file_shorter_than_its_size_fails_its_tar_entry() {
        let d = tempdir().unwrap();
        let f = d.path().join("zehn.txt");
        fs::write(&f, b"0123456789").unwrap();
        let meta = fs::metadata(&f).unwrap();
        for gz in [false, true] {
            let out = BufWriter::new(File::create(d.path().join("x.tar")).unwrap());
            let mut w = if gz {
                Writer::TarGz(Box::new(tar::Builder::new(flate2::write::GzEncoder::new(
                    out,
                    flate2::Compression::fast(),
                ))))
            } else {
                Writer::Tar(Box::new(tar::Builder::new(out)))
            };
            let err = w
                .add_file("zehn.txt", &meta, 6, &mut &b"0123"[..])
                .unwrap_err();
            assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof, "gz {gz}");
        }
    }
}
