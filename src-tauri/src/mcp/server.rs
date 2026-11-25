//! The local transport (design 071 E1): a Unix domain socket for the signed-in user
//! only – in a folder with mode `0700`, the socket itself `0600`, and every peer's
//! user id is compared with ours. No port, nothing a browser or the network reaches.
//! Exists only while `mcp.enabled` is on.

use super::limits::MAX_CONNECTIONS;
use super::{McpError, McpHub, session};
use std::io::BufReader;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

/// A slow or stuck client never holds a thread for ever.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

pub struct ServerHandle {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl ServerHandle {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Stops accepting and removes the socket. Open connections are closed by the hub.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

fn io_error(what: &str) -> McpError {
    McpError::new("io", what)
}

fn own_uid() -> u32 {
    // SAFETY: `getuid` has no arguments, never fails and touches no memory.
    unsafe { libc::getuid() }
}

/// The user id of the process at the other end of `stream`; `None` if the system
/// does not tell (then the connection is refused).
fn peer_uid(stream: &UnixStream) -> Option<u32> {
    use std::os::fd::AsRawFd;
    let fd = stream.as_raw_fd();
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut cred = libc::ucred {
            pid: 0,
            uid: u32::MAX,
            gid: u32::MAX,
        };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: `cred` and `len` are valid for writes of the sizes passed; the
        // descriptor belongs to `stream`, which outlives the call.
        let rc = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut cred as *mut libc::ucred).cast(),
                &mut len,
            )
        };
        (rc == 0 && len as usize == std::mem::size_of::<libc::ucred>()).then_some(cred.uid)
    }
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "dragonfly"
    ))]
    {
        let mut uid: libc::uid_t = u32::MAX;
        let mut gid: libc::gid_t = u32::MAX;
        // SAFETY: both pointers are valid for one write; the descriptor belongs to
        // `stream`, which outlives the call.
        let rc = unsafe { libc::getpeereid(fd, &mut uid, &mut gid) };
        (rc == 0).then_some(uid)
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "dragonfly"
    )))]
    {
        let _ = fd;
        None
    }
}

/// The folder of the socket: ours, a real folder (no link), mode `0700`.
fn prepare_dir(dir: &Path) -> Result<(), McpError> {
    std::fs::create_dir_all(dir).map_err(|_| io_error("The socket folder cannot be created"))?;
    let meta =
        std::fs::symlink_metadata(dir).map_err(|_| io_error("The socket folder cannot be read"))?;
    if !meta.file_type().is_dir() || meta.uid() != own_uid() {
        return Err(io_error("The socket folder is not a folder of this user"));
    }
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| io_error("The socket folder cannot be protected"))
}

/// Binds the socket and starts accepting. An answering socket of another instance is
/// left alone (`in_use`); a dead one is replaced.
pub fn start(hub: Arc<McpHub>, path: &Path) -> Result<ServerHandle, McpError> {
    let dir = path
        .parent()
        .ok_or_else(|| io_error("The socket path has no folder"))?;
    prepare_dir(dir)?;
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if !meta.file_type().is_socket() {
            return Err(io_error("Something else is in the place of the socket"));
        }
        if UnixStream::connect(path).is_ok() {
            return Err(McpError::new(
                "in_use",
                "Another instance of Files and Folders already serves MCP",
            ));
        }
        std::fs::remove_file(path).map_err(|_| io_error("The old socket cannot be removed"))?;
    }
    let listener =
        UnixListener::bind(path).map_err(|_| io_error("The socket cannot be created"))?;
    let protect = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    if protect.is_err() || listener.set_nonblocking(true).is_err() {
        let _ = std::fs::remove_file(path);
        return Err(io_error("The socket cannot be protected"));
    }
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::Builder::new()
        .name("fnf-mcp-accept".into())
        .spawn(move || accept_loop(&hub, &listener, &flag))
        .map_err(|_| {
            let _ = std::fs::remove_file(path);
            io_error("No thread for the socket")
        })?;
    Ok(ServerHandle {
        path: path.to_path_buf(),
        stop,
        thread: Some(thread),
    })
}

fn accept_loop(hub: &Arc<McpHub>, listener: &UnixListener, stop: &AtomicBool) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => accept(hub, stream),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => std::thread::sleep(Duration::from_millis(200)),
        }
    }
}

fn accept(hub: &Arc<McpHub>, stream: UnixStream) {
    // only the user the app runs as – whatever the modes of the socket say
    if peer_uid(&stream) != Some(own_uid()) {
        return;
    }
    if hub.connection_count() >= MAX_CONNECTIONS
        || stream.set_nonblocking(false).is_err()
        || stream.set_write_timeout(Some(WRITE_TIMEOUT)).is_err()
    {
        return;
    }
    let (Ok(reader), Ok(closing)) = (stream.try_clone(), stream.try_clone()) else {
        return;
    };
    let closer = Box::new(move || {
        let _ = closing.shutdown(std::net::Shutdown::Both);
    });
    let Some(conn) = hub.connect(closer) else {
        return;
    };
    let hub2 = hub.clone();
    let conn2 = conn.clone();
    let spawned = std::thread::Builder::new()
        .name(format!("fnf-mcp-conn-{}", conn.id))
        .spawn(move || session::serve(&hub2, conn2, BufReader::new(reader), Box::new(stream)));
    if spawned.is_err() {
        hub.disconnected(&conn);
    }
}
