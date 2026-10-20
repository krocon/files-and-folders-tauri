//! Extract job (design 016 E3/E4): entries of a ZIP/TAR/TAR.GZ into a folder.
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
//!   (never replacing a file unless "overwrite" was chosen).

use super::ask::Asker;
use super::report::Reporter;
use super::{
    Control, CopyOptions, Decision, FileMeta, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS,
    Summary,
};
use crate::archive::{self, ArchiveFormat, EntryType, IndexEntry};
use crate::error::{FsError, FsErrorCode};
use crate::paths::validate_name;
use crate::platform::rename_noreplace;
use std::collections::HashSet;
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

enum WriteError {
    Cancelled,
    Fs(FsError),
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
}

pub fn unsafe_entry(message: &str, path: &Path) -> FsError {
    FsError::new(FsErrorCode::UnsafeEntry, message, Some(path))
}

impl Run<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
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

    /// Writes one file from `reader` (at most `entry.size` bytes) via a temporary name.
    fn write_file(
        &mut self,
        reader: &mut dyn Read,
        entry: &IndexEntry,
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
            let mut out = options
                .open(&tmp)
                .map_err(|e| WriteError::Fs(FsError::from_io(&e, dst)))?;
            crate::platform::io_hints::prepare_write(&out);
            // small entries need no 1 MiB buffer each (review 029 #12)
            let len = usize::try_from(entry.size).unwrap_or(BLOCK);
            let mut buf = vec![0u8; len.clamp(8 * 1024, BLOCK)];
            loop {
                if self.control.is_cancelled() || !self.control.wait_while_paused() {
                    return Err(WriteError::Cancelled);
                }
                let n = reader.read(&mut buf).map_err(|e| {
                    WriteError::Fs(read_error(
                        &e,
                        &archive::virtual_path(self.archive, &entry.name),
                    ))
                })?;
                if n == 0 {
                    break;
                }
                written += n as u64;
                if written > entry.size {
                    return Err(WriteError::Fs(FsError::new(
                        FsErrorCode::ArchiveTooLarge,
                        "The entry holds more data than it declares (zip bomb?) – refused",
                        Some(dst),
                    )));
                }
                out.write_all(&buf[..n])
                    .map_err(|e| WriteError::Fs(FsError::from_io(&e, dst)))?;
                self.rep.progress.bytes_done += n as u64;
                self.rep.tick(false);
            }
            if written != entry.size {
                return Err(WriteError::Fs(archive::archive_error(
                    "The entry is shorter than declared (broken archive)",
                    dst,
                )));
            }
            out.flush()
                .map_err(|e| WriteError::Fs(FsError::from_io(&e, dst)))?;
            if let Some(ms) = entry.modified_ms.and_then(|m| u64::try_from(m).ok()) {
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

    /// Writes the data of a prepared file. `Err` = the job was cancelled.
    fn write(
        &mut self,
        item: &Item,
        step: Step,
        reader: Result<&mut dyn Read, FsError>,
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
        let reader = match reader {
            Ok(r) => r,
            Err(e) => {
                self.fail(&label, e);
                self.finish(item, before);
                return Ok(());
            }
        };
        match self.write_file(reader, &item.entry, &parent, &dst, overwrite) {
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
    };
    run.state(JobState::Planning);
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
    };
    run.rep.progress.current = None;
    run.summary.bytes_done = run.rep.progress.bytes_done;
    run.rep.tick(true);
    run.rep.flush_dirs();
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
    for item in items {
        if run.control.is_cancelled() || !run.control.wait_while_paused() {
            return true;
        }
        let Ok(step) = run.prepare(root, item) else {
            return true;
        };
        if matches!(step, Step::Done) {
            continue;
        }
        let label = run.label(item);
        let result = match za.by_index(item.entry.pos) {
            Ok(mut f) => run.write(item, step, Ok(&mut f)),
            Err(e) => run.write(item, step, Err(archive::zip_error(e, &label))),
        };
        if result.is_err() {
            return true;
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
