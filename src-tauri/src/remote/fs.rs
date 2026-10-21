//! The protocol-neutral, blocking interface of a server connection (design 034 §3.3).
//! FTP/FTPS (`ftp.rs`) and SFTP (`sftp.rs`) implement it; jobs and commands use only
//! this trait. Paths are absolute server paths (`/a/b`, checked by `RemotePath`).

use crate::error::{FsError, FsErrorCode};
use crate::model::EntryKind;
use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// One entry of a server folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEntry {
    pub name: String,
    pub kind: EntryKind,
    /// Links: the kind of the target (`None` = dangling or unknown).
    pub target_kind: Option<EntryKind>,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    /// Unix permission bits, when the server tells them.
    pub mode: Option<u32>,
    /// The name could not be decoded exactly (shown, but not operated on).
    pub lossy: bool,
}

/// A server folder: its entries and the number of lines/entries that could not be read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RemoteListing {
    pub entries: Vec<RemoteEntry>,
    pub unreadable: usize,
}

/// Metadata of one entry (`stat` without following links unless asked).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteMeta {
    pub kind: EntryKind,
    pub size: Option<u64>,
    pub modified_ms: Option<i64>,
    pub mode: Option<u32>,
}

impl RemoteMeta {
    pub fn is_dir(&self) -> bool {
        self.kind == EntryKind::Directory
    }
}

/// Lets another thread stop a connection (disconnect, app end): blocked calls return
/// with an error and the connection is unusable afterwards.
#[derive(Debug, Clone, Default)]
pub struct Abort(Arc<AtomicBool>);

impl Abort {
    pub fn is_set(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
    pub fn set(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

/// Stops a connection from another thread: blocked calls return with an error.
pub type Killer = Arc<dyn Fn() + Send + Sync>;

/// What a download hands every chunk to; `Ok(false)` stops the transfer (cancel).
pub type Sink<'a> = dyn FnMut(&[u8]) -> io::Result<bool> + 'a;

pub trait RemoteFs: Send {
    /// The folder the server puts the user in after login (absolute).
    fn home(&mut self) -> Result<String, FsError>;
    fn list(&mut self, dir: &str) -> Result<RemoteListing, FsError>;
    /// Metadata without following a link; `None` = does not exist.
    fn stat(&mut self, path: &str) -> Result<Option<RemoteMeta>, FsError>;
    /// Metadata of what a link points to; `None` = does not exist / dangling.
    fn stat_follow(&mut self, path: &str) -> Result<Option<RemoteMeta>, FsError>;
    /// Streams a file into `sink`. `Ok(false)` = stopped by the sink.
    fn read(&mut self, path: &str, sink: &mut Sink<'_>) -> Result<bool, FsError>;
    /// Creates (or truncates) `path` with the bytes of `source`; returns the bytes written.
    /// A `source` error (e.g. `Interrupted` on cancel) stops the upload.
    fn write(&mut self, path: &str, source: &mut dyn io::Read) -> Result<u64, FsError>;
    fn mkdir(&mut self, path: &str) -> Result<(), FsError>;
    /// Renames; callers check beforehand that `to` does not exist (FTP cannot refuse it).
    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError>;
    fn remove_file(&mut self, path: &str) -> Result<(), FsError>;
    fn remove_dir(&mut self, path: &str) -> Result<(), FsError>;
    /// Sets the modification time; `Ok(false)` = the server cannot.
    fn set_mtime(&mut self, path: &str, ms: i64) -> Result<bool, FsError>;
    /// Keeps the connection alive / checks it.
    fn noop(&mut self) -> Result<(), FsError>;
    /// Shuts the connection down from another thread (disconnect, app end).
    fn killer(&self) -> Killer;
    /// One line about the server for the UI (no secrets).
    fn server_info(&self) -> String;
}

/// Errors after which a connection is not reused.
pub fn is_connection_error(e: &FsError) -> bool {
    matches!(
        e.code,
        FsErrorCode::RemoteConnectionLost
            | FsErrorCode::RemoteTimeout
            | FsErrorCode::RemoteNotConnected
            | FsErrorCode::RemoteUnreachable
    )
}

/// An I/O error of the transport → our code (`TimedOut`/`WouldBlock` = timeout).
pub fn io_error(e: &io::Error, path: &str) -> FsError {
    let code = match e.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => FsErrorCode::RemoteTimeout,
        io::ErrorKind::ConnectionRefused
        | io::ErrorKind::HostUnreachable
        | io::ErrorKind::NetworkUnreachable
        | io::ErrorKind::AddrNotAvailable => FsErrorCode::RemoteUnreachable,
        _ => FsErrorCode::RemoteConnectionLost,
    };
    FsError::at(code, e.to_string(), path)
}

/// Joins a server folder and a name (`/` + `a` = `/a`).
pub fn join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_and_classifies() {
        assert_eq!(join("/", "a"), "/a");
        assert_eq!(join("/x", "a b"), "/x/a b");
        let t = io_error(&io::Error::from(io::ErrorKind::TimedOut), "/x");
        assert_eq!(t.code, FsErrorCode::RemoteTimeout);
        assert!(is_connection_error(&t));
        let r = io_error(&io::Error::from(io::ErrorKind::ConnectionReset), "/x");
        assert_eq!(r.code, FsErrorCode::RemoteConnectionLost);
        assert!(!is_connection_error(&FsError::at(
            FsErrorCode::NotFound,
            "x",
            "/"
        )));
        let a = Abort::default();
        assert!(!a.is_set());
        a.clone().set();
        assert!(a.is_set());
    }
}
