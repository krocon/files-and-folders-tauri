//! Checksum jobs (design 039): `checksum` hashes the selected files (folders
//! recursively, links never followed) and writes one list file, one file per
//! file, or only reports the digests (clipboard); `verifyChecksums` reads a list
//! file and checks every named file. Names from a list file are hostile
//! (`checksum::resolve`); the report lists at most `MAX_PROBLEMS` problems.

use super::report::Reporter;
use super::{Control, ItemError, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::checksum::{self, Algo, MAX_LIST_BYTES, MAX_PROBLEMS};
use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Files hashed by one job (folders included).
pub const MAX_FILES: usize = 1_000_000;
/// Files whose digest the `show` output reports.
pub const MAX_SHOWN: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ChecksumOutput {
    /// One list file `<base_dir>/<name>`; names relative to `base_dir`.
    List {
        name: String,
        #[serde(default)]
        overwrite: bool,
    },
    /// `<file>.<ext>` next to every file (existing ones are skipped unless `overwrite`).
    PerFile {
        #[serde(default)]
        overwrite: bool,
    },
    /// Only the digests in the summary (copy to the clipboard).
    Show,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksumDigest {
    pub path: String,
    pub hex: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProblemKind {
    /// The file's digest differs.
    Mismatch,
    /// The named file does not exist.
    Missing,
    /// The file could not be read.
    Unreadable,
    /// A line that is no checksum line of the format.
    Invalid,
    /// A name outside the list's folder (absolute, `..`, through a link) – not read.
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksumProblem {
    /// The name as written in the list (a broken line: the line, shortened).
    pub name: String,
    /// The file it points to (missing/refused/invalid: none).
    pub path: Option<String>,
    pub kind: ProblemKind,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksumSummary {
    pub algo: Option<Algo>,
    /// `checksum` with a list: the file written.
    pub file: Option<String>,
    /// `checksum` with `show`.
    pub digests: Vec<ChecksumDigest>,
    // `verifyChecksums`
    pub ok: u64,
    pub mismatched: u64,
    pub missing: u64,
    pub unreadable: u64,
    pub invalid: u64,
    pub refused: u64,
    pub problems: Vec<ChecksumProblem>,
}

fn fail(error: FsError) -> (JobState, Summary) {
    (
        JobState::Failed,
        Summary {
            error: Some(error),
            ..Summary::default()
        },
    )
}

fn push_error(summary: &mut Summary, rep: &Reporter, path: &Path, error: FsError) {
    summary.items_failed += 1;
    let item = ItemError {
        path: path.to_string_lossy().into_owned(),
        error,
    };
    rep.item_failed(item.clone());
    if summary.errors.len() < MAX_REPORTED_ERRORS {
        summary.errors.push(item);
    }
}

/// The regular files of the selection: folders recursively; links and special files are skipped.
fn collect(
    paths: &[PathBuf],
    control: &Control,
    summary: &mut Summary,
    rep: &Reporter,
) -> Option<Vec<(PathBuf, u64)>> {
    let mut files = Vec::new();
    let mut stack: Vec<PathBuf> = paths.iter().rev().cloned().collect();
    while let Some(p) = stack.pop() {
        if control.is_cancelled() {
            return None;
        }
        let meta = match fs::symlink_metadata(&p) {
            Ok(m) => m,
            Err(e) => {
                push_error(summary, rep, &p, FsError::from_io(&e, &p));
                continue;
            }
        };
        let ft = meta.file_type();
        if ft.is_file() {
            files.push((p, meta.len()));
            if files.len() > MAX_FILES {
                return Some(files);
            }
        } else if ft.is_dir() {
            match fs::read_dir(&p) {
                Ok(read) => {
                    let mut children: Vec<PathBuf> =
                        read.filter_map(|e| e.ok().map(|e| e.path())).collect();
                    children.sort();
                    stack.extend(children.into_iter().rev());
                }
                Err(e) => push_error(summary, rep, &p, FsError::from_io(&e, &p)),
            }
        } else {
            // links (never followed), FIFOs, devices
            summary.items_skipped += 1;
        }
    }
    Some(files)
}

pub fn run_create(
    id: &str,
    paths: &[PathBuf],
    base_dir: &Path,
    algo: Algo,
    output: &ChecksumOutput,
    control: &Control,
    emit: &(dyn Fn(super::JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut rep = Reporter::new(id, emit);
    rep.emit(super::JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let mut summary = Summary::default();
    let list_file = match output {
        ChecksumOutput::List { name, .. } => Some(base_dir.join(name)),
        _ => None,
    };
    let Some(mut files) = collect(paths, control, &mut summary, &rep) else {
        return (JobState::Cancelled, summary);
    };
    if files.len() > MAX_FILES {
        return fail(FsError::new(
            FsErrorCode::TooMany,
            format!("Too many files (max. {MAX_FILES})"),
            None,
        ));
    }
    // never hash the list being written, nor (per file) existing checksum files of this kind
    files.retain(|(p, _)| {
        Some(p) != list_file.as_ref()
            && !(matches!(output, ChecksumOutput::PerFile { .. })
                && p.extension().is_some_and(|e| e == algo.ext()))
    });
    if matches!(output, ChecksumOutput::Show) && files.len() > MAX_SHOWN {
        return fail(FsError::new(
            FsErrorCode::TooMany,
            format!("Too many files to show (max. {MAX_SHOWN})"),
            None,
        ));
    }
    if let (Some(file), ChecksumOutput::List { overwrite, .. }) = (&list_file, output)
        && !overwrite
        && fs::symlink_metadata(file).is_ok()
    {
        return fail(FsError::new(
            FsErrorCode::AlreadyExists,
            "The checksum file exists already",
            Some(file),
        ));
    }
    rep.progress.items_total = files.len() as u64;
    rep.progress.bytes_total = files.iter().map(|(_, s)| s).sum();
    rep.tick(true);

    let mut lines: Vec<(String, String)> = Vec::new();
    let mut digests = Vec::new();
    for (file, _) in &files {
        if control.is_cancelled() {
            return (JobState::Cancelled, summary);
        }
        control.wait_while_paused();
        rep.progress.current = Some(file.to_string_lossy().into_owned());
        let name = match output {
            ChecksumOutput::List { .. } => match checksum::relative_name(base_dir, file) {
                Some(n) => Some(n),
                None => {
                    push_error(
                        &mut summary,
                        &rep,
                        file,
                        FsError::new(
                            FsErrorCode::InvalidName,
                            "Not below the folder of the list, or no UTF-8 name",
                            Some(file),
                        ),
                    );
                    continue;
                }
            },
            _ => None,
        };
        let hex = {
            let rep = &mut rep;
            match checksum::hash_file(file, algo, control.cancel_flag(), &mut |n| {
                rep.progress.bytes_done += n;
                rep.tick(false);
            }) {
                Ok(Some(h)) => h,
                Ok(None) => return (JobState::Cancelled, summary),
                Err(e) => {
                    push_error(&mut summary, rep, file, FsError::from_io(&e, file));
                    continue;
                }
            }
        };
        match output {
            ChecksumOutput::List { .. } => lines.push((name.unwrap_or_default(), hex)),
            ChecksumOutput::Show => digests.push(ChecksumDigest {
                path: file.to_string_lossy().into_owned(),
                hex,
            }),
            ChecksumOutput::PerFile { overwrite } => {
                let mut target = file.as_os_str().to_owned();
                target.push(".");
                target.push(algo.ext());
                let target = PathBuf::from(target);
                if !overwrite && fs::symlink_metadata(&target).is_ok() {
                    summary.items_skipped += 1;
                    rep.progress.items_done += 1;
                    continue;
                }
                let Some(name) = file.file_name().and_then(|n| n.to_str()) else {
                    push_error(
                        &mut summary,
                        &rep,
                        file,
                        FsError::new(FsErrorCode::InvalidName, "No UTF-8 name", Some(file)),
                    );
                    continue;
                };
                if let Err(e) = write_atomic(&target, checksum::format_line(&hex, name).as_bytes())
                {
                    push_error(&mut summary, &rep, &target, FsError::from_io(&e, &target));
                    continue;
                }
                if let Some(dir) = target.parent() {
                    rep.dir_changed(dir.to_string_lossy().into_owned());
                }
            }
        }
        summary.items_done += 1;
        rep.progress.items_done += 1;
        rep.tick(false);
    }
    let mut cs = ChecksumSummary {
        algo: Some(algo),
        digests,
        ..ChecksumSummary::default()
    };
    if let Some(file) = &list_file {
        lines.sort();
        let text: String = lines
            .iter()
            .map(|(name, hex)| checksum::format_line(hex, name))
            .collect();
        if let Err(e) = write_atomic(file, text.as_bytes()) {
            return fail(FsError::from_io(&e, file));
        }
        rep.dir_changed(base_dir.to_string_lossy().into_owned());
        cs.file = Some(file.to_string_lossy().into_owned());
    }
    rep.tick(true);
    summary.bytes_done = rep.progress.bytes_done;
    summary.checksums = Some(cs);
    let state = if summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, summary)
}

fn problem(cs: &mut ChecksumSummary, name: &str, path: Option<&Path>, kind: ProblemKind) {
    match kind {
        ProblemKind::Mismatch => cs.mismatched += 1,
        ProblemKind::Missing => cs.missing += 1,
        ProblemKind::Unreadable => cs.unreadable += 1,
        ProblemKind::Invalid => cs.invalid += 1,
        ProblemKind::Refused => cs.refused += 1,
    }
    if cs.problems.len() < MAX_PROBLEMS {
        cs.problems.push(ChecksumProblem {
            name: name.chars().take(300).collect(),
            path: path.map(|p| p.to_string_lossy().into_owned()),
            kind,
        });
    }
}

pub fn run_verify(
    id: &str,
    list: &Path,
    control: &Control,
    emit: &(dyn Fn(super::JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut rep = Reporter::new(id, emit);
    rep.emit(super::JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let text = match crate::platform::open_regular_file(list).and_then(|f| {
        let mut bytes = Vec::new();
        f.take(MAX_LIST_BYTES + 1).read_to_end(&mut bytes)?;
        Ok(bytes)
    }) {
        Ok(b) if b.len() as u64 > MAX_LIST_BYTES => {
            return fail(FsError::new(
                FsErrorCode::TooMany,
                "The checksum file is too large",
                Some(list),
            ));
        }
        Ok(b) => match String::from_utf8(b) {
            Ok(t) => t,
            Err(_) => {
                return fail(FsError::new(
                    FsErrorCode::InvalidName,
                    "The checksum file is no UTF-8 text",
                    Some(list),
                ));
            }
        },
        Err(e) => return fail(FsError::from_io(&e, list)),
    };
    let Some(base) = list.parent() else {
        return fail(FsError::new(
            FsErrorCode::InvalidPath,
            "No folder",
            Some(list),
        ));
    };
    let hint = list
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(Algo::from_file_name);
    let lines: Vec<&str> = text.lines().collect();
    rep.progress.items_total = lines.len() as u64;
    rep.tick(true);
    let mut cs = ChecksumSummary {
        algo: hint,
        ..ChecksumSummary::default()
    };
    let mut summary = Summary::default();
    for raw in lines {
        if control.is_cancelled() {
            summary.checksums = Some(cs);
            return (JobState::Cancelled, summary);
        }
        control.wait_while_paused();
        rep.progress.items_done += 1;
        let line = match checksum::parse_line(raw, hint) {
            None => continue,
            Some(Err(_)) => {
                problem(&mut cs, raw.trim(), None, ProblemKind::Invalid);
                continue;
            }
            Some(Ok(l)) => l,
        };
        cs.algo.get_or_insert(line.algo);
        let path = match checksum::resolve(base, &line.name) {
            Err(_) => {
                problem(&mut cs, &line.name, None, ProblemKind::Refused);
                continue;
            }
            Ok(None) => {
                problem(&mut cs, &line.name, None, ProblemKind::Missing);
                continue;
            }
            Ok(Some(p)) => p,
        };
        rep.progress.current = Some(path.to_string_lossy().into_owned());
        let hashed = {
            let rep = &mut rep;
            checksum::hash_file(&path, line.algo, control.cancel_flag(), &mut |n| {
                rep.progress.bytes_done += n;
                rep.tick(false);
            })
        };
        match hashed {
            Ok(None) => {
                summary.checksums = Some(cs);
                return (JobState::Cancelled, summary);
            }
            Ok(Some(hex)) if hex == line.hex => cs.ok += 1,
            Ok(Some(_)) => problem(&mut cs, &line.name, Some(&path), ProblemKind::Mismatch),
            Err(_) => problem(&mut cs, &line.name, Some(&path), ProblemKind::Unreadable),
        }
        rep.tick(false);
    }
    rep.tick(true);
    summary.items_done = cs.ok;
    summary.items_failed = cs.mismatched + cs.missing + cs.unreadable + cs.invalid + cs.refused;
    summary.bytes_done = rep.progress.bytes_done;
    let state = if summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    summary.checksums = Some(cs);
    (state, summary)
}
