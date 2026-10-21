//! Connection profiles (design 034 §3.1): `<app_config_dir>/connections.json`.
//! A profile never holds a secret – `secret` only says whether one is kept in
//! the system keychain. Keep in sync with `src/app/core/remote/remote.models.ts`.

use super::path::{RemotePath, valid_id};
use crate::config_file::{Loaded, read_config};
use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::hash::{BuildHasher, Hasher};
use std::io;
use std::net::Ipv6Addr;
use std::path::Path;

pub const FILE_NAME: &str = "connections.json";
const VERSION: u32 = 1;
const MAX_FILE_BYTES: u64 = 2 << 20;
pub const MAX_PROFILES: usize = 500;
const MAX_NAME_CHARS: usize = 80;
const MAX_HOST_CHARS: usize = 253;
const MAX_USER_CHARS: usize = 256;
const MAX_DESCRIPTION_CHARS: usize = 1000;
const MAX_KEY_PATH_CHARS: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RemoteKind {
    Ftp,
    FtpsExplicit,
    FtpsImplicit,
    #[default]
    Sftp,
}

impl RemoteKind {
    pub fn default_port(self) -> u16 {
        match self {
            RemoteKind::Ftp | RemoteKind::FtpsExplicit => 21,
            RemoteKind::FtpsImplicit => 990,
            RemoteKind::Sftp => 22,
        }
    }

    pub fn is_ftp(self) -> bool {
        !matches!(self, RemoteKind::Sftp)
    }

    /// Whether the connection (and with it password and data) is encrypted.
    pub fn encrypted(self) -> bool {
        !matches!(self, RemoteKind::Ftp)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AuthKind {
    #[default]
    Password,
    /// SFTP: private key file (`key_file`), passphrase as a secret if it is encrypted.
    Key,
    /// SFTP: SSH agent (`SSH_AUTH_SOCK`, Pageant/OpenSSH agent on Windows).
    Agent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum NameEncoding {
    /// UTF-8 (`OPTS UTF8 ON` when the server offers it).
    #[default]
    Auto,
    Utf8,
    Latin1,
}

/// Where the secret of a profile lives – a marker, never the secret itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SecretState {
    #[default]
    None,
    Keychain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteProfile {
    pub id: String,
    pub name: String,
    pub kind: RemoteKind,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub anonymous: bool,
    pub auth: AuthKind,
    pub key_file: Option<String>,
    /// Absolute server path or `None` (= the folder after login).
    pub start_path: Option<String>,
    pub passive: bool,
    pub encoding: NameEncoding,
    pub timeout_secs: u32,
    pub max_connections: u32,
    pub keepalive_secs: u32,
    pub description: String,
    /// FTPS: SHA-256 (hex) of the leaf certificate the user confirmed.
    pub pinned_cert: Option<String>,
    /// FTPS: the pinned certificate may name another host (confirmed explicitly).
    pub accept_hostname_mismatch: bool,
    pub secret: SecretState,
}

impl Default for RemoteProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            kind: RemoteKind::Sftp,
            host: String::new(),
            port: 22,
            user: String::new(),
            anonymous: false,
            auth: AuthKind::Password,
            key_file: None,
            start_path: None,
            passive: true,
            encoding: NameEncoding::Auto,
            timeout_secs: 20,
            max_connections: 2,
            keepalive_secs: 60,
            description: String::new(),
            pinned_cert: None,
            accept_hostname_mismatch: false,
            secret: SecretState::None,
        }
    }
}

impl RemoteProfile {
    /// The user name sent to the server.
    pub fn login_user(&self) -> &str {
        if self.kind.is_ftp() && self.anonymous {
            "anonymous"
        } else {
            &self.user
        }
    }

    /// Whether connecting needs a password / passphrase from the user or the keychain.
    pub fn needs_secret(&self) -> bool {
        match (self.kind, self.auth) {
            (k, _) if k.is_ftp() => !self.anonymous,
            (_, AuthKind::Password) => true,
            // an unencrypted key or the agent need nothing; an encrypted key is found out on use
            _ => false,
        }
    }

    /// `host` or `[ipv6]` plus port – for messages and known_hosts.
    pub fn address(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

fn has_control(s: &str) -> bool {
    s.chars().any(char::is_control)
}

/// Host name (ASCII letters, digits, `.`, `-`, `_`) or an IP address (IPv6 without brackets).
pub fn valid_host(host: &str) -> bool {
    if host.is_empty() || host.len() > MAX_HOST_CHARS {
        return false;
    }
    if host.contains(':') {
        return host.parse::<Ipv6Addr>().is_ok();
    }
    host.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        && !host.starts_with(['.', '-'])
}

/// Checks a profile and brings optional values into their bounds. `Err` = reason code.
pub fn check(mut p: RemoteProfile) -> Result<RemoteProfile, &'static str> {
    if !valid_id(&p.id) {
        return Err("id");
    }
    p.name = p.name.trim().to_string();
    if p.name.is_empty() || p.name.chars().count() > MAX_NAME_CHARS || has_control(&p.name) {
        return Err("name");
    }
    p.host = p.host.trim().to_string();
    if !valid_host(&p.host) {
        return Err("host");
    }
    if p.port == 0 {
        return Err("port");
    }
    if p.user.chars().count() > MAX_USER_CHARS || has_control(&p.user) {
        return Err("user");
    }
    if p.user.is_empty() && !(p.kind.is_ftp() && p.anonymous) {
        return Err("user");
    }
    if !p.kind.is_ftp() {
        p.anonymous = false;
    } else if p.auth != AuthKind::Password {
        return Err("auth");
    }
    match (&p.auth, &p.key_file) {
        (AuthKind::Key, Some(k)) => {
            if k.chars().count() > MAX_KEY_PATH_CHARS
                || has_control(k)
                || !Path::new(k).is_absolute()
            {
                return Err("keyFile");
            }
        }
        (AuthKind::Key, None) => return Err("keyFile"),
        _ => p.key_file = None,
    }
    if let Some(sp) = &p.start_path {
        if sp.trim().is_empty() {
            p.start_path = None;
        } else if RemotePath::new(&p.id, sp).is_err() {
            return Err("startPath");
        }
    }
    p.timeout_secs = p.timeout_secs.clamp(5, 120);
    p.max_connections = p.max_connections.clamp(1, 8);
    if p.keepalive_secs != 0 {
        p.keepalive_secs = p.keepalive_secs.clamp(15, 600);
    }
    if p.description.chars().count() > MAX_DESCRIPTION_CHARS {
        p.description = p.description.chars().take(MAX_DESCRIPTION_CHARS).collect();
    }
    if let Some(pin) = &p.pinned_cert
        && (pin.len() != 64 || !pin.chars().all(|c| c.is_ascii_hexdigit()))
    {
        p.pinned_cert = None;
    }
    if !p.kind.is_ftp() || p.kind == RemoteKind::Ftp {
        p.pinned_cert = None;
        p.accept_hostname_mismatch = false;
    }
    if p.pinned_cert.is_none() {
        p.accept_hostname_mismatch = false;
    }
    Ok(p)
}

/// A new random id (`[a-z0-9]{8}`) not in `taken`.
pub fn new_id(taken: &HashSet<String>) -> String {
    loop {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        let mut n = h.finish();
        let mut id = String::new();
        for _ in 0..8 {
            id.push(char::from_digit((n % 36) as u32, 36).unwrap_or('0'));
            n /= 36;
        }
        if !taken.contains(&id) {
            return id;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProfilesFile {
    version: u32,
    #[serde(default)]
    profiles: Vec<serde_json::Value>,
}

/// Valid profiles of a file; invalid ones and repeated ids are dropped one by one.
pub fn sanitize(values: Vec<serde_json::Value>) -> Vec<RemoteProfile> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter_map(|v| serde_json::from_value::<RemoteProfile>(v).ok())
        .filter_map(|p| check(p).ok())
        .filter(|p| seen.insert(p.id.clone()))
        .take(MAX_PROFILES)
        .collect()
}

fn parse(text: &str) -> Result<Vec<RemoteProfile>, String> {
    let file: ProfilesFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(sanitize(file.profiles))
}

pub fn load(file: &Path) -> Loaded<Vec<RemoteProfile>> {
    read_config(file, MAX_FILE_BYTES, Vec::new, parse)
}

pub fn to_json(profiles: &[RemoteProfile]) -> serde_json::Value {
    serde_json::json!({ "version": VERSION, "profiles": profiles })
}

pub fn save(file: &Path, profiles: &[RemoteProfile]) -> io::Result<()> {
    let text = serde_json::to_string_pretty(&to_json(profiles)).map_err(io::Error::other)? + "\n";
    write_atomic(file, text.as_bytes())
}

/// The `connections` part of a settings bundle: profiles without the keychain marker
/// (an import on another machine has no secrets).
pub fn for_export(profiles: &[RemoteProfile]) -> serde_json::Value {
    let stripped: Vec<RemoteProfile> = profiles
        .iter()
        .cloned()
        .map(|mut p| {
            p.secret = SecretState::None;
            p
        })
        .collect();
    to_json(&stripped)
}

/// Profiles of an imported bundle part (checked like the file, secrets reset).
pub fn from_import(value: &serde_json::Value) -> Result<Vec<RemoteProfile>, String> {
    let mut list = parse(&value.to_string())?;
    for p in &mut list {
        p.secret = SecretState::None;
    }
    Ok(list)
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A profile draft from `sftp://user@host:22/path`, `ftp://…`, `ftps://…` (implicit TLS)
/// or `ftpes://…` (explicit TLS, FileZilla's convention). A password in the address is
/// dropped – `true` in the result says so; it is never shown or stored.
pub fn parse_url(url: &str) -> Result<(RemoteProfile, bool), FsError> {
    let bad = |why: &str| FsError::new(FsErrorCode::InvalidUrl, why, None);
    let url = url.trim();
    let (scheme, rest) = url.split_once("://").ok_or_else(|| bad("missing scheme"))?;
    let kind = match scheme.to_ascii_lowercase().as_str() {
        "sftp" | "ssh" => RemoteKind::Sftp,
        "ftp" => RemoteKind::Ftp,
        "ftps" => RemoteKind::FtpsImplicit,
        "ftpes" => RemoteKind::FtpsExplicit,
        _ => return Err(bad("unsupported scheme")),
    };
    if has_control(rest) {
        return Err(bad("control characters"));
    }
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let (userinfo, hostport) = match authority.rfind('@') {
        Some(i) => (Some(&authority[..i]), &authority[i + 1..]),
        None => (None, authority),
    };
    let mut dropped_password = false;
    let user = match userinfo {
        Some(u) => {
            let (name, pass) = match u.split_once(':') {
                Some((n, p)) => (n, Some(p)),
                None => (u, None),
            };
            dropped_password = pass.is_some();
            percent_decode(name).ok_or_else(|| bad("bad user"))?
        }
        None => String::new(),
    };
    let (host, port) = if let Some(after) = hostport.strip_prefix('[') {
        let (h, tail) = after
            .split_once(']')
            .ok_or_else(|| bad("bad IPv6 address"))?;
        let port = match tail.strip_prefix(':') {
            Some(p) => Some(p),
            None if tail.is_empty() => None,
            None => return Err(bad("bad port")),
        };
        (h.to_string(), port)
    } else {
        match hostport.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(p)),
            None => (hostport.to_string(), None),
        }
    };
    let port = match port {
        Some(p) => p
            .parse::<u16>()
            .ok()
            .filter(|p| *p > 0)
            .ok_or_else(|| bad("bad port"))?,
        None => kind.default_port(),
    };
    if !valid_host(&host) {
        return Err(bad("bad host"));
    }
    let start_path = if path.is_empty() || path == "/" {
        None
    } else {
        let p = percent_decode(path).ok_or_else(|| bad("bad path"))?;
        // checked with a stand-in id – the real one comes when the profile is saved
        RemotePath::new("x", &p).map_err(|_| bad("bad path"))?;
        Some(p)
    };
    let anonymous = kind.is_ftp() && (user.is_empty() || user.eq_ignore_ascii_case("anonymous"));
    let profile = RemoteProfile {
        name: host.clone(),
        kind,
        host,
        port,
        user: if anonymous { String::new() } else { user },
        anonymous,
        start_path,
        ..RemoteProfile::default()
    };
    Ok((profile, dropped_password))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    pub fn sample(id: &str) -> RemoteProfile {
        RemoteProfile {
            id: id.into(),
            name: "Mein Server".into(),
            host: "example.org".into(),
            user: "marc".into(),
            ..RemoteProfile::default()
        }
    }

    #[test]
    fn check_accepts_and_bounds() {
        let mut p = sample("a1");
        p.timeout_secs = 1;
        p.max_connections = 99;
        p.keepalive_secs = 5;
        p.start_path = Some("  ".into());
        let p = check(p).unwrap();
        assert_eq!(
            (
                p.timeout_secs,
                p.max_connections,
                p.keepalive_secs,
                p.start_path
            ),
            (5, 8, 15, None)
        );
    }

    #[test]
    fn check_refuses_injection_and_garbage() {
        type Change = Box<dyn Fn(&mut RemoteProfile)>;
        let cases: Vec<(&str, Change)> = vec![
            ("id", Box::new(|p| p.id = "A B".into())),
            ("name", Box::new(|p| p.name = " ".into())),
            ("name", Box::new(|p| p.name = "a\nb".into())),
            ("host", Box::new(|p| p.host = "evil.org\r\nUSER x".into())),
            ("host", Box::new(|p| p.host = "a/b".into())),
            ("host", Box::new(|p| p.host = "user@host".into())),
            ("host", Box::new(|p| p.host = "::zz".into())),
            ("host", Box::new(|p| p.host = "bücher.de".into())),
            ("port", Box::new(|p| p.port = 0)),
            ("user", Box::new(|p| p.user = "x\r\nPASS y".into())),
            ("user", Box::new(|p| p.user = String::new())),
            ("keyFile", Box::new(|p| p.auth = AuthKind::Key)),
            (
                "keyFile",
                Box::new(|p| {
                    p.auth = AuthKind::Key;
                    p.key_file = Some("relative/id_ed25519".into());
                }),
            ),
            ("startPath", Box::new(|p| p.start_path = Some("rel".into()))),
            (
                "startPath",
                Box::new(|p| p.start_path = Some("/a/../b".into())),
            ),
        ];
        for (code, change) in cases {
            let mut p = sample("a1");
            change(&mut p);
            assert_eq!(check(p.clone()).err(), Some(code), "{p:?}");
        }
        let mut ftp = sample("a1");
        ftp.kind = RemoteKind::Ftp;
        ftp.auth = AuthKind::Agent;
        assert_eq!(check(ftp).err(), Some("auth"));
    }

    #[test]
    fn anonymous_ftp_needs_no_user_and_no_secret() {
        let mut p = sample("a1");
        p.kind = RemoteKind::Ftp;
        p.user = String::new();
        p.anonymous = true;
        let p = check(p).unwrap();
        assert_eq!(p.login_user(), "anonymous");
        assert!(!p.needs_secret());
        let mut s = sample("b");
        s.anonymous = true;
        let s = check(s).unwrap();
        assert!(!s.anonymous && s.needs_secret());
    }

    #[test]
    fn ipv6_hosts() {
        let mut p = sample("a1");
        p.host = "::1".into();
        let p = check(p).unwrap();
        assert_eq!(p.address(), "[::1]:22");
        assert_eq!(sample("a").address(), "example.org:22");
    }

    #[test]
    fn pins_only_for_ftps() {
        let mut p = sample("a1");
        p.pinned_cert = Some("ab".repeat(32));
        p.accept_hostname_mismatch = true;
        let s = check(p.clone()).unwrap();
        assert_eq!((s.pinned_cert, s.accept_hostname_mismatch), (None, false));
        p.kind = RemoteKind::FtpsExplicit;
        assert!(check(p.clone()).unwrap().pinned_cert.is_some());
        p.pinned_cert = Some("xyz".into());
        let s = check(p).unwrap();
        assert_eq!((s.pinned_cert, s.accept_hostname_mismatch), (None, false));
    }

    #[test]
    fn file_roundtrip_drops_invalid_and_duplicates() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        let mut a = sample("a1");
        a.secret = SecretState::Keychain;
        save(&file, &[a.clone(), sample("b2")]).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("\"secret\": \"keychain\""));
        assert!(!text.to_lowercase().contains("password\":"));
        assert_eq!(load(&file).value, vec![a.clone(), sample("b2")]);
        std::fs::write(
            &file,
            r#"{"version":1,"profiles":[{"id":"a1","name":"A","host":"h","user":"u"},
               {"id":"a1","name":"dup","host":"h","user":"u"},
               {"id":"bad id","name":"B","host":"h","user":"u"},
               42]}"#,
        )
        .unwrap();
        let l = load(&file);
        assert_eq!(l.value.len(), 1);
        assert_eq!(l.value[0].name, "A");
        std::fs::write(&file, "{").unwrap();
        let l = load(&file);
        assert!(l.value.is_empty() && l.warning.unwrap().code == "broken");
    }

    #[test]
    fn export_strips_the_keychain_marker() {
        let mut a = sample("a1");
        a.secret = SecretState::Keychain;
        let v = for_export(&[a]);
        assert_eq!(v["profiles"][0]["secret"], "none");
        let back = from_import(&v).unwrap();
        assert_eq!(back[0].secret, SecretState::None);
    }

    #[test]
    fn new_ids_are_valid_and_unique() {
        let mut taken = HashSet::new();
        for _ in 0..200 {
            let id = new_id(&taken);
            assert!(valid_id(&id) && id.len() == 8);
            assert!(taken.insert(id));
        }
    }

    #[test]
    fn urls() {
        let (p, dropped) = parse_url("sftp://marc@example.org/home/marc").unwrap();
        assert_eq!(
            (
                p.kind,
                p.host.as_str(),
                p.port,
                p.user.as_str(),
                p.start_path.as_deref(),
                dropped
            ),
            (
                RemoteKind::Sftp,
                "example.org",
                22,
                "marc",
                Some("/home/marc"),
                false
            )
        );
        let (p, dropped) = parse_url("ftp://ftp.ftpx.com/pub/ftpx").unwrap();
        assert!(p.anonymous && p.user.is_empty() && p.port == 21 && !dropped);
        let (p, dropped) = parse_url("ftpes://m%40x:geheim@[::1]:2121/a%20b").unwrap();
        assert_eq!(
            (
                p.kind,
                p.host.as_str(),
                p.port,
                p.user.as_str(),
                p.start_path.as_deref()
            ),
            (RemoteKind::FtpsExplicit, "::1", 2121, "m@x", Some("/a b"))
        );
        assert!(dropped);
        assert!(!format!("{p:?}").contains("geheim"));
        assert_eq!(parse_url("ftps://h").unwrap().0.port, 990);
        for bad in [
            "http://x",
            "x",
            "sftp://",
            "sftp://h:0",
            "sftp://h:99999",
            "sftp://h/a/../b",
            "sftp://h/%0d%0aDELE",
            "sftp://h\r\nUSER x",
            "sftp://[::1",
        ] {
            assert!(parse_url(bad).is_err(), "{bad}");
        }
    }
}
