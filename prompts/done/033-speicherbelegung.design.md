# Design 033: Speicherbelegung

> **Status:** umgesetzt (21.10.2026) – freigegeben von Marc, externes Review eingearbeitet · **Datum:** 21.10.2026 · **Branch:** `feat/speicherbelegung`
> Auftrag: `prompts/033-speicherbelegung.md`. Neu (kein Gegenstück in legacy/mr) → `docs/feature-parity.md` A.4.

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Wo lebt die Ansicht? | **Tab-Art „Belegung“** im aktiven Panel (Liste = die normale Dateiliste), **Diagramm + Sammelkorb in der anderen Seite** – wie die Schnellvorschau (010 E4) |
| E2 | Diagrammart | **Sunburst (Standard) und Treemap**, umschaltbar; beide als reine Layout-Funktionen, SVG |
| E3 | Löschen | **Markierung = Sammelkorb** (scanweit, über alle Ebenen), F8/Entf wie gewohnt; ein Job `delete` mit `expected` |
| E4 | Datenhaltung | **Baum in Rust** (Arena, ≈ 60–100 B je Knoten), Frontend fragt nur sichtbare Ebenen ab; max. 3 Scans, Freigabe mit dem Tab |
| E5 | „Laufwerk“ | Wurzel des Volumes des aktiven Panels (Rust ermittelt sie); macOS: System- **und** Data-Volume als eine Einheit, Ordner per (Gerät, Inode) nur einmal |
| E6 | Größe | **belegt** (Blöcke) als Standard, logisch per Einstellung; Tooltip zeigt beide |
| E7 | `dirsize.rs` | **getrennt lassen**; eigener paralleler Walker in `disk_usage/` |
| E8 | Kürzel | `OPEN_DISK_USAGE` = **`Mod+Shift+D`** auf allen OS (frei, per Skript geprüft); Laufwerk ohne Kürzel (Palette, Ordnermenü) |

## Bestand → wofür → passt / fehlt

| Baustein | wofür | Befund |
|---|---|---|
| `dirsize.rs` (003 E7) | Muster: iterativ, keine Symlinks, Gerätegrenze, unlesbar zählen, Abbruch | passt als Vorlage; fehlt: Baum, belegte Größe, Hardlinks, Parallelität, macOS-Firmlinks |
| Job-Engine (005): `JobSpec`, `manager.rs` (`validate`, `run`), `Progress`, `is_helper`, `is_parallel` | Scan als Job mit Fortschritt/Abbruch | passt; neue Art `diskUsage` (parallel, Helfer) |
| `jobs/expect.rs` (030 E5) | Löschen aus veraltetem Stand | passt: Dateien Art/Größe/mtime, Ordner nur Art – s. E3 |
| `paths::DangerCheck` (006 E7, Review 024/031) | Wurzel/Home/System beim Löschen | passt unverändert (`/Applications`, `/Users`, `/System/**`, `C:\Windows` …) |
| `drop_nested` (`jobs/mod.rs`) | verschachtelte Wurzeln | passt (Wurzeln *und* Korb) |
| `platform/volumes.rs` (`statvfs_space`, `GetDiskFreeSpaceExW`) | Laufwerksbalken gesamt/frei | passt, Funktion öffentlich machen |
| Ergebnis-Tabs (009 E4/016 E6): `TabState.search`, `SearchStore`, `FileBrowserStore.showSearch`, `searchKey`, versteckte Spalten `dir`/`group` | Tab ohne echtes Verzeichnis, Zeilen in der normalen Liste, F8 entfernt aus dem Ergebnis | Muster passt; **muss erweitert werden**: Navigation *innerhalb* des Ergebnisses (heute gesperrt), Sortierung ohne „Ordner oben“ |
| `QuickViewStore` (010 E4) | Inhalt in der inaktiven Seite, folgt dem Cursor | Muster für Diagramm + Korb |
| `OpsStore.openDelete`/`runDelete`/`afterJob` | Löschdialog, Danger-Bestätigung, Ergebnis aktualisieren | passt; `afterJob` ruft zusätzlich `DiskUsageStore.prune` |
| `file-columns.ts` (`isVisible: FalseFn`-Spalten) | Spalten „Anteil“ (Balken) und „Inhalt“ | erweitern (zwei Spalten + Renderer) |
| Farbschema-Tokens (013/019, Rezept CLAUDE.md §9) | Diagrammfarben | neue Tokens (s. Farben) |
| Einstellungen (015, `settings-schema.json` gemeinsam) | Optionen | Gruppe `diskUsage.*` ergänzen |
| GuiExpert Table | Liste | Baumzeilen **nicht nötig** (Liste zeigt eine Ebene, wie Disk Drill rechts); keine Table-Lücke erwartet |

## E1 – Wo lebt die Ansicht?

```
(a) EMPFOHLEN: Tab + Diagramm in der anderen Seite        (b) beides in einer Seite
┌─ links (aktiv) ───────────────┬─ rechts ──────────────┐ ┌─ links ───────────────────────┬─ rechts ─┐
│ Belegung: ~/Projekte ▸ fnf    │ ◐ Sunburst | ▦ Treemap│ │ Liste (schmal)  │  Diagramm   │ normaler │
│ 38,2 GB · 412 103 Objekte     │      ╭────╮           │ │                 │  (klein)    │ Ordner   │
│ Name      Größe  Anteil Inhalt│    ╭─┤38 GB├─╮        │ │                 │             │          │
│ ..                            │    ╰─┴────┴─╯         │ └─────────────────┴─────────────┴──────────┘
│ target   21,4 GB ██████  …    │ ─────────────────────│  Platz fürs Diagramm halbiert, zweite Seite
│ node_mod  9,8 GB ███     …    │ Sammelkorb (3) 31,6 GB│  bleibt ungenutzt.
│ 12 kleinere Dateien  1,1 GB   │  target   21,4 GB  ✕  │ (c) Overlay/Vollbild: verdeckt die Panels,
├───────────────────────────────┤  …     [Entfernen…]   │     eigene Tastatur-/Fokuswelt, kein Panel-
│ Status: 38,2 GB · frei 112 GB │                       │     Kontext. (d) eigenes Fenster: Tauri-
└───────────────────────────────┴───────────────────────┘     Mehrfenster, Sitzung, Menüs – teuer.
```

**Empfehlung (a).** Die Liste *ist* die bestehende Dateiliste (Cursor, Markierung, Sortierung, Kontextmenü, F8,
Tastatur, Screenreader) – nichts davon wird neu gebaut. Das Diagramm bekommt eine ganze Seite. Wechselt der Nutzer mit
`Tab` auf die andere Seite, verschwindet das Diagramm und dort steht wieder der normale Ordner (wie die
Schnellvorschau, `shownOn = otherSide(activeSide)` solange der aktive Tab ein Belegungs-Tab ist). Das passt zum
Dual-Pane-Gefühl: man kann mit der anderen Seite weiterarbeiten und kommt mit `Tab` zurück.

- Tab-Titel „Belegung: <Name>“, Kopf (statt Pfad-Header, wie bei der Suche): Brotkrumen ab Scan-Wurzel (Segmente
  liefert Rust), Größe, Objekte, Stand („vor 3 min“), Hinweise *unvollständig / n nicht lesbar / vereinfacht*,
  Knöpfe *Stopp*, *Neu scannen*. Statuszeile: Laufwerksbalken *belegt (gescannt) · nicht erfasst · frei*.
- Sitzung: der Tab wird wie ein Such-Tab **nicht** gespeichert; nach Neustart steht dort der Ordner des zuletzt
  gezeigten Knotens (`rootTitle`-Mechanik, 009 E4).
- Mehrere Belegungs-Tabs sind möglich (je eigener Scan, max. 3 im Speicher – E4).

## E2 – Diagramm

**Sunburst als Standard, Treemap umschaltbar** (Knöpfe im Diagrammkopf + Einstellung `diskUsage.chart`).
Sunburst zeigt die Hierarchie (Baobab, Vorlage 1), Mitte = aktueller Knoten (Klick = hinauf); Treemap (squarified)
zeigt große Einzeldateien tief im Baum am deutlichsten (Disk Drill, Vorlage 2). Beide teilen Datenbeschaffung,
Farben, Tooltip und Interaktion; Aufwand des zweiten Layouts ≈ eine reine Funktion + Tests.

- **Layout rein** (`sunburst-layout.ts`, `treemap-layout.ts`): Eingabe = gekürzter Baum aus Rust, Ausgabe =
  Segmente `{nodeId, depth, a0, a1, r0, r1}` bzw. Rechtecke. Sunburst: Winkel ∝ Größe, max. Tiefe
  `diskUsage.rings` (Standard 4), Segmente < 0,5° fallen in ein Sammelsegment je Elternteil. Treemap: max. Tiefe 3,
  Mindestfläche 24 px², Ordner mit Innenabstand für die Kinder.
- **SVG** in einer Angular-Komponente, Pfade per `d`, Beschriftung über `textContent` (Dateinamen = Nutzerdaten,
  nie `innerHTML`), nur wenn Platz (Bogenlänge/Rechteckbreite ≥ Textbreite). Grenze ≈ 1500 Segmente.
- **Interaktion:** Hover = Tooltip (Name, Größe belegt/logisch, Anteil am aktuellen Knoten, Objekte) und Hervorhebung
  der Zeile; Klick auf ein Ordnersegment = hineinnavigieren, Klick auf eine Datei = Cursor dorthin; Cursor in der
  Liste hebt das Segment hervor. Übergang animiert (200 ms), aus bei `prefers-reduced-motion`.
- **Barrierefreiheit:** Die Liste ist die bedienbare Fläche (alles per Tastatur); das SVG ist `role="img"` mit
  `aria-label` („Ringdiagramm: target 56 %, node_modules 26 %, …“ – die größten fünf). Segmente sind nicht
  fokussierbar (doppelte Tab-Stopps vermeiden). Unlesbar/Sammelposten zusätzlich per Schraffur bzw. gestrichelter
  Kante (nicht nur Farbe).
- **Farben:** Farbton je Kind der aktuellen Ebene (8 kategoriale Tokens, zyklisch), tiefere Ringe heller
  (Mischung mit `--color-surface`, berechnet mit `color.ts`). Feste Tokens für Sammelposten, Dateien-Rest,
  unlesbar, frei, nicht erfasst. Treemap wahlweise „nach Größe“ (grün → orange → rot, Disk Drill) – Einstellung
  `diskUsage.colorBy: 'branch' | 'size'`.

## E3 – Löschen

**Markierung = Sammelkorb.** Im Belegungs-Tab gilt *eine* Markierungsmenge für den ganzen Scan (nicht je Ebene):
`Space`/`Insert`/Klick markieren wie gewohnt (Leertaste berechnet hier keine Ordnergröße – die steht schon da).
Der Korb unter dem Diagramm zeigt alle markierten Einträge über alle Ebenen mit Größe und Pfad relativ zur
Scan-Wurzel, Summe, `✕` je Eintrag, *Leeren*, *Entfernen…*. Liegt ein markierter Ordner über einem markierten
Eintrag, wird der innere zusammengefasst (`drop_nested`-Logik, Summe ohne Doppelzählung) und grau als „im Ordner
enthalten“ gezeigt.

- **F8/Entf** (bzw. *Entfernen…*) = bestehender Löschdialog mit den Korb-Einträgen (sonst Eintrag unter dem
  Cursor), Papierkorb Standard, Shift = endgültig, Danger-Rückfrage wie immer. **Ein** Job `delete`.
- **`expected` immer** (der Scan ist per Definition ein alter Stand): Dateien Art + Größe + mtime, Ordner Art
  (Rust-Regel aus 030 E5). Geänderte Dateien bleiben liegen und stehen im Fehlerprotokoll. Für Ordner zeigt der
  Dialog zusätzlich „Stand des Scans: vor n min“ – bei *endgültig* fett.
- Nach dem Job: `disk_usage_prune(scanId, paths)` – Rust entfernt nur Knoten, deren Pfad **wirklich nicht mehr
  existiert**, und korrigiert Summen bis zur Wurzel; Liste, Diagramm, Korb aktualisieren sich ohne Neu-Scan.
  Panels frischen wie immer über `dirsChanged` auf.
- Ziehen in den Korb (DragStore-Zone, 012/028): **Folge**, nicht in 033 – Markieren deckt den Bedarf.
- Aggregat-Zeilen („12 kleinere Dateien“, „Rest“) sind nicht markierbar/löschbar (`virtual`).

## E4 – Datenhaltung und Verträge

### Rust: Baum (`src-tauri/src/disk_usage/`)

- `tree.rs`: Arena `Vec<Node>`, Namen in einem gemeinsamen `String`-Puffer (Offset u32 + Länge u16), `parent: u32`,
  Kinder als `Vec<u32>` je Ordner (nach Abschluss nach Größe sortiert), Summen `alloc`, `logical`, `files`, `dirs`,
  `newest_ms`, `unreadable`. Datei-Knoten nur für (a) die **16 größten Dateien je Ordner** und (b) **alle Dateien
  ≥ 1 MiB**; der Rest je Ordner als Zähler + Summe („n kleinere Dateien“). Damit ist „Größte Dateien“ für alles
  ≥ 1 MiB exakt, und ein Home-Ordner mit ~3 Mio. Dateien bleibt geschätzt < 200 MB (Messung in Phase 2,
  Ziel ≤ 100 B/Knoten ohne Namen). Harte Obergrenze 4 Mio. Knoten → danach nur noch Ordner + Aggregat, Flag
  `simplified`.
- Summen wachsen **während** des Scans (jede Datei addiert entlang der Elternkette) → Teilergebnisse sind jederzeit
  abfragbar. `RwLock<Tree>`, Schreiben je Ordner gebündelt.
- `walk.rs`: eigene Worker (`min(8, Kerne)`, std-Threads + gemeinsame Warteschlange, keine neue Crate), je Ordner
  `read_dir` + `symlink_metadata`. Regeln:
  - Symlinks nie folgen (Knoten Art `link`, eigene Größe). Windows: Reparse-Points (Junctions) ebenso.
  - Ordner per **(Gerät, Inode)** nur einmal (Bind-Mounts, macOS-Firmlinks); Dateien mit `nlink > 1` per
    (Gerät, Inode) nur einmal gezählt (Unix). Windows: Hardlinks werden mehrfach gezählt (wie Explorer; `std`
    bietet den Datei-Index nicht stabil) – dokumentiert.
  - Dateisystemgrenze: erlaubt ist eine **Gerätemenge** (Standard: Gerät der Wurzel; macOS-Laufwerk: + Data-Volume,
    E5). Fremde Einhängepunkte werden als Knoten Art `mount` (Größe unbekannt, „nicht gescannt“) gezeigt. Option
    `diskUsage.crossFilesystems` (Standard aus). `/proc`, `/sys`, `/dev` bleiben über die Gerätegrenze draußen.
  - Unlesbare Ordner: Knoten mit `unreadable`, zählen in die Summe „n nicht lesbar“; nie abbrechen.
  - Belegte Größe: Unix `blocks()*512`; Windows logische Größe auf Clustergröße aufgerundet, exakt per
    `GetCompressedFileSizeW` nur für komprimierte/Sparse-Dateien (Attribute aus der Aufzählung) – hinter
    `platform/`. **Nie Dateiinhalte öffnen** (Cloud-Platzhalter von iCloud/OneDrive würden geladen).
  - Abbruch über das Job-Token; danach bleibt der Baum (Flag `complete = false`).
- Parallel vs. Einzel-Thread wird in Phase 2 gemessen (generierter Baum 200 000 Einträge, Release-Build, im Design
  notiert); bringt Parallelität < 1,3×, bleibt es beim Einzel-Thread.

### Job

```rust
JobSpec::DiskUsage {
    roots: Vec<String>,          // ≥ 1, normalisiert; verschachtelte → drop_nested
    #[serde(default)] volume: bool,            // true: genau 1 Wurzel → deren Volume-Wurzel scannen (E5)
    #[serde(default)] rescan: Option<Rescan>,  // { scanId, nodeId }: Teilbaum ersetzen
    #[serde(default)] options: DiskUsageOptions, // { crossFilesystems, sizeMode: "allocated"|"logical" }
}
```

`kind() = "diskUsage"`, `is_parallel() = true`, `is_helper() = true`. **Scan-Id = Job-Id.** `Progress`:
`items_done` (Einträge), `bytes_done` (belegt), `current` (Ordner – nicht geloggt). `Summary.disk_usage =
{ complete, entries, unreadable, simplified, elapsedMs }`. Validierung: Wurzeln existieren und sind Ordner,
keine virtuellen Archivpfade, ≤ 64 Wurzeln; `rescan` nur auf einen vorhandenen Scan/Ordnerknoten.

### Commands (`commands/disk_usage.rs`, alle async, `spawn_blocking`)

| Command | Parameter | Rückgabe |
|---|---|---|
| `disk_usage_view` | `scanId, nodeId: u32 \| null (=Wurzel), depth: 1..6, minFraction: f64, fileLimit` | `DiskUsageView { node: UsageNode, crumbs: Crumb[], children: UsageNode[] (rekursiv bis depth, Kleines als Aggregat), volume?: VolumeSpace, running, complete, simplified, scannedAtMs, version }` |
| `disk_usage_largest` | `scanId, nodeId, limit ≤ 500` | `UsageFile[]` (Pfad, relativer Ordner, Größen, mtime) |
| `disk_usage_locate` | `scanId, path` | `nodeId \| null` (Korb ↔ Knoten, „im Panel zeigen“ zurück) |
| `disk_usage_prune` | `scanId, paths` | `DiskUsageView` der Wurzel-Summen (entfernt nur, was nicht mehr existiert) |
| `disk_usage_release` | `scanId` | – (bricht laufenden Scan ab) |

```ts
interface UsageNode {
  id: number; name: string; path: string | null;   // null: virtuelle Wurzel „Auswahl“, Aggregate
  kind: 'dir' | 'file' | 'link' | 'mount' | 'files' | 'rest';   // files = „n kleinere Dateien“, rest = Kleines
  allocated: number; logical: number; files: number; dirs: number;
  modifiedMs: number | null; unreadable: number; children?: UsageNode[];
}
```

Neue Fehlercodes: `scan_not_found` (Scan freigegeben/unbekannt), `scan_busy` (Teilbaum wird gerade neu gescannt) –
in `error.rs`, `fs.models.ts`, `describeFsError()`. Hub `DiskUsageHub` als Tauri-State: max. **3 Scans** (LRU),
`release` beim Schließen des Tabs (wie `searchKeys`).

### Frontend

- `core/diskusage/`: `DiskUsageApi` (Fassade), DTOs; `testing/fake-disk-usage-api.ts`.
- `features/diskusage/`: `DiskUsageStore` (Root: Scans, aktueller Knoten je Tab, Verlauf zurück/vor, Korb je Scan,
  Abfrage gedrosselt – während des Scans alle 500 ms nur für sichtbare Tabs), `usage-rows.ts` (rein: `UsageNode` →
  Zeilen der Dateiliste inkl. `..` und Aggregaten), `sunburst-layout.ts`, `treemap-layout.ts`, `usage-colors.ts`,
  `basket-logic.ts` (rein: Verschachtelung, Summe), `disk-usage-chart.ts` + `usage-basket.ts` (andere Seite),
  `disk-usage-actions.ts`, Texte en/de.
- Workspace: `TabState.usage?: { scanId, label, rootTitle }` neben `search`; `FileBrowserStore.showUsage(rows)`
  analog `showSearch`; Navigation im Belegungs-Tab geht an den `DiskUsageStore` (`NAVIGATE_OPEN`,
  `NAVIGATE_PARENT`, `NAVIGATE_BACK/FORWARD`, `RELOAD_DIR` = Teilbaum neu scannen).
- Liste: Spalten `share` (Balken + %, `CellRendererIf`, Breite 110 px) und `items` (Objekte) nur im Belegungs-Tab
  sichtbar; dort Standardsortierung **Größe absteigend ohne „Ordner oben“** (eigener Comparator), Name/Datum
  weiter sortierbar.
- `OpsStore.afterJob`: in einem Belegungs-Tab `prune` statt `search.removePaths`.

## E5 – Laufwerk als Startpunkt

- Einstiege: `OPEN_DISK_USAGE_VOLUME` („Belegung des Laufwerks“) in Palette und Menü; im Ordnermenü (011) je
  Laufwerk ein Eintrag „Belegung analysieren“. Rust bestimmt die Volume-Wurzel (`volume: true`): Unix aufwärts,
  solange das Gerät gleich bleibt; Windows Präfix + Wurzel (`C:\`, `\\srv\share\`). Kein „alle Laufwerke“.
- **macOS (bei Marc prüfen):** `/` ist das versiegelte System-Volume, Nutzerdaten liegen auf
  `/System/Volumes/Data` und erscheinen über Firmlinks (`/usr/share/firmlinks`: `/Users`, `/Applications`,
  `/Library`, `/private`, `/usr/local` …) unter `/`. Eine reine Gerätegrenze schnitte `/Users` ab (anderes `st_dev`),
  eine naive Rekursion zählte sie doppelt. Lösung: Gerätemenge = {dev(`/`), dev(`/System/Volumes/Data`)},
  `/System/Volumes/Data` selbst wird übersprungen (die Inhalte kommen über die Firmlinks unter ihren gewohnten
  Pfaden), Ordner per (Gerät, Inode) nur einmal. Was nur auf dem Data-Volume liegt (`.Spotlight-V100`,
  `.fseventsd`, Snapshots, purgeable) landet in „nicht erfasst“. Prüfbefehl für Marc:
  `stat -f '%d %i %N' / /Users /System/Volumes/Data /System/Volumes/Data/Users`.
- „Nicht erfasst“ = (gesamt − frei) − gescannt belegt, nur bei Laufwerks-Scans und nur wenn ≥ 0.

## E6 – belegt oder logisch

Standard **belegt**: Ziel ist freier Platz; Sparse-Dateien, APFS-Kompression und Cloud-Platzhalter (iCloud
„optimiert“, OneDrive „nur online“) haben logisch viel und belegt wenig. Spalte und Diagramm folgen
`diskUsage.sizeMode`, der Tooltip zeigt beide. APFS-Klone werden voll gezählt (nicht billig erkennbar) – Hinweis im
Hilfetext, warum die Summe größer sein kann als Finder es anzeigt.

## E7 – Verhältnis zu `dirsize.rs`

Getrennt. `dirsize` ist schnell, einzeln, logisch und füttert die Statuszeile (003/018 mit Tests); seine Semantik zu
ändern ändert sichtbare Zahlen. `disk_usage/walk.rs` darf `device_of` u. Ä. aus `dirsize` übernehmen (in ein
gemeinsames kleines Modul verschieben). Zusammenlegen ist eine mögliche Folge.

## E8 – Aktionen und Kürzel

| Aktion | Kürzel | Wo |
|---|---|---|
| `OPEN_DISK_USAGE` „Speicherbelegung…“ | `Mod+Shift+D` (macOS `⌘⇧D`, sonst `Ctrl+Shift+D`) | Palette, Menü *Befehle*, Kontextmenü (Ordner), Actions-Menü |
| `OPEN_DISK_USAGE_VOLUME` „Belegung des Laufwerks…“ | – | Palette, Menü *Befehle*, Ordnermenü je Laufwerk |
| `DISK_USAGE_TOGGLE_CHART` „Ring/Kacheln“ | – (Knopf) | Diagrammkopf, Palette (nur im Belegungs-Tab) |
| `DISK_USAGE_LARGEST` „Größte Dateien“ | – (Knopf) | Kopf, Palette (nur im Belegungs-Tab) |

Wurzeln: markierte Ordner (Dateien unter den Markierten werden ignoriert, Hinweis), sonst Ordner unter dem Cursor,
sonst (Cursor auf `..`/Datei) der aktuelle Ordner. Gesperrt (Hinweis): Archive (virtuelle Pfade), Such-/Duplikat-Tab,
ungeprüftes Listing (030 – Pfade unsicher). Netzlaufwerke erlaubt, Hinweis „kann lange dauern“. `Ctrl+Shift+U`
bewusst nicht (GTK-Unicode-Eingabe unter Linux).

„Größte Dateien“: der Belegungs-Tab zeigt statt der Kinder die größten Dateien des aktuellen Teilbaums (Spalte
`dir` relativ zur Scan-Wurzel sichtbar, wie Suchtreffer); Enter = zum Ordner der Datei im Scan navigieren.

## Einstellungen (015)

`diskUsage.sizeMode` (`allocated`), `diskUsage.crossFilesystems` (false), `diskUsage.chart` (`sunburst`),
`diskUsage.rings` (4, 2–6), `diskUsage.colorBy` (`branch`), `diskUsage.minSegment` (0,5 °/24 px² intern fest,
nicht einstellbar), `diskUsage.largestCount` (100, 10–500). Versteckte Einträge zählen immer (der Platz ist
belegt); die Liste zeigt sie nach der Hidden-Einstellung des Tabs.

## Farben (neue Tokens, Rezept CLAUDE.md §9)

`--color-usage-1` … `--color-usage-8` (kategorial), `--color-usage-files` (n kleinere Dateien),
`--color-usage-rest`, `--color-usage-unreadable`, `--color-usage-free`, `--color-usage-uncounted`,
`--color-usage-bar` (Anteil-Balken in der Liste). In `styles.css` + `themes/{light,dark,crimson}.json`, deutsche
Labels, Kontrastpaar Beschriftung ↔ Segment (Beschriftung schwarz/weiß nach Kontrast gewählt), alte Designs über
Defaults; `docs/legacy-themes-contrast.md` neu erzeugen.

## Tests

- **Rust** (`tempfile`): Summen belegt/logisch; Sparse-Datei (Linux: belegt < logisch); Hardlink-Paar einmal;
  Symlink auf Datei/Ordner/dangling/Zyklus; Bind-Mount-artige Doppelung über (Gerät, Inode) (Ordner-Symlinks
  reichen dafür nicht – Hilfsfunktion direkt testen); unlesbarer Ordner (ohne root); Gerätemenge (Fake-Gerätefunktion
  injizierbar, damit der Firmlink-Fall auf Linux testbar ist); Unicode/Leerzeichen/Emoji/nicht-UTF-8; verschachtelte
  Wurzeln + virtuelle Wurzel; Abbruch mit Teilergebnis; Top-16 + ≥ 1 MiB + Aggregat; `view` (Tiefe, minFraction,
  Sortierung, Krumen); `largest` exakt; `prune` (nur Verschwundenes, Summen bis zur Wurzel); `rescan`; LRU/`release`;
  Knotengrenze → `simplified`; Wire-Format; Validierung (Archivpfad, Datei als Wurzel, zu viele Wurzeln).
  Leistung (ignoriert in `cargo test`, eigener Lauf): 200 000 Einträge, Einzel- vs. Mehr-Thread.
- **Frontend** (Vitest): Layouts (Winkelsumme = 360°, Mindestwinkel → Sammelsegment, Tiefe; Treemap-Flächen
  proportional ± 1 %, keine Überlappung, deterministisch), Farben/Kontrast, `usage-rows`, `basket-logic`
  (Verschachtelung, Summe), Store (Scan starten/abbrechen, Drosselung, Navigation/Verlauf, Korb, Löschen mit
  `expected`, `prune` nach Job, Freigabe beim Tab-Schließen), Sperren (Archiv, Ergebnis-Tab, ungeprüft), Einstiege
  (Wurzelwahl), Spalten nur im Belegungs-Tab, Texte en/de.
- **E2E** (Xvfb): Akzeptanzkriterien 1–11 mit Testbaum (große/kleine Dateien, Umlaute, Emoji, versteckt, Symlink,
  Hardlink, gesperrter Ordner); Screenshots light/dark/norton; Szene `disk-usage` in `scripts/screenshots/`.
  macOS (Firmlinks, APFS) und Windows (belegte Größe, Laufwerke) bei Marc bzw. CI.
- **Review** (separater Agent): Löschen aus veraltetem Scan, Korb-Verschachtelung, Walker-Grenzfälle,
  Speicher, keine Pfade in Logs, keine Nutzerdaten in `innerHTML`.

## Phasen

1. Design (dieses Dokument) 🛑 · 2. Rust (`disk_usage/`, Job, Commands, Messung) · 3. Frontend (Tab, Liste,
Diagramm, Korb, Aktionen, Einstellungen, Tokens) · 4. E2E · 5. Doku (`architecture.md`, `roadmap.md`,
`feature-parity.md` A.4, `features.md`, README, CLAUDE.md-Layout) · 6. Abschluss + Review.

## Nicht im Umfang

Erhöhte Rechte, Snapshots/purgeable aufschlüsseln, Scans über Neustart speichern, Aufräum-Vorschläge, Ziehen in den
Korb, Windows-Hardlink-Erkennung.

## Fortschritt

- 21.10.2026: Bestand gelesen, Design geschrieben, von Marc freigegeben („go“).
- Phase 2 (Rust) fertig: `disk_usage/{mod,tree,walk,tests}.rs`, `platform/disk_usage.rs`, Job `jobs/disk_usage.rs`
  (+ `tests_disk_usage.rs`), `commands/disk_usage.rs`, Fehlercodes `scan_not_found`/`scan_busy`.
  **Messung** (Container, 2 Kerne, Release, `measure`-Test): generiert 200 000 Dateien/2100 Ordner – 1 Thread
  0,43 s, 2 Threads 0,25 s; `/usr` (142 000 Dateien, 15 000 Ordner, warmer Cache) – 1 Thread kalt 2,5 s, 2 Threads
  0,41 s, 8 Threads 0,26 s → Worker = 2 × Kerne, 4–8. Knoten 136 B + Name (über dem Ziel ≤ 100 B) →
  `MAX_NODES` 3 Mio. (≈ 0,5 GB höchstens). Abweichung vom Entwurf: ein vor dem Start abgebrochener Scan legt keinen
  Baum an (`scan_not_found` – das Frontend zeigt „abgebrochen“).
- Phase 3 (Frontend) fertig: `core/diskusage/`, `features/diskusage/` (Store, Zeilen, Korb, Layouts, Farben, Chart,
  Renderer, Aktionen, Texte en/de), Anbindung in `FileBrowserStore` (`ResultKind 'usage'`, `usageNav`,
  `markedOverride`, synthetische Zeilen nie markierbar), `FilePanel` (Kopf, Chart in der anderen Seite), `OpsStore`
  (`expected` + Alter des Scans, `prune` nach Delete/Move), Spalten `share`/`items`, Menüs, Keymaps, Tokens.
  **Abweichungen vom Entwurf** (bewusst klein gehalten): Einstellungen nur `sizeMode`, `crossFilesystems`, `chart`
  (Ringtiefe 4, „Größte Dateien“ 100 und Farbe nach Zweig fest – der Dialog kennt keine Zahlenfelder, `colorBy`
  entfällt); im Belegungs-Tab werden versteckte Einträge immer gezeigt (der Platz ist belegt; Rust kennt das
  Windows-Attribut dort nicht); die Umschalter Ringe/Kacheln und „Größte Dateien“ stehen im Menü *Ansicht*; Rename,
  Anlegen, Attribute, Multi-Rename usw. sind im Belegungs-Tab gesperrt (Veto `OFF_IN_USAGE`), Kopieren/Verschieben
  gehen (Verschieben prunt danach wie Löschen).
- Phase 4 (E2E, Xvfb, Debug-Build): Ordner, Auswahl aus zwei Ordnern (virtuelle Wurzel „Auswahl“) und das ganze
  Laufwerk `/` des Containers (433 000 Objekte, 21 GB, ≈ 13 s, wächst sichtbar, Laufwerksbalken) gescannt;
  hinein/hinaus per Enter/Backspace/Brotkrume, Markieren auf zwei Ebenen → Korb → `F8` → Papierkorb, Summen ohne
  neuen Scan korrekt; eine nach dem Scan geänderte Datei bleibt liegen (Fehler in Tasks); Sparse-Datei 0 B belegt,
  Hardlink einmal, Symlink 0 B, „Größte Dateien“ mit Ordnerspalte, Ringe und Kacheln mit Tooltip. Dabei behoben:
  Klick ins Diagramm aktivierte die andere Seite (Diagramm verschwand), Spalten *Ext*/*Geändert* im Belegungs-Tab
  ausgeblendet (Name hatte keinen Platz), Beschriftungen bleiben im Ring, Köpfe der Ordner-Kacheln, Cursor nach
  „hinauf“ kommt mit den Zeilen. Dunkles Design per `GTK_THEME` nicht sichtbar geworden (Schema in der Sitzung fest
  hell) – Tokens für dark/crimson geprüft nur per Test.

## Externes Review (separater Agent, 21.10.2026) – alle Befunde behoben

| # | Befund | Behebung |
|---|---|---|
| 1 hoch | F8 in einem Ordner-Tab, der im selben Panel noch lädt, löschte den Korb des Belegungs-Tabs | `isUsage()` verlangt die Zeilen des Scans im Listing; `leaveResult()` beim Tab-Wechsel; Test |
| 2 | Nach „Neu scannen“ alte Ids im Korb → verdeckte Einträge gelöscht | Markierungen unterhalb des neu gescannten Ordners fallen weg; Test |
| 3 | Rescan neben dem ersten Walk, Batches entfernter Ordner zählten weiter | Rust: Rescan nur nach dem Walk (`scan_busy`), `add_entries`/`set_dir_self`/… ignorieren entfernte Ordner; Tests |
| 4 | Windows: jeder Reparse-Point als Link | nur `is_symlink()` (Symlink, Junction); bei Marc/CI prüfen |
| 5 | Graft vergrößert die Arena unbegrenzt | Graft verweigert über `MAX_NODES` (Fehler „neu als Ganzes scannen“); Test |
| 6 | Verdrängter Scan: Tab mit Korb, Prune scheitert | `scan_not_found` leert Zeilen und Korb; Test |
| 7 | Pfade unter nicht-UTF-8-Ordnern verlustbehaftet | Rust markiert sie `lossyName`, Frontend schickt sie nie an Rust (virtueller Pfad, nur per Id navigierbar); Tests |
| 8 | Markierung bei gleichzeitiger Abfrage verloren | Effekt Markierungen → Korb läuft vor dem Anzeigen |
| 9 | „Größte Dateien“ ohne vollständige Ahnen | `UsageFile.ancestors` aus Rust; Test |
| 10 | Abgebrochener Job nahm Einträge aus dem Korb | `prune` liefert die wirklich entfernten Pfade, nur die gehen; Test |
| 11 | Fremdes Laufwerk (0 B) markier- und löschbar | Zeilen `mount` haben einen virtuellen Pfad (nicht markierbar, nie an Rust) |
| 12 | Doku zu `MAX_NODES` falsch | Kommentar korrigiert (Ordner über dem Limit werden gezählt, ihr Inhalt fehlt) |
| 13 | Synthetische Zeile ziehbar | `dragSources` filtert virtuelle Pfade; Test |

## Nachtrag (Marc, 21.10.2026): lange Löschoperationen sichtbar machen

Einträge, die ein laufender Job `delete`/`move`/`clean` entfernt (`JobsStore.removing`: Pfad → Fortschritt 0–1 bzw.
`null`), bekommen in jeder Dateiliste die Zeilenklasse `fnf-removing` (durchgestrichen, kursiv, gedämpft, schraffiert);
die Größenspalte zeigt Kreisel + Prozent (Kreisel per negativer `animation-delay` im Takt der Uhr, weil Zellen bei
jedem Repaint neu entstehen). Neu gezeichnet wird nur, wenn sich die Menge oder der Fortschritt in 5-%-Schritten
ändert (`removingShown`) – ein Repaint je Fortschrittsereignis ließ die Liste flackern. Diagramm: betroffene Segmente
und ihr Inhalt pulsieren (aus bei `prefers-reduced-motion`), Korb-Einträge durchgestrichen. Tests: `jobs.store.spec`
(Menge, Fortschritt, Ende), `file-table-model.spec` (Klasse); E2E mit 120 000 kleinen Dateien (endgültig löschen)
in Ordner- und Belegungs-Tab.
