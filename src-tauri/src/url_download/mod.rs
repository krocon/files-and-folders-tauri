//! Download from URLs with yt-dlp (design 078). Pure code without Tauri: checking the
//! URLs, the file name template and the options, building the argument array, reading
//! the progress lines, finding the programs. yt-dlp is a program of the user – it is
//! searched, never shipped, never updated by the app.
//!
//! Security model (design 078 §4):
//! - the frontend sends a typed [`DownloadOptions`], never a program or an argument;
//! - every option with a value is one element `--opt=value`, the URL is parsed, has the
//!   scheme http/https and comes last after `--`;
//! - the target folder is the working folder of the process, the template has no
//!   separator and nothing yt-dlp would expand;
//! - whatever yt-dlp prints is hostile: only lines that start with a random marker are
//!   read, numbers as numbers, texts cleaned and cut, paths only inside the target.
//!
//! Keep in sync with `src/app/core/urldownload/url-download.models.ts`.

pub mod args;
pub mod presets;
pub mod progress;
pub mod template;
pub mod tools;
pub mod urls;

use crate::error::{FsError, FsErrorCode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// URLs of one job at most.
pub const MAX_URLS: usize = 200;
/// Bytes of one URL at most (as typed and as normalised).
pub const MAX_URL_BYTES: usize = 2048;
/// Heights the dialog offers for "at most".
pub const HEIGHTS: [u32; 6] = [2160, 1440, 1080, 720, 480, 360];
pub const MAX_SUB_LANGS: usize = 100;
pub const DEFAULT_TEMPLATE: &str = "%(title)s [%(id)s].%(ext)s";
pub const DEFAULT_SUB_LANGS: &str = "en";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Content {
    #[default]
    Video,
    Audio,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Container {
    #[default]
    Auto,
    Mp4,
    Mkv,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioFormat {
    /// Keep what the site delivers (m4a, opus …).
    #[default]
    Best,
    Mp3,
    M4a,
    Opus,
}

/// Browsers yt-dlp can read cookies from (`--cookies-from-browser`, without profile/keyring).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Browser {
    Brave,
    Chrome,
    Chromium,
    Edge,
    Firefox,
    Opera,
    Safari,
    Vivaldi,
}

impl Browser {
    pub fn arg(self) -> &'static str {
        match self {
            Browser::Brave => "brave",
            Browser::Chrome => "chrome",
            Browser::Chromium => "chromium",
            Browser::Edge => "edge",
            Browser::Firefox => "firefox",
            Browser::Opera => "opera",
            Browser::Safari => "safari",
            Browser::Vivaldi => "vivaldi",
        }
    }
}

/// What the dialog sends. Everything is an enum, a checked number or one of two checked
/// texts (`template`, `sub_langs`) – there is no field for free yt-dlp options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct DownloadOptions {
    /// Id of a preset from `url-download.json`; replaces content/height/container/audio.
    pub preset: Option<String>,
    pub content: Content,
    pub max_height: Option<u32>,
    pub container: Container,
    pub audio_format: AudioFormat,
    pub template: String,
    /// The whole playlist a URL belongs to (else only the video of the URL).
    pub playlist: bool,
    /// With `playlist`: a folder per playlist (its name is built by Rust).
    pub playlist_subfolder: bool,
    pub subtitles: bool,
    pub sub_langs: String,
    pub embed_thumbnail: bool,
    pub embed_metadata: bool,
    pub overwrite: bool,
    pub cookies_browser: Option<Browser>,
}

impl Default for DownloadOptions {
    fn default() -> Self {
        Self {
            preset: None,
            content: Content::Video,
            max_height: None,
            container: Container::Auto,
            audio_format: AudioFormat::Best,
            template: DEFAULT_TEMPLATE.into(),
            playlist: false,
            playlist_subfolder: false,
            subtitles: false,
            sub_langs: DEFAULT_SUB_LANGS.into(),
            embed_thumbnail: false,
            embed_metadata: false,
            overwrite: false,
            cookies_browser: None,
        }
    }
}

fn invalid_options(message: &str) -> FsError {
    FsError::new(FsErrorCode::DownloadInvalidOptions, message, None)
}

/// `en`, `de,en`, `en.*,-live_chat` – what `--sub-langs` takes, nothing else.
pub fn sub_langs_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_SUB_LANGS
        && !s.starts_with(',')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '*' | '_' | ',' | '-'))
}

impl DownloadOptions {
    /// Checks everything that does not need the programs or the preset file.
    pub fn validate(&self) -> Result<(), FsError> {
        if let Some(h) = self.max_height
            && !HEIGHTS.contains(&h)
        {
            return Err(invalid_options("Unknown maximum height"));
        }
        if let Some(id) = &self.preset
            && !presets::valid_id(id)
        {
            return Err(invalid_options("Unknown preset"));
        }
        if self.subtitles && !sub_langs_ok(&self.sub_langs) {
            return Err(invalid_options("Invalid subtitle languages"));
        }
        template::validate(&self.template).map_err(|r| {
            FsError::new(
                FsErrorCode::DownloadInvalidTemplate,
                format!("Invalid file name template ({})", r.code()),
                None,
            )
        })
    }

    /// The options need ffmpeg/ffprobe (a custom preset is not judged: yt-dlp says so).
    pub fn needs_ffmpeg(&self) -> bool {
        self.embed_thumbnail
            || self.embed_metadata
            || (self.preset.is_none()
                && (self.content == Content::Audio || self.container != Container::Auto))
    }
}

/// Where the programs are and how they are started – resolved by Rust when a job starts
/// (settings, login `PATH`, `url-download.json`), never sent by the frontend.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DownloadEnv {
    pub yt_dlp: Option<PathBuf>,
    pub ffmpeg: Option<PathBuf>,
    /// (`deno` | `node`, path)
    pub js_runtime: Option<(String, PathBuf)>,
    pub env: Vec<(String, String)>,
    pub presets: Vec<presets::Preset>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_wire_format_and_defaults() {
        let o: DownloadOptions = serde_json::from_str("{}").unwrap();
        assert_eq!(o, DownloadOptions::default());
        assert!(!o.overwrite, "never preselected");
        let o: DownloadOptions = serde_json::from_str(
            r#"{"content":"audio","audioFormat":"mp3","maxHeight":1080,"container":"mp4",
                "template":"%(title)s.%(ext)s","playlist":true,"playlistSubfolder":true,
                "subtitles":true,"subLangs":"de,en","embedThumbnail":true,"embedMetadata":true,
                "overwrite":true,"cookiesBrowser":"firefox","preset":null}"#,
        )
        .unwrap();
        assert_eq!(o.content, Content::Audio);
        assert_eq!(o.audio_format, AudioFormat::Mp3);
        assert_eq!(o.cookies_browser, Some(Browser::Firefox));
        assert!(o.validate().is_ok());
        // there is no field for free options
        for bad in [
            r#"{"args":["--exec","x"]}"#,
            r#"{"extra":"--exec x"}"#,
            r#"{"cookiesBrowser":"chrome:Profile 1"}"#,
            r#"{"content":"--exec"}"#,
            r#"{"container":"webm; rm"}"#,
        ] {
            assert!(
                serde_json::from_str::<DownloadOptions>(bad).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn options_are_checked() {
        let ok = DownloadOptions::default();
        assert!(ok.validate().is_ok());
        let e = DownloadOptions {
            max_height: Some(1081),
            ..ok.clone()
        }
        .validate()
        .unwrap_err();
        assert_eq!(e.code, FsErrorCode::DownloadInvalidOptions);
        let e = DownloadOptions {
            template: "../x.%(ext)s".into(),
            ..ok.clone()
        }
        .validate()
        .unwrap_err();
        assert_eq!(e.code, FsErrorCode::DownloadInvalidTemplate);
        let e = DownloadOptions {
            subtitles: true,
            sub_langs: "en --exec x".into(),
            ..ok.clone()
        }
        .validate()
        .unwrap_err();
        assert_eq!(e.code, FsErrorCode::DownloadInvalidOptions);
        // not used → not checked (the dialog keeps what was typed)
        assert!(
            DownloadOptions {
                subtitles: false,
                sub_langs: String::new(),
                ..ok.clone()
            }
            .validate()
            .is_ok()
        );
        let e = DownloadOptions {
            preset: Some("../x".into()),
            ..ok.clone()
        }
        .validate()
        .unwrap_err();
        assert_eq!(e.code, FsErrorCode::DownloadInvalidOptions);
        for (s, good) in [
            ("en", true),
            ("de,en", true),
            ("en.*,-live_chat", true),
            ("", false),
            (",en", false),
            ("en de", false),
            ("en;x", false),
        ] {
            assert_eq!(sub_langs_ok(s), good, "{s:?}");
        }
    }

    #[test]
    fn what_needs_ffmpeg() {
        let o = DownloadOptions::default();
        assert!(!o.needs_ffmpeg());
        assert!(
            DownloadOptions {
                content: Content::Audio,
                ..o.clone()
            }
            .needs_ffmpeg()
        );
        assert!(
            DownloadOptions {
                container: Container::Mkv,
                ..o.clone()
            }
            .needs_ffmpeg()
        );
        assert!(
            DownloadOptions {
                embed_metadata: true,
                ..o.clone()
            }
            .needs_ffmpeg()
        );
        // a custom preset replaces the content group
        assert!(
            !DownloadOptions {
                preset: Some("x".into()),
                content: Content::Audio,
                ..o.clone()
            }
            .needs_ffmpeg()
        );
    }
}
