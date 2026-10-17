# Design 002: Aktionssystem, Tastenkürzel und „Go to anything“

> **Status:** ✅ freigegeben (2026-10-17: D1–D6 wie empfohlen) – Umsetzung offen. Ursprünglich angehalten (Phase 1). Bewusst hier angehalten: 002 baut auf 004 auf, dessen
> Entscheidungen ebenfalls noch nicht bestätigt sind, und die Fragen D1–D6 ändern Datenformate, die später teuer
> umzustellen sind.
> **Datum:** 2026-10-17 · **Branch:** `feat/aktionen-tastatur` (von `feat/dual-pane-tabs`)
> **Grundlage:** legacy §2 (Ids, Keypress-Syntax, Keyup), mr §1.8/§2/§3 (Button-Sätze, Default-Keymaps,
> Matching-Fehler, Freigaberegeln), Design 001 (Tasten der GuiExpert Table), Design 004 (Interim-Handler).

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| `FileListController.onKey` / `onAction` | Enter, Backspace, Einfg, Shift+↑/↓, Strg/⌘+Enter; Table-Aktionen Leertaste, Strg/⌘+A, Strg/⌘+Shift+A | **wird ersetzt**: Logik bleibt im Controller (testbar), Auslösung kommt aus dem Dispatcher |
| `FilePanel.onKeydown` (Tab), `Workspace.onKeydown` (Strg+Tab, Strg/⌘+Alt+T/W) | Interim aus 004 | **wird ersetzt** |
| GuiExpert `ShortcutService` | verbraucht Pfeile, Bild↑/↓, Pos1/Ende, Leertaste, Strg+A, Strg+X (entfernt), stoppt dann die Propagation | **passt**, wenn unser Handler in der **Capture-Phase an `document`** läuft (vor der Table). Navigationstasten bleiben bei der Table (§3.4) |
| `buttons.json` + `ButtonBar` (004) | Sätze default/shift/cmd/ctrl/alt, alles gedimmt | **wird befüllt**: Umschaltung, Badges, Freigaben |
| `ContextMenu` (004) | APG-Menü | **wiederverwendbar** für das Actions-Menü (mit Spalten) |
| Rust | – | Override-Datei lesen/schreiben (wie `session.rs`) |

## 2. Entscheidungsfragen

### D1 – Keymaps im Frontend, Override-Datei über Rust ✅ Empfehlung

- Defaults als JSON im Frontend (`src/app/core/actions/keymaps/{macos,windows,linux}.json`, wie `buttons.json`
  gebündelt). Grund: Der Dispatcher, die Badges und die Palette sitzen im Frontend; eine Quelle, kein IPC beim Start.
- **Nutzer-Override** `<app_config_dir>/keymap.json` – lesen/schreiben über zwei schmale Rust-Commands
  (`load_keymap_override`, `save_keymap_override`, gleiche Mechanik wie `session.rs`: atomar, kaputt → `.bad` +
  Warnung, Defaults bleiben).
- **Native Menüleiste später (014).** Rust kann die Frontend-JSONs dann per `include_str!` lesen – die Quelle bleibt
  eine. Bis dahin: das Tauri-Standardmenü auf macOS belegt `⌘W` (Fenster schließen), `⌘Q`, `⌘H`, `⌘M`, `⌘,` – diese
  Kürzel werden nicht vergeben (Test).

### D2 – Notation: kanonische Strings, Taste aus `key` **mit** `code`-Rückfall ✅ Empfehlung

Format: `[Mod+][Ctrl+][Alt+][Shift+]<Taste>` (feste Reihenfolge, Groß-/Kleinschreibung egal beim Laden, kanonisch
beim Speichern). `Mod` = ⌘ auf macOS, Strg sonst; `Ctrl` = die echte Strg-Taste (auf macOS ⌃, sonst = `Mod`, beim
Laden zusammengefasst). Akkorde: `Ctrl+K F6` (Leerzeichen, 1,5 s Timeout) – nur macOS-Default `Ctrl+K F6` aus mr.

Taste aus dem Ereignis:

| Taste | Quelle | Beispiel |
|---|---|---|
| Buchstaben | `key` (Layout des Nutzers: Strg+Z ist auf QWERTZ dort, wo „Z“ draufsteht) – **außer** `key` ist kein Buchstabe a–z (macOS mit ⌥: `ø`, Tote Tasten) → aus `code` (`KeyO` → `O`) | `Mod+Shift+S`, `Alt+T` |
| Ziffern oben | `code` (`Digit7`), sonst wäre `Mod+Shift+7` auf deutscher Tastatur `/` | `Alt+1` |
| Ziffernblock | `code` (`NumpadAdd`, `NumpadSubtract`, `NumpadMultiply`, `Numpad0`) | `NumpadAdd` |
| benannte Tasten | `key` (`F1`…`F24`, `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `ArrowUp`…, `Space` für `' '`, `ContextMenu`) | `Shift+F6` |
| Satzzeichen | `key` | `Mod+,` |

Beide Seiten (Keymap-Eintrag und Ereignis) laufen durch **dieselbe** `canonical()`-Funktion (mr-Fehler: Reihenfolge
der Modifier, `del` vs. `delete`, `plus` vs. `+`). Auswertung auf `keydown` (Tastenwiederholung für Pfeile; legacy/mr
nutzten `keyup`).

### D3 – Leertaste: Total-Commander-Verhalten ✅ Empfehlung (wie 001 freigegeben)

Leertaste = Markieren + Cursor weiter. Bei Ordnern zusätzlich Größe berechnen – kommt mit 003 (Job). `Einfg`
(macOS: `Ctrl+0` wie legacy, `⌘↓`… bleibt bei der Table) gleiche Aktion.

### D4 – Aktionen abschalten erlaubt ✅ Empfehlung

`"OPEN_DELETE_DLG": []` im Override = ohne Kürzel (über Menü/Palette weiter erreichbar). Ein Eintrag ersetzt **die
Liste dieser Aktion** (nicht Arrays per Index wie legacy, nicht die ganze Datei wie mr).

### D5 – Override-Format ✅ Empfehlung

```json
{ "version": 1, "bindings": { "OPEN_COPY_DLG": ["F5", "Mod+C"], "OPEN_DELETE_DLG": [] } }
```

Gilt für das laufende OS (wer mehrere OS nutzt, hat ohnehin getrennte Config-Verzeichnisse). Unbekannte Ids,
unparsebare Kürzel und Doppelbelegungen werden **gemeldet** (Hinweis wie in 004) und übersprungen; der Rest gilt.
Doppelbelegung Override ↔ Default: der Override gewinnt, die Default-Belegung der anderen Aktion entfällt (gemeldet).

### D6 – Was bleibt bei der GuiExpert Table? ✅ Empfehlung

Navigationstasten im Fokus der Liste bleiben Table-Sache (sie kennt Zeilenhöhe/Viewport): `↑ ↓ Bild↑ Bild↓ Pos1 Ende`,
`Strg+Pos1/Ende`, macOS `⌘↑/⌘↓`. Sie sind **nicht** in der Keymap (nicht umbelegbar in 002; Test, dass keine Aktion
sie belegt). Alles andere, was die Table mappt (Leertaste, Strg/⌘+A), fängt unser Capture-Handler vorher ab, wenn es
in der Keymap steht. Die Interim-Mappings aus 001 (`home`/`end`, Entfernen von Strg+X) bleiben.

## 3. Verträge

### 3.1 Aktionen

```ts
type ActionId = 'NAVIGATE_OPEN' | 'NAVIGATE_PARENT' | 'RELOAD_DIR' | 'TOGGLE_PANEL' | 'SELECT_LEFT_PANEL' | … ;
interface ActionContext { side: Side; source: Side; target: Side; cursor: DirEntry | null;
                          marked: readonly DirEntry[]; displayed: readonly DirEntry[] }
interface ActionDef {
  id: ActionId; label: string; category: 'navigation' | 'selection' | 'panels' | 'files' | 'config' | 'tools';
  enabled?(ctx): boolean;          // Freigaberegeln mr §3 (z. B. Rename nur bei genau einem Eintrag)
  run(ctx): void | Promise<void>;  // Fehler → Hinweis (Live-Region)
  availableIn?: string;            // Prompt, solange nicht implementiert → gedimmt, in der Palette „kommt in …“
}
```

`ActionRegistry` (Root) nimmt Definitionen auf (`register(defs)`; spätere Prompts registrieren ihre Aktionen),
`ActionService.run(id)` baut den Kontext aus `WorkspaceStore` + aktivem Panel und führt aus. Panels melden dafür
ihren `FileBrowserStore`/Controller beim `WorkspaceStore` an (`registerPanel(side, handle)`).

### 3.2 Ids (alt → neu)

| alt (legacy/mr) | neu | Grund |
|---|---|---|
| `NAVIGATE_LEVEL_DOWN` | `NAVIGATE_PARENT` | hieß „Parent Dir“, Name war irreführend |
| `ENTER_PRESSED` | `NAVIGATE_OPEN` | Aktion statt Taste |
| `SPACE_PRESSED`, `TOGGLE_SELECTION_CURRENT_ROW` | `TOGGLE_MARK_AND_ADVANCE` | eine Aktion |
| `TOGGLE_SELECTION` (Num*) | `INVERT_MARKS` | tat Invertieren |
| `OPEN_SELECT_DLG`/`ENHANCE_SELECTION`, `OPEN_DESELECT_DLG`/`REDUCE_SELECTION` | `OPEN_MARK_PATTERN_DLG`, `OPEN_UNMARK_PATTERN_DLG` | Dialog mit Glob/Regex |
| `OPEN_FIND_DUBLICATES_DLG` | `OPEN_FIND_DUPLICATES_DLG` | Tippfehler |
| `NEXT_TAB` | `NEXT_TAB` + neu `PREV_TAB` | |
| `OPEN_GOTO_ANYTHING_DLG` | `OPEN_COMMAND_PALETTE` | |
| `HOME_/END_/PAGEUP_/PAGEDOWN_PRESSED`, `ARROW_UP/DOWN` | entfallen | Table (D6) |
| `DUMMY_ACTION`, `DO_NOTHING`, `PRINT_DEBUG`, `SAVE_CONFIG`, `OPEN_COLORCONFIG_DLG`, `OPEN_JOB_QUEUE_DLG`, `DESELECT`, `EDIT_FILE` | entfallen | tot (mr §2) bzw. ersetzt |
| neu | `OPEN_IN_NEW_TAB`, `CLONE_TAB`/`CLOSE_TAB` (= `ADD_NEW_TAB`/`REMOVE_TAB`), `TOGGLE_FAVORITE`, `SPLITTER_RESET` | aus 004 |

Alle übrigen Ids aus mr §2 bleiben (Dialoge `OPEN_*_DLG`, `COPY_2_CLIPBOARD_*`, `TOGGLE_FILTER`, …) und werden mit
`availableIn` registriert, sobald ihr Prompt sie nicht selbst liefert – so zeigt die Palette schon jetzt den Plan.

### 3.3 Default-Keymap (Auszug; vollständig in den JSON-Dateien + README-Tabelle)

| Aktion | Windows / Linux | macOS | jetzt lauffähig |
|---|---|---|---|
| NAVIGATE_OPEN / NAVIGATE_PARENT | `Enter` / `Backspace` | gleich (+ `Mod+ArrowDown`/`Mod+ArrowUp`? → nein, Table, D6) | ✅ |
| OPEN_IN_NEW_TAB | `Mod+Enter` | `Mod+Enter` | ✅ |
| RELOAD_DIR | `Ctrl+R` | `Mod+R` (WebView-Reload in Release aus; Dev-Build prüfen) | ✅ |
| TOGGLE_PANEL | `Tab` | `Tab` | ✅ |
| SELECT_LEFT_PANEL / RIGHT | `Alt+1` / `Alt+2` | `Alt+1` / `Alt+2` (aus `code`) | ✅ (Menü ▾ in 003) |
| NEXT_TAB / PREV_TAB | `Ctrl+Tab` / `Ctrl+Shift+Tab` | gleich (`Ctrl` = ⌃) | ✅ |
| CLONE_TAB / CLOSE_TAB | `Ctrl+T` / `Ctrl+W` (TC-Standard; 004 hatte überall `Mod+Alt+T/W`) | `Mod+Alt+T` / `Mod+Alt+W` (⌘W gehört dem Menü) | ✅ |
| TOGGLE_MARK_AND_ADVANCE | `Space`, `Insert` | `Space`, `Ctrl+0` | ✅ |
| SELECT_ALL / DESELECT_ALL | `Mod+A`, `Mod+NumpadAdd` / `Mod+Shift+A`, `Mod+NumpadSubtract` | gleich mit ⌘ | ✅ |
| INVERT_MARKS | `NumpadMultiply` | `NumpadMultiply` | ✅ |
| OPEN_MARK_PATTERN_DLG / UNMARK | `NumpadAdd` / `NumpadSubtract` | gleich | ✅ (Dialog in 002) |
| OPEN_COMMAND_PALETTE | `Mod+Shift+P`, `Ctrl+F12` (legacy) | `Mod+Shift+P`, `Mod+Ctrl+G` (mr) | ✅ |
| OPEN_CALL_ACTION_DLG | `F10` | `F10` | ✅ (= Palette mit Fokus auf Aktionen) |
| OPEN_VIEW_DLG / OPEN_EDIT_DLG | `F3` / `F4` | gleich | 010 / 011 |
| OPEN_CREATE_FILE_DLG | `Shift+F4` | gleich | 006 |
| OPEN_COPY_DLG / OPEN_MOVE_DLG | `F5` / `F6` | gleich | 006 |
| OPEN_RENAME_DLG | `Shift+F6` | gleich | 006 |
| OPEN_MULTIRENAME_DLG | `Mod+F6`, `Ctrl+Alt+M` | `Mod+F6` | 007 |
| OPEN_MKDIR_DLG | `F7`, `Shift+F7` | gleich | 006 (F7 fehlte in mr) |
| OPEN_DELETE_DLG | `F8`, `Delete` | `F8`, `Mod+Backspace` | 006 |
| OPEN_FIND_DLG | `Alt+F7`, `Ctrl+F` | `Alt+F7`, `Mod+F` | 009 |
| TOGGLE_HIDDEN_FILES / TOGGLE_FILTER | `Ctrl+H` / `Ctrl+Alt+F` | `Mod+Shift+.` (Finder) / `Mod+Alt+F` | 003 |
| NAVIGATE_BACK / FORWARD | `Alt+ArrowLeft` / `Alt+ArrowRight` | `Mod+[` / `Mod+]` | 003 |
| OPEN_SHORTCUT_DLG | `Ctrl+Shift+K` | `Mod+Shift+K` | 002 |

**WebView-Konflikte:** WebView2 (Windows) hat eigene Beschleuniger (F5 Neu laden, Strg+R, Strg+F, Strg+P, F12).
Unser Capture-Handler ruft `preventDefault()` für jede gemappte Taste; ob das bei WebView2 für **F5** genügt, ist nur
unter Windows prüfbar – Fallback: wry `browser_accelerator_keys(false)` (Tauri-Konfiguration prüfen). Unter Linux
(WebKitGTK) und macOS keine bekannten Konflikte außer dem Menü (D1).

### 3.4 Dispatcher

```
document keydown (capture)
 ├─ Palette/Dialog offen → nur Escape, Mod+Enter (primärer Button) – sonst durchlassen an den Dialog
 ├─ Fokus in Texteingabe (input, textarea, contenteditable) → nur Kürzel mit Mod/Ctrl/Alt oder F-Tasten
 ├─ Navigationstaste (D6) und Fokus in einer Liste → durchlassen an die Table
 ├─ Akkord offen → zweite Taste prüfen
 └─ Keymap-Treffer → preventDefault + stopPropagation → ActionService.run(id)
```

Modifier-Zustand für die Button-Leiste (`keydown`/`keyup`/`blur` → Signal `heldModifiers`), Badge = kürzestes Kürzel
der Aktion ohne die gehaltenen Modifier (mr `getSimplestShortcutsByAction`).

### 3.5 Rust

| Command | Rückgabe |
|---|---|
| `load_keymap_override` | `{ bindings: Record<string, string[]>, warning: string \| null }` (Datei fehlt → leer) |
| `save_keymap_override(bindings)` | `()` / `FsError io` |

Rust prüft nur Form und Größe (max. 500 Aktionen, 8 Kürzel je Aktion, 64 Zeichen je Kürzel); die Semantik
(bekannte Id, gültiges Kürzel, Doppelbelegung) prüft das Frontend und meldet sie.

## 4. UI

- **Befehlspalette** (`Mod+Shift+P`): Dialog oben mittig, `role="dialog"` + `aria-modal`, Eingabe als APG-Combobox mit
  Listbox, unscharfe Suche (Teilfolge, Treffer hervorgehoben, Kategorie als Gruppe), rechts `<kbd>` mit
  `formatShortcut(platform)` (macOS `⌘⌥⇧⌃`, sonst `Strg+Alt+Umschalt`), nicht verfügbare Aktionen gedimmt mit
  „kommt in Prompt …“. Esc schließt und gibt den Fokus an die Liste zurück.
- **Actions-Menü ▴** (Button-Leiste): 4 Spalten nach mr §1.8, Einträge mit Kürzel; das `ContextMenu` aus 004 bekommt
  Gruppen/Spalten.
- **⌨ Kürzel-Übersicht**: Tabelle Aktion → Kürzel (laufendes OS), Suche; **Bearbeiten** (Tastenaufnahme, Speichern
  in den Override) – Umfang klein halten, die volle Einstellungs-UI kommt in 015.
- **Markier-Dialog** (`Num+`/`Num−`): Muster mit Glob (`*.jpg`) **und** Regex (Umschalter), Vorlagen aus dem alten
  Programm (Bilder, Videos, Dokumente …), Vorschau „passt auf n Einträge“, gilt nur für angezeigte Zeilen.

## 5. Tests

| Ebene | Fälle |
|---|---|
| Frontend (rein) | `canonical()` für Ereignisse und Strings (Reihenfolge, Groß/klein, `key`/`code`-Regeln, macOS-⌥, deutsche Ziffern, Numpad); Umrechnung legacy → neu (Tabelle §6); **alle drei Keymaps**: jede Id existiert, keine Doppelbelegung, keine Table-Navigationstaste, keine reservierten macOS-Menükürzel; Override-Mischung (ersetzen, leeren, unbekannt, kaputt, Konflikt); Badge ohne gehaltene Modifier; Freigaberegeln |
| Frontend (Komponenten) | Dispatcher-Prioritäten (Eingabefeld, Dialog, Liste), Palette (Combobox-Rollen, Pfeile, Enter, Esc + Fokus-Rückgabe), Button-Leiste (Satzwechsel bei Shift/Alt/Mod, gedimmt nach Freigabe) |
| Rust | Override laden/speichern wie `session.rs` (fehlt, kaputt → `.bad`, Größe) |
| Ende-zu-Ende | jede vorhandene Funktion per Kürzel; Override ändert ein Kürzel nach Neustart; kaputte Datei → Warnung; Palette per Tastatur |

## 6. Umrechnung alte Notation → neue

| legacy (Keypress, Leerzeichen) / mr (`+`) | neu |
|---|---|
| `control 5` / `ctrl+5` | `Ctrl+5` (macOS) bzw. `Mod+5` |
| `cmd …` / `cmd+…` (meinte Meta auf **allen** OS) | `Mod+…` |
| `alt …` / `alt+…` | `Alt+…` |
| `shift f6` / `shift+f6` | `Shift+F6` |
| `num_add` / `num_subtract` / `num_multiply` | `NumpadAdd` / `NumpadSubtract` / `NumpadMultiply` |
| `space`, `enter`, `tab`, `insert`, `home`, `end`, `pageup`, `pagedown` | `Space`, `Enter`, `Tab`, `Insert`, `Home`, `End`, `PageUp`, `PageDown` |
| `delete` / `del`, `escape` / `esc` | `Delete`, `Escape` |
| `up`/`down`/`left`/`right` | `ArrowUp` … |
| `plus`, `minus`, `add`, `subtract`, `multiply` | `+`, `-` bzw. Numpad-Namen |
| `ctrl+k f6` (Akkord) | `Ctrl+K F6` |
| Modifier-Reihenfolge beliebig (`cmd+alt+left` vs. `alt+cmd+left`) | kanonisch `Mod+Ctrl+Alt+Shift+` |

## 7. Fortschritt

- [x] Phase 1: Bestand, Entscheidungen D1–D6, Verträge, Testplan (dieses Dokument)
- [x] Freigabe durch Marc (2026-10-17, D1–D6 wie empfohlen)
- [ ] Phase 2: Rust (Override-Datei)
- [ ] Phase 3: Frontend (Register, Keymaps, Dispatcher, Auswahl, Palette, Button-Leiste, Actions-Menü, ⌨)
- [ ] Phase 4–6
