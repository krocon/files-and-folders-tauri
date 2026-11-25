//! Pairing of a client (design 071 E4): the name a client states is shown in the
//! window – it is not authentic, so it is only cleaned, never trusted. And the
//! question itself must not become a tool against the user: it gets rarer with every
//! "no" and stops after a few (review #3).

use super::limits::PAIR_GAP;
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const MAX_NAME_CHARS: usize = 64;
pub const UNKNOWN_CLIENT: &str = "unknown client";
/// After this many questions that were not answered with yes, nobody is asked any
/// more until MCP is switched off and on again.
pub const MAX_DENIALS: u32 = 5;
/// Different names asked about within [`PAIR_GAP`].
const MAX_NAMES: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pairing {
    Unknown,
    Allowed,
    Denied,
}

/// A character that is not seen or changes how the text around it reads: controls
/// (Cc), format characters (Cf: bidi marks, zero-width characters, soft hyphen, tags,
/// interlinear annotation …), line/paragraph separators, fillers that render as
/// nothing and variation selectors (review #7).
pub fn is_hidden_char(c: char) -> bool {
    use icu_properties::CodePointMapData;
    use icu_properties::props::GeneralCategory;
    if c.is_ascii() {
        return c.is_ascii_control();
    }
    if matches!(c,
        '\u{034F}' | '\u{115F}' | '\u{1160}' | '\u{17B4}' | '\u{17B5}' | '\u{3164}' | '\u{FFA0}'
        | '\u{180B}'..='\u{180F}'
        | '\u{FE00}'..='\u{FE0F}'
        | '\u{E0100}'..='\u{E01EF}')
    {
        return true;
    }
    matches!(
        CodePointMapData::<GeneralCategory>::new().get(c),
        GeneralCategory::Control
            | GeneralCategory::Format
            | GeneralCategory::LineSeparator
            | GeneralCategory::ParagraphSeparator
            | GeneralCategory::Surrogate
            | GeneralCategory::PrivateUse
            | GeneralCategory::Unassigned
    )
}

/// A text of a client that is shown as it is (a proposed name, a tab title): nothing
/// hidden in it.
pub fn is_plain(text: &str) -> bool {
    !text.chars().any(is_hidden_char)
}

fn is_quote(c: char) -> bool {
    matches!(
        c,
        '"' | '\'' | '`' | '´' | '«' | '»' | '\u{2018}'..='\u{201F}' | '\u{2039}' | '\u{203A}'
    )
}

/// The name for the window and `mcp.clients`: visible characters only, one line, no
/// quotation marks (the window puts the name in quotes), at most [`MAX_NAME_CHARS`].
pub fn clean_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !is_hidden_char(*c) && !is_quote(*c))
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

/// When the pairing question may be shown. Per name: once in [`PAIR_GAP`]. For all
/// names together: after every question that did not end with a yes the pause doubles
/// (30 s, 1 min, 2 min, 4 min), and after [`MAX_DENIALS`] of them nobody is asked any
/// more – until the user switches MCP off and on (a new gate).
#[derive(Debug, Default)]
pub struct PromptGate {
    last: HashMap<String, Instant>,
    denials: u32,
    quiet_until: Option<Instant>,
}

impl PromptGate {
    pub fn may_ask(&mut self, name: &str, now: Instant) -> bool {
        if self.denials >= MAX_DENIALS || self.quiet_until.is_some_and(|t| now < t) {
            return false;
        }
        self.last
            .retain(|_, t| now.saturating_duration_since(*t) < PAIR_GAP);
        if self.last.contains_key(name) {
            return false;
        }
        // a client inventing names must not fill the memory or the screen
        if self.last.len() >= MAX_NAMES {
            return false;
        }
        self.last.insert(name.to_string(), now);
        true
    }

    /// The question about `name` ended: `allowed` = the user said yes. Anything else
    /// (no, no answer, the window was busy) makes the next question wait longer.
    pub fn answered(&mut self, name: &str, allowed: bool, now: Instant) {
        if allowed {
            self.last.remove(name);
            self.denials = 0;
            self.quiet_until = None;
            return;
        }
        self.denials += 1;
        let pause = PAIR_GAP * 2u32.saturating_pow(self.denials.saturating_sub(1).min(8));
        self.quiet_until = Some(now + pause.min(Duration::from_secs(3600)));
    }

    /// Nobody is asked any more (until a new gate).
    pub fn closed(&self) -> bool {
        self.denials >= MAX_DENIALS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned() {
        assert_eq!(clean_name("  Claude\tCode \n"), "Claude Code");
        assert_eq!(clean_name(""), UNKNOWN_CLIENT);
        assert_eq!(clean_name("\u{202E}\u{200B}"), UNKNOWN_CLIENT);
        assert_eq!(clean_name("a\u{0}b\u{1b}[31m"), "ab[31m");
        assert_eq!(clean_name(&"x".repeat(500)).chars().count(), MAX_NAME_CHARS);
        assert_eq!(clean_name("Ünï cödé 🤖"), "Ünï cödé 🤖");
    }

    /// Review #7: every format character goes, and a name cannot close the quotes the
    /// window puts around it.
    #[test]
    fn names_lose_every_hidden_character_and_quotes() {
        let hidden = [
            '\u{061C}',
            '\u{00AD}',
            '\u{115F}',
            '\u{3164}',
            '\u{FFF9}',
            '\u{FFFA}',
            '\u{FFFB}',
            '\u{FE0F}',
            '\u{E0101}',
            '\u{200D}',
            '\u{2028}',
            '\u{2066}',
            '\u{180E}',
            '\u{E0041}',
        ];
        for c in hidden {
            assert!(is_hidden_char(c), "U+{:04X}", c as u32);
            // a separator counts as white space: it becomes a plain blank
            let expected = if c.is_whitespace() {
                "Cla ude"
            } else {
                "Claude"
            };
            assert_eq!(
                clean_name(&format!("Cla{c}ude")),
                expected,
                "U+{:04X}",
                c as u32
            );
        }
        assert_eq!(
            clean_name("Claude\u{201D} wants to delete. \u{201C}x"),
            "Claude wants to delete. x"
        );
        assert_eq!(clean_name("a\"b'c`d«e»"), "abcde");
        for c in ['a', 'ß', 'é', '日', '🤖', ' ', '-', '_', '.', '(', '１'] {
            assert!(!is_hidden_char(c), "{c}");
        }
        assert!(is_plain("2026-11-25 Rechnung (März).pdf"));
        assert!(!is_plain("invoice\u{202E}fdp.exe"));
        assert!(!is_plain("a\tb"));
    }

    #[test]
    fn one_question_per_name_and_gap() {
        let mut g = PromptGate::default();
        let t = Instant::now();
        assert!(g.may_ask("a", t));
        assert!(!g.may_ask("a", t + Duration::from_secs(1)));
        assert!(g.may_ask("b", t));
        assert!(g.may_ask("a", t + PAIR_GAP + Duration::from_secs(1)));
        g.answered("a", true, t);
        assert!(g.may_ask("a", t + PAIR_GAP + Duration::from_secs(2)));
    }

    #[test]
    fn invented_names_do_not_flood() {
        let mut g = PromptGate::default();
        let t = Instant::now();
        let asked = (0..100).filter(|i| g.may_ask(&format!("n{i}"), t)).count();
        assert_eq!(asked, 8);
    }

    /// Review #3: every "no" makes the next question wait longer – whatever the name –
    /// and after a few nobody is asked any more.
    #[test]
    fn denials_slow_the_question_down_and_then_stop_it() {
        let mut g = PromptGate::default();
        let mut now = Instant::now();
        let mut pauses = Vec::new();
        for i in 0..MAX_DENIALS {
            let name = format!("client {i}");
            assert!(g.may_ask(&name, now), "question {i}");
            g.answered(&name, false, now);
            // another name does not get around the pause
            assert!(!g.may_ask("someone else", now + Duration::from_secs(1)));
            if g.closed() {
                break;
            }
            let pause = PAIR_GAP * 2u32.pow(i);
            assert!(!g.may_ask("x", now + pause - Duration::from_secs(1)));
            pauses.push(pause);
            now += pause + Duration::from_secs(1);
        }
        assert_eq!(pauses.len() as u32, MAX_DENIALS - 1);
        assert!(
            pauses.windows(2).all(|w| w[1] == w[0] * 2),
            "the pause doubles"
        );
        assert!(g.closed());
        assert!(!g.may_ask("anyone", now + Duration::from_secs(100_000)));
        // a yes in between starts over
        let mut g = PromptGate::default();
        let t = Instant::now();
        assert!(g.may_ask("a", t));
        g.answered("a", false, t);
        let later = t + PAIR_GAP + Duration::from_secs(1);
        assert!(g.may_ask("b", later));
        g.answered("b", true, later);
        assert!(g.may_ask("c", later));
    }
}
