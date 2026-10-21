//! SFTP over SSH with `russh` + `russh-sftp` (pure Rust, design 034 E2), wrapped into
//! the blocking [`RemoteFs`]. The async code runs on a small runtime of its own
//! ([`runtime`]); every call waits at most the profile's timeout and returns at once
//! when the connection is killed. Host keys are checked in [`Client::check_server_key`]
//! against the known_hosts files (design 034 E5).

use super::fs::{Killer, RemoteEntry, RemoteFs, RemoteListing, RemoteMeta, Sink, join};
use super::path::valid_segment;
use super::profiles::{AuthKind, RemoteProfile};
use super::trust::{HostKeyCheck, check_host_key, fingerprint};
use crate::error::{FsError, FsErrorCode};
use crate::model::EntryKind;
use crate::secret::Secret;
use russh::keys::PublicKey;
use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use std::future::Future;
use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const CHUNK: usize = 256 * 1024;

/// The runtime all SFTP connections run on (2 workers, never Tauri's).
pub fn runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("fnf-remote")
            .enable_all()
            .build()
            .expect("tokio runtime for server connections")
    })
}

/// What the host key check saw (for the trust dialog).
#[derive(Debug, Clone)]
pub enum HostKeySeen {
    /// `key` is recorded when the user confirms the fingerprint.
    Unknown {
        key_type: String,
        fingerprint: String,
        key: Box<PublicKey>,
    },
    Changed {
        fingerprint: String,
        file: PathBuf,
        line: usize,
    },
}

pub struct Client {
    host: String,
    port: u16,
    user_known_hosts: Option<PathBuf>,
    app_known_hosts: PathBuf,
    seen: Arc<Mutex<Option<HostKeySeen>>>,
}

impl russh::client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key: PublicKey = match server_public_key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            // host certificates: trusted like their key (no @cert-authority support)
            russh::keys::PublicKeyOrCertificate::Certificate(c) => {
                PublicKey::from(c.public_key().clone())
            }
        };
        let check = check_host_key(
            &self.host,
            self.port,
            &key,
            self.user_known_hosts.as_deref(),
            &self.app_known_hosts,
        );
        let seen = match check {
            HostKeyCheck::Known => return Ok(true),
            HostKeyCheck::Unknown => HostKeySeen::Unknown {
                key_type: key.algorithm().to_string(),
                fingerprint: fingerprint(&key),
                key: Box::new(key.clone()),
            },
            HostKeyCheck::Changed { file, line } => HostKeySeen::Changed {
                fingerprint: fingerprint(&key),
                file,
                line,
            },
        };
        *self.seen.lock().unwrap_or_else(|e| e.into_inner()) = Some(seen);
        Ok(false)
    }
}

/// Where host keys are looked up / recorded.
#[derive(Debug, Clone)]
pub struct KnownHosts {
    /// `~/.ssh/known_hosts` – read only.
    pub user: Option<PathBuf>,
    /// The app's own file.
    pub app: PathBuf,
}

pub struct SftpConn {
    handle: russh::client::Handle<Client>,
    sftp: SftpSession,
    timeout: Duration,
    kill: tokio::sync::watch::Sender<bool>,
    info: String,
}

fn sftp_error(e: SftpError, path: &str) -> FsError {
    match e {
        SftpError::Status(s) => {
            let code = match s.status_code {
                StatusCode::NoSuchFile => FsErrorCode::NotFound,
                StatusCode::PermissionDenied => FsErrorCode::PermissionDenied,
                StatusCode::ConnectionLost | StatusCode::NoConnection => {
                    FsErrorCode::RemoteConnectionLost
                }
                StatusCode::OpUnsupported => FsErrorCode::RemoteUnsupported,
                _ => FsErrorCode::RemoteProtocol,
            };
            FsError::at(
                code,
                format!("{}: {}", s.status_code, s.error_message),
                path,
            )
        }
        SftpError::Timeout => FsError::at(FsErrorCode::RemoteTimeout, "Timeout", path),
        SftpError::IO(m) => FsError::at(FsErrorCode::RemoteConnectionLost, m, path),
        other => FsError::at(FsErrorCode::RemoteProtocol, other.to_string(), path),
    }
}

fn ssh_error(e: &russh::Error, label: &str) -> FsError {
    let code = match e {
        russh::Error::IO(io) => return super::fs::io_error(io, label),
        russh::Error::ConnectionTimeout | russh::Error::KeepaliveTimeout => {
            FsErrorCode::RemoteTimeout
        }
        russh::Error::Disconnect | russh::Error::HUP => FsErrorCode::RemoteConnectionLost,
        _ => FsErrorCode::RemoteProtocol,
    };
    FsError::at(code, e.to_string(), label)
}

fn meta_of(a: &FileAttributes) -> RemoteMeta {
    let kind = if a.is_symlink() {
        EntryKind::Symlink
    } else if a.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::File
    };
    RemoteMeta {
        kind,
        size: (kind == EntryKind::File).then_some(a.size).flatten(),
        modified_ms: a.mtime.map(|t| i64::from(t) * 1000),
        mode: a.permissions.map(|p| p & 0o7777),
    }
}

/// Runs `f` on the SFTP runtime: at most `timeout`, at once on kill.
fn block<T>(
    kill: &tokio::sync::watch::Sender<bool>,
    timeout: Duration,
    label: &str,
    f: impl Future<Output = Result<T, FsError>>,
) -> Result<T, FsError>
where
    T: Send,
{
    let mut rx = kill.subscribe();
    if *rx.borrow() {
        return Err(FsError::at(
            FsErrorCode::RemoteNotConnected,
            "Disconnected",
            label,
        ));
    }
    runtime().block_on(async move {
        tokio::select! {
            r = tokio::time::timeout(timeout, f) => match r {
                Ok(r) => r,
                Err(_) => Err(FsError::at(FsErrorCode::RemoteTimeout, "Timeout", label)),
            },
            _ = rx.wait_for(|k| *k) => Err(FsError::at(FsErrorCode::RemoteNotConnected, "Disconnected", label)),
        }
    })
}

impl SftpConn {
    fn run<T: Send>(
        &self,
        label: &str,
        f: impl Future<Output = Result<T, FsError>>,
    ) -> Result<T, FsError> {
        block(&self.kill, self.timeout, label, f)
    }
}

impl RemoteFs for SftpConn {
    fn home(&mut self) -> Result<String, FsError> {
        let sftp = &self.sftp;
        self.run("/", async move {
            sftp.canonicalize(".").await.map_err(|e| sftp_error(e, "/"))
        })
        .map(|p| if p.starts_with('/') { p } else { "/".into() })
    }

    fn list(&mut self, dir: &str) -> Result<RemoteListing, FsError> {
        let sftp = &self.sftp;
        let entries = self.run(dir, async move {
            sftp.read_dir(dir).await.map_err(|e| sftp_error(e, dir))
        })?;
        let mut out = RemoteListing::default();
        let mut links = Vec::new();
        for e in entries {
            let name = e.file_name();
            if name == "." || name == ".." || name.is_empty() {
                continue;
            }
            let m = meta_of(&e.metadata());
            let lossy = name.contains('\u{FFFD}') || !valid_segment(&name);
            if m.kind == EntryKind::Symlink && !lossy {
                links.push(out.entries.len());
            }
            out.entries.push(RemoteEntry {
                name,
                kind: m.kind,
                target_kind: None,
                size: m.size,
                modified_ms: m.modified_ms,
                mode: m.mode,
                lossy,
            });
        }
        for i in links {
            let full = join(dir, &out.entries[i].name);
            if let Ok(Some(t)) = self.stat_follow(&full) {
                out.entries[i].target_kind = Some(t.kind);
                if t.kind == EntryKind::File {
                    out.entries[i].size = t.size;
                }
            }
        }
        Ok(out)
    }

    fn stat(&mut self, path: &str) -> Result<Option<RemoteMeta>, FsError> {
        let sftp = &self.sftp;
        let r = self.run(path, async move { Ok(sftp.symlink_metadata(path).await) })?;
        match r {
            Ok(a) => Ok(Some(meta_of(&a))),
            Err(e) => {
                let e = sftp_error(e, path);
                if e.code == FsErrorCode::NotFound {
                    Ok(None)
                } else {
                    Err(e)
                }
            }
        }
    }

    fn stat_follow(&mut self, path: &str) -> Result<Option<RemoteMeta>, FsError> {
        let sftp = &self.sftp;
        let r = self.run(path, async move { Ok(sftp.metadata(path).await) })?;
        match r {
            Ok(a) => Ok(Some(meta_of(&a))),
            Err(e) => {
                let e = sftp_error(e, path);
                if e.code == FsErrorCode::NotFound {
                    Ok(None)
                } else {
                    Err(e)
                }
            }
        }
    }

    fn read(&mut self, path: &str, sink: &mut Sink<'_>) -> Result<bool, FsError> {
        let sftp = &self.sftp;
        let mut file = self.run(path, async move {
            sftp.open(path).await.map_err(|e| sftp_error(e, path))
        })?;
        let mut buf = vec![0u8; CHUNK];
        loop {
            let (n, back) = self.run(path, async move {
                let mut b = buf;
                let n = file.read(&mut b).await;
                Ok((n.map_err(|e| super::fs::io_error(&e, path)), (b, file)))
            })?;
            let (b, f) = back;
            buf = b;
            file = f;
            let n = n?;
            if n == 0 {
                break;
            }
            match sink(&buf[..n]) {
                Ok(true) => {}
                Ok(false) => return Ok(false),
                Err(e) => return Err(FsError::at(FsErrorCode::Io, e.to_string(), path)),
            }
        }
        let _ = self.run(path, async move {
            let _ = file.shutdown().await;
            Ok(())
        });
        Ok(true)
    }

    fn write(&mut self, path: &str, source: &mut dyn Read) -> Result<u64, FsError> {
        let sftp = &self.sftp;
        let mut file = self.run(path, async move {
            sftp.open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| sftp_error(e, path))
        })?;
        let mut buf = vec![0u8; CHUNK];
        let mut total = 0u64;
        loop {
            let n = match source.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    let _ = self.run(path, async move {
                        let _ = file.shutdown().await;
                        Ok(())
                    });
                    let code = if e.kind() == io::ErrorKind::Interrupted {
                        FsErrorCode::Io
                    } else {
                        FsError::from_io(&e, std::path::Path::new(path)).code
                    };
                    return Err(FsError::at(code, e.to_string(), path));
                }
            };
            let chunk = buf[..n].to_vec();
            file = self.run(path, async move {
                file.write_all(&chunk)
                    .await
                    .map_err(|e| super::fs::io_error(&e, path))?;
                Ok(file)
            })?;
            total += n as u64;
        }
        self.run(path, async move {
            file.flush()
                .await
                .map_err(|e| super::fs::io_error(&e, path))?;
            file.shutdown()
                .await
                .map_err(|e| super::fs::io_error(&e, path))
        })?;
        Ok(total)
    }

    fn mkdir(&mut self, path: &str) -> Result<(), FsError> {
        let sftp = &self.sftp;
        self.run(path, async move {
            sftp.create_dir(path).await.map_err(|e| sftp_error(e, path))
        })
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), FsError> {
        let sftp = &self.sftp;
        self.run(from, async move {
            sftp.rename(from, to).await.map_err(|e| sftp_error(e, from))
        })
    }

    fn remove_file(&mut self, path: &str) -> Result<(), FsError> {
        let sftp = &self.sftp;
        self.run(path, async move {
            sftp.remove_file(path)
                .await
                .map_err(|e| sftp_error(e, path))
        })
    }

    fn remove_dir(&mut self, path: &str) -> Result<(), FsError> {
        let sftp = &self.sftp;
        self.run(path, async move {
            sftp.remove_dir(path).await.map_err(|e| sftp_error(e, path))
        })
    }

    fn set_mtime(&mut self, path: &str, ms: i64) -> Result<bool, FsError> {
        let Ok(secs) = u32::try_from(ms.div_euclid(1000)) else {
            return Ok(false);
        };
        let sftp = &self.sftp;
        self.run(path, async move {
            let attrs = FileAttributes {
                atime: Some(secs),
                mtime: Some(secs),
                ..FileAttributes::empty()
            };
            sftp.set_metadata(path, attrs)
                .await
                .map_err(|e| sftp_error(e, path))
        })?;
        Ok(true)
    }

    fn noop(&mut self) -> Result<(), FsError> {
        if self.handle.is_closed() {
            return Err(FsError::at(
                FsErrorCode::RemoteConnectionLost,
                "Connection closed",
                "/",
            ));
        }
        self.home().map(|_| ())
    }

    fn killer(&self) -> Killer {
        let kill = self.kill.clone();
        Arc::new(move || {
            kill.send_replace(true);
        })
    }

    fn server_info(&self) -> String {
        self.info.clone()
    }
}

impl Drop for SftpConn {
    fn drop(&mut self) {
        self.kill.send_replace(true);
    }
}

/// How an SFTP connect failed beyond a plain error.
pub enum SftpConnectError {
    Error(FsError),
    HostKey(HostKeySeen),
    /// The key file is encrypted and no (or a wrong) passphrase was given.
    NeedsPassphrase,
}

impl From<FsError> for SftpConnectError {
    fn from(e: FsError) -> Self {
        SftpConnectError::Error(e)
    }
}

async fn agent_auth(
    handle: &mut russh::client::Handle<Client>,
    user: &str,
) -> Result<bool, FsError> {
    let label = "agent";
    let failed =
        |e: russh::keys::Error| FsError::at(FsErrorCode::RemoteAuthFailed, e.to_string(), label);
    #[cfg(unix)]
    let mut agent = russh::keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(failed)?
        .dynamic();
    #[cfg(windows)]
    let mut agent = match russh::keys::agent::client::AgentClient::connect_named_pipe(
        r"\\.\pipe\openssh-ssh-agent",
    )
    .await
    {
        Ok(a) => a.dynamic(),
        Err(_) => russh::keys::agent::client::AgentClient::connect_pageant()
            .await
            .map_err(failed)?
            .dynamic(),
    };
    let ids = agent.request_identities().await.map_err(failed)?;
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    for id in ids {
        let russh::keys::agent::AgentIdentity::PublicKey { key, .. } = id else {
            continue;
        };
        let hash = if key.algorithm().is_rsa() {
            rsa_hash
        } else {
            None
        };
        if let Ok(r) = handle
            .authenticate_publickey_with(user, key, hash, &mut agent)
            .await
            && r.success()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Opens an SFTP connection. `password` = login password (auth `password`) or key
/// passphrase (auth `key`).
pub fn connect(
    p: &RemoteProfile,
    password: Option<&Secret>,
    known: &KnownHosts,
) -> Result<Box<dyn RemoteFs>, SftpConnectError> {
    let timeout = Duration::from_secs(u64::from(p.timeout_secs));
    let label = p.address();
    let seen = Arc::new(Mutex::new(None));
    let client = Client {
        host: p.host.clone(),
        port: p.port,
        user_known_hosts: known.user.clone(),
        app_known_hosts: known.app.clone(),
        seen: seen.clone(),
    };
    let config = russh::client::Config {
        inactivity_timeout: None,
        keepalive_interval: (p.keepalive_secs > 0)
            .then(|| Duration::from_secs(u64::from(p.keepalive_secs))),
        keepalive_max: 3,
        preferred: russh::Preferred {
            key: std::borrow::Cow::Owned(super::trust::preferred_host_key_algorithms(
                &p.host,
                p.port,
                known.user.as_deref(),
                &known.app,
            )),
            ..Default::default()
        },
        ..Default::default()
    };
    // a key file is read before connecting: a wrong passphrase needs no network round trip
    let key = match (p.auth, &p.key_file) {
        (AuthKind::Key, Some(file)) => {
            match russh::keys::load_secret_key(file, password.map(|s| s.expose())) {
                Ok(k) => Some(Arc::new(k)),
                Err(russh::keys::Error::KeyIsEncrypted) => {
                    return Err(SftpConnectError::NeedsPassphrase);
                }
                Err(e) if password.is_some() && e.to_string().to_lowercase().contains("crypt") => {
                    return Err(SftpConnectError::NeedsPassphrase);
                }
                Err(e) => {
                    return Err(
                        FsError::at(FsErrorCode::RemoteAuthFailed, e.to_string(), file).into(),
                    );
                }
            }
        }
        _ => None,
    };
    let (kill, _) = tokio::sync::watch::channel(false);
    let host = p.host.clone();
    let port = p.port;
    let user = p.user.clone();
    let auth = p.auth;
    let pass = password.cloned();
    let lbl = label.clone();
    let result = block(&kill, timeout, &label, async move {
        let mut handle =
            match russh::client::connect(Arc::new(config), (host.as_str(), port), client).await {
                Ok(h) => h,
                Err(e) => return Ok(Err(e)),
            };
        let ok = match auth {
            AuthKind::Password => {
                let pw = pass
                    .as_ref()
                    .map(|s| s.expose().to_string())
                    .unwrap_or_default();
                let pw = zeroize::Zeroizing::new(pw);
                handle
                    .authenticate_password(user.clone(), pw.as_str())
                    .await
                    .map(|r| r.success())
                    .map_err(|e| ssh_error(&e, &lbl))?
            }
            AuthKind::Key => {
                let key = key.expect("loaded above");
                let hash = if key.algorithm().is_rsa() {
                    handle
                        .best_supported_rsa_hash()
                        .await
                        .ok()
                        .flatten()
                        .flatten()
                } else {
                    None
                };
                handle
                    .authenticate_publickey(
                        user.clone(),
                        russh::keys::PrivateKeyWithHashAlg::new(key, hash),
                    )
                    .await
                    .map(|r| r.success())
                    .map_err(|e| ssh_error(&e, &lbl))?
            }
            AuthKind::Agent => agent_auth(&mut handle, &user).await?,
        };
        if !ok {
            return Err(FsError::at(
                FsErrorCode::RemoteAuthFailed,
                "Login refused",
                &lbl,
            ));
        }
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| ssh_error(&e, &lbl))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| ssh_error(&e, &lbl))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| sftp_error(e, &lbl))?;
        sftp.set_timeout(timeout.as_secs().max(1));
        Ok(Ok((handle, sftp)))
    });
    let (handle, sftp) = match result {
        Ok(Ok(pair)) => pair,
        Ok(Err(e)) => {
            if let Some(s) = seen.lock().unwrap_or_else(|e| e.into_inner()).take() {
                return Err(SftpConnectError::HostKey(s));
            }
            return Err(ssh_error(&e, &label).into());
        }
        Err(e) => {
            if let Some(s) = seen.lock().unwrap_or_else(|e| e.into_inner()).take() {
                return Err(SftpConnectError::HostKey(s));
            }
            return Err(e.into());
        }
    };
    Ok(Box::new(SftpConn {
        handle,
        sftp,
        timeout,
        kill,
        info: "SFTP".into(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sftp_errors_map() {
        let s = |code| {
            sftp_error(
                SftpError::Status(russh_sftp::protocol::Status {
                    id: 1,
                    status_code: code,
                    error_message: "x".into(),
                    language_tag: "en".into(),
                }),
                "/a",
            )
            .code
        };
        assert_eq!(s(StatusCode::NoSuchFile), FsErrorCode::NotFound);
        assert_eq!(
            s(StatusCode::PermissionDenied),
            FsErrorCode::PermissionDenied
        );
        assert_eq!(s(StatusCode::Failure), FsErrorCode::RemoteProtocol);
        assert_eq!(
            sftp_error(SftpError::Timeout, "/").code,
            FsErrorCode::RemoteTimeout
        );
    }
}
