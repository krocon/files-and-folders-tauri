//! Commands of the download dialog (design 078): which programs are there, the own
//! presets, checking the URL field. Starting is a normal job (`start_job`, kind
//! `download`) – no command here runs yt-dlp against a URL, and none takes a program,
//! a path to one or an argument from the frontend.

use crate::commands::shell::{shell_settings, tool_env};
use crate::commands::{blocking, config_dir};
use crate::config_file::ConfigWarning;
use crate::error::{FsError, FsErrorCode};
use crate::settings;
use crate::shell::ShellKind;
use crate::url_download::presets::{self, PresetProblem};
use crate::url_download::template::{self, TemplateReason};
use crate::url_download::tools::{self, DownloadTools};
use crate::url_download::urls::{self, UrlProblem};
use crate::url_download::{DownloadEnv, DownloadOptions, MAX_URL_BYTES, MAX_URLS, args};
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Runtime};

/// Bytes of the URL field a check accepts (a paste beyond that is refused, not read).
pub const MAX_TEXT_BYTES: usize = MAX_URLS * (MAX_URL_BYTES + 2) * 2;

/// Programs (without running them), start environment and presets – what a job needs.
/// Blocks for the first read of the login shell (design 061).
pub fn download_env(config: &Path) -> DownloadEnv {
    let stored = settings::load(&config.join(settings::FILE_NAME)).settings;
    let env = tool_env(config);
    let located = tools::locate(&tools::tool_settings(&stored), &tools::path_dirs(&env));
    DownloadEnv {
        yt_dlp: located.yt_dlp.path,
        ffmpeg: located.ffmpeg.path,
        js_runtime: located.js_name.zip(located.js_runtime.path),
        env,
        presets: presets::load(&config.join(presets::FILE_NAME))
            .value
            .presets,
        neutral_cwd: cfg!(windows),
    }
}

/// Which of yt-dlp, ffmpeg and a JavaScript runtime are there, with their versions.
/// Runs only `--version` of local programs – no network.
#[tauri::command]
pub async fn download_tools<R: Runtime>(app: AppHandle<R>) -> Result<DownloadTools, FsError> {
    let config = config_dir(&app)?;
    blocking("Looking for yt-dlp", move || {
        let stored = settings::load(&config.join(settings::FILE_NAME)).settings;
        let env = tool_env(&config);
        let located = tools::locate(&tools::tool_settings(&stored), &tools::path_dirs(&env));
        Ok(tools::probe(&located, &env, tools::today_days()))
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDownloadPresets {
    pub presets: Vec<PresetInfo>,
    /// Presets of the file that were refused (an argument not on the allow list …).
    pub problems: Vec<PresetProblem>,
    pub warning: Option<ConfigWarning>,
    /// The file, for the hint where own presets live.
    pub file: String,
}

/// The own presets of `url-download.json` (ids and labels – the arguments stay in Rust).
/// Creates the file with an example when there is none.
#[tauri::command]
pub async fn download_presets<R: Runtime>(
    app: AppHandle<R>,
) -> Result<LoadedDownloadPresets, FsError> {
    let file = config_dir(&app)?.join(presets::FILE_NAME);
    blocking("Loading the download presets", move || {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        presets::ensure_file(&file);
        let loaded = presets::load(&file);
        Ok(LoadedDownloadPresets {
            presets: loaded
                .value
                .presets
                .into_iter()
                .map(|p| PresetInfo {
                    id: p.id,
                    label: p.label,
                })
                .collect(),
            problems: loaded.value.problems,
            warning: loaded.warning,
            file: file.to_string_lossy().into_owned(),
        })
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCheck {
    /// The valid URLs, normalised, without duplicates – what the job is started with.
    pub urls: Vec<String>,
    pub problems: Vec<UrlProblem>,
    pub duplicates: usize,
    pub too_many: bool,
    /// Why the file name template is refused.
    pub template: Option<TemplateReason>,
    /// A sample file name (made-up values, no network); empty for a bad template.
    pub example: String,
}

/// Pure part of [`download_check`].
pub fn check(text: &str, options: &DownloadOptions) -> DownloadCheck {
    let u = urls::check_text(text);
    DownloadCheck {
        urls: u.urls,
        problems: u.problems,
        duplicates: u.duplicates,
        too_many: u.too_many,
        template: template::validate(&options.template).err(),
        example: template::example(&options.template, options),
    }
}

/// Checks the URL field and the template for the dialog – nothing is contacted.
#[tauri::command]
pub async fn download_check(
    text: String,
    options: DownloadOptions,
) -> Result<DownloadCheck, FsError> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(FsError::new(
            FsErrorCode::TooMany,
            "Too much text in the URL field",
            None,
        ));
    }
    blocking("Checking the URLs", move || Ok(check(&text, &options))).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCommandLine {
    pub line: String,
    /// The shell the line is quoted for: `sh` | `fish` | `cmd` | `powershell`.
    pub shell: &'static str,
}

/// The name of a shell kind for the dialog.
pub fn shell_name(kind: &ShellKind) -> &'static str {
    match kind {
        ShellKind::Posix { fish: false, .. } => "sh",
        ShellKind::Posix { fish: true, .. } => "fish",
        ShellKind::Cmd { .. } => "cmd",
        ShellKind::PowerShell { .. } => "powershell",
    }
}

/// The yt-dlp command for `url` as a person would type it ("Copy command") – quoted for
/// the shell of the shell bar (`shell.windowsShell` on Windows, `$SHELL` elsewhere). An
/// error `unquotable_name` when that shell cannot take the command safely (cmd.exe and
/// `%`): then nothing is copied (review 078 #2).
#[tauri::command]
pub async fn download_command_line<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    options: DownloadOptions,
) -> Result<DownloadCommandLine, FsError> {
    let config = config_dir(&app)?;
    blocking("Building the command", move || {
        let env = DownloadEnv {
            presets: presets::load(&config.join(presets::FILE_NAME))
                .value
                .presets,
            ..DownloadEnv::default()
        };
        let stored = settings::load(&config.join(settings::FILE_NAME)).settings;
        let kind = crate::shell::choose(&shell_settings(&stored).windows_shell);
        Ok(DownloadCommandLine {
            line: args::command_line(&options, &env, &url, &kind)?,
            shell: shell_name(&kind),
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_check_counts_like_the_dialog_shows() {
        // acceptance: three lines, one ftp, one repeated → "1 URL · 1 invalid (line 2)"
        let c = check(
            "https://a.example/1\nftp://a.example/2\nhttps://a.example/1",
            &DownloadOptions::default(),
        );
        assert_eq!(c.urls, ["https://a.example/1"]);
        assert_eq!(c.problems.len(), 1);
        assert_eq!(c.problems[0].line, 2);
        assert_eq!(c.duplicates, 1);
        assert_eq!(c.template, None);
        assert_eq!(c.example, "My video [abc123].mp4");
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["problems"][0]["reason"], "scheme");
        assert_eq!(json["tooMany"], false);
        let c = check(
            "--exec=x\n-o /tmp/x",
            &DownloadOptions {
                template: "../x".into(),
                ..DownloadOptions::default()
            },
        );
        assert!(c.urls.is_empty());
        assert_eq!(c.problems.len(), 2);
        assert_eq!(c.template, Some(TemplateReason::Separator));
        assert_eq!(c.example, "");
        assert_eq!(serde_json::to_value(&c).unwrap()["template"], "separator");
    }

    /// What the dialog would show on this machine – runs only `--version` of the local
    /// programs, no network: `cargo test probe_this_machine -- --ignored --nocapture`.
    #[test]
    #[ignore = "depends on what is installed"]
    fn probe_this_machine() {
        let d = tempfile::tempdir().unwrap();
        let env = tool_env(d.path());
        let located = tools::locate(&tools::ToolSettings::default(), &tools::path_dirs(&env));
        let found = tools::probe(&located, &env, tools::today_days());
        println!("{}", serde_json::to_string_pretty(&found).unwrap());
    }

    #[test]
    fn the_environment_of_a_job_reads_settings_and_presets() {
        let d = tempfile::tempdir().unwrap();
        // nothing configured: whatever the search finds – only the shape is checked here
        let env = download_env(d.path());
        assert!(env.presets.is_empty());
        assert!(env.yt_dlp.as_deref().is_none_or(Path::is_absolute));
        // a configured path that does not exist is not replaced by a search
        std::fs::write(
            d.path().join(settings::FILE_NAME),
            r#"{"version":1,"settings":{"download.ytDlpPath":"/nowhere/yt-dlp","shell.loginPath":"off"}}"#,
        )
        .unwrap();
        std::fs::write(
            d.path().join(presets::FILE_NAME),
            r#"{"version":1,"presets":[{"id":"a","label":"A","args":["-x"]},{"id":"b","label":"B","args":["--exec","x"]}]}"#,
        )
        .unwrap();
        let env = download_env(d.path());
        assert_eq!(env.yt_dlp, None);
        assert_eq!(env.presets.len(), 1);
        assert_eq!(env.presets[0].args, ["--extract-audio"]);
    }
}
