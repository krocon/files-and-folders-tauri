use serde::Serialize;
use std::io;
use std::path::Path;

/// Machine-readable error codes. Serialised as `snake_case` strings so the
/// frontend can map them to user-facing messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FsErrorCode {
    NotFound,
    PermissionDenied,
    NotADirectory,
    /// A file was expected (e.g. `open_file` on a folder).
    NotAFile,
    /// The file is executable; opening it needs an explicit confirmation.
    Executable,
    InvalidPath,
    NoHomeDirectory,
    /// Copy/move target lies inside the source folder.
    TargetInsideSource,
    /// Copy/move onto itself (source already in the target folder).
    SameSourceTarget,
    /// The target volume is full.
    DiskFull,
    /// A file or folder with this name exists already.
    AlreadyExists,
    /// The name is not allowed (separator, reserved name, too long …).
    InvalidName,
    /// Root, drive, home or system folder – needs an explicit second confirmation.
    DangerousPath,
    /// The item could not be moved to the trash (no trash on this volume …).
    TrashFailed,
    /// The drive has no trash at all (Windows: network, removable, optical drives) –
    /// nothing was deleted; the user may delete permanently instead (006 review #5).
    NoTrash,
    /// Two entries of a multi-rename would get the same name (design 007 E5).
    DuplicateTarget,
    /// Nothing to undo (no rename log for this task, or it was undone already).
    UndoUnavailable,
    /// An external program (tool, terminal, file manager) is not installed / not found.
    ProgramNotFound,
    /// The frontend asked for a tool id that is not in the configuration.
    UnknownTool,
    /// More files than the tool's `fileLimit`.
    TooManyFiles,
    /// More items than a command accepts (watched folders, dropped paths).
    TooMany,
    /// A search pattern (regex, glob) is invalid or too large (design 009).
    InvalidPattern,
    /// An archive is broken or uses an unsupported feature (encryption, method …) (design 016).
    ArchiveError,
    /// An archive entry would leave the target folder or is a link (zip slip, design 016 E3).
    UnsafeEntry,
    /// An archive exceeds the safety limits (entries, unpacked size, ratio – zip bomb).
    ArchiveTooLarge,
    /// The frontend sent a menu spec that is malformed or too large (design 014).
    InvalidMenu,
    /// A file to import is no settings export, has another version or is too big (design 015).
    InvalidSettings,
    /// The shell bar is switched off in the settings (design 021 E1).
    ShellDisabled,
    /// A shell command still runs – one at a time (design 021 E3).
    ShellBusy,
    /// The entry is no longer what the panel showed (design 030 E5): left alone.
    ChangedSinceListing,
    /// The shell command is empty, too long or contains a line break / NUL.
    InvalidCommand,
    /// A name cannot be quoted safely for the shell (control characters, `%`/`!` for cmd.exe).
    UnquotableName,
    /// A drag out of the window was asked for while no mouse button is held (design 028 E2).
    DragNotHeld,
    /// The archive (or entry) is encrypted and no password is known (design 025 E4).
    ArchivePasswordRequired,
    /// The password known for the archive does not fit (design 025 E4).
    ArchivePasswordWrong,
    /// The archive cannot be changed: 7z/RAR, a link, unsafe or duplicate names, SFX (design 035).
    ArchiveReadOnly,
    /// Another job writes this archive right now (design 035 E2).
    ArchiveBusy,
    /// The system refuses symbolic links here (Windows without developer mode, FAT …) (design 031 E9).
    LinkNotPermitted,
    /// A relative link cannot point to the source (other drive, or a linked folder on the way) (031 E9).
    RelativeLinkImpossible,
    /// A selected link was left unchanged – attributes are never changed through links (design 024 E4).
    SymlinkSkipped,
    /// A disk-usage scan is unknown or was released (design 033 E4).
    ScanNotFound,
    /// A part of the disk-usage scan is being scanned again (design 033 E4).
    ScanBusy,
    /// Server connections (design 034): the profile is not connected (or the connection was closed).
    RemoteNotConnected,
    /// The server refused the login (user, password, key).
    RemoteAuthFailed,
    /// The server could not be reached (name, refused, network).
    RemoteUnreachable,
    /// The server did not answer in time.
    RemoteTimeout,
    /// The connection broke during an operation.
    RemoteConnectionLost,
    /// The SSH host key differs from the one recorded (possible attack) – refused.
    RemoteHostKeyChanged,
    /// The server answered with an error (code in the message).
    RemoteProtocol,
    /// The operation is not possible on a server (e.g. trash).
    RemoteUnsupported,
    /// The system keychain is not available (no Secret Service, locked, error).
    KeychainUnavailable,
    /// A connection profile is invalid.
    InvalidProfile,
    /// A server address (`sftp://…`) could not be read.
    InvalidUrl,
    /// The connection profile does not exist (any more).
    UnknownProfile,
    /// Duplicates (design 042): an image that cannot be read safely (format, broken, too large).
    UnsupportedImage,
    /// Duplicates (design 042 E5): the kept file or a copy changed since the search – left alone.
    DuplicateChanged,
    Io,
}

/// Error returned by Tauri commands. Serialised as
/// `{ "code": "...", "message": "...", "path": "..." | null }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FsError {
    pub code: FsErrorCode,
    pub message: String,
    pub path: Option<String>,
}

impl FsError {
    pub fn new(code: FsErrorCode, message: impl Into<String>, path: Option<&Path>) -> Self {
        Self {
            code,
            message: message.into(),
            path: path.map(|p| p.to_string_lossy().into_owned()),
        }
    }

    /// An error for a path given as text (server paths `remote://…`, design 034).
    pub fn at(code: FsErrorCode, message: impl Into<String>, path: &str) -> Self {
        Self {
            code,
            message: message.into(),
            path: Some(path.to_string()),
        }
    }

    pub fn from_io(err: &io::Error, path: &Path) -> Self {
        let code = match err.kind() {
            io::ErrorKind::NotFound => FsErrorCode::NotFound,
            io::ErrorKind::PermissionDenied => FsErrorCode::PermissionDenied,
            io::ErrorKind::NotADirectory => FsErrorCode::NotADirectory,
            io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => FsErrorCode::DiskFull,
            io::ErrorKind::AlreadyExists => FsErrorCode::AlreadyExists,
            _ => FsErrorCode::Io,
        };
        Self::new(code, err.to_string(), Some(path))
    }
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for FsError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_io_error_kinds() {
        let p = Path::new("x");
        let e = FsError::from_io(&io::Error::from(io::ErrorKind::NotFound), p);
        assert_eq!(e.code, FsErrorCode::NotFound);
        let e = FsError::from_io(&io::Error::from(io::ErrorKind::PermissionDenied), p);
        assert_eq!(e.code, FsErrorCode::PermissionDenied);
        let e = FsError::from_io(&io::Error::other("boom"), p);
        assert_eq!(e.code, FsErrorCode::Io);
        assert_eq!(e.path.as_deref(), Some("x"));
    }

    #[test]
    fn serialises_code_as_snake_case() {
        let e = FsError::new(FsErrorCode::PermissionDenied, "denied", None);
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["code"], "permission_denied");
        assert_eq!(json["path"], serde_json::Value::Null);
        let e = FsError::new(FsErrorCode::SymlinkSkipped, "link", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "symlink_skipped");
        let e = FsError::new(FsErrorCode::DragNotHeld, "up", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "drag_not_held");
        let e = FsError::new(FsErrorCode::DuplicateTarget, "dup", None);
        assert_eq!(
            serde_json::to_value(&e).unwrap()["code"],
            "duplicate_target"
        );
        let e = FsError::new(FsErrorCode::ProgramNotFound, "no", None);
        assert_eq!(
            serde_json::to_value(&e).unwrap()["code"],
            "program_not_found"
        );
        let e = FsError::new(FsErrorCode::TooManyFiles, "no", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "too_many_files");
        let e = FsError::new(FsErrorCode::UnknownTool, "no", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "unknown_tool");
        let e = FsError::new(FsErrorCode::UndoUnavailable, "no", None);
        assert_eq!(
            serde_json::to_value(&e).unwrap()["code"],
            "undo_unavailable"
        );
        let e = FsError::new(FsErrorCode::TooMany, "many", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "too_many");
        let e = FsError::new(FsErrorCode::InvalidPattern, "bad", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "invalid_pattern");
        let e = FsError::new(FsErrorCode::UnsafeEntry, "slip", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "unsafe_entry");
        let e = FsError::new(FsErrorCode::ArchiveTooLarge, "bomb", None);
        assert_eq!(
            serde_json::to_value(&e).unwrap()["code"],
            "archive_too_large"
        );
        let e = FsError::new(FsErrorCode::ArchiveError, "broken", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "archive_error");
        let e = FsError::new(FsErrorCode::ArchivePasswordRequired, "pw", None);
        assert_eq!(
            serde_json::to_value(&e).unwrap()["code"],
            "archive_password_required"
        );
        let e = FsError::new(FsErrorCode::ArchivePasswordWrong, "pw", None);
        assert_eq!(
            serde_json::to_value(&e).unwrap()["code"],
            "archive_password_wrong"
        );
        let e = FsError::new(FsErrorCode::InvalidMenu, "bad", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "invalid_menu");
    }
}
