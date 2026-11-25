//! The call log (design 071, rule 9): tool, time, client, a count and the outcome –
//! in memory only, shown in the window. Never a path, a name or content.

use super::limits::LOG_LINES;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub at_ms: i64,
    pub client: String,
    pub tool: String,
    /// Paths in the call or entries in the answer.
    pub count: u32,
    /// `ok`, `confirmed`, `cancelled`, `running` or an error code.
    pub outcome: String,
}

#[derive(Debug, Default)]
pub struct CallLog(Mutex<VecDeque<LogLine>>);

impl CallLog {
    pub fn add(&self, line: LogLine) {
        let mut l = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if l.len() >= LOG_LINES {
            l.pop_front();
        }
        l.push_back(line);
    }

    /// Newest last.
    pub fn lines(&self) -> Vec<LogLine> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect()
    }

    pub fn clear(&self) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_is_bounded() {
        let log = CallLog::default();
        for i in 0..(LOG_LINES + 50) {
            log.add(LogLine {
                at_ms: i as i64,
                client: "c".into(),
                tool: "t".into(),
                count: 0,
                outcome: "ok".into(),
            });
        }
        let lines = log.lines();
        assert_eq!(lines.len(), LOG_LINES);
        assert_eq!(lines[0].at_ms, 50);
    }
}
