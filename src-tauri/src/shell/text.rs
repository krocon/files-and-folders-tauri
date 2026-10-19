//! Output cleaning (design 021 E7): bytes → text (UTF-8, Windows OEM code page
//! as fallback, else U+FFFD), ANSI escape sequences removed, line ends unified.
//! Both work on a stream: a sequence cut at a block border is finished with the
//! next block.

/// Bytes → text across block borders.
#[derive(Debug, Default)]
pub struct Decoder {
    pending: Vec<u8>,
}

impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        let mut data = std::mem::take(&mut self.pending);
        data.extend_from_slice(bytes);
        self.decode(data, false)
    }

    /// The rest at the end of the stream.
    pub fn finish(&mut self) -> String {
        let data = std::mem::take(&mut self.pending);
        self.decode(data, true)
    }

    fn decode(&mut self, data: Vec<u8>, last: bool) -> String {
        let mut out = String::new();
        let mut rest: &[u8] = &data;
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    out.push_str(s);
                    return out;
                }
                Err(e) => {
                    let (valid, after) = rest.split_at(e.valid_up_to());
                    // `valid` is UTF-8 by `valid_up_to`
                    out.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match e.error_len() {
                        None if !last => {
                            // an incomplete sequence at the end: wait for the next block
                            self.pending = after.to_vec();
                            return out;
                        }
                        None => {
                            out.push_str(&legacy(after));
                            return out;
                        }
                        Some(n) => {
                            if cfg!(windows) {
                                // not UTF-8: the console code page (OEM) – decode the rest that way
                                out.push_str(&legacy(after));
                                return out;
                            }
                            out.push('\u{FFFD}');
                            rest = &after[n..];
                        }
                    }
                }
            }
        }
    }
}

/// Text that is no UTF-8: Windows → OEM code page, else lossy.
fn legacy(bytes: &[u8]) -> String {
    #[cfg(windows)]
    {
        if let Some(s) = crate::platform::process::decode_oem(bytes) {
            return s;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum State {
    #[default]
    Text,
    /// After ESC.
    Esc,
    /// ESC + intermediates (0x20–0x2F), waiting for the final byte.
    EscInter,
    /// CSI: ESC [ … final byte 0x40–0x7E.
    Csi,
    /// OSC/DCS/APC/PM/SOS: until BEL or ESC \ – or a line end (an unterminated
    /// sequence, e.g. `cat` of a binary file, must not hide the rest, review 021 #9).
    Str,
    /// ESC inside a string (maybe the start of ST).
    StrEsc,
}

/// Removes ANSI escape sequences and control characters (except `\n`, `\t`);
/// `\r\n` → `\n`, a lone `\r` → `\n` (progress bars become lines – simple and
/// predictable).
#[derive(Debug, Default)]
pub struct AnsiStripper {
    state: State,
    cr: bool,
}

impl AnsiStripper {
    pub fn push(&mut self, input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        for c in input.chars() {
            match self.state {
                State::Text => match c {
                    '\u{1b}' => self.state = State::Esc,
                    '\u{9b}' => self.state = State::Csi,
                    // `\r\r\n` (Windows) stays one line end
                    '\r' => self.cr = true,
                    '\n' => {
                        self.cr = false;
                        out.push('\n');
                    }
                    c if c == '\t' || !c.is_control() => {
                        if self.cr {
                            out.push('\n');
                            self.cr = false;
                        }
                        out.push(c);
                    }
                    _ => {} // other control characters (BEL, BS …)
                },
                State::Esc => {
                    self.state = match c {
                        '[' => State::Csi,
                        ']' | 'P' | '_' | '^' | 'X' => State::Str,
                        '\u{20}'..='\u{2f}' => State::EscInter,
                        _ => State::Text, // two-character sequence
                    }
                }
                State::EscInter => {
                    if !('\u{20}'..='\u{2f}').contains(&c) {
                        self.state = State::Text;
                    }
                }
                State::Csi => {
                    if ('\u{40}'..='\u{7e}').contains(&c) {
                        self.state = State::Text;
                    }
                }
                State::Str => match c {
                    '\u{7}' | '\u{9c}' => self.state = State::Text,
                    '\u{1b}' => self.state = State::StrEsc,
                    '\n' => self.state = State::Text,
                    _ => {}
                },
                State::StrEsc => {
                    self.state = if c == '\\' { State::Text } else { State::Str };
                }
            }
        }
        out
    }

    /// End of the stream: a pending `\r` becomes a line end.
    pub fn finish(&mut self) -> String {
        let out = if self.cr {
            "\n".to_string()
        } else {
            String::new()
        };
        *self = Self::default();
        out
    }
}

/// Convenience for tests and one-off strings.
pub fn strip_ansi(s: &str) -> String {
    let mut a = AnsiStripper::default();
    let mut out = a.push(s);
    out.push_str(&a.finish());
    out
}
