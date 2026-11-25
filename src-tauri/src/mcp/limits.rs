//! Hard limits of the MCP interface (design 071, rule 8). Every limit ends in an
//! error code, never in a crash or an unbounded allocation.

use std::time::{Duration, Instant};

/// One JSON-RPC message (a line) from a client.
pub const MAX_LINE_BYTES: usize = 1 << 20;
/// Clients connected at the same time.
pub const MAX_CONNECTIONS: usize = 4;
/// Tool calls of one connection that run at the same time.
pub const MAX_CALLS_AT_ONCE: usize = 4;
/// Calls per second of one connection (token bucket) and its burst.
pub const RATE_PER_SEC: f64 = 20.0;
pub const RATE_BURST: f64 = 40.0;
/// Running jobs one connection may have started.
pub const MAX_JOBS: usize = 2;
/// Entries of a list result: default and hard limit.
pub const DEFAULT_LIMIT: usize = 200;
pub const MAX_LIMIT: usize = 2000;
/// Paths of one call.
pub const MAX_PATHS: usize = 1000;
/// Entries of one proposal (the dialog shows all of them).
pub const MAX_PROPOSAL: usize = 5000;
/// Length of a path or a name in an argument.
pub const MAX_TEXT: usize = 4096;
/// A tool waits this long for its job; then it answers `running` with the job id.
pub const JOB_WAIT: Duration = Duration::from_secs(30);
/// A proposal's dialog may stay open this long.
pub const PROPOSAL_WAIT: Duration = Duration::from_secs(600);
/// The pairing question.
pub const PAIR_WAIT: Duration = Duration::from_secs(120);
/// At most one pairing question per client name in this time.
pub const PAIR_GAP: Duration = Duration::from_secs(30);
/// A view request (navigate, mark …) – the window answers at once.
pub const UI_WAIT: Duration = Duration::from_secs(10);
/// The palette's answer (`find_files`).
pub const FIND_WAIT: Duration = Duration::from_secs(5);
/// Lines of the call log (memory only).
pub const LOG_LINES: usize = 200;
/// `read_text`: default and hard limit.
pub const DEFAULT_TEXT_BYTES: u64 = 64 * 1024;
pub const MAX_TEXT_BYTES: u64 = 256 * 1024;
/// Results of finished jobs kept for `get_job`.
pub const KEPT_RESULTS: usize = 16;
/// Job ids remembered per hub (who started what).
pub const KEPT_OWNERS: usize = 256;

/// Token bucket: [`RATE_PER_SEC`] calls per second, [`RATE_BURST`] in a row.
#[derive(Debug)]
pub struct RateLimiter {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    pub fn new(now: Instant) -> Self {
        Self {
            tokens: RATE_BURST,
            last: now,
        }
    }

    /// Takes one token; false = too many calls.
    pub fn take(&mut self, now: Instant) -> bool {
        let gained = now.saturating_duration_since(self.last).as_secs_f64() * RATE_PER_SEC;
        self.tokens = (self.tokens + gained).min(RATE_BURST);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// `limit` of a list tool: the default, never more than the hard limit, never 0.
pub fn list_limit(wanted: Option<u64>) -> usize {
    match wanted {
        None => DEFAULT_LIMIT,
        Some(n) => (n as usize).clamp(1, MAX_LIMIT),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bucket_allows_a_burst_then_the_rate() {
        let start = Instant::now();
        let mut r = RateLimiter::new(start);
        for _ in 0..RATE_BURST as usize {
            assert!(r.take(start));
        }
        assert!(!r.take(start), "the burst is used up");
        // half a second later: ten more
        let later = start + Duration::from_millis(500);
        let allowed = (0..100).filter(|_| r.take(later)).count();
        assert_eq!(allowed, 10);
        // a long pause never gives more than the burst
        let much_later = later + Duration::from_secs(3600);
        let allowed = (0..1000).filter(|_| r.take(much_later)).count();
        assert_eq!(allowed, RATE_BURST as usize);
    }

    #[test]
    fn list_limits_are_clamped() {
        assert_eq!(list_limit(None), DEFAULT_LIMIT);
        assert_eq!(list_limit(Some(0)), 1);
        assert_eq!(list_limit(Some(5)), 5);
        assert_eq!(list_limit(Some(u64::MAX)), MAX_LIMIT);
    }
}
