//! What the user allowed (design 071): the `mcp.*` values of `settings.json`, read by
//! Rust itself – never taken from a parameter of the frontend – and the place of the
//! socket, computed without Tauri (the bridge process has none).

use super::McpError;
use crate::settings;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

/// The bundle identifier (`tauri.conf.json`, a test keeps them equal).
pub const APP_ID: &str = "io.github.krocon.filesandfolders";
pub const SOCKET_DIR: &str = "mcp";
pub const SOCKET_NAME: &str = "fnf.sock";
/// Overrides the socket path: always for the bridge, for the app in debug builds only.
pub const SOCKET_ENV: &str = "FNF_MCP_SOCKET";
/// `sun_path` holds 104 bytes on macOS, 108 on Linux.
pub const MAX_SOCKET_PATH: usize = 100;
pub const MAX_ROOTS: usize = 16;
pub const MAX_CLIENTS: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct McpConfig {
    pub enabled: bool,
    pub allow_content: bool,
    /// Validated, absolute; empty settings = the home folder.
    pub roots: Vec<PathBuf>,
    /// The user named the roots (`mcp.roots` is not empty) – a private place among them
    /// is open for contents (review #1).
    pub explicit_roots: bool,
    /// Client names that are paired for good.
    pub clients: Vec<String>,
}

fn value(stored: &Map<String, Value>, key: &str) -> Value {
    stored.get(key).cloned().unwrap_or_else(|| {
        settings::SCHEMA
            .get(key)
            .map(|s| s.default_value())
            .unwrap_or(Value::Null)
    })
}

fn strings(v: &Value, max: usize) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .take(max)
                .collect()
        })
        .unwrap_or_default()
}

/// The MCP settings from the stored values (defaults from the schema: everything off).
pub fn from_settings(stored: &Map<String, Value>, home: Option<&Path>) -> McpConfig {
    let mut roots: Vec<PathBuf> = strings(&value(stored, "mcp.roots"), MAX_ROOTS)
        .iter()
        .filter_map(|raw| {
            if raw.starts_with('~') {
                let expanded = crate::paths::expand_tilde(raw, home?).ok()?;
                crate::paths::validate_job_path(&expanded.to_string_lossy()).ok()
            } else {
                crate::paths::validate_job_path(raw).ok()
            }
        })
        .collect();
    let explicit_roots = !roots.is_empty();
    if roots.is_empty()
        && let Some(h) = home
    {
        roots.push(h.to_path_buf());
    }
    McpConfig {
        // anything but a literal `true` keeps the interface off
        enabled: value(stored, "mcp.enabled").as_bool() == Some(true),
        allow_content: value(stored, "mcp.allowContent").as_bool() == Some(true),
        roots,
        explicit_roots,
        clients: strings(&value(stored, "mcp.clients"), MAX_CLIENTS)
            .iter()
            .map(|n| super::pairing::clean_name(n))
            .collect(),
    }
}

/// Reads `settings.json` in `config_dir` (blocking). A broken file = everything off.
pub fn read(config_dir: &Path, home: Option<&Path>) -> McpConfig {
    let loaded = settings::load(&config_dir.join(settings::FILE_NAME));
    from_settings(&loaded.settings, home)
}

/// The app's data folder as Tauri names it (`dirs::data_dir()/<identifier>`).
pub fn data_dir_from(
    home: Option<&Path>,
    xdg_data_home: Option<&Path>,
    macos: bool,
) -> Option<PathBuf> {
    let base = if macos {
        home?.join("Library").join("Application Support")
    } else {
        match xdg_data_home.filter(|p| p.is_absolute()) {
            Some(x) => x.to_path_buf(),
            None => home?.join(".local").join("share"),
        }
    };
    Some(base.join(APP_ID))
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn default_socket_path() -> Result<PathBuf, McpError> {
    let dir = data_dir_from(
        env_path("HOME").as_deref(),
        env_path("XDG_DATA_HOME").as_deref(),
        cfg!(target_os = "macos"),
    )
    .ok_or_else(|| McpError::new("not_available", "The home folder is unknown"))?;
    Ok(dir.join(SOCKET_DIR).join(SOCKET_NAME))
}

fn checked(path: PathBuf) -> Result<PathBuf, McpError> {
    if !path.is_absolute() {
        return Err(McpError::new(
            "not_available",
            "The socket path is not absolute",
        ));
    }
    if path.as_os_str().len() > MAX_SOCKET_PATH {
        return Err(McpError::new(
            "socket_path_too_long",
            "The path of the MCP socket is too long for this system",
        ));
    }
    Ok(path)
}

/// Where the running app listens. `FNF_MCP_SOCKET` moves it in debug builds only –
/// an installed app is never redirected by its environment.
pub fn socket_path_for_app() -> Result<PathBuf, McpError> {
    if cfg!(debug_assertions)
        && let Some(p) = env_path(SOCKET_ENV)
    {
        return checked(p);
    }
    checked(default_socket_path()?)
}

/// Where the bridge (`--mcp`) looks for the app.
pub fn socket_path_for_bridge() -> Result<PathBuf, McpError> {
    match env_path(SOCKET_ENV) {
        Some(p) => checked(p),
        None => checked(default_socket_path()?),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn everything_is_off_by_default() {
        let home = PathBuf::from(if cfg!(windows) {
            "C:\\Users\\u"
        } else {
            "/home/u"
        });
        let c = from_settings(&Map::new(), Some(&home));
        assert!(!c.enabled);
        assert!(!c.allow_content);
        assert_eq!(c.roots, vec![home]);
        assert!(c.clients.is_empty());
    }

    #[test]
    fn only_a_literal_true_switches_it_on() {
        for v in [json!("true"), json!(1), json!(null), json!({"a": 1})] {
            let c = from_settings(&map(json!({ "mcp.enabled": v })), None);
            assert!(!c.enabled);
        }
        assert!(from_settings(&map(json!({ "mcp.enabled": true })), None).enabled);
    }

    #[cfg(unix)]
    #[test]
    fn roots_are_validated_and_bounded() {
        let home = PathBuf::from("/home/u");
        let mut list = vec![
            json!("/data/x"),
            json!("relative"),
            json!("/a/../b"),
            json!(7),
            json!("~/Documents"),
            json!("  "),
        ];
        for i in 0..40 {
            list.push(json!(format!("/r{i}")));
        }
        let c = from_settings(&map(json!({ "mcp.roots": list })), Some(&home));
        assert!(c.roots.len() <= MAX_ROOTS);
        assert_eq!(c.roots[0], PathBuf::from("/data/x"));
        assert_eq!(c.roots[1], PathBuf::from("/home/u/Documents"));
        assert!(
            !c.roots
                .iter()
                .any(|r| r.ends_with("relative") || r.ends_with("b"))
        );
    }

    #[test]
    fn client_names_are_cleaned() {
        let c = from_settings(
            &map(json!({ "mcp.clients": ["  Claude Code ", "a\u{0}b", 5] })),
            None,
        );
        assert_eq!(c.clients, vec!["Claude Code".to_string(), "ab".to_string()]);
    }

    #[test]
    fn the_identifier_is_the_one_of_the_bundle() {
        let conf: Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], APP_ID);
    }

    // the socket is a Unix socket (no Windows transport yet) and these paths are Unix paths
    #[cfg(unix)]
    #[test]
    fn the_data_folder_follows_the_platform() {
        let home = Path::new("/Users/u");
        assert_eq!(
            data_dir_from(Some(home), None, true).unwrap(),
            Path::new("/Users/u/Library/Application Support").join(APP_ID)
        );
        assert_eq!(
            data_dir_from(Some(Path::new("/home/u")), None, false).unwrap(),
            Path::new("/home/u/.local/share").join(APP_ID)
        );
        assert_eq!(
            data_dir_from(
                Some(Path::new("/home/u")),
                Some(Path::new("/x/data")),
                false
            )
            .unwrap(),
            Path::new("/x/data").join(APP_ID)
        );
        // a relative XDG_DATA_HOME is ignored (as the spec says)
        assert_eq!(
            data_dir_from(Some(Path::new("/home/u")), Some(Path::new("rel")), false).unwrap(),
            Path::new("/home/u/.local/share").join(APP_ID)
        );
        assert!(data_dir_from(None, None, true).is_none());
    }

    // the socket is a Unix socket (no Windows transport yet) and these paths are Unix paths
    #[cfg(unix)]
    #[test]
    fn a_socket_path_must_fit() {
        assert!(checked(PathBuf::from("relative.sock")).is_err());
        let long = PathBuf::from(format!("/{}", "x".repeat(200)));
        assert_eq!(checked(long).unwrap_err().code, "socket_path_too_long");
    }
}
