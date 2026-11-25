//! URLs for yt-dlp (design 078): parsed (never a regex), only http/https, bounded in
//! length and number, duplicates merged. What goes on is the parser's own form of the
//! URL – it always starts with `http://` or `https://`, so it can never be read as an
//! option, whatever the user typed.

use super::{MAX_URL_BYTES, MAX_URLS};
use serde::Serialize;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UrlReason {
    /// Not a URL at all (also: blanks or control characters inside).
    Invalid,
    /// Another scheme than http/https.
    Scheme,
    NoHost,
    /// `https://user:password@…` – a secret would end up in the task list.
    Credentials,
    TooLong,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlProblem {
    /// 1-based line of the text field.
    pub line: usize,
    pub reason: UrlReason,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlCheck {
    /// The valid URLs in their normalised form, without duplicates, in the order typed.
    pub urls: Vec<String>,
    pub problems: Vec<UrlProblem>,
    /// Lines that repeated an earlier URL.
    pub duplicates: usize,
    /// More than [`MAX_URLS`] valid URLs (the rest is not in `urls`).
    pub too_many: bool,
}

/// One URL as typed (already trimmed) → its normalised form.
pub fn check_one(raw: &str) -> Result<String, UrlReason> {
    if raw.len() > MAX_URL_BYTES {
        return Err(UrlReason::TooLong);
    }
    // the parser would silently drop tabs and line breaks
    if raw.is_empty() || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(UrlReason::Invalid);
    }
    let url = Url::parse(raw).map_err(|_| UrlReason::Invalid)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(UrlReason::Scheme);
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(UrlReason::NoHost);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UrlReason::Credentials);
    }
    let out = url.as_str();
    if out.len() > MAX_URL_BYTES {
        return Err(UrlReason::TooLong);
    }
    debug_assert!(out.starts_with("http://") || out.starts_with("https://"));
    Ok(out.to_string())
}

/// The text of the URL field: one URL per line, empty lines are skipped.
pub fn check_text(text: &str) -> UrlCheck {
    let mut out = UrlCheck::default();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match check_one(line) {
            Ok(url) => {
                if out.urls.contains(&url) {
                    out.duplicates += 1;
                } else if out.urls.len() >= MAX_URLS {
                    out.too_many = true;
                } else {
                    out.urls.push(url);
                }
            }
            Err(reason) => {
                // a huge paste: the list of problems stays bounded too
                if out.problems.len() < MAX_URLS {
                    out.problems.push(UrlProblem {
                        line: i + 1,
                        reason,
                    });
                }
            }
        }
    }
    out
}

/// `host/…/last-segment` for the progress line: no query, no fragment, bounded.
pub fn display(url: &str) -> String {
    let Ok(u) = Url::parse(url) else {
        return String::new();
    };
    let host = u.host_str().unwrap_or("");
    let segs: Vec<&str> = u
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    let mut out = match segs.as_slice() {
        [] => host.to_string(),
        [one] => format!("{host}/{one}"),
        [.., last] => format!("{host}/…/{last}"),
    };
    if out.chars().count() > 80 {
        out = out.chars().take(79).collect::<String>() + "…";
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_http_urls_pass() {
        for (raw, want) in [
            (
                "https://example.org/watch?v=1",
                Ok("https://example.org/watch?v=1"),
            ),
            ("http://example.org", Ok("http://example.org/")),
            ("HTTPS://Example.ORG/A", Ok("https://example.org/A")),
            (
                "https://bücher.example/ä?q=ö#x",
                Ok("https://xn--bcher-kva.example/%C3%A4?q=%C3%B6#x"),
            ),
            ("https://[::1]:8080/x", Ok("https://[::1]:8080/x")),
            ("ftp://example.org/x", Err(UrlReason::Scheme)),
            ("file:///etc/passwd", Err(UrlReason::Scheme)),
            ("javascript:alert(1)", Err(UrlReason::Scheme)),
            ("data:text/plain,x", Err(UrlReason::Scheme)),
            // options never pass as a URL
            ("--exec=touch /tmp/pwned", Err(UrlReason::Invalid)),
            ("--exec=x", Err(UrlReason::Invalid)),
            ("-o", Err(UrlReason::Invalid)),
            ("-o /tmp/x", Err(UrlReason::Invalid)),
            ("--", Err(UrlReason::Invalid)),
            ("-", Err(UrlReason::Invalid)),
            ("example.org/x", Err(UrlReason::Invalid)),
            ("ytsearch:cats", Err(UrlReason::Scheme)),
            ("https://", Err(UrlReason::Invalid)),
            // the URL standard reads extra slashes away
            ("https:///x", Ok("https://x/")),
            (
                "https://user:secret@example.org/x",
                Err(UrlReason::Credentials),
            ),
            ("https://user@example.org/x", Err(UrlReason::Credentials)),
            ("https://example.org/a b", Err(UrlReason::Invalid)),
            ("https://example.org/a\tb", Err(UrlReason::Invalid)),
            ("https://example.org/a\u{0}b", Err(UrlReason::Invalid)),
            ("https://example.org/a\u{1b}[31m", Err(UrlReason::Invalid)),
            ("", Err(UrlReason::Invalid)),
        ] {
            assert_eq!(check_one(raw), want.map(String::from), "{raw:?}");
        }
        let long = format!("https://example.org/{}", "a".repeat(MAX_URL_BYTES));
        assert_eq!(check_one(&long), Err(UrlReason::TooLong));
    }

    #[test]
    fn whatever_passes_starts_with_the_scheme() {
        for raw in [
            "https://example.org/--exec=x",
            "https://example.org/?--exec",
            "http://-o.example.org/",
            "https://example.org/#--",
        ] {
            if let Ok(u) = check_one(raw) {
                assert!(u.starts_with("http://") || u.starts_with("https://"), "{u}");
                assert!(!u.starts_with('-'));
                assert!(!u.chars().any(|c| c.is_control() || c.is_whitespace()));
            }
        }
    }

    #[test]
    fn the_text_field_is_counted_per_line() {
        // the acceptance case: three URLs, one ftp, one repeated
        let c = check_text("https://a.example/1\nftp://a.example/2\nhttps://a.example/1\n");
        assert_eq!(c.urls, ["https://a.example/1"]);
        assert_eq!(
            c.problems,
            [UrlProblem {
                line: 2,
                reason: UrlReason::Scheme
            }]
        );
        assert_eq!(c.duplicates, 1);
        let c = check_text(
            "  https://a.example/1  \r\n\r\n\n--exec=x\n-o /tmp/x\nhttps://b.example/\n",
        );
        assert_eq!(c.urls, ["https://a.example/1", "https://b.example/"]);
        assert_eq!(
            c.problems.iter().map(|p| p.line).collect::<Vec<_>>(),
            [4, 5]
        );
        // the same address typed differently is one URL
        let c = check_text("https://A.example\nhttps://a.example/");
        assert_eq!((c.urls.len(), c.duplicates), (1, 1));
        assert_eq!(check_text(""), UrlCheck::default());
    }

    #[test]
    fn the_number_of_urls_is_bounded() {
        let text: String = (0..MAX_URLS + 5)
            .map(|i| format!("https://a.example/{i}\n"))
            .collect();
        let c = check_text(&text);
        assert_eq!(c.urls.len(), MAX_URLS);
        assert!(c.too_many);
        let bad: String = (0..MAX_URLS * 3).map(|_| "x\n").collect();
        assert_eq!(check_text(&bad).problems.len(), MAX_URLS);
    }

    #[test]
    fn display_shows_no_query() {
        assert_eq!(
            display("https://www.example.org/watch?v=SECRET&t=1#x"),
            "www.example.org/watch"
        );
        assert_eq!(
            display("https://example.org/a/b/c.mp4?token=1"),
            "example.org/…/c.mp4"
        );
        assert_eq!(display("https://example.org/"), "example.org");
        assert_eq!(display("nonsense"), "");
        let long = format!("https://example.org/{}", "ä".repeat(300));
        assert_eq!(display(&long).chars().count(), 80);
    }
}
