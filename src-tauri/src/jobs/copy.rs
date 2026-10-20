//! Copy and move jobs (design 005 E6, 006 E5): plan first (list, total size, validation), then
//! copy every file into a temporary `.fnf-<job>-<n>.part` in the target
//! folder and rename it to the real name – a cancelled or failed copy never
//! leaves a half-written file under the real name. Symbolic links are copied
//! as links. Existing targets raise a conflict question; per-item errors are
//! collected and the job goes on (a full disk pauses it instead).

use super::report::Reporter;
use super::{
    Conflict, ConflictKind, Control, CopyOptions, Decision, FileMeta, ItemError, JobEvent,
    JobState, MAX_REPORTED_ERRORS, Summary,
};
use crate::error::{FsError, FsErrorCode};
use crate::paths::{normalize_lexically, validate_name};
use crate::platform::{file_id, io_hints, rename_noreplace};
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// 1 MiB: few, large writes keep a slow drive's queue short; pause/cancel are
/// still checked per block (≤ 1 s even at 1 MB/s; design 029 E10).
const BLOCK: usize = 1024 * 1024;
/// `ItemFailed` events per job; further errors are only counted in the summary.
const MAX_LIVE_ERRORS: u64 = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemKind {
    Dir,
    File { size: u64 },
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub src: PathBuf,
    pub dst: PathBuf,
    pub kind: ItemKind,
    /// Device + inode at planning time: a move deletes or renames the source
    /// only if the path still names this entry (a folder swapped for a link
    /// must not lead outside the tree).
    pub id: Option<(u64, u64)>,
    pub top_idx: usize,
}

#[derive(Debug, Default)]
pub struct Plan {
    pub items: Vec<Item>,
    pub bytes_total: u64,
    /// Entries that could not be read while planning (the first [`MAX_REPORTED_ERRORS`]).
    pub errors: Vec<ItemError>,
    /// Further unreadable entries (counted, not listed).
    pub more_errors: u64,
}

impl Plan {
    fn error(&mut self, path: &Path, error: FsError) {
        if self.errors.len() < MAX_REPORTED_ERRORS {
            self.errors.push(ItemError {
                path: path_string(path),
                error,
            });
        } else {
            self.more_errors += 1;
        }
    }
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// One top-level source with its target path.
#[derive(Debug)]
pub struct Top {
    pub src: PathBuf,
    pub dst: PathBuf,
    pub meta: Metadata,
}

/// Job-level checks for all sources before anything happens: target is a
/// folder, no root, not onto itself, not into itself. Unreadable sources are
/// reported in the plan's errors.
pub fn check(
    sources: &[PathBuf],
    target_dir: &Path,
    rename_to: Option<&str>,
    plan: &mut Plan,
) -> Result<Vec<Top>, FsError> {
    let pairs: Vec<(PathBuf, PathBuf)> = sources
        .iter()
        .map(|s| (s.clone(), target_dir.to_path_buf()))
        .collect();
    check_pairs(&pairs, rename_to, plan)
}

/// [`check`] for pairs *source → target folder* (grouping, design 008 E2):
/// every distinct target folder must be a folder.
pub fn check_pairs(
    pairs: &[(PathBuf, PathBuf)],
    rename_to: Option<&str>,
    plan: &mut Plan,
) -> Result<Vec<Top>, FsError> {
    let mut checked: HashSet<PathBuf> = HashSet::new(); // review 008 #5: no O(n·g)
    for (_, target_dir) in pairs {
        let target_dir = normalize_lexically(target_dir);
        if checked.contains(&target_dir) {
            continue;
        }
        let meta = fs::metadata(&target_dir).map_err(|e| FsError::from_io(&e, &target_dir))?;
        if !meta.is_dir() {
            return Err(FsError::new(
                FsErrorCode::NotADirectory,
                "The target is not a folder",
                Some(&target_dir),
            ));
        }
        checked.insert(target_dir);
    }
    if let Some(n) = rename_to {
        validate_name(n)?;
        if pairs.len() != 1 {
            return Err(FsError::new(
                FsErrorCode::InvalidName,
                "A new name needs exactly one source",
                None,
            ));
        }
    }
    let mut tops = Vec::new();
    for (src, target_dir) in pairs {
        let target_dir = normalize_lexically(target_dir);
        let src = normalize_lexically(src);
        let Some(name) = src.file_name() else {
            return Err(FsError::new(
                FsErrorCode::InvalidPath,
                "A drive or root cannot be copied or moved",
                Some(&src),
            ));
        };
        let dst = target_dir.join(rename_to.map(OsStr::new).unwrap_or(name));
        if dst == src {
            return Err(FsError::new(
                FsErrorCode::SameSourceTarget,
                "Source and target folder are the same",
                Some(&src),
            ));
        }
        let src_meta = match fs::symlink_metadata(&src) {
            Ok(m) => m,
            Err(e) => {
                plan.error(&src, FsError::from_io(&e, &src));
                continue;
            }
        };
        if src_meta.is_dir() && target_dir.starts_with(&src) {
            return Err(FsError::new(
                FsErrorCode::TargetInsideSource,
                "The target folder lies inside the source folder",
                Some(&src),
            ));
        }
        tops.push(Top {
            src,
            dst,
            meta: src_meta,
        });
    }
    Ok(tops)
}

/// Lists everything below the top-level sources (parents before children).
/// `false` = cancelled.
pub fn walk(tops: Vec<Top>, plan: &mut Plan, control: &Control) -> bool {
    for (top_idx, top) in tops.into_iter().enumerate() {
        let mut stack = vec![(top.src, top.dst, top.meta)];
        while let Some((s, d, m)) = stack.pop() {
            if control.is_cancelled() {
                return false;
            }
            let ft = m.file_type();
            if ft.is_symlink() {
                plan.items.push(Item {
                    src: s,
                    dst: d,
                    kind: ItemKind::Symlink,
                    id: file_id(&m),
                    top_idx,
                });
            } else if ft.is_dir() {
                plan.items.push(Item {
                    src: s.clone(),
                    dst: d.clone(),
                    kind: ItemKind::Dir,
                    id: file_id(&m),
                    top_idx,
                });
                let read = match fs::read_dir(&s) {
                    Ok(r) => r,
                    Err(e) => {
                        plan.error(&s, FsError::from_io(&e, &s));
                        continue;
                    }
                };
                let mut children: Vec<_> = Vec::new();
                for entry in read {
                    match entry.and_then(|e| e.metadata().map(|m| (e.path(), e.file_name(), m))) {
                        Ok(c) => children.push(c),
                        Err(e) => plan.error(&s, FsError::from_io(&e, &s)),
                    }
                }
                // DirEntry::metadata does not follow symlinks – what we want
                children.sort_by(|a, b| b.1.cmp(&a.1));
                for (cp, cn, cm) in children {
                    stack.push((cp, d.join(cn), cm));
                }
            } else if ft.is_file() {
                plan.bytes_total += m.len();
                plan.items.push(Item {
                    src: s,
                    dst: d,
                    kind: ItemKind::File { size: m.len() },
                    id: file_id(&m),
                    top_idx,
                });
            } else {
                // pipes, sockets, devices: reading could block forever or never end
                plan.error(
                    &s,
                    FsError::new(
                        FsErrorCode::NotAFile,
                        "Special file (pipe, socket or device) – not copied",
                        Some(&s),
                    ),
                );
            }
        }
    }
    true
}

/// Validates sources and target and lists everything to copy (parents before
/// children). `Err` = the whole job cannot run, `Ok(None)` = cancelled.
pub fn plan(
    sources: &[PathBuf],
    target_dir: &Path,
    control: &Control,
) -> Result<Option<Plan>, FsError> {
    let mut plan = Plan::default();
    let tops = check(sources, target_dir, None, &mut plan)?;
    Ok(walk(tops, &mut plan, control).then_some(plan))
}

/// A free name in the folder of `dst`: `name (1).ext`, `name (2).ext`, …
pub fn suggest_name(dst: &Path) -> String {
    let name = dst
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name.as_str(), ""),
    };
    for n in 1..10_000 {
        let candidate = format!("{stem} ({n}){ext}");
        if fs::symlink_metadata(dst.with_file_name(&candidate)).is_err() {
            return candidate;
        }
    }
    format!("{stem} (copy){ext}")
}

fn meta_of(m: &Metadata) -> FileMeta {
    FileMeta {
        size: if m.is_dir() { None } else { Some(m.len()) },
        modified_ms: m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64),
        is_dir: m.is_dir(),
    }
}

enum CopyError {
    Cancelled,
    Io(io::Error),
}

impl From<io::Error> for CopyError {
    fn from(e: io::Error) -> Self {
        CopyError::Io(e)
    }
}

/// How one file ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Done,
    Failed,
    Cancelled,
}

/// Copy, or move (design 006 E5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Copy,
    /// `force_copy`: behave as if source and target were on different
    /// volumes (tests of the copy + delete path).
    Move {
        force_copy: bool,
    },
}

struct Run<'a> {
    id: &'a str,
    control: &'a Control,
    rep: Reporter<'a>,
    summary: Summary,
    conflict_seq: u64,
    /// Decision for all further conflicts ("apply to all" or the dialog default).
    for_all: Option<Decision>,
    /// Numbers the temporary names of this job.
    temp_seq: u64,
    moving: bool,
    /// Moving between volumes: copy + delete instead of rename.
    cross: bool,
    /// Per top-level source (`Item::top_idx`): its target path if it is a folder that did
    /// not exist before – only then is its size at the target what this job wrote
    /// (`Progress::dest_bytes`). Merged into an existing folder: `None`.
    top_dsts: Vec<Option<String>>,
}

fn is_cross_device(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::CrossesDevices
}

impl Run<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        let item = ItemError {
            path: path_string(path),
            error,
        };
        // the summary carries the list; live events only for the first ones (no IPC flood)
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

    /// `None` = cancelled.
    fn ask(&mut self, src: &Path, dst: &Path, sm: &Metadata, dm: &Metadata) -> Option<Decision> {
        if let Some(d) = &self.for_all {
            return Some(d.clone());
        }
        self.conflict_seq += 1;
        let conflict = Conflict {
            conflict_id: self.conflict_seq,
            kind: ConflictKind::Exists,
            source: path_string(src),
            target: path_string(dst),
            source_meta: meta_of(sm),
            target_meta: meta_of(dm),
            suggested_name: suggest_name(dst),
        };
        self.rep.emit(JobEvent::Conflict {
            id: self.id.to_string(),
            conflict,
        });
        self.state(JobState::WaitingForDecision);
        let answer = self.control.wait_for_decision(self.conflict_seq);
        if !self.control.is_cancelled() {
            self.state(if self.control.is_paused() {
                JobState::Paused
            } else {
                JobState::Running
            });
        }
        let (decision, all) = answer?;
        if all {
            // "rename for all" always takes the suggested name of each file
            self.for_all = Some(match decision {
                Decision::Rename { .. } => Decision::Rename { new_name: None },
                ref d => d.clone(),
            });
        }
        Some(decision)
    }

    /// Copies one file (or link) with retries after "disk full".
    fn copy_entry(&mut self, item: &Item, dst: &Path, overwrite: bool) -> Outcome {
        loop {
            let result = match item.kind {
                ItemKind::Symlink => {
                    let tmp = self.temp_name(dst);
                    copy_symlink(&item.src, dst, &tmp, overwrite).map_err(CopyError::Io)
                }
                _ => self.copy_file(&item.src, dst, overwrite, item.top_idx),
            };
            match result {
                Ok(()) => {
                    self.summary.items_done += 1;
                    return Outcome::Done;
                }
                Err(CopyError::Cancelled) => return Outcome::Cancelled,
                Err(CopyError::Io(e)) => {
                    let error = FsError::from_io(&e, dst);
                    if error.code == FsErrorCode::DiskFull {
                        // every further file would fail as well: pause and let the user decide
                        self.rep.item_failed(ItemError {
                            path: path_string(dst),
                            error,
                        });
                        self.control.set_paused(true);
                        self.state(JobState::Paused);
                        if !self.control.wait_while_paused() {
                            return Outcome::Cancelled;
                        }
                        self.state(JobState::Running);
                        continue;
                    }
                    self.fail(&item.src, error);
                    return Outcome::Failed;
                }
            }
        }
    }

    /// Moves one file or link. Same volume: rename (never replacing a target
    /// unless `overwrite`). Other volume: copy, and delete the source only
    /// after the copy is complete under its real name.
    fn move_entry(&mut self, item: &Item, dst: &Path, overwrite: bool) -> Outcome {
        if !unchanged(item) {
            self.fail(&item.src, changed_error(&item.src));
            return Outcome::Failed;
        }
        if !self.cross {
            match rename_no_clobber(item, dst, overwrite) {
                Ok(()) => {
                    self.summary.items_done += 1;
                    return Outcome::Done;
                }
                Err(e) if is_cross_device(&e) => self.cross = true,
                Err(e) => {
                    self.fail(&item.src, FsError::from_io(&e, dst));
                    return Outcome::Failed;
                }
            }
        }
        let outcome = self.copy_entry(item, dst, overwrite);
        if outcome == Outcome::Done && !unchanged(item) {
            // the copy stays, the source path names something else now: never delete that
            self.summary.items_done -= 1;
            self.fail(&item.src, changed_error(&item.src));
            return Outcome::Failed;
        }
        if outcome == Outcome::Done
            && let Err(e) = remove_entry(&item.src)
        {
            // the copy stays – nothing is lost, the source could not be removed
            self.summary.items_done -= 1;
            self.fail(&item.src, FsError::from_io(&e, &item.src));
            return Outcome::Failed;
        }
        outcome
    }

    /// Short temporary name next to `dst` – adding to a long file name could exceed
    /// the 255-byte limit of the file system.
    fn temp_name(&mut self, dst: &Path) -> PathBuf {
        self.temp_seq += 1;
        dst.with_file_name(format!(".fnf-{}-{}.part", self.id, self.temp_seq))
    }

    fn copy_file(
        &mut self,
        src: &Path,
        dst: &Path,
        overwrite: bool,
        top_idx: usize,
    ) -> Result<(), CopyError> {
        let tmp = self.temp_name(dst);
        let mut written = 0u64;
        let top_dst = self.top_dsts.get(top_idx).cloned().flatten();
        let result = (|| -> Result<(), CopyError> {
            let mut input = File::open(src)?;
            let src_meta = input.metadata()?;
            let mut out = File::create(&tmp)?;
            io_hints::prepare_read(&input);
            io_hints::prepare_write(&out);
            let mut dropped = 0u64;
            // small files need no 1 MiB buffer each
            let len = usize::try_from(src_meta.len()).unwrap_or(BLOCK);
            let mut buf = vec![0u8; len.clamp(8 * 1024, BLOCK)];
            loop {
                if self.control.is_cancelled() || !self.control.wait_while_paused() {
                    return Err(CopyError::Cancelled);
                }
                let n = input.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n])?;
                crate::test_slow::block(dst);
                written += n as u64;
                if written - dropped >= io_hints::DROP_EVERY {
                    io_hints::done_reading(&input, dropped, written - dropped);
                    dropped = written;
                }
                self.rep.progress.bytes_done += n as u64;
                if let Some(td) = &top_dst
                    && let Some(b) = self.rep.progress.dest_bytes.get_mut(td)
                {
                    *b += n as u64;
                }
                self.rep.tick(false);
            }
            out.flush()?;
            if let Ok(t) = src_meta.modified() {
                let _ = out.set_modified(t);
            }
            drop(out);
            let _ = fs::set_permissions(&tmp, src_meta.permissions());
            place(&tmp, dst, overwrite)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
            self.rep.progress.bytes_done -= written;
            if let Some(td) = &top_dst
                && let Some(b) = self.rep.progress.dest_bytes.get_mut(td)
            {
                *b = b.saturating_sub(written);
            }
        }
        result
    }
}

/// Removes a file or link (a directory link on Windows needs `remove_dir`).
fn remove_entry(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if cfg!(windows) && fs::symlink_metadata(path).is_ok_and(|m| m.is_symlink()) => {
            fs::remove_dir(path).map_err(|_| e)
        }
        r => r,
    }
}

/// Same-volume move of one file or link; never replaces a target unless
/// `overwrite`. `CrossesDevices` tells the caller to copy instead.
fn rename_no_clobber(item: &Item, dst: &Path, overwrite: bool) -> io::Result<()> {
    if overwrite {
        fs::rename(&item.src, dst)
    } else {
        rename_noreplace(&item.src, dst)
    }
}

/// True if `path` still names the entry that was planned (same device + inode).
fn unchanged(item: &Item) -> bool {
    match item.id {
        None => true,
        Some(id) => {
            fs::symlink_metadata(&item.src)
                .ok()
                .and_then(|m| file_id(&m))
                == Some(id)
        }
    }
}

fn changed_error(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::NotFound,
        "The entry changed while moving – left in place",
        Some(path),
    )
}

/// Moves the finished temporary file to its real name. Without `overwrite` a
/// file that appeared at `dst` meanwhile is never replaced: a hard link fails
/// if the name exists (atomic); file systems without hard links (FAT, exFAT)
/// fall back to check + rename, which leaves a tiny window.
fn place(tmp: &Path, dst: &Path, overwrite: bool) -> io::Result<()> {
    if overwrite {
        return fs::rename(tmp, dst);
    }
    rename_noreplace(tmp, dst).map_err(|e| {
        if e.kind() == io::ErrorKind::AlreadyExists {
            io::Error::new(
                io::ErrorKind::AlreadyExists,
                "The target appeared while copying",
            )
        } else {
            e
        }
    })
}

#[cfg(test)]
pub fn place_for_tests(tmp: &Path, dst: &Path) -> io::Result<()> {
    place(tmp, dst, false)
}

/// Copies a link as a link: created under a temporary name first, so an
/// existing target is only replaced once the new link exists.
fn copy_symlink(src: &Path, dst: &Path, tmp: &Path, overwrite: bool) -> io::Result<()> {
    let target = fs::read_link(src)?;
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&target, tmp);
    #[cfg(windows)]
    let made = if fs::metadata(src).map(|m| m.is_dir()).unwrap_or(false) {
        std::os::windows::fs::symlink_dir(&target, tmp)
    } else {
        std::os::windows::fs::symlink_file(&target, tmp)
    };
    made?;
    let placed = if overwrite {
        fs::rename(tmp, dst)
    } else {
        rename_noreplace(tmp, dst)
    };
    if placed.is_err() {
        let _ = fs::remove_file(tmp);
    }
    placed
}

/// Runs a copy or move job to its end. Emits progress, conflicts and state changes.
pub fn run(
    id: &str,
    sources: &[PathBuf],
    target_dir: &Path,
    options: &CopyOptions,
    mode: Mode,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let pairs: Vec<(PathBuf, PathBuf)> = super::drop_nested(sources)
        .into_iter()
        .map(|s| (s.clone(), target_dir.to_path_buf()))
        .collect();
    run_pairs(id, &pairs, options, mode, Summary::default(), control, emit)
}

/// [`run`] for pairs *source → target folder* (grouping). `summary` carries
/// what happened before (items that failed while preparing the groups).
pub fn run_pairs(
    id: &str,
    pairs: &[(PathBuf, PathBuf)],
    options: &CopyOptions,
    mode: Mode,
    summary: Summary,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut run = Run {
        id,
        control,
        rep: Reporter::new(id, emit),
        summary,
        conflict_seq: 0,
        for_all: options.conflict_default.decision(),
        temp_seq: 0,
        moving: matches!(mode, Mode::Move { .. }),
        cross: matches!(mode, Mode::Move { force_copy: true }),
        top_dsts: Vec::new(),
    };
    run.state(JobState::Planning);
    let mut plan = Plan::default();
    let tops = match check_pairs(pairs, options.rename_to.as_deref(), &mut plan) {
        Ok(t) => t,
        Err(e) => {
            run.summary.error = Some(e);
            return (JobState::Failed, run.summary);
        }
    };
    // moving: whole entries whose target name is free are renamed at once
    let mut fast_done = 0u64;
    let mut rest = Vec::new();
    for top in tops {
        // cancelled while planning: nothing more is renamed (review 008 #5)
        if control.is_cancelled() {
            run.rep.flush_dirs();
            return (JobState::Cancelled, run.summary);
        }
        if run.moving && !run.cross && fs::symlink_metadata(&top.dst).is_err() {
            match rename_noreplace(&top.src, &top.dst) {
                Ok(()) => {
                    fast_done += 1;
                    run.summary.items_done += 1;
                    for p in [top.src.parent(), top.dst.parent()].into_iter().flatten() {
                        run.rep.dir_changed(path_string(p));
                    }
                    continue;
                }
                Err(e) if is_cross_device(&e) => run.cross = true,
                // appeared meanwhile: merge / ask like any other existing target
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                Err(e) => {
                    run.fail(&top.src, FsError::from_io(&e, &top.src));
                    continue;
                }
            }
        }
        rest.push(top);
    }
    // live size of new target folders (the panel shows it while the job runs);
    // files and folders merged into an existing one are left out (small events, no wrong sizes)
    run.top_dsts = rest
        .iter()
        .map(|t| {
            (t.meta.is_dir() && fs::symlink_metadata(&t.dst).is_err()).then(|| path_string(&t.dst))
        })
        .collect();
    for dst in run.top_dsts.iter().flatten() {
        run.rep.progress.dest_bytes.insert(dst.clone(), 0);
    }
    if !walk(rest, &mut plan, control) {
        run.rep.flush_dirs();
        return (JobState::Cancelled, run.summary);
    }
    run.summary.items_failed += plan.more_errors;
    for e in std::mem::take(&mut plan.errors) {
        let path = PathBuf::from(&e.path);
        run.fail(&path, e.error);
    }
    run.rep.progress.bytes_total = plan.bytes_total;
    run.rep.progress.items_total = plan.items.len() as u64 + fast_done;
    run.rep.progress.items_done = fast_done;
    run.state(if control.is_paused() {
        JobState::Paused
    } else {
        JobState::Running
    });
    run.rep.tick(true);

    let mut failed_dirs: Vec<PathBuf> = Vec::new();
    // moving: source folders renamed as a whole (their items are done)
    let mut moved_dirs: Vec<PathBuf> = Vec::new();
    // moving: source folders whose target folder exists now (only these may go when empty)
    let mut placed_dirs: Vec<PathBuf> = Vec::new();
    let mut cancelled = false;
    'items: for item in &plan.items {
        if control.is_cancelled() || !control.wait_while_paused() {
            cancelled = true;
            break;
        }
        run.rep.progress.current = Some(path_string(&item.src));
        let size = match item.kind {
            ItemKind::File { size } => size,
            _ => 0,
        };
        if moved_dirs.iter().any(|d| item.src.starts_with(d)) {
            run.summary.items_done += 1;
            run.rep.progress.items_done += 1;
            run.rep.progress.bytes_done += size;
            continue;
        }
        if failed_dirs.iter().any(|d| item.dst.starts_with(d)) {
            run.summary.items_skipped += 1;
            run.rep.progress.items_done += 1;
            run.rep.progress.bytes_done += size;
            continue;
        }
        if let Some(parent) = item.dst.parent() {
            run.rep.dir_changed(path_string(parent));
        }
        if run.moving
            && let Some(parent) = item.src.parent()
        {
            run.rep.dir_changed(path_string(parent));
        }
        if item.kind == ItemKind::Dir {
            match fs::symlink_metadata(&item.dst) {
                Ok(m) if m.is_dir() => {
                    run.summary.items_done += 1; // merge into the existing folder
                    placed_dirs.push(item.src.clone());
                }
                Ok(_) => {
                    run.fail(
                        &item.dst,
                        FsError::new(
                            FsErrorCode::NotADirectory,
                            "A file with this name exists",
                            Some(&item.dst),
                        ),
                    );
                    failed_dirs.push(item.dst.clone());
                }
                Err(_) => {
                    let mut renamed = false;
                    if run.moving && !run.cross && unchanged(item) {
                        match rename_noreplace(&item.src, &item.dst) {
                            Ok(()) => renamed = true,
                            Err(e) if is_cross_device(&e) => run.cross = true,
                            Err(_) => {} // move the content one by one
                        }
                    }
                    if renamed {
                        run.summary.items_done += 1;
                        moved_dirs.push(item.src.clone());
                    } else {
                        match fs::create_dir(&item.dst) {
                            Ok(()) => {
                                run.summary.items_done += 1;
                                placed_dirs.push(item.src.clone());
                            }
                            Err(e) => {
                                run.fail(&item.dst, FsError::from_io(&e, &item.dst));
                                failed_dirs.push(item.dst.clone());
                            }
                        }
                    }
                }
            }
            run.rep.progress.items_done += 1;
            run.rep.tick(false);
            continue;
        }

        // file or symlink: resolve conflicts first
        let mut dst = item.dst.clone();
        let mut overwrite = false;
        while let Ok(dm) = fs::symlink_metadata(&dst) {
            if dm.is_dir() {
                run.fail(
                    &item.src,
                    FsError::new(
                        FsErrorCode::NotAFile,
                        "A folder with this name exists",
                        Some(&dst),
                    ),
                );
                run.rep.progress.items_done += 1;
                run.rep.progress.bytes_done += size;
                continue 'items;
            }
            let Ok(sm) = fs::symlink_metadata(&item.src) else {
                break;
            };
            let Some(decision) = run.ask(&item.src, &dst, &sm, &dm) else {
                cancelled = true;
                break 'items;
            };
            match decision {
                Decision::Overwrite => {
                    overwrite = true;
                    break;
                }
                Decision::OverwriteIfNewer if sm.modified().ok() > dm.modified().ok() => {
                    overwrite = true;
                    break;
                }
                Decision::Skip | Decision::OverwriteIfNewer => {
                    run.summary.items_skipped += 1;
                    run.rep.progress.items_done += 1;
                    run.rep.progress.bytes_done += size;
                    continue 'items;
                }
                Decision::Rename { new_name } => {
                    let name = new_name.unwrap_or_else(|| suggest_name(&dst));
                    if let Err(e) = validate_name(&name) {
                        run.fail(
                            &item.src,
                            FsError {
                                path: Some(path_string(&dst)),
                                ..e
                            },
                        );
                        run.rep.progress.items_done += 1;
                        run.rep.progress.bytes_done += size;
                        continue 'items;
                    }
                    dst = dst.with_file_name(name);
                }
                Decision::Cancel => {
                    control.cancel();
                    cancelled = true;
                    break 'items;
                }
            }
        }
        let before = run.rep.progress.bytes_done;
        let top_dst = run.top_dsts.get(item.top_idx).cloned().flatten();
        let top_before = top_dst
            .as_ref()
            .and_then(|td| run.rep.progress.dest_bytes.get(td).copied())
            .unwrap_or(0);
        let outcome = if run.moving {
            run.move_entry(item, &dst, overwrite)
        } else {
            run.copy_entry(item, &dst, overwrite)
        };
        if outcome == Outcome::Cancelled {
            cancelled = true;
            break;
        }
        // done or failed, the file counts as processed (its planned size, even if it changed meanwhile)
        run.rep.progress.bytes_done = before + size;
        if let Some(td) = top_dst {
            // only what arrived counts – a failed file was removed again
            let arrived = if outcome == Outcome::Done { size } else { 0 };
            run.rep.progress.dest_bytes.insert(td, top_before + arrived);
        }
        run.rep.progress.items_done += 1;
        run.rep.tick(false);
    }
    if run.moving {
        // emptied source folders go (deepest first) – only those that arrived at the target;
        // a folder the job never reached (cancel) or could not create stays where it is
        for item in plan.items.iter().rev() {
            if item.kind == ItemKind::Dir && placed_dirs.contains(&item.src) && unchanged(item) {
                let _ = fs::remove_dir(&item.src);
            }
        }
    }
    run.rep.progress.current = None;
    run.summary.bytes_done = run.rep.progress.bytes_done;
    run.summary.dest_bytes = run.rep.progress.dest_bytes.clone();
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
