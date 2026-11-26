//! Clean folders (design 008 E3, 077): finds empty folders, folders that hold
//! nothing but extras ("residues") and files matching a name pattern below
//! start folders – with a verdict per start folder. Pure std, writes nothing.
//!
//! Rules: everything that is not explicitly an extra is content. Symbolic links
//! are never followed (a link – even to an empty folder – is content), other
//! file systems are not entered, unreadable folders count as content, hidden
//! files are content unless their exact name is in the junk list, an extra that
//! only a pattern makes one is content once it is larger than its limit, and
//! nothing above a start folder is ever looked at. A folder that stays is not
//! gutted: below it only really empty folders go (design 077 E3). Companions
//! (subtitles, `companion_junk`) are extras only where a start folder goes as a
//! whole and holds a real extra – in every other case they are content.
//!
//! The job (`jobs/clean.rs`) decides with the same walk ([`plan_tree`]) right
//! before it deletes.

use crate::error::{FsError, FsErrorCode};
use crate::paths::{Danger, DangerCheck, normalize_lexically};
use crate::platform::file_id;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Entries the scan looks at before it stops (`truncated`).
pub const MAX_VISITED: u64 = 500_000;
/// Hits the scan reports at most (`truncated`).
pub const MAX_ITEMS: usize = 100_000;
/// Unreadable folders reported (further ones are counted in `unreadable_more`).
pub const MAX_UNREADABLE: usize = 1000;
/// Names in the junk list / patterns, and their length.
pub const MAX_NAMES: usize = 100;
pub const MAX_NAME_LEN: usize = 255;
/// Start folders of one scan.
pub const MAX_ROOTS: usize = 10_000;
/// Largest file a junk *pattern* may make an extra (design 077 E3).
pub const DEFAULT_JUNK_MAX_BYTES: u64 = 1024 * 1024;
/// The same for the sample patterns (`large_junk`): samples are big.
pub const DEFAULT_LARGE_JUNK_MAX_BYTES: u64 = 300 * 1024 * 1024;
/// Largest companion file (subtitle) that goes with a residue. Fixed: a VobSub
/// `.sub` has about 10 MB per language, a PGS `.sup` of a long film up to some
/// 60 MB – and no film is that small.
pub const COMPANION_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Entries that stay, reported per start folder.
pub const MAX_KEEP_SAMPLE: usize = 20;
/// Most frequent extensions of the content, reported per start folder.
pub const MAX_KEEP_EXTENSIONS: usize = 3;
/// Different extensions counted per start folder.
const MAX_EXTENSION_KINDS: usize = 1000;

fn yes() -> bool {
    true
}

fn junk_max() -> u64 {
    DEFAULT_JUNK_MAX_BYTES
}

fn large_junk_max() -> u64 {
    DEFAULT_LARGE_JUNK_MAX_BYTES
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
    /// File names that do not count as content (`.DS_Store` …); with `*`/`?` a name
    /// pattern (`*.nfo`, design 045 E4) – then only up to `junk_max_bytes`. Junk
    /// goes with its folder. Empty = off.
    #[serde(default)]
    pub junk: Vec<String>,
    /// Name patterns (`*`, `?`) of files to delete; empty = off.
    #[serde(default)]
    pub patterns: Vec<String>,
    /// Junk patterns with the generous limit `large_junk_max_bytes` (samples).
    #[serde(default)]
    pub large_junk: Vec<String>,
    /// A file that only a pattern of `junk` makes an extra is content when it is
    /// larger. A missing field never means "no limit".
    #[serde(default = "junk_max")]
    pub junk_max_bytes: u64,
    #[serde(default = "large_junk_max")]
    pub large_junk_max_bytes: u64,
    /// Below a folder that stays, folders holding only pattern extras (`Sample/`
    /// next to the film) go as well. Default off: a folder with content is not gutted.
    #[serde(default)]
    pub junk_dirs_beside_content: bool,
    /// Name patterns of companions (subtitles, addendum 26.11.2026 of design 077):
    /// extras only where a start folder goes as a whole **and** holds at least one
    /// real extra of `junk` patterns/names or `large_junk` – never on their own, never
    /// next to content, never larger than [`COMPANION_MAX_BYTES`]. Empty = off.
    #[serde(default)]
    pub companion_junk: Vec<String>,
}

impl Default for CleanOptions {
    fn default() -> Self {
        CleanOptions {
            empty_dirs: true,
            include_roots: false,
            junk: Vec::new(),
            patterns: Vec::new(),
            large_junk: Vec::new(),
            junk_max_bytes: DEFAULT_JUNK_MAX_BYTES,
            large_junk_max_bytes: DEFAULT_LARGE_JUNK_MAX_BYTES,
            junk_dirs_beside_content: false,
            companion_junk: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CleanKind {
    #[default]
    Dir,
    File,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanItem {
    pub path: String,
    pub kind: CleanKind,
    /// Junk files inside the folder (they go with it).
    #[serde(default)]
    pub junk: u32,
    /// The first junk names (at most [`MAX_JUNK_NAMES`]) – shown in the dialog, so the
    /// user sees what leaves with the folder (review 045 #2). Not read by the job.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub junk_names: Vec<String>,
    /// Bytes of the junk files directly inside the folder / of the file. Not read by the job.
    #[serde(default)]
    pub bytes: u64,
    /// Path relative to its start folder, for display only ("" = the start folder).
    #[serde(default)]
    pub rel: String,
    /// The folder is "empty" only because of pattern extras somewhere inside
    /// (design 077 E3). Not read by the job, which finds out itself.
    #[serde(default)]
    pub soft: bool,
}

/// Junk names reported per folder.
pub const MAX_JUNK_NAMES: usize = 5;

/// What happens to a start folder (design 077).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    /// Holds nothing but extras and empty folders: goes as a whole.
    Residue,
    /// Stays, but something below it goes.
    Partial,
    /// Nothing to do.
    Keep,
}

/// Why an entry counts as content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeepReason {
    /// A file no rule names.
    Content,
    /// Matches a junk pattern, but is larger than `junk_max_bytes`.
    TooLarge,
    /// Matches a sample pattern, but is larger than `large_junk_max_bytes`.
    SampleTooLarge,
    /// A hidden file whose exact name is not in the junk list.
    Hidden,
    /// A symbolic link (never followed).
    Link,
    /// A folder or entry that could not be read.
    Unreadable,
    /// A folder on another file system (a mount point).
    OtherFs,
    /// A FIFO, socket, device, or a name that is not valid Unicode.
    Special,
    /// A folder the system shows as one file (`.app`, `.photoslibrary` …): never entered.
    Package,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptEntry {
    /// Path relative to the start folder, for display only.
    pub rel: String,
    pub bytes: u64,
    pub reason: KeepReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootVerdict {
    pub path: String,
    /// The folder's name, for display.
    pub name: String,
    pub verdict: Verdict,
    /// Its entries are `items[first..first + count]`.
    pub first: usize,
    pub count: usize,
    pub remove_dirs: u64,
    pub remove_files: u64,
    pub remove_bytes: u64,
    /// Files that count as content (also too large or hidden ones).
    pub keep_files: u64,
    pub keep_bytes: u64,
    /// The most frequent extensions of the content (lower case, with the dot).
    pub keep_extensions: Vec<String>,
    /// The first entries that stay.
    pub keep_sample: Vec<KeptEntry>,
    pub too_large: u64,
    pub sample_too_large: u64,
    pub hidden: u64,
    pub links: u64,
    /// Unreadable folders, mount points, special files.
    pub blocked: u64,
    /// Extras that stay because they lie next to content.
    pub junk_kept: u64,
    /// Root, home or system folder: never deleted as a whole.
    pub danger: Option<Danger>,
    /// Reached through a link: never deleted as a whole.
    pub linked: bool,
    /// The scan stopped before this folder was done: nothing of it is certain.
    pub incomplete: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanScan {
    /// In delete order: children before their parents; grouped by start folder.
    pub items: Vec<CleanItem>,
    /// One verdict per start folder (nested and double ones merged).
    pub roots: Vec<RootVerdict>,
    pub unreadable: Vec<FsError>,
    pub unreadable_more: u64,
    /// The scan stopped at a limit; started folders count as not empty.
    pub truncated: bool,
    /// The scan was cancelled (a newer one started, the dialog closed).
    pub cancelled: bool,
    pub visited: u64,
}

/// What a file is for the cleaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileClass {
    /// Goes with its folder; `pattern`: only a pattern makes it an extra.
    Junk {
        pattern: bool,
    },
    /// Matches a delete pattern: listed on its own.
    Delete,
    /// A companion (subtitle) within its size limit: an extra only where its start
    /// folder goes as a whole with a real extra inside, content otherwise – the walk
    /// decides ([`Ctx::companions`]).
    Companion,
    Keep(KeepReason),
}

/// The built-in system junk (lower case): the only names without a size limit –
/// `.DS_Store` and `Thumbs.db` grow with their folder (review 077 #7).
pub const SYSTEM_JUNK: [&str; 3] = [".ds_store", "thumbs.db", "desktop.ini"];

/// Folders the system shows as one file (macOS packages and bundles): never entered,
/// always content – "empty" folders inside belong to their format (review 077 #2).
/// Hidden folders (`.git`) are treated the same way.
pub const PACKAGE_EXTENSIONS: [&str; 16] = [
    "app",
    "bundle",
    "framework",
    "plugin",
    "kext",
    "xcodeproj",
    "xcworkspace",
    "playground",
    "lproj",
    "photoslibrary",
    "musiclibrary",
    "tvlibrary",
    "imovielibrary",
    "fcpbundle",
    "sparsebundle",
    "rtfd",
];

/// The folder name ends with a package extension (any case).
pub fn is_package(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty() && PACKAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str())
    })
}

/// Compiled options: lower-case junk names and patterns, the size limits.
pub struct Matcher {
    /// Exact names of the built-in system junk (lower case): no size limit.
    junk: Vec<String>,
    /// Other exact names (typed by the user): extras up to `junk_max` only.
    junk_names: Vec<String>,
    /// Junk names with `*`/`?` (design 045 E4: `*.nfo`).
    junk_patterns: Vec<Vec<char>>,
    /// Sample patterns (`*-sample.*`), with the generous limit.
    large_patterns: Vec<Vec<char>>,
    /// Companion patterns (`*.srt`), limit [`COMPANION_MAX_BYTES`].
    companion_patterns: Vec<Vec<char>>,
    patterns: Vec<Vec<char>>,
    junk_max: u64,
    large_max: u64,
}

/// A pattern without a literal other than `.` hits (almost) every file:
/// `*`, `?*`, `*?*`, `*.*` (review 008 #1).
fn matches_everything(p: &str) -> bool {
    p.chars().all(|c| matches!(c, '*' | '?' | '.'))
}

fn bad_name(m: &str) -> FsError {
    FsError::new(FsErrorCode::InvalidName, m.to_string(), None)
}

impl Matcher {
    pub fn new(o: &CleanOptions) -> Result<Matcher, FsError> {
        if o.junk.len() > MAX_NAMES
            || o.patterns.len() > MAX_NAMES
            || o.large_junk.len() > MAX_NAMES
            || o.companion_junk.len() > MAX_NAMES
        {
            return Err(bad_name("Too many names or patterns"));
        }
        let mut junk = Vec::new();
        let mut junk_names = Vec::new();
        let mut junk_patterns = Vec::new();
        for j in &o.junk {
            let j = j.trim();
            if j.is_empty() {
                continue;
            }
            if j.len() > MAX_NAME_LEN || j.contains(['/', '\\', '\0']) {
                return Err(bad_name("A junk file name is invalid"));
            }
            if j.contains(['*', '?']) {
                if matches_everything(j) {
                    return Err(bad_name("The junk pattern would match every file"));
                }
                junk_patterns.push(j.to_lowercase().chars().collect());
            } else if SYSTEM_JUNK.contains(&j.to_lowercase().as_str()) {
                junk.push(j.to_lowercase());
            } else {
                junk_names.push(j.to_lowercase());
            }
        }
        let mut large_patterns = Vec::new();
        for j in &o.large_junk {
            let j = j.trim();
            if j.is_empty() {
                continue;
            }
            if j.len() > MAX_NAME_LEN || j.contains(['/', '\\', '\0']) {
                return Err(bad_name("A sample pattern is invalid"));
            }
            // an exact name (`sample.mkv`) is fine here: it has the sample limit, too
            if matches_everything(j) {
                return Err(bad_name("The sample pattern would match every file"));
            }
            large_patterns.push(j.to_lowercase().chars().collect());
        }
        let mut companion_patterns = Vec::new();
        for j in &o.companion_junk {
            let j = j.trim();
            if j.is_empty() {
                continue;
            }
            if j.len() > MAX_NAME_LEN || j.contains(['/', '\\', '\0']) {
                return Err(bad_name("A companion pattern is invalid"));
            }
            if matches_everything(j) {
                return Err(bad_name("The companion pattern would match every file"));
            }
            companion_patterns.push(j.to_lowercase().chars().collect());
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
                return Err(bad_name(
                    "A file pattern must be a name pattern such as *.bak",
                ));
            }
            if matches_everything(p) {
                return Err(bad_name("The file pattern would match every file"));
            }
            patterns.push(p.to_lowercase().chars().collect());
        }
        Ok(Matcher {
            junk,
            junk_names,
            junk_patterns,
            large_patterns,
            companion_patterns,
            patterns,
            junk_max: o.junk_max_bytes,
            large_max: o.large_junk_max_bytes,
        })
    }

    /// There are companion patterns at all.
    pub fn has_companions(&self) -> bool {
        !self.companion_patterns.is_empty()
    }

    /// The name alone says "extra" (exact name or a pattern, no companion) – without
    /// size and hidden rules. For texts only; decisions use [`Matcher::classify`].
    pub fn is_junk(&self, name: &str) -> bool {
        let lower = name.to_lowercase();
        if self.junk.contains(&lower) || self.junk_names.contains(&lower) {
            return true;
        }
        let chars: Vec<char> = lower.chars().collect();
        self.junk_patterns
            .iter()
            .chain(&self.large_patterns)
            .any(|p| glob_match(p, &chars))
    }

    pub fn matches(&self, name: &str) -> bool {
        if self.patterns.is_empty() {
            return false;
        }
        let name: Vec<char> = name.to_lowercase().chars().collect();
        self.patterns.iter().any(|p| glob_match(p, &name))
    }

    /// The one decision about a regular file (design 077 E3), used by the scan
    /// and by the job: `hidden` as the listing shows it, `size` in bytes.
    pub fn classify(&self, name: &str, hidden: bool, size: u64) -> FileClass {
        let lower = name.to_lowercase();
        let chars: Vec<char> = lower.chars().collect();
        // an explicit instruction of the user (profile "custom"), as in design 008
        if self.patterns.iter().any(|p| glob_match(p, &chars)) {
            return FileClass::Delete;
        }
        if self.junk.contains(&lower) {
            return FileClass::Junk { pattern: false };
        }
        // a name the user typed: explicit (it may be hidden), but never a large file
        if self.junk_names.contains(&lower) {
            return if size <= self.junk_max {
                FileClass::Junk { pattern: true }
            } else {
                FileClass::Keep(KeepReason::TooLarge)
            };
        }
        if hidden {
            // a pattern never reaches a hidden file
            return FileClass::Keep(KeepReason::Hidden);
        }
        if self.large_patterns.iter().any(|p| glob_match(p, &chars)) {
            return if size <= self.large_max {
                FileClass::Junk { pattern: true }
            } else {
                FileClass::Keep(KeepReason::SampleTooLarge)
            };
        }
        if self.junk_patterns.iter().any(|p| glob_match(p, &chars)) {
            return if size <= self.junk_max {
                FileClass::Junk { pattern: true }
            } else {
                FileClass::Keep(KeepReason::TooLarge)
            };
        }
        // last: a name that is a real extra, too, is one (`x-sample.ts` never a companion).
        // Too large = plain content: no subtitle, whatever its name says
        if size <= COMPANION_MAX_BYTES
            && self
                .companion_patterns
                .iter()
                .any(|p| glob_match(p, &chars))
        {
            return FileClass::Companion;
        }
        FileClass::Keep(KeepReason::Content)
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

/// The start folders, normalised and merged (design 077 E3): a folder named
/// twice counts once, a folder inside another start folder is part of it.
/// The order of the first mention stays.
pub fn merge_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, FsError> {
    if roots.is_empty() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "No start folder",
            None,
        ));
    }
    if roots.len() > MAX_ROOTS {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            format!("Too many start folders (max. {MAX_ROOTS})"),
            None,
        ));
    }
    let all: Vec<PathBuf> = roots.iter().map(|r| normalize_lexically(r)).collect();
    // shortest first: a parent is kept before its children are looked at
    let mut by_len: Vec<&PathBuf> = all.iter().collect();
    by_len.sort_by_key(|p| p.components().count());
    let mut kept: Vec<&PathBuf> = Vec::new();
    for p in by_len {
        if !kept.iter().any(|k| p.starts_with(k)) {
            kept.push(p);
        }
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for p in &all {
        if kept.contains(&p) && !out.contains(p) {
            out.push(p.clone());
        }
    }
    Ok(out)
}

/// Counters of the start folder being scanned.
#[derive(Default)]
struct RootStats {
    keep_files: u64,
    keep_bytes: u64,
    extensions: HashMap<String, u64>,
    keep_sample: Vec<KeptEntry>,
    too_large: u64,
    sample_too_large: u64,
    hidden: u64,
    links: u64,
    blocked: u64,
    junk_seen: u64,
    /// Extras that only a pattern or a typed name makes extras – what makes a
    /// folder a release leftover (system junk does not).
    real_extras: u64,
    /// Companions that were taken as extras.
    companions: u64,
}

/// A folder of a [`TreePlan`] as the walk saw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedDir {
    pub path: PathBuf,
    /// The junk files directly inside, each with its size at that moment.
    pub junk: Vec<(OsString, u64)>,
    /// Entries directly inside (junk files and folders that go).
    pub entries: usize,
    /// Its modification time before it was read (changes when an entry comes or goes).
    pub modified: Option<std::time::SystemTime>,
}

impl PlannedDir {
    /// Still a real folder with the same time stamp and number of entries (cheap:
    /// no file inside is looked at).
    pub fn unchanged(&self) -> bool {
        let Ok(meta) = fs::symlink_metadata(&self.path) else {
            return false;
        };
        meta.is_dir()
            && meta.modified().ok() == self.modified
            && fs::read_dir(&self.path).is_ok_and(|rd| rd.count() == self.entries)
    }
}

struct Ctx<'a> {
    m: &'a Matcher,
    o: &'a CleanOptions,
    cancel: &'a AtomicBool,
    /// The current start folder and whether it may go as a whole.
    root: PathBuf,
    root_may_go: bool,
    scan: CleanScan,
    stats: RootStats,
    /// Plan mode (the job): every folder that goes with *all* its junk names.
    plan: Option<Vec<PlannedDir>>,
    /// [`MAX_VISITED`] (tests use a small one).
    max_visited: u64,
    /// Companions count as extras in this walk – a first look that only stands if the
    /// start folder goes as a whole and holds a real extra ([`Ctx::companions_stand`]).
    companions: bool,
}

/// Where a walk began, to take it back ([`Ctx::rewind`]).
struct Mark {
    items: usize,
    unreadable: usize,
    unreadable_more: u64,
    visited: u64,
}

impl Ctx<'_> {
    fn mark(&self) -> Mark {
        Mark {
            items: self.scan.items.len(),
            unreadable: self.scan.unreadable.len(),
            unreadable_more: self.scan.unreadable_more,
            visited: self.scan.visited,
        }
    }

    /// Forgets everything the walk of the current start folder noted.
    fn rewind(&mut self, mark: &Mark) {
        self.scan.items.truncate(mark.items);
        self.scan.unreadable.truncate(mark.unreadable);
        self.scan.unreadable_more = mark.unreadable_more;
        self.scan.visited = mark.visited;
        self.stats = RootStats::default();
        if let Some(plan) = self.plan.as_mut() {
            plan.clear();
        }
    }

    /// The walk that took companions as extras stands: none was met, or the start
    /// folder goes as a whole (`went`) and holds a real extra. Otherwise companions
    /// are content, and the folder has to be walked again without them.
    fn companions_stand(&self, went: bool) -> bool {
        self.stats.companions == 0 || (went && self.stats.real_extras > 0)
    }

    /// Walks the start folder `root`; `true` = it goes as a whole. Companions
    /// (subtitles) are extras only in a start folder that goes as a whole with a real
    /// extra inside: a first walk takes them as extras, and if that does not hold, a
    /// second one decides with companions as content – so they never go on their
    /// own and never next to content, not even with `junk_dirs_beside_content`.
    fn root_walk(&mut self, root: &Path, dev: Option<u64>) -> bool {
        self.companions = self.m.has_companions() && self.root_may_go;
        if !self.companions {
            return self.dir(root, dev, true).is_some();
        }
        let mark = self.mark();
        let went = self.dir(root, dev, true).is_some();
        if self.scan.truncated || self.companions_stand(went) {
            if self.scan.truncated {
                // nothing of it is certain – and no folder listed with companions inside
                self.scan.items.truncate(mark.items);
            }
            return went;
        }
        self.rewind(&mark);
        self.companions = false;
        self.dir(root, dev, true).is_some()
    }

    fn unreadable(&mut self, path: &Path, e: &std::io::Error) {
        if self.scan.unreadable.len() < MAX_UNREADABLE {
            self.scan.unreadable.push(FsError::from_io(e, path));
        } else {
            self.scan.unreadable_more += 1;
        }
    }

    fn rel(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .map(path_string)
            .unwrap_or_else(|_| path_string(path))
    }

    fn push(&mut self, item: CleanItem) {
        if self.scan.items.len() >= MAX_ITEMS {
            self.scan.truncated = true;
            return;
        }
        self.scan.items.push(item);
    }

    /// Notes an entry that stays.
    fn keep(&mut self, path: &Path, bytes: u64, reason: KeepReason) {
        match reason {
            KeepReason::Content => {}
            KeepReason::TooLarge => self.stats.too_large += 1,
            KeepReason::SampleTooLarge => self.stats.sample_too_large += 1,
            KeepReason::Hidden => self.stats.hidden += 1,
            KeepReason::Link => self.stats.links += 1,
            KeepReason::Unreadable
            | KeepReason::OtherFs
            | KeepReason::Special
            | KeepReason::Package => self.stats.blocked += 1,
        }
        if self.stats.keep_sample.len() < MAX_KEEP_SAMPLE {
            let rel = self.rel(path);
            self.stats
                .keep_sample
                .push(KeptEntry { rel, bytes, reason });
        }
    }

    fn keep_file(&mut self, path: &Path, name: &str, bytes: u64, reason: KeepReason) {
        self.stats.keep_files += 1;
        self.stats.keep_bytes = self.stats.keep_bytes.saturating_add(bytes);
        if reason == KeepReason::Content
            && let Some((stem, ext)) = name.rsplit_once('.')
            && !stem.is_empty()
            && !ext.is_empty()
            && ext.chars().count() <= 10
        {
            let ext = format!(".{}", ext.to_lowercase());
            if self.stats.extensions.len() < MAX_EXTENSION_KINDS
                || self.stats.extensions.contains_key(&ext)
            {
                *self.stats.extensions.entry(ext).or_default() += 1;
            }
        }
        self.keep(path, bytes, reason);
    }

    /// Scans `dir` (a real folder on device `dev`). `Some(soft)` = it can go;
    /// `soft`: only because of pattern extras somewhere inside. A folder that
    /// stays keeps its "soft" children, too (design 077 E3).
    fn dir(&mut self, dir: &Path, dev: Option<u64>, is_root: bool) -> Option<bool> {
        let start = self.scan.items.len();
        let plan_start = self.plan.as_ref().map(Vec::len);
        let result = self.walk(dir, dev, is_root);
        if result.is_none() {
            if !self.o.junk_dirs_beside_content {
                // children first: every soft folder of this subtree lies in start..
                let mut i = 0;
                self.scan.items.retain(|it| {
                    let keep = i < start || !(it.kind == CleanKind::Dir && it.soft);
                    i += 1;
                    keep
                });
            }
            if let (Some(plan), Some(at)) = (self.plan.as_mut(), plan_start) {
                plan.truncate(at);
            }
        }
        result
    }

    fn walk(&mut self, dir: &Path, dev: Option<u64>, is_root: bool) -> Option<bool> {
        // plan mode: the time stamp from before the reading
        let modified = match self.plan {
            Some(_) => fs::symlink_metadata(dir).and_then(|m| m.modified()).ok(),
            None => None,
        };
        let rd = match fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(e) => {
                self.unreadable(dir, &e);
                self.keep(dir, 0, KeepReason::Unreadable);
                return None;
            }
        };
        let mut entries = 0usize;
        let mut removable = true;
        let mut soft = false;
        let mut junk = 0u32;
        let mut junk_bytes = 0u64;
        let mut junk_names: Vec<String> = Vec::new();
        let mut junk_all: Vec<(OsString, u64)> = Vec::new();
        for entry in rd {
            if self.cancel.load(Ordering::Relaxed) {
                self.scan.cancelled = true;
                self.scan.truncated = true;
                return None;
            }
            entries += 1;
            self.scan.visited += 1;
            if self.scan.visited > self.max_visited || self.scan.truncated {
                self.scan.truncated = true;
                return None;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    self.unreadable(dir, &e);
                    self.keep(dir, 0, KeepReason::Unreadable);
                    removable = false;
                    continue;
                }
            };
            let path = entry.path();
            let name = entry.file_name();
            // a name that is not UTF-8 could not be addressed again: content
            let Some(name) = name.to_str() else {
                self.keep(&path, 0, KeepReason::Special);
                removable = false;
                continue;
            };
            let Ok(ft) = entry.file_type() else {
                self.keep(&path, 0, KeepReason::Unreadable);
                removable = false;
                continue;
            };
            if ft.is_symlink() {
                self.keep(&path, 0, KeepReason::Link);
                removable = false; // never followed, never "empty"
            } else if ft.is_dir() {
                let meta = fs::symlink_metadata(&path).ok().filter(|m| m.is_dir());
                let same_fs = meta
                    .as_ref()
                    .is_some_and(|m| dev.is_none() || file_id(m).map(|f| f.0) == dev);
                // never entered (review 077 #2): `.git/refs/heads` is empty on purpose,
                // and so are folders inside a bundle
                if meta
                    .as_ref()
                    .is_some_and(|m| crate::listing::is_hidden(name, m))
                {
                    self.keep(&path, 0, KeepReason::Hidden);
                    removable = false;
                } else if is_package(name) {
                    self.keep(&path, 0, KeepReason::Package);
                    removable = false;
                } else if !same_fs {
                    self.keep(&path, 0, KeepReason::OtherFs);
                    removable = false;
                } else {
                    match self.dir(&path, dev, false) {
                        Some(child_soft) => soft |= child_soft,
                        None => removable = false,
                    }
                }
                if self.scan.truncated {
                    return None;
                }
            } else if ft.is_file() {
                // the entry's own metadata: a link is never followed here
                let Ok(meta) = entry.metadata() else {
                    self.keep_file(&path, name, 0, KeepReason::Unreadable);
                    removable = false;
                    continue;
                };
                if !meta.is_file() {
                    self.keep(&path, 0, KeepReason::Special);
                    removable = false;
                    continue;
                }
                let size = meta.len();
                let hidden = crate::listing::is_hidden(name, &meta);
                match self.m.classify(name, hidden, size) {
                    FileClass::Delete => {
                        if self.plan.is_some() {
                            // the job deletes pattern files first: one that is (still or
                            // newly) there was not confirmed as part of this folder
                            removable = false;
                        } else {
                            let rel = self.rel(&path);
                            self.push(CleanItem {
                                path: path_string(&path),
                                kind: CleanKind::File,
                                bytes: size,
                                rel,
                                ..CleanItem::default()
                            });
                        }
                    }
                    FileClass::Companion if !self.companions => {
                        self.keep_file(&path, name, size, KeepReason::Content);
                        removable = false;
                    }
                    class @ (FileClass::Junk { .. } | FileClass::Companion) => {
                        let pattern = match class {
                            FileClass::Junk { pattern } => {
                                self.stats.real_extras += u64::from(pattern);
                                pattern
                            }
                            _ => {
                                self.stats.companions += 1;
                                true
                            }
                        };
                        junk += 1;
                        junk_bytes = junk_bytes.saturating_add(size);
                        soft |= pattern;
                        self.stats.junk_seen += 1;
                        if junk_names.len() < MAX_JUNK_NAMES {
                            junk_names.push(name.to_string());
                        }
                        if self.plan.is_some() {
                            junk_all.push((entry.file_name(), size));
                        }
                    }
                    FileClass::Keep(reason) => {
                        self.keep_file(&path, name, size, reason);
                        removable = false;
                    }
                }
            } else {
                self.keep(&path, 0, KeepReason::Special);
                removable = false; // fifo, socket, device
            }
        }
        if !removable || !self.o.empty_dirs {
            return None;
        }
        if is_root && !self.root_may_go {
            // it could go, but must not (option, link, dangerous path): it stays –
            // and is then a folder with "content" like any other
            return None;
        }
        let rel = self.rel(dir);
        self.push(CleanItem {
            path: path_string(dir),
            kind: CleanKind::Dir,
            junk,
            junk_names,
            bytes: junk_bytes,
            rel,
            soft,
        });
        if let Some(plan) = self.plan.as_mut() {
            plan.push(PlannedDir {
                path: dir.to_path_buf(),
                junk: junk_all,
                entries,
                modified,
            });
        }
        Some(soft)
    }

    /// The verdict of the start folder just scanned (`first` = its first item).
    fn verdict(
        &mut self,
        root: &Path,
        first: usize,
        went: bool,
        danger: Option<Danger>,
        linked: bool,
    ) -> RootVerdict {
        let stats = std::mem::take(&mut self.stats);
        let items = &self.scan.items[first..];
        let incomplete = self.scan.truncated;
        let remove_dirs = items.iter().filter(|i| i.kind == CleanKind::Dir).count() as u64;
        let remove_files: u64 = items
            .iter()
            .map(|i| match i.kind {
                CleanKind::Dir => u64::from(i.junk),
                CleanKind::File => 1,
            })
            .sum();
        let junk_gone: u64 = items
            .iter()
            .filter(|i| i.kind == CleanKind::Dir)
            .map(|i| u64::from(i.junk))
            .sum();
        let remove_bytes = items.iter().fold(0u64, |a, i| a.saturating_add(i.bytes));
        let verdict = if incomplete {
            Verdict::Keep
        } else if went {
            Verdict::Residue
        } else if items.is_empty() {
            Verdict::Keep
        } else {
            Verdict::Partial
        };
        let mut ext: Vec<(String, u64)> = stats.extensions.into_iter().collect();
        ext.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        RootVerdict {
            path: path_string(root),
            name: root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path_string(root)),
            verdict,
            first,
            count: items.len(),
            remove_dirs,
            remove_files,
            remove_bytes,
            keep_files: stats.keep_files,
            keep_bytes: stats.keep_bytes,
            keep_extensions: ext
                .into_iter()
                .take(MAX_KEEP_EXTENSIONS)
                .map(|e| e.0)
                .collect(),
            keep_sample: stats.keep_sample,
            too_large: stats.too_large,
            sample_too_large: stats.sample_too_large,
            hidden: stats.hidden,
            links: stats.links,
            blocked: stats.blocked,
            junk_kept: stats.junk_seen.saturating_sub(junk_gone),
            danger,
            linked,
            incomplete,
        }
    }
}

/// Finds what "clean folders" would delete below `roots` (design 008 E3) –
/// without a home folder (tests, callers that never delete a start folder).
pub fn find_empty_dirs(roots: &[PathBuf], options: &CleanOptions) -> Result<CleanScan, FsError> {
    scan(roots, options, None, &AtomicBool::new(false))
}

/// [`find_empty_dirs`] that stops early (`cancelled`, nothing listed) once
/// `cancel` is set (review 008 #2).
pub fn find_empty_dirs_cancellable(
    roots: &[PathBuf],
    options: &CleanOptions,
    cancel: &AtomicBool,
) -> Result<CleanScan, FsError> {
    scan(roots, options, None, cancel)
}

/// The scan with a verdict per start folder (design 077). `home`: for the
/// danger check – a root, home or system folder never goes as a whole.
pub fn scan(
    roots: &[PathBuf],
    options: &CleanOptions,
    home: Option<&Path>,
    cancel: &AtomicBool,
) -> Result<CleanScan, FsError> {
    scan_limited(roots, options, home, cancel, MAX_VISITED)
}

fn scan_limited(
    roots: &[PathBuf],
    options: &CleanOptions,
    home: Option<&Path>,
    cancel: &AtomicBool,
    max_visited: u64,
) -> Result<CleanScan, FsError> {
    let roots = merge_roots(roots)?;
    let m = Matcher::new(options)?;
    let mut danger = DangerCheck::new(home);
    let mut ctx = Ctx {
        m: &m,
        o: options,
        cancel,
        root: PathBuf::new(),
        root_may_go: false,
        scan: CleanScan::default(),
        stats: RootStats::default(),
        plan: None,
        max_visited,
        companions: false,
    };
    for root in &roots {
        if ctx.scan.truncated {
            // not looked at: nothing of it is certain, nothing of it goes
            let first = ctx.scan.items.len();
            let v = ctx.verdict(root, first, false, None, false);
            ctx.scan.roots.push(v);
            continue;
        }
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
        // a linked start folder is never offered: the job deletes no link (review 008 #4)
        let linked = !fs::symlink_metadata(root).is_ok_and(|m| m.is_dir());
        let risk = danger.of(root);
        ctx.root = root.clone();
        ctx.root_may_go = options.include_roots && !linked && risk.is_none();
        let first = ctx.scan.items.len();
        let went = ctx.root_walk(root, dev);
        let v = ctx.verdict(root, first, went, risk, linked);
        ctx.scan.roots.push(v);
    }
    if ctx.scan.cancelled {
        ctx.scan.items.clear(); // a partial list must never be deleted
        for r in &mut ctx.scan.roots {
            r.verdict = Verdict::Keep;
            r.incomplete = true;
            r.first = 0;
            r.count = 0;
            r.remove_dirs = 0;
            r.remove_files = 0;
            r.remove_bytes = 0;
        }
    }
    Ok(ctx.scan)
}

/// What the job deletes when a folder goes as a whole (design 077 E6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreePlan {
    /// Every folder of the tree with the junk files directly inside – children
    /// before their parents, `top` last.
    pub dirs: Vec<PlannedDir>,
    /// "Empty" only because of pattern extras somewhere inside.
    pub soft: bool,
    pub files: u64,
    pub bytes: u64,
}

impl TreePlan {
    /// Nothing came or went in any folder of the plan since it was made (review 077 #3).
    pub fn unchanged(&self) -> bool {
        self.dirs.iter().all(PlannedDir::unchanged)
    }
}

/// Decides **now** whether the folder `top` (inside or equal to the start folder
/// `root`) can go as a whole – with the walk of the scan: links, other file
/// systems, hidden files, size limits, companions. `None`: it holds content (or
/// the walk hit a limit); nothing of it may be deleted then.
pub fn plan_tree(
    top: &Path,
    root: &Path,
    options: &CleanOptions,
    m: &Matcher,
    cancel: &AtomicBool,
) -> Result<Option<TreePlan>, FsError> {
    // the device of the start folder, as in the scan (which may reach it through a link)
    let root_meta = fs::metadata(root).map_err(|e| FsError::from_io(&e, root))?;
    let dev = file_id(&root_meta).map(|f| f.0);
    let meta = fs::symlink_metadata(top).map_err(|e| FsError::from_io(&e, top))?;
    if !meta.is_dir() || !(dev.is_none() || file_id(&meta).map(|f| f.0) == dev) {
        return Ok(None);
    }
    // below the start folder nothing hidden and no package is entered – the scan never
    // lists anything in there, so such an entry did not come from it (review 077 #2)
    if let Ok(rel) = top.strip_prefix(root) {
        let mut at = root.to_path_buf();
        for part in rel.components() {
            at.push(part);
            let name = part.as_os_str().to_string_lossy();
            let hidden =
                fs::symlink_metadata(&at).is_ok_and(|m| crate::listing::is_hidden(&name, &m));
            if hidden || is_package(&name) {
                return Ok(None);
            }
        }
    }
    let mut ctx = Ctx {
        m,
        o: options,
        cancel,
        root: top.to_path_buf(),
        root_may_go: true,
        scan: CleanScan::default(),
        stats: RootStats::default(),
        plan: Some(Vec::new()),
        max_visited: MAX_VISITED,
        // companions go only with a whole start folder; a folder below it lies next
        // to something that stays
        companions: m.has_companions() && top == root,
    };
    let Some(soft) = ctx.dir(top, dev, true) else {
        return Ok(None);
    };
    if ctx.scan.truncated || ctx.scan.cancelled {
        return Ok(None);
    }
    // … and only with a real extra: subtitles alone are content (no second walk
    // needed – without companions the folder holds content)
    if !ctx.companions_stand(true) {
        return Ok(None);
    }
    let dirs = ctx.plan.take().unwrap_or_default();
    // every listed entry is a folder here: pattern files make the walk say "stays"
    let files = ctx.scan.items.iter().map(|i| u64::from(i.junk)).sum();
    let bytes = ctx
        .scan
        .items
        .iter()
        .fold(0u64, |a, i| a.saturating_add(i.bytes));
    Ok(Some(TreePlan {
        dirs,
        soft,
        files,
        bytes,
    }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn opts() -> CleanOptions {
        CleanOptions::default()
    }

    fn names(scan: &CleanScan, base: &Path) -> Vec<String> {
        scan.items
            .iter()
            .map(|i| {
                let p = PathBuf::from(&i.path);
                // "/" between the parts on every system (Windows: `\`)
                let rel = p
                    .strip_prefix(base)
                    .unwrap_or(&p)
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
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
        // review 008 #1: patterns without a literal (or only dots) match (almost) every file
        for bad in [
            "a/b", "*", "**", "?", "?*", "*?*", "*.*", "**/*.*", ".", "*.", ".*", "?.?",
        ] {
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
    fn junk_may_be_name_patterns() {
        // design 045 E4: a release folder holding only extras (`*.nfo`, `Sample/*-sample.*`)
        // goes as a whole; with anything else in it, it stays (a junk-only child may go)
        let t = tempfile::tempdir().unwrap();
        let root = t.path().to_path_buf();
        let rel = root.join("Serie.S01E01.Grüße 🎬");
        fs::create_dir_all(rel.join("Sample")).unwrap();
        fs::write(rel.join("serie.s01e01.NFO"), "x").unwrap();
        fs::write(rel.join("Sample/serie.s01e01-sample.mkv"), "x").unwrap();
        let other = root.join("Serie.S01E02");
        fs::create_dir_all(other.join("Sample")).unwrap();
        fs::write(other.join("serie.s01e02.nfo"), "x").unwrap();
        fs::write(other.join("Sample/serie.s01e02-sample.mkv"), "x").unwrap();
        fs::write(other.join("serie.s01e02.mkv"), "x").unwrap(); // not moved: content
        let o = CleanOptions {
            include_roots: true,
            junk: vec!["*.nfo".into(), "*-sample.*".into(), ".DS_Store".into()],
            ..opts()
        };
        // design 077 E3: a folder with content is not gutted – `Sample/` next to the
        // film stays unless the option says otherwise (045 listed it always)
        let scan = find_empty_dirs(&[rel.clone(), other.clone()], &o).unwrap();
        assert_eq!(
            names(&scan, &root),
            ["Serie.S01E01.Grüße 🎬/Sample/", "Serie.S01E01.Grüße 🎬/"]
        );
        let gut = CleanOptions {
            junk_dirs_beside_content: true,
            ..o.clone()
        };
        let scan = find_empty_dirs(&[rel.clone(), other.clone()], &gut).unwrap();
        let got = names(&scan, &root);
        assert_eq!(
            got,
            [
                "Serie.S01E01.Grüße 🎬/Sample/",
                "Serie.S01E01.Grüße 🎬/",
                "Serie.S01E02/Sample/"
            ]
        );
        assert_eq!(
            scan.items.iter().map(|i| i.junk).collect::<Vec<_>>(),
            [1, 1, 1]
        );
        // the names go along, so the dialog can show what leaves with the folder (review 045 #2)
        assert_eq!(scan.items[1].junk_names, ["serie.s01e01.NFO"]);
        assert_eq!(scan.items[0].junk_names, ["serie.s01e01-sample.mkv"]);
        let m = Matcher::new(&o).unwrap();
        assert!(m.is_junk("A.NFO"));
        assert!(m.is_junk(".ds_store"));
        assert!(!m.is_junk("a.nfo.mkv"));
        assert!(!m.matches("a.nfo"), "junk is no delete pattern");
        // the same guard as for patterns: no literal → refused
        for bad in ["*", "*.*", "?", "a/b", "*\\x"] {
            assert!(
                Matcher::new(&CleanOptions {
                    junk: vec![bad.into()],
                    ..opts()
                })
                .is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_cancelled_scan_ends_early() {
        // review 008 #2: the scan stops at the token
        let t = tempfile::tempdir().unwrap();
        for i in 0..50 {
            fs::create_dir_all(t.path().join(format!("d{i}/e"))).unwrap();
        }
        let scan =
            find_empty_dirs_cancellable(&[t.path().to_path_buf()], &opts(), &AtomicBool::new(true))
                .unwrap();
        assert!(scan.cancelled);
        assert!(scan.items.is_empty());
        assert!(scan.visited <= 1, "{}", scan.visited);
        let scan = find_empty_dirs_cancellable(
            &[t.path().to_path_buf()],
            &opts(),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(!scan.cancelled);
        assert_eq!(scan.items.len(), 100);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_start_folder_is_never_listed_itself() {
        // review 008 #4: the job would refuse it (no link is deleted) – so the search does not offer it
        let t = tempfile::tempdir().unwrap();
        let empty = t.path().join("empty");
        fs::create_dir(&empty).unwrap();
        let link = t.path().join("link");
        std::os::unix::fs::symlink(&empty, &link).unwrap();
        let o = CleanOptions {
            include_roots: true,
            ..opts()
        };
        let scan = find_empty_dirs(std::slice::from_ref(&link), &o).unwrap();
        assert!(scan.items.is_empty(), "{:?}", scan.items);
        let scan = find_empty_dirs(std::slice::from_ref(&empty), &o).unwrap();
        assert_eq!(scan.items.len(), 1);
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
        // design 077 E3: nested and double start folders are merged (008 refused them)
        let scan = find_empty_dirs(
            &[
                t.path().join("a"),
                t.path().to_path_buf(),
                t.path().join("a"),
                t.path().join("a").join("."),
            ],
            &opts(),
        )
        .unwrap();
        assert_eq!(scan.roots.len(), 1);
        assert_eq!(scan.roots[0].path, path_string(t.path()));
        assert_eq!(names(&scan, t.path()), ["a/"]);
        assert_eq!(
            merge_roots(&[
                PathBuf::from("/x/b"),
                PathBuf::from("/x/a/1"),
                PathBuf::from("/x/a"),
                PathBuf::from("/x/b"),
                PathBuf::from("/x/ab"),
            ])
            .unwrap(),
            [
                PathBuf::from("/x/b"),
                PathBuf::from("/x/a"),
                PathBuf::from("/x/ab")
            ]
        );
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

    // ---- design 077: verdict per start folder ----

    /// The profile "release leftovers" as the frontend sends it.
    pub(crate) fn release() -> CleanOptions {
        CleanOptions {
            include_roots: true,
            junk: [
                ".DS_Store",
                "Thumbs.db",
                "desktop.ini",
                "*.nfo",
                "*.sfv",
                "*.srr",
                "*.md5",
                "*-proof.jpg",
                "*-proof.jpeg",
                "*-proof.png",
            ]
            .map(String::from)
            .to_vec(),
            // as `RELEASE_SAMPLES` in release-extras.ts: video endings only (review 077 #1)
            large_junk: [
                "mkv", "mp4", "avi", "m4v", "mov", "wmv", "ts", "mpg", "mpeg", "webm",
            ]
            .iter()
            .flat_map(|e| {
                [
                    format!("*-sample.{e}"),
                    format!("*.sample.{e}"),
                    format!("sample-*.{e}"),
                    format!("sample.{e}"),
                ]
            })
            .collect(),
            // as `RELEASE_SUBTITLES` in release-extras.ts
            companion_junk: ["idx", "sub", "srt", "ass", "ssa", "sup", "vtt"]
                .iter()
                .map(|e| format!("*.{e}"))
                .collect(),
            ..opts()
        }
    }

    /// The profile "only empty folders".
    fn only_empty() -> CleanOptions {
        CleanOptions {
            include_roots: true,
            junk: [".DS_Store", "Thumbs.db", "desktop.ini"]
                .map(String::from)
                .to_vec(),
            ..opts()
        }
    }

    fn sparse(path: &Path, len: u64) {
        fs::File::create(path).unwrap().set_len(len).unwrap();
    }

    /// Marc's four folders (`testdata/clean-marcs-tree.txt` = the example of prompt
    /// 077), files sparse in their real size. Returns the start folders in order.
    #[cfg(unix)]
    pub(crate) fn marcs_tree(base: &Path) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        for line in include_str!("testdata/clean-marcs-tree.txt").lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let (kind, rest) = line.split_once(' ').unwrap();
            let (size, rel) = rest.trim_start().split_once(' ').unwrap();
            let rel = rel.trim_start();
            let path = base.join(rel);
            match kind {
                "D" => {
                    fs::create_dir(&path).unwrap();
                    if !rel.contains('/') {
                        roots.push(path);
                    }
                }
                "F" => sparse(&path, size.parse().unwrap()),
                other => panic!("{other}"),
            }
        }
        assert_eq!(roots.len(), 4);
        roots
    }

    fn numbers(v: &RootVerdict) -> (Verdict, u64, u64, u64) {
        (v.verdict, v.remove_dirs, v.remove_files, v.remove_bytes)
    }

    #[cfg(unix)]
    #[test]
    fn marcs_tree_with_the_old_defaults_finds_nothing() {
        // the starting point of design 077 §1: no folder is literally empty
        let t = tempfile::tempdir().unwrap();
        let roots = marcs_tree(t.path());
        let scan = find_empty_dirs(&roots, &opts()).unwrap();
        assert!(scan.items.is_empty(), "{:?}", scan.items);
        assert!(scan.roots.iter().all(|r| r.verdict == Verdict::Keep));
        // by hand, as 008 + 045 allowed it: a flat list of eleven folders
        let by_hand = CleanOptions {
            include_roots: true,
            junk: vec!["*.nfo".into()],
            large_junk: vec!["*-sample.*".into()],
            ..opts()
        };
        let scan = find_empty_dirs(&roots, &by_hand).unwrap();
        assert_eq!(scan.items.len(), 11);
    }

    #[cfg(unix)]
    #[test]
    fn marcs_tree_release_leftovers() {
        // the acceptance numbers of prompt 077
        let t = tempfile::tempdir().unwrap();
        let roots = marcs_tree(t.path());
        let scan = scan(&roots, &release(), None, &AtomicBool::new(false)).unwrap();
        assert_eq!(scan.roots.len(), 4);
        let comics = &scan.roots[0];
        assert_eq!(comics.name, "Lustiges Taschenbuch - Europareise 01-03");
        assert_eq!(numbers(comics), (Verdict::Keep, 0, 0, 0));
        assert_eq!(comics.count, 0);
        assert_eq!(comics.keep_files, 3);
        assert_eq!(comics.keep_bytes, 765_215_206 + 785_569_449 + 415_393_679);
        assert_eq!(comics.keep_extensions, [".cbr"]);
        assert_eq!(comics.keep_sample.len(), 3);
        assert!(
            comics
                .keep_sample
                .iter()
                .all(|k| k.reason == KeepReason::Content)
        );
        assert_eq!(numbers(&scan.roots[1]), (Verdict::Residue, 2, 1, 736));
        assert_eq!(numbers(&scan.roots[2]), (Verdict::Residue, 2, 1, 647));
        assert_eq!(
            numbers(&scan.roots[3]),
            (Verdict::Residue, 7, 6, 212_024_204)
        );
        for r in &scan.roots[1..] {
            assert_eq!((r.keep_files, r.keep_bytes, r.junk_kept), (0, 0, 0));
            assert!(r.keep_sample.is_empty() && r.danger.is_none() && !r.incomplete);
            // its section of the list ends with the start folder itself
            let own = &scan.items[r.first..r.first + r.count];
            assert_eq!(own.len() as u64, r.remove_dirs);
            assert_eq!(own.last().unwrap().path, r.path);
            assert_eq!(own.last().unwrap().rel, "");
            assert!(own.iter().all(|i| i.soft && i.path.starts_with(&r.path)));
        }
        // sums of the dialog: 11 folders, 8 files
        assert_eq!(scan.items.len(), 11);
        assert_eq!(scan.roots.iter().map(|r| r.remove_files).sum::<u64>(), 8);
        // children before parents inside MobLand
        let mob = &scan.roots[3];
        let rels: Vec<&str> = scan.items[mob.first..mob.first + mob.count]
            .iter()
            .map(|i| i.rel.as_str())
            .collect();
        let pos = |n: &str| rels.iter().position(|r| *r == n).unwrap();
        let e8 = "MobLand.S02E08.GERMAN.DL.1080P.WEB.H264-WAYNE";
        assert!(pos(&format!("{e8}/Sample")) < pos(e8) && pos(e8) < pos(""));
        // nothing was written
        assert!(roots.iter().all(|r| r.is_dir()));
    }

    #[cfg(unix)]
    #[test]
    fn marcs_tree_only_empty_folders_keeps_all_four() {
        let t = tempfile::tempdir().unwrap();
        let roots = marcs_tree(t.path());
        let scan = scan(&roots, &only_empty(), None, &AtomicBool::new(false)).unwrap();
        assert!(scan.items.is_empty());
        assert_eq!(
            scan.roots
                .iter()
                .map(|r| (r.verdict, r.keep_files))
                .collect::<Vec<_>>(),
            [
                (Verdict::Keep, 3),
                (Verdict::Keep, 1),
                (Verdict::Keep, 1),
                (Verdict::Keep, 6)
            ]
        );
        assert_eq!(scan.roots[1].keep_extensions, [".nfo"]);
    }

    #[test]
    fn the_three_verdicts_and_no_gutting() {
        let t = tempfile::tempdir().unwrap();
        let base = t.path();
        // residue: an empty folder, and one with nothing but extras
        fs::create_dir_all(base.join("leer")).unwrap();
        fs::create_dir_all(base.join("rest/Sample")).unwrap();
        fs::write(base.join("rest/a.nfo"), "12345").unwrap();
        fs::write(base.join("rest/Sample/a-sample.mkv"), "1234567").unwrap();
        fs::write(base.join("rest/.DS_Store"), "x").unwrap();
        // partial: a film, its nfo, an empty folder and a sample folder
        let film = base.join("Film ä");
        fs::create_dir_all(film.join("leer/tiefer")).unwrap();
        fs::create_dir_all(film.join("Sample")).unwrap();
        fs::write(film.join("film.mkv"), "0123456789").unwrap();
        fs::write(film.join("film.nfo"), "x").unwrap();
        fs::write(film.join("Sample/film-sample.mkv"), "xy").unwrap();
        // keep: only content
        fs::create_dir_all(base.join("voll")).unwrap();
        fs::write(base.join("voll/a.txt"), "x").unwrap();
        fs::write(base.join("voll/b.TXT"), "x").unwrap();
        fs::write(base.join("voll/c.pdf"), "x").unwrap();
        let roots = ["leer", "rest", "Film ä", "voll"].map(|n| base.join(n));
        let scan = scan(&roots, &release(), None, &AtomicBool::new(false)).unwrap();
        assert_eq!(numbers(&scan.roots[0]), (Verdict::Residue, 1, 0, 0));
        assert_eq!(numbers(&scan.roots[1]), (Verdict::Residue, 2, 3, 13));
        // only the really empty folders go; film, nfo and Sample/ stay
        let f = &scan.roots[2];
        assert_eq!(numbers(f), (Verdict::Partial, 2, 0, 0));
        assert_eq!(
            scan.items[f.first..f.first + f.count]
                .iter()
                .map(|i| i.rel.replace('\\', "/"))
                .collect::<Vec<_>>(),
            ["leer/tiefer", "leer"]
        );
        assert_eq!((f.keep_files, f.keep_bytes, f.junk_kept), (1, 10, 2));
        assert_eq!(f.keep_extensions, [".mkv"]);
        let v = &scan.roots[3];
        assert_eq!(numbers(v), (Verdict::Keep, 0, 0, 0));
        assert_eq!(v.keep_extensions, [".txt", ".pdf"]);
        // with the option the sample folder goes as well – never the film or the nfo beside it
        let gut = CleanOptions {
            junk_dirs_beside_content: true,
            ..release()
        };
        let scan = scan_limited(&roots, &gut, None, &AtomicBool::new(false), MAX_VISITED).unwrap();
        let f = &scan.roots[2];
        assert_eq!(numbers(f), (Verdict::Partial, 3, 1, 2));
        assert_eq!(f.junk_kept, 1);
        assert!(
            scan.items
                .iter()
                .all(|i| i.kind == CleanKind::Dir && !i.path.ends_with("film.nfo"))
        );
        // the panel's own folder never goes as a whole: its extras-only children are
        // "next to content" then
        let own = CleanOptions {
            include_roots: false,
            ..release()
        };
        let scan = find_empty_dirs(&[base.join("rest")], &own).unwrap();
        assert_eq!(numbers(&scan.roots[0]), (Verdict::Keep, 0, 0, 0));
        assert_eq!(scan.roots[0].junk_kept, 3);
    }

    #[test]
    fn size_limits_turn_extras_into_content() {
        let t = tempfile::tempdir().unwrap();
        let base = t.path();
        let o = CleanOptions {
            junk_max_bytes: 10,
            large_junk_max_bytes: 100,
            ..release()
        };
        let mk = |name: &str, files: &[(&str, u64)]| {
            let d = base.join(name);
            fs::create_dir_all(d.join("Sample")).unwrap();
            for (f, len) in files {
                sparse(&d.join(f), *len);
            }
            d
        };
        let roots = [
            // exactly on both limits: extras
            mk("ok", &[("a.nfo", 10), ("Sample/a-sample.mkv", 100)]),
            // one byte more
            mk("nfo", &[("a.nfo", 11)]),
            mk("sample", &[("Sample/a-sample.mkv", 101)]),
            // an exact junk name has no limit
            mk("store", &[(".DS_Store", 5000)]),
        ];
        let scan = find_empty_dirs(&roots, &o).unwrap();
        assert_eq!(numbers(&scan.roots[0]), (Verdict::Residue, 2, 2, 110));
        let nfo = &scan.roots[1];
        // its empty `Sample` folder may still go; the folder itself stays
        assert_eq!(numbers(nfo), (Verdict::Partial, 1, 0, 0));
        assert_eq!((nfo.too_large, nfo.keep_files, nfo.keep_bytes), (1, 1, 11));
        assert_eq!(nfo.keep_sample[0].reason, KeepReason::TooLarge);
        let sample = &scan.roots[2];
        assert_eq!(numbers(sample), (Verdict::Keep, 0, 0, 0));
        assert_eq!(sample.sample_too_large, 1);
        assert_eq!(sample.keep_sample[0].reason, KeepReason::SampleTooLarge);
        assert_eq!(numbers(&scan.roots[3]), (Verdict::Residue, 2, 1, 5000));
        // a missing field never means "no limit"
        let parsed: CleanOptions = serde_json::from_str(r#"{"junk":["*.nfo"]}"#).unwrap();
        assert_eq!(parsed.junk_max_bytes, DEFAULT_JUNK_MAX_BYTES);
        assert_eq!(parsed.large_junk_max_bytes, DEFAULT_LARGE_JUNK_MAX_BYTES);
        assert!(!parsed.junk_dirs_beside_content && !parsed.include_roots);
        // an exact sample name is fine (it has the sample limit); everything-patterns are not
        assert!(
            Matcher::new(&CleanOptions {
                large_junk: vec!["sample.mkv".into()],
                ..opts()
            })
            .is_ok()
        );
        for bad in ["*", "*.*", "a/b*"] {
            assert!(
                Matcher::new(&CleanOptions {
                    large_junk: vec![bad.into()],
                    ..opts()
                })
                .is_err(),
                "{bad}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_huge_sample_keeps_its_folder() {
        // prompt 077: `Sample/film-sample.mkv` with 4 GiB is no sample
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Film (2025)");
        fs::create_dir_all(root.join("Sample")).unwrap();
        fs::write(root.join("film.nfo"), "x").unwrap();
        sparse(&root.join("Sample/film-sample.mkv"), 4 * 1024 * 1024 * 1024);
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        let v = &scan.roots[0];
        assert_eq!(numbers(v), (Verdict::Keep, 0, 0, 0));
        assert_eq!((v.sample_too_large, v.keep_files), (1, 1));
        assert_eq!(v.keep_bytes, 4 * 1024 * 1024 * 1024);
        // 300 MiB exactly still is one
        sparse(&root.join("Sample/film-sample.mkv"), 300 * 1024 * 1024);
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Residue);
    }

    #[test]
    fn hidden_files_are_content_unless_named_exactly() {
        let t = tempfile::tempdir().unwrap();
        let a = t.path().join("a");
        let b = t.path().join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join(".geheim.nfo"), "x").unwrap();
        fs::write(a.join("x.nfo"), "x").unwrap();
        fs::write(b.join(".DS_Store"), "x").unwrap();
        fs::write(b.join("x.nfo"), "x").unwrap();
        let scan = find_empty_dirs(&[a, b], &release()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Keep);
        assert_eq!(scan.roots[0].hidden, 1);
        assert_eq!(scan.roots[0].keep_sample[0].reason, KeepReason::Hidden);
        assert_eq!(numbers(&scan.roots[1]), (Verdict::Residue, 1, 2, 2));
        let m = Matcher::new(&release()).unwrap();
        assert_eq!(
            m.classify(".x.nfo", true, 1),
            FileClass::Keep(KeepReason::Hidden)
        );
        assert_eq!(
            m.classify("X.NFO", false, 1),
            FileClass::Junk { pattern: true }
        );
        assert_eq!(
            m.classify("thumbs.db", true, u64::MAX),
            FileClass::Junk { pattern: false }
        );
        assert_eq!(
            m.classify("film.mkv", false, 1),
            FileClass::Keep(KeepReason::Content)
        );
    }

    #[cfg(unix)]
    #[test]
    fn links_and_unreadable_folders_hold_a_residue() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let outside = t.path().join("outside");
        fs::create_dir_all(outside.join("leer")).unwrap();
        let linked = t.path().join("mit link");
        fs::create_dir_all(&linked).unwrap();
        fs::write(linked.join("a.nfo"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, linked.join("raus")).unwrap();
        let locked = t.path().join("gesperrt");
        fs::create_dir_all(locked.join("zu/innen")).unwrap();
        fs::set_permissions(locked.join("zu"), fs::Permissions::from_mode(0o000)).unwrap();
        let readable = fs::read_dir(locked.join("zu")).is_ok();
        let scan = find_empty_dirs(&[linked.clone(), locked.clone()], &release()).unwrap();
        fs::set_permissions(locked.join("zu"), fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(numbers(&scan.roots[0]), (Verdict::Keep, 0, 0, 0));
        assert_eq!(scan.roots[0].links, 1);
        assert_eq!(scan.roots[0].keep_sample[0].reason, KeepReason::Link);
        assert!(outside.join("leer").is_dir());
        if !readable {
            assert_eq!(numbers(&scan.roots[1]), (Verdict::Keep, 0, 0, 0));
            assert_eq!(scan.roots[1].blocked, 1);
            assert_eq!(scan.unreadable.len(), 1);
        }
        // a start folder reached through a link never goes as a whole
        let empty = t.path().join("leer");
        fs::create_dir(&empty).unwrap();
        let link = t.path().join("link");
        std::os::unix::fs::symlink(&empty, &link).unwrap();
        let scan = find_empty_dirs(&[link], &release()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Keep);
        assert!(scan.roots[0].linked);
    }

    #[test]
    fn a_home_folder_never_goes_as_a_whole() {
        let t = tempfile::tempdir().unwrap();
        let home = t.path().join("home");
        fs::create_dir_all(home.join("leer")).unwrap();
        let scan = scan(
            std::slice::from_ref(&home),
            &release(),
            Some(&home),
            &AtomicBool::new(false),
        )
        .unwrap();
        let v = &scan.roots[0];
        assert_eq!(v.danger, Some(Danger::Home));
        // its empty child may go, the home folder stays
        assert_eq!(numbers(v), (Verdict::Partial, 1, 0, 0));
        assert!(scan.items.iter().all(|i| i.path != v.path));
        // without the danger it would be a residue
        let scan = scan_limited(
            std::slice::from_ref(&home),
            &release(),
            None,
            &AtomicBool::new(false),
            MAX_VISITED,
        )
        .unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Residue);
    }

    #[test]
    fn a_scan_at_its_limit_is_incomplete() {
        let t = tempfile::tempdir().unwrap();
        let a = t.path().join("a");
        let b = t.path().join("b");
        for i in 0..20 {
            fs::create_dir_all(a.join(format!("d{i}"))).unwrap();
        }
        fs::create_dir_all(&b).unwrap();
        let roots = [a.clone(), b.clone()];
        let scan = scan_limited(&roots, &release(), None, &AtomicBool::new(false), 10).unwrap();
        assert!(scan.truncated);
        assert_eq!(scan.roots.len(), 2);
        // nothing of a started or an unvisited start folder is certain
        for r in &scan.roots {
            assert_eq!(r.verdict, Verdict::Keep);
            assert!(r.incomplete);
        }
        assert!(scan.items.iter().all(|i| i.path != path_string(&a)));
        assert!(scan.items.len() <= 10);
        // complete: both are residues
        let scan = find_empty_dirs(&roots, &release()).unwrap();
        assert!(scan.roots.iter().all(|r| r.verdict == Verdict::Residue));
        // cancelled: verdicts without anything to delete
        let scan = scan_limited(&roots, &release(), None, &AtomicBool::new(true), 10).unwrap();
        assert!(scan.cancelled && scan.items.is_empty());
        assert!(scan.roots.iter().all(|r| r.count == 0 && r.incomplete));
    }

    // ---- addendum 26.11.2026: subtitles are companions of a release leftover ----

    /// Marc's folder "Tigerland (2000)": the film is gone, sample, proof, nfo and
    /// subtitles are left. Returns the start folder.
    pub(crate) fn tigerland(base: &Path) -> PathBuf {
        let root = base.join("Tigerland (2000)");
        let rel = root.join("Tigerland.2000.German.DL.1080p.BluRay.x264-DETAiLS");
        for d in ["Proof", "Sample", "Subs"] {
            fs::create_dir_all(rel.join(d)).unwrap();
        }
        for (f, len) in [
            ("Proof/d-tigerland-1080p-proof.jpg", 176_000u64),
            ("Sample/d-tigerland-1080p-sample.mkv", 91_800_000),
            ("Subs/d-tigerland-1080p-eng.idx", 59_000),
            ("Subs/d-tigerland-1080p-eng.sub", 9_400_000),
            ("Subs/d-tigerland-1080p.idx", 59_000),
            ("Subs/d-tigerland-1080p.sub", 10_100_000),
            ("d-tigerland-1080p.nfo", 6_600),
        ] {
            sparse(&rel.join(f), len);
        }
        root
    }

    pub(crate) const TIGERLAND_BYTES: u64 =
        176_000 + 91_800_000 + 2 * 59_000 + 9_400_000 + 10_100_000 + 6_600;

    #[test]
    fn subtitles_go_with_a_release_leftover() {
        let t = tempfile::tempdir().unwrap();
        let root = tigerland(t.path());
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        let v = &scan.roots[0];
        // the start folder, the release folder, Proof, Sample, Subs – 7 files
        assert_eq!(
            numbers(v),
            (Verdict::Residue, 5, 7, TIGERLAND_BYTES),
            "{v:?}"
        );
        assert_eq!((v.keep_files, v.junk_kept), (0, 0));
        assert_eq!(scan.items.last().unwrap().path, path_string(&root));
        assert!(scan.items.iter().all(|i| i.soft));
        // without the companions (the rule before): the subtitles are content
        let before = CleanOptions {
            companion_junk: Vec::new(),
            ..release()
        };
        let scan = find_empty_dirs(std::slice::from_ref(&root), &before).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Keep);
        assert_eq!(scan.roots[0].keep_files, 4);
        // the panel's own folder never goes: then nothing of it goes, subtitles are content
        let own = CleanOptions {
            include_roots: false,
            ..release()
        };
        let scan = find_empty_dirs(std::slice::from_ref(&root), &own).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Keep, "{:?}", scan.items);
        assert_eq!(scan.roots[0].keep_files, 4);
        assert!(scan.items.is_empty());
    }

    #[test]
    fn subtitles_alone_are_content() {
        let t = tempfile::tempdir().unwrap();
        // a collection of subtitles, with system junk – but no release extra
        let subs = t.path().join("Untertitel ä");
        fs::create_dir_all(subs.join("Subs")).unwrap();
        fs::write(subs.join("film.de.srt"), "1").unwrap();
        fs::write(subs.join("Subs/film.idx"), "22").unwrap();
        fs::write(subs.join("Subs/film.sub"), "333").unwrap();
        fs::write(subs.join(".DS_Store"), "x").unwrap();
        // index files only
        let idx = t.path().join("idx");
        fs::create_dir(&idx).unwrap();
        fs::write(idx.join("a.idx"), "1").unwrap();
        // a visit counter and the unreadable list must not count twice
        let scan = find_empty_dirs(&[subs.clone(), idx.clone()], &release()).unwrap();
        for v in &scan.roots {
            assert_eq!(v.verdict, Verdict::Keep, "{v:?}");
            assert_eq!(v.count, 0);
        }
        assert!(scan.items.is_empty(), "{:?}", scan.items);
        let v = &scan.roots[0];
        assert_eq!((v.keep_files, v.keep_bytes, v.junk_kept), (3, 6, 1));
        assert!(
            v.keep_sample
                .iter()
                .all(|k| k.reason == KeepReason::Content)
        );
        assert_eq!(scan.roots[1].keep_extensions, [".idx"]);
        assert_eq!(scan.visited, 6, "the second look does not count again");
        // one release extra anywhere in the start folder, and they are its companions
        fs::write(subs.join("Subs/film.nfo"), "n").unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&subs), &release()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Residue);
        // a hidden subtitle is content, as for every pattern
        fs::write(subs.join(".x.srt"), "h").unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&subs), &release()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Keep);
        assert_eq!((scan.roots[0].hidden, scan.roots[0].keep_files), (1, 4));
    }

    #[test]
    fn subtitles_next_to_a_film_always_stay() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Film (2000)");
        for d in ["Subs", "Sample", "Extras"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        fs::write(root.join("film.mkv"), "film").unwrap();
        fs::write(root.join("film.nfo"), "n").unwrap();
        fs::write(root.join("Subs/film.idx"), "i").unwrap();
        fs::write(root.join("Subs/film.sub"), "s").unwrap();
        fs::write(root.join("Sample/film-sample.mkv"), "x").unwrap();
        // subtitles with a real extra beside them, in a folder next to the film
        fs::write(root.join("Extras/film.eng.srt"), "s").unwrap();
        fs::write(root.join("Extras/x.sfv"), "s").unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Keep);
        assert!(scan.items.is_empty(), "{:?}", scan.items);
        // gutting takes the sample folder – never a folder with subtitles
        let gut = CleanOptions {
            junk_dirs_beside_content: true,
            ..release()
        };
        let scan = find_empty_dirs(std::slice::from_ref(&root), &gut).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Partial);
        assert_eq!(names(&scan, &root), ["Sample/"]);
        assert_eq!(scan.roots[0].keep_files, 4, "film and three subtitles");
        // the same below a folder that must not go (the panel's own)
        let lib = t.path().join("Filme");
        let left = tigerland(&lib);
        let own = CleanOptions {
            include_roots: false,
            ..gut.clone()
        };
        let scan = find_empty_dirs(std::slice::from_ref(&lib), &own).unwrap();
        let got = names(&scan, &left);
        assert_eq!(got.len(), 2, "{got:?}");
        assert!(
            got.iter()
                .all(|n| n.ends_with("/Proof/") || n.ends_with("/Sample/"))
        );
    }

    #[test]
    fn a_huge_subtitle_is_content() {
        let t = tempfile::tempdir().unwrap();
        let root = tigerland(t.path());
        let sub = root.join("Tigerland.2000.German.DL.1080p.BluRay.x264-DETAiLS/Subs/big.sup");
        sparse(&sub, COMPANION_MAX_BYTES + 1);
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        let v = &scan.roots[0];
        assert_eq!(v.verdict, Verdict::Keep, "{v:?}");
        // all subtitles are content then, not only the big one
        assert_eq!(v.keep_files, 5);
        assert!(scan.items.is_empty());
        // exactly at the limit it is a companion
        sparse(&sub, COMPANION_MAX_BYTES);
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Residue);
        // the limits of the form do not reach companions
        let tight = CleanOptions {
            large_junk_max_bytes: 100_000_000,
            ..release()
        };
        let scan = find_empty_dirs(std::slice::from_ref(&root), &tight).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Residue);
    }

    #[test]
    fn plan_tree_knows_companions_only_for_a_whole_start_folder() {
        let t = tempfile::tempdir().unwrap();
        let root = tigerland(t.path());
        let rel = root.join("Tigerland.2000.German.DL.1080p.BluRay.x264-DETAiLS");
        let o = release();
        let m = Matcher::new(&o).unwrap();
        let never = AtomicBool::new(false);
        let plan = plan_tree(&root, &root, &o, &m, &never).unwrap().unwrap();
        assert!(plan.soft);
        assert_eq!(
            (plan.files, plan.bytes, plan.dirs.len()),
            (7, TIGERLAND_BYTES, 5)
        );
        let subs = plan.dirs.iter().find(|d| d.path.ends_with("Subs")).unwrap();
        assert_eq!(subs.junk.len(), 4);
        // a folder below the start folder lies next to something that stays
        assert_eq!(plan_tree(&rel, &root, &o, &m, &never).unwrap(), None);
        assert_eq!(
            plan_tree(&rel.join("Subs"), &root, &o, &m, &never).unwrap(),
            None
        );
        assert!(
            plan_tree(&rel.join("Sample"), &root, &o, &m, &never)
                .unwrap()
                .is_some()
        );
        // the real extras went meanwhile: subtitles alone are content
        fs::remove_file(rel.join("d-tigerland-1080p.nfo")).unwrap();
        fs::remove_dir_all(rel.join("Proof")).unwrap();
        fs::remove_dir_all(rel.join("Sample")).unwrap();
        assert_eq!(plan_tree(&root, &root, &o, &m, &never).unwrap(), None);
    }

    #[test]
    fn companion_patterns_are_checked_and_optional() {
        // an old job spec has no such field: off
        let o: CleanOptions = serde_json::from_str("{}").unwrap();
        assert!(o.companion_junk.is_empty());
        let o: CleanOptions = serde_json::from_str(r#"{"companionJunk":["*.srt"]}"#).unwrap();
        assert_eq!(o.companion_junk, ["*.srt"]);
        for bad in ["*", "*.*", "a/b.srt"] {
            let o = CleanOptions {
                companion_junk: vec![bad.into()],
                ..opts()
            };
            assert!(Matcher::new(&o).is_err(), "{bad}");
        }
        let many = CleanOptions {
            companion_junk: vec!["*.srt".into(); MAX_NAMES + 1],
            ..opts()
        };
        assert!(Matcher::new(&many).is_err());
    }

    #[test]
    fn plan_tree_decides_again() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("rest ü");
        fs::create_dir_all(root.join("rel/Sample")).unwrap();
        fs::write(root.join("rel/a.nfo"), "123").unwrap();
        fs::write(root.join("rel/Sample/a-sample.mkv"), "12345").unwrap();
        fs::create_dir_all(root.join("leer")).unwrap();
        let o = release();
        let m = Matcher::new(&o).unwrap();
        let never = AtomicBool::new(false);
        let plan = plan_tree(&root, &root, &o, &m, &never).unwrap().unwrap();
        assert!(plan.soft);
        assert_eq!((plan.files, plan.bytes, plan.dirs.len()), (2, 8, 4));
        assert_eq!(plan.dirs.last().unwrap().path, root);
        assert_eq!(plan.dirs.last().unwrap().entries, 2);
        let sample = plan
            .dirs
            .iter()
            .find(|d| d.path.ends_with("Sample"))
            .unwrap();
        assert_eq!(sample.junk, [(OsString::from("a-sample.mkv"), 5)]);
        // review 077 #3: the cheap check right before the trash
        assert!(plan.unchanged());
        fs::write(root.join("rel/Sample/neu.mkv"), "x").unwrap();
        assert!(!plan.unchanged());
        fs::remove_file(root.join("rel/Sample/neu.mkv")).unwrap();
        // a really empty folder is no soft one
        let plan = plan_tree(&root.join("leer"), &root, &o, &m, &never)
            .unwrap()
            .unwrap();
        assert!(!plan.soft);
        assert_eq!(plan.dirs.len(), 1);
        // a film arrived
        fs::write(root.join("rel/film.mkv"), "x").unwrap();
        assert_eq!(plan_tree(&root, &root, &o, &m, &never).unwrap(), None);
        assert_eq!(
            plan_tree(&root.join("rel"), &root, &o, &m, &never).unwrap(),
            None
        );
        assert!(
            plan_tree(&root.join("rel/Sample"), &root, &o, &m, &never)
                .unwrap()
                .is_some()
        );
        fs::remove_file(root.join("rel/film.mkv")).unwrap();
        // a file of a delete pattern was not part of what the user confirmed for the folder
        let with_pattern = CleanOptions {
            patterns: vec!["*.bak".into()],
            ..o.clone()
        };
        let mp = Matcher::new(&with_pattern).unwrap();
        fs::write(root.join("leer/x.bak"), "x").unwrap();
        assert_eq!(
            plan_tree(&root, &root, &with_pattern, &mp, &never).unwrap(),
            None
        );
        // a file is no folder, a missing one an error
        assert_eq!(
            plan_tree(&root.join("rel/a.nfo"), &root, &o, &m, &never).unwrap(),
            None
        );
        assert!(plan_tree(&root.join("fehlt"), &root, &o, &m, &never).is_err());
    }

    #[test]
    fn the_scan_is_serialised_as_the_frontend_reads_it() {
        // DTO contract with `core/folders/folders.models.ts` (CLAUDE.md §4)
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("r");
        fs::create_dir_all(root.join("leer")).unwrap();
        fs::write(root.join("film.mkv"), "x").unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        let v = serde_json::to_value(&scan).unwrap();
        let keys = |v: &serde_json::Value| -> Vec<String> {
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort();
            k
        };
        assert_eq!(
            keys(&v),
            [
                "cancelled",
                "items",
                "roots",
                "truncated",
                "unreadable",
                "unreadableMore",
                "visited"
            ]
        );
        assert_eq!(
            keys(&v["roots"][0]),
            [
                "blocked",
                "count",
                "danger",
                "first",
                "hidden",
                "incomplete",
                "junkKept",
                "keepBytes",
                "keepExtensions",
                "keepFiles",
                "keepSample",
                "linked",
                "links",
                "name",
                "path",
                "removeBytes",
                "removeDirs",
                "removeFiles",
                "sampleTooLarge",
                "tooLarge",
                "verdict"
            ]
        );
        assert_eq!(v["roots"][0]["verdict"], "partial");
        assert_eq!(v["roots"][0]["danger"], serde_json::Value::Null);
        assert_eq!(
            keys(&v["roots"][0]["keepSample"][0]),
            ["bytes", "reason", "rel"]
        );
        assert_eq!(v["roots"][0]["keepSample"][0]["reason"], "content");
        assert_eq!(
            keys(&v["items"][0]),
            ["bytes", "junk", "kind", "path", "rel", "soft"]
        );
        assert_eq!(v["items"][0]["kind"], "dir");
        for (reason, name) in [
            (KeepReason::SampleTooLarge, "sampleTooLarge"),
            (KeepReason::TooLarge, "tooLarge"),
            (KeepReason::OtherFs, "otherFs"),
        ] {
            assert_eq!(serde_json::to_value(reason).unwrap(), name);
        }
        assert_eq!(serde_json::to_value(Verdict::Residue).unwrap(), "residue");
    }

    // ---- review 077 ----

    #[test]
    fn documents_named_like_samples_are_content() {
        // review 077 #1: the release profile must not reach ordinary documents
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Vorlagen");
        fs::create_dir_all(root.join("Favoriten")).unwrap();
        fs::create_dir_all(root.join("Sample")).unwrap();
        for f in [
            "sample-vertrag.docx",
            "Angebot-sample.xlsx",
            "config.sample.json",
            "sample.txt",
            "Abnahme-proof.pdf",
            "Favoriten/Bank.url",
            "Sample/notizen.txt",
        ] {
            fs::write(root.join(f), "x").unwrap();
        }
        let scan = find_empty_dirs(std::slice::from_ref(&root), &release()).unwrap();
        let v = &scan.roots[0];
        assert_eq!(numbers(v), (Verdict::Keep, 0, 0, 0));
        assert_eq!((v.keep_files, v.junk_kept), (7, 0));
        // what a release really leaves behind still counts
        let m = Matcher::new(&release()).unwrap();
        for junk in [
            "film-sample.mkv",
            "Film.Sample.MP4",
            "sample-film.avi",
            "sample.mkv",
            "film-proof.jpg",
            "x.nfo",
        ] {
            assert!(
                matches!(m.classify(junk, false, 1), FileClass::Junk { .. }),
                "{junk}"
            );
        }
    }

    #[test]
    fn hidden_and_package_folders_are_content_and_never_entered() {
        // review 077 #2: a git repository after `git pack-refs --all` – its empty
        // `refs/heads`, `objects/pack` … must stay; the same for bundles
        let t = tempfile::tempdir().unwrap();
        let repo = t.path().join("repo");
        fs::create_dir_all(repo.join(".git/refs/heads")).unwrap();
        fs::create_dir_all(repo.join(".git/objects/pack")).unwrap();
        fs::create_dir_all(repo.join("Tool.APP/Contents/Resources")).unwrap();
        fs::create_dir_all(repo.join("Fotos.photoslibrary/database")).unwrap();
        fs::create_dir_all(repo.join("src/leer")).unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&repo), &only_empty()).unwrap();
        assert_eq!(names(&scan, &repo), ["src/leer/", "src/"]);
        let v = &scan.roots[0];
        assert_eq!(v.verdict, Verdict::Partial);
        assert_eq!((v.hidden, v.blocked), (1, 2));
        let mut kept: Vec<(String, KeepReason)> = v
            .keep_sample
            .iter()
            .map(|k| (k.rel.clone(), k.reason))
            .collect();
        kept.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(
            kept,
            [
                (".git".to_string(), KeepReason::Hidden),
                ("Fotos.photoslibrary".to_string(), KeepReason::Package),
                ("Tool.APP".to_string(), KeepReason::Package),
            ]
        );
        // the job's walk says the same – also for a folder inside
        let o = only_empty();
        let m = Matcher::new(&o).unwrap();
        let never = AtomicBool::new(false);
        for inside in [".git", ".git/refs", ".git/refs/heads", "Tool.APP/Contents"] {
            assert_eq!(
                plan_tree(&repo.join(inside), &repo, &o, &m, &never).unwrap(),
                None,
                "{inside}"
            );
        }
        assert_eq!(plan_tree(&repo, &repo, &o, &m, &never).unwrap(), None);
        // a hidden folder the user marked himself is his choice – what is hidden inside is not
        let own = t.path().join(".alt");
        fs::create_dir_all(own.join("leer")).unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&own), &only_empty()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Residue);
        fs::create_dir_all(own.join(".tief")).unwrap();
        let scan = find_empty_dirs(std::slice::from_ref(&own), &only_empty()).unwrap();
        assert_eq!(scan.roots[0].verdict, Verdict::Partial);
    }

    #[test]
    fn only_the_built_in_system_junk_has_no_size_limit() {
        // review 077 #7: an exact name the user typed ("sample") is an extra up to the limit only
        let o = CleanOptions {
            junk: vec![".DS_Store".into(), "Thumbs.db".into(), "sample".into()],
            junk_max_bytes: 10,
            ..opts()
        };
        let m = Matcher::new(&o).unwrap();
        assert_eq!(
            m.classify("Sample", false, 10),
            FileClass::Junk { pattern: true }
        );
        assert_eq!(
            m.classify("sample", false, 11),
            FileClass::Keep(KeepReason::TooLarge)
        );
        assert_eq!(
            m.classify(".ds_store", true, 5000),
            FileClass::Junk { pattern: false }
        );
        assert_eq!(
            m.classify("THUMBS.DB", false, 5000),
            FileClass::Junk { pattern: false }
        );
    }
}
