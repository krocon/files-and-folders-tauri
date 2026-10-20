//! mr action ids and shortcut notation → ours (design 026 E4/E5). Pure functions.
//! The id table follows `docs/feature-parity.md` section A.

/// The OS of an mr file (`shortcut/custom/<os>.json`, `tool/custom/<os>.json`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MrOs {
    Osx,
    Windows,
    Linux,
}

impl MrOs {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            MrOs::Osx
        } else if cfg!(target_os = "windows") {
            MrOs::Windows
        } else {
            MrOs::Linux
        }
    }

    /// File stem of mr's per-OS files.
    pub fn name(self) -> &'static str {
        match self {
            MrOs::Osx => "osx",
            MrOs::Windows => "windows",
            MrOs::Linux => "linux",
        }
    }
}

/// mr ids that kept their name.
const SAME: &[&str] = &[
    "OPEN_CALL_ACTION_DLG",
    "COPY_2_CLIPBOARD_FULLNAMES",
    "COPY_2_CLIPBOARD_FULLNAMES_AS_JSON",
    "COPY_2_CLIPBOARD_NAMES",
    "COPY_2_CLIPBOARD_NAMES_AS_JSON",
    "DESELECT_ALL",
    "NAVIGATE_BACK",
    "NAVIGATE_FORWARD",
    "NEXT_TAB",
    "OPEN_ABOUT_DLG",
    "OPEN_ATTRIBUTE_DLG",
    "OPEN_CHDIR_DLG",
    "OPEN_COPY_DLG",
    "OPEN_DELETE_DLG",
    "OPEN_DELETE_EMPTY_FOLDERS_DLG",
    "OPEN_EDIT_DLG",
    "OPEN_FIND_DLG",
    "OPEN_GROUPFILES_DLG",
    "OPEN_MKDIR_DLG",
    "OPEN_MOVE_DLG",
    "OPEN_MULTIMKDIR_DLG",
    "OPEN_MULTIRENAME_DLG",
    "OPEN_RENAME_DLG",
    "OPEN_SETUP_DLG",
    "OPEN_THEMES_DLG",
    "OPEN_BUTTON_CONFIG_DLG",
    "OPEN_FILETYPE_CONFIG_DLG",
    "OPEN_TOOL_CONFIG_DLG",
    "OPEN_SHORTCUT_DLG",
    "OPEN_UNPACK_DLG",
    "OPEN_PACK_DLG",
    "OPEN_VIEW_DLG",
    "OPEN_CREATE_FILE_DLG",
    "OPEN_TASK_DLG",
    "RELOAD_DIR",
    "SELECT_ALL",
    "SELECT_LEFT_PANEL",
    "SELECT_RIGHT_PANEL",
    "TOGGLE_FILTER",
    "TOGGLE_HIDDEN_FILES",
    "TOGGLE_PANEL",
    "TOGGLE_SHELL",
];

/// Renamed ids (old → new).
const RENAMED: &[(&str, &str)] = &[
    ("ADD_NEW_TAB", "CLONE_TAB"),
    ("REMOVE_TAB", "CLOSE_TAB"),
    ("DESELECT", "DESELECT_ALL"),
    ("ENHANCE_SELECTION", "OPEN_MARK_PATTERN_DLG"),
    ("OPEN_SELECT_DLG", "OPEN_MARK_PATTERN_DLG"),
    ("REDUCE_SELECTION", "OPEN_UNMARK_PATTERN_DLG"),
    ("OPEN_DESELECT_DLG", "OPEN_UNMARK_PATTERN_DLG"),
    ("ENTER_PRESSED", "NAVIGATE_OPEN"),
    ("NAVIGATE_LEVEL_DOWN", "NAVIGATE_PARENT"),
    ("OPEN_FIND_DUBLICATES_DLG", "OPEN_FIND_DUPLICATES_DLG"),
    ("OPEN_GOTO_ANYTHING_DLG", "OPEN_COMMAND_PALETTE"),
    ("OPEN_JOB_QUEUE_DLG", "OPEN_TASK_DLG"),
    ("OPEN_MENU", "OPEN_ACTIONS_MENU"),
    ("OPEN_COLORCONFIG_DLG", "OPEN_THEMES_DLG"),
    ("OPEN_THEME_CONFIG_DLG", "OPEN_THEMES_DLG"),
    ("SPACE_PRESSED", "TOGGLE_MARK_AND_ADVANCE"),
    ("SHIFT_SPACE_PRESSED", "TOGGLE_MARK_AND_RETREAT"),
    ("TOGGLE_SELECTION", "INVERT_MARKS"),
    ("TOGGLE_SELECTION_CURRENT_ROW", "TOGGLE_MARK"),
    ("CMD_SHELL", "OPEN_TERMINAL_HERE"),
    ("CMD_REVEAL_IN_FINDER", "REVEAL_IN_FILE_MANAGER"),
];

/// Keys the GuiExpert Table owns now (design 002 D6).
const TABLE_NAVIGATION: &[&str] = &[
    "ARROW_UP",
    "ARROW_DOWN",
    "HOME_PRESSED",
    "END_PRESSED",
    "PAGEUP_PRESSED",
    "PAGEDOWN_PRESSED",
];

/// Functions that are gone or have no single action (parity ✖ rows).
const NO_EQUIVALENT: &[&str] = &[
    "SAVE_CONFIG",
    "RELOAD_DIR_0",
    "RELOAD_DIR_1",
    "OPEN_SHELL_DLG",
    "OPEN_DOWNLOAD_DLG",
    "OPEN_PROMPT_CONFIG_DLG",
    "PRINT_DEBUG",
    "DUMMY_ACTION",
    "DO_NOTHING",
    "EDIT_FILE",
    "-",
];

/// mr id → our id, or the reason why there is none.
pub fn map_action(id: &str) -> Result<String, &'static str> {
    if SAME.contains(&id) {
        return Ok(id.to_string());
    }
    if let Some((_, new)) = RENAMED.iter().find(|(old, _)| *old == id) {
        return Ok((*new).to_string());
    }
    if TABLE_NAVIGATION.contains(&id) {
        return Err("table_navigation");
    }
    if NO_EQUIVALENT.contains(&id) || id.starts_with("CHANGE_LAF_") {
        return Err("no_equivalent");
    }
    Err("unknown_action")
}

const MODIFIERS: [&str; 4] = ["ctrl", "alt", "shift", "cmd"];

fn modifier(token: &str) -> Option<usize> {
    let t = match token {
        "control" => "ctrl",
        "meta" | "command" => "cmd",
        "option" => "alt",
        t => t,
    };
    MODIFIERS.iter().position(|m| *m == t)
}

/// † (mr bug 1): mr built the event string in the order `ctrl+alt+shift+cmd` and compared
/// it raw with the key of the file, and `delete`/`plus`/`minus` came as `del`/`+`/`-`.
pub fn never_fired(raw: &str) -> bool {
    raw.split_whitespace().any(|stroke| {
        let tokens: Vec<String> = stroke.split('+').map(str::to_lowercase).collect();
        let (key, mods) = tokens.split_last().expect("split yields one item");
        let mut last: Option<usize> = None;
        for m in mods {
            match modifier(m) {
                Some(i) if last.is_none_or(|l| i > l) => last = Some(i),
                _ => return true,
            }
        }
        matches!(key.as_str(), "delete" | "plus" | "minus")
    })
}

fn key_name(token: &str) -> Option<String> {
    let t = token.to_lowercase();
    if t.chars().count() == 1 {
        let c = t.chars().next()?;
        return if c.is_ascii_alphanumeric() {
            Some(c.to_ascii_uppercase().to_string())
        } else if c.is_ascii_punctuation() && c != '+' {
            Some(c.to_string())
        } else {
            None
        };
    }
    if let Some(n) = t.strip_prefix('f').and_then(|n| n.parse::<u8>().ok())
        && (1..=24).contains(&n)
    {
        return Some(format!("F{n}"));
    }
    let named = match t.as_str() {
        "up" | "arrowup" => "ArrowUp",
        "down" | "arrowdown" => "ArrowDown",
        "left" | "arrowleft" => "ArrowLeft",
        "right" | "arrowright" => "ArrowRight",
        "space" => "Space",
        "enter" | "return" => "Enter",
        "tab" => "Tab",
        "esc" | "escape" => "Escape",
        "backspace" => "Backspace",
        "delete" | "del" => "Delete",
        "insert" | "ins" => "Insert",
        "home" => "Home",
        "end" => "End",
        "pageup" | "pgup" => "PageUp",
        "pagedown" | "pgdn" => "PageDown",
        "plus" => "plus",
        "minus" => "-",
        _ => return None,
    };
    Some(named.to_string())
}

/// `ctrl+cmd+g` → `Mod+Ctrl+G` (macOS) / `Mod+G` (Ctrl, Windows/Linux); chords per stroke.
/// Errors: `meta_key` (`cmd` = Windows key outside macOS), `unknown_key`.
pub fn translate_shortcut(raw: &str, os: MrOs) -> Result<String, &'static str> {
    let mut strokes = Vec::new();
    for stroke in raw.split_whitespace() {
        let tokens: Vec<String> = stroke.split('+').map(str::to_lowercase).collect();
        let (key, mods) = tokens.split_last().ok_or("unknown_key")?;
        let (mut m, mut ctrl, mut alt, mut shift) = (false, false, false, false);
        for t in mods {
            match modifier(t) {
                Some(0) if os == MrOs::Osx => ctrl = true,
                Some(0) => m = true,
                Some(1) => alt = true,
                Some(2) => shift = true,
                Some(_) if os == MrOs::Osx => m = true,
                Some(_) => return Err("meta_key"),
                None => return Err("unknown_key"),
            }
        }
        let key = key_name(key).ok_or("unknown_key")?;
        let mut parts: Vec<&str> = Vec::new();
        for (on, name) in [(m, "Mod"), (ctrl, "Ctrl"), (alt, "Alt"), (shift, "Shift")] {
            if on {
                parts.push(name);
            }
        }
        parts.push(&key);
        strokes.push(parts.join("+"));
    }
    if strokes.is_empty() || strokes.len() > 2 {
        return Err("unknown_key");
    }
    Ok(strokes.join(" "))
}
