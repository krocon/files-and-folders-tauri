# Design 020: Actions-Menü nach Vorbild der alten Version (mr §1.8)

> **Status:** 🛑 Entwurf / Bereit zur Freigabe · **Datum:** 2026-10-18 · **Branch:** `feat/actions-menue` (von `main`)
> **Grundlage:** Prompt 020, `docs/legacy-analysis-mr.md` §1.8 & §1.10, Screenshot Soll-Zustand, Altreferenz `files-and-folders-mr/apps`.
> **Phasen:** Phase 1 (Design), Phase 3 (Frontend: Spezifikationen + Implementierung), Phase 4 (E2E), Phase 5 (Doku). Keine Rust-Änderungen erforderlich (reines UI-Feature).

---

## 1. Bestand und Analyse

| Baustein | Ist-Zustand (tauri) | Soll-Zustand (mr) | Handlungsbedarf |
|---|---|---|---|
| `ActionsMenu` (`actions-menu.ts`) | Iteriert dynamisch über `COLUMNS = ['navigation', 'selection', 'files', 'config']` und filtert alle Aktionen | Feste 4-Spalten-Zusammenstellung mit 17 logischen Gruppen getrennt durch Dividers | Eigene Menüdefinition `ACTIONS_MENU_COLUMNS` mit 4 Spalten und Trennern einführen |
| Spaltenköpfe | `<div class="heading">{{ col.label }}</div>` gerendert | Keine Spaltenüberschriften vorhanden | `.heading` komplett entfernen |
| Gruppentrennlinien | Keine vorhanden (durchgehende Liste) | Feine horizontale Linien (`border-bottom` / `<hr>`) zwischen den logischen Blöcken | `separator`-Items in das Menü-Array aufnehmen und als `.divider` rendern |
| Kürzel-Anzeige | Schlichtes `<kbd>{{ item.shortcut }}</kbd>` mit `opacity: 0.8` | Dunkle Badges (`<b class="fnf-shortcut">`), abgerundet, helle Schrift, gedimmtes `+`, wörtliches `alt`, Akkorde getrennt | Komponente/Helper für Shortcut-Badges mit Token-Splitting und Styling umsetzen |
| Benennungen | Ausführlich (`Parent folder`, `Create folder…`, `Delete empty folders`) | Prägnant (`Parent Dir`, `MkDir`, `Clean Folders…`) | Override-Labels für das Actions-Menü bereitstellen |
| Spaltenlayout (`actions-menu.css`) | `repeat(4, minmax(12rem, max-content))` | 4 Spalten mit großzügiger Breite (`350px 350px 330px 380px` oder `minmax(280px, 1fr)`) | CSS-Grid auf feste / proportionale Breiten mit komfortablem Padding anpassen |

---

## 2. Entscheidungen

### E1 – Struktur der 4 Spalten (1:1 nach mr §1.8)
Das Menü wird nicht mehr aus den Kategorien generiert, sondern folgt einer expliziten Spezifikation mit 4 Spalten:

#### Spalte 0 (Navigation & Allgemein)
1. `OPEN_COMMAND_PALETTE` (Label: „Go to anything…“)
2. `'-'` (Trennlinie)
3. `RELOAD_DIR` (Label: „Reload…“)
4. `OPEN_CHDIR_DLG` (Label: „Change Dir…“)
5. `TOGGLE_FILTER` (Label: „Toggle Filter Input“)
6. `TOGGLE_HIDDEN_FILES` (Label: „Toggle Hidden Files“)
7. `TOGGLE_SHELL` (Label: „Toggle Shell“)
8. `'-'` (Trennlinie)
9. `COPY_2_CLIPBOARD_NAMES` (Label: „Copy names to clipboard“)
10. `COPY_2_CLIPBOARD_FULLNAMES` (Label: „Copy full names to clipboard“)
11. `COPY_2_CLIPBOARD_NAMES_AS_JSON` (Label: „Copy names to clipboard as JSON“)
12. `COPY_2_CLIPBOARD_FULLNAMES_AS_JSON` (Label: „Copy full names to clipboard as JSON“)

#### Spalte 1 (Auswahl, Panels & Tabs)
1. `OPEN_FIND_DLG` (Label: „Find…“)
2. `'-'` (Trennlinie)
3. `OPEN_MARK_PATTERN_DLG` / `ENHANCE_SELECTION` (Label: „Enhance Selection“)
4. `OPEN_UNMARK_PATTERN_DLG` / `REDUCE_SELECTION` (Label: „Reduce Selection“)
5. `TOGGLE_MARK_AND_ADVANCE` (Label: „Toggle Selection“)
6. `SELECT_ALL` (Label: „Select All“)
7. `DESELECT_ALL` (Label: „Deselect All“)
8. `'-'` (Trennlinie)
9. `NAVIGATE_PARENT` (Label: „Parent Dir“)
10. `NAVIGATE_BACK` (Label: „History Back“)
11. `'-'` (Trennlinie)
12. `SELECT_LEFT_PANEL` (Label: „Left Panel“)
13. `SELECT_RIGHT_PANEL` (Label: „Right Panel“)
14. `TOGGLE_PANEL` (Label: „Toggle Panels“)
15. `'-'` (Trennlinie)
16. `CLONE_TAB` (Label: „Add Tab“)
17. `CLOSE_TAB` (Label: „Remove Tab“)

#### Spalte 2 (Dateioperationen)
1. `OPEN_COPY_DLG` (Label: „Copy“)
2. `OPEN_MOVE_DLG` (Label: „Move“)
3. `OPEN_DELETE_DLG` (Label: „Delete“)
4. `OPEN_MKDIR_DLG` (Label: „MkDir“)
5. `OPEN_RENAME_DLG` (Label: „Rename…“)
6. `OPEN_ATTRIBUTE_DLG` (Label: „File Attributes…“)
7. `OPEN_UNPACK_DLG` (Label: „Unpack…“)
8. `OPEN_PACK_DLG` (Label: „Pack…“)
9. `OPEN_DOWNLOAD_DLG` (Label: „Download…“)
10. `'-'` (Trennlinie)
11. `OPEN_MULTIRENAME_DLG` (Label: „Multi Rename…“)
12. `OPEN_MULTIMKDIR_DLG` (Label: „Multi MkDir…“)
13. `OPEN_GROUPFILES_DLG` (Label: „Group Files…“)
14. `OPEN_DELETE_EMPTY_FOLDERS_DLG` (Label: „Clean Folders…“)

#### Spalte 3 (Konfiguration & Tools)
1. `OPEN_SETUP_DLG` (Label: „Setup…“)
2. `OPEN_THEMES_DLG` (Label: „Fancy Theme Editor…“)
3. `OPEN_THEME_CONFIG_DLG` (Label: „Theme Configuration…“)
4. `OPEN_BUTTON_CONFIG_DLG` (Label: „Button Configuration…“)
5. `OPEN_FILETYPE_CONFIG_DLG` (Label: „File Type Configuration…“)
6. `OPEN_TOOL_CONFIG_DLG` (Label: „Tool Configuration…“)
7. `OPEN_PROMPT_CONFIG_DLG` (Label: „Prompt Configuration…“)
8. `OPEN_SHELL_DLG` (Label: „Server Shell…“)
9. `OPEN_ABOUT_DLG` (Label: „About…“)
10. `'-'` (Trennlinie)
11. `@tools` (Extrawerkzeuge wie Edit, Local Shell, Reveal in Finder)

---

### E2 – Shortcut Badges (`ShortcutBadge`)
Entsprechend mr §1.10 wird die Darstellung von Tastenkombinationen in Badges modularisiert:
- **Badge-Container**:
  Ein Wrapper `<span class="shortcut-badges">`, der pro Akkord-Schlag ein `<span class="badge">` enthält (z. B. bei zweistufigen Akkorden wie `^k ^c` zwei nebeneinanderliegende Badges).
- **Token-Parsing**:
  - `Ctrl` / `Control` → `^`
  - `Cmd` / `Meta` → `⌘`
  - `Alt` / `Option` → `alt` (wie im Original wörtlich klein geschrieben)
  - `Shift` → `⇧`
  - Plus-Separator: `<span class="plus">+</span>` mit 50 % Deckkraft
  - Tasten-Tokens: `f1`–`f12`, `tab`, `down`, `up`, `space`, `+`, `-` etc.
- **Farben & Tokens**:
  - `background: var(--color-shortcut-bg, #383838);`
  - `color: var(--color-shortcut-text, #eeeeee);`
  - `border-radius: var(--radius-sm, 3px);`
  - `padding: 1px 5px;`
  - `font-size: 11px;`
  - `font-family: var(--font-mono);`

---

### E3 – CSS-Grid & Menü-Styling
- **Menü-Container**:
  - `position: absolute; right: var(--spacing-2); bottom: calc(100% + 6px);`
  - `display: grid; grid-template-columns: 350px 350px 330px 380px; gap: 0 var(--spacing-4);`
  - `background: var(--color-surface); border: var(--border-width) solid var(--color-border);`
  - `box-shadow: var(--shadow-popup); border-radius: var(--radius-md); padding: var(--spacing-3);`
  - `max-height: 80vh; overflow-y: auto;`
- **Trennlinien (`.divider`)**:
  - `height: 1px; margin: 6px 0; background-color: var(--color-border); opacity: 0.7;`
- **Menüzeilen (`[role='menuitem']`)**:
  - `display: flex; justify-content: space-between; align-items: center;`
  - `padding: 3px 8px; border-radius: var(--radius-sm); font-size: var(--font-size-sm);`
  - Hover / Focus: Sanfter Hover-Effekt, ohne das Shortcut-Badge farblich zu überblenden.

---

### E4 – Tastaturnavigation
- Navigationsregeln nach WAI-ARIA APG Menumuster:
  - `ArrowDown` / `ArrowUp`: Springt zum nächsten / vorherigen aktivierbaren Item innerhalb der aktuellen Spalte. Trennlinien (`.divider`) werden übersprungen.
  - `ArrowRight` / `ArrowLeft`: Wechselt in die nächste / vorherige Spalte auf derselben relativen Zeilenhöhe (bzw. zum nächsten verfügbaren Item).
  - `Home` / `End`: Erster bzw. letzter Menüeintrag der Spalte.
  - `Enter` / `Space`: Führt die Aktion aus (`actions.runAny(id)`), schließt das Menü und fokussiert den Button.
  - `Escape` / `Tab`: Schließt das Menü ohne Aktion.

---

## 3. Testplan

1. **Unit-Tests (`shortcut-badge.spec.ts`)**:
   - Zerlegung von Standard-Shortcuts (`Mod+Shift+F` → `⌘+⇧+f`).
   - Zerlegung von Akkorden (`Ctrl+K Ctrl+C` → `[^k] [^c]`).
   - Korrekte Darstellung von `alt` (wörtlich "alt" statt ⌥).
   - Spezialtasten (`Space` → `space`, `ArrowDown` → `down`).
2. **Komponententests (`actions-menu.spec.ts`)**:
   - Menü rendert exakt 4 Spalten ohne `<div class="heading">`.
   - Menü rendert die definierten Trennlinien.
   - Pfeiltastennavigation überspringt `.divider`-Elemente.
   - Klick auf ein Item löst die korrekte `ActionId` aus und emittiert `closed`.
   - Escape schließt das Menü.
