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

/// Copies an existing `file` to `<name>.bak` before it is replaced (design 026 E11); when that
/// exists `<name>.bak-2` … `-99` – an older backup is never overwritten. `None` = no file.
pub fn backup_copy(file: &Path) -> io::Result<Option<PathBuf>> {
    match fs::metadata(file) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
        Ok(m) if !m.is_file() => {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a file"));
        }
        Ok(_) => {}
    }
    let name = file
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "file has no name"))?;
    for n in 1..=99 {
        let mut backup = name.to_os_string();
        backup.push(if n == 1 {
            ".bak".to_string()
        } else {
            format!(".bak-{n}")
        });
        let target = file.with_file_name(backup);
        let mut out = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        };
        let copied = fs::File::open(file)
            .and_then(|mut src| io::copy(&mut src, &mut out))
            .and_then(|_| out.sync_all());
        if let Err(e) = copied {
            drop(out);
            let _ = fs::remove_file(&target);
            return Err(e);
        }
        return Ok(Some(target));
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "too many backups next to the file",
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn backups_never_overwrite_an_older_one() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("ä b.json");
        assert!(backup_copy(&file).unwrap().is_none());
        fs::write(&file, "1").unwrap();
        let first = backup_copy(&file).unwrap().unwrap();
        fs::write(&file, "2").unwrap();
        let second = backup_copy(&file).unwrap().unwrap();
        assert!(first.ends_with("ä b.json.bak") && second.ends_with("ä b.json.bak-2"));
        assert_eq!(fs::read_to_string(first).unwrap(), "1");
        assert_eq!(fs::read_to_string(second).unwrap(), "2");
        assert!(backup_copy(dir.path()).is_err());
    }

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
