use super::*;
use serde_json::Value;

const CASES: &str = include_str!("../../../../src/app/features/palette/palette-query.cases.json");

fn catalog() -> Value {
    serde_json::from_str(CASES).expect("catalog")
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|s| s.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

fn opt_i64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_i64)
}

fn clock(c: &Value) -> (i64, i32) {
    (
        c["nowMs"].as_i64().unwrap(),
        c["tzOffsetMinutes"].as_i64().unwrap() as i32,
    )
}

#[test]
fn catalog_parse() {
    let c = catalog();
    let (now, tz) = clock(&c);
    for case in c["parse"].as_array().unwrap() {
        let input = case["input"].as_str().unwrap();
        let q = parse(input, now, tz);
        let mode = match q.mode {
            Mode::Files => "files",
            Mode::Actions => "actions",
            Mode::Path => "path",
        };
        assert_eq!(mode, case["mode"].as_str().unwrap(), "{input}");
        assert_eq!(q.terms, strings(case, "terms"), "{input}: terms");
        assert_eq!(q.not, strings(case, "not"), "{input}: not");
        assert_eq!(q.ext, strings(case, "ext"), "{input}: ext");
        assert_eq!(q.in_dirs, strings(case, "inDirs"), "{input}: in");
        assert_eq!(q.in_paths, strings(case, "inPaths"), "{input}: in paths");
        assert_eq!(
            q.size_min.map(|v| v as i64),
            opt_i64(case, "sizeMin"),
            "{input}"
        );
        assert_eq!(
            q.size_max.map(|v| v as i64),
            opt_i64(case, "sizeMax"),
            "{input}"
        );
        assert_eq!(
            q.modified_from,
            opt_i64(case, "modifiedFrom"),
            "{input}: from"
        );
        assert_eq!(q.modified_to, opt_i64(case, "modifiedTo"), "{input}: to");
        let kind = q
            .kind
            .map(|k| if k == KindFilter::Dir { "dir" } else { "file" });
        assert_eq!(
            kind,
            case.get("kind").and_then(Value::as_str),
            "{input}: kind"
        );
        assert_eq!(
            q.path.as_deref(),
            case.get("path").and_then(Value::as_str),
            "{input}: path"
        );
    }
}

/// Matching as the index and the live walk do it: bits of the folders above, own bits.
fn hit(q: &Query, path: &[String], dir: bool, size: Option<u64>, modified: Option<i64>) -> bool {
    let mut m = Matcher::new(q);
    let mut above = 0;
    for name in &path[..path.len() - 1] {
        above |= m.bits(name);
    }
    let name = path.last().unwrap();
    let own = m.bits(name);
    let folded = m.folded().to_string();
    m.is_hit(own, above, &folded, dir, size, modified)
}

#[test]
fn catalog_match() {
    let c = catalog();
    let (now, tz) = clock(&c);
    for case in c["match"].as_array().unwrap() {
        let input = case["query"].as_str().unwrap();
        let q = parse(input, now, tz);
        let path = strings(case, "path");
        let dir = case.get("dir").and_then(Value::as_bool).unwrap_or(false);
        let size = case
            .get("size")
            .and_then(Value::as_u64)
            .or(if dir { None } else { Some(10) });
        let modified = opt_i64(case, "modifiedMs").or(Some(now));
        assert_eq!(
            hit(&q, &path, dir, size, modified),
            case["hit"].as_bool().unwrap(),
            "{input} on {path:?}"
        );
    }
}

#[test]
fn catalog_rank() {
    let c = catalog();
    let (now, tz) = clock(&c);
    for case in c["rank"].as_array().unwrap() {
        let q = parse(case["query"].as_str().unwrap(), now, tz);
        let order = strings(case, "order");
        let depths: Vec<u32> = case
            .get("depths")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|d| d.as_u64().unwrap() as u32).collect())
            .unwrap_or_else(|| vec![1; order.len()]);
        let mut scored: Vec<(i32, &String)> = order
            .iter()
            .zip(&depths)
            .map(|(n, d)| (score(&q, n, *d, 0).0, n))
            .collect();
        scored.sort_by_key(|s| std::cmp::Reverse(s.0));
        let got: Vec<&String> = scored.into_iter().map(|(_, n)| n).collect();
        assert_eq!(got, order.iter().collect::<Vec<_>>(), "{}", case["query"]);
    }
}

#[test]
fn fold_strips_accents_and_case() {
    assert_eq!(fold("Ärger Über Çava"), "arger uber cava");
    assert_eq!(fold("ÅNGSTRÖM"), "angstrom");
    assert_eq!(fold("ABC"), "abc");
    // NFD and NFC give the same key (names from macOS)
    assert_eq!(fold("Cafe\u{301}"), fold("Café"));
    // scripts without accents stay as they are
    assert_eq!(fold("日本語"), "日本語");
}

#[test]
fn highlight_ranges_are_utf16_of_the_original() {
    let q = parse("cafe", 0, 0);
    let (_, ranges) = score(&q, "Le Café.jpg", 0, 0);
    assert_eq!(ranges, vec![[3, 7]]);
    // NFD name: é is two UTF-16 units – the range covers both
    let (_, ranges) = score(&q, "Cafe\u{301}.jpg", 0, 0);
    assert_eq!(ranges, vec![[0, 5]]);
    // astral characters count two units
    let q = parse("x", 0, 0);
    let (_, ranges) = score(&q, "😀x", 0, 0);
    assert_eq!(ranges, vec![[2, 3]]);
}

#[test]
fn limits() {
    let many = (0..30)
        .map(|i| format!("w{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    let q = parse(&many, 0, 0);
    assert_eq!(q.terms.len(), MAX_TERMS);
    assert_eq!(q.dropped, 30 - MAX_TERMS as u32);
    let long = "a".repeat(MAX_QUERY_LEN * 2);
    assert_eq!(parse(&long, 0, 0).terms[0].len(), MAX_QUERY_LEN);
    // a cut in the middle of a character does not panic
    let long = "ä".repeat(MAX_QUERY_LEN);
    assert!(parse(&long, 0, 0).terms[0].len() <= MAX_QUERY_LEN);
}

#[test]
fn searches_files_only_with_something_to_search() {
    assert!(!parse("", 0, 0).searches_files());
    assert!(!parse("> copy", 0, 0).searches_files());
    assert!(parse("ext:pdf", 0, 0).searches_files());
    assert!(!parse("is:dir", 0, 0).searches_files());
    assert!(parse("x", 0, 0).searches_files());
}

#[test]
fn sizes() {
    assert_eq!(parse_size("10m"), Some(10 << 20));
    assert_eq!(parse_size("10MB"), Some(10 << 20));
    assert_eq!(parse_size("1024"), Some(1024));
    assert_eq!(parse_size("0.5k"), Some(512));
    assert_eq!(parse_size("1e9"), None);
    assert_eq!(parse_size("-1"), None);
    assert_eq!(parse_size(""), None);
    assert_eq!(parse_size("99999999999t"), None);
}

#[test]
fn civil_days() {
    assert_eq!(days_from_civil(1970, 1, 1), 0);
    assert_eq!(days_from_civil(2000, 3, 1), 11_017);
    assert_eq!(days_from_civil(1969, 12, 31), -1);
}
