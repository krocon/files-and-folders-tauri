//! Check for a newer version on GitHub (design 075) – no updater: one `GET` to a fixed
//! URL, the answer is hostile data, the user downloads the release themselves.
//! Keep the DTOs in sync with `src/app/core/update/update.models.ts`.

use crate::config_file::read_config;
use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::Path;
use std::time::Duration;

/// The only address asked (E1) – never from the frontend or a config file.
pub const LATEST_URL: &str =
    "https://api.github.com/repos/krocon/files-and-folders-tauri/releases/latest";
/// The release list; also the fallback when a release URL looks wrong (E4).
pub const RELEASES_URL: &str = "https://github.com/krocon/files-and-folders-tauri/releases";
/// Redirects are followed only to this host (renamed repository, E3).
const API_HOST: &str = "api.github.com";
pub const FILE_NAME: &str = "update-check.json";

const MAX_BODY: usize = 256 * 1024;
const MAX_NOTES: usize = 4 * 1024;
const MAX_FIELD: usize = 200;
const TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REDIRECTS: usize = 3;

// ---------------------------------------------------------------------------------------
// Versions (E5): SemVer 2.0.0 precedence, `v` prefix allowed, build metadata ignored
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum PreId {
    Num(u64),
    Alpha(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    major: u64,
    minor: u64,
    patch: u64,
    pre: Vec<PreId>,
}

fn number(s: &str) -> Option<u64> {
    let ok = !s.is_empty()
        && s.bytes().all(|b| b.is_ascii_digit())
        && (s == "0" || !s.starts_with('0'));
    if ok { s.parse().ok() } else { None }
}

impl Version {
    pub fn parse(text: &str) -> Option<Version> {
        let t = text.trim();
        let t = t.strip_prefix(['v', 'V']).unwrap_or(t);
        if t.is_empty() || t.len() > 64 {
            return None;
        }
        let core_pre = t.split_once('+').map_or(t, |(a, _)| a);
        let (core, pre) = match core_pre.split_once('-') {
            Some((c, p)) => (c, Some(p)),
            None => (core_pre, None),
        };
        let mut parts = core.split('.');
        let major = number(parts.next()?)?;
        let minor = number(parts.next()?)?;
        let patch = number(parts.next()?)?;
        if parts.next().is_some() {
            return None;
        }
        let mut ids = Vec::new();
        if let Some(pre) = pre {
            for id in pre.split('.') {
                if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                    return None;
                }
                if id.bytes().all(|b| b.is_ascii_digit()) {
                    ids.push(PreId::Num(number(id)?));
                } else {
                    ids.push(PreId::Alpha(id.to_owned()));
                }
            }
        }
        Some(Version {
            major,
            minor,
            patch,
            pre: ids,
        })
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)?;
        for (i, id) in self.pre.iter().enumerate() {
            f.write_str(if i == 0 { "-" } else { "." })?;
            match id {
                PreId::Num(n) => write!(f, "{n}")?,
                PreId::Alpha(s) => f.write_str(s)?,
            }
        }
        Ok(())
    }
}

impl Ord for PreId {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (PreId::Num(a), PreId::Num(b)) => a.cmp(b),
            (PreId::Num(_), PreId::Alpha(_)) => Ordering::Less,
            (PreId::Alpha(_), PreId::Num(_)) => Ordering::Greater,
            (PreId::Alpha(a), PreId::Alpha(b)) => a.cmp(b),
        }
    }
}

impl PartialOrd for PreId {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                // a pre-release ranks below its release
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => self.pre.cmp(&other.pre),
            })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

// ---------------------------------------------------------------------------------------
// Evaluating the answer (E4)
// ---------------------------------------------------------------------------------------

/// The result of a check. `checked_at` in ms since 1970.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    pub release_url: String,
    pub name: Option<String>,
    pub published_at: Option<String>,
    pub notes: Option<String>,
    pub notes_truncated: bool,
    pub checked_at: u64,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

fn err(code: FsErrorCode, message: impl Into<String>) -> FsError {
    FsError::new(code, message, None)
}

/// Text without control characters (except line break and tab), at most `max` bytes cut
/// at a character boundary. Returns the text and whether it was cut.
fn clean_text(text: &str, max: usize) -> (String, bool) {
    let cleaned: String = text
        .replace("\r\n", "\n")
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.len() <= max {
        return (trimmed.to_owned(), false);
    }
    let mut end = max;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    (trimmed[..end].trim_end().to_owned(), true)
}

fn short_field(text: Option<String>) -> Option<String> {
    text.map(|t| clean_text(&t, MAX_FIELD).0)
        .filter(|t| !t.is_empty() && !t.contains('\n'))
}

/// The release page if it is one of ours and plain (E4), else the release list.
pub fn safe_release_url(url: Option<&str>) -> String {
    let prefix = format!("{RELEASES_URL}/");
    match url {
        Some(u)
            if u.len() <= 300
                && u.starts_with(&prefix)
                && u.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"/-._~%:".contains(&b)) =>
        {
            u.to_owned()
        }
        _ => RELEASES_URL.to_owned(),
    }
}

/// Evaluates the body of `releases/latest` against the running version.
pub fn evaluate(current: &str, body: &[u8], now_ms: u64) -> Result<UpdateInfo, FsError> {
    let cur = Version::parse(current).ok_or_else(|| {
        err(
            FsErrorCode::UpdateInvalidResponse,
            format!("Own version is no SemVer: {current}"),
        )
    })?;
    let release: Release = serde_json::from_slice(body).map_err(|e| {
        err(
            FsErrorCode::UpdateInvalidResponse,
            format!("No release JSON: {e}"),
        )
    })?;
    if release.draft || release.prerelease {
        return Err(err(
            FsErrorCode::UpdateNoRelease,
            "The latest release is a draft or pre-release",
        ));
    }
    let latest = Version::parse(&release.tag_name).ok_or_else(|| {
        err(
            FsErrorCode::UpdateInvalidResponse,
            "The release tag is no version",
        )
    })?;
    let (notes, notes_truncated) = match release.body.as_deref().map(|b| clean_text(b, MAX_NOTES))
    {
        Some((n, cut)) if !n.is_empty() => (Some(n), cut),
        _ => (None, false),
    };
    Ok(UpdateInfo {
        current: cur.to_string(),
        latest: latest.to_string(),
        newer: latest > cur,
        release_url: safe_release_url(release.html_url.as_deref()),
        name: short_field(release.name),
        published_at: short_field(release.published_at),
        notes,
        notes_truncated,
        checked_at: now_ms,
    })
}

/// An HTTP status other than 200 as an error (E6).
pub fn status_error(status: u16, rate_limit_exhausted: bool) -> FsError {
    match status {
        429 => err(FsErrorCode::UpdateRateLimited, "GitHub rate limit reached"),
        403 if rate_limit_exhausted => {
            err(FsErrorCode::UpdateRateLimited, "GitHub rate limit reached")
        }
        404 => err(FsErrorCode::UpdateNoRelease, "No published release"),
        s => err(FsErrorCode::UpdateHttp, format!("HTTP status {s}")),
    }
}

// ---------------------------------------------------------------------------------------
// Fetching (E2/E3)
// ---------------------------------------------------------------------------------------

fn tls_config() -> Result<rustls::ClientConfig, FsError> {
    let provider = crate::remote::trust::provider();
    let verifier = rustls_platform_verifier::Verifier::new(provider.clone())
        .map_err(|e| err(FsErrorCode::UpdateOffline, format!("TLS: {e}")))?;
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| err(FsErrorCode::UpdateOffline, format!("TLS: {e}")))?
        .dangerous()
        // the platform verifier is the normal OS check, nothing is relaxed
        .with_custom_certificate_verifier(std::sync::Arc::new(verifier))
        .with_no_client_auth())
}

fn net_error(e: &reqwest::Error) -> FsError {
    // only the kind – no URL or details (CLAUDE.md §4: log nothing needless)
    let kind = if e.is_timeout() {
        "timeout"
    } else if e.is_connect() {
        "connect"
    } else {
        "request"
    };
    err(FsErrorCode::UpdateOffline, format!("No connection ({kind})"))
}

/// `GET url` and the body (at most 256 KiB). `https_only` is false only in tests (local
/// server).
pub async fn fetch(url: &str, app_version: &str, https_only: bool) -> Result<Vec<u8>, FsError> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.stop()
        } else if attempt.url().scheme() == "https" && attempt.url().host_str() == Some(API_HOST) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    let client = reqwest::Client::builder()
        .tls_backend_preconfigured(tls_config()?)
        .https_only(https_only)
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(policy)
        .user_agent(format!("files-and-folders/{app_version}"))
        .build()
        .map_err(|e| err(FsErrorCode::UpdateOffline, format!("HTTP client: {e}")))?;
    let mut resp = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| net_error(&e))?;
    let status = resp.status().as_u16();
    if status != 200 {
        let exhausted = resp
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.trim() == "0");
        return Err(status_error(status, exhausted));
    }
    if resp.content_length().is_some_and(|n| n > MAX_BODY as u64) {
        return Err(err(FsErrorCode::UpdateInvalidResponse, "Answer too large"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| net_error(&e))? {
        if body.len() + chunk.len() > MAX_BODY {
            return Err(err(FsErrorCode::UpdateInvalidResponse, "Answer too large"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------------------
// State file (E7)
// ---------------------------------------------------------------------------------------

/// `update-check.json`: when the last check ran and which version the user skips.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_check: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct StateFile {
    version: u32,
    #[serde(flatten)]
    state: UpdateState,
}

/// Loads the state; missing or broken → empty (a broken file is kept as `.bad`).
pub fn load_state(file: &Path) -> UpdateState {
    read_config(file, 4096, UpdateState::default, |text| {
        let f: StateFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
        if f.version != 1 {
            return Err("unknown version".into());
        }
        let skipped = f
            .state
            .skipped
            .and_then(|s| Version::parse(&s).map(|v| v.to_string()));
        Ok(UpdateState {
            last_check: f.state.last_check,
            skipped,
        })
    })
    .value
}

pub fn save_state(file: &Path, state: &UpdateState) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(&StateFile {
        version: 1,
        state: state.clone(),
    })
    .map_err(std::io::Error::other)?;
    write_atomic(file, &bytes)
}

/// Normalises a version to skip; `None` = skip nothing.
pub fn skip_version(version: Option<&str>) -> Result<Option<String>, FsError> {
    match version {
        None => Ok(None),
        Some(v) => Version::parse(v)
            .map(|v| Some(v.to_string()))
            .ok_or_else(|| err(FsErrorCode::UpdateInvalidResponse, "No version")),
    }
}

#[cfg(test)]
mod tests;
