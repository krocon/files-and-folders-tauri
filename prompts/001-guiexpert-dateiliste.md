# Prompt 001: Dateiliste mit der GuiExpert Table

> **Slug:** `guiexpert-dateiliste` · **Braucht:** Phase 1 (MVP) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md` und `CLAUDE.md` §5. Altes Verhalten: `docs/legacy-analysis.md` §4
> (Spalten, Smart-Sortierung, Auswahlmodell, Cursor-Tasten).

## Ziel

Die selbstgebaute `FileTable` (`src/app/features/browser/file-table/`) wird durch die **GuiExpert Table**
(`@guiexpert/table` + `@guiexpert/angular-table@^22`) ersetzt. Danach ist die Liste so schnell und bedienbar, dass
alle weiteren Prompts (Markieren, Dual-Pane, Operationen) darauf aufbauen: 100 000 Einträge flüssig, Tastatur wie
im Total Commander, Spaltenbreiten und Sortierung bleiben beim Ordnerwechsel erhalten.

Gleichzeitig ist dieser Prompt ein **Praxistest der Table**: Jede Lücke wird dokumentiert und – wo sie in den Core
gehört – als Vorschlag für das Mono-Repo formuliert (nicht hier umgehen).

## Ausgangslage

- `FileBrowserStore` hält `listing`, `selectedPath`, `loading`, `error` (Signals) und navigiert; er bleibt die
  Quelle der Wahrheit. Die Table ist **Anzeige + Eingabe**, kein zweiter Zustand.
- `FileTable` liefert: Ordner zuerst, Name, Typ, Größe, Änderungsdatum, Hidden gedimmt, Symlink-Markierung,
  `aria-activedescendant`, Pfeile/Pos1/Ende/Bild↑↓/Enter/Backspace. Die Tests in `file-browser.spec.ts` beschreiben
  dieses Verhalten – sie werden auf das neue Bauteil umgestellt, nicht gelöscht.

## Zu lesende Stellen (Mono-Repo, `CLAUDE.md` §5)

- `mono/CLAUDE.md` §3.4 (Datenmodell, `TableFactory.createTableModel`, `AreaModelObjectArray`), §3.5 (Renderer,
  CSS-Variablen), §3.6 (Selektion, Fokus, Tastatur/`ShortcutService`, ARIA, Overlays, Sortierung, Filter, Zustand),
  §3.7 (Options), §4 (Angular-Wrapper).
- `mono/packages/angular-table/instructions.md` (Komponente, Inputs/Outputs, Abschnitte 5–10, 13).
- Quellen: `table-api.ts` (`setRows`, `repaintHard`, `scrollToIndex`, `ensureRowIsVisible`, `sort`, `sortByColumn`,
  `getSelectionModel`, `setSelectionModel`, `clearSelection`, `triggerAction`, `subscribe`, `getState`/`applyState`),
  `focus/focus-model.ts`, `selection/selection-model.ts`, `action/windows-shortcut-actionId-mapping.ts`,
  `action/osx-shortcut-actionId-mapping.ts`, `action/shortcut.service.ts`, `mouse-handler.ts` (`clickCount`).

## Aufgaben

1. **Abhängigkeiten**: `@guiexpert/table@^1.1.99`, `@guiexpert/angular-table@^22.1.99` (Versionen gegen npm prüfen,
   Major = Angular-Major). In `docs/architecture.md` begründen.
2. **Adapter** `src/app/features/browser/file-list/` (Namen im Design festlegen):
   - Zeilentyp = `DirEntry` (unverändert aus `fs.models.ts`), Spalten: Icon+Name, Erweiterung, Größe, Datum,
     (optional) Attribute/Rechte – Auswahl und Default-Breiten im Design.
   - **Renderer ohne Angular** (`CellRendererIf`) für Name (Icon + Text per `textContent`, Symlink-/Hidden-Klassen),
     Größe (rechtsbündig, `formatSize`), Datum (`formatModified`). HTML-Injection-Test mit
     `<img src=x onerror=alert(1)>.txt` als Dateiname.
   - Verzeichniswechsel: `tableApi.setRows(entries)` + `repaintHard()` statt neuem Modell (Spaltenbreiten,
     Sortierung bleiben). Prüfen, ob Scrollposition/Fokus dabei sinnvoll zurückgesetzt werden.
3. **Cursor und Auswahl** (Kernfrage, im Design entscheiden):
   - Cursor (die eine Zeile mit Fokusrahmen) ↔ `FocusModel`; `FileBrowserStore.selectedPath` folgt dem Fokus und
     umgekehrt (z. B. „Up“ wählt den Herkunftsordner).
   - Markierte Dateien (Mehrfachauswahl für spätere Operationen) ↔ `SelectionModel("row", "multi")` **oder** eigenes
     `Set<path>` im Store + `getCustomClassesAt`. Entscheiden nach: Sortieren/Filtern verschiebt Indizes – wie
     überlebt die Markierung? (Pfad als Schlüssel, `autoRestoreOptions.getRowId`?) Markierung **bleibt** über
     Sortierung erhalten und wird beim Ordnerwechsel geleert.
   - Total-Commander-Tasten (Details in Prompt 002, hier nur die Mechanik): Leertaste/Einfg markieren + Cursor
     weiter, Shift+Pfeile erweitern, Strg/⌘+A alles, Num+ / Num− / Num* (Muster in Prompt 002).
4. **Tastatur-Mapping** über `tableOptions.shortcutActionIdMapping`: `home`/`end` → erste/letzte Zeile
   (Default der Table = Zeilenanfang/-ende!), Enter = öffnen (nicht `ACTIVATE_CELL`), Backspace = nach oben.
   Prüfen, welche Tasten die Table verbraucht (stoppt Propagation) und welche zum App-Handler durchkommen.
   Doppelklick über `mouseClicked` mit `clickCount === 2` (Einfluss von `debounceMouseClickDelay` messen).
5. **Sortierung**: Klick auf Spaltenkopf; Ordner bleiben immer oben (eigener `sortComparator` bzw. `tableApi.sort`),
   Namensvergleich „natürlich“ (`file2` < `file10`, `Intl.Collator` mit `numeric`) – Regeln der alten Smart-Sortierung
   aus `docs/legacy-analysis.md` übernehmen oder begründet abweichen. Sortierung im Store gemerkt (je Panel).
6. **Darstellung**: CSS-Variablen `--ge-table-*` auf unsere Tokens (`src/styles.scss`) abbilden, light/dark
   (`html[data-theme]` der Table ↔ `prefers-color-scheme` bzw. künftige Theme-Einstellung), kompakte Zeilenhöhe
   (Default 24 px), keine Hover-Spalte, Hover-Zeile dezent. Leerer Ordner = eingebautes „No rows“-Overlay mit
   eigenem Text; Laden = `loading`-Input (kein Neuaufbau).
7. **ARIA**: `ariaLabel` bzw. `ariaLabelledBy` (Pfad-Anzeige), Ansage beim Ordnerwechsel („42 Einträge“) über die
   Live-Region der Table (`tableApi.announce`).
8. **Performance**: Rust-Testordner mit 100 000 Dateien erzeugen (Skript unter `scripts/`), Zeit für
   `list_directory`, IPC-Transfer und erstes Rendern messen (Konsole/Performance-Panel); Ziel < 500 ms bis zur
   ersten Anzeige auf einem aktuellen Mac. Falls IPC dominiert: Option „Streaming/Chunks“ im Design notieren (nicht
   umsetzen).
9. Alte `FileTable` entfernen, wenn alles übernommen ist; Tests umstellen.

## Entscheidungsfragen (Phase 1)

- Markierung: `SelectionModel` der Table oder eigenes Set + Klassen? (Kriterien: Sortierung, Filter, Persistenz,
  Total-Commander-Farbe „rot markiert“ unabhängig vom Cursor.)
- Sortieren in der Table (`ColumnDef.sortable`) oder im Store vor `setRows` (volle Kontrolle über „Ordner oben“
  und „..“-Eintrag aus Prompt 003)?
- Ein `TableModel` je Panel für die gesamte Lebensdauer (nur `setRows`) – reicht das für Spaltenkonfiguration
  (Prompt 015)?
- Was fehlt in der Table? (z. B. „Fokus auf Zeile setzen ohne Scrollsprung“, „Typ-Ahead“, „Zeile per Id finden“) →
  Liste mit Vorschlag für `mono/TODO.md`.

## Akzeptanzkriterien

- Liste zeigt dieselben Daten wie vorher, Unicode/Emoji/Leerzeichen korrekt, Symlinks und Hidden erkennbar.
- Enter/Doppelklick öffnet Ordner, Backspace/„Up“ geht hoch und setzt den Cursor auf den Herkunftsordner.
- Pfeile, Bild↑/↓, Pos1/Ende bewegen den Cursor über **Zeilen**; die Liste scrollt mit.
- Sortierung per Spaltenkopf, Ordner bleiben oben; Spaltenbreite ändern bleibt beim Ordnerwechsel erhalten.
- Markieren mehrerer Dateien funktioniert und übersteht Umsortieren.
- 100 000 Einträge: Scrollen ohne Ruckeln, Ladezeit gemessen und im Bericht genannt.
- `pnpm check` grün, Ende-zu-Ende in der App geprüft (light + dark).

## Definition of Done (zusätzlich zu 000)

- [ ] Design mit Entscheidung Cursor/Markierung und Lückenliste der Table
- [ ] Adapter + Renderer + Tests (Store/Adapter in Vitest; Tabellen-Verhalten Ende-zu-Ende)
- [ ] Performance-Messung dokumentiert (`docs/architecture.md`)
- [ ] Lücken der Table als Vorschlag für `mono/TODO.md` im Bericht
