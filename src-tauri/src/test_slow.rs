//! Test switch for a slow drive (design 029 E13), **debug builds only**:
//! `FNF_TEST_SLOW=<path prefix>:<listing ms>:<block ms>` delays listings of
//! folders and every written copy block below the prefix. Lets the end-to-end
//! test reproduce "copy onto a slow USB/network drive" in a container. In a
//! release build both functions are empty and the variable is never read.

#[cfg(debug_assertions)]
mod imp {
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use std::time::Duration;

    #[derive(Debug, PartialEq, Eq)]
    pub(super) struct Slow {
        pub prefix: PathBuf,
        pub listing: Duration,
        pub block: Duration,
    }

    /// `prefix:listing:block`; the prefix may itself contain `:` (Windows drive letters).
    pub(super) fn parse(raw: &str) -> Option<Slow> {
        let mut parts = raw.rsplitn(3, ':');
        let block = parts.next()?.trim().parse().ok()?;
        let listing = parts.next()?.trim().parse().ok()?;
        let prefix = parts.next()?.trim();
        if prefix.is_empty() {
            return None;
        }
        Some(Slow {
            prefix: PathBuf::from(prefix),
            listing: Duration::from_millis(listing),
            block: Duration::from_millis(block),
        })
    }

    fn config() -> Option<&'static Slow> {
        static CONFIG: OnceLock<Option<Slow>> = OnceLock::new();
        CONFIG
            .get_or_init(|| std::env::var("FNF_TEST_SLOW").ok().and_then(|v| parse(&v)))
            .as_ref()
    }

    pub fn listing(dir: &Path) {
        if let Some(c) = config().filter(|c| dir.starts_with(&c.prefix)) {
            std::thread::sleep(c.listing);
        }
    }

    pub fn block(file: &Path) {
        if let Some(c) = config().filter(|c| file.starts_with(&c.prefix)) {
            std::thread::sleep(c.block);
        }
    }
}

/// Delays a listing below the configured prefix (debug builds only).
#[inline]
pub fn listing(_dir: &std::path::Path) {
    #[cfg(debug_assertions)]
    imp::listing(_dir);
}

/// Delays one written block below the configured prefix (debug builds only).
#[inline]
pub fn block(_file: &std::path::Path) {
    #[cfg(debug_assertions)]
    imp::block(_file);
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::imp::{Slow, parse};
    use std::path::PathBuf;
    use std::time::Duration;

    #[test]
    fn parses_prefix_and_delays() {
        assert_eq!(
            parse("/tmp/slow:1500:40"),
            Some(Slow {
                prefix: PathBuf::from("/tmp/slow"),
                listing: Duration::from_millis(1500),
                block: Duration::from_millis(40),
            })
        );
        assert_eq!(
            parse(r"C:\slow:10:0").unwrap().prefix,
            PathBuf::from(r"C:\slow")
        );
        assert_eq!(parse("/tmp/slow:x:1"), None);
        assert_eq!(parse(":1:1"), None);
        assert_eq!(parse("1:1"), None);
    }
}
