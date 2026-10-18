# Prompt 020: Actions-Menü nach Vorbild der alten Version (mr §1.8)

> **Slug:** `actions-menue` · **Braucht:** 002, 004, 014 · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`.
> Altes Verhalten: `docs/legacy-analysis-mr.md` §1.8 (Actions ▲, 4 Spalten, Shortcut-Badges) und §1.10 (Shortcut Badge Tokenizer), Screenshot Soll-Zustand. Quellcode-Referenz: `files-and-folders-mr/apps`.

## Ziel

Das **Actions-Menü ▴** in der unteren Button-Leiste soll visuell, strukturell und inhaltlich dem Soll-Zustand der Vorgängerversion (`files-and-folders-mr`) entsprechen. 

Aktuell zeigt das Menü vier nach Kategorien gefilterte Listen mit Spaltenüberschriften, unstrukturiert ohne Trennlinien und mit schlichtem Text für Kürzel. Der Soll-Zustand zeichnet sich durch vier präzise gegliederte Spalten mit dezenten horizontalen Trennlinien, den Verzicht auf Spaltenüberschriften sowie hochwertige, dunkle **Shortcut-Badges** mit Akkord-Unterstützung und originalgetreuen Tokens (`^`, `⌘`, `alt`, `⇧`, `+`) aus.

Vorgängerversion: siehe prompts/020-soll.png, der alte Code: im Folder 'old_project'
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
