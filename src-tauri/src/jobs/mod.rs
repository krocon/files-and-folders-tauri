//! Job engine (design 005): long or destructive operations run as jobs with an
//! id, byte progress, cancel, pause, conflict questions and per-item errors.
//! Pure std code without Tauri – the command layer only forwards events.
//! Keep in sync with `src/app/core/jobs/jobs.models.ts`.

pub mod control;
pub mod copy;
pub mod delete;
pub mod manager;
pub mod rename;
pub mod report;
#[cfg(test)]
mod tests_engine;
#[cfg(test)]
mod tests_ops;

use crate::dirsize::DirSize;
use crate::error::FsError;
use serde::{Deserialize, Serialize};

pub use control::Control;
pub use manager::JobManager;
pub use rename::RenameItem;

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
    },
    /// Delete to the trash (default) or permanently.
    Delete {
        paths: Vec<String>,
        mode: DeleteMode,
        #[serde(default)]
        background: bool,
        #[serde(default)]
        allow_dangerous: bool,
    },
    /// Multi-rename (design 007): every entry gets a new name in its folder.
    /// `undo_of` = the job this one undoes (runs the valid pairs even if others
    /// fail) – set only by `JobManager::undo_rename`, never read from the frontend.
    Rename {
        items: Vec<RenameItem>,
        #[serde(default, skip_deserializing)]
        undo_of: Option<String>,
    },
    /// Counts files, folders and bytes of a selection (copy dialog; parallel).
    Count { paths: Vec<String> },
    /// Recursive size of a folder (always runs in parallel).
    DirSize { path: String },
    /// Test job for load and throttling tests – rejected in release builds.
    Simulate { items: u32, item_ms: u32 },
}

impl JobSpec {
    /// Runs immediately instead of waiting in the serial queue.
    pub fn is_parallel(&self) -> bool {
        match self {
            JobSpec::Copy { background, .. }
            | JobSpec::Move { background, .. }
            | JobSpec::Delete { background, .. } => *background,
            JobSpec::Rename { .. } => false,
            JobSpec::DirSize { .. } | JobSpec::Count { .. } | JobSpec::Simulate { .. } => true,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            JobSpec::Copy { .. } => "copy",
            JobSpec::Move { .. } => "move",
            JobSpec::Delete { .. } => "delete",
            JobSpec::Rename { .. } => "rename",
            JobSpec::Count { .. } => "count",
            JobSpec::DirSize { .. } => "dirSize",
            JobSpec::Simulate { .. } => "simulate",
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
                allow_dangerous: false
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
        let e = serde_json::to_value(JobEvent::DirsChanged { dirs: vec![] }).unwrap();
        assert_eq!(e["type"], "dirsChanged");
    }
}
