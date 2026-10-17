//! Properties of a file or folder (design 010 E5): times, permissions or
//! attributes, owner, link target, detected type. Read only.

use crate::error::FsError;
use crate::model::EntryKind;
use crate::platform;
use crate::preview::detect::{self, Format};
use serde::Serialize;
use std::fs::{self, Metadata};
use std::io::Read;
use std::path::Path;
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnixPerms {
    pub mode: u32,
    pub uid: u32,
    pub gid: u32,
    pub owner: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinAttrs {
    pub readonly: bool,
    pub hidden: bool,
    pub system: bool,
    pub archive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Properties {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    /// For links: kind of the target (`None` = dangling).
    pub target_kind: Option<EntryKind>,
    pub link_target: Option<String>,
    /// Files only (folders: job `dirSize`).
    pub size: Option<u64>,
    pub created_ms: Option<i64>,
    pub modified_ms: Option<i64>,
    pub accessed_ms: Option<i64>,
    pub readonly: bool,
    pub format: Option<Format>,
    pub unix: Option<UnixPerms>,
    pub windows: Option<WinAttrs>,
}

fn ms(t: std::io::Result<SystemTime>) -> Option<i64> {
    let t = t.ok()?;
    Some(match t.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(e) => -(e.duration().as_millis() as i64),
    })
}

fn kind_of(meta: &Metadata) -> EntryKind {
    let ft = meta.file_type();
    if ft.is_symlink() {
        EntryKind::Symlink
    } else if ft.is_dir() {
        EntryKind::Directory
    } else if ft.is_file() {
        EntryKind::File
    } else {
        EntryKind::Unknown
    }
}

/// Type by content (first 8 KiB), regular files only.
fn format_of(path: &Path) -> Option<Format> {
    let mut head = Vec::new();
    // `metadata` already said "regular file"; a FIFO swapped in would block – open non-blocking
    let mut opts = fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NONBLOCK);
    }
    let file = opts.open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    file.take(crate::preview::HEAD_BYTES as u64)
        .read_to_end(&mut head)
        .ok()?;
    Some(detect::classify(&head))
}

pub fn properties(path: &Path) -> Result<Properties, FsError> {
    let link_meta = fs::symlink_metadata(path).map_err(|e| FsError::from_io(&e, path))?;
    let kind = kind_of(&link_meta);
    let target = if kind == EntryKind::Symlink {
        fs::metadata(path).ok()
    } else {
        None
    };
    let link_target = (kind == EntryKind::Symlink)
        .then(|| fs::read_link(path).ok())
        .flatten()
        .map(|p| p.to_string_lossy().into_owned());
    // size, times, permissions: of the target if there is one (as the file list shows it)
    let meta = target.as_ref().unwrap_or(&link_meta);
    let is_file = meta.is_file();
    Ok(Properties {
        name: path
            .file_name()
            .map_or_else(|| path.to_string_lossy(), |n| n.to_string_lossy())
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        kind,
        target_kind: target.as_ref().map(kind_of),
        link_target,
        size: is_file.then_some(meta.len()),
        created_ms: ms(meta.created()),
        modified_ms: ms(meta.modified()),
        accessed_ms: ms(meta.accessed()),
        readonly: meta.permissions().readonly(),
        format: if is_file { format_of(path) } else { None },
        unix: unix_perms(meta),
        windows: win_attrs(meta),
    })
}

#[cfg(unix)]
fn unix_perms(meta: &Metadata) -> Option<UnixPerms> {
    use std::os::unix::fs::MetadataExt;
    Some(UnixPerms {
        mode: meta.mode() & 0o7777,
        uid: meta.uid(),
        gid: meta.gid(),
        owner: platform::user_name(meta.uid()),
        group: platform::group_name(meta.gid()),
    })
}

#[cfg(not(unix))]
fn unix_perms(_meta: &Metadata) -> Option<UnixPerms> {
    None
}

#[cfg(windows)]
fn win_attrs(meta: &Metadata) -> Option<WinAttrs> {
    let a = platform::file_attributes(meta);
    Some(WinAttrs {
        readonly: a & 0x1 != 0,
        hidden: a & 0x2 != 0,
        system: a & 0x4 != 0,
        archive: a & 0x20 != 0,
    })
}

#[cfg(not(windows))]
fn win_attrs(_meta: &Metadata) -> Option<WinAttrs> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::FsErrorCode;
    use tempfile::tempdir;

    #[test]
    fn file_with_type_size_and_times() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("Bild ä.txt");
        fs::write(&p, b"\x89PNG\r\n\x1a\n").unwrap();
        let pr = properties(&p).unwrap();
        assert_eq!(pr.name, "Bild ä.txt");
        assert_eq!(pr.kind, EntryKind::File);
        assert_eq!(pr.size, Some(8));
        assert_eq!(pr.format.unwrap().id, "png");
        assert!(pr.modified_ms.unwrap() > 0);
        assert!(pr.link_target.is_none());
        assert_eq!(
            serde_json::to_value(&pr).unwrap()["modifiedMs"],
            pr.modified_ms.unwrap()
        );
    }

    #[test]
    fn folder_has_no_size_and_missing_fails() {
        let dir = tempdir().unwrap();
        let pr = properties(dir.path()).unwrap();
        assert_eq!(pr.kind, EntryKind::Directory);
        assert_eq!(pr.size, None);
        assert!(pr.format.is_none());
        assert_eq!(
            properties(&dir.path().join("gone")).unwrap_err().code,
            FsErrorCode::NotFound
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_mode_owner_and_links() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let p = dir.path().join("f");
        fs::write(&p, "x").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
        let pr = properties(&p).unwrap();
        let u = pr.unix.unwrap();
        assert_eq!(u.mode, 0o640);
        assert_eq!(u.uid, unsafe { libc::getuid() });
        assert!(u.owner.is_some());
        assert!(pr.windows.is_none());

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&p, &link).unwrap();
        let pl = properties(&link).unwrap();
        assert_eq!(pl.kind, EntryKind::Symlink);
        assert_eq!(pl.target_kind, Some(EntryKind::File));
        assert_eq!(pl.link_target.as_deref(), p.to_str());
        assert_eq!(pl.size, Some(1));

        let dangling = dir.path().join("dangling");
        std::os::unix::fs::symlink("nowhere", &dangling).unwrap();
        let pd = properties(&dangling).unwrap();
        assert_eq!(pd.target_kind, None);
        assert_eq!(pd.link_target.as_deref(), Some("nowhere"));
        assert_eq!(pd.size, None);
    }
}
