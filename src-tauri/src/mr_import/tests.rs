//! Tests of the mr import. The files in `fixtures/` are shortened copies of the
//! configuration data of files-and-folders-mr (`apps/fnf-api/src/assets/…`, GUI Expert
//! GmbH) – data formats as test input, no code (CLAUDE.md §8). `shortcut-custom.json`
//! contains the two chords of mr's own `shortcut/custom/osx.json`, the rest are typical
//! user changes; `*-defaults.json` are excerpts of mr's `defaults/` files.

use super::keys::*;
use super::*;
use std::collections::BTreeSet;
use tempfile::{TempDir, tempdir};

const SHORTCUT_DEFAULTS: &str = include_str!("fixtures/shortcut-defaults.json");
const SHORTCUT_CUSTOM: &str = include_str!("fixtures/shortcut-custom.json");
const BUTTON_DEFAULTS: &str = include_str!("fixtures/button-defaults.json");
const BUTTON_CUSTOM: &str = include_str!("fixtures/button-custom.json");
const FILETYPE_DEFAULTS: &str = include_str!("fixtures/filetype-defaults.json");
const FILETYPE_CUSTOM: &str = include_str!("fixtures/filetype-custom.json");
const SEARCH_OWN: &str = include_str!("fixtures/search-own.json");
const TOOL_DEFAULTS: &str = include_str!("fixtures/tool-defaults.json");
const TOOL_CUSTOM: &str = include_str!("fixtures/tool-custom.json");
const COLOR_DEFAULTS: &str = include_str!("fixtures/color-light-defaults.json");
const COLOR_OWN: &str = include_str!("fixtures/color-own.json");
const SETUP: &str = include_str!("fixtures/setup.json");

fn put(root: &Path, rel: &str, text: &str) {
    let file = root.join(rel);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

/// An mr checkout `<tmp>/fnf mr ä/apps/fnf-api/src/assets` with all areas.
fn mr_tree() -> (TempDir, PathBuf, PathBuf) {
    let dir = tempdir().unwrap();
    let repo = dir.path().join("fnf mr ä");
    let a = repo.join("apps/fnf-api/src/assets");
    for os in ["osx", "linux", "windows"] {
        put(
            &a,
            &format!("shortcut/defaults/{os}.json"),
            SHORTCUT_DEFAULTS,
        );
        put(&a, &format!("shortcut/custom/{os}.json"), SHORTCUT_CUSTOM);
        put(&a, &format!("tool/defaults/{os}.json"), TOOL_DEFAULTS);
        put(&a, &format!("tool/custom/{os}.json"), TOOL_CUSTOM);
    }
    put(&a, "button/defaults/data.json", BUTTON_DEFAULTS);
    put(&a, "button/custom/data.json", BUTTON_CUSTOM);
    put(&a, "filetype/defaults/data.json", FILETYPE_DEFAULTS);
    put(&a, "filetype/custom/data.json", FILETYPE_CUSTOM);
    put(&a, "search/defaults/data.json", SEARCH_OWN);
    put(&a, "search/custom/info.md", "folder for custom data");
    put(&a, "color/defaults/light.json", COLOR_DEFAULTS);
    put(&a, "color/custom/light.json", COLOR_DEFAULTS);
    put(&a, "color/custom/my light.json", COLOR_OWN);
    put(&a, "setup/data.json", SETUP);
    (dir, repo, a)
}

fn reasons<T>(area: &MrArea<T>) -> BTreeSet<String> {
    area.skipped.iter().map(|s| s.reason.clone()).collect()
}

fn skipped<'a, T>(area: &'a MrArea<T>, reason: &str) -> Vec<&'a str> {
    area.skipped
        .iter()
        .filter(|s| s.reason == reason)
        .map(|s| s.item.as_str())
        .collect()
}

// ---- keys ----

#[test]
fn ids_are_mapped_like_the_parity_matrix() {
    assert_eq!(map_action("OPEN_COPY_DLG").unwrap(), "OPEN_COPY_DLG");
    assert_eq!(map_action("ADD_NEW_TAB").unwrap(), "CLONE_TAB");
    assert_eq!(
        map_action("NAVIGATE_LEVEL_DOWN").unwrap(),
        "NAVIGATE_PARENT"
    );
    assert_eq!(
        map_action("OPEN_GOTO_ANYTHING_DLG").unwrap(),
        "OPEN_COMMAND_PALETTE"
    );
    assert_eq!(map_action("TOGGLE_SELECTION").unwrap(), "INVERT_MARKS");
    assert_eq!(map_action("CMD_SHELL").unwrap(), "OPEN_TERMINAL_HERE");
    assert_eq!(map_action("ARROW_UP"), Err("table_navigation"));
    assert_eq!(map_action("PAGEDOWN_PRESSED"), Err("table_navigation"));
    assert_eq!(map_action("SAVE_CONFIG"), Err("no_equivalent"));
    assert_eq!(map_action("CHANGE_LAF_NORTON"), Err("no_equivalent"));
    assert_eq!(map_action("EDIT_FILE"), Err("no_equivalent"));
    assert_eq!(map_action("OPEN_FOO_DLG"), Err("unknown_action"));
    assert_eq!(map_action(""), Err("unknown_action"));
}

#[test]
fn never_fired_follows_mr_bug_1() {
    for ok in [
        "f5",
        "ctrl+cmd+g",
        "ctrl+alt+shift+d",
        "ctrl+k f6",
        "shift+cmd+x",
    ] {
        assert!(!never_fired(ok), "{ok}");
    }
    for dagger in [
        "cmd+alt+up",
        "cmd+ctrl+g",
        "cmd+shift+c",
        "ctrl+delete",
        "ctrl+alt+plus",
        "ctrl+alt+minus",
        "ctrl+ctrl+a",
        "ctrl+k cmd+alt+x",
    ] {
        assert!(never_fired(dagger), "{dagger}");
    }
}

#[test]
fn notation_per_os() {
    let mac = |s| translate_shortcut(s, MrOs::Osx);
    let lin = |s| translate_shortcut(s, MrOs::Linux);
    assert_eq!(mac("ctrl+cmd+g").unwrap(), "Mod+Ctrl+G");
    assert_eq!(lin("ctrl+alt+t").unwrap(), "Mod+Alt+T");
    assert_eq!(mac("ctrl+alt+t").unwrap(), "Ctrl+Alt+T");
    assert_eq!(lin("ctrl+k ctrl+c").unwrap(), "Mod+K Mod+C");
    assert_eq!(mac("shift+f11").unwrap(), "Shift+F11");
    assert_eq!(mac("cmd+left").unwrap(), "Mod+ArrowLeft");
    assert_eq!(lin("space").unwrap(), "Space");
    assert_eq!(lin("ctrl+,").unwrap(), "Mod+,");
    assert_eq!(lin("enter").unwrap(), "Enter");
    assert_eq!(lin("ctrl+cmd+g"), Err("meta_key"));
    assert_eq!(translate_shortcut("cmd+g", MrOs::Windows), Err("meta_key"));
    assert_eq!(lin("ctrl+hyper"), Err("unknown_key"));
    assert_eq!(lin("ctrl+"), Err("unknown_key"));
    assert_eq!(lin("f25"), Err("unknown_key"));
    assert_eq!(lin("a b c"), Err("unknown_key"));
}

// ---- finding ----

#[test]
fn finds_assets_from_the_repo_root_assets_area_and_a_packed_app() {
    let (dir, repo, assets) = mr_tree();
    assert_eq!(locate(&repo).unwrap(), assets);
    assert_eq!(locate(&assets).unwrap(), assets);
    assert_eq!(locate(&assets.join("shortcut")).unwrap(), assets);
    assert_eq!(locate(&assets.join("shortcut/custom")).unwrap(), assets);
    assert_eq!(locate(&repo.join("apps")).unwrap(), assets);
    // a packed app: somewhere below, next to node_modules (not searched)
    let packed = dir.path().join("Packed App");
    put(
        &packed,
        "node_modules/x/assets/button/custom/data.json",
        "{}",
    );
    put(
        &packed,
        "resources/app/dist/assets/button/custom/data.json",
        "{}",
    );
    assert_eq!(
        locate(&packed).unwrap(),
        packed.join("resources/app/dist/assets")
    );
    let other = dir.path().join("other");
    put(&other, "src/main.rs", "fn main() {}");
    assert!(locate(&other).is_none());
    let e = scan_path(&other, MrOs::Linux).unwrap_err();
    assert_eq!(e.code, FsErrorCode::NotFound);
    let e = scan_path(&other.join("src/main.rs"), MrOs::Linux).unwrap_err();
    assert_eq!(e.code, FsErrorCode::NotADirectory);
}

// ---- scanning ----

#[test]
fn shortcuts_only_the_changes_with_reasons() {
    let (_d, repo, _) = mr_tree();
    let scan = scan_path(&repo, MrOs::Osx).unwrap();
    assert_eq!(scan.os, "osx");
    let s = scan.shortcuts.unwrap();
    assert!(s.error.is_none());
    // 8 unchanged entries of the defaults
    assert_eq!(s.unchanged, 8);
    let got: Vec<(&str, &str)> = s
        .items
        .iter()
        .map(|i| (i.id.as_str(), i.shortcut.as_str()))
        .collect();
    assert_eq!(
        got,
        vec![
            ("OPEN_SETUP_DLG", "Alt+Shift+F12"),
            ("CLONE_TAB", "Ctrl+Alt+T"),
            ("OPEN_COMMAND_PALETTE", "Ctrl+F"),
            ("COPY_2_CLIPBOARD_FULLNAMES", "Ctrl+K Ctrl+C"),
            ("COPY_2_CLIPBOARD_FULLNAMES", "Ctrl+K Ctrl+Z"),
            ("OPEN_TOOL_CONFIG_DLG", "Mod+Shift+X"),
        ]
    );
    assert_eq!(s.items[1].source, "ctrl+alt+t → ADD_NEW_TAB");
    assert_eq!(
        skipped(&s, "never_fired"),
        vec![
            "cmd+alt+n → OPEN_MKDIR_DLG",
            "ctrl+shift+delete → OPEN_DELETE_DLG"
        ]
    );
    assert_eq!(skipped(&s, "table_navigation"), vec!["ctrl+up → ARROW_UP"]);
    assert_eq!(
        skipped(&s, "no_equivalent"),
        vec!["ctrl+cmd+1 → CHANGE_LAF_NORTON"]
    );
    assert_eq!(skipped(&s, "unknown_action"), vec!["f9 → OPEN_FOO_DLG"]);
    assert_eq!(
        skipped(&s, "unknown_key"),
        vec!["ctrl+hyper → OPEN_VIEW_DLG"]
    );
    // removed from the custom file: reported, except EDIT_FILE (no equivalent, no news)
    assert_eq!(skipped(&s, "removed"), vec!["f3 → OPEN_VIEW_DLG"]);

    // Linux: the same file, Ctrl is Mod, cmd is the Windows key
    let s = scan_path(&repo, MrOs::Linux).unwrap().shortcuts.unwrap();
    assert!(s.items.iter().any(|i| i.shortcut == "Mod+K Mod+C"));
    assert_eq!(
        skipped(&s, "meta_key"),
        vec!["shift+cmd+x → OPEN_TOOL_CONFIG_DLG"]
    );
}

#[test]
fn shortcuts_without_defaults_count_as_own() {
    let (_d, _, assets) = mr_tree();
    fs::remove_dir_all(assets.join("shortcut/defaults")).unwrap();
    let s = scan(&assets, MrOs::Osx).shortcuts.unwrap();
    assert_eq!(s.unchanged, 0);
    assert!(s.items.iter().any(|i| i.shortcut == "F5"));
    assert!(skipped(&s, "removed").is_empty());
    assert!(skipped(&s, "no_equivalent").contains(&"ctrl+cmd+s → SAVE_CONFIG"));
}

#[test]
fn broken_too_big_and_missing_files() {
    let (_d, _, assets) = mr_tree();
    put(&assets, "shortcut/custom/osx.json", "{ nope");
    put(&assets, "button/custom/data.json", "[1, 2]");
    let big = format!("[{}]", "1,".repeat(MAX_JSON_BYTES as usize / 2));
    put(&assets, "filetype/custom/data.json", &big);
    fs::remove_file(assets.join("setup/data.json")).unwrap();
    let scan = scan(&assets, MrOs::Osx);
    assert_eq!(scan.shortcuts.unwrap().error.as_deref(), Some("broken"));
    assert_eq!(scan.buttons.unwrap().error.as_deref(), Some("broken"));
    assert_eq!(scan.file_types.unwrap().error.as_deref(), Some("too_big"));
    assert!(scan.setup.is_none());
    // the windows file is untouched
    assert!(
        super::scan(&assets, MrOs::Windows)
            .shortcuts
            .unwrap()
            .error
            .is_none()
    );
}

#[test]
fn buttons_changed_sets_with_cmd_as_main_modifier() {
    let (_d, _, assets) = mr_tree();
    let b = scan(&assets, MrOs::Osx).buttons.unwrap();
    assert_eq!(b.unchanged, 2, "default and alt equal mr's defaults");
    assert_eq!(
        b.items["shift"],
        vec![
            "OPEN_CREATE_FILE_DLG",
            "OPEN_COMMAND_PALETTE",
            "OPEN_RENAME_DLG",
            "OPEN_DELETE_DLG"
        ]
    );
    assert_eq!(b.items["cmd"].last().unwrap(), "OPEN_FIND_DLG");
    assert_eq!(
        skipped(&b, "no_equivalent"),
        vec!["shift: CHANGE_LAF_COFFEE"]
    );
    let b = scan(&assets, MrOs::Windows).buttons.unwrap();
    assert!(b.items.contains_key("ctrl") && !b.items.contains_key("cmd"));
    // more than ten slots
    let ids = [
        "OPEN_COPY_DLG",
        "OPEN_MOVE_DLG",
        "OPEN_VIEW_DLG",
        "OPEN_EDIT_DLG",
        "OPEN_MKDIR_DLG",
        "OPEN_DELETE_DLG",
        "OPEN_RENAME_DLG",
        "OPEN_FIND_DLG",
        "OPEN_SETUP_DLG",
        "OPEN_TASK_DLG",
        "OPEN_PACK_DLG",
        "OPEN_UNPACK_DLG",
        "OPEN_COPY_DLG",
    ];
    put(
        &assets,
        "button/custom/data.json",
        &serde_json::json!({ "shift": ids, "weird": [] }).to_string(),
    );
    let b = scan(&assets, MrOs::Linux).buttons.unwrap();
    assert_eq!(b.items["shift"].len(), buttons::MAX_SLOTS);
    assert_eq!(skipped(&b, "too_many").len(), 2);
    assert_eq!(skipped(&b, "invalid"), vec!["weird"]);
}

#[test]
fn file_types_whole_list_unless_default() {
    let (_d, _, assets) = mr_tree();
    let f = scan(&assets, MrOs::Osx).file_types.unwrap();
    let labels: Vec<&str> = f.items.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, vec!["movies", "audio", "images", "Comics"]);
    assert_eq!(f.items[3].extensions, vec![".cbz", ".cbr"]);
    assert_eq!(f.items[1].extensions, vec![".mp3", ".flac", ".opus"]);
    assert_eq!(f.skipped.len(), 2);
    assert_eq!(reasons(&f), BTreeSet::from(["invalid".to_string()]));
    put(&assets, "filetype/custom/data.json", FILETYPE_DEFAULTS);
    let f = scan(&assets, MrOs::Osx).file_types.unwrap();
    assert!(f.items.is_empty());
    assert_eq!(f.unchanged, 3);
}

#[test]
fn search_reads_mrs_swapped_folders() {
    let (_d, _, assets) = mr_tree();
    let s = scan(&assets, MrOs::Osx).search.unwrap();
    assert!(s.file.ends_with("data.json") && s.file.contains("defaults"));
    let labels: Vec<&str> = s.items.iter().map(|p| p.label.as_str()).collect();
    // "movies" is a copy of mr's file type of that name: shipped, not own
    assert_eq!(labels, vec!["movies & images", "Comics & covers"]);
    assert_eq!(s.unchanged, 1);
    assert_eq!(skipped(&s, "invalid"), vec!["nothing"]);
    // only search/custom (no shipped file): that one counts
    fs::remove_file(assets.join("search/defaults/data.json")).unwrap();
    put(
        &assets,
        "search/custom/data.json",
        r#"[{"label":"Bücher","extensions":["EPUB"]}]"#,
    );
    let s = scan(&assets, MrOs::Osx).search.unwrap();
    assert_eq!(s.items[0].extensions, vec![".epub"]);
}

#[test]
fn tools_through_the_mr_import() {
    let (_d, _, assets) = mr_tree();
    let t = scan(&assets, MrOs::Linux).tools.unwrap();
    // CMD_SHELL and CMD_REVEAL_IN_FINDER equal mr's defaults
    assert_eq!(t.unchanged, 2);
    let ids: Vec<&str> = t.items.iter().map(|x| x.id.as_str()).collect();
    assert_eq!(ids, vec!["CMD_EDIT_FILE", "MELD"]);
    assert_eq!(t.items[0].program, "gedit");
    assert_eq!(t.items[1].args, vec!["{file}"]);
    assert!(t.items[1].per_file);
    assert_eq!(t.items[1].label, "Meld ü");
    assert_eq!(skipped(&t, "old_script"), vec!["Script"]);
}

#[test]
fn colors_only_own_files_and_no_links() {
    let (_d, _, assets) = mr_tree();
    let c = scan(&assets, MrOs::Osx).colors.unwrap();
    assert_eq!(c.unchanged, 1, "light.json equals mr's light");
    assert_eq!(c.items.len(), 1);
    assert_eq!(c.items[0].name, "My light");
    assert!(c.items[0].path.ends_with("my light.json"));
    put(&assets, "color/custom/nope.json", r#"{"name":"x"}"#);
    put(
        &assets,
        "color/custom/huge.json",
        &"x".repeat(MAX_COLOR_BYTES as usize + 1),
    );
    put(&assets, "color/custom/readme.md", "#");
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        assets.join("color/custom/my light.json"),
        assets.join("color/custom/link.json"),
    )
    .unwrap();
    let c = scan(&assets, MrOs::Osx).colors.unwrap();
    assert_eq!(c.items.len(), 1);
    assert_eq!(skipped(&c, "invalid"), vec!["nope"]);
    assert_eq!(skipped(&c, "too_big"), vec!["huge"]);
    fs::remove_dir_all(assets.join("color/custom")).unwrap();
    fs::create_dir(assets.join("color/custom")).unwrap();
    assert!(scan(&assets, MrOs::Osx).colors.is_none());
}

#[test]
fn setup_two_switches_and_window_options() {
    let (_d, _, assets) = mr_tree();
    let s = scan(&assets, MrOs::Osx).setup.unwrap();
    assert!(s.items.is_empty());
    assert_eq!(skipped(&s, "not_applicable").len(), 3);
    put(
        &assets,
        "setup/data.json",
        r#"{"condensedPresentationStyle":true,"loadFolderSizeAfterSelection":true,"openSetupInNewWindow":false}"#,
    );
    let s = scan(&assets, MrOs::Osx).setup.unwrap();
    assert_eq!(s.items["view.density"], "condensed");
    assert_eq!(s.items["behavior.spaceCalcSize"], true);
    assert!(s.skipped.is_empty());
}

// ---- applying ----

fn config(dir: &Path) -> ConfigFiles {
    ConfigFiles::in_dir(&dir.join("cfg ü"))
}

#[test]
fn apply_backs_up_and_writes_the_parts() {
    let dir = tempdir().unwrap();
    let files = config(dir.path());
    keymap::save(
        &files.keymap,
        BTreeMap::from([("OPEN_COPY_DLG".to_string(), vec!["F5".to_string()])]),
    )
    .unwrap();
    settings::save(
        &files.settings,
        serde_json::json!({"general.language": "de"})
            .as_object()
            .unwrap()
            .clone(),
    )
    .unwrap();
    fs::write(&files.themes, "{}").unwrap();
    let plan = MrApply {
        keymap: Some(BTreeMap::from([(
            "CLONE_TAB".to_string(),
            vec!["Mod+Alt+T".to_string()],
        )])),
        buttons: Some(BTreeMap::from([(
            "shift".to_string(),
            vec!["OPEN_COMMAND_PALETTE".to_string()],
        )])),
        file_types: Some(vec![FileType {
            label: "Comics".into(),
            extensions: vec![".cbz".into()],
            icon: None,
            color: None,
        }]),
        settings: Some(
            serde_json::json!({"view.density": "condensed"})
                .as_object()
                .unwrap()
                .clone(),
        ),
        tools: None,
        backup_themes: true,
    };
    let report = apply(&files, plan.clone(), MrOs::Linux, None);
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    let parts: BTreeSet<&str> = report.imported.iter().map(String::as_str).collect();
    assert_eq!(
        parts,
        BTreeSet::from(["keymap", "buttons", "fileTypes", "settings"])
    );
    // backups of the three existing files, none for new ones
    assert_eq!(report.backups.len(), 3);
    assert!(
        report
            .backups
            .iter()
            .any(|b| b.ends_with("keymap.json.bak"))
    );
    assert!(
        report
            .backups
            .iter()
            .any(|b| b.ends_with("themes.json.bak"))
    );
    assert!(
        fs::read_to_string(dir.path().join("cfg ü/keymap.json.bak"))
            .unwrap()
            .contains("OPEN_COPY_DLG")
    );
    assert_eq!(
        keymap::load(&files.keymap).bindings["CLONE_TAB"],
        vec!["Mod+Alt+T"]
    );
    // settings merged: the language stays
    let s = settings::load(&files.settings).settings;
    assert_eq!(s["general.language"], "de");
    assert_eq!(s["view.density"], "condensed");
    assert_eq!(
        buttons::load(&files.buttons).value.sets["shift"],
        vec!["OPEN_COMMAND_PALETTE"]
    );
    assert_eq!(
        filetypes::load(&files.file_types).value.unwrap()[0].label,
        "Comics"
    );
    // a second import keeps the first backup
    let report = apply(&files, plan, MrOs::Linux, None);
    assert!(
        report
            .backups
            .iter()
            .any(|b| b.ends_with("keymap.json.bak-2"))
    );
    assert!(
        fs::read_to_string(dir.path().join("cfg ü/keymap.json.bak"))
            .unwrap()
            .contains("OPEN_COPY_DLG")
    );
}

/// The tools part as the frontend sends it after a scan: chosen ids + the digest it saw.
fn choose(assets: &Path, ids: &[&str], replace: bool) -> (MrApply, Option<PathBuf>) {
    let area = scan(assets, MrOs::Linux).tools.unwrap();
    let plan = MrApply {
        tools: Some(MrToolsChoice {
            from: assets.to_string_lossy().into_owned(),
            digest: area.digest.clone().unwrap(),
            ids: ids.iter().map(|s| s.to_string()).collect(),
            replace,
        }),
        ..MrApply::default()
    };
    (plan, Some(assets.to_path_buf()))
}

#[test]
fn apply_merges_or_replaces_tools_and_keeps_a_broken_file() {
    let (_d, _, assets) = mr_tree();
    let dir = tempdir().unwrap();
    let files = config(dir.path());
    fs::create_dir_all(files.tools.parent().unwrap()).unwrap();
    fs::write(
        &files.tools,
        r#"{"version":1,"terminal":{"program":"xterm","args":[]},"tools":[
            {"id":"MELD","label":"old","program":"meld"},
            {"id":"mine","label":"Mine","program":"mine"}]}"#,
    )
    .unwrap();
    let (plan, from) = choose(&assets, &["MELD", "CMD_EDIT_FILE"], false);
    let report = apply(&files, plan, MrOs::Linux, from.clone());
    assert_eq!(report.imported, vec!["tools"]);
    assert!(report.backups[0].ends_with("tools.json.bak"));
    let cfg = tools::load(&files.tools);
    assert!(cfg.warnings.is_empty(), "{:?}", cfg.warnings);
    assert_eq!(cfg.find("MELD").unwrap().label, "Meld ü");
    assert!(cfg.find("mine").is_some() && cfg.find("CMD_EDIT_FILE").is_some());
    assert_eq!(cfg.terminal.unwrap().program, "xterm");
    // replace: own tools = the imported ones
    let (plan, _) = choose(&assets, &["MELD", "CMD_EDIT_FILE"], true);
    apply(&files, plan, MrOs::Linux, from.clone());
    assert!(tools::load(&files.tools).find("mine").is_none());
    // a broken file by hand is not replaced
    fs::write(&files.tools, "{ broken").unwrap();
    let (plan, _) = choose(&assets, &["MELD"], false);
    let report = apply(&files, plan, MrOs::Linux, from.clone());
    assert!(report.imported.is_empty());
    assert_eq!(report.warnings[0].code, "part_skipped");
    assert_eq!(fs::read_to_string(&files.tools).unwrap(), "{ broken");
    // the tools come from the mr files only: a folder without them writes nothing
    fs::remove_file(&files.tools).unwrap();
    let (plan, _) = choose(&assets, &["MELD"], false);
    let report = apply(&files, plan, MrOs::Linux, Some(dir.path().to_path_buf()));
    assert!(report.imported.is_empty() && !files.tools.exists());
    assert_eq!(report.warnings[0].code, "part_skipped");
}

#[test]
fn only_the_chosen_tools_and_only_what_was_shown() {
    // review 026 #1: one tool chosen, the other stays out
    let (_d, _, assets) = mr_tree();
    let dir = tempdir().unwrap();
    let files = config(dir.path());
    let (plan, from) = choose(&assets, &["MELD"], false);
    let report = apply(&files, plan, MrOs::Linux, from.clone());
    assert_eq!(report.imported, vec!["tools"]);
    let cfg = tools::load(&files.tools);
    assert!(cfg.find("MELD").is_some());
    assert_eq!(cfg.find("CMD_EDIT_FILE").map(|t| t.program.as_str()), None);
    // review 026 #2: the file changed after the preview → nothing is written
    let (plan, from) = choose(&assets, &["CMD_EDIT_FILE"], false);
    let file = assets.join("tool/custom/linux.json");
    let text = fs::read_to_string(&file)
        .unwrap()
        .replace("gedit", "/tmp/evil.sh");
    fs::write(&file, text).unwrap();
    let before = fs::read_to_string(&files.tools).unwrap();
    let report = apply(&files, plan, MrOs::Linux, from);
    assert!(report.imported.is_empty());
    assert_eq!(report.warnings[0].code, "source_changed");
    assert_eq!(fs::read_to_string(&files.tools).unwrap(), before);
    // the digest is the same for the same content and changes with it
    let a = scan(&assets, MrOs::Linux).tools.unwrap().digest.unwrap();
    assert_eq!(a, scan(&assets, MrOs::Linux).tools.unwrap().digest.unwrap());
    assert_eq!(a.len(), 64);
}

#[test]
fn tools_beyond_the_limit_are_refused() {
    // review 026 #6: 200 own tools + 1 imported – nothing is dropped silently
    let (_d, _, assets) = mr_tree();
    let dir = tempdir().unwrap();
    let files = config(dir.path());
    fs::create_dir_all(files.tools.parent().unwrap()).unwrap();
    let own: Vec<Value> = (0..tools::MAX_TOOLS)
        .map(|i| serde_json::json!({"id": format!("t{i}"), "label": "T", "program": "true"}))
        .collect();
    let text = serde_json::json!({"version": 1, "tools": own}).to_string();
    fs::write(&files.tools, &text).unwrap();
    let (plan, from) = choose(&assets, &["MELD"], false);
    let report = apply(&files, plan, MrOs::Linux, from);
    assert!(report.imported.is_empty());
    assert_eq!(report.warnings[0].code, "too_many");
    assert_eq!(fs::read_to_string(&files.tools).unwrap(), text);
}

#[test]
fn settings_keep_their_values_when_the_import_is_invalid() {
    // review 026 #3: an import value the schema refuses keeps the old one
    let dir = tempdir().unwrap();
    let files = config(dir.path());
    let mine = serde_json::json!([{"label": "mine", "form": {"name": "*.x"}}]);
    settings::save(
        &files.settings,
        serde_json::json!({"search.templates": mine, "behavior.spaceCalcSize": false})
            .as_object()
            .unwrap()
            .clone(),
    )
    .unwrap();
    let huge: Vec<Value> = (0..45)
        .map(|i| serde_json::json!({"label": format!("p{i}"), "form": {"name": "x".repeat(3000)}}))
        .collect();
    let plan = MrApply {
        settings: Some(
            serde_json::json!({"search.templates": huge, "behavior.spaceCalcSize": true})
                .as_object()
                .unwrap()
                .clone(),
        ),
        ..MrApply::default()
    };
    let report = apply(&files, plan, MrOs::Linux, None);
    assert_eq!(report.imported, vec!["settings"]);
    let w = &report.warnings[0];
    assert_eq!(
        (w.code.as_str(), w.key.as_deref()),
        ("invalid_value", Some("search.templates"))
    );
    let s = settings::load(&files.settings).settings;
    assert_eq!(s["search.templates"], mine);
    // a value equal to the default is set too (the own `false` goes)
    assert!(!s.contains_key("behavior.spaceCalcSize"));
}

#[test]
fn files_of_a_newer_version_are_not_replaced() {
    // review 026 #5: settings.json of a newer app version stays as it is
    let dir = tempdir().unwrap();
    let files = config(dir.path());
    fs::create_dir_all(files.settings.parent().unwrap()).unwrap();
    let newer = r#"{"version":7,"settings":{"future.key":1}}"#;
    fs::write(&files.settings, newer).unwrap();
    let plan = MrApply {
        settings: Some(
            serde_json::json!({"view.density": "condensed"})
                .as_object()
                .unwrap()
                .clone(),
        ),
        ..MrApply::default()
    };
    let report = apply(&files, plan, MrOs::Linux, None);
    assert!(report.imported.is_empty());
    assert_eq!(report.warnings[0].code, "part_skipped");
    assert_eq!(fs::read_to_string(&files.settings).unwrap(), newer);
}

#[test]
fn a_huge_file_type_list_is_read_quickly_and_bounded() {
    // review 026 #4: 1 MB of categories, quadratic before
    let (_d, _, assets) = mr_tree();
    let list: Vec<Value> = (0..20_000)
        .map(|i| serde_json::json!({"label": format!("c{i}"), "extensions": [format!(".e{i}")]}))
        .collect();
    put(
        &assets,
        "filetype/custom/data.json",
        &serde_json::to_string(&list).unwrap(),
    );
    let t = std::time::Instant::now();
    let f = scan(&assets, MrOs::Linux).file_types.unwrap();
    assert!(t.elapsed().as_secs() < 5, "{:?}", t.elapsed());
    assert_eq!(f.items.len(), filetypes::MAX_CATEGORIES);
    assert!(f.skipped.len() <= MAX_SKIPPED);
    assert_eq!(
        f.skipped_more as usize + f.skipped.len(),
        20_000 - filetypes::MAX_CATEGORIES
    );
}

#[test]
fn a_folder_with_one_bare_area_folder_is_no_assets_folder() {
    // review 026 #7
    let dir = tempdir().unwrap();
    let root = dir.path().join("proj");
    fs::create_dir_all(root.join("search")).unwrap();
    put(&root, "deep/x/assets/button/custom/data.json", "{}");
    assert_eq!(locate(&root).unwrap(), root.join("deep/x/assets"));
    fs::create_dir_all(root.join("search/custom")).unwrap();
    assert_eq!(locate(&root).unwrap(), root);
    let two = dir.path().join("two");
    fs::create_dir_all(two.join("search")).unwrap();
    fs::create_dir_all(two.join("button")).unwrap();
    assert_eq!(locate(&two).unwrap(), two);
}

#[cfg(unix)]
#[test]
fn a_fifo_in_place_of_a_file_does_not_block() {
    // review 026 #8: File::open on a FIFO waits for a writer
    let (_d, _, assets) = mr_tree();
    let file = assets.join("setup/data.json");
    fs::remove_file(&file).unwrap();
    let ok = std::process::Command::new("mkfifo")
        .arg(&file)
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        return;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let a = assets.clone();
    std::thread::spawn(move || tx.send(scan(&a, MrOs::Linux).setup).unwrap());
    let setup = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("the scan must not hang");
    assert_eq!(setup.unwrap().error.as_deref(), Some("unreadable"));
}

#[test]
fn a_failed_backup_skips_the_part() {
    let dir = tempdir().unwrap();
    let files = config(dir.path());
    // a folder where the file would be: unreadable → left alone (review 026 #5)
    fs::create_dir_all(&files.keymap).unwrap();
    // themes.json as a folder: no backup possible → reported
    fs::create_dir_all(&files.themes).unwrap();
    let plan = MrApply {
        keymap: Some(BTreeMap::new()),
        buttons: Some(BTreeMap::new()),
        backup_themes: true,
        ..MrApply::default()
    };
    let report = apply(&files, plan, MrOs::Linux, None);
    assert_eq!(report.imported, vec!["buttons"]);
    let codes: Vec<(&str, Option<&str>)> = report
        .warnings
        .iter()
        .map(|w| (w.code.as_str(), w.key.as_deref()))
        .collect();
    assert_eq!(
        codes,
        vec![
            ("part_skipped", Some("keymap")),
            ("part_failed", Some("themes"))
        ]
    );
    assert!(files.keymap.is_dir());
}

#[test]
fn plan_sizes_are_checked() {
    let mut plan = MrApply::default();
    assert!(plan_ok(&plan));
    plan.buttons = Some((0..6).map(|i| (format!("s{i}"), Vec::new())).collect());
    assert!(!plan_ok(&plan));
}
