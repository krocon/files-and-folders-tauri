//! Where a client may look (design 071 E6): the roots of `mcp.roots` – judged by the
//! **physical** place (symbolic links resolved), so a link inside a root that leads
//! out is outside. The app's own folders (settings, connections, caches) are never
//! inside; folders that hold secrets are closed for content.

use super::McpError;
use std::path::{Component, Path, PathBuf};

/// Folders below the home folder whose files are never read (`read_text`, content search).
const SECRET_DIRS: [&str; 9] = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    ".config/gcloud",
    ".config/gh",
    ".password-store",
    "Library/Keychains",
];
/// File names that are never read, wherever they are (compared without case).
const SECRET_NAMES: [&str; 4] = [".netrc", ".npmrc", ".pypirc", ".git-credentials"];
/// Name patterns (search exclusions) that keep a content search out of secrets.
pub const SECRET_EXCLUDES: [&str; 12] = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    "gcloud",
    ".password-store",
    "Keychains",
    ".netrc",
    ".npmrc",
    ".env",
    ".env.*",
];

#[derive(Debug, Clone, Default)]
pub struct Scope {
    /// Canonical roots.
    roots: Vec<PathBuf>,
    /// Canonical folders of the app (never inside).
    denied: Vec<PathBuf>,
    /// Canonical folders that hold secrets.
    secrets: Vec<PathBuf>,
}

/// The physical place of `path`: its deepest existing ancestor with links resolved,
/// plus what does not exist (yet). `None` if nothing on the way exists.
pub fn physical(path: &Path) -> Option<PathBuf> {
    let mut rest: Vec<&std::ffi::OsStr> = Vec::new();
    let mut p = path;
    loop {
        match std::fs::canonicalize(p) {
            Ok(mut real) => {
                for name in rest.iter().rev() {
                    real.push(name);
                }
                return Some(real);
            }
            Err(_) => {
                rest.push(p.file_name()?);
                p = p.parent()?;
            }
        }
    }
}

fn out_of_scope() -> McpError {
    McpError::new(
        "out_of_scope",
        "The path is outside the folders allowed for MCP (Settings → MCP → Folders)",
    )
}

impl Scope {
    /// Roots and app folders that do not exist are dropped (nothing is inside them).
    pub fn new(roots: &[PathBuf], denied: &[PathBuf], home: Option<&Path>) -> Self {
        let canon = |ps: &[PathBuf]| -> Vec<PathBuf> {
            ps.iter()
                .filter_map(|p| std::fs::canonicalize(p).ok())
                .collect()
        };
        let secrets = home
            .and_then(|h| std::fs::canonicalize(h).ok())
            .map(|h| SECRET_DIRS.iter().map(|d| h.join(d)).collect())
            .unwrap_or_default();
        Self {
            roots: canon(roots),
            // a denied folder that does not exist yet still counts once it does
            denied: denied.iter().filter_map(|p| physical(p)).collect(),
            secrets,
        }
    }

    /// Validates a path of a tool call and checks that it lies in a root: absolute,
    /// no NUL, no `..`, no server path. Returns the validated path (as given, not
    /// the canonical one – the panels know it under this name).
    pub fn check(&self, raw: &str) -> Result<PathBuf, McpError> {
        if raw.len() > super::limits::MAX_TEXT {
            return Err(McpError::new("invalid_path", "The path is too long"));
        }
        if crate::remote::is_remote(raw.trim()) {
            return Err(out_of_scope());
        }
        let path = crate::paths::validate_job_path(raw)?;
        self.check_path(&path)?;
        Ok(path)
    }

    /// The physical check of an already validated path.
    pub fn check_path(&self, path: &Path) -> Result<(), McpError> {
        if !path.is_absolute() || path.components().any(|c| c == Component::ParentDir) {
            return Err(McpError::new("invalid_path", "The path is not valid"));
        }
        let real = physical(path).ok_or_else(out_of_scope)?;
        if !self.roots.iter().any(|r| real.starts_with(r)) {
            return Err(out_of_scope());
        }
        if self.denied.iter().any(|d| real.starts_with(d)) {
            return Err(out_of_scope());
        }
        Ok(())
    }

    pub fn allows(&self, path: &Path) -> bool {
        self.check_path(path).is_ok()
    }

    /// [`check`](Self::check) for a file whose content is read: also not in a folder
    /// of secrets and not a file known to hold credentials.
    pub fn check_content(&self, raw: &str) -> Result<PathBuf, McpError> {
        let path = self.check(raw)?;
        let real = physical(&path).ok_or_else(out_of_scope)?;
        let secret_name = real
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| {
                let n = n.to_lowercase();
                SECRET_NAMES.contains(&n.as_str()) || n == ".env" || n.starts_with(".env.")
            })
            .unwrap_or(true);
        if secret_name || self.secrets.iter().any(|s| real.starts_with(s)) {
            return Err(McpError::new(
                "content_not_allowed",
                "Files that usually hold credentials are never read over MCP",
            ));
        }
        Ok(path)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    struct Fx {
        _tmp: tempfile::TempDir,
        root: PathBuf,
        outside: PathBuf,
        app: PathBuf,
        scope: Scope,
    }

    fn fx() -> Fx {
        let tmp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(tmp.path()).unwrap();
        let root = base.join("home");
        let outside = base.join("outside");
        let app = root.join("Library/App");
        fs::create_dir_all(root.join("docs/Ünï cödé 🤖")).unwrap();
        fs::create_dir_all(root.join(".ssh")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(&app).unwrap();
        fs::write(root.join("docs/a.txt"), "a").unwrap();
        fs::write(root.join(".ssh/id_ed25519"), "key").unwrap();
        fs::write(root.join("docs/.env"), "TOKEN=1").unwrap();
        fs::write(outside.join("secret.txt"), "s").unwrap();
        fs::write(app.join("connections.json"), "{}").unwrap();
        symlink(&outside, root.join("docs/escape")).unwrap();
        symlink(outside.join("secret.txt"), root.join("docs/link.txt")).unwrap();
        symlink(root.join("docs/a.txt"), root.join("docs/inside.txt")).unwrap();
        let scope = Scope::new(
            std::slice::from_ref(&root),
            std::slice::from_ref(&app),
            Some(&root),
        );
        Fx {
            _tmp: tmp,
            root,
            outside,
            app,
            scope,
        }
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn paths_in_a_root_are_inside() {
        let f = fx();
        assert!(f.scope.check(&s(&f.root)).is_ok());
        assert!(f.scope.check(&s(&f.root.join("docs/a.txt"))).is_ok());
        assert!(f.scope.check(&s(&f.root.join("docs/Ünï cödé 🤖"))).is_ok());
        // what does not exist yet is judged by its folder
        assert!(f.scope.check(&s(&f.root.join("docs/new/file.txt"))).is_ok());
        // a link that stays inside
        assert!(f.scope.check(&s(&f.root.join("docs/inside.txt"))).is_ok());
    }

    #[test]
    fn everything_else_is_outside() {
        let f = fx();
        for p in [
            s(&f.outside),
            s(&f.outside.join("secret.txt")),
            "/".to_string(),
            "/etc/passwd".to_string(),
            s(&f.root.parent().unwrap().join("homework")),
        ] {
            assert_eq!(f.scope.check(&p).unwrap_err().code, "out_of_scope", "{p}");
        }
    }

    #[test]
    fn a_link_that_leads_out_is_outside() {
        let f = fx();
        for p in ["docs/escape", "docs/escape/secret.txt", "docs/link.txt"] {
            assert_eq!(
                f.scope.check(&s(&f.root.join(p))).unwrap_err().code,
                "out_of_scope",
                "{p}"
            );
        }
    }

    #[test]
    fn invalid_paths_are_refused_like_by_the_commands() {
        let f = fx();
        let dotdot = format!("{}/docs/../../outside", s(&f.root));
        assert_eq!(f.scope.check(&dotdot).unwrap_err().code, "invalid_path");
        assert_eq!(
            f.scope.check("docs/a.txt").unwrap_err().code,
            "invalid_path"
        );
        assert_eq!(f.scope.check("").unwrap_err().code, "invalid_path");
        assert_eq!(f.scope.check("/a\0b").unwrap_err().code, "invalid_path");
        assert_eq!(
            f.scope.check("remote://p1/home").unwrap_err().code,
            "out_of_scope"
        );
        let long = format!("/{}", "x".repeat(5000));
        assert_eq!(f.scope.check(&long).unwrap_err().code, "invalid_path");
    }

    #[test]
    fn the_folders_of_the_app_are_never_inside() {
        let f = fx();
        assert_eq!(f.scope.check(&s(&f.app)).unwrap_err().code, "out_of_scope");
        assert_eq!(
            f.scope
                .check(&s(&f.app.join("connections.json")))
                .unwrap_err()
                .code,
            "out_of_scope"
        );
    }

    #[test]
    fn secrets_are_closed_for_content_only() {
        let f = fx();
        let key = s(&f.root.join(".ssh/id_ed25519"));
        assert!(f.scope.check(&key).is_ok(), "it may be listed");
        assert_eq!(
            f.scope.check_content(&key).unwrap_err().code,
            "content_not_allowed"
        );
        assert_eq!(
            f.scope
                .check_content(&s(&f.root.join("docs/.env")))
                .unwrap_err()
                .code,
            "content_not_allowed"
        );
        assert!(
            f.scope
                .check_content(&s(&f.root.join("docs/a.txt")))
                .is_ok()
        );
    }

    #[test]
    fn without_roots_nothing_is_inside() {
        let f = fx();
        let none = Scope::new(&[], &[], None);
        assert_eq!(none.check(&s(&f.root)).unwrap_err().code, "out_of_scope");
        // a root that does not exist is no root
        let gone = Scope::new(&[f.root.join("nope")], &[], None);
        assert!(gone.check(&s(&f.root.join("nope/x"))).is_err());
    }
}
