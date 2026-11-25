# Design 041: Spaltenauswahl und Ansichtsmodi

> **Status:** umgesetzt (Phasen 1–6, ohne Haltepunkt – von Marc so angeordnet; echte App auf dem Mac nicht geprüft, §9) · **Datum:** 2026-11-25 ·
> **Branch:** `feat/spalten-ansichten` · **Auftrag:** `041-spalten-ansichten.md`
>
> **Entscheidungen in einem Satz:** Spaltenauswahl und -reihenfolge sind **global** (Einstellung `view.columns`),
> Spaltenbreiten bleiben **je Tab** (Sitzung, wie bisher); der Ansichtsmodus (Voll/Kurz/Miniaturen) gilt **je Tab**
> (`TabSession.view`); Kurz- und Miniaturansicht sind **ein** GuiExpert Cover-Grid (`FileGrid`), das die versteckte
> Detail-Table als Quelle für Sortierung, Filter und Cursor nutzt; Miniaturen kommen aus der Bilder-Übersicht (074,
> Schema `fnfthumb`) – nichts Zweites.

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `file-list/file-columns.ts` | Spalten Name, Ext, Größe, Geändert + 7 Sonderspalten (Suche, Dubletten, Belegung, flach) | wird um 4 Spalten erweitert |
| `model.rs` `DirEntryDto` | Name, Pfad, Art, Größe, `modifiedMs`, versteckt | `symlink_metadata` ist je Eintrag schon gelesen → Erstellt, Zugriff, Modus kosten **keinen** weiteren Systemaufruf |
| `TableApi.getState/applyState(['columns'])` (1.1.105, `table-state.service.ts` `applyColumns`) | Reihenfolge, Sichtbarkeit, Breite je Property | passt – ein Aufruf setzt alles; ohne Neuaufbau |
| `TabSession.table` (004 E2) | Table-Zustand je Tab in der Sitzung | passt für Breiten; Sichtbarkeit/Reihenfolge darin werden künftig überschrieben (E1) |
| `TableBridge.setPresentation` | Spaltentitel je Sprache | **Fehler nach Umordnen:** schreibt den Titel per Index der Start-Reihenfolge → auf `getColumnIndex(property)` umgestellt |
| `onContextmenu` (`areaIdent === 'header'`) | Rechtsklick Spaltenkopf | bisher verworfen → öffnet das Spaltenmenü |
| `CoverGridFactory` / `CoverGridTableModel` (074, `OverviewGrid`) | Kacheln, virtuell | trägt Kacheln zeilenweise (links → rechts, dann nächste Zeile) – passt für Miniaturen und eine Kurzansicht |
| `image_overview/` + `fnfthumb` (074) | Thumbnails 160/320/640/2048, Platten-Cache ≤ 1 GiB, LIFO-Pool, 503 bei Überlast | wird wiederverwendet; nur `MAX_OPEN` 2 → 6 |
| `grid-math.ts`, `TileRetries`, `thumbStep` (074) | Raster-Arithmetik, Wiederholungen | wiederverwendet |
| `settings-schema.json` Typ `json` | Listen in den Einstellungen | passt für `view.columns` |

## 2. Entscheidungen

**E1 – Spalten global, Breiten je Tab.** Optionen: (a) alles je Tab, (b) alles global, (c) Auswahl/Reihenfolge
global, Breiten je Tab. Gewählt **(c)**: Wer „Erstellt“ sehen will, will das überall (Total Commander: eine
Spaltenansicht für alle Fenster); 20 Tabs einzeln umzustellen wäre Arbeit ohne Nutzen. Breiten hängen dagegen am
Inhalt eines Ordners und liegen seit 004 je Tab in der Sitzung – das bleibt. Folge: Sichtbarkeit und Reihenfolge aus
einem gespeicherten Tab-Zustand gelten nicht mehr; `columnLayout()` baut bei jedem Anzeigen **einen**
`columns`-Zustand aus Einstellung + Kontext + gespeicherten Breiten.

**E2 – Wählbare Spalten.** `name` (Pflicht, verschiebbar), `ext`, `size`, `modifiedMs`, neu `createdMs`,
`accessedMs`, `attrs`, `type`. Default wie bisher: Name, Ext, Größe, Geändert.
- Erstellt/Zugriff/Rechte: aus dem ohnehin gelesenen `symlink_metadata` (`created()`, `accessed()`, Unix-Modus bzw.
  Windows-Attribute) – kein zusätzlicher Systemaufruf, SMB (030) wird nicht langsamer. Felder `None`, wo die
  Plattform sie nicht kennt, in Archiven und auf Servern; `skip_serializing_if` hält das JSON klein.
- Typ: rein im Frontend (Ordner / Verknüpfung / Kategorie aus `filetypes.json`, sonst Endung).
- **Weggelassen:** Eigentümer (uid → Name ist je Eintrag eine Abfrage, auf Netzlaufwerken teuer) und Link-Ziel
  (`readlink` je Verknüpfung) – beides zeigt „Eigenschaften“ (010).
- Sonderspalten (Ordner, Pfad, Gruppe, Entscheidung, Pixel, Anteil, Objekte) bleiben vom Tab-Typ gesteuert und
  stehen hinter den gewählten; die Regeln von 033/042 (Belegung ohne Ext/Datum, Dubletten ohne Ext) bleiben.

**E3 – Breite der Datumsspalten.** Fehler aus `TODO.md` §4: 160 px fest, US-Format `12/28/2026, 10:48 PM` ist
breiter. Optionen: Mindestbreite je Locale (Tabelle pflegen) oder messen. Gewählt: **messen** –
`dateColumnWidth(sample, measure)` = Textbreite eines breiten Musterdatums im aktuellen Format + 20 px
Zell-Padding, gemessen mit Canvas in der Schrift der Liste (ohne Canvas: 8 px je Zeichen). Die Breite gilt als
„automatisch“, solange der Nutzer die Spalte nicht selbst gezogen hat: Beim Speichern des Tab-Zustands wird eine
Breite, die der automatischen entspricht, weggelassen (`stripAutoWidths`) – so folgt die Spalte einem Sprach-/
Formatwechsel, eine gezogene bleibt.

**E4 – Ansichtsmodus je Tab.** Ein Bildordner will Miniaturen, der Tab daneben nicht. Feld `view` in
`TabSession` (`full` | `brief` | `thumbnails`, Rust begrenzt auf diese Werte, Default `full`). Ergebnis-Tabs der
Belegung und das Diagramm bleiben immer in der Vollansicht (ihre Spalten sind der Inhalt).

**E5 – Kurzansicht: Cover-Grid, zeilenweise.** Total Commander füllt in „Kurz“ spaltenweise (oben → unten, dann
nächste Spalte, waagerecht scrollen). Das kann die Table **nicht**: das Cover-Grid kennt nur zeilenweises Füllen
mit senkrechtem Scrollen, ein normales Table-Modell keine umbrechenden Zeilen. Nachbauen wäre eine zweite virtuelle
Liste (Auftrag: „hier nicht nachbauen“). Gewählt: Kurzansicht als Cover-Grid mit schmalen Kacheln (Icon + Name, eine
Zeile hoch, ≥ 220 px breit) – entspricht der Ansicht „Liste/Kleine Symbole“ des Explorers. Das spaltenweise Füllen
ist als Lücke **G20** für `mono/TODO.md` vorgeschlagen (§7). Abweichung in `docs/feature-parity.md`.

**E6 – Miniaturen: dieselbe Komponente, Thumbnails aus 074.** Kein neuer Thumbnail-Code: Für den Ordner des Panels
wird eine Bilder-Übersicht ohne Unterordner geöffnet (`ImageOverviewApi.open(path, false)`), ihre Einträge
(`path → index`) liefern die `fnfthumb`-URL der Kachel. Das bringt begrenzten Platten-Cache, LIFO-Pool (nur was
sichtbar ist, wird erzeugt; 503 → `TileRetries`), EXIF-Drehung, RAW und die Sicherheitsregel „Rust liefert nur, was
es selbst gelistet hat“ mit. Änderung in Rust: `MAX_OPEN` 2 → 6 (Übersicht 2 + je Panel eine offene und eine, die sie
ersetzt). Nicht-Bilder und Ordner zeigen ihr Datei-Icon groß. **Offen:** Miniaturen in Archiven, auf Servern und in
Ergebnis-Tabs (Suche, flach, Dubletten) – dort zeigt die Ansicht Icons (074 E17 gilt weiter: nur lokale Ordner).
Kachelgröße: Einstellung `view.thumbnailSize` (64–320, Default 128).

**E7 – Die versteckte Table bleibt die Quelle.** Optionen: (a) eigenes Sortieren/Filtern/Cursor im Grid,
(b) Table bleibt im DOM (unsichtbar, wie bei Schnellvorschau/Diagramm) und liefert `displayedRows()`; das Grid
spiegelt sie. Gewählt **(b)**: `FileListController` (Markieren, Bereich, Type-ahead, F5 …), Sortierung und Filter
laufen unverändert – „Cursor/Markierung/F5 wie in der Detailansicht“ gilt per Konstruktion. Das Grid ist nur Anzeige
+ Tasten eines Raster-Widgets (APG-Ausnahme CLAUDE.md §4: Pfeile, Pos1/Ende, Bild↑/↓ – in der Vollansicht macht das
die Table selbst). Leertaste/Einfg/Enter/F-Tasten bleiben Aktionen. F2 in der Liste gibt es im Grid nicht →
Umbenennen-Dialog (der Controller meldet `false`). Sortiert wird in der Vollansicht (Spaltenkopf); die Reihenfolge
gilt in allen Ansichten.

**E8 – Aktionen und Tasten.** `VIEW_MODE_FULL` / `VIEW_MODE_BRIEF` / `VIEW_MODE_THUMBNAILS`, `OPEN_COLUMNS_DLG`.
Windows/Linux wie TC: `Mod+F2`, `Mod+F1`, `Mod+Shift+F1`. macOS: `Ctrl+F1/F2` gehören dem System (Menüleiste/Dock
fokussieren) → wie im Finder `Mod+1`, `Mod+2`, `Mod+3`. `OPEN_COLUMNS_DLG` ohne Kürzel. Menü „Ansicht“: die drei
Modi, Untermenü „Spalten“ (Haken je Spalte, `Spalten…`). Rechtsklick auf den Spaltenkopf: dasselbe Spaltenmenü.
Spalten-Haken sind `MenuChoice`-Einträge (`column:<property>`, wie die Farbschemata 070) – kein Katalog-Eintrag je
Spalte.

**E9 – Dialog „Spalten“.** Liste (APG Listbox) aller wählbaren Spalten in ihrer Reihenfolge, Leertaste = ein/aus,
`Alt+↑/↓` = verschieben (wie Tabs/Buttons), Knöpfe „Nach oben/unten“, „Standard“. Änderungen wirken sofort in beiden
Panels (Vorschau), „Abbrechen“ stellt den Stand beim Öffnen wieder her. Einstieg auch: Einstellungen → Anpassen.

## 3. Verträge

Rust `DirEntryDto` (+ TS `DirEntry`, alle optional):

```
createdMs?: number   accessedMs?: number   // ms seit 1970, fehlt = unbekannt
mode?: number        // Unix: st_mode & 0o7777
winAttrs?: number    // Windows: FILE_ATTRIBUTE_*
```

`TabSession.view?: 'full' | 'brief' | 'thumbnails'` (Rust: `String`, unbekannt → `full`).
Einstellungen: `view.columns` (`json`, Liste der sichtbaren Spalten in Reihenfolge, ≤ 16 Einträge),
`view.thumbnailSize` (`int` 64–320, 128). Keine neuen Commands, keine neuen Fehlercodes, keine neue Abhängigkeit.

Frontend (rein, `file-list/column-layout.ts`): `sanitizeColumns`, `columnLayout(chosen, context, widths, auto)`,
`toggleColumn`, `moveColumn`, `dateColumnWidth`, `stripAutoWidths`. `TableBridge.applyColumns(state)`.

```
┌ Spalten ───────────────────────────┐   Fokus: Liste → Nach oben → Nach unten → Standard
│ [x] Name            (immer)        │          → Abbrechen → OK
│ [x] Ext                            │   role=listbox, option aria-selected (Fokus) + aria-checked
│ [ ] Größe                          │
│ [x] Geändert        [Nach oben]    │
│ [x] Erstellt        [Nach unten]   │
│ [ ] Zugriff                        │
│ [ ] Rechte          [Standard]     │
│ [ ] Typ                            │
│                [Abbrechen] [OK]    │
└────────────────────────────────────┘
```

## 4. Tests

- Rust: neue Listing-Felder (Datei mit Modus 0640, Zeiten gesetzt; Archiv-Einträge ohne), `view` in der Sitzung
  (bekannt/unbekannt), `MAX_OPEN` (die 7. Übersicht schließt die älteste). Thumbnail-Erzeugung (Größen, kaputte
  Bilder, Grenzen) ist mit 074 getestet (`image_overview::thumbs::tests`) – unverändert.
- Frontend: `column-layout.spec.ts` (Reihenfolge, Sonderspalten, Breiten, Auto-Breite, roter Test US-Datum),
  Vergleicher/Renderer der neuen Spalten, `ColumnsStore` (Vorschau, Abbrechen), `FileGrid`-Logik
  (`grid-logic.spec.ts`: Kachelmaße, Index ↔ Zelle), `PanelThumbs` (öffnet/schließt, nur lokale Ordner),
  Ansichtswechsel ohne Verlust von Cursor/Markierung (Store-Test), Menümodell (`@columns`), Keymaps.
- Nur Ende-zu-Ende: Table in echt (Reihenfolge anwenden, Rechtsklick Kopf, Grid-Layout, Scrollen mit 2 000 Bildern).

## 5. Phasen

Phasen 2 und 3 wie in 000; Phase 1 ohne Haltepunkt (Anordnung Marc). Commits: Design · Rust · Spalten ·
Ansichten · Doku.

## 6. Abweichungen vom alten Programm

- mr und die Version von 2016 haben feste Spalten und keine Ansichtsmodi – alles hier ist neu (Vorbild TC).
- Kurzansicht füllt zeilenweise statt spaltenweise (E5).

## 7. Lücken der GuiExpert Table (Vorschlag für `mono/TODO.md`)

- **G20 – Kurzansicht spaltenweise:** Cover-Grid mit `flow: 'column'` (Elemente oben → unten, dann nächste Spalte,
  waagerechtes virtuelles Scrollen, Pfeil ↓ am Spaltenende → nächste Spalte). Heute nur zeilenweise.
- **G21 – Kopf-Rechtsklick:** `GeMouseEvent` nennt für den Kopf nur `columnIndex`; ein `property`/`columnDef` im
  Ereignis spart die Rückrechnung nach dem Umordnen.
- **G22 – `setColumnWidth` gilt als Nutzer-Breite:** kein Weg, eine „Breite des Codes“ nachträglich zu ändern
  (z. B. Datumsspalte nach Sprachwechsel), ohne dass sie als gezogen im Zustand landet → hier `stripAutoWidths`.
- **G23 – Titel einer Spalte ändern:** `header.setValue(0, index, label)` braucht den aktuellen Index;
  `tableApi.setColumnHeaderLabel(property, label)` fehlt (zusätzlich zu den Overlay-Texten aus 015).
- **G24 – `minWidth` einer Gewichts-Spalte:** Die Namensspalte (`width: 1 weight`, `minWidth: 160 px`) wird in
  schmalen Panels bzw. mit vielen Spalten schmaler als ihr Minimum (Namen werden zu `…`), statt dass die Table
  waagerecht scrollt. Schon vor 041 so (Vergleichsbild von `main` bei 760 px Fensterbreite), mit mehr wählbaren
  Spalten aber eher sichtbar.

## 8. Fortschritt

- [x] Phase 1 – dieses Dokument (ohne Haltepunkt, Anordnung Marc)
- [x] Phase 2 – Rust: `DirEntryDto` + `createdMs`/`accessedMs`/`mode`/`winAttrs` (`listing.rs`), `session::ViewMode`
      (nachsichtig gelesen), `image_overview::MAX_OPEN` 6
- [x] Phase 3 – Frontend: `column-layout.ts`, neue Spalten/Renderer/Vergleicher, `TableBridge.applyColumns` /
      `setCovered`, `features/columns/` (Store, Dialog, Aktionen), `file-grid/` (FileGrid, FileTileRenderer,
      grid-logic, PanelThumbs), Menüs (`@columns`, Kopf-Menü), Einstellungen, Texte en/de
- [x] Phase 4 – im Browser mit der echten Table (Playwright + Mock-Backend, `pnpm screenshots`), Debug-Build gebaut
- [x] Phase 5 – Doku
- [x] Phase 6 – `pnpm check` grün

## 9. Ergebnis

**Umgesetzt wie entworfen**, mit diesen Erfahrungen:

- `applyState({ columns })` der Table (1.1.105) trägt Reihenfolge, Sichtbarkeit und Breiten in einem Schritt – auch
  in jsdom (`file-list.spec.ts` prüft den echten Table-Zustand). Die Titel folgen nur, wenn man sie per
  `getColumnIndex` schreibt (alter Fehler in `setPresentation`, vor 041 nicht sichtbar).
- Die Table setzt `position: relative` als Inline-Style auf ihren Host – die verdeckte Table braucht deshalb
  `position: absolute !important`, sonst teilt sie sich die Breite mit dem Grid (im Browser gefunden).
- Fokus beim Ansichtswechsel: Palette und Menü geben den Fokus an das Element zurück, das ihn vorher hatte – das
  ist nach dem Wechsel verdeckt bzw. weg. `FileList.onViewMode` holt ihn deshalb in die jetzt sichtbare Ansicht
  (zweimal, nach 0 und 80 ms), `FileGrid.ready` meldet, wenn dessen Table den Fokus nehmen kann.
- Datumsbreite: Ziffern sind in der Listenschrift nicht gleich breit (`2026-09-02 08:48` war abgeschnitten, wo
  `2026-10-12 11:11` passte) → gemessen wird mit jeder Ziffer an allen Stellen, die breiteste zählt.

**Geprüft im Browser** (Chromium, echte GuiExpert Table, nachgebautes Backend; Szenen in
`scripts/screenshots/scenes.json`): `columns-dialog` (Leertaste, Alt+↑ – beide Panels folgen sofort, Titel stimmen),
`columns-menu` (Rechtsklick auf den Spaltenkopf), `columns-us-dates` (US-Format vollständig lesbar, Spalten
Erstellt/Rechte/Typ), `view-brief`, `view-thumbnails` (auch Norton), `view-thumbnails-back` (Pfeile im Raster,
Leertaste markiert, zurück in die Vollansicht: Cursor und Markierung da, Cursorzeile im Bild),
`view-thumbnails-2000` (2 027 Einträge: 20 Kacheln im DOM; 60 Frames lang je Frame 700 px weiter gescrollt:
Median 38 ms, Maximum 78 ms je Frame – jeder Frame ersetzt dabei alle Kacheln samt Vorschaubildern; headless
Chromium, Vorschaubilder als SVG vom lokalen Testserver, also keine Aussage über WebKit und echte JPEGs).

**Nicht geprüft:** die echte Tauri-App. Marcs installierte App lief während der Arbeit (gleicher App-Ordner
`io.github.krocon.filesandfolders`); ein zweiter Prozess hätte dieselbe `session.json`/`settings.json` gelesen und
geschrieben – deshalb nicht gestartet. Damit offen: Miniaturen über das echte Schema `fnfthumb` im Panel
(WebKit, Rust-Pool, Platten-Cache – die Bausteine selbst sind mit 074 geprüft), Neustart-Persistenz in der echten
App (Rust-Test für `view`, Einstellungs-/Sitzungsweg unverändert), `⌘1/⌘2/⌘3`, Windows-Attribute (`winAttrs`,
kein Windows-Build hier).

## 10. Offen

- Miniaturen in Archiven, auf Servern und in Ergebnis-Tabs (Suche, flach, Dubletten) – dort Icons (E6).
- Spalten Eigentümer und Link-Ziel (E2).
- Sortieren aus der Kurz-/Miniaturansicht (kein Spaltenkopf) – über die Vollansicht; die Reihenfolge bleibt.
- Kurzansicht spaltenweise wie TC (G20), Kachelgröße per Strg+Mausrad, Miniaturen für Ordner (Inhaltsvorschau).
- Kein Bild in der README: ihre Liste ist mit 20 Bildern voll (`scripts/screenshots.test.mjs`), `pngquant` fehlte lokal.
