# Design 077: Cleaning Folders – Rückstände in markierten Ordnern aufräumen

> **Status:** umgesetzt (Phasen 1–6), externes Review steht aus (veranlasst Marc) · **Datum:** 25.11.2026 ·
> **Branch:** `feat/rueckstaende-aufraeumen` · Auftrag: [`077-rueckstaende-aufraeumen.md`](077-rueckstaende-aufraeumen.md)
> **Kein Haltepunkt nach Phase 1** (Marc, 25.11.2026): alle Fragen sind hier entschieden, Empfehlung = umgesetzt.

## 1. Bestand

| Baustein | wofür | Urteil |
|---|---|---|
| `clean.rs` `find_empty_dirs`, `Ctx::dir`, `Matcher`, Grenzen | Tiefensuche ohne Links/fremdes FS, Müll-Namen/-Muster | **erweitern**: Urteil je Wurzel, Größen, Größengrenzen, versteckte Dateien, „nicht ausweiden“ |
| `clean::check_roots` | lehnt verschachtelte Wurzeln ab | **ändern**: zusammenführen statt ablehnen (Aufgabe 4) |
| `jobs/clean.rs` | prüft jeden Eintrag neu; Papierkorb je Ordner einzeln | **umbauen**: oberster Ordner als Einheit (ein Papierkorb-Eintrag), Neuprüfung des ganzen Teilbaums mit denselben Regeln wie die Suche |
| `CleanFoldersStore`, `clean-dialog.ts` | Formular, entprellte Suche, flache Liste | **ausbauen** (Variante A) |
| `series-engine.ts` `RELEASE_EXTRAS`, `SeriesGroupStore` → `openPrepared` | Beiwerk-Liste, vorbelegter Dialog | Liste nach `core/folders/release-extras.ts` (eine Quelle), `openPrepared` nimmt das Profil „Release-Reste“ |
| `shared/preview-grid` | GuiExpert Table für Vorschauen, `activeIndex`, `rowClick` | passt (Muster: Sync-Dialog 036) |
| `McpGuardService`/`ProposalService` (071) | Schutz, wenn ein MCP-Client die Markierung setzte | **anschließen** (E9) |
| Vetos: `OFF_IN_ARCHIVE`, `OFF_ON_SERVER`, Belegungs-Tab, `OFF_WHILE_UNCHECKED`, `hasFolder()` (Ergebnis-Tabs: `path()` = null) | Sperren aus Aufgabe 8 | **gilt schon alles** – nichts nachzuziehen |

**Ausgangswert (Fixture aus der Beispieldatei, Test `clean::tests::marcs_tree_*`):** Mit den 008-Defaults liefert der
Scan für alle vier Ordner **nichts**; mit „Startordner selbst“ + Müll `*.nfo; *-sample.*` von Hand: 11 Ordner in
einer flachen Liste, ohne Urteil und ohne Größen.

**Akzeptanzzahlen nachgerechnet** (Beispieldatei): Ordner 2 = 2 Ordner/1 Datei/736 B ✓, Ordner 3 = 2/1/647 B ✓,
Ordner 4 = 7 Ordner (Wurzel + 3 Release + 3 `Sample`), 6 Dateien, 3 × 629 + 57 434 089 + 78 788 631 + 75 799 597 =
**212 024 204 B** ✓. Ordner 1: 3 Dateien, 765 215 206 + 785 569 449 + 415 393 679 = 1 966 178 334 B (= 1,97 GB
dezimal bzw. 1,83 GiB). **Abweichungen zum Prompt-Text:** (a) die Summenzeile der Skizze nennt „8 Dateien“ – richtig
sind **11 Ordner, 8 Dateien, 212 025 587 B**, das stimmt; (b) „202 MiB“ ist binär, „1,97 GB“ dezimal – die App
formatiert einheitlich mit `formatSize` (Einstellung des Nutzers), die Tests prüfen Bytes.

## 2. Entscheidungen

### E1 – Variante A: der vorhandene Dialog wird ausgebaut ✅
Gleiche Aktion `OPEN_DELETE_EMPTY_FOLDERS_DLG`, gleicher Store, gleiche Kürzel. B hätte zwei Menüeinträge und zwei
Löschpfade (zweites Review). Das alte Formular ist das Profil „Eigene“.

### E2 – Scan: `find_empty_dirs` wird erweitert, kein zweiter Command ✅
| Option | + | − |
|---|---|---|
| **A: `find_empty_dirs` erweitern** (`CleanScan.roots`) | ein Durchlauf, eine Regelstelle für Suche **und** Job, `cancel_clean_scan` unverändert | DTO wächst |
| B: `scan_residue` daneben | alter Vertrag unberührt | zwei Durchläufe mit fast gleichen Regeln – genau die Doppelung, die bei einem Löschfeature Fehler macht |

Die Größen fallen beim selben Durchlauf an (`DirEntry::metadata`, kein Folgen von Links).

### E3 – Regeln (alle in `clean.rs`, eine Klassifizierung `Ctx::file` für Suche und Job)
- **Inhalt ist alles, was nicht ausdrücklich Beiwerk ist.** Keine Liste „wichtiger“ Endungen.
- Drei Beiwerk-Arten in `CleanOptions`: `junk` exakte Namen (Systemmüll, ohne Größengrenze – `.DS_Store` kann groß
  sein), `junk` mit `*`/`?` (Grenze `junkMaxBytes`, Default **1 MiB**), `largeJunk` (Sample-Muster, Grenze
  `largeJunkMaxBytes`, Default **300 MiB**). Die Defaults gelten auch, wenn das Feld fehlt (alte Job-Specs):
  fehlend heißt nie „unbegrenzt“. Zu groß → **Inhalt**, Grund `tooLarge`/`sampleTooLarge`.
- **Versteckte Dateien** (Name beginnt mit `.`, unter Windows zusätzlich Attribut „versteckt“) sind Inhalt, außer
  sie stehen als **exakter** Name im Müll. Ein Muster trifft nie eine versteckte Datei. („Dateien nach Muster
  löschen“ im Profil „Eigene“ bleibt wie in 008 – das ist eine ausdrückliche Eingabe.)
- **Nicht ausweiden:** Bleibt ein Ordner stehen (Inhalt, oder er ist die Wurzel und darf nicht als Ganzes gehen),
  gehen darunter nur **wirklich leere** Unterordner (leer oder nur exakter Systemmüll). Ein Unterordner, der nur
  über Muster-Beiwerk „leer“ ist (`Sample/` neben dem Film), geht nur mit `junkDirsBesideContent` (Default
  **aus**; fehlt das Feld: aus). Einzelne Beiwerk-Dateien neben Inhalt bleiben immer. Das ändert das in 045
  „Abweichungen“ beschriebene Verhalten – jetzt eine bewusste Option.
- Unverändert: Links nie folgen (Link = Inhalt), kein fremdes Dateisystem, unlesbar = Inhalt, Nicht-UTF-8-Namen =
  Inhalt, Sonderdateien = Inhalt, nie oberhalb einer Wurzel, Grenzen, Abbruch.
- **Wurzeln zusammenführen** (`merge_roots`): doppelte fallen weg, eine Wurzel innerhalb einer anderen geht in
  ihr auf (lexikalisch nach `normalize_lexically`). Vorher: Fehler.
- **Gefahrenprüfung je Wurzel** (`paths::DangerCheck`: Volume-Wurzel, Home, Systemordner, auch physischer Ort):
  eine solche Wurzel bekommt nie das Urteil „Rückstand“ (`RootVerdict.danger`), der Job lehnt sie zusätzlich ab
  (`check_danger`, wie bisher). Ebenso eine Wurzel, die nur über einen Link erreicht wird (`linked`).
- **Urteil:** `residue` = Wurzel geht als Ganzes (nur mit `includeRoots`, echt, ungefährlich, vollständig
  gescannt); `partial` = Wurzel bleibt, darunter geht etwas; `keep` = nichts. Nach `truncated` bekommen die
  angefangene und alle weiteren Wurzeln `keep` + `incomplete`.

### E4 – Profile ✅ (Vorbelegung bestätigt: letzte Wahl, beim ersten Mal „Nur leere Ordner“)
| Profil | `junk` | `largeJunk` | Sonstiges |
|---|---|---|---|
| **Nur leere Ordner** (`empty`) | `DEFAULT_JUNK` | – | gefahrlos für beliebige Ordner; Default beim ersten Öffnen |
| **Release-Reste** (`release`) | `DEFAULT_JUNK` + `RELEASE_EXTRAS` | `RELEASE_SAMPLES` | Grenzen 1 MiB / 300 MiB sichtbar und änderbar, Option „auch reine Beiwerk-Unterordner neben Inhalt“ |
| **Eigene** (`custom`) | Feld wie bisher (Schalter) | – | „Dateien nach Muster löschen“, „Leere Ordner löschen“, allgemeine Grenze |

Ein Profil, das Dateien löscht, ist nie automatisch gewählt – auch nicht, wenn Ordner markiert sind. Findet „Nur
leere Ordner“ nichts, obwohl in den Ordnern Dateien liegen, zeigt der Dialog einen Hinweis mit Knopf „Release-Reste
probieren“ (kein zweiter Scan auf Verdacht).

**Eine Quelle** `core/folders/release-extras.ts` (045 importiert von dort):
`RELEASE_EXTRAS = *.nfo, *.sfv, *.srr, *.md5, *.url, *-proof.*` (neu: `*.url`, `*-proof.*`),
`RELEASE_SAMPLES = *-sample.*, *.sample.*, sample-*, sample.*`. Die Serien-Engine (045) nutzt weiter beide
zusammen als „Extras“ ihres Dialogs.
**Bewusst nicht:** Bilder allgemein (`*.jpg`/`*.png` – Fotoordner), Untertitel und ein Ordner `Subs`,
Archivteile (`*.rar`, `*.r00`: groß und unwiederbringlich – auch nicht als Option; wer das will, nimmt „Eigene“ und
hebt die Grenze an), **keine Ordner-Regel** („alles in `Sample/`/`Proof/` ist Beiwerk“): `sample/` gibt es auch in
Code-Projekten; in Releases heißen die Dateien selbst `…-sample.*`.

### E5 – Eingabe ✅ (F8 als Maßstab)
Markierung vorhanden → die markierten **echten Ordner** (Links nicht; markierte Dateien werden gezählt und als
Hinweis genannt). Keine Markierung → der Ordner unter dem Cursor (echter Ordner, nicht `..`). Sonst (Cursor auf
Datei/`..`, oder nur Dateien markiert) → der Panel-Ordner. Markierte/Cursor-Ordner dürfen als Ganzes gehen
(`includeRoots = true`); der **Panel-Ordner selbst nie** (`includeRoots = false`) – man sägt nicht den Ast ab, auf
dem das Panel sitzt. Die frühere Checkbox „Auch der Startordner selbst“ entfällt (alte gemerkte Werte werden
ignoriert).

### E6 – Ausführung: oberster Ordner als Einheit ✅
Heute: jeder leere Ordner einzeln in den Papierkorb (MobLand = 7 Einträge). Neu in `jobs/clean.rs`:
1. Datei-Einträge (Muster-Löschen) einzeln wie bisher.
2. Von den Ordner-Einträgen nur die **obersten** (kein gelisteter Ordner darüber). Für jeden: `verify_top` (in
   einer Wurzel, Wurzel selbst nur mit `includeRoots`, kein Link auf dem Weg, `check_danger`, echter Ordner) und
   dann **`clean::plan_tree`** – derselbe Durchlauf wie die Suche, jetzt auf dem Teilbaum, mit denselben Optionen
   (Größengrenzen, versteckt, Links, fremdes FS). Nur wenn der Teilbaum **jetzt** vollständig entfernbar ist:
   Papierkorb → **ein** `trash_one(top)`; endgültig → der frische Plan Ordner für Ordner (Kinder zuerst) über
   `remove_below` (nie `remove_dir_all`, O_NOFOLLOW).
3. Passt der Teilbaum nicht mehr (Film dazugelegt, Sample gewachsen): der oberste Ordner bleibt **ganz** stehen
   (Fehler „nicht mehr leer“), seine gelisteten Unterordner zählen als übersprungen – er wird nicht ausgeweidet.
`Summary.bytesDone` = Bytes der entfernten Dateien (für die Meldung). Was der Job löscht, ergibt sich aus dem
frischen Plan, nicht aus der Liste der Vorschau – die Liste bestimmt nur, **welche obersten Ordner** angefasst
werden dürfen.
**Rest-Risiko** (unverändert seit 008): zwischen `plan_tree` und `trash_one` (per Pfad) liegt ein kleines
Zeitfenster. „Nicht ausweiden“ prüft auch der Job: Ein gelisteter Ordner, dessen Elternordner stehen bleibt, geht
nur, wenn er wirklich leer ist (oder die Option gesetzt ist) – nur eine Wurzel selbst darf als reiner
Beiwerk-Ordner gehen. Scheitert ein oberster Ordner, werden seine gelisteten Kinder mit derselben Regel einzeln
neu entschieden (wirklich leere gehen, Beiwerk-Ordner bleiben).

### E7 – Dialog
```
Ordner aufräumen – 4 Ordner in /…/Filme.nosync
Profil: (•) Nur leere Ordner ( ) Release-Reste ( ) Eigene          [▸ Regeln]
  (Regeln, eingeklappt: Grenzen, Option „Beiwerk-Unterordner“, bei „Eigene“ die Felder von 008)
┌ Ordner ────────────────────────────────────────────────────────────────────┐
│ ☑  Mein Land … (2025)      Rückstand   2 Ordner · 1 Datei · 736 B    –      │   Fokus 2: Liste (Pfeile, Leertaste)
│ –  Lustiges Taschenbuch…   bleibt      –            3 Dateien · 1,97 GB (.cbr)
└────────────────────────────────────────────────────────────────────────────┘
Details: <Ordner unter dem Cursor>
┌ geht/bleibt │ Eintrag │ Grund ───────────────────────────────────────────────┐
3 Ordner werden gelöscht · 11 Ordner, 8 Dateien · 202 MiB     (•) Papierkorb ( ) endgültig   [Esc] [↩ Aufräumen]
```
- Fokus-Reihenfolge: Profil (Radiogruppe) → Regeln (`<details>`, bei „Eigene“ offen) → Ordnerliste (**Autofokus**:
  Pfeile zeigen sofort die Details, Leertaste wählt ab, Enter räumt auf; geschützt für MCP liegt der Autofokus
  auf „Abbrechen“) (`tabindex=0`, APG-Grid-Muster wie
  Sync 036: ↑/↓/Bild/Pos1/Ende, **Leertaste** = an/abwählen, Klick in die Checkbox-Spalte) → Details → Löschmodus
  → Knöpfe. Live-Region nennt Zeile und Urteil.
- Zeilen „bleibt“ sind nicht anwählbar (`–`), „Rückstand“ und „teilweise“ sind vorgewählt.
- Tasten nach 057/076: Papierkorb = `primary` (↩), endgültig = `destructive:D` (nie Enter), Abbrechen = Esc,
  Hinweis-Knopf „Release-Reste“ = `secondary:R`.
- Namen sind Text der Table (nie `innerHTML`); Name der Wurzel und relativer Pfad der Einträge kommen aus Rust
  (`RootVerdict.name`, `CleanItem.rel` – nur Anzeige).

### E8 – Nach dem Job
Meldung mit Anzahl und Bytes („in den Papierkorb“ bzw. „freigegeben“). Die Markierung wird nicht mehr pauschal
aufgehoben: gelöschte Ordner verschwinden beim Auffrischen aus der Markierung, gebliebene bleiben markiert.

### E9 – MCP (071): der Clean-Dialog ist betroffen ✅
Der Dialog löscht anhand von Markierung/Cursor. Hat ein MCP-Client sie gesetzt und der Nutzer seither nichts
geändert (`McpGuardService.influence`), wird der Dialog **wie ein Vorschlag geschützt** – genau wie F8: Hinweis
`ProposalNote`, Knopf mit Rolle `confirm` (Mod+Enter oder Klick, nie Enter allein), gesperrt bis die Tastatur
ruhig war (`ProposalService.watch/locked`), endgültig ganz ohne Taste, nach Bestätigen `guard.forget`. Zusätzlich
gilt die kurze Sperre `guard.locked()` über das Veto, das 071 für dateiändernde Aktionen schon setzt. Ein eigenes
MCP-Werkzeug „clean vorschlagen“ gibt es nicht (→ Offen). `openPrepared` (045) ist nicht betroffen: seine Wurzeln
kommen aus dem eben gelaufenen Job, nicht aus der Markierung.

## 3. Verträge

### Rust (`clean.rs`)
```rust
pub struct CleanOptions {            // serde camelCase, alle neuen Felder mit Default
    pub empty_dirs: bool, pub include_roots: bool,
    pub junk: Vec<String>, pub patterns: Vec<String>,
    pub large_junk: Vec<String>,             // Muster mit der großen Grenze (Samples)
    pub junk_max_bytes: u64,                 // Default 1 MiB  – Muster in `junk`
    pub large_junk_max_bytes: u64,           // Default 300 MiB – `large_junk`
    pub junk_dirs_beside_content: bool,      // Default false
}
pub struct CleanItem { path, kind, junk, junk_names, bytes: u64, rel: String /* Anzeige */, soft: bool }
pub enum Verdict { Residue, Partial, Keep }
pub enum KeepReason { Content, TooLarge, SampleTooLarge, Hidden, Link, Unreadable, OtherFs, Special }
pub struct KeptEntry { rel: String, bytes: u64, reason: KeepReason }
pub struct RootVerdict {
    path, name, verdict,
    first: usize, count: usize,              // Abschnitt in `items`
    remove_dirs, remove_files, remove_bytes: u64,
    keep_files, keep_bytes: u64,
    keep_extensions: Vec<String>,            // die häufigsten, ≤ 3
    keep_sample: Vec<KeptEntry>,             // die ersten, ≤ 20
    too_large, sample_too_large, hidden, links, blocked: u64,
    danger: Option<Danger>, linked: bool, incomplete: bool,
}
pub struct CleanScan { items, roots: Vec<RootVerdict>, unreadable, unreadable_more, truncated, cancelled, visited }
pub fn scan(roots, options, home, cancel) -> Result<CleanScan, FsError>;   // find_empty_dirs* = dünne Hüllen
pub fn merge_roots(roots) -> Result<Vec<PathBuf>, FsError>;
pub fn plan_tree(top, root, options, matcher) -> Result<Option<TreePlan>, FsError>;  // None = nicht (mehr) entfernbar
```
Command `find_empty_dirs(scanId, roots, options)` unverändert im Namen; reicht den Home-Ordner durch. Keine neuen
Fehlercodes. Job `clean`: `JobSpec::Clean` unverändert in der Form.

### TypeScript
`core/folders/folders.models.ts` spiegelt die DTOs; `CleanForm` bekommt `profile`, `junkMaxMb`, `sampleMaxMb`,
`junkDirsBesideContent`. Reine Helfer in `features/cleanfolders/clean-logic.ts`: `cleanOptions(form, includeRoots)`,
`cleanInput(folder, marked, cursor)`, `rootRows`, `detailRows`, `keepReason`, `sums`, `restoreCleanForm`.

## 4. Tests
- **Rust `clean.rs`:** Marcs Baum (008-Defaults = nichts; „Release-Reste“ = Zahlen oben; „Nur leere Ordner“ =
  viermal `keep`), drei Urteile, beide Größengrenzen (auch genau auf der Grenze), versteckte Dateien, Links,
  unlesbar, `truncated`/`incomplete`, verschachtelte/doppelte Wurzeln, Home/Volume-Wurzel, nicht ausweiden ±
  Option, alte Tests angepasst (Begründung im Test).
- **Rust `jobs/tests_tools.rs`:** Rückstand als Ganzes endgültig und (bedingt) in den Papierkorb, neue Datei →
  Ordner bleibt ganz, gewachsenes Sample, Abbruch, nie oberhalb der Wurzel, kein Ausweiden beim Scheitern.
- **Frontend:** `clean-logic.spec.ts` (tabellengetrieben), Store (`groupfiles/tools.spec.ts`:
  Profile → Optionen, Vorwahl, Abwählen, Summen, veraltete Antworten, Job nur mit angewählten, Formular merken –
  nie der Löschmodus, `openPrepared`, MCP-Schutz), Dialog (`tools-dialogs.spec.ts`), `dialog-roles`, `catalogs`.
- **Nur Ende-zu-Ende:** echter Papierkorb, Tabelle im echten Fenster.

## 5. Abweichungen bei der Umsetzung

- **E6:** Scheitert ein oberster Ordner, bleibt er nicht pauschal „samt allem“ stehen: seine gelisteten Kinder
  werden einzeln neu entschieden, wirklich leere gehen weiter (so blieb `clean_rechecks_every_entry` aus 008
  gültig). Reine Beiwerk-Unterordner gehen dann **nicht** (anders als 045: Test
  `clean_with_junk_patterns_rechecks_new_content` angepasst, Begründung im Test).
- **E3:** `check_roots` (Fehler bei verschachtelten Wurzeln) ist durch `merge_roots` ersetzt; der Test
  `roots_are_checked` prüft jetzt das Zusammenführen.
- **045:** `RELEASE_EXTRAS` liegt in `core/folders/release-extras.ts`; `openPrepared` übergibt
  `{ ...DEFAULT_CLEAN_FORM, profile: 'release' }` statt eines Mustertexts. Neu in der Liste: `*.url`,
  `*-proof.*`. Samples haben jetzt die 300-MiB-Grenze, die übrigen Muster 1 MiB – auch nach „Serien nach Staffeln“.
- **Aufgabe 6:** Ohne Markierung ist der **Ordner unter dem Cursor** die Eingabe (vorher: der Panel-Ordner). Der
  Panel-Ordner wird nur noch genommen, wenn der Cursor auf einer Datei oder `..` steht – und geht dann nie selbst.
  Die Checkbox „Auch der Startordner selbst“ gibt es nicht mehr.
- **Marcs Fixture** (`src-tauri/src/testdata/clean-marcs-tree.txt` = Kopie der Beispieldatei, sparse per
  `set_len`) läuft nur unter Unix (`#[cfg(unix)]`): NTFS belegt für `set_len` ohne Sparse-Flag echten Platz (2 GB).
- **Befund am Rand:** Der Job aus 008/045 prüfte Beiwerk nur über den Namen. Die neuen Tests waren gegen den
  alten Job rot (6 von 10): ein nach der Vorschau gewachsenes „Sample“ und eine neue versteckte `.x.nfo` wären
  mitgelöscht worden.
- `command-palette.spec.ts`: Die Eingabe `copy…` traf nur zufällig ein zweites Label („Clean folders (delete empty
  folders)…“); der Test tippt für die Pfeiltasten jetzt `copy`.

## 6. Verifikation (ehrlich)

| Akzeptanzkriterium | geprüft durch |
|---|---|
| Marcs Beispiel, „Release-Reste“: Urteile und Zahlen 2/1/736, 2/1/647, 7/6/212 024 204 | Rust `clean::tests::marcs_tree_release_leftovers` (echtes Dateisystem, sparse); Dialog: `clean-logic.spec.ts`, Screenshot-Szene `clean-folders-dialog` (Mock-Backend mit denselben Regeln) |
| Aufräumen → drei Ordner weg, Comic-Ordner unverändert | Rust `jobs::tests_tools::clean_marcs_tree` (**endgültig**, nicht Papierkorb) |
| … **im Papierkorb**, je Ordner ein Eintrag | nur Linux-Test `delete_to_the_trash` → `clean_residue_is_one_trash_entry` – **auf dem Mac kompiliert, nicht gelaufen**; echter macOS-Papierkorb **nicht geprüft** |
| „Nur leere Ordner“ → viermal „bleibt“, Knopf gesperrt, Hinweis | Rust `marcs_tree_only_empty_folders_keeps_all_four`; `tools-dialogs.spec.ts`, `tools.spec.ts`; Szene `clean-folders-hint` |
| Sample 4 GiB hält den Ordner | Rust `a_huge_sample_keeps_its_folder`, `size_limits_turn_extras_into_content` |
| Film + leerer Unterordner + `Sample/` → „teilweise“, Option | Rust `the_three_verdicts_and_no_gutting`; Job `clean_does_not_gut_a_folder_with_content_even_when_asked_to` |
| Datei zwischen Vorschau und Start | Job `clean_leaves_a_residue_alone_that_got_content_after_the_preview`, `clean_rechecks_size_limit_and_hidden_files` |
| Symlink, unlesbar, Home | Rust `links_and_unreadable_folders_hold_a_residue`, `a_home_folder_never_goes_as_a_whole`, 008-Tests; **Mountpoint** und **Volume-Wurzel** nur über den vorhandenen Code-Pfad (Geräte-Id, `paths::danger_of` mit eigenen Tests) – kein eigener Test |
| `openPrepared` (045) | `series.spec.ts`, Rust `series_move_then_clean_…` |
| 50 000 Einträge bedienbar, abbrechbar | **nicht gemessen**; Abbruch und Grenze: Rust `a_cancelled_scan_ends_early`, `a_scan_at_its_limit_is_incomplete`, Store-Test „cancels a running search …“ |
| Tastatur, de/en | `tools-dialogs.spec.ts` (Pfeile, Leertaste, Enter, Pos1/Ende), `catalogs.spec.ts`, `dialog-roles.spec.ts`; Screenreader **nicht** geprüft |
| Ende-zu-Ende im echten Fenster | **nicht durchgeklickt.** Die Debug-Binary wurde gebaut und mit eigenem `HOME` gestartet (`node scripts/mcp-e2e.mjs`: 26 Prüfungen grün – Start, Panels, Jobs), der Clean-Dialog lässt sich aber nur per Tastatur/Maus öffnen: Tastendrücke an ein Fenster zu schicken, während Marc am Rechner arbeitet und seine installierte App dieselbe Kennung trägt, war das Risiko nicht wert. |

## 7. Offen

- Externes Review (000 Phase 6) – veranlasst Marc. Schwerpunkte: `clean.rs` `Ctx::walk`/`Ctx::dir`
  (Entfernbarkeit, Filter „nicht ausweiden“), `Matcher::classify`, `plan_tree`, `jobs/clean.rs` `locate`,
  `remove_tree`, `run` (Reihenfolge Eltern → Kinder, `Outcome`).
- Echter macOS-/Windows-Papierkorb mit einem Rückstands-Ordner; Klick-Durchlauf im echten Fenster.
- `docs/screenshots/readme/clean-folders.png` ist unkomprimiert (kein `pngquant` auf dem Rechner):
  `pnpm screenshots:readme` mit `pngquant` holt das nach.
- Windows: keine Geräte-Id aus `std` (wie 008/045) – die Grenze „kein fremdes Dateisystem“ greift dort nicht.
- Nicht in diesem Prompt: automatisches Aufräumen ohne Dialog, Abgleich „liegt der Film woanders?“, Serverpfade
  und Archive, benannte eigene Profile, MCP-Werkzeug `propose_clean`, Option „entpackte Archivteile“.
- „Dateien nach Muster löschen“ (Profil „Eigene“) trifft weiterhin auch versteckte Dateien (wie 008).

## 8. Fortschritt

- [x] Phase 1 Design (25.11.2026, ohne Haltepunkt)
- [x] Phase 2 Rust: Scan mit Urteil, Schutzregeln, Job (Tests zuerst rot gegen den alten Job)
- [x] Phase 3 Frontend: Logik, Store, Dialog, Texte de/en, Kontextmenü, MCP-Schutz
- [x] Phase 4: Debug-Build, Start mit eigenem `HOME`, Screenshots light/dark/Norton – Klick-Durchlauf offen (s. §6)
- [x] Phase 5 Doku, Prompt nach `prompts/done/`
- [x] Phase 6 `pnpm check`
