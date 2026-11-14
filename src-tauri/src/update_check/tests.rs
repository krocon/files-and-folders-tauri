use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use tempfile::tempdir;

fn v(s: &str) -> Version {
    Version::parse(s).unwrap_or_else(|| panic!("{s} parses"))
}

/// Shape of a real answer of `releases/latest` (shortened).
const GITHUB_ANSWER: &str = r###"{
  "url": "https://api.github.com/repos/krocon/files-and-folders-tauri/releases/1",
  "html_url": "https://github.com/krocon/files-and-folders-tauri/releases/tag/v1.5.0",
  "tag_name": "v1.5.0",
  "name": "Files and Folders 1.5.0",
  "draft": false,
  "prerelease": false,
  "published_at": "2026-11-20T10:00:00Z",
  "assets": [{ "name": "fnf.dmg", "size": 123 }],
  "body": "## Neu\r\n- Nach Updates suchen\r\n- Bilder-Übersicht 🖼"
}"###;

#[test]
fn versions_follow_semver_precedence() {
    assert!(v("1.4.0") < v("1.5.0"));
    assert!(v("1.4.9") < v("1.10.0"));
    assert!(v("1.5.0-beta.1") < v("1.5.0"));
    assert!(v("1.5.0-alpha") < v("1.5.0-beta"));
    assert!(v("1.5.0-beta.2") < v("1.5.0-beta.11"));
    assert!(v("1.5.0-1") < v("1.5.0-alpha"));
    assert!(v("1.5.0-beta") < v("1.5.0-beta.1"));
    assert_eq!(v("v1.4.0"), v("1.4.0"));
    assert_eq!(v("1.4.0+build.7"), v("1.4.0"));
    assert_eq!(v(" V2.0.0 ").to_string(), "2.0.0");
    assert_eq!(v("1.5.0-rc.1").to_string(), "1.5.0-rc.1");
}

#[test]
fn invalid_versions_are_refused() {
    for bad in [
        "", "v", "1", "1.2", "1.2.3.4", "01.2.3", "1.2.x", "1.2.3-", "1.2.3-a..b", "1.2.3-ä",
        "latest", "-1.2.3",
    ] {
        assert!(Version::parse(bad).is_none(), "{bad:?}");
    }
}

#[test]
fn a_newer_release_is_found() {
    let info = evaluate("1.4.0", GITHUB_ANSWER.as_bytes(), 42).unwrap();
    assert!(info.newer);
    assert_eq!(info.current, "1.4.0");
    assert_eq!(info.latest, "1.5.0");
    assert_eq!(
        info.release_url,
        "https://github.com/krocon/files-and-folders-tauri/releases/tag/v1.5.0"
    );
    assert_eq!(info.name.as_deref(), Some("Files and Folders 1.5.0"));
    assert_eq!(info.published_at.as_deref(), Some("2026-11-20T10:00:00Z"));
    assert_eq!(
        info.notes.as_deref(),
        Some("## Neu\n- Nach Updates suchen\n- Bilder-Übersicht 🖼")
    );
    assert!(!info.notes_truncated);
    assert_eq!(info.checked_at, 42);
}

#[test]
fn same_or_older_release_is_not_newer() {
    assert!(!evaluate("1.5.0", GITHUB_ANSWER.as_bytes(), 0).unwrap().newer);
    assert!(!evaluate("1.6.0", GITHUB_ANSWER.as_bytes(), 0).unwrap().newer);
    // a pre-release of our own ranks below the release
    assert!(
        evaluate("1.5.0-beta.1", GITHUB_ANSWER.as_bytes(), 0)
            .unwrap()
            .newer
    );
}

#[test]
fn drafts_and_prereleases_are_no_release() {
    for flag in ["draft", "prerelease"] {
        let body = GITHUB_ANSWER.replace(&format!("\"{flag}\": false"), &format!("\"{flag}\": true"));
        assert_eq!(
            evaluate("1.4.0", body.as_bytes(), 0).unwrap_err().code,
            FsErrorCode::UpdateNoRelease
        );
    }
}

#[test]
fn hostile_answers_are_refused_or_tamed() {
    for body in ["", "<html>", "[]", r#"{"tag_name": 5}"#, r#"{"tag_name": "nightly"}"#] {
        assert_eq!(
            evaluate("1.4.0", body.as_bytes(), 0).unwrap_err().code,
            FsErrorCode::UpdateInvalidResponse,
            "{body}"
        );
    }
    // a foreign or odd page falls back to our release list
    for url in [
        "https://evil.example/releases/tag/v9.0.0",
        "https://github.com/krocon/files-and-folders-tauri/releases/tag/v9\"><script>",
        "javascript:alert(1)",
        "https://github.com/krocon/files-and-folders-tauri/releasesX",
    ] {
        let body = format!(r#"{{"tag_name": "v9.0.0", "html_url": {}}}"#, serde_json::json!(url));
        let info = evaluate("1.4.0", body.as_bytes(), 0).unwrap();
        assert_eq!(info.release_url, RELEASES_URL, "{url}");
    }
    // control characters go, long notes are cut at a character boundary
    let notes = format!("a\u{7}b\u{1b}[31m{}", "ä".repeat(5000));
    let body = serde_json::json!({ "tag_name": "1.5.0", "body": notes, "name": "x\ny" }).to_string();
    let info = evaluate("1.4.0", body.as_bytes(), 0).unwrap();
    let n = info.notes.unwrap();
    assert!(n.starts_with("ab[31m"));
    assert!(n.len() <= 4096);
    assert!(info.notes_truncated);
    assert_eq!(info.name, None, "a multi-line name is dropped");
    assert_eq!(info.release_url, RELEASES_URL);
}

#[test]
fn own_version_must_be_semver() {
    assert_eq!(
        evaluate("dev", GITHUB_ANSWER.as_bytes(), 0).unwrap_err().code,
        FsErrorCode::UpdateInvalidResponse
    );
}

#[test]
fn status_codes_map_to_errors() {
    assert_eq!(status_error(404, false).code, FsErrorCode::UpdateNoRelease);
    assert_eq!(status_error(429, false).code, FsErrorCode::UpdateRateLimited);
    assert_eq!(status_error(403, true).code, FsErrorCode::UpdateRateLimited);
    assert_eq!(status_error(403, false).code, FsErrorCode::UpdateHttp);
    assert_eq!(status_error(500, false).code, FsErrorCode::UpdateHttp);
}

#[test]
fn error_codes_serialise_snake_case() {
    let json = serde_json::to_value(status_error(429, false)).unwrap();
    assert_eq!(json["code"], "update_rate_limited");
}

#[test]
fn the_fixed_urls_point_to_our_repository() {
    assert!(LATEST_URL.starts_with("https://api.github.com/repos/krocon/files-and-folders-tauri/"));
    assert!(RELEASES_URL.starts_with("https://github.com/krocon/files-and-folders-tauri/"));
}

#[test]
fn state_round_trip_and_bad_files() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("Ordner ä").join(FILE_NAME);
    assert_eq!(load_state(&file), UpdateState::default());
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    let state = UpdateState {
        last_check: Some(1_700_000_000_000),
        skipped: Some("1.5.0".into()),
    };
    save_state(&file, &state).unwrap();
    assert_eq!(load_state(&file), state);
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.contains("\"version\": 1") && text.contains("\"lastCheck\""));

    // a skipped value that is no version is dropped
    std::fs::write(&file, r#"{"version":1,"skipped":"<b>"}"#).unwrap();
    assert_eq!(load_state(&file).skipped, None);
    // broken or unknown version → empty, kept as .bad
    std::fs::write(&file, "{").unwrap();
    assert_eq!(load_state(&file), UpdateState::default());
    assert!(file.with_file_name(format!("{FILE_NAME}.bad")).exists());
    std::fs::write(&file, r#"{"version":2,"lastCheck":5}"#).unwrap();
    assert_eq!(load_state(&file), UpdateState::default());
}

#[test]
fn skip_version_normalises() {
    assert_eq!(skip_version(None).unwrap(), None);
    assert_eq!(skip_version(Some("v1.5.0")).unwrap().as_deref(), Some("1.5.0"));
    assert_eq!(
        skip_version(Some("../x")).unwrap_err().code,
        FsErrorCode::UpdateInvalidResponse
    );
}

/// A local HTTP server that answers one request with `response` and hands back the request.
fn serve_once(response: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/repos/x/releases/latest", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0u8; 4096];
        let mut request = Vec::new();
        while !request.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = stream.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            request.extend_from_slice(&buf[..n]);
        }
        let _ = stream.write_all(&response);
        String::from_utf8_lossy(&request).into_owned()
    });
    (url, handle)
}

fn http(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

#[tokio::test]
async fn fetch_reads_the_answer_and_sends_only_what_is_needed() {
    let (url, server) = serve_once(http("200 OK", "", GITHUB_ANSWER.as_bytes()));
    let body = fetch(&url, "1.4.0", false).await.unwrap();
    assert_eq!(body, GITHUB_ANSWER.as_bytes());
    let request = server.join().unwrap().to_lowercase();
    assert!(request.starts_with("get /repos/x/releases/latest http/1.1"));
    assert!(request.contains("user-agent: files-and-folders/1.4.0"));
    assert!(request.contains("accept: application/vnd.github+json"));
    assert!(!request.contains("cookie"));
    assert!(!request.contains("authorization"));
}

#[tokio::test]
async fn fetch_maps_status_and_limits() {
    let (url, server) = serve_once(http("404 Not Found", "", b"{}"));
    assert_eq!(
        fetch(&url, "1.4.0", false).await.unwrap_err().code,
        FsErrorCode::UpdateNoRelease
    );
    server.join().unwrap();

    let (url, server) = serve_once(http("403 Forbidden", "x-ratelimit-remaining: 0\r\n", b"{}"));
    assert_eq!(
        fetch(&url, "1.4.0", false).await.unwrap_err().code,
        FsErrorCode::UpdateRateLimited
    );
    server.join().unwrap();

    let big = vec![b' '; MAX_BODY + 1];
    let (url, server) = serve_once(http("200 OK", "", &big));
    assert_eq!(
        fetch(&url, "1.4.0", false).await.unwrap_err().code,
        FsErrorCode::UpdateInvalidResponse
    );
    let _ = server.join();
}

#[tokio::test]
async fn fetch_refuses_plain_http_in_production_mode_and_unreachable_hosts() {
    // https_only: an http URL is refused before any connection
    assert_eq!(
        fetch("http://127.0.0.1:9/x", "1.4.0", true)
            .await
            .unwrap_err()
            .code,
        FsErrorCode::UpdateOffline
    );
    // nobody listens on the port
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    assert_eq!(
        fetch(&format!("http://127.0.0.1:{port}/x"), "1.4.0", false)
            .await
            .unwrap_err()
            .code,
        FsErrorCode::UpdateOffline
    );
}

#[tokio::test]
async fn redirects_to_other_hosts_are_not_followed() {
    let (url, server) = serve_once(http(
        "302 Found",
        "Location: http://127.0.0.1:1/elsewhere\r\n",
        b"",
    ));
    assert_eq!(
        fetch(&url, "1.4.0", false).await.unwrap_err().code,
        FsErrorCode::UpdateHttp
    );
    server.join().unwrap();
}

/// Real request against GitHub – by hand only: `cargo test --lib live_github -- --ignored`.
#[tokio::test]
#[ignore = "network"]
async fn live_github() {
    let body = fetch(LATEST_URL, "0.0.1", true).await.unwrap();
    let info = evaluate("0.0.1", &body, now_ms()).unwrap();
    println!("{info:?}");
    assert!(info.newer);
}
