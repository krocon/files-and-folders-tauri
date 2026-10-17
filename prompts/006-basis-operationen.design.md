# Design 006: Basisoperationen – Ordner, Datei, Umbenennen, Kopieren, Verschieben, Löschen

> **Status:** 🛑 Entwurf, wartet auf Freigabe · **Datum:** 2026-10-17 · **Branch:** `feat/basis-operationen`
> (von `feat/job-queue`)
> **Grundlage:** legacy §3/§4/§6, mr §3/§5/§7, Design 005 (Job-Engine, Kopieren), CLAUDE.md §4 (Destruktives nur
> im Backend validiert, Papierkorb als Standard).

---

## 1. Bestand

| Baustein | heute (005) | Bewertung |
|---|---|---|
| Job-Engine `jobs/` | Kopieren mit Planung, Temp + Umbenennen/Hard-Link, Konflikte, Pause/Abbruch, Fehler je Eintrag | **passt**; neue Job-Arten `move`, `delete`, `count`; `copy` bekommt Optionen |
| `Conflict`/`Decision` | Ziel existiert | **erweitern** um die Frage „schreibgeschützt löschen?“ (`kind`) |
| F5 minimal (`job-actions.ts`) | Rückfrage + Start | **wird ersetzt** durch den Kopier-/Verschiebedialog |
| Regel „Markierung, sonst Cursor“ | in `job-actions.ts` (`sources()`) | **wird zentral** (`selectionForAction`) und gilt für alle Operationen |
| `resolve_location` (003) | Pfadeingabe → Ordner | **passt** für das Zielfeld im Dialog |
| `changedDirs` (005) | Zielordner | **erweitern**: Verschieben/Löschen melden auch die Quellordner |
| Aktionen (002) | `OPEN_COPY/MOVE/RENAME/MKDIR/CREATE_FILE/DELETE_DLG` „kommt in 006“ | **Handler**; neu `DELETE_PERMANENT`, `RENAME_INLINE` |
| GuiExpert Table | `startEditing(row, column)`, eigener `getEditRenderer` je Spalte | **passt** für Inline-Umbenennen (Spike in Phase 3) |

## 2. Entscheidungen (Empfehlungen)

### E1 – Papierkorb mit der Crate `trash` 5.2.9 (MIT, 30+ Mio. Downloads) ✅

Geprüft im Quellcode der Version:

| OS | Weg in `trash` | Verhalten / Risiko | Umgang |
|---|---|---|---|
| Windows | `IFileOperation` mit `FOF_ALLOWUNDO` | wiederherstellbar über den Papierkorb. **Risiko:** Laufwerke ohne Papierkorb (Netzlaufwerk, manche USB-Sticks) – Windows kann dann endgültig löschen | vor dem Löschen prüfen, ob das Laufwerk einen Papierkorb hat (`SHQueryRecycleBin`); sonst Frage „endgültig löschen?“ statt still. **Nur unter Windows prüfbar** |
| macOS | Finder per `osascript` (Default) | „Zurücklegen“ im Finder möglich; beim ersten Mal fragt macOS nach der Erlaubnis, den Finder zu steuern | bei verweigerter Erlaubnis Rückfall auf `NSFileManager.trashItem` (ohne „Zurücklegen“) + einmaliger Hinweis |
| Linux | freedesktop-Spezifikation (`~/.local/share/Trash` bzw. `$topdir/.Trash-$uid`) | auf fremden Volumes ohne Papierkorb → Fehler (verschiebt nie über Geräte) | Fehler je Eintrag, Angebot „endgültig löschen“ |

Symlinks werden selbst in den Papierkorb gelegt, nicht ihr Ziel (die Crate kanonisiert nur den Elternordner –
geprüft). Löschen in den Papierkorb ist ein Job (je Eintrag, abbrechbar zwischen den Einträgen).

### E2 – Symlinks: immer als Link kopieren/verschieben, keine Option ✅

Wie 005. „Ziele kopieren“ würde Zyklen und doppelte Daten erzeugen; kann in 015 als Einstellung kommen, wenn
gewünscht. Endgültiges Löschen entfernt den Link, nie das Ziel.

### E3 – Inline-Umbenennen (F2) mit dem Editor der GuiExpert Table ✅

`tableApi.startEditing(row, 'name')` mit einem **eigenen Edit-Renderer** für die Namensspalte: Eingabefeld, in dem
der Name **ohne Endung** markiert ist (`setSelectionRange`), Enter = umbenennen, Esc = abbrechen. Das Modell
übernimmt den Wert nicht selbst (`setValue` → Rust-Command, danach Neu laden). Spike zu Beginn von Phase 3; klappt
es nicht sauber, öffnet F2 den Umbenennen-Dialog (Shift+F6) und die Lücke geht als G17 an das Mono-Repo.

### E4 – Ein Dialog für Kopieren und Verschieben (F5/F6) ✅

- **Quelle:** Name bzw. „N Einträge“ + Live-Zählung („1 234 Dateien, 56 Ordner, 3,4 GB“) über einen `count`-Job
  (parallel, wird beim Schließen abgebrochen).
- **Ziel:** Textfeld (vorbelegt: Ordner der anderen Seite) + Liste: andere Seite, Tabs beider Seiten, Favoriten,
  zuletzt besucht (ohne Dubletten). Validierung über `resolve_location` beim Bestätigen.
- **Einzelne Datei in denselben Ordner** (oder Ziel = Dateiname): Zielname editierbar → „Kopie unter neuem Namen“
  (TC). Rust prüft: Name gültig, Ziel ≠ Quelle.
- **Optionen:** Vorgabe bei Konflikten (fragen · überschreiben · überspringen · wenn neuer · umbenennen), im
  Hintergrund. Strg/⌘+Enter = Start, Esc = abbrechen.

### E5 – Verschieben ✅

- **Gleiches Volume:** `rename` je oberstem Eintrag (atomar, schnell). Ziel existiert: Datei → Konfliktfrage;
  Ordner → zusammenführen (die Kinder werden einzeln verschoben, der leere Quellordner danach entfernt).
- **Anderes Volume** (`EXDEV`/`ERROR_NOT_SAME_DEVICE`): je Datei kopieren (wie 005, Temp + Umbenennen) und die
  Quelle **erst nach erfolgreicher Kopie** löschen; Quellordner am Ende nur mit `remove_dir` (nur wenn leer – was
  übersprungen wurde oder scheiterte, bleibt mit seinem Ordner stehen). Abbruch: Bereits Verschobenes bleibt
  verschoben, der Rest unverändert – nie ein Zustand „weder hier noch dort“.
- Validierung wie Kopieren (Ziel in Quelle, auf sich selbst) im Backend.

### E6 – Löschen ✅

| | Papierkorb (Standard) | Endgültig |
|---|---|---|
| Kürzel | F8, Entf · macOS `⌘⌫` | Shift+F8, Shift+Entf · macOS `⌘⌥⌫` |
| Dialog | „N Einträge in den Papierkorb legen?“, Enter = **Löschen** (wiederherstellbar) | roter Dialog „N Einträge endgültig löschen – nicht wiederherstellbar“, Enter = **Abbrechen** |
| Rust | `trash::delete` je Eintrag | eigener Durchlauf (Kinder zuerst), folgt keinen Links, abbrechbar, Fortschritt in Einträgen |

Schreibgeschützte Dateien (Windows-Attribut, Unix-Ordner ohne Schreibrecht) beim endgültigen Löschen:
Frage wie ein Konflikt („trotzdem löschen · überspringen · abbrechen“, „für alle“) – `Conflict.kind = readOnly`.

### E7 – Schutz vor gefährlichen Pfaden ✅

Rust `paths::danger_of(path)`: Wurzel (`/`, `C:\`), Laufwerks-/Volume-Wurzeln, das Home-Verzeichnis selbst,
Systemordner (`/System`, `/usr`, `/bin`, `/etc`, `/Library`, `C:\Windows`, `C:\Program Files*`, …). Verschieben,
Umbenennen und Löschen solcher Pfade lehnt Rust ab, **außer** die Anfrage trägt `allowDangerous: true`; das Frontend
setzt das nur nach einer zweiten, ausdrücklichen Bestätigung (Pfad wird angezeigt). Kopieren *aus* solchen Ordnern
ist erlaubt.

### E8 – Ordner anlegen, Datei anlegen, Umbenennen: schnelle Commands, keine Jobs ✅

Sie überschreiben nie etwas (Ziel existiert → Fehler), sind also nicht destruktiv und brauchen keinen Fortschritt:

- `make_dir(parent, name)`: `a/b/c` erlaubt (nur relative Segmente, kein `..`), jedes Segment validiert; der neue
  (oberste) Ordner bekommt den Cursor. Vorschlag: nächster Name einer Serie (`S01`, `S02` → `S03`, mr), sonst Name
  der Markierung/des Cursors ohne Endung (legacy).
- `create_file(parent, name)`: `create_new` (nie überschreiben), Cursor darauf.
- `rename_entry(path, newName)`: nur der Name; Ziel existiert → Fehler; **nur Groß-/Kleinschreibung** geändert
  (`a.txt` → `A.txt`) auf case-insensitiven Dateisystemen → über einen Zwischennamen.

### E9 – Namensprüfung zentral in Rust ✅

`paths::validate_name(name)`: nicht leer, nicht `.`/`..`, keine Trenner, kein NUL, ≤ 255 Byte (Windows: ≤ 255
UTF-16-Einheiten); **unter Windows zusätzlich** `< > : " | ? *`, Steuerzeichen, Leerzeichen/Punkt am Ende,
reservierte Namen `CON PRN AUX NUL COM1–9 LPT1–9` (auch mit Endung). Die Regeln gelten unter Windows immer und
werden auf macOS/Linux als **Warnung** angezeigt, wenn das Ziel vermutlich ein FAT/NTFS-Laufwerk ist (nur Hinweis,
kein Verbot – das Dateisystem meldet selbst einen Fehler). Gleiche Funktion für Kopieren-unter-neuem-Namen und
Konflikt-Umbenennen.

### E10 – Einheitliche Auswahlregel und Freigaben ✅

`selectionForAction(panel)`: markierte Einträge, sonst der Cursor-Eintrag, nie `..` (legacy `getRowsForAction`).
Freigaben nach mr §3: Kopieren/Verschieben/Löschen ≥ 1 Eintrag; Umbenennen genau 1; Ordner/Datei anlegen immer
(außer ohne Ordner). Nach der Operation: verarbeitete Einträge entmarkieren, betroffene Ordner beider Seiten neu
laden (`changedDirs` meldet bei Verschieben/Löschen auch die Quellordner), Cursor auf neuem/umbenanntem Eintrag.

## 3. Verträge

### Rust

```rust
enum JobSpec {
  Copy  { sources, target_dir, background, options: CopyOptions },     // 005 + Optionen
  Move  { sources, target_dir, background, options: CopyOptions, allow_dangerous: bool },
  Delete{ paths, mode: Trash | Permanent, background, allow_dangerous: bool },
  Count { paths },                                                       // Live-Zählung im Dialog
  DirSize { path }, Simulate { .. },
}
struct CopyOptions { conflict_default: Ask|Overwrite|Skip|OverwriteIfNewer|Rename, rename_to: Option<String> }
struct Conflict { kind: Exists | ReadOnly, .. }       // 005 + kind
```

| Command | Rückgabe / Fehler |
|---|---|
| `make_dir(parent, name)` | Pfad des obersten neuen Ordners · `already_exists`*, `invalid_name`* |
| `create_file(parent, name)` | Pfad · `already_exists`, `invalid_name` |
| `rename_entry(path, newName, allowDangerous)` | neuer Pfad · `already_exists`, `invalid_name`, `dangerous_path`* |
| `check_paths(paths)` | `{ path, danger: null \| 'root' \| 'home' \| 'system' }[]` (für die Zweitbestätigung) |
| `start_job(spec)` (005) | zusätzlich `dangerous_path`, `invalid_name` |

`*` neue Fehlercodes – in `error.rs`, `fs.models.ts`, `describeFsError()`.

### Aktionen und Kürzel

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `OPEN_COPY_DLG` / `OPEN_MOVE_DLG` | F5 / F6 | F5 / F6 |
| `OPEN_RENAME_DLG` / `RENAME_INLINE` *(neu)* | Shift+F6 / F2 | Shift+F6 / F2 |
| `OPEN_MKDIR_DLG` / `OPEN_CREATE_FILE_DLG` | F7 / Shift+F4 | F7 / Shift+F4 |
| `OPEN_DELETE_DLG` | F8, Entf | F8, ⌘⌫ |
| `DELETE_PERMANENT` *(neu)* | Shift+F8, Shift+Entf | Shift+F8, ⌘⌥⌫ |

## 4. UI-Skizze Kopieren/Verschieben

```
┌ Kopieren ───────────────────────────────────────────────┐
│ 3 Einträge  ·  1 234 Dateien, 56 Ordner, 3,4 GB (zählt…) │
│ Nach: [/Users/marc/Ziel                       ] [▾]      │
│        ▾ andere Seite · Tabs · Favoriten · zuletzt        │
│ Bei vorhandenen Dateien: (•) fragen ( ) überschreiben …   │
│ [ ] im Hintergrund                                        │
│                               [Abbrechen] [Kopieren ⏎]   │
└──────────────────────────────────────────────────────────┘
```

Fokus: Zielfeld (markiert) → Liste ▾ → Optionen → Buttons. `role="dialog"`, Fokusfalle, Hintergrund `inert` (005).

## 5. Tests

| Ebene | Fälle |
|---|---|
| Rust | `validate_name` je OS (reserviert, Zeichen, Länge, Unicode); `danger_of`; mkdir verschachtelt/existiert; create_file nie überschreiben; rename (existiert, nur Groß/klein über Zwischenname, ungültig); Copy-Optionen (Vorgabe für alle, `rename_to`); **Move** gleiches Volume (Datei, Ordner, zusammenführen, Konflikte), über Volumes **simuliert** (Hook erzwingt den Kopierpfad): Quelle erst nach Kopie weg, übersprungene bleiben, Abbruch mittendrin → nichts verloren, Quellordner nur wenn leer; **Delete** endgültig (Baum, Link nicht verfolgt, schreibgeschützt fragt, Abbruch), Papierkorb (Linux, freedesktop im Temp-HOME); Ordner in sich selbst verschieben/kopieren verweigert; Zyklus endet |
| Frontend | `selectionForAction`, Freigaben, Serien-Vorschlag (S01/S02 → S03), Kopier-/Verschiebedialog (Ziel-Liste, Zählung, Strg+Enter, Fehler im Feld, Name bei Einzeldatei), Löschdialog (Default-Button je Modus, Zweitbestätigung bei gefährlichen Pfaden), Mkdir/Datei/Umbenennen (Cursor auf Ergebnis), Inline-Umbenennen (Auswahl ohne Endung) |
| Ende-zu-Ende | alle fünf Operationen mit Testordnern (Unicode, Links, schreibgeschützt), Konflikt „für alle“, Abbruch, Papierkorb (Linux: Datei liegt in `~/.local/share/Trash`), endgültig |

**Nicht im Container prüfbar:** Papierkorb unter macOS/Windows, Verschieben über echte Volumes (nur simuliert bzw.
`/tmp` ↔ `/dev/shm`, falls verfügbar), Windows-Sonderfälle (lange Pfade, reservierte Namen auf NTFS,
Schreibschutz-Attribut).

## 6. Fortschritt

- [x] Phase 1: dieses Dokument
- [ ] Freigabe
- [ ] Phasen 2–6
