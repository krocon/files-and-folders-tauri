# Design 009: Suche, Ergebnis-Tabs und Ordner-Finder

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) – alle Empfehlungen übernommen ·
> **Datum:** 2026-10-17 · **Branch:** `feat/suche` (auf `feat/gruppieren-leere-ordner`, 008 ist darin fertig)
> **Grundlage:** legacy §1.3 (`search`, `walkfolder`, `{cancelled, rid}`), §3 (Find, Change Dir), §5 (Such-Tabs),
> mr §5/§7/§9 (Glob `**/*.*`, Vorlagen `search/defaults/data.json`, „nur Ordner“, „in neuem Tab“, Change Dir mit
> Tiefe), `docs/ui-layout.md` (Header `Search: "<Muster>"`, Such-Tabs mit Lupe), Design 005 (Job-Engine, ein
> Ereigniskanal), Design 001 (Performance: große DTOs, `setRows` statt neuem Modell).
> **Phasen:** alle sechs.

---

## 1. Bestand

| Baustein | heute (008) | Bewertung |
|---|---|---|
| Job-Engine (`JobSpec`, `JobManager`, `Control`, ein `Channel` je WebView) | Abbruch-Token, parallele Hilfs-Jobs (`count`, `dirSize`) | **passt** – Suche wird Job-Art `search` (parallel), Treffer als neues Ereignis `searchHits` |
| `JobsStore` (Root) | spiegelt `JobInfo`; `isHelperJob` blendet Hilfs-Jobs aus der Task-Liste | **erweitern**: Treffer-Abonnement je Job-Id (Treffer **nicht** in `JobInfo` – sonst wächst der Snapshot) |
| `listing::entry_from_metadata`, `is_hidden` | privat | **öffnen** (`pub(crate)`) – Treffer haben dasselbe Format wie Listing-Einträge |
| `clean.rs` Glob (`*`, `?`) | nur Namen, ohne Klassen | **nicht** wiederverwendet: Suche übersetzt Glob → Regex (Crate `regex`, Klassen `[…]`, Groß/klein) |
| `platform::file_id` | (dev, ino) unter Unix | **passt** für den Zyklusschutz; Windows: kanonischer Pfad als Schlüssel |
| Tabs (`WorkspaceStore`, `TabSession`) | nur Ordner-Tabs | **erweitern**: `TabState.search` (Verweis auf ein Ergebnis im Root-`SearchStore`), nicht in `session.json` |
| `FileBrowserStore` | lädt Ordner per `FsApi` | **erweitern**: Modus „Suchergebnis“ (`showSearch`), `path()` = `null`, neue `locationKey()` |
| Datei-Table | Spalten Name/Ext/Size/Modified | **erweitern**: Spalte „Folder“ (`dir`), per `setColumnVisible` nur im Ergebnis-Tab sichtbar |
| `OpsStore` (Kopieren/Verschieben/Löschen) | braucht `store.path()` | **anpassen**: `locationKey()` statt Pfad als Identität des Quell-Panels |
| `fuzzy.ts` (Befehlspalette) | Subsequenz-Score | **passt** für den Ordner-Finder |
| `preview-grid` (008) | GuiExpert Table mit Spalten als Input | **passt** für die Liste des Ordner-Finders (virtualisiert) |
| Aktionen | `OPEN_FIND_DLG` (Alt+F7, „kommt in 009“), `OPEN_CHDIR_DLG` = Pfadeingabe (Mod+L, Alt+F10) | Handler; **neu** `OPEN_FOLDER_FINDER_DLG` (bekommt Alt+F10), `GOTO_FILE`, `RERUN_SEARCH` |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Suche als Job `search` mit gebündelten Treffern über den Job-Kanal ✅

| Option | + | − |
|---|---|---|
| **A: `JobSpec::Search { criteria }`, Ereignis `JobEvent::SearchHits`** | ein Kanal, Abbruch/Fehler/Ende wie alle Jobs, Snapshot nach Reload kennt laufende Suchen | Treffer laufen an alle WebViews (es gibt nur eine) |
| B: eigener Command mit eigenem `Channel` | Treffer nur an den Aufrufer | zweiter Abbruch-/Ende-Mechanismus – widerspricht CLAUDE.md §4 („als Job-Art ergänzt“) |

**Empfehlung A.** Der Job ist **parallel** (wartet nicht hinter einem Kopierjob), ein Hilfs-Job (nicht in der
Task-Liste, kein Nachfragen beim Beenden – ein Abbruch schadet nicht). Die Treffer werden **nicht** im `JobInfo`
gespeichert, nur gestreamt; das Frontend sammelt sie (Annahme: ein Reload der WebView verliert laufende Ergebnisse).
Pause wird zwischen Ordnern respektiert (kostet nichts), ist in der UI aber nicht angeboten.

**Bündelung:** ein Ereignis, sobald 500 Treffer warten **oder** 50 ms seit dem letzten vergangen sind (mit Treffern),
spätestens alle 250 ms ein Ereignis nur mit Statistik (durchsuchte Ordner/Dateien, Dauer). Erste Treffer kommen damit
nach ≤ 50 ms + Laufzeit bis zum ersten Treffer. Das Frontend zeigt gesammelt höchstens alle 300 ms neu an
(`setRows` + `reSort` über bis zu 100 000 Zeilen, Messung 001: 0,2–0,4 s).

**Neue Suche bricht alte ab:** der `SearchStore` hält je Ergebnis die laufende Job-Id; „Erneut suchen“ oder eine neue
Suche in denselben Tab bricht den alten Job ab und verwirft Treffer fremder Job-Ids (Abonnement je Id).

### E2 – Durchlauf: eigene Iteration, keine Crate `walkdir`/`ignore` ✅

`walkdir` kann Zyklen nur beim Folgen von Links erkennen, sammelt Fehler nicht getrennt und kennt keine
Ausschlüsse/Hidden-Regeln wie das Listing; `ignore` bringt `.gitignore`-Semantik (nicht gewünscht) und eigene Threads.
Eigene Tiefensuche (Stapel, ~150 Zeilen) mit:

- **Links:** Standard: nie folgen (ein Link ist ein Treffer der Art „Link“, wird nicht betreten). Option „Links
  folgen“: Link auf Ordner wird betreten, wenn sein Ziel noch nicht besucht wurde – Schlüssel `(dev, ino)` (Unix)
  bzw. kanonischer Pfad (sonst; nur intern, nie Navigation). Jeder betretene Ordner (auch Wurzeln) kommt in die Menge
  → kein Endlos-Durchlauf, auch nicht bei `a/link → a` (Rust-Test).
- **Unlesbare Ordner** werden gesammelt (max. 1 000 als `Summary.errors`, Anzahl `itemsFailed`) – nie Abbruch.
- **Tiefe:** `maxDepth` (1 = nur direkte Kinder), ohne Angabe 256 als harte Grenze.
- **Ausschlüsse:** Glob-Namen (`node_modules; .git`, ohne Groß/klein) – Ordner werden nicht betreten, Einträge nicht
  gemeldet. Default im Dialog `.git; node_modules`.
- **Versteckte** (Dot-Name + nativer Flag wie im Listing) nur mit Option; versteckte Ordner werden ohne Option nicht
  betreten.
- **Grenzen:** `maxHits` Default 10 000, höchstens 100 000 → danach Ende mit `truncated` (sichtbar im Header).
- **Fremde Dateisysteme** werden betreten (Annahme: Suche über gemountete Laufwerke ist gewollt; anders als Clean).

### E3 – Kriterien ✅

| Kriterium | Umsetzung |
|---|---|
| Name | Modus **Glob** (Default, `*`, `?`, `[…]`; mehrere Muster mit `;`; führendes `**/` wird ignoriert, `*.*` = alles wie in TC/mr), **Regex** (Rust-`regex`, Syntax ähnlich JS; Fehler → `invalid_pattern` am Feld), **Text** (Teilstring). Groß/klein-Option (Default aus). „Ganzer Name“ (Default an bei Glob, sonst Teil) |
| Typ | Dateien / Ordner / Links (Checkboxen, Default alle; mr-Fehler „nur Ordner liefert nichts“ ist durch den Test `dirs_only` abgedeckt) |
| Größe | min/max in Bytes (Dialog: Zahl + Einheit KB/MB/GB); gilt nur für Dateien (Ordner fallen bei gesetzter Größe heraus) |
| Datum | von/bis (`modifiedFromMs`/`ToMs`); „letzte N Tage“ rechnet das Frontend in `from` um |
| Inhalt | **jetzt**, als Option: Text (literal) mit Groß/klein, nur reguläre Dateien bis `maxFileSize` (Default 10 MiB, max. 1 GiB), gelesen in 64-KiB-Blöcken mit Überlappung (kein ganzes Einlesen), Abbruch je Block. Inhalte werden nie geloggt oder übertragen – nur der Treffer |

### E4 – Ergebnis-Tab ✅

- `TabState.search = { key, label }` – `key` zeigt auf ein Ergebnis im Root-`SearchStore` (Kriterien, Treffer,
  Status, Job-Id). Geklonte Tabs teilen das Ergebnis; Ergebnisse ohne Tab werden verworfen (und ihr Job
  abgebrochen).
- **Nicht in `session.json`** (Annahme: Treffer sind Momentaufnahmen; ein gespeicherter Such-Tab wird beim Speichern
  zu einem Ordner-Tab der ersten Wurzel).
- Panel im Modus „Suchergebnis“: `FileBrowserStore.showSearch(view)` setzt ein synthetisches Listing (keine `..`-
  Zeile, keine Breadcrumbs); `path()` ist `null` → alles, was einen Ordner braucht (F7, Multi-Rename, Gruppieren,
  Ziel eines Kopierens), ist dort aus. **Markieren, Kopieren, Verschieben, Löschen** gehen (Quellen sind volle
  Pfade); `locationKey()` (`search:<key>`) ersetzt in `OpsStore` den Quellordner als Identität. Nach Löschen/
  Verschieben entfernt der `SearchStore` die erledigten Pfade (keine neue Suche, kein neuer Command).
- Spalte **Folder** (`dir`, voller Elternpfad aus Rust) nur im Ergebnis-Tab sichtbar.
- **Zur Datei springen** (`GOTO_FILE`, Strg/⌘+Shift+G, Kontextmenü, Button im Header): öffnet den Ordner des Treffers
  in einem **neuen Tab** neben dem Ergebnis-Tab, Cursor auf dem Treffer (das Ergebnis bleibt erhalten). **Enter** auf
  einem Ordner-Treffer: dieser Ordner in neuem Tab; auf einer Datei: Standard-App wie in der Liste.
- **Header:** `Search: "<Muster>"` + Wurzel, Spinner + Zähler während der Suche, `Stop`, `Search again`, Hinweis bei
  unlesbaren Ordnern/Grenze; Doppelklick (und `RERUN_SEARCH` per Strg/⌘+Shift+F7) öffnet den Dialog mit den alten
  Werten. **Tab-Titel:** Lupe + Muster; während der Suche Spinner und `aria-busy="true"` (kein Blinken).

### E5 – Suchdialog (Alt+F7) ✅

Felder in dieser Fokus-Reihenfolge: Suchen in (aktueller Ordner; mit Markierung „markierte Ordner“ als Auswahl;
Laufwerke ab 011), Name + Modus (Glob/Regex/Text) + Vorlage ▾ + „Groß/klein“ + „ganzer Name“, Typ, Größe, Datum
(alle / letzte N Tage / von–bis), Inhalt + Größenlimit, Optionen (versteckte, Links folgen, max. Tiefe,
Ausschlüsse, max. Treffer), „in neuem Tab“ (Default an), Buttons. Enter = Suchen, Esc = Abbrechen.

- **Vorlagen:** eingebaut aus `features/search/search-presets.json` (mr-Format `[{label, extensions}]` → Glob
  `*.avi;*.mkv;…`; dazu `cbr/cbz`, `epub` aus legacy) und **eigene Vorlagen** (benannte Kriterien) sowie die **letzten
  10 Suchen** im Root-Store – nur für die Sitzung (Annahme wie 008 E6; dauerhaft mit 015 Einstellungen).

### E6 – Ordner-Finder (Alt+F10) ✅

Eigener Dialog: startet beim Öffnen einen `search`-Job ab dem aktuellen Ordner mit `kinds = dirs`, ohne Namensfilter,
Tiefe aus einem Regler (1–10, Default 5 wie mr, „∞“ = 256), versteckte nach Panel-Einstellung, Ausschlüsse
`.git; node_modules`. Filter-Eingabe filtert **live und unscharf** (`fuzzyMatch` auf den vollen Pfad, Sortierung nach
Score, bei leerem Filter in Fundreihenfolge), Liste in der GuiExpert Table (`preview-grid`, virtualisiert, max.
100 000 Ordner). ↑/↓ bewegen die Auswahl, **Enter** wechselt das aktive Panel dorthin, **Esc**/Schließen bricht den
Job ab. Statt eines Baums eine flache Liste der vollen Pfade (mr: Baum mit Tiefe) – mit Filter schneller bedienbar;
Baum → „Offen“.

`OPEN_CHDIR_DLG` (Pfadeingabe) behält Mod+L, gibt Alt+F10 an den Ordner-Finder ab (TC: Alt+F10 = Baum).

### E7 – Kein Hintergrund-Index ✅

Bewusst ohne Index (architecture.md „Geplante Erweiterungen“). Ein Index lohnt erst, wenn (a) wiederholte Suchen über
dieselben großen Bäume (> 1 Mio. Einträge) typisch werden, (b) Inhaltssuche über viele GB gefragt ist oder (c) die
Plattform-Indizes (Spotlight `mdfind`, Windows Search, `locate`) als externe Werkzeuge (011) nicht reichen. Dann:
pro Wurzel, opt-in, mit Dateisystem-Überwachung (012), Speicherort im App-Datenordner.

### E8 – Kürzel ✅

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `OPEN_FIND_DLG` | Alt+F7 (vorhanden) | ⌥F7 |
| `OPEN_FOLDER_FINDER_DLG` (neu) | **Alt+F10** (von `OPEN_CHDIR_DLG`) | ⌥F10 |
| `GOTO_FILE` (neu, nur im Ergebnis-Tab aktiv) | **Strg+Shift+G** | ⌘⇧G |
| `RERUN_SEARCH` (neu, nur im Ergebnis-Tab) | **Strg+Shift+F7** | ⌘⇧F7 |

## 3. Verträge

### Rust

```rust
// search.rs (rein std + regex)
struct SearchCriteria { roots: Vec<String>, name: String, name_mode: NameMode /* glob|regex|text */,
  case_sensitive: bool, whole_name: bool, kinds: Kinds { files, dirs, links },
  min_size: Option<u64>, max_size: Option<u64>, modified_from_ms: Option<i64>, modified_to_ms: Option<i64>,
  include_hidden: bool, follow_links: bool, max_depth: Option<u32>, excludes: Vec<String>,
  content: Option<ContentQuery { text, case_sensitive, max_file_size: Option<u64> }>, max_hits: Option<u32> }
struct SearchHit { #[flatten] entry: DirEntryDto, dir: String }
struct SearchStats { hits, dirs_scanned, files_scanned, unreadable: u64, elapsed_ms: u64, truncated: bool }
pub fn compile(c: &SearchCriteria) -> Result<Compiled, FsError>;      // invalid_pattern, invalid_path
pub fn walk(c: &Compiled, cancel: &AtomicBool, sink: &mut dyn FnMut(Event)) -> SearchStats;
// jobs/search.rs: JobSpec::Search { criteria } → bündelt, JobEvent::SearchHits { id, hits, stats }
// Summary.search: Option<SearchStats>; Summary.errors = unlesbare Ordner
```

| Command / Job | Rückgabe / Fehler |
|---|---|
| `start_job({ kind: 'search', criteria })` | Job-Id · `invalid_path` (Wurzel), `invalid_pattern` (neu: Regex/Glob), `not_a_directory` |
| Ereignis `searchHits { id, hits: SearchHit[], stats }` | über `subscribe_jobs` |

Neuer Fehlercode `invalid_pattern` (Rust `error.rs`, TS `fs.models.ts`, `describeFsError`).

### TypeScript

```ts
// core/search/search.models.ts
interface SearchCriteria { roots; name; nameMode: 'glob'|'regex'|'text'; caseSensitive; wholeName;
  kinds: { files; dirs; links }; minSize?; maxSize?; modifiedFromMs?; modifiedToMs?; includeHidden;
  followLinks; maxDepth?; excludes: string[]; content?: { text; caseSensitive; maxFileSize? } | null; maxHits? }
type SearchHit = DirEntry & { dir: string };
// JobsStore.onSearchHits(id, fn): () => void
// features/search/search.store.ts (Root): run(criteria, target) / rerun(key) / stop(key) / removePaths(key, paths)
//   results: signal<Map<key, SearchResult>>; SearchResult { key, criteria, hits, running, stats, errors, error }
// FileBrowserStore.showSearch(view) · locationKey() · searchKey()
```

## 4. UI-Skizzen

```
┌ Find files ──────────────────────────────────────────────────────────────┐
│ Search in  (•) /home/u/Musik   ( ) 3 marked folders                       │
│ Name  [*.mp3;*.flac            ] (Glob ▾) [Templates ▾] [ ] Aa [x] whole   │
│ Kinds [x] files [x] folders [x] links                                     │
│ Size  min [   ] [MB▾]  max [   ] [MB▾]   Modified (•) any ( ) last [7] days│
│ Text  [                ] [ ] Aa  max file size [10] MB                    │
│ [ ] hidden  [ ] follow links  depth [  ]  exclude [.git; node_modules ]   │
│ max hits [10000]   [x] open in new tab     [Save template] [Cancel] [Find]│
└───────────────────────────────────────────────────────────────────────────┘
Ergebnis-Tab:  [🔍 *.mp3 ◌] …   Header: Search: "*.mp3" in /home/u/Musik · 1 234 hits · ◌ [Stop] [Again] [Go to file]
               Liste: Name │ Ext │ Size │ Modified │ Folder
┌ Find folder – /home/u ───────────────────────────────────┐
│ Filter [mus_            ]  depth [====5====]  ◌ 1 204    │
│ ┌ Folder ───────────────────────────────────────────────┐ │
│ │ /home/u/Musik                                          │ │
│ └────────────────────────────────────────────────────────┘ │
│                                        [Cancel] [Open ⏎]  │
└───────────────────────────────────────────────────────────┘
```

- Dialoge: `role="dialog"`, `aria-modal`, Fokusfalle (Modal), Fehler am Feld (`aria-invalid`, `aria-describedby`),
  Live-Region für Zähler und Ende („1 234 hits, 2 folders unreadable“), Status als Text, nicht nur Farbe.
- Ordner-Finder: Fokus bleibt im Filterfeld; ↑/↓/Bild↑/Bild↓ bewegen die Auswahl der Table (aktive Zeile per
  `aria-activedescendant`-Ersatz: Zeilenklasse + Live-Text), Enter öffnet.

## 5. Tests

| Ebene | Fälle |
|---|---|
| Rust `search.rs` | Glob (Klassen, `;`, `**/`, `*.*`), Regex (ungültig → `invalid_pattern`), Text, Groß/klein, ganzer Name/Teil; Typen (nur Ordner liefert Ordner!), Größe, Datum, versteckte, Tiefe, Ausschlüsse, Unicode/Leerzeichen/Emoji; **Symlink-Zyklus** mit und ohne „folgen“ (endet, jeder Ordner einmal), dangling Link, Link auf Datei; unlesbarer Ordner (als root nur bedingt); Inhalt (Treffer, Groß/klein, über Blockgrenze, Größenlimit); `maxHits` → `truncated`; Abbruch |
| Rust Job | Treffer kommen gebündelt (≤ 500 je Ereignis), Statistik, Summary mit Fehlern; Abbruch < 200 ms bei großem Baum; Wire-Format `search`/`searchHits`; 200 000-Dateien-Messung (`--ignored`, release) |
| Frontend | `SearchStore` (Start, Sammeln, Drosselung, fremde Job-Ids verworfen, neue Suche bricht alte ab, `removePaths`, Ende/Fehler), Kriterien aus dem Formular (Größe/Datum/Tage), Vorlagen → Glob, `WorkspaceStore` (Such-Tab nicht in der Sitzung), Ordner-Finder-Filter (fuzzy, Sortierung), Dialog-Zustände |
| E2E (Xvfb) | Suche mit Umlauten/Emoji/Hidden/Symlink-Zyklus, Abbruch, Ergebnis-Tab: Markieren + Kopieren + Löschen, Zur Datei, erneut suchen; Ordner-Finder filtern + Enter; 200 000 Dateien (erste Treffer, Stop) |

## 6. Annahmen

- Treffer leben nur im Frontend; ein WebView-Reload verliert sie, die Suche läuft im Backend zu Ende.
- Such-Tabs werden nicht gespeichert (E4).
- Vorlagen und letzte Suchen nur für die Sitzung (E5).
- Fremde Dateisysteme werden durchsucht (E2).
- Umbenennen (F2) und Ordner-Werkzeuge sind im Ergebnis-Tab aus (kein Ordner) – „Offen“.

## 7. Abweichungen bei der Umsetzung

| Punkt | Design | umgesetzt | Grund |
|---|---|---|---|

## 8. Review (separater Agent) – Ergebnis

| # | Befund | Schwere | Umgang |
|---|---|---|---|

## 9. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [ ] Phase 2 Rust
- [ ] Phase 3 Frontend
- [ ] Phase 4 Ende-zu-Ende
- [ ] Phase 5 Doku · [ ] Phase 6 Abschlussprüfung

## 10. Offen

- Dauerhafte Vorlagen/letzte Suchen (015), Laufwerke als Suchort (011), Baumansicht im Ordner-Finder.
- Umbenennen und Ordner-Werkzeuge im Ergebnis-Tab; Ergebnis-Tabs über einen Neustart hinweg.
- Inhaltssuche mit Regex und Kodierungen (UTF-16), Suche in Archiven (016).
