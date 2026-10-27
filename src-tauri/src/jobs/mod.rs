//! Job engine (design 005): long or destructive operations run as jobs with an
//! id, byte progress, cancel, pause, conflict questions and per-item errors.
//! Pure std code without Tauri – the command layer only forwards events.
//! Keep in sync with `src/app/core/jobs/jobs.models.ts`.

pub mod archive_write;
pub mod ask;
pub mod attributes;
pub mod checksum;
pub mod clean;
pub mod control;
pub mod copy;
pub mod dedupe;
pub mod delete;
pub mod disk_usage;
pub mod duplicates;
pub mod expect;
pub mod extract;
pub mod group;
pub mod link;
pub mod manager;
pub mod pack;
pub mod remote_delete;
pub mod rename;
pub mod report;
pub mod search;
pub mod shell;
#[cfg(test)]
mod tests_archive;
#[cfg(test)]
mod tests_archive_write;
#[cfg(test)]
mod tests_attributes;
#[cfg(test)]
mod tests_checksum;
#[cfg(test)]
mod tests_dedupe;
#[cfg(test)]
mod tests_disk_usage;
#[cfg(test)]
mod tests_engine;
#[cfg(test)]
mod tests_formats;
#[cfg(test)]
mod tests_link;
#[cfg(test)]
mod tests_ops;
#[cfg(test)]
mod tests_remote;
#[cfg(all(test, unix))]
mod tests_shell;
#[cfg(test)]
mod tests_tools;
pub mod transfer;

use crate::archive::ArchiveFormat;
use crate::attributes::{ApplyTo, AttrChange};
use crate::clean::{CleanItem, CleanOptions};
use crate::dirsize::DirSize;
use crate::disk_usage::{DiskUsageOptions, DiskUsageSummary, Rescan};
use crate::duplicates::DuplicateCriteria;
use crate::error::FsError;
use crate::search::{SearchCriteria, SearchHit, SearchStats};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub use control::Control;
pub use group::{GroupItem, Transfer};
pub use link::LinkOptions;
pub use manager::{JobManager, StartNow};
pub use rename::RenameItem;
pub use shell::{ShellChunk, ShellLaunch, ShellStream, ShellSummary};

/// Sources that lie below another source (or repeat one) are dropped – the
/// folder brings them along (review 009 #5: search results can hold a folder
/// and entries in it). Compared lexically, component by component; the order
/// of the remaining sources stays.
pub fn drop_nested(paths: &[std::path::PathBuf]) -> Vec<std::path::PathBuf> {
    let norm: Vec<std::path::PathBuf> = paths
        .iter()
        .map(|p| crate::paths::normalize_lexically(p))
        .collect();
    paths
        .iter()
        .enumerate()
        .filter(|(i, _)| {
            let me = &norm[*i];
            !norm.iter().enumerate().any(|(j, other)| {
                if other == me {
                    j < *i // a repeated source: the first one stays
                } else {
                    me.starts_with(other)
                }
            })
        })
        .map(|(_, p)| p.clone())
        .collect()
}

/// What the frontend asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JobSpec {
    /// Copy files and folders (recursively) into `target_dir`.
    Copy {
        sources: Vec<String>,
        target_dir: String,
        #[serde(default)]
        background: bool,
        #[serde(default)]
        options: CopyOptions,
    },
    /// Move into `target_dir`: rename on the same volume, else copy + delete per file.
    Move {
        sources: Vec<String>,
        target_dir: String,
        #[serde(default)]
        background: bool,
        #[serde(default)]
        options: CopyOptions,
        /// The user confirmed moving a root/home/system path a second time.
        #[serde(default)]
        allow_dangerous: bool,
        /// What the panel showed for the sources (design 030 E5); changed ones are left alone.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        expected: Vec<expect::ExpectedEntry>,
    },
    /// Delete to the trash (default) or permanently.
    Delete {
        paths: Vec<String>,
        mode: DeleteMode,
        #[serde(default)]
        background: bool,
        #[serde(default)]
        allow_dangerous: bool,
        /// What the panel showed for the paths (design 030 E5); changed ones are left alone.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        expected: Vec<expect::ExpectedEntry>,
    },
    /// Multi-rename (design 007): every entry gets a new name in its folder.
    /// `undo_of` = the job this one undoes (runs the valid pairs even if others
    /// fail) – set only by `JobManager::undo_rename`, never read from the frontend.
    Rename {
        items: Vec<RenameItem>,
        #[serde(default, skip_deserializing)]
        undo_of: Option<String>,
    },
    /// Group files (design 008): every entry to `<root>/<group>/<name>` by copy or move.
    Group {
        root: String,
        items: Vec<GroupItem>,
        transfer: Transfer,
        #[serde(default)]
        options: CopyOptions,
    },
    /// Clean folders (design 008): delete what `find_empty_dirs` listed, checked again.
    Clean {
        roots: Vec<String>,
        items: Vec<CleanItem>,
        mode: DeleteMode,
        #[serde(default)]
        options: CleanOptions,
    },
    /// Recursive search (design 009): hits are streamed as `searchHits` events.
    Search { criteria: SearchCriteria },
    /// Extract entries of an archive (design 016 E4). `entries` are virtual paths
    /// (`…/a.zip/dir`) – empty = everything; `into_subfolder` = into `<target>/<archive stem>`.
    Extract {
        archive: String,
        #[serde(default)]
        entries: Vec<String>,
        target_dir: String,
        #[serde(default)]
        into_subfolder: bool,
        #[serde(default)]
        options: CopyOptions,
    },
    /// Pack sources into `<target_dir>/<name>` (design 016 E5).
    Pack {
        sources: Vec<String>,
        target_dir: String,
        name: String,
        format: ArchiveFormat,
        /// Compression level 0–9 (ZIP, TAR.GZ, 7z; 0 = store only); default 6.
        #[serde(default)]
        level: Option<u32>,
        /// ZIP (AES-256) / 7z (AES-256, names too) password (design 025 E4). Read from
        /// the frontend, never serialised back (job events carry the spec).
        #[serde(default, skip_serializing)]
        password: Option<crate::archive::secrets::Secret>,
    },
    /// Adds files and folders to a ZIP/TAR/TAR.GZ (design 035): `target_dir` is a folder in
    /// the archive (virtual path) or the archive itself; `move_sources` removes what went in
    /// after the archive was replaced.
    ArchiveAdd {
        sources: Vec<String>,
        target_dir: String,
        #[serde(default)]
        options: CopyOptions,
        #[serde(default)]
        move_sources: bool,
    },
    /// Removes entries (virtual paths of one archive) – there is no trash in an archive.
    ArchiveDelete { paths: Vec<String> },
    /// Creates folder `name` in the archive folder `parent` (virtual path).
    ArchiveMkdir { parent: String, name: String },
    /// Extracts one file of an archive into the app's view cache (design 025 E5):
    /// Enter on a file inside an archive; the copy's path is `Summary.view_path`.
    ViewEntry { path: String },
    /// Symbolic links to the sources in `target_dir` (design 031 E9) – never replaces a name.
    Link {
        sources: Vec<String>,
        target_dir: String,
        #[serde(default)]
        options: LinkOptions,
    },
    /// Duplicate files (design 016 E6): groups are streamed as `searchHits`.
    Duplicates { criteria: DuplicateCriteria },
    /// Delete (trash/permanent) or move the copies the user chose (design 042 E5): each
    /// copy is checked against the kept file of its group right before.
    Dedupe {
        groups: Vec<dedupe::DedupeGroup>,
        #[serde(default)]
        action: dedupe::DedupeAction,
        /// `action = move`: the folder the copies go to.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_dir: Option<String>,
        #[serde(default)]
        verify: dedupe::DedupeVerify,
        /// `verify = similar…`: differing bits allowed between the kept file and a copy.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        threshold: Option<u8>,
        #[serde(default)]
        allow_dangerous: bool,
    },
    /// Checksums of the selection (design 039): a list file in `base_dir`, one file
    /// per file, or only the digests (`show`, for the clipboard).
    Checksum {
        paths: Vec<String>,
        base_dir: String,
        algo: crate::checksum::Algo,
        output: checksum::ChecksumOutput,
    },
    /// Checks every file named in a checksum file (design 039).
    VerifyChecksums { file: String },
    /// Counts files, folders and bytes of a selection (copy dialog; parallel).
    Count { paths: Vec<String> },
    /// Recursive size of a folder (always runs in parallel).
    DirSize { path: String },
    /// Disk usage (design 033): scans `roots` (or, `volume`, the volume of the first
    /// one; or, `rescan`, a folder of an earlier scan) into a tree; scan id = job id.
    DiskUsage {
        #[serde(default)]
        roots: Vec<String>,
        #[serde(default)]
        volume: bool,
        #[serde(default)]
        rescan: Option<Rescan>,
        #[serde(default)]
        options: DiskUsageOptions,
    },
    /// Test job for load and throttling tests – rejected in release builds.
    Simulate { items: u32, item_ms: u32 },
    /// Change permissions, attributes and times (design 024): the selected entries
    /// and – `recursive` – everything in selected folders; `apply_to` filters both.
    Attributes {
        paths: Vec<String>,
        change: AttrChange,
        #[serde(default)]
        recursive: bool,
        #[serde(default)]
        apply_to: ApplyTo,
    },
    /// A command of the shell bar (design 021 E1/E3). Built only by the command
    /// `run_shell` – `start_job` cannot create it (no deserialising).
    #[serde(skip_deserializing)]
    Shell {
        cwd: String,
        command: String,
        #[serde(skip)]
        launch: ShellLaunch,
    },
}

impl JobSpec {
    /// Runs immediately instead of waiting in the serial queue.
    pub fn is_parallel(&self) -> bool {
        match self {
            JobSpec::Copy { background, .. }
            | JobSpec::Move { background, .. }
            | JobSpec::Delete { background, .. } => *background,
            // a digest for the clipboard should not wait behind a long copy
            JobSpec::Checksum { output, .. } => {
                matches!(output, checksum::ChecksumOutput::Show)
            }
            JobSpec::VerifyChecksums { .. } => false,
            JobSpec::Rename { .. }
            | JobSpec::Group { .. }
            | JobSpec::Clean { .. }
            | JobSpec::Extract { .. }
            | JobSpec::Pack { .. }
            | JobSpec::Link { .. }
            | JobSpec::Dedupe { .. }
            | JobSpec::ArchiveAdd { .. }
            | JobSpec::ArchiveDelete { .. }
            | JobSpec::ArchiveMkdir { .. }
            | JobSpec::Attributes { .. } => false,
            JobSpec::ViewEntry { .. }
            | JobSpec::Duplicates { .. }
            | JobSpec::DirSize { .. }
            | JobSpec::DiskUsage { .. }
            | JobSpec::Count { .. }
            | JobSpec::Search { .. }
            | JobSpec::Shell { .. }
            | JobSpec::Simulate { .. } => true,
        }
    }

    /// Paths the job moves, renames or deletes (not copies): watched folders at
    /// or below them are paused while it runs (review 012 #3).
    pub fn changed_paths(&self) -> Vec<std::path::PathBuf> {
        let strs: Vec<&String> = match self {
            JobSpec::Move { sources, .. } => sources.iter().collect(),
            JobSpec::Delete { paths, .. } => paths.iter().collect(),
            JobSpec::Rename { items, .. } => items.iter().map(|i| &i.path).collect(),
            JobSpec::Group {
                items,
                transfer: Transfer::Move,
                ..
            } => items.iter().map(|i| &i.path).collect(),
            JobSpec::Clean { items, .. } => items.iter().map(|i| &i.path).collect(),
            JobSpec::ArchiveAdd {
                sources,
                move_sources: true,
                ..
            } => sources.iter().collect(),
            JobSpec::Dedupe { groups, .. } => groups
                .iter()
                .flat_map(|g| g.remove.iter().map(|e| &e.path))
                .collect(),
            _ => Vec::new(),
        };
        strs.into_iter().map(std::path::PathBuf::from).collect()
    }

    /// Folders the job writes new entries into (design 029 E8): watched folders at or
    /// below them hold their reloads back while it runs – the job reports its changes.
    pub fn target_dirs(&self) -> Vec<std::path::PathBuf> {
        let dir = match self {
            JobSpec::Copy { target_dir, .. }
            | JobSpec::Move { target_dir, .. }
            | JobSpec::Extract { target_dir, .. }
            | JobSpec::Pack { target_dir, .. }
            | JobSpec::Link { target_dir, .. } => target_dir,
            JobSpec::Group { root, .. } => root,
            // the folder that holds the archive (the archive file is replaced there)
            JobSpec::ArchiveAdd { target_dir: p, .. } | JobSpec::ArchiveMkdir { parent: p, .. } => {
                return archive_write::split(p)
                    .ok()
                    .and_then(|(a, _)| a.parent().map(crate::paths::normalize_lexically))
                    .into_iter()
                    .collect();
            }
            JobSpec::ArchiveDelete { paths } => {
                return paths
                    .first()
                    .and_then(|p| archive_write::split(p).ok())
                    .and_then(|(a, _)| a.parent().map(crate::paths::normalize_lexically))
                    .into_iter()
                    .collect();
            }
            JobSpec::Dedupe {
                target_dir: Some(dir),
                ..
            } => dir,
            JobSpec::Checksum {
                base_dir, output, ..
            } if !matches!(output, checksum::ChecksumOutput::Show) => base_dir,
            // the folders of the changed entries (design 024 E2)
            JobSpec::Attributes { paths, .. } => {
                let mut dirs: Vec<std::path::PathBuf> = paths
                    .iter()
                    .filter_map(|p| std::path::Path::new(p).parent())
                    .map(crate::paths::normalize_lexically)
                    .collect();
                dirs.sort();
                dirs.dedup();
                return dirs;
            }
            _ => return Vec::new(),
        };
        vec![crate::paths::normalize_lexically(std::path::Path::new(dir))]
    }

    /// Helper jobs (folder size, count, search) are no tasks of the user: quitting
    /// while they run needs no confirmation – cancelling them loses nothing.
    pub fn is_helper(&self) -> bool {
        matches!(
            self,
            JobSpec::DirSize { .. }
                | JobSpec::DiskUsage { .. }
                | JobSpec::Count { .. }
                | JobSpec::Search { .. }
                | JobSpec::Duplicates { .. }
                | JobSpec::Shell { .. }
        )
    }

    /// Every path the job reads or changes (sources, targets, entries) – for the
    /// overlap check when a queued job is started at once (`JobManager::start_now`).
    /// Helper jobs (only reading, run in parallel anyway) give none.
    pub fn touched_paths(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        match self {
            JobSpec::Copy {
                sources,
                target_dir,
                ..
            }
            | JobSpec::Move {
                sources,
                target_dir,
                ..
            }
            | JobSpec::Pack {
                sources,
                target_dir,
                ..
            }
            | JobSpec::Link {
                sources,
                target_dir,
                ..
            } => {
                out.extend(sources.iter().cloned());
                out.push(target_dir.clone());
            }
            JobSpec::Delete { paths, .. }
            | JobSpec::Attributes { paths, .. }
            | JobSpec::Count { paths } => out.extend(paths.iter().cloned()),
            JobSpec::Rename { items, .. } => {
                for i in items {
                    out.push(i.path.clone());
                    // the new name lands next to the old one
                    if let Some(dir) = std::path::Path::new(&i.path).parent() {
                        out.push(dir.join(&i.new_name).to_string_lossy().into_owned());
                    }
                }
            }
            JobSpec::Group { root, items, .. } => {
                out.push(root.clone());
                out.extend(items.iter().map(|i| i.path.clone()));
            }
            JobSpec::Clean { roots, items, .. } => {
                out.extend(roots.iter().cloned());
                out.extend(items.iter().map(|i| i.path.clone()));
            }
            JobSpec::Extract {
                archive,
                target_dir,
                ..
            } => {
                out.push(archive.clone());
                out.push(target_dir.clone());
            }
            JobSpec::Dedupe {
                groups, target_dir, ..
            } => {
                for g in groups {
                    out.push(g.keep.path.clone());
                    out.extend(g.remove.iter().map(|e| e.path.clone()));
                }
                out.extend(target_dir.iter().cloned());
            }
            JobSpec::Checksum {
                paths, base_dir, ..
            } => {
                out.extend(paths.iter().cloned());
                out.push(base_dir.clone());
            }
            JobSpec::VerifyChecksums { file } => out.push(file.clone()),
            JobSpec::ArchiveAdd {
                sources,
                target_dir,
                ..
            } => {
                out.extend(sources.iter().cloned());
                out.push(target_dir.clone());
            }
            JobSpec::ArchiveDelete { paths } => out.extend(paths.iter().cloned()),
            JobSpec::ArchiveMkdir { parent, .. } => out.push(parent.clone()),
            JobSpec::DirSize { path } | JobSpec::ViewEntry { path } => out.push(path.clone()),
            JobSpec::DiskUsage { roots, .. } => out.extend(roots.iter().cloned()),
            JobSpec::Search { .. }
            | JobSpec::Duplicates { .. }
            | JobSpec::Shell { .. }
            | JobSpec::Simulate { .. } => {}
        }
        out
    }

    pub fn kind(&self) -> &'static str {
        match self {
            JobSpec::Copy { .. } => "copy",
            JobSpec::Move { .. } => "move",
            JobSpec::Delete { .. } => "delete",
            JobSpec::Rename { .. } => "rename",
            JobSpec::Group { .. } => "group",
            JobSpec::Clean { .. } => "clean",
            JobSpec::Search { .. } => "search",
            JobSpec::Extract { .. } => "extract",
            JobSpec::Pack { .. } => "pack",
            JobSpec::ViewEntry { .. } => "viewEntry",
            JobSpec::ArchiveAdd { .. } => "archiveAdd",
            JobSpec::ArchiveDelete { .. } => "archiveDelete",
            JobSpec::ArchiveMkdir { .. } => "archiveMkdir",
            JobSpec::Link { .. } => "link",
            JobSpec::Duplicates { .. } => "duplicates",
            JobSpec::Dedupe { .. } => "dedupe",
            JobSpec::Checksum { .. } => "checksum",
            JobSpec::VerifyChecksums { .. } => "verifyChecksums",
            JobSpec::Count { .. } => "count",
            JobSpec::DirSize { .. } => "dirSize",
            JobSpec::DiskUsage { .. } => "diskUsage",
            JobSpec::Simulate { .. } => "simulate",
            JobSpec::Shell { .. } => "shell",
            JobSpec::Attributes { .. } => "attributes",
        }
    }
}

/// What happens when a target exists (copy/move dialog, design 006 E4).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictDefault {
    #[default]
    Ask,
    Overwrite,
    Skip,
    OverwriteIfNewer,
    /// Free name `name (1).ext` for every conflict.
    Rename,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOptions {
    #[serde(default)]
    pub conflict_default: ConflictDefault,
    /// New name of the single source in the target folder ("copy under another name").
    #[serde(default)]
    pub rename_to: Option<String>,
}

impl ConflictDefault {
    /// The answer applied to every conflict (`None` = ask).
    pub fn decision(self) -> Option<Decision> {
        match self {
            ConflictDefault::Ask => None,
            ConflictDefault::Overwrite => Some(Decision::Overwrite),
            ConflictDefault::Skip => Some(Decision::Skip),
            ConflictDefault::OverwriteIfNewer => Some(Decision::OverwriteIfNewer),
            ConflictDefault::Rename => Some(Decision::Rename { new_name: None }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeleteMode {
    Trash,
    Permanent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Planning,
    Running,
    Paused,
    WaitingForDecision,
    Done,
    DoneWithErrors,
    Failed,
    Cancelled,
}

impl JobState {
    pub fn is_finished(self) -> bool {
        matches!(
            self,
            JobState::Done | JobState::DoneWithErrors | JobState::Failed | JobState::Cancelled
        )
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub items_done: u64,
    pub items_total: u64,
    /// Item being processed (full path).
    pub current: Option<String>,
    /// Bytes per second over the job so far.
    pub rate_bps: u64,
    /// Bytes copied/moved into each top-level target destination so far.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub dest_bytes: HashMap<String, u64>,
}

/// Size, modification time and kind of one side of a conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    pub is_dir: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub conflict_id: u64,
    pub kind: ConflictKind,
    pub source: String,
    pub target: String,
    pub source_meta: FileMeta,
    pub target_meta: FileMeta,
    /// Free name in the target folder (`name (1).ext`) for "rename".
    pub suggested_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    /// The target exists (copy/move). Answers: all decisions.
    Exists,
    /// Permanent delete of a write-protected entry (`source` = `target`).
    /// Answers: overwrite (= delete anyway), skip, cancel.
    ReadOnly,
}

/// Answer to a conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Decision {
    Overwrite,
    Skip,
    /// Copy under another name in the same folder (`None` = suggested name).
    Rename {
        new_name: Option<String>,
    },
    OverwriteIfNewer,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemError {
    pub path: String,
    pub error: FsError,
}

/// Result of a finished job.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub items_done: u64,
    pub items_skipped: u64,
    pub items_failed: u64,
    pub bytes_done: u64,
    /// The first [`MAX_REPORTED_ERRORS`] errors (`items_failed` has the full count).
    pub errors: Vec<ItemError>,
    /// Job-level error (planning failed, invalid target …).
    pub error: Option<FsError>,
    pub dir_size: Option<DirSize>,
    /// Search job: the final statistics (`errors` = unreadable folders).
    pub search: Option<SearchStats>,
    /// Shell job (design 021): exit code / signal.
    pub shell: Option<ShellSummary>,
    /// Final bytes copied/moved into each top-level target destination.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub dest_bytes: HashMap<String, u64>,
    /// Job `diskUsage` (design 033).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk_usage: Option<DiskUsageSummary>,
    /// Job `viewEntry`: the copy of the entry in the view cache (design 025 E5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_path: Option<String>,
    /// Jobs `checksum` / `verifyChecksums` (design 039).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksums: Option<checksum::ChecksumSummary>,
}

pub const MAX_REPORTED_ERRORS: usize = 1000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: String,
    pub spec: JobSpec,
    pub state: JobState,
    pub progress: Progress,
    pub conflict: Option<Conflict>,
    pub summary: Option<Summary>,
    /// Why the job paused itself (e.g. disk full) – cleared when it runs again.
    pub pause_reason: Option<FsError>,
    /// A finished rename job that `undo_rename` can still undo.
    pub undo_available: bool,
}

/// Everything the frontend hears about jobs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JobEvent {
    Added {
        job: Box<JobInfo>,
    },
    State {
        id: String,
        state: JobState,
    },
    Progress {
        id: String,
        progress: Progress,
    },
    Conflict {
        id: String,
        conflict: Conflict,
    },
    ItemFailed {
        id: String,
        error: ItemError,
    },
    /// Folders whose content changed (panels showing them reload).
    DirsChanged {
        dirs: Vec<String>,
    },
    Finished {
        id: String,
        state: JobState,
        summary: Box<Summary>,
    },
    Removed {
        ids: Vec<String>,
    },
    /// A rename job can be undone (after it finished) – or no longer.
    UndoAvailable {
        id: String,
        available: bool,
    },
    /// A batch of search hits (design 009) with the statistics so far.
    SearchHits {
        id: String,
        hits: Vec<SearchHit>,
        stats: SearchStats,
    },
    /// Output of a shell command (design 021 E3): cleaned text per stream;
    /// `dropped` = bytes left out by the flood protection since the last event.
    ShellOutput {
        id: String,
        chunks: Vec<ShellChunk>,
        dropped: u64,
    },
    /// The window wants to close while jobs run – ask the user.
    QuitRequested {
        running: usize,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_format() {
        let spec: JobSpec = serde_json::from_str(
            r#"{"kind":"copy","sources":["/a"],"targetDir":"/b","background":true}"#,
        )
        .unwrap();
        assert!(spec.is_parallel());
        let JobSpec::Copy { options, .. } = spec else {
            panic!()
        };
        assert_eq!(options, CopyOptions::default());
        let spec: JobSpec = serde_json::from_str(
            r#"{"kind":"move","sources":["/a"],"targetDir":"/b","options":{"conflictDefault":"overwriteIfNewer","renameTo":"x"}}"#,
        )
        .unwrap();
        assert_eq!(
            spec,
            JobSpec::Move {
                sources: vec!["/a".into()],
                target_dir: "/b".into(),
                background: false,
                options: CopyOptions {
                    conflict_default: ConflictDefault::OverwriteIfNewer,
                    rename_to: Some("x".into())
                },
                allow_dangerous: false,
                expected: Vec::new(),
            }
        );
        let spec: JobSpec =
            serde_json::from_str(r#"{"kind":"delete","paths":["/a"],"mode":"permanent"}"#).unwrap();
        assert_eq!(spec.kind(), "delete");
        assert!(!spec.is_parallel());
        let d: Decision =
            serde_json::from_str(r#"{"type":"rename","newName":"x (1).txt"}"#).unwrap();
        assert_eq!(
            d,
            Decision::Rename {
                new_name: Some("x (1).txt".into())
            }
        );
        let e = serde_json::to_value(JobEvent::State {
            id: "j1".into(),
            state: JobState::WaitingForDecision,
        })
        .unwrap();
        assert_eq!(e["type"], "state");
        assert_eq!(e["state"], "waitingForDecision");
        let spec: JobSpec =
            serde_json::from_str(r#"{"kind":"rename","items":[{"path":"/a","newName":"b"}]}"#)
                .unwrap();
        assert_eq!(spec.kind(), "rename");
        assert!(!spec.is_parallel());
        let e = serde_json::to_value(JobEvent::UndoAvailable {
            id: "j1".into(),
            available: true,
        })
        .unwrap();
        assert_eq!(e["type"], "undoAvailable");
        let spec: JobSpec = serde_json::from_str(
            r#"{"kind":"group","root":"/r","items":[{"path":"/a/x 01.mp3","group":"x"}],"transfer":"move"}"#,
        )
        .unwrap();
        assert_eq!(spec.kind(), "group");
        assert!(!spec.is_parallel());
        let spec: JobSpec = serde_json::from_str(
            r#"{"kind":"clean","roots":["/r"],"items":[{"path":"/r/e","kind":"dir"}],"mode":"trash","options":{"includeRoots":false,"junk":[".DS_Store"]}}"#,
        )
        .unwrap();
        let JobSpec::Clean { options, items, .. } = &spec else {
            panic!()
        };
        assert!(options.empty_dirs, "default on");
        assert_eq!(items[0].junk, 0);
        assert_eq!(spec.kind(), "clean");
        let e = serde_json::to_value(JobEvent::DirsChanged { dirs: vec![] }).unwrap();
        assert_eq!(e["type"], "dirsChanged");
        let spec: JobSpec = serde_json::from_str(
            r#"{"kind":"search","criteria":{"roots":["/r"],"name":"*.mp3","nameMode":"regex","kinds":{"files":true,"dirs":false},"maxDepth":3,"content":{"text":"x"}}}"#,
        )
        .unwrap();
        assert_eq!(spec.kind(), "search");
        assert!(spec.is_parallel() && spec.is_helper());
        let JobSpec::Search { criteria } = &spec else {
            panic!()
        };
        assert!(criteria.whole_name, "default on");
        assert!(criteria.kinds.links, "default on");
        assert!(!criteria.kinds.dirs);
        assert_eq!(criteria.max_depth, Some(3));
        let e = serde_json::to_value(JobEvent::SearchHits {
            id: "j1".into(),
            hits: vec![],
            stats: SearchStats::default(),
        })
        .unwrap();
        assert_eq!(e["type"], "searchHits");
        assert_eq!(e["stats"]["dirsScanned"], 0);
    }
}
