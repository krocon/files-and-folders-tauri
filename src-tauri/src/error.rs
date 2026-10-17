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
    /// A search pattern (regex, glob) is invalid or too large (design 009).
    InvalidPattern,
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
        let e = FsError::new(FsErrorCode::InvalidPattern, "bad", None);
        assert_eq!(serde_json::to_value(&e).unwrap()["code"], "invalid_pattern");
    }
}
