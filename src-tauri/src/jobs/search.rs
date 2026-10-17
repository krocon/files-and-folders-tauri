//! Search job (design 009 E1): runs `search::walk` and streams the hits in
//! batches over the job channel – at most [`BATCH_HITS`] per event, at least
//! every [`BATCH_INTERVAL`] while hits wait, statistics every [`STATS_INTERVAL`].
//! Hits are never stored in the job info (only streamed).

use super::{Control, ItemError, JobEvent, JobState, Summary};
use crate::search::{self, SearchCriteria, SearchHit, SearchStats};
use std::time::{Duration, Instant};

pub const BATCH_HITS: usize = 500;
pub const BATCH_INTERVAL: Duration = Duration::from_millis(50);
pub const STATS_INTERVAL: Duration = Duration::from_millis(250);

pub fn run(
    id: &str,
    criteria: &SearchCriteria,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let compiled = match search::compile(criteria) {
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
    // every root missing: the job fails; some missing: they are reported as unreadable
    let bad = compiled.check_roots();
    if bad.len() == compiled.roots().len() {
        return (
            JobState::Failed,
            Summary {
                error: bad.into_iter().next(),
                ..Summary::default()
            },
        );
    }
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
    let mut pending: Vec<SearchHit> = Vec::new();
    let mut last = Instant::now();
    let result = search::walk(&compiled, control.cancel_flag(), &mut |hit, stats| {
        let folder_done = hit.is_none();
        if let Some(h) = hit {
            pending.push(h);
        }
        let since = last.elapsed();
        if pending.len() >= BATCH_HITS
            || (!pending.is_empty() && since >= BATCH_INTERVAL)
            || since >= STATS_INTERVAL
        {
            send(std::mem::take(&mut pending), stats);
            last = Instant::now();
        }
        if folder_done {
            // pause between folders (not offered in the UI, but the engine supports it)
            control.wait_while_paused();
        }
    });
    // the last batch always comes (with the final statistics)
    send(std::mem::take(&mut pending), &result.stats);
    let state = if control.is_cancelled() {
        JobState::Cancelled
    } else if result.stats.unreadable > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    let errors: Vec<ItemError> = result
        .unreadable
        .into_iter()
        .map(|error| ItemError {
            path: error.path.clone().unwrap_or_default(),
            error,
        })
        .collect();
    let summary = Summary {
        items_done: result.stats.hits,
        items_failed: result.stats.unreadable,
        errors,
        search: Some(result.stats),
        ..Summary::default()
    };
    (state, summary)
}
