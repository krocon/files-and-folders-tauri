//! Extract job (design 016 E3/E4, 025): entries of a ZIP/TAR/TAR.GZ/7z/RAR into a folder.
//!
//! Safety first – every point has a test in `tests_archive.rs`:
//! - names were checked when the index was read (`archive::sanitize`: no `..`,
//!   no absolute names, no drive letters); unsafe entries never reach the plan;
//! - links and special entries are never created (error per entry);
//! - every folder on the way in the target is checked with `symlink_metadata`:
//!   only real folders are entered, a link there stops the entry;
//! - never more than the declared size is written (lying headers), the index
//!   already refused archives above the size/ratio/count limits;
//! - an existing target raises the conflict question of copying;
//! - every file goes to `.fnf-<job>-<n>.part` first and is renamed to its name
//!   (never replacing a file unless "overwrite" was chosen);
//! - encrypted entries need the password of the archive (`archive::secrets`):
//!   none known → the job fails with `archive_password_required` before it
//!   writes anything, a wrong one stops it with `archive_password_wrong`
//!   (the frontend asks and starts it again, design 025 E4).
//!
//! The data of an entry arrives through a *fill* function that pushes chunks
//! into the temporary file: from a `Read` (ZIP, TAR, 7z) or from the UnRAR
//! callback (RAR, which cannot be read as a stream).

use super::ask::Asker;
use super::report::Reporter;
use super::{
    Control, CopyOptions, Decision, FileMeta, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS,
    Summary,
};
use crate::archive::secrets::Secret;
use crate::archive::{self, ArchiveFormat, EntryType, IndexEntry};
use crate::error::{FsError, FsErrorCode};
use crate::paths::validate_name;
use crate::platform::rename_noreplace;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

/// Same block size as a copy (design 029 E10).
const BLOCK: usize = 1024 * 1024;
const MAX_LIVE_ERRORS: u64 = 100;

/// One entry to extract: where it goes, relative to the target root.
#[derive(Debug, Clone)]
struct Item {
    entry: IndexEntry,
    rel: Vec<String>,
}

pub(crate) enum WriteError {
    Cancelled,
    Fs(FsError),
}

/// Pushes one chunk of an entry's data into its temporary file.
type Push<'a> = dyn FnMut(&[u8]) -> Result<(), WriteError> + 'a;
/// Produces the data of one entry through `push`.
type Fill<'a> = dyn FnMut(&mut Push<'_>) -> Result<(), WriteError> + 'a;

/// Copies a reader into `push`; read errors become entry errors (`encrypted` =
/// a decoding error most likely means a wrong password).
fn fill_from(
    reader: &mut dyn Read,
    label: &Path,
    encrypted: bool,
    push: &mut Push<'_>,
) -> Result<(), WriteError> {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| {
            WriteError::Fs(
                if encrypted && e.kind() != io::ErrorKind::PermissionDenied {
                    archive::password_wrong(label)
                } else {
                    read_error(&e, label)
                },
            )
        })?;
        if n == 0 {
            return Ok(());
        }
        push(&buf[..n])?;
    }
}

struct Run<'a> {
    id: &'a str,
    control: &'a Control,
    rep: Reporter<'a>,
    summary: Summary,
    asker: Asker,
    temp_seq: u64,
    archive: &'a Path,
    /// Folders in the target that were checked (real folders, no links).
    verified: HashSet<PathBuf>,
    /// Folders that could not be created: everything below them is skipped.
    failed_dirs: Vec<Vec<String>>,
    /// Password of the archive (design 025 E4), if known.
    password: Option<Secret>,
    /// A password error ends the job (the frontend asks again).
    password_error: Option<FsError>,
}

pub fn unsafe_entry(message: &str, path: &Path) -> FsError {
    FsError::new(FsErrorCode::UnsafeEntry, message, Some(path))
}

impl Run<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        if matches!(
            error.code,
            FsErrorCode::ArchivePasswordWrong | FsErrorCode::ArchivePasswordRequired
        ) && self.password_error.is_none()
        {
            self.password_error = Some(error.clone());
        }
        self.summary.items_failed += 1;
        let item = ItemError {
            path: path.to_string_lossy().into_owned(),
            error,
        };
        if self.summary.items_failed <= MAX_LIVE_ERRORS {
            self.rep.item_failed(item.clone());
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(item);
        }
    }

    fn state(&self, state: JobState) {
        self.rep.emit(JobEvent::State {
            id: self.id.to_string(),
            state,
        });
    }

    fn label(&self, item: &Item) -> PathBuf {
        archive::virtual_path(self.archive, &item.entry.name)
    }

    /// Creates (or checks) the folders `comps` below `root`; a link or a file on
    /// the way is an error – nothing is ever written through a link.
    fn ensure_dir(&mut self, root: &Path, comps: &[String]) -> Result<PathBuf, FsError> {
        let mut cur = root.to_path_buf();
        for c in comps {
            cur.push(c);
            if self.verified.contains(&cur) {
                continue;
            }
            check_or_create_dir(&cur)?;
            self.verified.insert(cur.clone());
        }
        Ok(cur)
    }

    fn temp_name(&mut self, parent: &Path) -> PathBuf {
        self.temp_seq += 1;
        parent.join(format!(".fnf-{}-{}.part", self.id, self.temp_seq))
    }

    /// Writes one file from `fill` (at most `entry.size` bytes) via a temporary name.
    fn write_file(
        &mut self,
        fill: &mut Fill<'_>,
        entry: &IndexEntry,
        modified_ms: Option<i64>,
        parent: &Path,
        dst: &Path,
        overwrite: bool,
    ) -> Result<(), WriteError> {
        let tmp = self.temp_name(parent);
        let mut written = 0u64;
        let result = (|| -> Result<(), WriteError> {
            // `create_new`: never opens an existing file or a link planted under the temporary name
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            // the archive's permission bits at creation, so the umask applies (like `tar`
            // without `-p`); never setuid/setgid/sticky (review 016 #3)
            #[cfg(unix)]
            if let Some(m) = entry.mode {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(m & 0o777);
            }
            let out = options
                .open(&tmp)
                .map_err(|e| WriteError::Fs(FsError::from_io(&e, dst)))?;
            crate::platform::io_hints::prepare_write(&out);
            // small entries need no 1 MiB buffer each (review 029 #12)
            let len = usize::try_from(entry.size).unwrap_or(BLOCK);
            let mut out = io::BufWriter::with_capacity(len.clamp(8 * 1024, BLOCK), out);
            let control = self.control;
            let rep = &mut self.rep;
            let size = entry.size;
            let mut push = |chunk: &[u8]| -> Result<(), WriteError> {
                // pausing waits here – except under the RAR library lock (see `extract_rar`)
                if control.is_cancelled() || !control.wait_while_paused() {
                    return Err(WriteError::Cancelled);
                }
                written += chunk.len() as u64;
                if written > size {
                    return Err(WriteError::Fs(FsError::new(
                        FsErrorCode::ArchiveTooLarge,
                        "The entry holds more data than it declares (zip bomb?) – refused",
                        Some(dst),
                    )));
                }
                out.write_all(chunk)
                    .map_err(|e| WriteError::Fs(FsError::from_io(&e, dst)))?;
                rep.progress.bytes_done += chunk.len() as u64;
                rep.tick(false);
                Ok(())
            };
            fill(&mut push)?;
            let out = out
                .into_inner()
                .map_err(|e| WriteError::Fs(FsError::from_io(e.error(), dst)))?;
            if written != entry.size {
                return Err(WriteError::Fs(archive::archive_error(
                    "The entry is shorter than declared (broken archive)",
                    dst,
                )));
            }
            if let Some(ms) = modified_ms.and_then(|m| u64::try_from(m).ok()) {
                let _ = out.set_modified(UNIX_EPOCH + Duration::from_millis(ms));
            }
            drop(out);
            let placed = if overwrite {
                fs::rename(&tmp, dst)
            } else {
                rename_noreplace(&tmp, dst)
            };
            placed.map_err(|e| {
                let mut err = FsError::from_io(&e, dst);
                if e.kind() == io::ErrorKind::AlreadyExists {
                    err.message = "The target appeared while extracting".into();
                }
                WriteError::Fs(err)
            })
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
            self.rep.progress.bytes_done -= written;
        }
        result
    }

    /// Resolves an existing target (`None` = skip this entry, `Err` = cancel the job).
    fn resolve_target(
        &mut self,
        item: &Item,
        mut dst: PathBuf,
    ) -> Result<Option<(PathBuf, bool)>, ()> {
        let label = self.label(item);
        while let Ok(dm) = fs::symlink_metadata(&dst) {
            if dm.is_dir() {
                self.fail(
                    &label,
                    FsError::new(
                        FsErrorCode::NotAFile,
                        "A folder with this name exists",
                        Some(&dst),
                    ),
                );
                return Ok(None);
            }
            let source_meta = FileMeta {
                size: Some(item.entry.size),
                modified_ms: item.entry.modified_ms,
                is_dir: false,
            };
            let label_str = label.to_string_lossy().into_owned();
            let Some(decision) = self.asker.ask(
                self.id,
                self.control,
                &self.rep,
                &label_str,
                source_meta,
                &dst,
                &dm,
            ) else {
                return Err(());
            };
            match decision {
                Decision::Overwrite => return Ok(Some((dst, true))),
                Decision::OverwriteIfNewer => {
                    let theirs = super::ask::meta_of(&dm).modified_ms;
                    if item.entry.modified_ms > theirs {
                        return Ok(Some((dst, true)));
                    }
                    self.summary.items_skipped += 1;
                    return Ok(None);
                }
                Decision::Skip => {
                    self.summary.items_skipped += 1;
                    return Ok(None);
                }
                Decision::Rename { new_name } => {
                    let name = new_name.unwrap_or_else(|| super::copy::suggest_name(&dst));
                    if let Err(e) = validate_name(&name) {
                        self.fail(
                            &label,
                            FsError {
                                path: Some(dst.to_string_lossy().into_owned()),
                                ..e
                            },
                        );
                        return Ok(None);
                    }
                    dst = dst.with_file_name(name);
                }
                Decision::Cancel => {
                    self.control.cancel();
                    return Err(());
                }
            }
        }
        Ok(Some((dst, false)))
    }

    /// Counts a processed entry (done, skipped or failed) with its planned size.
    fn finish(&mut self, item: &Item, before: u64) {
        let size = if item.entry.kind == EntryType::File {
            item.entry.size
        } else {
            0
        };
        self.rep.progress.bytes_done = before + size;
        self.rep.progress.items_done += 1;
        self.rep.tick(false);
    }

    /// Everything before the data of one planned entry: folders, links, the
    /// conflict question. `Err` = the job was cancelled.
    fn prepare(&mut self, root: &Path, item: &Item) -> Result<Step, ()> {
        let label = self.label(item);
        self.rep.progress.current = Some(label.to_string_lossy().into_owned());
        let before = self.rep.progress.bytes_done;
        if self
            .failed_dirs
            .iter()
            .any(|d| item.rel.len() > d.len() && item.rel[..d.len()] == d[..])
        {
            self.summary.items_skipped += 1;
            self.finish(item, before);
            return Ok(Step::Done);
        }
        match item.entry.kind {
            EntryType::Link | EntryType::Other => {
                self.fail(
                    &label,
                    unsafe_entry(
                        "Links and special files in archives are not extracted",
                        &label,
                    ),
                );
            }
            EntryType::Dir => match self.ensure_dir(root, &item.rel) {
                Ok(dir) => {
                    self.summary.items_done += 1;
                    if let Some(p) = dir.parent() {
                        self.rep.dir_changed(p.to_string_lossy().into_owned());
                    }
                }
                Err(e) => {
                    self.fail(&label, e);
                    self.failed_dirs.push(item.rel.clone());
                }
            },
            EntryType::File => {
                let (dirs, name) = item.rel.split_at(item.rel.len() - 1);
                match self.ensure_dir(root, dirs) {
                    Ok(parent) => {
                        self.rep.dir_changed(parent.to_string_lossy().into_owned());
                        if let Some((dst, overwrite)) =
                            self.resolve_target(item, parent.join(&name[0]))?
                        {
                            return Ok(Step::Write {
                                parent,
                                dst,
                                overwrite,
                            });
                        }
                    }
                    Err(e) => self.fail(&label, e),
                }
            }
        }
        self.finish(item, before);
        Ok(Step::Done)
    }

    /// Writes the data of a prepared file from a reader. `Err` = the job was cancelled.
    fn write(
        &mut self,
        item: &Item,
        step: Step,
        reader: Result<&mut dyn Read, FsError>,
    ) -> Result<(), ()> {
        let label = self.label(item);
        let encrypted = item.entry.encrypted;
        match reader {
            Ok(r) => self.write_fill(item, step, None, &mut |push: &mut Push<'_>| {
                fill_from(r, &label, encrypted, push)
            }),
            Err(e) => {
                if matches!(step, Step::Write { .. }) {
                    let before = self.rep.progress.bytes_done;
                    self.fail(&label, e);
                    self.finish(item, before);
                }
                Ok(())
            }
        }
    }

    /// Writes the data of a prepared file from `fill`; `modified_ms` overrides
    /// the index time (ZIP Extended Timestamp). `Err` = the job was cancelled.
    fn write_fill(
        &mut self,
        item: &Item,
        step: Step,
        modified_ms: Option<i64>,
        fill: &mut Fill<'_>,
    ) -> Result<(), ()> {
        let Step::Write {
            parent,
            dst,
            overwrite,
        } = step
        else {
            return Ok(());
        };
        let label = self.label(item);
        let before = self.rep.progress.bytes_done;
        let modified = modified_ms.or(item.entry.modified_ms);
        match self.write_file(fill, &item.entry, modified, &parent, &dst, overwrite) {
            Ok(()) => self.summary.items_done += 1,
            Err(WriteError::Cancelled) => return Err(()),
            Err(WriteError::Fs(e)) => {
                let disk_full = e.code == FsErrorCode::DiskFull;
                self.fail(&label, e);
                if disk_full {
                    // every further file would fail as well: pause, the user decides
                    self.control.set_paused(true);
                    self.state(JobState::Paused);
                    if !self.control.wait_while_paused() {
                        return Err(());
                    }
                    self.state(JobState::Running);
                }
            }
        }
        self.finish(item, before);
        Ok(())
    }
}

/// What remains of an entry after [`Run::prepare`].
enum Step {
    Done,
    Write {
        parent: PathBuf,
        dst: PathBuf,
        overwrite: bool,
    },
}

/// Checks that `dir` is a real folder (no link) or creates it.
pub(crate) fn check_or_create_dir(dir: &Path) -> Result<(), FsError> {
    let check = |m: &fs::Metadata| -> Result<(), FsError> {
        let ft = m.file_type();
        if ft.is_symlink() {
            Err(unsafe_entry(
                "A link in the target folder – not followed",
                dir,
            ))
        } else if ft.is_dir() {
            Ok(())
        } else {
            Err(FsError::new(
                FsErrorCode::NotADirectory,
                "A file with this name exists",
                Some(dir),
            ))
        }
    };
    match fs::symlink_metadata(dir) {
        Ok(m) => check(&m),
        Err(e) if e.kind() == io::ErrorKind::NotFound => match fs::create_dir(dir) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                let m = fs::symlink_metadata(dir).map_err(|e| FsError::from_io(&e, dir))?;
                check(&m)
            }
            Err(e) => Err(FsError::from_io(&e, dir)),
        },
        Err(e) => Err(FsError::from_io(&e, dir)),
    }
}

fn read_error(e: &io::Error, path: &Path) -> FsError {
    if e.to_string() == archive::BOMB_MESSAGE {
        return archive::too_large(archive::BOMB_MESSAGE, path);
    }
    match e.kind() {
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof | io::ErrorKind::Other => {
            archive::archive_error(format!("Broken entry: {e}"), path)
        }
        _ => FsError::from_io(e, path),
    }
}

/// The entries to extract with their place below the target root: a selected
/// folder brings everything below it, each selection under its own name.
fn plan(index: &archive::ArchiveIndex, selections: &[Vec<String>]) -> (Vec<Item>, Vec<usize>) {
    let mut items = Vec::new();
    let mut matched = vec![false; selections.len()];
    for e in &index.entries {
        for (si, s) in selections.iter().enumerate() {
            if e.name.len() >= s.len() && e.name[..s.len()] == s[..] {
                let keep = s.len().saturating_sub(1);
                items.push(Item {
                    entry: e.clone(),
                    rel: e.name[keep..].to_vec(),
                });
                matched[si] = true;
                break;
            }
        }
    }
    items.sort_by_key(|i| i.entry.pos);
    let missing = matched
        .iter()
        .enumerate()
        .filter(|(_, m)| !**m)
        .map(|(i, _)| i)
        .collect();
    (items, missing)
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    archive_path: &Path,
    entries: &[String],
    target_dir: &Path,
    into_subfolder: bool,
    options: &CopyOptions,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut run = Run {
        id,
        control,
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
        asker: Asker::new(options.conflict_default.decision()),
        temp_seq: 0,
        archive: archive_path,
        verified: HashSet::new(),
        failed_dirs: Vec::new(),
        password: None,
        password_error: None,
    };
    run.state(JobState::Planning);
    run.password = archive::secrets::get(archive_path);
    let failed = |mut summary: Summary, e: FsError| {
        summary.error = Some(e);
        (JobState::Failed, summary)
    };
    match fs::metadata(target_dir) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => {
            let e = FsError::new(
                FsErrorCode::NotADirectory,
                "The target is not a folder",
                Some(target_dir),
            );
            return failed(run.summary, e);
        }
        Err(e) => return failed(run.summary, FsError::from_io(&e, target_dir)),
    }
    let index = match archive::index_of(archive_path) {
        Ok(i) => i,
        Err(e) => return failed(run.summary, e),
    };
    let mut selections = Vec::new();
    if entries.is_empty() {
        selections.push(Vec::new());
    }
    for e in entries {
        match archive::inner_of(archive_path, Path::new(e)) {
            Some(inner) => selections.push(inner),
            None => {
                let err = FsError::new(
                    FsErrorCode::InvalidPath,
                    "The entry is not in this archive",
                    Some(Path::new(e)),
                );
                return failed(run.summary, err);
            }
        }
    }
    let (items, missing) = plan(&index, &selections);
    if run.password.is_none()
        && let Some(item) = items
            .iter()
            .find(|i| i.entry.encrypted && i.entry.kind == EntryType::File)
    {
        // ask before anything is written (design 025 E4)
        let e = FsError::new(
            FsErrorCode::ArchivePasswordRequired,
            "The archive is encrypted – a password is needed",
            Some(&archive::virtual_path(archive_path, &item.entry.name)),
        );
        return failed(run.summary, e);
    }
    if entries.is_empty() && index.unsafe_entries > 0 {
        // never extracted, and never part of the listing: one error for all of them
        let n = index.unsafe_entries;
        run.fail(
            archive_path,
            unsafe_entry(
                &format!(
                    "{n} {} with an unsafe name (.., absolute path, drive letter) not extracted",
                    if n == 1 { "entry" } else { "entries" }
                ),
                archive_path,
            ),
        );
        run.summary.items_failed += u64::from(n) - 1;
    }
    for i in missing {
        let p = archive::virtual_path(archive_path, &selections[i]);
        run.fail(
            &p,
            FsError::new(FsErrorCode::NotFound, "Not in the archive", Some(&p)),
        );
    }
    let root = if into_subfolder {
        let stem = archive_path
            .file_name()
            .map(|n| archive::stem_of(&n.to_string_lossy()))
            .unwrap_or_default();
        if let Err(e) = validate_name(&stem) {
            return failed(run.summary, e);
        }
        let sub = target_dir.join(&stem);
        if let Err(e) = check_or_create_dir(&sub) {
            return failed(run.summary, e);
        }
        run.verified.insert(sub.clone());
        sub
    } else {
        target_dir.to_path_buf()
    };
    run.rep
        .dir_changed(target_dir.to_string_lossy().into_owned());
    run.rep.progress.items_total = items.len() as u64;
    run.rep.progress.bytes_total = items
        .iter()
        .filter(|i| i.entry.kind == EntryType::File)
        .map(|i| i.entry.size)
        .sum();
    run.state(if control.is_paused() {
        JobState::Paused
    } else {
        JobState::Running
    });
    run.rep.tick(true);

    let cancelled = match index.format {
        ArchiveFormat::Zip => extract_zip(&mut run, &root, &items),
        ArchiveFormat::Tar | ArchiveFormat::TarGz => {
            extract_tar(&mut run, &root, &items, index.format, index.archive_size)
        }
        ArchiveFormat::SevenZ => extract_7z(&mut run, &root, &items),
        #[cfg(feature = "rar")]
        ArchiveFormat::Rar => extract_rar(&mut run, &root, &items),
        #[cfg(not(feature = "rar"))]
        ArchiveFormat::Rar => {
            run.fail(
                archive_path,
                archive::archive_error("RAR support is not built in", archive_path),
            );
            false
        }
    };
    run.rep.progress.current = None;
    run.summary.bytes_done = run.rep.progress.bytes_done;
    run.rep.tick(true);
    run.rep.flush_dirs();
    if let Some(e) = run.password_error.take() {
        // the frontend asks for the password and starts the job again
        run.summary.error = Some(e);
        return (JobState::Failed, run.summary);
    }
    let state = if cancelled || control.is_cancelled() {
        JobState::Cancelled
    } else if run.summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, run.summary)
}

/// `true` = cancelled.
fn extract_zip(run: &mut Run<'_>, root: &Path, items: &[Item]) -> bool {
    let archive_path = run.archive;
    let opened = File::open(archive_path)
        .map_err(|e| FsError::from_io(&e, archive_path))
        .and_then(|f| {
            zip::ZipArchive::new(BufReader::new(f)).map_err(|e| archive::zip_error(e, archive_path))
        });
    let mut za = match opened {
        Ok(z) => z,
        Err(e) => {
            run.fail(archive_path, e);
            return false;
        }
    };
    let password = run.password.clone();
    for item in items {
        if run.control.is_cancelled() || !run.control.wait_while_paused() {
            return true;
        }
        if run.password_error.is_some() {
            return false;
        }
        let Ok(step) = run.prepare(root, item) else {
            return true;
        };
        if matches!(step, Step::Done) {
            continue;
        }
        let label = run.label(item);
        let opened = match (&password, item.entry.encrypted) {
            (Some(pw), true) => za.by_index_decrypt(item.entry.pos, pw.expose().as_bytes()),
            _ => za.by_index(item.entry.pos),
        };
        let result = match opened {
            Ok(mut f) => {
                let modified = archive::zip_mtime_ms(&f);
                let encrypted = item.entry.encrypted;
                run.write_fill(item, step, modified, &mut |push: &mut Push<'_>| {
                    // a ZipCrypto check byte lets 1 of 256 wrong passwords through: the CRC
                    // (or the AES HMAC) at the end tells
                    fill_from(&mut f, &label, encrypted, push)
                })
            }
            Err(e) => run.write(item, step, Err(archive::zip_error(e, &label))),
        };
        if result.is_err() {
            return true;
        }
    }
    false
}

/// Remembers whether a reader failed (a solid 7z block is out of sync then).
struct Watched<'r> {
    inner: &'r mut dyn Read,
    failed: bool,
}

impl Read for Watched<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf).inspect_err(|_| self.failed = true)
    }
}

/// `true` = cancelled. Decodes only the blocks that hold planned entries, one
/// at a time and in order; unplanned entries of a block are read and dropped
/// (the decoder streams through a block).
fn extract_7z(run: &mut Run<'_>, root: &Path, items: &[Item]) -> bool {
    use sevenz_rust2::BlockDecoder;
    let archive_path = run.archive;
    let (mut source, archive, _) = match archive::sevenz::open(archive_path) {
        Ok(x) => x,
        Err(e) => {
            run.fail(archive_path, e);
            return false;
        }
    };
    let password = archive::sevenz::password_of(run.password.as_ref());
    let by_pos: HashMap<usize, &Item> = items.iter().map(|i| (i.entry.pos, i)).collect();
    let block_of = |pos: usize| {
        archive
            .stream_map
            .file_block_index
            .get(pos)
            .copied()
            .flatten()
    };
    let blocks: BTreeSet<usize> = items.iter().filter_map(|i| block_of(i.entry.pos)).collect();
    let mut handled: HashSet<usize> = HashSet::new();
    for b in blocks {
        if run.control.is_cancelled() || !run.control.wait_while_paused() {
            return true;
        }
        if run.password_error.is_some() {
            return false;
        }
        let Some(block) = archive.blocks.get(b) else {
            continue;
        };
        let encrypted = archive::sevenz::block_encrypted(block);
        let checked = archive::sevenz::check_memory(block, archive_path);
        let mut cancelled = false;
        let result = match checked {
            Err(e) => Err(e),
            Ok(()) => {
                let Some(&start) = archive.stream_map.block_first_file_index.get(b) else {
                    continue;
                };
                let mut k = start;
                let decoded = BlockDecoder::new(1, b, &archive, &password, &mut source)
                    .for_each_entries(&mut |_entry, rd| {
                        let pos = k;
                        k += 1;
                        let Some(item) = by_pos.get(&pos).copied() else {
                            // keep the stream in step: read and drop
                            io::copy(rd, &mut io::sink())?;
                            return Ok(true);
                        };
                        handled.insert(pos);
                        let Ok(step) = run.prepare(root, item) else {
                            cancelled = true;
                            return Ok(false);
                        };
                        let mut watched = Watched {
                            inner: rd,
                            failed: false,
                        };
                        let wrote = if matches!(step, Step::Done) {
                            io::copy(&mut watched, &mut io::sink())
                                .map(|_| ())
                                .map_err(|_| ())
                        } else {
                            run.write(item, step, Ok(&mut watched))
                        };
                        if wrote.is_err() && !watched.failed {
                            cancelled = true;
                            return Ok(false);
                        }
                        // a failed read leaves the block out of step: stop it
                        Ok(!watched.failed && run.password_error.is_none())
                    });
                decoded.map_err(|e| archive::sevenz::map_error(e, archive_path, encrypted))
            }
        };
        if cancelled {
            return true;
        }
        let failed_with = result.err();
        // planned entries of this block that were not reached
        for item in items.iter().filter(|i| block_of(i.entry.pos) == Some(b)) {
            if handled.insert(item.entry.pos) {
                let label = run.label(item);
                let before = run.rep.progress.bytes_done;
                let e = failed_with.clone().unwrap_or_else(|| {
                    archive::archive_error("Not reached (broken archive)", &label)
                });
                run.fail(
                    &label,
                    FsError {
                        path: Some(label.to_string_lossy().into_owned()),
                        ..e
                    },
                );
                run.finish(item, before);
            }
        }
    }
    // entries without data (empty files, folders, links)
    for item in items.iter().filter(|i| block_of(i.entry.pos).is_none()) {
        if run.control.is_cancelled() || !run.control.wait_while_paused() {
            return true;
        }
        if run.password_error.is_some() {
            return false; // nothing more is written with a wrong password
        }
        let Ok(step) = run.prepare(root, item) else {
            return true;
        };
        if run.write(item, step, Ok(&mut io::empty())).is_err() {
            return true;
        }
    }
    false
}

/// `true` = cancelled. The library tests each planned entry and hands its data
/// to our temporary file; everything else is skipped. Pausing takes effect
/// between entries: a pause inside the callback would hold the library lock.
#[cfg(feature = "rar")]
fn extract_rar(run: &mut Run<'_>, root: &Path, items: &[Item]) -> bool {
    let archive_path = run.archive;
    let password = run.password.clone();
    let mut a = match archive::rar::RarArchive::open(archive_path, password.as_ref(), true) {
        Ok(a) => a,
        Err(e) => {
            run.fail(archive_path, e);
            return false;
        }
    };
    let not_reached = |run: &mut Run<'_>, rest: &[&Item], e: Option<FsError>| {
        for item in rest {
            let label = run.label(item);
            let err = e
                .clone()
                .unwrap_or_else(|| archive::archive_error("Not reached (broken archive)", &label));
            run.fail(
                &label,
                FsError {
                    path: Some(label.to_string_lossy().into_owned()),
                    ..err
                },
            );
        }
    };
    let planned: Vec<&Item> = items.iter().collect();
    let mut next = 0usize;
    let mut pos = 0usize;
    while next < planned.len() {
        if run.control.is_cancelled() || !run.control.wait_while_paused() {
            return true;
        }
        if run.password_error.is_some() {
            return false;
        }
        let header = match a.next_header() {
            Ok(Some(h)) => h,
            Ok(None) => {
                not_reached(run, &planned[next..], None);
                return false;
            }
            Err(e) => {
                not_reached(run, &planned[next..], Some(e));
                return false;
            }
        };
        let this = pos;
        pos += 1;
        let item = planned[next];
        if item.entry.pos != this {
            if let Err(e) = a.skip() {
                not_reached(run, &planned[next..], Some(e));
                return false;
            }
            continue;
        }
        next += 1;
        let Ok(step) = run.prepare(root, item) else {
            return true;
        };
        let mut processed = false;
        let label = run.label(item);
        let result = run.write_fill(item, step, None, &mut |push: &mut Push<'_>| {
            processed = true;
            let mut failure: Option<WriteError> = None;
            let done = a
                .test_into(&header, &mut |chunk: &[u8]| match push(chunk) {
                    Ok(()) => true,
                    Err(e) => {
                        failure = Some(e);
                        false
                    }
                })
                .map_err(|e| {
                    WriteError::Fs(FsError {
                        path: Some(label.to_string_lossy().into_owned()),
                        ..e
                    })
                })?;
            match failure {
                Some(e) => Err(e),
                None if done => Ok(()),
                None => Err(WriteError::Cancelled),
            }
        });
        if result.is_err() {
            return true;
        }
        if !processed && let Err(e) = a.skip() {
            not_reached(run, &planned[next..], Some(e));
            return false;
        }
    }
    false
}

/// `true` = cancelled. The stream is read once; entries come in archive order.
fn extract_tar(
    run: &mut Run<'_>,
    root: &Path,
    items: &[Item],
    format: ArchiveFormat,
    archive_size: u64,
) -> bool {
    let archive_path = run.archive;
    let file = match File::open(archive_path) {
        Ok(f) => f,
        Err(e) => {
            run.fail(archive_path, FsError::from_io(&e, archive_path));
            return false;
        }
    };
    let mut tar = tar::Archive::new(archive::tar_stream(file, format, archive_size));
    let entries = match tar.entries() {
        Ok(e) => archive::TarEntries::new(e),
        Err(e) => {
            run.fail(archive_path, archive::tar_error(&e, archive_path));
            return false;
        }
    };
    let mut next = items.iter().peekable();
    for entry in entries {
        if run.control.is_cancelled() || !run.control.wait_while_paused() {
            return true;
        }
        let Some(item) = next.peek().copied() else {
            break; // nothing more to extract
        };
        let (pos, _, mut entry) = match entry {
            Ok(e) => e,
            Err(e) => {
                // the stream is broken: the rest cannot be reached
                run.fail(archive_path, archive::tar_error(&e, archive_path));
                for rest in next {
                    let label = run.label(rest);
                    run.fail(
                        &label,
                        archive::archive_error("Not reached (broken archive)", &label),
                    );
                }
                return false;
            }
        };
        if item.entry.pos != pos {
            continue;
        }
        next.next();
        let Ok(step) = run.prepare(root, item) else {
            return true;
        };
        if run.write(item, step, Ok(&mut entry)).is_err() {
            return true;
        }
    }
    false
}
