//! The argument array for yt-dlp (design 078 §3). Built only here, only from the typed
//! [`DownloadOptions`], the programs Rust found and – for an own preset – the checked
//! arguments of `url-download.json`. Rules that hold for every result (tested):
//!
//! - every element but the last two is `--option` or `--option=value` (a value can never
//!   be read as an option);
//! - the second to last element is `--`, the last one is exactly one URL that starts
//!   with `http://` or `https://`;
//! - no `-P`/`--paths` (yt-dlp expands and trims that path): the target folder is the
//!   working folder of the process;
//! - never `-U`, `--exec`, a config file or a batch file.

use super::presets::Preset;
use super::{AudioFormat, Container, Content, DownloadEnv, DownloadOptions, template, urls};
use crate::error::{FsError, FsErrorCode};

/// File names are cut to this many characters before the extension.
pub const TRIM_FILENAMES: u32 = 160;

/// What the arguments are for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode<'a> {
    /// A job: with the protocol lines, marked with this process's marker.
    Job { marker: &'a str },
    /// "Copy command": what a person would type – no protocol, no program locations.
    Show,
}

fn missing(what: &str) -> FsError {
    FsError::new(
        FsErrorCode::DownloadToolMissing,
        format!("{what} was not found"),
        None,
    )
}

/// The format part from the fields of the dialog (README "Format selection examples").
fn format_args(o: &DownloadOptions) -> Vec<String> {
    let mut a: Vec<String> = Vec::new();
    match o.content {
        Content::Video => {
            if let Some(h) = o.max_height {
                a.push(format!("--format-sort=res:{h}"));
            }
            match o.container {
                Container::Auto => {}
                Container::Mp4 => {
                    a.push("--format=bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b".into());
                    a.push("--merge-output-format=mp4".into());
                }
                Container::Mkv => a.push("--merge-output-format=mkv".into()),
            }
        }
        Content::Audio => {
            a.push(
                match o.audio_format {
                    AudioFormat::Best | AudioFormat::Mp3 => "--format=ba/b",
                    AudioFormat::M4a => "--format=ba[ext=m4a]/ba/b",
                    AudioFormat::Opus => "--format=ba[ext=webm]/ba/b",
                }
                .into(),
            );
            a.push("--extract-audio".into());
            match o.audio_format {
                AudioFormat::Best => {}
                AudioFormat::Mp3 => {
                    a.push("--audio-format=mp3".into());
                    a.push("--audio-quality=0".into());
                }
                AudioFormat::M4a => a.push("--audio-format=m4a".into()),
                AudioFormat::Opus => a.push("--audio-format=opus".into()),
            }
        }
    }
    a
}

fn preset<'a>(env: &'a DownloadEnv, id: &str) -> Result<&'a Preset, FsError> {
    env.presets.iter().find(|p| p.id == id).ok_or_else(|| {
        FsError::new(
            FsErrorCode::DownloadInvalidOptions,
            "The preset does not exist (any more)",
            None,
        )
    })
}

/// The arguments for one URL. `url` must be what [`urls::check_one`] returned.
pub fn build(
    options: &DownloadOptions,
    env: &DownloadEnv,
    mode: Mode<'_>,
    url: &str,
) -> Result<Vec<String>, FsError> {
    options.validate()?;
    let url = match urls::check_one(url) {
        Ok(u) if u == url => u,
        _ => {
            return Err(FsError::new(
                FsErrorCode::DownloadInvalidUrl,
                "Not a plain http(s) address",
                None,
            ));
        }
    };
    let mut a: Vec<String> = vec![
        "--ignore-config".into(),
        "--no-exec".into(),
        "--no-simulate".into(),
    ];
    if let Mode::Job { marker } = mode {
        if marker.is_empty()
            || !marker
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(FsError::new(FsErrorCode::Io, "Invalid marker", None));
        }
        if options.needs_ffmpeg() && env.ffmpeg.is_none() {
            return Err(missing("ffmpeg"));
        }
        a.extend([
            "--color=never".to_string(),
            "--encoding=utf-8".to_string(),
            "--newline".to_string(),
            "--progress".to_string(),
            "--progress-delta=0.25".to_string(),
            format!(
                "--progress-template=download:{marker}|dl|%(progress.status)s|\
                 %(progress.downloaded_bytes)s|%(progress.total_bytes)s|\
                 %(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"
            ),
            format!(
                "--progress-template=postprocess:{marker}|pp|%(progress.status)s|\
                 %(progress.postprocessor)s"
            ),
            format!("--print=before_dl:{marker}|item|%(title)j"),
            format!("--print=after_move:{marker}|file|%(__real_download|NA)s|%(filepath)j"),
        ]);
        if let Some(p) = &env.ffmpeg {
            a.push(format!("--ffmpeg-location={}", p.to_string_lossy()));
        }
        if let Some((name, p)) = &env.js_runtime
            && matches!(name.as_str(), "deno" | "node")
        {
            a.push(format!("--js-runtimes={name}:{}", p.to_string_lossy()));
        }
    }
    a.push(format!("--trim-filenames={TRIM_FILENAMES}"));
    match &options.preset {
        Some(id) => {
            // checked when the file was loaded – and once more: nothing unchecked goes on
            let p = preset(env, id)?;
            let checked = super::presets::check_args(&p.args).map_err(|_| {
                FsError::new(
                    FsErrorCode::DownloadInvalidOptions,
                    "The preset has arguments that are not allowed",
                    None,
                )
            })?;
            a.extend(checked);
        }
        None => a.extend(format_args(options)),
    }
    a.push(
        if options.playlist {
            "--yes-playlist"
        } else {
            "--no-playlist"
        }
        .into(),
    );
    if options.subtitles {
        a.push("--write-subs".into());
        a.push(format!("--sub-langs={}", options.sub_langs));
    }
    if options.embed_thumbnail {
        a.push("--embed-thumbnail".into());
    }
    if options.embed_metadata {
        a.push("--embed-metadata".into());
    }
    if options.overwrite {
        a.push("--force-overwrites".into());
    }
    if let Some(b) = options.cookies_browser {
        a.push(format!("--cookies-from-browser={}", b.arg()));
    }
    a.push(format!("--output={}", template::output_arg(options)));
    a.push("--".into());
    a.push(url);
    Ok(a)
}

/// POSIX single quotes / PowerShell single quotes – for showing, never for running.
fn quote(arg: &str, windows: bool) -> String {
    let plain = !arg.is_empty()
        && arg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '=' | '.' | '/' | ':'));
    if plain {
        arg.to_string()
    } else if windows {
        format!("'{}'", arg.replace('\'', "''"))
    } else {
        format!("'{}'", arg.replace('\'', r"'\''"))
    }
}

/// The command a person could type in a terminal for `url` (dialog "Copy command").
pub fn command_line(
    options: &DownloadOptions,
    env: &DownloadEnv,
    url: &str,
    windows: bool,
) -> Result<String, FsError> {
    let args = build(options, env, Mode::Show, url)?;
    let mut out = String::from("yt-dlp");
    for a in &args {
        out.push(' ');
        out.push_str(&quote(a, windows));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::url_download::Browser;
    use std::path::PathBuf;

    const URL: &str = "https://example.org/watch?v=1";
    const M: &str = "MARK123";

    fn env() -> DownloadEnv {
        DownloadEnv {
            yt_dlp: Some(PathBuf::from("/opt/bin/yt-dlp")),
            ffmpeg: Some(PathBuf::from("/opt/bin/ffmpeg")),
            js_runtime: Some(("deno".into(), PathBuf::from("/opt/bin/deno"))),
            env: Vec::new(),
            presets: vec![Preset {
                id: "p720".into(),
                label: "720p".into(),
                args: vec!["--format-sort=res:720".into(), "--embed-chapters".into()],
            }],
        }
    }

    fn job(o: &DownloadOptions) -> Vec<String> {
        build(o, &env(), Mode::Job { marker: M }, URL).unwrap()
    }

    /// Only the part the options decide (between the fixed head and `--`).
    fn tail(o: &DownloadOptions) -> Vec<String> {
        let a = job(o);
        let from = a
            .iter()
            .position(|x| x.starts_with("--trim-filenames="))
            .unwrap()
            + 1;
        a[from..a.len() - 2].to_vec()
    }

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    /// The rules of the module header, for any result.
    fn assert_shape(a: &[String]) {
        let n = a.len();
        assert_eq!(a[n - 2], "--", "{a:?}");
        assert!(a[n - 1].starts_with("https://") || a[n - 1].starts_with("http://"));
        assert_eq!(a.iter().filter(|x| *x == "--").count(), 1);
        for x in &a[..n - 2] {
            assert!(x.starts_with("--") && x.len() > 2, "{x}");
            let name = x.split('=').next().unwrap();
            assert!(
                ![
                    "--exec",
                    "--paths",
                    "--update",
                    "--config-locations",
                    "--batch-file",
                    "--netrc-cmd",
                    "--plugin-dirs",
                    "--load-info-json",
                    "--cookies",
                    "--downloader",
                    "--postprocessor-args",
                    "--use-postprocessor",
                ]
                .contains(&name),
                "{x}"
            );
            assert!(!x.chars().any(|c| c.is_control()), "{x:?}");
        }
        assert!(a.contains(&"--ignore-config".to_string()));
        assert!(a.contains(&"--no-exec".to_string()));
    }

    #[test]
    fn the_fixed_head_of_a_job() {
        let a = job(&DownloadOptions::default());
        assert_shape(&a);
        assert_eq!(
            a,
            v(&[
                "--ignore-config",
                "--no-exec",
                "--no-simulate",
                "--color=never",
                "--encoding=utf-8",
                "--newline",
                "--progress",
                "--progress-delta=0.25",
                "--progress-template=download:MARK123|dl|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
                "--progress-template=postprocess:MARK123|pp|%(progress.status)s|%(progress.postprocessor)s",
                "--print=before_dl:MARK123|item|%(title)j",
                "--print=after_move:MARK123|file|%(__real_download|NA)s|%(filepath)j",
                "--ffmpeg-location=/opt/bin/ffmpeg",
                "--js-runtimes=deno:/opt/bin/deno",
                "--trim-filenames=160",
                "--no-playlist",
                "--output=%(title)s [%(id)s].%(ext)s",
                "--",
                URL,
            ])
        );
    }

    #[test]
    fn options_to_arguments() {
        let d = DownloadOptions::default();
        let out = |t: &str| format!("--output={t}");
        let base = out(&d.template);
        let cases: Vec<(DownloadOptions, Vec<String>)> = vec![
            // the built-in presets
            (d.clone(), vec!["--no-playlist".into(), base.clone()]),
            (
                DownloadOptions {
                    max_height: Some(1080),
                    container: Container::Mp4,
                    ..d.clone()
                },
                vec![
                    "--format-sort=res:1080".into(),
                    "--format=bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b".into(),
                    "--merge-output-format=mp4".into(),
                    "--no-playlist".into(),
                    base.clone(),
                ],
            ),
            (
                DownloadOptions {
                    content: Content::Audio,
                    audio_format: AudioFormat::Mp3,
                    ..d.clone()
                },
                vec![
                    "--format=ba/b".into(),
                    "--extract-audio".into(),
                    "--audio-format=mp3".into(),
                    "--audio-quality=0".into(),
                    "--no-playlist".into(),
                    base.clone(),
                ],
            ),
            (
                DownloadOptions {
                    content: Content::Audio,
                    ..d.clone()
                },
                vec![
                    "--format=ba/b".into(),
                    "--extract-audio".into(),
                    "--no-playlist".into(),
                    base.clone(),
                ],
            ),
            // every other field
            (
                DownloadOptions {
                    content: Content::Audio,
                    audio_format: AudioFormat::M4a,
                    // height and container belong to video
                    max_height: Some(720),
                    container: Container::Mkv,
                    ..d.clone()
                },
                vec![
                    "--format=ba[ext=m4a]/ba/b".into(),
                    "--extract-audio".into(),
                    "--audio-format=m4a".into(),
                    "--no-playlist".into(),
                    base.clone(),
                ],
            ),
            (
                DownloadOptions {
                    content: Content::Audio,
                    audio_format: AudioFormat::Opus,
                    ..d.clone()
                },
                vec![
                    "--format=ba[ext=webm]/ba/b".into(),
                    "--extract-audio".into(),
                    "--audio-format=opus".into(),
                    "--no-playlist".into(),
                    base.clone(),
                ],
            ),
            (
                DownloadOptions {
                    container: Container::Mkv,
                    max_height: Some(360),
                    ..d.clone()
                },
                vec![
                    "--format-sort=res:360".into(),
                    "--merge-output-format=mkv".into(),
                    "--no-playlist".into(),
                    base.clone(),
                ],
            ),
            (
                DownloadOptions {
                    playlist: true,
                    ..d.clone()
                },
                vec!["--yes-playlist".into(), base.clone()],
            ),
            (
                DownloadOptions {
                    playlist: true,
                    playlist_subfolder: true,
                    template: "%(playlist_index)02d - %(title)s.%(ext)s".into(),
                    ..d.clone()
                },
                vec![
                    "--yes-playlist".into(),
                    out(
                        "%(playlist_title|Playlist).80s [%(playlist_id|-).40s]/%(playlist_index)02d - %(title)s.%(ext)s",
                    ),
                ],
            ),
            (
                DownloadOptions {
                    subtitles: true,
                    sub_langs: "de,en".into(),
                    embed_thumbnail: true,
                    embed_metadata: true,
                    overwrite: true,
                    cookies_browser: Some(Browser::Firefox),
                    ..d.clone()
                },
                vec![
                    "--no-playlist".into(),
                    "--write-subs".into(),
                    "--sub-langs=de,en".into(),
                    "--embed-thumbnail".into(),
                    "--embed-metadata".into(),
                    "--force-overwrites".into(),
                    "--cookies-from-browser=firefox".into(),
                    base.clone(),
                ],
            ),
            // an own preset replaces the content group, nothing else
            (
                DownloadOptions {
                    preset: Some("p720".into()),
                    content: Content::Audio,
                    audio_format: AudioFormat::Mp3,
                    embed_metadata: true,
                    ..d.clone()
                },
                vec![
                    "--format-sort=res:720".into(),
                    "--embed-chapters".into(),
                    "--no-playlist".into(),
                    "--embed-metadata".into(),
                    base.clone(),
                ],
            ),
        ];
        for (o, want) in cases {
            assert_eq!(tail(&o), want, "{o:?}");
            assert_shape(&job(&o));
        }
        // sub_langs is not passed unless subtitles are on
        assert!(
            !job(&DownloadOptions {
                sub_langs: "xx".into(),
                ..d.clone()
            })
            .iter()
            .any(|a| a.contains("xx"))
        );
        // overwrite is never there by default
        assert!(!job(&d).contains(&"--force-overwrites".to_string()));
    }

    #[test]
    fn user_text_never_becomes_an_option() {
        let e = env();
        let d = DownloadOptions::default();
        // the URL
        for bad in [
            "--exec=touch /tmp/pwned",
            "-o",
            "-o /tmp/x",
            "--",
            "ftp://example.org/x",
            "https://example.org/a b",
            // valid, but not in the normalised form `check_one` hands out
            "HTTPS://EXAMPLE.org/x",
            "https://example.org",
        ] {
            let r = build(&d, &e, Mode::Job { marker: M }, bad);
            assert_eq!(
                r.unwrap_err().code,
                FsErrorCode::DownloadInvalidUrl,
                "{bad:?}"
            );
        }
        // the template
        for bad in [
            "../x.%(ext)s",
            "/etc/x.%(ext)s",
            "--exec.%(ext)s",
            "$HOME.%(ext)s",
        ] {
            let o = DownloadOptions {
                template: bad.into(),
                ..d.clone()
            };
            assert_eq!(
                build(&o, &e, Mode::Job { marker: M }, URL)
                    .unwrap_err()
                    .code,
                FsErrorCode::DownloadInvalidTemplate
            );
        }
        // a template that looks like an option still is one element `--output=…`
        let o = DownloadOptions {
            template: "x --exec y.%(ext)s".into(),
            ..d.clone()
        };
        let a = job(&o);
        assert_shape(&a);
        assert!(a.contains(&"--output=x --exec y.%(ext)s".to_string()));
        // the subtitle languages
        let o = DownloadOptions {
            subtitles: true,
            sub_langs: "en --exec x".into(),
            ..d.clone()
        };
        assert_eq!(
            build(&o, &e, Mode::Job { marker: M }, URL)
                .unwrap_err()
                .code,
            FsErrorCode::DownloadInvalidOptions
        );
        // a preset that is not in the file, and one that was tampered with after loading
        let o = DownloadOptions {
            preset: Some("gone".into()),
            ..d.clone()
        };
        assert_eq!(
            build(&o, &e, Mode::Job { marker: M }, URL)
                .unwrap_err()
                .code,
            FsErrorCode::DownloadInvalidOptions
        );
        let mut evil = env();
        evil.presets[0].args = vec!["--exec=touch /tmp/pwned".into()];
        let o = DownloadOptions {
            preset: Some("p720".into()),
            ..d.clone()
        };
        assert_eq!(
            build(&o, &evil, Mode::Job { marker: M }, URL)
                .unwrap_err()
                .code,
            FsErrorCode::DownloadInvalidOptions
        );
        // a marker that could break the templates
        assert!(build(&d, &e, Mode::Job { marker: "a|b" }, URL).is_err());
        assert!(build(&d, &e, Mode::Job { marker: "" }, URL).is_err());
    }

    #[test]
    fn programs_that_are_missing() {
        let d = DownloadOptions::default();
        let mut e = env();
        e.ffmpeg = None;
        e.js_runtime = None;
        let a = build(&d, &e, Mode::Job { marker: M }, URL).unwrap();
        assert!(!a.iter().any(|x| x.starts_with("--ffmpeg-location")));
        assert!(!a.iter().any(|x| x.starts_with("--js-runtimes")));
        let audio = DownloadOptions {
            content: Content::Audio,
            ..d.clone()
        };
        assert_eq!(
            build(&audio, &e, Mode::Job { marker: M }, URL)
                .unwrap_err()
                .code,
            FsErrorCode::DownloadToolMissing
        );
        // an unknown runtime name is not passed on
        e.js_runtime = Some(("bun --exec".into(), PathBuf::from("/x")));
        let a = build(&d, &e, Mode::Job { marker: M }, URL).unwrap();
        assert!(!a.iter().any(|x| x.starts_with("--js-runtimes")));
    }

    #[test]
    fn the_command_to_copy() {
        let o = DownloadOptions {
            content: Content::Audio,
            audio_format: AudioFormat::Mp3,
            ..DownloadOptions::default()
        };
        // no ffmpeg known: showing the command does not need it
        let line = command_line(&o, &DownloadEnv::default(), URL, false).unwrap();
        assert_eq!(
            line,
            "yt-dlp --ignore-config --no-exec --no-simulate --trim-filenames=160 --format=ba/b \
             --extract-audio --audio-format=mp3 --audio-quality=0 --no-playlist \
             '--output=%(title)s [%(id)s].%(ext)s' -- 'https://example.org/watch?v=1'"
        );
        assert!(!line.contains("progress") && !line.contains("--print"));
        let o = DownloadOptions {
            template: "it's %(title)s.%(ext)s".into(),
            ..DownloadOptions::default()
        };
        let line = command_line(&o, &DownloadEnv::default(), URL, false).unwrap();
        assert!(line.contains(r"'--output=it'\''s %(title)s.%(ext)s'"));
        let line = command_line(&o, &DownloadEnv::default(), URL, true).unwrap();
        assert!(line.contains("'--output=it''s %(title)s.%(ext)s'"));
        assert!(command_line(&o, &DownloadEnv::default(), "-x", false).is_err());
    }
}
