# Design 045: Serien nach Staffeln gruppieren

> **Status:** freigegeben (29.10.2026), in Umsetzung · **Datum:** 29.10.2026 · **Branch:** `feat/serien-gruppieren`
> Auftrag: [045-serien-gruppieren.md](045-serien-gruppieren.md) · Beispiel: [045-serien-gruppieren-beispiel.txt](045-serien-gruppieren-beispiel.txt)
>
> **Entscheidungen (Kurzfassung):** E1 Einsammeln über einen neuen, schmalen Command `collect_files` (eigener
> Walker, keine Links, kein fremdes FS, Grenzen) – nicht über die Suche · E2 Erkennung rein in TypeScript
> (`series-engine.ts` + Fallkatalog), Rust prüft und führt aus · E3 Ausführung = **unveränderte** Job-Art `group`
> (008 E2) · E4 Aufräumen = vorhandener Dialog „Ordner aufräumen“ (008 E3), vorbelegt mit den Release-Ordnern;
> dafür dürfen Systemmüll-Namen künftig `*`/`?` enthalten · E5 Ordnername per Vorlage, Default `S{nn}` · E6 Kopieren
> ist Default (Strg/⌘+Enter), Wurzel = aktueller Ordner · E7 Kürzel `Alt+Shift+G` (⌥⇧G) · Phasen wie üblich (2 Rust
> klein, 3 Frontend groß).

## 1. Bestand

| Baustein | wofür | passt / fehlt / erweitern |
|---|---|---|
| `jobs/group.rs` – `JobSpec::Group { root, items: [{path, group}], transfer, options }` | Gruppenordner anlegen (bestehender echter Ordner = zusammenführen), Paare an `copy::run_pairs` | **passt**: Quellen dürfen in beliebigen Unterordnern liegen (Ziel = `root/group/<name>`); „schon in der Gruppe“ (`src.parent() == dir`) wird übersprungen; Verschieben prüft die Gefahren (`check_danger_with`); Konflikte/Abbruch/Pause aus 005. Nur ein Test mit Quellen aus Unterordnern fehlt |
| `paths::validate_name` | Gruppenname prüfen | passt (Staffelordner-Name) |
| `group-engine.ts` `checkGroupName` | Gruppennamen im Frontend vorab prüfen | passt (wiederverwenden) |
| `GroupFilesStore` / `groupfiles-dialog.ts` | Muster Anfrage → Vorschau → Job → `afterJob` (Meldung, Markierung) | Vorlage für den neuen Store/Dialog |
| `shared/preview-grid/` | GuiExpert-Vorschau mit Zeilenklasse | passt |
| `search.rs` (`walk`) | rekursive Suche | **passt nicht gut**: verlässt fremde Dateisysteme, liefert keine Ordnernamen relativ zur Wurzel, ist an Ergebnis-Tabs/Job-Events gekoppelt (s. E1) |
| `clean.rs` + Job `clean` + `CleanFoldersStore`/Dialog | leere bzw. nur-Müll-Ordner finden und (Papierkorb) löschen, jeder Eintrag wird im Job neu geprüft | **erweitern**: Systemmüll ist heute nur eine Liste exakter Namen (`.DS_Store` …) – `*.nfo`, `*-sample.*` gehen nicht. Store braucht einen Einstieg mit vorgegebenen Wurzeln/Formular |
| `CleanScanState` + `cancel_clean_scan` | Abbruch-Token je Suche | passt (auch für `collect_files`) |
| `FoldersApi` / `FakeFoldersApi` | Fassade der Ordner-Werkzeuge | erweitern um `collectFiles` |
| `dialog-memory.ts` (`dialogs.recent`, max. 8) | letzte Eingaben | erweitern um `'seriesGroup'` (dann 6 von 8 belegt) |
| `core/file-icon/file-types.json` „movies“ | Video-Endungen | nur als Vorbild – eigene Liste (E2) |
| Aktionskatalog, Keymaps, `menu-model.ts` (Menü „Dateien“), `actions-menu-def.ts`, Vetos (`archive-actions`, `remote-actions`, `disk-usage-actions`, `OFF_WHILE_UNCHECKED`) | Aktion verdrahten und sperren | ergänzen |
| mr | `group_filenames`-KI-Prompt („TV series into `/{TITLE}/{Snn}/…`“, mr §9), `ebook_mode` | nur Idee; keine KI, kein Umbenennen (Prompt „Nicht in diesem Prompt“) |

## 2. Entscheidungen

### E1 – Einsammeln: neuer Command `collect_files` (Rust, rein + dünner Command)

| Option | + | − |
|---|---|---|
| A: Job `search` mit Kriterien „Dateien, Endung“ | vorhanden, streamt | Treffer laufen in Ergebnis-Tabs/`SearchStore`; verlässt fremde FS; Filter müssten in Rust, die Vorschau will aber auch die **ignorierten** Dateien zeigen; keine Ordnernamen relativ zur Wurzel |
| **B: Command `collect_files(scanId, root, options)`** | klein, eine Antwort, Ordnernamen relativ zur Wurzel aus Rust (das Frontend splittet nie Pfade), Regeln wie `clean.rs` | ein weiterer Walker (~150 Zeilen) |

**Empfehlung B.** Neues Modul `src-tauri/src/collect.rs` (rein std), Command in `commands.rs` mit `spawn_blocking`
und dem Abbruch-Token aus `CleanScanState` (Abbruch über das vorhandene `cancel_clean_scan`). Regeln:

- Nur **Dateien** (keine Ordner, keine Links – auch nicht auf Dateien: ein Link würde beim Verschieben als Link
  verschoben, beim Kopieren als Link kopiert; für Serien uninteressant und unklar), **Links werden nie verfolgt**.
- **Kein fremdes Dateisystem** (Gerät ≠ Gerät der Wurzel → Ordner nicht betreten; Windows: `file_id` wie `clean.rs`).
- **Versteckte Einträge** (Punkt-Namen, Windows-Attribut) werden übersprungen – wichtig für macOS-`._*`-Dateien
  (AppleDouble auf exFAT/SMB), die sonst als „Video“ durchgingen.
- Grenzen: Tiefe ≤ 16 (Option, Default 8), ≤ 20 000 Dateien, ≤ 500 000 besuchte Einträge → `truncated`; unlesbare
  Ordner gesammelt (≤ 1 000 mit Namen), nie fatal.
- Wurzel: lokaler, existierender Ordner (`resolve_input`/`validate_input_path`; Serverpfade und virtuelle
  Archivpfade werden dort schon abgelehnt).
- Je Datei: `path` (voll, opak), `name`, `size`, `modifiedMs`, `dirs` (Namen der Ordner **zwischen** Wurzel und
  Datei, `[]` = direkt in der Wurzel), `top` (voller Pfad des obersten Ordners unter der Wurzel, `null` bei `dirs = []`)
  und `rel` (relativer Pfad mit OS-Trennern, **nur zur Anzeige**). Reihenfolge: Pfad-sortiert (stabile Vorschau).

### E2 – Erkennung und Filter: rein in TypeScript (`features/seriesgroup/series-engine.ts`)

Wie 007/008 E1: Vorschau ohne IPC bei jeder Optionsänderung, Rust prüft nur noch Namen und führt aus.

**Klassifizierung je Datei** (in dieser Reihenfolge, erste Regel gewinnt):

1. In einem **Beiwerk-Ordner** (ein Name in `dirs` passt zu `junkDirs`, Default `Sample; Samples; Proof`) →
   `ignored` (Grund „Ordner Sample“).
2. Name passt zu einem **Beiwerk-Muster** (`junk`, Default
   `*.nfo; *.sfv; *.srr; *.md5; *.txt; *.url; *.jpg; *.jpeg; *.png; *-sample.*; *.sample.*; sample-*; sample.*`)
   → `ignored`. Muster mit `*`/`?`, ohne Groß/klein – **dieselbe Syntax wie in `clean.rs`** (E4 nutzt die Liste weiter).
3. Endung nicht in **Videos** (Default `.mkv; .mp4; .avi; .m4v; .mov; .wmv; .ts; .m2ts; .mpg; .mpeg; .webm; .flv;
   .divx; .ogm`) und nicht (bei Option **Untertitel**, Default aus) in `.srt; .sub; .idx; .ass; .ssa; .vtt` →
   `ignored` (Grund „kein Video“).
4. **Staffel/Folge** aus dem Dateinamen, sonst aus den Ordnernamen von innen nach außen (`dirs` rückwärts) – nicht
   erkannt → `unrecognized` (wird nicht ausgeführt).
5. Ordnername aus der Vorlage (E5) ungültig (`checkGroupName`) → `invalid`.
6. Datei liegt schon im Zielordner (Wurzel = Quellordner **und** `dirs` = `[<Staffelordner>]`) → `inPlace`.
7. sonst `ok` – zusätzlich Merker `duplicate`, wenn dieselbe (Staffel, Folge) mehrfach `ok` ist.

Die Liste der Videos ist eine **eigene, editierbare Liste** (nicht die Kategorie „movies“ aus `filetypes.json`):
die Vorschau bleibt unabhängig von Nutzer-Dateitypen und testbar (Annahme A1).

**Muster für Staffel/Folge** (Unicode, ohne Groß/klein; „Grenze“ = Anfang/Ende oder ein Zeichen, das weder
Buchstabe noch Ziffer ist):

| Muster | Beispiele | Ergebnis |
|---|---|---|
| `S<1–4 Ziffern>[ ._-]?E<1–4 Ziffern>` an Grenzen | `S01E01`, `s1e1`, `S01.E01`, `S01_E01`, `S01 E01`, `S2024E03` | Staffel, Folge |
| … gefolgt von `[ ._-]?E<n>` oder `-<n>` / `-E<n>` | `S01E01E02`, `S01E01-E02`, `S01E01-02` | Doppelfolge (Folge 1–2) |
| `<1–2 Ziffern>x<2–3 Ziffern>` an Grenzen | `1x01`, `10x112` | Staffel, Folge |
| `Staffel <n> … Folge <n>`, `Season <n> … Episode <n>` (`Ep`, `Ep.` erlaubt, max. 3 Wörter dazwischen) | `Staffel 2 Folge 5`, `Season 1 Episode 10` | Staffel, Folge |

Nie erkannt (Testfälle): `x264`, `h264`, `h.265`, `1080p`, `2160p`, `1920x1080`, `DDP5.1`, `AAC2.0`, `E01` ohne
Staffel, `S01` ohne Folge, Jahreszahl `2019`. Mehrere Treffer in einem Namen: der erste gewinnt. Staffel 0 → `S00`
(Specials) – Annahme A2.

**Hinweise in der Vorschau** (nur Info, blockieren nichts): doppelte Folgen; Lücken in der Folgen-Nummerierung je
Staffel (z. B. „S02: E04 fehlt“); **mehrere Serien** im Ordner – Serienname = Text vor dem Treffer, normalisiert
(Punkte/Unterstriche → Leerzeichen, klein, getrimmt); unterscheiden sich die Namen der `ok`-Zeilen, erscheint eine
Warnung mit den Namen.

### E3 – Ausführung: Job-Art `group` unverändert

Die Paare `{ path, group: <Staffelordner> }` gehen mit `root` und `transfer` an `JobSpec::Group`. Der Job legt
`S01` … an (vorhandener echter Ordner = zusammenführen, Datei/Link gleichen Namens = Fehler für die Staffel),
überspringt „schon in der Gruppe“, gleichnamige Ziele laufen über den Konfliktdialog (005). **Keine Rust-Änderung
am Job** – nur ein neuer Test mit Quellen aus Unterordnern, gemischten Staffeln, schon einsortierten Dateien und
Verschieben (Release-Ordner bleiben mit Beiwerk zurück).

- **Wurzel** = Ordner des aktiven Panels (Default, Marcs Beispiel); Option „In den Ordner der anderen Seite“
  (wie 008, dort umgekehrt als Default). Hat die andere Seite keinen Ordner, ist die Option aus.
- **Kopieren ist Default** (Marc: „hinein kopiert“): Primär-Knopf und Strg/⌘+Enter = Kopieren; Verschieben ist ein
  eigener Knopf. Der Transfer wird **nicht** gemerkt (wie der Löschmodus bei Aufräumen: Default jedes Mal sicher).
- Nach dem Job: Meldung wie Gruppieren (`done`/`withErrors`/`failed`), beide Panels frischen über `DirsChanged`/
  Watcher auf (wie 008).

### E4 – Aufräumen nach dem Verschieben: vorhandener Dialog „Ordner aufräumen“, vorbelegt

| Option | + | − |
|---|---|---|
| **A: nach dem Move-Job den Clean-Dialog (008) öffnen**, Wurzeln = Release-Ordner, Formular vorbelegt | Vorschau, Papierkorb-Default, Job `clean` prüft jeden Ordner neu – alles da und reviewt | Clean kennt heute nur exakte Müll-Namen |
| B: eigene Aufräum-Liste im Serien-Dialog | ein Dialog | doppelte Logik, zweites Review |

**Empfehlung A** mit einer kleinen Erweiterung von `clean.rs`:

- **Systemmüll-Einträge dürfen `*`/`?` enthalten** (`Matcher::is_junk` nutzt dann `glob_match`; gleiche Sperre wie
  bei Mustern: ohne Literal außer `.` → abgelehnt). Exakte Namen verhalten sich wie bisher. Damit gilt ein
  Release-Ordner als „leer“, wenn er nur noch Beiwerk (`*.nfo`, `Sample/*-sample.mkv` …) enthält, und wandert
  **als Ganzes** in den Papierkorb – liegt noch etwas anderes darin (ein nicht erkanntes Video), bleibt er stehen und
  es wird **gar nichts** daraus gelöscht (anders als bei „Dateien nach Muster löschen“). Der Job `clean` prüft das
  unmittelbar vor dem Löschen neu (unverändert).
- **Wurzeln** = die verschiedenen `top` der erfolgreich verschobenen Dateien (Geschwister unter der Wurzel, nie
  verschachtelt, nie die Wurzel selbst und nie ein Staffelordner); `includeRoots = true`; Müll = `junk`-Muster des
  Serien-Dialogs + `DEFAULT_JUNK`; „Dateien nach Muster löschen“ aus.
- Option im Serien-Dialog: „Danach leere Release-Ordner aufräumen“ (Default aus, nur bei Verschieben wirksam).
  Ist sie an, öffnet sich nach einem erfolgreichen Move-Job der Clean-Dialog mit diesen Wurzeln; der Nutzer sieht
  die Liste und bestätigt (Papierkorb, Default). Bei Fehlern im Move-Job: Dialog trotzdem, aber nur mit den `top`
  der erfolgreich verschobenen Dateien.
- `CleanFoldersStore.openPrepared(side, folder, roots, form)` öffnet den Dialog ohne die Panel-Auswahl; Formular
  vorbelegt, **nicht** gemerkt (der normale Clean-Dialog behält seine eigenen letzten Eingaben).

### E5 – Staffelordner-Name per Vorlage

Vorlage mit `{n}` (Zahl ohne Nullen) und `{nn}` (mindestens zwei Stellen, `S100` dreistellig). Auswahl: `S{nn}`
(Default), `Staffel {n}`, `Season {nn}`, `Season {n}`, „Eigene…“ (Textfeld). Eine Vorlage ohne `{n}`/`{nn}` ist
ungültig (alle Folgen in einem Ordner – dafür gibt es „Neuer Ordner“ in 008). Der Name wird in TS (`checkGroupName`)
und vom Job (`validate_name`) geprüft.

### E6 – Dialog

```
┌ Serien nach Staffeln gruppieren – 30 Folgen in 4 Staffeln ─────────────────────────────┐
│ Ordnername [S{nn}            ▾] [ eigene Vorlage …  ]   Ziel: …/Die Kirche bleibt im Dorf │
│ [ ] In den Ordner der anderen Seite   [ ] Untertitel mitnehmen   [x] Ignorierte zeigen     │
│ Videos   [.mkv; .mp4; .avi; .m4v; …                                                ]       │
│ Beiwerk  [*.nfo; *.sfv; *-sample.*; …                ]  Ordner [Sample; Samples; Proof]    │
│ [ ] Nach dem Verschieben leere Release-Ordner aufräumen (Papierkorb)                       │
│ Vorschau                                                                                   │
│ ┌──┬──────────────────────────────────────────────┬───────┬───────┬─────┬───────────────┐ │
│ │Nr│ Quelle (relativ)                             │Staffel│ Folge │ Ziel│ Info          │ │
│ │ 1│ Die.Kirche…S01E01…/die.kirche…s01e01….mkv    │   1   │   1   │ S01 │ ok            │ │
│ │ 2│ Die.Kirche…S01E01…/die.kirche…s01e01….nfo    │       │       │     │ ignoriert     │ │
│ │ 3│ …/Sample/…-sample.mkv                         │       │       │     │ Ordner Sample │ │
│ └──┴──────────────────────────────────────────────┴───────┴───────┴─────┴───────────────┘ │
│ S01: 12 · S02: 6 · S03: 6 · S04: 6 — 30 ausführbar, 60 ignoriert           (aria-live)    │
│ ⚠ Hinweise: …                                                               (role=alert) │
│                                        [Abbrechen] [Verschieben] [Kopieren ⏎]            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- `role="dialog"`, Fokusfalle (Modal), Fokus-Reihenfolge: Vorlage → (eigene Vorlage) → Optionen → Videos → Beiwerk →
  Beiwerk-Ordner → Aufräumen → Vorschau-Grid (`aria-labelledby`) → Abbrechen → Verschieben → Kopieren. Esc schließt,
  Strg/⌘+Enter kopiert.
- Beim Öffnen läuft `collect_files` (Ladeanzeige „Sammle Dateien …“ in der Vorschau, Abbruch beim Schließen über
  `cancelScan`; veraltete Antworten werden verworfen). Optionen ändern die Vorschau **ohne** neuen Scan (alles TS).
- `truncated`/unlesbare Ordner → Hinweiszeile („Nicht alles gelesen: …“), ausführbar bleibt der Rest.
- Zeilenklassen wie 008: `invalid` rot, `ignored`/`inPlace`/`unrecognized` grau, `duplicate` mit Info „doppelt“.
- Knöpfe gesperrt, solange gescannt wird oder 0 Zeilen `ok` sind (zweiter Lauf = alles „schon am Ziel“).
- Letzte Eingaben (`dialogs.recent`, Schlüssel `seriesGroup`): Vorlage, eigene Vorlage, Ziel-Option, Untertitel,
  Ignorierte zeigen, Videos, Beiwerk, Beiwerk-Ordner, Aufräumen – **nicht** der Transfer.

### E7 – Aktion, Kürzel, Menüs, Sperren

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `OPEN_SERIES_GROUP_DLG` „Serien nach Staffeln gruppieren…“ / „Group series by season…“ | **Alt+Shift+G** | **⌥⇧G** (`Alt+Shift+G`) |

In allen drei Keymaps frei (geprüft; `Mod+Shift+G` = `GOTO_FILE` bleibt). Menü „Dateien“ und Actions-Menü direkt
nach „Dateien gruppieren…“, Befehlspalette automatisch über den Katalog (`m(…, 'files', '045')`).
**Gesperrt** in Archiven (`archive-actions`), auf Serverpfaden (`OFF_ON_SERVER`), im Belegungs-Tab, in
Ergebnis-Tabs (kein einzelner Ordner) und bei ungeprüften Listings (`OFF_WHILE_UNCHECKED` – Verschieben ist
destruktiv); `enabled` nur, wenn das aktive Panel einen lokalen Ordner zeigt.

## 3. Verträge

### Rust

```rust
// collect.rs (rein std) – keep in sync with src/app/core/folders/folders.models.ts
#[serde(rename_all = "camelCase")]
pub struct CollectOptions { #[serde(default = "eight")] pub max_depth: u32 /* 1..=16 */ }
pub struct TreeFile {
    pub path: String, pub name: String, pub size: u64, pub modified_ms: Option<i64>,
    pub dirs: Vec<String>,          // folder names between root and file
    pub top: Option<String>,        // full path of the first folder below root
    pub rel: String,                // display only (OS separators)
}
pub struct FileTree {
    pub files: Vec<TreeFile>, pub unreadable: Vec<FsError>, pub unreadable_more: u64,
    pub truncated: bool, pub cancelled: bool, pub visited: u64,
}
pub const MAX_FILES: usize = 20_000; pub const MAX_VISITED: u64 = 500_000; pub const MAX_DEPTH: u32 = 16;
pub fn collect_files_cancellable(root: &Path, o: &CollectOptions, cancel: &AtomicBool) -> Result<FileTree, FsError>;

// clean.rs: Matcher::is_junk – junk entries with `*`/`?` are name patterns (same rules as `patterns`)
```

| Command | Rückgabe / Fehler |
|---|---|
| `collect_files(scanId, root, options)` (async, `spawn_blocking`, Token aus `CleanScanState`) | `FileTree` · `invalid_path`, `not_found`, `not_a_directory`, `permission_denied` (Wurzel) – keine neuen Codes |
| `cancel_clean_scan(scanId)` | vorhanden, stoppt auch `collect_files` |
| `start_job({ kind: 'group', root, items, transfer })` | vorhanden (008) |
| `find_empty_dirs` / `start_job({ kind: 'clean', … })` | vorhanden; `junk` darf Muster enthalten |

### TypeScript

```ts
// core/folders/folders.models.ts
interface CollectOptions { readonly maxDepth: number }
interface TreeFile { readonly path: string; readonly name: string; readonly size: number;
  readonly modifiedMs: number | null; readonly dirs: readonly string[]; readonly top: string | null; readonly rel: string }
interface FileTree { readonly files: readonly TreeFile[]; readonly unreadable: readonly FsError[];
  readonly unreadableMore: number; readonly truncated: boolean; readonly cancelled: boolean; readonly visited: number }
// FoldersApi: collectFiles(scanId, root, options): Promise<FileTree>  (+ FakeFoldersApi)

// features/seriesgroup/series-engine.ts – rein
interface SeriesOptions {
  template: string;            // 'S{nn}' …
  videos: string;              // '.mkv; .mp4; …'
  junk: string;                // '*.nfo; *-sample.*; …'
  junkDirs: string;            // 'Sample; Samples; Proof'
  subtitles: boolean; otherSide: boolean; showIgnored: boolean; cleanup: boolean;
}
interface Episode { season: number; first: number; last: number; series: string }
type SeriesStatus = 'ok' | 'inPlace' | 'ignored' | 'unrecognized' | 'invalid';
type IgnoreReason = 'junkDir' | 'junk' | 'notVideo';
interface SeriesRow { file: TreeFile; status: SeriesStatus; reason: IgnoreReason | null;
  episode: Episode | null; folder: string | null; duplicate: boolean; error: string | null }
function parseEpisode(name: string): Episode | null;
function seasonFolder(template: string, season: number): string;
function planSeries(files: readonly TreeFile[], o: SeriesOptions, sameRoot: boolean): {
  rows: SeriesRow[]; seasons: { folder: string; count: number }[];
  gaps: { folder: string; missing: number[] }[]; seriesNames: string[] };
function cleanupRoots(rows: readonly SeriesRow[], movedOk: ReadonlySet<string>): string[];  // distinct `top`
function restoreSeriesOptions(v: unknown): SeriesOptions;

// features/seriesgroup/series.store.ts – Root (wie GroupFilesStore): request, options, scan (Sequenz), rows,
// items (GroupItem[]), canRun, open(), update(), close(), run('copy'|'move') → afterJob → ggf. Clean
// features/cleanfolders/clean.store.ts: openPrepared(side, folder, roots, form)
```

## 4. Tests

- **Rust (`collect.rs`):** Normalfall mit Unterordnern (`dirs`, `top`, `rel`), Unicode/Leerzeichen/Umlaute,
  versteckte Dateien und `._*` übersprungen, Symlink auf Ordner außerhalb und auf Datei nicht verfolgt bzw. nicht
  gelistet, dangling Link, Tiefe, `MAX_FILES` → `truncated`, Abbruch, unlesbarer Ordner (bedingt, nicht als root),
  nicht-UTF-8-Name (Linux), Wurzel ist Datei/fehlt.
- **Rust (`clean.rs`/`jobs/clean.rs`):** Müll mit Mustern: Release-Ordner nur mit `.nfo` + `Sample/x-sample.mkv` →
  als Ganzes gelistet (Kinder vor Eltern, `includeRoots`), mit zusätzlichem `.mkv` → nichts gelistet; Muster ohne
  Literal abgelehnt; der Job löscht nicht, wenn inzwischen Nicht-Müll hinzukam; exakte Namen wie bisher.
- **Rust (`jobs/tests_tools.rs`):** `group` mit Quellen aus Unterordnern (Kopieren und Verschieben), schon im
  Staffelordner → übersprungen, `S02` existiert als Datei → Fehler nur für Staffel 2.
- **Frontend (rein):** `series-engine.spec.ts` mit Katalog `series-engine.cases.json`: alle Muster, Fehlerkennungen
  (`x264`, `1920x1080`, `DDP5.1` …), Doppelfolgen, Ordner-Fallback, Vorlagen (`{n}`, `{nn}`, ungültig), Filter
  (Beiwerk-Ordner/-Muster, Untertitel), `inPlace`, Dubletten, Lücken, mehrere Serien, `cleanupRoots`. **Marcs
  Beispieldatei** als eigener Test (liest `prompts/045-serien-gruppieren-beispiel.txt` per `node:fs`, baut
  `TreeFile`s): 30 `ok` (S01 12, S02–S04 je 6), 60 `ignored`.
- **Frontend (Store/Dialog, Fakes):** Öffnen scannt, veraltete Antwort verworfen, Schließen bricht ab; Kopieren
  startet einen `group`-Job mit Wurzel = Quellordner; Verschieben + Aufräumen öffnet den Clean-Dialog mit den
  `top`-Wurzeln (nur erfolgreiche); zweiter Lauf → Knöpfe gesperrt; Strg+Enter = Kopieren; letzte Eingaben ohne
  Transfer; Aktion gesperrt in Archiv/Server/Ergebnis-Tab/ungeprüft; Texte en/de vollständig (`catalogs.spec.ts`).
- **E2E (Xvfb):** Fixture aus der Beispieldatei (leere bzw. kleine Dateien) + Ordner mit Umlauten/Emoji, Symlink,
  gesperrtem Ordner; Alt+Shift+G → Vorschau prüfen → Kopieren → `S01`–`S04` im Panel; zweiter Lauf gesperrt;
  Verschieben + Aufräumen → Release-Ordner im Papierkorb (Linux: `~/.local/share/Trash`); light/dark ansehen.

## 5. Annahmen (bitte bestätigen oder korrigieren)

- **A1** Video-Endungen als eigene, editierbare Liste im Dialog (nicht aus den Nutzer-Dateitypen).
- **A2** Staffel 0 (Specials) → Ordner `S00`.
- **A3** Doppelte Folgen werden alle übernommen (nur Hinweis); gleicher Dateiname → Konfliktdialog.
- **A4** Kopieren ist Default und der Transfer wird nicht gemerkt; Wurzel = aktueller Ordner.
- **A5** Aufräumen nur nach Verschieben, über den bestehenden Clean-Dialog mit Bestätigung (Papierkorb).
- **A6** Dateinamen bleiben unverändert (Umbenennen → Multi-Rename 007).
- **A7** Ein Lauf arbeitet auf dem Ordner des aktiven Panels; markierte Unterordner als Startpunkte gibt es
  nicht (Prompt nennt sie als Variante – bei Bedarf später: `collect_files` mit mehreren Wurzeln).

## 6. Abweichungen bei der Umsetzung

- **E4 (Phase 2):** Ein reiner Müll-Unterordner (`Sample/` nur mit `*-sample.mkv`) wird vom Clean-Scan auch dann
  gelistet, wenn der Release-Ordner selbst noch Inhalt hat – das ist das bestehende Verhalten von 008 (leere bzw.
  nur-Müll-Unterordner eines nicht leeren Ordners). Der Release-Ordner selbst bleibt dann stehen. Da als Wurzeln nur
  die Release-Ordner **verschobener** Videos übergeben werden und der Nutzer die Liste bestätigt, bleibt das so
  (Tests `clean::tests::junk_may_be_name_patterns`, `jobs::tests_tools::series_move_then_clean_…`).
- **E1:** Unter Windows gibt es (wie in `clean.rs`) keine Geräte-Id aus `std` – die Grenze „kein fremdes
  Dateisystem“ greift dort nicht; Links (Junctions) werden dennoch nie betreten.

## 6a. Externes Review (separater Agent, 29.10.2026) – Befunde und Behebung

| # | Befund | Behebung |
|---|---|---|
| 1 | **ReDoS** im TS-Musterabgleich (`nameMatcher` baute `.*`-Regexe; `*a*a*a*a*a*b` → 28–41 s, im Test 377 s) – das Muster wird gemerkt und hinge bei jedem Öffnen | Port von Rusts linearem `glob_match` nach TS (Code-Points, ohne Regex); Test „matches patterns in linear time like clean.rs“ (rot → grün) |
| 2 | Aufräumen übernahm die ganze Beiwerk-Liste des Dialogs (`*.jpg`, `*.txt`) als Clean-Müll – ein Ordner mit fremdem `cover.jpg` wäre samt Datei in den Papierkorb gegangen; der Dialog zeigte nur die Anzahl | Clean bekommt nur noch echte Release-Extras (`RELEASE_EXTRAS`: `*.nfo; *.sfv; *.srr; *.md5; *-sample.*; *.sample.*; sample-*; sample.*` + Systemmüll); Rust liefert je Ordner die ersten 5 Müll-Namen (`CleanItem.junkNames`), der Clean-Dialog zeigt sie („mit 7 Müll-Dateien: a.nfo, … …“) – auch im normalen Aufräumen |
| 3 | `openPrepared` bekam den Zielordner statt des Quellordners (Ziel = andere Seite) | `req.sourceDir`; Test „cleanup after a move into the other side …“ |
| 4 | Fehlerkennungen `3x45 Min`; Ordner-Fallback gab allen Dateien eines Sammel-Releases (`Show.S01E01-E10.Complete`) dieselbe Folge | `NxMM` nicht vor „min“; Ordner-Fallback nur, wenn der Ordner genau ein Video enthält; Testfälle im Katalog |
| – | Walker: Ordner könnte zwischen Prüfung und `read_dir` gegen einen Link getauscht werden | akzeptiert wie `clean.rs` (nur listen; der Job prüft jede Quelle neu), im Modulkopf dokumentiert |
| – | Windows: keine Geräte-Id → „kein fremdes FS“ greift nicht | bekannt (Abschnitt 6), wie `clean.rs` |
| – | `failed` kennt nur die ersten 1 000 Fehler | unkritisch: ein nicht verschobenes Video hält seinen Release-Ordner fest; nur reine Müll-Unterordner (`Sample/`) könnten angeboten werden, mit Liste und Bestätigung |
| – | Faltung: `toLocaleLowerCase` vs. `iu` | einheitlich `toLowerCase` |
| – | Texte in `computed` (`rows`, `hints`) | wie `GroupFilesStore`/`CleanFoldersStore`; die Texte sind Proxys auf das Sprach-Signal, die Zeilen rechnen beim Sprachwechsel neu (kein GuiExpert-Modell im `computed`) |

## 7. Fortschritt

- [x] Phase 1 – Bestand, Design (29.10.2026) – freigegeben von Marc (29.10.2026, „passt“, A1–A7 bestätigt)
- [x] Phase 2 – Rust: `collect.rs` + Command `collect_files`, Müll-Muster in `clean.rs`, Tests `group` aus
      Unterordnern und Aufräumen (`jobs/tests_tools.rs` › `series_*`, `clean_with_junk_patterns_rechecks_new_content`)
- [x] Phase 3 – Frontend: `features/seriesgroup/` (Engine + Katalog `series-engine.cases.json`, Store, Dialog,
      Aktion), `FoldersApi.collectFiles` + Fake, Keymaps/Menüs/Vetos, Texte en/de, `CleanFoldersStore.openPrepared`
      (vorbelegtes Formular wird nie gemerkt, das eigene kehrt beim Schließen zurück); `pnpm check` grün
- [x] Phase 4 – E2E unter Xvfb (s. unten)
- [ ] Phase 5 – Doku (README, architecture, roadmap, feature-parity, prompts/README, CLAUDE.md §1/§3)
- [ ] Phase 6 – `pnpm check`, Debug-Build, Review durch separaten Agenten (Schwerpunkte: Walker-Grenzen/Links,
      Müll-Muster im Clean-Job, Verschieben/Aufräumen nie außerhalb der Wurzel)

## 8. Offen

- Umbenennen der Folgen, Metadaten (TVDB/TMDB), mehrere Serien automatisch trennen (Prompt „Nicht in diesem Prompt“).
- Serverordner und Archive als Quelle.
