//! Copy job (design 005 E6): plan first (list, total size, validation), then
//! copy every file into a temporary `.<name>.fnf-part-<job>` in the target
//! folder and rename it to the real name – a cancelled or failed copy never
//! leaves a half-written file under the real name. Symbolic links are copied
//! as links. Existing targets raise a conflict question; per-item errors are
//! collected and the job goes on (a full disk pauses it instead).

use super::report::Reporter;
use super::{
    Conflict, Control, Decision, FileMeta, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS,
    Summary,
};
use crate::error::{FsError, FsErrorCode};
use crate::paths::normalize_lexically;
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const BLOCK: usize = 64 * 1024;

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
}

#[derive(Debug, Default)]
pub struct Plan {
    pub items: Vec<Item>,
    pub bytes_total: u64,
    /// Entries that could not be read while planning.
    pub errors: Vec<ItemError>,
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Validates sources and target and lists everything to copy (parents before
/// children). `Err` = the whole job cannot run.
pub fn plan(
    sources: &[PathBuf],
    target_dir: &Path,
    control: &Control,
) -> Result<Option<Plan>, FsError> {
    let target_dir = normalize_lexically(target_dir);
    let meta = fs::metadata(&target_dir).map_err(|e| FsError::from_io(&e, &target_dir))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "The target is not a folder",
            Some(&target_dir),
        ));
    }
    let mut plan = Plan::default();
    for src in sources {
        let src = normalize_lexically(src);
        let Some(name) = src.file_name() else {
            return Err(FsError::new(
                FsErrorCode::InvalidPath,
                "A drive or root cannot be copied",
                Some(&src),
            ));
        };
        if src.parent() == Some(target_dir.as_path()) {
            return Err(FsError::new(
                FsErrorCode::SameSourceTarget,
                "Source and target folder are the same",
                Some(&src),
            ));
        }
        let src_meta = match fs::symlink_metadata(&src) {
            Ok(m) => m,
            Err(e) => {
                plan.errors.push(ItemError {
                    path: path_string(&src),
                    error: FsError::from_io(&e, &src),
                });
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
        let mut stack = vec![(src.clone(), target_dir.join(name), src_meta)];
        while let Some((s, d, m)) = stack.pop() {
            if control.is_cancelled() {
                return Ok(None);
            }
            let ft = m.file_type();
            if ft.is_symlink() {
                plan.items.push(Item {
                    src: s,
                    dst: d,
                    kind: ItemKind::Symlink,
                });
            } else if ft.is_dir() {
                plan.items.push(Item {
                    src: s.clone(),
                    dst: d.clone(),
                    kind: ItemKind::Dir,
                });
                let read = match fs::read_dir(&s) {
                    Ok(r) => r,
                    Err(e) => {
                        plan.errors.push(ItemError {
                            path: path_string(&s),
                            error: FsError::from_io(&e, &s),
                        });
                        continue;
                    }
                };
                let mut children: Vec<_> = Vec::new();
                for entry in read {
                    match entry.and_then(|e| e.metadata().map(|m| (e.path(), e.file_name(), m))) {
                        Ok(c) => children.push(c),
                        Err(e) => plan.errors.push(ItemError {
                            path: path_string(&s),
                            error: FsError::from_io(&e, &s),
                        }),
                    }
                }
                // DirEntry::metadata does not follow symlinks – what we want
                children.sort_by(|a, b| b.1.cmp(&a.1));
                for (cp, cn, cm) in children {
                    stack.push((cp, d.join(cn), cm));
                }
            } else {
                plan.bytes_total += m.len();
                plan.items.push(Item {
                    src: s,
                    dst: d,
                    kind: ItemKind::File { size: m.len() },
                });
            }
        }
    }
    Ok(Some(plan))
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

/// A new name typed by the user: one path component, nothing special.
fn valid_new_name(name: &str) -> bool {
    let p = Path::new(name);
    !name.trim().is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && p.components().count() == 1
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

struct Run<'a> {
    id: &'a str,
    control: &'a Control,
    rep: Reporter<'a>,
    summary: Summary,
    conflict_seq: u64,
    /// Decision for all further conflicts ("apply to all").
    for_all: Option<Decision>,
}

impl Run<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        let item = ItemError {
            path: path_string(path),
            error,
        };
        self.rep.item_failed(item.clone());
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

    /// Copies one file (or link) with retries after "disk full"; returns false if cancelled.
    fn copy_entry(&mut self, item: &Item, dst: &Path, overwrite: bool) -> bool {
        loop {
            let result = match item.kind {
                ItemKind::Symlink => copy_symlink(&item.src, dst, overwrite).map_err(CopyError::Io),
                _ => self.copy_file(&item.src, dst),
            };
            match result {
                Ok(()) => {
                    self.summary.items_done += 1;
                    return true;
                }
                Err(CopyError::Cancelled) => return false,
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
                            return false;
                        }
                        self.state(JobState::Running);
                        continue;
                    }
                    self.fail(&item.src, error);
                    return true;
                }
            }
        }
    }

    fn copy_file(&mut self, src: &Path, dst: &Path) -> Result<(), CopyError> {
        let name = dst
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let tmp = dst.with_file_name(format!(".{name}.fnf-part-{}", self.id));
        let mut written = 0u64;
        let result = (|| -> Result<(), CopyError> {
            let mut input = File::open(src)?;
            let src_meta = input.metadata()?;
            let mut out = File::create(&tmp)?;
            let mut buf = vec![0u8; BLOCK];
            loop {
                if self.control.is_cancelled() || !self.control.wait_while_paused() {
                    return Err(CopyError::Cancelled);
                }
                let n = input.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n])?;
                written += n as u64;
                self.rep.progress.bytes_done += n as u64;
                self.rep.tick(false);
            }
            out.flush()?;
            if let Ok(t) = src_meta.modified() {
                let _ = out.set_modified(t);
            }
            drop(out);
            let _ = fs::set_permissions(&tmp, src_meta.permissions());
            fs::rename(&tmp, dst)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
            self.rep.progress.bytes_done -= written;
        }
        result
    }
}

fn copy_symlink(src: &Path, dst: &Path, overwrite: bool) -> io::Result<()> {
    let target = fs::read_link(src)?;
    if overwrite {
        fs::remove_file(dst)?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, dst)
    }
    #[cfg(windows)]
    {
        if fs::metadata(src).map(|m| m.is_dir()).unwrap_or(false) {
            std::os::windows::fs::symlink_dir(&target, dst)
        } else {
            std::os::windows::fs::symlink_file(&target, dst)
        }
    }
}

/// Runs a copy job to its end. Emits progress, conflicts and state changes.
pub fn run(
    id: &str,
    sources: &[PathBuf],
    target_dir: &Path,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut run = Run {
        id,
        control,
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
        conflict_seq: 0,
        for_all: None,
    };
    run.state(JobState::Planning);
    let plan = match plan(sources, target_dir, control) {
        Ok(Some(p)) => p,
        Ok(None) => return (JobState::Cancelled, run.summary),
        Err(e) => {
            run.summary.error = Some(e);
            return (JobState::Failed, run.summary);
        }
    };
    for e in plan.errors {
        let path = PathBuf::from(&e.path);
        run.fail(&path, e.error);
    }
    run.rep.progress.bytes_total = plan.bytes_total;
    run.rep.progress.items_total = plan.items.len() as u64;
    run.state(if control.is_paused() {
        JobState::Paused
    } else {
        JobState::Running
    });
    run.rep.tick(true);

    let mut failed_dirs: Vec<PathBuf> = Vec::new();
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
        if failed_dirs.iter().any(|d| item.dst.starts_with(d)) {
            run.summary.items_skipped += 1;
            run.rep.progress.items_done += 1;
            run.rep.progress.bytes_done += size;
            continue;
        }
        if let Some(parent) = item.dst.parent() {
            run.rep.dir_changed(path_string(parent));
        }
        if item.kind == ItemKind::Dir {
            match fs::symlink_metadata(&item.dst) {
                Ok(m) if m.is_dir() => run.summary.items_done += 1, // merge into the existing folder
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
                Err(_) => match fs::create_dir(&item.dst) {
                    Ok(()) => run.summary.items_done += 1,
                    Err(e) => {
                        run.fail(&item.dst, FsError::from_io(&e, &item.dst));
                        failed_dirs.push(item.dst.clone());
                    }
                },
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
                    if !valid_new_name(&name) {
                        run.fail(
                            &item.src,
                            FsError::new(FsErrorCode::InvalidPath, "Invalid file name", Some(&dst)),
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
        if !run.copy_entry(item, &dst, overwrite) {
            cancelled = true;
            break;
        }
        // done or failed, the file counts as processed (its planned size, even if it changed meanwhile)
        run.rep.progress.bytes_done = before + size;
        run.rep.progress.items_done += 1;
        run.rep.tick(false);
    }
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
