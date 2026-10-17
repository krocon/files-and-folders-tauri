//! External tools (design 011 E3): configuration (`tools.json` in the app
//! config directory, defaults per OS, the old mr format importable),
//! placeholders **per argument** and starting a program with an argument
//! array – never a string for a shell. The frontend sends a tool id and the
//! context (files, folders); program and arguments come only from here.
//! Keep in sync with `src/app/core/os/os.models.ts`.

use crate::error::{FsError, FsErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const FILE_NAME: &str = "tools.json";
pub const VERSION: u32 = 1;
pub const MAX_TOOLS: usize = 200;
pub const MAX_ARGS: usize = 64;
pub const MAX_TEXT: usize = 4096;
pub const MAX_FILE_LIMIT: u32 = 1000;
pub const DEFAULT_FILE_LIMIT: u32 = 10;

/// A program with arguments (`{dir}` allowed) – the custom terminal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramSpec {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// One start per file (the old `$file`); otherwise one start with all files.
    #[serde(default)]
    pub per_file: bool,
    #[serde(default = "default_limit")]
    pub file_limit: u32,
    /// Working folder (placeholders allowed); default `{dir}`, else the home folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
}

fn default_limit() -> u32 {
    DEFAULT_FILE_LIMIT
}

/// The old format of files-and-folders-mr (`cmd` + `para` as one line).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MrTool {
    id: String,
    label: String,
    #[serde(default)]
    shortcut: Option<String>,
    cmd: String,
    #[serde(default)]
    para: Option<String>,
    #[serde(default)]
    file_limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileFormat {
    #[serde(default = "version")]
    version: u32,
    #[serde(default)]
    replace_defaults: bool,
    #[serde(default)]
    terminal: Option<ProgramSpec>,
    #[serde(default)]
    tools: Vec<Value>,
}

fn version() -> u32 {
    VERSION
}

/// The file as written when it is created (defaults spelled out to edit them).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileOut<'a> {
    version: u32,
    replace_defaults: bool,
    terminal: Option<&'a ProgramSpec>,
    tools: &'a [Tool],
}

/// The effective configuration: defaults merged with the file.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ToolsConfig {
    pub tools: Vec<Tool>,
    pub terminal: Option<ProgramSpec>,
    pub warnings: Vec<String>,
}

impl ToolsConfig {
    pub fn find(&self, id: &str) -> Option<&Tool> {
        self.tools.iter().find(|t| t.id == id)
    }
}

/// What the frontend gets: no need to send program or arguments back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub id: String,
    pub label: String,
    pub shortcut: Option<String>,
    pub per_file: bool,
    pub file_limit: u32,
    pub needs_files: bool,
    /// For display only (tooltip).
    pub program: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedTools {
    pub tools: Vec<ToolInfo>,
    pub warnings: Vec<String>,
    pub file: Option<String>,
}

impl From<&Tool> for ToolInfo {
    fn from(t: &Tool) -> Self {
        Self {
            id: t.id.clone(),
            label: t.label.clone(),
            shortcut: t.shortcut.clone(),
            per_file: t.per_file,
            file_limit: t.file_limit,
            needs_files: needs_files(t),
            program: t.program.clone(),
        }
    }
}

// ---- defaults per OS ----

fn tool(id: &str, label: &str, program: &str, args: &[&str], per_file: bool, limit: u32) -> Tool {
    Tool {
        id: id.into(),
        label: label.into(),
        shortcut: None,
        program: program.into(),
        args: args.iter().map(|a| a.to_string()).collect(),
        per_file,
        file_limit: limit,
        working_dir: None,
    }
}

/// `edit` is what F4 starts. Terminal and "show in file manager" are actions, not tools.
pub fn defaults() -> Vec<Tool> {
    #[cfg(target_os = "macos")]
    {
        vec![
            tool(
                "edit",
                "Edit (text editor)",
                "open",
                &["-t", "{files}"],
                false,
                10,
            ),
            tool(
                "vscode",
                "Open in VS Code",
                "open",
                &["-a", "Visual Studio Code", "{files}"],
                false,
                20,
            ),
        ]
    }
    #[cfg(windows)]
    {
        vec![
            tool(
                "edit",
                "Edit (Notepad)",
                "notepad.exe",
                &["{file}"],
                true,
                5,
            ),
            tool(
                "vscode",
                "Open in VS Code",
                "code.cmd",
                &["{files}"],
                false,
                20,
            ),
            tool(
                "7zip",
                "Open with 7-Zip",
                "C:\\Program Files\\7-Zip\\7zFM.exe",
                &["{file}"],
                true,
                1,
            ),
        ]
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        vec![
            tool(
                "edit",
                "Edit (default app)",
                "xdg-open",
                &["{file}"],
                true,
                5,
            ),
            tool("vscode", "Open in VS Code", "code", &["{files}"], false, 20),
        ]
    }
}

// ---- loading ----

fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn text_ok(s: &str) -> bool {
    s.len() <= MAX_TEXT && !s.contains('\0')
}

/// Checks one tool; trims the label and clamps the file limit.
pub fn validate(mut t: Tool) -> Result<Tool, String> {
    if !valid_id(&t.id) {
        return Err(format!(
            "invalid id {:?} (letters, digits, _ - . only)",
            t.id
        ));
    }
    t.label = t.label.trim().to_string();
    if t.label.is_empty() || t.label.chars().count() > 100 {
        return Err(format!("tool {}: the label is empty or too long", t.id));
    }
    if t.program.trim().is_empty() || !text_ok(&t.program) || t.program.contains('{') {
        return Err(format!(
            "tool {}: the program is empty, too long or contains a placeholder",
            t.id
        ));
    }
    if t.args.len() > MAX_ARGS || !t.args.iter().all(|a| text_ok(a)) {
        return Err(format!("tool {}: too many or too long arguments", t.id));
    }
    if t.args
        .iter()
        .any(|a| a != "{files}" && a.contains("{files}"))
    {
        return Err(format!(
            "tool {}: {{files}} must be an argument of its own",
            t.id
        ));
    }
    if t.working_dir.as_deref().is_some_and(|w| !text_ok(w)) {
        return Err(format!("tool {}: the working folder is invalid", t.id));
    }
    if t.shortcut.as_deref().is_some_and(|s| s.len() > 64) {
        return Err(format!("tool {}: the shortcut is too long", t.id));
    }
    t.shortcut = t.shortcut.filter(|s| !s.trim().is_empty());
    t.file_limit = t.file_limit.clamp(1, MAX_FILE_LIMIT);
    Ok(t)
}

/// Splits a command line into words; `'…'` and `"…"` group (no escapes).
pub fn split_words(line: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote: Option<char> = None;
    for c in line.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                in_word = true;
            }
            None if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut cur));
                    in_word = false;
                }
            }
            None => {
                cur.push(c);
                in_word = true;
            }
        }
    }
    if quote.is_some() {
        return Err("unclosed quote".into());
    }
    if in_word {
        words.push(cur);
    }
    Ok(words)
}

/// `"control shift f"` / `"cmd+4"` → `"Mod+Shift+F"` (keymap notation, design 002).
pub fn convert_mr_shortcut(s: &str) -> Option<String> {
    let (mut m, mut ctrl, mut alt, mut shift, mut key) = (false, false, false, false, None);
    for t in s
        .split(|c: char| c.is_whitespace() || c == '+')
        .filter(|t| !t.is_empty())
    {
        match t.to_ascii_lowercase().as_str() {
            "cmd" | "meta" | "command" | "mod" => m = true,
            "control" | "ctrl" => {
                if cfg!(target_os = "macos") {
                    ctrl = true
                } else {
                    m = true
                }
            }
            "alt" | "option" | "opt" => alt = true,
            "shift" => shift = true,
            k => {
                let mut c = k.chars();
                let first = c.next()?;
                key = Some(first.to_uppercase().chain(c).collect::<String>());
            }
        }
    }
    let mut parts: Vec<String> = Vec::new();
    for (on, name) in [(m, "Mod"), (ctrl, "Ctrl"), (alt, "Alt"), (shift, "Shift")] {
        if on {
            parts.push(name.into());
        }
    }
    parts.push(key?);
    Some(parts.join("+"))
}

fn from_mr(m: MrTool) -> Result<Tool, String> {
    let line = format!("{} {}", m.cmd, m.para.unwrap_or_default());
    if line.contains("$clidir") || line.contains("$__dirname") {
        return Err(format!(
            "tool {}: $clidir/$__dirname (scripts of the old app) are not supported",
            m.id
        ));
    }
    let words = split_words(&line).map_err(|e| format!("tool {}: {e}", m.id))?;
    let Some((program, rest)) = words.split_first() else {
        return Err(format!("tool {}: empty command", m.id));
    };
    if program.contains('$') {
        return Err(format!("tool {}: the program contains a placeholder", m.id));
    }
    let args = rest
        .iter()
        .map(|w| w.replace("$file", "{file}").replace("$dir", "{dir}"))
        .collect();
    Ok(Tool {
        id: m.id,
        label: m.label,
        shortcut: m.shortcut.as_deref().and_then(convert_mr_shortcut),
        program: program.clone(),
        args,
        per_file: line.contains("$file"),
        file_limit: m.file_limit.unwrap_or(DEFAULT_FILE_LIMIT),
        working_dir: None,
    })
}

fn entry(v: Value) -> Result<Tool, String> {
    let is_mr = v.get("cmd").is_some() && v.get("program").is_none();
    let tool = if is_mr {
        from_mr(serde_json::from_value::<MrTool>(v).map_err(|e| e.to_string())?)?
    } else {
        serde_json::from_value::<Tool>(v).map_err(|e| e.to_string())?
    };
    validate(tool)
}

/// Merges a file text with the defaults. A broken file gives the defaults and a warning
/// (the file is left alone – it is the user's, edited by hand). A bare array (an mr
/// tools file) counts as `tools` without `replaceDefaults`.
pub fn parse(text: &str, defaults: Vec<Tool>) -> ToolsConfig {
    let value: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            return ToolsConfig {
                tools: defaults,
                terminal: None,
                warnings: vec![format!(
                    "tools.json is not valid JSON ({e}); using the defaults."
                )],
            };
        }
    };
    let file: FileFormat = match value {
        Value::Array(tools) => FileFormat {
            version: VERSION,
            replace_defaults: false,
            terminal: None,
            tools,
        },
        v => match serde_json::from_value(v) {
            Ok(f) => f,
            Err(e) => {
                return ToolsConfig {
                    tools: defaults,
                    terminal: None,
                    warnings: vec![format!(
                        "tools.json has the wrong shape ({e}); using the defaults."
                    )],
                };
            }
        },
    };
    let mut warnings = Vec::new();
    if file.version != VERSION {
        return ToolsConfig {
            tools: defaults,
            terminal: None,
            warnings: vec![format!(
                "tools.json has the unsupported version {}; using the defaults.",
                file.version
            )],
        };
    }
    let mut own: Vec<Tool> = Vec::new();
    for v in file.tools.into_iter().take(MAX_TOOLS) {
        match entry(v) {
            Ok(t) if own.iter().any(|o| o.id == t.id) => warnings.push(format!(
                "tool {}: the id is used twice; the first one counts",
                t.id
            )),
            Ok(t) => own.push(t),
            Err(e) => warnings.push(format!("Skipped a tool: {e}")),
        }
    }
    let terminal = match file.terminal {
        Some(t)
            if t.program.trim().is_empty()
                || !text_ok(&t.program)
                || t.program.contains('{')
                || t.args.len() > MAX_ARGS
                || !t.args.iter().all(|a| text_ok(a)) =>
        {
            warnings.push("The terminal entry is invalid; using the default terminal.".into());
            None
        }
        t => t,
    };
    let mut tools = if file.replace_defaults {
        Vec::new()
    } else {
        defaults
            .into_iter()
            .filter(|d| !own.iter().any(|o| o.id == d.id))
            .collect()
    };
    // own tools replace a default of the same id in its place, the rest is appended
    let mut rest = Vec::new();
    for t in own {
        match tools.iter().position(|d| d.id == t.id) {
            Some(i) => tools[i] = t,
            None => rest.push(t),
        }
    }
    tools.extend(rest);
    ToolsConfig {
        tools,
        terminal,
        warnings,
    }
}

/// Missing file → defaults; unreadable → defaults + warning.
pub fn load(file: &Path) -> ToolsConfig {
    match std::fs::read_to_string(file) {
        Ok(text) => parse(&text, defaults()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => ToolsConfig {
            tools: defaults(),
            ..ToolsConfig::default()
        },
        Err(e) => ToolsConfig {
            tools: defaults(),
            terminal: None,
            warnings: vec![format!(
                "tools.json could not be read ({e}); using the defaults."
            )],
        },
    }
}

/// Text of a new `tools.json` with the defaults written out.
pub fn default_file_text() -> String {
    let tools = defaults();
    let out = FileOut {
        version: VERSION,
        replace_defaults: false,
        terminal: None,
        tools: &tools,
    };
    serde_json::to_string_pretty(&out).unwrap_or_default() + "\n"
}

// ---- placeholders ----

/// Paths checked by the command layer: files exist, folders are folders.
#[derive(Debug, Clone, Default)]
pub struct ResolvedContext {
    pub files: Vec<PathBuf>,
    pub dir: Option<PathBuf>,
    pub target_dir: Option<PathBuf>,
    pub home: Option<PathBuf>,
}

/// One program start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub program: String,
    pub args: Vec<OsString>,
    pub cwd: Option<PathBuf>,
}

const FILE_PLACEHOLDERS: [&str; 3] = ["{file}", "{files}", "{name}"];

pub fn needs_files(t: &Tool) -> bool {
    t.args
        .iter()
        .chain(t.working_dir.iter())
        .any(|a| FILE_PLACEHOLDERS.iter().any(|p| a.contains(p)))
}

fn missing(what: &str) -> FsError {
    FsError::new(
        FsErrorCode::InvalidPath,
        format!("This tool needs {what}"),
        None,
    )
}

/// Replaces `{file}`, `{name}`, `{dir}`, `{targetDir}` inside one argument (it stays
/// one argument); unknown `{…}` stay as they are.
pub fn expand(
    template: &str,
    file: Option<&Path>,
    ctx: &ResolvedContext,
) -> Result<OsString, FsError> {
    let mut out = OsString::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push(&rest[..start]);
        let after = &rest[start..];
        let Some(end) = after.find('}') else {
            out.push(after);
            return Ok(out);
        };
        let token = &after[..=end];
        match token {
            "{file}" | "{files}" => out.push(file.ok_or_else(|| missing("a file"))?),
            "{name}" => out.push(
                file.and_then(|f| f.file_name())
                    .ok_or_else(|| missing("a file"))?,
            ),
            "{dir}" => out.push(ctx.dir.as_deref().ok_or_else(|| missing("a folder"))?),
            "{targetDir}" => out.push(
                ctx.target_dir
                    .as_deref()
                    .ok_or_else(|| missing("a target folder (other panel)"))?,
            ),
            other => out.push(other),
        }
        rest = &after[end + 1..];
    }
    out.push(rest);
    Ok(out)
}

/// The program starts for `tool` in `ctx` (pure; no I/O).
pub fn plan(tool: &Tool, ctx: &ResolvedContext) -> Result<Vec<Invocation>, FsError> {
    let files = &ctx.files;
    if needs_files(tool) && files.is_empty() {
        return Err(missing("a file (mark one or put the cursor on it)"));
    }
    if files.len() > tool.file_limit as usize {
        return Err(FsError::new(
            FsErrorCode::TooManyFiles,
            format!(
                "{} entries, but {} takes at most {}",
                files.len(),
                tool.label,
                tool.file_limit
            ),
            None,
        ));
    }
    let one = |file: Option<&Path>, all: &[PathBuf]| -> Result<Invocation, FsError> {
        let mut args = Vec::new();
        for a in &tool.args {
            if a == "{files}" {
                args.extend(all.iter().map(|f| f.as_os_str().to_os_string()));
            } else {
                args.push(expand(a, file, ctx)?);
            }
        }
        let cwd = match &tool.working_dir {
            Some(w) => Some(PathBuf::from(expand(w, file, ctx)?)),
            None => ctx.dir.clone().or_else(|| ctx.home.clone()),
        };
        Ok(Invocation {
            program: tool.program.clone(),
            args,
            cwd,
        })
    };
    if tool.per_file && !files.is_empty() {
        files
            .iter()
            .map(|f| one(Some(f), std::slice::from_ref(f)))
            .collect()
    } else {
        Ok(vec![one(files.first().map(PathBuf::as_path), files)?])
    }
}

// ---- starting ----

/// The `Command` of an invocation: argument array, no shell.
pub fn command(inv: &Invocation) -> Command {
    let mut c = Command::new(&inv.program);
    c.args(&inv.args);
    if let Some(d) = &inv.cwd {
        c.current_dir(d);
    }
    c
}

/// Starts detached from the app: no stdin/stdout/stderr, own process group
/// (Unix), a thread reaps it (no zombie). A missing program is `program_not_found`.
pub fn spawn_detached(mut cmd: Command, program: &str) -> Result<(), FsError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| spawn_error(&e, program))?;
    let _ = std::thread::Builder::new()
        .name("fnf-tool-reaper".into())
        .spawn(move || {
            let _ = child.wait();
        });
    Ok(())
}

pub fn spawn_error(e: &io::Error, program: &str) -> FsError {
    if e.kind() == io::ErrorKind::NotFound {
        FsError::new(
            FsErrorCode::ProgramNotFound,
            format!("The program \"{program}\" was not found"),
            None,
        )
    } else {
        FsError::new(
            FsErrorCode::Io,
            format!("\"{program}\" could not be started: {e}"),
            None,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn t(args: &[&str], per_file: bool) -> Tool {
        tool("x", "X", "prog", args, per_file, 10)
    }

    fn ctx(files: &[&str]) -> ResolvedContext {
        ResolvedContext {
            files: files.iter().map(PathBuf::from).collect(),
            dir: Some(PathBuf::from("/src dir")),
            target_dir: Some(PathBuf::from("/target")),
            home: Some(PathBuf::from("/home/u")),
        }
    }

    fn args(inv: &Invocation) -> Vec<String> {
        inv.args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn placeholders_stay_one_argument() {
        let p = plan(
            &t(
                &[
                    "--file={file}",
                    "-n",
                    "{name}",
                    "{dir}",
                    "to {targetDir}",
                    "{other}",
                ],
                false,
            ),
            &ctx(&["/a b/Brief ä.txt"]),
        )
        .unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(
            args(&p[0]),
            [
                "--file=/a b/Brief ä.txt",
                "-n",
                "Brief ä.txt",
                "/src dir",
                "to /target",
                "{other}"
            ]
        );
        assert_eq!(p[0].cwd.as_deref(), Some(Path::new("/src dir")));
    }

    #[test]
    fn files_expand_to_several_arguments_or_one_start_each() {
        let c = ctx(&["/a/1", "/a/2", "/a/3"]);
        let p = plan(&t(&["-x", "{files}"], false), &c).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(args(&p[0]), ["-x", "/a/1", "/a/2", "/a/3"]);
        let p = plan(&t(&["{file}"], true), &c).unwrap();
        assert_eq!(
            p.iter().map(args).collect::<Vec<_>>(),
            [["/a/1"], ["/a/2"], ["/a/3"]]
        );
        let p = plan(&t(&["{files}"], true), &c).unwrap();
        assert_eq!(p.len(), 3);
        // not per file: {file} is the first one
        let p = plan(&t(&["{file}"], false), &c).unwrap();
        assert_eq!(args(&p[0]), ["/a/1"]);
    }

    #[test]
    fn limits_and_missing_context() {
        let mut tl = t(&["{file}"], true);
        tl.file_limit = 2;
        let e = plan(&tl, &ctx(&["/1", "/2", "/3"])).unwrap_err();
        assert_eq!(e.code, FsErrorCode::TooManyFiles);
        assert_eq!(
            plan(&tl, &ctx(&[])).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        // a tool without file placeholders needs no files
        let p = plan(&t(&["{dir}"], false), &ctx(&[])).unwrap();
        assert_eq!(args(&p[0]), ["/src dir"]);
        let mut c = ctx(&[]);
        c.target_dir = None;
        assert_eq!(
            plan(&t(&["{targetDir}"], false), &c).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
        // no folder: working dir falls back to home
        c.dir = None;
        assert_eq!(
            plan(&t(&["x"], false), &c).unwrap()[0].cwd.as_deref(),
            Some(Path::new("/home/u"))
        );
        let mut w = t(&[], false);
        w.working_dir = Some("{targetDir}".into());
        assert_eq!(
            plan(&w, &ctx(&[])).unwrap()[0].cwd.as_deref(),
            Some(Path::new("/target"))
        );
    }

    #[test]
    fn validation() {
        assert!(validate(t(&["{file}"], true)).is_ok());
        let mut bad = t(&[], false);
        bad.id = "a b".into();
        assert!(validate(bad).is_err());
        let mut bad = t(&[], false);
        bad.program = "{file}".into();
        assert!(validate(bad).is_err());
        assert!(validate(t(&["--all={files}"], false)).is_err());
        let mut bad = t(&[], false);
        bad.label = "  ".into();
        assert!(validate(bad).is_err());
        let mut many = t(&[], false);
        many.args = vec!["a".into(); MAX_ARGS + 1];
        assert!(validate(many).is_err());
        let mut clamp = t(&[], false);
        clamp.file_limit = 0;
        assert_eq!(validate(clamp).unwrap().file_limit, 1);
    }

    #[test]
    fn words_and_mr_shortcuts() {
        assert_eq!(
            split_words(r#" open -a "Visual Studio Code"  'x y' $file "#).unwrap(),
            ["open", "-a", "Visual Studio Code", "x y", "$file"]
        );
        assert_eq!(split_words(r#"a "" b"#).unwrap(), ["a", "", "b"]);
        assert!(split_words("a \"b").is_err());
        assert_eq!(
            convert_mr_shortcut("cmd shift f").as_deref(),
            Some("Mod+Shift+F")
        );
        assert_eq!(convert_mr_shortcut("f4").as_deref(), Some("F4"));
        let ctrl = if cfg!(target_os = "macos") {
            "Ctrl+Alt+C"
        } else {
            "Mod+Alt+C"
        };
        assert_eq!(convert_mr_shortcut("control alt c").as_deref(), Some(ctrl));
        assert_eq!(convert_mr_shortcut("shift"), None);
    }

    #[test]
    fn mr_format_is_imported() {
        let text = r#"[
          {"id":"CMD_EDIT_FILE","label":"Edit","shortcut":"cmd shift 4","cmd":"code ","fileLimit":4,"para":" $file ","local":true},
          {"id":"CMD_SHELL","label":"Local Shell","shortcut":"cmd 0","cmd":"$clidir/linux-open-terminal.sh","para":" $dir "},
          {"id":"CMD_REVEAL","label":"Reveal","cmd":"open ","para":" $dir "}
        ]"#;
        let c = parse(text, vec![]);
        assert_eq!(c.warnings.len(), 1, "{:?}", c.warnings);
        assert!(c.warnings[0].contains("$clidir"));
        let edit = c.find("CMD_EDIT_FILE").unwrap();
        assert_eq!(edit.program, "code");
        assert_eq!(edit.args, ["{file}"]);
        assert!(edit.per_file);
        assert_eq!(edit.file_limit, 4);
        assert_eq!(edit.shortcut.as_deref(), Some("Mod+Shift+4"));
        let reveal = c.find("CMD_REVEAL").unwrap();
        assert_eq!(
            (reveal.program.as_str(), reveal.args.as_slice()),
            ("open", &["{dir}".to_string()][..])
        );
        assert!(!reveal.per_file && !needs_files(reveal));
    }

    #[test]
    fn file_merges_with_the_defaults() {
        let defaults = vec![t(&["a"], false), tool("y", "Y", "p", &[], false, 1)];
        let text = r#"{"version":1,"tools":[
            {"id":"y","label":"Own Y","program":"q"},
            {"id":"z","label":"Z","program":"r","args":["{files}"]},
            {"id":"z","label":"Z2","program":"r"},
            {"id":"bad id","label":"B","program":"r"},
            42
        ],"terminal":{"program":"open","args":["-a","iTerm","{dir}"]}}"#;
        let c = parse(text, defaults.clone());
        assert_eq!(
            c.tools.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["x", "y", "z"]
        );
        assert_eq!(c.find("y").unwrap().label, "Own Y");
        assert_eq!(c.find("z").unwrap().file_limit, DEFAULT_FILE_LIMIT);
        assert_eq!(c.warnings.len(), 3, "{:?}", c.warnings);
        assert_eq!(c.terminal.as_ref().unwrap().args, ["-a", "iTerm", "{dir}"]);
        let c = parse(
            r#"{"version":1,"replaceDefaults":true,"tools":[]}"#,
            defaults.clone(),
        );
        assert!(c.tools.is_empty());
        for broken in ["{nope", r#"{"version":2}"#, r#"{"tools":"x"}"#] {
            let c = parse(broken, defaults.clone());
            assert_eq!(c.tools, defaults);
            assert_eq!(c.warnings.len(), 1);
        }
        let c = parse(
            r#"{"version":1,"terminal":{"program":""}}"#,
            defaults.clone(),
        );
        assert!(c.terminal.is_none() && c.warnings.len() == 1);
    }

    #[test]
    fn defaults_are_valid_and_the_new_file_parses_back() {
        let d = defaults();
        assert!(d.iter().any(|t| t.id == "edit"));
        for t in &d {
            assert_eq!(validate(t.clone()).as_ref(), Ok(t));
        }
        let c = parse(&default_file_text(), defaults());
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.tools, d);
        let dir = tempdir().unwrap();
        assert_eq!(load(&dir.path().join("missing.json")).tools, d);
    }

    #[test]
    fn a_missing_program_is_reported() {
        let inv = Invocation {
            program: "fnf-no-such-program-011".into(),
            args: vec![],
            cwd: None,
        };
        let e = spawn_detached(command(&inv), &inv.program).unwrap_err();
        assert_eq!(e.code, FsErrorCode::ProgramNotFound);
        assert!(e.message.contains("fnf-no-such-program-011"));
    }

    /// Acceptance criterion 011: a file name like `"; rm -rf ~"` is an argument,
    /// nothing else – no shell sees it.
    #[cfg(unix)]
    #[test]
    fn file_names_are_never_run_as_commands() {
        let dir = tempdir().unwrap();
        let names = [
            "\"; rm -rf ~\"",
            "$(touch PWNED)",
            "`touch PWNED2`",
            "a && touch PWNED3; echo",
            "x | tee PWNED4",
            "new\nline",
        ];
        let files: Vec<PathBuf> = names.iter().map(|n| dir.path().join(n)).collect();
        for f in &files {
            fs::write(f, "x").unwrap();
        }
        let printf = ["/usr/bin/printf", "/bin/printf"]
            .into_iter()
            .find(|p| Path::new(p).exists())
            .expect("printf");
        let echo = tool("echo", "Echo", printf, &["%s|", "{files}"], false, 10);
        let c = ResolvedContext {
            files: files.clone(),
            dir: Some(dir.path().to_path_buf()),
            target_dir: None,
            home: None,
        };
        let inv = plan(&echo, &c).unwrap();
        let out = command(&inv[0]).output().unwrap();
        assert!(out.status.success());
        let expected: String = files.iter().map(|f| format!("{}|", f.display())).collect();
        assert_eq!(String::from_utf8_lossy(&out.stdout), expected);
        // also detached, per file, with {name} inside an argument
        let per = tool("n", "N", printf, &["name=%s", "{name}"], true, 10);
        for inv in plan(&per, &c).unwrap() {
            spawn_detached(command(&inv), printf).unwrap();
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        for p in ["PWNED", "PWNED2", "PWNED3", "PWNED4"] {
            assert!(!dir.path().join(p).exists(), "{p} was created");
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), names.len());
    }
}
