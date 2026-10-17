//! Drives, volumes and mount points as starting points (design 011 E1).
//!
//! Two steps: the OS lists the candidates **without touching them** (Linux
//! `/proc/self/mountinfo`, macOS the names in `/Volumes`, Windows the drive
//! letters), then every candidate is probed (size, label, file system) in its
//! own thread. A probe that does not answer within the timeout – a dead
//! network mount – marks the volume as not reachable; it is not started again
//! while it still hangs, so opening the menu repeatedly does not pile up threads.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// How long `list_volumes` waits for the probes together.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VolumeKind {
    Fixed,
    Removable,
    Network,
    Optical,
    Ram,
    Unknown,
}

/// A volume as the frontend shows it (keep in sync with `src/app/core/os/os.models.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub path: String,
    pub label: String,
    pub kind: VolumeKind,
    pub fs_type: Option<String>,
    pub total: Option<u64>,
    pub free: Option<u64>,
    /// False: the probe failed or did not answer in time (sizes unknown).
    pub reachable: bool,
}

/// A volume as the OS lists it, before it was touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub path: PathBuf,
    pub label: String,
    pub kind: VolumeKind,
    pub fs_type: Option<String>,
}

/// What probing the mounted file system tells (may hang on a dead network mount).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Probe {
    pub total: Option<u64>,
    pub free: Option<u64>,
    pub label: Option<String>,
    pub fs_type: Option<String>,
    pub network: bool,
}

/// The volumes of this computer; never blocks longer than about `timeout`.
pub fn list_volumes(timeout: Duration) -> Vec<Volume> {
    probe_all(candidates(), timeout, probe)
}

fn pending() -> MutexGuard<'static, HashSet<PathBuf>> {
    static PENDING: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    PENDING
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Probes all candidates in parallel and waits at most `timeout` for them.
pub fn probe_all(
    cands: Vec<Candidate>,
    timeout: Duration,
    probe: fn(&Path) -> Option<Probe>,
) -> Vec<Volume> {
    let deadline = Instant::now() + timeout;
    let (tx, rx) = mpsc::channel::<(usize, Option<Probe>)>();
    let mut waiting = 0usize;
    for (i, c) in cands.iter().enumerate() {
        if !pending().insert(c.path.clone()) {
            continue; // an earlier probe of this volume still hangs
        }
        let tx = tx.clone();
        let path = c.path.clone();
        let spawned = std::thread::Builder::new()
            .name("fnf-volume-probe".into())
            .spawn(move || {
                let result = probe(&path);
                pending().remove(&path);
                let _ = tx.send((i, result));
            });
        match spawned {
            Ok(_) => waiting += 1,
            Err(_) => {
                pending().remove(&c.path);
            }
        }
    }
    drop(tx);
    let mut results: Vec<Option<Probe>> = vec![None; cands.len()];
    while waiting > 0 {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match rx.recv_timeout(deadline - now) {
            Ok((i, r)) => {
                results[i] = r;
                waiting -= 1;
            }
            Err(_) => break,
        }
    }
    cands
        .into_iter()
        .zip(results)
        .map(|(c, p)| to_volume(c, p))
        .collect()
}

fn to_volume(c: Candidate, p: Option<Probe>) -> Volume {
    let path = c.path.to_string_lossy().into_owned();
    match p {
        None => Volume {
            path,
            label: c.label,
            kind: c.kind,
            fs_type: c.fs_type,
            total: None,
            free: None,
            reachable: false,
        },
        Some(p) => Volume {
            path,
            label: match p.label.filter(|l| !l.trim().is_empty()) {
                Some(l) => format!("{l} ({})", c.label),
                None => c.label,
            },
            kind: if p.network && matches!(c.kind, VolumeKind::Fixed | VolumeKind::Unknown) {
                VolumeKind::Network
            } else {
                c.kind
            },
            fs_type: c.fs_type.or(p.fs_type),
            total: p.total,
            free: p.free,
            reachable: true,
        },
    }
}

// ---- Unix: space via statvfs ----

#[cfg(unix)]
#[allow(clippy::unnecessary_cast)] // field types differ between Linux and macOS
fn statvfs_space(path: &Path) -> Option<(u64, u64)> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: zeroed is a valid statvfs; the path is NUL-terminated
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    let unit = s.f_frsize as u64;
    Some((
        (s.f_blocks as u64).saturating_mul(unit),
        (s.f_bavail as u64).saturating_mul(unit),
    ))
}

// ---- Linux ----

#[cfg(target_os = "linux")]
fn candidates() -> Vec<Candidate> {
    match std::fs::read("/proc/self/mountinfo") {
        Ok(bytes) => parse_mountinfo(&bytes),
        Err(_) => vec![Candidate {
            path: PathBuf::from("/"),
            label: "/".into(),
            kind: VolumeKind::Fixed,
            fs_type: None,
        }],
    }
}

#[cfg(target_os = "linux")]
fn probe(path: &Path) -> Option<Probe> {
    let (total, free) = statvfs_space(path)?;
    Some(Probe {
        total: Some(total),
        free: Some(free),
        ..Probe::default()
    })
}

/// File systems that are no volumes a user would open.
#[cfg(target_os = "linux")]
const PSEUDO_FS: &[&str] = &[
    "proc",
    "sysfs",
    "tmpfs",
    "devtmpfs",
    "devpts",
    "cgroup",
    "cgroup2",
    "securityfs",
    "pstore",
    "debugfs",
    "tracefs",
    "configfs",
    "fusectl",
    "mqueue",
    "hugetlbfs",
    "bpf",
    "autofs",
    "binfmt_misc",
    "rpc_pipefs",
    "nsfs",
    "efivarfs",
    "ramfs",
    "squashfs",
    "selinuxfs",
    "overlay",
    "nfsd",
    "fuse.portal",
    "fuse.gvfsd-fuse",
    "fuse.lxcfs",
    "fuse.snapfuse",
];

/// Mount points below these are system internals (`/run/media` is allowed).
#[cfg(target_os = "linux")]
const SYSTEM_PREFIXES: &[&str] = &[
    "/proc",
    "/sys",
    "/dev",
    "/run",
    "/boot",
    "/snap",
    "/etc",
    "/usr",
    "/var/lib",
    "/var/snap",
    "/tmp",
];

#[cfg(target_os = "linux")]
const NETWORK_FS: &[&str] = &[
    "nfs",
    "nfs4",
    "cifs",
    "smb3",
    "smbfs",
    "ncpfs",
    "afs",
    "ceph",
    "glusterfs",
    "davfs",
    "9p",
    "fuse.sshfs",
    "fuse.rclone",
    "fuse.glusterfs",
    "fuse.davfs2",
];

#[cfg(target_os = "linux")]
fn under(path: &[u8], prefix: &str) -> bool {
    let p = prefix.as_bytes();
    path == p || (path.starts_with(p) && path.get(p.len()) == Some(&b'/'))
}

/// `\040` → space etc. (the kernel escapes space, tab, newline and backslash).
/// Computed in `u16`: `\777` is no byte and stays as it is (review 011 #6).
#[cfg(target_os = "linux")]
fn unescape_octal(field: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(field.len());
    let mut i = 0;
    while i < field.len() {
        let value = (field[i] == b'\\' && i + 4 <= field.len())
            .then(|| &field[i + 1..i + 4])
            .filter(|d| d.iter().all(|b| (b'0'..=b'7').contains(b)))
            .map(|d| d.iter().fold(0u16, |v, b| v * 8 + u16::from(b - b'0')))
            .and_then(|v| u8::try_from(v).ok());
        if let Some(v) = value {
            out.push(v);
            i += 4;
        } else {
            out.push(field[i]);
            i += 1;
        }
    }
    out
}

/// The user-visible mounts of a `/proc/self/mountinfo` text: `/` first, then
/// by path; later mounts on the same point shadow earlier ones.
#[cfg(target_os = "linux")]
pub fn parse_mountinfo(text: &[u8]) -> Vec<Candidate> {
    use std::os::unix::ffi::OsStringExt;
    let mut found: Vec<(Vec<u8>, String)> = Vec::new();
    for line in text.split(|b| *b == b'\n') {
        let fields: Vec<&[u8]> = line.split(|b| *b == b' ').collect();
        let Some(sep) = fields.iter().position(|f| *f == b"-") else {
            continue;
        };
        if sep < 5 || fields.len() < sep + 2 {
            continue;
        }
        let mount = unescape_octal(fields[4]);
        let fs = String::from_utf8_lossy(fields[sep + 1]).into_owned();
        let root = mount == b"/";
        if !root {
            if PSEUDO_FS.contains(&fs.as_str()) {
                continue;
            }
            let allowed_run = under(&mount, "/run/media");
            if !allowed_run && SYSTEM_PREFIXES.iter().any(|p| under(&mount, p)) {
                continue;
            }
        }
        found.retain(|(m, _)| *m != mount);
        found.push((mount, fs));
    }
    found.sort_by(|a, b| (a.0 != b"/", &a.0).cmp(&(b.0 != b"/", &b.0)));
    if !found.iter().any(|(m, _)| m == b"/") {
        found.insert(0, (b"/".to_vec(), String::new()));
    }
    found
        .into_iter()
        .map(|(mount, fs)| {
            let kind = if NETWORK_FS.contains(&fs.as_str()) {
                VolumeKind::Network
            } else if fs == "iso9660" || fs == "udf" {
                VolumeKind::Optical
            } else if under(&mount, "/media") || under(&mount, "/run/media") {
                VolumeKind::Removable
            } else {
                VolumeKind::Fixed
            };
            let path = PathBuf::from(std::ffi::OsString::from_vec(mount));
            let label = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "/".into());
            Candidate {
                path,
                label,
                kind,
                fs_type: (!fs.is_empty()).then_some(fs),
            }
        })
        .collect()
}

// ---- macOS ----

#[cfg(target_os = "macos")]
fn candidates() -> Vec<Candidate> {
    let mut out = vec![Candidate {
        path: PathBuf::from("/"),
        label: "/".into(),
        kind: VolumeKind::Fixed,
        fs_type: None,
    }];
    if let Ok(dir) = std::fs::read_dir("/Volumes") {
        let mut mounts: Vec<Candidate> = Vec::new();
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // the type comes from the directory itself (d_type), no stat of the mount
            match entry.file_type() {
                Ok(t) if t.is_symlink() => {
                    // the boot volume ("Macintosh HD" → /)
                    if std::fs::read_link(entry.path()).is_ok_and(|t| t == Path::new("/")) {
                        out[0].label = name;
                    }
                }
                Ok(t) if t.is_dir() => mounts.push(Candidate {
                    path: entry.path(),
                    label: name,
                    kind: VolumeKind::Unknown,
                    fs_type: None,
                }),
                _ => {}
            }
        }
        mounts.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
        out.extend(mounts);
    }
    out
}

#[cfg(target_os = "macos")]
#[allow(clippy::unnecessary_cast)]
fn probe(path: &Path) -> Option<Probe> {
    use std::ffi::{CStr, CString};
    use std::os::unix::ffi::OsStrExt;
    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: zeroed is a valid statfs; the path is NUL-terminated
    let mut s: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    // SAFETY: f_fstypename is a NUL-terminated C string filled by statfs
    let fs = unsafe { CStr::from_ptr(s.f_fstypename.as_ptr()) }
        .to_string_lossy()
        .into_owned();
    let unit = s.f_bsize as u64;
    Some(Probe {
        total: Some((s.f_blocks as u64).saturating_mul(unit)),
        free: Some((s.f_bavail as u64).saturating_mul(unit)),
        label: None,
        network: (s.f_flags as u64) & (libc::MNT_LOCAL as u64) == 0,
        fs_type: (!fs.is_empty()).then_some(fs),
    })
}

// ---- other Unix (BSD …): only the root ----

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn candidates() -> Vec<Candidate> {
    vec![Candidate {
        path: PathBuf::from("/"),
        label: "/".into(),
        kind: VolumeKind::Fixed,
        fs_type: None,
    }]
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn probe(path: &Path) -> Option<Probe> {
    let (total, free) = statvfs_space(path)?;
    Some(Probe {
        total: Some(total),
        free: Some(free),
        ..Probe::default()
    })
}

// ---- Windows: kernel32 by hand (three functions, no crate) ----

#[cfg(windows)]
mod win {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn GetLogicalDrives() -> u32;
        pub fn GetDriveTypeW(root: *const u16) -> u32;
        pub fn GetDiskFreeSpaceExW(
            dir: *const u16,
            free_to_caller: *mut u64,
            total: *mut u64,
            total_free: *mut u64,
        ) -> i32;
        pub fn GetVolumeInformationW(
            root: *const u16,
            name: *mut u16,
            name_len: u32,
            serial: *mut u32,
            max_component: *mut u32,
            flags: *mut u32,
            fs_name: *mut u16,
            fs_name_len: u32,
        ) -> i32;
        pub fn SetThreadErrorMode(new_mode: u32, old_mode: *mut u32) -> i32;
    }
    pub const DRIVE_REMOVABLE: u32 = 2;
    pub const DRIVE_FIXED: u32 = 3;
    pub const DRIVE_REMOTE: u32 = 4;
    pub const DRIVE_CDROM: u32 = 5;
    pub const DRIVE_RAMDISK: u32 = 6;
    /// No "insert a disk" dialog for empty card readers.
    pub const SEM_FAILCRITICALERRORS: u32 = 0x0001;

    pub fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn from_wide(buf: &[u16]) -> String {
        let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }
}

#[cfg(windows)]
fn candidates() -> Vec<Candidate> {
    // SAFETY: no arguments
    let mask = unsafe { win::GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| {
            let letter = (b'A' + i) as char;
            let root = format!("{letter}:\\");
            let w = win::wide(std::ffi::OsStr::new(&root));
            // SAFETY: a NUL-terminated wide string; GetDriveTypeW does no I/O on the volume
            let kind = match unsafe { win::GetDriveTypeW(w.as_ptr()) } {
                win::DRIVE_FIXED => VolumeKind::Fixed,
                win::DRIVE_REMOVABLE => VolumeKind::Removable,
                win::DRIVE_REMOTE => VolumeKind::Network,
                win::DRIVE_CDROM => VolumeKind::Optical,
                win::DRIVE_RAMDISK => VolumeKind::Ram,
                _ => VolumeKind::Unknown,
            };
            Candidate {
                path: PathBuf::from(root),
                label: format!("{letter}:"),
                kind,
                fs_type: None,
            }
        })
        .collect()
}

#[cfg(windows)]
fn probe(path: &Path) -> Option<Probe> {
    let w = win::wide(path.as_os_str());
    let mut old = 0u32;
    // SAFETY: plain values / out pointers to locals
    unsafe { win::SetThreadErrorMode(win::SEM_FAILCRITICALERRORS, &mut old) };
    let mut name = [0u16; 261];
    let mut fs = [0u16; 261];
    let (mut serial, mut max_comp, mut flags) = (0u32, 0u32, 0u32);
    // SAFETY: buffers with their lengths, out pointers to locals
    let info = unsafe {
        win::GetVolumeInformationW(
            w.as_ptr(),
            name.as_mut_ptr(),
            name.len() as u32,
            &mut serial,
            &mut max_comp,
            &mut flags,
            fs.as_mut_ptr(),
            fs.len() as u32,
        )
    } != 0;
    let (mut caller_free, mut total, mut total_free) = (0u64, 0u64, 0u64);
    // SAFETY: out pointers to locals
    let space = unsafe {
        win::GetDiskFreeSpaceExW(w.as_ptr(), &mut caller_free, &mut total, &mut total_free)
    } != 0;
    if !info && !space {
        return None; // empty card reader, disconnected share
    }
    Some(Probe {
        total: space.then_some(total),
        free: space.then_some(caller_free),
        label: info.then(|| win::from_wide(&name)),
        fs_type: info.then(|| win::from_wide(&fs)).filter(|s| !s.is_empty()),
        network: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    const SAMPLE: &str = "\
22 1 8:2 / / rw,relatime shared:1 - ext4 /dev/sda2 rw
23 22 0:21 / /proc rw shared:2 - proc proc rw
24 22 0:22 / /sys rw shared:3 - sysfs sysfs rw
25 22 0:5 / /dev rw shared:4 - devtmpfs udev rw
26 22 0:23 / /run rw shared:5 - tmpfs tmpfs rw
27 22 8:1 / /boot/efi rw shared:6 - vfat /dev/sda1 rw
28 22 8:3 / /home rw shared:7 - ext4 /dev/sda3 rw
29 22 7:0 / /snap/core/1 ro shared:8 - squashfs /dev/loop0 ro
30 26 8:17 / /run/media/marc/USB\\040Stick rw shared:9 - vfat /dev/sdb1 rw
31 22 0:40 / /mnt/nas rw shared:10 - nfs4 nas:/share rw
32 22 8:33 / /media/marc/DVD ro shared:11 - iso9660 /dev/sr0 ro
33 22 0:41 / /mnt/nas rw shared:12 - cifs //nas/share rw
34 22 8:2 /etc/hosts /etc/hosts rw shared:1 - ext4 /dev/sda2 rw
35 26 0:50 / /run/user/1000/gvfs rw shared:13 - fuse.gvfsd-fuse gvfsd-fuse rw
36 22 0:51 / /tmp rw shared:14 - tmpfs tmpfs rw
";

    #[cfg(target_os = "linux")]
    #[test]
    fn mountinfo_keeps_user_volumes_only() {
        let c = parse_mountinfo(SAMPLE.as_bytes());
        let paths: Vec<_> = c
            .iter()
            .map(|c| c.path.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            paths,
            [
                "/",
                "/home",
                "/media/marc/DVD",
                "/mnt/nas",
                "/run/media/marc/USB Stick"
            ]
        );
        let by = |p: &str| c.iter().find(|c| c.path == Path::new(p)).unwrap();
        assert_eq!(by("/").label, "/");
        assert_eq!(by("/").kind, VolumeKind::Fixed);
        assert_eq!(by("/home").fs_type.as_deref(), Some("ext4"));
        // the later mount on the same point wins
        assert_eq!(by("/mnt/nas").fs_type.as_deref(), Some("cifs"));
        assert_eq!(by("/mnt/nas").kind, VolumeKind::Network);
        assert_eq!(by("/media/marc/DVD").kind, VolumeKind::Optical);
        let usb = by("/run/media/marc/USB Stick");
        assert_eq!(usb.kind, VolumeKind::Removable);
        assert_eq!(usb.label, "USB Stick");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn mountinfo_root_is_always_there() {
        // a container: / is an overlay, which is otherwise filtered
        let c = parse_mountinfo(
            b"1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / /proc rw - proc proc rw\n",
        );
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].path, Path::new("/"));
        assert!(
            parse_mountinfo(b"garbage\n\n")
                .iter()
                .any(|c| c.path == Path::new("/"))
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn octal_escapes_and_non_utf8() {
        assert_eq!(unescape_octal(b"a\\040b\\134c\\011"), b"a b\\c\t");
        assert_eq!(unescape_octal(b"x\\04"), b"x\\04"); // incomplete: kept
        // review 011 #6: at the very end, and values above \377 are no byte (kept)
        assert_eq!(unescape_octal(b"end\\040"), b"end ");
        assert_eq!(unescape_octal(b"a\\777b"), b"a\\777b");
        assert_eq!(unescape_octal(b"\\377"), [0xff]);
        let c = parse_mountinfo(b"1 0 8:1 / /mnt/\xff\\040x rw - ext4 /dev/x rw\n");
        use std::os::unix::ffi::OsStrExt;
        assert!(
            c.iter()
                .any(|c| c.path.as_os_str().as_bytes() == b"/mnt/\xff x")
        );
    }

    fn slow(path: &Path) -> Option<Probe> {
        if path.ends_with("hangs") {
            std::thread::sleep(Duration::from_millis(1500));
        }
        Some(Probe {
            total: Some(100),
            free: Some(40),
            ..Probe::default()
        })
    }

    #[test]
    fn a_hanging_probe_does_not_block_and_is_not_started_twice() {
        let cand = |p: &str| Candidate {
            path: PathBuf::from(p),
            label: p.into(),
            kind: VolumeKind::Unknown,
            fs_type: Some("nfs".into()),
        };
        let cands = vec![cand("/test-011/ok"), cand("/test-011/hangs")];
        let t = Instant::now();
        let v = probe_all(cands.clone(), Duration::from_millis(200), slow);
        assert!(t.elapsed() < Duration::from_millis(1000));
        assert!(v[0].reachable);
        assert_eq!((v[0].total, v[0].free), (Some(100), Some(40)));
        assert!(!v[1].reachable);
        assert_eq!(v[1].total, None);
        assert_eq!(v[1].fs_type.as_deref(), Some("nfs"));
        // while it hangs, a second call does not start another probe
        assert!(pending().contains(Path::new("/test-011/hangs")));
        let v = probe_all(cands, Duration::from_millis(50), slow);
        assert!(v[0].reachable && !v[1].reachable);
    }

    #[test]
    fn probe_label_and_network_flag() {
        let c = Candidate {
            path: PathBuf::from("C:\\"),
            label: "C:".into(),
            kind: VolumeKind::Fixed,
            fs_type: None,
        };
        let v = to_volume(
            c,
            Some(Probe {
                label: Some("System".into()),
                fs_type: Some("NTFS".into()),
                network: true,
                ..Probe::default()
            }),
        );
        assert_eq!(v.label, "System (C:)");
        assert_eq!(v.fs_type.as_deref(), Some("NTFS"));
        assert_eq!(v.kind, VolumeKind::Network);
    }

    #[test]
    fn the_real_list_has_the_root() {
        let v = list_volumes(DEFAULT_TIMEOUT);
        assert!(!v.is_empty());
        #[cfg(unix)]
        {
            assert_eq!(v[0].path, "/");
            assert!(v[0].reachable && v[0].total.is_some());
        }
    }
}
