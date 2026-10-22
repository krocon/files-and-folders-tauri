//! Comic book archives in the duplicate search (design 042 E7).
//!
//! Fingerprint = number of pages + pHash of the first four pages (title first). Fixed
//! positions from the start (not 25 %/50 %/75 %): a comic with one page more at the end
//! samples the same pages; one more page at the front is a different comic for us. The archive is read through the archive code of design 025
//! (`archive::index_of`: limits, fail-closed), the few sampled pages are extracted with
//! `extract::run` (zip slip, bombs, links never created) into a private scratch folder,
//! fingerprinted and removed at once.

use super::images::{self, ImageFp};
use super::phash;
use crate::archive::{self, EntryType, view};
use crate::error::{FsError, FsErrorCode};
use crate::jobs::{ConflictDefault, Control, CopyOptions, JobState};
use std::cmp::Ordering;
use std::path::Path;

pub const COMIC_EXT: &[&str] = &["cbz", "cbr", "cb7", "cbt"];

/// Pages sampled for the fingerprint (title + 3).
pub const SAMPLES: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComicFp {
    pub pages: u32,
    /// Size of the title page.
    pub width: u32,
    pub height: u32,
    /// pHash of the sampled pages, in page order (title first).
    pub hashes: Vec<u64>,
}

pub fn is_comic_name(name: &str) -> bool {
    images::extension(name).is_some_and(|e| COMIC_EXT.contains(&e.as_str()))
        && archive::comic_format(name).is_some()
}

/// Natural order: digit runs compare by value (`page2` < `page10`), the rest without case.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let mut n = String::new();
                while let Some(c) = x.peek().copied().filter(char::is_ascii_digit) {
                    n.push(c);
                    x.next();
                }
                let mut m = String::new();
                while let Some(d) = y.peek().copied().filter(char::is_ascii_digit) {
                    m.push(d);
                    y.next();
                }
                let (n, m) = (n.trim_start_matches('0'), m.trim_start_matches('0'));
                let o = n.len().cmp(&m.len()).then_with(|| n.cmp(m));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(c), Some(d)) => {
                let o = c.to_lowercase().cmp(d.to_lowercase());
                if o != Ordering::Equal {
                    return o;
                }
                x.next();
                y.next();
            }
        }
    }
}

/// The page entries of an archive index (image files, no hidden or `__MACOSX` parts),
/// in natural order.
pub fn pages(index: &archive::ArchiveIndex) -> Vec<&archive::IndexEntry> {
    let mut pages: Vec<&archive::IndexEntry> = index
        .entries
        .iter()
        .filter(|e| e.kind == EntryType::File)
        .filter(|e| {
            !e.name
                .iter()
                .any(|part| part.starts_with('.') || part == "__MACOSX")
        })
        .filter(|e| e.name.last().is_some_and(|n| images::is_image_name(n)))
        .collect();
    pages.sort_by(|a, b| natural_cmp(&a.name.join("/"), &b.name.join("/")));
    pages
}

/// Indices of the sampled pages among `n` pages: the first [`SAMPLES`].
pub fn samples(n: usize) -> Vec<usize> {
    (0..n.min(SAMPLES)).collect()
}

/// Reads the fingerprint of the comic at `path`.
pub fn fingerprint(path: &Path, control: &Control) -> Result<ComicFp, FsError> {
    let index = archive::index_of(path)?;
    let pages = pages(&index);
    if pages.is_empty() {
        return Err(archive::archive_error(
            "No pages (images) in the comic",
            path,
        ));
    }
    let mut first: Option<ImageFp> = None;
    let mut hashes = Vec::with_capacity(SAMPLES);
    for i in samples(pages.len()) {
        if control.is_cancelled() {
            return Err(FsError::new(FsErrorCode::Io, "cancelled", Some(path)));
        }
        let fp = page_fingerprint(path, pages[i], control)?;
        hashes.push(fp.hash);
        first.get_or_insert(fp);
    }
    let first = first.expect("at least one page");
    Ok(ComicFp {
        pages: u32::try_from(pages.len()).unwrap_or(u32::MAX),
        width: first.width,
        height: first.height,
        hashes,
    })
}

/// Extracts one page into a scratch folder (all checks of `extract::run`) and
/// returns the extracted file's folder – the caller removes it.
pub(crate) fn extract_page(
    path: &Path,
    entry: &archive::IndexEntry,
    control: &Control,
) -> Result<(std::path::PathBuf, std::path::PathBuf), FsError> {
    if entry.size > images::MAX_BYTES {
        return Err(FsError::new(
            FsErrorCode::UnsupportedImage,
            format!("A page is too large (over {} MiB)", images::MAX_BYTES >> 20),
            Some(path),
        ));
    }
    let dir = view::scratch_dir()?;
    let virtual_path = archive::virtual_path(path, &entry.name);
    let options = CopyOptions {
        conflict_default: ConflictDefault::Overwrite,
        rename_to: None,
    };
    let (state, summary) = crate::jobs::extract::run(
        "duplicates-comic",
        path,
        &[virtual_path.to_string_lossy().into_owned()],
        &dir,
        false,
        &options,
        control,
        &|_| {},
    );
    let file = dir.join(entry.name.last().expect("a page has a name"));
    if state == JobState::Done && file.is_file() {
        return Ok((dir, file));
    }
    let _ = view::remove_tree(&dir);
    Err(summary
        .error
        .or_else(|| summary.errors.into_iter().next().map(|e| e.error))
        .unwrap_or_else(|| archive::archive_error("A page could not be read", path)))
}

fn page_fingerprint(
    path: &Path,
    entry: &archive::IndexEntry,
    control: &Control,
) -> Result<ImageFp, FsError> {
    let (dir, file) = extract_page(path, entry, control)?;
    let fp = images::fingerprint(&file).map_err(|mut e| {
        // the message names the comic, not the scratch copy
        e.path = Some(path.to_string_lossy().into_owned());
        e
    });
    let _ = view::remove_tree(&dir);
    fp
}

/// Distance of two comics: `None` if the page counts differ by more than one (an extra
/// page at the end) or the title pages have other shapes; else the largest distance of
/// the sampled pages.
pub fn distance(a: &ComicFp, b: &ComicFp) -> Option<u32> {
    if a.pages.abs_diff(b.pages) > 1
        || phash::aspect_differs((a.width, a.height), (b.width, b.height))
    {
        return None;
    }
    let n = a.hashes.len().min(b.hashes.len());
    (n > 0).then(|| {
        (0..n)
            .map(|i| phash::hamming(a.hashes[i], b.hashes[i]))
            .max()
            .unwrap_or(0)
    })
}

#[cfg(test)]
mod tests {
    use super::super::images::testimg::{jpeg, photo};
    use super::*;
    use std::fs;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn cbz(path: &Path, pages: &[(String, Vec<u8>)], method: zip::CompressionMethod) {
        let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let o = SimpleFileOptions::default().compression_method(method);
        for (name, data) in pages {
            w.start_file(name.as_str(), o).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
    }

    fn book(n: u32, variant: u32) -> Vec<(String, Vec<u8>)> {
        (1..=n)
            .map(|i| {
                (
                    format!("Heft ä/page{i}.jpg"),
                    jpeg(&photo(300, 450, variant * 100 + i), 85),
                )
            })
            .collect()
    }

    #[test]
    fn natural_order_and_samples() {
        let mut v = vec!["p10.jpg", "p2.jpg", "P1.jpg", "p02a.jpg"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, ["P1.jpg", "p2.jpg", "p02a.jpg", "p10.jpg"]);
        assert_eq!(samples(0), Vec::<usize>::new());
        assert_eq!(samples(1), vec![0]);
        assert_eq!(samples(3), vec![0, 1, 2]);
        assert_eq!(samples(40), vec![0, 1, 2, 3]);
        assert!(
            is_comic_name("Asterix 01.CBZ") && !is_comic_name("a.zip") && !is_comic_name(".cbz")
        );
    }

    #[test]
    fn repacked_comic_is_the_same_other_is_not() {
        let d = tempfile::tempdir().unwrap();
        let pages = book(9, 1);
        let a = d.path().join("Heft 1.cbz");
        cbz(&a, &pages, zip::CompressionMethod::Deflated);
        // repacked: stored, pages in another order, plus a hidden file and __MACOSX
        let mut shuffled = pages.clone();
        shuffled.reverse();
        shuffled.push(("__MACOSX/._page1.jpg".into(), b"junk".to_vec()));
        shuffled.push(("Heft ä/.thumb.jpg".into(), b"junk".to_vec()));
        let b = d.path().join("Heft 1 (neu gepackt).cbz");
        cbz(&b, &shuffled, zip::CompressionMethod::Stored);
        assert_ne!(fs::read(&a).unwrap(), fs::read(&b).unwrap());
        let control = Control::default();
        let fa = fingerprint(&a, &control).unwrap();
        let fb = fingerprint(&b, &control).unwrap();
        assert_eq!(fa.pages, 9);
        assert_eq!(fa.hashes.len(), 4);
        assert_eq!(distance(&fa, &fb), Some(0));
        // one page more at the end: still similar
        let mut more = pages.clone();
        more.push(("Heft ä/page10.jpg".into(), jpeg(&photo(300, 450, 999), 85)));
        let c = d.path().join("Heft 1 + Bonus.cbz");
        cbz(&c, &more, zip::CompressionMethod::Deflated);
        let fc = fingerprint(&c, &control).unwrap();
        assert!(distance(&fa, &fc).unwrap() <= 6, "{:?}", distance(&fa, &fc));
        // another comic with the same page count
        let o = d.path().join("Heft 2.cbz");
        cbz(&o, &book(9, 2), zip::CompressionMethod::Deflated);
        let fo = fingerprint(&o, &control).unwrap();
        assert!(distance(&fa, &fo).unwrap() > 12);
        // far other page count
        let short = d.path().join("kurz.cbz");
        cbz(&short, &book(5, 1), zip::CompressionMethod::Deflated);
        assert_eq!(distance(&fa, &fingerprint(&short, &control).unwrap()), None);
    }

    #[test]
    fn hostile_comics_are_errors() {
        let d = tempfile::tempdir().unwrap();
        let control = Control::default();
        // zip slip: the entry is not in the index (unsafe name) → no pages
        let slip = d.path().join("slip.cbz");
        cbz(
            &slip,
            &[("../../evil.jpg".into(), jpeg(&photo(10, 10, 1), 80))],
            zip::CompressionMethod::Stored,
        );
        assert!(fingerprint(&slip, &control).is_err());
        assert!(!d.path().join("evil.jpg").exists());
        // no images
        let text = d.path().join("text.cbz");
        cbz(
            &text,
            &[("read me.txt".into(), b"hi".to_vec())],
            zip::CompressionMethod::Stored,
        );
        assert!(
            fingerprint(&text, &control)
                .unwrap_err()
                .message
                .contains("No pages")
        );
        // not an archive at all
        let junk = d.path().join("junk.cbz");
        fs::write(&junk, b"not a zip").unwrap();
        assert!(fingerprint(&junk, &control).is_err());
        // a broken page: an error for this comic
        let broken = d.path().join("broken.cbz");
        cbz(
            &broken,
            &[("p1.jpg".into(), b"\xff\xd8 broken".to_vec())],
            zip::CompressionMethod::Stored,
        );
        assert_eq!(
            fingerprint(&broken, &control).unwrap_err().code,
            FsErrorCode::UnsupportedImage
        );
    }
}
