# Design 001: Dateiliste mit der GuiExpert Table

> **Status:** ✅ umgesetzt (Freigabe 2026-10-17: E2 eigenes Set, Sortieren per Doppelklick hinnehmen, Leertaste = TC) · **Datum:** 2026-10-17 · **Branch:** `feat/guiexpert-dateiliste`
> **Pakete:** `@guiexpert/table@1.1.99`, `@guiexpert/angular-table@22.1.99` (npm, Major = Angular 22)
> **Grundlage:** Quellcode-Analyse des Mono-Repos (Stand `ebcf9cd`, Release 1.1.99) **und** ein Spike in der echten
> Tauri-App unter Xvfb (Rust-Daten, zoneless Angular 22, Tastatur/Maus per `xdotool`). Der Spike wurde verworfen,
> seine Ergebnisse stehen unten.

---

## 1. Ergebnisse von Spike und Code-Analyse

| Frage | Ergebnis | Beleg |
|---|---|---|
| Läuft der Wrapper ohne zone.js (zoneless)? | **Ja.** `runOutsideAngular` ist ohne Zone ein No-op; Outputs feuern. | Spike; `table.component.ts:285` |
| Rendern mit echten Daten | Ja, Unicode/Emoji korrekt. Default: zentrierter Text, 34-px-Zeilen, Zellrahmen. | Spike-Screenshot |
| Doppelklick | `mouseClicked` mit `clickCount 2`. Der Wrapper entprellt (150 ms): schneller Doppelklick liefert **nur** `clickCount 2`, einfacher Klick kommt 150 ms verspätet. | Spike; `table.component.ts:256-265`, `mouse-handler.ts:101-158` |
| Welche Tasten verbraucht die Table? | Pfeile, Bild↑/↓, Pos1/Ende, Strg+Pos1/Ende, Leertaste, Strg+A, Strg+X (= `DESELECT_ALL`!). **Bubbeln** zur App: Enter (`ACTIVATE_CELL` liefert bei flachem Body `false`), Backspace, Einfg, Tab, Esc, Buchstaben, Shift+Pfeile. | Spike-Log; `shortcut.service.ts:130-155`, `table-scope.ts:1163-1187` |
| Pos1/Ende | Gehen zur ersten/letzten **Spalte** (`NAVIGATE_ROW_START/END`), nicht Zeile. Über `shortcutActionIdMapping` umbiegbar (Mapping wird je Taste gemischt). | `table-scope.ts:1149-1156`, `shortcut.service.ts:87-100` |
| Fokus | Eine **Zelle** (`FocusModel`, Index in der angezeigten/sortierten Reihenfolge), gezeichnet als Zellrahmen. Kein `api.setFocus`; Zugriff über `api.getTableScope().focusModel()`. Event `focusChanged(FocusModelIf)`. | `focus-model.ts`, `render-scope.ts:2230` |
| Auswahl (`SelectionModel`) | **Index-basiert** (Ranges). Sortieren per API und `setRows` rechnen sie **nicht** um → markiert danach falsche Zeilen. Header-Sortierung leert sie. Nur die State-API kennt Zeilen-Ids. | `selection-model.ts:59-61`, `mouse-handler.ts:207` |
| Zeilen-CSS | Nur je **Zelle** über `AreaModelIf.getCustomClassesAt` (Unterklasse von `AreaModelObjectArrayWithColumndefs`). | `area-model-object-array.ts:831-842` |
| Sortierung | `ColumnDef.sortComparator(a, b, rowA, rowB, f)` mit `f = ±1` → „Ordner oben“ in beiden Richtungen möglich (`f * (aDir ? -1 : 1)`). Spaltenkopf sortiert per **Doppelklick**. `setRows` setzt die Reihenfolge zurück → danach `api.reSort()`. | Spike; `area-model-object-array.ts:875`, `mouse-handler.ts:206-208` |
| `setRows` | Tauscht nur die Zeilen. Fokus-Index, Auswahl-Ranges und Scrollposition bleiben stehen (Fokus kann hinter der letzten Zeile landen), kein Repaint. | `table-api.ts:1320-1331`, Spike |
| Eigene Aktionen | `api.getTableScope().shortcutService.addListener({ onActionTriggered })` – **alle** Listener werden aufgerufen; einer mit `true` verbraucht die Taste. | `shortcut.service.ts:39, 143-153` |
| jsdom | Kein Layout (Zeilenschleife bricht nach einer Zeile ab), `ResizeObserver` Pflicht. Tabellenverhalten nur im echten Fenster sinnvoll testbar. | `render-scope.ts:1385`, `resize-handler.ts:20` |
| Theming | `--ge-table-*` auf `html`, dunkel über `html[data-theme="dark"]` (kein `prefers-color-scheme`). Auswahlfarbe ist ein Overlay ohne Textfarbe. Keine Scrollbar-Variablen. | `css/table-color-vars.css` |

## 2. Entscheidungen

### E1 – Cursor = `FocusModel`, Spalte immer 0 ✅ Empfehlung

Der Total-Commander-Cursor ist der Table-Fokus. `FileBrowserStore.selectedPath` bleibt die Quelle der Wahrheit
(heißt künftig `cursorPath`); ein Adapter synchronisiert in beide Richtungen:

- Table → Store: `focusChanged` → Zeile per Index aus `getFilteredRows()` → `store.setCursor(path)`.
- Store → Table: nach jedem Laden/Sortieren/Filtern `findIndex(path)` → `focusModel.setFocus(row, 0)` +
  `ensureRowIsVisible(row)` + `repaint()`.
- Darstellung als **Zeilen-Cursor**: Klasse `fnf-cursor` auf allen Zellen der Fokuszeile (über
  `getCustomClassesAt`), der Zellrahmen der Table wird per `--ge-table-focus-border` dezent bzw. unsichtbar.
  Links/Rechts (Spaltenwechsel) sind in einer Dateiliste sinnlos → auf horizontales Scrollen bzw. nichts mappen
  (Detail in 002).

### E2 – Markierung = eigenes `Set<path>` im Store, **nicht** `SelectionModel` ✅ Empfehlung

Begründung: Das `SelectionModel` ist index-basiert und überlebt weder Sortieren noch Ordnerwechsel; die Umrechnung
über die State-API (`getState/applyState(['selection'])`) wäre bei jedem Sortieren nötig und bei 100 000 Zeilen
teuer. Ein `Set<string>` mit Pfaden ist sortier- und filterfest und genau das, was Operationen (006) brauchen.

- Table: `getSelectionModel: () => new SelectionModel('none', …)` (bzw. Typ `none`), damit Klicks keine
  Table-Auswahl erzeugen.
- Anzeige: Klasse `fnf-marked` über `getCustomClassesAt` (Farbe aus Tokens, TC-Rot in Prompt 013).
- Tasten: eigener `onActionTriggered`-Listener übernimmt `TOGGLE_SELECTION` (Leertaste/Einfg: umschalten + Cursor
  weiter), `SELECT_ALL`, `DESELECT_ALL`; `ctrl+x`/`meta+x` werden aus der Live-Mapping-Tabelle entfernt
  (`getShortcutActionMapping()`), weil sie später „Ausschneiden“ sein müssen. Maus: Strg/⌘+Klick schaltet um,
  Shift+Klick markiert Bereich ab Cursor (im Adapter über `mouseClicked` + `originalEvent`).
- Markierung wird beim Ordnerwechsel geleert, beim Neu-Laden desselben Ordners auf noch vorhandene Pfade gekürzt.

### E3 – Sortieren in der Table mit eigenen Comparatoren ✅ Empfehlung

- Jede Spalte bekommt einen Comparator mit „Ordner (und Symlinks auf Ordner) zuerst“ unabhängig von der Richtung,
  Name natürlich (`Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`), Größe/Datum numerisch mit
  `null` zuletzt, Erweiterung mit Name als zweitem Schlüssel. (Alt: `localeCompare` ohne Zahlenlogik,
  legacy §4 – bewusst verbessert.)
- Vorteil gegenüber Sortieren im Store: Sortier-Pfeil im Kopf, ARIA-Ansage und spätere Spaltenkonfiguration (015)
  kommen von der Table. Die „..“-Zeile (003) wird vom Comparator immer oben gehalten.
- Nach jedem `setRows`: `reSort()` → `repaintHard()` → Cursor setzen (E1). Sortierzustand je Panel im Store
  (`{ property, direction }`), Default Name aufsteigend.

### E4 – Ein `TableModel` je Panel, Ordnerwechsel nur über `setRows` ✅ Empfehlung

Modell und Optionen werden **einmal** pro `FileList`-Instanz erzeugt (neues Objekt = Neuaufbau). Spaltenbreiten und
Sortierung bleiben damit beim Ordnerwechsel erhalten. Tabs (004) sichern/übernehmen Zustand über
`getState/applyState(['columns', 'sort', 'scroll'])`.

### E5 – Doppelklick und Klick über den Core statt über den Wrapper-Output ✅ Empfehlung

`api.subscribe({ onMouseClicked })` (Core, ohne 150-ms-Entprellung) statt `(mouseClicked)`. Doppelklick =
`clickCount === 2` im Body → öffnen. Klick ins Leere unter der letzten Zeile ändert nichts.

### E6 – Spalten (Default)

| Spalte | Property | Breite | Ausrichtung | Renderer |
|---|---|---|---|---|
| Name | `name` | 320 px, min 120 | Anfang | Icon + Name (Text-Knoten), Symlink-Pfeil, Hidden gedimmt |
| Erw. | berechnet aus `name` (`valueGetter`, nur Dateien) | 70 px | Anfang | Text |
| Größe | `size` | 90 px | Ende | `formatSize`, Ordner `<DIR>` (wie TC/alt) |
| Geändert | `modifiedMs` | 140 px | Anfang | `formatModified` |

Typ-Spalte des MVP entfällt (Information steckt in Icon + Erweiterung); Attribute/Rechte kommen mit 010.
Name zeigt den **vollen** Namen inkl. Endung (Abweichung vom alten Programm, das die Endung abschnitt – heute
unüblich und bei Umbenennen/Typ-Ahead hinderlich).

Renderer ohne Angular (`CellRendererIf`), Text nur über `domService.createText` / `textContent` –
HTML-Injection-Test mit Dateiname `<img src=x onerror=alert(1)>.txt`.

### E7 – Tastatur in 001 (Rest in 002)

| Taste | Wirkung | Weg |
|---|---|---|
| ↑/↓, Bild↑/↓ | Cursor | Table (Default) |
| Pos1/Ende | erste/letzte Zeile | Mapping `home`/`end` → `NAVIGATE_FIRST_CELL`/`NAVIGATE_LAST_CELL` |
| Enter, Doppelklick | Ordner öffnen | bubbelt → Handler am `FileList`-Host |
| Backspace | Elternordner | bubbelt → Handler |
| Leertaste, Einfg | Markieren + Cursor weiter | `TOGGLE_SELECTION`-Listener bzw. Handler (Einfg ist ungemappt) |
| Strg/⌘+A | alles markieren | `SELECT_ALL`-Listener |
| Strg/⌘+Shift+A | Markierung aufheben | `DESELECT_ALL`-Listener |
| Shift+↑/↓ | Markierung erweitern | bubbelt → Handler |

Diese Handler sind bewusst klein und ziehen in Prompt 002 ins Aktionssystem um.

### E8 – Darstellung

- Zeilenhöhe 24 px (Body) / 26 px (Kopf), keine Hover-Spalte, keine vertikalen Rahmen, dezente horizontale Linien.
- `--ge-table-*` werden in `src/styles/ge-table-theme.scss` auf unsere Tokens gemappt (light/dark über
  `prefers-color-scheme`, zusätzlich `html[data-theme]` der Table setzen, damit Overlays/Icons passen).
- Overlay „leerer Ordner“ mit eigenem Text (`overlayOptions.noRowsText`), Laden über den `loading`-Input,
  Verzögerung 150 ms (`loadingDelayInMs`), damit schnelle Ordnerwechsel nicht flackern.
- ARIA: `ariaLabelledBy` → Pfad-Anzeige; nach Ordnerwechsel `api.announce("<Ordner>, 42 Einträge")`.

### E9 – Architektur der Bausteine

```
features/browser/
  file-browser.ts            (bestehend) Toolbar, Fehler, Statuszeile, <app-file-list>
  file-browser.store.ts      (bestehend) + cursorPath, marked: Set, sort, Methoden toggleMark/markAll/…
  file-list/
    file-list.ts             Komponente: <guiexpert-table>, Tastatur-/Maus-Handler, ruft nur Store + Adapter
    file-list-adapter.ts     Brücke Store ↔ TableApi (setRows, reSort, Cursor setzen, Listener) – ohne Angular
    file-table-model.ts      Modell- und Optionsfabrik, FileBodyModel (getCustomClassesAt: cursor/marked/hidden)
    file-columns.ts          ColumnDefs + Comparatoren (rein, unit-getestet)
    file-renderers.ts        Name/Größe/Datum-Renderer (rein DOM)
styles/ge-table-theme.scss   Token-Brücke
```

Die alte `file-table/` wird entfernt, sobald die Tests umgestellt sind.

### E10 – Tests

- **Vitest (Node/jsdom):** Comparatoren (natürlich, Ordner oben in beiden Richtungen, `null` zuletzt, Symlink auf
  Ordner), Renderer (Text statt HTML, Injection), Store (Markieren, Bereich, Invertieren, Cursor nach Laden/Up,
  Markierung beim Ordnerwechsel), **Adapter gegen eine Fake-`TableApi`** (Aufrufreihenfolge `setRows → reSort →
  repaintHard → setFocus`, Cursor per Pfad nach Sortierung). `FileBrowser`-Komponententests ersetzen die Table durch
  einen Test-Doppelgänger (`TestBed.overrideComponent`), weil jsdom kein Layout hat.
- **Ende-zu-Ende (Xvfb, wie im Spike):** Tastatur-Tabelle E7, Doppelklick, Sortieren per Kopf, Markieren übersteht
  Umsortieren, Spaltenbreite bleibt beim Ordnerwechsel, 100 000 Einträge (Messung).
- **Performance-Messung:** `scripts/make-big-dir.mjs` erzeugt einen Ordner mit 100 000 leeren Dateien; gemessen
  werden Rust (`list_directory`), IPC und erstes Rendern (Performance-API, Ausgabe im Debug-Log).

## 3. Lücken der GuiExpert Table (Vorschläge für `mono/TODO.md`)

Werden in 001 **umgangen, wo es ohne Core-Eingriff sauber geht**, und als Vorschlag gemeldet:

| # | Lücke | Workaround in 001 | Vorschlag Core |
|---|---|---|---|
| G1 | Kein öffentliches `setFocus` | `getTableScope().focusModel().setFocus` | `TableApi.setFocusedCell(row, col, { scroll })` |
| G2 | Fokus nur als Zellrahmen | Zeilenklasse über `getCustomClassesAt` | Option `focusStyle: "cell" \| "row"` |
| G3 | Sortieren nur per Doppelklick auf den Kopf | Doppelklick akzeptieren (Hinweis-Tooltip) | Option `sortOnHeaderClick: "single" \| "double"` |
| G4 | `setRows` sortiert nicht neu, Fokus kann ins Leere zeigen | `reSort()` + Fokus selbst setzen | `setRows(rows, { keepSort: true, focus: "clamp" })` |
| G5 | Default-Tasten nicht per Option abwählbar (Strg+X = Deselect) | Live-Mapping-Objekt ändern | `shortcutActionIdMapping`-Wert `null` = entfernen |
| G6 | Auswahl index-basiert, nicht sortierfest | eigenes `Set<path>` | Auswahl über `getRowId` (optional) |
| G7 | Nur Zell-, keine Zeilenklassen | Klasse auf jeder Zelle | `getRowClassesAt(rowIndex)` |
| G8 | Wrapper entprellt Klicks (150 ms), `clickCount 1` geht bei Doppelklick verloren | `api.subscribe` | Doku-Hinweis oder Default 0 bei `clickCount` |
| G9 | `rxjs` fehlt in den Peer-Dependencies des Angular-Wrappers | – (Angular bringt rxjs mit) | Peer-Dep ergänzen |
| G10 | Keine Scrollbar-Variablen, kein `prefers-color-scheme` | eigene Regeln | `--ge-table-scrollbar-*`, optional Auto-Dark |
| G11 | `ResizeObserver` Pflicht (jsdom) | Test-Doppelgänger | Guard `typeof ResizeObserver` |
| G12 | `console.debug` je Taste auf `localhost` (betrifft Tauri-Dev) | hinnehmen | an `setLoggingActive` koppeln |
| G13 | `AreaModelObjectArray.getCustomClassesAt` wirft für Zeilen außerhalb des Bereichs (`row.selected` von `undefined`) | Guard in `FileBodyModel` | Guard im Core + Test |
| G14 | Header-Sortierung (Doppelklick) ruft `stopPropagation()`, kein Ereignis „Sortierung geändert“ | Capture-Listener + `setTimeout` → Cursor per Pfad wiederherstellen | Event `onSortChanged(GeSortEvent)` |

## 4. Offene Fragen an Marc

1. **E2:** Einverstanden, Markierungen **nicht** über das `SelectionModel` der Table zu führen (eigenes Set)?
2. **G3:** Sortieren per Doppelklick in 001 hinnehmen und die Option `sortOnHeaderClick` im Mono-Repo nachziehen –
   oder soll ich das Core-Feature (klein) zuerst im Mono-Repo nach dessen Regeln umsetzen?
3. **Leertaste:** in 001 TC-Verhalten (markieren + weiter) – die Ordnergröße per Leertaste (altes Programm) kommt
   dann in 003 auf eine andere Taste bzw. als „markieren + Größe berechnen“ bei Ordnern. Passt das?

## 5. Fortschritt

- [x] Phase 1: Bestand, Spike, Design (dieses Dokument)
- [x] Freigabe (2026-10-17, alle drei Empfehlungen)
- [x] Phase 3: Frontend – 58 Vitest-Tests (Comparatoren, Renderer inkl. HTML-Injection, Body-Modell, Store,
  Controller gegen `FakeTableBridge`, FileBrowser mit Platzhalter für die Table); Phase 2 entfällt bis auf den
  manuellen Rust-Messtest (`listing.rs`, `#[ignore]`)
- [x] Phase 4: Ende-zu-Ende unter Xvfb (Debug- und Release-Build): Tastatur-Tabelle E7, Doppelklick, Sortieren per
  Kopf mit Cursor- und Markierungserhalt, Spaltenbreite über Ordnerwechsel, gesperrter Ordner, 100 000 Einträge
- [x] Phase 5: Doku (`docs/architecture.md` inkl. Performance, README Tastatur, `docs/feature-parity.md`, `CLAUDE.md` §5)
- [x] Phase 6: `pnpm check`, Release-Build

### Befunde während der Umsetzung

- **Sortieren nach Kopf-Doppelklick** verschob den Cursor (Index bleibt, Zeilen tauschen) → G14-Workaround.
- **Collator unter POSIX-Locale:** WebKitGTK mit `LANG=C.UTF-8` sortierte Groß- vor Kleinbuchstaben →
  `createNameCollator()` prüft sich selbst und fällt auf `en` zurück.
- **Eigene Renderer** haben keinen Innenabstand (die Table polstert nur ihr Label-Div) → Klasse `fnf-cell`.
- Aus Marcs Screenshot der alten Version übernommen: Häkchen statt Icon für markierte Einträge.
- **Performance** (Release, Container, 100 020 Einträge): Rust 0,80 s + JSON 0,06 s, gesamt inkl. IPC 1,5 s, Table
  0,17–0,40 s → Ziel < 500 ms verfehlt, Engpass Backend/Transport (20 MB JSON). Optionen in `docs/architecture.md`
  („Performance“); auf dem Mac nachmessen.

### Offen

- Lücken G1–G14 als Vorschläge in `mono/TODO.md` eintragen (Marc entscheidet, ob/wann).
- macOS/Windows nicht praktisch getestet (nur Linux/Xvfb).
