//! Data for the "About" dialog (design 017): product name, version, Tauri version,
//! OS family and architecture. Pure, no file system.

use serde::Serialize;

/// Keep in sync with `AppInfo` in `src/app/core/about/about.models.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    /// Version from `tauri.conf.json`, which reads `package.json` (one source of truth).
    pub version: String,
    /// Version of the Rust crate (`Cargo.toml`); equal to `version` when the release
    /// was prepared with `scripts/version.mjs`.
    pub crate_version: String,
    pub tauri_version: String,
    /// `macos`, `windows`, `linux`, …
    pub os: String,
    /// `x86_64`, `aarch64`, …
    pub arch: String,
    /// Debug build (development), not a release package.
    pub debug: bool,
}

pub fn app_info(name: &str, version: &str) -> AppInfo {
    AppInfo {
        name: name.to_owned(),
        version: version.to_owned(),
        crate_version: env!("CARGO_PKG_VERSION").to_owned(),
        tauri_version: tauri::VERSION.to_owned(),
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        debug: cfg!(debug_assertions),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_build_and_platform_data() {
        let info = app_info("Files and Folders", "1.2.3");
        assert_eq!(info.name, "Files and Folders");
        assert_eq!(info.version, "1.2.3");
        assert_eq!(info.crate_version, env!("CARGO_PKG_VERSION"));
        assert!(!info.tauri_version.is_empty());
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.arch, std::env::consts::ARCH);
    }

    #[test]
    fn serialises_camel_case() {
        let json = serde_json::to_value(app_info("x", "0.1.0")).unwrap();
        assert!(json.get("tauriVersion").is_some());
        assert!(json.get("crateVersion").is_some());
    }

    /// tauri.conf.json takes its version from package.json; Cargo.toml must match it
    /// (`node scripts/version.mjs set <v>` keeps them equal).
    #[test]
    fn crate_version_matches_package_json() {
        let pkg: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert_eq!(pkg["version"].as_str(), Some(env!("CARGO_PKG_VERSION")));
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["version"].as_str(), Some("../package.json"));
    }
}
