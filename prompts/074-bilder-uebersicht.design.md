# Design 074: Bilder-Übersicht

> **Status: freigegeben (Marc, 14.11.2026), umgesetzt** · Datum: 14.11.2026 · Branch `feat/bilder-uebersicht` (von
> `feat/doppelklick-ausloeser`, weil Prompt und Index nur dort liegen; 073 ist noch nicht in `main`)
> Auftrag: [`074-bilder-uebersicht.md`](074-bilder-uebersicht.md) · Regeln: [`000-arbeitsweise.md`](000-arbeitsweise.md)
> Vorgabe von Marc (14.11.2026): **das Cover-Grid der GuiExpert Table nutzen, analog zu Comic Commander**
> (`~/WebstormProjects/comic-commander-tauri`, MIT, gleicher Autor: Designs 003 „Cover“ und 004 „Cover-Grid“).
> Vorher-Check: `pnpm check` grün (14.11.2026, auf diesem Branch vor jeder Änderung).

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Fenstermodus oder Tab-Typ? | **Fenstermodus** des Workspace: die Übersicht liegt über Zeilen 1–4 beider Seiten (volle Breite); die Panels bleiben im DOM (`hidden` + `inert`), damit ihre Komponenten-Stores (Cursor, Markierung, Table-Zustand, Scrollposition) unangetastet bleiben – ein `@if` würde sie zerstören. Nicht in der Sitzung (nach Neustart immer Panels) |
| E2 | Raster | **GuiExpert Cover-Grid** (`CoverGridFactory.createCoverGridModel`, `guiexpert-table-signal`), Aufbau wie Comic Commander 004: Renderer ohne Angular, eigener Cursor + Markierung im Store, Breite gestreckt (keine Lücke rechts), `ResizeObserver`, `shortcutActionsDisabled`, `overflowY: 'scroll'`, Fokusrahmen der Table per CSS aus. Reine Rechenfunktionen (`grid-math.ts`, `cover-retries.ts`) aus Comic Commander übernehmen (MIT, gleicher Autor) |
| E3 | Wie kommen Vorschaubilder ins `<img>`? | Neues Schema **`fnfthumb`** wie `cccover` (CC 003 E1): URL `<overviewId>.<index>.<stufe>?v=<mtime>` – Rust liefert nur Bilder, die es selbst für diese Übersicht gelistet hat (kein Pfad aus dem Frontend, kein allgemeiner Bild-Leser), **kein `invoke` je Kachel**. CSP `img-src` um `fnfthumb:` ergänzen |
| E4 | Größen und Cache | Stufen **160 / 320 / 640 px** (längste Kante); geladen wird die kleinste Stufe ≥ Kachelbreite × `devicePixelRatio`, CSS skaliert dazwischen → Slider stufenlos, ohne bei jedem Pixel neu zu rechnen. Platten-Cache `<app cache>/thumbs/<xx>/<fnv64>.jpg` (Schlüssel: Pfad, Größe, mtime, Stufe), Grenze **1 GiB**, Aufräumen beim Start und je 500 neuen Bildern (CC 003 E4); JPEG Q 80; WebView-Cache über unveränderliche URLs |
| E5 | Rechenarbeit | Eigener Pool mit **LIFO**-Warteschlange (nach schnellem Scrollen kommen die sichtbaren zuerst), `min(4, Kerne − 1)` Threads, auf Netzlaufwerken 1, gleiche Anfragen zusammengelegt; Anfragen einer geschlossenen/ersetzten Übersicht verfallen. Decoder mit den Grenzen aus `duplicates/images.rs` |
| E6 | EXIF-Orientierung | ja: `ImageDecoder::orientation()` + `DynamicImage::apply_orientation` (image 0.25, vorhanden) |
| E7 | RAW (`.nef .cr2 .arw .dng .orf .rw2 .raf`) | **eingebettetes JPEG** über einen eigenen, kleinen TIFF/IFD-Leser (kein neues Crate), fail-closed (Offsets/Längen gegen Dateigröße, max. 64 IFDs, keine Zyklen): größtes JPEG nehmen, dann wie ein JPEG. `.raf` (eigenes Format) und alles, was die Prüfung nicht besteht → Platzhalter-Kachel. Eigene Phase 2b – fällt sie aus Zeitgründen weg, bleibt der Platzhalter |
| E8 | HEIC/AVIF | Vorschaubild: Platzhalter (wie bisher „nicht unterstützt“). Großansicht: über `read_preview`/`fnfpreview` – WebKit auf macOS dekodiert HEIC selbst. `sips`/ImageIO für Vorschaubilder = Folge-Prompt |
| E9 | Welche Einträge? | **Nur Bilder** (`IMAGE_EXT` + RAW + HEIC/AVIF als Platzhalter); Ordner nicht als Kacheln (dafür ist der Baum da); versteckte Dateien wie `collect_files` nie |
| E10 | Liste und „rekursiv“ | Rust sammelt: `collect.rs` bekommt `onlyImages` (die Grenze 20 000 zählt dann Bilder), Tiefe 1 = nur der Ordner, rekursiv = bis 16. Ergebnis in Teilen ≤ 2 000 über einen Channel (CC 004: große IPC-Nachrichten sind langsam), abbrechbar. Rekursiv **flach** nach relativem Pfad sortiert, Ordner der Cursor-Kachel in der Statuszeile + Tooltip; Abschnittsköpfe je Ordner kann das Cover-Grid nicht → Vorschlag `mono/TODO.md` |
| E11 | Kachel | Bild `object-fit: contain` auf dunkler Fläche (Fotos haben verschiedene Seitenverhältnisse), darunter der Name (eine Zeile, gekürzt, `textContent`); Kachelhöhe = Breite × 3/4 + Namenszeile. Markiert = Rahmen + Häkchen in der Markier-Farbe (`--color-marked`), Cursor = Rahmen in `--color-cursor-bg` |
| E12 | Kachelgröße | stufenlos **96–640 px**, Slider + `−`/`+` in der Fußleiste, `Mod+=`/`Mod+-` (Faktor 1,25), `Mod`+Mausrad; Einstellung `imageOverview.tileSize` (Default 200). Cursor-Kachel bleibt im Blick (CC 004 E10) |
| E13 | Ordnerbaum | eigene kleine Komponente nach APG-Tree: Wurzel = Ordner der Übersicht, Kinder lazy über `FsApi.listDirectory` (nur Ordner, Reihenfolge von Rust); Eltern über die Pfadleiste. Ein-/ausblendbar (`Mod+Shift+T` im Overview, Knopf), Breite per Splitter; `imageOverview.tree` = `{ visible, width }` |
| E14 | Großansicht | eigenes Overlay der Übersicht (nicht der F3-Dialog): Bild über `read_preview` → `fnfpreview` (Original, WebView dekodiert; Grenze 64 MiB); RAW und zu große Bilder: Stufe 640 bzw. eine zusätzliche Stufe **2048** aus dem Thumbnail-Weg. Modus **im Fenster** (Overlay über die ganze App) oder **ganzer Bildschirm** (`toggle_fullscreen`, beim Schließen zurück, wenn wir es eingeschaltet haben); `F` schaltet, `imageOverview.largeMode` merkt ihn. ←/→, Bild↑/↓, Pos1/Ende blättern, nächstes/voriges Bild vorgeladen, Zoom Einpassen ↔ 100 % (`Z`/Doppelklick), Esc zurück (Cursor = zuletzt gezeigtes Bild) |
| E15 | Dateiaktionen | Die Übersicht meldet sich beim `WorkspaceStore` als **Auswahlquelle** (`overview` = `SelectionSource` + Ordner + Seite); `OpsStore.selection()`/`location()`/`folder()` fragen sie zuerst. Damit laufen F5/F6 (Ziel = anderes Panel), F8 (Papierkorb), F2 (Umbenennen-Dialog) und Ziehen ins System unverändert über die normalen Dialoge/Jobs. Aktionen, die ein Panel brauchen (Tabs, flache Ansicht, Navigation, Suche, Archive …), per **Veto** (Allowlist), Meldung „In der Bilder-Übersicht nicht verfügbar“ |
| E16 | Auffrischen | Der Ordner der Übersicht kommt zu den überwachten Ordnern (`WatchService`); Änderung → neu sammeln im Hintergrund (kein Overlay), Cursor und Markierung über den Pfad gehalten, gelöschte Kacheln verschwinden ohne Flackern (`bodyModel.items` tauschen + `repaintHard`, kein neues Modell) |
| E17 | Server, Archive, Ergebnis-Tabs | im ersten Schritt **aus**: `TOGGLE_IMAGE_OVERVIEW` meldet „Nur für lokale Ordner“; Folge-Prompt |
| E18 | Kürzel | `Mod+Shift+I` (in allen drei Keymaps frei) öffnet/schließt; im Overview zusätzlich Esc (ohne offene Großansicht/Filter) |

## Bestand

| Baustein | wofür | passt / fehlt |
|---|---|---|
| `@guiexpert/table` 1.1.105: `CoverGridFactory.createCoverGridModel(items, renderer, w, h, width, firstRowPaddingTop)`, `createCoverGrisDefaultOptions` (sic) | Raster | **passt** (installiert, `cover-grid-factory.d.ts`); Comic Commander nutzt dieselbe API seit 1.1.102 |
| Cover-Grid: kein Fokus-/Auswahlmodell, `role="grid"` wird je Zeichnen gesetzt, `getRowCount()` mit Extrazeile, 0 Spalten → `Infinity` | Cursor, ARIA | **Lücke** (in `mono/TODO.md` schon eingetragen) → wie CC: Cursor im Store, Live-Region statt `aria-activedescendant`, `cols ≥ 1` erzwingen, `// TODO(guiexpert)` |
| Comic Commander `features/grid/`: `grid-math.ts` (`gridLayout`, `moveCursor`, `pageRows`, `scrollToShow`, `topIndex`), `cover-retries.ts`, `cover-renderer.ts`, `cover-grid.ts` (Table-Optionen, `ResizeObserver`) | Vorlage | **übernehmen/anpassen** (MIT, gleicher Autor) |
| Comic Commander `cccover`-Schema, LIFO-Pool, Platten-Cache (Design 003 E1/E4/E9) | Vorschaubilder | **Vorlage** für `fnfthumb` (E3–E5) |
| `duplicates/thumbs.rs` (256 Stück/32 MiB im Speicher, max. 256 px, `fnfpreview`-Token `t…`) | Dubletten-Kacheln | für 2 000+ Bilder bis 640 px **zu klein**; bleibt für 042 unverändert |
| `duplicates/images.rs` (`decode`, Grenzen, Semaphor `MAX_DECODES = 4`, `IMAGE_EXT`, `UNSUPPORTED_EXT`) | Dekodieren | **passt**; nach `images/decode.rs` heben, `duplicates` importiert von dort (reines Verschieben, Tests wandern mit) |
| `preview::read_preview` + `ImageTokens` (16 Tokens, 64 MiB, 3 parallel) | Großansicht im Original | **passt** (3 Tokens gleichzeitig: aktuell, vor, zurück) |
| `collect.rs` / `collect_files` (045: keine Links, kein fremdes FS, keine versteckten, 20 000 Dateien, Abbruch) | Liste, rekursiv | **erweitern**: `onlyImages`, Teil-Ereignisse über Channel |
| `WorkspaceStore` (`registerPanel`, `panel()`, `source()`, `targetDir`), `OpsStore.selection()/location()/folder()` | Dateiaktionen | **erweitern** um die Auswahlquelle (E15) |
| `ActionService.setVeto` | gesperrte Aktionen | **passt** |
| `MenuApi.toggleFullscreen(): Promise<boolean>` (022) | ganzer Bildschirm | **passt** (liefert den neuen Zustand) |
| `WatchService` | Auffrischen | **erweitern** um einen dritten Ordner |
| `FsApi.listDirectory` | Baum | **passt** (Ordner filtern im Frontend über `kind`) |
| Pfadleiste (`file-panel.html`, Segmente aus Rust) | Kopf | als kleine Komponente herauslösen oder nachbauen – in Phase 3 entscheiden, wer weniger Code ist |

## Oberfläche

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [◧] / Users / marc / Fotos / 2021-08-Frankreich   [☐ Unterordner]  [Name ▾]  [Filter…] [✕ Panels] │ Kopf
├──────────────────┬─────────────────────────────────────────────────────────────────────┤
│ ▾ 2021-08-Frank… │ ┌────────┐ ┌────────┐ ╔════════╗ ┌────────┐                            │
│   ▸ Tag 1        │ │  Bild  │ │  Bild  │ ║ Cursor ║ │ ✔ mark │                            │
│     Tag 2        │ │        │ │        │ ║        ║ │        │   Cover-Grid                │
│                  │ │DSC1158 │ │DSC1159 │ ║DSC1160 ║ │DSC1161 │   (GuiExpert Table)         │
│  Baum (APG tree) │ └────────┘ └────────┘ ╚════════╝ └────────┘                            │
│                  │ ┌────────┐ …                                                           │
├──────────────────┴─────────────────────────────────────────────────────────────────────┤
│ 182 Bilder (9,9 GB) · 2 markiert │ DSC1160.NEF · 58,1 MB · 8256 × 5504 · 14.08.2021  │ − ━━●━━ + │ Fußleiste
└────────────────────────────────────────────────────────────────────────────────────────┘
  darunter wie immer: Shell-Zeile (falls an), Button-Leiste
```

- Fokus-Reihenfolge: Baum-Knopf → Pfadleiste → Unterordner → Sortierung → Filter → Zurück → Baum → Raster →
  `−` → Slider → `+`. Beim Öffnen hat das Raster den Fokus, beim Schließen bekommt ihn das aktive Panel zurück.
- Raster-Host: `aria-label` „Bilder in <Ordner>“; Live-Region sagt die Cursor-Kachel an („DSC1160.NEF, 3 von 182,
  markiert“) – wie CC 004 (Abweichung E8 dort: die Table überschreibt `role`/`aria-activedescendant`).
- Großansicht: `role="dialog"`, `aria-modal`, Fokusfalle, Esc; Kopfzeile (Name, n/m, Modus-Knopf, Zoom, Schließen)
  blendet nach 2 s ohne Maus aus.
- Farben: neue Tokens `--color-overview-bg`, `--color-overview-tile`, `--color-overview-large-bg` (Default dunkel
  auch im hellen Schema – Fotos wirken auf dunklem Grund, wie CC) in `tokens.ts`, `styles.css`, drei `themes/*.json`,
  Labels de, Kontrastpaar für den Namen auf der Kachel.

## Tastatur (im Raster; `Mod` = ⌘ bzw. Strg)

| Taste | Wirkung |
|---|---|
| `←↑→↓`, `Pos1`/`Ende`, `Bild↑`/`Bild↓` | Cursor (2-D, `moveCursor` aus CC) |
| `Shift` + Bewegung, `Leertaste`, `Einfg` | markieren wie in der Liste (Einfg: markieren + weiter) |
| `Enter`, Doppelklick | Großansicht |
| `Mod+=` / `Mod+-`, `Mod`+Mausrad | Kachelgröße |
| Buchstabe/Ziffer | springt zum ersten passenden Namen (Total-Commander-Schnellsuche, wie in der Liste) |
| `Mod+F` | Filterfeld |
| `Esc` | Filter leeren, sonst Übersicht schließen |
| `Mod+Shift+I` | Übersicht schließen |
| `F5`/`F6`/`F8`/`Shift+F8`/`F2`, `Shift+F10`/Kontextmenü | über das Aktionssystem (E15) |

Die Raster- und Baum-Tasten sind Widget-Tasten (CLAUDE.md §4: Ausnahme Widgets nach APG); alles mit einer Funktion
außerhalb des Widgets bleibt eine Aktion.

## Verträge

**Rust (neu)**

| Command / Schema | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `image_overview_open` (async) | `root: String`, `recursive: bool`, `on_event: Channel<OverviewEvent>` | `overviewId: String` | `not_found`, `not_a_directory`, `permission_denied`, `unsupported_location` (Server/Archiv) |
| `image_overview_close` (async) | `overviewId` | `()` – bricht Sammeln und offene Vorschaubilder ab | – |
| Schema `fnfthumb` | Pfad `<overviewId>.<index>.<stufe>` (`stufe` ∈ 0…3 = 160/320/640/2048) | `image/jpeg`, `Cache-Control: immutable` | 404 unbekannt/kein Bild, 415 nicht unterstützt (Platzhalter), 422 kaputt, 503 Pool voll (Wiederholung über `CoverRetries`) |

```
OverviewEvent =
  | { kind: "items", items: OverviewItem[], done: false }            // Teile ≤ 2000, Reihenfolge von Rust
  | { kind: "done", truncated: bool, unreadable: FsError[], unreadableMore: u32 }
  | { kind: "cancelled" }
OverviewItem { index: u32, path: String, name: String, size: u64, modifiedMs: Option<i64>,
               rel: String, dir: String /* Elternordner, opak */, kind: "image" | "raw" | "unsupported" }
```

- Module: `images/mod.rs` (`decode.rs` = heutiges `duplicates/images.rs`, `raw.rs` = E7, `orient.rs`),
  `image_overview/mod.rs` (Registry: max. 2 offene Übersichten, Item-Liste je Id, Abbruch-Token),
  `image_overview/thumbs.rs` (Stufen, Platten-Cache, Aufräumen), `image_overview/pool.rs` (LIFO, zusammengelegte
  Anfragen), Commands `commands/image_overview.rs`, Schema-Registrierung in `lib.rs`.
- Neuer Fehlercode `unsupported_location` in `error.rs`, `fs.models.ts`, `describeFsError()`.
- `CollectOptions { maxDepth, onlyImages }` (TS + Rust, Default `false` → 045 unverändert).

**Frontend (neu)** – `app/core/imageoverview/`: `ImageOverviewApi` (`open(root, recursive, onEvent)`, `close(id)`,
`thumbUrl(id, index, step, mtime)`), DTOs, `FakeImageOverviewApi` in `src/testing/`.
`app/features/imageoverview/`:

- `ImageOverviewStore` (Root): offen?, Ordner, rekursiv, Items (sortiert/gefiltert), Cursor, Markierung (`Set<path>`),
  Kachelgröße, Baum, Großansicht; implementiert `SelectionSource` (E15); verwirft Ereignisse alter Ids.
- `overview-logic.ts` (rein): Sortieren (natürlich, Datum, Größe, Typ), Filter, Stufe aus Breite × dpr, Markieren
  mit Shift, Cursor über Pfad nach Neuladen halten, Schnellsuche.
- `grid-math.ts`, `cover-retries.ts` (aus CC), `tile-renderer.ts` (`CellRendererIf`, nur DOM-API, `textContent`).
- Komponenten: `ImageOverview` (Kopf, Baum, Raster, Fußleiste), `OverviewGrid` (Table + `ResizeObserver`),
  `FolderTree`, `LargeView`; Texte `image-overview-texts.ts` + `.de.ts`; Aktionen `image-overview-actions.ts`.
- `action-catalog.ts`: `TOGGLE_IMAGE_OVERVIEW` (Gruppe `view`), Keymaps × 3, Menü „Ansicht“, Palette.
- `settings-schema.json`: `imageOverview.tileSize` (96…640, 200), `imageOverview.tree` (`visible`, `width`),
  `imageOverview.largeMode` (`window`|`screen`), `imageOverview.sort` – gemeinsam mit Rust (`settings.rs`).
- `WorkspaceStore.overview` (Signal mit der Auswahlquelle) + `workspace.html`/`.css` (Overlay über Zeilen 1–4,
  Panels `hidden`/`inert`); `OpsStore` fragt `ws.overview()` zuerst.

## Tests

- **Rust:** `collect` mit `onlyImages` (Grenze zählt Bilder, Unicode/Emoji, Symlink auf Bild/Ordner, nicht lesbarer
  Ordner, Abbruch); `thumbs` (Stufen, EXIF-Drehung 6/8 → Breite/Höhe vertauscht, kaputtes Bild → 422, zu großes →
  Grenze, Cache-Treffer nach Neustart, Aufräumen über 1 GiB mit kleiner Testgrenze, Schlüssel ändert sich mit mtime);
  `raw` (generierte Mini-TIFFs: eingebettetes JPEG gefunden, Offset hinter Dateiende, IFD-Zyklus, 65 IFDs → abgelehnt);
  `pool` (LIFO-Reihenfolge, zusammengelegte Anfragen, verfallene Übersicht); Schema: unbekannte Id/Index → 404, kein
  Pfad aus der URL; `command_rules` (async).
- **Frontend:** `overview-logic` (Sortierung, Filter, Stufenwahl, Shift-Markieren, Cursor halten), `grid-math` (aus CC
  samt Tests), `tile-renderer` (Escaping `<img src=x onerror=…>`, Platzhalter, Klassen), Store (Teil-Ereignisse,
  veraltete Ids, Auf/Zu ohne Verlust des Panel-Zustands, Veto, Auswahlquelle → `OpsStore`), `FolderTree` (APG-Tasten),
  `LargeView` (Blättern, Modus merken, Vollbild zurück), Texte en/de.
- **E2E (Mac, `pnpm tauri dev`):** Ordner mit 2 000 Bildern (Generator-Skript nach `scripts/`, Ausgabe nicht
  einchecken) + RAW-Probe + HEIC + kaputte Datei + Hochformat mit EXIF; Zeit bis zu den ersten Kacheln, Scrollen,
  Größe, rekursiv, Großansicht in beiden Modi, F5/F6/F8, Neustart → Kachelgröße. Screenshot-Szene `image-overview`.

## Phasen

| Phase | Inhalt |
|---|---|
| 2a | Rust: `images/` herauslösen, `collect` + `onlyImages`, Registry, `fnfthumb` mit Cache und Pool, EXIF – Commit |
| 2b | Rust: RAW-Vorschau (E7) – Commit (entfällt notfalls, dann Platzhalter) |
| 3a | Frontend: Api/Fake, Logik, Store, Grid + Renderer, Workspace-Overlay, Aktion – Commit |
| 3b | Baum, Großansicht, Auswahlquelle/Veto, Einstellungen, Tokens – Commit |
| 4–6 | E2E auf dem Mac, Doku (`architecture.md`, `roadmap.md`, `feature-parity.md`, README, CLAUDE.md), `pnpm check`, Review durch separaten Agenten (Schwerpunkt: Schema `fnfthumb` als Leck, RAW-Parser, Cache-Pfade) |

## Offene Risiken

- JPEG wird voll dekodiert (zune-jpeg skaliert nicht): ein 24-MP-Foto ≈ 150–250 ms → 2 000 Bilder beim ersten Mal
  ~2 min mit 3 Threads, nur für die sichtbaren zuerst (LIFO). Ausweg falls zu langsam: das EXIF-Vorschaubild (160 px)
  aus dem JPEG für Stufe 0 nehmen (gleicher IFD-Leser wie E7) – messen, dann entscheiden.
- Das Cover-Grid rendert beim Scrollen Zellen neu; der Renderer setzt `src` nur bei anderem Item (CC 004 Risiko 1).
- Overlay über den Panels: Panels müssen ihren `ResizeObserver` beim Wiedereinblenden richtig nachziehen (Table-Breite
  war 0, solange `hidden`) – `recalcColumnWidths()` beim Schließen.

## Vorschläge für das Mono-Repo

- Abschnittsköpfe (Gruppen) im Cover-Grid (für „rekursiv“ mit Ordnerüberschriften).
- Fokus-/Auswahlmodell und ARIA im Cover-Grid (schon CC 004 → `mono/TODO.md`).

## Abweichungen bei der Umsetzung

- **`images/`** nimmt nur die Erkennung (`kind_of`, RAW-Endungen), `decode_upright` und `raw.rs` auf; der Decoder
  selbst bleibt in `duplicates/images.rs` (er hängt am pHash der Dubletten). Neu dort: `decode_oriented`,
  `decode_bytes_oriented`, `with_permit` – beide Features teilen die vier Decode-Plätze.
- **Kein Fehlercode `unsupported_location`**: Serverpfade lehnt `image_overview_open` mit `remote_unsupported` ab,
  Archive und Ergebnis-Tabs sperrt schon das Frontend (`overviewOrigin`).
- **Liste nicht gestreamt beim Sammeln**: `collect_files` sammelt erst (schnell, Grenzen wie 045), dann gehen die
  Teile ≤ 2000 über den Channel. Netzlaufwerke bekommen keinen eigenen Faden (der Pool hat `min(4, Kerne − 1)`, die
  vier Decode-Plätze gelten app-weit).
- **Wiederholungen**: `TileRetries` = `CoverRetries` aus CC (seit Review #4, weil der volle Pool jetzt 503 antwortet).
- **RAF** (Fuji) wird gelesen (fester Kopf mit JPEG-Offset), nicht nur Platzhalter.
- **Auswahlquelle**: `OpsStore` fragt den Root-Store `ImageOverviewStore` direkt (kein Signal im `WorkspaceStore`).
- **Tokens** `--color-overview-bg/-tile/-text` gehören zur Gruppe „Allgemein“, in allen eingebauten Schemata gleich
  dunkel; Kontrastpaar „Image overview names“.
- **Noch nicht drin**: Kontextmenü auf Kacheln, Mod+A (Mod+A ist eine Panel-Aktion → in der Übersicht gesperrt),
  Ziehen ins System, Screenshot-Szene. „Im Panel zeigen“ geschieht beim Schließen (Cursor des Panels auf das Bild,
  wenn es im Ordner des Panels liegt).

## Review (separater Agent) und Fixes

Nichts Kritisches; das Schema `fnfthumb` (nur gelistete Bilder offener Übersichten), die Grenzen des RAW-Lesers und die
Commands waren in Ordnung. Behoben, je mit rotem Test zuerst:

1. **RAW: bis zu 128 Decode-Versuche je Datei** – gleiche Spannen werden zusammengelegt, nur die drei größten
   versucht (`raw.rs` `candidates`, `MAX_TRIES`; Test `spans_are_deduplicated_and_only_the_largest_few_tried`).
2. **Gemeinsamer Temp-Name zweier Worker / kaputte Cache-Datei** – Temp-Name mit Zähler, eine leere oder
   abgeschnittene Datei (ohne `FF D9`) gilt als Miss und wird neu erzeugt (`a_broken_cache_file_is_a_miss`,
   `temp_names_differ_per_write`).
3. **Fallback auf `/tmp/fnf-thumbs`** – entfällt: ohne App-Cache-Ordner nur im Speicher. `clean` steigt nur in echte
   `<xx>`-Ordner (keine Links) und löscht nur eigene Dateien (`clean_touches_only_its_own_files`).
4. **Unbegrenzte Warteschlange, Panic im Worker** – höchstens 1 000 wartende Vorschaubilder, die ältesten bekommen 503
   (das Raster fragt per `TileRetries` später erneut), eine Panic antwortet 500-artig statt den Worker zu töten
   (`a_full_queue_drops_the_oldest_with_the_fallback`, `a_panic_answers_with_the_fallback_and_the_key_works_again`).
5. **Klein**: Cache-Schlüssel SHA-256 statt FNV-64 (keine konstruierbaren Kollisionen).

## Fortschritt

- [x] Phase 1: Design (14.11.2026), freigegeben
- [x] 2a + 2b Rust (`142fc49`) · [x] 3a + 3b Frontend · [ ] 4 E2E auf dem Mac · [x] 5 Doku · [x] 6 Review (separater Agent, Befunde behoben)
