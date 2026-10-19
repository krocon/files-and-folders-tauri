# Feature-Parität mit `files-and-folders`

Stand **Prompt 018** (2026-10-19). Vorlage (SOLL) ist die letzte alte Version **`files-and-folders-mr`**, Quellcode
unter `old_project/` (nicht im Git); Zusammenfassung in [legacy-analysis-mr.md](legacy-analysis-mr.md) („mr §“), die
ältere AngularJS-Version in [legacy-analysis.md](legacy-analysis.md) („legacy §“). „Kompatibel“ gilt nur, wenn
Implementierung **und** Test vorliegen: jede ✅-Zeile nennt mindestens einen Test (Vitest-Spec › „it-Titel“ bzw.
Rust-Testfunktion), alle per grep geprüft.

## Quellen

| Projekt | Art | Stack | Lizenz |
| --- | --- | --- | --- |
| npm `files-and-folders` 0.0.14 (2017) | Launcher-Paket für Client/Server | Node, hängt von `files-and-folders-client`/`-server` ab | MIT (package.json) |
| `krocon/node-files-and-folders` | App (Client/Server), Quelle des npm-Pakets | Node + AngularJS 1.x, WebSockets | MIT (package.json, keine LICENSE-Datei gefunden) |
| `krocon/files-and-folders` (2022) | App (Browser-UI + Node-API, Docker) | Nx, Angular 13, NestJS, ag-grid | „ISC“ in package.json, keine LICENSE-Datei |
| `krocon/files-and-folders-mr` (2026) | App (Web + Electron) | Angular 20, NestJS 10, Electron 30 | Custom Source-Available License – **kein Code übernehmen** |

Das npm-Paket bietet **keine** programmatische Bibliotheks-API im engeren Sinn, sondern startet eine
Client/Server-App. Parität wird daher **funktional** (Bedienung/Features) angestrebt, nicht als
API-Kompatibilität. Die WebSocket-/REST-Schnittstellen der Referenzen werden bewusst **nicht**
nachgebildet – hier ersetzt Tauri-IPC sie.

## Matrix

## Zusammenfassung

| Abschnitt | ✅ | 🟡 | ⬜ | ✖ |
|---|---|---|---|---|
| A Aktionen | 66 | 5 | 3 | 13 |
| B Button-Leiste | 9 | 2 | 1 | 1 |
| C Dialoge und Optionen | 17 | 8 | 0 | 2 |
| D Dateiliste | 19 | 2 | 0 | 0 |
| E Panels, Tabs, Persistenz | 18 | 2 | 0 | 0 |
| F Operationen & Jobs | 17 | 2 | 0 | 1 |
| G Konfigurationsdateien & Editoren | 7 | 3 | 1 | 0 |
| H Shell-Leiste, Server-Shell, KI, Electron | 5 | 2 | 3 | 4 |
| I Bugs der alten Versionen | 37 | 0 | 1 | 2 |
| **Summe** | **195** | **26** | **9** | **23** |

- Die ⬜-Zeilen sind die Folge-Prompts 021 ff. (Abschnitt „Folge-Prompts“), die ✖-Zeilen sind bewusst entfallen
  (Web-/Server-Transport, Electron, tote Ids, nie funktionierende Kürzel der alten Version) – Grund je Zeile.
- Alle Fehler aus mr §11 und legacy §9 sind behoben oder entfallen (Abschnitt I).
- In 018 geschlossen: alte Kürzel, die in mr wirklich funktionierten (J1–J6), Actions-Menü per Tastatur (J7), Ordner
  in „Go to anything“ (J9), Shift+Leertaste und Umschalten ohne Bewegen (J10), Tab-Verlauf (J12), Shift+Klick
  schließt Tabs (J13); dazu das Actions-Menü nach Vorbild (Prompt 020) und drei Fehler aus dem E2E-Arbeitstag.

Status: ✅ umgesetzt + Test · 🟡 teilweise / ohne Test · ⬜ fehlt · ✖ bewusst entfallen (Grund).
Testangaben: Vitest = `<spec-Datei relativ zu src/app/>` › „it-Titel“; Rust = `src-tauri/src/<datei>` › `fn`.
Alle zitierten Titel/Funktionen sind per grep im Repo vorhanden (528 `it(...)`, 325 `#[test]`).

**Lesehilfe Kürzel alt:** Format `osx | win/linux`. Windows/Linux-Dateien sind identisch bis auf die markierten
Stellen. `cmd` = Meta auch unter Windows/Linux (= Windows-Taste, mr-Bug 2). **†** = Kürzel feuerte in mr nie, weil
mr den Event-String in der Reihenfolge `ctrl+alt+shift+cmd` baute und roh gegen die JSON-Schlüssel verglich
(mr-Bug 1: alles mit `cmd+alt…`, `cmd+ctrl…`, `cmd+shift…`, dazu `ctrl+delete`, `ctrl+alt+plus/minus`).
Kürzel neu: `Mod` = ⌘ auf macOS, Strg auf Windows/Linux. `Win/Lx` = Windows und Linux (Dateien identisch bis auf
eine Leerzeile).

## A. Aktionen

### A.1 Echte Aktions-Ids von mr (`apps/fnf/src/app/domain/action/fnf-action.enum.ts`, Handler in
`service/action-execution.service.ts`, `feature/main/filetable/file-table.component.ts` `actionCall`,
`feature/main/footer/buttonpanel/buttonpanel.component.ts`)

| Funktion | Referenz alt (Id · Label · Kürzel osx \| win/linux) | Umsetzung neu (Id · Handler · Kürzel macOS \| Win/Lx) | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Aktion aufrufen | `OPEN_CALL_ACTION_DLG` · – · `f10` \| `f10` | `OPEN_CALL_ACTION_DLG` · ja (`workspace-actions.ts`) · `F10` \| `F10` | ✅ | `features/actions/workspace-actions.spec.ts` › „opens the dialogs“; `features/actions/command-palette.spec.ts` › „is a combobox with a listbox of all actions and shortcuts“ | = Palette mit Fokus auf Aktionen |
| Neuer Tab | `ADD_NEW_TAB` · Add Tab · `cmd+alt+t`† \| `cmd+alt+t`† | `CLONE_TAB` · ja · `Mod+Alt+T` \| `Mod+T` | ✅ | `features/workspace/workspace.store.spec.ts` › „clones the active tab next to it and selects the clone“; `features/workspace/tab-bar.spec.ts` › „clones with + and closes with −, the last tab stays“ | Id umbenannt (Design 002 §3.2) |
| Cursor ↑/↓ | `ARROW_UP`/`ARROW_DOWN` · Change Focus · `up`/`down` (keyup, ohne Repeat) | Table-Navigation (kein Aktions-Id) | ✖ | `core/actions/keyboard-dispatcher.spec.ts` › „leaves navigation keys to the table“ | Navigation gehört der GuiExpert Table (Design 002 D6), mit Auto-Repeat (behebt mr-Bug 11) |
| Pos1/Ende/Bild↑/Bild↓ | `HOME_PRESSED`, `END_PRESSED`, `PAGEUP_PRESSED`, `PAGEDOWN_PRESSED` · Jump to begin/end/top/bottom · `cmd+left`, `cmd+right`, `cmd+up`, `cmd+down` | Table (`Home`/`End` auf `NAVIGATE_FIRST_CELL`/`LAST_CELL` umgebogen, PageUp/Down) | ✖ | `features/browser/file-list/file-table-model.spec.ts` › „creates a compact table without table selection and with file-list shortcuts“ | Table-Tasten statt Aktionen (D6). ⌘←/⌘→/⌘↑/⌘↓ als Sprungtasten auf macOS nicht mehr belegt |
| Namen in Zwischenablage | `COPY_2_CLIPBOARD_NAMES` · Copy names to clipboard · – | `COPY_2_CLIPBOARD_NAMES` · ja (`os-actions.ts`) · `Mod+Alt+N` \| `Mod+Alt+N` | ✅ | `features/osintegration/os.spec.ts` › „copies names and paths as lines and JSON in display order, folders included“; `core/os/clipboard.spec.ts` › „names and paths as lines, folders included, order kept“ | eine Zeile je Eintrag, Ordner dabei (alt: Tab-getrennt, nur Dateien) |
| Pfade in Zwischenablage | `COPY_2_CLIPBOARD_FULLNAMES` · – | `COPY_2_CLIPBOARD_FULLNAMES` · ja · `Mod+Alt+C` \| `Mod+Alt+C` | ✅ | wie oben | |
| Namen als JSON | `COPY_2_CLIPBOARD_NAMES_AS_JSON` · – | `COPY_2_CLIPBOARD_NAMES_AS_JSON` · ja · – \| – | ✅ | `core/os/clipboard.spec.ts` › „JSON is an indented array of strings that parses back“ | |
| Pfade als JSON | `COPY_2_CLIPBOARD_FULLNAMES_AS_JSON` · – | `COPY_2_CLIPBOARD_FULLNAMES_AS_JSON` · ja · – \| – | ✅ | wie oben | |
| (tot) Abwählen | `DESELECT` · Deselect All · – (kein Handler) | → `DESELECT_ALL` | ✖ | – | tote Id (mr §2) |
| Alles abwählen | `DESELECT_ALL` · Deselect All · `ctrl+cmd+d` (+`cmd+ctrl+d`†) \| gleich (⊞-Taste) | `DESELECT_ALL` · ja · `Mod+Shift+A`, `Mod+NumpadSubtract` \| gleich | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „marks all, unmarks all and inverts on the displayed rows“ | 018: ⌃⌘D wieder „alle abwählen“ (`core/actions/keymap.spec.ts` › „keeps the shortcuts of the old version that really fired (018 J1–J6, mr defaults)“) |
| Markieren per Muster | `ENHANCE_SELECTION` · Enhance Selection · `ctrl+alt+plus`† | `OPEN_MARK_PATTERN_DLG` · ja · `NumpadAdd` \| `NumpadAdd` | ✅ | `features/actions/dialogs.spec.ts` › „mark by pattern: suggests the cursor extension, counts live, marks on submit“; `features/actions/pattern.spec.ts` › „globs with wildcards, case-insensitive“ | Glob + Regex + Vorlagen; alte Syntax `-term`/`a\|b` bleibt (`pattern.spec.ts` › „matches terms without wildcard as substring, \| as or, - excludes“) |
| Öffnen (Enter) | `ENTER_PRESSED` · Execute File · `enter` | `NAVIGATE_OPEN` · ja · `Enter` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „opens the cursor folder and goes up again“; `features/browser/navigation.spec.ts` › „opens files with the default app and asks before running programs“ | Rückfrage bei Programmen (neu) |
| Verlauf zurück | `NAVIGATE_BACK` · History Back · `cmd+alt+up`† | `NAVIGATE_BACK` · ja · `Mod+[` \| `Alt+ArrowLeft` | ✅ | `features/browser/navigation.spec.ts` › „goes back and forward with cursor and scroll position“ | + Maustasten 4/5 |
| Verlauf vor | `NAVIGATE_FORWARD` · Forward · `cmd+alt+shift+up`† | `NAVIGATE_FORWARD` · ja · `Mod+]` \| `Alt+ArrowRight` | ✅ | wie oben | alt: Wrap-around; neu: Stapel |
| Elternordner | `NAVIGATE_LEVEL_DOWN` · „Parent Dir“ · `cmd+alt+down`† | `NAVIGATE_PARENT` · ja · `Backspace` \| `Backspace` | ✅ | `features/browser/file-browser.store.spec.ts` › „goes up and puts the cursor on the folder it came from“; `features/browser/navigation.spec.ts` › „".." opens the parent“ | Id umbenannt (mr-Bug 5) |
| Nächster Tab | `NEXT_TAB` · Toggle Tabs · `shift+tab` | `NEXT_TAB` (+ `PREV_TAB`) · ja · `Ctrl+Tab` / `Ctrl+Shift+Tab` \| `Mod+Tab` / `Mod+Shift+Tab` | ✅ | `features/workspace/workspace.store.spec.ts` › „cycles through tabs with wrap-around“ | `Shift+Tab` = Fokus rückwärts (Barrierefreiheit) |
| Über | `OPEN_ABOUT_DLG` · About... · `cmd+ctrl+shift+f1`† (Route `/about`) | `OPEN_ABOUT_DLG` · ja · – \| – (macOS App-Menü) | ✅ | `features/about/about-dialog.spec.ts` › „shows version, build and platform“; Rust `about.rs` › `fills_build_and_platform_data` | Dialog statt Route |
| Attribute ändern | `OPEN_ATTRIBUTE_DLG` · File Attributes... · `cmd+ctrl+shift+f2`† (Archive/Hidden/Read only/System, Datum/Zeit setzen) | `OPEN_ATTRIBUTE_DLG` „Properties…“ · ja · `Alt+Enter`, `Mod+I` \| `Alt+Enter` | 🟡 | `features/preview/preview.spec.ts` › „rows of the properties dialog are platform-specific“; Rust `properties.rs` › `unix_mode_owner_and_links` | nur Anzeige; Ändern von Attributen/Rechten/Datum fehlt (→ K) |
| Ordner wechseln (Baum) | `OPEN_CHDIR_DLG` · Change Dir... · `ctrl+alt+d`, `ctrl+alt+9` \| gleich (Baum der Unterordner, Tiefe-Regler, Filter) | `OPEN_FOLDER_FINDER_DLG` · ja · `Alt+F10` \| `Alt+F10`; dazu `OPEN_CHDIR_DLG` = **Pfadeingabe** · `Mod+L`, `Mod+Ctrl+D` \| `Mod+L` | ✅ | `features/search/folder-finder-logic.spec.ts` › „fuzzy, name matches first, then path matches“; `features/workspace/file-panel.spec.ts` › „path input: Strg/⌘+L, errors stay in the field, a file opens its folder with the cursor on it“ | flache Liste statt Baum; gleiche Id bedeutet jetzt Pfadeingabe; 018: ⌃⌥D bzw. Strg+Alt+D → Pfadeingabe (`core/actions/keymap.spec.ts` › „keeps the shortcuts of the old version that really fired (018 J1–J6, mr defaults)“); `Ctrl+Alt+9` nicht (AltGr+9 = `]`) |
| (tot) Farbkonfig | `OPEN_COLORCONFIG_DLG` · Color Config... · `cmd+ctrl+f3`† | → `OPEN_THEMES_DLG` | ✖ | – | tote Id |
| Kopieren | `OPEN_COPY_DLG` · Copy · `f5`, `ctrl+cmd+c` (+`cmd+ctrl+c`†) | `OPEN_COPY_DLG` · ja · `F5` \| `F5` | ✅ | `features/ops/ops.spec.ts` › „F5: marked entries to the other panel, then unmarked“; Rust `jobs/tests_engine.rs` › `conflict_overwrite_skip_rename_and_apply_to_all` | 018: ⌃⌘C ergänzt |
| Löschen | `OPEN_DELETE_DLG` · Delete · `f8`, `ctrl+delete`† | `OPEN_DELETE_DLG` · ja · `F8`, `Mod+Backspace` \| `F8`, `Delete`; + `DELETE_PERMANENT` `Shift+F8`, `Mod+Alt+Backspace` \| `Shift+F8`, `Shift+Delete` | ✅ | `features/ops/ops.spec.ts` › „F8: trash by default, the cursor moves to the next remaining entry“; Rust `jobs/tests_ops.rs` › `delete_to_the_trash` | Papierkorb statt endgültig |
| Ordner aufräumen | `OPEN_DELETE_EMPTY_FOLDERS_DLG` · Clean Folders... · `ctrl+alt+shift+d` \| gleich | `OPEN_DELETE_EMPTY_FOLDERS_DLG` · ja · `Mod+Alt+R`, `Mod+Alt+Shift+D` \| gleich | ✅ | `features/groupfiles/tools.spec.ts` › „searches on open, again on changes, drops stale answers and deletes to the trash“; Rust `jobs/tests_tools.rs` › `clean_deletes_children_first_and_nothing_outside_the_start_folder` | 018: macOS ⌃⌥⇧D ergänzt |
| Abwählen per Muster | `OPEN_DESELECT_DLG` · Reduce Selection... · `cmd+alt+d`† (tot) | `OPEN_UNMARK_PATTERN_DLG` · ja · `NumpadSubtract` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „marks and unmarks by a name predicate“ | |
| Bearbeiten | `OPEN_EDIT_DLG` · Edit · `f4` (Monaco in `edit.html`, Speichern) | `OPEN_EDIT_DLG` · ja (Tool `edit`, Default Standard-App) · `F4` | 🟡 | `features/osintegration/os.spec.ts` › „F4 (default app) asks before running a program, like Enter (review 011 #1)“, „F4 without an "edit" tool explains what is missing“ | kein eingebauter Editor (→ K) |
| Suchen | `OPEN_FIND_DLG` · Find... · `ctrl+f` | `OPEN_FIND_DLG` · ja · `Alt+F7`, `Mod+F` \| gleich | ✅ | `features/search/search.store.spec.ts` › „starts a search job and opens a result tab after the active one“; Rust `search.rs` › `name_modes_case_and_whole_name` | macOS ⌃F → ⌘F |
| Duplikate | `OPEN_FIND_DUBLICATES_DLG` · Find Dublicates... · `ctrl+alt+shift+f` (tot, nicht implementiert) | `OPEN_FIND_DUPLICATES_DLG` · ja · `Alt+Shift+F7` \| gleich (+ `DUP_MARK_KEEP_*`) | ✅ | `features/archive/archive.spec.ts` › „duplicates: a result tab with groups, selection helpers and the delete warning“; Rust `duplicates.rs` › `known_duplicates_are_grouped` | neu implementiert; Tippfehler-Id korrigiert; 018: ⌃⌥⇧F bzw. Strg+Alt+Shift+F ergänzt |
| Go to anything | `OPEN_GOTO_ANYTHING_DLG` · Go to anything... · `ctrl+cmd+g` (+`cmd+ctrl+g`†) | `OPEN_COMMAND_PALETTE` · ja · `Mod+Shift+P`, `Mod+Ctrl+G` \| `Mod+Shift+P` | ✅ | `features/actions/command-palette.spec.ts` › „filters fuzzily, shows the shortcut and runs with Enter“ | 018: auch Ordner aus Tabs, Verläufen, Favoriten, zuletzt (`command-palette.spec.ts` › „lists known folders … (018 J9)“) + Farbschemata |
| Gruppieren | `OPEN_GROUPFILES_DLG` · Group Files... · `ctrl+alt+g` | `OPEN_GROUPFILES_DLG` · ja · `Alt+G`, `Mod+Alt+G` \| gleich | ✅ | `features/groupfiles/tools.spec.ts` › „previews, uses the other side as root and starts one group job“; Rust `jobs/tests_tools.rs` › `group_copy_and_move_into_new_and_existing_group_folders` | 018: macOS ⌃⌥G ergänzt |
| (tot) Job-Queue | `OPEN_JOB_QUEUE_DLG` · Open Action Queue Dialog · `cmd+ctrl+f4`† | → `OPEN_TASK_DLG` | ✖ | – | tote Id |
| Ordner anlegen | `OPEN_MKDIR_DLG` · MkDir · `shift+f7`, `ctrl+alt+n` (kein `f7`) | `OPEN_MKDIR_DLG` · ja · `F7`, `Shift+F7` \| gleich | ✅ | `core/actions/keymap.spec.ts` › „binds the Total Commander function keys and F7 = MkDir“; `features/ops/ops.spec.ts` › „F7: suggests the next name of a series, creates and puts the cursor on it“; Rust `fileops.rs` › `make_dir_simple_nested_and_existing` | 018: macOS ⌃⌥N ergänzt; Win/Lx belegt (Namen kopieren) |
| Verschieben | `OPEN_MOVE_DLG` · Move · `f6`, `ctrl+cmd+m` | `OPEN_MOVE_DLG` · ja · `F6` | ✅ | `features/ops/ops.spec.ts` › „F6: dangerous sources are listed and need the extra confirmation“; Rust `jobs/tests_ops.rs` › `move_across_volumes_copies_then_deletes_the_source` | 018: ⌃⌘M ergänzt |
| Multi-MkDir | `OPEN_MULTIMKDIR_DLG` · Multi MkDir... · `cmd+ctrl+f5`† | `OPEN_MULTIMKDIR_DLG` · ja · `Mod+F7` | ✅ | `features/groupfiles/tools.spec.ts` › „creates the folders and keeps failed names in the dialog“; `features/multimkdir/mkdir-engine.spec.ts` › „counter with start, end, step and digits“; Rust `fileops.rs` › `create_folders_never_touches_existing_entries` | |
| Multi-Rename | `OPEN_MULTIRENAME_DLG` · Multi Rename... · `cmd+f6`, `ctrl+f6`, `ctrl+alt+m` \| gleich | `OPEN_MULTIRENAME_DLG` · ja · `Mod+F6` \| `Mod+F6`, `Mod+Alt+M`, `Mod+M` | ✅ | `features/multirename/multirename.spec.ts` › „runs a job with all pairs, unmarks, follows the cursor and remembers the rules“; Rust `jobs/rename.rs` › `run_simple_chain_swap_and_three_cycle` | 018: macOS ⌃F6/⌃⌥M ergänzt |
| Umbenennen | `OPEN_RENAME_DLG` · Rename... · `shift+f6`, `cmd+alt+r`† | `OPEN_RENAME_DLG` · ja · `Shift+F6`; + `RENAME_INLINE` `F2` | ✅ | `features/ops/ops.spec.ts` › „Shift+F6: the name without extension is selected; rename moves the cursor“, „F2 renames in the list; a failed rename opens the dialog with the typed name“; Rust `fileops.rs` › `rename_plain_existing_and_case_only` | `Mod+Alt+R` neu = Ordner aufräumen |
| (tot) Auswahl-Dialog | `OPEN_SELECT_DLG` · Enhance Selection... · `ctrl+alt+a` (kein Handler) | → `OPEN_MARK_PATTERN_DLG` | ✅ | wie „Markieren per Muster“ | 018: ⌃⌥A bzw. Strg+Alt+A ergänzt |
| Einstellungen | `OPEN_SETUP_DLG` · Setup... · `cmd+ctrl+f6`† (Route `/setup`, 6 Checkboxen) | `OPEN_SETUP_DLG` · ja · `Mod+,` \| `Mod+,` | ✅ | `features/settings/settings-dialog.spec.ts` › „applies a change at once and resets the section“; Rust `settings.rs` › `round_trip_keeps_only_changes` | Dialog statt Route |
| Theme-Editor | `OPEN_THEMES_DLG` · Fancy Theme Editor... · `cmd+ctrl+shift+f3`† (eigenes Fenster) | `OPEN_THEMES_DLG` „Colour schemes…“ · ja · – | ✅ | `features/themes/theme-dialog.spec.ts` › „previews an edit, warns about contrast, refuses unsafe values and saves as a new scheme“ | im Fenster als Dialog; kein Kürzel |
| Button-Konfig | `OPEN_BUTTON_CONFIG_DLG` · Button Configuration... · `cmd+ctrl+shift+f4`† (Monaco-JSON) | `OPEN_BUTTON_CONFIG_DLG` · **kein Handler** (`m(…,'018')`) | ⬜ | – | `buttons.json` nur eingebaut, keine Nutzerdatei (→ K) |
| Dateityp-Konfig | `OPEN_FILETYPE_CONFIG_DLG` · File Type Configuration... · `cmd+ctrl+shift+f5`† | – (Kategorien fest in `core/file-icon/file-icon.service.ts` `FILE_CATEGORIES`) | ⬜ | `core/file-icon/file-icon.service.spec.ts` › „provides the 11 configured categories and extensions“ (nur fest) | keine Datei, kein Editor (→ K) |
| Tool-Konfig | `OPEN_TOOL_CONFIG_DLG` · Tool Configuration... · `cmd+ctrl+shift+f6`† (OS-Auswahl, Monaco) | `OPEN_TOOL_CONFIG_DLG` · ja · – | ✅ | `features/osintegration/os.spec.ts` › „opens the tools palette and the configuration dialog“; Rust `tools.rs` › `mr_format_is_imported` | nur eigenes OS |
| Prompt-Konfig (KI) | `OPEN_PROMPT_CONFIG_DLG` · Prompt Configuration... · `cmd+ctrl+shift+f8`† | – | ⬜ | – | KI-Funktionen fehlen insgesamt (→ H, K) |
| Theme-JSON-Konfig | `OPEN_THEME_CONFIG_DLG` · Theme Configuration... · `cmd+ctrl+shift+f7`† | → `OPEN_THEMES_DLG` (Import/Export) | ✖ | `core/theme/theme.service.spec.ts` › „imports own and old files and exports complete schemes“ | gleicher Dialog wie Theme-Editor (Design 020) |
| Server-Shell | `OPEN_SHELL_DLG` · Server Shell... · `cmd+ctrl+f7`† (Route `/shell`, spawn) | – (`OPEN_TERMINAL_HERE` öffnet System-Terminal) | ✖ | `features/osintegration/os.spec.ts` › „reveals the cursor entry (else the folder) and opens the terminal in the folder“ | Desktop-App: System-Terminal statt Server-Shell (mr §11 Drop) |
| Kürzel-Editor | `OPEN_SHORTCUT_DLG` · Shortcuts... · `cmd+ctrl+f8`† | `OPEN_SHORTCUT_DLG` · ja · `Mod+Shift+K` | ✅ | `features/actions/dialogs.spec.ts` › „shortcuts: records a new shortcut into the override, removes and resets“; Rust `keymap.rs` › `round_trip_including_empty_lists` | Override je Aktion (mr: ersetzte alles); nur eigenes OS |
| Entpacken | `OPEN_UNPACK_DLG` · Unpack... · `cmd+ctrl+f9`† (7z/zip/rar…, Passwort) | `OPEN_UNPACK_DLG` · ja · `Alt+F9` | 🟡 | `features/archive/archive.spec.ts` › „Alt+F9 unpacks the selected archives, Alt+F5 packs the selection“; Rust `jobs/tests_archive.rs` › `pack_and_extract_round_trip` | nur ZIP/TAR/TAR.GZ, kein Passwort, kein 7z/RAR |
| Packen | `OPEN_PACK_DLG` · Pack... · `cmd+ctrl+f10`† (Format 7z Default, Stufe, Passwort) | `OPEN_PACK_DLG` · ja · `Alt+F5` | 🟡 | wie oben | ZIP/TAR/TAR.GZ + Stufe; kein 7z, kein Passwort |
| Download | `OPEN_DOWNLOAD_DLG` · Download... · `cmd+ctrl+f11`† | – | ✖ | – | nur Browser-Betrieb (mr §10) |
| Ansicht | `OPEN_VIEW_DLG` · View · `f3` (Monaco read-only) | `OPEN_VIEW_DLG` · ja · `F3` | ✅ | `features/preview/preview.spec.ts` › „opens the viewer, steps through files only and moves the panel cursor“; Rust `preview/mod.rs` › `huge_sparse_file_reads_only_the_limit` | Text/Hex/Bild statt Monaco |
| Datei anlegen | `OPEN_CREATE_FILE_DLG` · Create File · `shift+f4` | `OPEN_CREATE_FILE_DLG` · ja · `Shift+F4` | ✅ | `features/ops/ops.spec.ts` › „errors keep the name dialog open“; Rust `fileops.rs` › `create_file_never_overwrites` | |
| Taskmanager | `OPEN_TASK_DLG` · Taskmanager... · `ctrl+k f6` \| `ctrl+f11` | `OPEN_TASK_DLG` · ja · `Ctrl+K F6` \| `Mod+F11` | ✅ | `features/jobs/job-actions.spec.ts` › „opens the task list“; `core/actions/keyboard-dispatcher.spec.ts` › „handles chords (macOS Ctrl+K F6) with a timeout“ | |
| Actions-Menü öffnen | `OPEN_MENU` · Menu · `ctrl+k ctrl+m` \| `ctrl+f12` (öffnet „Actions ▲“) | `OPEN_ACTIONS_MENU` · ja (`button-bar.ts`) · `Ctrl+K Ctrl+M` \| `Mod+F12` | ✅ | `features/workspace/button-bar/button-bar.spec.ts` › „opens the Actions menu by keyboard (OPEN_ACTIONS_MENU, mr OPEN_MENU – 018 J7)“ | 018: `Mod+F12` auf Win/Lx von der Palette zurück an das Menü |
| Debug | `PRINT_DEBUG` · Debug · Bug-Button | – | ✖ | – | Debug-Hilfe (mr §11 Drop) |
| Abwählen per Muster | `REDUCE_SELECTION` · Reduce Selection · `ctrl+alt+minus`† | `OPEN_UNMARK_PATTERN_DLG` · ja · `NumpadSubtract` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „marks and unmarks by a name predicate“ | |
| Neu laden | `RELOAD_DIR` · Reload... · `ctrl+cmd+r` (+`cmd+ctrl+r`†) | `RELOAD_DIR` · ja · `Mod+R` \| `Mod+R` | ✅ | `features/actions/workspace-actions.spec.ts` › „opens folders, goes up and reloads in the active panel“ | 018: ⌃⌘R ergänzt |
| Links/rechts neu laden | `RELOAD_DIR_0`/`RELOAD_DIR_1` · Reload Left/Right · `cmd+ctrl+f1`/`f2`† (+ Doppelklick Tab) | – (Doppelklick auf Tab lädt neu; Watcher, 012) | ✖ | `features/workspace/tab-bar.spec.ts` › „reloads on double click“ | Panels aktualisieren sich selbst |
| Tab schließen | `REMOVE_TAB` · Remove Tab · `cmd+alt+w`† | `CLOSE_TAB` · ja · `Mod+Alt+W` \| `Mod+W` | ✅ | `features/workspace/workspace.store.spec.ts` › „closes tabs but always keeps the last one“ | |
| (tot) Konfig speichern | `SAVE_CONFIG` · Save Config · `ctrl+cmd+s` | – | ✖ | `features/workspace/workspace.store.spec.ts` › „saves debounced after a change“ | automatisches Speichern |
| Alles markieren | `SELECT_ALL` · Select All · `ctrl+cmd+a` (+`cmd+ctrl+a`†) | `SELECT_ALL` · ja · `Mod+A`, `Mod+NumpadAdd` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „marks all, unmarks all and inverts on the displayed rows“; `features/browser/navigation.spec.ts` › „does not mark ".." with Space or "mark all"“ | 018: ⌃⌘A ergänzt |
| Linkes Panel (+ Menü) | `SELECT_LEFT_PANEL` · Left Panel · `cmd+alt+left`† (aktiviert **und** öffnet Favs-Menü) | `SELECT_LEFT_PANEL` `Alt+1` + `OPEN_FOLDER_MENU_LEFT` `Alt+F1` · ja | ✅ | `features/actions/workspace-actions.spec.ts` › „switches panels and tabs, clones and closes tabs“; `features/workspace/file-panel.spec.ts` › „keeps hidden/filter per tab and opens folders from the folder menu“ | in zwei Aktionen getrennt |
| Rechtes Panel (+ Menü) | `SELECT_RIGHT_PANEL` · Right Panel · `cmd+alt+right`† | `SELECT_RIGHT_PANEL` `Alt+2` + `OPEN_FOLDER_MENU_RIGHT` `Alt+F2` · ja | ✅ | wie oben | |
| Leertaste | `SPACE_PRESSED` · Toggle selection on focussed row · `space` (+ Ordnergröße) | `TOGGLE_MARK_AND_ADVANCE` · ja · `Space`, `Ctrl+0` \| `Space`, `Insert` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „toggles the mark and moves the cursor down (Space/Insert)“; `features/browser/navigation.spec.ts` › „calculates a folder size as a job, shows it and cancels jobs when leaving“ | Größe abschaltbar (`behavior.spaceCalcSize`) |
| Shift+Leertaste | `SHIFT_SPACE_PRESSED` · gleiches Label · `shift+space` (umschalten, Cursor hoch) | `TOGGLE_MARK_AND_RETREAT` · ja · `Shift+Space` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „Shift+Space toggles and moves up, Mod+Shift+Space toggles in place (018 J10, mr)“ | 018 ergänzt, mit Auto-Repeat |
| Filter | `TOGGLE_FILTER` · Toggle Filter Input · `cmd+alt+f`† | `TOGGLE_FILTER` · ja · `Mod+Alt+F` \| gleich | ✅ | `features/browser/navigation.spec.ts` › „filters hidden files and by pattern; ".." always passes“ | Wildcards, `\|`, `-ausschließen` |
| Versteckte Dateien | `TOGGLE_HIDDEN_FILES` · Toggle Hidden Files · `cmd+alt+shift+h`† | `TOGGLE_HIDDEN_FILES` · ja · `Mod+Shift+.` \| `Mod+H` | ✅ | `features/workspace/file-panel.spec.ts` › „keeps hidden/filter per tab and opens folders from the folder menu“ | |
| Panel wechseln | `TOGGLE_PANEL` · Toggle Panels · `tab` | `TOGGLE_PANEL` · ja · `Tab` | ✅ | `features/workspace/workspace.store.spec.ts` › „switches the active side: source and target follow, the new side gets the focus“ | |
| Markierung umkehren | `TOGGLE_SELECTION` · Toggle Selection · `ctrl+space` | `INVERT_MARKS` · ja · `NumpadMultiply` | ✅ | `features/browser/file-browser.store.spec.ts` › „marks all and inverts“ | ⌃Space nicht übernommen (macOS Eingabequelle, Windows-IME) |
| Zeile umschalten ohne Bewegen | `TOGGLE_SELECTION_CURRENT_ROW` · Toggle Selection Current Row · `ctrl+shift+space` | `TOGGLE_MARK` · ja · `Mod+Shift+Space` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „Shift+Space toggles and moves up, Mod+Shift+Space toggles in place (018 J10, mr)“ | 018: eigene Aktion `TOGGLE_MARK` (`Mod+Shift+Space`); Strg/⌘+Klick schaltet ebenfalls ohne Bewegen |
| Shell-Leiste | `TOGGLE_SHELL` · Toggle Shell · `shift+f11` | `TOGGLE_SHELL` · Shell-Zeile ein/aus/fokussieren · `Shift+F11`; dazu `SHELL_INSERT_NAMES` (`Mod+Shift+Enter`), `SHELL_INSERT_PATHS` (`Mod+Alt+Enter`), `SHELL_CLEAR_OUTPUT` | ✅ | `features/shell/shell.spec.ts` › „TOGGLE_SHELL shows and focuses, then hides; it follows shell.enabled“, „inserts the marked names (or full paths), quoted by Rust, at the caret“ | Prompt 021: Pipes statt PTY, eigenes Sicherheitsmodell (Design 021 E1, CLAUDE.md §4) |
| Pseudo | `DO_NOTHING`, `DUMMY_ACTION` (`ctrl+cmd+enter`, osx `ctrl+m`, win `cmd+ctrl+enter`†), `-` | – | ✖ | – | Platzhalter |
| (tot, nur JSON) | `EDIT_FILE` · – · `cmd+e` | – | ✖ | – | nie behandelt |

### A.2 Tool-Ids (`apps/fnf-api/src/assets/tool/defaults/{osx,linux,windows}.json`)

| Funktion | Referenz alt | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Editor-Tool | `CMD_EDIT_FILE` `code $file` · osx `ctrl shift 4`, linux `control 4`, win `f4` (überschrieb `OPEN_EDIT_DLG`) – Tool-Kürzel feuerten nie (mr-Bug 1) | Tools `edit` (Default-App, F4) + `vscode` je OS in `src-tauri/src/tools.rs` `defaults()`; Palette `tool:<id>`, `OPEN_TOOLS_DLG` `Mod+Shift+X` | ✅ | Rust `tools.rs` › `defaults_are_valid_and_the_new_file_parses_back`, `mr_format_is_imported`, `words_and_mr_shortcuts`; `features/osintegration/os.spec.ts` › „tools become extra actions with shortcuts; the keymap wins, conflicts are reported“ | Argument-Arrays statt Shell-String; Defaults ohne Kürzel |
| Lokale Shell | `CMD_SHELL` · osx `open -a Terminal $dir` `cmd 0`; win `.bat` `control alt c`; Shortcut-JSON `cmd+shift+c`† | `OPEN_TERMINAL_HERE` · ja · `Mod+Shift+C` \| gleich | ✅ | Rust `platform/desktop.rs` › `terminal_arguments_per_program`, `linux_terminal_order`; `features/osintegration/os.spec.ts` › „reveals the cursor entry (else the folder) and opens the terminal in the folder“ | |
| Im Finder zeigen | `CMD_REVEAL_IN_FINDER` · `open $dir` · `cmd shift f`, JSON `ctrl+cmd+shift+r`† | `REVEAL_IN_FILE_MANAGER` · ja · `Mod+Shift+F` \| gleich | ✅ | Rust `platform/desktop.rs` › `uris_are_percent_encoded`; os.spec wie oben | auch Explorer/FileManager1 |
| 7-Zip (Windows) | `CMD_7ZIP` · `7z` · `control shift z` | Tool `7zip` (Windows-Default in `tools.rs`) | 🟡 | Rust `tools.rs` › `defaults_are_valid_and_the_new_file_parses_back` (nur Gültigkeit) | kein Kürzel, unter Windows nicht geprüft |

### A.3 `CHANGE_LAF_*` (`buttonpanel.component.ts`, dynamisch)

| Funktion | Referenz alt | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Design wählen | `CHANGE_LAF_BITBUCKET`, `_BLACKBOARD`, `_COFFEE`, `_COMBAT`, `_CYPRESS`, `_LIGHT`, `_NORTON`, `_PAPER` · `cmd+ctrl+alt+f1…f8`† | Palette listet Schemata; `NEXT_THEME` `Mod+Ctrl+Alt+T` \| `Ctrl+Alt+Shift+T`; `THEME_FOLLOW_SYSTEM`; 🎨-Menü | ✅ | `features/actions/command-palette.spec.ts` › „lists the colour schemes and switches to one (design 013 E3)“; `core/theme/theme.service.spec.ts` › „cycles with next()“; `features/workspace/button-bar/button-bar.spec.ts` › „opens the colour scheme menu (radio items, own first) and selects a scheme“ | keine Id je Schema (Design 013), daher keine eigenen Kürzel je Design |

### A.4 Nur neu (kein Gegenstück in mr) – Kurzbeleg

| Funktion | Umsetzung neu (Kürzel macOS \| Win/Lx) | Status | Tests |
|---|---|---|---|
| Ordner in neuem Tab | `OPEN_IN_NEW_TAB` `Mod+Enter` | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „Ctrl/⌘+Enter opens the folder under the cursor in a new tab“ |
| Ordnergrößen | `CALC_DIR_SIZES` `Alt+Shift+Enter` | ✅ | Rust `dirsize.rs` › `sums_files_and_counts_folders`; `features/browser/navigation.spec.ts` › „calculates a folder size as a job, …“ |
| Markieren mit Shift | `MARK_DOWN`/`MARK_UP`/`MARK_TO_START`/`MARK_TO_END` | ✅ | file-list-controller.spec › „marks and moves (Shift+↓/↑)“, „marks to the first/last entry (Shift+Pos1/Ende)“ |
| Favorit | `TOGGLE_FAVORITE` `Mod+D` | ✅ | `features/workspace/file-panel.spec.ts` › „toggles the favourite star for the current folder“ |
| Splitter 50/50 | `SPLITTER_RESET` | ✅ | `features/workspace/splitter.spec.ts` › „jumps to the limits and back to the middle“ |
| Suche wiederholen / Zur Datei | `RERUN_SEARCH` `Mod+Shift+F7`, `GOTO_FILE` `Mod+Shift+G` | ✅ | `features/search/search.store.spec.ts` › „search again cancels the old job and ignores its hits“, „actions: find needs a folder, go to file opens the folder of the hit with the cursor on it“ |
| Schnellvorschau | `QUICK_VIEW` `Ctrl+Q` \| `Mod+Q` | ✅ | `features/preview/preview.spec.ts` › „quick view: the other panel previews the cursor, debounced, stale answers dropped“ |
| Rückgängig Multi-Rename | `UNDO_RENAME` | ✅ | `features/multirename/multirename.spec.ts` › „undo: the action takes the last undoable job“; Rust `jobs/tests_ops.rs` › `rename_job_swap_undo_and_undo_of_undo` |
| Duplikat-Helfer | `DUP_MARK_KEEP_NEWEST/OLDEST/FIRST` | ✅ | `features/duplicates/duplicates-logic.spec.ts` › „keeps exactly one file per group“ |
| Kontextmenü / Menüleiste / Beenden | `OPEN_CONTEXT_MENU` `Shift+F10`, `FOCUS_MENU_BAR` `Alt+M` (Win/Lx), `QUIT_APP` | ✅ | `core/actions/keyboard-dispatcher.spec.ts` › „opens the context menu with Shift+F10 only in the list …“; `features/menus/menus.spec.ts` › „html: the menu bar opens with ↓, moves with →, closes with Esc; FOCUS_MENU_BAR focuses it“ |
| Mit Tool öffnen | `OPEN_TOOLS_DLG` `Mod+Shift+X` | ✅ | `features/osintegration/os.spec.ts` › „the palette in tools scope lists only the tools and runs one“ |

---

## B. Button-Leiste

`apps/fnf-api/src/assets/button/defaults/data.json` ↔ `src/app/features/workspace/button-bar/buttons.json`

| Funktion | Referenz alt | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Satz `default` | EDIT, COPY, MOVE, MKDIR, DELETE | gleich | ✅ | `features/workspace/button-bar/button-bar.spec.ts` › „shows the default set with shortcut badges, dimmed while the action is missing“; `button-config.spec.ts` › „has five known actions per modifier set“ | |
| Satz `shift` | CREATE_FILE, COPY, RENAME, MKDIR, **DELETE** | CREATE_FILE, COPY, RENAME, MKDIR, **DELETE_PERMANENT** | ✅ | button-bar.spec › „switches the set while Shift is held and shows the badge without Shift“ | Shift+F8 = endgültig (TC) |
| Satz `cmd` (macOS) | VIEW, COPY, MULTIRENAME, MKDIR, DELETE | gleich | ✅ | button-config.spec › „picks the set for the held modifiers (⌘ > Alt > Shift; Ctrl on Windows/Linux)“ | |
| Satz `ctrl` (Win/Lx) | **fehlte** (mr-Bug 3) | VIEW, COPY, MULTIRENAME, MKDIR, DELETE | ✅ | wie oben | neu |
| Satz `alt` | VIEW, **COPY**, MULTIRENAME, MKDIR, DELETE | VIEW, **PACK**, MULTIRENAME, MKDIR, DELETE | ✅ | button-config.spec › „has five known actions per modifier set“ | Alt+F5 = Packen (TC) |
| Badge | einfachstes Kürzel ohne gehaltene Modifier; `ctrl→^`, `shift→⇧`, `cmd→⌘`, `alt` als Wort | gleich (`core/actions/shortcut-badge.ts`) | ✅ | `core/actions/shortcut-badge.spec.ts` › „macOS: Mod is ⌘, Ctrl is ^, alt stays a word, Shift is ⇧, keys in lower case“, „Windows/Linux: Mod is ^“ | `alt` bewusst wie mr (kein ⌥) |
| Freigaberegeln | `get-button-enable-states.fn.ts` (MULTIRENAME > 1 Eintrag, UNPACK zip/rar/7z/tar/gz/bz2/xz, nichts im Zip) | `enabled()` je Handler + Archiv-Veto | 🟡 | `features/ops/ops.spec.ts` › „is disabled without a selection; rename needs exactly one entry“; `features/archive/archive.spec.ts` › „a non-archive file cannot be unpacked“ | Multi-Rename ab 1 Eintrag; Unpack nur ZIP/TAR/TAR.GZ |
| Actions ▲ (4 Spalten) | menuItems0–3 inkl. DOWNLOAD, THEME_CONFIG, FILETYPE_CONFIG, PROMPT_CONFIG, SHELL_DLG, Tools | `features/actions/actions-menu-def.ts` (Design 020): ohne die ✖-Einträge, + FIND_DUPLICATES, SHORTCUT_DLG | ✅ | actions-menu.spec › „four columns without headings, dividers as separators, short labels like the old version“, „shortcuts as badges …“; button-bar.spec › „opens the Actions menu with four columns“ | Gründe im Kopf von `actions-menu-def.ts` |
| Tasks-Button | busy-bee, Tooltip `finished / total` | Tasks mit Fortschritt | ✅ | button-bar.spec › „shows "finished / total" and a progress bar on the Tasks button while jobs run“ | |
| Palette-Icon (Themes) | Menü: eigene, Trenner, Defaults „L&F name“ | 🎨-Menü (eigene zuerst) | ✅ | button-bar.spec › „opens the colour scheme menu …“, „closes the colour scheme menu with a second click on its button (review 013 #10)“ | |
| Tastatur-Icon | `OPEN_SHORTCUT_DLG` | gleich (`fa-keyboard-o`) | 🟡 | – (kein Test für das Icon) | |
| Bug-Icon | `PRINT_DEBUG` | – | ✖ | – | Debug |
| Button-Konfiguration | Nutzerdatei `button/custom` + Monaco-Editor, REST PUT/reset | nur eingebaute `buttons.json` | ⬜ | – | Prompt 018 (`OPEN_BUTTON_CONFIG_DLG`) |

---

## C. Dialoge und Optionen

| Funktion | Referenz alt (Komponente, Optionen) | Umsetzung neu | Status | Tests | Abweichung/Grund (fehlende Optionen) |
|---|---|---|---|---|---|
| Kopieren/Verschieben | `cmd/copyormoveordelete`: Quelle, Live-Zählung (walkdir), Ziel mit Vorschlägen aller Tabs | `features/ops/copy-move-dialog.ts` (+ Favoriten/zuletzt, Kopie unter neuem Namen, Konfliktvorgabe) | ✅ | `features/ops/dialogs.spec.ts` › „copy: counts live, cancels the count on close and starts with the options“; Rust `jobs/tests_ops.rs` › `copy_options_conflict_default_and_new_name` | – |
| Löschen | dito ohne Ziel, endgültig | `features/ops/delete-dialog.ts` (Papierkorb/endgültig; im Papierkorb-Dialog zusätzlich roter Button „Delete permanently“, nie Default, warnt bei Hover/Fokus) | ✅ | dialogs.spec › „delete: trash confirms with Enter, permanent defaults to Cancel“, „delete: the trash dialog can delete permanently instead“ | – |
| Ordner anlegen | `cmd/mkdir`: Ziel + Serienvorschlag | `features/ops/name-dialog.ts` | ✅ | `features/ops/ops-logic.spec.ts` › „continues a series of at least two siblings“ | – |
| Datei anlegen | `cmd/createfile`: Ziel | name-dialog | ✅ | Rust `fileops.rs` › `create_file_never_overwrites` | – |
| Umbenennen | `cmd/rename`: Quelle, Ziel | name-dialog + F2 inline | ✅ | dialogs.spec › „rename: selects the name without extension, offers "Rename anyway" for dangerous paths“ | – |
| Multi-Rename | `cmd/multirename`: renameTemplate `[N][E][C][P][Q][R]`, Zähler Start/Schritt/Stellen, Capitalize, Ignore Extension, Fix german umlauts, Remove parent dir, Replace risky chars, Space to underscore, Suchen/Ersetzen (Use RegExp, only if match), strategy, **KI** | `features/multirename/multirename-dialog.ts` (+ Makros, Vorlagen, Undo) | 🟡 | `features/multirename/rename-engine.spec.ts` › „every macro example from the old help texts“; `multirename-dialog.spec.ts` › „a macro fills its row and switches replacing on; Ctrl+Enter renames“ | fehlt: KI-Modus (`ai/convertnames`); Umlaute `Ä→Ae` statt `AE` |
| Multi-MkDir | `cmd/multimkdir`: Vorlage, Zähler Start/Ende/Schritt/Stellen, Letter Case | `features/multimkdir/multimkdir-dialog.ts` | ✅ | `features/multimkdir/mkdir-engine.spec.ts` › „letters, parents and case“ | – |
| Gruppieren | `cmd/groupfiles`: Modus (10 inkl. `ebook_mode`), Mindestgröße, Ignore Brackets, Use Source Directory, strategy (inkl. **AI**) | `features/groupfiles/groupfiles-dialog.ts` | 🟡 | `features/groupfiles/group-engine.spec.ts` › „checks group names for every platform“; `tools-dialogs.spec.ts` › „group files: heading with the group count, Ctrl+Enter moves“ | fehlt: `ebook_mode`, KI-Strategie |
| Suchen | `cmd/find`: Search for (Glob `**/*.*`, Vorlagen), **Search in (Kommaliste)**, Directories only, New tab | `features/search/find-dialog.ts` (+ Regex/Text, Größe, Datum, Inhalt, Tiefe, Ausschlüsse, max. Treffer, Links) | 🟡 | `features/search/find-form.spec.ts` › „templates become globs (mr format)“, „defaults: everything below the folder, .git and node_modules excluded“ | „Search in“ nur aktueller Ordner oder markierte Ordner, **keine freie Eingabe mehrerer Ordner/Laufwerke**; eigene Vorlagen nur für die Sitzung |
| Aufräumen | `cmd/clean`: Clean in, Delete Files (`**/*.bak`), Delete empty folders | `features/cleanfolders/clean-dialog.ts` (+ Systemmüll, Papierkorb) | ✅ | `features/groupfiles/tools-dialogs.spec.ts` › „clean folders: trash is the default, permanent is red, nothing found blocks Delete“ | – |
| Attribute | `cmd/attribute`: Archive, Hidden, Read only, System, Datum/Zeit ändern | `features/preview/properties-dialog.ts` (nur Anzeige) | 🟡 | `features/preview/preview.spec.ts` › „properties: loads and calculates a folder size as a job“ | fehlt: alles Ändern |
| Packen | `cmd/pack`: Dateiname, Zielordner, **Passwort**, Format (7z), Stufe | `features/archive/pack-dialog.ts`: Name, Format ZIP/TAR/TAR.GZ, Stufe, Ziel | 🟡 | `features/archive/archive.spec.ts` › „Alt+F9 unpacks the selected archives, Alt+F5 packs the selection“ | fehlt: Passwort, 7z |
| Entpacken | `cmd/unzip`: Zielordner, **Passwort** | `features/archive/unpack-dialog.ts` (+ Unterordner je Archiv, Konflikt) | 🟡 | Rust `jobs/tests_archive.rs` › `existing_targets_ask_and_are_never_overwritten_silently` | fehlt: Passwort, 7z/RAR |
| Download | `cmd/download` | – | ✖ | – | Browser-only |
| Go to anything | `cmd/gotoanything`: Ordner aus Tabs/Verläufen + Aktionen | Befehlspalette `features/actions/command-palette.ts` | ✅ | command-palette.spec › „lists known folders (tabs, histories, favourites, recent) and opens one in the active panel (018 J9)“ | 018: Ordner ergänzt () |
| Call Action | `cmd/callaction`: „Enter command“ | Palette im Aktionsmodus | ✅ | command-palette.spec › „marks actions of later prompts and moves with the arrow keys“ | – |
| Change Dir | `cmd/changedir`: GE-Baum, Deep-Regler (≤5), Filter | `features/search/folder-finder-dialog.ts` (Tiefe 1–10/∞, unscharf) | ✅ | `features/search/folder-finder-logic.spec.ts` › „review 009 #8: the incremental filter equals the full one while the list grows“ | flache Liste statt Baum |
| Auswahl | `cmd/selection`: Textfeld (Terme, `-x`, `a\|b`) | `features/actions/mark-pattern-dialog.ts` (Glob/Regex, Vorlagen, Live-Zahl) | ✅ | `features/actions/pattern.spec.ts` › „matches terms without wildcard as substring, \| as or, - excludes“ | alte Syntax `-x`/`a\|b` gilt weiter |
| Kürzel | `shortcut/shortcut-dialog` (OS-Wahl, Tabelle) + `edit-shortcut-dialog` (Aufnahme inkl. Akkord) | `features/actions/shortcut-dialog.ts` | ✅ | `features/actions/dialogs.spec.ts` › „shortcuts: records a new shortcut into the override, removes and resets“ | keine OS-Wahl (nur eigenes OS) |
| Konfig-Editoren | `config/{button,filetype,tool,theme,prompts}` (Monaco JSON/YAML, Name-/OS-Wahl) | nur Tool-Dialog + Theme-Dialog | 🟡 | `features/osintegration/os.spec.ts` › „opens the tools palette and the configuration dialog“ | Button/Dateityp/Prompt fehlen (→ G) |
| Theme-Editor | `/themes` eigenes Fenster: Variablentabelle, 17 Filter, Farbdialog, Variable hinzufügen | `features/themes/theme-dialog.ts` (Gruppen, Live, Kontrast, Import/Export) | ✅ | `features/themes/theme-dialog.spec.ts` › „lists the schemes (own first) and switches live by picking one“ | keine freien Variablen (nur Katalog-Tokens, Sicherheit) |
| Setup | Route `/setup`: 6 Checkboxen | `features/settings/settings-dialog.ts` | ✅ | `features/settings/settings-dialog.spec.ts` › „searches across the sections“ | 4 Fenster-Flags ✖ (keine Extra-Fenster) |
| Server-Shell | Route `/shell` | – | ✖ | – | siehe H |
| Taskliste | Bottom-Sheet (s. F) | `features/jobs/job-list-dialog.ts` | ✅ | `features/jobs/dialogs.spec.ts` › „job list: progress, pause/cancel, errors after the end, clear finished“ | – |
| Konfliktdialog | **fehlte** (überschrieb still) | `features/jobs/conflict-dialog.ts` | ✅ | `features/jobs/dialogs.spec.ts` › „conflict: alertdialog with both files, Skip is the default“ | neu |
| About | Route `/about` | `features/about/about-dialog.ts` | ✅ | `features/about/about-dialog.spec.ts` › „shows the version and copies the details“ | – |
| Ansicht/Editor | `edit.html` Monaco: Theme, Zeilennummern, Minimap, Umbruch, Suchen/Ersetzen, Speichern | `features/preview/viewer-dialog.ts`: Text (Zeilennr., Suche, Umbruch, Kodierung), Hex, Bild | 🟡 | `features/preview/preview.spec.ts` › „searches the text and wraps around“, „reloads with another encoding or mode and drops stale answers“ | fehlt: Bearbeiten/Speichern, Ersetzen, Minimap |

---

## D. Dateiliste

| Funktion | Referenz alt (mr §3) | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Spalten | Name (Icon, `[dir]`, ohne Endung), Ext, Size, Date (`yyyy-mm-dd` + `HH:MM`) | Name, Ext, Size, Modified (`file-columns.ts`) | ✅ | `features/browser/file-list/file-columns.spec.ts` › „defines name, ext, size and modified columns, all sortable, name ascending“ | `[Ordner]`/ohne Endung als Einstellung (`view.folderBrackets`, `view.hideExtension`) |
| Sortierung | `..` zuerst, Ordner vor Dateien, `localeCompare`; Name-Comparator ignoriert Richtung | natürlich, Ordner oben in beiden Richtungen | ✅ | file-columns.spec › „keeps folders (and links to folders) first in both directions – name“, „sorts naturally and case-insensitively“; `features/browser/navigation.spec.ts` › „keeps ".." on top in both sort directions“ | Kopf-Doppelklick (GE) |
| Sortierung gespeichert | bei jedem Start auf Name ↑ zurückgesetzt (mr-Bug 10) | Table-Zustand je Tab in der Sitzung | ✅ | `features/browser/file-list/file-list-controller.spec.ts` › „applies a tab table state around the cursor: columns + sort first, scroll last“; Rust `session.rs` › `round_trip_keeps_everything` | |
| Markieren Maus | Klick = nur diese Zeile; Shift+Klick Bereich; Strg/⌘+Klick umschalten; Strg/⌘+Alt+Klick abwählen; Doppelklick öffnen | Strg/⌘+Klick, Shift+Klick, Doppelklick (Einstellung `behavior.doubleClick`) | 🟡 | file-list-controller.spec › „Ctrl/⌘+click toggles, Shift+click marks a range from the previous cursor“, „opens on double click, ignores header clicks“ | Strg/⌘+Alt+Klick (abwählen) fehlt – durch Umschalten abgedeckt |
| Markieren Tastatur | Space/Shift+Space, Shift+↑/↓ Bereich, Strg/⌘+↑/↓ umschalten | Space/Insert, Shift+↑/↓/Pos1/Ende | ✅ | file-list-controller.spec › „marks and moves (Shift+↓/↑)“, „Shift+Space toggles and moves up, Mod+Shift+Space toggles in place (018 J10, mr)“ | 018: Shift+Space ergänzt; Strg+↑/↓ (umschalten) bewusst nicht – Strg/⌘+↑/↓ sind Navigation |
| Markierung als Set | `row.meta.selected`, Bug 6 | `Set<path>` im Store, übersteht Sortieren | ✅ | `features/browser/file-browser.store.spec.ts` › „toggles, sets and clears marks“; file-list-controller.spec › „keeps the cursor on the same entry after the table re-sorted“ | |
| Darstellung markiert/Cursor | rote Schrift + Häkchen-Icon; Cursor nur im aktiven Panel | rot + Häkchen + Screenreader-Hinweis | ✅ | `features/browser/file-list/file-renderers.spec.ts` › „shows a check mark and a screen-reader hint for marked rows“; `file-table-model.spec.ts` › „adds cursor, marked, hidden and symlink classes per row“ | |
| Quick-Search | Präfix, Reset nach 2 s / Esc | Typ-Ahead (`file-list-controller.ts` `typeAhead`) | ✅ | `features/browser/navigation.spec.ts` › „jumps to the first name with the typed prefix, accent- and case-insensitive“ | |
| Zeilenhöhe | fest 34 px | `view.density` condensed/normal/spacious, Default 30 (`file-table-model.ts:17`) | ✅ | `core/settings/settings.store.spec.ts` › „density "normal" is the height the file list is built with“; `browser/file-list/table-bridge.spec.ts` › „a new row height re-sizes the content (else the last rows are clipped)“ | Default 30 statt 34 |
| Renderer Name | Material-SVG, Icon-Tabelle im Renderer, Tooltip Pfad, Suchtreffer RTL | Font Awesome 4.5 über `FileIconService`, Text ohne innerHTML | ✅ | `features/browser/file-list/file-renderers.spec.ts` › „renders the name as text – no HTML injection“, „chooses icons per kind and extension“; `core/file-icon/file-icon.service.spec.ts` › „maps archives to archive icon“ | `.rarp`-Tippfehler entfällt |
| Renderer Size/Date | `formatFileSize` 2 Dezimalen, ` DIR`; Tooltip Bytes | `<DIR>`, binär/dezimal/Bytes | ✅ | file-renderers.spec › „shows <DIR> for folders and a formatted size for files“; `shared/format.spec.ts` › „uses binary units“ | |
| `..`-Zeile | vorangestellt, nicht markierbar | gleich | ✅ | navigation.spec › „never marks the ".." row“, „".." opens the parent“ | |
| Ordner zuerst | ja | ja | ✅ | file-columns.spec › „sorts sizes numerically, folders first, unknown sizes last in both directions“ | |
| Auswahl/Cursor je Ordner merken | localStorage `selection0/1`, `focus0/1` je Pfad, **über Neustart** | `TabMemory.folders` (50 Ordner je Tab), **nur im Speicher** | 🟡 | navigation.spec › „restores cursor and marks when coming back to a folder“, „remembers per tab memory: switching memory does not mix folders“ | nicht über Neustart (Design 003 E3) |
| Zip-Browsing | `file.zip:` (node-stream-zip) | Archive als virtueller Ordner (ZIP/TAR/TAR.GZ) | ✅ | `features/archive/archive.spec.ts` › „Enter on an archive opens it as a folder; files inside are not opened“; Rust `archive/tests.rs` › `virtual_paths_resolve_through_list_directory` | kein 7z/RAR; Dateien im Archiv nicht öffnbar |
| Filter/Hidden | Teilstring, je Tab; Doppelklick leert | Wildcards/`\|`/`-`, je Tab, Doppelklick leert (`tab-bar.html:101`) | ✅ | navigation.spec › „filters hidden files and by pattern; ".." always passes“, „filters 100 000 entries quickly“ | |
| Ordnergröße mit Space | walkdir-Socket, Größe in der Zelle | Job, abbrechbar, ohne Symlinks | ✅ | Rust `dirsize.rs` › `does_not_follow_symlinks_and_survives_cycles`; navigation.spec › „calculates a folder size as a job, …“ | |
| Statuszeile | `<selSize> / <allSize> in a/b Files, c/d Folders` | `features/workspace/status.ts` | ✅ | `features/workspace/status.spec.ts` › „counts marked entries separately“, „ignores ".." and adds calculated folder sizes“; file-panel.spec › „shows the status line in the target format“ | |
| Inkrementelle Updates | Dir-Events `add/unlink/…` | Watcher-Deltas je Pfad | ✅ | `features/browser/watch-changes.spec.ts` › „adds, replaces and removes entries by path; marks of removed ones go“ | |
| Große Ordner | `listpreview` ab 10 000 | Rust-Listing + GE virtuell | ✅ | Rust `listing.rs` › `perf_list_big_directory`; navigation.spec › „filters 100 000 entries quickly“ | |
| Mkdir-Serienvorschlag | `^[A-Za-z]{1,10}\d{2,}$`, ≥ 2 Geschwister | gleich | ✅ | ops-logic.spec › „continues a series of at least two siblings“, „prefers the series of the basis entry, else the larger one“ | |

---

## E. Panels, Tabs, Persistenz

| Funktion | Referenz alt (mr §1, §4) | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Fenster-Grid (6 Zeilen) | Breadcrumb, Tabs, Tabelle, Summary, Shell, Buttons | `workspace.html` (Shell-Zeile = Zeile 5, Prompt 021) | ✅ | `features/workspace/file-panel.spec.ts` › „marks its parts as the active panel“ |  |
| Klick aktiviert Panel | jede Zelle | Pointer down | ✅ | file-panel.spec › „activates its side on pointer down and registers itself for actions“ | |
| Splitter | gemeinsam, Doppelklick 50/50, **nicht gespeichert**, `50vW` ohne `calc()` | gemeinsam, Tastatur/Maus/Doppelklick, gespeichert | ✅ | `features/workspace/splitter.spec.ts` › „maps the pointer position to a bounded ratio“, „moves with the arrow keys within the limits“; workspace.store.spec › „bounds the splitter“ | behebt mr-Bug 10/11 |
| Breadcrumb + Fav-Stern | Segmente klickbar, Fav-Toggle | gleich | ✅ | file-panel.spec › „navigates via a breadcrumb segment, cursor on the folder it came from“, „toggles the favourite star for the current folder“ | |
| Favs/Latest/Drives-Menü | root, Volumes, Drives, Favs, Latest (10) | Menü ▾: Home, Drives, Favoriten, zuletzt (20) | ✅ | file-panel.spec › „keeps hidden/filter per tab and opens folders from the folder menu“; `features/osintegration/os.spec.ts` › „drives: loading, then the list; a late older answer is dropped“; Rust `platform/volumes.rs` › `mountinfo_keeps_user_volumes_only` | |
| Tab-Kontextmenü | Reload, Close, Move/Clone to other panel, Move left/right | gleich (`tab-bar.ts:95-100`) | ✅ | `features/workspace/tab-bar.spec.ts` › „opens the context menu and runs its entries“, „opens the context menu with Shift+F10 and closes it with Escape“ | per Rechtsklick (nicht Long-Press) |
| Tab-Verlaufsmenü | Long-Press: `tab.history` | Tab-Kontextmenü „History ▸“ (letzte 15 Ordner des Tabs) | ✅ | `features/workspace/tab-bar.spec.ts` › „the context menu lists the history of the tab; an entry opens it there (018 J12)“ | 018: Untermenü im Kontextmenü statt Long-Press |
| Tab schließen per Maus | Shift+Klick | Mittelklick | ✅ | tab-bar.spec › „closes a tab on middle click“, „Shift+click closes a tab (old version, 018 J13)“ | 018: Shift+Klick ergänzt |
| Tab Doppelklick | Reload | Reload | ✅ | tab-bar.spec › „reloads on double click“ | |
| +/− Buttons | klonen / entfernen | gleich | ✅ | tab-bar.spec › „clones with + and closes with −, the last tab stays“ | |
| Tab-Reihenfolge | Move left/right | gleich + Tastatur | ✅ | workspace.store.spec › „reorders tabs and keeps the selection on the same tab“ | Tab-Drag & Drop (legacy TODO) fehlt |
| Suchtab | `tabfind…`, Doppelklick öffnet Suche | Ergebnis-Tab, Doppelklick ändert Suche, nicht gespeichert | ✅ | `features/search/search.store.spec.ts` › „result tabs are not saved: they become a tab of their first folder“ | |
| Verlauf je Tab | max. 15, neueste zuerst, unique; Forward mit Wrap | max. 15 + Stapel 50 | ✅ | workspace.store.spec › „records navigation in the tab history (newest first, unique, max. 15)“; navigation.spec › „bounds stacks without direct duplicates and keeps the last folders“ | |
| Filter/Hidden je Tab | `TabData.filterActive/hiddenFilesVisible/filterText` | je Tab, gespeichert | ✅ | file-panel.spec › „keeps hidden/filter per tab and opens folders from the folder menu“ | |
| Persistenz | localStorage (`tabs0/1`, `activePanelIndex`, `fav`, `latest`, …) | `session.json` (Rust, Schema v1, atomar) | ✅ | Rust `session.rs` › `round_trip_keeps_everything`, `garbage_gives_defaults_with_warning_and_keeps_the_file`; workspace.store.spec › „round-trips through the session format“ | |
| Gelöschter Ordner beim Start | – | nächster existierender Elternordner + Hinweis | ✅ | Rust `session.rs` › `nearest_existing_dir_climbs_to_an_existing_parent`; workspace.store.spec › „shows warnings and replaced folders of the loaded session“ | neu |
| Fenstergeometrie | Electron fest 1280×800 | gespeichert, Monitorprüfung | ✅ | Rust `window_state.rs` › `position_off_all_monitors_is_not_reachable` | |
| Kontextmenü Dateien | fehlte | Datei/Ordner/Markierung/frei/Ergebnis-Tab | ✅ | `features/menus/menu-model.spec.ts` › „builds the context per situation (design 014 E2/E3)“; `features/menus/menus.spec.ts` › „right click: the cursor moves to the row, marks stay, the menu fits the context“ | neu |
| Vollbild-Button | oben rechts, Browser-Fullscreen-API | nur natives macOS-Menü (`menu-model.ts:231`) | 🟡 | – (kein Test) | Win/Linux ohne Vollbild (→ J14) |
| Letzte Dialogeingaben | localStorage `find-dlg-pattern`, `clean-dlg-pattern`, `group-files-dlg-pattern`, `groupFilesData`, `multiRenameData`, `multiMkdirData` | Suche: `search.recent` (Einstellungen); Multi-Rename: Vorlagen + „zuletzt“ (`rename-presets.json`) | 🟡 | search.store.spec › „remembered forms over the size limit: the oldest go, the new one stays (review 015 #7)“; `features/multirename/multirename.spec.ts` › „presets: save, apply, delete“; Rust `rename_presets.rs` › `round_trip` | Clean/Group/Multi-MkDir merken nichts über einen Neustart |

---

## F. Operationen & Jobs

| Funktion | Referenz alt (mr §6, §7) | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Kopieren | `cp -r`/`xcopy`/`rsync -avzh`, überschreibt still | Rust-Job, Temp + Umbenennen, Konflikte, Fortschritt | ✅ | Rust `jobs/tests_engine.rs` › `copies_folders_recursively_with_times_and_progress`, `cancel_mid_file_removes_the_partial_copy`, `symlinks_are_copied_as_links` | |
| Verschieben | `mv`/`robocopy`/`rsync --remove-source-files` | gleicher Datenträger: umbenennen; sonst kopieren + löschen je Datei | ✅ | Rust `jobs/tests_ops.rs` › `move_on_the_same_volume_renames_whole_entries`, `move_across_volumes_cancelled_midway_loses_nothing` | |
| Löschen | `fse.remove` endgültig | Papierkorb (Default), endgültig mit Shift | ✅ | Rust `jobs/tests_ops.rs` › `delete_to_the_trash`, `delete_permanently_removes_the_tree_but_never_follows_links` | |
| Umbenennen | fs-extra | `rename_noreplace` | ✅ | Rust `platform.rs` › `rename_noreplace_never_replaces`; `fileops.rs` › `rename_case_only_does_not_overwrite_a_distinct_entry` | |
| Ordner/Datei anlegen | Quick-Queue, Fokus auf neuen Eintrag | Command, Cursor auf neuen Eintrag | ✅ | `features/ops/ops.spec.ts` › „F7: suggests the next name of a series, creates and puts the cursor on it“ | |
| Packen/Entpacken | node-7z + 7zip-bin (7z, Passwort) | Rust `zip`/`tar`, Jobs mit Konflikt | 🟡 | Rust `jobs/tests_archive.rs` › `zip_slip_archive_is_refused_and_the_rest_extracted`, `packing_onto_an_existing_archive_asks` | kein 7z/RAR/Passwort |
| Download | `POST /api/download` (Blob) | – | ✖ | – | Browser-only |
| Gruppieren | Gruppenordner + Kopieren/Verschieben | Job `group` | ✅ | Rust `jobs/tests_tools.rs` › `group_conflicts_go_through_the_engine`; `features/groupfiles/group-engine.spec.ts` (Fallkatalog `group-engine.cases.json`) | `ebook_mode`/KI fehlen |
| Multi-Rename | Queue `rename` je Datei | Job `rename` mit Plan, Ketten/Zyklen, Undo | ✅ | Rust `jobs/rename.rs` › `plan_existing_target_chain_and_swap`, `cycle_failure_is_rolled_back_without_temporary_names` | |
| Multi-MkDir | – | `create_folders` | ✅ | Rust `fileops.rs` › `create_folders_never_touches_existing_entries` | |
| Ordner aufräumen | `POST /api/clean` | Job `clean`, prüft jeden Eintrag neu | ✅ | Rust `clean.rs` › `nested_empty_children_first_never_the_root_or_above`; `jobs/tests_tools.rs` › `clean_rechecks_every_entry`, `clean_never_deletes_through_a_link` | |
| Suche | Socket `find`, sync readdir, micromatch | Job `search`, gebündelt, abbrechbar | ✅ | Rust `search.rs` › `symlink_cycles_end_and_links_are_hits`, `search_200k_first_hit_and_cancel`; `jobs/tests_tools.rs` › `search_streams_batches_and_reports_stats` | |
| Duplikate | nicht implementiert | Job `duplicates` (Größe → SHA-256 Kopf/Ende → voll) | ✅ | Rust `duplicates.rs` › `hard_links_and_symlinks_are_not_copies`, `many_files_and_cancel`; `jobs/tests_archive.rs` › `duplicates_job_streams_groups` | neu |
| Öffnen mit Standard-App | `open`/`start`/`xdg-open` (legacy: Linux nur PDF) | `opener.rs` (Rückfrage bei Programmen) | ✅ | Rust `opener.rs` › `plain_documents_are_fine`, `executables_need_confirmation` | |
| Queue-Modell | mehrere Queues, streng seriell, Fehler stoppt Queue | seriell + Hintergrund parallel, Fehler je Eintrag, Job läuft weiter | ✅ | Rust `jobs/tests_engine.rs` › `serial_queue_runs_one_after_another_background_in_parallel`, `errors_per_item_are_collected_and_the_job_goes_on` | |
| Pause/Weiter/Abbruch | Pause, Resume, Stop All (nur pending) | je Job, auch mitten in der Datei | ✅ | Rust `jobs/tests_engine.rs` › `pause_stops_progress_and_resume_finishes`; `jobs/control.rs` › `cancel_wakes_a_paused_job_quickly` | |
| Konflikte | keine | Überschreiben/Überspringen/Umbenennen/alle, „wenn neuer“ | ✅ | Rust `jobs/tests_engine.rs` › `apply_to_all_overwrite_if_newer_asks_once`; `features/jobs/dialogs.spec.ts` › „conflict: Alt+letter answers, "apply to all" is passed on“ | |
| Task-UI | Bottom-Sheet: Status, Restzeit, Tabelle Grp/Cmd/Status/Dauer/Datei, Clean List, Stop All, Pause, Resume, Löschen je Zeile | `features/jobs/job-list-dialog.ts` | ✅ | `features/jobs/dialogs.spec.ts` › „job list: progress, pause/cancel, errors after the end, clear finished“; `features/jobs/job-format.spec.ts` › „shows size, rate and time left“ | |
| Rückfrage beim Beenden | – | ja | ✅ | `features/workspace/workspace.spec.ts` › „opens the conflict question automatically and asks before quitting“ | neu |
| Drag & Drop | – (legacy: Drop-Dialog „not implemented“) | Panels/Ordnerzeilen/vom System → Dialog | 🟡 | `features/dnd/dnd.spec.ts` › „drop on the other panel opens the copy dialog with that folder – nothing runs yet“ | Ziehen ins System fehlt |

---

## G. Konfigurationsdateien & Editoren

| Funktion | Referenz alt (Form, Ort) | Umsetzung neu (Form, Ort) | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Setup | `setup/data.json`: 6 Flags (`openAboutInNewWindow`, `openSetupInNewWindow`, `openServerShellInNewWindow`, `openManageShortcutsInNewWindow`, `loadFolderSizeAfterSelection`, `condensedPresentationStyle`) | `settings.json` nach `settings-schema.json` (15 Schlüssel); `loadFolderSizeAfterSelection` → `behavior.spaceCalcSize`, `condensedPresentationStyle` → `view.density` | ✅ | Rust `settings.rs` › `schema_parses_and_defaults_are_valid`, `invalid_values_fall_back_with_a_warning_per_key`; `core/settings/settings.store.spec.ts` › „has a valid default for every key and the TS keys match the JSON“ | 4 „…InNewWindow“-Flags ✖ (keine Extra-Fenster) |
| Tools | `tool/{os}.json` `CmdIf[] {id,label,shortcut,cmd,para,fileLimit,local}` mit `$file/$dir/$clidir` | `tools.json` `{id,label,program,args[],perFile,fileLimit,shortcut}` mit `{file}{files}{name}{dir}{targetDir}`; mr-Format wird beim Laden umgestellt | ✅ | Rust `tools.rs` › `mr_format_is_imported`, `placeholders_stay_one_argument`, `file_merges_with_the_defaults` | Merge statt Ersatz |
| Buttons | `button/data.json` `{default,shift,cmd,alt}` + custom | eingebaute `buttons.json` (+`ctrl`), keine Nutzerdatei | 🟡 | `features/workspace/button-bar/button-config.spec.ts` › „has five known actions per modifier set“ | Editor/Override fehlt (018) |
| Dateitypen | `filetype/data.json` `[{label, extensions[]}]` (11 Kategorien, für Auswahl nach Typ) | fest `FILE_CATEGORIES` (`core/file-icon/file-icon.service.ts:9`), für Icons; Muster-Vorlagen im Markier-Dialog | 🟡 | `core/file-icon/file-icon.service.spec.ts` › „provides the 11 configured categories and extensions“ | nicht konfigurierbar |
| Suchmuster | `search/data.json` (+ „movies & images“, „ebooks & covers“), defaults/custom vertauscht | `features/search/search-presets.json` (mr-Format) + eigene Vorlagen (nur Sitzung) | 🟡 | `features/search/find-form.spec.ts` › „templates become globs (mr format)“ | eigene Vorlagen nicht dauerhaft |
| KI-Prompts | `prompt/*.yaml` `{description, prompt}` (`convert_filenames`, `group_filenames`) | – | ⬜ | – | KI fehlt (H) |
| Kürzel | `shortcut/{os}.json` `{"key": "ACTION"}`, custom ersetzt Defaults | Keymaps je OS `{ACTION: [keys]}` + `keymap.json`-Override je Aktion gemischt | ✅ | `core/actions/keymap.spec.ts` › „gives an overridden shortcut to the overriding action“, „reports unknown ids, invalid and reserved shortcuts, and keeps the rest“; Rust `keymap.rs` › `broken_file_gives_a_warning_and_is_kept` | Format umgedreht; **kein Import alter `shortcut/custom/*.json`** (alte Ids) (→ K) |
| Themes | `color/{name}.json` `{name, colors:{--fnf-*}}` | `themes.json` (eigene) + eingebaut `core/theme/themes/*.json`, `legacy/*.json`; Import/Export `.theme.json`, altes Format lesbar/exportierbar | ✅ | `core/theme/legacy-theme.spec.ts` › „map every one of the 76 variables or leave it out with a reason“, „export in the old format and read it back“; Rust `themes.rs` › `import_reads_small_json_objects_only` | |
| Multi-Rename-Vorlagen | localStorage `multiRenameData` | `rename-presets.json` | ✅ | Rust `rename_presets.rs` › `round_trip`, `missing_and_broken_files` | |
| Export/Import aller Einstellungen | – | Bündel aller Teile | ✅ | Rust `settings.rs` › `export_writes_all_parts_and_never_overwrites`, `import_writes_the_chosen_parts_only`; settings-dialog.spec › „exports into the folder and imports the chosen parts (tools off by default)“ | neu |
| Ablageort | `assets/<x>/custom/` im App-Ordner | `app_config_dir()`, atomar, kaputt → `.bad` | ✅ | Rust `fs_atomic.rs` › `writes_atomically_and_creates_the_directory`, `keeps_a_broken_file` | |

---

## H. Shell-Leiste, Server-Shell, KI, Electron

| Funktion | Referenz alt | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Shell-Leiste (Zeile 5) | Eingabe `{{path}}>`, Autocomplete (Verlauf + `GET shell-autocomplete`), `POST /api/shell` (`exec`), Ausgabe in Monaco-Bottom-Sheet, Verlauf 20, `shellVisible` | `ShellBar` über der Button-Leiste: Befehl als Hilfsjob `shell` (Pipes, stdin zu, eigene Sitzung), Ausgabe gestreamt mit Flutschutz, Esc/Strg+C bricht die ganze Prozessgruppe ab, `cd`/`cd -`/`clear` in Rust (Panel navigiert), Verlauf 100 in `shell-history.json`, Vorschläge aus dem Verlauf, Login-`PATH`, Sichtbarkeit/Höhe in der Sitzung, gesperrt im Archiv | ✅ | Rust `jobs/tests_shell.rs` › `cancel_ends_the_whole_group`, `a_folder_name_is_never_executed`, `endless_output_is_limited`, `stdin_is_closed_and_there_is_no_terminal`; `shell/tests.rs` › `quoting_round_trip_in_real_shells`, `builtins_posix`; `features/shell/shell.spec.ts` › „Enter runs the typed line in the active folder; output streams in, the exit code ends it“ | Design 021; Dateinamen-Vervollständigung und PTY offen |
| Server-Shell | Route `/shell`, `spawn`/`cancelspawn` | – | ✖ | – | mr §11 Drop |
| Terminal öffnen | Tool `CMD_SHELL` | `OPEN_TERMINAL_HERE` | ✅ | Rust `platform/desktop.rs` › `the_next_terminal_is_tried_when_one_fails_to_start` | |
| KI Namen umwandeln | `POST /api/ai/convertnames` (OpenAI/Ollama), Button im Multi-Rename | – | ⬜ | – | optional, Schlüssel im Schlüsselbund (mr §11) |
| KI gruppieren | `POST /api/ai/groupfiles`, Strategie `AI` | – | ⬜ | – | dito |
| `hasopenaiapikey` | Freigabe des KI-Buttons | – | ⬜ | – | dito |
| Electron-Fenster | 1280×800, CSP | Tauri-Fenster, Geometrie gespeichert, CSP strikt | ✅ | Rust `window_state.rs` › `position_on_a_monitor_is_reachable` | |
| DevTools global (`Cmd+Alt+I`, `F12`) | systemweit | – | ✖ | – | kollidierte mit App-Tasten (mr §10) |
| HTTP-Helfer 127.0.0.1:4765, `window.bridge` | ungenutzt | – | ✖ | – | Tauri-IPC |
| Version | `/app/version` | `get_app_info` | ✅ | Rust `about.rs` › `crate_version_matches_package_json`; `features/about/about-dialog.spec.ts` › „tauri.conf.json reads package.json“ | |
| `openExternal(url)` | Bridge | – | 🟡 | – | keine Links nach außen nötig; kein Test |
| Docker-Root, Multi-Port, Socket-Broadcast, CSS-Socket-Sync | ja | – | ✖ | – | Desktop-only (mr §10) |
| Natives Menü | – | macOS nativ, Win/Linux HTML | ✅ | Rust `app_menu.rs` › `accelerators_map_mod_per_os`; `features/menus/menu-model.spec.ts` › „shows the app menu only on macOS and Quit/About only elsewhere“ | neu |
| Pakete | Electron (Start der API extern) | dmg/msi/NSIS/deb/rpm/AppImage | 🟡 | `scripts/*.test.mjs` | nicht auf macOS/Windows geprüft, keine Signierung |

---

## I. Bugs der alten Versionen

### I.1 mr §11 „Notable bugs“

| Funktion | Referenz alt | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| 1 Modifier-Reihenfolge, `ctrl+delete`, `ctrl+alt+plus`, Tool-Kürzel mit Leerzeichen | `shortcut-util.ts` | kanonische Form (`core/actions/shortcut.ts`), Tool-Kürzel kanonisiert | ✅ behoben | `core/actions/shortcut.spec.ts` › „canonicalises modifier order, case and aliases“, „builds the same string from an event as from the keymap“, „reads digits and the numpad from code (layout-independent)“; Rust `tools.rs` › `words_and_mr_shortcuts` | |
| 2 `cmd` = Meta auf Win/Linux | | `Mod` = Strg auf Win/Linux | ✅ behoben | `core/actions/shortcut.spec.ts` › „keeps Ctrl separate from ⌘ on macOS only“; `core/actions/shortcut-badge.spec.ts` › „Windows/Linux: Mod is ^“ | |
| 3a kein Ctrl-Button-Satz | | `ctrl`-Satz | ✅ behoben | `features/workspace/button-bar/button-config.spec.ts` › „picks the set for the held modifiers (⌘ > Alt > Shift; Ctrl on Windows/Linux)“ | |
| 3b `alt` nicht als ⌥ | | Badge zeigt weiter „alt“ | ✖ | `core/actions/shortcut-badge.spec.ts` › „macOS: Mod is ⌘, Ctrl is ^, alt stays a word, Shift is ⇧, keys in lower case“ | bewusst wie mr (Badge 1:1) |
| 3c kein F7 für MkDir | | `F7` | ✅ behoben | `core/actions/keymap.spec.ts` › „binds the Total Commander function keys and F7 = MkDir“ | |
| 4 `document.title` durch ngDoCheck überschrieben | | kein Schreibzugriff auf `document.title` im Code (grep) | ✅ entfällt | – (Code-Beleg: kein `document.title` in `src/`) | |
| 5 tote Aktionen, Duplikate fehlen, `NAVIGATE_LEVEL_DOWN` = „Parent Dir“ | | alle Katalog-Ids außer 1 mit Handler; Duplikate implementiert; `NAVIGATE_PARENT` | ✅ behoben | `core/actions/keymap.spec.ts` › „${platform}: known ids, valid shortcuts, no double bindings, nothing reserved“; `features/menus/menu-model.spec.ts` › „has every action of the catalog in the menu bar (mouse reaches everything)“; `features/archive/archive.spec.ts` › „duplicates: a result tab with groups, …“ | `OPEN_BUTTON_CONFIG_DLG` noch ohne Handler (gedimmt mit Hinweis); `TOGGLE_SHELL` seit 021 |
| 6 `setFileItemSelected` setzt Flag nur ohne `meta` | | Markierung als `Set<path>` | ✅ entfällt | `features/browser/file-browser.store.spec.ts` › „toggles, sets and clears marks“ | |
| 7 Find `directoriesOnly` leer; Find blockiert Event-Loop | | Arten Dateien/Ordner/Links; Rust-Job | ✅ behoben | Rust `search.rs` › `kinds_size_date_depth`; `jobs/tests_tools.rs` › `search_cancel_reacts_fast` | |
| 8 kein Konflikt, Löschen endgültig, `rsync -z` | | Konflikte, Papierkorb, natives Kopieren | ✅ behoben | Rust `jobs/tests_engine.rs` › `conflict_overwrite_skip_rename_and_apply_to_all`, `a_target_that_appears_while_copying_is_not_replaced`; `jobs/tests_ops.rs` › `delete_to_the_trash` | |
| 9a Suchkonfig-Pfade vertauscht | | keine defaults/custom-Datei für Suchmuster | ✅ entfällt | – (Struktur: nur eingebautes `search-presets.json`) | |
| 9b Multi-Rename Schritt „50“ = 30 | | `STEPS = [1, 2, 5, 10, 20, 50, 100, 1000]` | ✅ behoben | `features/multirename/rename-engine.spec.ts` › „valid: ${c.title}“ mit Fall „bug: step 50 is 50 (was 30)“ (`rename-engine.cases.json:190`) | |
| 9c `.rarp`-Tippfehler | | `.rar` in `FILE_CATEGORIES` | ✅ behoben | `core/file-icon/file-icon.service.spec.ts` › „maps archives to archive icon“ | |
| 10 Sortierung beim Start zurückgesetzt; Splitter nicht gespeichert | | Table-Zustand + Splitter in der Sitzung | ✅ behoben | `features/browser/file-list/file-list-controller.spec.ts` › „applies a tab table state around the cursor: columns + sort first, scroll last“; `features/workspace/workspace.store.spec.ts` › „round-trips through the session format“ | |
| 11 50/50 ohne `calc()`; Pfeile auf keyup ohne Repeat | | Verhältnis 0..1; Table-Navigation auf keydown; Repeat-Liste | ✅ behoben | `features/workspace/splitter.spec.ts` › „jumps to the limits and back to the middle“; `core/actions/keyboard-dispatcher.spec.ts` › „ignores auto-repeat except for repeatable actions“ | |
| 12a Tab-Kontext- und Verlaufsmenü beide an Long-Press | | Kontextmenü per Rechtsklick/`Shift+F10`; kein Verlaufsmenü | ✅ | `features/workspace/tab-bar.spec.ts` › „opens the context menu with Shift+F10 and closes it with Escape“ | Bug entfällt; Verlaufsmenü seit 018 im Kontextmenü (`tab-bar.spec.ts` › „the context menu lists the history of the tab …“) |
| 12b Shell-Leiste ohne ↑/↓-Verlauf, Esc | | ↑/↓ mit Entwurf, Esc-Kaskade (Vorschläge → Abbruch → Leeren → Liste) | ✅ behoben | `features/shell/shell.spec.ts` › „↑/↓ walk the history (draft kept); the suggestions take Enter“, „Esc: closes suggestions, stops a running command, clears the text, then returns to the list“ | |

### I.2 legacy §9 (AngularJS/Node 2016)

| Funktion | Referenz alt | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| Port mit bitweisem OR | Server | keine Ports | ✅ entfällt | – | Tauri-IPC |
| Datumsspalte zeigt atime | | `modified` | ✅ behoben | `features/browser/file-list/file-columns.spec.ts` › „sorts by modification time with missing times last“; Rust `listing.rs` › `stat_entry_matches_the_listing` | |
| Statuszeile um Faktor 1000 falsch | | binäre/dezimale Einheiten | ✅ behoben | `features/workspace/status.spec.ts` › „counts files and folders and sums file sizes“; `shared/format.spec.ts` › „never shows 1024 of a unit – rounding moves to the next unit“ | |
| `size =+` statt `+=` (Vorab-Größe) | `deepselection.service.js` | Zählung in Rust | ✅ behoben | Rust `jobs/tests_ops.rs` › `count_files_folders_and_bytes` | |
| Löschen ignoriert Cursor-Zeile | | markiert sonst Cursor, nie `..` | ✅ behoben | `features/ops/ops-logic.spec.ts` › „takes the marked entries, otherwise the cursor entry, never ".."“ | |
| Umbenennen braucht Markierung | | Cursor genügt | ✅ behoben | `features/ops/ops.spec.ts` › „Shift+F6: the name without extension is selected; rename moves the cursor“ | |
| Multi-Rename: kein Refresh, Namen ohne Punkt, „50“=30 | | Job + Watcher, Namensteil/Endung, Schritt 50 | ✅ behoben | `features/multirename/rename-engine.spec.ts` › „splits names and extensions (E2)“; `features/multirename/multirename.spec.ts` › „folders are not split and keep their name with the default pattern“ | |
| Linux copy/move nimmt Windows-Zweig | | plattformneutral in Rust | ✅ behoben | Rust `jobs/tests_engine.rs` › `copies_folders_recursively_with_times_and_progress` (läuft unter Linux) | |
| `dir`-Ende-Race | | Request-Sequenz | ✅ behoben | `features/browser/file-browser.store.spec.ts` › „ignores responses of superseded requests“ | |
| `delempty` steigt über den Startordner | | strukturell ausgeschlossen | ✅ behoben | Rust `clean.rs` › `nested_empty_children_first_never_the_root_or_above`; `jobs/tests_tools.rs` › `clean_deletes_children_first_and_nothing_outside_the_start_folder` | |
| `saveconfig` mit Client-`username` (Path Traversal), Socket ohne Auth | | kein Netz; feste Dateinamen in `app_config_dir()` | ✅ entfällt | Rust `settings.rs` › `read_bundle_rejects_other_files` (Import nur eigener Bündel) | |
| Shell-Kommandos per String-Verkettung | | Argument-Arrays, keine Shell | ✅ behoben | Rust `tools.rs` › `file_names_are_never_run_as_commands`, `names_with_a_leading_dash_are_no_options`; `features/osintegration/os.spec.ts` › „sends the tool id and the context – never a command“ | |
| macOS `control 0` doppelt; Windows `f3` = Copy, `f8`/`f9` = Delete | | eindeutige Keymaps | ✅ behoben | `core/actions/keymap.spec.ts` › „${platform}: known ids, valid shortcuts, no double bindings, nothing reserved“ | |
| keine Überschreib-Rückfrage, kein Abbruch | | Konflikte, Abbruch | ✅ behoben | Rust `jobs/tests_engine.rs` › `cancel_while_asking_leaves_no_trace`; `features/jobs/dialogs.spec.ts` › „conflict: rename with a typed name“ | |
| Verlauf unbegrenzt | | max. 15 / 50 | ✅ behoben | `features/workspace/workspace.store.spec.ts` › „records navigation in the tab history (newest first, unique, max. 15)“ | |
| Ordner-Button-Label leer unter Unix (Wurzel) | | Segmente beginnen mit Wurzelname `/` | ✅ | Rust `paths.rs` › `parent_and_segments` (Wurzel hat einen Namen) | |
| Event-Cache flusht höchstens alle 16 s | | Entprellung 150/400 ms, Max-Verzögerung | ✅ behoben | Rust `watch/batch.rs` › `a_steady_stream_is_delivered_after_max_delay` | |
| Unfertig: Duplikate, Drop, Kontextmenü, Copy/Move-Optionen, Linux-Kürzel/-Tools, Linux-open nur PDF | | alle vorhanden | ✅ | Rust `duplicates.rs` › `known_duplicates_are_grouped`; `features/dnd/dnd.spec.ts` › „files from the system: highlight while over, copy dialog on drop“; `features/menus/menus.spec.ts` › „runs the chosen entry as an action and closes the menu“; Rust `jobs/tests_ops.rs` › `copy_options_conflict_default_and_new_name`; `core/actions/keymap.spec.ts` › „${platform}: …“; Rust `opener.rs` › `plain_documents_are_fine` | |
| TODO.txt: Freier Platz je Laufwerk | | Laufwerke mit frei/gesamt | ✅ | `features/osintegration/os.spec.ts` › „formats a volume line, unreachable ones without sizes“ | |
| TODO.txt: Dateien teilen/zusammenfügen (`concat.js`), FAV-Pflegedialog, Tab-Drag&Drop, FXP | | – | ⬜ | – | (→ K) |

---


### I.3 Fehler aus dem E2E-Arbeitstag (018, Linux/Xvfb)

| Funktion | Referenz alt | Umsetzung neu | Status | Tests | Abweichung/Grund |
|---|---|---|---|---|---|
| „Kopieren abbrechen“ im Konfliktdialog unsichtbar (Classic light) | – | Gefahr-Buttons/-Texte mit `--color-danger-bg` | ✅ behoben | `core/theme/danger-pairs.spec.ts` › „every rule with --color-danger-text also sets --color-danger-bg …“ | alte Designs setzen `--color-danger-text` hell (Fehlerpanel) |
| Ergebnis-Tab nach Neustart ohne Titel („…“) | – | Tab merkt sich den Titel seines Ordners | ✅ behoben | `features/search/search.store.spec.ts` › „a saved result tab keeps the title of the folder it was started in …“ | |
| Linux: `Ctrl+Q` beendet nicht | – | `Ctrl+Q` = Schnellansicht (TC); Beenden über Menü Datei/Fenster schließen | ✖ | – | Belegung wie TC/Design 010 |

## J. Kleine Lücken – Stand nach 018

| # | Lücke | Stand |
|---|---|---|
| J1–J6 | Kürzel der alten Version, die wirklich feuerten (⌃⌘D = abwählen, ⌃⌥D Pfad, ⌃⌘C/M/R/A, ⌃⌥N/M/G, ⌃⌥⇧D/F, ⌃⌥A) | ✅ `keymap.spec.ts` › „keeps the shortcuts of the old version that really fired (018 J1–J6, mr defaults)“ |
| J7 | Actions-Menü per Tastatur (`OPEN_ACTIONS_MENU`, mr `OPEN_MENU`) | ✅ `button-bar.spec.ts` |
| J8 | `-term`/`a\|b` im Markier-Dialog | entfällt (funktioniert, `pattern.spec.ts`) |
| J9 | Ordner in „Go to anything“ | ✅ `command-palette.spec.ts` |
| J10 | Shift+Leertaste, Umschalten ohne Bewegen | ✅ `file-list-controller.spec.ts` |
| J11 | `TOGGLE_SHELL`/`OPEN_BUTTON_CONFIG_DLG` zeigten „kommt in 011/018“ | ✅ verweisen auf Folge-Prompts 021/022; `TOGGLE_SHELL` mit 021 umgesetzt |
| J12 | Tab-Verlaufsmenü | ✅ `tab-bar.spec.ts` |
| J13 | Shift+Klick schließt Tab | ✅ `tab-bar.spec.ts` |
| J14 | Vollbild unter Windows/Linux | ⬜ braucht die Fähigkeit `core:window:allow-set-fullscreen` bzw. einen schmalen Command – mit Folge-Prompt 022 |
| J15 | Strg/⌘+Alt+Klick wählt ab | ✖ bewusst nicht: Strg/⌘+Klick schaltet um (TC), Alt+Klick ist unter Linux oft Fenster-Ziehen |
| J16 | Kürzel für Default-Tools (mr `CMD_EDIT_FILE` ⌃⇧4) | ✖ Tools bekommen Kürzel in `tools.json` (Nutzer); F4 = Tool `edit` |

## Folge-Prompts (Vorschlag, große Lücken)

| Prompt | Inhalt (eine Zeile) |
|---|---|
| 021 Shell-Leiste | ✅ umgesetzt (Design `prompts/021-shell-leiste.design.md`): Pipes statt PTY, Hilfsjob `shell`, Sicherheitsmodell in CLAUDE.md §4. |
| 022 Konfigurations-Editoren | Buttons (`OPEN_BUTTON_CONFIG_DLG`, Override je Modifier-Satz), Dateitypen (Kategorien für Icons/Markieren/Suche), dauerhafte Suchvorlagen; Vollbild-Aktion (J14). |
| 023 Eingebauter Editor | F4 intern: Text bearbeiten, Kodierung erhalten, Suchen/Ersetzen, Rückfrage bei ungespeichert. |
| 024 Attribute ändern | Rechte/Eigentümer (Unix), R/H/S/A (Windows), Zeitstempel – als Job mit Rust-Validierung. |
| 025 Archive erweitert | 7z/RAR lesen, Passwörter, in Archive schreiben, Dateien im Archiv öffnen. |
| 026 Import alter Konfiguration | mr-`shortcut/custom/*.json` (Ids übersetzen), Buttons, Suchmuster, Dateitypen. |
| 027 Persistenz je Ordner | Cursor/Markierung je Ordner über einen Neustart, Dialogeingaben von Gruppieren/Aufräumen/Multi-MkDir. |
| 028 Drag & Drop erweitert | Ziehen aus der App ins System, Tabs zwischen den Seiten ziehen. |
| später | KI-Funktionen (Namen normalisieren, Gruppieren; Schlüssel im OS-Schlüsselbund), Dateien teilen/zusammenfügen. |
