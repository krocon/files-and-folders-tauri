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
    let out = e.hub.connect(&p.id, pw(), Remember::Keychain).unwrap();
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
