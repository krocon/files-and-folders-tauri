# Design 020: Actions-Menü nach Vorbild der alten Version (mr §1.8)

> **Status:** ✅ umgesetzt (2026-10-19, zusammen mit 018) · **Datum:** 2026-10-18 · **Branch:** `feat/actions-menue` (von `main`)
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

---

## 4. Detaillierte Referenz aller Menüpunkte (Code aus `old_project`)

Hier ist für jeden Menüpunkt genau beschrieben, was im alten Code passierte und wie er im neuen Projekt (`tauri`) umgesetzt ist:

### Spalte 0 (`menuItems0`)

1. **`OPEN_GOTO_ANYTHING_DLG` – „Go to anything…“**
   - **Altes Projekt (`file-table.component.ts:597-630`):** Öffnet den modalen Dialog `GotoAnythingDialog`. Sammelt Verzeichnispfade aller Tabs (`getDirsFromAllTabs`), alle Verlaufseinträge (`getAllHistories`) sowie alle registrierten Aktions-IDs. Eingaben filtern die Liste per Typeahead. Bei Auswahl eines Pfades wird `cd <pfad>` auf dem aktiven Panel ausgeführt; bei Auswahl einer Aktion wird diese per `triggerAction(id)` gestartet.
   - **Tauri:** Entspricht `OPEN_COMMAND_PALETTE` (`command-palette.ts`) bzw. dem Aktions-Sucher.

2. **`RELOAD_DIR` – „Reload…“**
   - **Altes Projekt (`file-table.component.ts:345-348, 487-489`):** Ruft `this.reload()` auf. Setzt Zeilen auf leer, invalidiert den Cache und fordert per WebSocket/API die aktuellen Verzeichniseinträge vom Betriebssystem neu an.
   - **Tauri:** Löst `RELOAD_DIR` aus (`ActionService.run('RELOAD_DIR')`), wodurch das aktive Panel das Verzeichnis neu einliest und die GuiExpert-Tabelle auffrischt.

3. **`OPEN_CHDIR_DLG` – „Change Dir…“**
   - **Altes Projekt (`action-execution.service.ts:195-197`):** Öffnet `ChangeDirDialogService`. Der Nutzer tippt einen absoluten oder relativen Pfad ein (mit Autovervollständigung). Nach Bestätigung wechselt das Panel per `onChangeDir` dorthin.
   - **Tauri:** Entspricht `OPEN_CHDIR_DLG`.

4. **`TOGGLE_FILTER` – „Toggle Filter Input“**
   - **Altes Projekt (`action-execution.service.ts:104-108`):** Invertiert `tab.filterActive` auf den Tab-Daten des aktiven Panels. Blendet das Eingabefeld in der Tab-Leiste ein oder aus und fokussiert es beim Einblenden.
   - **Tauri:** Entspricht `TOGGLE_FILTER`.

5. **`TOGGLE_HIDDEN_FILES` – „Toggle Hidden Files“**
   - **Altes Projekt (`action-execution.service.ts:112-116`):** Invertiert `tab.hiddenFilesVisible` für den aktiven Tab und lädt das Verzeichnis neu, sodass Dotfiles (`.*`) angezeigt oder ausgeblendet werden.
   - **Tauri:** Entspricht `TOGGLE_HIDDEN_FILES`.

6. **`TOGGLE_SHELL` – „Toggle Shell“**
   - **Altes Projekt (`action-execution.service.ts:109-111`):** Ruft `shellLocalStorage.toggleShellVisible()` auf. Blendet das Shell-Eingabepanel oberhalb der Fußleiste ein/aus.
   - **Tauri:** Entspricht `TOGGLE_SHELL`.

7. **`COPY_2_CLIPBOARD_NAMES` – „Copy names to clipboard“**
   - **Altes Projekt (`action-execution.service.ts:133-136`):** Ermittelt die markierten Zeilen (oder die Zeile unter dem Cursor) und schreibt die reinen Dateinamen getrennt durch Zeilenumbrüche (`\n`) in die Zwischenablage.
   - **Tauri:** Entspricht `COPY_2_CLIPBOARD_NAMES`.

8. **`COPY_2_CLIPBOARD_FULLNAMES` – „Copy full names to clipboard“**
   - **Altes Projekt (`action-execution.service.ts:129-132`):** Schreibt die vollständigen absoluten Pfade der selektierten/fokussierten Dateien zeilenweise in die Zwischenablage.
   - **Tauri:** Entspricht `COPY_2_CLIPBOARD_FULLNAMES`.

9. **`COPY_2_CLIPBOARD_NAMES_AS_JSON` – „Copy names to clipboard as JSON“**
   - **Altes Projekt (`action-execution.service.ts:141-144`):** Serialisiert die Dateinamen als formatiertes JSON-String-Array (z. B. `["file1.txt", "file2.jpg"]`) in die Zwischenablage.
   - **Tauri:** Entspricht `COPY_2_CLIPBOARD_NAMES_AS_JSON`.

10. **`COPY_2_CLIPBOARD_FULLNAMES_AS_JSON` – „Copy full names to clipboard as JSON“**
    - **Altes Projekt (`action-execution.service.ts:137-140`):** Serialisiert die absoluten Pfade als formatiertes JSON-String-Array in die Zwischenablage.
    - **Tauri:** Entspricht `COPY_2_CLIPBOARD_FULLNAMES_AS_JSON`.

---

### Spalte 1 (`menuItems1`)

1. **`OPEN_FIND_DLG` – „Find…“**
   - **Altes Projekt (`action-execution.service.ts:198-200, 290-320`):** Öffnet `FindDialogService` mit Suchordner, Glob-Muster (`**/*.*`), Optionen für Regex und Textsuche. Erstellt nach Bestätigung einen neuen Suchergebnis-Tab `TabData` mit `findData`.
   - **Tauri:** Entspricht `OPEN_FIND_DLG`.

2. **`ENHANCE_SELECTION` – „Enhance Selection“**
   - **Altes Projekt (`file-table.component.ts:507-509`):** Öffnet `SelectionDialogService` im Modus `true` (Hinzufügen). Nutzer gibt ein Glob-/Regex-Muster ein (z. B. `*.ts`); passende Zeilen werden zusätzlich selektiert.
   - **Tauri:** Entspricht `OPEN_MARK_PATTERN_DLG`.

3. **`REDUCE_SELECTION` – „Reduce Selection“**
   - **Altes Projekt (`file-table.component.ts:510-512`):** Öffnet `SelectionDialogService` im Modus `false` (Abwählen). Passende Zeilen werden aus der bestehenden Selektion entfernt.
   - **Tauri:** Entspricht `OPEN_UNMARK_PATTERN_DLG`.

4. **`TOGGLE_SELECTION` – „Toggle Selection“**
   - **Altes Projekt (`file-table.component.ts:498-501`):** Invertiert die Auswahl aller Zeilen im Panel (`selectionManager.toggleSelection()`).
   - **Tauri:** Entspricht `INVERT_MARKS`.

5. **`SELECT_ALL` – „Select All“**
   - **Altes Projekt (`file-table.component.ts:490-493`):** Markiert alle Zeilen im aktuellen Tab (`selectionManager.selectionAll()`).
   - **Tauri:** Entspricht `SELECT_ALL`.

6. **`DESELECT_ALL` – „Deselect All“**
   - **Altes Projekt (`file-table.component.ts:494-497`):** Hebt alle Markierungen im aktuellen Tab auf (`selectionManager.deSelectionAll()`).
   - **Tauri:** Entspricht `DESELECT_ALL`.

7. **`NAVIGATE_LEVEL_DOWN` – „Parent Dir“**
   - **Altes Projekt (`file-table.component.ts:575-581`):** Wechselt in das Elternverzeichnis (äquivalent zum Aktivieren der `..`-Zeile).
   - **Tauri:** Entspricht `NAVIGATE_PARENT`.

8. **`NAVIGATE_BACK` – „History Back“**
   - **Altes Projekt (`file-table.component.ts:632-633`):** Navigiert im Pfadverlauf des aktuellen Tabs einen Schritt zurück (`appService.navigateBack()`).
   - **Tauri:** Entspricht `NAVIGATE_BACK`.

9. **`SELECT_LEFT_PANEL` – „Left Panel“**
   - **Altes Projekt (`action-execution.service.ts:123-125`):** Setzt das linke Panel (Index 0) als aktives Panel.
   - **Tauri:** Entspricht `SELECT_LEFT_PANEL`.

10. **`SELECT_RIGHT_PANEL` – „Right Panel“**
    - **Altes Projekt (`action-execution.service.ts:126-128`):** Setzt das rechte Panel (Index 1) als aktives Panel.
    - **Tauri:** Entspricht `SELECT_RIGHT_PANEL`.

11. **`TOGGLE_PANEL` – „Toggle Panels“**
    - **Altes Projekt (`action-execution.service.ts:97-99`):** Wechselt den Fokus zwischen linkem und rechtem Panel hin und her.
    - **Tauri:** Entspricht `TOGGLE_PANEL`.

12. **`ADD_NEW_TAB` – „Add Tab“**
    - **Altes Projekt (`action-execution.service.ts:120-122`):** Erzeugt im aktiven Panel einen neuen Tab und dupliziert den aktuellen Verzeichnispfad.
    - **Tauri:** Entspricht `CLONE_TAB` bzw. `OPEN_IN_NEW_TAB`.

13. **`REMOVE_TAB` – „Remove Tab“**
    - **Altes Projekt (`action-execution.service.ts:117-119`):** Schließt den aktuellen Tab, sofern mindestens zwei Tabs vorhanden sind.
    - **Tauri:** Entspricht `CLOSE_TAB`.

---

### Spalte 2 (`menuItems2`)

1. **`OPEN_COPY_DLG` – „Copy“**
   - **Altes Projekt (`action-execution.service.ts:216-218`):** Öffnet den Bestätigungsdialog zum Kopieren aller selektierten Dateien in das Zielverzeichnis des gegenüberliegenden Panels.
   - **Tauri:** Entspricht `OPEN_COPY_DLG`.

2. **`OPEN_MOVE_DLG` – „Move“**
   - **Altes Projekt (`action-execution.service.ts:219-221`):** Öffnet den Bestätigungsdialog zum Verschieben aller selektierten Dateien in das gegenüberliegende Panel.
   - **Tauri:** Entspricht `OPEN_MOVE_DLG`.

3. **`OPEN_DELETE_DLG` – „Delete“**
   - **Altes Projekt (`action-execution.service.ts:204-206`):** Öffnet den Lösch-Dialog für markierte Dateien (mit Option für Papierkorb vs. permanent löschen).
   - **Tauri:** Entspricht `OPEN_DELETE_DLG`.

4. **`OPEN_MKDIR_DLG` – „MkDir“**
   - **Altes Projekt (`file-table.component.ts:582-584`):** Öffnet den Dialog `MakeDirDialog` zur Eingabe eines neuen Ordnernamens im aktuellen Verzeichnis.
   - **Tauri:** Entspricht `OPEN_MKDIR_DLG`.

5. **`OPEN_RENAME_DLG` – „Rename…“**
   - **Altes Projekt (`action-execution.service.ts:180-182`):** Öffnet den Umbenennen-Dialog für das aktuell fokussierte Element.
   - **Tauri:** Entspricht `OPEN_RENAME_DLG`.

6. **`OPEN_ATTRIBUTE_DLG` – „File Attributes…“**
   - **Altes Projekt (`action-execution.service.ts:183-185`):** Öffnet den Dialog für Dateiattribute (Berechtigungen `rwxrwxrwx`, POSIX-Flags, Eigentümer, ctime/mtime).
   - **Tauri:** Entspricht `OPEN_ATTRIBUTE_DLG`.

7. **`OPEN_UNPACK_DLG` – „Unpack…“**
   - **Altes Projekt (`file-table.component.ts:585-587`):** Öffnet den Entpack-Dialog für das markierte ZIP-/TAR-Archiv mit Vorgabe des Zielordners im anderen Panel.
   - **Tauri:** Entspricht `OPEN_UNPACK_DLG`.

8. **`OPEN_PACK_DLG` – „Pack…“**
   - **Altes Projekt (`file-table.component.ts:588-590`):** Öffnet den Pack-Dialog zur Kompression der markierten Dateien in eine Archivdatei.
   - **Tauri:** Entspricht `OPEN_PACK_DLG`.

9. **`OPEN_DOWNLOAD_DLG` – „Download…“**
   - **Altes Projekt (`file-table.component.ts:591-593`):** Startet den HTTP-Download/Export der ausgewählten Datei(en).
   - **Tauri:** Entspricht `OPEN_DOWNLOAD_DLG`.

10. **`OPEN_MULTIRENAME_DLG` – „Multi Rename…“**
    - **Altes Projekt (`action-execution.service.ts:186-188`):** Startet das Multi-Rename-Tool (Muster-Ersetzungen, Nummerierung, Groß-/Kleinschreibung, Regex, Tabellenvorschau).
    - **Tauri:** Entspricht `OPEN_MULTIRENAME_DLG`.

11. **`OPEN_MULTIMKDIR_DLG` – „Multi MkDir…“**
    - **Altes Projekt (`action-execution.service.ts:189-191`):** Öffnet den Dialog zur automatisierten Massenerstellung von Verzeichnissen nach Vorlage (Zähler, Schrittweite).
    - **Tauri:** Entspricht `OPEN_MULTIMKDIR_DLG`.

12. **`OPEN_GROUPFILES_DLG` – „Group Files…“**
    - **Altes Projekt (`action-execution.service.ts:192-194`):** Öffnet das Gruppierungswerkzeug, um Dateien nach Kriterien (Nummer, Trennzeichen, Wort) in Unterordner zu verschieben/kopieren.
    - **Tauri:** Entspricht `OPEN_GROUPFILES_DLG`.

13. **`OPEN_DELETE_EMPTY_FOLDERS_DLG` – „Clean Folders…“**
    - **Altes Projekt (`action-execution.service.ts:201-203`):** Öffnet den Dialog zum rekursiven Aufspüren und Entfernen leerer Verzeichnisse sowie von Dateileichen (`.DS_Store`, `Thumbs.db`).
    - **Tauri:** Entspricht `OPEN_DELETE_EMPTY_FOLDERS_DLG`.

---

### Spalte 3 (`menuItems3` & Tools)

1. **`OPEN_SETUP_DLG` – „Setup…“**
   - **Altes Projekt (`action-execution.service.ts:148-150`):** Navigiert zur Setup-Seite (`/setup`) für globale Grundeinstellungen der App.
   - **Tauri:** Entspricht `OPEN_SETUP_DLG`.

2. **`OPEN_THEMES_DLG` – „Fancy Theme Editor…“**
   - **Altes Projekt (`action-execution.service.ts:151-156`):** Öffnet den grafischen Theme-Editor in einem separaten Fenster (`/themes`).
   - **Tauri:** Entspricht `OPEN_THEMES_DLG`.

3. **`OPEN_THEME_CONFIG_DLG` – „Theme Configuration…“**
   - **Altes Projekt (`action-execution.service.ts:173-176`):** Öffnet den Verwaltungsdialog für installierte Farbschemata.
   - **Tauri:** Entspricht `OPEN_THEMES_DLG`.

4. **`OPEN_BUTTON_CONFIG_DLG` – „Button Configuration…“**
   - **Altes Projekt (`action-execution.service.ts:157-160`):** Dialog zur Belegung der Funktionsleisten-Buttons für Standard-, Shift-, Cmd- und Alt-Zustände.
   - **Tauri:** Entspricht `OPEN_BUTTON_CONFIG_DLG`.

5. **`OPEN_FILETYPE_CONFIG_DLG` – „File Type Configuration…“**
   - **Altes Projekt (`action-execution.service.ts:161-164`):** Dialog zur Zuweisung von Dateitypen zu Editoren und Icons.
   - **Tauri:** Entspricht `OPEN_FILETYPE_CONFIG_DLG`.

6. **`OPEN_TOOL_CONFIG_DLG` – „Tool Configuration…“**
   - **Altes Projekt (`action-execution.service.ts:165-168`):** Dialog zur Definition benutzerdefinierter Tools (Befehlszeile, Parameterersetzung `%f`, Shortcuts).
   - **Tauri:** Entspricht `OPEN_TOOL_CONFIG_DLG`.

7. **`OPEN_PROMPT_CONFIG_DLG` – „Prompt Configuration…“**
   - **Altes Projekt (`action-execution.service.ts:169-172`):** Dialog zur Verwaltung von KI-/Befehls-Prompt-Vorlagen.
   - **Tauri:** Entspricht `OPEN_PROMPT_CONFIG_DLG`.

8. **`OPEN_SHELL_DLG` – „Server Shell…“**
   - **Altes Projekt (`action-execution.service.ts:177-179`):** Navigiert zur integrierten Vollbild-Shell (`/shell`).
   - **Tauri:** Entspricht `OPEN_TERMINAL_HERE` / `OPEN_SHELL_DLG`.

9. **`OPEN_ABOUT_DLG` – „About…“**
   - **Altes Projekt (`action-execution.service.ts:145-147`):** Navigiert zur Über-Seite (`/about`) mit Versions- und Lizenzangaben.
   - **Tauri:** Entspricht `OPEN_ABOUT_DLG`.

10. **`@tools` (Dynamische Tool-Einträge)**
    - **Altes Projekt (`buttonpanel.component.html:108-140` & `action-execution.service.ts:223-228, 269-274`):**
      Liest die konfigurierten Werkzeuge aus der Tool-Konfiguration (`tools.json`) und führt sie mit Kontextparametern (`prepareCmdAndExecute`) aus:
      - **Edit** (`^ ⇧ 4`): Öffnet die fokussierte Datei im Standard-Editor.
      - **Local Shell** (`⌘ 0`): Startet ein Terminal im Verzeichnis des aktiven Panels.
      - **Reveal in Finder** (`⌘ ⇧ f`): Zeigt die markierte Datei im nativen Dateimanager (macOS Finder bzw. Windows Explorer) an.

---

## 5. Umsetzung und Abweichungen (2026-10-19)

- Menüdefinition `features/actions/actions-menu-def.ts` (4 Spalten mit `'-'`, `'@tools'`), Kurzlabels in
  `actions-texts.ts` (`menu`, en/de), Badges: reiner Tokenizer `core/actions/shortcut-badge.ts` + Komponente
  `features/actions/shortcut-badges.ts` (Tokens `^ ⌘ alt ⇧` + Taste klein, `+` gedimmt, ein Badge je Akkord-Schlag).
  Für Screenreader trägt jeder Eintrag `aria-keyshortcuts` mit dem normalen Kürzeltext; die Badges sind `aria-hidden`.
- Ids der alten Version auf die neuen abgebildet: `OPEN_GOTO_ANYTHING_DLG` → `OPEN_COMMAND_PALETTE`,
  `ENHANCE_/REDUCE_SELECTION` → `OPEN_MARK_/OPEN_UNMARK_PATTERN_DLG`, `TOGGLE_SELECTION` → `INVERT_MARKS` (mr invertiert
  alle Zeilen), `NAVIGATE_LEVEL_DOWN` → `NAVIGATE_PARENT`, `ADD_NEW_TAB`/`REMOVE_TAB` → `CLONE_TAB`/`CLOSE_TAB`.
- **Weggelassen** (✖): Download… (HTTP-Transport der Web-App), Server Shell… (Browser-Shell; das Terminal ist ein
  Tool), Theme Configuration… (derselbe Dialog wie der Theme-Editor), File Type / Prompt Configuration… (gibt es noch
  nicht – Folge-Prompt, s. `docs/feature-parity.md`). **Ergänzt:** Find Duplicates… (016) und Shortcuts… (002).
- Spaltenbreite: `repeat(4, minmax(0, 1fr))` bis 88 rem statt fester 350/350/330/380 px – das Fenster der Desktop-App ist
  oft schmaler als 1 410 px; Labels werden notfalls gekürzt (…), Badges nie.
- Tool-Kürzel erscheinen wie Aktions-Kürzel als ein Badge je Schlag (mr zeigte dort jede Taste einzeln – eine Folge
  seines Leerzeichen-Formats, legacy-mr §11 #1).

## 6. Fortschritt

- [x] Phase 1 Design · [x] Phase 3 Frontend (`shortcut-badge.spec.ts`, `actions-menu.spec.ts`) · [x] Phase 4 E2E
  (Linux/Xvfb: Menü mit 4 Spalten, Trennern, Badges, gedimmten Einträgen) · [x] Phase 5 Doku

