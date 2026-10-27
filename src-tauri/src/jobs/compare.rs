//! Compare job (design 036 E2): runs `compare::Compiled::walk` and streams the rows
//! like the search streams its hits – at most [`BATCH_ROWS`] per event, at least every
//! 50 ms while rows wait, statistics every 250 ms. Rows are never stored in the job info.

use super::search::{BATCH_INTERVAL, STATS_INTERVAL};
use super::{Control, JobEvent, JobState, Summary};
use crate::compare::{self, CompareOptions, CompareRow, CompareStats};
use std::path::Path;
use std::time::Instant;

pub const BATCH_ROWS: usize = 500;

pub fn run(
    id: &str,
    left: &Path,
    right: &Path,
    options: &CompareOptions,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let compiled = match compare::compile(left, right, options) {
        Ok(c) => c,
        Err(error) => {
            return (
                JobState::Failed,
                Summary {
                    error: Some(error),
                    ..Summary::default()
                },
            );
        }
    };
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let send = |rows: Vec<CompareRow>, stats: &CompareStats| {
        emit(JobEvent::CompareRows {
            id: id.to_string(),
            rows,
            stats: CompareStats {
                // the errors come with the summary, not with every batch
                errors: Vec::new(),
                ..stats.clone()
            },
        });
    };
    let mut pending: Vec<CompareRow> = Vec::new();
    let mut last = Instant::now();
    let stats = compiled.walk(control.cancel_flag(), &mut |row, stats| {
        let folder_done = row.is_none();
        if let Some(r) = row {
            pending.push(r);
        }
        let since = last.elapsed();
        if pending.len() >= BATCH_ROWS
            || (!pending.is_empty() && since >= BATCH_INTERVAL)
            || since >= STATS_INTERVAL
        {
            send(std::mem::take(&mut pending), stats);
            last = Instant::now();
        }
        if folder_done {
            control.wait_while_paused();
        }
    });
    send(std::mem::take(&mut pending), &stats);
    let state = if control.is_cancelled() {
        JobState::Cancelled
    } else if stats.unreadable > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    let summary = Summary {
        items_done: stats.rows,
        items_failed: stats.unreadable,
        errors: stats.errors.clone(),
        compare: Some(CompareStats {
            errors: Vec::new(),
            ..stats
        }),
        ..Summary::default()
    };
    (state, summary)
}
