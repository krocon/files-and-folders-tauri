# Design 004: Fensteraufbau – zwei Seiten, Tabs, Header, Statuszeile, Button-Leiste

> **Status:** 🟡 umgesetzt **ohne ausdrückliche Freigabe** – Marc war 2–3 h abwesend und hatte gesagt „arbeite, soweit
> du kannst“. Alle Entscheidungen unten folgen der jeweiligen Empfehlung; sie sind auf dem Branch leicht änderbar.
> Bitte die Entscheidungsfragen (E1–E4) nachträglich bestätigen oder korrigieren.
> **Datum:** 2026-10-17 · **Branch:** `feat/dual-pane-tabs`
> **Grundlage:** `docs/ui-layout.md`, mr §1/§4, legacy §5, Design 001 (E4), GuiExpert Table 1.1.99 (State-API
> `getState/applyState`, `onStateChanged`).

---

## 1. Bestand

| Baustein | wofür | Bewertung |
|---|---|---|
| `FileBrowserStore` (je Panel) | Listing, Cursor, Markierung | **passt**; bekommt `load(path, { cursor })` schon – für den Tab-Wechsel genügt das |
| `FileBrowser` (Toolbar, Pfad, Fehler, Statuszeile) | ein Panel | **wird ersetzt** durch `FilePanel` (Header, Tabs, Liste, Status); Up/Refresh-Buttons entfallen (Backspace, Tab-Doppelklick/Kontextmenü „Neu laden“; „..“ kommt in 003) |
| `FileList` + `FileListController` + `TableBridge` | Table je Panel | **muss erweitert werden**: Tabellenzustand je Tab sichern/anwenden (`getState/applyState`), `onStateChanged` melden, Strg/⌘+Enter = Ordner im neuen Tab |
| `DirectoryListing.segments` | Breadcrumb | **passt** (Rust rechnet die Segmente) |
| GuiExpert `getState(['columns','sort','scroll'])` / `applyState` | Tab-Zustand | **passt**; Spalten per Property, Scroll in px |
| GuiExpert `onStateChanged` | Spaltenbreite/Sortierung/Scroll geändert → speichern | **passt** |
| Mittelklick auf eine Zeile | Ordner im neuen Tab | **fehlt**: `onMouseClicked` kommt nur für die linke Taste → `auxclick` am Host + Zeile über `pointer`-Position ist ohne Table-API nicht sauber → **G15** (s. §6), bis dahin nur Strg/⌘+Enter |
| Rust | Sitzungszustand, Fenstergeometrie | **fehlt** → neues Modul `session.rs` + `window_state.rs` |

## 2. Entscheidungen

### E1 – Cursor im inaktiven Panel: **gedämpft** ✅ Empfehlung

Der Cursor bleibt im inaktiven Panel sichtbar, aber mit `--color-cursor-inactive-bg` (wie heute). Grund: Beim
Kopieren sieht man, worauf das Ziel-Panel steht; mr/TC zeigen das ebenso. Die alte Variante (ausblenden) ist eine
Zeile CSS, falls gewünscht (Design 019 kann sie je Theme wählen).

### E2 – **Eine Table je Panel**, Zustand je Tab gesichert ✅ Empfehlung

Beim Tab-Wechsel: aktuellen Tab sichern (`cursor`, `getState(['columns','sort','scroll'])`), dann neuen Pfad laden,
`setRows`, `applyState(columns, sort)` + `reSort`, Cursor per Pfad, zuletzt `applyState(scroll)`.

| | eine Table je Panel | eine Table je Tab |
|---|---|---|
| Speicher/DOM | 2 Tables | n Tables (je 100 000 Zeilen im Speicher) |
| Tab-Wechsel | neu laden (aktuell, mit Cache später) | sofort, aber Inhalt veraltet |
| Komplexität | State-API (vorhanden) | n Stores, n Shortcut-Listener, versteckte Tables (Layout 0 px → Resize-Probleme) |

Der Tab-Wechsel lädt den Ordner neu – das ist ohnehin richtig (Inhalt kann sich geändert haben; Überwachung erst
012).

### E3 – Sitzungszustand als **eigene JSON-Datei, geschrieben von Rust** ✅ Empfehlung

`<app_config_dir>/session.json`, Schema mit `version: 1`, atomar (temp-Datei im selben Ordner + `rename`).
Kein `tauri-plugin-store` (zusätzliche Abhängigkeit mit generischem Schlüssel/Wert-Zugriff aus dem Frontend, keine
Validierung). Kein `tauri-plugin-window-state` (eigene Datei, eigene Berechtigungen): Die Fenstergeometrie schreibt
Rust selbst in dieselbe Datei – beim Speichern und beim Schließen – und stellt sie im `setup` wieder her, bevor das
Fenster sichtbar wird (`visible: false` in `tauri.conf.json`, danach `show()`). Damit braucht das Frontend **keine**
zusätzlichen Fenster-Berechtigungen. Position wird nur übernommen, wenn sie auf einem vorhandenen Monitor liegt.

Kaputte Datei → Defaults + Warnung; die kaputte Datei wird als `session.json.bad` aufgehoben (nicht stillschweigend
überschrieben). Unbekannte Felder werden ignoriert, fehlende bekommen Defaults, Werte werden begrenzt (s. §3).

Neue Abhängigkeit: `serde_json` wird von dev- zur normalen Abhängigkeit (Parsen/Schreiben der Datei; ohnehin über
Tauri im Baum).

### E4 – Tastenkürzel für Tabs/Seiten (Abstimmung mit 002) ✅ Empfehlung

| Taste | Wirkung | Bemerkung |
|---|---|---|
| `Tab` (in der Liste) | andere Seite aktivieren | wie alt/mr/TC |
| `Shift+Tab` (in der Liste) | normaler Fokuswechsel rückwärts (zur Tab-Leiste) | **Abweichung**: alt = nächster Tab. So bleiben Tab-Leiste und Header per Tastatur erreichbar (Barrierefreiheit) |
| `Strg+Tab` / `Strg+Shift+Tab` | nächster / vorheriger Tab | in Tauri gibt es keinen Browser-Tab-Konflikt; auf macOS ebenfalls `Strg` (⌘+Tab gehört dem System) |
| `Strg/⌘+T` | Tab klonen (`+`) | mr: `cmd+alt+t` – in 002 als zweites Kürzel |
| `Strg/⌘+W` | Tab schließen (`−`) | mr: `cmd+alt+w`; schließt nie das Fenster |
| `Strg/⌘+Enter` | Ordner unter dem Cursor im neuen Tab | Prompt 004 §4 |
| in der Tab-Leiste | `←/→`, `Pos1/Ende` wechseln den Tab (APG, automatische Aktivierung), `Entf` schließt, `Shift+F10`/Kontextmenütaste öffnet das Kontextmenü | |

Bis 002 als kleine Handler am Panel; 002 übernimmt sie ins Aktionsregister.

## 3. Verträge

### Rust-Commands

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `load_session` | – | `LoadedSession { session: Session, warning: string \| null, adjusted: { from, to }[] }` | nie (Fehler → Defaults + `warning`) |
| `save_session` | `session: Session` | `()` | `FsError` `io` (Schreiben fehlgeschlagen) |

`load_session` prüft jeden Tab-Pfad: existiert er nicht (mehr) als Ordner, wird der **nächste existierende
Elternordner** eingesetzt (lexikalisch nach oben, ohne `canonicalize`), sonst das Home-Verzeichnis; jede Änderung
steht in `adjusted`. `Session.window` wird vom Frontend nicht gesendet/gelesen (Rust ergänzt die aktuelle Geometrie
selbst).

### Schema (`session.json`, Rust `session.rs` ↔ TS `core/session/session.models.ts`)

```ts
interface Session {
  version: 1;
  activeSide: 'left' | 'right';
  splitter: number;               // Anteil der linken Seite, 0.15 … 0.85 (begrenzt)
  favorites: string[];            // max. 200, ohne Dubletten
  panels: { left: PanelSession; right: PanelSession };
  window?: WindowGeometry;        // nur Rust: { x, y, width, height, maximized }
}
interface PanelSession { activeTab: number; tabs: TabSession[] }   // 1 … 50 Tabs
interface TabSession {
  id: string;                     // stabil innerhalb der Sitzung
  path: string | null;            // null = Home
  history: string[];              // max. 15, neueste zuerst (für 003)
  cursor: string | null;          // Pfad des Eintrags unter dem Cursor
  hiddenVisible: boolean;         // für 003
  filterActive: boolean;          // für 003
  filterText: string;             // für 003
  table: unknown | null;          // GuiExpert TableStateIf (columns, sort, scroll) – opak für Rust, max. 64 KB
}
```

Begrenzung in Rust (`sanitize`): fehlende Panels/Tabs → ein Home-Tab, `activeTab` in Bereich, Splitter begrenzt,
Listen gekürzt, `version ≠ 1` → Defaults + Warnung.

### TS-Fassade

`SessionApi` (abstrakt) mit `load(): Promise<LoadedSession>` und `save(s: Session): Promise<void>`; `TauriSessionApi`
ist neben `TauriFsApi` die einzige `invoke`-Stelle dafür; `FakeSessionApi` in `src/testing/`.

## 4. Frontend-Aufbau

```
features/workspace/
  workspace.ts / .html / .scss  CSS-Grid (Zeilen header · tabs · list · status · buttons), Splitter, Live-Region
  workspace.store.ts            Root: Seiten, Tabs beider Seiten, activeSide, source()/target(), Splitter, Favoriten,
                                Serialisieren/Speichern (entprellt 400 ms)
  splitter.ts                   reine Logik (Pfeiltasten ±2 %, Pos1/Ende, Begrenzung) + Direktive
  file-panel.ts / .html         eine Seite (display: contents → ihre vier Teile liegen in den Grid-Zeilen);
                                providers: [FileBrowserStore]; Tab-Wechsel sichert/lädt Zustand
  path-header.ts                Breadcrumb + Favoriten-Stern
  tab-bar.ts                    role=tablist, + / −, Kontextmenü
  context-menu.ts               kleines Menü nach APG (role=menu, Pfeile, Esc, Fokus-Rückgabe)
  status-line.ts + status.ts    Zielformat (reine Funktion `summarize`)
  button-bar/                   button-bar.ts + buttons.json (Sätze default/shift/cmd/alt wie mr) + labels
core/session/                   session.models.ts, session-api.ts
```

Skizze (Fokus-Reihenfolge je Seite: Breadcrumb-Segmente → Stern → Tab-Leiste (ein Tab-Stopp) → `+` → `−` → Liste;
danach rechte Seite, dann Button-Leiste):

```
 nav[aria-label="Pfad links"]: / Users / marc ☆   ║ / Volumes ☆
 div[role=tablist aria-label="Tabs links"]: [marc][Downloads] + − ║ [Volumes] + −
 guiexpert-table (aria-labelledby = Pfad)          ║ …
 output.status: 1.2 MB / 7.7 MB in 1 / 12 Files, 0 / 4 Folders ║ …
 [F4 Edit][F5 Copy][F6 Move][F7 MkDir][F8 Delete]      [Actions ▴][Tasks][🎨][⌨]
```

Aktive Seite: Klasse `fnf-active-panel` an allen vier Teilen (Tokens `--color-active-panel-accent`,
`--color-active-panel-tab-bg/-text`), Live-Region (`aria-live=polite`) sagt „Linkes Panel, /Users/marc“ beim
Wechsel.

Statuszeile: `formatSize`, nur Dateien zählen in Größen (Ordnergrößen ab 003), Tooltip mit exakten Bytes, markierte
Zahlen im aktiven Panel hervorgehoben.

Button-Leiste: Buttons mit `aria-disabled="true"` (bleiben fokussierbar, Tooltip „kommt in Prompt 006“); die
Modifier-Umschaltung baut 002, das Format (`buttons.json`) steht jetzt.

## 5. Tests

| Ebene | Fälle |
|---|---|
| Rust (`session.rs`) | Rundreise; fehlende Datei → Defaults ohne Warnung; Müll/falsche Version → Defaults + Warnung + `.bad`-Kopie; unbekannte Felder; `sanitize` (leere Tabs, Index, Splitter, Listen); atomares Schreiben (kein Temp-Rest, Zielordner wird angelegt); nächster existierender Elternordner (gelöscht, Umlaute/Leerzeichen, Datei statt Ordner, nichts existiert → Home); Geometrie nur auf vorhandenem Monitor (reine Funktion) |
| Frontend | WorkspaceStore (Tabs anlegen/klonen/schließen/verschieben/klonen ins andere Panel/umsortieren, letzter Tab bleibt, aktive Seite, Quelle/Ziel, Favoriten, Serialisieren ↔ Wiederherstellen, entprelltes Speichern), `summarize` (bekannte Größen, ohne Ordner), Splitter-Logik, Button-Konfiguration (Schema, Sätze), TabBar (Rollen, Tastatur, Kontextmenü), PathHeader (Segmentklick, Stern), FilePanel (Tab-Wechsel sichert Cursor/Table-Zustand über `FakeTableBridge`) |
| Ende-zu-Ende (Xvfb) | Layout-Screenshot, Splitter (Maus, Tastatur, Doppelklick), Tab/Klick wechselt Seite, Tabs (alle Kontextmenü-Einträge), Neustart stellt alles wieder her, gelöschter Pfad, kaputte Datei |

## 6. Neue Lücke der GuiExpert Table

| # | Lücke | Workaround | Vorschlag Core |
|---|---|---|---|
| G15 | `onMouseClicked` nur für die linke Taste; Mittelklick (`auxclick`) liefert keine Zeile | Mittelklick auf Ordnerzeile entfällt vorerst (Strg/⌘+Enter) | `GeMouseEvent` auch für `auxclick` (Button im Event) oder `TableApi.getRowIndexAt(clientX, clientY)` |

## 7. Fortschritt

- [x] Phase 1: Bestand, Entscheidungen, Verträge (dieses Dokument)
- [ ] Freigabe durch Marc (nachträglich)
- [ ] Phase 2: Rust
- [ ] Phase 3: Frontend
- [ ] Phase 4: Ende-zu-Ende
- [ ] Phase 5: Doku
- [ ] Phase 6: Abschluss
