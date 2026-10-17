//! Is a folder on a network file system? (design 012 E2) – such folders are
//! not watched natively: remote changes are not reported, and polling a big
//! network folder is expensive.

use std::path::Path;

#[cfg(target_os = "linux")]
pub fn is_network(path: &Path) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    // statfs(2) f_type values of network file systems
    const NETWORK: &[u32] = &[
        0x6969,      // NFS
        0x517B,      // SMB
        0xFF53_4D42, // CIFS
        0xFE53_4D42, // SMB2
        0x5346_414F, // AFS
        0x7375_7245, // Coda
        0x0102_1997, // 9p (WSL, VMs)
        0x00C3_6400, // Ceph
        0x0BD0_0BD0, // Lustre
    ];
    let Ok(c) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `c` is a valid NUL-terminated path, `s` a zeroed out-parameter.
    let mut s: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut s) } != 0 {
        return false;
    }
    #[allow(clippy::unnecessary_cast)]
    let kind = (s.f_type as u64 & 0xFFFF_FFFF) as u32;
    NETWORK.contains(&kind)
}

#[cfg(target_os = "macos")]
pub fn is_network(path: &Path) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    const MNT_LOCAL: u32 = 0x0000_1000;
    let Ok(c) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `c` is a valid NUL-terminated path, `s` a zeroed out-parameter.
    let mut s: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut s) } != 0 {
        return false;
    }
    s.f_flags & MNT_LOCAL == 0
}

#[cfg(windows)]
pub fn is_network(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Component, Prefix};
    const DRIVE_REMOTE: u32 = 4;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return false;
    };
    match prefix.kind() {
        Prefix::UNC(..) | Prefix::VerbatimUNC(..) => true,
        Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
            let root: Vec<u16> = std::ffi::OsStr::new(&format!("{}:\\", letter as char))
                .encode_wide()
                .chain(Some(0))
                .collect();
            // SAFETY: `root` is a NUL-terminated UTF-16 string.
            unsafe { GetDriveTypeW(root.as_ptr()) == DRIVE_REMOTE }
        }
        _ => false,
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub fn is_network(_path: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_temp_folder_is_local() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!is_network(tmp.path()));
        assert!(!is_network(&tmp.path().join("does not exist")));
    }
}
