//! Change attributes (design 024): permissions (Unix), attributes (Windows,
//! "hidden" on macOS) and times – always as a difference to what an entry has
//! (E3), never following links (E4). The job lives in `jobs/attributes.rs`,
//! the system calls in `platform/attributes.rs`.
//! Keep in sync with `src/app/core/attributes/attributes.models.ts`.

use crate::error::{FsError, FsErrorCode};
use crate::platform::attributes as sys;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Selected entries per job (the contents of folders are not limited).
pub const MAX_ITEMS: usize = 10_000;
/// Permission bits incl. setuid, setgid and sticky.
pub const MODE_MASK: u32 = 0o7777;
/// 1601-01-01 00:00:00.001 … 9999-12-31: what every OS can store. Not 1601-01-01
/// 00:00:00.000 itself: that is `FILETIME` 0, which Windows reads as "leave the
/// time unchanged" (external review #6).
pub const MIN_MS: i64 = -11_644_473_600_000 + 1;
pub const MAX_MS: i64 = 253_402_300_799_999;

/// Which entries a change applies to (selected ones and the contents of folders, E2).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApplyTo {
    #[default]
    All,
    Files,
    Dirs,
}

impl ApplyTo {
    pub fn matches(self, is_dir: bool) -> bool {
        match self {
            ApplyTo::All => true,
            ApplyTo::Files => !is_dir,
            ApplyTo::Dirs => is_dir,
        }
    }
}

/// A new time: "now" (resolved once when the job starts) or a fixed instant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TimeValue {
    Now,
    At { ms: i64 },
}

/// What to change. `None` / no bit = unchanged (tri-state for many entries).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrChange {
    /// Unix: permission bits to set …
    #[serde(default)]
    pub mode_set: u32,
    /// … and to clear (disjoint from `mode_set`).
    #[serde(default)]
    pub mode_clear: u32,
    /// Windows attributes; `hidden` also on macOS (`UF_HIDDEN`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readonly: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<TimeValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accessed: Option<TimeValue>,
    /// Creation time: Windows and macOS only (Linux cannot set it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<TimeValue>,
}

/// What this OS can change (E6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Supported {
    pub mode: bool,
    pub readonly: bool,
    pub hidden: bool,
    pub system: bool,
    pub archive: bool,
    pub created: bool,
}

pub const UNIX: Supported = Supported {
    mode: true,
    readonly: false,
    hidden: false,
    system: false,
    archive: false,
    created: false,
};
pub const MACOS: Supported = Supported {
    hidden: true,
    created: true,
    ..UNIX
};
pub const WINDOWS: Supported = Supported {
    mode: false,
    readonly: true,
    hidden: true,
    system: true,
    archive: true,
    created: true,
};

/// The fields of the running OS.
pub const SUPPORTED: Supported = if cfg!(windows) {
    WINDOWS
} else if cfg!(target_os = "macos") {
    MACOS
} else {
    UNIX
};

fn invalid(message: &str) -> FsError {
    FsError::new(FsErrorCode::InvalidPath, message, None)
}

impl AttrChange {
    pub fn is_empty(&self) -> bool {
        self.mode_set == 0
            && self.mode_clear == 0
            && self.readonly.is_none()
            && self.hidden.is_none()
            && self.system.is_none()
            && self.archive.is_none()
            && self.modified.is_none()
            && self.accessed.is_none()
            && self.created.is_none()
    }

    /// Checks the change for the running OS.
    pub fn validate(&self) -> Result<(), FsError> {
        self.validate_for(SUPPORTED)
    }

    pub fn validate_for(&self, s: Supported) -> Result<(), FsError> {
        if self.is_empty() {
            return Err(invalid("Nothing to change"));
        }
        if (self.mode_set | self.mode_clear) & !MODE_MASK != 0 {
            return Err(invalid("Unknown permission bits"));
        }
        if self.mode_set & self.mode_clear != 0 {
            return Err(invalid("A permission cannot be set and cleared at once"));
        }
        let unsupported = [
            (self.mode_set | self.mode_clear != 0, s.mode),
            (self.readonly.is_some(), s.readonly),
            (self.hidden.is_some(), s.hidden),
            (self.system.is_some(), s.system),
            (self.archive.is_some(), s.archive),
            (self.created.is_some(), s.created),
        ];
        if unsupported.iter().any(|&(asked, can)| asked && !can) {
            return Err(invalid("This cannot be changed on this system"));
        }
        for t in [self.modified, self.accessed, self.created]
            .into_iter()
            .flatten()
        {
            if let TimeValue::At { ms } = t
                && !(MIN_MS..=MAX_MS).contains(&ms)
            {
                return Err(invalid("The date is out of range (1601–9999)"));
            }
        }
        Ok(())
    }

    /// The mode after the change (permission bits only).
    pub fn new_mode(&self, current: u32) -> u32 {
        ((current & !self.mode_clear) | self.mode_set) & MODE_MASK
    }

    /// The owner gets read or execute permission they do not have yet: a folder
    /// is then (partly) changed before its contents, otherwise after them (E7).
    pub fn owner_gains_access(&self, current: u32) -> bool {
        self.new_mode(current) & !current & 0o500 != 0
    }

    /// When a folder with mode `current` is changed relative to its contents
    /// (E7, external review #8).
    pub fn folder_order(&self, current: u32) -> FolderOrder {
        if !self.owner_gains_access(current) {
            return FolderOrder::After;
        }
        let new = self.new_mode(current);
        if new & 0o500 == 0o500 {
            return FolderOrder::First; // the owner can read and enter it afterwards
        }
        // e.g. u+x u-r: first only what is gained, the rest after the contents
        FolderOrder::Staged(current | (new & !current))
    }

    /// Fixes "now" for every entry of the job.
    pub fn resolve(&self, now: SystemTime) -> Resolved {
        let at = |t: Option<TimeValue>| {
            t.map(|t| match t {
                TimeValue::Now => now,
                TimeValue::At { ms } => time_of_ms(ms),
            })
        };
        Resolved {
            mode_set: self.mode_set,
            mode_clear: self.mode_clear,
            flags: sys::Flags {
                readonly: self.readonly,
                hidden: self.hidden,
                system: self.system,
                archive: self.archive,
            },
            times: sys::Times {
                accessed: at(self.accessed),
                modified: at(self.modified),
                created: at(self.created),
            },
        }
    }
}

/// When a folder is changed during a recursive walk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderOrder {
    /// Before its contents (the change opens it for the owner).
    First,
    /// The gained bits (this mode) before the contents, the full change after them.
    Staged(u32),
    /// After its contents (`chmod -R a-x` does not lock itself out).
    After,
}

/// Milliseconds since the Unix epoch (negative = before 1970) as a time.
pub fn time_of_ms(ms: i64) -> SystemTime {
    let d = Duration::from_millis(ms.unsigned_abs());
    if ms >= 0 {
        UNIX_EPOCH + d
    } else {
        UNIX_EPOCH - d
    }
}

/// A change with fixed times, applied to one entry after another.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub mode_set: u32,
    pub mode_clear: u32,
    pub flags: sys::Flags,
    pub times: sys::Times,
}

impl Resolved {
    fn changes_mode(&self) -> bool {
        self.mode_set | self.mode_clear != 0
    }

    /// What changes on an entry that is no link (`st` read right before).
    pub fn for_entry(&self, st: &sys::Stat) -> sys::Apply {
        let mode = if self.changes_mode() && cfg!(unix) {
            let change = AttrChange {
                mode_set: self.mode_set,
                mode_clear: self.mode_clear,
                ..AttrChange::default()
            };
            Some(change.new_mode(st.mode)).filter(|&m| m != st.mode) // no needless change of ctime
        } else if self.changes_mode() {
            Some(0) // refused by the platform (validated before)
        } else {
            None
        };
        sys::Apply {
            mode,
            flags: self.flags,
            times: self.times,
        }
    }
}

/// The error for a selected link (E4).
pub fn symlink_skipped(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::SymlinkSkipped,
        "Links are left unchanged",
        Some(path),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(json: &str) -> AttrChange {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn wire_format_and_defaults() {
        let c = change(
            r#"{"modeSet":16,"hidden":true,"modified":{"type":"at","ms":1000},"accessed":{"type":"now"}}"#,
        );
        assert_eq!(c.mode_set, 0o20);
        assert_eq!(c.mode_clear, 0);
        assert_eq!(c.hidden, Some(true));
        assert_eq!(c.readonly, None);
        assert_eq!(c.modified, Some(TimeValue::At { ms: 1000 }));
        assert_eq!(c.accessed, Some(TimeValue::Now));
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["accessed"]["type"], "now");
        assert!(v.get("created").is_none());
        let a: ApplyTo = serde_json::from_str(r#""dirs""#).unwrap();
        assert_eq!(a, ApplyTo::Dirs);
        assert_eq!(ApplyTo::default(), ApplyTo::All);
        assert!(ApplyTo::Files.matches(false) && !ApplyTo::Files.matches(true));
        assert!(ApplyTo::Dirs.matches(true) && !ApplyTo::Dirs.matches(false));
    }

    #[test]
    fn validation_of_masks_platform_fields_and_times() {
        let err = |c: AttrChange, s: Supported| c.validate_for(s).unwrap_err().message;
        assert_eq!(err(AttrChange::default(), UNIX), "Nothing to change");
        let bad_bits = AttrChange {
            mode_set: 0o10000,
            ..AttrChange::default()
        };
        assert_eq!(err(bad_bits, UNIX), "Unknown permission bits");
        let both = AttrChange {
            mode_set: 0o20,
            mode_clear: 0o20,
            ..AttrChange::default()
        };
        assert!(err(both, UNIX).contains("at once"));
        let mode = AttrChange {
            mode_set: 0o4000,
            mode_clear: 0o002,
            ..AttrChange::default()
        };
        assert!(mode.validate_for(UNIX).is_ok());
        assert!(mode.validate_for(MACOS).is_ok());
        assert!(err(mode, WINDOWS).contains("this system"));
        let hidden = AttrChange {
            hidden: Some(true),
            ..AttrChange::default()
        };
        assert!(hidden.validate_for(MACOS).is_ok() && hidden.validate_for(WINDOWS).is_ok());
        assert!(err(hidden, UNIX).contains("this system"));
        for c in [
            AttrChange {
                system: Some(false),
                ..AttrChange::default()
            },
            AttrChange {
                readonly: Some(true),
                ..AttrChange::default()
            },
            AttrChange {
                archive: Some(true),
                ..AttrChange::default()
            },
        ] {
            assert!(c.validate_for(WINDOWS).is_ok());
            assert!(c.validate_for(MACOS).is_err());
        }
        let created = AttrChange {
            created: Some(TimeValue::Now),
            ..AttrChange::default()
        };
        assert!(created.validate_for(MACOS).is_ok() && created.validate_for(WINDOWS).is_ok());
        assert!(created.validate_for(UNIX).is_err(), "Linux cannot set it");
        let at = |ms| AttrChange {
            modified: Some(TimeValue::At { ms }),
            ..AttrChange::default()
        };
        assert!(at(MIN_MS).validate_for(UNIX).is_ok());
        assert!(at(MAX_MS).validate_for(UNIX).is_ok());
        assert!(err(at(MIN_MS - 1), UNIX).contains("range"));
        assert!(err(at(MAX_MS + 1), WINDOWS).contains("range"));
        assert!(at(0).validate_for(UNIX).is_ok(), "1970 is fine");
        assert_eq!(
            err(AttrChange::default(), WINDOWS),
            "Nothing to change",
            "checked first"
        );
    }

    #[test]
    fn new_mode_changes_only_the_named_bits() {
        let c = AttrChange {
            mode_set: 0o020,
            mode_clear: 0o005,
            ..AttrChange::default()
        };
        assert_eq!(c.new_mode(0o755), 0o770);
        assert_eq!(c.new_mode(0o4644), 0o4660, "setuid stays");
        assert_eq!(c.new_mode(0o100755), 0o770, "file type bits are dropped");
        let up = AttrChange {
            mode_set: 0o500,
            ..AttrChange::default()
        };
        assert!(up.owner_gains_access(0o000));
        assert!(up.owner_gains_access(0o400), "x is new");
        assert!(!up.owner_gains_access(0o700));
        let down = AttrChange {
            mode_clear: 0o111,
            ..AttrChange::default()
        };
        assert!(!down.owner_gains_access(0o755));
    }

    #[test]
    fn now_is_fixed_once_and_ms_convert_both_ways() {
        let now = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let c = AttrChange {
            modified: Some(TimeValue::Now),
            accessed: Some(TimeValue::At { ms: -1500 }),
            ..AttrChange::default()
        };
        let r = c.resolve(now);
        assert_eq!(r.times.modified, Some(now));
        assert_eq!(
            r.times.accessed,
            Some(UNIX_EPOCH - Duration::from_millis(1500))
        );
        assert_eq!(r.times.created, None);
        assert!(r.flags.is_empty());
        assert_eq!(time_of_ms(1234), UNIX_EPOCH + Duration::from_millis(1234));
    }

    /// External review #8: a folder the owner can read and enter afterwards is
    /// changed first; one that only gains a part gets that part first.
    #[test]
    fn folder_order_opens_up_before_and_closes_after_the_contents() {
        let c = |set, clear| AttrChange {
            mode_set: set,
            mode_clear: clear,
            ..AttrChange::default()
        };
        assert_eq!(c(0o500, 0).folder_order(0o000), FolderOrder::First);
        assert_eq!(c(0o100, 0).folder_order(0o600), FolderOrder::First);
        assert_eq!(
            c(0o100, 0o400).folder_order(0o600),
            FolderOrder::Staged(0o700)
        );
        assert_eq!(
            c(0o400, 0o100).folder_order(0o300),
            FolderOrder::Staged(0o700)
        );
        assert_eq!(c(0o020, 0).folder_order(0o700), FolderOrder::After);
        assert_eq!(c(0, 0o111).folder_order(0o755), FolderOrder::After);
    }

    /// External review #6: 1601-01-01 00:00:00.000 is `FILETIME` 0 ("unchanged").
    #[test]
    fn the_earliest_time_is_one_millisecond_after_1601() {
        assert_eq!(MIN_MS, -11_644_473_599_999);
        let at = |ms| AttrChange {
            created: Some(TimeValue::At { ms }),
            ..AttrChange::default()
        };
        assert!(at(MIN_MS).validate_for(WINDOWS).is_ok());
        assert!(at(MIN_MS - 1).validate_for(WINDOWS).is_err());
    }
}
