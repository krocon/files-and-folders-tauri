# Prompt 020: Actions-Menü nach Vorbild der alten Version (mr §1.8)

> **Slug:** `actions-menue` · **Braucht:** 002, 004, 014 · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`.
> Altes Verhalten: `docs/legacy-analysis-mr.md` §1.8 (Actions ▲, 4 Spalten, Shortcut-Badges) und §1.10 (Shortcut Badge Tokenizer), Screenshot Soll-Zustand. Quellcode-Referenz: `files-and-folders-mr/apps`.

## Ziel

Das **Actions-Menü ▴** in der unteren Button-Leiste soll visuell, strukturell und inhaltlich dem Soll-Zustand der Vorgängerversion (`files-and-folders-mr`) entsprechen. 

Aktuell zeigt das Menü vier nach Kategorien gefilterte Listen mit Spaltenüberschriften, unstrukturiert ohne Trennlinien und mit schlichtem Text für Kürzel. Der Soll-Zustand zeichnet sich durch vier präzise gegliederte Spalten mit dezenten horizontalen Trennlinien, den Verzicht auf Spaltenüberschriften sowie hochwertige, dunkle **Shortcut-Badges** mit Akkord-Unterstützung und originalgetreuen Tokens (`^`, `⌘`, `alt`, `⇧`, `+`) aus.

Vorgängerversion: siehe prompts/done/020-soll.png, der alte Code: im Folder 'old_project'
---

## Analyse Ist-Zustand vs. Soll-Zustand

| Aspekt | Ist-Zustand (Screenshot 1 / tauri) | Soll-Zustand (Screenshot 2 / mr) |
|---|---|---|
| **Spaltenüberschriften** | Vorhanden („Navigation & view“, „Selection, panels & tabs“, etc.) | **Keine Überschriften** – Spalten beginnen direkt mit den Menüeinträgen |
| **Inhaltsstruktur** | Flache dynamische Liste aller Katalog-Aktionen je Kategorie | **Feste, kuratierte 4-Spalten-Struktur** nach `mr §1.8` |
| **Gruppierung & Trenner** | Keine Trennlinien – eine durchgehende Liste je Spalte | **Horizontale Trennlinien (`divider`)** zwischen den semantischen Blöcken |
| **Tastenkürzel (Badges)** | Schlichter Text (`<kbd>`) mit Mac-Symbolen (`⌘R`, `⌥F1`, `Num*`) | **Stylische Badges** (`<b class="fnf-shortcut">`): dunkle Box (`#333`/`#444`), abgerundet, helles Label, gedimmtes `+` |
| **Kürzel-Tokens** | `⌃`, `⌥`, `⇧`, `⌘` zusammenhängend | `^` für Ctrl, `⌘` für Cmd, **`alt` als Text**, Akkorde als separate Badges (`^k` `^c`) |
| **Item-Labels** | Ausführlich/deskriptiv („Parent folder“, „Create folder…“, etc.) | Prägnant wie im Original („Parent Dir“, „MkDir“, „Clean Folders…“, etc.) |
| **Tools-Integration** | Am Ende von Spalte 4 als einfacher Text | Am Ende von Spalte 4 nach Trennlinie mit eigenen Badges (z. B. `^ ⇧ 4`, `⌘ 0`) |
| **Layout & Spacing** | `repeat(4, minmax(12rem, max-content))`, enges Padding | Großzügiges 4-Spalten-Grid (`350px 350px 330px 380px` bzw. proportionale Min-Breiten) |

---

## Aufgaben

### 1. Datenmodell & Menü-Definition (`actions-menu-def.ts` oder Erweiterung `menu-model.ts`)
- Definition der 4 festen Spalten (`menuItems0` bis `menuItems3`) mit expliziten Trennlinien (`'-'`):
  - **Spalte 0:**
    1. `OPEN_COMMAND_PALETTE` / `OPEN_GOTO_ANYTHING_DLG` („Go to anything…“)
    2. *Trenner*
    3. `RELOAD_DIR`, `OPEN_CHDIR_DLG`, `TOGGLE_FILTER`, `TOGGLE_HIDDEN_FILES`, `TOGGLE_SHELL`
    4. *Trenner*
    5. `COPY_2_CLIPBOARD_NAMES`, `COPY_2_CLIPBOARD_FULLNAMES`, `COPY_2_CLIPBOARD_NAMES_AS_JSON`, `COPY_2_CLIPBOARD_FULLNAMES_AS_JSON`
  - **Spalte 1:**
    1. `OPEN_FIND_DLG` („Find…“)
    2. *Trenner*
    3. `ENHANCE_SELECTION` (bzw. `OPEN_MARK_PATTERN_DLG`), `REDUCE_SELECTION` (bzw. `OPEN_UNMARK_PATTERN_DLG`), `TOGGLE_SELECTION` (bzw. `TOGGLE_MARK_AND_ADVANCE`), `SELECT_ALL`, `DESELECT_ALL`
    4. *Trenner*
    5. `NAVIGATE_PARENT` („Parent Dir“), `NAVIGATE_BACK` („History Back“)
    6. *Trenner*
    7. `SELECT_LEFT_PANEL` („Left Panel“), `SELECT_RIGHT_PANEL` („Right Panel“), `TOGGLE_PANEL` („Toggle Panels“)
    8. *Trenner*
    9. `ADD_NEW_TAB` / `CLONE_TAB` („Add Tab“), `CLOSE_TAB` („Remove Tab“)
  - **Spalte 2:**
    1. `OPEN_COPY_DLG` („Copy“), `OPEN_MOVE_DLG` („Move“), `OPEN_DELETE_DLG` („Delete“), `OPEN_MKDIR_DLG` („MkDir“), `OPEN_RENAME_DLG` („Rename…“), `OPEN_ATTRIBUTE_DLG` („File Attributes…“), `OPEN_UNPACK_DLG` („Unpack…“), `OPEN_PACK_DLG` („Pack…“), `OPEN_DOWNLOAD_DLG` („Download…“)
    2. *Trenner*
    3. `OPEN_MULTIRENAME_DLG` („Multi Rename…“), `OPEN_MULTIMKDIR_DLG` („Multi MkDir…“), `OPEN_GROUPFILES_DLG` („Group Files…“), `OPEN_DELETE_EMPTY_FOLDERS_DLG` („Clean Folders…“)
  - **Spalte 3:**
    1. `OPEN_SETUP_DLG` („Setup…“), `OPEN_THEMES_DLG` („Fancy Theme Editor…“), `OPEN_THEME_CONFIG_DLG` („Theme Configuration…“), `OPEN_BUTTON_CONFIG_DLG` („Button Configuration…“), `OPEN_FILETYPE_CONFIG_DLG` („File Type Configuration…“), `OPEN_TOOL_CONFIG_DLG` („Tool Configuration…“), `OPEN_PROMPT_CONFIG_DLG` („Prompt Configuration…“), `OPEN_SHELL_DLG` („Server Shell…“), `OPEN_ABOUT_DLG` („About…“)
    2. *Trenner*
    3. `@tools` (Extrawerkzeuge aus der Tool-Konfiguration: Edit, Local Shell, Reveal in Finder, etc.)
- Bereitstellung menüspezifischer Kurzlabels (z. B. „Parent Dir“ statt „Parent folder“, „MkDir“ statt „Create folder…“, „Clean Folders…“ statt „Delete empty folders“).

#### Detaillierte Funktionsbeschreibung aller Menüpunkte (Code-Referenz aus `old_project`):

##### Spalte 0 (`menuItems0`)
1. **`OPEN_GOTO_ANYTHING_DLG` („Go to anything…“)**
   - *Code:* `old_project/.../file-table.component.ts:597-630`
   - *Ablauf:* Öffnet einen modalen Schnellsuchdialog. Sammelt alle Pfade aus offenen Tabs (`getDirsFromAllTabs`), Pfadhistorien (`getAllHistories`) sowie alle registrierten Action-IDs. Nutzer kann per Typeahead filtern. Bei Pfadauswahl: `cd <pfad>` im aktiven Panel. Bei Aktionsauswahl: Aufruf von `triggerAction(id)`.
   - *In Tauri:* Entspricht `OPEN_COMMAND_PALETTE` (`command-palette.ts`).
2. **`RELOAD_DIR` („Reload…“)**
   - *Code:* `old_project/.../file-table.component.ts:345-348, 487-489`
   - *Ablauf:* Ruft `this.reload()` auf. Invalidiert Dateilisten-Cache und liest das Verzeichnis im aktiven Tab frisch vom Dateisystem ein.
   - *In Tauri:* Löst `RELOAD_DIR` aus.
3. **`OPEN_CHDIR_DLG` („Change Dir…“)**
   - *Code:* `old_project/.../action-execution.service.ts:195-197`
   - *Ablauf:* Öffnet Verzeichnisauswahl-Dialog zur direkten Texteingabe eines Pfades. Nach Bestätigung wechselt das aktive Panel dorthin.
   - *In Tauri:* Entspricht `OPEN_CHDIR_DLG`.
4. **`TOGGLE_FILTER` („Toggle Filter Input“)**
   - *Code:* `old_project/.../action-execution.service.ts:104-108`
   - *Ablauf:* Schaltet `tab.filterActive` für den aktuellen Tab um. Blendet das Filter-Eingabefeld in der Tab-Leiste ein (und fokussiert es) bzw. aus.
   - *In Tauri:* Entspricht `TOGGLE_FILTER`.
5. **`TOGGLE_HIDDEN_FILES` („Toggle Hidden Files“)**
   - *Code:* `old_project/.../action-execution.service.ts:112-116`
   - *Ablauf:* Schaltet `tab.hiddenFilesVisible` für den aktuellen Tab um. Lädt die Tabelle neu, um Dotfiles (`.*`) anzuzeigen bzw. auszublenden.
   - *In Tauri:* Entspricht `TOGGLE_HIDDEN_FILES`.
6. **`TOGGLE_SHELL` („Toggle Shell“)**
   - *Code:* `old_project/.../action-execution.service.ts:109-111`
   - *Ablauf:* Schaltet die integrierte Shell-Eingabezeile oberhalb der Fußleiste sichtbar/unsichtbar (`shellLocalStorage.toggleShellVisible()`).
   - *In Tauri:* Entspricht `TOGGLE_SHELL`.
7. **`COPY_2_CLIPBOARD_NAMES` („Copy names to clipboard“)**
   - *Code:* `old_project/.../action-execution.service.ts:133-136`
   - *Ablauf:* Schreibt die reinen Dateinamen aller selektierten (bzw. der fokussierten) Zeilen getrennt mit `\n` in die Zwischenablage.
   - *In Tauri:* Entspricht `COPY_2_CLIPBOARD_NAMES`.
8. **`COPY_2_CLIPBOARD_FULLNAMES` („Copy full names to clipboard“)**
   - *Code:* `old_project/.../action-execution.service.ts:129-132`
   - *Ablauf:* Schreibt die absoluten Pfade aller selektierten/fokussierten Zeilen zeilenweise in die Zwischenablage.
   - *In Tauri:* Entspricht `COPY_2_CLIPBOARD_FULLNAMES`.
9. **`COPY_2_CLIPBOARD_NAMES_AS_JSON` („Copy names to clipboard as JSON“)**
   - *Code:* `old_project/.../action-execution.service.ts:141-144`
   - *Ablauf:* Kopiert ein JSON-Array der Dateinamen (`["a.txt", "b.jpg"]`) in die Zwischenablage.
   - *In Tauri:* Entspricht `COPY_2_CLIPBOARD_NAMES_AS_JSON`.
10. **`COPY_2_CLIPBOARD_FULLNAMES_AS_JSON` („Copy full names to clipboard as JSON“)**
    - *Code:* `old_project/.../action-execution.service.ts:137-140`
    - *Ablauf:* Kopiert ein JSON-Array der vollständigen absoluten Pfade (`["/path/a.txt", ...]`) in die Zwischenablage.
    - *In Tauri:* Entspricht `COPY_2_CLIPBOARD_FULLNAMES_AS_JSON`.

##### Spalte 1 (`menuItems1`)
1. **`OPEN_FIND_DLG` („Find…“)**
   - *Code:* `old_project/.../action-execution.service.ts:198-200, 290-320`
   - *Ablauf:* Öffnet den Suchdialog (Suchmuster, Glob `**/*.*`, Textinhalt, Regex). Ergebnisse werden in einem neuen Tab im aktiven Panel dargestellt.
   - *In Tauri:* Entspricht `OPEN_FIND_DLG`.
2. **`ENHANCE_SELECTION` („Enhance Selection“)**
   - *Code:* `old_project/.../file-table.component.ts:507-509`
   - *Ablauf:* Öffnet den Auswahldialog im Add-Modus. Über ein Suchmuster (Glob/Regex) werden passende Zeilen zur Selektion hinzugefügt.
   - *In Tauri:* Entspricht `OPEN_MARK_PATTERN_DLG`.
3. **`REDUCE_SELECTION` („Reduce Selection“)**
   - *Code:* `old_project/.../file-table.component.ts:510-512`
   - *Ablauf:* Öffnet den Auswahldialog im Subtraktions-Modus, um passende Zeilen aus der Selektion abzuwählen.
   - *In Tauri:* Entspricht `OPEN_UNMARK_PATTERN_DLG`.
4. **`TOGGLE_SELECTION` („Toggle Selection“)**
   - *Code:* `old_project/.../file-table.component.ts:498-501`
   - *Ablauf:* Invertiert die Auswahl aller Zeilen im Panel (`selectionManager.toggleSelection()`).
   - *In Tauri:* Entspricht `INVERT_MARKS`.
5. **`SELECT_ALL` („Select All“)**
   - *Code:* `old_project/.../file-table.component.ts:490-493`
   - *Ablauf:* Selektiert alle Zeilen im aktuellen Tab.
   - *In Tauri:* Entspricht `SELECT_ALL`.
6. **`DESELECT_ALL` („Deselect All“)**
   - *Code:* `old_project/.../file-table.component.ts:494-497`
   - *Ablauf:* Hebt die Selektion aller Zeilen im Tab auf.
   - *In Tauri:* Entspricht `DESELECT_ALL`.
7. **`NAVIGATE_LEVEL_DOWN` („Parent Dir“)**
   - *Code:* `old_project/.../file-table.component.ts:575-581`
   - *Ablauf:* Wechselt in das übergeordnete Verzeichnis (wie `..`).
   - *In Tauri:* Entspricht `NAVIGATE_PARENT`.
8. **`NAVIGATE_BACK` („History Back“)**
   - *Code:* `old_project/.../file-table.component.ts:632-633`
   - *Ablauf:* Navigiert im Verlaufs-Stack des aktuellen Tabs einen Schritt zurück.
   - *In Tauri:* Entspricht `NAVIGATE_BACK`.
9. **`SELECT_LEFT_PANEL` („Left Panel“)**
   - *Code:* `old_project/.../action-execution.service.ts:123-125`
   - *Ablauf:* Aktiviert das linke Panel (Index 0).
   - *In Tauri:* Entspricht `SELECT_LEFT_PANEL`.
10. **`SELECT_RIGHT_PANEL` („Right Panel“)**
    - *Code:* `old_project/.../action-execution.service.ts:126-128`
    - *Ablauf:* Aktiviert das rechte Panel (Index 1).
    - *In Tauri:* Entspricht `SELECT_RIGHT_PANEL`.
11. **`TOGGLE_PANEL` („Toggle Panels“)**
    - *Code:* `old_project/.../action-execution.service.ts:97-99`
    - *Ablauf:* Wechselt den Fokus zwischen linkem und rechtem Panel.
    - *In Tauri:* Entspricht `TOGGLE_PANEL`.
12. **`ADD_NEW_TAB` („Add Tab“)**
    - *Code:* `old_project/.../action-execution.service.ts:120-122`
    - *Ablauf:* Erstellt einen neuen Tab im aktiven Panel mit demselben Pfad.
    - *In Tauri:* Entspricht `CLONE_TAB` / `OPEN_IN_NEW_TAB`.
13. **`REMOVE_TAB` („Remove Tab“)**
    - *Code:* `old_project/.../action-execution.service.ts:117-119`
    - *Ablauf:* Schließt den aktiven Tab (wenn mehr als 1 Tab offen ist).
    - *In Tauri:* Entspricht `CLOSE_TAB`.

##### Spalte 2 (`menuItems2`)
1. **`OPEN_COPY_DLG` („Copy“)**
   - *Code:* `old_project/.../action-execution.service.ts:216-218`
   - *Ablauf:* Öffnet den Kopierdialog (Quelle: markierte Zeilen, Ziel: Pfad des inaktiven Panels).
   - *In Tauri:* Entspricht `OPEN_COPY_DLG`.
2. **`OPEN_MOVE_DLG` („Move“)**
   - *Code:* `old_project/.../action-execution.service.ts:219-221`
   - *Ablauf:* Öffnet den Verschiebedialog mit Ziel im inaktiven Panel.
   - *In Tauri:* Entspricht `OPEN_MOVE_DLG`.
3. **`OPEN_DELETE_DLG` („Delete“)**
   - *Code:* `old_project/.../action-execution.service.ts:204-206`
   - *Ablauf:* Öffnet den Löschdialog für selektierte Dateien.
   - *In Tauri:* Entspricht `OPEN_DELETE_DLG`.
4. **`OPEN_MKDIR_DLG` („MkDir“)**
   - *Code:* `old_project/.../file-table.component.ts:582-584`
   - *Ablauf:* Öffnet Dialog zum Anlegen eines neuen Ordners.
   - *In Tauri:* Entspricht `OPEN_MKDIR_DLG`.
5. **`OPEN_RENAME_DLG` („Rename…“)**
   - *Code:* `old_project/.../action-execution.service.ts:180-182`
   - *Ablauf:* Öffnet Dialog zum Umbenennen des fokussierten Elements.
   - *In Tauri:* Entspricht `OPEN_RENAME_DLG`.
6. **`OPEN_ATTRIBUTE_DLG` („File Attributes…“)**
   - *Code:* `old_project/.../action-execution.service.ts:183-185`
   - *Ablauf:* Öffnet Eigenschaften- und Attributdialog (Berechtigungen `chmod`, Zeitstempel, Größe).
   - *In Tauri:* Entspricht `OPEN_ATTRIBUTE_DLG`.
7. **`OPEN_UNPACK_DLG` („Unpack…“)**
   - *Code:* `old_project/.../file-table.component.ts:585-587`
   - *Ablauf:* Öffnet Archiv-Entpackdialog für ZIP/TAR mit Zielordner im gegenüberliegenden Panel.
   - *In Tauri:* Entspricht `OPEN_UNPACK_DLG`.
8. **`OPEN_PACK_DLG` („Pack…“)**
   - *Code:* `old_project/.../file-table.component.ts:588-590`
   - *Ablauf:* Öffnet Komprimierungsdialog zum Packen markierter Dateien in ein neues Archiv.
   - *In Tauri:* Entspricht `OPEN_PACK_DLG`.
9. **`OPEN_DOWNLOAD_DLG` („Download…“)**
   - *Code:* `old_project/.../file-table.component.ts:591-593`
   - *Ablauf:* Startet den Datei-Download / Transfer.
   - *In Tauri:* Entspricht `OPEN_DOWNLOAD_DLG`.
10. **`OPEN_MULTIRENAME_DLG` („Multi Rename…“)**
    - *Code:* `old_project/.../action-execution.service.ts:186-188`
    - *Ablauf:* Öffnet den Multi-Rename-Dialog mit Zählern, Regex, Vorlagen und Live-Vorschau.
    - *In Tauri:* Entspricht `OPEN_MULTIRENAME_DLG`.
11. **`OPEN_MULTIMKDIR_DLG` („Multi MkDir…“)**
    - *Code:* `old_project/.../action-execution.service.ts:189-191`
    - *Ablauf:* Öffnet Massenerstellung von Verzeichnissen nach Zähler-Schema.
    - *In Tauri:* Entspricht `OPEN_MULTIMKDIR_DLG`.
12. **`OPEN_GROUPFILES_DLG` („Group Files…“)**
    - *Code:* `old_project/.../action-execution.service.ts:192-194`
    - *Ablauf:* Öffnet Werkzeug zum Gruppieren von Dateien in Unterordner (z. B. nach erstem Wort/Buchstabe/Nummer).
    - *In Tauri:* Entspricht `OPEN_GROUPFILES_DLG`.
13. **`OPEN_DELETE_EMPTY_FOLDERS_DLG` („Clean Folders…“)**
    - *Code:* `old_project/.../action-execution.service.ts:201-203`
    - *Ablauf:* Sucht und löscht rekursiv leere Ordner und Mülldateien (`.DS_Store` etc.).
    - *In Tauri:* Entspricht `OPEN_DELETE_EMPTY_FOLDERS_DLG`.

##### Spalte 3 (`menuItems3` & Tools)
1. **`OPEN_SETUP_DLG` („Setup…“)**
   - *Code:* `old_project/.../action-execution.service.ts:148-150`
   - *Ablauf:* Navigiert zu `/setup` für globale Konfigurationen.
   - *In Tauri:* Entspricht `OPEN_SETUP_DLG`.
2. **`OPEN_THEMES_DLG` („Fancy Theme Editor…“)**
   - *Code:* `old_project/.../action-execution.service.ts:151-156`
   - *Ablauf:* Öffnet den visuellen Theme-Editor (`/themes`).
   - *In Tauri:* Entspricht `OPEN_THEMES_DLG`.
3. **`OPEN_THEME_CONFIG_DLG` („Theme Configuration…“)**
   - *Code:* `old_project/.../action-execution.service.ts:173-176`
   - *Ablauf:* Dialog zur Theme-Verwaltung und Farbschema-Auswahl.
   - *In Tauri:* Entspricht `OPEN_THEMES_DLG`.
4. **`OPEN_BUTTON_CONFIG_DLG` („Button Configuration…“)**
   - *Code:* `old_project/.../action-execution.service.ts:157-160`
   - *Ablauf:* Konfiguration der Buttons der unteren Fußleiste (Default, Shift, Cmd, Alt).
   - *In Tauri:* Entspricht `OPEN_BUTTON_CONFIG_DLG`.
5. **`OPEN_FILETYPE_CONFIG_DLG` („File Type Configuration…“)**
   - *Code:* `old_project/.../action-execution.service.ts:161-164`
   - *Ablauf:* Dateiendungs-Zuordnung zu Programmen und Icons.
   - *In Tauri:* Entspricht `OPEN_FILETYPE_CONFIG_DLG`.
6. **`OPEN_TOOL_CONFIG_DLG` („Tool Configuration…“)**
   - *Code:* `old_project/.../action-execution.service.ts:165-168`
   - *Ablauf:* Konfigurationsdialog für benutzerdefinierte externe Tools.
   - *In Tauri:* Entspricht `OPEN_TOOL_CONFIG_DLG`.
7. **`OPEN_PROMPT_CONFIG_DLG` („Prompt Configuration…“)**
   - *Code:* `old_project/.../action-execution.service.ts:169-172`
   - *Ablauf:* Verwaltung konfigurierter Prompt-Vorlagen.
   - *In Tauri:* Entspricht `OPEN_PROMPT_CONFIG_DLG`.
8. **`OPEN_SHELL_DLG` („Server Shell…“)**
   - *Code:* `old_project/.../action-execution.service.ts:177-179`
   - *Ablauf:* Öffnet die Vollbild-Shell (`/shell`).
   - *In Tauri:* Entspricht `OPEN_TERMINAL_HERE` / `OPEN_SHELL_DLG`.
9. **`OPEN_ABOUT_DLG` („About…“)**
   - *Code:* `old_project/.../action-execution.service.ts:145-147`
   - *Ablauf:* Öffnet die Info- und Versionsseite (`/about`).
   - *In Tauri:* Entspricht `OPEN_ABOUT_DLG`.
10. **`@tools` (Dynamische Tool-Einträge)**
    - *Code:* `old_project/.../buttonpanel.component.html:108-140` & `action-execution.service.ts:223-228, 269-274`
    - *Ablauf:* Führt das jeweilige Werkzeug aus `tools.json` mit Pfad und markierten Dateien aus:
      - **Edit** (`^ ⇧ 4`): Öffnet Datei im Standard-Editor.
      - **Local Shell** (`⌘ 0`): Öffnet Terminal im aktuellen Verzeichnis.
      - **Reveal in Finder** (`⌘ ⇧ f`): Zeigt Datei im System-Dateimanager.

### 2. Shortcut-Badge Komponente (`shortcut-badge.ts` oder Formatierungslogik)
- Nachbildung des mr-Shortcut-Badges (`<b class="fnf-shortcut">`):
  - Tokenizer: `ctrl` → `^`, `shift` → `⇧`, `cmd` → `⌘`, `alt` → `alt` (wörtlich, wie in mr!), `+` als gedimmter Separator (50 % Opazität).
  - Tasten klein geschrieben oder standardisiert (`f5`, `tab`, `down`, `space`, etc.).
  - Akkorde (wie `^k ^c` oder `^ ⇧ 4`) als eigenständige nebeneinanderliegende Badge-Boxen darstellen.
  - Styling: Hintergrund `var(--color-shortcut-bg)` (dunkles Anthrazit `#383838` / `#444`), Schrift `var(--color-shortcut-text)` (`#eee`), `border-radius: 3px` bis `4px`, `padding: 1px 4px`, Monospace-/System-Font `font-size: 11px`.

### 3. Template & Styling des Menüs (`actions-menu.ts`, `actions-menu.css`)
- Entfernung der `<div class="heading">` Spaltentitel.
- Rendern von horizontalen Trennlinien `<div class="divider" role="separator"></div>` zwischen Gruppen.
- 4-Spalten-CSS-Grid mit festen Mindestbreiten (z. B. `grid-template-columns: 350px 350px 330px 380px` oder responsiv `repeat(4, minmax(280px, max-content))`).
- Optimierte Zeilenhöhe (`padding: 3px 8px` bis `4px 10px`), klare Trennung zwischen Label (links) und Shortcut-Badge (rechts).
- Dezentes Hover-/Fokus-Styling entsprechend den Theme-Tokens (kein aggressiver blauer Balken, der das Badge unleserlich macht; Badges behalten ihren Kontrast).

### 4. Tastaturnavigation & ARIA
- Beibehaltung der vollen APG-Menüsteuerung:
  - `↑` / `↓` navigieren innerhalb der aktuellen Spalte (überspringen Trennlinien).
  - `←` / `→` wechseln zur Nachbarspalte.
  - `Home` / `End` springen an den Anfang/Ende der aktuellen Spalte.
  - `Enter` / `Leertaste` führt die fokussierte Aktion aus und schließt das Menü.
  - `Esc` / Klick außerhalb schließt das Menü und gibt den Fokus an den „Actions“-Button zurück.

### 5. Tests
- Unit-Tests für den Shortcut-Badge-Tokenizer (inkl. Mac-Modifikatoren, Akkorden, Sonderzeichen).
- Komponententests für `ActionsMenu`:
  - 4 Spalten ohne Spaltenüberschriften.
  - Trennlinien an den definierten Positionen vorhanden und von Pfeiltasten übersprungen.
  - Aktionen und Tools werden korrekt aufgelöst und ausgelöst.
  - Barrierefreiheit (Rollen `menu`, `menuitem`, `separator`).

---

## Akzeptanzkriterien

- [ ] Das Actions-Menü hat keine Spaltenüberschriften mehr.
- [ ] Die 4 Spalten stimmen inhaltlich und in ihrer Gliederung mit dem Soll-Zustand überein.
- [ ] Zwischen den Gruppen befinden sich dezente horizontale Trennlinien.
- [ ] Tastenkürzel werden als dunkle Shortcut-Badges mit Tokens (`^`, `alt`, `⌘`, `⇧`) gerendert; Akkord-Kürzel erscheinen als getrennte Badges.
- [ ] Tastaturnavigation (`↑`, `↓`, `←`, `→`, `Enter`, `Esc`) funktioniert nahtlos und überspringt Trennlinien.
- [ ] `pnpm check` und `pnpm test` sind grün.
