//! Why is a folder not there? A favourite that fails to open is either gone for
//! good (deleted, renamed) or only away for now (its drive is not connected, the
//! share not mounted). The panel offers different ways out for the two – "remove
//! from favourites" for the first, "retry" for the second – so Rust looks at
//! the path: what is the nearest folder that still exists, and is the first
//! missing part a volume?
//!
//! Reads metadata only, follows no links for the walk, changes nothing.

use std::path::{Path, PathBuf};

/// Why the path is missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MissingReason {
    /// The volume is there, the folder is not: deleted, moved or renamed.
    Gone,
    /// The volume itself is missing (drive not connected, share not mounted).
    Volume,
    /// The folder is missing on a mounted network drive – less certain than `Gone`.
    Network,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingPath {
    pub reason: MissingReason,
    /// The nearest ancestor that exists (the path itself if it is back); none for `Volume`.
    pub nearest: Option<String>,
    /// Its name for a button label.
    pub nearest_name: Option<String>,
    /// Name of the missing volume (`Volume` only).
    pub volume: Option<String>,
}

/// Looks at `path` (absolute, validated by the caller).
pub fn diagnose(path: &Path) -> MissingPath {
    let nearest = path
        .ancestors()
        .find(|p| std::fs::symlink_metadata(p).is_ok());
    let network = nearest
        .is_some_and(|n| crate::watch::netfs::is_network(n) || crate::test_slow::is_network(n));
    classify(path, nearest, network)
}

/// The decision without the file system: `nearest` is the closest existing ancestor.
pub fn classify(path: &Path, nearest: Option<&Path>, network: bool) -> MissingPath {
    let Some(nearest) = nearest else {
        // not even the root exists: a drive letter or share that is not there (Windows)
        let root = path.ancestors().last().unwrap_or(path);
        return volume(display_name(root));
    };
    if nearest != path && is_mount_parent(nearest) {
        let first_missing = path
            .strip_prefix(nearest)
            .ok()
            .and_then(|rest| rest.components().next())
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .unwrap_or_default();
        return volume(first_missing);
    }
    MissingPath {
        reason: if network {
            MissingReason::Network
        } else {
            MissingReason::Gone
        },
        nearest: Some(nearest.to_string_lossy().into_owned()),
        nearest_name: Some(display_name(nearest)),
        volume: None,
    }
}

fn volume(name: String) -> MissingPath {
    MissingPath {
        reason: MissingReason::Volume,
        nearest: None,
        nearest_name: None,
        volume: Some(name),
    }
}

/// Last component, or the whole path for a root (`/`, `C:\`).
fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.to_string_lossy().into_owned(),
        |n| n.to_string_lossy().into_owned(),
    )
}

/// Folders whose children are mount points: a missing child is a volume that is
/// not connected, not a deleted folder. `/Volumes` (macOS), `/mnt`, `/media` and
/// the per-user folders below `/media` and `/run/media` (Linux).
fn is_mount_parent(dir: &Path) -> bool {
    if cfg!(windows) {
        return false;
    }
    let parts: Vec<PathBuf> = dir
        .components()
        .skip(1)
        .map(|c| c.as_os_str().into())
        .collect();
    let names: Vec<&str> = parts.iter().filter_map(|p| p.to_str()).collect();
    if names.len() != parts.len() {
        return false;
    }
    matches!(
        names.as_slice(),
        ["Volumes"] | ["mnt"] | ["media"] | ["media", _] | ["run", "media"] | ["run", "media", _]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_deleted_folder_names_the_nearest_one_that_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let keep = tmp.path().join("Filme Öut");
        std::fs::create_dir(&keep).unwrap();
        let info = diagnose(&keep.join("_filme").join("deeper"));
        assert_eq!(info.reason, MissingReason::Gone);
        assert_eq!(info.nearest.as_deref(), Some(keep.to_str().unwrap()));
        assert_eq!(info.nearest_name.as_deref(), Some("Filme Öut"));
        assert_eq!(info.volume, None);
    }

    #[test]
    fn a_path_that_is_back_is_its_own_nearest() {
        let tmp = tempfile::tempdir().unwrap();
        let info = diagnose(tmp.path());
        assert_eq!(info.reason, MissingReason::Gone);
        assert_eq!(info.nearest.as_deref(), tmp.path().to_str());
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_link_counts_as_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(tmp.path().join("nowhere"), &link).unwrap();
        let info = diagnose(&link.join("x"));
        assert_eq!(info.nearest.as_deref(), link.to_str());
    }

    #[cfg(unix)]
    #[test]
    fn a_missing_child_of_a_mount_folder_is_a_volume() {
        for (path, nearest, name) in [
            ("/Volumes/NAS/filme/a", "/Volumes", "NAS"),
            ("/media/marc/USB Stick", "/media/marc", "USB Stick"),
            ("/run/media/marc/disk/x", "/run/media/marc", "disk"),
            ("/mnt/share", "/mnt", "share"),
        ] {
            let info = classify(Path::new(path), Some(Path::new(nearest)), false);
            assert_eq!(info.reason, MissingReason::Volume, "{path}");
            assert_eq!(info.volume.as_deref(), Some(name), "{path}");
            assert_eq!(info.nearest, None, "{path}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_missing_on_a_mounted_volume_is_not_a_missing_volume() {
        let info = classify(
            Path::new("/Volumes/NAS/filme/a"),
            Some(Path::new("/Volumes/NAS")),
            true,
        );
        assert_eq!(info.reason, MissingReason::Network);
        assert_eq!(info.nearest.as_deref(), Some("/Volumes/NAS"));
        let local = classify(
            Path::new("/Volumes/Disk/filme"),
            Some(Path::new("/Volumes/Disk")),
            false,
        );
        assert_eq!(local.reason, MissingReason::Gone);
        // the mount folder itself, shown again, is no volume
        let own = classify(Path::new("/Volumes"), Some(Path::new("/Volumes")), false);
        assert_eq!(own.reason, MissingReason::Gone);
    }

    #[cfg(unix)]
    #[test]
    fn the_root_as_nearest_has_a_name() {
        let info = classify(Path::new("/nope"), Some(Path::new("/")), false);
        assert_eq!(info.nearest_name.as_deref(), Some("/"));
    }

    #[cfg(windows)]
    #[test]
    fn a_drive_that_is_not_there_is_a_volume() {
        let info = classify(Path::new(r"Q:\filme\a"), None, false);
        assert_eq!(info.reason, MissingReason::Volume);
        assert_eq!(info.volume.as_deref(), Some(r"Q:\"));
    }
}
