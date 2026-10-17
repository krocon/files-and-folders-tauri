//! DTOs exchanged with the frontend. Field names are serialised in camelCase.
//! Keep in sync with `src/app/core/fs/fs.models.ts`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    /// Metadata could not be read (e.g. entry vanished or access denied).
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryDto {
    /// File name as shown to the user (lossy for non-UTF-8 names).
    pub name: String,
    /// Full platform path; pass back unchanged to `list_directory`.
    pub path: String,
    pub kind: EntryKind,
    /// For symlinks: the kind of the resolved target (`None` if dangling).
    pub target_kind: Option<EntryKind>,
    /// Size in bytes for files (and symlinks pointing to files).
    pub size: Option<u64>,
    /// Last modification, milliseconds since the Unix epoch.
    pub modified_ms: Option<i64>,
    pub hidden: bool,
    /// True when the name is not valid UTF-8 and was converted lossily.
    /// Navigation into such entries is not supported yet.
    pub lossy_name: bool,
}

impl DirEntryDto {
    /// Whether the entry can be opened as a directory (incl. symlinks to directories).
    pub fn is_navigable_dir(&self) -> bool {
        self.kind == EntryKind::Directory
            || (self.kind == EntryKind::Symlink && self.target_kind == Some(EntryKind::Directory))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSegment {
    /// Display label (root segments show the root itself, e.g. `/` or `C:\`).
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub parent: Option<String>,
    pub segments: Vec<PathSegment>,
    pub entries: Vec<DirEntryDto>,
    /// Number of entries whose metadata could not be read.
    pub unreadable_entries: usize,
    /// Set when the listing is a folder inside an archive (design 016 E1):
    /// `path` and the entry paths are virtual then (`…/a.zip/dir`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive: Option<crate::archive::ArchiveInfo>,
}
