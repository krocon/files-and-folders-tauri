//! Duplicate search job (design 016 E6): runs `duplicates::find` and sends the
//! groups as `searchHits` (batches of [`BATCH_HITS`]) – the result tab of the
//! search shows them. While it runs, empty batches carry the statistics.

use super::{Control, ItemError, JobEvent, JobState, Summary};
use crate::duplicates::{self, DuplicateCriteria, Report};
use crate::search::{SearchHit, SearchStats};

pub const BATCH_HITS: usize = 500;

pub fn run(
    id: &str,
    criteria: &DuplicateCriteria,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    emit(JobEvent::State {
        id: id.to_string(),
        state: JobState::Running,
    });
    let send = |hits: Vec<SearchHit>, stats: &SearchStats| {
        emit(JobEvent::SearchHits {
            id: id.to_string(),
            hits,
            stats: stats.clone(),
        });
    };
    let result = duplicates::find(criteria, control.cancel_flag(), &mut |r| match r {
        Report::Stats(s) => send(Vec::new(), s),
    });
    let r = match result {
        Ok(r) => r,
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
    let hits: Vec<SearchHit> = r.groups.into_iter().flatten().collect();
    if hits.is_empty() {
        send(Vec::new(), &r.stats);
    }
    let mut rest = hits;
    while !rest.is_empty() {
        let tail = rest.split_off(rest.len().min(BATCH_HITS));
        send(rest, &r.stats);
        rest = tail;
    }
    let state = if r.cancelled || control.is_cancelled() {
        JobState::Cancelled
    } else if r.stats.unreadable > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    let errors: Vec<ItemError> = r
        .unreadable
        .into_iter()
        .take(super::MAX_REPORTED_ERRORS)
        .map(|error| ItemError {
            path: error.path.clone().unwrap_or_default(),
            error,
        })
        .collect();
    let summary = Summary {
        items_done: r.stats.hits,
        items_failed: r.stats.unreadable,
        errors,
        search: Some(r.stats),
        ..Summary::default()
    };
    (state, summary)
}
