//! The file name template for yt-dlp's `--output` (design 078). yt-dlp treats the value
//! as `[TYPES:]TEMPLATE`, expands `~` and `$VAR` in it and joins it to the working
//! folder – so the template must be a single path component with nothing to expand:
//! no separator, no `$`, no leading `~`, no `:` outside a field, every `%` a field
//! `%(…)…x` or `%%`, and the extension field at the end. Sub-folders are added only by
//! Rust ([`playlist_prefix`]).

use super::{AudioFormat, Container, Content, DownloadOptions};
use serde::Serialize;

pub const MAX_TEMPLATE_CHARS: usize = 200;
const EXT: &str = ".%(ext)s";
/// Conversion types of yt-dlp's output template (Python's plus B, j, h, l, q, D, S, U).
const TYPES: &str = "diouxXeEfFgGcrsaBjhlqDSU";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TemplateReason {
    Empty,
    TooLong,
    /// `/` or `\`: the file would land in another folder.
    Separator,
    /// `..`, a leading `~`, `$`, a drive or a type prefix (`:`): yt-dlp would leave the folder.
    Escape,
    /// Control characters or characters no file system takes (`"*<>?|`).
    Character,
    /// A `%` that is no field `%(name)s`.
    Field,
    /// Does not end with `.%(ext)s`.
    Extension,
}

impl TemplateReason {
    pub fn code(self) -> &'static str {
        match self {
            TemplateReason::Empty => "empty",
            TemplateReason::TooLong => "tooLong",
            TemplateReason::Separator => "separator",
            TemplateReason::Escape => "escape",
            TemplateReason::Character => "character",
            TemplateReason::Field => "field",
            TemplateReason::Extension => "extension",
        }
    }
}

/// A piece of a template.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Part {
    Text(String),
    /// `%(inner)spec` – `conv` is the conversion type, `spec` what stands before it.
    Field {
        inner: String,
        spec: String,
        conv: char,
    },
}

fn parse(template: &str) -> Result<Vec<Part>, TemplateReason> {
    let chars: Vec<char> = template.chars().collect();
    let mut parts: Vec<Part> = Vec::new();
    let mut text = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c != '%' {
            match c {
                '/' | '\\' => return Err(TemplateReason::Separator),
                '$' | ':' => return Err(TemplateReason::Escape),
                '"' | '*' | '<' | '>' | '?' | '|' => return Err(TemplateReason::Character),
                c if c.is_control() => return Err(TemplateReason::Character),
                _ => text.push(c),
            }
            i += 1;
            continue;
        }
        match chars.get(i + 1) {
            Some('%') => {
                text.push('%');
                i += 2;
                continue;
            }
            Some('(') => {}
            _ => return Err(TemplateReason::Field),
        }
        // the field name with everything yt-dlp allows in it (`>%Y-%m-%d`, `|default`, `.:50`)
        let mut depth = 1;
        let mut j = i + 2;
        let mut inner = String::new();
        while j < chars.len() && depth > 0 {
            match chars[j] {
                '(' => depth += 1,
                ')' => depth -= 1,
                '/' | '\\' => return Err(TemplateReason::Separator),
                '$' => return Err(TemplateReason::Escape),
                c if c.is_control() => return Err(TemplateReason::Character),
                _ => {}
            }
            if depth > 0 {
                inner.push(chars[j]);
            }
            j += 1;
        }
        if depth != 0 || inner.is_empty() {
            return Err(TemplateReason::Field);
        }
        // flags, width, precision, type
        let mut spec = String::new();
        while j < chars.len() && matches!(chars[j], '-' | '#' | '0' | '+' | ' ') {
            spec.push(chars[j]);
            j += 1;
        }
        while j < chars.len() && chars[j].is_ascii_digit() {
            spec.push(chars[j]);
            j += 1;
        }
        if j < chars.len() && chars[j] == '.' && chars.get(j + 1).is_some_and(char::is_ascii_digit)
        {
            spec.push('.');
            j += 1;
            while j < chars.len() && chars[j].is_ascii_digit() {
                spec.push(chars[j]);
                j += 1;
            }
        }
        let Some(&conv) = chars.get(j).filter(|c| TYPES.contains(**c)) else {
            return Err(TemplateReason::Field);
        };
        if !text.is_empty() {
            parts.push(Part::Text(std::mem::take(&mut text)));
        }
        parts.push(Part::Field { inner, spec, conv });
        i = j + 1;
    }
    if !text.is_empty() {
        parts.push(Part::Text(text));
    }
    Ok(parts)
}

/// Checks a template typed by the user (or taken from the list of the dialog).
pub fn validate(template: &str) -> Result<(), TemplateReason> {
    if template.trim().is_empty() {
        return Err(TemplateReason::Empty);
    }
    if template.chars().count() > MAX_TEMPLATE_CHARS {
        return Err(TemplateReason::TooLong);
    }
    // a blank at the edge is no part of a name anyone wants; `-x` would look like an option
    // in a file list, `~` is expanded by yt-dlp
    if template != template.trim() {
        return Err(TemplateReason::Character);
    }
    if template.starts_with('~') || template.starts_with('-') {
        return Err(TemplateReason::Escape);
    }
    let parts = parse(template)?;
    if !template.ends_with(EXT) || template == EXT {
        return Err(TemplateReason::Extension);
    }
    // literal dots only: `..%(ext)s` must not become a name of dots
    let literal: String = parts
        .iter()
        .filter_map(|p| match p {
            Part::Text(t) => Some(t.as_str()),
            Part::Field { .. } => None,
        })
        .collect();
    let fields = parts
        .iter()
        .filter(|p| matches!(p, Part::Field { .. }))
        .count();
    if fields == 1 && literal.chars().all(|c| c == '.') {
        // only the extension and dots
        return Err(TemplateReason::Extension);
    }
    Ok(())
}

/// The folder per playlist (design 078 E-b/§1): built here, never from user text. Title
/// and id are cut, and the brackets make sure the component is never only dots – yt-dlp
/// keeps a field value `..` as it is.
pub fn playlist_prefix() -> &'static str {
    "%(playlist_title|Playlist).80s [%(playlist_id|-).40s]/"
}

/// What `--output` gets.
pub fn output_arg(options: &DownloadOptions) -> String {
    if options.playlist && options.playlist_subfolder {
        format!("{}{}", playlist_prefix(), options.template)
    } else {
        options.template.clone()
    }
}

fn sample_ext(options: &DownloadOptions) -> &'static str {
    if options.preset.is_some() {
        return "mp4";
    }
    match (options.content, options.audio_format, options.container) {
        (Content::Audio, AudioFormat::Mp3, _) => "mp3",
        (Content::Audio, AudioFormat::Opus, _) => "opus",
        (Content::Audio, _, _) => "m4a",
        (Content::Video, _, Container::Mkv) => "mkv",
        (Content::Video, _, _) => "mp4",
    }
}

fn sample_value(name: &str, options: &DownloadOptions) -> Option<String> {
    Some(
        match name {
            "title" | "fulltitle" | "track" => "My video",
            "id" | "display_id" => "abc123",
            "ext" => sample_ext(options),
            "uploader" | "channel" | "creator" | "artist" => "Uploader",
            "uploader_id" | "channel_id" => "uploader",
            "upload_date" | "release_date" => "20260131",
            "playlist" | "playlist_title" | "album" => "Playlist",
            "playlist_id" => "PL123",
            "playlist_index" | "playlist_autonumber" | "autonumber" | "track_number" => "1",
            "playlist_count" | "n_entries" => "12",
            "extractor" | "extractor_key" => "example",
            "resolution" => "1920x1080",
            "height" => "1080",
            "width" => "1920",
            "duration" => "754",
            "duration_string" => "12:34",
            "format_id" => "137+140",
            "vcodec" => "avc1",
            "acodec" => "mp4a",
            _ => return None,
        }
        .to_string(),
    )
}

/// `20260131` as `strftime` would print it (the fields a file name uses).
fn sample_date(format: &str) -> String {
    format
        .replace("%Y", "2026")
        .replace("%y", "26")
        .replace("%m", "01")
        .replace("%d", "31")
        .replace("%H", "12")
        .replace("%M", "00")
        .replace("%S", "00")
        .replace("%B", "January")
        .replace("%b", "Jan")
}

fn render(inner: &str, spec: &str, conv: char, options: &DownloadOptions) -> String {
    // `name>format`, `name|default`, alternatives `a,b`, traversal `a.b` – enough for a sample
    let (head, default) = match inner.split_once('|') {
        Some((h, d)) => (h, Some(d)),
        None => (inner, None),
    };
    let (names, date_format) = match head.split_once('>') {
        Some((n, f)) => (n, Some(f)),
        None => (head, None),
    };
    let found = names
        .split(',')
        .map(|n| {
            n.split(['.', '&', '+', '-', '*'])
                .next()
                .unwrap_or("")
                .trim()
        })
        .find_map(|n| sample_value(n, options));
    let mut value = match (found, date_format) {
        (Some(_), Some(f)) => sample_date(f),
        (Some(v), None) => v,
        (None, _) => default.unwrap_or("NA").to_string(),
    };
    let (flags_width, precision) = match spec.split_once('.') {
        Some((a, p)) => (a, p.parse::<usize>().ok()),
        None => (spec, None),
    };
    let zero = flags_width.contains('0')
        && flags_width
            .trim_start_matches(['-', '#', '+', ' '])
            .starts_with('0');
    let left = flags_width.contains('-');
    let width: usize = flags_width
        .trim_start_matches(['-', '#', '0', '+', ' '])
        .parse()
        .unwrap_or(0);
    if let Some(p) = precision
        && !matches!(conv, 'd' | 'i' | 'f' | 'F' | 'e' | 'E' | 'g' | 'G')
    {
        value = if conv == 'B' {
            // bytes, cut at a character boundary
            let mut end = p.min(value.len());
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            value[..end].to_string()
        } else {
            value.chars().take(p).collect()
        };
    }
    let len = value.chars().count();
    if len < width {
        let pad = width - len;
        if left {
            value.push_str(&" ".repeat(pad));
        } else if zero && value.chars().all(|c| c.is_ascii_digit()) {
            value = "0".repeat(pad) + &value;
        } else {
            value = " ".repeat(pad) + &value;
        }
    }
    value
}

/// A sample file name for the dialog – no network, made-up values. Empty for an
/// invalid template.
pub fn example(template: &str, options: &DownloadOptions) -> String {
    if validate(template).is_err() {
        return String::new();
    }
    let Ok(parts) = parse(template) else {
        return String::new();
    };
    parts
        .iter()
        .map(|p| match p {
            Part::Text(t) => t.clone(),
            Part::Field { inner, spec, conv } => render(inner, spec, *conv, options),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_offered_templates_are_valid() {
        for t in [
            "%(title)s [%(id)s].%(ext)s",
            "%(title)s.%(ext)s",
            "%(uploader)s - %(title)s.%(ext)s",
            "%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s",
            "%(playlist_index)02d - %(title)s.%(ext)s",
            "%(title).100B [%(id)s].%(ext)s",
            "%(title.:50)s.%(ext)s",
            "%(uploader|Unknown)s – %(title)s (%(height)sp).%(ext)s",
            "100%% %(title)s.%(ext)s",
            "Ünïcödé 🎬 %(title)s.%(ext)s",
        ] {
            assert_eq!(validate(t), Ok(()), "{t}");
        }
    }

    #[test]
    fn what_could_leave_the_folder_is_refused() {
        use TemplateReason::*;
        for (t, want) in [
            // the acceptance cases
            ("../x", Separator),
            ("/etc/x", Separator),
            ("C:\\x", Escape),
            ("../x.%(ext)s", Separator),
            ("/etc/x.%(ext)s", Separator),
            ("C:\\x.%(ext)s", Escape),
            ("C:x.%(ext)s", Escape),
            ("\\\\server\\share\\x.%(ext)s", Separator),
            ("a/b.%(ext)s", Separator),
            ("a\\b.%(ext)s", Separator),
            ("%(title)s/%(id)s.%(ext)s", Separator),
            ("%(playlist/x)s.%(ext)s", Separator),
            // yt-dlp expands these
            ("$HOME.%(ext)s", Escape),
            ("${HOME}x.%(ext)s", Escape),
            ("%(title$HOME)s.%(ext)s", Escape),
            ("~.%(ext)s", Escape),
            ("~user.%(ext)s", Escape),
            // `[TYPES:]TEMPLATE`
            ("thumbnail:x.%(ext)s", Escape),
            ("infojson:%(title)s.%(ext)s", Escape),
            ("pl_video:x.%(ext)s", Escape),
            // looks like an option in a listing
            ("-x.%(ext)s", Escape),
            ("--exec.%(ext)s", Escape),
            // dots only
            ("..%(ext)s", Extension),
            (".%(ext)s", Extension),
            ("....%(ext)s", Extension),
            ("%(title)s", Extension),
            ("%(title)s.mp4", Extension),
            ("%(title)s.%(ext)s.exe", Extension),
            ("%(title)s.%(ext)s ", Character),
            (" %(title)s.%(ext)s", Character),
            ("", Empty),
            ("   ", Empty),
            ("a\nb.%(ext)s", Character),
            ("a\u{0}b.%(ext)s", Character),
            ("a\u{1b}[0m.%(ext)s", Character),
            ("a|b.%(ext)s", Character),
            ("a?b.%(ext)s", Character),
            ("a*b.%(ext)s", Character),
            ("a<b>.%(ext)s", Character),
            ("a\"b.%(ext)s", Character),
            ("%s.%(ext)s", Field),
            ("%USERPROFILE%.%(ext)s", Field),
            ("50% %(title)s.%(ext)s", Field),
            ("%(title.%(ext)s", Field),
            ("%().%(ext)s", Field),
            ("%(title)z.%(ext)s", Field),
            ("%(title)", Field),
            ("x%", Field),
        ] {
            assert_eq!(validate(t), Err(want), "{t:?}");
        }
        let long = format!("{}.%(ext)s", "a".repeat(MAX_TEMPLATE_CHARS));
        assert_eq!(validate(&long), Err(TooLong));
    }

    #[test]
    fn the_playlist_folder_is_ours_and_never_dots() {
        let p = playlist_prefix();
        assert!(p.ends_with('/'));
        // a literal `[` … `]` stands in the component whatever the fields give
        assert!(p.contains(" [") && p.contains("]/"));
        assert_eq!(p.matches('/').count(), 1);
        let mut o = DownloadOptions::default();
        assert_eq!(output_arg(&o), o.template);
        o.playlist_subfolder = true; // without `playlist`: no folder
        assert_eq!(output_arg(&o), o.template);
        o.playlist = true;
        assert_eq!(output_arg(&o), format!("{p}{}", o.template));
    }

    #[test]
    fn examples_without_network() {
        let o = DownloadOptions::default();
        assert_eq!(
            example("%(title)s [%(id)s].%(ext)s", &o),
            "My video [abc123].mp4"
        );
        assert_eq!(
            example("%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s", &o),
            "2026-01-31 My video.mp4"
        );
        assert_eq!(
            example("%(playlist_index)02d - %(title)s.%(ext)s", &o),
            "01 - My video.mp4"
        );
        assert_eq!(
            example("%(uploader)s - %(title).2s.%(ext)s", &o),
            "Uploader - My.mp4"
        );
        assert_eq!(example("%(title).4B.%(ext)s", &o), "My v.mp4");
        assert_eq!(example("%(nope|x)s 100%%.%(ext)s", &o), "x 100%.mp4");
        assert_eq!(example("%(nope)s.%(ext)s", &o), "NA.mp4");
        assert_eq!(example("../x", &o), "");
        let audio = DownloadOptions {
            content: Content::Audio,
            audio_format: AudioFormat::Mp3,
            ..o.clone()
        };
        assert_eq!(example("%(title)s.%(ext)s", &audio), "My video.mp3");
        let mkv = DownloadOptions {
            container: Container::Mkv,
            ..o
        };
        assert_eq!(example("%(title)s.%(ext)s", &mkv), "My video.mkv");
    }
}
