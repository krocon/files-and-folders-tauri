//! Clean folders (design 008 E3): finds empty folders (and files matching a
//! name pattern) below start folders. Pure std, writes nothing.
//!
//! Rules: symbolic links are never followed (a link – even to an empty folder –
//! is content), other file systems are not entered, unreadable folders count as
//! not empty, and nothing above a start folder is ever looked at. The start
//! folder itself is listed only with `include_roots`.

use crate::error::{FsError, FsErrorCode};
use crate::paths::normalize_lexically;
use crate::platform::file_id;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Entries the scan looks at before it stops (`truncated`).
pub const MAX_VISITED: u64 = 500_000;
/// Hits the scan reports at most (`truncated`).
pub const MAX_ITEMS: usize = 100_000;
/// Unreadable folders reported (further ones are counted in `unreadable_more`).
pub const MAX_UNREADABLE: usize = 1000;
/// Names in the junk list / patterns, and their length.
pub const MAX_NAMES: usize = 100;
pub const MAX_NAME_LEN: usize = 255;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanOptions {
    /// Delete folders without entries (default on).
    #[serde(default = "yes")]
    pub empty_dirs: bool,
    /// The start folders themselves may go, too (default off).
    #[serde(default)]
    pub include_roots: bool,
    /// File names that do not count as content (`.DS_Store` …); empty = off.
    #[serde(default)]
    pub junk: Vec<String>,
    /// Name patterns (`*`, `?`) of files to delete; empty = off.
    #[serde(default)]
    pub patterns: Vec<String>,
}

impl Default for CleanOptions {
    fn default() -> Self {
        CleanOptions {
            empty_dirs: true,
            include_roots: false,
            junk: Vec::new(),
            patterns: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanKind {
    Dir,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanItem {
    pub path: String,
    pub kind: CleanKind,
    /// Junk files inside the folder (they go with it).
    #[serde(default)]
    pub junk: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanScan {
    /// In delete order: children before their parents.
    pub items: Vec<CleanItem>,
    pub unreadable: Vec<FsError>,
    pub unreadable_more: u64,
    /// The scan stopped at a limit; started folders count as not empty.
    pub truncated: bool,
    pub visited: u64,
}

/// Compiled options: lower-case junk names and patterns.
pub struct Matcher {
    junk: Vec<String>,
    patterns: Vec<Vec<char>>,
}

impl Matcher {
    pub fn new(o: &CleanOptions) -> Result<Matcher, FsError> {
        let bad = |m: &str| Err(FsError::new(FsErrorCode::InvalidName, m.to_string(), None));
        if o.junk.len() > MAX_NAMES || o.patterns.len() > MAX_NAMES {
            return bad("Too many names or patterns");
        }
        let mut junk = Vec::new();
        for j in &o.junk {
            let j = j.trim();
            if j.is_empty() {
                continue;
            }
            if j.len() > MAX_NAME_LEN || j.contains(['/', '\\', '\0']) {
                return bad("A junk file name is invalid");
            }
            junk.push(j.to_lowercase());
        }
        let mut patterns = Vec::new();
        for p in &o.patterns {
            let p = p.trim();
            // `**/*.bak` (mr) = `*.bak`: hits are found in every depth anyway
            let p = p.strip_prefix("**/").unwrap_or(p);
            if p.is_empty() {
                continue;
            }
            if p.len() > MAX_NAME_LEN || p.contains(['/', '\\', '\0']) {
                return bad("A file pattern must be a name pattern such as *.bak");
            }
            if p.chars().all(|c| c == '*') {
                return bad("The file pattern would match every file");
            }
            patterns.push(p.to_lowercase().chars().collect());
        }
        Ok(Matcher { junk, patterns })
    }

    pub fn is_junk(&self, name: &str) -> bool {
        !self.junk.is_empty() && self.junk.contains(&name.to_lowercase())
    }

    pub fn matches(&self, name: &str) -> bool {
        if self.patterns.is_empty() {
            return false;
        }
        let name: Vec<char> = name.to_lowercase().chars().collect();
        self.patterns.iter().any(|p| glob_match(p, &name))
    }
}

/// `*` = any sequence, `?` = one character (no character classes).
fn glob_match(p: &[char], s: &[char]) -> bool {
    let (mut pi, mut si) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi, si));
            pi += 1;
        } else if let Some((sp, ss)) = star {
            pi = sp + 1;
            si = ss + 1;
            star = Some((sp, ss + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|c| *c == '*')
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Checks the start folders: absolute folders that do not lie inside each other.
pub fn check_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, FsError> {
    if roots.is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "No start folder",
            None,
        ));
    }
    let roots: Vec<PathBuf> = roots.iter().map(|r| normalize_lexically(r)).collect();
    for (i, a) in roots.iter().enumerate() {
        for (j, b) in roots.iter().enumerate() {
            if i != j && b.starts_with(a) {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    "The start folders lie inside each other",
                    Some(b),
                ));
            }
        }
    }
    Ok(roots)
}

struct Ctx<'a> {
    m: &'a Matcher,
    o: &'a CleanOptions,
    scan: CleanScan,
    seen: HashSet<PathBuf>,
}

impl Ctx<'_> {
    fn unreadable(&mut self, path: &Path, e: &std::io::Error) {
        if self.scan.unreadable.len() < MAX_UNREADABLE {
            self.scan.unreadable.push(FsError::from_io(e, path));
        } else {
            self.scan.unreadable_more += 1;
        }
    }

    fn push(&mut self, path: &Path, kind: CleanKind, junk: u32) {
        if self.scan.items.len() >= MAX_ITEMS {
            self.scan.truncated = true;
            return;
        }
        if self.seen.insert(path.to_path_buf()) {
            self.scan.items.push(CleanItem {
                path: path_string(path),
                kind,
                junk,
            });
        }
    }

    /// Scans `dir` (a real folder on device `dev`); true = it can go.
    fn dir(&mut self, dir: &Path, dev: Option<u64>, is_root: bool) -> bool {
        let rd = match fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(e) => {
                self.unreadable(dir, &e);
                return false;
            }
        };
        let mut removable = true;
        let mut junk = 0u32;
        for entry in rd {
            self.scan.visited += 1;
            if self.scan.visited > MAX_VISITED || self.scan.truncated {
                self.scan.truncated = true;
                return false;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    self.unreadable(dir, &e);
                    removable = false;
                    continue;
                }
            };
            let name = entry.file_name();
            // a name that is not UTF-8 could not be addressed again: content
            let Some(name) = name.to_str() else {
                removable = false;
                continue;
            };
            let Ok(ft) = entry.file_type() else {
                removable = false;
                continue;
            };
            let path = entry.path();
            if ft.is_symlink() {
                removable = false; // never followed, never "empty"
            } else if ft.is_dir() {
                let same_fs = match fs::symlink_metadata(&path) {
                    Ok(m) if m.is_dir() => dev.is_none() || file_id(&m).map(|f| f.0) == dev,
                    _ => false,
                };
                if !same_fs || !self.dir(&path, dev, false) {
                    removable = false;
                }
                if self.scan.truncated {
                    return false;
                }
            } else if ft.is_file() {
                if self.m.matches(name) {
                    self.push(&path, CleanKind::File, 0);
                } else if self.m.is_junk(name) {
                    junk += 1;
                } else {
                    removable = false;
                }
            } else {
                removable = false; // fifo, socket, device
            }
        }
        if !removable || !self.o.empty_dirs {
            return false;
        }
        if !is_root || self.o.include_roots {
            self.push(dir, CleanKind::Dir, junk);
        }
        true
    }
}

/// Finds what "clean folders" would delete below `roots` (design 008 E3).
pub fn find_empty_dirs(roots: &[PathBuf], options: &CleanOptions) -> Result<CleanScan, FsError> {
    let roots = check_roots(roots)?;
    let m = Matcher::new(options)?;
    let mut ctx = Ctx {
        m: &m,
        o: options,
        scan: CleanScan::default(),
        seen: HashSet::new(),
    };
    for root in &roots {
        // the start folder itself may be reached through a link (the panel's path)
        let meta = fs::metadata(root).map_err(|e| FsError::from_io(&e, root))?;
        if !meta.is_dir() {
            return Err(FsError::new(
                FsErrorCode::NotADirectory,
                "The start folder is not a folder",
                Some(root),
            ));
        }
        let dev = file_id(&meta).map(|f| f.0);
        ctx.dir(root, dev, true);
        if ctx.scan.truncated {
            break;
        }
    }
    Ok(ctx.scan)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> CleanOptions {
        CleanOptions::default()
    }

    fn names(scan: &CleanScan, base: &Path) -> Vec<String> {
        scan.items
            .iter()
            .map(|i| {
                let p = PathBuf::from(&i.path);
                let rel = p
                    .strip_prefix(base)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .into_owned();
                match i.kind {
                    CleanKind::Dir => format!("{}/", rel),
                    CleanKind::File => rel,
                }
            })
            .collect()
    }

    #[test]
    fn glob() {
        let m = Matcher::new(&CleanOptions {
            patterns: vec!["*.bak".into(), "**/~*.tmp".into(), "a?c".into()],
            ..opts()
        })
        .unwrap();
        assert!(m.matches("x.bak"));
        assert!(m.matches("X.BAK"));
        assert!(m.matches(".bak"));
        assert!(!m.matches("x.bak.txt"));
        assert!(m.matches("~ä 1.tmp"));
        assert!(m.matches("abc"));
        assert!(!m.matches("abbc"));
        for bad in ["a/b", "*", "**"] {
            assert!(
                Matcher::new(&CleanOptions {
                    patterns: vec![bad.into()],
                    ..opts()
                })
                .is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn nested_empty_children_first_never_the_root_or_above() {
        let t = tempfile::tempdir().unwrap();
        // an empty sibling *above* the start folder must never be listed
        fs::create_dir(t.path().join("empty sibling")).unwrap();
        let root = t.path().join("start");
        fs::create_dir_all(root.join("a/b/c")).unwrap();
        fs::create_dir_all(root.join("Ünïcode 🎉/leer")).unwrap();
        fs::create_dir_all(root.join("full/x")).unwrap();
        fs::write(root.join("full/file.txt"), "x").unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&root), &opts()).unwrap();
        let mut got = names(&scan, &root);
        // children before parents
        let pos = |n: &str| got.iter().position(|g| g == n).unwrap();
        assert!(pos("a/b/c/") < pos("a/b/") && pos("a/b/") < pos("a/"));
        got.sort();
        assert_eq!(
            got,
            [
                "a/",
                "a/b/",
                "a/b/c/",
                "full/x/",
                "Ünïcode 🎉/",
                "Ünïcode 🎉/leer/"
            ]
        );
        assert!(
            !scan
                .items
                .iter()
                .any(|i| !PathBuf::from(&i.path).starts_with(&root))
        );
        // the root itself only on request – even when everything below is empty
        let empty_root = t.path().join("empty sibling");
        let scan = find_empty_dirs(std::slice::from_ref(&empty_root), &opts()).unwrap();
        assert!(scan.items.is_empty());
        let scan = find_empty_dirs(
            std::slice::from_ref(&empty_root),
            &CleanOptions {
                include_roots: true,
                ..opts()
            },
        )
        .unwrap();
        assert_eq!(scan.items.len(), 1);
        assert_eq!(scan.items[0].path, path_string(&empty_root));
    }

    #[cfg(unix)]
    #[test]
    fn links_are_content_and_never_followed() {
        let t = tempfile::tempdir().unwrap();
        let outside = t.path().join("outside");
        fs::create_dir_all(outside.join("empty inside")).unwrap();
        let root = t.path().join("start");
        fs::create_dir_all(root.join("with link")).unwrap();
        fs::create_dir_all(root.join("with dangling")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("with link/out")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link to outside")).unwrap();
        std::os::unix::fs::symlink(t.path().join("nope"), root.join("with dangling/x")).unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&root), &opts()).unwrap();
        assert!(scan.items.is_empty(), "{:?}", scan.items);
        // a link as start folder is scanned (the panel's path), its target's empty child is found
        let scan = find_empty_dirs(&[root.join("link to outside")], &opts()).unwrap();
        assert_eq!(
            names(&scan, &root.join("link to outside")),
            ["empty inside/"]
        );
    }

    #[test]
    fn junk_option_and_patterns() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().to_path_buf();
        fs::create_dir_all(root.join("mac")).unwrap();
        fs::write(root.join("mac/.DS_Store"), "x").unwrap();
        fs::create_dir_all(root.join("win")).unwrap();
        fs::write(root.join("win/thumbs.db"), "x").unwrap();
        fs::create_dir_all(root.join("bak")).unwrap();
        fs::write(root.join("bak/old.bak"), "x").unwrap();
        fs::write(root.join("keep.txt"), "x").unwrap();
        // off: junk is content
        let scan = find_empty_dirs(std::slice::from_ref(&root), &opts()).unwrap();
        assert!(scan.items.is_empty());
        let junk = vec![".DS_Store".into(), "Thumbs.db".into(), "desktop.ini".into()];
        let scan = find_empty_dirs(
            std::slice::from_ref(&root),
            &CleanOptions {
                junk: junk.clone(),
                ..opts()
            },
        )
        .unwrap();
        let mut got = names(&scan, &root);
        got.sort();
        assert_eq!(got, ["mac/", "win/"]);
        assert!(scan.items.iter().all(|i| i.junk == 1));
        // patterns: the file is listed before its folder, which is empty without it
        let scan = find_empty_dirs(
            std::slice::from_ref(&root),
            &CleanOptions {
                patterns: vec!["**/*.bak".into()],
                ..opts()
            },
        )
        .unwrap();
        assert_eq!(names(&scan, &root), ["bak/old.bak", "bak/"]);
        // patterns without empty folders
        let scan = find_empty_dirs(
            std::slice::from_ref(&root),
            &CleanOptions {
                empty_dirs: false,
                patterns: vec!["*.bak".into()],
                ..opts()
            },
        )
        .unwrap();
        assert_eq!(names(&scan, &root), ["bak/old.bak"]);
    }

    #[test]
    fn roots_are_checked() {
        let t = tempfile::tempdir().unwrap();
        fs::create_dir(t.path().join("a")).unwrap();
        fs::write(t.path().join("f"), "x").unwrap();
        assert!(find_empty_dirs(&[], &opts()).is_err());
        let e = find_empty_dirs(&[t.path().join("f")], &opts()).unwrap_err();
        assert_eq!(e.code, FsErrorCode::NotADirectory);
        let e = find_empty_dirs(&[t.path().join("missing")], &opts()).unwrap_err();
        assert_eq!(e.code, FsErrorCode::NotFound);
        let e =
            find_empty_dirs(&[t.path().to_path_buf(), t.path().join("a")], &opts()).unwrap_err();
        assert_eq!(e.code, FsErrorCode::InvalidPath);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_folder_is_reported_and_not_empty() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let locked = t.path().join("locked");
        fs::create_dir_all(locked.join("inner")).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let scan = find_empty_dirs(&[t.path().to_path_buf()], &opts()).unwrap();
        let readable = fs::read_dir(&locked).is_ok();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        if readable {
            // running as root: permissions do not apply – only check the result is sane
            return;
        }
        assert_eq!(scan.unreadable.len(), 1);
        assert!(scan.items.is_empty());
    }
}
