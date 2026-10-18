# Design 016: Archive (ZIP/TAR) und Duplikate

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) – alle Empfehlungen übernommen ·
> **Datum:** 2026-10-18 · **Branch:** `feat/archive-duplikate` (von `main`, 001–012 fertig)
> **Grundlage:** legacy §3/§9 (nur Platzhalter), mr §3/§5/§7 (Zip-Browsing `datei.zip:`, Pack/Unpack-Dialog,
> „Find duplicates“ nur als Kürzel), Design 005 (Job-Engine, Konflikte), 006 (Temp + Umbenennen, Papierkorb),
> 009 (Such-Job, Ergebnis-Tab).
> **Umfang:** Prompt ist „optional, L“ – der Kern wird vollständig umgesetzt (alle sechs Phasen), Weiteres steht
> unter „Offen“.

---

## 1. Bestand

| Baustein | heute (012) | Bewertung |
|---|---|---|
| `list_directory` + `DirectoryListing` | nur echte Ordner | **erweitern**: Rückfall auf Archive (virtueller Pfad), Feld `archive` |
| `FileBrowserStore` (Navigation, Verlauf, Breadcrumbs, Tabs, Sitzung) | arbeitet mit opaken Pfaden aus Rust | **passt** – virtuelle Pfade aus Rust laufen durch alles durch; nur Enter auf ein Archiv und Schreibschutz neu |
| Job-Engine (`JobSpec`, Konflikte, `Control`, `Reporter`) | copy/move/delete/… | **erweitern**: Job-Arten `extract`, `pack`, `duplicates` |
| `copy.rs` (`walk`, `suggest_name`, `place` = Temp + `rename_noreplace`) | privat bis auf `walk`/`suggest_name` | `walk` für Packen wiederverwendet; Platzieren als `pub(crate)` |
| `search::walk` (zyklensicher, Ausschlüsse, Hidden, `/proc`) | max. 100 000 Treffer | **wiederverwendet** für die Duplikatsuche (eigene Grenze per `with_max_hits`) |
| Such-Ergebnis-Tab (`SearchStore`, `showSearch`, Spalte Folder, F5/F6/F8, `removePaths`) | Treffer = `SearchHit` | **wiederverwendet** für Duplikate: `SearchHit.group`, Spalte „Group“, Auswahlhilfen |
| Löschdialog (`OpsStore.openDelete`, Papierkorb als Default) | – | **wiederverwendet**; neue Warnung „Gruppe verliert jede Kopie“ |
| Kopierdialog (F5) | Kopieren/Verschieben | **erweitern**: Quelle im Archiv → Job `extract` (gleicher Dialog, Titel „Extract“) |
| Aktionen `OPEN_PACK_DLG`, `OPEN_UNPACK_DLG`, `OPEN_FIND_DUPLICATES_DLG` | Platzhalter „016“ | Handler + Kürzel; neu `DUP_MARK_*` |
| Watcher (`WatchService`) | beobachtet `store.path()` | **anpassen**: virtuelle Archiv-Pfade nicht beobachten |

## 2. Entscheidungen

### E1 – Archiv als virtueller Ordner über `list_directory` ✅

| Option | + | − |
|---|---|---|
| **A: virtueller Pfad `…/a.zip/inner/dir` (Rust baut ihn mit `Path::join`), `list_directory` fällt auf das Archiv zurück** | Navigation, `..`, Breadcrumbs, Zurück/Vor, Tabs, Sitzung, Tab-Titel funktionieren ohne Änderung; Frontend bleibt pfad-opak | jede Funktion, die einen echten Ordner braucht, muss den Archiv-Modus kennen (sonst nur „nicht gefunden“ aus Rust) |
| B: eigener Modus wie der Such-Tab (`TabState.archive`) | klare Trennung | Navigation, Verlauf, Breadcrumbs, Sitzung neu bauen |
| C: Präfix `zip:` (mr) | sichtbar | Frontend müsste Pfade zerlegen (CLAUDE.md §4) |

**Empfehlung A.** `list_directory(p)`: Ist `p` ein Ordner → wie bisher. Ist `p` eine reguläre Datei mit Archiv-Endung
(`.zip`, `.tar`, `.tar.gz`, `.tgz`) → Wurzel des Archivs. Existiert `p` nicht, wird der nächste Vorfahr gesucht, der
eine reguläre Archiv-Datei ist; der Rest ist der innere Ordner. Ein virtueller Pfad kann real nie existieren (sein
Vorfahr ist eine Datei) – Schreiboperationen darauf scheitern in Rust ohnehin (`not_found`/`not_a_directory`).
`DirectoryListing.archive = { path, inner, format, unsafeEntries, entries }`; `parent` der Archiv-Wurzel ist der
echte Ordner des Archivs (`..` → Cursor auf dem Archiv). Enter auf eine Datei mit Archiv-Endung öffnet sie wie einen
Ordner (TC, mr). Ordnergrößen im Archiv rechnet Rust gleich mit (Summe der Einträge).

**Index-Cache:** das Inhaltsverzeichnis eines Archivs (bei `.tar.gz` nur durch vollständiges Entpacken lesbar) wird in
einem LRU mit 4 Archiven gehalten, Schlüssel *Pfad + Größe + Änderungszeit* – ein geändertes Archiv wird neu gelesen.

**Schreibschutz:** Im Archiv gehen nur Kopieren (= Entpacken), Ansehen der Liste, Markieren, Packen der Markierung
ist aus. F6/F8/F2/F7/Shift+F4/Multi-Rename sind gesperrt (`OpsStore.folder()` = null im Archiv); F3/Enter auf einer
Datei im Archiv zeigen „erst entpacken (F5)“ (Öffnen über Temp → Offen). Der Watcher beobachtet Archiv-Pfade nicht.

### E2 – Crates ✅

| Crate | Lizenz | Pflege | Größe / Features | Entscheidung |
|---|---|---|---|---|
| `zip` 9 (zip-rs/zip2) | MIT | aktiv, Standard-Crate | `default-features = false`, nur `deflate-flate2` (kein AES, bzip2, zstd, lzma, time) | ✅ lesen + schreiben |
| `tar` 0.4 (alexcrichton) | MIT/Apache | Standard (cargo selbst) | `default-features = false` (ohne `xattr`), zieht `filetime` | ✅ |
| `flate2` 1 | MIT/Apache | rust-lang | **schon im Baum** (Tauri), Backend miniz_oxide/zlib-rs | ✅ für `.tar.gz` |
| `sha2` 0.10 (RustCrypto) | MIT/Apache | aktiv | **schon im Baum** (Tauri) – null neue Crates; SHA-NI per `cpufeatures` | ✅ Hash für Duplikate |
| `blake3` | CC0/Apache | aktiv | schneller, aber neue Crate + C/asm-Build | ❌ (Platte ist der Engpass) |
| `xxhash` | BSL | – | nicht kryptografisch: gezielt erzeugte Kollisionen möglich – beim Löschen zu riskant | ❌ |
| 7z (`sevenz-rust2`, Apache-2.0) | ok | klein | nur bewertet | → Offen (lesen machbar) |
| RAR (`unrar`, C++ unRAR-Lizenz) | **unfrei** (verbietet RAR-Kompressor-Nachbau, nicht OSI) | – | – | ❌ nur über ein externes Tool (011) |
| 7-Zip-Sidecar (mr) | LGPL + unRAR-Klausel | – | ~1,5 MB je OS, Signierung | ❌ jetzt, ggf. 017 |

### E3 – Sicherheit beim Entpacken (zentral) ✅

1. **Namen** (`archive::sanitize`, auch beim Auflisten): `\` gilt als Trenner; abgewiesen werden absolute Namen
   (`/x`, `\x`), Laufwerksbuchstaben/Doppelpunkte (`C:x`, ADS `a:b`), `..`, NUL, Steuerzeichen, leere Komponenten
   in der Mitte bleiben ignoriert (`a//b` = `a/b`), `.` wird übersprungen; jede Komponente zusätzlich durch
   `paths::validate_name` (Windows-Regeln unter Windows: reservierte Namen, `<>:"|?*`, Punkt/Leerzeichen am Ende).
   Abgewiesene Einträge erscheinen nicht in der Liste (Zähler `unsafeEntries` im Header) und sind beim Entpacken
   Fehler je Eintrag (`unsafe_entry`) – der Rest läuft weiter.
2. **Links und Sonderdateien im Archiv** (ZIP-Unix-Modus `S_IFLNK`, TAR Symlink/Hardlink/Gerät/FIFO) werden **nie**
   angelegt: sie werden aufgelistet (Art „Link“), beim Entpacken übersprungen und als Fehler gemeldet.
3. **Ziel ohne Umwege:** jeder Ordner auf dem Weg im Zielordner wird per `symlink_metadata` geprüft; ein Link (z. B.
   `ziel/x → /etc`, vorher angelegt oder aus demselben Archiv) bricht den Eintrag ab (`unsafe_entry`); nur echte
   Ordner werden betreten, fehlende mit `create_dir` angelegt.
4. **Zip-Bomben:** max. **200 000 Einträge**; Summe der angegebenen Größen ≤ **64 GiB** und ≤ **1 100 × Archivgröße
   + 1 MiB** (Deflate schafft höchstens ~1 032 : 1 – mehr bedeutet überlappende Einträge wie bei Fifields Bombe);
   beim Schreiben wird **nie mehr als die angegebene Größe** gelesen (`take(size + 1)`, mehr = Fehler), bei `.tar.gz`
   zählt der Job die entpackten Bytes gegen dieselbe Grenze. Verschachtelte Archive werden nicht automatisch geöffnet.
5. **Nie überschreiben ohne Entscheidung:** Ziel vorhanden → dieselbe Konfliktfrage wie beim Kopieren (Default aus dem
   Dialog, „für alle“), Ordner werden zusammengeführt, Datei ↔ Ordner = Fehler.
6. **Temp + Umbenennen:** jede Datei → `.fnf-<job>-<n>.part` im Zielordner → `rename_noreplace` (bzw. `rename` bei
   „Überschreiben“); Abbruch/Fehler löscht die Temp-Datei. CRC wird vom `zip`-Crate geprüft (Fehler = Datei verworfen).
7. Verschlüsselte Einträge, unbekannte Kompression → Fehler je Eintrag (`archive_error`).

### E4 – Entpacken: Job `extract` ✅

- **F5 im Archiv-Panel**: Kopierdialog (Titel „Extract“, Ziel = anderes Panel, „Falls vorhanden“) → Job mit den
  markierten virtuellen Pfaden. Ein Ordner wird mit allem darunter entpackt, unter seinem Namen (wie Kopieren).
- **Alt+F9** auf Archiv-Dateien im normalen Panel: Entpacken-Dialog (Ziel, „in Unterordner *Name*“ – Default an,
  Rust bildet den Namen ohne Endung –, Konflikt-Default). Mehrere markierte Archive = mehrere Jobs (serielle Queue).
- Fortschritt in Bytes (angegebene Größen), Abbruch/Pause je Block, `dirsChanged` für den Zielordner.

### E5 – Packen: Job `pack` (Alt+F5) ✅

Dialog: Dateiname (Default `<Name>.zip` bei einem Eintrag, sonst `<Ordner>.zip`), Format ZIP/TAR/TAR.GZ (Endung folgt),
Zielordner (anderes Panel), Kompressionsstufe 1–9 (Default 6, ZIP/GZ). Rust: Quellen wie beim Kopieren planen
(`copy::walk`, Links **nicht** folgen – sie werden übersprungen und gemeldet, Sonderdateien ebenso), Archiv in
`.fnf-<job>.part` neben dem Ziel schreiben, dann `rename_noreplace`; existiert das Ziel → Konfliktfrage
(Überschreiben/Überspringen/Umbenennen). Der Zielordner darf nicht in einer Quelle liegen, wenn das Archiv selbst
mitgepackt würde – unkritisch, weil der Plan vor dem Anlegen der Temp-Datei steht (Temp nie im Archiv). Unix-Rechte und
Änderungszeit werden mitgespeichert. Packen in ein geöffnetes Archiv und Passwörter → Offen.

### E6 – Duplikate: Job `duplicates` ✅

- **Kriterien** (`DuplicateCriteria`): Wurzeln (aktueller Ordner bzw. markierte Ordner), `compare: size | content`
  (Default `content`), `sameName` (zusätzlich gleicher Name, ohne Groß/klein), `minSize` (Default 1 Byte – leere
  Dateien sind immer „gleich“ und uninteressant), versteckte, Ausschlüsse (Default `.git; node_modules`),
  `maxFiles` (Default 500 000, max. 2 000 000).
- **Stufen:** Durchlauf mit `search::walk` (nur Dateien, keine Links folgen, zyklensicher) → Gruppen nach Größe
  (+ Name) → **gleiche Datei nur einmal** (gleiche Geräte-/Inode-Nummer = Hardlink oder doppelte Wurzel: das ist keine
  Kopie, Löschen spart nichts) → Teil-Hash **erste + letzte 64 KiB** (SHA-256) → bei Dateien > 128 KiB voller
  SHA-256 → Gruppen ≥ 2. Fortschritt: Phase „scanning“ (Dateien), dann Bytes zu hashen/gehasht. Abbruch je 64-KiB-Block.
- **Ergebnis** als Ergebnis-Tab wie die Suche (E4 aus 009): Treffer = `SearchHit` + `group` (1…n, nach verschwendeten
  Bytes absteigend), gesendet als `searchHits` am Ende in Bündeln; Spalte **Group** (nur in Duplikat-Tabs sichtbar),
  Zeilen nach Gruppe sortiert, abwechselnde Gruppen-Schattierung. Header: Gruppen, Dateien, „x MB doppelt“.
- **Auswahlhilfen** (Aktionen + Buttons im Header, Befehlspalette): „alle außer neuester“, „alle außer ältester“,
  „alle außer erster (kürzester Pfad)“ – je Gruppe bleibt **immer** mindestens eine Datei unmarkiert.
- **Löschen** nur über F8/Shift+F8 und den bestehenden Löschdialog (Papierkorb als Default). Der Dialog warnt, wenn eine
  Gruppe ganz markiert ist („3 Gruppen verlieren jede Kopie“). Gelöschtes verlässt das Ergebnis (009 `removePaths`).
- Warum kein Row-Grouping der GuiExpert Table: Gruppenzeilen würden Markierung, Cursor, F8 und `removePaths` des
  Ergebnis-Tabs aushebeln; eine sortierbare Gruppenspalte mit Schattierung reicht und bleibt bedienbar.

### E7 – Kürzel ✅

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `OPEN_PACK_DLG` | Alt+F5 (TC) | ⌥F5 |
| `OPEN_UNPACK_DLG` | Alt+F9 (TC) | ⌥F9 |
| `OPEN_FIND_DUPLICATES_DLG` | Alt+Shift+F7 (neben Suchen) | ⌥⇧F7 |
| `DUP_MARK_ALL_BUT_NEWEST` / `_OLDEST` / `_FIRST` | ohne Kürzel (Header-Buttons, Palette) | – |

## 3. Verträge

### Rust

```rust
// list_directory(path) – unverändert, Rückfall auf Archive; DirectoryListing bekommt:
pub archive: Option<ArchiveInfo>, // skip_serializing_if None
pub struct ArchiveInfo { path: String, inner: String /* "a/b", "" = Wurzel */, format: ArchiveFormat,
                         unsafe_entries: u32, entries: u32 }
pub enum ArchiveFormat { Zip, Tar, TarGz }            // "zip" | "tar" | "tarGz"
JobSpec::Extract { archive: String, entries: Vec<String> /* virtuelle Pfade, leer = alles */,
                   target_dir: String, into_subfolder: bool, options: CopyOptions }
JobSpec::Pack { sources: Vec<String>, target_dir: String, name: String, format: ArchiveFormat,
                level: Option<u32> /* 1–9 */ }
JobSpec::Duplicates { criteria: DuplicateCriteria }   // parallel, Hilfs-Job; Treffer als SearchHits
DuplicateCriteria { roots, compare: Size|Content, same_name, min_size, include_hidden, excludes,
                    max_files, skip_virtual_fs }
SearchHit { …, group: Option<u32> }                   // skip_serializing_if None
SearchStats { …, groups: u64, bytes_to_hash: u64, bytes_hashed: u64 } // serde default 0
FsErrorCode: ArchiveError ("archive_error"), UnsafeEntry ("unsafe_entry"), ArchiveTooLarge ("archive_too_large")
```

### TypeScript

`fs.models.ts`: `ArchiveInfo`, `DirectoryListing.archive?`, neue Codes; `core/archive/archive.models.ts`
(`isArchiveName`, `ArchiveFormat`, `archiveExtension`); `jobs.models.ts`: Specs `extract`, `pack`, `duplicates`;
`search.models.ts`: `SearchHit.group?`, `DuplicateCriteria`, Stats-Felder; `SearchResult.kind: 'search' | 'duplicates'`.

### UI-Skizze

```
Pack (Alt+F5)                       Duplikat-Tab (Header)
┌─────────────────────────────┐     Duplicates in /home/m/Fotos · 12 groups, 31 files, 48 MB redundant
│ 3 entries                   │     [Keep newest] [Keep oldest] [Keep first] [Search again]
│ Archive name [Fotos.zip   ] │     Group | Name        | Folder        | Size  | Modified
│ Format  (•)ZIP ( )TAR ( )TGZ│       1   | IMG_1.jpg   | /…/2023       | 4 MB  | …
│ Level   [6 ▾]               │       1   | IMG_1 (1).jpg | /…/Backup    | 4 MB  | …
│ To folder [/home/m/Backup ] │       2   | …
│        [Cancel] [Pack]      │
└─────────────────────────────┘
```

Dialoge mit `role="dialog"`, Fokusfalle (`Modal`), Enter = Start, Esc = Abbrechen; Radiogruppe als `fieldset`.

## 4. Tests

- **Rust** (`archive/tests.rs`, `duplicates.rs`, `jobs/tests_archive.rs`): Namensprüfung (`..`, `/abs`, `C:\x`,
  `a\..\b`, ADS, NUL, Windows-Regeln); Liste mit Umlaut/Emoji-Namen, impliziten Ordnern, Ordnergrößen; virtuelle Pfade
  auflösen; **Zip-Slip-Archiv abgewiesen** (nichts außerhalb des Ziels, Rest entpackt); Symlink-Eintrag (ZIP + TAR) nie
  angelegt; Ziel-Ordner ist Link → abgewiesen; Bombe (angegebene Größe lügt, Summe/Verhältnis, Anzahl) abgewiesen;
  Konflikte (Frage, Skip, Rename, Overwrite); Abbruch hinterlässt keine `.part`; Packen ZIP/TAR/TGZ → Entpacken
  ergibt dieselben Bytes; Ziel vorhanden → Frage; Duplikate: bekannte Dubletten (gleich groß, verschiedener Inhalt mit
  gleichem Kopf/Ende, Hardlinks, leere Dateien, `sameName`, nur Größe), 100 000 Dateien abbrechbar (Test), Messung
  `--ignored`.
- **Frontend**: Auswahlhilfen (rein), Duplikat-Ergebnis im `SearchStore` (Gruppen, `removePaths`), `OpsStore`
  (Extrakt-Spec aus F5 im Archiv, gesperrte Aktionen, Warnung „Gruppe ganz markiert“), Pack-Form (Name/Endung),
  `isArchiveName`, Enter auf Archiv navigiert.
- **E2E**: ZIP mit Unicode-Namen öffnen, navigieren, Teile entpacken, Markierung packen; Duplikatsuche mit Abbruch und
  Löschen in den Papierkorb.

## 5. Annahmen

- TAR-Varianten: ustar/GNU/PAX über `tar`; `.tar.bz2`/`.tar.xz`/`.7z`/`.rar` werden nicht geöffnet (Endung nicht als
  Archiv erkannt → normale Datei).
- ZIP-Namen ohne UTF-8-Flag dekodiert das `zip`-Crate als CP437 (Standard); Info-ZIP-Unicode-Extrafeld wird genutzt.
- Ein Archiv-Index (max. 200 000 Einträge) passt in den Speicher; `.tar.gz` wird zum Auflisten einmal vollständig
  entpackt (gestreamt, ohne Daten zu behalten) – große Archive brauchen dafür Sekunden (kein Abbruch der Liste).
- Duplikat-Ergebnisse sind wie Suchergebnisse Momentaufnahmen (nicht in `session.json`).

## 6. Abweichungen bei der Umsetzung

| Punkt | Design | umgesetzt | Grund |
|---|---|---|---|
| F5 im Archiv | Kopierdialog mit Titel „Extract“ | Entpacken-Dialog (derselbe wie `Alt+F9`, ohne „Unterordner“) | ein Dialog für beide Wege; der Kopierdialog hätte Name/Hintergrund/Zählung ohne Sinn im Archiv |
| Sperren im Archiv | `OpsStore.folder()` = null | zusätzlich **zentrales Veto** `ActionService.setVeto` (`OFF_IN_ARCHIVE`: F3/F4/F7/F8/Shift+F4/F2, Eigenschaften, Tools, Terminal, Suche, Multi-Rename, Gruppieren, Aufräumen, Duplikate, Packen) – auch für Tools (Extras) | E2E: F4/F3 und Werkzeuge anderer Features waren im Archiv aktiv und hätten virtuelle Pfade an Rust bzw. externe Programme gegeben |
| Ziehen aus einem Archiv / auf ein Archiv-Panel | – | Meldung „read-only“ bzw. „cannot copy into an archive“ | Entpacken per Drag → Offen |
| Unsichere Einträge beim Entpacken | Fehler je Eintrag | **ein** Fehler „N Einträge mit unsicherem Namen nicht entpackt“, `itemsFailed` += N | sie stehen nicht im Index (nie im Plan), ein Eintrag je Name würde die Liste fluten |
| Zip-Bomben-Test | Testarchiv mit überlappenden Einträgen | Grenzen über synthetischen Index (`check_limits`), `LimitedReader` für gzip, ZIP mit gepatchter Größe (Job) | überlappende Einträge lassen sich mit dem `zip`-Writer nicht erzeugen; die Grenzen selbst sind getestet |
| Zeiten in ZIP | – | DOS-Zeit wird als UTC gelesen und geschrieben | ohne Zeitzonen-Crate; eigene Archive sind exakt, fremde um die Zeitzone verschoben (Offen: Extended-Timestamp-Feld) |
| Duplikat-Header | Buttons „Keep newest/oldest/first“ | „Keep: newest · oldest · first“, Gruppe mit nur noch einer Datei zählt nicht mehr | E2E: im schmalen Panel verdeckten die Buttons die Zusammenfassung |
| Sitzung | Tabs laufen unverändert durch | `session::resolve_missing_paths` behält Pfade in ein vorhandenes Archiv (Test `tabs_inside_an_archive_are_kept`) | E2E (Neustart): ein Tab im Archiv wurde als „Folder no longer exists“ auf den Ordner des Archivs gesetzt |
| Hilfs-Job | – | `duplicates` ist Hilfs-Job (nicht in Tasks, kein Nachfragen beim Beenden) wie `search` | ein Abbruch verliert nichts |
| Merge mit 013/014/019 | – | `--color-group-alt-bg` als Katalog-Token (`core/theme/tokens.ts`, Gruppe Liste, Kontrastpaare Liste/aktive Liste, `ADJUST_BACKGROUND`), in `themes/*.json` und für die acht alten Designs abgeleitet (Liste 5 % Richtung Text); Menüs: Packen/Entpacken/Duplikate im Datei-Menü, Untermenü „Duplicates“ (Edit + Ergebnis-Kontext), Kontext `archiveFile` (Entpacken) und `archive` (im Archiv: Entpacken, Kopieren, Marken); das Veto gilt für Menü-/Kontextmenü-Einträge (über `ActionService.state`) und Tools (`extraReady`) | 014 brachte ein Menümodell, 013 einen Token-Katalog |

## 7. Review

### Selbstprüfung

- **Zip-Slip:** Namen werden einmal beim Lesen des Index geprüft (`sanitize`) – nur geprüfte Komponenten erreichen
  Liste und Plan; Ziel = `root.join(komponenten)` ohne `..`; jeder Ordner auf dem Weg per `symlink_metadata` (nie
  `metadata`), Temp-Datei mit `create_new` (folgt keinem Link), `rename`/`rename_noreplace` ersetzen nie *durch* einen
  Link. Tests: `zip_slip_archive_is_refused_and_the_rest_extracted`, `tar_slip_and_links_are_refused`,
  `a_link_in_the_target_is_never_followed`. **Restrisiko:** ein lokaler Angreifer, der zwischen Prüfung und Schreiben
  einen geprüften Ordner gegen einen Link tauscht (TOCTOU) – wie beim Kopieren; `openat`-basiert wäre die Lösung.
- **Bomben:** Anzahl (200 000), Summe (64 GiB), Verhältnis (1 100 × + 1 MiB) vor jedem Entpacken (schon beim Auflisten),
  je Eintrag nie mehr als die angegebene Größe (`written > size` → Abbruch, Temp weg), gzip-Strom gezählt. Ein
  legitimes 64-GiB-Nullen-Archiv läuft (Platte voll → Pause wie Kopieren).
- **Links/Sonderdateien** aus Archiven werden nie angelegt; Setuid/Setgid/Sticky werden nie gesetzt (`& 0o777`).
- **Packen:** Links werden nicht verfolgt (gemeldet), FIFOs/Geräte nie geöffnet (`open_regular_file`), das zu
  ersetzende Archiv packt sich nie selbst, halbe Archive nie unter dem echten Namen.
- **Duplikate:** SHA-256 (keine konstruierbaren Kollisionen), Hardlinks/doppelte Wurzeln nur einmal, leere Dateien
  ignoriert; Auswahlhilfen lassen je Gruppe genau eine Datei unmarkiert, Löschen nur über den Löschdialog
  (Papierkorb-Default, Warnung bei ganz markierten Gruppen).
- **Nicht geprüft:** macOS/Windows (Pfade mit `\` und Laufwerken nur über die Namensprüfung getestet, Windows-Regeln
  von `validate_name` greifen dort), Archive > 1 GB (nur Grenzen per Test), Dark-Mode nur über Tokens.

### Review (separater Agent) – Ergebnis

| # | Befund | Schwere | Umgang |
|---|---|---|---|

## 8. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [x] Phase 2 Rust: `archive/` (Index ZIP/TAR/TAR.GZ, `sanitize`, Grenzen, LRU, virtuelle Pfade in
  `list_directory`), Jobs `extract`, `pack`, `duplicates` (+ `jobs/ask.rs`), `duplicates.rs`, Fehlercodes
  `archive_error`/`unsafe_entry`/`archive_too_large`, `SearchHit.group`, `SearchStats.groups/bytesToHash/bytesHashed`
  – 26 neue Rust-Tests (+ 100 000 Dateien `--ignored`, 52 s, davon ~30 s Anlegen)
- [x] Phase 3 Frontend: `core/archive/archive-names.ts`, `FileBrowserStore.archive()`/`searchKind`, Enter öffnet
  Archive, `ArchiveStore` + Pack-/Unpack-Dialog, `OpsStore`-Sperren, Veto im `ActionService`, `DuplicatesStore` +
  Dialog + `duplicates-logic.ts`, `SearchStore.findDuplicates` (Ergebnis-Art `duplicates`), Spalte „Group“ mit
  Schattierung (Token `--color-group-alt-bg`), Header mit Zusammenfassung/Fortschritt/Auswahlhilfen, Löschwarnung,
  Kürzel `Alt+F5`/`Alt+F9`/`Alt+Shift+F7`, Button-Leiste Alt-Satz F5 = Packen – 14 neue Frontend-Tests
- [x] Phase 4 Ende-zu-Ende (Xvfb :98, Debug-Build, eigenes `HOME` unter `/tmp/claude-0/e2e-016`): ZIP mit
  Unicode-/Emoji-Namen, `../evil.txt`, `/abs-evil.txt` und Link geöffnet (Badge „ZIP · read-only · 2 unsafe entries
  hidden“, Link als Link, Ordnergrößen), navigiert (Breadcrumbs, `..` mit Cursor auf dem Archiv), eine Datei per F5
  entpackt, das ganze Archiv per `Alt+F9` in Unterordner (3 Fehler gemeldet, nichts außerhalb des Ziels), Ordner mit
  Link/leerem Ordner als TAR.GZ gepackt (Link gemeldet, `tar tzvf` korrekt) und im Panel geöffnet; Duplikate (2
  Gruppen, versteckte und „gleicher Kopf, anderer Inhalt“ ausgeschlossen), „Keep newest“, F8 → Papierkorb, Zeilen
  verlassen das Ergebnis; 100 000 Dateien (eine Größengruppe) in ~2 s, `/usr` mit `Stop` beim Scannen und beim
  Vergleichen (< 0,5 s „stopped“); im Archiv F7/F8/F4 gesperrt; Entpacken auf vorhandene Datei → Konfliktfrage, „Skip“
  lässt sie unverändert; Neustart mit Tab im Archiv (Fund → behoben). Nicht prüfbar: gesperrter Ordner (root),
  macOS/Windows.
- [x] Phase 5 Doku (architecture, feature-parity, roadmap, README, CLAUDE.md, prompts/README)
- [x] Phase 6 Abschlussprüfung (`pnpm check`, Debug-Build)

### Lücken der GuiExpert Table

- Keine neue. G15 (`minWidth` bei Gewichtsspalten) trifft auch den Duplikat-Tab: mit Spalte „Group“ wird der Name im
  schmalen Panel sehr schmal – Spalte daher nur 52 px.

## 9. Offen

- 7z lesen (`sevenz-rust2`), RAR nur über externes Tool; `.tar.bz2`/`.tar.xz`.
- Passwörter (ZIP AES/ZipCrypto) beim Packen und Entpacken.
- In ein geöffnetes Archiv packen/löschen/umbenennen; Datei im Archiv öffnen/ansehen (F3, Enter) über Temp-Kopie.
- Suche in Archiven; Abbruch des Auflistens großer `.tar.gz`.
- Duplikate: Ordner-Duplikate, Bild-Ähnlichkeit, „durch Hardlink ersetzen“, Fortschritt in Prozent im Tab.
- ZIP-Zeiten aus dem Extended-Timestamp-Feld (UTC) statt DOS-Zeit; Entpacken per Drag aus einem Archiv-Panel.
- Konfliktdialog beim Entpacken/Packen sagt „Cancel copying“ (Text des Kopierens); Pfad-Eingabe (`Strg/⌘+L`) und
  Ziel-Eingaben kennen keine virtuellen Pfade (nur Navigation per Enter/Breadcrumbs).
- E2E einmal beobachtet (nicht reproduzierbar): der erste F5 im Archiv öffnete keinen Dialog; danach stets korrekt.
