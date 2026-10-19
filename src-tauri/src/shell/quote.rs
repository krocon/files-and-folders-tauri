//! Quoting of names and paths inserted into the shell field (design 021 E12).
//! The frontend never quotes or joins paths; it sends the strings and gets one
//! line back. The quoting matches the shell `run_shell` will use.

use super::ShellKind;
use crate::error::{FsError, FsErrorCode};

fn unquotable(message: &str) -> FsError {
    FsError::new(FsErrorCode::UnquotableName, message, None)
}

/// Characters that never need quotes in a POSIX shell.
fn posix_safe(c: char) -> bool {
    c.is_alphanumeric() || "_@%+=:,./-".contains(c)
}

/// Plain enough to insert without quotes: safe characters, and no leading `=`
/// (zsh: `=cmd` → path of cmd) or `%` (fish: `%self` → pid) – review 021 #3.
fn posix_plain(item: &str) -> bool {
    !item.starts_with(['=', '%']) && item.chars().all(posix_safe)
}

/// Bidi controls make the field show something else than what runs (review 021 #15).
fn is_bidi_control(c: char) -> bool {
    matches!(c, '\u{200E}' | '\u{200F}' | '\u{061C}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// One item for `kind`. `name` = a bare name (a leading `-` becomes `./-…` so it
/// is no option), else a full path.
pub fn quote_one(item: &str, kind: &ShellKind, name: bool) -> Result<String, FsError> {
    if item.is_empty() {
        return Err(unquotable("Empty name"));
    }
    if item.chars().any(|c| c.is_control() || is_bidi_control(c)) {
        return Err(unquotable(
            "The name contains control characters and cannot be inserted",
        ));
    }
    let item = if name && item.starts_with('-') {
        if kind.is_windows_style() {
            format!(".\\{item}")
        } else {
            format!("./{item}")
        }
    } else {
        item.to_string()
    };
    Ok(match kind {
        ShellKind::Posix { fish: false, .. } => {
            if posix_plain(&item) {
                item
            } else {
                format!("'{}'", item.replace('\'', r"'\''"))
            }
        }
        // fish: inside '…' only \' and \\ are escapes
        ShellKind::Posix { fish: true, .. } => {
            if posix_plain(&item) {
                item
            } else {
                format!("'{}'", item.replace('\\', r"\\").replace('\'', r"\'"))
            }
        }
        ShellKind::PowerShell { .. } => {
            let mut out = String::with_capacity(item.len() + 2);
            out.push('\'');
            for c in item.chars() {
                // PowerShell also treats the typographic single quotes as quotes
                if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
                    out.push(c);
                }
                out.push(c);
            }
            out.push('\'');
            out
        }
        ShellKind::Cmd { .. } => {
            // `%VAR%` and `!VAR!` expand even inside "…" with `cmd /C` – no safe escape
            if item.contains(['%', '!', '"']) {
                return Err(unquotable(
                    "The name cannot be quoted safely for cmd.exe – choose PowerShell in the settings",
                ));
            }
            format!("\"{item}\"")
        }
    })
}

/// All items, separated by one space.
pub fn quote(items: &[String], kind: &ShellKind, names: bool) -> Result<String, FsError> {
    let quoted = items
        .iter()
        .map(|i| quote_one(i, kind, names))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(quoted.join(" "))
}
