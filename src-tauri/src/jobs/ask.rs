//! The conflict question of the archive jobs (design 016 E3.5): the same
//! `Conflict` event, decisions and "apply to all" as copying (`copy.rs`).

use super::report::Reporter;
use super::{Conflict, ConflictKind, Control, Decision, FileMeta, JobEvent, JobState};
use std::fs::Metadata;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub struct Asker {
    seq: u64,
    /// Answer for all further conflicts ("apply to all" or the dialog default).
    pub for_all: Option<Decision>,
}

pub fn meta_of(m: &Metadata) -> FileMeta {
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

impl Asker {
    pub fn new(for_all: Option<Decision>) -> Self {
        Self { seq: 0, for_all }
    }

    /// Asks what to do with an existing `target`; `None` = cancelled.
    #[allow(clippy::too_many_arguments)]
    pub fn ask(
        &mut self,
        id: &str,
        control: &Control,
        rep: &Reporter<'_>,
        source: &str,
        source_meta: FileMeta,
        target: &Path,
        target_meta: &Metadata,
    ) -> Option<Decision> {
        if let Some(d) = &self.for_all {
            return Some(d.clone());
        }
        self.seq += 1;
        rep.emit(JobEvent::Conflict {
            id: id.to_string(),
            conflict: Conflict {
                conflict_id: self.seq,
                kind: ConflictKind::Exists,
                source: source.to_string(),
                target: target.to_string_lossy().into_owned(),
                source_meta,
                target_meta: meta_of(target_meta),
                suggested_name: super::copy::suggest_name(target),
            },
        });
        let state = |s| {
            rep.emit(JobEvent::State {
                id: id.to_string(),
                state: s,
            })
        };
        state(JobState::WaitingForDecision);
        let answer = control.wait_for_decision(self.seq);
        if !control.is_cancelled() {
            state(if control.is_paused() {
                JobState::Paused
            } else {
                JobState::Running
            });
        }
        let (decision, all) = answer?;
        if all {
            self.for_all = Some(match decision {
                Decision::Rename { .. } => Decision::Rename { new_name: None },
                ref d => d.clone(),
            });
        }
        Some(decision)
    }
}
