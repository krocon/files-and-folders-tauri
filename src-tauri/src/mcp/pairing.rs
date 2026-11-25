//! Pairing of a client (design 071 E4): the name a client states is shown in the
//! window – it is not authentic, so it is only cleaned, never trusted.

use super::limits::PAIR_GAP;
use std::collections::HashMap;
use std::time::Instant;

pub const MAX_NAME_CHARS: usize = 64;
pub const UNKNOWN_CLIENT: &str = "unknown client";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pairing {
    Unknown,
    Allowed,
    Denied,
}

/// The name for the window and `mcp.clients`: visible characters only, one line,
/// at most [`MAX_NAME_CHARS`].
pub fn clean_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !c.is_control() && !is_invisible(*c))
        .collect();
    let trimmed: String = cleaned
        .split(' ')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    let trimmed = trimmed.trim_end().to_string();
    if trimmed.is_empty() {
        UNKNOWN_CLIENT.to_string()
    } else {
        trimmed
    }
}

/// Characters that change how a name reads without being seen (bidi controls,
/// zero-width characters, tags).
fn is_invisible(c: char) -> bool {
    matches!(c,
        '\u{200B}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2069}'
        | '\u{FEFF}'
        | '\u{E0000}'..='\u{E007F}')
}

/// At most one pairing question per name in [`PAIR_GAP`] (no storm of questions).
#[derive(Debug, Default)]
pub struct PromptGate {
    last: HashMap<String, Instant>,
}

impl PromptGate {
    pub fn may_ask(&mut self, name: &str, now: Instant) -> bool {
        self.last
            .retain(|_, t| now.saturating_duration_since(*t) < PAIR_GAP);
        if self.last.contains_key(name) {
            return false;
        }
        // a client inventing names must not fill the memory or the screen
        if self.last.len() >= 8 {
            return false;
        }
        self.last.insert(name.to_string(), now);
        true
    }

    /// The user answered: the next connection of this name may ask again at once.
    pub fn answered(&mut self, name: &str) {
        self.last.remove(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn names_are_cleaned() {
        assert_eq!(clean_name("  Claude\tCode \n"), "Claude Code");
        assert_eq!(clean_name(""), UNKNOWN_CLIENT);
        assert_eq!(clean_name("\u{202E}\u{200B}"), UNKNOWN_CLIENT);
        assert_eq!(clean_name("a\u{0}b\u{1b}[31m"), "ab[31m");
        assert_eq!(clean_name(&"x".repeat(500)).chars().count(), MAX_NAME_CHARS);
        assert_eq!(clean_name("Ünï cödé 🤖"), "Ünï cödé 🤖");
    }

    #[test]
    fn one_question_per_name_and_gap() {
        let mut g = PromptGate::default();
        let t = Instant::now();
        assert!(g.may_ask("a", t));
        assert!(!g.may_ask("a", t + Duration::from_secs(1)));
        assert!(g.may_ask("b", t));
        assert!(g.may_ask("a", t + PAIR_GAP + Duration::from_secs(1)));
        g.answered("a");
        assert!(g.may_ask("a", t + PAIR_GAP + Duration::from_secs(2)));
    }

    #[test]
    fn invented_names_do_not_flood() {
        let mut g = PromptGate::default();
        let t = Instant::now();
        let asked = (0..100).filter(|i| g.may_ask(&format!("n{i}"), t)).count();
        assert_eq!(asked, 8);
    }
}
