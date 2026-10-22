//! Hub tests against the in-process servers (design 034 §5).

use super::credentials::{MemoryStore, SecretKind, SecretStore};
use super::profiles::{AuthKind, RemoteKind, RemoteProfile, SecretState};
use super::testserver::{self, PASSWORD, USER, put};
use super::*;
use crate::secret::Secret;
use std::sync::Arc;

struct Env {
    hub: Hub,
    store: Arc<MemoryStore>,
    dir: tempfile::TempDir,
}

fn env_with(store: MemoryStore, test_root: bool) -> Env {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(store);
    let mut hub = Hub::new(dir.path().to_path_buf(), None, store.clone());
    if test_root {
        hub = hub.with_test_root(testserver::test_ca());
    }
    Env { hub, store, dir }
}

fn env() -> Env {
    env_with(MemoryStore::default(), true)
}

fn profile(kind: RemoteKind, port: u16) -> RemoteProfile {
    RemoteProfile {
        name: "Test".into(),
        kind,
        host: "127.0.0.1".into(),
        port,
        user: USER.into(),
        timeout_secs: 5,
        ..RemoteProfile::default()
    }
}

fn pw() -> Option<Secret> {
    Some(Secret::new(PASSWORD))
}

/// Connects an SFTP profile, confirming the host key on the way.
fn connect_sftp(e: &Env, id: &str, remember: Remember) -> ConnectOutcome {
    match e.hub.connect(id, pw(), remember).unwrap() {
        ConnectOutcome::HostKeyUnknown { fingerprint, .. } => {
            e.hub.trust_host_key(id, &fingerprint).unwrap();
            e.hub.connect(id, pw(), remember).unwrap()
        }
        other => other,
    }
}

#[test]
fn nothing_works_before_connecting() {
    let e = env();
    let p = e.hub.save_profile(profile(RemoteKind::Sftp, 1)).unwrap();
    let err = e
        .hub
        .list_directory(&format!("remote://{}/", p.id))
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteNotConnected);
    let err = e.hub.list_directory("remote://nope/").unwrap_err();
    assert_eq!(err.code, FsErrorCode::UnknownProfile);
}

#[test]
fn sftp_password_host_key_keychain_and_files() {
    let srv = testserver::start_sftp(1, None);
    put(srv.root.path(), "docs/Äpfel und Birnen.txt", b"hallo");
    put(srv.root.path(), ".hidden", b"");
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    // no secret yet
    match e.hub.connect(&p.id, None, Remember::None).unwrap() {
        ConnectOutcome::NeedsSecret {
            what,
            keychain,
            refused,
        } => {
            assert_eq!(
                (what.as_str(), keychain, refused),
                ("password", true, false)
            );
        }
        o => panic!("{o:?}"),
    }
    // unknown host key → confirm → known from now on
    let fp = match e.hub.connect(&p.id, pw(), Remember::Keychain).unwrap() {
        ConnectOutcome::HostKeyUnknown {
            fingerprint,
            key_type,
        } => {
            assert!(fingerprint.starts_with("SHA256:") && key_type.contains("ed25519"));
            fingerprint
        }
        o => panic!("{o:?}"),
    };
    assert!(e.hub.trust_host_key(&p.id, "SHA256:wrong").is_err());
    // the wrong confirmation consumed the pending key: ask again
    assert!(matches!(
        e.hub.connect(&p.id, pw(), Remember::Keychain).unwrap(),
        ConnectOutcome::HostKeyUnknown { .. }
    ));
    e.hub.trust_host_key(&p.id, &fp).unwrap();
    // the password typed before the question is used once more – not sent again
    let out = e.hub.connect(&p.id, None, Remember::None).unwrap();
    let ConnectOutcome::Connected {
        home,
        encrypted,
        keychain_failed,
        ..
    } = out
    else {
        panic!("{out:?}");
    };
    assert_eq!(home, format!("remote://{}/", p.id));
    assert!(encrypted && !keychain_failed);
    // the password is in the keychain, never in the file
    assert_eq!(
        e.store
            .get(&p.id, SecretKind::Password)
            .unwrap()
            .unwrap()
            .expose(),
        PASSWORD
    );
    assert_eq!(e.hub.profile(&p.id).unwrap().secret, SecretState::Keychain);
    let file = std::fs::read_to_string(e.dir.path().join("connections.json")).unwrap();
    assert!(!file.contains(PASSWORD) && file.contains("keychain"));

    // listing
    let l = e.hub.list_directory(&home).unwrap();
    let names: Vec<(&str, bool)> = l
        .entries
        .iter()
        .map(|x| (x.name.as_str(), x.hidden))
        .collect();
    assert_eq!(names, [("docs", false), (".hidden", true)]);
    assert!(l.network && l.remote.as_ref().unwrap().encrypted);
    assert_eq!(l.segments[0].name, "Test");
    let docs = &l.entries[0].path;
    let l = e.hub.list_directory(docs).unwrap();
    assert_eq!(l.entries[0].name, "Äpfel und Birnen.txt");
    assert_eq!(l.entries[0].size, Some(5));
    assert_eq!(l.parent.as_deref(), Some(home.as_str()));

    // file operations through the trait
    e.hub
        .with(&p.id, |c| {
            c.mkdir("/neu 😀")?;
            let n = c.write("/neu 😀/a#1%.txt", &mut &b"inhalt"[..])?;
            assert_eq!(n, 6);
            let mut got = Vec::new();
            assert!(c.read("/neu 😀/a#1%.txt", &mut |b: &[u8]| {
                got.extend_from_slice(b);
                Ok(true)
            })?);
            assert_eq!(got, b"inhalt");
            assert!(c.set_mtime("/neu 😀/a#1%.txt", 1_000_000_000_000)?);
            assert_eq!(
                c.stat("/neu 😀/a#1%.txt")?.unwrap().modified_ms,
                Some(1_000_000_000_000)
            );
            c.rename("/neu 😀/a#1%.txt", "/neu 😀/b.txt")?;
            assert!(c.stat("/neu 😀/a#1%.txt")?.is_none());
            c.remove_file("/neu 😀/b.txt")?;
            c.remove_dir("/neu 😀")?;
            Ok(())
        })
        .unwrap();
    assert!(!srv.root.path().join("neu 😀").exists());

    // a new hub (= app restart) finds the password in the keychain: no question
    let hub2 = Hub::new(e.dir.path().to_path_buf(), None, e.store.clone());
    assert!(matches!(
        hub2.connect(&p.id, None, Remember::None).unwrap(),
        ConnectOutcome::Connected { .. }
    ));
    // disconnect → not connected
    e.hub.disconnect(&p.id);
    assert_eq!(
        e.hub.list_directory(&home).unwrap_err().code,
        FsErrorCode::RemoteNotConnected
    );
    // forgetting removes it from the keychain
    e.hub.forget_secret(&p.id).unwrap();
    assert!(e.store.is_empty());
    assert_eq!(e.hub.profile(&p.id).unwrap().secret, SecretState::None);
}

#[test]
fn sftp_changed_host_key_is_refused() {
    let srv = testserver::start_sftp(2, None);
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    // a different key is on record for this host:port
    let other = testserver::host_key(9);
    trust::learn_host_key(
        "127.0.0.1",
        srv.port,
        other.public_key(),
        &e.dir.path().join("known_hosts"),
    )
    .unwrap();
    let err = e.hub.connect(&p.id, pw(), Remember::None).unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteHostKeyChanged);
    assert!(err.message.contains("known_hosts"));
}

#[test]
fn sftp_wrong_and_outdated_passwords() {
    let srv = testserver::start_sftp(3, None);
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    connect_sftp(&e, &p.id, Remember::Keychain);
    e.hub.disconnect(&p.id);
    // a typed wrong password is an error and never stored
    let err = e
        .hub
        .connect(&p.id, Some(Secret::new("falsch")), Remember::Keychain)
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteAuthFailed);
    assert_eq!(
        e.store
            .get(&p.id, SecretKind::Password)
            .unwrap()
            .unwrap()
            .expose(),
        PASSWORD
    );
    // an outdated stored password → ask again
    e.store
        .set(&p.id, SecretKind::Password, &Secret::new("alt"))
        .unwrap();
    let hub2 = Hub::new(e.dir.path().to_path_buf(), None, e.store.clone());
    match hub2.connect(&p.id, None, Remember::None).unwrap() {
        ConnectOutcome::NeedsSecret { refused, .. } => assert!(refused),
        o => panic!("{o:?}"),
    }
}

#[test]
fn sftp_key_login_with_passphrase() {
    // the key file is encrypted with the passphrase "geheim"
    let (key_file, public) = testserver::client_key_file();
    let srv = testserver::start_sftp(4, Some(public));
    let e = env();
    let mut prof = profile(RemoteKind::Sftp, srv.port);
    prof.auth = AuthKind::Key;
    prof.key_file = Some(key_file.to_string_lossy().into_owned());
    let p = e.hub.save_profile(prof).unwrap();
    match e.hub.connect(&p.id, None, Remember::None).unwrap() {
        ConnectOutcome::NeedsSecret { what, .. } => assert_eq!(what, "passphrase"),
        o => panic!("{o:?}"),
    }
    let out = match e
        .hub
        .connect(&p.id, Some(Secret::new("geheim")), Remember::Session)
        .unwrap()
    {
        ConnectOutcome::HostKeyUnknown { fingerprint, .. } => {
            e.hub.trust_host_key(&p.id, &fingerprint).unwrap();
            e.hub
                .connect(&p.id, Some(Secret::new("geheim")), Remember::Session)
                .unwrap()
        }
        o => o,
    };
    assert!(matches!(out, ConnectOutcome::Connected { .. }), "{out:?}");
    // session only: nothing in the keychain
    assert!(e.store.is_empty());
}

#[test]
fn ftp_anonymous_and_password() {
    let srv = testserver::start_ftp(false);
    put(srv.root.path(), "pub/größe.bin", &[1u8; 1000]);
    let e = env();
    let mut anon = profile(RemoteKind::Ftp, srv.port);
    anon.anonymous = true;
    anon.user = String::new();
    let a = e.hub.save_profile(anon).unwrap();
    let out = e.hub.connect(&a.id, None, Remember::None).unwrap();
    let ConnectOutcome::Connected {
        home, encrypted, ..
    } = out
    else {
        panic!("{out:?}")
    };
    assert!(!encrypted);
    let l = e.hub.list_directory(&home).unwrap();
    assert_eq!(l.entries[0].name, "pub");
    assert!(!l.remote.as_ref().unwrap().encrypted);

    let p = e
        .hub
        .save_profile(profile(RemoteKind::Ftp, srv.port))
        .unwrap();
    let err = e
        .hub
        .connect(&p.id, Some(Secret::new("x")), Remember::None)
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteAuthFailed);
    assert!(matches!(
        e.hub.connect(&p.id, pw(), Remember::Session).unwrap(),
        ConnectOutcome::Connected { .. }
    ));
    let l = e
        .hub
        .list_directory(&format!("remote://{}/pub", p.id))
        .unwrap();
    assert_eq!(
        (l.entries[0].name.as_str(), l.entries[0].size),
        ("größe.bin", Some(1000))
    );
    e.hub
        .with(&p.id, |c| {
            c.mkdir("/neu ordner")?;
            c.write("/neu ordner/x 1.txt", &mut &b"abc"[..])?;
            let m = c.stat("/neu ordner/x 1.txt")?.unwrap();
            assert_eq!((m.kind, m.size), (EntryKind::File, Some(3)));
            let mut got = Vec::new();
            c.read("/neu ordner/x 1.txt", &mut |b: &[u8]| {
                got.extend_from_slice(b);
                Ok(true)
            })?;
            assert_eq!(got, b"abc");
            c.rename("/neu ordner/x 1.txt", "/neu ordner/y.txt")?;
            assert!(c.stat("/neu ordner/x 1.txt")?.is_none());
            c.remove_file("/neu ordner/y.txt")?;
            c.remove_dir("/neu ordner")?;
            assert!(c.stat("/neu ordner")?.is_none());
            Ok(())
        })
        .unwrap();
    // two parallel users of one profile get two connections
    let t = std::thread::scope(|s| {
        let a = s.spawn(|| e.hub.list_directory(&home).map(|l| l.entries.len()));
        let b = s.spawn(|| e.hub.list_directory(&home).map(|l| l.entries.len()));
        (a.join().unwrap(), b.join().unwrap())
    });
    assert!(t.0.is_ok() && t.1.is_ok());
}

#[test]
fn ftps_trusted_by_ca_and_by_pin() {
    let srv = testserver::start_ftp(true);
    put(srv.root.path(), "a.txt", b"x");
    // the test CA is trusted: no question
    let e = env();
    let mut prof = profile(RemoteKind::FtpsExplicit, srv.port);
    prof.host = "localhost".into();
    let p = e.hub.save_profile(prof.clone()).unwrap();
    let out = e.hub.connect(&p.id, pw(), Remember::None).unwrap();
    assert!(
        matches!(
            out,
            ConnectOutcome::Connected {
                encrypted: true,
                ..
            }
        ),
        "{out:?}"
    );
    let l = e
        .hub
        .list_directory(&format!("remote://{}/", p.id))
        .unwrap();
    assert_eq!(l.entries[0].name, "a.txt");

    // without the CA (system store): untrusted → pin → trusted
    let e2 = env_with(MemoryStore::default(), false);
    let p2 = e2.hub.save_profile(prof).unwrap();
    let ConnectOutcome::CertificateUntrusted {
        sha256,
        hostname_mismatch,
        pinned_changed,
        ..
    } = e2.hub.connect(&p2.id, pw(), Remember::None).unwrap()
    else {
        panic!("expected a certificate question");
    };
    assert!(!hostname_mismatch && !pinned_changed);
    assert!(
        e2.hub
            .trust_certificate(&p2.id, &"0".repeat(64), false)
            .is_err()
    );
    let _ = e2.hub.connect(&p2.id, pw(), Remember::None).unwrap();
    e2.hub.trust_certificate(&p2.id, &sha256, false).unwrap();
    assert_eq!(
        e2.hub.profile(&p2.id).unwrap().pinned_cert.as_deref(),
        Some(sha256.as_str())
    );
    assert!(matches!(
        e2.hub.connect(&p2.id, pw(), Remember::None).unwrap(),
        ConnectOutcome::Connected { .. }
    ));
    // a pin does not survive a new host
    let mut moved = e2.hub.profile(&p2.id).unwrap();
    moved.host = "127.0.0.1".into();
    let moved = e2.hub.save_profile(moved).unwrap();
    assert_eq!(moved.pinned_cert, None);
}

#[test]
fn keychain_unavailable_keeps_the_password_for_the_session() {
    let srv = testserver::start_ftp(false);
    let e = env_with(MemoryStore::unavailable(), true);
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Ftp, srv.port))
        .unwrap();
    match e.hub.connect(&p.id, None, Remember::None).unwrap() {
        ConnectOutcome::NeedsSecret { keychain, .. } => assert!(!keychain),
        o => panic!("{o:?}"),
    }
    let out = e.hub.connect(&p.id, pw(), Remember::Keychain).unwrap();
    assert!(
        matches!(
            out,
            ConnectOutcome::Connected {
                keychain_failed: true,
                ..
            }
        ),
        "{out:?}"
    );
    assert_eq!(e.hub.profile(&p.id).unwrap().secret, SecretState::None);
    // further connections of this run need no question
    e.hub.with(&p.id, |c| c.list("/").map(|_| ())).unwrap();
}

#[test]
fn a_silent_server_times_out() {
    // accepts TCP, never answers
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let e = env();
    let p = e.hub.save_profile(profile(RemoteKind::Ftp, port)).unwrap();
    let t = std::time::Instant::now();
    let err = e.hub.connect(&p.id, pw(), Remember::None).unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteTimeout, "{err:?}");
    assert!(t.elapsed() < std::time::Duration::from_secs(15));
    let s = e.hub.save_profile(profile(RemoteKind::Sftp, port)).unwrap();
    let err = e.hub.connect(&s.id, pw(), Remember::None).unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteTimeout, "{err:?}");
    drop(l);
}

#[test]
fn unreachable_server() {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let e = env();
    let p = e.hub.save_profile(profile(RemoteKind::Ftp, port)).unwrap();
    let err = e.hub.connect(&p.id, pw(), Remember::None).unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteUnreachable, "{err:?}");
}

#[test]
fn deleting_a_profile_removes_its_secrets_and_connections() {
    let srv = testserver::start_ftp(false);
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Ftp, srv.port))
        .unwrap();
    e.hub.connect(&p.id, pw(), Remember::Keychain).unwrap();
    assert_eq!(e.store.len(), 1);
    e.hub.delete_profile(&p.id).unwrap();
    assert!(e.store.is_empty());
    assert!(e.hub.profiles().is_empty());
    assert_eq!(
        e.hub
            .list_directory(&format!("remote://{}/", p.id))
            .unwrap_err()
            .code,
        FsErrorCode::UnknownProfile
    );
}

#[test]
fn outcomes_and_events_never_carry_the_password() {
    let srv = testserver::start_ftp(false);
    let e = env();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let s2 = seen.clone();
    e.hub
        .subscribe(Arc::new(move |ev| s2.lock().unwrap().push(ev)));
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Ftp, srv.port))
        .unwrap();
    let out = e.hub.connect(&p.id, pw(), Remember::Keychain).unwrap();
    let json = serde_json::to_string(&out).unwrap();
    assert!(!json.contains(PASSWORD));
    e.hub.disconnect(&p.id);
    let events = seen.lock().unwrap().clone();
    assert_eq!(
        events.iter().map(|e| e.state).collect::<Vec<_>>(),
        [ConnState::Connected, ConnState::Disconnected]
    );
    assert!(!serde_json::to_string(&events).unwrap().contains(PASSWORD));
    let err = e
        .hub
        .connect(&p.id, Some(Secret::new("Sehr-Geheim-42")), Remember::None)
        .unwrap_err();
    assert!(!format!("{err:?}").contains("Sehr-Geheim-42"));
}

/// The frontend reads camelCase fields (`keyType`, `hostnameMismatch` …) – `rename_all`
/// alone renames only the variants of the enum (E2E 034: empty key type in the dialog).
#[test]
fn connect_outcome_fields_are_camel_case() {
    let host = serde_json::to_value(ConnectOutcome::HostKeyUnknown {
        key_type: "ssh-ed25519".into(),
        fingerprint: "SHA256:x".into(),
    })
    .unwrap();
    assert_eq!(host["status"], "hostKeyUnknown");
    assert_eq!(host["keyType"], "ssh-ed25519");
    let cert = serde_json::to_value(ConnectOutcome::CertificateUntrusted {
        sha256: "ab".into(),
        reason: "r".into(),
        hostname_mismatch: true,
        pinned_changed: true,
    })
    .unwrap();
    assert_eq!(cert["hostnameMismatch"], true);
    assert_eq!(cert["pinnedChanged"], true);
}

/// Real servers (E2E, risk R1): `FNF_E2E_SERVERS=1 cargo test -- --ignored real_servers` with
/// sshd on 2222, vsftpd plain on 2121 and vsftpd with explicit FTPS (`require_ssl_reuse=YES`)
/// on 2990, user `fnf` / password `FNF_E2E_PASSWORD` (default „geheim 1“), home `/home/fnf`.
#[test]
#[ignore]
fn real_servers() {
    if std::env::var("FNF_E2E_SERVERS").is_err() {
        return;
    }
    let password = std::env::var("FNF_E2E_PASSWORD").unwrap_or_else(|_| "geheim 1".into());
    let e = env_with(MemoryStore::default(), false);
    for (kind, port) in [
        (RemoteKind::Sftp, 2222),
        (RemoteKind::Ftp, 2121),
        (RemoteKind::FtpsExplicit, 2990),
    ] {
        let p = e
            .hub
            .save_profile(RemoteProfile {
                user: "fnf".into(),
                ..profile(kind, port)
            })
            .unwrap();
        let secret = || Some(Secret::new(password.as_str()));
        let mut out = e.hub.connect(&p.id, secret(), Remember::Session).unwrap();
        for _ in 0..3 {
            out = match out {
                ConnectOutcome::HostKeyUnknown { fingerprint, .. } => {
                    e.hub.trust_host_key(&p.id, &fingerprint).unwrap();
                    e.hub.connect(&p.id, None, Remember::Session).unwrap()
                }
                ConnectOutcome::CertificateUntrusted {
                    sha256,
                    hostname_mismatch,
                    ..
                } => {
                    e.hub
                        .trust_certificate(&p.id, &sha256, hostname_mismatch)
                        .unwrap();
                    e.hub.connect(&p.id, None, Remember::Session).unwrap()
                }
                done => done,
            };
        }
        let ConnectOutcome::Connected {
            home, encrypted, ..
        } = out
        else {
            panic!("{kind:?}: {out:?}");
        };
        assert_eq!(encrypted, kind != RemoteKind::Ftp, "{kind:?}");
        // a folder with an umlaut and a space: create, list, rename, list again
        let name = format!("E2E Ordner ä {port}");
        let made = e.hub.make_dir(&home, &name).unwrap();
        let names = |dir: &str| -> Vec<String> {
            e.hub
                .list_directory(dir)
                .unwrap()
                .entries
                .into_iter()
                .map(|x| x.name)
                .collect()
        };
        assert!(names(&home).contains(&name), "{kind:?}");
        // data channel (TLS session reuse on vsftpd): an empty file in the new folder
        e.hub.create_file(&made, "leer.txt").unwrap();
        assert_eq!(names(&made), vec!["leer.txt".to_string()], "{kind:?}");
        let renamed = e
            .hub
            .rename_entry(&made, &format!("{name} neu"), false)
            .unwrap();
        assert!(names(&home).contains(&format!("{name} neu")), "{kind:?}");
        assert!(e.hub.stat_entry(&made).unwrap().is_none(), "{kind:?}");
        let _ = std::fs::remove_dir_all(format!("/home/fnf/{name} neu"));
        let _ = renamed;
        e.hub.disconnect(&p.id);
    }
}

/// A connection that answers NOOP as told and breaks after 40 bytes of an upload.
struct Breaking {
    alive: bool,
}

impl fs::RemoteFs for Breaking {
    fn home(&mut self) -> Result<String, FsError> {
        Ok("/".into())
    }
    fn list(&mut self, _: &str) -> Result<fs::RemoteListing, FsError> {
        unimplemented!()
    }
    fn stat(&mut self, _: &str) -> Result<Option<fs::RemoteMeta>, FsError> {
        unimplemented!()
    }
    fn stat_follow(&mut self, _: &str) -> Result<Option<fs::RemoteMeta>, FsError> {
        unimplemented!()
    }
    fn read(&mut self, _: &str, _: &mut fs::Sink<'_>) -> Result<bool, FsError> {
        unimplemented!()
    }
    fn write(&mut self, path: &str, source: &mut dyn std::io::Read) -> Result<u64, FsError> {
        let mut buf = [0u8; 40];
        source.read_exact(&mut buf).unwrap();
        Err(FsError::at(FsErrorCode::RemoteConnectionLost, "gone", path))
    }
    fn mkdir(&mut self, _: &str) -> Result<(), FsError> {
        unimplemented!()
    }
    fn rename(&mut self, _: &str, _: &str) -> Result<(), FsError> {
        unimplemented!()
    }
    fn remove_file(&mut self, _: &str) -> Result<(), FsError> {
        unimplemented!()
    }
    fn remove_dir(&mut self, _: &str) -> Result<(), FsError> {
        unimplemented!()
    }
    fn set_mtime(&mut self, _: &str, _: i64) -> Result<bool, FsError> {
        unimplemented!()
    }
    fn noop(&mut self) -> Result<(), FsError> {
        if self.alive {
            Ok(())
        } else {
            Err(FsError::at(FsErrorCode::RemoteConnectionLost, "gone", "/"))
        }
    }
    fn killer(&self) -> fs::Killer {
        Arc::new(|| {})
    }
    fn server_info(&self) -> String {
        String::new()
    }
}

fn with_breaking(alive: bool) -> (testserver::TestSftp, Env, String) {
    let srv = testserver::start_sftp(1, None);
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    connect_sftp(&e, &p.id, Remember::None);
    lock(&e.hub.pools)
        .get_mut(&p.id)
        .unwrap()
        .idle
        .push((Box::new(Breaking { alive }), std::time::Instant::now()));
    (srv, e, p.id)
}

/// Review 034 #1: a stream that broke half way is never sent again on a new connection
/// (the rest would land on the server as a truncated "complete" file).
#[test]
fn a_broken_stream_is_not_resent() {
    let (srv, e, id) = with_breaking(true);
    let data: Vec<u8> = (0..100u8).collect();
    let err = e
        .hub
        .with_stream(&id, |c| {
            c.write("/up.bin", &mut std::io::Cursor::new(&data))
        })
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::RemoteConnectionLost);
    assert!(!srv.root.path().join("up.bin").exists());
}

/// …but a reused connection that died while idle is replaced before the stream starts.
#[test]
fn a_dead_idle_connection_is_replaced_before_streaming() {
    let (srv, e, id) = with_breaking(false);
    let data: Vec<u8> = (0..100u8).collect();
    let n = e
        .hub
        .with_stream(&id, |c| {
            c.write("/up.bin", &mut std::io::Cursor::new(&data))
        })
        .unwrap();
    assert_eq!(n, 100);
    assert_eq!(std::fs::read(srv.root.path().join("up.bin")).unwrap(), data);
}

/// Review 034 #2: a remembered password belongs to one server – a new host, port, kind,
/// user or login method forgets it (keychain and session), it is never sent elsewhere.
#[test]
fn the_password_does_not_follow_a_new_server() {
    let srv = testserver::start_sftp(1, None);
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    connect_sftp(&e, &p.id, Remember::Keychain);
    assert!(e.store.get(&p.id, SecretKind::Password).unwrap().is_some());
    // a new name keeps it
    let renamed = e
        .hub
        .save_profile(RemoteProfile {
            name: "Anders".into(),
            ..e.hub.profile(&p.id).unwrap()
        })
        .unwrap();
    assert_eq!(renamed.secret, SecretState::Keychain);
    let moved = e
        .hub
        .save_profile(RemoteProfile {
            host: "localhost".into(),
            ..e.hub.profile(&p.id).unwrap()
        })
        .unwrap();
    assert_eq!(moved.secret, SecretState::None);
    assert!(e.store.get(&p.id, SecretKind::Password).unwrap().is_none());
    assert!(!e.hub.has_session_secret(&p.id));
    assert!(matches!(
        e.hub.connect(&p.id, None, Remember::None).unwrap(),
        ConnectOutcome::NeedsSecret { .. }
    ));
}

/// Review 034 #8: a trust answer belongs to the server that was shown – after an edit
/// of the profile (or a disconnect) the pending question is gone.
#[test]
fn a_trust_answer_does_not_survive_an_edit() {
    let srv = testserver::start_sftp(1, None);
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    let ConnectOutcome::HostKeyUnknown { fingerprint, .. } =
        e.hub.connect(&p.id, pw(), Remember::None).unwrap()
    else {
        panic!()
    };
    e.hub
        .save_profile(RemoteProfile {
            port: srv.port + 1,
            ..e.hub.profile(&p.id).unwrap()
        })
        .unwrap();
    assert!(e.hub.trust_host_key(&p.id, &fingerprint).is_err());
    // the same for a plain disconnect (dialog cancelled)
    e.hub
        .save_profile(RemoteProfile {
            port: srv.port,
            ..e.hub.profile(&p.id).unwrap()
        })
        .unwrap();
    let ConnectOutcome::HostKeyUnknown { fingerprint, .. } =
        e.hub.connect(&p.id, pw(), Remember::None).unwrap()
    else {
        panic!()
    };
    e.hub.disconnect(&p.id);
    assert!(e.hub.trust_host_key(&p.id, &fingerprint).is_err());
}

/// E2E 034: the password typed before the certificate question is used after "trust"
/// (it was dropped by the disconnect inside `trust_certificate`).
#[test]
fn the_password_survives_the_certificate_question() {
    let srv = testserver::start_ftp(true);
    let e = env_with(MemoryStore::default(), false);
    let p = e
        .hub
        .save_profile(profile(RemoteKind::FtpsExplicit, srv.port))
        .unwrap();
    let ConnectOutcome::CertificateUntrusted {
        sha256,
        hostname_mismatch,
        ..
    } = e.hub.connect(&p.id, pw(), Remember::None).unwrap()
    else {
        panic!()
    };
    e.hub
        .trust_certificate(&p.id, &sha256, hostname_mismatch)
        .unwrap();
    let out = e.hub.connect(&p.id, None, Remember::None).unwrap();
    assert!(matches!(out, ConnectOutcome::Connected { .. }), "{out:?}");
}

/// Review 034 #4: `readme` → `README` next to an existing `README` (case-sensitive
/// server) must not replace it; with no such entry the case change works.
#[test]
fn a_case_change_never_replaces_another_entry() {
    let srv = testserver::start_sftp(1, None);
    put(srv.root.path(), "readme", b"klein");
    put(srv.root.path(), "README", b"GROSS");
    put(srv.root.path(), "einzeln", b"x");
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    connect_sftp(&e, &p.id, Remember::None);
    let listed = || -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(srv.root.path())
            .unwrap()
            .map(|d| d.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    };
    // the test server serves a local folder: on macOS/Windows "readme" and "README" are
    // one file there – then only the case change itself can be checked (CI 22.10.2026)
    if listed().len() == 2 {
        e.hub
            .rename_entry(&format!("remote://{}/readme", p.id), "README", false)
            .unwrap();
        e.hub
            .rename_entry(&format!("remote://{}/einzeln", p.id), "EINZELN", false)
            .unwrap();
        assert_eq!(listed(), ["EINZELN", "README"]);
        return;
    }
    let err = e
        .hub
        .rename_entry(&format!("remote://{}/readme", p.id), "README", false)
        .unwrap_err();
    assert_eq!(err.code, FsErrorCode::AlreadyExists);
    assert_eq!(
        std::fs::read(srv.root.path().join("README")).unwrap(),
        b"GROSS"
    );
    assert_eq!(
        std::fs::read(srv.root.path().join("readme")).unwrap(),
        b"klein"
    );
    e.hub
        .rename_entry(&format!("remote://{}/einzeln", p.id), "EINZELN", false)
        .unwrap();
    // the server refuses the direct rename (a name in another case exists): two steps,
    // no temporary name is left over
    assert_eq!(listed(), ["EINZELN", "README", "readme"]);
}

/// Review 034 #5: a disconnect between two calls is not lost – the next call of that
/// SFTP connection fails at once instead of carrying on with the old login.
#[test]
fn an_sftp_kill_between_calls_sticks() {
    let srv = testserver::start_sftp(1, None);
    let e = env();
    let p = e
        .hub
        .save_profile(profile(RemoteKind::Sftp, srv.port))
        .unwrap();
    connect_sftp(&e, &p.id, Remember::None);
    let (mut conn, _) = lock(&e.hub.pools)
        .get_mut(&p.id)
        .unwrap()
        .idle
        .pop()
        .unwrap();
    conn.list("/").unwrap();
    conn.killer()();
    assert!(conn.list("/").is_err());
}
