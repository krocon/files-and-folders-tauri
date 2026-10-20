//! Link job (design 031 E9): creates a symbolic link to every source in the
//! target folder. Never replaces an existing name – the OS call fails
//! atomically; with `keep_both` the link gets a free name `name (1).ext`.
//! Absolute targets by default (the source path as listed, never
//! canonicalised); relative ones are computed lexically and checked against
//! the file system before the link is made.

use super::report::Reporter;
use super::{Control, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::error::{FsError, FsErrorCode};
use crate::paths::{normalize_lexically, validate_name};
use crate::platform;
use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub const MAX_ITEMS: usize = 100_000;
/// Attempts with a new free name when another program takes it meanwhile.
const FREE_NAME_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkOptions {
    /// Relative link target (default: absolute).
    #[serde(default)]
    pub relative: bool,
    /// Name of the link of a single source (default: the source's name).
    #[serde(default)]
    pub rename_to: Option<String>,
    /// The name exists: link under a free name instead of failing.
    #[serde(default)]
    pub keep_both: bool,
}

/// The path from `link_dir` to `source`, computed lexically (`..` per
/// remaining folder of `link_dir`). `None` without a common root – another
/// drive or UNC share on Windows, or a relative input.
pub fn relative_target(source: &Path, link_dir: &Path) -> Option<PathBuf> {
    let source = normalize_lexically(source);
    let link_dir = normalize_lexically(link_dir);
    if !source.is_absolute() || !link_dir.is_absolute() {
        return None;
    }
    let s: Vec<Component> = source.components().collect();
    let d: Vec<Component> = link_dir.components().collect();
    let common = s
        .iter()
        .zip(&d)
        .take_while(|(a, b)| same_component(a, b))
        .count();
    // the root (and on Windows the drive prefix) must be shared
    let root_len = s
        .iter()
        .take_while(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
        .count();
    if common < root_len.max(1) {
        return None;
    }
    let mut rel = PathBuf::new();
    for _ in common..d.len() {
        rel.push("..");
    }
    for c in &s[common..] {
        rel.push(c.as_os_str());
    }
    if rel.as_os_str().is_empty() {
        rel.push(".");
    }
    Some(rel)
}

/// The drive or share of a Windows prefix, comparable: `c:`, `C:` and `\\?\C:`
/// are one drive; `\\srv\share` and `\\?\UNC\SRV\Share` one share (external
/// review 031 #9). Ignoring case is right for drive letters and server/share
/// names; the file-system check in `link_target` stays the last word.
fn prefix_key(p: std::path::PrefixComponent<'_>) -> Option<String> {
    use std::path::Prefix;
    let lower = |s: &std::ffi::OsStr| s.to_string_lossy().to_lowercase();
    match p.kind() {
        Prefix::Disk(d) | Prefix::VerbatimDisk(d) => {
            Some(format!("{}:", char::from(d.to_ascii_lowercase())))
        }
        Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => {
            Some(format!(r"\\{}\{}", lower(server), lower(share)))
        }
        Prefix::Verbatim(_) | Prefix::DeviceNS(_) => None,
    }
}

fn same_component(a: &Component<'_>, b: &Component<'_>) -> bool {
    match (a, b) {
        (Component::Prefix(x), Component::Prefix(y)) => match (prefix_key(*x), prefix_key(*y)) {
            (Some(kx), Some(ky)) => kx == ky,
            _ => x == y,
        },
        _ => a == b,
    }
}

/// `a` and `b` (links not followed) name the same entry: device + inode (Unix),
/// volume serial number + file index (Windows, external review 031 #10).
/// Without an id (a file system that has none): kind, size and modification time.
fn same_entry(a: &Path, b: &Path) -> bool {
    if let (Some(x), Some(y)) = (platform::entry_id(a), platform::entry_id(b)) {
        return x == y;
    }
    match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
        (Ok(ma), Ok(mb)) => {
            ma.file_type() == mb.file_type()
                && platform::entry_stamp(&ma) == platform::entry_stamp(&mb)
        }
        _ => false,
    }
}

fn link_error(e: &io::Error, path: &Path) -> FsError {
    if platform::links_not_permitted(e) {
        FsError::new(
            FsErrorCode::LinkNotPermitted,
            "The system does not allow symbolic links here",
            Some(path),
        )
    } else {
        FsError::from_io(e, path)
    }
}

/// What the link of one source points to.
fn link_target(source: &Path, target_dir: &Path, relative: bool) -> Result<PathBuf, FsError> {
    if !relative {
        return Ok(source.to_path_buf());
    }
    let impossible = || {
        FsError::new(
            FsErrorCode::RelativeLinkImpossible,
            "A relative link would not point to the source",
            Some(source),
        )
    };
    let rel = relative_target(source, target_dir).ok_or_else(impossible)?;
    // `..` is resolved physically: a linked folder on the way leads elsewhere
    if !same_entry(&target_dir.join(&rel), source) {
        return Err(impossible());
    }
    Ok(rel)
}

/// Creates the link for one source; returns the link's path. `name` is the
/// typed new name or the source's own name – taken as it is, also when it is
/// no UTF-8 (external review 031 #11).
fn link_one(
    source: &Path,
    target_dir: &Path,
    name: &OsStr,
    options: &LinkOptions,
) -> Result<PathBuf, FsError> {
    // exists (a dangling link too); a virtual archive path does not
    fs::symlink_metadata(source).map_err(|e| FsError::from_io(&e, source))?;
    match name.to_str() {
        Some(n) => validate_name(n)?,
        // not UTF-8 (Unix): the name of an existing entry – one segment, never `.`/`..`
        None if Path::new(name).components().count() != 1
            || Path::new(name).file_name() != Some(name) =>
        {
            return Err(FsError::new(
                FsErrorCode::InvalidName,
                "The name is not a single file name",
                Some(source),
            ));
        }
        None => {}
    }
    let target = link_target(source, target_dir, options.relative)?;
    // Windows: a link to a folder (also through links) must be a folder link
    let dir = fs::metadata(source).map(|m| m.is_dir()).unwrap_or(false);
    let mut link = target_dir.join(name);
    for attempt in 0..=FREE_NAME_ATTEMPTS {
        match platform::make_symlink(&target, &link, dir) {
            Ok(()) => return Ok(link),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                if !options.keep_both || attempt == FREE_NAME_ATTEMPTS {
                    return Err(FsError::new(
                        FsErrorCode::AlreadyExists,
                        "An entry with this name exists",
                        Some(&link),
                    ));
                }
                link = target_dir.join(super::copy::suggest_name(&link));
            }
            Err(e) => return Err(link_error(&e, &link)),
        }
    }
    unreachable!("the loop returns")
}

pub fn run(
    id: &str,
    sources: &[PathBuf],
    target_dir: &Path,
    options: &LinkOptions,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut summary = Summary::default();
    let target_dir = normalize_lexically(target_dir);
    match fs::metadata(&target_dir) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => {
            summary.error = Some(FsError::new(
                FsErrorCode::NotADirectory,
                "The target is not a folder",
                Some(&target_dir),
            ));
            return (JobState::Failed, summary);
        }
        Err(e) => {
            summary.error = Some(FsError::from_io(&e, &target_dir));
            return (JobState::Failed, summary);
        }
    }
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let mut report = Reporter::new(id, emit);
    report.progress.items_total = sources.len() as u64;
    report.tick(true);
    let single = sources.len() == 1;
    let mut state = JobState::Done;
    for source in sources {
        if !control.wait_while_paused() {
            state = JobState::Cancelled;
            break;
        }
        let source = normalize_lexically(source);
        let name: OsString = match (&options.rename_to, single) {
            (Some(n), true) => n.into(),
            _ => source
                .file_name()
                .map(OsStr::to_os_string)
                .unwrap_or_default(),
        };
        report.progress.current = Some(source.to_string_lossy().into_owned());
        match link_one(&source, &target_dir, &name, options) {
            Ok(_) => {
                summary.items_done += 1;
                report.dir_changed(target_dir.to_string_lossy().into_owned());
            }
            Err(error) => {
                summary.items_failed += 1;
                let e = ItemError {
                    path: source.to_string_lossy().into_owned(),
                    error,
                };
                report.item_failed(e.clone());
                if summary.errors.len() < MAX_REPORTED_ERRORS {
                    summary.errors.push(e);
                }
            }
        }
        report.progress.items_done += 1;
        report.tick(false);
    }
    report.progress.current = None;
    report.tick(true);
    report.flush_dirs();
    if state == JobState::Done && summary.items_failed > 0 {
        state = JobState::DoneWithErrors;
    }
    (state, summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn relative_targets_are_lexical() {
        let r = |s: &str, d: &str| relative_target(Path::new(s), Path::new(d));
        assert_eq!(r("/a/b/c.txt", "/a/b"), Some(PathBuf::from("c.txt")));
        assert_eq!(r("/a/b/c.txt", "/a/x"), Some(PathBuf::from("../b/c.txt")));
        assert_eq!(r("/a/b", "/a/b/c/d"), Some(PathBuf::from("../..")));
        assert_eq!(r("/a/b", "/a/b"), Some(PathBuf::from(".")));
        assert_eq!(r("/x", "/a/b"), Some(PathBuf::from("../../x")));
        assert_eq!(
            r("/a/./b/../Ünï cödé 🎉", "/a/z"),
            Some(PathBuf::from("../Ünï cödé 🎉"))
        );
        assert_eq!(r("a/b", "/a"), None, "relative input");
    }

    #[cfg(windows)]
    #[test]
    fn relative_targets_need_the_same_drive() {
        let r = |s: &str, d: &str| relative_target(Path::new(s), Path::new(d));
        assert_eq!(
            r(r"C:\a\b.txt", r"C:\a\x"),
            Some(PathBuf::from(r"..\b.txt"))
        );
        assert_eq!(r(r"D:\a\b.txt", r"C:\a"), None);
    }

    /// External review 031 #9: the drive letter's case and the verbatim prefix
    /// do not make another drive.
    #[cfg(windows)]
    #[test]
    fn drive_letters_ignore_case_and_the_verbatim_prefix() {
        let r = |s: &str, d: &str| relative_target(Path::new(s), Path::new(d));
        assert_eq!(
            r(r"c:\a\b.txt", r"C:\a\x"),
            Some(PathBuf::from(r"..\b.txt"))
        );
        assert_eq!(r(r"\\?\C:\a\b.txt", r"C:\a"), Some(PathBuf::from("b.txt")));
        assert_eq!(
            r(r"\\SRV\Share\a.txt", r"\\?\UNC\srv\share\x"),
            Some(PathBuf::from(r"..\a.txt"))
        );
        assert_eq!(r(r"\\srv\other\a.txt", r"\\srv\share"), None);
    }
}
