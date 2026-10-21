//! FTP and FTPS (explicit `AUTH TLS` and implicit) through `suppaftp`, blocking
//! (design 034 E2/E6). Every socket gets read/write timeouts and is registered so
//! [`Abort`] can shut it down from another thread. Passive mode only (PASV with the
//! NAT workaround over IPv4, EPSV over IPv6), binary transfers, MLSD/MLST when the
//! server offers them, otherwise `LIST` parsed as Unix or DOS lines.

use super::fs::{
    Abort, Killer, RemoteEntry, RemoteFs, RemoteListing, RemoteMeta, Sink, io_error, join,
};
use super::path::valid_segment;
use super::profiles::{NameEncoding, RemoteKind, RemoteProfile};
use crate::error::{FsError, FsErrorCode};
use crate::model::EntryKind;
use crate::secret::Secret;
use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use suppaftp::list::{File as ListFile, ListParser};
use suppaftp::types::FileType as TransferType;
use suppaftp::{FtpError, ImplFtpStream, Mode, RustlsConnector, Status, TlsStream};

const CHUNK: usize = 256 * 1024;
/// Links whose target kind is looked up per listing (each costs a CWD).
const MAX_LINK_PROBES: usize = 200;

/// Latin-1 names for old servers (profile setting `latin1`).
#[derive(Debug, Clone, Copy)]
struct Latin1;

impl suppaftp::Encoding for Latin1 {
    fn decode(&self, bytes: &[u8]) -> String {
        bytes.iter().map(|b| *b as char).collect()
    }
    fn encode(&self, text: &str) -> io::Result<Vec<u8>> {
        text.chars()
            .map(|c| u8::try_from(c as u32).map_err(|_| io::Error::other("not Latin-1")))
            .collect()
    }
}

type Sockets = Arc<Mutex<Vec<TcpStream>>>;

fn register(sockets: &Sockets, s: &TcpStream) {
    if let Ok(clone) = s.try_clone() {
        let mut list = sockets.lock().unwrap_or_else(|e| e.into_inner());
        // data connections come and go – keep the list short
        let n = list.len();
        if n > 16 {
            // the control connection (first) stays
            list.drain(1..n - 8);
        }
        list.push(clone);
    }
}

/// An `Abort` that also shuts the registered sockets down.
#[derive(Clone)]
struct FtpAbort {
    flag: Abort,
    sockets: Sockets,
}

impl FtpAbort {
    /// Drops the clones of data sockets: an upload ends when the client closes its
    /// data connection – a clone kept here would hold it open.
    fn forget_data(&self) {
        let mut list = self.sockets.lock().unwrap_or_else(|e| e.into_inner());
        list.truncate(1);
    }

    fn fire(&self) {
        self.flag.set();
        let list = self.sockets.lock().unwrap_or_else(|e| e.into_inner());
        for s in list.iter() {
            let _ = s.shutdown(Shutdown::Both);
        }
    }
}

pub struct FtpConn<T: TlsStream> {
    ftp: ImplFtpStream<T>,
    abort: FtpAbort,
    mlst: bool,
    mfmt: bool,
    info: String,
}

/// Maps a `suppaftp` error; `path` names what the operation was about.
pub fn ftp_error(e: FtpError, path: &str) -> FsError {
    match e {
        FtpError::ConnectionError(io) => io_error(&io, path),
        FtpError::SecureError(s) => {
            FsError::at(FsErrorCode::RemoteProtocol, format!("TLS: {s}"), path)
        }
        FtpError::UnexpectedResponse(r) => {
            let text = String::from_utf8_lossy(&r.body).trim().to_string();
            let lower = text.to_lowercase();
            let code = match r.status {
                Status::NotLoggedIn | Status::InvalidCredentials => FsErrorCode::RemoteAuthFailed,
                Status::FileUnavailable
                    if lower.contains("denied") || lower.contains("permission") =>
                {
                    FsErrorCode::PermissionDenied
                }
                Status::FileUnavailable => FsErrorCode::NotFound,
                Status::ExceededStorage | Status::RequestedActionNotTaken => FsErrorCode::DiskFull,
                Status::BadFilename => FsErrorCode::InvalidName,
                Status::NotAvailable => FsErrorCode::RemoteConnectionLost,
                _ => FsErrorCode::RemoteProtocol,
            };
            FsError::at(code, format!("{} {text}", r.status.code()), path)
        }
        FtpError::BadResponse => {
            FsError::at(FsErrorCode::RemoteProtocol, "Invalid server response", path)
        }
        FtpError::InvalidAddress(a) => {
            FsError::at(FsErrorCode::RemoteProtocol, a.to_string(), path)
        }
        FtpError::DataConnectionAlreadyOpen => FsError::at(
            FsErrorCode::RemoteProtocol,
            "Data connection already open",
            path,
        ),
    }
}

/// Connects a TCP socket within `timeout` (first address that answers).
pub fn tcp_connect(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, FsError> {
    let label = format!("{host}:{port}");
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| FsError::at(FsErrorCode::RemoteUnreachable, e.to_string(), &label))?
        .collect();
    let mut last = None;
    for a in addrs {
        match TcpStream::connect_timeout(&a, timeout) {
            Ok(s) => {
                s.set_read_timeout(Some(timeout)).ok();
                s.set_write_timeout(Some(timeout)).ok();
                s.set_nodelay(true).ok();
                return Ok(s);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(match last {
        Some(e) => io_error(&e, &label),
        None => FsError::at(FsErrorCode::RemoteUnreachable, "Host not found", &label),
    })
}

fn system_time_ms(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn entry_of(f: &ListFile) -> Option<RemoteEntry> {
    let name = f.name().to_string();
    if name == "." || name == ".." || name.is_empty() {
        return None;
    }
    let kind = if f.is_symlink() {
        EntryKind::Symlink
    } else if f.is_directory() {
        EntryKind::Directory
    } else {
        EntryKind::File
    };
    let lossy = name.contains('\u{FFFD}') || !valid_segment(&name);
    Some(RemoteEntry {
        size: (kind == EntryKind::File).then_some(f.size() as u64),
        modified_ms: system_time_ms(f.modified()).filter(|ms| *ms > 0),
        mode: None,
        target_kind: None,
        name,
        kind,
        lossy,
    })
}

/// Parses `LIST` output (Unix or DOS lines; `total n` and blank lines are skipped).
pub fn parse_list(lines: &[String]) -> RemoteListing {
    let mut out = RemoteListing::default();
    for line in lines {
        let l = line.trim_end_matches(['\r', '\n']);
        if l.trim().is_empty() || l.starts_with("total ") {
            continue;
        }
        let parsed = ListParser::parse_posix(l).or_else(|_| ListParser::parse_dos(l));
        match parsed {
            Ok(f) => out.entries.extend(entry_of(&f)),
            Err(_) => out.unreadable += 1,
        }
    }
    out
}

/// Parses `MLSD` lines (`cdir`/`pdir` entries are dropped).
pub fn parse_mlsd(lines: &[String]) -> RemoteListing {
    let mut out = RemoteListing::default();
    for line in lines {
        let l = line.trim_end_matches(['\r', '\n']);
        if l.trim().is_empty() {
            continue;
        }
        let lower = l.to_ascii_lowercase();
        if lower.contains("type=cdir;") || lower.contains("type=pdir;") {
            continue;
        }
        match ListParser::parse_mlsd(l) {
            Ok(f) => out.entries.extend(entry_of(&f)),
            Err(_) => out.unreadable += 1,
        }
    }
    out
}

fn meta_of(f: &ListFile) -> RemoteMeta {
    let e = entry_of(f);
    RemoteMeta {
        kind: e.as_ref().map(|e| e.kind).unwrap_or(EntryKind::Directory),
        size: e.as_ref().and_then(|e| e.size),
        modified_ms: e.as_ref().and_then(|e| e.modified_ms),
        mode: None,
    }
}

fn parent_and_name(path: &str) -> Option<(&str, &str)> {
    let i = path.rfind('/')?;
    let name = &path[i + 1..];
    if name.is_empty() {
        return None;
    }
    Some((if i == 0 { "/" } else { &path[..i] }, name))
}

/// `YYYYMMDDHHMMSS` (UTC) for `MFMT`.
pub fn mfmt_time(ms: i64) -> Option<String> {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // civil from days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    if !(1970..=9999).contains(&y) {
        return None;
    }
    Some(format!(
        "{y:04}{m:02}{d:02}{:02}{:02}{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    ))
}

impl<T: TlsStream + Send + 'static> FtpConn<T> {
    fn setup(
        mut ftp: ImplFtpStream<T>,
        p: &RemoteProfile,
        password: Option<&Secret>,
        abort: FtpAbort,
        timeout: Duration,
        ipv6: bool,
    ) -> Result<Self, FsError> {
        let addr = p.address();
        let sockets = abort.sockets.clone();
        ftp = ftp.passive_stream_builder(move |a: SocketAddr| {
            let s = TcpStream::connect_timeout(&a, timeout)
                .map_err(suppaftp::FtpError::ConnectionError)?;
            s.set_read_timeout(Some(timeout)).ok();
            s.set_write_timeout(Some(timeout)).ok();
            register(&sockets, &s);
            Ok(s)
        });
        if ipv6 {
            ftp.set_mode(Mode::ExtendedPassive);
        } else {
            ftp.set_mode(Mode::Passive);
            ftp.set_passive_nat_workaround(true);
        }
        if p.encoding == NameEncoding::Latin1 {
            ftp.set_encoding(Latin1);
        }
        let pass = if p.anonymous {
            "anonymous@".to_string()
        } else {
            password.map(|s| s.expose().to_string()).unwrap_or_default()
        };
        let pass = zeroize::Zeroizing::new(pass);
        ftp.login(p.login_user(), pass.as_str())
            .map_err(|e| ftp_error(e, &addr))?;
        ftp.transfer_type(TransferType::Binary)
            .map_err(|e| ftp_error(e, &addr))?;
        let feat = ftp.feat().unwrap_or_default();
        let has = |k: &str| feat.keys().any(|f| f.eq_ignore_ascii_case(k));
        if has("UTF8") && p.encoding != NameEncoding::Latin1 {
            let _ = ftp.opts("UTF8", Some("ON"));
        }
        let info = format!(
            "{} · {}",
            if p.kind.encrypted() { "FTPS" } else { "FTP" },
            ftp.get_welcome_msg()
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .filter(|c| !c.is_control())
                .take(80)
                .collect::<String>()
        );
        Ok(Self {
            mlst: has("MLST"),
            mfmt: has("MFMT"),
            ftp,
            abort,
            info,
        })
    }

    fn stat_by_listing(&mut self, path: &str) -> Result<Option<RemoteMeta>, FsError> {
        let Some((dir, name)) = parent_and_name(path) else {
            return Ok(Some(RemoteMeta {
                kind: EntryKind::Directory,
                size: None,
                modified_ms: None,
                mode: None,
            }));
        };
        let listing = match self.list(dir) {
            Ok(l) => l,
            Err(e) if e.code == FsErrorCode::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let unreadable = listing.unreadable;
        let found = listing
            .entries
            .into_iter()
            .find(|e| e.name == name)
            .map(|e| RemoteMeta {
                kind: e.kind,
                size: e.size,
                modified_ms: e.modified_ms,
                mode: e.mode,
            });
        if found.is_none() && unreadable > 0 {
            // a line we could not read may be this entry: no "does not exist"
            return Err(FsError::at(
                FsErrorCode::RemoteProtocol,
                "The server listing could not be read completely",
                path,
            ));
        }
        Ok(found)
    }

    /// Whether `path` can be entered (a folder, or a link to one).
    fn is_dir(&mut self, path: &str) -> bool {
        self.ftp.cwd(path).is_ok()
    }
}

impl<T: TlsStream + Send + 'static> RemoteFs for FtpConn<T> {
    fn home(&mut self) -> Result<String, FsError> {
        let pwd = self.ftp.pwd().map_err(|e| ftp_error(e, "/"))?;
        Ok(if pwd.starts_with('/') {
            pwd
        } else {
            "/".into()
        })
    }

    fn list(&mut self, dir: &str) -> Result<RemoteListing, FsError> {
        let mut listing = if self.mlst {
            let lines = self.ftp.mlsd(Some(dir)).map_err(|e| ftp_error(e, dir))?;
            parse_mlsd(&lines)
        } else {
            // LIST takes options on most servers: change into the folder, list it with `-a`
            self.ftp.cwd(dir).map_err(|e| ftp_error(e, dir))?;
            let lines = match self.ftp.list(Some("-a")) {
                Ok(l) => l,
                Err(FtpError::UnexpectedResponse(_)) => {
                    self.ftp.list(None).map_err(|e| ftp_error(e, dir))?
                }
                Err(e) => return Err(ftp_error(e, dir)),
            };
            parse_list(&lines)
        };
        let mut probes = 0;
        for i in 0..listing.entries.len() {
            if listing.entries[i].kind != EntryKind::Symlink || listing.entries[i].lossy {
                continue;
            }
            if probes >= MAX_LINK_PROBES {
                break;
            }
            probes += 1;
            let full = join(dir, &listing.entries[i].name);
            listing.entries[i].target_kind = Some(if self.is_dir(&full) {
                EntryKind::Directory
            } else {
                EntryKind::File
            });
        }
        Ok(listing)
    }

    fn stat(&mut self, path: &str) -> Result<Option<RemoteMeta>, FsError> {
        if path == "/" {
            return self.stat_by_listing(path);
        }
        if self.mlst {
            return match self.ftp.mlst(Some(path)) {
                Ok(line) => Ok(ListParser::parse_mlst(&line).ok().map(|f| meta_of(&f))),
                // 550 also means "no permission" or "busy" on some servers: "not there"
                // only when the reply says so, else a listing of the folder decides – a
                // wrong `None` would let a rename replace the entry (review 034)
                Err(FtpError::UnexpectedResponse(r)) if r.status == Status::FileUnavailable => {
                    if says_not_found(&String::from_utf8_lossy(&r.body)) {
                        Ok(None)
                    } else {
                        self.stat_by_listing(path)
                    }
                }
                Err(e) => Err(ftp_error(e, path)),
            };
        }
        self.stat_by_listing(path)
    }

    fn stat_follow(&mut self, path: &str) -> Result<Option<RemoteMeta>, FsError> {
        match self.stat(path)? {
            Some(m) if m.kind == EntryKind::Symlink => {
                if self.is_dir(path) {
                    Ok(Some(RemoteMeta {
                        kind: EntryKind::Directory,
                        ..m
                    }))
                } else {
                    match self.ftp.size(path) {
                        Ok(n) => Ok(Some(RemoteMeta {
                            kind: EntryKind::File,
                            size: Some(n as u64),
                            ..m
                        })),
                        Err(_) => Ok(None),
                    }
                }
            }
            other => Ok(other),
        }
    }

    fn read(&mut self, path: &str, sink: &mut Sink<'_>) -> Result<bool, FsError> {
        let mut stream = self
            .ftp
            .retr_as_stream(path)
            .map_err(|e| ftp_error(e, path))?;
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    let _ = self.ftp.abort(stream);
                    return Err(io_error(&e, path));
                }
            };
            match sink(&buf[..n]) {
                Ok(true) => {}
                Ok(false) => {
                    let _ = self.ftp.abort(stream);
                    return Ok(false);
                }
                Err(e) => {
                    let _ = self.ftp.abort(stream);
                    return Err(FsError::at(FsErrorCode::Io, e.to_string(), path));
                }
            }
        }
        stream.finish().map_err(|e| ftp_error(e, path))?;
        Ok(true)
    }

    fn write(&mut self, path: &str, source: &mut dyn Read) -> Result<u64, FsError> {
        let mut stream = self
            .ftp
            .put_with_stream(path)
            .map_err(|e| ftp_error(e, path))?;
        let mut buf = vec![0u8; CHUNK];
        let mut total = 0u64;
        loop {
            let n = match source.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    self.abort.forget_data();
                    let _ = self.ftp.abort(stream);
                    let code = if e.kind() == io::ErrorKind::Interrupted {
                        FsErrorCode::Io
                    } else {
                        crate::error::FsError::from_io(&e, std::path::Path::new(path)).code
                    };
                    return Err(FsError::at(code, e.to_string(), path));
                }
            };
            if let Err(e) = stream.write_all(&buf[..n]) {
                self.abort.forget_data();
                let _ = self.ftp.abort(stream);
                return Err(io_error(&e, path));
            }
            total += n as u64;
        }
        stream.flush().ok();
        self.abort.forget_data();
        stream.finish().map_err(|e| ftp_error(e, path))?;
        Ok(total)
    }

    fn mkdir(&mut self, path: &str) -> Result<(), FsError> {
        self.ftp.mkdir(path).map_err(|e| ftp_error(e, path))
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError> {
        self.ftp.rename(from, to).map_err(|e| ftp_error(e, from))
    }

    fn remove_file(&mut self, path: &str) -> Result<(), FsError> {
        self.ftp.rm(path).map_err(|e| ftp_error(e, path))
    }

    fn remove_dir(&mut self, path: &str) -> Result<(), FsError> {
        self.ftp.rmdir(path).map_err(|e| ftp_error(e, path))
    }

    fn set_mtime(&mut self, path: &str, ms: i64) -> Result<bool, FsError> {
        if !self.mfmt {
            return Ok(false);
        }
        let Some(t) = mfmt_time(ms) else {
            return Ok(false);
        };
        self.ftp
            .custom_command(format!("MFMT {t} {path}"), &[Status::File])
            .map(|_| true)
            .map_err(|e| ftp_error(e, path))
    }

    fn noop(&mut self) -> Result<(), FsError> {
        self.ftp.noop().map_err(|e| ftp_error(e, "/"))
    }

    fn killer(&self) -> Killer {
        let a = self.abort.clone();
        Arc::new(move || a.fire())
    }

    fn server_info(&self) -> String {
        self.info.clone()
    }
}

/// The text of a 550 reply says the entry does not exist (vsftpd, ProFTPD, Pure-FTPd,
/// FileZilla Server, IIS phrase it like this).
fn says_not_found(text: &str) -> bool {
    let t = text.to_lowercase();
    [
        "no such file",
        "not found",
        "does not exist",
        "doesn't exist",
        "cannot find",
        "can't find",
        "can't check for file existence",
        "could not get file",
        "the system cannot find",
    ]
    .iter()
    .any(|p| t.contains(p))
}

/// A TLS connector that bounds every socket it sees (control and data channels of
/// implicit FTPS) by the profile timeout and registers it for disconnect.
#[derive(Debug)]
struct TimedConnector {
    inner: RustlsConnector,
    timeout: Duration,
    sockets: Sockets,
}

impl suppaftp::TlsConnector for TimedConnector {
    type Stream = <RustlsConnector as suppaftp::TlsConnector>::Stream;

    fn connect(&self, domain: &str, stream: TcpStream) -> suppaftp::FtpResult<Self::Stream> {
        stream.set_read_timeout(Some(self.timeout)).ok();
        stream.set_write_timeout(Some(self.timeout)).ok();
        register(&self.sockets, &stream);
        self.inner.connect(domain, stream)
    }
}

/// Opens an FTP/FTPS connection. For FTPS `tls` holds the client config (OS trust + pin).
pub fn connect(
    p: &RemoteProfile,
    password: Option<&Secret>,
    tls: Option<Arc<rustls::ClientConfig>>,
) -> Result<Box<dyn RemoteFs>, FsError> {
    let timeout = Duration::from_secs(u64::from(p.timeout_secs));
    let tcp = tcp_connect(&p.host, p.port, timeout)?;
    let ipv6 = tcp.peer_addr().map(|a| a.is_ipv6()).unwrap_or(false);
    let abort = FtpAbort {
        flag: Abort::default(),
        sockets: Arc::new(Mutex::new(Vec::new())),
    };
    register(&abort.sockets, &tcp);
    let addr = p.address();
    match p.kind {
        RemoteKind::Ftp => {
            let ftp =
                suppaftp::FtpStream::connect_with_stream(tcp).map_err(|e| ftp_error(e, &addr))?;
            let conn = FtpConn::setup(ftp, p, password, abort, timeout, ipv6)?;
            Ok(Box::new(conn))
        }
        RemoteKind::FtpsExplicit => {
            let cfg =
                tls.ok_or_else(|| FsError::at(FsErrorCode::RemoteProtocol, "no TLS", &addr))?;
            let ftp = suppaftp::RustlsFtpStream::connect_with_stream(tcp)
                .map_err(|e| ftp_error(e, &addr))?
                .into_secure(RustlsConnector::from(cfg), &p.host)
                .map_err(|e| ftp_error(e, &addr))?;
            let conn = FtpConn::setup(ftp, p, password, abort, timeout, ipv6)?;
            Ok(Box::new(conn))
        }
        RemoteKind::FtpsImplicit => {
            let cfg =
                tls.ok_or_else(|| FsError::at(FsErrorCode::RemoteProtocol, "no TLS", &addr))?;
            // suppaftp opens the socket itself here: the probe above ensured the host answers.
            // The connector gets that socket before the handshake – timeouts and kill apply
            // from the first byte on (review 034 #6).
            let peer = tcp.peer_addr().map_err(|e| io_error(&e, &addr))?;
            drop(tcp);
            let ftp = suppaftp::RustlsFtpStream::connect_secure_implicit(
                peer,
                TimedConnector {
                    inner: RustlsConnector::from(cfg),
                    timeout,
                    sockets: abort.sockets.clone(),
                },
                &p.host,
            )
            .map_err(|e| ftp_error(e, &addr))?;
            let conn = FtpConn::setup(ftp, p, password, abort, timeout, ipv6)?;
            Ok(Box::new(conn))
        }
        RemoteKind::Sftp => Err(FsError::at(FsErrorCode::RemoteProtocol, "not FTP", &addr)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_only_when_the_reply_says_so() {
        assert!(says_not_found("/a: No such file or directory"));
        assert!(says_not_found("Could not get file information"));
        assert!(says_not_found("The system cannot find the file specified."));
        assert!(!says_not_found("Permission denied"));
        assert!(!says_not_found("Requested action not taken"));
        assert!(!says_not_found(""));
    }

    /// Review 034 #6: an implicit-FTPS server that accepts and then stays silent ends
    /// in the timeout (the TLS handshake used to wait forever).
    #[test]
    fn implicit_ftps_gives_up_on_a_silent_server() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let mut held = Vec::new();
            for s in listener.incoming() {
                held.push(s);
            }
        });
        let p = RemoteProfile {
            kind: RemoteKind::FtpsImplicit,
            host: "127.0.0.1".into(),
            port,
            user: "u".into(),
            timeout_secs: 1,
            ..RemoteProfile::default()
        };
        let (cfg, _) = super::super::trust::tls_config(None, false, None).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let r = connect(&p, Some(&Secret::new("pw")), Some(cfg));
            let _ = tx.send(r.err().map(|e| e.code));
        });
        let code = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("connect hangs");
        assert_eq!(code, Some(FsErrorCode::RemoteTimeout));
    }

    #[test]
    fn list_lines_unix_and_dos() {
        let lines: Vec<String> = [
            "total 8",
            "drwxr-xr-x    2 1000     1000         4096 Oct 21 10:00 pub",
            "-rw-r--r--    1 1000     1000          123 Jan 02  2024 a b.txt",
            "lrwxrwxrwx    1 0        0               3 Oct 21 10:00 link -> pub",
            "drwxr-xr-x    2 1000     1000         4096 Oct 21 10:00 .",
            "10-21-26  10:00AM       <DIR>          Dos Dir",
            "10-21-26  10:00AM                  42 dos.txt",
            "garbage line",
            "",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let l = parse_list(&lines);
        let names: Vec<(&str, EntryKind, Option<u64>)> = l
            .entries
            .iter()
            .map(|e| (e.name.as_str(), e.kind, e.size))
            .collect();
        assert_eq!(
            names,
            [
                ("pub", EntryKind::Directory, None),
                ("a b.txt", EntryKind::File, Some(123)),
                ("link", EntryKind::Symlink, None),
                ("Dos Dir", EntryKind::Directory, None),
                ("dos.txt", EntryKind::File, Some(42)),
            ]
        );
        assert_eq!(l.unreadable, 1);
        assert!(l.entries.iter().all(|e| !e.lossy));
    }

    #[test]
    fn mlsd_lines() {
        let lines: Vec<String> = [
            "type=cdir;modify=20261021100000; .",
            "type=pdir;modify=20261021100000; ..",
            "type=dir;modify=20261021100000;UNIX.mode=0755; pub",
            "type=file;size=5;modify=20261021100000.123; a;b c.txt",
            "type=file;size=1; bad\u{FFFD}name",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let l = parse_mlsd(&lines);
        assert_eq!(l.entries.len(), 3);
        assert_eq!(l.entries[1].name, "a;b c.txt");
        assert_eq!(l.entries[1].size, Some(5));
        assert_eq!(l.entries[0].modified_ms, Some(1_792_576_800_000));
        assert!(l.entries[2].lossy);
    }

    #[test]
    fn mfmt_times() {
        assert_eq!(mfmt_time(0).as_deref(), Some("19700101000000"));
        assert_eq!(
            mfmt_time(1_792_576_800_000).as_deref(),
            Some("20261021100000")
        );
        assert_eq!(
            mfmt_time(951_782_400_000).as_deref(),
            Some("20000229000000")
        );
        assert_eq!(mfmt_time(-1000), None);
    }

    #[test]
    fn errors_map_to_codes() {
        let r = |code: u32, body: &str| {
            ftp_error(
                FtpError::UnexpectedResponse(suppaftp::types::Response::new(
                    Status::from(code),
                    body.as_bytes().to_vec(),
                )),
                "/x",
            )
            .code
        };
        assert_eq!(r(530, "Login incorrect."), FsErrorCode::RemoteAuthFailed);
        assert_eq!(r(550, "No such file"), FsErrorCode::NotFound);
        assert_eq!(r(550, "Permission denied."), FsErrorCode::PermissionDenied);
        assert_eq!(r(552, "full"), FsErrorCode::DiskFull);
        assert_eq!(r(500, "?"), FsErrorCode::RemoteProtocol);
        assert_eq!(parent_and_name("/a/b"), Some(("/a", "b")));
        assert_eq!(parent_and_name("/a"), Some(("/", "a")));
        assert_eq!(parent_and_name("/"), None);
    }
}
