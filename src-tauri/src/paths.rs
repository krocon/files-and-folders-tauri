//! Platform-aware path helpers. All logic uses `std::path` – never string
//! manipulation with hard-coded separators.

use crate::error::{FsError, FsErrorCode};
use crate::model::PathSegment;
use std::path::{Component, Path, PathBuf};

/// Validates a path coming from the frontend.
///
/// Rules: must not be empty, must not contain NUL bytes and must be absolute.
/// `.`/`..` components are resolved lexically (without touching the file
/// system, so symlinks are not resolved and Windows paths do not get the
/// `\\?\` prefix that `canonicalize` would add).
pub fn validate_input_path(raw: &str) -> Result<PathBuf, FsError> {
    if raw.trim().is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Path is empty",
            None,
        ));
    }
    if raw.contains('\0') {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Path contains a NUL byte",
            None,
        ));
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "Path must be absolute",
            Some(&path),
        ));
    }
    Ok(normalize_lexically(&path))
}

/// Expands a leading `~` (`~`, `~/x`, `~\\x`) with `home`. `~user` is not supported.
pub fn expand_tilde(raw: &str, home: &Path) -> Result<PathBuf, FsError> {
    let trimmed = raw.trim();
    let Some(rest) = trimmed.strip_prefix('~') else {
        return Ok(PathBuf::from(trimmed));
    };
    if rest.is_empty() {
        return Ok(home.to_path_buf());
    }
    let rest = rest
        .strip_prefix('/')
        .or_else(|| rest.strip_prefix(std::path::MAIN_SEPARATOR))
        .ok_or_else(|| {
            FsError::new(
                FsErrorCode::InvalidPath,
                "Only ~ for your own home folder is supported",
                None,
            )
        })?;
    Ok(home.join(rest))
}

/// Resolves `.` and `..` lexically. `..` never climbs above the root.
pub fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                // `pop` is a no-op at the root, which is what we want.
                let at_root = out.parent().is_none();
                if !at_root {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn parent_of(path: &Path) -> Option<PathBuf> {
    path.parent().map(Path::to_path_buf)
}

/// Builds breadcrumb segments from the root down to `path` itself.
pub fn segments_of(path: &Path) -> Vec<PathSegment> {
    let mut segs: Vec<PathSegment> = path
        .ancestors()
        .map(|p| PathSegment {
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.to_string_lossy().into_owned()),
            path: p.to_string_lossy().into_owned(),
        })
        .collect();
    segs.reverse();
    segs
}

/// Checks a single file or folder name typed by the user (design 006 E9).
/// The Windows rules apply on Windows only; elsewhere the file system decides.
pub fn validate_name(name: &str) -> Result<(), FsError> {
    validate_name_for(name, cfg!(windows))
}

fn invalid(message: &str) -> FsError {
    FsError::new(FsErrorCode::InvalidName, message, None)
}

/// Device names Windows reserves in every folder (also with an extension).
/// Includes the superscript digits and the console names (review 016 #8).
pub(crate) const WINDOWS_RESERVED: [&str; 30] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "COM¹", "COM²", "COM³", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
    "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³", "CONIN$", "CONOUT$",
];

pub fn validate_name_for(name: &str, windows: bool) -> Result<(), FsError> {
    if name.trim().is_empty() {
        return Err(invalid("The name is empty"));
    }
    if name == "." || name == ".." {
        return Err(invalid("\".\" and \"..\" are not allowed as names"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(invalid("A name must not contain / or \\"));
    }
    if name.contains('\0') {
        return Err(invalid("The name contains a NUL character"));
    }
    if windows {
        if name.encode_utf16().count() > 255 {
            return Err(invalid("The name is too long (max. 255 characters)"));
        }
        if let Some(c) = name
            .chars()
            .find(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || (*c as u32) < 32)
        {
            let shown = if (c as u32) < 32 {
                "a control character".to_string()
            } else {
                format!("\"{c}\"")
            };
            return Err(invalid(&format!("Windows does not allow {shown} in names")));
        }
        if name.ends_with(' ') || name.ends_with('.') {
            return Err(invalid(
                "Windows does not allow a space or dot at the end of a name",
            ));
        }
        let stem = name.split('.').next().unwrap_or("").trim_end();
        if WINDOWS_RESERVED
            .iter()
            .any(|r| r.eq_ignore_ascii_case(stem))
        {
            return Err(invalid(&format!(
                "\"{stem}\" is a reserved name on Windows"
            )));
        }
    } else if name.len() > 255 {
        return Err(invalid("The name is too long (max. 255 bytes)"));
    }
    Ok(())
}

/// Why a path must not be moved, renamed or deleted without a second confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Danger {
    /// File-system root, drive or mounted volume.
    Root,
    /// The user's home folder itself.
    Home,
    /// An operating-system folder (or something inside one).
    System,
}

/// System folders whose content belongs to the OS (inside counts too).
#[cfg(unix)]
const SYSTEM_TREES: &[&str] = &[
    "/System",
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/usr/lib",
    "/usr/libexec",
    "/usr/share",
    "/etc",
    "/boot",
    "/dev",
    "/proc",
    "/sys",
    "/lib",
    "/lib32",
    "/lib64",
    "/private/etc",
    "/var/lib",
    "/usr/include",
    "/nix",
    "/snap",
    "/efi",
];
/// Folders that are dangerous themselves, but whose content is often the user's.
#[cfg(unix)]
const SYSTEM_DIRS: &[&str] = &[
    "/usr",
    "/var",
    "/Library",
    "/Applications",
    "/Users",
    "/home",
    "/private",
    "/opt",
    "/root",
    "/Volumes",
    "/mnt",
    "/media",
    "/tmp",
    "/private/var",
    "/private/tmp",
    "/srv",
    "/run",
    "/usr/local",
];
/// Windows: the folders come from the environment (the system may not be on C:).
#[cfg(windows)]
fn windows_folders(vars: &[&str], fallback: &[&str]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = vars
        .iter()
        .filter_map(|v| std::env::var_os(v))
        .map(PathBuf::from)
        .collect();
    out.extend(fallback.iter().map(PathBuf::from));
    out
}

fn system_trees() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        windows_folders(
            &[
                "SystemRoot",
                "ProgramFiles",
                "ProgramFiles(x86)",
                "ProgramData",
            ],
            &[
                "C:\\Windows",
                "C:\\Program Files",
                "C:\\Program Files (x86)",
                "C:\\ProgramData",
            ],
        )
    }
    #[cfg(unix)]
    {
        SYSTEM_TREES.iter().map(PathBuf::from).collect()
    }
}

fn system_dirs() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let users = std::env::var_os("PUBLIC")
            .map(PathBuf::from)
            .and_then(|p| p.parent().map(Path::to_path_buf));
        let mut v: Vec<PathBuf> = users.into_iter().collect();
        v.push(PathBuf::from("C:\\Users"));
        v
    }
    #[cfg(unix)]
    {
        SYSTEM_DIRS.iter().map(PathBuf::from).collect()
    }
}

/// `\\?\C:\x` → `C:\x` (the verbatim prefix must not hide a system folder).
fn without_verbatim(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// Case-insensitive on macOS and Windows (their default file systems are).
fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

fn inside(path: &Path, tree: &Path) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        let p = path.to_string_lossy().to_lowercase();
        Path::new(&p).starts_with(tree.to_string_lossy().to_lowercase())
    } else {
        path.starts_with(tree)
    }
}

/// Classifies a (validated, absolute) path – design 006 E7.
pub fn danger_of(path: &Path, home: Option<&Path>) -> Option<Danger> {
    let path = without_verbatim(&normalize_lexically(path));
    if path.parent().is_none() {
        return Some(Danger::Root);
    }
    // mounted volumes: /Volumes/X, /mnt/X, /media/X, /media/<user>/X
    if let Some(parent) = path.parent() {
        let mounts = ["/Volumes", "/mnt", "/media", "/run/media"];
        let grand = parent.parent();
        if mounts.iter().any(|m| same_path(parent, Path::new(m)))
            || grand.is_some_and(|g| {
                ["/media", "/run/media"]
                    .iter()
                    .any(|m| same_path(g, Path::new(m)))
            })
        {
            return Some(Danger::Root);
        }
    }
    if let Some(h) = home {
        // the home folder and every folder above it (e.g. /data when home is /data/marc)
        if inside(&normalize_lexically(h), &path) {
            return Some(Danger::Home);
        }
    }
    if system_trees().iter().any(|t| inside(&path, t))
        || system_dirs().iter().any(|d| same_path(&path, d))
    {
        return Some(Danger::System);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(parts: &[&str]) -> PathBuf {
        // Build an absolute path on the current platform without assuming '/'.
        let mut p = std::env::temp_dir()
            .ancestors()
            .last()
            .unwrap()
            .to_path_buf();
        for part in parts {
            p.push(part);
        }
        p
    }

    #[test]
    fn rejects_empty_relative_and_nul() {
        assert_eq!(
            validate_input_path("").unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        assert_eq!(
            validate_input_path("   ").unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        assert_eq!(
            validate_input_path("relative/dir").unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        let with_nul = format!("{}\0x", abs(&["a"]).display());
        assert_eq!(
            validate_input_path(&with_nul).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
    }

    #[test]
    fn accepts_absolute_unicode_path_with_spaces() {
        let p = abs(&["Ordner mit Leerzeichen", "Ünïcödé 日本語"]);
        let v = validate_input_path(p.to_str().unwrap()).unwrap();
        assert_eq!(v, p);
    }

    #[test]
    fn normalizes_dot_components_without_escaping_root() {
        let root = abs(&[]);
        let p = abs(&["a", "b"]).join("..").join(".").join("c");
        assert_eq!(normalize_lexically(&p), abs(&["a", "c"]));
        let escape = root.join("..").join("..").join("x");
        assert_eq!(normalize_lexically(&escape), abs(&["x"]));
    }

    #[test]
    fn expands_tilde_for_the_own_home_only() {
        let home = abs(&["home", "jörg"]);
        assert_eq!(expand_tilde("~", &home).unwrap(), home);
        assert_eq!(
            expand_tilde(" ~/Mein Ordner ", &home).unwrap(),
            home.join("Mein Ordner")
        );
        assert_eq!(
            expand_tilde("~other/x", &home).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        let plain = abs(&["x"]);
        assert_eq!(expand_tilde(plain.to_str().unwrap(), &home).unwrap(), plain);
    }

    #[test]
    fn parent_and_segments() {
        let p = abs(&["a", "b c", "ä"]);
        assert_eq!(parent_of(&p), Some(abs(&["a", "b c"])));
        assert_eq!(parent_of(&abs(&[])), None);

        let segs = segments_of(&p);
        assert_eq!(segs.len(), 4);
        assert_eq!(segs[0].path, abs(&[]).to_string_lossy());
        assert_eq!(segs[2].name, "b c");
        assert_eq!(segs[3].name, "ä");
        assert_eq!(segs[3].path, p.to_string_lossy());
    }

    #[test]
    fn names_valid_everywhere() {
        for ok in ["a", "Ünïcödé 日本語.txt", ".hidden", "a b", "x..y"] {
            assert!(validate_name_for(ok, true).is_ok(), "{ok}");
            assert!(validate_name_for(ok, false).is_ok(), "{ok}");
        }
        for bad in ["", "  ", ".", "..", "a/b", "a\\b", "a\0b"] {
            assert_eq!(
                validate_name_for(bad, false).unwrap_err().code,
                FsErrorCode::InvalidName,
                "{bad:?}"
            );
        }
        assert!(validate_name_for(&"x".repeat(255), false).is_ok());
        assert!(validate_name_for(&"x".repeat(256), false).is_err());
        // 128 × "ä" = 256 bytes but 128 UTF-16 units
        assert!(validate_name_for(&"ä".repeat(128), false).is_err());
        assert!(validate_name_for(&"ä".repeat(128), true).is_ok());
    }

    #[test]
    fn verbatim_prefix_is_ignored() {
        assert_eq!(
            without_verbatim(Path::new(r"\\?\C:\Windows")),
            PathBuf::from(r"C:\Windows")
        );
        assert_eq!(
            without_verbatim(Path::new(r"\\?\UNC\srv\x")),
            PathBuf::from(r"\\?\UNC\srv\x")
        );
    }

    #[test]
    fn windows_name_rules() {
        for bad in [
            "a:b",
            "a?",
            "a*",
            "a<b",
            "a>b",
            "a|b",
            "a\"b",
            "a\tb",
            "end.",
            "end ",
            "CON",
            "con.txt",
            "Lpt9.tar.gz",
            "AUX ",
            "nul",
            "COM¹",
            "lpt³.txt",
            "CONIN$",
            "conout$.log",
        ] {
            assert!(validate_name_for(bad, true).is_err(), "{bad:?}");
        }
        for ok in ["CONsole", "COM10", "a:b", "end."] {
            assert!(validate_name_for(ok, false).is_ok(), "{ok:?}");
        }
        assert!(validate_name_for("COM10", true).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn dangerous_paths() {
        let home = Path::new("/home/jörg");
        assert_eq!(danger_of(Path::new("/"), Some(home)), Some(Danger::Root));
        assert_eq!(
            danger_of(Path::new("/Volumes/USB"), Some(home)),
            Some(Danger::Root)
        );
        assert_eq!(
            danger_of(Path::new("/media/jörg/USB"), Some(home)),
            Some(Danger::Root)
        );
        assert_eq!(
            danger_of(Path::new("/home/jörg"), Some(home)),
            Some(Danger::Home)
        );
        assert_eq!(
            danger_of(Path::new("/home/jörg/x/.."), Some(home)),
            Some(Danger::Home)
        );
        assert_eq!(
            danger_of(Path::new("/usr/bin/ls"), Some(home)),
            Some(Danger::System)
        );
        assert_eq!(
            danger_of(Path::new("/etc"), Some(home)),
            Some(Danger::System)
        );
        assert_eq!(
            danger_of(Path::new("/usr"), Some(home)),
            Some(Danger::System)
        );
        assert_eq!(
            danger_of(Path::new("/tmp"), Some(home)),
            Some(Danger::System)
        );
        assert_eq!(danger_of(Path::new("/usr/local/x"), Some(home)), None);
        assert_eq!(danger_of(Path::new("/tmp/x"), Some(home)), None);
        assert_eq!(danger_of(Path::new("/var/folders/x"), Some(home)), None);
        assert_eq!(
            danger_of(Path::new("/home/jörg/Dokumente"), Some(home)),
            None
        );
        assert_eq!(danger_of(Path::new("/Volumes/USB/a"), Some(home)), None);
    }
}
