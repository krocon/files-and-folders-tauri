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

    /// Adds a line – or, if the newest line is the same refusal of the same client
    /// (`merge`), counts it there: a client that is not paired cannot push everything
    /// else out of the log by calling (review #9).
    pub fn add_or_count(&self, line: LogLine, merge: bool) {
        let mut l = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if merge
            && let Some(last) = l.back_mut()
            && last.client == line.client
            && last.outcome == line.outcome
        {
            last.count = last.count.saturating_add(1);
            last.at_ms = line.at_ms;
            last.tool = "*".to_string();
            return;
        }
        drop(l);
        self.add(line);
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

    fn line(client: &str, tool: &str, outcome: &str) -> LogLine {
        LogLine {
            at_ms: 1,
            client: client.into(),
            tool: tool.into(),
            count: 1,
            outcome: outcome.into(),
        }
    }

    /// Review #9: refused calls of one client are one line with a count.
    #[test]
    fn repeated_refusals_are_counted_in_one_line() {
        let log = CallLog::default();
        log.add(line("good", "get_selection", "ok"));
        for _ in 0..500 {
            log.add_or_count(line("bad", "list_directory", "not_paired"), true);
        }
        log.add_or_count(line("other", "search", "not_paired"), true);
        log.add_or_count(line("good", "search", "ok"), false);
        log.add_or_count(line("good", "search", "ok"), false);
        let lines = log.lines();
        assert_eq!(lines.len(), 5);
        assert_eq!(
            lines[0].tool, "get_selection",
            "the useful line is still there"
        );
        assert_eq!(
            (
                lines[1].client.as_str(),
                lines[1].count,
                lines[1].tool.as_str()
            ),
            ("bad", 500, "*")
        );
    }

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
