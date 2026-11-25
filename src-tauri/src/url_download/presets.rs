//! Own presets for the download dialog (`url-download.json`, design 078 E-d). A preset
//! is an argument array for yt-dlp – checked against an **allow list**: every argument
//! is a known switch or a known option whose value passes its own check. yt-dlp gets new
//! options all the time, so nothing unknown is ever passed on; a preset with one refused
//! argument is dropped as a whole and reported with the reason.
//!
//! Never on the list: anything that starts a program or takes a path (`--exec`,
//! `--netrc-cmd`, `--downloader`, `--postprocessor-args`, `--use-postprocessor`,
//! `--config-locations`, `--plugin-dirs`, `--batch-file`, `--load-info-json`,
//! `--cookies`, `-o`, `-P`, `--ffmpeg-location`, `--print-to-file`, `--download-archive`,
//! `--cache-dir`, `--proxy` …).

use crate::config_file::{Loaded, read_config};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "url-download.json";
pub const VERSION: u32 = 1;
pub const MAX_PRESETS: usize = 50;
pub const MAX_ARGS: usize = 40;
pub const MAX_ID: usize = 64;
pub const MAX_LABEL: usize = 80;
pub const MAX_FILE_BYTES: u64 = 256 * 1024;

/// A preset as stored; after loading, `args` are in the canonical form
/// (`--long` / `--long=value`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub label: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetProblem {
    /// The preset's id as far as it can be shown (cleaned, cut).
    pub id: String,
    /// `id` | `label` | `duplicate` | `tooManyArgs` | `notAllowed` | `missingValue` |
    /// `badValue` | `unexpectedValue`
    pub reason: String,
    /// The option concerned (its name only, never a value).
    pub option: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetFile {
    pub presets: Vec<Preset>,
    pub problems: Vec<PresetProblem>,
}

type Check = fn(&str) -> bool;

/// (long name, short name, value check – `None` = a switch).
const ALLOWED: &[(&str, Option<&str>, Option<Check>)] = &[
    ("--format", Some("-f"), Some(format_ok)),
    ("--format-sort", Some("-S"), Some(sort_ok)),
    ("--extract-audio", Some("-x"), None),
    ("--audio-format", None, Some(containers_ok)),
    ("--audio-quality", None, Some(quality_ok)),
    ("--merge-output-format", None, Some(containers_ok)),
    ("--remux-video", None, Some(containers_ok)),
    ("--recode-video", None, Some(containers_ok)),
    ("--embed-thumbnail", None, None),
    ("--embed-metadata", None, None),
    ("--embed-chapters", None, None),
    ("--embed-subs", None, None),
    ("--write-subs", None, None),
    ("--write-auto-subs", None, None),
    ("--sub-langs", None, Some(langs_ok)),
    ("--sub-format", None, Some(containers_ok)),
    ("--convert-subs", None, Some(word_ok)),
    ("--convert-thumbnails", None, Some(word_ok)),
    ("--limit-rate", Some("-r"), Some(size_ok)),
    ("--concurrent-fragments", Some("-N"), Some(small_number_ok)),
    ("--retries", Some("-R"), Some(retries_ok)),
    ("--fragment-retries", None, Some(retries_ok)),
    ("--playlist-items", Some("-I"), Some(items_ok)),
    ("--max-filesize", None, Some(size_ok)),
    ("--min-filesize", None, Some(size_ok)),
    ("--sponsorblock-remove", None, Some(categories_ok)),
    ("--sponsorblock-mark", None, Some(categories_ok)),
    ("--mtime", None, None),
    ("--no-mtime", None, None),
];

fn all(s: &str, max: usize, ok: impl Fn(char) -> bool) -> bool {
    !s.is_empty() && s.len() <= max && !s.starts_with('-') && s.chars().all(ok)
}

/// A format selector: printable ASCII (`bv*[height<=720]+ba/b`). It selects among the
/// formats of the site – it names no file and no program.
fn format_ok(s: &str) -> bool {
    all(s, 300, |c| c.is_ascii_graphic() || c == ' ')
}

fn sort_ok(s: &str) -> bool {
    // `+res:480` starts with a plus, never with a dash
    all(s, 200, |c| {
        c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '.' | ',' | '+' | '~' | '-')
    })
}

fn containers_ok(s: &str) -> bool {
    all(s, 60, |c| {
        c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '/' | '>')
    })
}

fn word_ok(s: &str) -> bool {
    all(s, 16, |c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn quality_ok(s: &str) -> bool {
    all(s, 8, |c| c.is_ascii_alphanumeric() || c == '.')
}

fn langs_ok(s: &str) -> bool {
    super::sub_langs_ok(s)
}

fn size_ok(s: &str) -> bool {
    all(s, 12, |c| {
        c.is_ascii_digit() || matches!(c, '.' | 'K' | 'M' | 'G' | 'k' | 'm' | 'g' | 'i' | 'B')
    })
}

fn small_number_ok(s: &str) -> bool {
    s.parse::<u32>().is_ok_and(|n| (1..=32).contains(&n)) && all(s, 2, |c| c.is_ascii_digit())
}

fn retries_ok(s: &str) -> bool {
    s == "infinite" || all(s, 4, |c| c.is_ascii_digit())
}

fn items_ok(s: &str) -> bool {
    // `1:3,7,-5::2` – a leading dash is a negative index: it travels as `--playlist-items=-5`
    !s.is_empty()
        && s.len() <= 100
        && s.chars()
            .all(|c| c.is_ascii_digit() || matches!(c, ':' | ',' | '-'))
}

fn categories_ok(s: &str) -> bool {
    all(s, 120, |c| {
        c.is_ascii_lowercase() || matches!(c, '_' | ',' | '-')
    })
}

fn find(name: &str) -> Option<&'static (&'static str, Option<&'static str>, Option<Check>)> {
    ALLOWED
        .iter()
        .find(|(long, short, _)| *long == name || *short == Some(name))
}

/// The option's name for a problem report: only what an option name can be.
fn shown_option(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect()
}

/// Checks an argument array against the allow list; returns the canonical form
/// (`--long` / `--long=value`) or `(reason, option name)`.
pub fn check_args(args: &[String]) -> Result<Vec<String>, (&'static str, String)> {
    if args.len() > MAX_ARGS {
        return Err(("tooManyArgs", String::new()));
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        // `--opt=value` only for long options (a short one takes the next element)
        let (name, inline) = match arg.split_once('=') {
            Some((n, v)) if n.starts_with("--") => (n, Some(v)),
            _ => (arg.as_str(), None),
        };
        let Some((long, _, check)) = find(name) else {
            return Err(("notAllowed", shown_option(name)));
        };
        match (check, inline) {
            (None, None) => out.push((*long).to_string()),
            (None, Some(_)) => return Err(("unexpectedValue", (*long).to_string())),
            (Some(check), inline) => {
                let value = match inline {
                    Some(v) => v,
                    None => {
                        let Some(v) = args.get(i) else {
                            return Err(("missingValue", (*long).to_string()));
                        };
                        i += 1;
                        v.as_str()
                    }
                };
                if !check(value) {
                    return Err(("badValue", (*long).to_string()));
                }
                out.push(format!("{long}={value}"));
            }
        }
    }
    Ok(out)
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

fn clean_label(label: &str) -> String {
    let s: String = label
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_LABEL)
        .collect();
    s.trim().to_string()
}

fn shown_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .take(MAX_ID)
        .collect()
}

/// Keeps the presets that pass, reports the others.
pub fn sanitize(raw: Vec<Preset>) -> PresetFile {
    let mut out = PresetFile::default();
    for p in raw.into_iter().take(MAX_PRESETS * 4) {
        let mut problem = |reason: &str, option: Option<String>| {
            out.problems.push(PresetProblem {
                id: shown_id(&p.id),
                reason: reason.into(),
                option,
            });
        };
        if !valid_id(&p.id) {
            problem("id", None);
            continue;
        }
        if out.presets.iter().any(|q| q.id == p.id) {
            problem("duplicate", None);
            continue;
        }
        let label = clean_label(&p.label);
        if label.is_empty() {
            problem("label", None);
            continue;
        }
        match check_args(&p.args) {
            Ok(args) => {
                if out.presets.len() < MAX_PRESETS {
                    out.presets.push(Preset {
                        id: p.id,
                        label,
                        args,
                    });
                }
            }
            Err((reason, option)) => {
                problem(reason, Some(option).filter(|o| !o.is_empty()));
            }
        }
    }
    out
}

#[derive(Deserialize)]
struct RawFile {
    version: u32,
    #[serde(default)]
    presets: Vec<Preset>,
}

fn parse(text: &str) -> Result<PresetFile, String> {
    let f: RawFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if f.version != VERSION {
        return Err("unknown version".into());
    }
    Ok(sanitize(f.presets))
}

/// Reads `url-download.json`; a missing file means no presets.
pub fn load(file: &Path) -> Loaded<PresetFile> {
    read_config(file, MAX_FILE_BYTES, PresetFile::default, parse)
}

/// The file written when there is none: no presets, and an example of the format that
/// is not read (`example`).
pub fn default_file_text() -> String {
    let v = serde_json::json!({
        "version": VERSION,
        "presets": [],
        "example": {
            "id": "720p-mkv",
            "label": "Video 720p (mkv)",
            "args": ["-S", "res:720", "--merge-output-format", "mkv"]
        }
    });
    serde_json::to_string_pretty(&v).unwrap_or_default() + "\n"
}

/// Creates the file with [`default_file_text`] unless something is there.
pub fn ensure_file(file: &Path) {
    if !file.exists() {
        let _ = write_atomic(file, default_file_text().as_bytes());
    }
}

/// Writes the presets that pass (settings import); returns what was written.
pub fn save(file: &Path, raw: Vec<Preset>) -> io::Result<Vec<Preset>> {
    let presets = sanitize(raw).presets;
    let v = serde_json::json!({ "version": VERSION, "presets": presets });
    let text = serde_json::to_string_pretty(&v).map_err(io::Error::other)? + "\n";
    write_atomic(file, text.as_bytes())?;
    Ok(presets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn allowed_arguments_come_out_canonical() {
        assert_eq!(
            check_args(&v(&[
                "-S",
                "res:720",
                "--merge-output-format",
                "mkv",
                "-x",
                "--audio-format=mp3",
                "-f",
                "bv*[height<=720]+ba/b",
                "--embed-thumbnail",
                "-N",
                "4",
                "-I",
                "-5",
                "--sub-langs",
                "en.*,-live_chat",
                "-r",
                "2.5M",
                "--retries=infinite",
            ])),
            Ok(v(&[
                "--format-sort=res:720",
                "--merge-output-format=mkv",
                "--extract-audio",
                "--audio-format=mp3",
                "--format=bv*[height<=720]+ba/b",
                "--embed-thumbnail",
                "--concurrent-fragments=4",
                "--playlist-items=-5",
                "--sub-langs=en.*,-live_chat",
                "--limit-rate=2.5M",
                "--retries=infinite",
            ]))
        );
        assert_eq!(check_args(&[]), Ok(Vec::new()));
        // every canonical element is one `--option[=value]`
        for (long, _, _) in ALLOWED {
            assert!(long.starts_with("--"), "{long}");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for (args, reason, option) in [
            (v(&["--exec", "touch /tmp/pwned"]), "notAllowed", "--exec"),
            (v(&["--exec=touch /tmp/pwned"]), "notAllowed", "--exec"),
            (v(&["--netrc-cmd", "x"]), "notAllowed", "--netrc-cmd"),
            (
                v(&["--config-locations", "/tmp/x"]),
                "notAllowed",
                "--config-locations",
            ),
            (
                v(&["--plugin-dirs", "/tmp/x"]),
                "notAllowed",
                "--plugin-dirs",
            ),
            (v(&["--batch-file", "/tmp/x"]), "notAllowed", "--batch-file"),
            (v(&["-a", "/tmp/x"]), "notAllowed", "-a"),
            (
                v(&["--load-info-json", "/tmp/x"]),
                "notAllowed",
                "--load-info-json",
            ),
            (v(&["--cookies", "/tmp/x"]), "notAllowed", "--cookies"),
            (v(&["-o", "/tmp/x"]), "notAllowed", "-o"),
            (v(&["--output=/tmp/x"]), "notAllowed", "--output"),
            (v(&["-P", "/tmp"]), "notAllowed", "-P"),
            (v(&["--paths", "/tmp"]), "notAllowed", "--paths"),
            (v(&["--downloader", "aria2c"]), "notAllowed", "--downloader"),
            (
                v(&["--postprocessor-args", "-y /tmp/x"]),
                "notAllowed",
                "--postprocessor-args",
            ),
            (v(&["--ppa", "x"]), "notAllowed", "--ppa"),
            (
                v(&["--use-postprocessor", "x"]),
                "notAllowed",
                "--use-postprocessor",
            ),
            (
                v(&["--ffmpeg-location", "/tmp/x"]),
                "notAllowed",
                "--ffmpeg-location",
            ),
            (
                v(&["--print-to-file", "x", "/tmp/x"]),
                "notAllowed",
                "--print-to-file",
            ),
            (
                v(&["--download-archive", "/tmp/x"]),
                "notAllowed",
                "--download-archive",
            ),
            (v(&["--proxy", "http://x"]), "notAllowed", "--proxy"),
            (v(&["-U"]), "notAllowed", "-U"),
            (v(&["--update"]), "notAllowed", "--update"),
            (v(&["--alias", "x", "--exec y"]), "notAllowed", "--alias"),
            (
                v(&["--enable-file-urls"]),
                "notAllowed",
                "--enable-file-urls",
            ),
            (v(&["--"]), "notAllowed", "--"),
            (
                v(&["https://example.org/"]),
                "notAllowed",
                "httpsexampleorg",
            ),
            // an abbreviation yt-dlp's parser would complete is not on the list
            (v(&["--exe", "x"]), "notAllowed", "--exe"),
            (v(&["--FORMAT", "b"]), "notAllowed", "--FORMAT"),
            // values
            (v(&["-f"]), "missingValue", "--format"),
            (v(&["-f", "--exec"]), "badValue", "--format"),
            (v(&["--format=-x"]), "badValue", "--format"),
            (v(&["-f", "b\nx"]), "badValue", "--format"),
            (v(&["-f", "bä"]), "badValue", "--format"),
            (v(&["-S", "res:720;x"]), "badValue", "--format-sort"),
            (
                v(&["--audio-format", "mp3 --exec x"]),
                "badValue",
                "--audio-format",
            ),
            (
                v(&["--merge-output-format", "../x"]),
                "badValue",
                "--merge-output-format",
            ),
            (v(&["-N", "0"]), "badValue", "--concurrent-fragments"),
            (v(&["-N", "999"]), "badValue", "--concurrent-fragments"),
            (v(&["--sub-langs", ""]), "badValue", "--sub-langs"),
            (v(&["-I", "1;2"]), "badValue", "--playlist-items"),
            (
                v(&["--embed-thumbnail=1"]),
                "unexpectedValue",
                "--embed-thumbnail",
            ),
            // a short option glued to its value is not known
            (v(&["-fb"]), "notAllowed", "-fb"),
            (v(&["-f=b"]), "notAllowed", "-fb"),
        ] {
            assert_eq!(
                check_args(&args),
                Err((reason, option.to_string())),
                "{args:?}"
            );
        }
        let many = vec!["-x".to_string(); MAX_ARGS + 1];
        assert_eq!(check_args(&many), Err(("tooManyArgs", String::new())));
    }

    #[test]
    fn a_file_keeps_the_good_presets_and_names_the_bad() {
        let text = r#"{ "version": 1, "example": {"anything": true}, "presets": [
            { "id": "720p-mkv", "label": "  Video 720p (mkv)\u0007 ", "args": ["-S", "res:720", "--merge-output-format", "mkv"] },
            { "id": "evil", "label": "Evil", "args": ["-f", "b", "--exec", "touch /tmp/pwned"] },
            { "id": "720p-mkv", "label": "Again", "args": [] },
            { "id": "bad id!", "label": "X", "args": [] },
            { "id": "nolabel", "label": "  ", "args": [] }
        ] }"#;
        let f = parse(text).unwrap();
        assert_eq!(
            f.presets,
            [Preset {
                id: "720p-mkv".into(),
                label: "Video 720p (mkv)".into(),
                args: v(&["--format-sort=res:720", "--merge-output-format=mkv"]),
            }]
        );
        let got: Vec<(&str, &str, Option<&str>)> = f
            .problems
            .iter()
            .map(|p| (p.id.as_str(), p.reason.as_str(), p.option.as_deref()))
            .collect();
        assert_eq!(
            got,
            [
                ("evil", "notAllowed", Some("--exec")),
                ("720p-mkv", "duplicate", None),
                ("badid", "id", None),
                ("nolabel", "label", None),
            ]
        );
        assert!(parse(r#"{"version":2,"presets":[]}"#).is_err());
        assert!(parse("[]").is_err());
    }

    #[test]
    fn the_default_file_is_read_as_no_presets() {
        let d = tempdir().unwrap();
        let file = d.path().join(FILE_NAME);
        assert_eq!(load(&file).value, PresetFile::default());
        ensure_file(&file);
        let loaded = load(&file);
        assert!(loaded.warning.is_none());
        assert_eq!(loaded.value, PresetFile::default());
        // the example in it is a valid preset – whoever copies it gets one
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let example: Preset = serde_json::from_value(v["example"].clone()).unwrap();
        assert_eq!(sanitize(vec![example]).presets.len(), 1);
        // an existing file is left alone
        std::fs::write(&file, "x").unwrap();
        ensure_file(&file);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "x");
        // broken → no presets, kept as .bad
        let loaded = load(&file);
        assert_eq!(loaded.value, PresetFile::default());
        assert_eq!(loaded.warning.unwrap().code, "broken");
    }

    #[test]
    fn saving_writes_only_what_passes() {
        let d = tempdir().unwrap();
        let file = d.path().join(FILE_NAME);
        let written = save(
            &file,
            vec![
                Preset {
                    id: "a".into(),
                    label: "A".into(),
                    args: v(&["-x"]),
                },
                Preset {
                    id: "b".into(),
                    label: "B".into(),
                    args: v(&["--exec", "x"]),
                },
            ],
        )
        .unwrap();
        assert_eq!(written.len(), 1);
        assert_eq!(load(&file).value.presets, written);
        assert!(!std::fs::read_to_string(&file).unwrap().contains("exec"));
    }
}
