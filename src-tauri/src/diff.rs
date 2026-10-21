//! Comparing two files (design 037): text line by line (crate `similar`, Myers),
//! read with the viewer's encodings (`preview::encoding`), line endings
//! normalised, optionally ignoring white space and case; binary byte by byte.
//! Read-only, bounded: texts up to [`MAX_TEXT_BYTES`], binaries up to
//! [`MAX_BINARY_BYTES`] per file – above that the external tool is the answer.
//! Keep in sync with `src/app/core/diff/diff.models.ts`.

use crate::error::{FsError, FsErrorCode};
use crate::preview::{detect, encoding};
use serde::{Deserialize, Serialize};
use similar::{Algorithm, DiffOp, capture_diff_slices_deadline};
use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant};

pub const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_BINARY_BYTES: u64 = 512 * 1024 * 1024;
/// Rows sent for the whole-file view (the grid is virtual, the payload is not).
pub const MAX_ROWS: usize = 400_000;
/// Differing byte ranges listed for binaries (the count is complete).
pub const MAX_RANGES: usize = 1_000;
/// Bytes shown around the first difference of binaries.
pub const WINDOW: usize = 64;
/// Upper bound for the diff itself (pathological inputs).
const DEADLINE: Duration = Duration::from_secs(10);
const HEAD: usize = 8 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiffOptions {
    pub ignore_whitespace: bool,
    pub ignore_case: bool,
    /// Equal lines kept around a change; `None` = the whole file.
    pub context: Option<u32>,
    /// Compare bytes even if both look like text.
    pub binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideInfo {
    pub size: u64,
    /// `utf-8` …; `None` for binaries.
    pub encoding: Option<String>,
    /// Line ending found (`lf`, `crlf`, `cr`, `mixed`, `none`).
    pub eol: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowKind {
    Equal,
    Removed,
    Added,
    Changed,
    /// Equal lines left out (`skipped` = how many).
    Skip,
}

/// One row of the side-by-side view; `left`/`right` = (line number from 1, text).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    pub kind: RowKind,
    pub left: Option<(u32, String)>,
    pub right: Option<(u32, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteRange {
    pub offset: u64,
    pub len: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DiffResult {
    Text {
        left: SideInfo,
        right: SideInfo,
        rows: Vec<DiffRow>,
        /// Number of changed blocks (for "next/previous difference").
        changes: u32,
        /// The rows were cut at [`MAX_ROWS`].
        truncated: bool,
    },
    Binary {
        left: SideInfo,
        right: SideInfo,
        identical: bool,
        /// Differing ranges in the common length (first [`MAX_RANGES`]).
        ranges: Vec<ByteRange>,
        /// Differing bytes in the common length (all).
        differing_bytes: u64,
        /// Start of the bytes shown below.
        window_offset: u64,
        left_window: Vec<u8>,
        right_window: Vec<u8>,
    },
}

fn too_big(path: &Path, what: &str) -> FsError {
    FsError::new(
        FsErrorCode::TooMany,
        format!("The file is too large to compare {what}"),
        Some(path),
    )
}

fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>, FsError> {
    let f = crate::platform::open_regular_file(path).map_err(|e| FsError::from_io(&e, path))?;
    let mut bytes = Vec::new();
    f.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| FsError::from_io(&e, path))?;
    if bytes.len() as u64 > max {
        return Err(too_big(path, "as text"));
    }
    Ok(bytes)
}

fn size_of(path: &Path) -> Result<u64, FsError> {
    std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| FsError::from_io(&e, path))
}

fn head(path: &Path) -> Result<Vec<u8>, FsError> {
    let f = crate::platform::open_regular_file(path).map_err(|e| FsError::from_io(&e, path))?;
    let mut h = Vec::with_capacity(HEAD);
    f.take(HEAD as u64)
        .read_to_end(&mut h)
        .map_err(|e| FsError::from_io(&e, path))?;
    Ok(h)
}

/// Splits into lines; `\r\n`, `\r` and `\n` end a line. Returns the lines and the EOL style.
pub fn split_lines(text: &str) -> (Vec<&str>, &'static str) {
    let (mut lf, mut crlf, mut cr) = (0, 0, 0);
    let mut lines = Vec::new();
    let bytes = text.as_bytes();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\n' => {
                lines.push(&text[start..i]);
                lf += 1;
                start = i + 1;
            }
            b'\r' => {
                lines.push(&text[start..i]);
                if bytes.get(i + 1) == Some(&b'\n') {
                    crlf += 1;
                    i += 1;
                } else {
                    cr += 1;
                }
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    if start < bytes.len() {
        lines.push(&text[start..]);
    }
    let eol = match (lf > 0, crlf > 0, cr > 0) {
        (false, false, false) => "none",
        (true, false, false) => "lf",
        (false, true, false) => "crlf",
        (false, false, true) => "cr",
        _ => "mixed",
    };
    (lines, eol)
}

fn key(line: &str, o: &DiffOptions) -> String {
    let s: String = if o.ignore_whitespace {
        line.split_whitespace().collect::<Vec<_>>().join(" ")
    } else {
        line.to_string()
    };
    if o.ignore_case { s.to_lowercase() } else { s }
}

fn row(kind: RowKind, l: Option<(usize, &str)>, r: Option<(usize, &str)>) -> DiffRow {
    let side = |x: Option<(usize, &str)>| x.map(|(i, t)| ((i + 1) as u32, t.to_string()));
    DiffRow {
        kind,
        left: side(l),
        right: side(r),
        skipped: None,
    }
}

/// Side-by-side rows of two texts (pure – the heart of the text diff).
pub fn diff_lines(old: &[&str], new: &[&str], o: &DiffOptions) -> (Vec<DiffRow>, u32, bool) {
    let ok: Vec<String> = old.iter().map(|l| key(l, o)).collect();
    let nk: Vec<String> = new.iter().map(|l| key(l, o)).collect();
    // past the deadline Myers gives a correct but less minimal diff
    let ops =
        capture_diff_slices_deadline(Algorithm::Myers, &ok, &nk, Some(Instant::now() + DEADLINE));
    let mut rows = Vec::new();
    let mut changes = 0u32;
    let ctx = o.context.map(|c| c as usize);
    let n_ops = ops.len();
    for (i, op) in ops.iter().enumerate() {
        match *op {
            DiffOp::Equal {
                old_index,
                new_index,
                len,
            } => {
                let pairs = |a: usize, b: usize, rows: &mut Vec<DiffRow>| {
                    for k in a..b {
                        rows.push(row(
                            RowKind::Equal,
                            Some((old_index + k, old[old_index + k])),
                            Some((new_index + k, new[new_index + k])),
                        ));
                    }
                };
                match ctx {
                    None => pairs(0, len, &mut rows),
                    Some(c) => {
                        // context after the previous change and before the next one
                        let head = if i == 0 { 0 } else { c.min(len) };
                        let tail = if i + 1 == n_ops { 0 } else { c.min(len - head) };
                        pairs(0, head, &mut rows);
                        let skipped = len - head - tail;
                        if skipped > 0 {
                            rows.push(DiffRow {
                                kind: RowKind::Skip,
                                left: None,
                                right: None,
                                skipped: Some(skipped as u32),
                            });
                        }
                        pairs(len - tail, len, &mut rows);
                    }
                }
            }
            DiffOp::Delete {
                old_index, old_len, ..
            } => {
                changes += 1;
                for k in 0..old_len {
                    rows.push(row(
                        RowKind::Removed,
                        Some((old_index + k, old[old_index + k])),
                        None,
                    ));
                }
            }
            DiffOp::Insert {
                new_index, new_len, ..
            } => {
                changes += 1;
                for k in 0..new_len {
                    rows.push(row(
                        RowKind::Added,
                        None,
                        Some((new_index + k, new[new_index + k])),
                    ));
                }
            }
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => {
                changes += 1;
                for k in 0..old_len.max(new_len) {
                    let l = (k < old_len).then(|| (old_index + k, old[old_index + k]));
                    let r = (k < new_len).then(|| (new_index + k, new[new_index + k]));
                    let kind = match (l, r) {
                        (Some(_), Some(_)) => RowKind::Changed,
                        (Some(_), None) => RowKind::Removed,
                        _ => RowKind::Added,
                    };
                    rows.push(row(kind, l, r));
                }
            }
        }
        if rows.len() > MAX_ROWS {
            rows.truncate(MAX_ROWS);
            return (rows, changes, true);
        }
    }
    (rows, changes, false)
}

fn compare_text(left: &Path, right: &Path, o: &DiffOptions) -> Result<DiffResult, FsError> {
    let lb = read_bounded(left, MAX_TEXT_BYTES)?;
    let rb = read_bounded(right, MAX_TEXT_BYTES)?;
    let le = encoding::detect(&lb, false);
    let re = encoding::detect(&rb, false);
    let (lt, _) = encoding::decode(&lb, le, false);
    let (rt, _) = encoding::decode(&rb, re, false);
    let (ll, leol) = split_lines(&lt);
    let (rl, reol) = split_lines(&rt);
    let (rows, changes, truncated) = diff_lines(&ll, &rl, o);
    let side = |size: usize, enc: encoding::Encoding, eol: &str| SideInfo {
        size: size as u64,
        encoding: Some(enc.id().to_string()),
        eol: Some(eol.to_string()),
    };
    Ok(DiffResult::Text {
        left: side(lb.len(), le, leol),
        right: side(rb.len(), re, reol),
        rows,
        changes,
        truncated,
    })
}

/// Byte-wise comparison (pure over two readers).
pub fn compare_bytes(
    a: &mut dyn Read,
    b: &mut dyn Read,
) -> std::io::Result<(u64, Vec<ByteRange>, Option<u64>)> {
    const CHUNK: usize = 1024 * 1024;
    let mut ba = vec![0u8; CHUNK];
    let mut bb = vec![0u8; CHUNK];
    let mut offset = 0u64;
    let mut differing = 0u64;
    let mut ranges: Vec<ByteRange> = Vec::new();
    let mut first = None;
    let mut open: Option<ByteRange> = None;
    loop {
        let na = read_full(a, &mut ba)?;
        let nb = read_full(b, &mut bb)?;
        let n = na.min(nb);
        for i in 0..n {
            let at = offset + i as u64;
            if ba[i] != bb[i] {
                differing += 1;
                first.get_or_insert(at);
                match &mut open {
                    Some(r) if r.offset + r.len == at => r.len += 1,
                    _ => {
                        if let Some(r) = open.take()
                            && ranges.len() < MAX_RANGES
                        {
                            ranges.push(r);
                        }
                        open = Some(ByteRange { offset: at, len: 1 });
                    }
                }
            }
        }
        offset += n as u64;
        if n < CHUNK {
            break;
        }
    }
    if let Some(r) = open
        && ranges.len() < MAX_RANGES
    {
        ranges.push(r);
    }
    Ok((differing, ranges, first))
}

fn read_full(r: &mut dyn Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match r.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(n)
}

fn window(path: &Path, offset: u64) -> Result<Vec<u8>, FsError> {
    use std::io::{Seek, SeekFrom};
    let mut f = crate::platform::open_regular_file(path).map_err(|e| FsError::from_io(&e, path))?;
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| FsError::from_io(&e, path))?;
    let mut out = Vec::with_capacity(WINDOW * 2);
    f.take((WINDOW * 2) as u64)
        .read_to_end(&mut out)
        .map_err(|e| FsError::from_io(&e, path))?;
    Ok(out)
}

fn compare_binary(left: &Path, right: &Path) -> Result<DiffResult, FsError> {
    let (ls, rs) = (size_of(left)?, size_of(right)?);
    if ls > MAX_BINARY_BYTES {
        return Err(too_big(left, "byte by byte"));
    }
    if rs > MAX_BINARY_BYTES {
        return Err(too_big(right, "byte by byte"));
    }
    let mut a = crate::platform::open_regular_file(left).map_err(|e| FsError::from_io(&e, left))?;
    let mut b =
        crate::platform::open_regular_file(right).map_err(|e| FsError::from_io(&e, right))?;
    let (differing, ranges, first) =
        compare_bytes(&mut a, &mut b).map_err(|e| FsError::from_io(&e, left))?;
    let first = first.or_else(|| (ls != rs).then(|| ls.min(rs)));
    let window_offset = first
        .map(|f| f.saturating_sub(WINDOW as u64 / 2))
        .unwrap_or(0);
    let side = |size| SideInfo {
        size,
        encoding: None,
        eol: None,
    };
    Ok(DiffResult::Binary {
        left: side(ls),
        right: side(rs),
        identical: first.is_none(),
        ranges,
        differing_bytes: differing,
        window_offset,
        left_window: window(left, window_offset)?,
        right_window: window(right, window_offset)?,
    })
}

/// Compares two local files (paths validated by the caller).
pub fn diff_files(left: &Path, right: &Path, o: &DiffOptions) -> Result<DiffResult, FsError> {
    if left == right {
        return Err(FsError::new(
            FsErrorCode::SameSourceTarget,
            "A file is compared with itself",
            Some(left),
        ));
    }
    let binary =
        o.binary || detect::looks_binary(&head(left)?) || detect::looks_binary(&head(right)?);
    if binary {
        compare_binary(left, right)
    } else {
        compare_text(left, right, o)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn kinds(rows: &[DiffRow]) -> Vec<RowKind> {
        rows.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn line_endings_split_and_reported() {
        assert_eq!(split_lines("a\nb\n"), (vec!["a", "b"], "lf"));
        assert_eq!(split_lines("a\r\nb"), (vec!["a", "b"], "crlf"));
        assert_eq!(split_lines("a\rb\nc"), (vec!["a", "b", "c"], "mixed"));
        assert_eq!(split_lines(""), (vec![], "none"));
        assert_eq!(split_lines("\n\n"), (vec!["", ""], "lf"));
    }

    #[test]
    fn inserted_removed_and_changed_lines_side_by_side() {
        let old = ["eins", "zwei", "drei", "vier"];
        let new = ["eins", "zwei ä", "drei", "neu 😀", "vier"];
        let (rows, changes, truncated) = diff_lines(&old, &new, &DiffOptions::default());
        assert!(!truncated);
        assert_eq!(changes, 2);
        assert_eq!(
            kinds(&rows),
            vec![
                RowKind::Equal,
                RowKind::Changed,
                RowKind::Equal,
                RowKind::Added,
                RowKind::Equal
            ]
        );
        assert_eq!(rows[1].left, Some((2, "zwei".into())));
        assert_eq!(rows[1].right, Some((2, "zwei ä".into())));
        assert_eq!(rows[3].left, None);
        assert_eq!(rows[3].right, Some((4, "neu 😀".into())));
        let (rows, _, _) = diff_lines(&new, &old, &DiffOptions::default());
        assert_eq!(rows[3].kind, RowKind::Removed);
    }

    #[test]
    fn context_leaves_out_equal_lines() {
        let old: Vec<String> = (1..=20).map(|i| format!("l{i}")).collect();
        let mut new = old.clone();
        new[9] = "x".into();
        let o: Vec<&str> = old.iter().map(String::as_str).collect();
        let n: Vec<&str> = new.iter().map(String::as_str).collect();
        let opts = DiffOptions {
            context: Some(2),
            ..DiffOptions::default()
        };
        let (rows, changes, _) = diff_lines(&o, &n, &opts);
        assert_eq!(changes, 1);
        assert_eq!(
            kinds(&rows),
            vec![
                RowKind::Skip,
                RowKind::Equal,
                RowKind::Equal,
                RowKind::Changed,
                RowKind::Equal,
                RowKind::Equal,
                RowKind::Skip
            ]
        );
        assert_eq!(rows[0].skipped, Some(7));
        assert_eq!(rows[6].skipped, Some(8));
        assert_eq!(rows[1].left, Some((8, "l8".into())));
        // identical: everything equal, nothing left out in the whole-file view
        let (rows, changes, _) = diff_lines(&o, &o, &DiffOptions::default());
        assert_eq!((rows.len(), changes), (20, 0));
    }

    #[test]
    fn whitespace_and_case_can_be_ignored() {
        let old = ["  a  b", "Hallo"];
        let new = ["a b", "hallo"];
        let (_, changes, _) = diff_lines(&old, &new, &DiffOptions::default());
        assert_eq!(changes, 1);
        let o = DiffOptions {
            ignore_whitespace: true,
            ignore_case: true,
            ..DiffOptions::default()
        };
        let (rows, changes, _) = diff_lines(&old, &new, &o);
        assert_eq!(changes, 0);
        // the original texts are shown
        assert_eq!(rows[0].left, Some((1, "  a  b".into())));
    }

    #[test]
    fn files_in_different_encodings_and_line_endings() {
        let d = tempdir().unwrap();
        let a = d.path().join("ä utf8.txt");
        let b = d.path().join("latin1.txt");
        fs::write(&a, "Grüße\nzwei\n").unwrap();
        fs::write(&b, b"Gr\xfc\xdfe\r\nzwei\r\n").unwrap();
        let r = diff_files(&a, &b, &DiffOptions::default()).unwrap();
        let DiffResult::Text {
            left,
            right,
            changes,
            ..
        } = r
        else {
            panic!("text expected");
        };
        assert_eq!(changes, 0);
        assert_eq!(left.encoding.as_deref(), Some("utf-8"));
        assert_eq!(right.eol.as_deref(), Some("crlf"));
        assert_ne!(right.encoding.as_deref(), Some("utf-8"));
    }

    #[test]
    fn binaries_report_ranges_and_a_window() {
        let d = tempdir().unwrap();
        let a = d.path().join("a.bin");
        let b = d.path().join("b.bin");
        let mut x = vec![0u8; 3 * 1024 * 1024];
        x[5] = 1;
        let mut y = x.clone();
        y[5] = 2;
        y[2 * 1024 * 1024] = 9;
        y[2 * 1024 * 1024 + 1] = 9;
        fs::write(&a, &x).unwrap();
        fs::write(&b, &y).unwrap();
        let r = diff_files(&a, &b, &DiffOptions::default()).unwrap();
        let DiffResult::Binary {
            identical,
            ranges,
            differing_bytes,
            window_offset,
            left_window,
            right_window,
            ..
        } = r
        else {
            panic!("binary expected");
        };
        assert!(!identical);
        assert_eq!(differing_bytes, 3);
        assert_eq!(
            ranges,
            vec![
                ByteRange { offset: 5, len: 1 },
                ByteRange {
                    offset: 2 * 1024 * 1024,
                    len: 2
                }
            ]
        );
        assert_eq!(window_offset, 0);
        assert_eq!((left_window[5], right_window[5]), (1, 2));

        fs::write(&b, &x).unwrap();
        let DiffResult::Binary { identical, .. } =
            diff_files(&a, &b, &DiffOptions::default()).unwrap()
        else {
            panic!()
        };
        assert!(identical);
        // only the length differs
        fs::write(&b, &x[..100]).unwrap();
        let DiffResult::Binary {
            identical,
            window_offset,
            ..
        } = diff_files(&a, &b, &DiffOptions::default()).unwrap()
        else {
            panic!()
        };
        assert!(!identical);
        assert_eq!(window_offset, 100 - WINDOW as u64 / 2);
    }

    #[test]
    fn limits_and_refusals() {
        let d = tempdir().unwrap();
        let a = d.path().join("a.txt");
        fs::write(&a, "x").unwrap();
        assert_eq!(
            diff_files(&a, &a, &DiffOptions::default())
                .unwrap_err()
                .code,
            FsErrorCode::SameSourceTarget
        );
        assert!(diff_files(&a, d.path(), &DiffOptions::default()).is_err());
        let big = d.path().join("big.txt");
        fs::File::create(&big)
            .unwrap()
            .set_len(MAX_TEXT_BYTES + 1)
            .unwrap();
        // a sparse file of zeros looks binary; as text it is too large
        let o = DiffOptions::default();
        let text = compare_text(&a, &big, &o).unwrap_err();
        assert_eq!(text.code, FsErrorCode::TooMany);
    }
}
