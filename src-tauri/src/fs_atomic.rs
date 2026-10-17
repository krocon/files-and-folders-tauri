//! Small helpers for config files written by the app: atomic replace and
//! keeping a broken file aside instead of overwriting it.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Writes `bytes` atomically: temp file in the target directory, flush,
/// rename. Creates the directory if needed. On error the old file is untouched.
pub fn write_atomic(file: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = file
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "file has no directory"))?;
    fs::create_dir_all(dir)?;
    let mut tmp_name = file.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(format!(".tmp-{}", std::process::id()));
    let tmp = file.with_file_name(tmp_name);
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Renames `file` to `<name>.bad` (replacing an older one). `None` if that failed.
pub fn keep_broken_file(file: &Path) -> Option<PathBuf> {
    let mut name = file.file_name()?.to_os_string();
    name.push(".bad");
    let bad = file.with_file_name(name);
    fs::rename(file, &bad).ok().map(|_| bad)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_atomically_and_creates_the_directory() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("a b/ü.json");
        write_atomic(&file, b"1").unwrap();
        write_atomic(&file, b"2").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"2");
        assert_eq!(fs::read_dir(file.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn keeps_a_broken_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("x.json");
        fs::write(&file, "bad").unwrap();
        let bad = keep_broken_file(&file).unwrap();
        assert_eq!(fs::read_to_string(bad).unwrap(), "bad");
        assert!(!file.exists());
        assert!(keep_broken_file(&file).is_none());
    }
}
