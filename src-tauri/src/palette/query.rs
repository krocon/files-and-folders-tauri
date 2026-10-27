//! The small query language of the palette (design 043 E3) – pure, shared with the
//! frontend through the case catalog `src/app/features/palette/palette-query.cases.json`.
//!
//! - words: every one must be in the name or in a folder name of the path
//!   (`invoice 2025`); case and accents do not matter (like the type-ahead);
//!   `"two words"` is one word, `-word` must not appear
//! - `>` at the start: only actions (the frontend handles it);
//!   `/`, `~`, `C:\`, `\\server` at the start: a path (completion in that folder)
//! - filters: `ext:pdf,docx`, `in:Projects` (a folder of the path; absolute: below
//!   that folder), `size>10m`, `size<1g`, `modified:2025`, `modified:2025-03`,
//!   `modified:2025-03-14`, `modified>2025-01` (after January), `modified<2025` (before 2025),
//!   `modified:today`,
//!   `modified:7d` / `2w`, `is:file`, `is:dir`
//!
//! Unknown `key:value` words are plain words. Limits keep a query cheap: at most
//! [`MAX_TERMS`] words, [`MAX_NOT`] exclusions, [`MAX_IN`] `in:` filters.

use icu_normalizer::DecomposingNormalizerBorrowed;
use serde::Serialize;

pub const MAX_QUERY_LEN: usize = 512;
pub const MAX_TERMS: usize = 12;
pub const MAX_NOT: usize = 6;
pub const MAX_IN: usize = 6;
pub const MAX_EXT: usize = 16;

const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Files and folders by name.
    Files,
    /// `>`: only actions (no file search).
    Actions,
    /// A typed path: entries of that folder (completion).
    Path,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KindFilter {
    File,
    Dir,
}

/// A parsed query. Words are folded ([`fold`]); `path` is the typed path (path mode).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub mode: Mode,
    pub terms: Vec<String>,
    pub not: Vec<String>,
    pub ext: Vec<String>,
    /// `in:` words (a folder name of the path contains them).
    pub in_dirs: Vec<String>,
    /// `in:` with an absolute path: below that folder (as typed, not folded).
    pub in_paths: Vec<String>,
    pub size_min: Option<u64>,
    pub size_max: Option<u64>,
    /// Milliseconds since the epoch, `from` inclusive, `to` exclusive.
    pub modified_from: Option<i64>,
    pub modified_to: Option<i64>,
    pub kind: Option<KindFilter>,
    /// Path mode: the typed text (trimmed).
    pub path: Option<String>,
    /// Words or filters left out because of the limits.
    pub dropped: u32,
    /// The words as typed (not folded) – for the system search, which folds itself.
    #[serde(skip)]
    pub raw_terms: Vec<String>,
}

impl Query {
    fn new(mode: Mode) -> Self {
        Self {
            mode,
            terms: Vec::new(),
            not: Vec::new(),
            ext: Vec::new(),
            in_dirs: Vec::new(),
            in_paths: Vec::new(),
            size_min: None,
            size_max: None,
            modified_from: None,
            modified_to: None,
            kind: None,
            path: None,
            dropped: 0,
            raw_terms: Vec::new(),
        }
    }

    /// Something to search files for: a word or a filter.
    pub fn searches_files(&self) -> bool {
        self.mode == Mode::Files
            && (!self.terms.is_empty()
                || !self.ext.is_empty()
                || !self.in_dirs.is_empty()
                || !self.in_paths.is_empty()
                || self.size_min.is_some()
                || self.size_max.is_some()
                || self.modified_from.is_some()
                || self.modified_to.is_some())
    }

    /// Bits of all words (bit `i` = `terms[i]`).
    pub fn all_terms(&self) -> u32 {
        bits(self.terms.len(), 0)
    }

    pub fn all_in(&self) -> u32 {
        bits(self.in_dirs.len(), MAX_TERMS)
    }

    pub fn all_not(&self) -> u32 {
        bits(self.not.len(), MAX_TERMS + MAX_IN)
    }

    /// Size, date, kind and extension filters for one entry (`size` only for files).
    pub fn filters_pass(
        &self,
        name_folded: &str,
        is_dir: bool,
        size: Option<u64>,
        modified_ms: Option<i64>,
    ) -> bool {
        match self.kind {
            Some(KindFilter::File) if is_dir => return false,
            Some(KindFilter::Dir) if !is_dir => return false,
            _ => {}
        }
        if !self.ext.is_empty() {
            if is_dir {
                return false;
            }
            let Some(ext) = extension(name_folded) else {
                return false;
            };
            if !self.ext.iter().any(|e| e == ext) {
                return false;
            }
        }
        if self.size_min.is_some() || self.size_max.is_some() {
            let Some(s) = size.filter(|_| !is_dir) else {
                return false;
            };
            if self.size_min.is_some_and(|m| s <= m) || self.size_max.is_some_and(|m| s >= m) {
                return false;
            }
        }
        if self.modified_from.is_some() || self.modified_to.is_some() {
            let Some(m) = modified_ms else {
                return false;
            };
            if self.modified_from.is_some_and(|f| m < f) || self.modified_to.is_some_and(|t| m >= t)
            {
                return false;
            }
        }
        true
    }
}

fn bits(n: usize, shift: usize) -> u32 {
    if n == 0 {
        0
    } else {
        ((1u32 << n) - 1) << shift
    }
}

/// The extension of a folded name (`a.tar.gz` → `gz`), none for `.hidden` and `name.`.
pub fn extension(name: &str) -> Option<&str> {
    let dot = name.rfind('.')?;
    (dot > 0 && dot + 1 < name.len()).then(|| &name[dot + 1..])
}

/// Lower case without accents (NFD, combining marks removed) – like the type-ahead of the
/// file list (`normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()`).
pub fn fold(s: &str) -> String {
    if s.is_ascii() {
        return s.to_ascii_lowercase();
    }
    let nfd = DecomposingNormalizerBorrowed::new_nfd().normalize(s);
    nfd.chars()
        .filter(|c| !is_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

/// [`fold`] with, for every byte of the result, the UTF-16 range of the original
/// character it came from (highlighting in the frontend).
pub fn fold_with_map(s: &str) -> (String, Vec<(u32, u32)>) {
    let mut out = String::with_capacity(s.len());
    let mut map = Vec::with_capacity(s.len());
    let norm = DecomposingNormalizerBorrowed::new_nfd();
    let mut at16 = 0u32;
    let mut buf = [0u8; 4];
    for c in s.chars() {
        let end16 = at16 + c.len_utf16() as u32;
        let folded: String = if c.is_ascii() {
            c.to_ascii_lowercase().to_string()
        } else {
            norm.normalize(c.encode_utf8(&mut buf))
                .chars()
                .filter(|c| !is_mark(*c))
                .flat_map(char::to_lowercase)
                .collect()
        };
        if folded.is_empty() {
            // a combining mark of its own (NFD): it belongs to the character before
            if let Some(&(start, _)) = map.last() {
                for r in map.iter_mut().rev().take_while(|r| r.0 == start) {
                    r.1 = end16;
                }
            }
        }
        for _ in 0..folded.len() {
            map.push((at16, end16));
        }
        out.push_str(&folded);
        at16 = end16;
    }
    (out, map)
}

/// Combining marks (General Category M) – the same set as JavaScript's `\p{M}`.
fn is_mark(c: char) -> bool {
    use icu_properties::CodePointMapData;
    use icu_properties::props::{GeneralCategory, GeneralCategoryGroup};
    !c.is_ascii()
        && GeneralCategoryGroup::Mark.contains(CodePointMapData::<GeneralCategory>::new().get(c))
}

/// Parses the text typed into the palette. `now_ms` and `tz_offset_min` (local time =
/// UTC + offset) resolve dates.
pub fn parse(text: &str, now_ms: i64, tz_offset_min: i32) -> Query {
    let mut text = text.trim();
    // at most MAX_QUERY_LEN characters (as the frontend counts them)
    if let Some((cut, _)) = text.char_indices().nth(MAX_QUERY_LEN) {
        text = &text[..cut];
    }
    if text.starts_with('>') {
        return Query::new(Mode::Actions);
    }
    if is_path_like(text) {
        let mut q = Query::new(Mode::Path);
        q.path = Some(text.to_string());
        return q;
    }
    let mut q = Query::new(Mode::Files);
    for word in words(text) {
        apply_word(&mut q, &word, now_ms, tz_offset_min);
    }
    q
}

/// `/x`, `~`, `~/x`, `C:\x`, `C:/x`, `\\server\x`.
pub fn is_path_like(text: &str) -> bool {
    let b = text.as_bytes();
    text.starts_with('/')
        || text == "~"
        || text.starts_with("~/")
        || text.starts_with("~\\")
        || text.starts_with("\\\\")
        || (b.len() >= 3
            && b[0].is_ascii_alphabetic()
            && b[1] == b':'
            && (b[2] == b'\\' || b[2] == b'/'))
}

/// Words separated by white space; `"…"` keeps white space (an open quote runs to the end).
fn words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in text.chars() {
        if c == '"' {
            quoted = !quoted;
            continue;
        }
        if c.is_whitespace() && !quoted {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn push_limited(list: &mut Vec<String>, value: String, max: usize, dropped: &mut u32) {
    if value.is_empty() || list.contains(&value) {
        return;
    }
    if list.len() >= max {
        *dropped += 1;
    } else {
        list.push(value);
    }
}

/// A word with a separator becomes several words (`docs/2025` → `docs`, `2025`).
fn push_terms(q: &mut Query, word: &str, negate: bool) {
    for part in word.split(['/', '\\']) {
        let f = fold(part);
        if negate {
            push_limited(&mut q.not, f, MAX_NOT, &mut q.dropped);
        } else {
            let before = q.terms.len();
            push_limited(&mut q.terms, f, MAX_TERMS, &mut q.dropped);
            if q.terms.len() > before {
                q.raw_terms.push(part.to_string());
            }
        }
    }
}

fn apply_word(q: &mut Query, word: &str, now_ms: i64, tz: i32) {
    let lower = word.to_ascii_lowercase();
    // key and operator: `ext:pdf`, `size>10m`, `modified<2025`
    if let Some((key, op, value)) = split_filter(&lower, word)
        && apply_filter(q, key, op, value, now_ms, tz)
    {
        return;
    }
    if let Some(rest) = word.strip_prefix('-')
        && !rest.is_empty()
    {
        push_terms(q, rest, true);
        return;
    }
    push_terms(q, word, false);
}

/// `key`, operator (`:`, `>`, `<`, `:>`, `:<`) and the value (original case).
fn split_filter<'a>(lower: &'a str, word: &'a str) -> Option<(&'a str, char, &'a str)> {
    let at = lower.find([':', '>', '<'])?;
    let key = &lower[..at];
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    let mut op = lower.as_bytes()[at] as char;
    let mut rest = at + 1;
    if op == ':' && matches!(lower.as_bytes().get(rest), Some(b'>' | b'<')) {
        op = lower.as_bytes()[rest] as char;
        rest += 1;
    }
    Some((key, op, &word[rest..]))
}

fn apply_filter(q: &mut Query, key: &str, op: char, value: &str, now_ms: i64, tz: i32) -> bool {
    if value.is_empty() {
        return false;
    }
    match (key, op) {
        ("ext", ':') => {
            for e in value.split(',') {
                let e = fold(e.trim().trim_start_matches('.'));
                push_limited(&mut q.ext, e, MAX_EXT, &mut q.dropped);
            }
            true
        }
        ("in", ':') => {
            if is_path_like(value) {
                push_limited(&mut q.in_paths, value.to_string(), MAX_IN, &mut q.dropped);
            } else {
                for part in value.split(['/', '\\']) {
                    push_limited(&mut q.in_dirs, fold(part), MAX_IN, &mut q.dropped);
                }
            }
            true
        }
        ("size", '>' | '<') => {
            let Some(n) = parse_size(value) else {
                return false;
            };
            if op == '>' {
                q.size_min = Some(n);
            } else {
                q.size_max = Some(n);
            }
            true
        }
        ("modified" | "mod" | "date", ':' | '>' | '<') => {
            let Some((from, to, relative)) = parse_period(&value.to_ascii_lowercase(), now_ms, tz)
            else {
                return false;
            };
            // `>X`: after the period X, `<X`: before it; a period up to now (`7d`, `today`):
            // `>` = newer than its start, `<` = older than its start
            match op {
                '>' if relative => q.modified_from = Some(from),
                '>' => q.modified_from = Some(to),
                '<' => q.modified_to = Some(from),
                _ => {
                    q.modified_from = Some(from);
                    q.modified_to = Some(to);
                }
            }
            true
        }
        ("is" | "type", ':') => match value.to_ascii_lowercase().as_str() {
            "file" | "files" | "datei" => {
                q.kind = Some(KindFilter::File);
                true
            }
            "dir" | "dirs" | "folder" | "folders" | "ordner" => {
                q.kind = Some(KindFilter::Dir);
                true
            }
            _ => false,
        },
        _ => false,
    }
}

/// `10m`, `1.5g`, `500k`, `20mb`, `1024` (bytes), binary units.
pub fn parse_size(v: &str) -> Option<u64> {
    let v = v.trim().to_ascii_lowercase();
    let v = v.strip_suffix('b').unwrap_or(&v);
    let (num, mul) = match v.as_bytes().last()? {
        b'k' => (&v[..v.len() - 1], 1u64 << 10),
        b'm' => (&v[..v.len() - 1], 1 << 20),
        b'g' => (&v[..v.len() - 1], 1 << 30),
        b't' => (&v[..v.len() - 1], 1 << 40),
        _ => (v, 1),
    };
    if num.is_empty() || !num.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return None;
    }
    let n: f64 = num.parse().ok()?;
    let bytes = n * mul as f64;
    (bytes.is_finite() && bytes >= 0.0 && bytes < u64::MAX as f64).then_some(bytes as u64)
}

/// `2025`, `2025-03`, `2025-03-14`, `today`, `yesterday`, `7d`, `2w` → [from, to) in ms and
/// whether the period is relative to now.
fn parse_period(v: &str, now_ms: i64, tz: i32) -> Option<(i64, i64, bool)> {
    let (from, to) = absolute_or_relative(v, now_ms, tz)?;
    // absolute periods end in a digit (`2025-03`), relative ones in a letter (`7d`, `today`)
    let relative = !v.ends_with(|c: char| c.is_ascii_digit());
    Some((from, to, relative))
}

fn absolute_or_relative(v: &str, now_ms: i64, tz: i32) -> Option<(i64, i64)> {
    let offset = i64::from(tz) * 60_000;
    let local_day = (now_ms + offset).div_euclid(DAY_MS);
    let start_of = |day: i64| day * DAY_MS - offset;
    match v {
        "today" | "heute" => return Some((start_of(local_day), start_of(local_day + 1))),
        "yesterday" | "gestern" => return Some((start_of(local_day - 1), start_of(local_day))),
        _ => {}
    }
    if let Some(n) = v.strip_suffix('d').or_else(|| v.strip_suffix('t')) {
        let n: i64 = n.parse().ok().filter(|n| (1..=36_500).contains(n))?;
        return Some((start_of(local_day + 1 - n), start_of(local_day + 1)));
    }
    if let Some(n) = v.strip_suffix('w') {
        let n: i64 = n.parse().ok().filter(|n| (1..=5_200).contains(n))?;
        return Some((start_of(local_day + 1 - 7 * n), start_of(local_day + 1)));
    }
    let parts: Vec<&str> = v.split('-').collect();
    let num = |s: &str, len: usize| -> Option<i64> {
        (s.len() == len && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse().ok())?
    };
    match parts.as_slice() {
        [y] => {
            let y = num(y, 4)?;
            Some((
                start_of(days_from_civil(y, 1, 1)),
                start_of(days_from_civil(y + 1, 1, 1)),
            ))
        }
        [y, m] => {
            let (y, m) = (num(y, 4)?, num(m, 2)?);
            if !(1..=12).contains(&m) {
                return None;
            }
            let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
            Some((
                start_of(days_from_civil(y, m, 1)),
                start_of(days_from_civil(ny, nm, 1)),
            ))
        }
        [y, m, d] => {
            let (y, m, d) = (num(y, 4)?, num(m, 2)?, num(d, 2)?);
            if !(1..=12).contains(&m) || !(1..=days_in_month(y, m)).contains(&d) {
                return None;
            }
            let day = days_from_civil(y, m, d);
            Some((start_of(day), start_of(day + 1)))
        }
        _ => None,
    }
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 (Howard Hinnant's algorithm).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

// ---- matching -----------------------------------------------------------------------------

/// Folds names and tells which words they contain; keeps one buffer (no allocation per
/// ASCII name).
pub struct Matcher<'q> {
    q: &'q Query,
    buf: String,
    /// Prepared searchers for `terms`, `in_dirs`, `not` (in that order of bits).
    finders: Vec<(u32, memchr::memmem::Finder<'static>)>,
}

impl<'q> Matcher<'q> {
    pub fn new(q: &'q Query) -> Self {
        let mut finders = Vec::new();
        let groups = [
            (&q.terms, 0),
            (&q.in_dirs, MAX_TERMS),
            (&q.not, MAX_TERMS + MAX_IN),
        ];
        for (list, shift) in groups {
            for (i, t) in list.iter().enumerate() {
                finders.push((
                    1u32 << (shift + i),
                    memchr::memmem::Finder::new(t.as_bytes()).into_owned(),
                ));
            }
        }
        Self {
            q,
            buf: String::with_capacity(256),
            finders,
        }
    }

    pub fn query(&self) -> &'q Query {
        self.q
    }

    /// Bits of the words (`terms`), `in:` words and exclusions found in `name`.
    pub fn bits(&mut self, name: &str) -> u32 {
        if name.is_ascii() {
            self.buf.clear();
            self.buf.push_str(name);
            self.buf.make_ascii_lowercase();
        } else {
            self.buf = fold(name);
        }
        let hay = self.buf.as_bytes();
        let mut out = 0u32;
        for (bit, f) in &self.finders {
            if f.find(hay).is_some() {
                out |= bit;
            }
        }
        out
    }

    /// The folded name of the last [`Matcher::bits`] call.
    pub fn folded(&self) -> &str {
        &self.buf
    }

    /// Whether an entry is a hit: `own` = bits of its name, `above` = bits of the folder
    /// names above it (below the root), `folded` = its folded name.
    pub fn is_hit(
        &self,
        own: u32,
        above: u32,
        folded: &str,
        is_dir: bool,
        size: Option<u64>,
        modified_ms: Option<i64>,
    ) -> bool {
        let q = self.q;
        let all = own | above;
        all & q.all_terms() == q.all_terms()
            && above & q.all_in() == q.all_in()
            && all & q.all_not() == 0
            && q.filters_pass(folded, is_dir, size, modified_ms)
    }
}

// ---- ranking ------------------------------------------------------------------------------

/// The cheap part of [`score`] for the pre-selection of the index: a name that starts
/// with a word, a name that is the words (review 043 #6).
pub fn quick_bonus(q: &Query, folded: &str, own: u32) -> i32 {
    let mut b = 0;
    for (i, t) in q.terms.iter().enumerate() {
        if own & (1 << i) != 0 && folded.starts_with(t.as_str()) {
            b += 40;
        }
    }
    if q.terms.len() == 1 {
        let stem = match extension(folded) {
            Some(e) => &folded[..folded.len() - e.len() - 1],
            None => folded,
        };
        if stem == q.terms[0] {
            b += 80;
        }
    }
    b
}

/// The rank of a hit (higher first) and the UTF-16 ranges of the words in its name.
pub fn score(q: &Query, name: &str, depth: u32, boost: i32) -> (i32, Vec<[u32; 2]>) {
    let (folded, map) = fold_with_map(name);
    let mut s = 0i32;
    let mut ranges: Vec<[u32; 2]> = Vec::new();
    let mut in_name = 0;
    for t in &q.terms {
        match folded.find(t.as_str()) {
            Some(p) => {
                in_name += 1;
                s += 100;
                if p == 0 {
                    s += 40;
                } else if !folded[..p]
                    .chars()
                    .next_back()
                    .is_some_and(char::is_alphanumeric)
                {
                    s += 25;
                }
                if let (Some(a), Some(b)) = (map.get(p), map.get(p + t.len() - 1)) {
                    ranges.push([a.0, b.1]);
                }
            }
            None => s += 10,
        }
    }
    // the name is exactly the words (without the extension): `invoice` → invoice.pdf
    let stem = match extension(&folded) {
        Some(e) => &folded[..folded.len() - e.len() - 1],
        None => folded.as_str(),
    };
    if in_name == q.terms.len() && !q.terms.is_empty() && stem == q.terms.join(" ") {
        s += 80;
    }
    s -= (depth.min(20) as i32) * 2;
    s -= (name.chars().count() as i32) / 8;
    s += boost;
    ranges.sort_unstable();
    (s, merge(ranges))
}

fn merge(ranges: Vec<[u32; 2]>) -> Vec<[u32; 2]> {
    let mut out: Vec<[u32; 2]> = Vec::with_capacity(ranges.len());
    for r in ranges {
        match out.last_mut() {
            Some(last) if r[0] <= last[1] => last[1] = last[1].max(r[1]),
            _ => out.push(r),
        }
    }
    out
}

#[cfg(test)]
mod tests;
