//! Server connections (design 034): FTP, FTPS and SFTP folders in the panels.
//!
//! The [`Hub`] owns the profiles, the connections (a small pool per profile), the
//! secrets of this run and the pending trust questions. Everything here blocks –
//! commands call it through `spawn_blocking`, jobs from their own threads.
//!
//! A profile is "connected" once the user connected it in this run; afterwards a
//! broken or missing connection is opened again silently with the secret of this run
//! (or the keychain). Before that every access fails with `remote_not_connected` –
//! nothing connects on its own (no network at start, design 034 §4.4).

pub mod credentials;
pub mod danger;
pub mod fs;
pub mod ftp;
pub mod path;
pub mod profiles;
pub mod sftp;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub mod testserver;
pub mod trust;
pub mod view;

pub use path::{RemotePath, is_remote};

use crate::error::{FsError, FsErrorCode};
use crate::model::{DirEntryDto, DirectoryListing, EntryKind, RemoteInfo};
use crate::secret::Secret;
use credentials::{SecretKind, SecretStore, SessionSecrets};
use fs::{Killer, RemoteFs, is_connection_error};
use profiles::{AuthKind, RemoteKind, RemoteProfile, SecretState};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnState {
    Disconnected,
    Connected,
    /// Was connected; the last connection broke (it is reopened on the next access).
    Lost,
}

/// How the user wants a secret entered now to be kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Remember {
    /// Only for this attempt.
    #[default]
    None,
    /// Until the app ends.
    Session,
    /// In the system keychain (and for this run).
    Keychain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ConnectOutcome {
    Connected {
        /// `remote://<id>/…` – start path of the profile or the login folder.
        home: String,
        encrypted: bool,
        server_info: String,
        /// The secret should have gone to the keychain, but that failed (kept for the session).
        keychain_failed: bool,
    },
    /// A password (`password`) or key passphrase (`passphrase`) is needed.
    NeedsSecret {
        what: String,
        keychain: bool,
        /// The stored secret was refused by the server.
        refused: bool,
    },
    HostKeyUnknown {
        key_type: String,
        fingerprint: String,
    },
    CertificateUntrusted {
        sha256: String,
        reason: String,
        hostname_mismatch: bool,
        pinned_changed: bool,
    },
}

/// A state change for the frontend (channel `subscribe_remote`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEvent {
    pub profile_id: String,
    pub state: ConnState,
}

struct Pool {
    idle: Vec<(Box<dyn RemoteFs>, Instant)>,
    busy: usize,
    killers: Vec<Killer>,
    state: ConnState,
    info: String,
    /// The folder after login (for the danger check).
    home: String,
}

type Listener = Arc<dyn Fn(RemoteEvent) + Send + Sync>;

pub struct Hub {
    config_dir: PathBuf,
    user_known_hosts: Option<PathBuf>,
    store: Arc<dyn SecretStore>,
    profiles: Mutex<Option<Vec<RemoteProfile>>>,
    /// The profile file could not be read or moved aside – never written over.
    write_blocked: Mutex<bool>,
    /// One change of the profile list at a time (read – change – write).
    editing: Mutex<()>,
    pools: Mutex<HashMap<String, Pool>>,
    freed: Condvar,
    secrets: SessionSecrets,
    /// Profiles whose secret was typed without "remember": forgotten on disconnect.
    ephemeral: Mutex<HashSet<String>>,
    pending_keys: Mutex<HashMap<String, sftp::HostKeySeen>>,
    /// A secret typed for a connect that stopped at a trust question: used by the next
    /// connect of that profile (after "trust"), so the frontend sends it only once.
    pending_secrets: Mutex<HashMap<String, (Secret, Remember)>>,
    pending_certs: Mutex<HashMap<String, trust::CertSeen>>,
    listeners: Mutex<Vec<Listener>>,
    /// Tests: trust this root instead of the system store (FTPS).
    test_root: Option<rustls::pki_types::CertificateDer<'static>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn err(code: FsErrorCode, message: &str, path: &str) -> FsError {
    FsError::at(code, message, path)
}

/// The id of a test draft (`remote_test` with an unsaved profile).
pub const DRAFT_ID: &str = "draft";

enum Opened {
    Conn(Box<dyn RemoteFs>),
    HostKey(sftp::HostKeySeen),
    Cert(trust::CertSeen),
    NeedsPassphrase,
}

impl Hub {
    pub fn new(
        config_dir: PathBuf,
        user_known_hosts: Option<PathBuf>,
        store: Arc<dyn SecretStore>,
    ) -> Self {
        Self {
            config_dir,
            user_known_hosts,
            store,
            profiles: Mutex::new(None),
            write_blocked: Mutex::new(false),
            editing: Mutex::new(()),
            pools: Mutex::new(HashMap::new()),
            freed: Condvar::new(),
            secrets: SessionSecrets::default(),
            ephemeral: Mutex::new(HashSet::new()),
            pending_keys: Mutex::new(HashMap::new()),
            pending_secrets: Mutex::new(HashMap::new()),
            pending_certs: Mutex::new(HashMap::new()),
            listeners: Mutex::new(Vec::new()),
            test_root: None,
        }
    }

    #[cfg(test)]
    pub fn with_test_root(mut self, root: rustls::pki_types::CertificateDer<'static>) -> Self {
        self.test_root = Some(root);
        self
    }

    fn profiles_file(&self) -> PathBuf {
        self.config_dir.join(profiles::FILE_NAME)
    }

    fn known_hosts(&self) -> sftp::KnownHosts {
        sftp::KnownHosts {
            user: self.user_known_hosts.clone(),
            app: self.config_dir.join(trust::APP_KNOWN_HOSTS),
        }
    }

    pub fn keychain_available(&self) -> bool {
        self.store.available()
    }

    pub fn subscribe(&self, f: Listener) {
        lock(&self.listeners).push(f);
    }

    fn emit(&self, profile_id: &str, state: ConnState) {
        let listeners = lock(&self.listeners).clone();
        for l in listeners {
            l(RemoteEvent {
                profile_id: profile_id.to_string(),
                state,
            });
        }
    }

    // ---- profiles -------------------------------------------------------------

    /// The profiles (loaded once) and a warning about the file.
    pub fn load(
        &self,
    ) -> (
        Vec<RemoteProfile>,
        Option<crate::config_file::ConfigWarning>,
    ) {
        let loaded = profiles::load(&self.profiles_file());
        *lock(&self.write_blocked) = !loaded.persist;
        *lock(&self.profiles) = Some(loaded.value.clone());
        (loaded.value, loaded.warning)
    }

    pub fn profiles(&self) -> Vec<RemoteProfile> {
        if lock(&self.profiles).is_none() {
            self.load();
        }
        lock(&self.profiles).clone().unwrap_or_default()
    }

    pub fn profile(&self, id: &str) -> Result<RemoteProfile, FsError> {
        self.profiles()
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| err(FsErrorCode::UnknownProfile, "Unknown connection", id))
    }

    fn write(&self, list: Vec<RemoteProfile>) -> Result<(), FsError> {
        if *lock(&self.write_blocked) {
            return Err(err(
                FsErrorCode::InvalidProfile,
                "connections.json could not be read – not written over",
                "connections.json",
            ));
        }
        profiles::save(&self.profiles_file(), &list)
            .map_err(|e| FsError::from_io(&e, &self.profiles_file()))?;
        *lock(&self.profiles) = Some(list);
        Ok(())
    }

    /// Saves a profile (empty id = new). The keychain marker and pin stay as Rust knows them.
    pub fn save_profile(&self, mut p: RemoteProfile) -> Result<RemoteProfile, FsError> {
        let _edit = lock(&self.editing);
        let mut list = self.profiles();
        let taken: HashSet<String> = list.iter().map(|p| p.id.clone()).collect();
        let existing = list.iter().position(|q| q.id == p.id && !p.id.is_empty());
        if existing.is_none() {
            if list.len() >= profiles::MAX_PROFILES {
                return Err(err(FsErrorCode::TooMany, "Too many connections", ""));
            }
            p.id = profiles::new_id(&taken);
            p.secret = SecretState::None;
        }
        if let Some(i) = existing {
            let old = &list[i];
            p.secret = old.secret;
            // a pin belongs to the server: a new host or kind drops it
            if old.host != p.host || old.port != p.port || old.kind != p.kind {
                p.pinned_cert = None;
                p.accept_hostname_mismatch = false;
            } else if p.pinned_cert != old.pinned_cert {
                // pins are set by `trust_certificate` only (or cleared by the user)
                if p.pinned_cert.is_some() {
                    p.pinned_cert = old.pinned_cert.clone();
                    p.accept_hostname_mismatch = old.accept_hostname_mismatch;
                }
            }
        }
        let p = profiles::check(p).map_err(|why| {
            err(
                FsErrorCode::InvalidProfile,
                &format!("Invalid connection: {why}"),
                why,
            )
        })?;
        let changed_login = existing.is_some_and(|i| {
            let o = &list[i];
            o.host != p.host
                || o.port != p.port
                || o.kind != p.kind
                || o.user != p.user
                || o.auth != p.auth
        });
        match existing {
            Some(i) => list[i] = p.clone(),
            None => list.push(p.clone()),
        }
        self.write(list)?;
        if changed_login {
            // the old connections log in elsewhere – close them
            self.disconnect(&p.id);
        }
        Ok(p)
    }

    pub fn delete_profile(&self, id: &str) -> Result<(), FsError> {
        let _edit = lock(&self.editing);
        self.disconnect(id);
        self.secrets.forget(id);
        for kind in [SecretKind::Password, SecretKind::Passphrase] {
            let _ = self.store.delete(id, kind);
        }
        let list: Vec<RemoteProfile> = self.profiles().into_iter().filter(|p| p.id != id).collect();
        self.write(list)
    }

    /// Forgets the secrets of a profile (memory and keychain).
    pub fn forget_secret(&self, id: &str) -> Result<(), FsError> {
        self.secrets.forget(id);
        let mut failed = None;
        for kind in [SecretKind::Password, SecretKind::Passphrase] {
            if let Err(e) = self.store.delete(id, kind)
                && self.store.available()
            {
                failed = Some(e);
            }
        }
        {
            let _edit = lock(&self.editing);
            let mut list = self.profiles();
            if let Some(p) = list.iter_mut().find(|p| p.id == id) {
                p.secret = SecretState::None;
                self.write(list)?;
            }
        }
        match failed {
            Some(e) => Err(err(FsErrorCode::KeychainUnavailable, &e.0, id)),
            None => Ok(()),
        }
    }

    /// The profile file was replaced (settings import): close everything, read it again.
    pub fn reload_after_import(&self) {
        let _edit = lock(&self.editing);
        self.disconnect_all();
        for p in self.profiles() {
            self.secrets.forget(&p.id);
        }
        self.load();
    }

    // ---- state ----------------------------------------------------------------

    pub fn states(&self) -> HashMap<String, ConnState> {
        lock(&self.pools)
            .iter()
            .map(|(id, p)| (id.clone(), p.state))
            .collect()
    }

    /// The login folder of a connected profile.
    pub fn home_of(&self, id: &str) -> Option<String> {
        lock(&self.pools).get(id).map(|p| p.home.clone())
    }

    /// Server info of a connected profile.
    pub fn server_info(&self, id: &str) -> Option<String> {
        lock(&self.pools).get(id).map(|p| p.info.clone())
    }

    pub fn has_session_secret(&self, id: &str) -> bool {
        self.secrets.has(id)
    }

    /// Closes all connections of a profile (busy ones are shut down).
    pub fn disconnect(&self, id: &str) {
        lock(&self.pending_secrets).remove(id);
        if lock(&self.ephemeral).remove(id) {
            self.secrets.forget(id);
        }
        let pool = lock(&self.pools).remove(id);
        if let Some(pool) = pool {
            for k in &pool.killers {
                k();
            }
            drop(pool);
            self.freed.notify_all();
            self.emit(id, ConnState::Disconnected);
        }
    }

    pub fn disconnect_all(&self) {
        let ids: Vec<String> = lock(&self.pools).keys().cloned().collect();
        for id in ids {
            self.disconnect(&id);
        }
    }

    // ---- connecting -----------------------------------------------------------

    fn tls_for(
        &self,
        p: &RemoteProfile,
    ) -> Result<(Option<Arc<rustls::ClientConfig>>, Option<trust::CertSlot>), FsError> {
        if !p.kind.is_ftp() || p.kind == RemoteKind::Ftp {
            return Ok((None, None));
        }
        let (cfg, seen) = trust::tls_config(
            p.pinned_cert.clone(),
            p.accept_hostname_mismatch,
            self.test_root.clone(),
        )
        .map_err(|e| err(FsErrorCode::RemoteProtocol, &e, &p.address()))?;
        Ok((Some(cfg), Some(seen)))
    }

    /// Opens one connection with `secret` (password, or the passphrase of a key).
    fn open(&self, p: &RemoteProfile, secret: Option<&Secret>) -> Result<Opened, FsError> {
        if p.kind.is_ftp() {
            let (tls, seen) = self.tls_for(p)?;
            match ftp::connect(p, secret, tls) {
                Ok(c) => Ok(Opened::Conn(c)),
                Err(e) => {
                    if let Some(s) = seen.and_then(|s| lock(&s).take()) {
                        return Ok(Opened::Cert(s));
                    }
                    Err(e)
                }
            }
        } else {
            match sftp::connect(p, secret, &self.known_hosts()) {
                Ok(c) => Ok(Opened::Conn(c)),
                Err(sftp::SftpConnectError::Error(e)) => Err(e),
                Err(sftp::SftpConnectError::HostKey(k)) => Ok(Opened::HostKey(k)),
                Err(sftp::SftpConnectError::NeedsPassphrase) => Ok(Opened::NeedsPassphrase),
            }
        }
    }

    fn secret_kind(p: &RemoteProfile) -> SecretKind {
        if p.auth == AuthKind::Key {
            SecretKind::Passphrase
        } else {
            SecretKind::Password
        }
    }

    /// The secret known for `p` in this run or in the keychain.
    fn known_secret(&self, p: &RemoteProfile) -> Option<Secret> {
        let kind = Self::secret_kind(p);
        if let Some(s) = self.secrets.get(&p.id, kind) {
            return Some(s);
        }
        if p.secret == SecretState::Keychain
            && let Ok(Some(s)) = self.store.get(&p.id, kind)
        {
            self.secrets.set(&p.id, kind, s.clone());
            return Some(s);
        }
        None
    }

    fn mark_keychain(&self, id: &str, state: SecretState) {
        let _edit = lock(&self.editing);
        let mut list = self.profiles();
        if let Some(p) = list.iter_mut().find(|p| p.id == id)
            && p.secret != state
        {
            p.secret = state;
            let _ = self.write(list);
        }
    }

    /// Connects a profile (the dialog's "Connect"). `secret` = what the user typed now.
    pub fn connect(
        &self,
        id: &str,
        secret: Option<Secret>,
        remember: Remember,
    ) -> Result<ConnectOutcome, FsError> {
        let p = self.profile(id)?;
        self.connect_profile(&p, secret, remember)
    }

    /// Connects `p` (saved or a draft for "Test").
    pub fn connect_profile(
        &self,
        p: &RemoteProfile,
        typed: Option<Secret>,
        remember: Remember,
    ) -> Result<ConnectOutcome, FsError> {
        let kind = Self::secret_kind(p);
        let what = match kind {
            SecretKind::Password => "password",
            SecretKind::Passphrase => "passphrase",
        };
        let mut remember = remember;
        let mut typed = typed.filter(|s| !s.is_empty());
        let pending = lock(&self.pending_secrets).remove(&p.id);
        if typed.is_none()
            && let Some((s, r)) = pending
        {
            typed = Some(s);
            remember = r;
        }
        // connected already (and nothing typed): no new connection, just where to go
        if typed.is_none()
            && let Some((home, info)) = lock(&self.pools)
                .get(&p.id)
                .filter(|pool| pool.state == ConnState::Connected)
                .map(|pool| (pool.home.clone(), pool.info.clone()))
        {
            let start = p.start_path.clone().unwrap_or(home);
            return Ok(ConnectOutcome::Connected {
                home: RemotePath::new(&p.id, &start)
                    .unwrap_or_else(|_| RemotePath::root(&p.id))
                    .to_string(),
                encrypted: p.kind.encrypted(),
                server_info: info,
                keychain_failed: false,
            });
        }
        let stored = if typed.is_none() {
            self.known_secret(p)
        } else {
            None
        };
        let secret = typed.clone().or(stored.clone());
        if secret.is_none() && p.needs_secret() {
            return Ok(ConnectOutcome::NeedsSecret {
                what: what.into(),
                keychain: self.store.available(),
                refused: false,
            });
        }
        let opened = match self.open(p, secret.as_ref()) {
            Ok(o) => o,
            Err(e)
                if e.code == FsErrorCode::RemoteAuthFailed
                    && typed.is_none()
                    && stored.is_some() =>
            {
                // the remembered secret is outdated: ask again (the keychain entry stays until replaced)
                self.secrets.forget(&p.id);
                return Ok(ConnectOutcome::NeedsSecret {
                    what: what.into(),
                    keychain: self.store.available(),
                    refused: true,
                });
            }
            Err(e) => return Err(e),
        };
        let mut conn = match opened {
            Opened::Conn(c) => c,
            Opened::NeedsPassphrase => {
                return Ok(ConnectOutcome::NeedsSecret {
                    what: "passphrase".into(),
                    keychain: self.store.available(),
                    refused: typed.is_some() || stored.is_some(),
                });
            }
            Opened::HostKey(seen) => {
                return match seen {
                    sftp::HostKeySeen::Unknown {
                        ref key_type,
                        ref fingerprint,
                        ..
                    } => {
                        let out = ConnectOutcome::HostKeyUnknown {
                            key_type: key_type.clone(),
                            fingerprint: fingerprint.clone(),
                        };
                        lock(&self.pending_keys).insert(p.id.clone(), seen);
                        if let Some(s) = typed {
                            lock(&self.pending_secrets).insert(p.id.clone(), (s, remember));
                        }
                        Ok(out)
                    }
                    sftp::HostKeySeen::Changed {
                        fingerprint,
                        file,
                        line,
                        ..
                    } => Err(err(
                        FsErrorCode::RemoteHostKeyChanged,
                        &format!(
                            "The host key of {} changed ({fingerprint}). Recorded in {} line {line}.",
                            p.address(),
                            file.display()
                        ),
                        &p.address(),
                    )),
                };
            }
            Opened::Cert(seen) => {
                let out = ConnectOutcome::CertificateUntrusted {
                    sha256: seen.sha256.clone(),
                    reason: seen.reason.clone(),
                    hostname_mismatch: seen.hostname_mismatch,
                    pinned_changed: seen.pinned_changed,
                };
                lock(&self.pending_certs).insert(p.id.clone(), seen);
                if let Some(s) = typed {
                    lock(&self.pending_secrets).insert(p.id.clone(), (s, remember));
                }
                return Ok(out);
            }
        };
        let home_dir = conn.home()?;
        let start = p.start_path.clone().unwrap_or(home_dir.clone());
        let home = RemotePath::new(&p.id, &start)
            .unwrap_or_else(|_| RemotePath::root(&p.id))
            .to_string();
        // keep the secret the user typed
        let mut keychain_failed = false;
        if let Some(s) = &typed {
            match remember {
                Remember::None => {}
                Remember::Session => self.secrets.set(&p.id, kind, s.clone()),
                Remember::Keychain => {
                    self.secrets.set(&p.id, kind, s.clone());
                    if p.id != DRAFT_ID {
                        match self.store.set(&p.id, kind, s) {
                            Ok(()) => self.mark_keychain(&p.id, SecretState::Keychain),
                            Err(_) => keychain_failed = true,
                        }
                    }
                }
            }
            if remember == Remember::None {
                // further connections of this run need it – but only until disconnect
                self.secrets.set(&p.id, kind, s.clone());
                lock(&self.ephemeral).insert(p.id.clone());
            } else {
                lock(&self.ephemeral).remove(&p.id);
            }
        }
        let info = conn.server_info();
        if p.id == DRAFT_ID {
            conn.killer()();
            self.secrets.forget(DRAFT_ID);
        } else {
            let killer = conn.killer();
            let mut pools = lock(&self.pools);
            let pool = pools.entry(p.id.clone()).or_insert_with(|| Pool {
                idle: Vec::new(),
                busy: 0,
                killers: Vec::new(),
                state: ConnState::Connected,
                info: info.clone(),
                home: home_dir.clone(),
            });
            pool.state = ConnState::Connected;
            pool.home = home_dir;
            pool.killers.push(killer);
            pool.idle.push((conn, Instant::now()));
            drop(pools);
            self.emit(&p.id, ConnState::Connected);
        }
        Ok(ConnectOutcome::Connected {
            home,
            encrypted: p.kind.encrypted(),
            server_info: info,
            keychain_failed,
        })
    }

    /// Records the host key the user confirmed (must be the one just seen).
    pub fn trust_host_key(&self, id: &str, fingerprint: &str) -> Result<(), FsError> {
        let p = if id == DRAFT_ID {
            None
        } else {
            Some(self.profile(id)?)
        };
        let seen = lock(&self.pending_keys).remove(id);
        match seen {
            Some(sftp::HostKeySeen::Unknown {
                fingerprint: f,
                key,
                ..
            }) if f == fingerprint => {
                let (host, port) = match &p {
                    Some(p) => (p.host.clone(), p.port),
                    None => {
                        return Err(err(
                            FsErrorCode::UnknownProfile,
                            "Save the connection first",
                            id,
                        ));
                    }
                };
                trust::learn_host_key(&host, port, &key, &self.known_hosts().app)
                    .map_err(|e| FsError::from_io(&e, &self.known_hosts().app))
            }
            _ => Err(err(
                FsErrorCode::RemoteHostKeyChanged,
                "The confirmed fingerprint is not the one the server showed",
                id,
            )),
        }
    }

    /// Pins the certificate the user confirmed (must be the one just seen).
    pub fn trust_certificate(
        &self,
        id: &str,
        sha256: &str,
        accept_hostname: bool,
    ) -> Result<(), FsError> {
        let seen = lock(&self.pending_certs).remove(id);
        match seen {
            Some(s) if s.sha256.eq_ignore_ascii_case(sha256) => {
                let _edit = lock(&self.editing);
                let mut list = self.profiles();
                let p = list.iter_mut().find(|p| p.id == id).ok_or_else(|| {
                    err(FsErrorCode::UnknownProfile, "Save the connection first", id)
                })?;
                p.pinned_cert = Some(s.sha256.to_ascii_lowercase());
                p.accept_hostname_mismatch = accept_hostname && s.hostname_mismatch;
                self.write(list)?;
                self.disconnect(id);
                Ok(())
            }
            _ => Err(err(
                FsErrorCode::RemoteProtocol,
                "The confirmed certificate is not the one the server showed",
                id,
            )),
        }
    }

    // ---- using connections ----------------------------------------------------

    /// Takes a connection of profile `id` (idle, or a new one within the limit).
    fn acquire(&self, id: &str) -> Result<(Box<dyn RemoteFs>, bool), FsError> {
        let p = self.profile(id)?;
        let limit = p.max_connections.max(1) as usize;
        let deadline = Instant::now() + Duration::from_secs(u64::from(p.timeout_secs) * 3);
        let mut pools = lock(&self.pools);
        loop {
            let Some(pool) = pools.get_mut(id) else {
                return Err(err(FsErrorCode::RemoteNotConnected, "Not connected", id));
            };
            if let Some((c, _)) = pool.idle.pop() {
                pool.busy += 1;
                return Ok((c, true));
            }
            if pool.busy < limit {
                pool.busy += 1;
                drop(pools);
                return match self.reopen(&p) {
                    Ok(c) => Ok((c, false)),
                    Err(e) => {
                        let mut pools = lock(&self.pools);
                        if let Some(pool) = pools.get_mut(id) {
                            pool.busy = pool.busy.saturating_sub(1);
                            if is_connection_error(&e) || e.code == FsErrorCode::RemoteAuthFailed {
                                pool.state = ConnState::Lost;
                            }
                        }
                        drop(pools);
                        self.freed.notify_all();
                        Err(e)
                    }
                };
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(err(
                    FsErrorCode::RemoteTimeout,
                    "All connections are busy",
                    id,
                ));
            }
            pools = self
                .freed
                .wait_timeout(pools, deadline - now)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    /// A new connection for an already connected profile (silently, with known secrets).
    fn reopen(&self, p: &RemoteProfile) -> Result<Box<dyn RemoteFs>, FsError> {
        let secret = self.known_secret(p);
        if secret.is_none() && p.needs_secret() {
            return Err(err(
                FsErrorCode::RemoteNotConnected,
                "Not connected (no password)",
                &p.id,
            ));
        }
        match self.open(p, secret.as_ref())? {
            Opened::Conn(c) => {
                let killer = c.killer();
                let mut pools = lock(&self.pools);
                if let Some(pool) = pools.get_mut(&p.id) {
                    pool.killers.push(killer);
                    if pool.state != ConnState::Connected {
                        pool.state = ConnState::Connected;
                        drop(pools);
                        self.emit(&p.id, ConnState::Connected);
                    }
                }
                Ok(c)
            }
            // trust changed since the first connect: the user must connect again
            _ => Err(err(FsErrorCode::RemoteNotConnected, "Connect again", &p.id)),
        }
    }

    fn release(&self, id: &str, conn: Option<Box<dyn RemoteFs>>, lost: bool) {
        let mut pools = lock(&self.pools);
        let mut emit = None;
        if let Some(pool) = pools.get_mut(id) {
            pool.busy = pool.busy.saturating_sub(1);
            if let Some(c) = conn {
                pool.idle.push((c, Instant::now()));
            }
            if lost && pool.idle.is_empty() && pool.busy == 0 && pool.state == ConnState::Connected
            {
                pool.state = ConnState::Lost;
                emit = Some(ConnState::Lost);
            }
        }
        drop(pools);
        self.freed.notify_all();
        if let Some(s) = emit {
            self.emit(id, s);
        }
    }

    /// Runs `f` with a connection of profile `id`. A broken reused connection is
    /// replaced once (it may have timed out on the server while idle).
    pub fn with<T>(
        &self,
        id: &str,
        mut f: impl FnMut(&mut dyn RemoteFs) -> Result<T, FsError>,
    ) -> Result<T, FsError> {
        let mut retried = false;
        loop {
            let (mut conn, reused) = self.acquire(id)?;
            match f(conn.as_mut()) {
                Ok(v) => {
                    self.release(id, Some(conn), false);
                    return Ok(v);
                }
                Err(e) if is_connection_error(&e) => {
                    drop(conn);
                    self.release(id, None, true);
                    if reused && !retried && e.code != FsErrorCode::RemoteNotConnected {
                        retried = true;
                        continue;
                    }
                    return Err(match e.code {
                        FsErrorCode::RemoteTimeout => e,
                        _ => FsError {
                            code: FsErrorCode::RemoteConnectionLost,
                            ..e
                        },
                    });
                }
                Err(e) => {
                    self.release(id, Some(conn), false);
                    return Err(e);
                }
            }
        }
    }

    /// Keeps idle connections alive (called every few seconds by a background thread):
    /// idle ones older than the keepalive interval get a NOOP; dead ones are dropped.
    pub fn keepalive(&self) {
        let profiles = self.profiles();
        for p in profiles {
            if p.keepalive_secs == 0 {
                continue;
            }
            let due = Duration::from_secs(u64::from(p.keepalive_secs));
            let stale: Vec<(Box<dyn RemoteFs>, Instant)> = {
                let mut pools = lock(&self.pools);
                let Some(pool) = pools.get_mut(&p.id) else {
                    continue;
                };
                let (old, fresh): (Vec<_>, Vec<_>) =
                    pool.idle.drain(..).partition(|(_, t)| t.elapsed() >= due);
                pool.idle = fresh;
                pool.busy += old.len();
                old
            };
            for (mut c, _) in stale {
                let ok = c.noop().is_ok();
                self.release(&p.id, ok.then_some(c), !ok);
            }
        }
    }

    // ---- listing --------------------------------------------------------------

    pub fn info(&self, p: &RemoteProfile, path: &RemotePath) -> RemoteInfo {
        RemoteInfo {
            profile_id: p.id.clone(),
            name: p.name.clone(),
            kind: p.kind,
            encrypted: p.kind.encrypted(),
            display: path.display(&p.name),
        }
    }

    /// Lists a server folder as a `DirectoryListing` (sorted like local ones).
    pub fn list_directory(&self, raw: &str) -> Result<DirectoryListing, FsError> {
        let path = RemotePath::parse(raw)?;
        let p = self.profile(path.profile())?;
        let listing = self.with(path.profile(), |c| c.list(path.server_path()))?;
        let mut entries = Vec::with_capacity(listing.entries.len());
        let mut unreadable = listing.unreadable;
        for e in listing.entries {
            let entry_path = match path.join(&e.name) {
                Ok(p) => p.to_string(),
                Err(_) => {
                    unreadable += 1;
                    continue;
                }
            };
            entries.push(DirEntryDto {
                hidden: e.name.starts_with('.'),
                path: entry_path,
                kind: e.kind,
                target_kind: e.target_kind,
                size: e.size,
                modified_ms: e.modified_ms,
                lossy_name: e.lossy,
                name: e.name,
            });
        }
        entries.sort_by(crate::listing::compare_entries);
        Ok(DirectoryListing {
            path: path.to_string(),
            parent: path.parent().map(|p| p.to_string()),
            segments: path.segments(&p.name),
            entries,
            unreadable_entries: unreadable,
            archive: None,
            network: true,
            remote: Some(self.info(&p, &path)),
        })
    }

    /// One entry (or `None`) as a listing would show it.
    pub fn stat_entry(&self, raw: &str) -> Result<Option<DirEntryDto>, FsError> {
        let path = RemotePath::parse(raw)?;
        let Some(name) = path.name().map(str::to_string) else {
            return Ok(Some(DirEntryDto {
                name: "/".into(),
                path: path.to_string(),
                kind: EntryKind::Directory,
                target_kind: None,
                size: None,
                modified_ms: None,
                hidden: false,
                lossy_name: false,
            }));
        };
        let meta = self.with(path.profile(), |c| c.stat(path.server_path()))?;
        Ok(meta.map(|m| DirEntryDto {
            hidden: name.starts_with('.'),
            name,
            path: path.to_string(),
            kind: m.kind,
            target_kind: None,
            size: m.size,
            modified_ms: m.modified_ms,
            lossy_name: false,
        }))
    }
}

// ---- the app's hub ---------------------------------------------------------------

static HUB: OnceLock<Hub> = OnceLock::new();

/// Sets up the hub of the app (once; later calls are ignored).
pub fn init(config_dir: PathBuf, home: Option<&Path>) {
    let user = home.map(|h| h.join(".ssh").join("known_hosts"));
    let store: Arc<dyn SecretStore> = Arc::new(LazyKeyring);
    let _ = HUB.set(Hub::new(config_dir, user, store));
    std::thread::Builder::new()
        .name("fnf-remote-keepalive".into())
        .spawn(|| {
            loop {
                std::thread::sleep(Duration::from_secs(10));
                if let Some(h) = HUB.get() {
                    h.keepalive();
                }
            }
        })
        .ok();
}

/// The hub of the app (`remote_not_connected` everywhere until [`init`] ran).
pub fn hub() -> Result<&'static Hub, FsError> {
    HUB.get().ok_or_else(|| {
        err(
            FsErrorCode::RemoteNotConnected,
            "Server connections are not ready",
            "",
        )
    })
}

/// Tests: install a hub (first caller wins) and return it.
#[cfg(test)]
pub fn install_for_tests(hub: Hub) -> &'static Hub {
    let _ = HUB.set(hub);
    HUB.get().expect("hub")
}

/// The system keychain, set up on first use (D-Bus/Keychain may be slow or absent).
struct LazyKeyring;

impl SecretStore for LazyKeyring {
    fn available(&self) -> bool {
        credentials::system_store().available()
    }
    fn get(&self, p: &str, k: SecretKind) -> Result<Option<Secret>, credentials::StoreError> {
        credentials::system_store().get(p, k)
    }
    fn set(&self, p: &str, k: SecretKind, s: &Secret) -> Result<(), credentials::StoreError> {
        credentials::system_store().set(p, k, s)
    }
    fn delete(&self, p: &str, k: SecretKind) -> Result<(), credentials::StoreError> {
        credentials::system_store().delete(p, k)
    }
}

// ---- single operations (no job: short and never overwriting) ----------------------

impl Hub {
    /// Creates folder `name` (`a/b` allowed) in `parent`; returns the topmost new path.
    pub fn make_dir(&self, parent: &str, name: &str) -> Result<String, FsError> {
        let parent = RemotePath::parse(parent)?;
        let parts: Vec<&str> = name.split('/').filter(|s| !s.is_empty()).collect();
        if parts.is_empty() {
            return Err(err(FsErrorCode::InvalidName, "Empty name", name));
        }
        let mut cur = parent.clone();
        let mut first_new: Option<RemotePath> = None;
        self.with(parent.profile(), |c| {
            for part in &parts {
                cur = cur.join(part)?;
                match c.stat(cur.server_path())? {
                    Some(m) if m.is_dir() => continue,
                    Some(_) => {
                        return Err(err(
                            FsErrorCode::AlreadyExists,
                            "A file with this name exists",
                            &cur.to_string(),
                        ));
                    }
                    None => {
                        c.mkdir(cur.server_path())?;
                        if first_new.is_none() {
                            first_new = Some(cur.clone());
                        }
                    }
                }
            }
            Ok(())
        })?;
        first_new.map(|p| p.to_string()).ok_or_else(|| {
            err(
                FsErrorCode::AlreadyExists,
                "The folder exists",
                &cur.to_string(),
            )
        })
    }

    /// Creates an empty file (never overwrites).
    pub fn create_file(&self, parent: &str, name: &str) -> Result<String, FsError> {
        let target = RemotePath::parse(parent)?.join(name)?;
        self.with(target.profile(), |c| {
            if c.stat(target.server_path())?.is_some() {
                return Err(err(
                    FsErrorCode::AlreadyExists,
                    "The name exists",
                    &target.to_string(),
                ));
            }
            c.write(target.server_path(), &mut std::io::empty())
                .map(|_| ())
        })?;
        Ok(target.to_string())
    }

    /// Renames an entry in its folder (never overwrites; root/home/start need `allow_dangerous`).
    pub fn rename_entry(
        &self,
        raw: &str,
        new_name: &str,
        allow_dangerous: bool,
    ) -> Result<String, FsError> {
        let path = RemotePath::parse(raw)?;
        let parent = path.parent().ok_or_else(|| {
            err(
                FsErrorCode::DangerousPath,
                "The root cannot be renamed",
                raw,
            )
        })?;
        let target = parent.join(new_name)?;
        if !allow_dangerous {
            let start = self.profile(path.profile())?.start_path;
            let home = self.home_of(path.profile());
            if let Some(why) = danger::danger_of(&path, home.as_deref(), start.as_deref()) {
                return Err(err(
                    FsErrorCode::DangerousPath,
                    &format!("Dangerous path on the server ({why})"),
                    raw,
                ));
            }
        }
        self.with(path.profile(), |c| {
            // only the case changes: the server sees the "same" name (case-insensitive servers)
            let same_entry = path
                .name()
                .is_some_and(|n| n.eq_ignore_ascii_case(new_name));
            if !same_entry && c.stat(target.server_path())?.is_some() {
                return Err(err(
                    FsErrorCode::AlreadyExists,
                    "The name exists",
                    &target.to_string(),
                ));
            }
            c.rename(path.server_path(), target.server_path())
        })?;
        Ok(target.to_string())
    }

    /// Properties of a server entry (what the server tells).
    pub fn properties(&self, raw: &str) -> Result<crate::properties::Properties, FsError> {
        let path = RemotePath::parse(raw)?;
        let (meta, target) = self.with(path.profile(), |c| {
            let m = c.stat(path.server_path())?;
            let t = match m {
                Some(m) if m.kind == EntryKind::Symlink => c.stat_follow(path.server_path())?,
                _ => None,
            };
            Ok((m, t))
        })?;
        let meta = meta.ok_or_else(|| err(FsErrorCode::NotFound, "Not found", raw))?;
        let shown = target.unwrap_or(meta);
        Ok(crate::properties::Properties {
            name: path.name().unwrap_or("/").to_string(),
            path: path.to_string(),
            kind: meta.kind,
            target_kind: (meta.kind == EntryKind::Symlink)
                .then_some(target.map(|t| t.kind))
                .flatten(),
            link_target: None,
            size: (shown.kind == EntryKind::File)
                .then_some(shown.size)
                .flatten(),
            created_ms: None,
            modified_ms: shown.modified_ms,
            accessed_ms: None,
            readonly: false,
            format: None,
            unix: None,
            windows: None,
        })
    }
}
