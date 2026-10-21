//! Secrets of server profiles (design 034 E3).
//!
//! Persistent only in the system keychain (macOS Keychain, Windows Credential Manager,
//! Secret Service on Linux) – never in a file of the app. Entry: service =
//! the app identifier, account = `remote:<profile-id>:password|passphrase` (no host
//! or user name in clear). Without a keychain secrets live for the session only.
//! Keychain calls may block (unlock prompts): call them off the async runtime.

use crate::secret::Secret;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub const SERVICE: &str = "io.github.krocon.filesandfolders";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecretKind {
    Password,
    Passphrase,
}

impl SecretKind {
    fn tag(self) -> &'static str {
        match self {
            SecretKind::Password => "password",
            SecretKind::Passphrase => "passphrase",
        }
    }
}

pub fn account(profile: &str, kind: SecretKind) -> String {
    format!("remote:{profile}:{}", kind.tag())
}

/// Why the keychain could not be used – never contains the secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError(pub String);

pub trait SecretStore: Send + Sync {
    /// Whether a keychain can be used at all.
    fn available(&self) -> bool;
    fn get(&self, profile: &str, kind: SecretKind) -> Result<Option<Secret>, StoreError>;
    fn set(&self, profile: &str, kind: SecretKind, secret: &Secret) -> Result<(), StoreError>;
    /// Removes the entry; a missing entry is fine.
    fn delete(&self, profile: &str, kind: SecretKind) -> Result<(), StoreError>;
}

/// The system keychain through `keyring-core` and the store of this OS.
pub struct KeyringStore {
    ready: Result<(), StoreError>,
}

#[cfg(target_os = "macos")]
fn native_store() -> Result<std::sync::Arc<keyring_core::CredentialStore>, String> {
    apple_native_keyring_store::keychain::Store::new()
        .map(|s| s as std::sync::Arc<keyring_core::CredentialStore>)
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn native_store() -> Result<std::sync::Arc<keyring_core::CredentialStore>, String> {
    windows_native_keyring_store::Store::new()
        .map(|s| s as std::sync::Arc<keyring_core::CredentialStore>)
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn native_store() -> Result<std::sync::Arc<keyring_core::CredentialStore>, String> {
    dbus_secret_service_keyring_store::Store::new()
        .map(|s| s as std::sync::Arc<keyring_core::CredentialStore>)
        .map_err(|e| e.to_string())
}

impl KeyringStore {
    /// Sets up the keychain of this OS once; a failure makes the store unavailable.
    pub fn new() -> Self {
        let ready = native_store()
            .map(keyring_core::set_default_store)
            .map_err(StoreError);
        Self { ready }
    }

    fn entry(&self, profile: &str, kind: SecretKind) -> Result<keyring_core::Entry, StoreError> {
        self.ready.clone()?;
        keyring_core::Entry::new(SERVICE, &account(profile, kind))
            .map_err(|e| StoreError(e.to_string()))
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for KeyringStore {
    fn available(&self) -> bool {
        self.ready.is_ok()
    }

    fn get(&self, profile: &str, kind: SecretKind) -> Result<Option<Secret>, StoreError> {
        match self.entry(profile, kind)?.get_password() {
            Ok(text) => Ok(Some(Secret::new(zeroize::Zeroizing::new(text).as_str()))),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(StoreError(e.to_string())),
        }
    }

    fn set(&self, profile: &str, kind: SecretKind, secret: &Secret) -> Result<(), StoreError> {
        self.entry(profile, kind)?
            .set_password(secret.expose())
            .map_err(|e| StoreError(e.to_string()))
    }

    fn delete(&self, profile: &str, kind: SecretKind) -> Result<(), StoreError> {
        match self.entry(profile, kind)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(StoreError(e.to_string())),
        }
    }
}

/// A keychain in memory – tests and the "no keychain" fallback of tests.
#[derive(Default)]
pub struct MemoryStore {
    pub unavailable: bool,
    entries: Mutex<HashMap<String, Secret>>,
}

impl MemoryStore {
    pub fn unavailable() -> Self {
        Self {
            unavailable: true,
            ..Self::default()
        }
    }
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl SecretStore for MemoryStore {
    fn available(&self) -> bool {
        !self.unavailable
    }
    fn get(&self, profile: &str, kind: SecretKind) -> Result<Option<Secret>, StoreError> {
        if self.unavailable {
            return Err(StoreError("no keychain".into()));
        }
        let e = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        Ok(e.get(&account(profile, kind)).cloned())
    }
    fn set(&self, profile: &str, kind: SecretKind, secret: &Secret) -> Result<(), StoreError> {
        if self.unavailable {
            return Err(StoreError("no keychain".into()));
        }
        let mut e = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        e.insert(account(profile, kind), secret.clone());
        Ok(())
    }
    fn delete(&self, profile: &str, kind: SecretKind) -> Result<(), StoreError> {
        if self.unavailable {
            return Err(StoreError("no keychain".into()));
        }
        let mut e = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        e.remove(&account(profile, kind));
        Ok(())
    }
}

/// Secrets of this run (entered with "for this session", or read from the keychain once).
#[derive(Default)]
pub struct SessionSecrets {
    map: Mutex<HashMap<(String, SecretKind), Secret>>,
}

impl SessionSecrets {
    pub fn get(&self, profile: &str, kind: SecretKind) -> Option<Secret> {
        let m = self.map.lock().unwrap_or_else(|e| e.into_inner());
        m.get(&(profile.to_string(), kind)).cloned()
    }
    pub fn set(&self, profile: &str, kind: SecretKind, secret: Secret) {
        let mut m = self.map.lock().unwrap_or_else(|e| e.into_inner());
        m.insert((profile.to_string(), kind), secret);
    }
    pub fn forget(&self, profile: &str) {
        let mut m = self.map.lock().unwrap_or_else(|e| e.into_inner());
        m.retain(|(p, _), _| p != profile);
    }
    pub fn has(&self, profile: &str) -> bool {
        let m = self.map.lock().unwrap_or_else(|e| e.into_inner());
        m.keys().any(|(p, _)| p == profile)
    }
}

/// The keychain of the app (set up on first use).
pub fn system_store() -> &'static KeyringStore {
    static STORE: OnceLock<KeyringStore> = OnceLock::new();
    STORE.get_or_init(KeyringStore::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_name_no_host_or_user() {
        assert_eq!(
            account("k3x9", SecretKind::Password),
            "remote:k3x9:password"
        );
        assert_eq!(
            account("k3x9", SecretKind::Passphrase),
            "remote:k3x9:passphrase"
        );
    }

    #[test]
    fn memory_store_and_session() {
        let s = MemoryStore::default();
        assert!(s.available());
        assert_eq!(s.get("a", SecretKind::Password).unwrap(), None);
        s.set("a", SecretKind::Password, &Secret::new("pw"))
            .unwrap();
        assert_eq!(
            s.get("a", SecretKind::Password).unwrap().unwrap().expose(),
            "pw"
        );
        s.delete("a", SecretKind::Password).unwrap();
        s.delete("a", SecretKind::Password).unwrap();
        assert!(s.is_empty());
        let u = MemoryStore::unavailable();
        assert!(!u.available() && u.get("a", SecretKind::Password).is_err());

        let sess = SessionSecrets::default();
        sess.set("a", SecretKind::Password, Secret::new("x"));
        sess.set("b", SecretKind::Passphrase, Secret::new("y"));
        assert!(sess.has("a"));
        sess.forget("a");
        assert!(!sess.has("a") && sess.has("b"));
        assert_eq!(
            format!("{:?}", sess.get("b", SecretKind::Passphrase)),
            "Some(Secret(***))"
        );
    }
}

/// The real keychain (E2E): `FNF_E2E_KEYRING=1 cargo test -- --ignored real_keychain`
/// inside a D-Bus session with an unlocked Secret Service (Linux) or on macOS/Windows.
#[cfg(test)]
mod real {
    use super::*;

    #[test]
    #[ignore]
    fn real_keychain() {
        if std::env::var("FNF_E2E_KEYRING").is_err() {
            return;
        }
        let s = KeyringStore::new();
        assert!(s.available(), "{:?}", s.ready);
        let id = format!("e2e-{}", std::process::id());
        assert_eq!(s.get(&id, SecretKind::Password).unwrap(), None);
        s.set(&id, SecretKind::Password, &Secret::new("pässwört 🔑"))
            .unwrap();
        assert_eq!(
            s.get(&id, SecretKind::Password).unwrap().unwrap().expose(),
            "pässwört 🔑"
        );
        s.delete(&id, SecretKind::Password).unwrap();
        assert_eq!(s.get(&id, SecretKind::Password).unwrap(), None);
    }
}
