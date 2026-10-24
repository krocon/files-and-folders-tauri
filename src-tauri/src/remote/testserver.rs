//! In-process FTP(S) and SFTP servers for the tests (design 034 §5): no daemon, the
//! same on every OS. Both serve a temporary folder; user `u`, password [`PASSWORD`].
//! The SFTP server also accepts the public key passed to [`start_sftp`].

use super::sftp::runtime;
use russh::keys::{PrivateKey, PublicKey};
use russh::server::{Auth, Msg, Server as _, Session};
use russh::{Channel, ChannelId};
use russh_sftp::protocol::{
    Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode, Version,
};
use rustls::pki_types::CertificateDer;
use rustls::pki_types::pem::PemObject;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpListener as StdListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU16, Ordering};
use tempfile::TempDir;

pub const USER: &str = "u";
/// Long and unusual: tests check that it never shows up in files (a 2-letter "pw" could appear in a
/// random id or fingerprint by chance).
pub const PASSWORD: &str = "testSecretQx7";

fn testdata() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/remote/testdata")
}

pub fn test_ca() -> CertificateDer<'static> {
    CertificateDer::from_pem_file(testdata().join("ca.pem")).expect("test CA")
}

fn free_port() -> u16 {
    StdListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .expect("free port")
}

/// Passive ports: a different range per server so parallel tests do not collide.
fn passive_range() -> std::ops::RangeInclusive<u16> {
    static NEXT: AtomicU16 = AtomicU16::new(0);
    let n = NEXT.fetch_add(1, Ordering::SeqCst) % 400;
    let start = 41_000 + n * 50;
    start..=start + 40
}

// ---- FTP ------------------------------------------------------------------------

#[derive(Debug)]
struct TestAuth;

#[async_trait::async_trait]
impl unftp_core::auth::Authenticator for TestAuth {
    async fn authenticate(
        &self,
        username: &str,
        creds: &unftp_core::auth::Credentials,
    ) -> Result<unftp_core::auth::Principal, unftp_core::auth::AuthenticationError> {
        let ok = (username == USER && creds.password.as_deref() == Some(PASSWORD))
            || username == "anonymous";
        if ok {
            Ok(unftp_core::auth::Principal {
                username: username.to_string(),
            })
        } else {
            Err(unftp_core::auth::AuthenticationError::BadPassword)
        }
    }
}

pub struct TestFtp {
    pub port: u16,
    pub root: TempDir,
}

/// Starts an FTP server; `tls` = FTPS (explicit, `AUTH TLS`) with the test certificate.
pub fn start_ftp(tls: bool) -> TestFtp {
    let root = tempfile::tempdir().expect("ftp root");
    let dir = root.path().to_path_buf();
    let port = free_port();
    let passive = passive_range();
    let mut builder = libunftp::ServerBuilder::with_authenticator(
        Box::new(move || unftp_sbe_fs::Filesystem::new(dir.clone()).expect("fs backend")),
        Arc::new(TestAuth),
    )
    .greeting("FnF test server")
    .passive_ports(passive);
    if tls {
        builder = builder.ftps(testdata().join("server.pem"), testdata().join("server.key"));
    }
    let server = builder.build().expect("ftp server");
    runtime().spawn(async move {
        let _ = server.listen(format!("127.0.0.1:{port}")).await;
    });
    // wait until it accepts
    for _ in 0..200 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    TestFtp { port, root }
}

// ---- SFTP -----------------------------------------------------------------------

pub struct TestSftp {
    pub port: u16,
    pub root: TempDir,
    pub host_key: PrivateKey,
}

#[derive(Clone)]
struct SshServer {
    root: PathBuf,
    client_key: Option<PublicKey>,
}

impl russh::server::Server for SshServer {
    type Handler = SshSession;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> SshSession {
        SshSession {
            root: self.root.clone(),
            client_key: self.client_key.clone(),
            channels: HashMap::new(),
        }
    }
}

struct SshSession {
    root: PathBuf,
    client_key: Option<PublicKey>,
    channels: HashMap<ChannelId, Channel<Msg>>,
}

impl russh::server::Handler for SshSession {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if user == USER && password == PASSWORD {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        Ok(
            if user == USER
                && self
                    .client_key
                    .as_ref()
                    .is_some_and(|k| k.key_data() == key.key_data())
            {
                Auth::Accept
            } else {
                Auth::reject()
            },
        )
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        match (name, self.channels.remove(&channel_id)) {
            ("sftp", Some(channel)) => {
                session.channel_success(channel_id)?;
                let handler = Sftp {
                    root: self.root.clone(),
                    handles: HashMap::new(),
                    next: 0,
                };
                tokio::spawn(russh_sftp::server::run(channel.into_stream(), handler));
            }
            _ => session.channel_failure(channel_id)?,
        }
        Ok(())
    }
}

enum H {
    File(std::fs::File),
    Dir(Option<Vec<File>>),
}

/// SFTP over a folder: `/` is the root of the test folder.
struct Sftp {
    root: PathBuf,
    handles: HashMap<String, H>,
    next: u64,
}

fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".into(),
        language_tag: "en".into(),
    }
}

fn code_of(e: &std::io::Error) -> StatusCode {
    match e.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NoSuchFile,
        std::io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
        _ => StatusCode::Failure,
    }
}

impl Sftp {
    fn real(&self, p: &str) -> Result<PathBuf, StatusCode> {
        let mut out = self.root.clone();
        for seg in p.split('/') {
            match seg {
                "" | "." => {}
                ".." => return Err(StatusCode::PermissionDenied),
                s => out.push(s),
            }
        }
        Ok(out)
    }
    fn handle(&mut self, h: H) -> String {
        self.next += 1;
        let k = self.next.to_string();
        self.handles.insert(k.clone(), h);
        k
    }
}

impl russh_sftp::server::Handler for Sftp {
    type Error = StatusCode;

    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }

    async fn init(&mut self, _v: u32, _e: HashMap<String, String>) -> Result<Version, StatusCode> {
        Ok(Version::new())
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, StatusCode> {
        let p = if path == "." || path.is_empty() {
            "/".to_string()
        } else {
            path
        };
        Ok(Name {
            id,
            files: vec![File::dummy(p)],
        })
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _a: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        let real = self.real(&filename)?;
        let f = std::fs::OpenOptions::new()
            .read(pflags.contains(OpenFlags::READ))
            .write(pflags.contains(OpenFlags::WRITE))
            .create(pflags.contains(OpenFlags::CREATE))
            .truncate(pflags.contains(OpenFlags::TRUNCATE))
            .open(real)
            .map_err(|e| code_of(&e))?;
        Ok(Handle {
            id,
            handle: self.handle(H::File(f)),
        })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, StatusCode> {
        self.handles.remove(&handle);
        Ok(ok(id))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusCode> {
        let Some(H::File(f)) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        f.seek(SeekFrom::Start(offset)).map_err(|e| code_of(&e))?;
        let mut buf = vec![0u8; len as usize];
        let n = f.read(&mut buf).map_err(|e| code_of(&e))?;
        if n == 0 {
            return Err(StatusCode::Eof);
        }
        buf.truncate(n);
        Ok(Data { id, data: buf })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, StatusCode> {
        let Some(H::File(f)) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        f.seek(SeekFrom::Start(offset)).map_err(|e| code_of(&e))?;
        f.write_all(&data).map_err(|e| code_of(&e))?;
        Ok(ok(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let m = std::fs::symlink_metadata(self.real(&path)?).map_err(|e| code_of(&e))?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&m),
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let m = std::fs::metadata(self.real(&path)?).map_err(|e| code_of(&e))?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&m),
        })
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, StatusCode> {
        let Some(H::File(f)) = self.handles.get(&handle) else {
            return Err(StatusCode::Failure);
        };
        let m = f.metadata().map_err(|e| code_of(&e))?;
        Ok(Attrs {
            id,
            attrs: FileAttributes::from(&m),
        })
    }

    async fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusCode> {
        if let Some(t) = attrs.mtime {
            let f = std::fs::File::options()
                .write(true)
                .open(self.real(&path)?)
                .or_else(|_| std::fs::File::open(self.real(&path).unwrap_or_default()))
                .map_err(|e| code_of(&e))?;
            f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(u64::from(t)))
                .map_err(|e| code_of(&e))?;
        }
        Ok(ok(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, StatusCode> {
        let real = self.real(&path)?;
        let mut files = Vec::new();
        for e in std::fs::read_dir(&real).map_err(|e| code_of(&e))? {
            let e = e.map_err(|e| code_of(&e))?;
            let m = std::fs::symlink_metadata(e.path()).map_err(|e| code_of(&e))?;
            files.push(File::new(
                e.file_name().to_string_lossy(),
                FileAttributes::from(&m),
            ));
        }
        Ok(Handle {
            id,
            handle: self.handle(H::Dir(Some(files))),
        })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, StatusCode> {
        match self.handles.get_mut(&handle) {
            Some(H::Dir(files)) => match files.take() {
                Some(files) => Ok(Name { id, files }),
                None => Err(StatusCode::Eof),
            },
            _ => Err(StatusCode::Failure),
        }
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, StatusCode> {
        std::fs::remove_file(self.real(&filename)?).map_err(|e| code_of(&e))?;
        Ok(ok(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _a: FileAttributes,
    ) -> Result<Status, StatusCode> {
        std::fs::create_dir(self.real(&path)?).map_err(|e| code_of(&e))?;
        Ok(ok(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, StatusCode> {
        std::fs::remove_dir(self.real(&path)?).map_err(|e| code_of(&e))?;
        Ok(ok(id))
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, StatusCode> {
        let to = self.real(&newpath)?;
        // SFTP v3: renaming onto an existing name fails – and, like a server on macOS or
        // Windows, a name in another case counts as existing (on every test system, so
        // the case change in two steps is tested everywhere)
        let taken_in_any_case = |to: &Path| {
            let (Some(dir), Some(name)) = (to.parent(), to.file_name()) else {
                return false;
            };
            let name = name.to_string_lossy().to_lowercase();
            std::fs::read_dir(dir).is_ok_and(|entries| {
                entries
                    .flatten()
                    .any(|e| e.file_name().to_string_lossy().to_lowercase() == name)
            })
        };
        if std::fs::symlink_metadata(&to).is_ok() || taken_in_any_case(&to) {
            return Err(StatusCode::Failure);
        }
        std::fs::rename(self.real(&oldpath)?, to).map_err(|e| code_of(&e))?;
        Ok(ok(id))
    }

    async fn readlink(&mut self, id: u32, path: String) -> Result<Name, StatusCode> {
        let t = std::fs::read_link(self.real(&path)?).map_err(|e| code_of(&e))?;
        Ok(Name {
            id,
            files: vec![File::dummy(t.to_string_lossy())],
        })
    }
}

/// A host key from a seed (tests can make "the same" or "another" server).
pub fn host_key(seed: u8) -> PrivateKey {
    PrivateKey::from(russh::keys::ssh_key::private::Ed25519Keypair::from_seed(
        &[seed; 32],
    ))
}

/// Starts an SFTP server with host key `seed`; `client_key` may log in by key.
pub fn start_sftp(seed: u8, client_key: Option<PublicKey>) -> TestSftp {
    let root = tempfile::tempdir().expect("sftp root");
    let key = host_key(seed);
    let config = Arc::new(russh::server::Config {
        keys: vec![key.clone()],
        auth_rejection_time: std::time::Duration::from_millis(10),
        auth_rejection_time_initial: Some(std::time::Duration::from_millis(0)),
        ..Default::default()
    });
    let server: &'static mut SshServer = Box::leak(Box::new(SshServer {
        root: root.path().to_path_buf(),
        client_key,
    }));
    let listener = runtime()
        .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
        .expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let listener: &'static tokio::net::TcpListener = Box::leak(Box::new(listener));
    let running = {
        let _guard = runtime().enter();
        server.run_on_socket(config, listener)
    };
    runtime().spawn(async move {
        let _ = running.await;
    });
    TestSftp {
        port,
        root,
        host_key: key,
    }
}

/// Writes `bytes` to `<root>/<rel>` (creating folders).
/// The encrypted test key (passphrase `geheim`) and its public key.
pub fn client_key_file() -> (PathBuf, PublicKey) {
    let file = testdata().join("id_ed25519_pass");
    let public = std::fs::read_to_string(testdata().join("id_ed25519_pass.pub")).expect("pub key");
    (
        file,
        PublicKey::from_openssh(public.trim()).expect("public key"),
    )
}

pub fn put(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(p, bytes).unwrap();
}

/// The app hub for job tests (installed once; tests add their own profiles).
pub fn global_hub() -> &'static super::Hub {
    static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    let dir = DIR.get_or_init(|| tempfile::tempdir().expect("hub dir").keep());
    super::install_for_tests(
        super::Hub::new(
            dir.clone(),
            None,
            Arc::new(super::credentials::MemoryStore::default()),
        )
        .with_test_root(test_ca()),
    )
}

/// A connected profile on the global hub for `kind` at `port`.
pub fn connected(kind: super::profiles::RemoteKind, port: u16) -> String {
    let hub = global_hub();
    let p = hub
        .save_profile(super::profiles::RemoteProfile {
            name: format!("T{port}"),
            kind,
            host: if kind == super::profiles::RemoteKind::FtpsExplicit {
                "localhost".into()
            } else {
                "127.0.0.1".into()
            },
            port,
            user: USER.into(),
            timeout_secs: 5,
            ..Default::default()
        })
        .expect("profile");
    let pw = || Some(crate::secret::Secret::new(PASSWORD));
    match hub
        .connect(&p.id, pw(), super::Remember::Session)
        .expect("connect")
    {
        super::ConnectOutcome::HostKeyUnknown { fingerprint, .. } => {
            hub.trust_host_key(&p.id, &fingerprint).expect("trust");
            let out = hub
                .connect(&p.id, pw(), super::Remember::Session)
                .expect("connect");
            assert!(
                matches!(out, super::ConnectOutcome::Connected { .. }),
                "{out:?}"
            );
        }
        super::ConnectOutcome::Connected { .. } => {}
        other => panic!("{other:?}"),
    }
    p.id
}
