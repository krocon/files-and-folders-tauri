//! Job engine (design 005): long or destructive operations run as jobs with an
//! id, byte progress, cancel, pause, conflict questions and per-item errors.
//! Pure std code without Tauri – the command layer only forwards events.
//! Keep in sync with `src/app/core/jobs/jobs.models.ts`.

pub mod control;
pub mod copy;
pub mod manager;
pub mod report;
#[cfg(test)]
mod tests_engine;

use crate::dirsize::DirSize;
use crate::error::FsError;
use serde::{Deserialize, Serialize};

pub use control::Control;
pub use manager::JobManager;

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
    },
    /// Recursive size of a folder (always runs in parallel).
    DirSize { path: String },
    /// Test job for load and throttling tests – rejected in release builds.
    Simulate { items: u32, item_ms: u32 },
}

impl JobSpec {
    /// Runs immediately instead of waiting in the serial queue.
    pub fn is_parallel(&self) -> bool {
        match self {
            JobSpec::Copy { background, .. } => *background,
            JobSpec::DirSize { .. } | JobSpec::Simulate { .. } => true,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            JobSpec::Copy { .. } => "copy",
            JobSpec::DirSize { .. } => "dirSize",
            JobSpec::Simulate { .. } => "simulate",
        }
    }
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
    pub source: String,
    pub target: String,
    pub source_meta: FileMeta,
    pub target_meta: FileMeta,
    /// Free name in the target folder (`name (1).ext`) for "rename".
    pub suggested_name: String,
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
        let e = serde_json::to_value(JobEvent::DirsChanged { dirs: vec![] }).unwrap();
        assert_eq!(e["type"], "dirsChanged");
    }
}
