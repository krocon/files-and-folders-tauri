//! A secret text (design 025 E4, 034 E3): archive passwords, server passwords and
//! key passphrases. [`Secret`] hides its text in `Debug`, has no `Serialize` (it can
//! never travel back to the frontend or into a file) and is wiped (`zeroize`) when
//! it is dropped.

use serde::{Deserialize, Deserializer};
use zeroize::Zeroizing;

/// Passwords longer than this are refused (no archive format needs more).
pub const MAX_PASSWORD_CHARS: usize = 1024;

/// A password. `Debug` prints `***`; there is no `Serialize`, so a job spec
/// that carries one (`skip_serializing`) never sends it back to the frontend.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(text: impl Into<String>) -> Self {
        Secret(Zeroizing::new(text.into()))
    }

    /// The password itself – only for handing it to a decoder/encoder.
    pub fn expose(&self) -> &str {
        self.0.as_str()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = Zeroizing::new(String::deserialize(d)?);
        if text.chars().count() > MAX_PASSWORD_CHARS {
            return Err(serde::de::Error::custom("password too long"));
        }
        Ok(Secret(text))
    }
}
