//! Native application menu (design 014 E5–E7).
//!
//! The frontend owns the menu model (every item is an action of its catalog) and
//! sends a [`MenuSpec`] with shortcuts in the keymap notation. This module
//! validates the spec, turns safe shortcuts into native accelerators and builds
//! the Tauri menu. Pure parts (validation, accelerators) are unit-tested; the
//! build needs a running app.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Runtime};

/// Limits of a spec – a menu bar has ~150 entries; anything far beyond is a bug.
pub const MAX_NODES: usize = 600;
pub const MAX_DEPTH: usize = 3;
pub const MAX_LABEL: usize = 120;
pub const MAX_ID: usize = 80;

/// One node of a menu (`kind` tag, camelCase like all DTOs).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MenuNode {
    /// An action: `id` comes back in a [`MenuEvent`].
    #[serde(rename_all = "camelCase")]
    Item {
        id: String,
        label: String,
        /// Shortcut in keymap notation (`Mod+Shift+P`), already resolved with the override.
        #[serde(default)]
        accelerator: Option<String>,
        enabled: bool,
    },
    Submenu {
        label: String,
        items: Vec<MenuNode>,
    },
    Separator,
    /// A native item of the OS (Edit → Copy, Quit, …), see [`PREDEFINED`].
    Predefined {
        name: String,
    },
}

/// The menu bar: top-level nodes must be submenus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MenuSpec {
    pub menus: Vec<MenuNode>,
}

/// A chosen menu item (sent over the menu channel).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MenuEvent {
    pub id: String,
}

/// Native items the frontend may ask for.
pub const PREDEFINED: &[&str] = &[
    "about",
    "services",
    "hide",
    "hideOthers",
    "showAll",
    "quit",
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "selectAll",
    "minimize",
    "maximize",
    "fullscreen",
    "closeWindow",
];

/// Checks form and size of a spec; the message names the first problem.
pub fn validate_spec(spec: &MenuSpec) -> Result<(), String> {
    let mut count = 0usize;
    let mut ids = HashSet::new();
    for top in &spec.menus {
        if !matches!(top, MenuNode::Submenu { .. }) {
            return Err("top-level entries must be submenus".into());
        }
        validate_node(top, 1, &mut count, &mut ids)?;
    }
    Ok(())
}

fn validate_node<'a>(
    node: &'a MenuNode,
    depth: usize,
    count: &mut usize,
    ids: &mut HashSet<&'a str>,
) -> Result<(), String> {
    *count += 1;
    if *count > MAX_NODES {
        return Err(format!("more than {MAX_NODES} menu entries"));
    }
    match node {
        MenuNode::Item { id, label, .. } => {
            validate_id(id)?;
            validate_label(label)?;
            // the same action may appear in several menus – it is the same event
            ids.insert(id.as_str());
        }
        MenuNode::Submenu { label, items } => {
            if depth > MAX_DEPTH {
                return Err(format!("menus nest deeper than {MAX_DEPTH} levels"));
            }
            validate_label(label)?;
            for child in items {
                validate_node(child, depth + 1, count, ids)?;
            }
        }
        MenuNode::Separator => {}
        MenuNode::Predefined { name } => {
            if !PREDEFINED.contains(&name.as_str()) {
                return Err(format!("unknown native menu item \"{name}\""));
            }
        }
    }
    Ok(())
}

fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= MAX_ID
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '.' | '-'));
    if ok {
        Ok(())
    } else {
        Err(format!("invalid menu id \"{}\"", id.escape_debug()))
    }
}

fn validate_label(label: &str) -> Result<(), String> {
    if label.trim().is_empty() || label.chars().count() > MAX_LABEL {
        return Err("a menu label is empty or too long".into());
    }
    if label.chars().any(char::is_control) {
        return Err("a menu label contains control characters".into());
    }
    Ok(())
}

/// Keys of the keymap notation that have a native accelerator (muda names).
fn native_key(key: &str) -> Option<String> {
    let mut chars = key.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return (c.is_ascii_alphanumeric() || "`\\[],.=-';/".contains(c))
            .then(|| c.to_ascii_uppercase().to_string());
    }
    if let Some(n) = key.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()) {
        return (1..=24).contains(&n).then(|| key.to_string());
    }
    const NAMED: &[&str] = &[
        "Enter",
        "Tab",
        "Escape",
        "Backspace",
        "Delete",
        "Insert",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "NumpadAdd",
        "NumpadSubtract",
        "NumpadMultiply",
        "NumpadDivide",
        "NumpadDecimal",
        "NumpadEnter",
    ];
    NAMED.contains(&key).then(|| key.to_string())
}

/// Native accelerator for a keymap shortcut (design 014 E6), `None` when the menu
/// must not own the key: only one stroke with Mod/Ctrl or an F-key – plain keys,
/// Alt+letter (⌥ types characters on macOS) and chords stay with the page, else a
/// menu would take keys away from text fields.
pub fn native_accelerator(shortcut: &str, macos: bool) -> Option<String> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() || shortcut.contains(' ') {
        return None;
    }
    // a trailing "+" key is written "Mod++" – no native name for it
    if shortcut.ends_with("++") {
        return None;
    }
    let mut parts: Vec<&str> = shortcut.split('+').collect();
    let key = parts.pop()?;
    let (mut command, mut ctrl, mut alt, mut shift) = (false, false, false, false);
    for p in parts {
        match p {
            "Mod" => command = true,
            "Ctrl" => ctrl = true,
            "Alt" => alt = true,
            "Shift" => shift = true,
            _ => return None,
        }
    }
    let is_fkey = key.len() > 1 && key.starts_with('F') && key[1..].parse::<u8>().is_ok();
    if !(command || ctrl || is_fkey) {
        return None;
    }
    let key = native_key(key)?;
    let mut out = Vec::new();
    if command {
        out.push(if macos { "Cmd" } else { "Ctrl" });
    }
    if ctrl && (macos || !command) {
        out.push("Ctrl");
    }
    if alt {
        out.push("Alt");
    }
    if shift {
        out.push("Shift");
    }
    let mut text = out.join("+");
    if !text.is_empty() {
        text.push('+');
    }
    text.push_str(&key);
    Some(text)
}

/// Builds the native menu from a validated spec.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>, spec: &MenuSpec) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    for top in &spec.menus {
        if let MenuNode::Submenu { label, items } = top {
            let sub = build_submenu(app, label, items)?;
            menu.append(&sub)?;
        }
    }
    Ok(menu)
}

fn build_submenu<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    items: &[MenuNode],
) -> tauri::Result<Submenu<R>> {
    let sub = Submenu::new(app, label, true)?;
    for node in items {
        let kind = build_node(app, node)?;
        sub.append(&kind as &dyn IsMenuItem<R>)?;
    }
    Ok(sub)
}

fn build_node<R: Runtime>(app: &AppHandle<R>, node: &MenuNode) -> tauri::Result<MenuItemKind<R>> {
    Ok(match node {
        MenuNode::Item {
            id,
            label,
            accelerator,
            enabled,
        } => {
            let accel = accelerator
                .as_deref()
                .and_then(|a| native_accelerator(a, cfg!(target_os = "macos")));
            let base = || MenuItemBuilder::with_id(id.clone(), label).enabled(*enabled);
            let item = match accel {
                // an accelerator muda rejects must not cost the whole menu
                Some(a) => base()
                    .accelerator(a)
                    .build(app)
                    .or_else(|_| base().build(app))?,
                None => base().build(app)?,
            };
            MenuItemKind::MenuItem(item)
        }
        MenuNode::Submenu { label, items } => {
            MenuItemKind::Submenu(build_submenu(app, label, items)?)
        }
        MenuNode::Separator => MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?),
        MenuNode::Predefined { name } => MenuItemKind::Predefined(predefined(app, name)?),
    })
}

fn predefined<R: Runtime>(app: &AppHandle<R>, name: &str) -> tauri::Result<PredefinedMenuItem<R>> {
    match name {
        "about" => {
            let info = app.package_info();
            let meta = AboutMetadata {
                name: Some(info.name.clone()),
                version: Some(info.version.to_string()),
                ..Default::default()
            };
            PredefinedMenuItem::about(app, None, Some(meta))
        }
        "services" => PredefinedMenuItem::services(app, None),
        "hide" => PredefinedMenuItem::hide(app, None),
        "hideOthers" => PredefinedMenuItem::hide_others(app, None),
        "showAll" => PredefinedMenuItem::show_all(app, None),
        "quit" => PredefinedMenuItem::quit(app, None),
        "undo" => PredefinedMenuItem::undo(app, None),
        "redo" => PredefinedMenuItem::redo(app, None),
        "cut" => PredefinedMenuItem::cut(app, None),
        "copy" => PredefinedMenuItem::copy(app, None),
        "paste" => PredefinedMenuItem::paste(app, None),
        "selectAll" => PredefinedMenuItem::select_all(app, None),
        "minimize" => PredefinedMenuItem::minimize(app, None),
        "maximize" => PredefinedMenuItem::maximize(app, None),
        "fullscreen" => PredefinedMenuItem::fullscreen(app, None),
        "closeWindow" => PredefinedMenuItem::close_window(app, None),
        // validated before – never reached
        _ => PredefinedMenuItem::separator(app),
    }
}

/// Ids of all items of a spec (menu events for other ids are dropped).
pub fn item_ids(spec: &MenuSpec) -> HashSet<String> {
    fn walk(node: &MenuNode, out: &mut HashSet<String>) {
        match node {
            MenuNode::Item { id, .. } => {
                out.insert(id.clone());
            }
            MenuNode::Submenu { items, .. } => items.iter().for_each(|n| walk(n, out)),
            _ => {}
        }
    }
    let mut out = HashSet::new();
    spec.menus.iter().for_each(|n| walk(n, &mut out));
    out
}

/// The native menu is used on macOS, elsewhere only with `FNF_NATIVE_MENU=1` (design 014 E5).
pub fn native_menu_wanted() -> bool {
    cfg!(target_os = "macos") || std::env::var("FNF_NATIVE_MENU").is_ok_and(|v| v == "1")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> MenuNode {
        MenuNode::Item {
            id: id.into(),
            label: "Copy…".into(),
            accelerator: None,
            enabled: true,
        }
    }

    fn sub(items: Vec<MenuNode>) -> MenuNode {
        MenuNode::Submenu {
            label: "File".into(),
            items,
        }
    }

    #[test]
    fn accelerators_map_mod_per_os() {
        assert_eq!(
            native_accelerator("Mod+Shift+P", true).as_deref(),
            Some("Cmd+Shift+P")
        );
        assert_eq!(
            native_accelerator("Mod+Shift+P", false).as_deref(),
            Some("Ctrl+Shift+P")
        );
        // the real Control key on macOS
        assert_eq!(
            native_accelerator("Ctrl+Q", true).as_deref(),
            Some("Ctrl+Q")
        );
        assert_eq!(
            native_accelerator("Mod+Ctrl+D", true).as_deref(),
            Some("Cmd+Ctrl+D")
        );
        assert_eq!(
            native_accelerator("Mod+Alt+Backspace", true).as_deref(),
            Some("Cmd+Alt+Backspace")
        );
        assert_eq!(native_accelerator("Mod+[", true).as_deref(), Some("Cmd+["));
        assert_eq!(native_accelerator("Mod+,", true).as_deref(), Some("Cmd+,"));
        assert_eq!(
            native_accelerator("Mod+.", false).as_deref(),
            Some("Ctrl+.")
        );
    }

    #[test]
    fn function_keys_need_no_modifier() {
        assert_eq!(native_accelerator("F5", true).as_deref(), Some("F5"));
        assert_eq!(
            native_accelerator("Shift+F8", false).as_deref(),
            Some("Shift+F8")
        );
        assert_eq!(
            native_accelerator("Alt+F7", true).as_deref(),
            Some("Alt+F7")
        );
        assert_eq!(native_accelerator("F25", true), None);
    }

    #[test]
    fn plain_keys_alt_letters_and_chords_stay_with_the_page() {
        for s in [
            "Enter",
            "Space",
            "Tab",
            "Backspace",
            "NumpadAdd",
            "Shift+ArrowDown",
            "Alt+1",
            "Alt+G",
            "Ctrl+K F6",
            "Mod++",
            "",
            "Hyper+A",
            "Mod+ContextMenu",
        ] {
            assert_eq!(native_accelerator(s, true), None, "{s}");
        }
    }

    #[test]
    fn spec_accepts_a_normal_menu() {
        let spec = MenuSpec {
            menus: vec![sub(vec![
                item("OPEN_COPY_DLG"),
                MenuNode::Separator,
                item("tool:edit"),
                MenuNode::Predefined {
                    name: "copy".into(),
                },
                sub(vec![item("COPY_2_CLIPBOARD_NAMES")]),
            ])],
        };
        assert_eq!(validate_spec(&spec), Ok(()));
        let ids = item_ids(&spec);
        assert!(ids.contains("tool:edit") && ids.contains("COPY_2_CLIPBOARD_NAMES"));
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn spec_rejects_bad_input() {
        let bad = |menus| validate_spec(&MenuSpec { menus }).is_err();
        assert!(bad(vec![item("A")]), "top level must be a submenu");
        assert!(bad(vec![sub(vec![item("a b")])]), "space in id");
        assert!(bad(vec![sub(vec![item(&"x".repeat(81))])]));
        assert!(bad(vec![sub(vec![MenuNode::Predefined {
            name: "rm -rf".into()
        }])]));
        assert!(bad(vec![sub(vec![MenuNode::Item {
            id: "A".into(),
            label: "evil\u{7}".into(),
            accelerator: None,
            enabled: true
        }])]));
        assert!(bad(vec![sub(vec![MenuNode::Item {
            id: "A".into(),
            label: "  ".into(),
            accelerator: None,
            enabled: true
        }])]));
        // depth: File ▸ a ▸ b ▸ c
        assert!(bad(vec![sub(vec![sub(vec![sub(vec![sub(vec![])])])])]));
        assert!(!bad(vec![sub(vec![sub(vec![sub(vec![])])])]));
        assert!(bad(vec![sub((0..MAX_NODES).map(|_| item("A")).collect())]));
    }

    #[test]
    fn spec_json_form() {
        let json = r#"{"menus":[{"kind":"submenu","label":"Edit","items":[
            {"kind":"predefined","name":"selectAll"},
            {"kind":"separator"},
            {"kind":"item","id":"SELECT_ALL","label":"Mark all","accelerator":"Mod+A","enabled":false},
            {"kind":"item","id":"X","label":"No shortcut","enabled":true}]}]}"#;
        let spec: MenuSpec = serde_json::from_str(json).unwrap();
        assert_eq!(validate_spec(&spec), Ok(()));
        let MenuNode::Submenu { items, .. } = &spec.menus[0] else {
            panic!("submenu")
        };
        assert_eq!(
            items[2],
            MenuNode::Item {
                id: "SELECT_ALL".into(),
                label: "Mark all".into(),
                accelerator: Some("Mod+A".into()),
                enabled: false
            }
        );
        assert!(matches!(
            &items[3],
            MenuNode::Item {
                accelerator: None,
                ..
            }
        ));
        assert_eq!(
            serde_json::to_value(MenuEvent { id: "X".into() }).unwrap(),
            serde_json::json!({ "id": "X" })
        );
    }
}
