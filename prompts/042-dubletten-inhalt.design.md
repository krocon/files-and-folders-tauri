# Design 042: Dubletten nach Inhalt, Regeln zum Behalten, ähnliche Bilder und Comics

> **Status:** Entwurf – 🛑 wartet auf Freigabe · **Datum:** 22.10.2026 · **Branch:** `feat/dubletten-inhalt`
> Auftrag: `prompts/042-dubletten-inhalt.md` (Marc, 21.10.2026). Baut auf 016 E6 (Job `duplicates`), 009 E4
> (Ergebnis-Tabs), 010 E3 (`fnfpreview`), 025 (Archive lesen), 030 E5 (`expected`), 033 E1/E3 (Ansicht in der anderen
> Seite, Löschen aus altem Stand) auf. Neue Crate: `image` (nur Decoder, pure Rust) – E6.

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E1 | Ergebnis im 016-Tab erweitern oder eigener Tab-Typ? | **016-Tab erweitern** (`kind = 'duplicates'`), Gruppen-Vorschau in der **anderen Seite** wie 033 |
| E2 | Regeln im Frontend oder in Rust? | **Engine rein im Frontend** (`duplicates-rules.ts`); Rust liefert nur Fakten je Treffer (Auflösung, Seiten, Links, Fundreihenfolge) |
| E3 | Hash-Cache: Speicher oder Datei? | **Nur im Speicher**, je App-Sitzung, begrenzt; Schlüssel Gerät+Inode+Größe+mtime(ns)+Pfad |
| E4 | Hardlinks | **„gleiche Datei“**, nie löschbar; Windows-Fehler in 016 beheben (`file_id` → `entry_id`) |
| E5 | Löschen | **eigener Job `dedupe`**: je Gruppe Prüfung der behaltenen Datei **und Bytevergleich** vor jedem Löschen; F8 im Dubletten-Tab öffnet diese Bestätigung |
| E6 | Ähnliche Bilder | eigener **pHash (DCT, 64 Bit)** über Crate `image` (ohne `image_hasher`), Gruppierung „Zentrum + Radius“ mit BK-Baum, HEIC/AVIF ⬜ |
| E7 | Comics | Fingerabdruck = Seitenzahl + pHash von Titel und 3 Seiten, Entnahme über `extract::run` (alle 025-Grenzen) |
| E8 | Ersetzen durch Hardlink/Symlink | **bewusst ✖** (spätere Änderung einer „Kopie“ ändert alle; Backups/Sync-Tools; Volumes) – „in Ordner verschieben“ ✅ |
| E9 | Kürzel | Enter/Doppelklick = „diese behalten“, Leertaste = umschalten, F8 = Dubletten löschen… (alles nur im Dubletten-Tab), sonst keine neuen Kürzel |

## 1. Bestand → wofür → passt / fehlt

| Baustein | wofür | Befund |
|---|---|---|
| `duplicates.rs` (016 E6): `search::walk` → Größe(+Name) → gleiche Datei raus → SHA-256 Kopf/Ende → voll | exakte Dubletten | **passt**, erweitern: Name ist schon optional (`sameName`, Default aus) ✅; Hardlinks werden heute **stillschweigend weggelassen** statt gezeigt; **Bug:** `platform::file_id` ist unter Windows `None` → Hardlinks gelten dort als Kopien (Löschen spart nichts). Fehlt: Cache, „paranoid“, Bildmodus, Comics, Fakten für Regeln |
| `jobs/duplicates.rs` | Treffer als `searchHits` in Bündeln | passt; Phasen für Bilder ergänzen |
| `SearchHit.group`, `SearchResult.kind = 'duplicates'`, Spalte Group, Gruppenschattierung (`file-list.ts`), `removePaths` | Liste der Gruppen | **passt** (E1); zwei neue Spalten „Entscheidung“, „Grund“ |
| `duplicates-logic.ts` (`marksKeepingOne`, `wholeGroups`, `duplicateSummary`) | 3 feste Behalten-Knöpfe, Warnung „Gruppe ganz markiert“ | wird von der Regel-Engine **abgelöst**; die drei Aktionen bleiben als Ein-Regel-Sätze (Ids unverändert) |
| `DuplicatesStore`, `duplicates-dialog.ts`, `duplicates-form.ts` | Dialog `OPEN_FIND_DUPLICATES_DLG` | erweitern: Modus, Filter-Glob, Schwelle, paranoid, Regelsatz |
| `OpsStore.openDelete` + `delete-dialog.ts` (Warnung ganze Gruppe, `sizeOnly`) | Löschen aus dem Ergebnis | bleibt für andere Tabs; im Dubletten-Tab ersetzt durch E5 |
| `jobs/expect.rs` (030 E5) | „noch so wie gezeigt?“ (Art, Größe, mtime) | **passt** als erste Stufe der Prüfung im Job `dedupe` |
| `jobs/delete.rs` (`run_trash`, `run_permanent`), `paths::DangerCheck` | Papierkorb/endgültig | **passt**, Job `dedupe` ruft dieselben Funktionen je Datei |
| `jobs/copy.rs` (Move: `rename_noreplace`, sonst Kopie + Löschen) | „in Ordner verschieben“ | passt (Konflikt = Name mit ` (2)`, nie überschreiben) |
| `preview::ImageTokens` + Schema `fnfpreview` (max. 16 Tokens, 64 MiB je Bild, 3 parallel) | Bilder in der WebView | für Kacheln **zu grob** (volle Bilder, 16 Tokens) → eigene Vorschaubilder (E6.5), gleiches Schema |
| `archive::index_of` (Grenzen, fail-closed), `jobs/extract::run`, `archive::view` (privater Cache) | Seiten aus Comics lesen | **passt**, keine neue Archiv-Lesung (E7) |
| 033 E1: `chartScan` in `file-panel.ts` (Inhalt der anderen Seite, solange der Tab aktiv ist) | Gruppen-Vorschau | Muster passt 1:1 |
| `rename_presets.rs` (Form/Größe geprüft, Regeln als `serde_json::Value`) | Regelsätze als Vorlagen | Muster passt → `duplicate-rules.json` |
| `dialogs.recent` (027) | letzte Dialogeingaben | passt für das Formular |
| GuiExpert Table | Liste, Renderer, Zeilenklassen | keine Lücke erwartet (Renderer `CellRendererIf` für Entscheidung/Grund wie die Gruppen-Spalte) |
| legacy/mr | – | Dubletten gab es in beiden nicht (`docs/feature-parity.md` Zeile „Duplikate“) → keine Vorlage, Abweichungen entfallen |

## 2. Entscheidungen

### E1 – Ansicht: 016-Tab erweitern, Gruppe in der anderen Seite

```
┌─ links (aktiv): Dubletten-Tab ─────────────────────────┬─ rechts: Gruppe 3 von 41 ───────────────────┐
│ Dubletten in ~/Fotos · Exakt · 41 Gruppen, 97 Dateien   │  ┌────────┐ ┌────────┐ ┌────────┐            │
│ Löschen: 56 Dateien, 1,8 GB frei · 2 unentschieden      │  │ [Bild] │ │ [Bild] │ │ [Bild] │            │
│ Regeln: [Downloads löschen, älteste ▾] [Anwenden]       │  │BEHALTEN│ │LÖSCHEN │ │GLEICHE │            │
│         [Bearbeiten…] [Dubletten löschen… (F8)]         │  └────────┘ └────────┘ │ DATEI  │            │
│ Grp │ Entscheidung │ Name          │ Ordner    │ Größe  │  a.jpg      Kopie v…  └────────┘            │
│  1  │ ✓ behalten   │ a.jpg         │ ~/Archiv  │ 4 MB   │  ~/Archiv   ~/Downl…  a-link.jpg            │
│  1  │ ✗ löschen    │ Kopie von a…  │ ~/Downl…  │ 4 MB   │  4 MB · 12.03.2021 · 4032×3024              │
│  1  │ = gleiche D. │ a-link.jpg    │ ~/Archiv  │ 4 MB   │  Grund: „Pfad passt auf /Downloads/“        │
│  2  │ ? unentsch.  │ x.bin         │ …         │        │  [Diese behalten (Enter)]                    │
│ Grund-Spalte rechts außen: Regel, die entschied        │                                              │
└────────────────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

**Empfehlung: bestehenden Tab erweitern.** Liste, Cursor, Markierung, Sortierung, Kontextmenü, Screenreader,
`removePaths` und die Gruppen-Schattierung gibt es schon; ein eigener Tab-Typ (033) lohnt nur, wenn Rust einen Zustand
hält, den die Liste abfragt – hier ist das Ergebnis klein genug fürs Frontend (100 000 Treffer ≈ 30 MB JS, wie heute).

- **Markiert = „löschen“**, unmarkiert = „behalten“ (bzw. „gleiche Datei“/„unentschieden“ über Spalte). So wirken
  alle bekannten Markierwerkzeuge (Leertaste, Insert, `+`/`-` mit Muster) und die Zählung in der Statuszeile weiter.
- Neue Spalten (nur in Dubletten-Tabs sichtbar, wie Group): **Entscheidung** (Symbol + Text, nicht nur Farbe) und
  **Grund** (Kurzname der Regel oder „manuell“). Im Bildmodus zusätzlich **Auflösung** und **Abstand** (Hamming zum
  Gruppenzentrum, 0 = gleich), im Comic-Modus **Seiten**.
- **Kopf:** Modus, Gruppen, Dateien; „Löschen: n Dateien, x frei“, „k unentschieden“, „j ohne behaltene Datei“
  (Warnfarbe + Text); Regelsatz-Auswahl, *Anwenden*, *Bearbeiten…*, *Dubletten löschen…*.
- **Gruppen-Vorschau** (neue Komponente `DuplicateGroupView`, Platz wie das 033-Diagramm: andere Seite, solange der
  Dubletten-Tab aktiv ist; `Tab` wechselt die Seite und zeigt dort wieder den Ordner): die Gruppe unter dem Cursor als
  Kacheln (Bilder/Comic-Titel über Vorschaubilder E6.5, sonst Datei-Icon), darunter Name, Ordner, Größe, Datum,
  Auflösung/Seiten, Entscheidung, Grund. Klick auf eine Kachel = Cursor dorthin (ohne die Seite zu aktivieren, wie 033).
  Kacheln sind nicht fokussierbar, Bedienung über die Liste; `role="region"` mit `aria-label`, Entscheidung im Text.
- **Bedienung:** Leertaste = Zeile umschalten (normales `TOGGLE_MARK_AND_ADVANCE`), Enter/Doppelklick = „diese
  behalten“ (Zeile unmarkieren, die anderen Einheiten der Gruppe markieren, Grund „manuell“). Öffnen einer Datei im
  Dubletten-Tab dann über F3 (Ansicht), Kontextmenü „Öffnen“ – bewusste Abweichung von Enter = Öffnen, weil Marc
  Enter für „behalten“ wünscht. Alternative (falls lieber): `Mod+Enter` = behalten, Enter bleibt Öffnen.

### E2 – Regel-Engine im Frontend

**Rein im Frontend** (`features/duplicates/duplicates-rules.ts`, Testkatalog `duplicates-rules.cases.json` wie
007/008). Die Regeln brauchen nur Felder, die ein Treffer ohnehin trägt; was nur Rust weiß (Auflösung, Seiten,
Link-Anzahl, Fundreihenfolge), kommt als Feld am Treffer. So ist „Anwenden“ sofort (keine Rundreise) und für 100 000
Treffer ein O(n log n)-Durchlauf.

**Einheit** = eine physische Datei: Treffer mit gleichem `fileKey` (Gerät+Inode bzw. Volume+File-ID) bilden eine
Einheit mit Haupteintrag und Aliassen (E4). Regeln wählen zwischen Einheiten, nie zwischen Aliassen.

**Ablauf je Gruppe** (Regeln in Reihenfolge, „die erste entscheidet, weitere brechen Gleichstände“):

```
kandidaten = alle Einheiten der Gruppe
für jede Regel r:
    bewertet = r.score(kandidat) für alle kandidaten        // Zahl oder bool
    beste = kandidaten mit bestem Wert
    wenn 0 < |beste| < |kandidaten|: kandidaten = beste; letzte_trennende = r
    wenn |kandidaten| == 1: Ende
|kandidaten| == 1 → diese behalten (Grund = letzte_trennende), alle anderen Einheiten löschen
sonst             → nichts markieren, Gruppe „unentschieden“ (Grund „keine Regel trennt“)
```

Damit kann **nie** eine ganze Gruppe markiert werden (es bleibt genau eine Einheit oder keine Markierung).

| Regel (`kind`) | Wert | Anmerkung |
|---|---|---|
| `oldest` / `newest` | `modifiedMs` (fehlt = trennt nicht) | |
| `shortestName` / `longestName` | Länge in Unicode-Codepoints | |
| `shortestPath` / `longestPath` | Länge von `path` | |
| `pathPattern` { pattern, syntax: glob\|regex, prefer: keep\|delete, caseSensitive } | passt ja/nein | Muster gilt für den ganzen Pfad; `/` im Muster passt auf `/` **und** `\` (nur beim Vergleich, kein Pfadrechnen); ungültiges Regex = Regelsatz ungültig, nichts wird markiert |
| `inFolder` { folder, prefer: keep\|delete } | liegt darunter ja/nein | Ordner aus Ordnermenü/anderer Seite; „darunter“ entscheidet Rust (E2a) |
| `noCopySuffix` | Name ohne Kopie-Merkmal ja/nein | Merkmale (de/en/fr/es): `Kopie von …`, `Copy of …`, `… - Kopie`, `… - Copy`, `… copy`, `… Kopie`, `… (1)`, `… (2)`, `…_copy`, `… copy 2`; jeweils vor der Endung |
| `largerResolution` | Breite×Höhe (fehlt = trennt nicht) | Bild-/Comic-Modus |
| `largerFile` | Größe | v. a. ähnliche Bilder (exakte sind gleich groß) |
| `firstFound` | Fundreihenfolge `order` | trennt immer → wer „unentschieden“ sehen will, lässt sie weg |

- **E2a „liegt in Ordner X“:** Pfade sind opak. Rust schickt mit jedem Treffer nichts Neues; stattdessen fragt die
  Engine einmal je Regelsatz `classify_paths(paths, folders) -> Vec<bool[]>` (async, rein lexikalisch über
  `std::path::Path::starts_with` nach `normalize_lexically`) und cached das je Ergebnis. Alternative ohne Command:
  `hit.dir === folder || hit.dir.startsWith(folder + sep)` mit beiden Trennern – verletzt die Regel „kein Split/Join“,
  daher nicht empfohlen.
- **Regelsätze** `{ name, rules: Rule[] }` in `duplicate-rules.json` (App-Konfiguration, Muster `rename_presets.rs`:
  Rust prüft nur Form/Größe, max. 100 Sätze, 16 KiB je Satz; enthält Muster und Ordnerpfade, aber keine Dateinamen),
  `last` = zuletzt benutzter Satz. Eingebaute Sätze (nicht löschbar): „Älteste behalten“, „Neueste behalten“, „Kürzester
  Pfad“ (= die 016-Knöpfe, Aktionen `DUP_MARK_KEEP_*` bleiben), „Kopien-Namen löschen, sonst älteste“, im Bildmodus
  „Höchste Auflösung, dann größte Datei“.
- **Editor** (Dialog `DUP_RULES_DLG`): Liste der Regeln (hinzufügen, entfernen, hoch/runter per `Alt+↑/↓` und Knöpfen),
  je Regel ihre Felder; Live-Zähler „entscheidet n Gruppen, k bleiben unentschieden“ gegen das aktuelle Ergebnis;
  Vorlagen speichern/laden/löschen. `role="dialog"`, Liste als `listbox`, Fokusfalle (`Modal`).
- **Anwenden:** ersetzt alle Markierungen des Tabs (Rückfrage nur, wenn manuelle Änderungen da sind). Neue Treffer
  (Suche läuft noch) werden nicht automatisch entschieden – *Anwenden* erst nach Ende freigeschaltet.
- **Ähnliche Gruppen:** die Engine schlägt vor wie bei exakten; gelöscht wird erst nach der Bestätigung mit Bildern (E5).

### E3 – Hash-Cache nur im Speicher

`duplicates::cache::HashCache` (globaler `Mutex`, LRU, **max. 400 000 Einträge ≈ 60 MB**):
Schlüssel `(dev, inode | file-id, size, mtime in ns, path)`, Wert `{ partial?, full?, phash?, dims? }`.
Jede Änderung von Größe, mtime, Inode oder Pfad ist ein Fehlschlag → neu hashen. Gilt bis zum App-Ende; Menüpunkt
„Hash-Cache leeren“ nicht nötig (Einstellung `duplicates.cache` an/aus, Default an).

Gegen eine Datei sprechen: (1) Datenschutz – Pfade + Fingerabdrücke von Inhalten liegen dauerhaft auf der Platte,
(2) Invalidierung über Sitzungen ist auf FAT/SMB (2-s-mtime, Uhren) unzuverlässig, (3) Platz (≈ 150 B je Datei).
Da der Job `dedupe` vor dem Löschen **byteweise** vergleicht (E5), kann ein veralteter Cache-Eintrag nie Datenverlust
verursachen, schlimmstenfalls eine falsche Gruppe, die beim Löschen übersprungen wird.

### E4 – Hardlinks und „gleiche Datei“

- Rust bestimmt je Treffer `fileKey` über **`platform::entry_id`** (Unix: Gerät+Inode; Windows: Volume-Seriennummer +
  File-Index) statt `file_id` → behebt den Windows-Fehler (roter Test zuerst, läuft nur unter Windows; unter Unix ein
  Test, dass die Gruppierung dieselbe Funktion nutzt).
- Treffer mit gleichem `fileKey` **bleiben im Ergebnis** (neu: `SearchHit.sameAs = <Pfad des Haupteintrags>`), werden
  nur einmal gehasht und zählen nicht als zusätzliche Kopie. Eine Gruppe, die nur aus einer Datei + Aliassen besteht,
  ist keine Dublette und entfällt (wie heute).
- `SearchHit.links` = Link-Anzahl (`nlink`, Windows `nNumberOfLinks`). Eine Einheit mit `links > 1` wird von der Engine
  **bevorzugt behalten** (Löschen gibt keinen Platz frei) und nie markiert, solange es eine andere Einheit gibt;
  Aliasse sind nicht markierbar (Markieren wird ignoriert, Leertaste meldet „gleiche Datei – Löschen spart nichts“).
- Frei werdender Platz = Größe je gelöschter Einheit mit `links == 1`.
- Symlinks werden wie bisher nicht verfolgt und nicht aufgenommen (`search::walk`, `links: false`).

### E5 – Löschen erst nach Bestätigung: Job `dedupe`

Aktion **`DUP_DELETE_MARKED`** „Dubletten löschen…“ (Kopf-Knopf, Palette; F8/Entf und Shift+F8 im Dubletten-Tab
leiten hierher um – der normale Löschdialog kennt die Gruppen nicht).

**Bestätigungsdialog:**

```
┌ Dubletten löschen ─────────────────────────────────────────────┐
│ 56 Dateien aus 39 Gruppen · 1,8 GB werden frei                  │
│ Übersprungen: 2 Gruppen unentschieden, 1 Gruppe ohne behaltene  │
│ Datei (nichts wird dort gelöscht)                               │
│ (•) In den Papierkorb  ( ) Endgültig  ( ) In Ordner verschieben │
│     [~/Dubletten-Ablage          ] (andere Seite)               │
│ ▸ Gruppen zeigen (bei ähnlichen Bildern aufgeklappt, Kacheln)   │
│ Vor dem Löschen wird jede Datei mit der behaltenen verglichen.  │
│                                   [Abbrechen] [56 löschen]      │
└────────────────────────────────────────────────────────────────┘
```

- Im Bild-/Comic-Modus ist die Gruppenliste **immer aufgeklappt** (Kacheln behalten | löschen je Gruppe, scrollbar,
  max. 200 Gruppen sichtbar, Rest „und n weitere“) – „nie ohne sichtbare Vorschau“.
- Endgültig: fett + zweite Bestätigung (wie 006); `DangerCheck` wie beim normalen Löschen.

**Vertrag:**

```rust
JobSpec::Dedupe {
    groups: Vec<DedupeGroup>,
    action: DedupeAction,            // "trash" | "permanent" | { moveTo: target_dir }
    verify: DedupeVerify,            // "content" (exakt) | "unchanged" (ähnliche Bilder/Comics)
    #[serde(default)] allow_dangerous: bool,
}
struct DedupeGroup { keep: ExpectedEntry, remove: Vec<ExpectedEntry> }   // 030-Struktur: Pfad, Art, Größe, mtime
```

**Prüfung je Gruppe, unmittelbar bevor ihre Dateien angefasst werden** (Gruppe überspringen = Item-Fehler
`changed_since_listing` bzw. neuer Code `duplicate_changed` mit Grund, Rest läuft weiter):

1. `keep` existiert, ist Datei, Größe + mtime wie gezeigt (`expect::changed`); `keep` steht nicht in `remove`.
2. Jede Datei in `remove`: wie gezeigt (`expect::changed`), **nicht dieselbe Datei wie `keep`** (`entry_id`), sonst
   übersprungen.
3. `verify = content`: **Bytevergleich** `remove` ↔ `keep` (Blöcke à 64 KiB, Abbruch je Block, Fortschritt in Bytes) –
   kein Hash, kein Cache. Weicht ein Byte ab → diese Datei bleibt.
4. Danach `keep` erneut auf Größe/mtime prüfen (ändert sich die behaltene Datei während des Vergleichs → Gruppe
   überspringen) und die Datei löschen/verschieben (`delete::trash_one` bzw. `permanent_one`, Move mit
   `rename_noreplace`/Kopie ohne Überschreiben).

Validierung in `JobManager::start` wie alle Job-Arten (`validate_job_path` für jeden Pfad, max. 200 000 Pfade). Nach dem
Job: `removePaths` für die erledigten Pfade, Gruppen mit < 2 Einheiten verlassen das Ergebnis; Panels frischen über
`dirsChanged` auf. **Ersetzen durch Hardlink/Symlink: ✖** (E8).

### E6 – Ähnliche Bilder

1. **Crate `image` 0.25** (`default-features = false`, Features `jpeg`, `png`, `gif`, `webp`, `bmp`, `tiff`) – alle
   Decoder pure Rust (zune-jpeg, png, gif, image-webp, tiff), also keine Systembibliothek. **HEIC/HEIF und AVIF ⬜**
   (bräuchten libheif bzw. dav1d) – im Dialog als „nicht unterstützt“ ausgewiesen, im Ergebnis als übersprungen
   gezählt. `image_hasher` nicht: zieht `rustdct`, `transpose`, `base64` und eine eigene Bildpipeline nach, wir brauchen
   ~80 Zeilen.
2. **Fingerabdruck:** pHash 64 Bit – Graustufen, auf 32×32 skalieren (`imageops::resize`, Triangle), 2-D-DCT
   (separabel, vorab berechnete Kosinustabelle), 8×8 niedrige Frequenzen ohne DC, Bit = Wert > Median. Dazu
   Seitenverhältnis: Bilder mit > 10 % Abweichung kommen nie in eine Gruppe. Gespiegelte/gedrehte Bilder gelten **nicht**
   als gleich (kein Ausprobieren der Orientierungen; EXIF-Drehung wird ebenfalls nicht angewandt – so sind ein Foto und
   seine gedrehte Kopie verschieden, das ist erwartbar und im Text erwähnt).
3. **Grenzen (Bomben):** Datei ≤ 64 MiB (`preview::MAX_IMAGE_BYTES`), Kopf zuerst lesen (`ImageReader::into_dimensions`)
   → > 16 384 px Kante oder > 100 MP = übersprungen *vor* dem Dekodieren; `image::Limits { max_image_width/height,
   max_alloc = 512 MiB }`; jedes Bild in `catch_unwind` (Verteidigung gegen Decoder-Panics). Kaputte Bilder: Item-Fehler
   „nicht lesbar“, der Lauf geht weiter. GIF/TIFF: erste Seite. JPEG dekodiert voll (zune-jpeg kann nicht skaliert
   dekodieren); Kosten s. Messung.
4. **Gruppierung** (nicht transitiv): Bilder sortiert nach Pixelzahl ↓, Größe ↓, Pfad; jedes noch freie Bild wird
   **Zentrum** einer neuen Gruppe, Mitglieder = alle freien Bilder mit Hamming-Abstand ≤ t **zum Zentrum** (Suche im
   BK-Baum über alle Hashes, freie werden beim Zuordnen entfernt). Jedes Mitglied ist also höchstens t vom Zentrum
   entfernt, nie über Ketten verbunden; Ergebnis deterministisch. Schwelle als Regler **streng (4) … normal (8) …
   locker (12)** von 64 Bit. Zum Vergleich wird der Brute-Force-Abgleich (XOR + `count_ones`) gemessen; bei 50 000
   Bildern liegt er bei < 2 s – ist der BK-Baum nicht deutlich schneller, bleibt es beim einfachen Verfahren.
5. **Vorschaubilder** für Gruppen-Vorschau und Bestätigung: Command `duplicate_thumbnails(paths, maxPx ≤ 256) ->
   Vec<Option<token>>` (async, `spawn_blocking`, max. 24 Pfade je Aufruf) dekodiert (mit denselben Grenzen), skaliert und
   kodiert PNG; eigener Speicher `ThumbStore` (LRU, max. 256 Bilder / 32 MiB), ausgeliefert über das bestehende
   Schema `fnfpreview` mit Präfix `t-` im Token. Bei Comics ist der Pfad die Archivdatei, Rust nimmt das Titelbild.
   Nur Pfade aus einem Dubletten-Ergebnis dieser Sitzung werden angenommen (Rust merkt sich die Pfade je Job), damit der
   Command kein allgemeiner Bild-Leser wird.
6. **Laufzeit:** Dekodieren in einem Worker-Pool (`std::thread::scope`, `min(4, CPUs/2)` Threads, damit die App
   bedienbar bleibt); Phasen im Fortschritt: Suchen → Dekodieren (n/m Bilder) → Gruppieren. Messung (`--ignored`-Test,
   Release-Build): 50 000 synthetische Bilder 1024×768 JPEG und 2 000 Fotos 12 MP; Ergebnis kommt ins Design.

### E7 – Comics (`.cbz`/`.cbr`/`.cb7`)

- Index über `archive::index_of` (alle 025-Grenzen, fail-closed; verschlüsselte oder unsichere Archive → übersprungen
  mit Grund; RAR nur mit Feature `rar`). Auch `.zip`/`.rar`/`.7z` werden im Comic-Modus **nicht** angefasst (nur die
  Comic-Endungen).
- Seiten = Einträge mit Bild-Endung (jpg, jpeg, png, gif, webp, bmp), natürlich sortiert (`page2` < `page10`), ohne
  versteckte/`__MACOSX`-Einträge. Fingerabdruck = **Seitenzahl** + pHash von **Titel (1. Seite) und den Seiten bei 25 %,
  50 %, 75 %**.
- Entnahme der ≤ 4 Seiten über `extract::run` in einen privaten Temp-Ordner (wie `archive::view`, gleiche Grenzen:
  Zip-Slip, Bomben, Links nie angelegt), Seite ≤ 64 MiB, danach sofort gelöscht.
- Ähnlich, wenn Seitenzahl gleich (±1 für eine zusätzliche Credits-Seite) **und** jeder der 4 Abstände ≤ t. Gruppierung
  wie E6.4 mit dem Maximum der 4 Abstände als Abstandsmaß (BK-Baum über den Titel-Hash als Vorfilter).
- Akzeptanz „dieselbe `.cbz` neu gepackt“: gleiche Seiten → Abstände 0 → eine Gruppe.

### E8 – Ersetzen durch Hardlink/Symlink: bewusst ✖

Ein Hardlink macht aus zwei unabhängigen Dateien eine: ändert der Nutzer später „seine Kopie“ (z. B. ein Foto in
`Downloads` bearbeiten), ändert sich auch das Archivexemplar – genau das, was eine Kopie verhindern sollte. Dazu: nur
auf demselben Volume, Backup-/Sync-Programme behandeln Links unterschiedlich, Windows-Explorer zeigt doppelte Belegung.
Symlinks brechen beim Verschieben des Ziels. Stattdessen **„in Ordner verschieben“** (sichere Ablage zum späteren
Löschen). Eintrag in `docs/feature-parity.md` als ✖ mit Begründung.

### E9 – Aktionen und Kürzel

| Aktion | Kürzel | Wo |
|---|---|---|
| `OPEN_FIND_DUPLICATES_DLG` (erweitert) | wie bisher `Alt+Shift+F7` / `⌥⇧F7` | überall |
| `DUP_APPLY_RULES` „Regeln anwenden“ | – (Kopf-Knopf, Palette) | Dubletten-Tab |
| `DUP_RULES_DLG` „Regeln bearbeiten…“ | – | Dubletten-Tab |
| `DUP_KEEP_THIS` „Diese Datei behalten“ | Enter / Doppelklick (über `NAVIGATE_OPEN` im Dubletten-Tab) | Dubletten-Tab |
| `DUP_DELETE_MARKED` „Dubletten löschen…“ | F8/Entf, Shift+F8 (Umleitung im Dubletten-Tab) | Dubletten-Tab |
| `DUP_NEXT_GROUP` / `DUP_PREV_GROUP` | – (Palette; Kürzel nur, wenn Marc eins möchte) | Dubletten-Tab |
| `DUP_MARK_KEEP_NEWEST/OLDEST/FIRST` | bleiben (wenden den gleichnamigen eingebauten Regelsatz an) | Dubletten-Tab |

Alle in `action-catalog.ts`, Menü „Dubletten“ (`menu-model.ts`, bisher `DUP_MARK`), Texte en/de.

## 3. Dialog „Dubletten finden“ (erweitert)

```
┌ Dubletten finden ─────────────────────────────────────────────────┐
│ Modus   (•) Exakt (Inhalt)  ( ) Ähnliche Bilder  ( ) Comics        │
│ Suchen in (•) ~/Fotos  ( ) 3 markierte Ordner                      │
│ Dateien [*            ] (Glob, z. B. *.jpg;*.png)                  │
│ Mindestgröße [1   ] [B ▾]   [ ] versteckte   Ausschlüsse [.git; …] │
│ Exakt:   [ ] nur Größe  [ ] zusätzlich gleicher Name  [ ] paranoid │
│ Bilder:  Ähnlichkeit  streng ●────○──── locker  (8)                │
│          JPEG PNG GIF WebP BMP TIFF · HEIC/AVIF nicht unterstützt  │
│ Regelsatz [Älteste behalten ▾]  (wird nach der Suche angewandt)    │
│ max. Dateien [500000]                         [Abbrechen] [Suchen] │
└───────────────────────────────────────────────────────────────────┘
```

- Felder je Modus ein-/ausgeblendet (`fieldset` mit `legend`, Radiogruppen per Pfeiltasten); Werte über `dialogs.recent`.
- „Regelsatz … wird angewandt“: Default **„keiner“** (erst ansehen, dann entscheiden – Marcs „Wichtig“); wählbar,
  damit ein bewährter Satz nicht jedes Mal von Hand angewandt werden muss.
- **paranoid** (Exakt): nach dem vollen SHA-256 innerhalb jeder Gruppe zusätzlich Bytevergleich gegen das erste
  Mitglied; Abweichler bilden eigene Gruppen.

## 4. Verträge

### Rust

```rust
// duplicates.rs
pub enum DupMode { Exact, SimilarImages, Comics }                     // "exact" | "similarImages" | "comics"
pub struct DuplicateCriteria {
    roots, compare, same_name, min_size, include_hidden, excludes, max_files, skip_virtual_fs,  // wie 016
    #[serde(default)] mode: DupMode,
    #[serde(default)] name: String,            // Glob-Liste "*.jpg;*.png" ('' = alle), wie search
    #[serde(default)] paranoid: bool,
    #[serde(default)] threshold: Option<u8>,   // 0–16, Default 8 (Bilder/Comics)
}
SearchHit {                                    // neue Felder, alle skip_serializing_if None
    group, …,
    order: Option<u32>,                        // Fundreihenfolge (Regel firstFound)
    same_as: Option<String>,                   // Alias (Hardlink) dieses Pfads
    links: Option<u32>,                        // nlink > 1
    width: Option<u32>, height: Option<u32>,   // Bilder; Comics: Titelbild
    pages: Option<u32>,                        // Comics
    distance: Option<u8>,                      // Hamming zum Gruppenzentrum
}
SearchStats { …, images_total: u64, images_done: u64, skipped_unsupported: u64 }   // serde default 0
pub mod cache;                                 // HashCache (E3)
pub mod phash;                                 // pHash, Hamming, BK-Baum, Gruppierung (rein, ohne I/O)
pub mod comic;                                 // Seitenauswahl, Fingerabdruck

JobSpec::Dedupe { groups: Vec<DedupeGroup>, action: DedupeAction, verify: DedupeVerify, allow_dangerous: bool }
// parallel: nein (destruktiv, Warteschlange wie Delete); kind "dedupe"

#[tauri::command] async fn classify_paths(paths: Vec<String>, folders: Vec<String>) -> Result<Vec<Vec<bool>>, FsError>
#[tauri::command] async fn duplicate_thumbnails(paths: Vec<String>, max_px: u32) -> Result<Vec<Option<String>>, FsError>
#[tauri::command] async fn load_duplicate_rules() / save_duplicate_rules(rules: DuplicateRules)
FsErrorCode::DuplicateChanged ("duplicate_changed"), ::UnsupportedImage ("unsupported_image")
```

### TypeScript

- `core/search/search.models.ts`: `DupMode`, Felder von `DuplicateCriteria`/`SearchHit`/`SearchStats` wie oben.
- `core/jobs/jobs.models.ts`: Spec `dedupe`, `DedupeGroup`, `DedupeAction`, `DedupeVerify`.
- `core/duplicates/duplicates-api.ts`: `DuplicatesApi` (`classifyPaths`, `thumbnails`, `loadRules`, `saveRules`),
  Fake in `src/testing/`.
- `features/duplicates/duplicates-rules.ts` (rein): `Rule`, `RuleSet`, `validateRuleSet`, `decide(rows, set, ctx) →
  { marks: string[], decisions: Map<path, Decision>, undecided: number[], invalid?: {rule, message} }`,
  `isCopyName(name)`, `dedupeGroups(rows, marks) → { groups, skippedWhole, skippedUndecided, bytes }`.
- `DuplicatesStore` (Root) hält je Ergebnis-Key `decisions` und den aktiven Regelsatz; `DuplicateGroupView`,
  `DedupeDialog`, `DuplicateRulesDialog`.

## 5. Tests

**Rust**
- `duplicates.rs`: Akzeptanz-Ordner (`a.jpg`, `Kopie von a.jpg`, `sub/x.bin` = gleicher Inhalt, `b.txt` gleiche Größe
  anderer Inhalt → eine Gruppe mit 3); Hardlink erscheint mit `same_as`/`links`, wird nur einmal gehasht; Symlink nicht
  aufgenommen; Name kein Kriterium (Default); paranoid trennt gleichen Hash (Test über eine eingeschleuste Hash-Funktion);
  Unicode/Leerzeichen/Emoji; nicht-UTF-8 (Linux).
- `cache.rs`: Treffer bei gleicher Datei, Fehlschlag bei Größe/mtime/Inode/Pfad, LRU-Grenze; zweiter Lauf liest nichts
  (Zähler).
- `phash.rs`: generierte Testbilder (Verläufe + Formen, `image`-Encoder): JPEG q95/q40 und auf 50 % skaliert ≤ 8;
  anderes Motiv > 20; gespiegelt > 8; Seitenverhältnis-Sperre; BK-Baum = Brute-Force (Eigenschaftstest über
  Zufallshashes); Gruppierung deterministisch, nie über Ketten (A–B 6, B–C 6, A–C 12 bei t = 8 → nicht alle drei).
- Feindliche Bilder: 0-Byte, abgeschnittenes JPEG, PNG-Kopf mit 100 000×100 000, GIF mit riesigem logischem Screen,
  TIFF mit 2^31 Streifen → Fehler je Datei, Lauf geht weiter, kein großer Speicher (Grenzen vor der Allokation).
- `comic.rs`: `.cbz` neu gepackt (andere Kompression/Reihenfolge) → gleich; Seite fehlt am Ende → noch ähnlich
  (±1); andere Seiten → nicht; Zip-Slip-/Bomben-Comic → übersprungen; verschlüsselter `.cb7` → übersprungen mit Grund.
- `jobs/tests_dedupe.rs`: löscht nur Markiertes; behaltene Datei geändert (mtime/Größe) → Gruppe übersprungen;
  zu löschende Datei inhaltlich abweichend bei gleicher Größe/mtime → bleibt; `keep` = Hardlink von `remove` → bleibt;
  `keep` gelöscht → Gruppe übersprungen; Abbruch mitten im Bytevergleich; Verschieben ohne Überschreiben;
  Danger-Pfad; Papierkorb (Linux, `trash`-Crate wie 006).
- Messungen `--ignored`: 50 000 Bilder, 100 000 Dateien exakt mit warmem/kaltem Cache.

**Frontend**
- `duplicates-rules.cases.json` (Tabellenkatalog): jede Regel, Reihenfolge/Gleichstände, Muster keep/delete, Glob vs.
  Regex, `/` passt auf `\`, Regex-Fehler → nichts markiert, nie ganze Gruppe, Aliasse/`links > 1`, unentschieden,
  Kopie-Suffixe (de/en, mit/ohne Endung, `(1)`), Bild-Regeln ohne Maße.
- Store: Anwenden ersetzt Marken, manuell → Grund „manuell“, Enter = behalten, Alias nicht markierbar, Summen (Gruppen,
  Dateien, Bytes, unentschieden, ohne behaltene), 100 000 Zeilen < 200 ms.
- Dialoge (Fakes): Dubletten-Dialog je Modus, Regeleditor (Reihenfolge per Tastatur, Vorlage speichern), Bestätigung
  (Zahlen, Modus, Bilder sichtbar im Bildmodus, Spec des Jobs), F8-Umleitung.

**E2E (Xvfb):** Testordner mit den Akzeptanz-Dateien (+ Hardlink, Umlaute, Emoji, versteckt, gesperrter Ordner),
Testbilder per ImageMagick (`convert -quality 40`, `-resize 50%`, `-flop`, anderes Motiv, kaputtes JPEG, 30 000×30 000
PNG-Kopf), `.cbz` gepackt mit `zip -9` und `zip -0`. Abläufe: Suchen → Regelsatz „/Downloads/ löschen, sonst älteste“
→ Vorschau → Bestätigen → Papierkorb; behaltene Datei zwischendurch per `touch` ändern → Gruppe übersprungen; Esc in
jeder Phase; light/dark.

**Review** durch separaten Agenten: Datenverlust (Job `dedupe`, Regel-Engine „nie ganze Gruppe“, Aliasse), feindliche
Bilder/Comics (Grenzen vor der Allokation, Panics), Thumbnail-Command als Leck.

## 6. Phasen

| Phase | Inhalt |
|---|---|
| 2a | Rust exakt: `entry_id`, Aliasse/links/order, Cache, paranoid, Glob-Filter – Commit |
| 2b | Rust Job `dedupe` + `classify_paths` + Regelsatz-Datei – Commit |
| 2c | Rust Bilder/Comics: `image`, pHash, Gruppierung, Thumbnails, Messung – Commit |
| 3a | Regel-Engine + Katalog, Store, Spalten, Kopf – Commit |
| 3b | Gruppen-Vorschau, Regeleditor, Bestätigung, Dialog, Aktionen/Menü/Texte – Commit |
| 4–6 | E2E, Doku (`architecture.md` mit Crate `image`, `feature-parity.md`, README, roadmap), Review, Bericht |

## 7. Nicht im Umfang / offen

- HEIC/HEIF, AVIF, RAW-Formate (⬜, bräuchten Systembibliotheken); Video-Dubletten.
- Gedrehte/gespiegelte Bilder als ähnlich erkennen (bewusst nicht, E6.2).
- Ersetzen durch Hardlinks/Symlinks (✖, E8).
- Dubletten auf Serververbindungen (034) – Treffer nur lokal (`skip_virtual_fs`, Serverpfade abgelehnt wie bisher).
- Hash-Cache als Datei (E3).

## 8. Fragen an Marc

1. Enter = „diese behalten“ im Dubletten-Tab (Öffnen dann über F3/Kontextmenü) – oder lieber `Mod+Enter`?
2. Regelsatz nach der Suche automatisch anwenden: Default „keiner“ ok?
3. „In Ordner verschieben“ als dritter Weg neben Papierkorb/endgültig – gewünscht?
4. Kürzel für nächste/vorige Gruppe (Vorschlag `Alt+↓`/`Alt+↑`, sofern frei) oder nur Palette?

## Fortschritt

- 22.10.2026: Bestand geprüft, Design geschrieben. Container eingerichtet. Wartet auf Freigabe.
