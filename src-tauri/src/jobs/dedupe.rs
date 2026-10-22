//! Deleting duplicates (design 042 E5): job `dedupe`.
//!
//! The user decided which file of each group stays. Right before a copy is touched the
//! job checks, **per file**:
//! 1. the kept file still exists, is a file and is unchanged (size + mtime as shown);
//! 2. the copy is unchanged (size + mtime) and is not the kept file under another name
//!    (hard link: deleting it would free nothing – and with `keep` gone, lose it);
//! 3. `verify = content`: the copy has the **same bytes** as the kept file (compared
//!    now – no hash, no cache);
//! 4. the kept file is still unchanged after the comparison.
//!
//! Only then the copy goes to the trash, is deleted or moved into a folder (never over an
//! existing name). Whatever fails a check stays where it is and is reported
//! (`duplicate_changed`); the rest goes on. A group whose kept file is gone or changed is
//! skipped as a whole.

use super::expect::{self, ExpectedEntry};
use super::report::Reporter;
use super::{Control, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::error::{FsError, FsErrorCode};
use crate::model::EntryKind;
use crate::platform::{FileStamp, file_stamp, possibly_same_file, rename_noreplace};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Copies one job may handle.
pub const MAX_PATHS: usize = 200_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DedupeGroup {
    /// The file that stays – as the result showed it.
    pub keep: ExpectedEntry,
    /// The copies to remove – as the result showed them.
    pub remove: Vec<ExpectedEntry>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DedupeAction {
    #[default]
    Trash,
    Permanent,
    /// Into `target_dir` (a free name if the name is taken).
    Move,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DedupeVerify {
    /// Exact duplicates: the bytes are compared right before.
    #[default]
    Content,
    /// Only "unchanged since the search".
    Unchanged,
    /// Similar images: unchanged, and the copy looks like the file that stays (pHash
    /// distance ≤ threshold – not only like the group's centre, review 042 #2).
    SimilarImages,
    /// Similar comics: the same for the sampled pages.
    SimilarComics,
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn changed(path: &Path, why: impl Into<String>) -> FsError {
    FsError::new(FsErrorCode::DuplicateChanged, why, Some(path))
}

/// Why the kept file is not (any more) what the result showed – `None` if it still is.
fn keep_problem(keep: &Path, expected: &ExpectedEntry) -> Option<String> {
    match fs::symlink_metadata(keep) {
        Err(_) => Some("the file to keep is gone".into()),
        Ok(m) if !m.is_file() => Some("the file to keep is no file any more".into()),
        Ok(_) => {
            expect::changed(keep, expected).map(|why| format!("the file to keep changed: {why}"))
        }
    }
}

/// Why `copy` must not be removed against `keep` because it may be the same file (review
/// 042 #1) – fail closed: without an identity on either side nothing is removed.
pub(crate) fn same_file_reason(
    keep: Option<&FileStamp>,
    copy: Option<&FileStamp>,
) -> Option<&'static str> {
    match (keep, copy) {
        (Some(k), Some(c)) if k.id == c.id => {
            Some("it is the file to keep under another name (hard link)")
        }
        (Some(k), Some(c)) if possibly_same_file(k, c) => {
            Some("it may be the file to keep on another mount (same file number, size and time)")
        }
        (Some(_), Some(_)) => None,
        _ => Some("its identity cannot be read – not removed to be safe"),
    }
}

/// Moves `src` into `dir` without replacing anything: a free name `name (n).ext` if the
/// name is taken; across volumes copy → rename into place → delete the source.
fn move_into(src: &Path, dir: &Path) -> Result<PathBuf, FsError> {
    let name = src
        .file_name()
        .ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "No file name", Some(src)))?;
    let mut dst = dir.join(name);
    if fs::symlink_metadata(&dst).is_ok() {
        dst = dir.join(super::copy::suggest_name(&dst));
    }
    match rename_noreplace(src, &dst) {
        Ok(()) => return Ok(dst),
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {}
        Err(e) => return Err(FsError::from_io(&e, src)),
    }
    let tmp = crate::fileops::unique_temp(dir);
    let copied = (|| -> io::Result<()> {
        let len = fs::copy(src, &tmp)?;
        if len != fs::metadata(src)?.len() {
            return Err(io::Error::other("the copy is incomplete"));
        }
        {
            let f = fs::File::options().write(true).open(&tmp)?;
            if let Ok(t) = fs::metadata(src).and_then(|m| m.modified()) {
                let _ = f.set_modified(t);
            }
            // on disk before the source goes (two volumes, two journals – review 042 #7)
            f.sync_all()?;
        }
        rename_noreplace(&tmp, &dst)?;
        #[cfg(unix)]
        if let Ok(d) = fs::File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();
    if let Err(e) = copied {
        let _ = fs::remove_file(&tmp);
        return Err(FsError::from_io(&e, src));
    }
    fs::remove_file(src).map_err(|e| FsError::from_io(&e, src))?;
    Ok(dst)
}

struct Run<'a> {
    rep: Reporter<'a>,
    summary: Summary,
}

impl Run<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        let item = ItemError {
            path: path_string(path),
            error,
        };
        if self.summary.items_failed <= 100 {
            self.rep.item_failed(item.clone());
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(item);
        }
    }

    fn step(&mut self) {
        self.rep.progress.items_done += 1;
        self.rep.tick(false);
    }

    /// One copy is through: its bytes count as done.
    fn step_to(&mut self, bytes: u64) {
        self.rep.progress.bytes_done = self.rep.progress.bytes_done.max(bytes);
        self.step();
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    id: &str,
    groups: &[DedupeGroup],
    action: DedupeAction,
    target_dir: Option<&Path>,
    verify: DedupeVerify,
    threshold: Option<u8>,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut run = Run {
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
    };
    if action == DedupeAction::Move {
        let ok = target_dir.is_some_and(|d| fs::metadata(d).is_ok_and(|m| m.is_dir()));
        if !ok {
            run.summary.error = Some(FsError::new(
                FsErrorCode::NotADirectory,
                "The folder to move the copies into does not exist",
                target_dir,
            ));
            return (JobState::Failed, run.summary);
        }
    }
    run.rep.progress.items_total = groups.iter().map(|g| g.remove.len() as u64).sum();
    if verify == DedupeVerify::Content {
        run.rep.progress.bytes_total = groups
            .iter()
            .flat_map(|g| g.remove.iter())
            .map(|r| r.size.unwrap_or(0) * 2)
            .sum();
    }
    run.rep.emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    run.rep.tick(true);
    let cancelled = 'groups: {
        for g in groups {
            let keep = Path::new(&g.keep.path);
            if let Some(why) = keep_problem(keep, &g.keep) {
                for r in &g.remove {
                    run.fail(Path::new(&r.path), changed(Path::new(&r.path), why.clone()));
                    run.step();
                }
                continue;
            }
            let keep_stamp = file_stamp(keep);
            let mut skip_rest: Option<String> = None;
            for r in &g.remove {
                if control.is_cancelled() || !control.wait_while_paused() {
                    break 'groups true;
                }
                // whatever happens to this copy, its share of the bytes is done (review 042 #11)
                let target = run.rep.progress.bytes_done
                    + if verify == DedupeVerify::Content {
                        r.size.unwrap_or(0) * 2
                    } else {
                        0
                    };
                let p = Path::new(&r.path);
                run.rep.progress.current = Some(r.path.clone());
                if let Some(why) = &skip_rest {
                    run.fail(p, changed(p, why.clone()));
                    run.step_to(target);
                    continue;
                }
                match check_copy(
                    p,
                    r,
                    keep,
                    keep_stamp.as_ref(),
                    (verify, threshold),
                    control,
                    &mut run,
                ) {
                    Ok(()) => {}
                    Err(None) => break 'groups true,
                    Err(Some(e)) => {
                        run.fail(p, e);
                        run.step_to(target);
                        continue;
                    }
                }
                // the kept file again, after the comparison
                if let Some(why) = keep_problem(keep, &g.keep) {
                    run.fail(p, changed(p, why.clone()));
                    skip_rest = Some(why);
                    run.step_to(target);
                    continue;
                }
                let done = match action {
                    DedupeAction::Trash => super::delete::trash_one(p).map_err(|msg| {
                        FsError::new(
                            FsErrorCode::TrashFailed,
                            format!("Could not move to the trash: {msg}"),
                            Some(p),
                        )
                    }),
                    DedupeAction::Permanent => {
                        fs::remove_file(p).map_err(|e| FsError::from_io(&e, p))
                    }
                    DedupeAction::Move => {
                        let dir = target_dir.expect("checked above");
                        move_into(p, dir).map(|_| run.rep.dir_changed(path_string(dir)))
                    }
                };
                match done {
                    Ok(()) => {
                        run.summary.items_done += 1;
                        run.summary.bytes_done += r.size.unwrap_or(0);
                        if let Some(parent) = p.parent() {
                            run.rep.dir_changed(path_string(parent));
                        }
                    }
                    Err(e) => run.fail(p, e),
                }
                run.step_to(target);
            }
        }
        false
    };
    run.rep.progress.current = None;
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

/// Checks 2 and 3 for one copy. `Err(None)` = cancelled.
fn check_copy(
    p: &Path,
    expected: &ExpectedEntry,
    keep: &Path,
    keep_stamp: Option<&FileStamp>,
    (verify, threshold): (DedupeVerify, Option<u8>),
    control: &Control,
    run: &mut Run<'_>,
) -> Result<(), Option<FsError>> {
    let meta = fs::symlink_metadata(p).map_err(|e| Some(FsError::from_io(&e, p)))?;
    if !meta.is_file() {
        return Err(Some(changed(p, "it is no file any more")));
    }
    if let Some(why) = expect::changed(p, expected) {
        return Err(Some(changed(p, why)));
    }
    if let Some(why) = same_file_reason(keep_stamp, file_stamp(p).as_ref()) {
        return Err(Some(changed(p, why)));
    }
    if crate::paths::normalize_lexically(p) == crate::paths::normalize_lexically(keep) {
        return Err(Some(changed(p, "it is the file to keep")));
    }
    if verify == DedupeVerify::Content {
        let rep = &mut run.rep;
        let same = crate::duplicates::same_content(keep, p, control.cancel_flag(), &mut |n| {
            rep.progress.bytes_done += n;
            rep.tick(false);
        });
        match same {
            Ok(true) => {}
            Ok(false) => {
                return Err(Some(changed(
                    p,
                    "its content differs from the file to keep",
                )));
            }
            Err(_) if control.is_cancelled() => return Err(None),
            Err(e) => return Err(Some(FsError::from_io(&e, p))),
        }
    }
    if matches!(
        verify,
        DedupeVerify::SimilarImages | DedupeVerify::SimilarComics
    ) {
        let comics = verify == DedupeVerify::SimilarComics;
        let limit = u32::from(
            threshold
                .unwrap_or(crate::duplicates::DEFAULT_THRESHOLD)
                .min(crate::duplicates::MAX_THRESHOLD),
        );
        match crate::duplicates::similar_distance(keep, p, comics, control) {
            Ok(Some(d)) if d <= limit => {}
            Ok(_) => return Err(Some(changed(p, "it does not look like the file to keep"))),
            Err(_) if control.is_cancelled() => return Err(None),
            Err(e) => return Err(Some(e)),
        }
    }
    Ok(())
}

/// Checks a `dedupe` spec without touching the file system beyond path syntax:
/// at least one copy, every path once, files only, local paths.
pub fn validate(
    groups: &[DedupeGroup],
    action: DedupeAction,
    target_dir: Option<&str>,
) -> Result<(), FsError> {
    let invalid = |m: &str| FsError::new(FsErrorCode::InvalidPath, m.to_string(), None);
    let total: usize = groups.iter().map(|g| g.remove.len() + 1).sum();
    if groups.is_empty() || groups.iter().all(|g| g.remove.is_empty()) {
        return Err(invalid("Nothing to delete"));
    }
    if total > MAX_PATHS {
        return Err(FsError::new(FsErrorCode::TooMany, "Too many files", None));
    }
    let mut seen = std::collections::HashSet::with_capacity(total);
    for g in groups {
        for e in std::iter::once(&g.keep).chain(g.remove.iter()) {
            if crate::remote::is_remote(&e.path) {
                return Err(FsError::at(
                    FsErrorCode::RemoteUnsupported,
                    "Duplicates on a server cannot be deleted here",
                    &e.path,
                ));
            }
            let p = crate::paths::validate_input_path(&e.path)?;
            if e.size.is_none() || e.modified_ms.is_none() {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    "Size and time of every file are needed to check it before deleting",
                    Some(&p),
                ));
            }
            if e.kind != EntryKind::File {
                return Err(FsError::new(
                    FsErrorCode::NotAFile,
                    "Only files are duplicates",
                    Some(&p),
                ));
            }
            if !seen.insert(crate::paths::normalize_lexically(&p)) {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    "A file appears twice in the duplicates to delete",
                    Some(&p),
                ));
            }
        }
    }
    match (action, target_dir) {
        (DedupeAction::Move, Some(d)) => crate::paths::validate_input_path(d).map(|_| ()),
        (DedupeAction::Move, None) => Err(invalid("No folder to move the copies into")),
        _ => Ok(()),
    }
}
