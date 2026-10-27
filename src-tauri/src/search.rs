//! Recursive search (design 009): criteria, compiled name/content matchers and
//! a cycle-safe depth-first walk. Pure std + `regex`, without Tauri – the job
//! (`jobs/search.rs`) batches the hits and reports them.
//!
//! - Links are never followed unless `follow_links`; then every entered folder
//!   is remembered by its identity (device + inode, elsewhere the canonical path)
//!   and entered at most once – no endless walk on link cycles.
//! - Unreadable folders are collected, never fatal.
//! - File contents are read in blocks, only up to a size limit, and never logged.
//!
//! Keep in sync with `src/app/core/search/search.models.ts`.

use crate::error::{FsError, FsErrorCode};
use crate::listing::{entry_from_metadata, is_hidden};
use crate::model::DirEntryDto;
use crate::paths::{parent_names, validate_input_path};
use regex::bytes::{Regex as BytesRegex, RegexBuilder as BytesRegexBuilder};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, Metadata};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, UNIX_EPOCH};

/// Hits per search by default and at most.
pub const DEFAULT_MAX_HITS: u32 = 10_000;
pub const MAX_HITS: u32 = 100_000;
/// Depth limit without (and above) an explicit `max_depth`.
pub const MAX_DEPTH: u32 = 256;
/// Content search: default and maximum file size.
pub const DEFAULT_MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
pub const MAX_FILE_SIZE: u64 = 1024 * 1024 * 1024;
/// Unreadable folders reported by name (the count is complete).
pub const MAX_REPORTED_UNREADABLE: usize = 1000;
const MAX_ROOTS: usize = 100;
const MAX_PATTERN_LEN: usize = 4096;
const MAX_EXCLUDES: usize = 100;
const BLOCK: usize = 64 * 1024;
/// Compiled regexes stay small (a pattern can't eat the memory).
const REGEX_SIZE_LIMIT: usize = 1 << 20;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NameMode {
    /// `*`, `?`, `[…]`; several patterns separated by `;`.
    #[default]
    Glob,
    Regex,
    /// Plain text (substring, or the whole name).
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kinds {
    #[serde(default = "yes")]
    pub files: bool,
    #[serde(default = "yes")]
    pub dirs: bool,
    #[serde(default = "yes")]
    pub links: bool,
}

impl Default for Kinds {
    fn default() -> Self {
        Self {
            files: true,
            dirs: true,
            links: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentQuery {
    pub text: String,
    #[serde(default)]
    pub case_sensitive: bool,
    /// Larger files are skipped (default [`DEFAULT_MAX_FILE_SIZE`]).
    #[serde(default)]
    pub max_file_size: Option<u64>,
}

/// What to search for (the search dialog, or the folder finder).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCriteria {
    pub roots: Vec<String>,
    /// Empty = every name.
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub name_mode: NameMode,
    #[serde(default)]
    pub case_sensitive: bool,
    /// The pattern must match the whole name (else a part of it).
    #[serde(default = "yes")]
    pub whole_name: bool,
    #[serde(default)]
    pub kinds: Kinds,
    /// Bytes, files only (other kinds never match a size filter).
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub max_size: Option<u64>,
    /// Modification time, ms since the Unix epoch (inclusive).
    #[serde(default)]
    pub modified_from_ms: Option<i64>,
    #[serde(default)]
    pub modified_to_ms: Option<i64>,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub follow_links: bool,
    /// 1 = only the entries of the roots.
    #[serde(default)]
    pub max_depth: Option<u32>,
    /// Name patterns (glob, without case) of entries that are skipped – folders are not entered.
    #[serde(default)]
    pub excludes: Vec<String>,
    #[serde(default)]
    pub content: Option<ContentQuery>,
    #[serde(default)]
    pub max_hits: Option<u32>,
    /// Linux: `/proc`, `/sys` and `/dev` are not entered (a root that is one of
    /// them is still searched). Default on (review 009 #6).
    #[serde(default = "yes")]
    pub skip_virtual_fs: bool,
}

/// One hit: an entry as in a listing, plus its folder (shown in the result tab).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    #[serde(flatten)]
    pub entry: DirEntryDto,
    /// Full path of the folder that contains the entry.
    pub dir: String,
    /// `dir` relative to the search root it was found under (OS separators), "" for an
    /// entry directly in the root – the flat view's "Path" column (design 038 E2).
    pub rel_dir: String,
    /// Names of `dir`, its parent and grandparent (`paths::parent_names`): a result
    /// tab has no breadcrumbs, and the frontend never splits paths (multi-rename P/Q/R).
    pub parent_names: [String; 3],
    /// Duplicate search (design 016 E6): the group the file belongs to (1 = most wasted bytes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<u32>,
    /// Duplicates (design 042): position in the walk – rule "first found".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    /// Duplicates (042 E4): this name is a hard link of the file at that path – the same
    /// file, never a copy to delete.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub same_as: Option<String>,
    /// Duplicates (042 E4): the file has this many names (> 1) – deleting one frees nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<u32>,
    /// Similar images (042 E6): size in pixels (comics: of the title page).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// Comics (042 E7): number of pages.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<u32>,
    /// Similar images/comics: differing bits to the group's centre (0 = the centre or the same).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance: Option<u8>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStats {
    pub hits: u64,
    pub dirs_scanned: u64,
    pub files_scanned: u64,
    pub unreadable: u64,
    pub elapsed_ms: u64,
    /// Stopped at `max_hits`.
    pub truncated: bool,
    /// Duplicate search: groups found so far, and the bytes to hash / hashed (design 016 E6).
    pub groups: u64,
    pub bytes_to_hash: u64,
    pub bytes_hashed: u64,
    /// Similar images/comics (design 042): files to fingerprint / done.
    pub images_total: u64,
    pub images_done: u64,
    /// Images in a format we cannot read (HEIC, AVIF) – counted, skipped.
    pub skipped_unsupported: u64,
}

struct ContentMatcher {
    re: BytesRegex,
    /// Bytes kept from the previous block (a match may cross the block border).
    overlap: usize,
    max_size: u64,
}

/// Checked and compiled criteria.
pub struct Compiled {
    roots: Vec<PathBuf>,
    /// `None` = every name.
    name: Option<Regex>,
    kinds: Kinds,
    min_size: Option<u64>,
    max_size: Option<u64>,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
    include_hidden: bool,
    follow_links: bool,
    max_depth: u32,
    excludes: Option<Regex>,
    content: Option<ContentMatcher>,
    max_hits: u64,
    skip_virtual_fs: bool,
}

impl Compiled {
    /// Another hit limit than the dialog's (duplicate search: files to compare).
    pub(crate) fn with_max_hits(mut self, max_hits: u64) -> Self {
        self.max_hits = max_hits;
        self
    }
}

fn invalid(message: impl Into<String>) -> FsError {
    FsError::new(FsErrorCode::InvalidPattern, message, None)
}

pub(crate) fn build(pattern: &str, case_sensitive: bool) -> Result<Regex, FsError> {
    RegexBuilder::new(pattern)
        .case_insensitive(!case_sensitive)
        .size_limit(REGEX_SIZE_LIMIT)
        .build()
        .map_err(|e| invalid(format!("Invalid pattern: {e}")))
}

/// One glob (`*`, `?`, `[…]`, `[!…]`) as a regex without anchors.
fn glob_to_regex(glob: &str) -> String {
    let chars: Vec<char> = glob.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '*' => out.push_str(".*"),
            '?' => out.push('.'),
            '[' => {
                // a class up to the next `]` (a `]` right after `[` or `[!` belongs to it)
                let mut j = i + 1;
                if j < chars.len() && (chars[j] == '!' || chars[j] == '^') {
                    j += 1;
                }
                if j < chars.len() && chars[j] == ']' {
                    j += 1;
                }
                while j < chars.len() && chars[j] != ']' {
                    j += 1;
                }
                if j >= chars.len() {
                    out.push_str("\\[");
                } else {
                    out.push('[');
                    let mut k = i + 1;
                    if chars[k] == '!' || chars[k] == '^' {
                        out.push('^');
                        k += 1;
                    }
                    for &cc in &chars[k..j] {
                        if matches!(cc, '\\' | '[' | ']' | '&' | '~' | '^') {
                            out.push('\\');
                        }
                        out.push(cc);
                    }
                    out.push(']');
                    i = j;
                }
            }
            _ => out.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    out
}

/// `a;b` as one regex, `None` if one of the parts matches every name
/// (`*`, `*.*` as in Total Commander and mr, empty pattern).
pub(crate) fn globs_to_regex(patterns: &str, whole: bool) -> Option<String> {
    let mut parts = Vec::new();
    for p in patterns.split(';') {
        let mut p = p.trim();
        // `**/*.mp3` (mr) = `*.mp3`: the walk finds hits in every depth anyway
        while let Some(rest) = p.strip_prefix("**/") {
            p = rest;
        }
        if p.is_empty() {
            continue;
        }
        if p == "*" || p == "*.*" || p == "**" {
            return None;
        }
        parts.push(glob_to_regex(p));
    }
    if parts.is_empty() {
        return None;
    }
    let alt = parts.join("|");
    Some(if whole { format!("^(?:{alt})$") } else { alt })
}

/// `a;b` globs as one whole-name regex without case (design 036: filter and exclusions of
/// the folder comparison); `None` = every name matches (empty, `*`, `*.*`).
pub(crate) fn glob_set(patterns: &str) -> Result<Option<Regex>, FsError> {
    if patterns.len() > MAX_PATTERN_LEN {
        return Err(invalid("Pattern too long"));
    }
    globs_to_regex(patterns, true)
        .map(|s| build(&s, false))
        .transpose()
}

/// Checks the criteria without touching the file system (the job checks the roots).
pub fn compile(c: &SearchCriteria) -> Result<Compiled, FsError> {
    if c.roots.is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "No folder to search in",
            None,
        ));
    }
    if c.roots.len() > MAX_ROOTS {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            format!("Too many folders (max. {MAX_ROOTS})"),
            None,
        ));
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    for r in &c.roots {
        let p = validate_input_path(r)?;
        if !roots.contains(&p) {
            roots.push(p);
        }
    }
    if c.name.len() > MAX_PATTERN_LEN || c.excludes.len() > MAX_EXCLUDES {
        return Err(invalid("The pattern is too long"));
    }
    let source = match c.name_mode {
        NameMode::Glob => globs_to_regex(&c.name, c.whole_name),
        NameMode::Regex if c.name.is_empty() => None,
        NameMode::Regex if c.whole_name => Some(format!("^(?:{})$", c.name)),
        NameMode::Regex => Some(c.name.clone()),
        NameMode::Text if c.name.is_empty() => None,
        NameMode::Text if c.whole_name => Some(format!("^{}$", regex::escape(&c.name))),
        NameMode::Text => Some(regex::escape(&c.name)),
    };
    let name = source.map(|s| build(&s, c.case_sensitive)).transpose()?;
    let excludes = {
        let joined = c
            .excludes
            .iter()
            .map(|e| e.trim())
            .filter(|e| !e.is_empty())
            .collect::<Vec<_>>()
            .join(";");
        if joined.len() > MAX_PATTERN_LEN {
            return Err(invalid("Too many exclusions"));
        }
        if joined.is_empty() {
            None
        } else {
            match globs_to_regex(&joined, true) {
                Some(s) => Some(build(&s, false)?),
                None => return Err(invalid("An exclusion would skip every entry")),
            }
        }
    };
    let content = match &c.content {
        Some(q) if !q.text.is_empty() => {
            if q.text.len() > 1024 {
                return Err(invalid("The text to find is too long (max. 1024 bytes)"));
            }
            let re = BytesRegexBuilder::new(&regex::escape(&q.text))
                .case_insensitive(!q.case_sensitive)
                .size_limit(REGEX_SIZE_LIMIT)
                .build()
                .map_err(|e| invalid(format!("Invalid text: {e}")))?;
            Some(ContentMatcher {
                re,
                // case folding can change the byte length of a character (max. 4 bytes)
                overlap: q.text.chars().count() * 4,
                max_size: q
                    .max_file_size
                    .unwrap_or(DEFAULT_MAX_FILE_SIZE)
                    .min(MAX_FILE_SIZE),
            })
        }
        _ => None,
    };
    Ok(Compiled {
        roots,
        name,
        kinds: c.kinds,
        min_size: c.min_size,
        max_size: c.max_size,
        from_ms: c.modified_from_ms,
        to_ms: c.modified_to_ms,
        include_hidden: c.include_hidden,
        follow_links: c.follow_links,
        max_depth: c.max_depth.unwrap_or(MAX_DEPTH).clamp(1, MAX_DEPTH),
        excludes,
        content,
        max_hits: u64::from(c.max_hits.unwrap_or(DEFAULT_MAX_HITS).clamp(1, MAX_HITS)),
        skip_virtual_fs: c.skip_virtual_fs,
    })
}

impl Compiled {
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// The roots that exist as folders (links to folders count); the others as errors.
    pub fn check_roots(&self) -> Vec<FsError> {
        self.roots
            .iter()
            .filter_map(|r| match fs::metadata(r) {
                Ok(m) if m.is_dir() => None,
                Ok(_) => Some(FsError::new(
                    FsErrorCode::NotADirectory,
                    "Not a folder",
                    Some(r),
                )),
                Err(e) => Some(FsError::from_io(&e, r)),
            })
            .collect()
    }

    fn name_matches(&self, name: &str) -> bool {
        self.name.as_ref().is_none_or(|re| re.is_match(name))
    }

    fn excluded(&self, name: &str) -> bool {
        self.excludes.as_ref().is_some_and(|re| re.is_match(name))
    }
}

fn modified_ms(meta: &Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|t| match t.duration_since(UNIX_EPOCH) {
            Ok(d) => i64::try_from(d.as_millis()).ok(),
            Err(e) => i64::try_from(e.duration().as_millis()).ok().map(|v| -v),
        })
}

/// Identity of a folder for the cycle check (only used when following links).
#[derive(Hash, PartialEq, Eq)]
enum DirKey {
    Id(u64, u64),
    Path(PathBuf),
}

fn dir_key(path: &Path, meta: &Metadata) -> Option<DirKey> {
    if let Some((dev, ino)) = crate::platform::file_id(meta) {
        return Some(DirKey::Id(dev, ino));
    }
    // no stable id (Windows): the resolved path – internal only, never used for navigation
    fs::canonicalize(path).ok().map(DirKey::Path)
}

/// Pseudo file systems that a walk does not enter (Linux): endless or blocking
/// "files", and nothing a user searches for.
pub(crate) fn is_virtual_fs(path: &Path) -> bool {
    cfg!(target_os = "linux")
        && [Path::new("/proc"), Path::new("/sys"), Path::new("/dev")].contains(&path)
}

/// Whether the file contains the text – read in blocks, stops on cancel. The
/// file is opened without blocking and must still be a regular file (a FIFO or
/// device swapped in after the listing never hangs the search).
fn content_matches(path: &Path, m: &ContentMatcher, cancel: &AtomicBool) -> bool {
    let Ok(mut file) = crate::platform::open_regular_file(path) else {
        return false;
    };
    let mut buf: Vec<u8> = Vec::with_capacity(BLOCK + m.overlap);
    let mut block = vec![0u8; BLOCK];
    let mut read_total: u64 = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        let n = match file.read(&mut block) {
            Ok(0) => return false,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return false,
        };
        read_total += n as u64;
        if read_total > m.max_size {
            // grew past the limit while reading
            return false;
        }
        buf.extend_from_slice(&block[..n]);
        if m.re.is_match(&buf) {
            return true;
        }
        let keep = m.overlap.min(buf.len());
        buf.drain(..buf.len() - keep);
    }
}

/// What the walk reports. `None` = a folder was finished (statistics only).
pub type Sink<'a> = dyn FnMut(Option<SearchHit>, &SearchStats) + 'a;

/// Result of a walk: statistics and the unreadable folders (first
/// [`MAX_REPORTED_UNREADABLE`], `stats.unreadable` has the count).
pub struct WalkResult {
    pub stats: SearchStats,
    pub unreadable: Vec<FsError>,
}

/// Depth-first walk over the roots (the roots themselves are never hits).
pub fn walk(c: &Compiled, cancel: &AtomicBool, sink: &mut Sink<'_>) -> WalkResult {
    let start = Instant::now();
    let mut stats = SearchStats::default();
    let mut unreadable: Vec<FsError> = Vec::new();
    let mut visited: HashSet<DirKey> = HashSet::new();
    let mut stack: Vec<(PathBuf, u32, usize)> = Vec::new();
    let mut note_unreadable = |stats: &mut SearchStats, e: FsError| {
        stats.unreadable += 1;
        if unreadable.len() < MAX_REPORTED_UNREADABLE {
            unreadable.push(e);
        }
    };
    // following links, a folder is entered once per identity; one without an
    // identity (no inode, canonicalize failed) is entered anyway – the depth
    // limit ends a cycle through it (review 009 #7)
    let mut first_visit = |path: &Path, meta: &Metadata| match dir_key(path, meta) {
        Some(k) => visited.insert(k),
        None => true,
    };
    for (ri, root) in c.roots.iter().enumerate() {
        match fs::metadata(root) {
            Ok(meta) if meta.is_dir() => {
                if c.follow_links && !first_visit(root, &meta) {
                    continue; // the same folder twice (a root inside a linked root …)
                }
                stack.push((root.clone(), 0, ri));
            }
            Ok(_) => note_unreadable(
                &mut stats,
                FsError::new(FsErrorCode::NotADirectory, "Not a folder", Some(root)),
            ),
            Err(e) => note_unreadable(&mut stats, FsError::from_io(&e, root)),
        }
    }
    // the folder finder only wants folders: other entries need no `lstat` (review 009 #8)
    let only_dirs = !c.kinds.files && !c.kinds.links && !c.follow_links;
    let skip_dir = |path: &Path| c.skip_virtual_fs && is_virtual_fs(path);
    // the first root is searched first
    stack.reverse();
    'walk: while let Some((dir, depth, ri)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let rd = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(e) => {
                note_unreadable(&mut stats, FsError::from_io(&e, &dir));
                continue;
            }
        };
        stats.dirs_scanned += 1;
        let dir_str = dir.to_string_lossy().into_owned();
        let dir_parents = parent_names(&dir);
        let rel_dir = dir
            .strip_prefix(&c.roots[ri])
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut children: Vec<PathBuf> = Vec::new();
        let enter = depth + 1 < c.max_depth;
        // in name order: hits and the folder finder come in a stable, readable order
        let mut entries: Vec<fs::DirEntry> = Vec::new();
        for e in rd {
            match e {
                Ok(e) => entries.push(e),
                Err(e) => {
                    // the rest of the folder could not be read
                    note_unreadable(&mut stats, FsError::from_io(&e, &dir));
                    break;
                }
            }
        }
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            if cancel.load(Ordering::Relaxed) {
                break 'walk;
            }
            if only_dirs && entry.file_type().is_ok_and(|ft| !ft.is_dir()) {
                stats.files_scanned += 1;
                continue;
            }
            let os_name = entry.file_name();
            let name = os_name.to_string_lossy().into_owned();
            let path = entry.path();
            // below a folder with a non-UTF-8 name the path is lossy too: such a hit
            // cannot be addressed by its path string (review 009 #4)
            let lossy = path.to_str().is_none();
            // `DirEntry::metadata` does not follow links (lstat)
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue, // gone meanwhile
                Err(e) => {
                    note_unreadable(&mut stats, FsError::from_io(&e, &path));
                    continue;
                }
            };
            if (!c.include_hidden && is_hidden(&name, &meta)) || c.excluded(&name) {
                continue;
            }
            let ft = meta.file_type();
            let is_link = ft.is_symlink();
            if ft.is_dir() {
                if enter && !skip_dir(&path) && (!c.follow_links || first_visit(&path, &meta)) {
                    children.push(path.clone());
                }
            } else {
                stats.files_scanned += 1;
                if is_link
                    && c.follow_links
                    && enter
                    && !skip_dir(&path)
                    && let Ok(target) = fs::metadata(&path)
                    && target.is_dir()
                    && first_visit(&path, &target)
                {
                    children.push(path.clone());
                }
            }
            let kind_ok = if is_link {
                c.kinds.links
            } else if ft.is_dir() {
                c.kinds.dirs
            } else {
                c.kinds.files
            };
            if !kind_ok || !c.name_matches(&name) {
                continue;
            }
            if c.min_size.is_some() || c.max_size.is_some() {
                if !ft.is_file() {
                    continue;
                }
                let len = meta.len();
                if c.min_size.is_some_and(|m| len < m) || c.max_size.is_some_and(|m| len > m) {
                    continue;
                }
            }
            if c.from_ms.is_some() || c.to_ms.is_some() {
                let Some(ms) = modified_ms(&meta) else {
                    continue;
                };
                if c.from_ms.is_some_and(|f| ms < f) || c.to_ms.is_some_and(|t| ms > t) {
                    continue;
                }
            }
            if let Some(m) = &c.content
                && (!ft.is_file() || meta.len() > m.max_size || !content_matches(&path, m, cancel))
            {
                continue;
            }
            // one hit more than allowed: only now is the result incomplete (review 009 #12)
            if stats.hits >= c.max_hits {
                stats.truncated = true;
                break 'walk;
            }
            let hit = SearchHit {
                entry: entry_from_metadata(name, &path, &meta, lossy),
                dir: dir_str.clone(),
                rel_dir: rel_dir.clone(),
                parent_names: dir_parents.clone(),
                group: None,
                order: None,
                same_as: None,
                links: None,
                width: None,
                height: None,
                pages: None,
                distance: None,
            };
            stats.hits += 1;
            stats.elapsed_ms = start.elapsed().as_millis() as u64;
            sink(Some(hit), &stats);
        }
        // pop in name order (deterministic, like the listing)
        children.sort_by(|a, b| b.cmp(a));
        stack.extend(children.into_iter().map(|p| (p, depth + 1, ri)));
        stats.elapsed_ms = start.elapsed().as_millis() as u64;
        sink(None, &stats);
    }
    stats.elapsed_ms = start.elapsed().as_millis() as u64;
    WalkResult { stats, unreadable }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;
    use tempfile::TempDir;

    fn crit(root: &Path) -> SearchCriteria {
        SearchCriteria {
            roots: vec![root.to_string_lossy().into_owned()],
            name: String::new(),
            name_mode: NameMode::Glob,
            case_sensitive: false,
            whole_name: true,
            kinds: Kinds::default(),
            min_size: None,
            max_size: None,
            modified_from_ms: None,
            modified_to_ms: None,
            include_hidden: false,
            follow_links: false,
            max_depth: None,
            excludes: vec![],
            content: None,
            max_hits: None,
            skip_virtual_fs: true,
        }
    }

    /// Names of the hits relative to `root`, sorted, `/`-separated.
    fn run(c: &SearchCriteria, root: &Path) -> (Vec<String>, WalkResult) {
        let compiled = compile(c).unwrap();
        let mut hits = Vec::new();
        let cancel = AtomicBool::new(false);
        let res = walk(&compiled, &cancel, &mut |h, _| {
            if let Some(h) = h {
                hits.push(h);
            }
        });
        let mut names: Vec<String> = hits
            .iter()
            .map(|h| {
                let p = PathBuf::from(&h.entry.path);
                let rel = p.strip_prefix(root).unwrap();
                rel.components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .collect();
        names.sort();
        (names, res)
    }

    fn tree() -> TempDir {
        let t = TempDir::new().unwrap();
        let r = t.path();
        fs::create_dir_all(r.join("Musik/Über alles")).unwrap();
        fs::create_dir_all(r.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(r.join(".hidden dir")).unwrap();
        fs::write(r.join("Musik/Über alles/01 Lied.mp3"), b"x").unwrap();
        fs::write(r.join("Musik/Über alles/cover.JPG"), vec![0u8; 2000]).unwrap();
        fs::write(r.join("Musik/🎉 party.flac"), b"").unwrap();
        fs::write(r.join("node_modules/pkg/index.mp3"), b"").unwrap();
        fs::write(r.join(".hidden dir/secret.mp3"), b"").unwrap();
        fs::write(r.join(".dot.mp3"), b"").unwrap();
        fs::write(r.join("readme.txt"), b"Hello W\xc3\xb6rld, needle here").unwrap();
        t
    }

    #[test]
    fn glob_translation() {
        let m = |p: &str, name: &str| {
            let re = build(&globs_to_regex(p, true).unwrap(), false).unwrap();
            re.is_match(name)
        };
        assert!(m("*.mp3", "01 Lied.MP3"));
        assert!(!m("*.mp3", "a.mp3.bak"));
        assert!(m("**/*.mp3", "a.mp3"));
        assert!(m("*.mp3;*.flac", "x.flac"));
        assert!(m("file?.txt", "file1.txt"));
        assert!(!m("file?.txt", "file10.txt"));
        assert!(m("[ab]*", "beta"));
        assert!(!m("[!ab]*", "beta"));
        assert!(m("[]x]", "]"));
        assert!(m("a[", "a["), "unclosed class is literal");
        assert!(
            m("a+b (1).txt", "a+b (1).txt"),
            "regex characters are literal"
        );
        assert!(m("Ü*", "über"), "unicode case folding");
        assert_eq!(globs_to_regex("*.*", true), None, "TC: *.* = everything");
        assert_eq!(globs_to_regex("**/*.*", true), None);
        assert_eq!(globs_to_regex(" ; ", true), None);
        let part = build(&globs_to_regex("lied", false).unwrap(), false).unwrap();
        assert!(part.is_match("01 Lied.mp3"));
    }

    #[test]
    fn name_modes_case_and_whole_name() {
        let t = tree();
        let r = t.path();
        let mut c = crit(r);
        c.name = "*.mp3".into();
        let (names, _) = run(&c, r);
        // no hidden entries, node_modules is searched without exclusions
        assert_eq!(
            names,
            vec!["Musik/Über alles/01 Lied.mp3", "node_modules/pkg/index.mp3"]
        );
        c.excludes = vec!["NODE_MODULES".into(), ".git".into()];
        assert_eq!(run(&c, r).0, vec!["Musik/Über alles/01 Lied.mp3"]);
        c.include_hidden = true;
        assert_eq!(
            run(&c, r).0,
            vec![
                ".dot.mp3",
                ".hidden dir/secret.mp3",
                "Musik/Über alles/01 Lied.mp3"
            ]
        );
        c.include_hidden = false;
        c.name_mode = NameMode::Regex;
        c.name = r"^\d+ .*\.mp3$".into();
        c.whole_name = false;
        assert_eq!(run(&c, r).0, vec!["Musik/Über alles/01 Lied.mp3"]);
        c.name = "über".into();
        assert_eq!(run(&c, r).0, vec!["Musik/Über alles"]);
        c.case_sensitive = true;
        assert!(run(&c, r).0.is_empty());
        c.name_mode = NameMode::Text;
        c.case_sensitive = false;
        c.name = "🎉 PARTY".into();
        assert_eq!(run(&c, r).0, vec!["Musik/🎉 party.flac"]);
        c.whole_name = true;
        assert!(run(&c, r).0.is_empty(), "text must be the whole name");
        c.name = "cover.jpg".into();
        assert_eq!(run(&c, r).0, vec!["Musik/Über alles/cover.JPG"]);
        c.name_mode = NameMode::Regex;
        c.name = "(".into();
        let err = compile(&c).err().unwrap();
        assert_eq!(err.code, FsErrorCode::InvalidPattern);
        c.name = "a{1000}{1000}".into();
        assert_eq!(
            compile(&c).err().unwrap().code,
            FsErrorCode::InvalidPattern,
            "regex size limit"
        );
    }

    #[test]
    fn kinds_size_date_depth() {
        let t = tree();
        let r = t.path();
        let mut c = crit(r);
        c.kinds = Kinds {
            files: false,
            dirs: true,
            links: false,
        };
        // mr bug: "directories only" found nothing
        assert_eq!(
            run(&c, r).0,
            vec![
                "Musik",
                "Musik/Über alles",
                "node_modules",
                "node_modules/pkg"
            ]
        );
        c.max_depth = Some(1);
        assert_eq!(run(&c, r).0, vec!["Musik", "node_modules"]);
        c.max_depth = None;
        c.kinds = Kinds::default();
        c.min_size = Some(1000);
        assert_eq!(run(&c, r).0, vec!["Musik/Über alles/cover.JPG"]);
        c.min_size = None;
        c.max_size = Some(0);
        assert_eq!(
            run(&c, r).0,
            vec!["Musik/🎉 party.flac", "node_modules/pkg/index.mp3"]
        );
        c.max_size = None;
        let now = modified_ms(&fs::metadata(r.join("readme.txt")).unwrap()).unwrap();
        c.modified_from_ms = Some(now + 60_000);
        assert!(run(&c, r).0.is_empty());
        c.modified_from_ms = Some(now - 60_000);
        c.modified_to_ms = Some(now + 60_000);
        assert_eq!(run(&c, r).0.len(), 9);
    }

    #[test]
    fn content_search_with_limit_and_block_border() {
        let t = tree();
        let r = t.path();
        let mut c = crit(r);
        c.content = Some(ContentQuery {
            text: "WÖRLD".into(),
            case_sensitive: false,
            max_file_size: None,
        });
        assert_eq!(run(&c, r).0, vec!["readme.txt"]);
        c.content.as_mut().unwrap().case_sensitive = true;
        assert!(run(&c, r).0.is_empty());
        // a match across the 64 KiB block border
        let mut big = vec![b'a'; BLOCK - 3];
        big.extend_from_slice(b"needle");
        big.extend(vec![b'b'; 100]);
        fs::write(r.join("big.bin"), &big).unwrap();
        c.content = Some(ContentQuery {
            text: "needle".into(),
            case_sensitive: true,
            max_file_size: None,
        });
        assert_eq!(run(&c, r).0, vec!["big.bin", "readme.txt"]);
        c.content.as_mut().unwrap().max_file_size = Some(1000);
        assert_eq!(run(&c, r).0, vec!["readme.txt"], "size limit skips big.bin");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cycles_end_and_links_are_hits() {
        use std::os::unix::fs::symlink;
        let t = TempDir::new().unwrap();
        let r = t.path();
        fs::create_dir_all(r.join("a/b")).unwrap();
        fs::write(r.join("a/b/f.txt"), b"").unwrap();
        symlink(r.join("a"), r.join("a/b/up")).unwrap(); // cycle a → b → up → a
        symlink(r, r.join("a/root")).unwrap(); // cycle to the root
        symlink(r.join("a/b/f.txt"), r.join("file-link")).unwrap();
        symlink(r.join("missing"), r.join("dangling")).unwrap();
        let mut c = crit(r);
        // default: links are hits, never entered
        let (names, res) = run(&c, r);
        assert_eq!(
            names,
            vec![
                "a",
                "a/b",
                "a/b/f.txt",
                "a/b/up",
                "a/root",
                "dangling",
                "file-link"
            ]
        );
        assert_eq!(res.stats.dirs_scanned, 3);
        // following links: every folder once, no endless walk
        c.follow_links = true;
        let (names, res) = run(&c, r);
        assert_eq!(res.stats.dirs_scanned, 3, "root, a, a/b – each once");
        assert_eq!(names.len(), 7);
        // links only
        c.kinds = Kinds {
            files: false,
            dirs: false,
            links: true,
        };
        assert_eq!(
            run(&c, r).0,
            vec!["a/b/up", "a/root", "dangling", "file-link"]
        );
        // a link to a folder outside is followed
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("o.txt"), b"").unwrap();
        symlink(outside.path(), r.join("out")).unwrap();
        c.kinds = Kinds::default();
        c.name = "o.txt".into();
        assert_eq!(run(&c, r).0, vec!["out/o.txt"]);
        c.follow_links = false;
        assert!(run(&c, r).0.is_empty());
    }

    #[test]
    fn unreadable_folders_are_collected_and_roots_checked() {
        let t = tree();
        let r = t.path();
        let mut c = crit(r);
        c.roots
            .push(r.join("missing").to_string_lossy().into_owned());
        c.roots
            .push(r.join("readme.txt").to_string_lossy().into_owned());
        let compiled = compile(&c).unwrap();
        assert_eq!(compiled.check_roots().len(), 2);
        let (names, res) = run(&c, r);
        assert_eq!(names.len(), 9, "the readable root is searched");
        assert_eq!(res.stats.unreadable, 2);
        assert_eq!(res.unreadable[0].code, FsErrorCode::NotFound);
        assert_eq!(res.unreadable[1].code, FsErrorCode::NotADirectory);
        c.roots = vec!["relative".into()];
        assert_eq!(compile(&c).err().unwrap().code, FsErrorCode::InvalidPath);
        c.roots = vec![];
        assert_eq!(compile(&c).err().unwrap().code, FsErrorCode::InvalidPath);
    }

    #[cfg(unix)]
    #[test]
    fn locked_folder_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let t = tree();
        let r = t.path();
        let locked = r.join("locked");
        fs::create_dir(&locked).unwrap();
        fs::write(locked.join("in.txt"), b"").unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let readable = fs::read_dir(&locked).is_ok(); // root ignores permissions
        let (_, res) = run(&crit(r), r);
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        if !readable {
            assert_eq!(res.stats.unreadable, 1);
            assert_eq!(res.unreadable[0].code, FsErrorCode::PermissionDenied);
        }
    }

    #[test]
    fn max_hits_truncates_and_cancel_stops() {
        let t = TempDir::new().unwrap();
        let r = t.path();
        for i in 0..50 {
            fs::write(r.join(format!("f{i}.txt")), b"").unwrap();
        }
        let mut c = crit(r);
        c.max_hits = Some(10);
        let (names, res) = run(&c, r);
        assert_eq!(names.len(), 10);
        assert!(res.stats.truncated);
        let compiled = compile(&crit(r)).unwrap();
        let cancel = AtomicBool::new(false);
        let mut n = 0;
        let res = walk(&compiled, &cancel, &mut |h, _| {
            if h.is_some() {
                n += 1;
                if n == 3 {
                    cancel.store(true, Ordering::SeqCst);
                }
            }
        });
        assert_eq!(res.stats.hits, 3);
        assert!(!res.stats.truncated);
    }

    /// Review 009 #12: exactly `max_hits` hits is not "truncated" – only one more is.
    #[test]
    fn exactly_max_hits_is_not_truncated() {
        let t = TempDir::new().unwrap();
        let r = t.path();
        for i in 0..10 {
            fs::write(r.join(format!("f{i}.txt")), b"").unwrap();
        }
        let mut c = crit(r);
        c.max_hits = Some(10);
        let (names, res) = run(&c, r);
        assert_eq!(names.len(), 10);
        assert!(!res.stats.truncated, "all hits were found");
        fs::write(r.join("f10.txt"), b"").unwrap();
        let (names, res) = run(&c, r);
        assert_eq!(names.len(), 10);
        assert!(res.stats.truncated);
    }

    /// Review 009 #4: below a folder with a non-UTF-8 name, every hit's path is
    /// lossy (U+FFFD) – the hits are flagged like the folder itself.
    #[cfg(target_os = "linux")]
    #[test]
    fn hits_below_a_non_utf8_folder_are_lossy() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let t = TempDir::new().unwrap();
        let r = t.path();
        let bad = r.join(OsStr::from_bytes(b"bad\xffdir"));
        fs::create_dir_all(bad.join("sub")).unwrap();
        fs::write(bad.join("sub/ok.txt"), b"").unwrap();
        fs::write(r.join("fine.txt"), b"").unwrap();
        let compiled = compile(&crit(r)).unwrap();
        let mut hits = Vec::new();
        walk(&compiled, &AtomicBool::new(false), &mut |h, _| {
            hits.extend(h)
        });
        let by_name = |n: &str| hits.iter().find(|h| h.entry.name == n).unwrap();
        assert!(!by_name("fine.txt").entry.lossy_name);
        assert!(by_name("sub").entry.lossy_name, "child of a lossy folder");
        assert!(
            by_name("ok.txt").entry.lossy_name,
            "grandchild of a lossy folder"
        );
        assert!(
            hits.iter()
                .any(|h| h.entry.lossy_name && h.entry.name.contains('\u{FFFD}'))
        );
    }

    /// Review 009 #6: /proc, /sys and /dev are not entered by default (a root
    /// that is one of them is still searched).
    #[cfg(target_os = "linux")]
    #[test]
    fn virtual_file_systems_are_skipped_by_default() {
        if !Path::new("/proc/self").exists() {
            return;
        }
        let mut c = crit(Path::new("/"));
        c.name = "self".into();
        c.max_depth = Some(2);
        c.kinds = Kinds {
            files: false,
            dirs: false,
            links: true,
        };
        let found = |c: &SearchCriteria| {
            let compiled = compile(c).unwrap();
            let mut hits = Vec::new();
            walk(&compiled, &AtomicBool::new(false), &mut |h, _| {
                hits.extend(h)
            });
            hits.iter().any(|h| h.entry.path == "/proc/self")
        };
        assert!(!found(&c));
        c.skip_virtual_fs = false;
        assert!(found(&c));
        let mut inside = crit(Path::new("/proc"));
        inside.name = "self".into();
        inside.max_depth = Some(1);
        assert!(found(&inside), "an explicit root is searched");
    }

    #[test]
    fn hit_carries_entry_and_folder() {
        let t = tree();
        let r = t.path();
        let mut c = crit(r);
        c.name = "cover.jpg".into();
        let compiled = compile(&c).unwrap();
        let mut hits = Vec::new();
        walk(&compiled, &AtomicBool::new(false), &mut |h, _| {
            hits.extend(h);
        });
        assert_eq!(hits.len(), 1);
        let h = &hits[0];
        assert_eq!(h.entry.name, "cover.JPG");
        assert_eq!(h.entry.size, Some(2000));
        assert_eq!(PathBuf::from(&h.dir), r.join("Musik").join("Über alles"));
        let json = serde_json::to_value(h).unwrap();
        assert_eq!(json["name"], "cover.JPG");
        assert_eq!(json["kind"], "file");
        assert!(json["dir"].is_string());
        let tmp = r.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(
            h.parent_names,
            ["Über alles".to_string(), "Musik".into(), tmp.clone()]
        );
        assert_eq!(
            json["parentNames"],
            serde_json::json!(["Über alles", "Musik", tmp])
        );
    }

    /// Flat view (design 038 E2): the criteria the frontend builds for it.
    fn flat_crit(root: &Path) -> SearchCriteria {
        let mut c = crit(root);
        c.kinds = Kinds {
            files: true,
            dirs: false,
            links: true,
        };
        c.max_hits = Some(MAX_HITS);
        c
    }

    fn collect(c: &SearchCriteria) -> (Vec<SearchHit>, WalkResult) {
        let compiled = compile(c).unwrap();
        let mut hits = Vec::new();
        let res = walk(&compiled, &AtomicBool::new(false), &mut |h, _| {
            hits.extend(h);
        });
        (hits, res)
    }

    #[test]
    fn rel_dir_is_relative_to_the_root() {
        let t = TempDir::new().unwrap();
        let r = t.path();
        fs::create_dir_all(r.join("a b/Ébène 🎉/drei")).unwrap();
        fs::write(r.join("top.txt"), b"").unwrap();
        fs::write(r.join("a b/eins.txt"), b"").unwrap();
        fs::write(r.join("a b/Ébène 🎉/zwei.txt"), b"").unwrap();
        fs::write(r.join("a b/Ébène 🎉/drei/drei.txt"), b"").unwrap();
        let (hits, res) = collect(&flat_crit(r));
        assert!(!res.stats.truncated);
        let mut got: Vec<(String, PathBuf)> = hits
            .iter()
            .map(|h| (h.entry.name.clone(), PathBuf::from(&h.rel_dir)))
            .collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                (
                    "drei.txt".into(),
                    Path::new("a b").join("Ébène 🎉").join("drei")
                ),
                ("eins.txt".into(), PathBuf::from("a b")),
                ("top.txt".into(), PathBuf::new()),
                ("zwei.txt".into(), Path::new("a b").join("Ébène 🎉")),
            ],
            "all files of three levels, folders not shown"
        );
        let top = hits.iter().find(|h| h.entry.name == "top.txt").unwrap();
        assert_eq!(top.rel_dir, "", "directly in the root");
        let json = serde_json::to_value(top).unwrap();
        assert_eq!(json["relDir"], "");
    }

    #[test]
    fn rel_dir_with_two_roots_and_folders_shown() {
        let t = TempDir::new().unwrap();
        let r = t.path();
        fs::create_dir_all(r.join("one/sub")).unwrap();
        fs::create_dir_all(r.join("two/x")).unwrap();
        fs::write(r.join("one/sub/f"), b"").unwrap();
        fs::write(r.join("two/x/g"), b"").unwrap();
        let mut c = flat_crit(&r.join("one"));
        c.roots.push(r.join("two").to_string_lossy().into_owned());
        c.kinds.dirs = true;
        let (hits, _) = collect(&c);
        let mut got: Vec<(String, String)> = hits
            .iter()
            .map(|h| (h.entry.name.clone(), h.rel_dir.clone()))
            .collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                ("f".into(), "sub".into()),
                ("g".into(), "x".into()),
                ("sub".into(), "".into()),
                ("x".into(), "".into()),
            ]
        );
    }

    #[test]
    fn flat_view_skips_hidden_folders_unless_shown() {
        let t = tree();
        let r = t.path();
        let (names, _) = run(&flat_crit(r), r);
        assert!(!names.iter().any(|n| n.contains("secret")), "{names:?}");
        assert!(!names.contains(&".dot.mp3".to_string()));
        assert!(names.contains(&"Musik/Über alles/01 Lied.mp3".to_string()));
        let mut c = flat_crit(r);
        c.include_hidden = true;
        let (names, _) = run(&c, r);
        assert!(names.contains(&".hidden dir/secret.mp3".to_string()));
        assert!(names.contains(&".dot.mp3".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn flat_view_survives_a_symlink_cycle() {
        use std::os::unix::fs::symlink;
        let t = TempDir::new().unwrap();
        let r = t.path();
        fs::create_dir_all(r.join("a/b")).unwrap();
        fs::write(r.join("a/b/f.txt"), b"").unwrap();
        symlink(r.join("a"), r.join("a/b/loop")).unwrap();
        symlink(r, r.join("a/up")).unwrap();
        let (hits, res) = collect(&flat_crit(r));
        let mut got: Vec<(String, String)> = hits
            .iter()
            .map(|h| (h.entry.name.clone(), h.rel_dir.replace('\\', "/")))
            .collect();
        got.sort();
        assert_eq!(
            got,
            vec![
                ("f.txt".into(), "a/b".into()),
                ("loop".into(), "a/b".into()),
                ("up".into(), "a".into()),
            ],
            "links are entries, never entered"
        );
        assert_eq!(res.stats.dirs_scanned, 3);
    }

    #[test]
    fn flat_view_limit_marks_the_result_truncated() {
        let t = TempDir::new().unwrap();
        let r = t.path();
        for d in 0..3 {
            fs::create_dir(r.join(format!("d{d}"))).unwrap();
            for f in 0..4 {
                fs::write(r.join(format!("d{d}/f{f}")), b"").unwrap();
            }
        }
        let mut c = flat_crit(r);
        c.max_hits = Some(10);
        let (hits, res) = collect(&c);
        assert_eq!(hits.len(), 10);
        assert!(res.stats.truncated);
    }

    /// 200 000 files: first hit and cancel latency. Release:
    /// `cargo test --release search_200k -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn search_200k_first_hit_and_cancel() {
        let t = TempDir::new().unwrap();
        let r = t.path();
        for d in 0..400 {
            let dir = r.join(format!("d{d:03}"));
            fs::create_dir(&dir).unwrap();
            for f in 0..500 {
                fs::write(dir.join(format!("file {f} ä.txt")), b"").unwrap();
            }
        }
        let mut c = crit(r);
        c.name = "*499*".into();
        let compiled = compile(&c).unwrap();
        let start = Instant::now();
        let mut first = None;
        let res = walk(&compiled, &AtomicBool::new(false), &mut |h, _| {
            if h.is_some() && first.is_none() {
                first = Some(start.elapsed());
            }
        });
        println!(
            "200k: first hit {:?}, all {:?}, {} hits, {} files",
            first.unwrap(),
            start.elapsed(),
            res.stats.hits,
            res.stats.files_scanned
        );
        assert!(first.unwrap() < Duration::from_millis(300));
        let cancel = AtomicBool::new(false);
        let mut cancelled_at = None;
        let mut all = crit(r);
        all.max_hits = Some(MAX_HITS);
        let compiled = compile(&all).unwrap();
        let start = Instant::now();
        walk(&compiled, &cancel, &mut |_, s| {
            if s.files_scanned > 50_000 && cancelled_at.is_none() {
                cancel.store(true, Ordering::SeqCst);
                cancelled_at = Some(Instant::now());
            }
        });
        let reaction = cancelled_at.unwrap().elapsed();
        println!("cancel reaction {reaction:?} after {:?}", start.elapsed());
        assert!(reaction < Duration::from_millis(200));
    }
}
