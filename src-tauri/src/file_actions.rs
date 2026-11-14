//! Double-click actions (design 072): rules in `file-actions.json` (app config directory) –
//! trigger, file pattern, ask first (yes/no) and a command line such as `node %N`.
//! The command is split into words here (quotes group), the first word is the program and
//! every other word stays **one** argument; nothing goes through a shell. Placeholders are
//! those of the starter menu (`starter::convert_word`), plus `%name` as a readable `%N`.
//! The frontend matches the pattern and runs a rule by id; program and arguments come only
//! from this file. Keep in sync with `src/app/core/fileactions/file-actions.models.ts`.

use crate::config_file::{Loaded, read_config};
use crate::fs_atomic::write_atomic;
use crate::starter;
use crate::tools::{self, Tool};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "file-actions.json";
pub const VERSION: u32 = 1;
pub const MAX_RULES: usize = 200;
pub const MAX_ID: usize = 64;
pub const MAX_PATTERN: usize = 512;
pub const MAX_FILE_BYTES: u64 = 256 * 1024;

/// Kinds of triggers this version knows – for now only the double click on a file.
/// Unknown kinds (a newer file) stay in the rule and are a problem (design 073 E13).
pub const TRIGGERS: &[&str] = &["doubleClick"];
/// Keys that may be held with a trigger, in canonical order (`Mod+Alt+Shift`, 073 E11):
/// `mod` is ⌘ on macOS and Ctrl elsewhere. No own `ctrl`: on macOS Ctrl+click is the
/// context menu (E12).
pub const MODIFIERS: &[&str] = &["mod", "alt", "shift"];
pub const MAX_MODIFIERS: usize = 8;
pub const DOUBLE_CLICK: &str = "doubleClick";

fn double_click() -> String {
    DOUBLE_CLICK.into()
}

fn yes() -> bool {
    true
}

/// One rule as written in `file-actions.json` and edited by the dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileActionRule {
    #[serde(default)]
    pub id: String,
    /// Kind of trigger (`doubleClick`); a file of 072 may lack it.
    #[serde(default = "double_click")]
    pub trigger: String,
    /// Keys held with it, canonical order, empty = no key (073 E11); missing in files of 072.
    #[serde(default)]
    pub modifiers: Vec<String>,
    /// Globs on the file name, separated by `;` or spaces (`*.js *.mjs`).
    #[serde(default)]
    pub pattern: String,
    /// Ask before running. A rule imported without this field asks.
    #[serde(default = "yes")]
    pub confirm: bool,
    /// One line, program first (`node %N`).
    #[serde(default)]
    pub command: String,
    /// Show it in a terminal window that stays open, instead of in the background (E9).
    #[serde(default)]
    pub terminal: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct RulesFile {
    version: u32,
    #[serde(default)]
    rules: Vec<FileActionRule>,
}

/// Why a rule cannot be saved or run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileActionProblem {
    pub id: String,
    /// `trigger` | `pattern` | `program` | `params_quote` | `params_files` | `too_long`
    pub code: String,
}

fn valid_id(id: &str) -> bool {
    (1..=MAX_ID).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// Known modifiers in canonical order without doubles, unknown ones after them in their
/// order (kept, so nothing is lost silently – they are a problem, 073 E13).
fn normalize_modifiers(mods: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = MODIFIERS
        .iter()
        .filter(|m| mods.iter().any(|x| x == *m))
        .map(|m| (*m).to_string())
        .collect();
    for m in mods {
        if !out.contains(&m) {
            out.push(m);
        }
    }
    out.truncate(MAX_MODIFIERS);
    out
}

/// A trigger this version can fire: known kind and only known keys.
fn trigger_ok(rule: &FileActionRule) -> bool {
    TRIGGERS.contains(&rule.trigger.as_str())
        && rule
            .modifiers
            .iter()
            .all(|m| MODIFIERS.contains(&m.as_str()))
}

/// Brings the rules into shape (never fails): ids valid and unique (missing ones get
/// `r<n>`), texts trimmed, overlong ones cleared, modifiers normalized, at most
/// [`MAX_RULES`].
pub fn sanitize(rules: Vec<FileActionRule>) -> Vec<FileActionRule> {
    let mut seen = HashSet::new();
    let mut next = 1usize;
    let mut out = Vec::new();
    for mut r in rules.into_iter().take(MAX_RULES) {
        if !valid_id(&r.id) || seen.contains(&r.id) {
            loop {
                let id = format!("r{next}");
                next += 1;
                if !seen.contains(&id) {
                    r.id = id;
                    break;
                }
            }
        }
        seen.insert(r.id.clone());
        r.pattern = r.pattern.trim().to_string();
        if r.pattern.len() > MAX_PATTERN || r.pattern.contains('\0') {
            r.pattern.clear();
        }
        r.command = r.command.trim().to_string();
        if r.command.len() > tools::MAX_TEXT || r.command.contains('\0') {
            r.command.clear();
        }
        if r.trigger.len() > MAX_ID || r.trigger.contains('\0') {
            r.trigger.clear();
        }
        r.modifiers
            .retain(|m| m.len() <= MAX_ID && !m.contains('\0'));
        r.modifiers = normalize_modifiers(std::mem::take(&mut r.modifiers));
        out.push(r);
    }
    out
}

/// One argument word → tool notation; `%name` reads better than `%N` and means the same.
fn convert_arg(word: &str) -> String {
    if word.contains("%%") {
        starter::convert_word(word)
    } else {
        starter::convert_word(&word.replace("%name", "%N"))
    }
}

/// The rule as a tool: one start, no shell, placeholders translated, `~` expanded; on
/// macOS an `.app` bundle becomes `open -a <app> …`. The working folder is `{dir}`, which
/// the command layer sets to the folder of the file.
pub fn to_tool(rule: &FileActionRule, home: Option<&Path>) -> Result<Tool, &'static str> {
    if !trigger_ok(rule) {
        return Err("trigger");
    }
    if rule.pattern.is_empty() {
        return Err("pattern");
    }
    let words = tools::split_words(&rule.command).map_err(|_| "params_quote")?;
    let Some((first, rest)) = words.split_first() else {
        return Err("program");
    };
    if rest.len() > tools::MAX_ARGS {
        return Err("too_long");
    }
    let program = starter::with_home(first, home);
    // the file itself is no program: `%P%N` as the first word would run whatever is clicked
    if !tools::program_ok(&starter::convert_word(&program)) {
        return Err("program");
    }
    let args: Vec<String> = rest.iter().map(|w| convert_arg(w)).collect();
    if args.iter().any(|a| a != "{files}" && a.contains("{files}")) {
        return Err("params_files");
    }
    let (program, args) = starter::app_launch(program, args);
    Ok(Tool {
        id: rule.id.clone(),
        label: rule.command.clone(),
        shortcut: None,
        program,
        args,
        per_file: false,
        file_limit: 1,
        working_dir: None,
        default_app: false,
    })
}

/// Problems of all rules, in order.
pub fn problems(rules: &[FileActionRule], home: Option<&Path>) -> Vec<FileActionProblem> {
    rules
        .iter()
        .filter_map(|r| {
            to_tool(r, home).err().map(|code| FileActionProblem {
                id: r.id.clone(),
                code: code.into(),
            })
        })
        .collect()
}

fn parse(text: &str) -> Result<Vec<FileActionRule>, String> {
    let file: RulesFile = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if file.version != VERSION {
        return Err(format!("unsupported version {}", file.version));
    }
    Ok(sanitize(file.rules))
}

/// Missing file → no rules; broken → no rules + the file kept as `.bad` (design 022 E2).
pub fn load(file: &Path) -> Loaded<Vec<FileActionRule>> {
    read_config(file, MAX_FILE_BYTES, Vec::new, parse)
}

/// Writes the (sanitized) rules atomically; returns what was written.
pub fn save(file: &Path, rules: Vec<FileActionRule>) -> io::Result<Vec<FileActionRule>> {
    let rules = sanitize(rules);
    let data = RulesFile {
        version: VERSION,
        rules,
    };
    let text = serde_json::to_string_pretty(&data).map_err(io::Error::other)? + "\n";
    write_atomic(file, text.as_bytes())?;
    Ok(data.rules)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::{ResolvedContext, plan};
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn rule(id: &str, pattern: &str, command: &str) -> FileActionRule {
        FileActionRule {
            id: id.into(),
            trigger: DOUBLE_CLICK.into(),
            modifiers: Vec::new(),
            pattern: pattern.into(),
            confirm: true,
            command: command.into(),
            terminal: false,
        }
    }

    fn args_for(command: &str, file: &str) -> (String, Vec<OsString>, Option<PathBuf>) {
        let tool = to_tool(&rule("a", "*", command), None).unwrap();
        let file = PathBuf::from(file);
        let ctx = ResolvedContext {
            dir: file.parent().map(Path::to_path_buf),
            files: vec![file],
            target_dir: None,
            home: None,
        };
        let mut p = plan(&tool, &ctx).unwrap();
        assert_eq!(p.len(), 1);
        let inv = p.remove(0);
        (inv.program, inv.args, inv.cwd)
    }

    #[test]
    fn a_name_with_spaces_stays_one_argument_and_runs_in_its_folder() {
        for placeholder in ["%N", "%name", "{name}"] {
            let (program, args, cwd) =
                args_for(&format!("node {placeholder}"), "/some dir/my script.js");
            assert_eq!(program, "node");
            assert_eq!(args, [OsString::from("my script.js")]);
            assert_eq!(cwd.as_deref(), Some(Path::new("/some dir")));
        }
    }

    #[test]
    fn hostile_names_are_no_options_and_no_shell_syntax() {
        let (_, args, _) = args_for("node %N", "/d/-rf; rm x.js");
        // `./` (Windows `.\`): a leading `-` is no option
        let dashed = format!(".{}-rf; rm x.js", std::path::MAIN_SEPARATOR);
        assert_eq!(args, [OsString::from(dashed)]);
    }

    #[test]
    fn full_path_stem_and_literal_percent() {
        let (_, args, _) = args_for(r#"tool "%P%N" %O 100%% %%name"#, "/d/a.js");
        assert_eq!(
            args,
            [
                OsString::from("/d/a.js"),
                OsString::from("a"),
                OsString::from("100%"),
                OsString::from("%name"),
            ]
        );
    }

    #[test]
    fn invalid_rules_have_a_problem() {
        let cases = [
            (rule("a", "", "node %N"), "pattern"),
            (rule("a", "*.js", ""), "program"),
            (rule("a", "*.js", "%P%N"), "program"),
            (rule("a", "*.js", "%N --x"), "program"),
            (rule("a", "*.js", "./relative %N"), "program"),
            (rule("a", "*.js", r#"node "%N"#), "params_quote"),
            (rule("a", "*.js", "node x%S"), "params_files"),
        ];
        for (r, code) in cases {
            assert_eq!(
                problems(std::slice::from_ref(&r), None),
                [FileActionProblem {
                    id: "a".into(),
                    code: code.into()
                }],
                "{}",
                r.command
            );
        }
        let many = format!("node {}", "x ".repeat(tools::MAX_ARGS + 1));
        assert_eq!(
            to_tool(&rule("a", "*", &many), None).err(),
            Some("too_long")
        );
        assert!(problems(&[rule("a", "*.js", "node %N")], None).is_empty());
    }

    /// E6: a bare program name is looked up in the `PATH` given to the process, not in the
    /// one of the app (which an app started from the Finder keeps minimal).
    #[cfg(unix)]
    #[test]
    fn the_given_path_finds_the_program_and_the_file_folder_is_the_cwd() {
        use std::os::unix::fs::PermissionsExt;
        let bin = tempdir().unwrap();
        let work = tempdir().unwrap();
        let probe = bin.path().join("fnf-probe-072");
        fs::write(&probe, "#!/bin/sh\necho \"$1\" > marker.txt\n").unwrap();
        fs::set_permissions(&probe, fs::Permissions::from_mode(0o755)).unwrap();
        let file = work.path().join("my script.js");
        fs::write(&file, "").unwrap();
        let tool = to_tool(&rule("a", "*", "fnf-probe-072 %N"), None).unwrap();
        let ctx = ResolvedContext {
            dir: Some(work.path().to_path_buf()),
            files: vec![file],
            target_dir: None,
            home: None,
        };
        let inv = plan(&tool, &ctx).unwrap().remove(0);
        let mut command = tools::command(&inv);
        command.env("PATH", format!("{}:/usr/bin:/bin", bin.path().display()));
        let status = command.status().unwrap();
        assert!(status.success());
        assert_eq!(
            fs::read_to_string(work.path().join("marker.txt")).unwrap(),
            "my script.js\n"
        );
    }

    #[test]
    fn home_is_expanded_in_the_program() {
        // an absolute home of this OS (`/home/marc` has no drive on Windows)
        let home = if cfg!(windows) {
            Path::new(r"C:\Users\marc")
        } else {
            Path::new("/home/marc")
        };
        let tool = to_tool(&rule("a", "*", "~/bin/run %N"), Some(home)).unwrap();
        assert_eq!(Path::new(&tool.program), home.join("bin/run"));
    }

    #[test]
    fn sanitize_makes_ids_unique_and_trims() {
        let out = sanitize(vec![
            rule("x", " *.js ", " node %N "),
            rule("x", "*.py", "python3 %N"),
            rule("bad id!", "*.sh", "bash %N"),
        ]);
        assert_eq!(out[0].id, "x");
        assert_eq!(out[0].pattern, "*.js");
        assert_eq!(out[0].command, "node %N");
        assert_eq!(out[1].id, "r1");
        assert_eq!(out[2].id, "r2");
        assert_eq!(
            sanitize(vec![rule("a", "*", "x"); MAX_RULES + 5]).len(),
            MAX_RULES
        );
    }

    #[test]
    fn save_and_load_keep_the_order() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        assert!(load(&file).value.is_empty());
        let mut second = rule("b", "*.py", "python3 %N");
        second.confirm = false;
        second.terminal = true;
        let rules = vec![rule("a", "*.js", "node %N"), second];
        assert_eq!(save(&file, rules.clone()).unwrap(), rules);
        assert_eq!(load(&file).value, rules);
    }

    #[test]
    fn a_rule_without_the_confirm_field_asks() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::write(
            &file,
            r#"{"version":1,"rules":[{"id":"a","pattern":"*.js","command":"node %N"}]}"#,
        )
        .unwrap();
        let rules = load(&file).value;
        assert!(rules[0].confirm);
        assert!(!rules[0].terminal);
        assert_eq!(rules[0].trigger, DOUBLE_CLICK);
        assert!(rules[0].modifiers.is_empty());
    }

    /// 073: a file written by 072 (trigger, no modifiers) loads as "no key" and is
    /// written back with an empty list.
    #[test]
    fn a_file_of_072_loads_as_no_key() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::write(
            &file,
            r#"{"version":1,"rules":[{"id":"a","trigger":"doubleClick","pattern":"*.js","confirm":false,"command":"node %N","terminal":true}]}"#,
        )
        .unwrap();
        let rules = load(&file).value;
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].trigger, DOUBLE_CLICK);
        assert!(rules[0].modifiers.is_empty());
        assert!(problems(&rules, None).is_empty());
        save(&file, rules.clone()).unwrap();
        assert!(
            fs::read_to_string(&file)
                .unwrap()
                .contains(r#""modifiers": []"#)
        );
        assert_eq!(load(&file).value, rules);
    }

    #[test]
    fn modifiers_are_sorted_and_doubles_removed() {
        let mut r = rule("a", "*.js", "node %N");
        r.modifiers = vec!["shift".into(), "mod".into(), "shift".into(), "alt".into()];
        let out = sanitize(vec![r]);
        assert_eq!(out[0].modifiers, ["mod", "alt", "shift"]);
        assert!(problems(&out, None).is_empty());
    }

    #[test]
    fn unknown_kinds_and_keys_are_a_problem_and_are_kept() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::write(
            &file,
            r#"{"version":1,"rules":[
                {"id":"a","trigger":"middleClick","pattern":"*.js","command":"node %N"},
                {"id":"b","modifiers":["hyper","shift"],"pattern":"*.js","command":"node %N"},
                {"id":"c","modifiers":["shift"],"pattern":"*.js","command":"node %N"}]}"#,
        )
        .unwrap();
        let rules = load(&file).value;
        assert_eq!(rules.len(), 3, "a newer file is no broken file");
        assert_eq!(rules[0].trigger, "middleClick");
        assert_eq!(rules[1].modifiers, ["shift", "hyper"]);
        let codes: Vec<_> = problems(&rules, None)
            .into_iter()
            .map(|p| (p.id, p.code))
            .collect();
        assert_eq!(
            codes,
            [
                ("a".into(), "trigger".into()),
                ("b".into(), "trigger".into())
            ]
        );
        // round trip: nothing of the unknown values is lost
        save(&file, rules.clone()).unwrap();
        assert_eq!(load(&file).value, rules);
    }

    #[test]
    fn a_broken_file_is_kept_aside() {
        let dir = tempdir().unwrap();
        let file = dir.path().join(FILE_NAME);
        fs::write(&file, "{nope").unwrap();
        let loaded = load(&file);
        assert!(loaded.value.is_empty());
        assert_eq!(loaded.warning.unwrap().code, "broken");
    }
}
