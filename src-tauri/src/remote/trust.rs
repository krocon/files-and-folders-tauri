//! Trust in servers (design 034 E5).
//!
//! SSH: host keys are checked against `~/.ssh/known_hosts` (read only – servers the
//! user already trusts in a terminal) and the app's own `known_hosts`; a key the user
//! confirmed is appended to the app's file only. A changed key is refused hard.
//!
//! FTPS: certificates are checked by the operating system (`rustls-platform-verifier`).
//! A certificate the OS does not trust is accepted only if its SHA-256 equals the pin
//! the user confirmed for the profile; the host name must still match unless the user
//! confirmed that too. What the verifier saw on a failure is kept for the dialog.

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Where a refused certificate is reported (filled by [`PinVerifier`]).
pub type CertSlot = Arc<Mutex<Option<CertSeen>>>;

pub const APP_KNOWN_HOSTS: &str = "known_hosts";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyCheck {
    Known,
    Unknown,
    /// The key differs from the one recorded in `file` (line `line`).
    Changed {
        file: PathBuf,
        line: usize,
    },
}

/// `SHA256:…` like `ssh-keygen -l`.
pub fn fingerprint(key: &russh::keys::PublicKey) -> String {
    key.fingerprint(russh::keys::HashAlg::Sha256).to_string()
}

/// Checks `key` for `host:port` against the user's and the app's known_hosts files.
pub fn check_host_key(
    host: &str,
    port: u16,
    key: &russh::keys::PublicKey,
    user_file: Option<&Path>,
    app_file: &Path,
) -> HostKeyCheck {
    let mut known = false;
    for file in user_file.into_iter().chain(std::iter::once(app_file)) {
        if !file.is_file() {
            continue;
        }
        match russh::keys::check_known_hosts_path(host, port, key, file) {
            Ok(true) => known = true,
            Ok(false) => {}
            Err(russh::keys::Error::KeyChanged { line }) => {
                return HostKeyCheck::Changed {
                    file: file.to_path_buf(),
                    line,
                };
            }
            // an unreadable or odd file is no trust and no veto
            Err(_) => {}
        }
    }
    if known {
        HostKeyCheck::Known
    } else {
        HostKeyCheck::Unknown
    }
}

/// Records a confirmed key in the app's known_hosts.
pub fn learn_host_key(
    host: &str,
    port: u16,
    key: &russh::keys::PublicKey,
    app_file: &Path,
) -> io::Result<()> {
    russh::keys::known_hosts::learn_known_hosts_path(host, port, key, app_file)
        .map_err(|e| io::Error::other(e.to_string()))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// What the verifier saw when it refused a certificate (for the trust dialog).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertSeen {
    pub sha256: String,
    pub reason: String,
    pub hostname_mismatch: bool,
    /// A pin existed and the certificate is a different one.
    pub pinned_changed: bool,
}

#[derive(Debug)]
pub struct PinVerifier {
    inner: Arc<dyn ServerCertVerifier>,
    pin: Option<String>,
    accept_hostname_mismatch: bool,
    pub seen: CertSlot,
}

impl PinVerifier {
    pub fn new(
        inner: Arc<dyn ServerCertVerifier>,
        pin: Option<String>,
        accept_hostname_mismatch: bool,
    ) -> Self {
        Self {
            inner,
            pin: pin.map(|p| p.to_ascii_lowercase()),
            accept_hostname_mismatch,
            seen: Arc::new(Mutex::new(None)),
        }
    }
}

fn hostname_matches(cert: &CertificateDer<'_>, name: &ServerName<'_>) -> bool {
    rustls::server::ParsedCertificate::try_from(cert)
        .ok()
        .is_some_and(|p| rustls::client::verify_server_name(&p, name).is_ok())
}

impl ServerCertVerifier for PinVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let sha = sha256_hex(end_entity.as_ref());
        let name_ok = hostname_matches(end_entity, server_name);
        if self.pin.as_deref() == Some(sha.as_str()) && (name_ok || self.accept_hostname_mismatch) {
            return Ok(ServerCertVerified::assertion());
        }
        match self.inner.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        ) {
            Ok(v) => Ok(v),
            Err(e) => {
                let mut seen = self.seen.lock().unwrap_or_else(|p| p.into_inner());
                *seen = Some(CertSeen {
                    sha256: sha,
                    reason: e.to_string(),
                    hostname_mismatch: !name_ok,
                    pinned_changed: self.pin.is_some(),
                });
                Err(e)
            }
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

pub fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// TLS settings for an FTPS profile: OS trust + pin. Returns the config and the slot
/// that holds what a refused certificate looked like.
pub fn tls_config(
    pin: Option<String>,
    accept_hostname_mismatch: bool,
    extra_root: Option<CertificateDer<'static>>,
) -> Result<(Arc<rustls::ClientConfig>, CertSlot), String> {
    let provider = provider();
    let inner: Arc<dyn ServerCertVerifier> = match extra_root {
        // tests: a private CA instead of the system store
        Some(root) => {
            let mut roots = rustls::RootCertStore::empty();
            roots.add(root).map_err(|e| e.to_string())?;
            rustls::client::WebPkiServerVerifier::builder_with_provider(
                Arc::new(roots),
                provider.clone(),
            )
            .build()
            .map_err(|e| e.to_string())?
        }
        None => Arc::new(
            rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|e| e.to_string())?,
        ),
    };
    let verifier = Arc::new(PinVerifier::new(inner, pin, accept_hostname_mismatch));
    let seen = verifier.seen.clone();
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    Ok((Arc::new(config), seen))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn key(seed: u8) -> russh::keys::PublicKey {
        let pk = russh::keys::PrivateKey::from(
            russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&[seed; 32]),
        );
        pk.public_key().clone()
    }

    #[test]
    fn host_keys_known_unknown_changed() {
        let dir = tempdir().unwrap();
        let app = dir.path().join("app_known_hosts");
        let user = dir.path().join("user_known_hosts");
        let k1 = key(1);
        let k2 = key(2);
        assert_eq!(
            check_host_key("h", 22, &k1, Some(&user), &app),
            HostKeyCheck::Unknown
        );
        learn_host_key("h", 2222, &k1, &app).unwrap();
        assert_eq!(
            check_host_key("h", 2222, &k1, Some(&user), &app),
            HostKeyCheck::Known
        );
        // other port = other host
        assert_eq!(
            check_host_key("h", 22, &k1, None, &app),
            HostKeyCheck::Unknown
        );
        assert!(matches!(
            check_host_key("h", 2222, &k2, None, &app),
            HostKeyCheck::Changed { .. }
        ));
        // the user's file is read, never written
        learn_host_key("u", 22, &k2, &user).unwrap();
        let before = std::fs::read(&user).unwrap();
        assert_eq!(
            check_host_key("u", 22, &k2, Some(&user), &app),
            HostKeyCheck::Known
        );
        match check_host_key("u", 22, &k1, Some(&user), &app) {
            HostKeyCheck::Changed { file, .. } => assert_eq!(file, user),
            other => panic!("{other:?}"),
        }
        assert_eq!(std::fs::read(&user).unwrap(), before);
        assert!(fingerprint(&k1).starts_with("SHA256:"));
    }

    #[test]
    fn sha_is_hex() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
