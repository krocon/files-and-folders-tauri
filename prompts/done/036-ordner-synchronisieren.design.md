# Design 036: Ordner vergleichen und synchronisieren

> **Status:** umgesetzt und reviewt (27.10.2026), Branch `feat/ordner-synchronisieren` · ohne Freigabe-Halt (Marc: „selbständig“) ·
> Phasen 2/3 nacheinander, 4–6 zusammen · neue Crate **keine** (`icu_normalizer` 2.3 war schon im Baum über `url`/
> `idna` und wird nur direkt genannt).

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| Job-Engine (`jobs/`, `Reporter`, `Control`) | Vergleich und Abgleich als Jobs, Abbruch, Pause | **passt** – zwei neue Arten `compare`, `sync` |
| `jobs/copy.rs` (`run_pairs`, Temp + Umbenennen, Konflikte) | Kopieren beim Abgleich | **muss erweitert werden**: Paare *Quelle → genauer Zielpfad* und „dieses Ziel darf ersetzt werden, wenn es noch so aussieht“ (`run_targets`) |
| `jobs/delete.rs` (`run`, Papierkorb/endgültig) | Löschen beim Abgleich | **passt** (je Seite ein Aufruf, Zusammenfassungen werden addiert) |
| `jobs/expect.rs` (`ExpectedEntry`, `changed`) | „ist es noch, was der Vergleich sah?“ | **passt** – jede Zeile trägt die gesehenen Werte beider Seiten |
| `search.rs` (Glob mit `;`, Bündeln ≤ 500/50 ms) | Filter, Zeilen streamen | **passt** – `search::glob_set` ist öffentlich gemacht |
| `listing::is_hidden` | versteckte Einträge wie im Panel | **passt** |
| `JobsStore.onSearchHits` | Treffer an genau einen Hörer | **Muster**: `onCompareRows` gleich gebaut (Puffer bis der Hörer da ist) |
| `PreviewGrid` | Ergebnisliste | **erweitert**: `rowClick` meldet die Spalte (Klick auf die Aktionsspalte schaltet um) |
| `FileBrowserStore.setMarked/clearMarks`, `WorkspaceStore.panel(side)` | Schnellvergleich markiert in beiden Seiten | **passt** |
| Dialog-Gedächtnis 027 (`rememberDialog`) | Optionen des letzten Vergleichs | **passt** (Vorlagen = Aufgabe 7, siehe E9) |

## 2. Entscheidungen

### E1 – Schnellvergleich `COMPARE_DIRS` (Shift+F2) rein im Frontend ✅

Beide Panels haben ihr Listing schon im Speicher; ein Rust-Aufruf brächte nur Wartezeit. `quick-compare.ts` (rein)
vergleicht die oberste Ebene beider Listings und **ersetzt** die Markierung beider Seiten (wie TC):

- markiert wird: was auf der anderen Seite fehlt; bei Dateien beider Seiten die **neuere** (Toleranz 2 s); gleiche Zeit,
  andere Größe → **beide**. Ordner nur, wenn sie drüben fehlen (kein rekursiver Vergleich – dafür der Dialog).
- Namen werden über einen Schlüssel gepaart: NFC (`String.normalize('NFC')`) und – auf macOS/Windows – ohne Groß/klein.
  Kollidieren auf einer Seite zwei Namen unter dem Schlüssel (Linux: `a` und `A`), werden diese exakt gepaart.
- Geht nur, wenn beide Seiten einen Ordner zeigen (kein Ergebnis-/Belegungs-Tab); Archive und Server gehen (Listing).
- Meldung „N links, M rechts markiert“ bzw. „Ordner sind gleich“ über `JobsStore.report`.

### E2 – Vergleich als Job `compare` (Rust `compare.rs` rein + `jobs/compare.rs`) ✅

`JobSpec::Compare { left, right, options }`, parallel, Hilfs-Job (kein Nachfragen beim Beenden). Zeilen kommen als
neues Ereignis `JobEvent::CompareRows { id, rows, stats }` gebündelt (≤ 500 Zeilen oder 50 ms, Statistik spätestens alle
250 ms), Abbruch je Ordner und je 1-MiB-Block beim Inhaltsvergleich. Die Zeilen stehen **nicht** im `JobInfo`.

**Durchlauf:** beide Bäume parallel (eigener Stapel, kein `walkdir`), je Ordner beide Seiten lesen, Einträge über den
Schlüssel paaren (wie E1, `ignore_case`-Option, Default an auf macOS/Windows, aus auf Linux), sortiert nach Schlüssel.
Symlinks werden **nie verfolgt** (Art `link`, verglichen über das Ziel), fremde Dateisysteme werden betreten,
versteckte nur mit Option (Default = Einstellung des aktiven Panels), Ausschlüsse (Glob, Default `.git; node_modules`)
werden nicht betreten. Ordner, die nur auf einer Seite liegen, werden ebenfalls durchlaufen – jede Datei darin ist eine
eigene Zeile (TC-Verhalten; der Filter gilt so auch dort). Grenzen: 200 000 Zeilen (`truncated`), Tiefe 256,
unlesbare Ordner gesammelt (`stats.errors`, max. 1 000).

**Status je Zeile:**

| Fall | Status |
|---|---|
| nur links / nur rechts | `onlyLeft` / `onlyRight` |
| Ordner beidseitig | `equal` (Ordner selbst werden nicht verglichen) |
| Datei ↔ Ordner/Link | `kindMismatch` |
| Inhalt geprüft und gleich | `equal` (auch bei anderer Zeit – TC) |
| Inhalt geprüft und anders bzw. Größe anders | Zeit entscheidet: `leftNewer` / `rightNewer`, Zeit gleich → `differs` |
| ohne Inhalt: Größe und Zeit gleich | `equal` |
| Links: gleiches Ziel → `equal`, sonst wie Dateien nach Zeit | |

„Zeit gleich“ = |Δ| ≤ Toleranz (Default 2 s wegen FAT/SMB); Option „1-h-Abweichungen ignorieren“ (Sommerzeit/FAT):
|Δ − 3600 s| ≤ Toleranz zählt als gleich. Option „Zeit ignorieren“: nur Größe (und Inhalt) zählen, ein Unterschied ist
`differs`. **Inhalt** nur bei gleicher Größe, **byteweise** (beide Dateien werden ohnehin ganz gelesen; ein SHA-256 je
Seite kostet dasselbe I/O plus Rechenzeit und bringt bei zwei Dateien nichts) – Prompt nennt beides als Option.

### E3 – Vorgeschlagene Aktionen im Frontend (`sync-logic.ts`, rein) ✅

Rust liefert nur den Status; die Aktion ist UI-Zustand. Modus **beide Richtungen** (Default), **links → rechts** oder
**rechts → links**, dazu „Überzählige auf der Zielseite löschen“ (Spiegeln, Default aus):

| Status | beide | links → rechts | (+ spiegeln) |
|---|---|---|---|
| `leftNewer` / `onlyLeft` | → | → | → |
| `rightNewer` / `onlyRight` | ← | – (Hinweis „rechts neuer“) | `rightNewer` → ; `onlyRight` = löschen rechts |
| `differs`, `kindMismatch`, `equal` | – | – | `differs` → |

Erlaubt je Zeile: kopieren nur von einer vorhandenen Seite und nicht bei `kindMismatch`; löschen links/rechts nur, wo
etwas ist; „nichts“ immer. **Ordnerzeilen:** kopieren = Ordner anlegen (seine Dateien bringen ihre eigenen Zeilen mit),
löschen = Ordner mit Inhalt. Damit ein gelöschter Ordner nicht im selben Abgleich beschrieben wird, sind sie gekoppelt:
„löschen“ an einem Ordner setzt alle Zeilen darunter auf dasselbe Löschen; jede andere Aktion an einer Zeile darunter
nimmt das Löschen an allen Ordnern darüber zurück. Rust prüft dasselbe noch einmal (E4).

### E4 – Abgleich als **ein** Job `sync` ✅

| Option | + | − |
|---|---|---|
| **A: `JobSpec::Sync { left, right, ops, deleteMode }`, ein Job, Phasen Ordner → Kopien → Löschen** | eine Zeile in der Task-Liste, ein Abbruch, eine Zusammenfassung, Prüfungen zentral | `copy.rs` braucht eine Variante mit genauen Zielpfaden |
| B: Folge von Copy-/Delete-Jobs | nichts Neues in Rust | mehrere Tasks, Konflikt „Ziel existiert“ bei jedem gewollten Überschreiben, keine Gesamtprüfung |

**A.** Jede Operation trägt beide Pfade und die gesehenen Werte (`ExpectedEntry` oder `null` = „war nicht da“):
`SyncOp { action, left: SyncSide, right: SyncSide }`, `SyncSide { path, seen: ExpectedEntry | null }`. Rust prüft beim
Annehmen (`validate`) und **noch einmal direkt vor jedem Schritt**:

1. Pfade wie alle Job-Pfade normalisiert, `..` abgelehnt; jeder Pfad liegt **echt unter** seiner Wurzel (nie die
   Wurzel selbst); linker und rechter Pfad sind derselbe relative Ort (Komponenten gleich unter NFC + Groß/klein).
2. Zwischen Wurzel und Ziel ist **kein Bestandteil ein Symlink** (sonst würde durch einen Link nach außen geschrieben
   bzw. gelöscht) – fehlende Ordner werden einzeln mit `create_dir` angelegt.
3. Quelle ist noch, was der Vergleich sah (Art, bei Dateien Größe + mtime); das Ziel ebenso – oder fehlt noch, wenn es
   fehlte. Sonst Eintrag übersprungen mit `changed_since_listing` (kein Überschreiben von etwas Ungesehenem).
4. Höchstens eine Operation je Pfad; kein Kopierziel und keine Kopierquelle unter einem Pfad, der im selben Job gelöscht
   wird; Löschen auf der Gefahrenliste (`check_danger`) wie überall; Löschen in den **Papierkorb** als Default.

Kopien laufen über die Engine aus 005/006 (`copy::run_targets`): Temp-Datei + Umbenennen, Abbruch lässt nie eine halbe
Datei unter echtem Namen; ein Ziel, das der Vergleich gesehen hat und das unverändert ist, wird **ohne Nachfrage**
ersetzt (der Nutzer hat die Zeile bestätigt); ist es inzwischen anders oder neu aufgetaucht, fragt die Engine (normaler
Konfliktdialog). Ziel-Name = der vorhandene Name drüben (`Foo.txt` bleibt `Foo.txt`). Löschen über `delete::run` je
Seite, verschachtelte Pfade fallen weg. Höchstens 200 000 Operationen.

Vor dem Start zeigt der Dialog eine **Zusammenfassung** (Anzahl + Bytes je Richtung, Löschungen je Seite mit
„Papierkorb“/„endgültig“) und erst „Starten“ startet.

### E5 – Oberfläche: großer Dialog „Ordner synchronisieren“ (`OPEN_SYNC_DIRS_DLG`) ✅

TC zeigt den Abgleich in einem eigenen Fenster; ein Ergebnis-Tab passte nicht, weil eine Zeile **zwei** Seiten hat.

```
┌ Ordner synchronisieren ──────────────────────────────────────────────────────────────┐
│ Links  [/home/m/Fotos                 ]   Rechts [/mnt/nas/Fotos               ]  [⇄] │
│ [x] Unterordner  [ ] Inhalt  [ ] Zeit ignorieren  Toleranz [2] s  [ ] 1 h ignorieren  │
│ [x] Groß/klein egal  [ ] Versteckte  Filter [*      ]  Ausschließen [.git; node_modules]│
│ Richtung (•) beide ( ) links → rechts ( ) rechts → links  [ ] Überzählige löschen      │
│                                                              [Vergleichen] [Stopp]    │
│ Zeigen: [=] [≠] [→] [←] [nur links] [nur rechts]   · 1 203 Zeilen, 37 Unterschiede      │
│ ┌ Name links ────── Größe  Datum ─┬ Aktion ┬─ Datum  Größe ── Name rechts ─────────┐  │
│ │ a/neu.txt         1 KB   12.10. │   →    │                                       │  │
│ │ b.jpg             2 MB   01.10. │   =    │ 01.10.  2 MB   b.jpg                  │  │
│ └─────────────────────────────────┴────────┴───────────────────────────────────────┘  │
│ → 12 Dateien (3,4 MB) · ← 2 (10 KB) · löschen links 0 · rechts 1     [Synchronisieren…]│
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Fokus-Reihenfolge: Pfade, Optionen, Vergleichen, Ansichtsfilter, Liste, Synchronisieren, Schließen. Die Liste ist ein
  fokussierbares Element (`role="grid"` der Table, aktive Zeile per `activeIndex`). Tasten in der Liste (Widget nach
  APG, daher im Dialog erlaubt): ↑/↓/Pos1/Ende/Bild↑/↓ bewegen, **→/←** kopieren nach rechts/links, **Entf** löschen
  (wechselt rechts ↔ links bei beidseitigen Einträgen), **Leertaste** nächste erlaubte Aktion, **=** bzw. Rücktaste
  nichts. Klick auf die Aktionsspalte = nächste Aktion; Buttons „Auswahl: → / ← / nichts“ wirken auf alle *sichtbaren*
  Zeilen.
- Aktions-Spalte zeigt Symbol und `aria-label`-Text; Status als Zeilenklasse (Farbe nur zusätzlich, Symbol trägt die
  Bedeutung). Live-Region für „Vergleich läuft … N Zeilen“ / Summen.
- Default-Ordnerpaar: die aktiven Ordner beider Seiten (linkes Panel = links). `⇄` tauscht.

### E6 – Server und Archive (zweite Stufe) ⏸

Nicht in diesem Branch: Vergleich gegen `remote://` braucht ein rekursives Listing über den `RemoteFs`-Pool und einen
Abgleich über `jobs/transfer.rs` (Server haben keinen Papierkorb, mtime oft nur Minuten genau). Rust lehnt
Server-/Archivpfade für `compare`/`sync` heute mit `remote_unsupported` bzw. `not_a_directory` ab; die Aktion ist dort
gesperrt (Vetos). Notiert in „Offen“ und `docs/feature-parity.md`.

### E7 – NFC/NFD und Groß/klein ✅

Paarung über den Schlüssel (E1/E2). Angezeigt und benutzt wird immer der **echte** Name jeder Seite; beim Kopieren in
eine Lücke entsteht der Name der Quelle. Auf macOS (APFS normalisierungsunempfindlich) findet `symlink_metadata` die
NFD-Datei auch über den NFC-Namen – deshalb Ziel = Pfad des gesehenen Eintrags, nicht neu zusammengesetzt.

### E8 – Kürzel ✅

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `COMPARE_DIRS` | Shift+F2 | ⇧F2 |
| `OPEN_SYNC_DIRS_DLG` | Strg+Shift+S | ⌘⇧S |

Beide im Menü „Befehle“ (Gruppe „Dateien“) und in der Palette; gesperrt in Archiv, Server, Ergebnis-/Belegungs-Tab.

### E9 – Vorlagen 🟡

Die Optionen des letzten Vergleichs merkt sich der Dialog über 027 (`dialogs.recent`, Schlüssel `sync`). Benannte
Vorlagen (Ordnerpaar + Optionen) sind **offen** – das 027-Gedächtnis kennt nur „letzte Eingabe“.

## 3. Verträge

### Rust

```rust
JobSpec::Compare { left: String, right: String, options: CompareOptions }
JobSpec::Sync { left: String, right: String, ops: Vec<SyncOp>, delete_mode: DeleteMode }

struct CompareOptions { recursive: bool /*true*/, content: bool, ignore_date: bool, tolerance_secs: u32 /*2, ≤ 86400*/,
  ignore_hour: bool, ignore_case: bool /*OS-Default*/, hidden: bool, filter: String /*Glob ; , leer = alle*/,
  exclude: String, max_rows: Option<u32> /*200 000*/ }
struct CompareRow { rel: String /* Anzeige, '/' */, depth: u32, kind: RowKind /*file|dir|link|mixed*/,
  left: Option<CompareSide>, right: Option<CompareSide>, status: CompareStatus, content_checked: bool }
struct CompareSide { path: String, name: String, kind: EntryKind, size: Option<u64>, modified_ms: Option<i64> }
enum CompareStatus { Equal, LeftNewer, RightNewer, Differs, OnlyLeft, OnlyRight, KindMismatch }
struct CompareStats { dirs: u64, files: u64, rows: u64, differences: u64, bytes_compared: u64, truncated: bool,
  errors: Vec<ItemError> }
JobEvent::CompareRows { id, rows: Vec<CompareRow>, stats: CompareStats }   // Summary.compare = Some(stats) am Ende

struct SyncOp { action: SyncAction /*copyToRight|copyToLeft|deleteLeft|deleteRight*/, left: SyncSide, right: SyncSide }
struct SyncSide { path: String, seen: Option<ExpectedEntry> }
```

Fehlercodes: vorhandene (`invalid_path`, `not_a_directory`, `changed_since_listing`, `remote_unsupported`,
`dangerous_path`, `too_many`, `target_inside_source`). Neu: keiner.

### TypeScript

`core/sync/sync.models.ts` (Spiegel der DTOs), `JobSpec` um `compare`/`sync`, `JobEvent` um `compareRows`,
`JobsStore.onCompareRows(id, listener)`. Feature `features/sync/`: `quick-compare.ts` (rein), `sync-logic.ts` (rein:
Default-Aktionen, erlaubte Aktionen, Kopplung, Filter, Summen, Ops bauen), `sync.store.ts` (Root), `sync-dialog.ts`,
`sync-actions.ts`, Texte en/de.

## 4. Tests

- **Rust** (`compare.rs` + `jobs/tests_sync.rs`, tempfile): Status-Tabelle (alle Fälle), Toleranz und 1-h-Regel,
  Zeit ignorieren, Inhalt gleich/anders bei gleicher Größe und Zeit, NFC ↔ NFD, Groß/klein an/aus inkl. Kollision,
  Symlinks (auf Datei, Ordner, dangling – nie betreten), Filter/Ausschlüsse/versteckte, nur-eine-Seite-Ordner
  durchlaufen, Grenze `truncated`, Abbruch, großer Baum (`#[ignore]`-Messung); Sync: Kopien beider Richtungen in
  fehlende Unterordner, Ersetzen nur bei unverändertem Ziel, geändertes Ziel → Konflikt bzw. `changed`, Ordner anlegen,
  Löschen links/rechts (Papierkorb/endgültig), Pfad außerhalb der Wurzel / über Symlink / `..` / Wurzel selbst
  abgelehnt, linker ≠ rechter relativer Ort abgelehnt, Kopie unter gelöschtem Ordner abgelehnt, Abbruch → keine
  `.part`-Datei, danach zweiter Vergleich nur `=`.
- **Frontend:** Schnellvergleich (Tabellenfälle, Markierung beider Seiten), Default-Aktionen je Modus, erlaubte
  Aktionen, Kopplung Ordner ↔ Inhalt, Ansichtsfilter, Summen, Ops aus Zeilen, Store mit Fakes (Zeilen streamen,
  veraltete Job-Ids verworfen, Start des Sync-Jobs mit Zusammenfassung).
- **E2E** unter Xvfb: Testordner mit neuen/geänderten/fehlenden Dateien, Unterordnern, Umlauten, Leerzeichen, Emoji.

## 5. Externes Review (separater Agent, 27.10.2026) – alle Befunde behoben

| # | Befund | Schwere | Behebung (Test) |
|---|---|---|---|
| 1 | Ordner löschen nahm Inhalt mit, den der Vergleich nie zeigte (Ausschlüsse `.git`, versteckte, Filter, nicht rekursiv, abgeschnitten, später hinzugekommen) | hoch | Das Frontend schickt den Inhalt mit; Rust löscht einen Ordner nur **ganz**, wenn jeder Eintrag darunter eine Löschung dieses Jobs und unverändert ist (`all_seen_below`), sonst nur die gezeigten Einträge; `CompareRow.complete` (`a_folder_with_unseen_content_is_not_deleted_whole`, `a_file_added_to_a_folder_after_the_comparison_keeps_it`) |
| 2 | Lesefehler auf der Master-Seite → Löschvorschläge auf der Zielseite; Iterationsfehler von `read_dir` nicht gezählt | hoch | Fehler gezählt, `readError` je Ordner und `rootReadError`; darunter (und bei abgeschnittener Liste überall) keine Löschung erlaubt oder vorgeschlagen (`sync.spec.ts` › „no deletes below a folder that could not be read …“) |
| 3 | Wurzeln physisch verschachtelt (Symlink, Bind-Mount) | hoch/mittel | `compare::check_physical` (kanonisch + Geräte/Inode der Vorfahren) in `compile` und erneut in `sync::run` (`roots_nested_through_a_link_are_refused`) |
| 4 | NFC/NFD- bzw. nicht-UTF-8-Namen auf einer Seite fielen zu einer Zeile zusammen | mittel | Kollisionen auch unter dem NFC-Schlüssel, exakter Schlüssel aus den Rohbytes, `lossy`-Namen immer exakt (`nfc_and_nfd_names_on_one_side_stay_two_rows`, `names_that_are_not_utf8_are_paired_exactly_and_marked`) |
| 5 | Groß/klein-unempfindliches Ziel bei `ignoreCase` aus: Kopie und Löschung derselben Datei | mittel | Löschungen von Dateien, die der Job liest oder schreibt (Gerät + Inode), werden abgelehnt (`a_delete_of_a_file_the_job_also_copies_is_refused`, über einen Hardlink nachgestellt) |
| 6 | Link nach der Planung in den Pfad getauscht (TOCTOU) | mittel | `copy::run_targets` nimmt einen `Guard`, der direkt vor jeder Datei `no_link_on_the_way` prüft; ein Restfenster zwischen Prüfung und `open` bleibt (wie bei allen pfadbasierten Jobs) |
| 7 | „Für alle überschreiben“ galt auch für seit dem Vergleich geänderte Ziele | niedrig | geänderte `replace`-Ziele fragen immer (`overwrite_for_all_does_not_cover_a_target_changed_since_the_comparison`) |
| 8 | Nicht-UTF-8-Namen: Aktion lief ins Leere und galt als Erfolg | niedrig | `CompareSide.lossy`, solche Zeilen erlauben nur „nichts“ (`sync.spec.ts` › „lossy names allow nothing“) |

Geprüft und in Ordnung laut Review: richtige Seite je Löschung, `..`/Normalisierung, eine Operation je Pfad, Ordner
nur anlegen (nie rekursiv kopieren), `replace` nur für das exakte Ziel, Abbruch vor den Löschungen, Inhaltsvergleich
ohne Link-Folgen, Kopplung im Frontend.

## 6. Fortschritt

- [x] Design (dieses Dokument)
- [x] Rust `compare` + `sync` (`compare/`, `jobs/compare.rs`, `jobs/sync.rs`, `copy::run_targets`), Tests
- [x] Frontend (`features/sync/`, `core/sync/`, `JobsStore.onCompareRows`, `PreviewGrid.rowClick` mit Spalte)
- [x] E2E Linux (Xvfb, Debug-Build): Testordner mit gleich/neu/geändert/älter/nur links/nur rechts, Unterordnern,
  Umlauten, Emoji, verstecktem Eintrag, Symlinks und `Müller.txt` NFD links ↔ NFC rechts. Shift+F2 markiert links
  `geändert.txt`, `neu links ä.txt`, rechts `älter.txt`, `nur rechts 🎉.txt`, `r` (NFD/NFC gepaart; seit dem E2E nur
  noch Sichtbares – vorher wurde die versteckte Datei mitmarkiert). Dialog: 9 Unterschiede, Entf auf „neu links“ →
  `✕ ·`, Zusammenfassung → Start: Kopien beider Richtungen, Löschung im Papierkorb (`~/.local/share/Trash`), erneutes
  Öffnen vergleicht automatisch: 0 Unterschiede; mit „Inhalt vergleichen“ genau `inhalt.bin` (gleiche Größe/Zeit) `≠`.
- [x] Externes Review (oben), Doku
- Offen: Serverordner/Archive (E6), benannte Vorlagen (E9), macOS (NFD auf APFS, Papierkorb) und Windows bei Marc
  bzw. in der CI; nicht lesbarer Ordner im Container nicht prüfbar (root) – Logik per Spec; Messung 2 × 100 000
  Dateien im Debug-Build 0,9 s (`compare_large_tree`, `#[ignore]`).
