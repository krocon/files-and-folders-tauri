//! Archive passwords (design 025 E4): kept in memory only, per archive path,
//! for the lifetime of the app – never written to the session, the settings or
//! a log. [`Secret`] hides its text in `Debug`, is never serialised and is
//! wiped (`zeroize`) when it is dropped.

pub use crate::secret::{MAX_PASSWORD_CHARS, Secret};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

type Store = Mutex<HashMap<PathBuf, Secret>>;

fn store() -> &'static Store {
    static STORE: OnceLock<Store> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn key(archive: &Path) -> PathBuf {
    crate::paths::normalize_lexically(archive)
}

/// The password known for `archive` (set with [`remember`]).
pub fn get(archive: &Path) -> Option<Secret> {
    let s = store().lock().unwrap_or_else(|e| e.into_inner());
    s.get(&key(archive)).cloned()
}

pub fn known(archive: &Path) -> bool {
    let s = store().lock().unwrap_or_else(|e| e.into_inner());
    s.contains_key(&key(archive))
}

/// Remembers a (checked) password for `archive` until the app ends.
pub fn remember(archive: &Path, secret: Secret) {
    let mut s = store().lock().unwrap_or_else(|e| e.into_inner());
    s.insert(key(archive), secret);
}

pub fn forget(archive: &Path) {
    let mut s = store().lock().unwrap_or_else(|e| e.into_inner());
    s.remove(&key(archive));
    drop(s);
    super::sevenz_header::forget_keys();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_is_never_printed_and_not_too_long() {
        let s = Secret::new("geheim");
        assert_eq!(format!("{s:?}"), "Secret(***)");
        assert_eq!(s.expose(), "geheim");
        let parsed: Secret = serde_json::from_str("\"pässwört 🔑\"").unwrap();
        assert_eq!(parsed.expose(), "pässwört 🔑");
        let long = format!("\"{}\"", "x".repeat(MAX_PASSWORD_CHARS + 1));
        assert!(serde_json::from_str::<Secret>(&long).is_err());
    }

    #[test]
    fn passwords_are_kept_per_archive() {
        let a = Path::new("/tmp/fnf-secrets-test/a.zip");
        assert!(get(a).is_none());
        remember(a, Secret::new("1"));
        assert!(known(Path::new("/tmp/fnf-secrets-test/./a.zip")));
        assert!(!known(Path::new("/tmp/fnf-secrets-test/b.zip")));
        forget(a);
        assert!(!known(a));
    }
}
