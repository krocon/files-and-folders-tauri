//! Starter menu (design 032, Total Commander's "Start" menu): the user's own quick
//! launch entries in `starter.json` (app config directory) – programs and scripts
//! with parameters, folders to jump to, submenus and separators. Parameters are one
//! line like in Total Commander (`"%P%N" -x`): split into words here (quotes group),
//! every word stays **one** argument and nothing goes through a shell. The TC
//! placeholders are translated to the ones of the tools (design 011):
//!
//! | TC          | here          | meaning                                          |
//! |-------------|---------------|--------------------------------------------------|
//! | `%P%N`      | `{file}`      | full path of the file under the cursor           |
//! | `%N`        | `{name}`      | its name                                         |
//! | `%O` / `%E` | `{stem}`/`{ext}` | name without extension / extension            |
//! | `%P` / `%T` | `{dir}` / `{targetDir}` + separator | folder of the active / other panel |
//! | `%S`        | `{files}`     | all marked entries (a word of its own)           |
//! | `%%`        | `%`           |                                                  |
//!
//! The `{…}` forms of the tools work as well. Program and arguments come only from
//! this file; the frontend runs an entry by id (`run_starter`).
//! Keep in sync with `src/app/core/starter/starter.models.ts`.

use crate::config_file::{Loaded, read_config};
use crate::fs_atomic::write_atomic;
use crate::tools::{self, Tool};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{MAIN_SEPARATOR_STR, Path, PathBuf};

pub const FILE_NAME: &str = "starter.json";
pub const VERSION: u32 = 1;
/// All entries of all levels together.
pub const MAX_ITEMS: usize = 500;
/// Submenus inside submenus: at most this many levels below the top.
pub const MAX_DEPTH: usize = 5;
pub const MAX_LABEL: usize = 100;
pub const MAX_ID: usize = 64;
pub const MAX_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StarterKind {
    #[default]
    Program,
    Folder,
    Submenu,
    Separator,
}

/// One entry as written in `starter.json` and edited by the dialog.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: StarterKind,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
    /// Program or script: a name found in `PATH` or an absolute path (`~` allowed); on
    /// macOS also an `.app` bundle.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub program: String,
    /// One line, TC style (`"%P%N" --flag`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub params: String,
    /// Start folder (placeholders and `~` allowed); empty = folder of the active panel.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub working_dir: String,
    /// Folder entries: where the active panel goes (absolute or `~`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub folder: String,
    /// Keymap notation (`Alt+1`); checked by the frontend against the keymap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<StarterItem>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StarterFile {
    version: u32,
    #[serde(default)]
    items: Vec<StarterItem>,
}

/// Why an entry cannot run (shown at the entry in the menu and the editor).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterProblem {
    pub id: String,
    /// `label` | `program` | `folder` | `params_quote` | `params_files` | `working_dir` |
    /// `too_deep` | `too_long`
    pub code: String,
}

fn problem(id: &str, code: &str) -> StarterProblem {
    StarterProblem {
        id: id.into(),
        code: code.into(),
    }
}

fn valid_id(id: &str) -> bool {
    (1..=MAX_ID).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn text_ok(s: &str) -> bool {
    s.len() <= tools::MAX_TEXT && !s.contains('\0')
}

/// Brings the tree into shape (never fails): labels cleaned, ids valid and unique
/// (missing ones get `s<n>`), separators and folders without program fields, children only
/// in submenus, at most [`MAX_DEPTH`] levels and [`MAX_ITEMS`] entries, overlong texts cut.
pub fn sanitize(items: Vec<StarterItem>) -> Vec<StarterItem> {
    let mut seen = std::collections::HashSet::new();
    let mut count = 0usize;
    let mut next = 1usize;
    fn walk(
        items: Vec<StarterItem>,
        depth: usize,
        seen: &mut std::collections::HashSet<String>,
        count: &mut usize,
        next: &mut usize,
    ) -> Vec<StarterItem> {
        let mut out = Vec::new();
        for mut it in items {
            if *count >= MAX_ITEMS {
                break;
            }
            *count += 1;
            if !valid_id(&it.id) || seen.contains(&it.id) {
                loop {
                    let id = format!("s{next}");
                    *next += 1;
                    if !seen.contains(&id) {
                        it.id = id;
                        break;
                    }
                }
            }
            seen.insert(it.id.clone());
            it.label = cut(&tools::clean_label(&it.label), MAX_LABEL);
            for s in [
                &mut it.program,
                &mut it.params,
                &mut it.working_dir,
                &mut it.folder,
            ] {
                if !text_ok(s) {
                    s.clear();
                }
            }
            it.shortcut = it
                .shortcut
                .filter(|s| !s.trim().is_empty() && s.len() <= 64)
                .map(|s| s.trim().to_string());
            match it.kind {
                StarterKind::Separator => {
                    let id = std::mem::take(&mut it.id);
                    it = StarterItem {
                        id,
                        kind: StarterKind::Separator,
                        ..StarterItem::default()
                    };
                }
                StarterKind::Folder => {
                    it.program.clear();
                    it.params.clear();
                    it.working_dir.clear();
                    it.items.clear();
                }
                StarterKind::Program => {
                    it.folder.clear();
                    it.items.clear();
                }
                StarterKind::Submenu => {
                    it.program.clear();
                    it.params.clear();
                    it.working_dir.clear();
                    it.folder.clear();
                    it.shortcut = None;
                    let children = std::mem::take(&mut it.items);
                    it.items = if depth < MAX_DEPTH {
                        walk(children, depth + 1, seen, count, next)
                    } else {
                        Vec::new()
                    };
                }
            }
            out.push(it);
        }
        out
    }
    walk(items, 0, &mut seen, &mut count, &mut next)
}

fn cut(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// TC placeholders of one word → tool placeholders (see the module docs).
pub fn convert_word(word: &str) -> String {
    if word == "%S" || word == "%s" {
        return "{files}".into();
    }
    let mut out = String::new();
    let mut rest = word;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        let (rep, len): (String, usize) = if after.starts_with("%%") {
            ("%".into(), 2)
        } else if after.len() >= 4 && after[..4].eq_ignore_ascii_case("%P%N") {
            ("{file}".into(), 4)
        } else {
            match after.as_bytes().get(1).map(u8::to_ascii_uppercase) {
                Some(b'P') => (format!("{{dir}}{MAIN_SEPARATOR_STR}"), 2),
                Some(b'T') => (format!("{{targetDir}}{MAIN_SEPARATOR_STR}"), 2),
                Some(b'N') => ("{name}".into(), 2),
                Some(b'O') => ("{stem}".into(), 2),
                Some(b'E') => ("{ext}".into(), 2),
                // inside a word: rejected by `convert_params` (`{files}` must stand alone)
                Some(b'S') => ("{files}".into(), 2),
                _ => ("%".into(), 1),
            }
        };
        out.push_str(&rep);
        rest = &after[len..];
    }
    out.push_str(rest);
    out
}

/// The parameter line → argument templates (tool notation).
pub fn convert_params(params: &str) -> Result<Vec<String>, &'static str> {
    let words = tools::split_words(params).map_err(|_| "params_quote")?;
    if words.len() > tools::MAX_ARGS {
        return Err("too_long");
    }
    let args: Vec<String> = words.iter().map(|w| convert_word(w)).collect();
    if args.iter().any(|a| a != "{files}" && a.contains("{files}")) {
        return Err("params_files");
    }
    Ok(args)
}

/// Expands a leading `~` (`~`, `~/…`); other text stays as it is.
fn with_home(raw: &str, home: Option<&Path>) -> String {
    let t = raw.trim();
    match (home, t.strip_prefix('~')) {
        (Some(h), Some(rest))
            if rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\') =>
        {
            let rest = rest.trim_start_matches(['/', '\\']);
            if rest.is_empty() {
                h.to_string_lossy().into_owned()
            } else {
                h.join(rest).to_string_lossy().into_owned()
            }
        }
        _ => t.to_string(),
    }
}

/// The problem of one entry (children are checked by [`problems`]).
pub fn check(item: &StarterItem, home: Option<&Path>) -> Option<&'static str> {
    match item.kind {
        StarterKind::Separator => None,
        _ if item.label.trim().is_empty() => Some("label"),
        StarterKind::Submenu => None,
        StarterKind::Folder => {
            let f = with_home(&item.folder, home);
            (f.is_empty() || !Path::new(&f).is_absolute() || f.contains('\0'))
                .then_some("folder")
        }
        StarterKind::Program => {
            if !tools::program_ok(&with_home(&item.program, home)) {
                return Some("program");
            }
            if let Err(code) = convert_params(&item.params) {
                return Some(code);
            }
            if !item.working_dir.trim().is_empty() {
                let w = convert_word(&with_home(&item.working_dir, home));
                if w.contains("{files}") {
                    return Some("working_dir");
                }
                let starts_with_placeholder = ["{dir}", "{targetDir}", "{file}"]
                    .iter()
                    .any(|p| w.starts_with(p));
                if !starts_with_placeholder && !Path::new(&w).is_absolute() {
                    return Some("working_dir");
                }
            }
            None
        }
    }
}

/// Problems of all entries (depth-first).
pub fn problems(items: &[StarterItem], home: Option<&Path>) -> Vec<StarterProblem> {
    let mut out = Vec::new();
    fn walk(
        items: &[StarterItem],
        home: Option<&Path>,
        depth: usize,
        out: &mut Vec<StarterProblem>,
    ) {
        for it in items {
            if let Some(code) = check(it, home) {
                out.push(problem(&it.id, code));
            }
            if it.kind == StarterKind::Submenu {
                if depth >= MAX_DEPTH && !it.items.is_empty() {
                    out.push(problem(&it.id, "too_deep"));
                } else {
                    walk(&it.items, home, depth + 1, out);
                }
            }
        }
    }
    walk(items, home, 0, &mut out);
    out
}

/// Number of entries of all levels.
pub fn count(items: &[StarterItem]) -> usize {
    items.iter().map(|i| 1 + count(&i.items)).sum()
}

pub fn find<'a>(items: &'a [StarterItem], id: &str) -> Option<&'a StarterItem> {
    for it in items {
        if it.id == id {
            return Some(it);
        }
        if let Some(found) = find(&it.items, id) {
            return Some(found);
        }
    }
    None
}

/// Whether the entry uses all marked entries (`%S` / `{files}`) – else only the cursor file.
pub fn uses_all_files(item: &StarterItem) -> bool {
    convert_params(&item.params).is_ok_and(|a| a.iter().any(|w| w == "{files}"))
}

/// An entry as a tool (design 011): checked, placeholders translated, `~` expanded; on
/// macOS an `.app` bundle becomes `open -a <app> …`. One start (no `perFile`).
pub fn to_tool(item: &StarterItem, home: Option<&Path>) -> Result<Tool, &'static str> {
    if item.kind != StarterKind::Program {
        return Err("program");
    }
    if let Some(code) = check(item, home) {
        return Err(code);
    }
    let mut program = with_home(&item.program, home);
    let mut args = convert_params(&item.params)?;
    if cfg!(target_os = "macos") && is_app_bundle(&program) {
        let mut open = vec!["-a".to_string(), program];
        open.append(&mut args);
        args = open;
        program = "open".into();
    }
    let working_dir = Some(item.working_dir.trim())
        .filter(|w| !w.is_empty())
        .map(|w| convert_word(&with_home(w, home)));
    Ok(Tool {
        id: item.id.clone(),
        label: item.label.clone(),
        shortcut: None,
        program,
        args,
        per_file: false,
        file_limit: tools::MAX_FILE_LIMIT,
        working_dir,
        default_app: false,
    })
}

fn is_app_bundle(program: &str) -> bool {
    let p = Path::new(program);
    p.is_absolute()
        && p.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("app"))
}

/// Folder entries: the absolute target (`~` expanded).
pub fn folder_target(item: &StarterItem, home: Option<&Path>) -> Result<PathBuf, &'static str> {
    if item.kind != StarterKind::Folder || check(item, home).is_some() {
        return Err("folder");
    }
    Ok(PathBuf::from(with_home(&item.folder, home)))
}

fn parse(text: &str) -> Result<Vec<StarterItem>, String> {
    let file: StarterFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(sanitize(file.items))
}

/// Missing file → empty menu; broken → empty + the file kept as `.bad` (design 022 E2).
pub fn load(file: &Path) -> Loaded<Vec<StarterItem>> {
    read_config(file, MAX_FILE_BYTES, Vec::new, parse)
}

/// Writes the (sanitized) entries atomically; returns what was written.
pub fn save(file: &Path, items: Vec<StarterItem>) -> io::Result<Vec<StarterItem>> {
    let items = sanitize(items);
    let data = StarterFile {
        version: VERSION,
        items,
    };
    let text = serde_json::to_string_pretty(&data).map_err(io::Error::other)? + "\n";
    write_atomic(file, text.as_bytes())?;
    Ok(data.items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::{ResolvedContext, plan};
    use std::fs;
    use tempfile::tempdir;

    fn prog(id: &str, program: &str, params: &str) -> StarterItem {
        StarterItem {
            id: id.into(),
            kind: StarterKind::Program,
            label: format!("L {id}"),
            program: program.into(),
            params: params.into(),
            ..StarterItem::default()
        }
    }

    fn sep() -> StarterItem {
        StarterItem {
            kind: StarterKind::Separator,
            ..StarterItem::default()
        }
    }

    fn sub(id: &str, items: Vec<StarterItem>) -> StarterItem {
        StarterItem {
            id: id.into(),
            kind: StarterKind::Submenu,
            label: format!("Sub {id}"),
            items,
            ..StarterItem::default()
        }
    }

    fn ctx(files: &[&str]) -> ResolvedContext {
        ResolvedContext {
            files: files.iter().map(PathBuf::from).collect(),
            dir: Some(PathBuf::from("/src dir")),
            target_dir: Some(PathBuf::from("/other")),
            home: Some(PathBuf::from("/home/u")),
        }
    }

    fn args(t: &Tool, c: &ResolvedContext) -> Vec<String> {
        plan(t, c).unwrap()[0]
            .args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    const SEP: &str = MAIN_SEPARATOR_STR;

    #[test]
    fn tc_placeholders_become_tool_placeholders() {
        assert_eq!(convert_word("%P%N"), "{file}");
        assert_eq!(convert_word("%p%n"), "{file}");
        assert_eq!(convert_word("--in=%P%N"), "--in={file}");
        assert_eq!(convert_word("%N"), "{name}");
        assert_eq!(convert_word("%O.%E"), "{stem}.{ext}");
        assert_eq!(convert_word("%P"), format!("{{dir}}{SEP}"));
        assert_eq!(convert_word("%T%N"), format!("{{targetDir}}{SEP}{{name}}"));
        assert_eq!(convert_word("%S"), "{files}");
        assert_eq!(convert_word("100%%"), "100%");
        assert_eq!(convert_word("50%"), "50%");
        assert_eq!(convert_word("%X"), "%X");
        assert_eq!(convert_word("{file}"), "{file}");
    }

    #[test]
    fn params_are_words_never_a_shell_line() {
        let t = to_tool(&prog("a", "prog", r#""%P%N" -x 'a b' ; rm -rf ~"#), None).unwrap();
        let c = ctx(&["/a b/Brief ä.txt"]);
        assert_eq!(
            args(&t, &c),
            ["/a b/Brief ä.txt", "-x", "a b", ";", "rm", "-rf", "~"]
        );
        assert_eq!(
            plan(&t, &c).unwrap()[0].cwd.as_deref(),
            Some(Path::new("/src dir"))
        );
        // %S = all files, each one argument
        let t = to_tool(&prog("b", "prog", "-o %S"), None).unwrap();
        assert_eq!(args(&t, &ctx(&["/1", "/2 x"])), ["-o", "/1", "/2 x"]);
        assert!(uses_all_files(&prog("b", "prog", "-o %S")));
        assert!(!uses_all_files(&prog("b", "prog", "%P%N")));
        // %N starting with a dash cannot become an option
        let t = to_tool(&prog("c", "prog", "%N"), None).unwrap();
        assert_eq!(args(&t, &ctx(&["/d/-rf"])), [format!(".{SEP}-rf")]);
        // a file placeholder without a file: a clear error, nothing starts
        assert!(plan(&t, &ctx(&[])).is_err());
    }

    #[test]
    fn problems_name_the_entry() {
        let home = Path::new("/home/u");
        let mut no_label = prog("a", "prog", "");
        no_label.label = " ".into();
        let mut folder_rel = StarterItem {
            id: "f".into(),
            kind: StarterKind::Folder,
            label: "F".into(),
            folder: "rel/dir".into(),
            ..StarterItem::default()
        };
        let mut wd = prog("w", "prog", "");
        wd.working_dir = "relative".into();
        let items = vec![
            no_label,
            prog("b", "./x.sh", ""),
            prog("c", "prog", "\"open"),
            prog("d", "prog", "--all=%S"),
            folder_rel.clone(),
            wd,
            sep(),
        ];
        let p = problems(&items, Some(home));
        let codes: Vec<(&str, &str)> = p
            .iter()
            .map(|p| (p.id.as_str(), p.code.as_str()))
            .collect();
        assert_eq!(
            codes,
            [
                ("a", "label"),
                ("b", "program"),
                ("c", "params_quote"),
                ("d", "params_files"),
                ("f", "folder"),
                ("w", "working_dir")
            ]
        );
        folder_rel.folder = "~/Projekte ä".into();
        assert_eq!(check(&folder_rel, Some(home)), None);
        assert_eq!(
            folder_target(&folder_rel, Some(home)).unwrap(),
            home.join("Projekte ä")
        );
        let mut ok = prog("o", "~/bin/run.sh", "%P%N");
        ok.working_dir = "%T".into();
        assert_eq!(check(&ok, Some(home)), None);
        let t = to_tool(&ok, Some(home)).unwrap();
        assert_eq!(Path::new(&t.program), home.join("bin/run.sh"));
        assert_eq!(
            plan(&t, &ctx(&["/f"])).unwrap()[0].cwd.as_deref(),
            Some(Path::new(&format!("/other{SEP}")))
        );
    }

    #[test]
    fn sanitize_fixes_ids_shape_and_limits() {
        let mut dup = prog("a", "p", "x");
        dup.folder = "/should/go".into();
        let mut folder = StarterItem {
            id: "bad id".into(),
            kind: StarterKind::Folder,
            label: "Line\nbreak".into(),
            folder: "/x".into(),
            program: "p".into(),
            ..StarterItem::default()
        };
        folder.items = vec![prog("z", "p", "")];
        let mut s = sep();
        s.label = "x".into();
        s.shortcut = Some("Alt+1".into());
        let out = sanitize(vec![prog("a", "p", ""), dup, folder, s]);
        let ids: Vec<&str> = out.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["a", "s1", "s2", "s3"]);
        assert!(out[1].folder.is_empty());
        assert_eq!(out[2].label, "Line break");
        assert!(out[2].program.is_empty() && out[2].items.is_empty());
        assert_eq!(
            out[3],
            StarterItem {
                id: "s3".into(),
                kind: StarterKind::Separator,
                ..StarterItem::default()
            }
        );
        // depth
        let mut deep = prog("leaf", "p", "");
        for i in 0..(MAX_DEPTH + 3) {
            deep = sub(&format!("m{i}"), vec![deep]);
        }
        let out = sanitize(vec![deep]);
        let mut levels = 0;
        let mut cur = &out[0];
        while let Some(child) = cur.items.first() {
            levels += 1;
            cur = child;
        }
        assert_eq!(levels, MAX_DEPTH);
        // count
        let many: Vec<_> = (0..MAX_ITEMS + 20)
            .map(|i| prog(&format!("p{i}"), "p", ""))
            .collect();
        assert_eq!(count(&sanitize(many)), MAX_ITEMS);
    }

    #[test]
    fn find_and_count_walk_submenus() {
        let items = vec![
            prog("a", "p", ""),
            sub("m", vec![sep(), sub("n", vec![prog("deep", "p", "")])]),
        ];
        assert_eq!(count(&items), 5);
        assert_eq!(find(&items, "deep").unwrap().program, "p");
        assert!(find(&items, "nope").is_none());
        assert_eq!(
            to_tool(find(&items, "m").unwrap(), None).unwrap_err(),
            "program"
        );
    }

    #[test]
    fn save_and_load_round_trip_and_broken_files() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("ü config").join(FILE_NAME);
        assert_eq!(load(&file).value, Vec::<StarterItem>::new());
        let items = vec![
            prog("a", "/usr/bin/code", "%P%N"),
            sep(),
            sub("m", vec![prog("", "p", "")]),
        ];
        let saved = save(&file, items).unwrap();
        assert_eq!(saved[1].id, "s1");
        assert_eq!(saved[2].items[0].id, "s2");
        assert_eq!(load(&file).value, saved);
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.contains("\"version\": 1") && text.contains("\"kind\": \"separator\""));
        fs::write(&file, "{ nope").unwrap();
        let l = load(&file);
        assert!(l.value.is_empty());
        assert_eq!(l.warning.unwrap().code, "broken");
        fs::write(&file, r#"{"version": 9, "items": []}"#).unwrap();
        assert_eq!(load(&file).warning.unwrap().code, "broken");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_bundles_start_with_open() {
        let t = to_tool(&prog("a", "/Applications/Preview.app", "%P%N"), None).unwrap();
        assert_eq!(t.program, "open");
        assert_eq!(args(&t, &ctx(&["/x.pdf"])), ["-a", "/Applications/Preview.app", "/x.pdf"]);
    }
}
