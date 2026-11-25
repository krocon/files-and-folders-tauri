//! Where a client may look (design 071 E6): the roots of `mcp.roots` – judged by the
//! **physical** place (symbolic links resolved), so a link inside a root that leads
//! out is outside. The app's own folders (settings, connections, caches) are never
//! inside; folders that hold secrets are closed for content.

use super::McpError;
use std::path::{Component, Path, PathBuf};

/// Folders below the home folder whose files are never read, hashed or searched – not
/// even when the user names them as a root (`read_text`, `checksum`, content search,
/// content comparison, duplicates).
const SECRET_DIRS: [&str; 10] = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    ".config/gcloud",
    ".config/gh",
    ".password-store",
    "Library/Keychains",
    "Library/Cookies",
];
/// File names that are never read, wherever they are (compared without case).
const SECRET_NAMES: [&str; 4] = [".netrc", ".npmrc", ".pypirc", ".git-credentials"];
/// The part of the home folder that is private by default (review #1): every entry
/// whose name starts with a dot, and `Library` (settings of other programs, histories,
/// tokens). Closed for contents unless the user named a root at or below such a place.
const PRIVATE_DIR: &str = "Library";

#[derive(Debug, Clone, Default)]
pub struct Scope {
    /// Canonical roots.
    roots: Vec<PathBuf>,
    /// Canonical folders of the app (never inside).
    denied: Vec<PathBuf>,
    /// The canonical home folder.
    home: Option<PathBuf>,
    /// Roots the user named that lie in the private part of the home folder.
    opened: Vec<PathBuf>,
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
    /// `explicit`: the user named the roots (`mcp.roots` is not empty).
    pub fn new(roots: &[PathBuf], denied: &[PathBuf], home: Option<&Path>, explicit: bool) -> Self {
        let roots: Vec<PathBuf> = roots
            .iter()
            .filter_map(|p| std::fs::canonicalize(p).ok())
            .collect();
        let home = home.and_then(|h| std::fs::canonicalize(h).ok());
        let mut scope = Self {
            roots,
            // a denied folder that does not exist yet still counts once it does
            denied: denied.iter().filter_map(|p| physical(p)).collect(),
            home,
            opened: Vec::new(),
        };
        if explicit {
            scope.opened = scope
                .roots
                .iter()
                .filter(|r| scope.is_private(r))
                .cloned()
                .collect();
        }
        scope
    }

    /// A place that holds credentials – closed for contents, always.
    fn is_secret(&self, real: &Path) -> bool {
        let by_name = real
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| {
                let n = n.to_lowercase();
                SECRET_NAMES.contains(&n.as_str()) || n == ".env" || n.starts_with(".env.")
            })
            // a name we cannot read is not judged safe
            .unwrap_or(true);
        by_name
            || self
                .home
                .as_ref()
                .is_some_and(|h| SECRET_DIRS.iter().any(|d| real.starts_with(h.join(d))))
    }

    /// In the private part of the home folder: below a dot entry of it, or below `Library`.
    fn is_private(&self, real: &Path) -> bool {
        let Some(rest) = self.home.as_ref().and_then(|h| real.strip_prefix(h).ok()) else {
            return false;
        };
        match rest.components().next() {
            Some(Component::Normal(first)) => first
                .to_str()
                .is_none_or(|n| n.starts_with('.') || n == PRIVATE_DIR),
            _ => false,
        }
    }

    /// The **one** rule for contents (review #1): may the content of what is at `path`
    /// be read, hashed, searched or compared? Not in a place of credentials; not in the
    /// private part of the home folder unless the user named a root there.
    pub fn content_allowed(&self, path: &Path) -> bool {
        let Some(real) = physical(path) else {
            return false;
        };
        if self.is_secret(&real) {
            return false;
        }
        !self.is_private(&real) || self.opened.iter().any(|r| real.starts_with(r))
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

    /// [`check`](Self::check) for something whose content is read (a file, or a folder a
    /// content search starts in): also [`content_allowed`](Self::content_allowed).
    pub fn check_content(&self, raw: &str) -> Result<PathBuf, McpError> {
        let path = self.check(raw)?;
        if !self.content_allowed(&path) {
            return Err(McpError::new(
                "content_not_allowed",
                "Private files of the home folder and files that hold credentials are not read over MCP",
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
            false,
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
        let none = Scope::new(&[], &[], None, false);
        assert_eq!(none.check(&s(&f.root)).unwrap_err().code, "out_of_scope");
        // a root that does not exist is no root
        let gone = Scope::new(&[f.root.join("nope")], &[], None, false);
        assert!(gone.check(&s(&f.root.join("nope/x"))).is_err());
    }

    /// Review #1: dot entries of the home folder and `Library` are private by default.
    #[test]
    fn the_private_part_of_home_is_closed_for_contents_unless_named_as_a_root() {
        let f = fx();
        for rel in [
            ".config/app",
            "Library/Application Support/X",
            ".local/share",
        ] {
            fs::create_dir_all(f.root.join(rel)).unwrap();
        }
        fs::write(f.root.join(".zsh_history"), "x").unwrap();
        fs::write(f.root.join(".config/app/a.txt"), "x").unwrap();
        fs::write(f.root.join("docs/.hidden.txt"), "x").unwrap();
        let closed = [
            ".zsh_history",
            ".config",
            ".config/app/a.txt",
            "Library",
            "Library/Application Support/X",
            ".ssh",
        ];
        for rel in closed {
            assert!(!f.scope.content_allowed(&f.root.join(rel)), "{rel}");
            assert!(
                f.scope.check(&s(&f.root.join(rel))).is_ok(),
                "{rel} may be listed"
            );
        }
        // a dot file deeper down is an ordinary file, and so is the home folder itself
        assert!(f.scope.content_allowed(&f.root.join("docs/.hidden.txt")));
        assert!(f.scope.content_allowed(&f.root));
        // named as a root: open – credentials stay closed, also as a root
        let named = Scope::new(
            &[f.root.clone(), f.root.join(".config"), f.root.join(".ssh")],
            &[],
            Some(&f.root),
            true,
        );
        assert!(named.content_allowed(&f.root.join(".config/app/a.txt")));
        assert!(!named.content_allowed(&f.root.join(".ssh/id_ed25519")));
        assert!(!named.content_allowed(&f.root.join(".zsh_history")));
        // naming the home folder itself opens nothing private
        let home_only = Scope::new(std::slice::from_ref(&f.root), &[], Some(&f.root), true);
        assert!(!home_only.content_allowed(&f.root.join(".config/app/a.txt")));
        // a link in an ordinary folder that leads into a private place
        symlink(f.root.join(".zsh_history"), f.root.join("docs/history.txt")).unwrap();
        assert!(!f.scope.content_allowed(&f.root.join("docs/history.txt")));
    }
}
