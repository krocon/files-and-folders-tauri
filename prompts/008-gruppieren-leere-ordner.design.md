# Design 008: Dateien gruppieren, Ordner aufräumen, Multi-MkDir

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) – alle Empfehlungen übernommen ·
> **Datum:** 2026-10-17 · **Branch:** `feat/gruppieren-leere-ordner` (auf `feat/multi-rename`, 007 ist darin fertig)
> **Grundlage:** legacy §3.2 (Group Files), §3/§6 (`delempty`), §9 (Fehler „klettert über den Startordner“),
> mr §5 (11 Gruppier-Modi, Clean Folders mit Muster, Multi-MkDir), Quellcode
> `node-files-and-folders-client/src/fnf/commands/groupfiles/` und mr `feature/cmd/{groupfiles,clean,multimkdir}/`
> (nur Verhalten gelesen), Design 005/006/007 (Job-Engine, Copy/Move, Delete/Papierkorb, Vorschau-Table).
> **Phasen:** alle sechs; Rust und Frontend sind beide betroffen.

---

## 1. Bestand

| Baustein | heute (007) | Bewertung |
|---|---|---|
| Aktionen `OPEN_GROUPFILES_DLG`, `OPEN_DELETE_EMPTY_FOLDERS_DLG`, `OPEN_MULTIMKDIR_DLG` | im Katalog („kommt in 008“), Kürzel `Mod+Alt+G`, `Mod+Alt+Shift+D`, keins für Multi-MkDir | **passt**, Handler + Kürzel ergänzen (E7) |
| `copy::run` (006) | Quellen → **ein** Zielordner, der existieren muss | **erweitern**: Paare *Quelle → Zielordner* (`run_pairs`), sonst unverändert |
| Konfliktdialog (005) | Fragen der Engine je Ziel | **passt** – Gruppieren nutzt ihn unverändert |
| `delete::trash_entry`/Permanent-Löschen (006) | Papierkorb über Crate `trash` | **passt** für einzelne leere Ordner/Dateien |
| `paths::validate_name`, `fileops::check_danger`, `platform::file_id` | vorhanden | **passt** |
| `fileops::make_dir` | ein Ordner, nie überschreiben | **passt** als Kern für Multi-MkDir |
| Vorschau-Table 007 (`multirename/preview-table.ts`) | an `PreviewRow` und Texte gebunden | **verallgemeinern** → `shared/preview-grid/` (Spalten + Zeilenklasse als Input) |
| `selectionForAction`, `selectionInDisplayOrder` | „Markierung, sonst Cursor“ | **passt** (E1: Gruppieren ohne Markierung = alle angezeigten Einträge) |
| `DirectoryListing.segments` | Eltern-Namen ohne Pfad-Splitting | **passt** für `[P]`/`[Q]`/`[R]` in Multi-MkDir |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Gruppieren: Logik in TypeScript, Rust prüft und führt aus ✅

Wie 007 E1: die Gruppe je Datei wird in TS berechnet (Vorschau ohne IPC), Rust bekommt Paare
`{ path, group }` + Wurzel und entscheidet allein über Gültigkeit (`validate_name`), Gefahren und Ausführung.

- **Auswahl:** markierte Einträge, sonst **alle angezeigten** Einträge des Ordners (ohne `..`) – eine einzelne Datei
  zu gruppieren ist sinnlos; die Vorschau zeigt vorher, was passiert (Annahme, legacy nahm die Markierung).
- **Wurzel:** Ordner der anderen Seite (Default), Option „Quellordner als Wurzel“; hat die andere Seite keinen Ordner,
  ist die Option fest an. Ziel = `<wurzel>/<gruppe>/<name>` – den Pfad baut Rust (`Path::join`).
- **Modi** (legacy 10, Reihenfolge wie alt): Laufende Nummer (Default), Neuer Ordner (manuell), Minus-Trenner,
  Erstes Wort, Erster Buchstabe (normal/klein/GROSS), Zwei Buchstaben (normal/klein/GROSS). Regeln wie legacy §3.2,
  mit diesen Änderungen:

| Punkt | alt | neu | Grund |
|---|---|---|---|
| Wörter/Ziffern | `\w`, `\d` (ASCII) | `\p{L}\p{N}_` bzw. `\p{Nd}` | Prompt: „Über alles 01.mp3“ gruppierte nicht |
| Klammern bei Buchstaben-Modi | nur `[\w\d\s]`-Inhalt | jeder Inhalt (wie die anderen Modi) | einheitlich |
| Minus-Trenner | gieriges `(.+) - (.+)` = vor dem **letzten** „ - “ | gleich (Test) | Verhalten bewahren |
| Erstes Wort | `(\w+)\W(.+)` | erstes Unicode-Wort, wenn danach noch etwas folgt | – |
| Laufende Nummer | `\D+`-Läufe | gleich, `#`, `'` und `" Band "` raus, `. _-`/Leerraum trimmen | – |
| Gruppenname | ungeprüft | NFC, getrimmt, Endpunkte/-leerzeichen weg; ungültig (`/ \ : * ? " < > \|`, Steuerzeichen, `.`/`..`, > 255 Bytes) → Zeile „ungültiger Gruppenname“, wird nicht ausgeführt | Prompt |
| Mindestgröße | bei Buchstaben-Modi ohne Wirkung | gilt für alle Modi außer „Neuer Ordner“ | einheitlich, Default 2 |
| Bereits am Ziel | (mr: übersprungen) | Zeile „schon in der Gruppe“, nicht ausgeführt | kein Selbst-Kopieren |

- **Gruppenzahl** im Dialog; „Kopieren“/„Verschieben“ gesperrt bei 0 ausführbaren Zeilen.
- **Nicht in 008:** mr `ebook_mode` (heuristische Serien-Erkennung) und KI-Strategie → „Offen“.

### E2 – Ausführung: neue Job-Art `group` auf der Copy/Move-Engine ✅

| Option | + | − |
|---|---|---|
| **A: `JobSpec::Group { root, items, transfer, options }`** | ein Job, eine Konfliktfrage-Reihe, ein Abbruch; Gruppenordner legt der Job an | `copy::run` braucht Paare statt eines Zielordners |
| B: ein Copy/Move-Job je Gruppe | keine Rust-Änderung an der Engine | 26 Jobs bei „Erster Buchstabe“, Ordner müssten vorher per Command entstehen, „für alle“-Antworten gelten nur je Job |

**Empfehlung A.** Ablauf im Job-Thread: Wurzel ist ein Ordner → je Gruppe `validate_name` und
`create_dir(root/gruppe)` (existiert schon als **echter** Ordner = zusammenführen; als Datei/Link → Fehler für alle
Einträge der Gruppe) → Einträge ausfiltern, die schon am Ziel liegen oder deren Gruppenordner in ihnen selbst läge
(`target_inside_source` je Eintrag statt Abbruch) → `copy::run_pairs` (Konflikte, Temp+Umbenennen, Abbruch, Pause
wie 005/006). Verschieben prüft wie `move` die Gefahren (`check_danger`, ohne Zweitbestätigung). Leer angelegte
Gruppenordner bleiben nach Abbruch stehen (Annahme, im Bericht des Jobs sichtbar über `DirsChanged`).

### E3 – Leere Ordner / Clean Folders: Suche in Rust, Löschen als Job ✅

- `find_empty_dirs(roots, options)` (Command, `spawn_blocking`, schreibt nie): Tiefensuche **ohne Symlinks zu
  folgen** (`symlink_metadata`/`DirEntry::file_type`), **keine fremden Dateisysteme** (Gerät ≠ Gerät der Wurzel =
  „nicht leer“), unlesbare Ordner werden gemeldet und gelten als nicht leer. Ein Ordner ist entfernbar, wenn jeder
  Eintrag (a) ein entfernbarer Ordner, (b) eine Datei nach Lösch-Muster oder (c) bei aktiver Option Systemmüll ist.
  Ein Symlink (auch auf einen leeren Ordner) ist immer Inhalt.
- Ergebnis in **Löschreihenfolge** (Kinder vor Eltern). Der **Startordner** selbst nur mit Option „Startordner
  mitlöschen“ (Default aus); nie etwas oberhalb (es wird nie nach oben gelaufen – der alte Fehler ist strukturell
  ausgeschlossen, Rust-Test).
- Grenzen: 500 000 besuchte Einträge → `truncated` (die angefangenen Ordner gelten als nicht leer), max. 100 000
  Treffer. Abbrechen der Suche = Antwort verwerfen (Sequenz, wie Listing).
- **Löschen** `JobSpec::Clean { roots, items, mode, options }` (seriell, Abbruch/Pause zwischen Einträgen,
  Fortschritt je Eintrag). Der Job **prüft jeden Eintrag neu**: liegt lexikalisch in einer Wurzel (oder ist sie bei
  „Startordner mitlöschen“), kein Pfadteil unterhalb der Wurzel ist ein Symlink, nicht `danger_of`; Datei-Eintrag:
  noch eine Datei/ein Link, Name passt zum Muster; Ordner-Eintrag: echter Ordner, **jetzt** nur noch Systemmüll
  (bzw. leer). Papierkorb (Default): der Ordner samt Müll wandert in den Papierkorb; endgültig: Müll per
  `remove_file`, dann `remove_dir` (scheitert bei neuem Inhalt – nie `remove_dir_all`). Was nicht mehr passt:
  Fehler je Eintrag („nicht mehr leer“), die Eltern bleiben dadurch automatisch stehen.
- **Systemmüll** (Option, Default aus): `.DS_Store`, `Thumbs.db`, `desktop.ini`; die
  Liste ist im Dialog editierbar (`;`-getrennt, Vergleich ohne Groß/klein). **Lösch-Muster** (mr, Option, Default
  aus, Vorgabe `*.bak`): Namensmuster mit `*`/`?`, `;`-getrennt; ein führendes `**/` wird ignoriert (Treffer in jeder
  Tiefe ohnehin). Keine neue Crate (kein `globset`).
- Ordner werden einzeln in den Papierkorb gelegt (verschachtelte leere Bäume = mehrere Papierkorb-Einträge) –
  einfach und je Schritt prüfbar; Zusammenfassen → „Offen“.

### E4 – Multi-MkDir (mr) ✅

- TS erzeugt die Namen: Vorlage (Default `Folder [C]`) mit `[C]` Zähler (Start, Ende, Schritt, Stellen),
  `[L]` Buchstabe (`a`+Zähler mod 26), `[P]`/`[Q]`/`[R]` Elternordner (aus `segments`), Groß-/Kleinschreibung
  (unverändert/GROSS/klein); max. 1 000 Namen; Dubletten und ungültige Namen markiert.
- Rust `create_folders(parent, names)` (Command, `spawn_blocking`): je Name `make_dir` (nie überschreiben), Ergebnis
  je Name (angelegt oder Fehler) – kurz und nicht destruktiv, deshalb kein Job (wie `make_dir` in 006).

### E5 – Gemeinsame Vorschau-Table ✅

`shared/preview-grid/preview-grid.ts`: GuiExpert Table, Spalten (`property`, Titel, Breite) und Zeilenklasse als
Input, Modell einmal gebaut, Zeilen per `setRows` + `repaintHard` (wie 007). Multi-Rename behält seine eigene
Table (kein Umbau eines fertigen Features in diesem Prompt).

### E6 – Dialog-Zustand ✅

Letzte Optionen (Modus, Mindestgröße, Klammern, Quellordner; Clean-Optionen; Multi-MkDir-Vorlage) leben im
Root-Store für die Sitzung (nicht in einer Datei – die Einstellungen kommen mit 015). Annahme.

### E7 – Kürzel ✅

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `OPEN_GROUPFILES_DLG` | **Alt+G** (legacy, neu), Strg+Alt+G (mr, vorhanden) | ⌥G, ⌘⌥G |
| `OPEN_DELETE_EMPTY_FOLDERS_DLG` („Clean folders…“) | **Strg+Alt+R** (legacy, neu), Strg+Alt+Shift+D | ⌘⌥R, ⌘⌥⇧D |
| `OPEN_MULTIMKDIR_DLG` | **Strg+F7** (neu, neben F7) | ⌘F7 |
| im Dialog | Strg/⌘+Enter = Ausführen (Gruppieren: Verschieben/Kopieren gemäß Auswahl), Esc | |

Alle neuen Kürzel sind in den drei Keymaps frei (geprüft).

## 3. Verträge

### Rust

```rust
// jobs/mod.rs
enum JobSpec { …,
  Group { root: String, items: Vec<GroupItem>, transfer: Transfer /* copy|move */, #[serde(default)] options: CopyOptions },
  Clean { roots: Vec<String>, items: Vec<CleanItem>, mode: DeleteMode, options: CleanOptions },
}
struct GroupItem { path: String, group: String }
struct CleanItem { path: String, kind: CleanKind /* dir | file */ }
struct CleanOptions { include_roots: bool, junk: Vec<String> /* leer = aus */, patterns: Vec<String> /* leer = aus */ }

// clean.rs (rein std)
pub fn find_empty_dirs(roots: &[PathBuf], o: &CleanOptions) -> CleanScan;
struct CleanScan { items: Vec<CleanItem>, unreadable: Vec<FsError>, truncated: bool, visited: u64 }
```

| Command | Rückgabe / Fehler |
|---|---|
| `find_empty_dirs(roots, options)` | `CleanScan` · `invalid_path`, `not_a_directory`, `not_found` (Wurzel) |
| `create_folders(parent, names)` | `{ created: string[], errors: { name, error }[] }` · `invalid_path`, max. 1 000 Namen |
| `start_job({ kind: 'group' \| 'clean', … })` | Job-Id; `start_job` prüft nur Form und Gefahren, der Job prüft alles Weitere im eigenen Thread |

Keine neuen Fehlercodes: „nicht mehr leer“ zur Laufzeit ist `io` mit Text (Annahme).

### TypeScript

```ts
// features/groupfiles/group-engine.ts – rein
type GroupMode = 'runningNumber' | 'newFolder' | 'minusSeparator' | 'firstWord'
  | 'firstLetter' | 'firstLetterLower' | 'firstLetterUpper' | 'twoLetters' | 'twoLettersLower' | 'twoLettersUpper';
interface GroupOptions { mode; newFolder: string; ignoreBrackets: boolean; minSize: 0|2|3|4|5|10 }
function groupOf(name: string, o: GroupOptions): string | null;                // ein Name
function groupEntries(names: string[], o): { groups: (string | null)[]; count: number };  // + Mindestgröße
function checkGroupName(g: string): string | null;                             // Fehlertext
// features/multimkdir/mkdir-engine.ts – rein
function folderNames(t: MkdirTemplate, parents: [p, q, r]): { name: string; error: string | null }[];
```

## 4. UI-Skizzen

```
┌ Group files – 24 entries → 3 groups ─────────────────────────────────────────────┐
│ Mode [Running number ▾]  New folder [        ]  Min. group size [2 ▾]             │
│ [x] Ignore brackets  [ ] Use source folder as root    Root: /home/u/Musik         │
│ ┌ Nr ┬ Source ──────────────┬ Group ───────┬ Info ─────────────┐                  │
│ │ 1  │ Band - Titel 01.mp3  │ Band - Titel │ OK                │                  │
│ └────┴──────────────────────┴──────────────┴───────────────────┘                  │
│ 3 groups · 20 entries · 4 without group               [Cancel] [Copy] [Move ⏎]    │
└───────────────────────────────────────────────────────────────────────────────────┘
┌ Clean folders – /home/u/Downloads ───────────────────────────────────────────────┐
│ [x] Delete empty folders  [ ] Also the start folder                              │
│ [ ] Treat as empty: [.DS_Store; Thumbs.db; desktop.ini ]                          │
│ [ ] Delete files matching [*.bak                    ]                [Search]     │
│ ┌ Kind ┬ Path (relative to start) ───────────────────┐                            │
│ └──────┴─────────────────────────────────────────────┘                            │
│ 12 folders · 3 files · 1 unreadable   ( ) Trash (•)  ( ) Permanently  [Cancel] [Delete] │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- Fokus: erstes Feld → Optionen → Table → Buttons; `role="dialog"`, `aria-modal`, Fokusfalle (Modal), Live-Region für
  die Zusammenfassung, Fehler am Feld (`aria-invalid`, `aria-describedby`). Status steht als Text in der Info-Spalte,
  nicht nur als Farbe.
- Clean sucht beim Öffnen und bei jeder Optionsänderung (entprellt 250 ms, veraltete Antworten verworfen); „Delete“
  gesperrt, solange gesucht wird oder nichts gefunden ist. Pfade relativ zum Startordner zeigt Rust nicht an – die
  Table zeigt den vollen Pfad (opak), keine Pfadrechnung im Frontend.
- Multi-MkDir: Vorlage, Start, Ende, Schritt, Stellen, Schreibweise, Liste der Namen (mit Fehlern), „Create“.

## 5. Tests

| Ebene | Fälle |
|---|---|
| TS Gruppier-Engine (tabellengetrieben, `group-engine.cases.json`) | jeder Modus mit Beispielen aus den alten Regeln („Band - Titel 01.mp3“, „Artist - Album - 03 Song.mp3“, „Asterix Band 12.cbr“, „#1 Foo 02“), Klammern an/aus, Unicode-Wörter („Über alles 01“, „Ägypten 3“), Mindestgröße, Buchstaben klein/groß, Emoji, ungültige Gruppennamen, NFD → NFC |
| TS Multi-MkDir | Zähler Start/Ende/Schritt/Stellen, `[L]`, `[P]`, Schreibweise, Dubletten, Grenze 1 000, ungültige Namen |
| Rust Clean | verschachtelt leer (Kinder vor Eltern), Startordner nie / nur mit Option, **nichts oberhalb des Startordners**, Symlink auf leeren Ordner außerhalb (Link = Inhalt, Ziel unberührt), dangling Link, Systemmüll an/aus, Muster `*.bak`, `**/*.bak`, unlesbarer Ordner (als root nur bedingt), Unicode-Namen; Job: Papierkorb nicht prüfbar im Test → endgültig; neue Datei nach der Suche (bleibt, Eltern bleiben), Pfad außerhalb der Wurzel abgelehnt, Symlink-Bestandteil abgelehnt, Abbruch zwischen Einträgen |
| Rust Group | Kopieren/Verschieben in neue Gruppenordner, vorhandener Gruppenordner (Zusammenführen), Gruppenordner als Datei/Link (Fehler je Gruppe), ungültiger Gruppenname, schon am Ziel, Ordner in sich selbst, Konflikt (Frage über die Engine), Wire-Format |
| Rust `create_folders` | angelegt, vorhanden (nie überschrieben), ungültig, Limit |
| Frontend | Stores: Auswahl (Markierung/alle), Wurzel (andere Seite/Quelle), Start der Jobs mit richtigen Specs, Sequenz der Suche, Sperren; Dialog-Tests für Zustände |
| E2E (Xvfb) | Gruppieren per Kopieren und Verschieben mit Konflikt, Clean mit Startordner, Symlink, Systemmüll, Multi-MkDir |

## 6. Annahmen

- Gruppieren ohne Markierung nimmt alle angezeigten Einträge (E1).
- Dialog-Optionen leben nur für die Sitzung (E6).
- Leere Gruppenordner bleiben nach Abbruch stehen.
- Papierkorb aus dem Linux-Container wird über die Crate `trash` (freedesktop) geprüft; macOS/Windows nicht prüfbar.
- „Nicht mehr leer“ zur Laufzeit ist ein `io`-Fehler mit Text, kein neuer Fehlercode.

## 7. Abweichungen bei der Umsetzung

(wird während der Umsetzung gefüllt)

## 8. Review

(wird am Ende gefüllt)

## 9. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [ ] Phase 2 Rust
- [ ] Phase 3 Frontend
- [ ] Phase 4 Ende-zu-Ende
- [ ] Phase 5 Doku · [ ] Phase 6 Abschlussprüfung

## 10. Offen

- mr `ebook_mode`, KI-Strategie fürs Gruppieren, Undo fürs Gruppieren.
- Suche nach leeren Ordnern als abbrechbarer Job mit Fortschritt (heute Command mit Grenze).
- Verschachtelte leere Bäume als ein Papierkorb-Eintrag.
