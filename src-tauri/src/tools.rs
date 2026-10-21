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
/// `perFile` starts at most this many programs per call (review 011 #7) – more
/// would flood the desktop with windows; `fileLimit` may be higher for `{files}`.
pub const MAX_PER_FILE_STARTS: usize = 50;
/// Programs that hand their arguments to the default app: their files are checked
/// like Enter (design 003 E2) – a script would be *run*, not opened (review 011 #1).
const DEFAULT_APP_LAUNCHERS: &[&str] = &[
    "xdg-open",
    "gio",
    "kde-open",
    "kde-open5",
    "gnome-open",
    "exo-open",
    "open",
    "explorer",
    "explorer.exe",
];

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
    /// Working folder (placeholders allowed, absolute after replacing); default
    /// `{dir}`, else the home folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    /// The program hands files to the default app (like `xdg-open`): executables
    /// need a confirmation. Known launchers count without this flag.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub default_app: bool,
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
        default_app: false,
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

/// A program is a bare name (looked up in `PATH`) or an absolute path – never
/// relative to the working folder, which is the panel's folder (review 011 #4).
pub fn program_ok(p: &str) -> bool {
    let p = p.trim();
    if p.is_empty() || !text_ok(p) || p.contains('{') {
        return false;
    }
    if Path::new(p).is_absolute() {
        return true;
    }
    !p.contains(['/', '\\', ':']) && p != "." && p != ".."
}

/// A label for menus and buttons: control characters (line breaks, tabs, escapes)
/// become spaces, runs of whitespace one space (a native menu rejects them, review 014 #4).
pub fn clean_label(label: &str) -> String {
    label
        .split(|c: char| c.is_control() || c.is_whitespace())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Checks one tool; cleans the label and clamps the file limit.
pub fn validate(mut t: Tool) -> Result<Tool, String> {
    if !valid_id(&t.id) {
        return Err(format!(
            "invalid id {:?} (letters, digits, _ - . only)",
            t.id
        ));
    }
    t.label = clean_label(&t.label);
    if t.label.is_empty() || t.label.chars().count() > 100 {
        return Err(format!("tool {}: the label is empty or too long", t.id));
    }
    if !program_ok(&t.program) {
        return Err(format!(
            "tool {}: the program must be a name (found in PATH) or an absolute path, without placeholders",
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
        default_app: false,
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

/// One entry of an mr tools file (`tool/custom/<os>.json`, design 026 E8); the error is a
/// reason code: `old_script` (`$clidir`/`$__dirname`) or `invalid`.
pub fn from_mr_value(v: Value) -> Result<Tool, &'static str> {
    let m: MrTool = serde_json::from_value(v).map_err(|_| "invalid")?;
    let line = format!("{} {}", m.cmd, m.para.as_deref().unwrap_or_default());
    if line.contains("$clidir") || line.contains("$__dirname") {
        return Err("old_script");
    }
    from_mr(m).and_then(validate).map_err(|_| "invalid")
}

/// The user's `tools.json` (text, `None` = no file) with `imported` merged in: an own tool of
/// the same id is replaced in place, the others are appended; `replace` = the own tools are
/// only the imported ones. `terminal` and `replaceDefaults` stay (design 026 E8).
pub fn merge_file(
    existing: Option<&str>,
    imported: Vec<Tool>,
    replace: bool,
) -> Result<Value, String> {
    let file = match existing {
        None => FileFormat {
            version: VERSION,
            replace_defaults: false,
            terminal: None,
            tools: Vec::new(),
        },
        Some(text) => {
            let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
            check_file(&value)?;
            match value {
                Value::Array(tools) => FileFormat {
                    version: VERSION,
                    replace_defaults: false,
                    terminal: None,
                    tools,
                },
                v => serde_json::from_value(v).map_err(|e| e.to_string())?,
            }
        }
    };
    let mut own = if replace { Vec::new() } else { file.tools };
    for t in imported {
        let t = validate(t)?;
        let id = Value::String(t.id.clone());
        let v = serde_json::to_value(&t).map_err(|e| e.to_string())?;
        match own.iter().position(|o| o.get("id") == Some(&id)) {
            Some(i) => own[i] = v,
            None => own.push(v),
        }
    }
    if own.len() > MAX_TOOLS {
        // review 026 #6: never drop tools silently
        return Err("too_many".into());
    }
    Ok(serde_json::json!({
        "version": VERSION,
        "replaceDefaults": file.replace_defaults,
        "terminal": file.terminal,
        "tools": own,
    }))
}

/// Whether `v` is a usable `tools.json` (shape and version; single tools are checked on load).
pub fn check_file(v: &Value) -> Result<(), String> {
    match v {
        Value::Array(_) => Ok(()),
        Value::Object(_) => match serde_json::from_value::<FileFormat>(v.clone()) {
            Ok(f) if f.version == VERSION => Ok(()),
            Ok(f) => Err(format!("unsupported version {}", f.version)),
            Err(e) => Err(e.to_string()),
        },
        _ => Err("no JSON object".into()),
    }
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
            if !program_ok(&t.program)
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

const FILE_PLACEHOLDERS: [&str; 5] = ["{file}", "{files}", "{name}", "{stem}", "{ext}"];

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

/// Replaces `{file}`, `{name}`, `{stem}`, `{ext}`, `{dir}`, `{targetDir}` inside one argument (it stays
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
            "{name}" => {
                let name = file
                    .and_then(|f| f.file_name())
                    .ok_or_else(|| missing("a file"))?;
                // at the start of an argument, `-rf` would be an option: `./-rf`
                if out.is_empty() && name.as_encoded_bytes().first() == Some(&b'-') {
                    out.push(".");
                    out.push(std::path::MAIN_SEPARATOR_STR);
                }
                out.push(name);
            }
            "{stem}" => {
                // the name without its last extension (`.bashrc` stays `.bashrc`, starter 032)
                let stem = file
                    .and_then(|f| f.file_stem())
                    .ok_or_else(|| missing("a file"))?;
                if out.is_empty() && stem.as_encoded_bytes().first() == Some(&b'-') {
                    out.push(".");
                    out.push(std::path::MAIN_SEPARATOR_STR);
                }
                out.push(stem);
            }
            "{ext}" => {
                let f = file.ok_or_else(|| missing("a file"))?;
                out.push(f.extension().unwrap_or_default());
            }
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
    if tool.per_file && files.len() > MAX_PER_FILE_STARTS {
        return Err(FsError::new(
            FsErrorCode::TooManyFiles,
            format!(
                "{} entries, but {} starts once per file (perFile) – at most {} at a time",
                files.len(),
                tool.label,
                MAX_PER_FILE_STARTS
            ),
            None,
        ));
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
            Some(w) => {
                let d = PathBuf::from(expand(w, file, ctx)?);
                if !d.is_absolute() {
                    return Err(FsError::new(
                        FsErrorCode::InvalidPath,
                        format!(
                            "{}: the working folder must be an absolute path",
                            tool.label
                        ),
                        None,
                    ));
                }
                Some(d)
            }
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

/// Does `tool` hand its files to the default app (flag or a known launcher)?
pub fn uses_default_app(tool: &Tool) -> bool {
    if tool.default_app {
        return true;
    }
    let name = tool
        .program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    DEFAULT_APP_LAUNCHERS.contains(&name.as_str())
}

/// For default-app tools: every file passes the Enter check (design 003 E2) –
/// an executable gives `executable` (the frontend asks, then repeats with
/// `allow_executable`). Folders are fine (the file manager opens them).
pub fn check_default_app_files(
    tool: &Tool,
    files: &[PathBuf],
    allow_executable: bool,
) -> Result<(), FsError> {
    if !uses_default_app(tool) {
        return Ok(());
    }
    for f in files {
        match crate::opener::check_openable(f, allow_executable) {
            Err(e) if e.code == FsErrorCode::NotAFile => {}
            other => other?,
        }
    }
    Ok(())
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
        // control characters would break the native menu (review 014 #4)
        let mut ctl = t(&[], false);
        ctl.label = " Ed\nit\u{7}\tnow ".into();
        assert_eq!(validate(ctl).unwrap().label, "Ed it now");
        let mut only = t(&[], false);
        only.label = "\u{1b}\u{7}".into();
        assert!(validate(only).is_err());
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

    /// Review 011 #1: tools that hand files to the default app ask like Enter does.
    #[cfg(unix)]
    #[test]
    fn default_app_tools_check_executables() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let script = dir.path().join("run");
        fs::write(&script, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let doc = dir.path().join("Brief ä.txt");
        fs::write(&doc, "x").unwrap();
        let sub = dir.path().join("Ordner");
        fs::create_dir(&sub).unwrap();
        for program in [
            "xdg-open",
            "/usr/bin/xdg-open",
            "open",
            "explorer.exe",
            "gio",
        ] {
            let t = tool("edit", "Edit", program, &["{file}"], true, 5);
            assert!(uses_default_app(&t), "{program}");
        }
        let mut flagged = tool("x", "X", "my-launcher", &["{file}"], true, 5);
        flagged.default_app = true;
        assert!(uses_default_app(&flagged));
        let editor = tool("code", "Code", "code", &["{files}"], false, 5);
        assert!(!uses_default_app(&editor));
        let edit = tool("edit", "Edit", "xdg-open", &["{file}"], true, 5);
        let e = check_default_app_files(&edit, &[doc.clone(), script.clone()], false).unwrap_err();
        assert_eq!(e.code, FsErrorCode::Executable);
        assert_eq!(e.path.as_deref(), Some(script.to_string_lossy().as_ref()));
        check_default_app_files(&edit, &[doc.clone(), script.clone()], true).unwrap();
        check_default_app_files(&edit, &[doc.clone(), sub.clone()], false).unwrap();
        // an editor gets the script as text: no question
        check_default_app_files(&editor, std::slice::from_ref(&script), false).unwrap();
    }

    /// Review 011 #2: `{name}` at the start of an argument never becomes an option.
    #[test]
    fn names_with_a_leading_dash_are_no_options() {
        let p = plan(
            &t(&["{name}", "--title={name}", "{file}"], false),
            &ctx(&["/a/-rf"]),
        )
        .unwrap();
        assert_eq!(args(&p[0]), ["./-rf", "--title=-rf", "/a/-rf"]);
        let p = plan(&t(&["{name}"], false), &ctx(&["/a/x-y"])).unwrap();
        assert_eq!(args(&p[0]), ["x-y"]);
    }

    /// Review 011 #4: program = bare name (PATH) or absolute; working folder absolute.
    #[test]
    fn programs_and_working_folders_are_not_relative() {
        for ok in ["code", "notepad.exe", "xdg-open"] {
            let mut x = t(&[], false);
            x.program = ok.into();
            assert!(validate(x).is_ok(), "{ok}");
        }
        #[cfg(unix)]
        {
            let mut x = t(&[], false);
            x.program = "/usr/bin/code".into();
            assert!(validate(x).is_ok());
        }
        for bad in ["./run.sh", "bin/tool", "..\\x.exe", "..", ".", "C:tool.exe"] {
            let mut x = t(&[], false);
            x.program = bad.into();
            assert!(validate(x).is_err(), "{bad}");
        }
        let c = parse(r#"{"version":1,"terminal":{"program":"./term"}}"#, vec![]);
        assert!(c.terminal.is_none() && c.warnings.len() == 1);
        let mut w = t(&["{file}"], false);
        w.working_dir = Some("rel/{name}".into());
        assert_eq!(
            plan(&w, &ctx(&["/a/b.txt"])).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
    }

    /// Review 011 #7: `perFile` starts at most MAX_PER_FILE_STARTS programs at once.
    #[test]
    fn per_file_starts_are_bounded() {
        let mut x = t(&["{file}"], true);
        x.file_limit = MAX_FILE_LIMIT;
        let many: Vec<String> = (0..=MAX_PER_FILE_STARTS)
            .map(|i| format!("/a/{i}"))
            .collect();
        let names: Vec<&str> = many.iter().map(String::as_str).collect();
        let e = plan(&x, &ctx(&names)).unwrap_err();
        assert_eq!(e.code, FsErrorCode::TooManyFiles);
        assert!(e.message.contains("perFile"), "{}", e.message);
        assert_eq!(
            plan(&x, &ctx(&names[..MAX_PER_FILE_STARTS])).unwrap().len(),
            MAX_PER_FILE_STARTS
        );
        // one start with all files is not bounded by this
        x.per_file = false;
        x.args = vec!["{files}".into()];
        assert_eq!(plan(&x, &ctx(&names)).unwrap().len(), 1);
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
