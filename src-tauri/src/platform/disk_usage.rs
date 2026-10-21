//! Platform parts of the disk-usage scan (design 033 E5/E6): bytes on disk,
//! the root of the volume a path lies on, the macOS data volume.

use std::fs::Metadata;
use std::path::{Path, PathBuf};

/// Bytes `meta` occupies on disk. Never opens the file (cloud placeholders stay
/// unloaded).
#[cfg(unix)]
pub fn allocated(_path: &Path, meta: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.blocks().saturating_mul(512)
}

/// Windows: the size rounded up to the cluster (4 KiB, the NTFS default); compressed
/// and sparse files ask the system (`GetCompressedFileSizeW` reads no content).
#[cfg(windows)]
pub fn allocated(path: &Path, meta: &Metadata) -> u64 {
    use std::os::windows::fs::MetadataExt;
    const COMPRESSED: u32 = 0x800;
    const SPARSE: u32 = 0x200;
    const CLUSTER: u64 = 4096;
    if meta.is_dir() {
        return 0;
    }
    if meta.file_attributes() & (COMPRESSED | SPARSE) != 0
        && let Some(n) = win::compressed_size(path)
    {
        return n;
    }
    meta.len().div_ceil(CLUSTER).saturating_mul(CLUSTER)
}

#[cfg(windows)]
mod win {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCompressedFileSizeW(name: *const u16, high: *mut u32) -> u32;
        fn GetLastError() -> u32;
    }
    const INVALID_FILE_SIZE: u32 = 0xFFFF_FFFF;

    pub fn compressed_size(path: &Path) -> Option<u64> {
        let w: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut high = 0u32;
        // SAFETY: NUL-terminated wide string, out pointer to a local
        let low = unsafe { GetCompressedFileSizeW(w.as_ptr(), &mut high) };
        // SAFETY: no arguments
        if low == INVALID_FILE_SIZE && unsafe { GetLastError() } != 0 {
            return None;
        }
        Some((u64::from(high) << 32) | u64::from(low))
    }
}

#[cfg(not(any(unix, windows)))]
pub fn allocated(_path: &Path, meta: &Metadata) -> u64 {
    meta.len()
}

/// The data volume of macOS (Catalina and later), reached from `/` through firmlinks.
pub const MACOS_DATA_VOLUME: &str = "/System/Volumes/Data";

/// The root of the volume `path` lies on (design 033 E5): Unix climbs up while the
/// device stays the same (macOS: the data volume counts as `/`); Windows keeps
/// drive/share and root.
#[cfg(unix)]
pub fn volume_root(path: &Path) -> PathBuf {
    use std::os::unix::fs::MetadataExt;
    let dev = |p: &Path| std::fs::symlink_metadata(p).ok().map(|m| m.dev());
    let mut cur = path.to_path_buf();
    let Some(d) = dev(&cur) else {
        return cur;
    };
    while let Some(parent) = cur.parent() {
        if dev(parent) != Some(d) {
            break;
        }
        cur = parent.to_path_buf();
    }
    if cfg!(target_os = "macos") && dev(Path::new(MACOS_DATA_VOLUME)) == Some(d) {
        return PathBuf::from("/");
    }
    cur
}

#[cfg(not(unix))]
pub fn volume_root(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => out.push(c.as_os_str()),
            _ => break,
        }
    }
    if out.as_os_str().is_empty() {
        path.to_path_buf()
    } else {
        out
    }
}

/// macOS: scanning `/` also scans the data volume (through the firmlinks), but
/// not `/System/Volumes/Data` itself (it would count everything twice).
/// Returns (extra device, folder to skip).
#[cfg(target_os = "macos")]
pub fn firmlink_plan(root: &Path) -> Option<(u64, PathBuf)> {
    use std::os::unix::fs::MetadataExt;
    if root != Path::new("/") {
        return None;
    }
    let m = std::fs::symlink_metadata(MACOS_DATA_VOLUME).ok()?;
    m.is_dir()
        .then(|| (m.dev(), PathBuf::from(MACOS_DATA_VOLUME)))
}

#[cfg(not(target_os = "macos"))]
pub fn firmlink_plan(_root: &Path) -> Option<(u64, PathBuf)> {
    None
}

/// Total and free bytes of the volume of `path`.
pub fn space(path: &Path) -> Option<(u64, u64)> {
    crate::platform::volumes::space_of(path)
}
