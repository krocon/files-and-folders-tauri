//! The lines yt-dlp prints for us (design 078 E-j). The templates in [`super::args`]
//! make every line we read start with a random marker of this process – a title or an
//! error text from a web page cannot forge one. Everything else on stdout is dropped;
//! of stderr only the last error line is kept, cleaned and cut.
//!
//! ```text
//! <M>|item|<title as JSON>
//! <M>|dl|<status>|<downloaded>|<total>|<total estimate>|<speed>|<eta>
//! <M>|pp|<status>|<postprocessor>
//! <M>|file|<True|False|NA>|<path as JSON>
//! ```
//! Missing values are `NA`; numbers may be floats.

/// Longer lines are dropped as a whole.
pub const MAX_LINE: usize = 16 * 1024;
pub const MAX_TITLE: usize = 200;
pub const MAX_ERROR: usize = 300;
pub const MAX_PATH: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Line {
    /// A video is about to be downloaded.
    Item { title: String },
    Download {
        finished: bool,
        done: Option<u64>,
        /// Exact, or yt-dlp's estimate.
        total: Option<u64>,
        speed: Option<u64>,
    },
    /// A post-processor (ffmpeg: merge, extract audio, embed …) started or finished.
    Post { finished: bool },
    /// A file is at its final place. `real` = `Some(false)`: it was there already.
    File { real: Option<bool>, path: String },
}

fn is_bidi_control(c: char) -> bool {
    matches!(c, '\u{200E}' | '\u{200F}' | '\u{061C}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// Hostile text for the window: no control or bidi characters, blanks collapsed, cut.
pub fn clean_text(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut n = 0;
    let mut blank = true; // also trims the start
    for c in s.chars() {
        let c = if c.is_whitespace() { ' ' } else { c };
        if c.is_control() || is_bidi_control(c) {
            continue;
        }
        if c == ' ' {
            if blank {
                continue;
            }
            blank = true;
        } else {
            blank = false;
        }
        if n + 1 >= max {
            out.push('…');
            break;
        }
        out.push(c);
        n += 1;
    }
    out.trim_end().to_string()
}

/// `1234`, `1234.5`, `NA` → a count (never negative, never NaN).
fn number(s: &str) -> Option<u64> {
    let v: f64 = s.trim().parse().ok()?;
    if !v.is_finite() || v < 0.0 {
        return None;
    }
    Some(if v >= u64::MAX as f64 {
        u64::MAX
    } else {
        v as u64
    })
}

fn json_text(s: &str) -> Option<String> {
    serde_json::from_str::<String>(s.trim()).ok()
}

/// One line of output → what it says, `None` for everything that is not ours.
pub fn parse(marker: &str, line: &str) -> Option<Line> {
    if marker.is_empty() || line.len() > MAX_LINE {
        return None;
    }
    let rest = line
        .trim_start()
        .strip_prefix(marker)?
        .strip_prefix('|')?
        .trim_end_matches(['\r', '\n']);
    let (kind, rest) = rest.split_once('|')?;
    match kind {
        "item" => Some(Line::Item {
            title: json_text(rest)
                .map(|t| clean_text(&t, MAX_TITLE))
                .unwrap_or_default(),
        }),
        "dl" => {
            let f: Vec<&str> = rest.split('|').collect();
            let [status, done, total, estimate, speed, _eta] = f.as_slice() else {
                return None;
            };
            let finished = match *status {
                "downloading" => false,
                "finished" => true,
                _ => return None,
            };
            Some(Line::Download {
                finished,
                done: number(done),
                total: number(total).or_else(|| number(estimate)),
                speed: number(speed),
            })
        }
        "pp" => {
            let (status, _name) = rest.split_once('|')?;
            match status {
                "started" | "processing" => Some(Line::Post { finished: false }),
                "finished" => Some(Line::Post { finished: true }),
                _ => None,
            }
        }
        "file" => {
            let (real, path) = rest.split_once('|')?;
            let path = json_text(path)?;
            if path.is_empty() || path.len() > MAX_PATH || path.contains('\0') {
                return None;
            }
            Some(Line::File {
                real: match real {
                    "True" => Some(true),
                    "False" => Some(false),
                    _ => None,
                },
                path,
            })
        }
        _ => None,
    }
}

/// Splits decoded output into lines (`\n`, `\r\n`, a lone `\r`); a line beyond
/// [`MAX_LINE`] is dropped up to its end, memory stays bounded.
#[derive(Debug, Default)]
pub struct LineSplitter {
    buf: String,
    overflow: bool,
}

impl LineSplitter {
    pub fn push(&mut self, text: &str, mut line: impl FnMut(&str)) {
        for c in text.chars() {
            if c == '\n' || c == '\r' {
                if !self.overflow && !self.buf.is_empty() {
                    line(&self.buf);
                }
                self.buf.clear();
                self.overflow = false;
            } else if !self.overflow {
                if self.buf.len() + c.len_utf8() > MAX_LINE {
                    self.overflow = true;
                    self.buf.clear();
                } else {
                    self.buf.push(c);
                }
            }
        }
    }

    pub fn finish(&mut self, mut line: impl FnMut(&str)) {
        if !self.overflow && !self.buf.is_empty() {
            line(&self.buf);
        }
        self.buf.clear();
        self.overflow = false;
    }
}

/// Keeps the reason of a failure from stderr: the last line that starts with `ERROR:`,
/// else the last line at all.
#[derive(Debug, Default)]
pub struct ErrorLine {
    error: Option<String>,
    last: Option<String>,
}

impl ErrorLine {
    pub fn push(&mut self, line: &str) {
        let text = clean_text(line, MAX_ERROR);
        if text.is_empty() {
            return;
        }
        if let Some(rest) = text.strip_prefix("ERROR:") {
            self.error = Some(rest.trim().to_string());
        } else {
            self.last = Some(text);
        }
    }

    pub fn take(&mut self) -> Option<String> {
        self.error
            .take()
            .or_else(|| self.last.take())
            .filter(|s| !s.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::text::Decoder;

    const M: &str = "M";

    /// The fixtures are **synthetic** (design 078 §5): built from the templates in
    /// `args.rs` and yt-dlp's source, not recorded from a run.
    fn fixture(name: &str) -> Vec<Line> {
        let text = match name {
            "video" => include_str!("testdata/synthetic-video.txt"),
            "audio" => include_str!("testdata/synthetic-audio.txt"),
            "playlist" => include_str!("testdata/synthetic-playlist.txt"),
            "present" => include_str!("testdata/synthetic-present.txt"),
            "error" => include_str!("testdata/synthetic-error.txt"),
            _ => unreachable!(),
        };
        let mut lines = Vec::new();
        let mut s = LineSplitter::default();
        s.push(text, |l| lines.extend(parse(M, l)));
        s.finish(|l| lines.extend(parse(M, l)));
        lines
    }

    fn files(lines: &[Line]) -> Vec<(Option<bool>, &str)> {
        lines
            .iter()
            .filter_map(|l| match l {
                Line::File { real, path } => Some((*real, path.as_str())),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_video_with_two_streams_and_a_merge() {
        let lines = fixture("video");
        assert_eq!(
            lines[0],
            Line::Item {
                title: "Mein Video ä 🎬 a/b".into()
            }
        );
        // exact total, then an estimate, floats, NA
        assert!(lines.contains(&Line::Download {
            finished: false,
            done: Some(1024),
            total: Some(1_048_576),
            speed: Some(524_288),
        }));
        assert!(lines.contains(&Line::Download {
            finished: false,
            done: Some(2048),
            total: Some(4096),
            speed: None,
        }));
        assert!(lines.contains(&Line::Download {
            finished: false,
            done: Some(0),
            total: None,
            speed: None,
        }));
        assert_eq!(
            lines
                .iter()
                .filter(|l| matches!(l, Line::Download { finished: true, .. }))
                .count(),
            2
        );
        assert!(lines.contains(&Line::Post { finished: false }));
        assert!(lines.contains(&Line::Post { finished: true }));
        assert_eq!(
            files(&lines),
            [(Some(true), "/ziel/Mein Video ä 🎬 a⧸b [abc123].mp4")]
        );
    }

    #[test]
    fn audio_playlist_present_and_error() {
        let lines = fixture("audio");
        assert_eq!(files(&lines), [(Some(true), "/ziel/Lied [x1].mp3")]);
        assert!(lines.contains(&Line::Post { finished: false }));

        let lines = fixture("playlist");
        assert_eq!(
            lines
                .iter()
                .filter(|l| matches!(l, Line::Item { .. }))
                .count(),
            3
        );
        assert_eq!(files(&lines).len(), 2, "the third entry failed");

        let lines = fixture("present");
        assert_eq!(files(&lines), [(Some(false), "/ziel/Schon da [p1].mp4")]);
        assert!(!lines.iter().any(|l| matches!(l, Line::Download { .. })));

        // a failing URL prints nothing of ours on stdout
        assert_eq!(fixture("error"), []);
    }

    #[test]
    fn only_lines_with_the_marker_count() {
        for line in [
            "",
            "[download] 100% of 1.00MiB",
            "X|dl|downloading|1|2|NA|3|4",
            "M",
            "M|",
            "M|dl",
            "M|dl|downloading|1|2|NA|3",
            "M|dl|downloading|1|2|NA|3|4|5",
            "M|dl|error|1|2|NA|3|4",
            "M|nope|x",
            "M|file|True|/not/json",
            "M|file|True|\"\"",
            "M|file|True|\"a\\u0000b\"",
            "M|file|True|[\"/x\"]",
            "M|pp|weird|Merger",
            "MM|dl|downloading|1|2|NA|3|4",
        ] {
            assert_eq!(parse(M, line), None, "{line:?}");
        }
        // no marker → nothing is ours
        assert_eq!(parse("", "|dl|downloading|1|2|NA|3|4"), None);
        // a title cannot smuggle a line: it is JSON on one line
        assert_eq!(
            parse(M, r#"M|item|"a\nM|file|True|\"/etc/passwd\"""#),
            Some(Line::Item {
                title: "a M|file|True|\"/etc/passwd\"".into()
            })
        );
        // numbers
        assert_eq!(
            parse(M, "M|dl|downloading|-5|inf|nan|1e400|NA"),
            Some(Line::Download {
                finished: false,
                done: None,
                total: None,
                speed: None
            })
        );
        assert_eq!(
            parse(M, "  M|dl|finished|10.9|NA|20.2|NA|NA\r"),
            Some(Line::Download {
                finished: true,
                done: Some(10),
                total: Some(20),
                speed: None
            })
        );
        assert_eq!(
            parse(M, "M|item|NA"),
            Some(Line::Item {
                title: String::new()
            })
        );
        let long = format!("M|item|\"{}\"", "a".repeat(MAX_LINE));
        assert_eq!(parse(M, &long), None);
        let title = format!("M|item|\"{}\"", "ä".repeat(500));
        let Some(Line::Item { title }) = parse(M, &title) else {
            panic!()
        };
        assert_eq!(title.chars().count(), MAX_TITLE);
    }

    #[test]
    fn lines_are_split_and_bounded() {
        let mut got: Vec<String> = Vec::new();
        let mut s = LineSplitter::default();
        s.push("a\r\nb\rc", |l| got.push(l.into()));
        s.push("d\n\n", |l| got.push(l.into()));
        let huge = "x".repeat(MAX_LINE * 3);
        s.push(&huge, |l| got.push(l.into()));
        s.push("tail\nnext\nrest", |l| got.push(l.into()));
        s.finish(|l| got.push(l.into()));
        assert_eq!(got, ["a", "b", "cd", "next", "rest"]);
        // an endless line never grows the buffer
        let mut s = LineSplitter::default();
        for _ in 0..100 {
            s.push(&huge, |_| panic!("no line"));
        }
        assert!(s.buf.len() <= MAX_LINE);
    }

    #[test]
    fn output_that_is_no_utf8_does_not_break_the_reader() {
        let mut d = Decoder::default();
        let mut bytes = b"M|dl|downloading|1|2|NA|3|4\n".to_vec();
        bytes.extend_from_slice(&[0xff, 0xfe, 0x80, b'\n']);
        bytes.extend_from_slice(b"M|pp|started|Merger\n");
        let text = d.push(&bytes) + &d.finish();
        let mut lines = Vec::new();
        let mut s = LineSplitter::default();
        s.push(&text, |l| lines.extend(parse(M, l)));
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn the_error_is_the_last_error_line_cleaned() {
        let mut e = ErrorLine::default();
        assert_eq!(e.take(), None);
        e.push("WARNING: [youtube] something");
        e.push("ERROR: [generic] Unable to download webpage: \u{1b}[31mHTTP Error 404\u{202e}: Not Found");
        e.push("WARNING: later");
        e.push("   ");
        assert_eq!(
            e.take().as_deref(),
            Some("[generic] Unable to download webpage: [31mHTTP Error 404: Not Found")
        );
        e.push("just a line");
        assert_eq!(e.take().as_deref(), Some("just a line"));
        e.push(&format!("ERROR: {}", "ä".repeat(1000)));
        assert!(e.take().unwrap().chars().count() <= MAX_ERROR);
        assert_eq!(clean_text("  a \t\n b\u{0}c  ", 100), "a bc");
        assert_eq!(clean_text("abcdef", 4), "abc…");
    }
}
