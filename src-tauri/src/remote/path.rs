//! Server paths (design 034 E1): `remote://<profile-id>/<server path>`.
//!
//! The profile id stands for host, user and secret – a path never carries
//! credentials. After the id follows the raw absolute server path with `/`
//! separators; nothing is percent-encoded (`#`, `%`, `?` and spaces are plain
//! name characters). Only Rust splits and joins these paths; the frontend treats
//! them as opaque strings like every other path.
//!
//! Refused everywhere: NUL, CR and LF (an FTP command ends at CRLF – a name with
//! a line break could smuggle a second command), `.`/`..` segments and empty
//! segments (`//`).

use crate::error::{FsError, FsErrorCode};
use crate::model::PathSegment;

pub const SCHEME: &str = "remote://";
/// Longest accepted server path in bytes.
pub const MAX_PATH_BYTES: usize = 4096;
/// Longest profile id.
pub const MAX_ID_CHARS: usize = 40;

/// Whether `raw` is meant as a server path (it may still be invalid).
pub fn is_remote(raw: &str) -> bool {
    raw.starts_with(SCHEME)
}

/// A checked profile id: `[a-z0-9-]{1,40}`.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().count() <= MAX_ID_CHARS
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A single name on a server: not empty, no `/`, not `.`/`..`, no NUL/CR/LF.
pub fn valid_segment(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\0', '\r', '\n'])
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RemotePath {
    profile: String,
    /// `/` or `/a/b` (no trailing `/`).
    path: String,
}

fn invalid(message: &str, raw: &str) -> FsError {
    FsError::at(FsErrorCode::InvalidPath, message, raw)
}

impl RemotePath {
    /// Parses `remote://<id>[/path]`; a trailing `/` is dropped.
    pub fn parse(raw: &str) -> Result<Self, FsError> {
        let Some(rest) = raw.strip_prefix(SCHEME) else {
            return Err(invalid("Not a server path", raw));
        };
        let (id, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, "/"),
        };
        if !valid_id(id) {
            return Err(invalid("Invalid connection id in the path", raw));
        }
        Self::new(id, path).map_err(|e| FsError {
            path: Some(raw.to_string()),
            ..e
        })
    }

    /// The path `server_path` (absolute, `/`-separated) of profile `id`.
    pub fn new(id: &str, server_path: &str) -> Result<Self, FsError> {
        if !valid_id(id) {
            return Err(invalid("Invalid connection id", server_path));
        }
        if server_path.len() > MAX_PATH_BYTES {
            return Err(invalid("Server path is too long", server_path));
        }
        if !server_path.starts_with('/') {
            return Err(invalid("Server path must be absolute", server_path));
        }
        let trimmed = server_path.trim_end_matches('/');
        if trimmed.is_empty() {
            return Ok(Self::root(id));
        }
        for seg in trimmed[1..].split('/') {
            if !valid_segment(seg) {
                return Err(invalid(
                    "Server path has an empty, \".\"/\"..\" or control-character segment",
                    server_path,
                ));
            }
        }
        Ok(Self {
            profile: id.to_string(),
            path: trimmed.to_string(),
        })
    }

    pub fn root(id: &str) -> Self {
        Self {
            profile: id.to_string(),
            path: "/".to_string(),
        }
    }

    pub fn profile(&self) -> &str {
        &self.profile
    }

    /// The absolute path on the server (`/` = root).
    pub fn server_path(&self) -> &str {
        &self.path
    }

    pub fn is_root(&self) -> bool {
        self.path == "/"
    }

    /// The last name (`None` for the root).
    pub fn name(&self) -> Option<&str> {
        if self.is_root() {
            None
        } else {
            self.path.rsplit('/').next()
        }
    }

    pub fn parent(&self) -> Option<Self> {
        if self.is_root() {
            return None;
        }
        let i = self.path.rfind('/').unwrap_or(0);
        Some(Self {
            profile: self.profile.clone(),
            path: if i == 0 {
                "/".to_string()
            } else {
                self.path[..i].to_string()
            },
        })
    }

    /// `self/name` – `name` must be a valid single name.
    pub fn join(&self, name: &str) -> Result<Self, FsError> {
        if !valid_segment(name) {
            return Err(FsError::at(
                FsErrorCode::InvalidName,
                "Invalid name on a server",
                name,
            ));
        }
        let path = if self.is_root() {
            format!("/{name}")
        } else {
            format!("{}/{name}", self.path)
        };
        if path.len() > MAX_PATH_BYTES {
            return Err(invalid("Server path is too long", &path));
        }
        Ok(Self {
            profile: self.profile.clone(),
            path,
        })
    }

    /// `self` is `other` or lies below it (same profile, whole segments).
    pub fn starts_with(&self, other: &RemotePath) -> bool {
        if self.profile != other.profile {
            return false;
        }
        other.is_root()
            || self.path == other.path
            || (self.path.starts_with(&other.path)
                && self.path.as_bytes().get(other.path.len()) == Some(&b'/'))
    }

    /// Breadcrumbs: the profile's root (named after the profile), then every folder.
    pub fn segments(&self, profile_name: &str) -> Vec<PathSegment> {
        let mut out = vec![PathSegment {
            name: profile_name.to_string(),
            path: Self::root(&self.profile).to_string(),
        }];
        let mut cur = Self::root(&self.profile);
        if !self.is_root() {
            for seg in self.path[1..].split('/') {
                // segments were checked when the path was built
                cur = cur.join(seg).expect("checked segment");
                out.push(PathSegment {
                    name: seg.to_string(),
                    path: cur.to_string(),
                });
            }
        }
        out
    }

    /// `Name: /server/path` for the header and tab titles.
    pub fn display(&self, profile_name: &str) -> String {
        format!("{profile_name}: {}", self.path)
    }
}

impl std::fmt::Display for RemotePath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.is_root() {
            write!(f, "{SCHEME}{}/", self.profile)
        } else {
            write!(f, "{SCHEME}{}{}", self.profile, self.path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_root_and_folders() {
        let r = RemotePath::parse("remote://k3x9").unwrap();
        assert!(r.is_root());
        assert_eq!(r.to_string(), "remote://k3x9/");
        assert_eq!(RemotePath::parse("remote://k3x9/").unwrap(), r);
        let p = RemotePath::parse("remote://k3x9/pub/ftpx/").unwrap();
        assert_eq!(p.server_path(), "/pub/ftpx");
        assert_eq!(p.to_string(), "remote://k3x9/pub/ftpx");
        assert_eq!(p.name(), Some("ftpx"));
        assert_eq!(p.profile(), "k3x9");
    }

    #[test]
    fn keeps_special_characters_as_they_are() {
        for name in ["a b", "50%", "#1", "what?", "Äpfel ü", "😀 x", "a\\b", "C:"] {
            let raw = format!("remote://p1/dir/{name}");
            let p = RemotePath::parse(&raw).unwrap();
            assert_eq!(p.name(), Some(name));
            assert_eq!(p.to_string(), raw);
        }
    }

    #[test]
    fn refuses_bad_paths() {
        for raw in [
            "/local/path",
            "sftp://host/x",
            "remote://",
            "remote://UPPER/x",
            "remote://a_b/x",
            "remote://a/x/../y",
            "remote://a/x/./y",
            "remote://a/x//y",
            "remote://a/x\r\nDELE y",
            "remote://a/x\ny",
            "remote://a/x\0y",
        ] {
            assert!(RemotePath::parse(raw).is_err(), "{raw:?} must be refused");
        }
        let long = format!("remote://a/{}", "x".repeat(MAX_PATH_BYTES + 1));
        assert!(RemotePath::parse(&long).is_err());
        let id = "a".repeat(MAX_ID_CHARS + 1);
        assert!(RemotePath::parse(&format!("remote://{id}/x")).is_err());
        assert!(RemotePath::new("a", "relative").is_err());
    }

    #[test]
    fn parent_join_and_prefix() {
        let p = RemotePath::parse("remote://a/x/y").unwrap();
        let x = p.parent().unwrap();
        assert_eq!(x.to_string(), "remote://a/x");
        let root = x.parent().unwrap();
        assert!(root.is_root());
        assert!(root.parent().is_none());
        assert_eq!(root.join("z").unwrap().to_string(), "remote://a/z");
        assert_eq!(x.join("y").unwrap(), p);
        for bad in ["", ".", "..", "a/b", "x\ry", "x\ny", "x\0"] {
            assert!(x.join(bad).is_err(), "{bad:?}");
        }
        assert!(p.starts_with(&x));
        assert!(p.starts_with(&root));
        assert!(p.starts_with(&p));
        assert!(!x.starts_with(&p));
        let xy = RemotePath::parse("remote://a/xy").unwrap();
        assert!(!xy.starts_with(&x));
        let other = RemotePath::parse("remote://b/x/y").unwrap();
        assert!(!other.starts_with(&x));
    }

    #[test]
    fn segments_start_with_the_profile() {
        let p = RemotePath::parse("remote://a/pub/ftp x").unwrap();
        let s = p.segments("Mein Server");
        let names: Vec<&str> = s.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["Mein Server", "pub", "ftp x"]);
        assert_eq!(s[0].path, "remote://a/");
        assert_eq!(s[2].path, "remote://a/pub/ftp x");
        assert_eq!(p.display("Mein Server"), "Mein Server: /pub/ftp x");
        assert_eq!(RemotePath::root("a").segments("S").len(), 1);
    }

    #[test]
    fn ids() {
        assert!(valid_id("k3x9-a"));
        assert!(!valid_id(""));
        assert!(!valid_id("A"));
        assert!(!valid_id("a/b"));
        assert!(is_remote("remote://x/y"));
        assert!(!is_remote("/remote://x"));
    }
}
