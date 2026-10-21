//! Checksums (design 039): hash files (MD5, SHA-1, SHA-256, SHA-512), write and read
//! checksum files in the GNU coreutils format (`<hex>  <name>`, `\` escapes) and read
//! the BSD format (`SHA256 (name) = hex`). Names in a checksum file are relative to
//! its folder with `/`; a file from elsewhere is hostile: absolute names, `..` and
//! anything that leaves the folder (also through links) are refused.
//! Keep in sync with `src/app/core/checksum/checksum.models.ts`.

use md5::Md5;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Read buffer of the hashing loop (also the granularity of cancel and progress).
pub const CHUNK: usize = 1024 * 1024;
/// A checksum file larger than this is not read (a million lines are ~100 MiB).
pub const MAX_LIST_BYTES: u64 = 128 * 1024 * 1024;
/// Problems listed in the verify report (`ok` and the counts are complete).
pub const MAX_PROBLEMS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Algo {
    Md5,
    Sha1,
    Sha256,
    Sha512,
}

impl Algo {
    pub const ALL: [Algo; 4] = [Algo::Md5, Algo::Sha1, Algo::Sha256, Algo::Sha512];

    /// File extension of a checksum file (`.sha256` …), also the GNU tool name minus `sum`.
    pub fn ext(self) -> &'static str {
        match self {
            Algo::Md5 => "md5",
            Algo::Sha1 => "sha1",
            Algo::Sha256 => "sha256",
            Algo::Sha512 => "sha512",
        }
    }

    /// Name in the BSD format (`SHA256 (x) = …`).
    pub fn bsd_name(self) -> &'static str {
        match self {
            Algo::Md5 => "MD5",
            Algo::Sha1 => "SHA1",
            Algo::Sha256 => "SHA256",
            Algo::Sha512 => "SHA512",
        }
    }

    pub fn hex_len(self) -> usize {
        match self {
            Algo::Md5 => 32,
            Algo::Sha1 => 40,
            Algo::Sha256 => 64,
            Algo::Sha512 => 128,
        }
    }

    fn from_hex_len(n: usize) -> Option<Algo> {
        Algo::ALL.into_iter().find(|a| a.hex_len() == n)
    }

    fn from_bsd(name: &str) -> Option<Algo> {
        let n = name.replace('-', "").to_ascii_uppercase();
        Algo::ALL.into_iter().find(|a| a.bsd_name() == n)
    }

    /// The algorithm a checksum file's name stands for (`x.sha256`, `SHA256SUMS`, `MD5SUMS` …).
    pub fn from_file_name(name: &str) -> Option<Algo> {
        let lower = name.to_lowercase();
        let ext = lower.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
        if let Some(a) = Algo::ALL.into_iter().find(|a| a.ext() == ext) {
            return Some(a);
        }
        Algo::ALL
            .into_iter()
            .find(|a| lower.starts_with(&format!("{}sum", a.ext())))
    }
}

enum Hasher {
    Md5(Md5),
    Sha1(Sha1),
    Sha256(Sha256),
    Sha512(Sha512),
}

impl Hasher {
    fn new(algo: Algo) -> Self {
        match algo {
            Algo::Md5 => Hasher::Md5(Md5::new()),
            Algo::Sha1 => Hasher::Sha1(Sha1::new()),
            Algo::Sha256 => Hasher::Sha256(Sha256::new()),
            Algo::Sha512 => Hasher::Sha512(Sha512::new()),
        }
    }

    fn update(&mut self, data: &[u8]) {
        match self {
            Hasher::Md5(h) => h.update(data),
            Hasher::Sha1(h) => h.update(data),
            Hasher::Sha256(h) => h.update(data),
            Hasher::Sha512(h) => h.update(data),
        }
    }

    fn hex(self) -> String {
        let bytes: Vec<u8> = match self {
            Hasher::Md5(h) => h.finalize().to_vec(),
            Hasher::Sha1(h) => h.finalize().to_vec(),
            Hasher::Sha256(h) => h.finalize().to_vec(),
            Hasher::Sha512(h) => h.finalize().to_vec(),
        };
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Hashes everything `reader` yields; `None` when cancelled. `on_bytes` gets each chunk's size.
pub fn hash_reader(
    reader: &mut dyn Read,
    algo: Algo,
    cancel: &AtomicBool,
    on_bytes: &mut dyn FnMut(u64),
) -> io::Result<Option<String>> {
    let mut h = Hasher::new(algo);
    let mut buf = vec![0u8; CHUNK];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        h.update(&buf[..n]);
        on_bytes(n as u64);
    }
    Ok(Some(h.hex()))
}

/// Hashes a regular file (never a device, FIFO or a folder: `open_regular_file`).
pub fn hash_file(
    path: &Path,
    algo: Algo,
    cancel: &AtomicBool,
    on_bytes: &mut dyn FnMut(u64),
) -> io::Result<Option<String>> {
    let mut f = crate::platform::open_regular_file(path)?;
    hash_reader(&mut f, algo, cancel, on_bytes)
}

/// One line in the GNU format; names with `\` or a line break are escaped (line starts with `\`).
pub fn format_line(hex: &str, name: &str) -> String {
    if name.contains('\\') || name.contains('\n') || name.contains('\r') {
        let escaped = name
            .replace('\\', "\\\\")
            .replace('\n', "\\n")
            .replace('\r', "\\r");
        format!("\\{hex}  {escaped}\n")
    } else {
        format!("{hex}  {name}\n")
    }
}

/// Name of `file` relative to `base` with `/` – `None` outside `base` or not UTF-8.
pub fn relative_name(base: &Path, file: &Path) -> Option<String> {
    let rel = file.strip_prefix(base).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_str()?.to_string()),
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// A line that is no checksum line of the format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BadLine;

/// A name that would leave the folder of its checksum file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Refused;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub algo: Algo,
    /// Lower case.
    pub hex: String,
    pub name: String,
}

fn unescape(s: &str) -> Option<String> {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next()? {
                '\\' => out.push('\\'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                _ => return None,
            }
        } else {
            out.push(c);
        }
    }
    Some(out)
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Reads one line; `None` = no checksum line (empty, comment) – `Err` = a broken one.
/// `hint` = the algorithm of the file's name, checked against the digest length.
pub fn parse_line(raw: &str, hint: Option<Algo>) -> Option<Result<Line, BadLine>> {
    let line = raw.trim_end_matches(['\r', '\n']);
    if line.trim().is_empty() || line.starts_with('#') {
        return None;
    }
    let (escaped, line) = match line.strip_prefix('\\') {
        Some(rest) => (true, rest),
        None => (false, line),
    };
    // BSD: `ALGO (name) = hex`
    if let Some((head, hex)) = line.rsplit_once(") = ")
        && let Some((algo, name)) = head.split_once(" (")
        && let Some(algo) = Algo::from_bsd(algo)
    {
        let name = if escaped {
            unescape(name)
        } else {
            Some(name.to_string())
        };
        return Some(match name {
            Some(name) if is_hex(hex) && hex.len() == algo.hex_len() && !name.is_empty() => {
                Ok(Line {
                    algo,
                    hex: hex.to_ascii_lowercase(),
                    name,
                })
            }
            _ => Err(BadLine),
        });
    }
    // GNU: `hex  name` (text mode) or `hex *name` (binary mode)
    let Some((hex, rest)) = line.split_once(' ') else {
        return Some(Err(BadLine));
    };
    let name = rest
        .strip_prefix(' ')
        .or_else(|| rest.strip_prefix('*'))
        .unwrap_or(rest);
    let name = if escaped {
        unescape(name)
    } else {
        Some(name.to_string())
    };
    let algo = Algo::from_hex_len(hex.len());
    Some(match (name, algo) {
        (Some(name), Some(algo))
            if is_hex(hex) && !name.is_empty() && hint.is_none_or(|h| h == algo) =>
        {
            Ok(Line {
                algo,
                hex: hex.to_ascii_lowercase(),
                name,
            })
        }
        _ => Err(BadLine),
    })
}

/// Where a name of a checksum file in `base` points: only plain relative names that stay
/// below `base` – also after following links (`base` and the target canonical).
/// `Ok(None)` = the file does not exist (anymore).
pub fn resolve(base: &Path, name: &str) -> Result<Option<PathBuf>, Refused> {
    if name.contains('\0') {
        return Err(Refused);
    }
    // `\` separates on Windows only; elsewhere it is part of a name
    let rel = Path::new(name);
    let mut out = base.to_path_buf();
    for c in rel.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return Err(Refused),
        }
    }
    if out == base {
        return Err(Refused);
    }
    let canon_base = base.canonicalize().map_err(|_| Refused)?;
    match out.canonicalize() {
        Ok(real) if real.starts_with(&canon_base) && real != canon_base => Ok(Some(out)),
        Ok(_) => Err(Refused),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            // a missing file: its folder must still be inside (a link may point elsewhere)
            match out.parent().map(Path::canonicalize) {
                Some(Ok(parent)) if parent.starts_with(&canon_base) => Ok(None),
                Some(Err(e)) if e.kind() == io::ErrorKind::NotFound => Ok(None),
                _ => Err(Refused),
            }
        }
        Err(_) => Ok(Some(out)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn hash(data: &[u8], algo: Algo) -> String {
        let flag = AtomicBool::new(false);
        hash_reader(&mut &data[..], algo, &flag, &mut |_| {})
            .unwrap()
            .unwrap()
    }

    #[test]
    fn known_vectors() {
        assert_eq!(hash(b"abc", Algo::Md5), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            hash(b"abc", Algo::Sha1),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(
            hash(b"abc", Algo::Sha256),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(hash(b"abc", Algo::Sha512).starts_with("ddaf35a193617aba"));
        assert_eq!(
            hash(b"", Algo::Sha256),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn cancel_stops_and_progress_counts() {
        let data = vec![7u8; CHUNK * 3 + 5];
        let flag = AtomicBool::new(false);
        let mut seen = 0;
        let h = hash_reader(&mut &data[..], Algo::Sha256, &flag, &mut |n| seen += n).unwrap();
        assert!(h.is_some());
        assert_eq!(seen, data.len() as u64);
        flag.store(true, Ordering::Relaxed);
        assert_eq!(
            hash_reader(&mut &data[..], Algo::Sha256, &flag, &mut |_| {}).unwrap(),
            None
        );
    }

    #[test]
    fn lines_round_trip_with_escapes() {
        let hex = "ab".repeat(32);
        for name in [
            "x.txt",
            "Ü ä/b 😀.txt",
            "back\\slash",
            "new\nline",
            "*star",
            " lead",
        ] {
            let line = format_line(&hex, name);
            let parsed = parse_line(&line, Some(Algo::Sha256)).unwrap().unwrap();
            assert_eq!(parsed.name, name, "{line:?}");
            assert_eq!(parsed.hex, hex);
        }
        assert!(format_line(&hex, "a\\b").starts_with('\\'));
    }

    #[test]
    fn reads_gnu_binary_bsd_and_rejects_broken_lines() {
        let md5 = "900150983CD24FB0D6963F7D28E17F72";
        let l = parse_line(&format!("{md5} *bin.dat\r\n"), None)
            .unwrap()
            .unwrap();
        assert_eq!((l.algo, l.name.as_str()), (Algo::Md5, "bin.dat"));
        assert_eq!(l.hex, md5.to_lowercase());
        let l = parse_line(&format!("MD5 (a b.txt) = {md5}"), None)
            .unwrap()
            .unwrap();
        assert_eq!(l.name, "a b.txt");
        let l = parse_line(&format!("SHA256 (x) = {}", "0".repeat(64)), None)
            .unwrap()
            .unwrap();
        assert_eq!(l.algo, Algo::Sha256);
        assert!(parse_line("", None).is_none());
        assert!(parse_line("# comment", None).is_none());
        for bad in [
            "nothex  x".to_string(),
            format!("{}  x", "a".repeat(31)),
            md5.to_string(),
            format!("{md5}  "),
            format!("\\{md5}  bad\\qescape"),
            format!("MD5 (x) = {}", "a".repeat(64)),
        ] {
            assert_eq!(parse_line(&bad, None), Some(Err(BadLine)), "{bad}");
        }
        // the name says SHA-256, the digest is MD5
        assert_eq!(
            parse_line(&format!("{md5}  x"), Some(Algo::Sha256)),
            Some(Err(BadLine))
        );
    }

    #[test]
    fn algorithm_from_the_file_name() {
        assert_eq!(Algo::from_file_name("CHECKSUMS.sha256"), Some(Algo::Sha256));
        assert_eq!(Algo::from_file_name("x.MD5"), Some(Algo::Md5));
        assert_eq!(Algo::from_file_name("SHA512SUMS"), Some(Algo::Sha512));
        assert_eq!(Algo::from_file_name("sha1sums.txt"), Some(Algo::Sha1));
        assert_eq!(Algo::from_file_name("notes.txt"), None);
    }

    #[test]
    fn relative_names_use_slashes() {
        let base = Path::new("/b");
        assert_eq!(
            relative_name(base, Path::new("/b/sub/ä x.txt")).as_deref(),
            Some("sub/ä x.txt")
        );
        assert_eq!(relative_name(base, Path::new("/other/x")), None);
        assert_eq!(relative_name(base, base), None);
    }

    #[test]
    fn hostile_names_never_leave_the_folder() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("base ä");
        fs::create_dir_all(base.join("sub")).unwrap();
        fs::write(base.join("sub/x.txt"), "x").unwrap();
        fs::write(dir.path().join("secret"), "s").unwrap();
        assert_eq!(
            resolve(&base, "sub/x.txt"),
            Ok(Some(base.join("sub/x.txt")))
        );
        assert_eq!(
            resolve(&base, "./sub/x.txt"),
            Ok(Some(base.join("sub/x.txt")))
        );
        assert_eq!(resolve(&base, "gone.txt"), Ok(None));
        assert_eq!(resolve(&base, "nowhere/gone.txt"), Ok(None));
        for bad in [
            "../secret",
            "sub/../../secret",
            "/etc/passwd",
            "",
            ".",
            "a\0b",
        ] {
            assert_eq!(resolve(&base, bad), Err(Refused), "{bad}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path(), base.join("out")).unwrap();
            assert_eq!(resolve(&base, "out/secret"), Err(Refused));
            assert_eq!(resolve(&base, "out/missing"), Err(Refused));
        }
    }

    #[test]
    fn hashes_only_regular_files() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("a.txt");
        fs::write(&f, b"abc").unwrap();
        let flag = AtomicBool::new(false);
        assert_eq!(
            hash_file(&f, Algo::Md5, &flag, &mut |_| {})
                .unwrap()
                .unwrap(),
            "900150983cd24fb0d6963f7d28e17f72"
        );
        assert!(hash_file(dir.path(), Algo::Md5, &flag, &mut |_| {}).is_err());
    }
}
