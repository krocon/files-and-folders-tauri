# Design 025: Archive erweitert – 7z, RAR, Passwörter, Dateien im Archiv öffnen

> **Status:** ✅ umgesetzt ohne Freigabe-Halt (Marc, 20.10.2026: „jetzt und selbständig“, Rahmen in `prompts/025-*.md`) ·
> **Datum:** 2026-10-20 · **Branch:** `feat/archive-erweitert` (von `main`)
> **Grundlage:** Design 016 (E1–E5, Review, Offen), mr `cmd/pack` + `cmd/unzip` (node-7z, Passwortfeld, 7z als
> Default), Design 010 (Vorschau), 011 (Öffnen mit Standard-App), 005/006 (Jobs, Konfliktfrage).

---

## 1. Bestand

| Baustein | heute (016) | Bewertung |
|---|---|---|
| `archive::read_index` / `ArchiveIndex` / `IndexEntry` | ZIP, TAR, TAR.GZ; Namen geprüft, Grenzen | **erweitern**: 7z, RAR, `encrypted` je Eintrag, Grenzen je Format |
| `archive::sanitize`, `check_limits`, LRU, virtuelle Pfade | formatunabhängig | **passt** – 7z/RAR laufen durch dieselbe Prüfung |
| `jobs/extract.rs` (`Run::write_file(reader)`) | ZIP (`by_index`), TAR (Strom) | **erweitern**: Schreiben über eine `Sink` (Temp-Datei, Zähler, Grenze) – RAR liefert Daten per Callback, nicht als `Read`; 7z blockweise |
| `jobs/pack.rs` (`Writer` ZIP/TAR/TGZ) | ohne Passwort | **erweitern**: 7z, ZIP mit AES-256, 7z mit AES-256 + verschlüsselten Namen |
| `preview::read_preview` (F3, Schnellvorschau) | nur echte Dateien | **erweitern**: virtueller Pfad → Eintrag im App-Cache, dann wie bisher |
| `open_file` (Enter) | nur echte Dateien | neu: Job `viewEntry` (Fortschritt/Abbruch bei großen Einträgen), dann `open_file` auf die Kopie |
| `FsErrorCode` | `archive_error`, `unsafe_entry`, `archive_too_large` | **neu**: `archive_password_required`, `archive_password_wrong` |
| `ArchiveStore`, Pack-/Unpack-Dialog | ZIP/TAR/TGZ, ohne Passwort | **erweitern**: Format 7Z, Passwort (+ Wiederholung), Unpack-Passwortfeld, Passwortdialog |
| Veto `OFF_IN_ARCHIVE` | F3, Schnellvorschau gesperrt | F3/Schnellvorschau/Enter **frei**; Rest bleibt (Archive bleiben schreibgeschützt, s. E9) |
| Konfliktdialog | Button „Cancel copying“ für jede Job-Art | Text je Job-Art |
| ZIP-Zeiten | DOS-Zeit als UTC gelesen/geschrieben | Extended Timestamp (UTC) bevorzugt, DOS-Zeit = Ortszeit |

## 2. Entscheidungen

### E1 – Umfang und Reihenfolge ✅

Reihenfolge nach Nutzen und Risiko: (1) 7z lesen/entpacken/packen, (2) Passwörter ZIP/7z, (3) Dateien im Archiv
ansehen/öffnen, (4) RAR lesen/entpacken, (5) ZIP-Zeiten, Konflikttext, Freigaberegeln. **In Archive schreiben (Aufgabe
5) bleibt offen** – Begründung E9.

### E2 – Crates ✅

| Crate | Lizenz | Pflege | Größe / Features | Entscheidung |
|---|---|---|---|---|
| `sevenz-rust2` 0.24.1 | Apache-2.0 | aktiv (Fork von `sevenz-rust`, Releases 2026 monatlich) | reines Rust; Features `aes256` (RustCrypto `aes`/`cbc`/`sha2`), `compress` (LZMA2-Encoder), `ppmd` (rein Rust), `bzip2` (0.6 = `libbz2-rs-sys`, rein Rust); **ohne** `zstd`/`brotli`/`lz4`/`deflate` (C bzw. selten in 7z) | ✅ lesen + schreiben |
| `sevenz-rust2` 0.20.x | – | MSRV 1.85 | fehlen: 0.21.1 (Pfad-Ausbruch beim Entpacken), 0.21.3 (Panics/Endlosschleifen/unbegrenzte Allokation bei bösartigen Archiven), 0.21.4 (Überlauf im Block-Header) | ❌ → **MSRV 1.90 → 1.93** (`Cargo.toml`) |
| `zip` 9 + Feature `aes-crypto` | MIT | wie 016 | `aes`, `hmac`, `pbkdf2`, `sha1`, `constant_time_eq`, `zeroize` (RustCrypto) – ZipCrypto lesen ist ohne Feature dabei | ✅ AES lesen + schreiben |
| `unrar-ng-sys` =0.7.7 | Wrapper MIT/Apache; **mitgelieferte UnRAR-Quellen 7.21 (C++, unRAR-Lizenz)** | aktiv (Fork von `unrar_sys`, UnRAR März 2026) | nur die FFI-Schicht, ~1,4 MB Quellen, C++-Compiler beim Build (Xcode/MSVC/g++) | ✅ hinter Cargo-Feature **`rar`** (Default an) |
| `unrar` / `unrar_sys` 0.5.8 (muja) | wie oben | UnRAR 7.1 (2024) | älter | ❌ |
| `unrar-ng` (sichere Hülle) | MIT/Apache | – | Daten nur als ganzer `Vec` (`read`) oder Datei schreibt die DLL selbst (`extract_to`: Links, kein Abbruch, kein Temp + Umbenennen) | ❌ – eigene schmale FFI (E3.6) |
| `unrar-rs` 0.14 | **unbekannt** | – | – | ❌ |
| externes `unrar`/`7z` (mr: `7zip-bin`) | – | – | fehlt auf macOS/Windows, Signierung je OS | ❌ |

**RAR – Begründung für die Aufnahme:** Die unRAR-Lizenz erlaubt ausdrücklich, die Quellen „in any software to handle
RAR archives“ kostenlos zu verwenden; verboten ist nur, damit einen RAR-kompatiblen Packer zu bauen – wir packen kein
RAR. Pflicht: der Lizenzabsatz in der Dokumentation (`docs/licenses.md`). Risiko: C++-Parser für nicht vertrauenswürdige
Daten im Prozess. Gemindert durch: aktuelle UnRAR-Version, **nur Test-Modus** (`RAR_TEST`) mit Daten-Callback – die
DLL schreibt nie eine Datei und legt nie einen Link an, Pfade/Ziele bestimmt allein unser Code; Wörterbuch > 1 GiB
abgelehnt (`UCM_LARGEDICT`), mehrteilige Archive nicht unterstützt. Wer RAR nicht will: `--no-default-features`
(Feature `rar`), dann ist `.rar` eine normale Datei.

### E3 – Sicherheit für 7z und RAR (wie 016 E3) ✅

1. **Namen**: jeder Eintragsname läuft durch `archive::sanitize` – unsichere Einträge fehlen in der Liste
   (`unsafeEntries`) und werden nie entpackt.
2. **Links/Sonderdateien**: 7z – Unix-Erweiterung (`attr & 0x8000`, Modus `attr >> 16`) mit `S_IFLNK`/Gerät/FIFO oder
   `FILE_ATTRIBUTE_REPARSE_POINT` → `Link`/`Other`; RAR – `RedirType ≠ 0` (Symlink, Junction, Hardlink, Dateikopie)
   oder Unix-Host mit `S_IFLNK` → `Link`. Nie angelegt (wie 016).
3. **Bomben**: Anzahl (200 000), Summe (64 GiB) wie 016. **Verhältnis je Format:** Deflate (ZIP, TAR.GZ, TAR) 1 100 : 1
   wie bisher; **7z und RAR 20 000 : 1** – LZMA2/RAR erreichen bei Nullen legitim ~7 000 : 1, die alte Grenze würde
   echte Archive abweisen. Je Eintrag wird nie mehr als die angegebene Größe geschrieben (bei 7z prüft die Crate
   zusätzlich CRC und Länge, bei RAR die DLL im Test-Modus den CRC).
4. **Speicher**: 7z – Wörterbuch (LZMA/LZMA2) bzw. PPMd-Speicher > **1 GiB** je Block → `archive_too_large` vor dem
   Dekodieren (die Crate prüft das nicht: `MAX_MEM_LIMIT_KB = usize::MAX`); RAR – `UCM_LARGEDICT` wird abgelehnt
   (Grenze der DLL), `dict_size` > 1 GiB im Header ebenso.
5. **Mehrteilige RAR** (`.part1.rar`, Split-Flags) → Eintrag „Other“, Entpacken meldet „mehrteilige RAR-Archive werden
   nicht unterstützt“; die DLL öffnet nie ein Nachbar-Volume (`UCM_CHANGEVOLUME` → Abbruch).
6. **RAR-FFI** (`archive/rar.rs`, einziger `unsafe`-Code): Öffnen per `RAROpenArchiveEx` (Breitzeichen-Pfad), Lesen
   per `RARReadHeaderEx`, Daten per `RARProcessFileW(RAR_TEST)` + Callback `UCM_PROCESSDATA` → unsere `Sink`; Passwort
   nur über `UCM_NEEDPASSWORDW` (Breitzeichen, keine ANSI-Codepage), Callback ohne Panik (`catch_unwind`), Rückgabe −1
   bricht ab (Abbruch-Token, Grenze, Schreibfehler). Handle wird immer geschlossen (`Drop`).
7. Verschachtelte Archive werden weiterhin nicht automatisch geöffnet; ein Archiv im Archiv lässt sich jetzt aber per
   Enter in den Cache entpacken und mit der Standard-App öffnen (wie jede Datei).

### E4 – Passwörter ✅

| Frage | Entscheidung | Grund |
|---|---|---|
| Wo liegt das Passwort? | **Rust, im Speicher**, je Archivpfad (`archive::secrets`), Typ `Secret` (Debug = `***`, beim Verwerfen genullt über `zeroize`; auch die Breitzeichen-Kopie für UnRAR. **Grenzen:** Kopien in `sevenz-rust2` (`Password`), im ZIP-AES-Schlüsselableiter und im WebView bis zur Garbage Collection werden nicht genullt) | Listing, Vorschau, Öffnen und Entpacken brauchen es wiederholt; das Frontend hält es nur bis zum Absenden des Dialogs |
| Wie lange? | bis zum Beenden der App; `forget_archive_passwords` beim Schließen nicht nötig (Prozessende) | Marcs Rahmen; nie in `session.json`/`settings.json`, kein Schlüsselbund (Aufwand, Plattformcode, Risiko) |
| Wie kommt es nach Rust? | Command **`set_archive_password(archive, password)`** – prüft es (7z/RAR: Index lesen; ZIP: kleinsten verschlüsselten Eintrag ganz lesen bzw. ab 16 MiB nur den Prüfwert) und speichert es nur, wenn es passt | falsches Passwort sofort im Dialog, nicht erst als Fehler je Eintrag |
| Packen | `JobSpec::Pack.password: Option<Secret>` – **nur deserialisiert** (`skip_serializing`), also nie in `JobInfo`/Ereignissen zurück ans Frontend | ein Pack-Job braucht es genau einmal |
| ZIP schreiben | AES-256 (WinZip AE-2); **kein ZipCrypto** (gebrochen) | Hinweis im Dialog: Windows-Explorer und macOS-Archivprogramm öffnen AES-ZIP nicht (7-Zip, WinZip, Keka, The Unarchiver schon) |
| 7z schreiben | AES-256 + **verschlüsselte Namen** (Header) | wie 7-Zip „Dateinamen verschlüsseln“; ohne Passwort sieht niemand den Inhalt |
| Lesen | ZIP: ZipCrypto + AES (Namen offen, Liste sofort; Inhalt braucht das Passwort). 7z/RAR: Inhalt verschlüsselt (Liste sofort) oder Namen verschlüsselt (Liste braucht das Passwort) | Formate |
| Fehler | `archive_password_required` (keins bekannt), `archive_password_wrong` (bekannt, passt nicht: AES-Prüfwert, CRC/HMAC, 7z „MaybeBadPassword“, RAR `ERAR_BAD_PASSWORD`) | eigener Code → Frontend öffnet den Passwortdialog statt einer Fehlermeldung |
| Logging | das Passwort erscheint in keinem Log, keiner Fehlermeldung, keinem Debug-Ausdruck; Dialogfelder `type=password`, `autocomplete=off` | CLAUDE.md §4 Sicherheit |

### E5 – Dateien im Archiv ansehen und öffnen ✅

- **Cache:** `archive/view.rs` – privates Verzeichnis `<app_cache_dir>/archive-view/<lauf>/` (je Nutzer; nicht das
  gemeinsame `/tmp`), Unterordner je Eintrag `<n>/<name>`; Unix-Rechte 0700. Ein Eintrag wird mit **demselben
  Extract-Code** wie F5 entpackt (Zip-Slip, Grenzen, Links, Passwort), danach **schreibgeschützt** gesetzt („kein
  Zurückschreiben“). Schlüssel: Archivpfad + Größe + Änderungszeit + innerer Pfad → eine zweite Ansicht entpackt nicht
  neu. Höchstens 2 GiB/256 Dateien je Lauf, älteste fliegen zuerst. Aufräumen: beim Beenden (`RunEvent::Exit`) der
  eigene Lauf, beim Start fremde Läufe, die älter als **3 Tage** sind (Absturz-Reste; parallele Instanzen bleiben unberührt – jede Kopie frischt ihren Lauf-Ordner auf).
- **F3 / Schnellvorschau:** `read_preview(path)` erkennt einen virtuellen Pfad (`archive::resolve`) und liest die Kopie
  im Cache – Einträge über **256 MiB** → `archive_too_large` („erst entpacken (F5)“). Die Vorschau zeigt den Namen aus
  dem Archiv.
- **Enter:** Job **`viewEntry { path }`** (parallel, kein Hilfsjob – große Einträge zeigen Fortschritt in Tasks und
  lassen sich abbrechen), Ergebnis `Summary.viewPath` = Kopie im Cache → `open_file` (wie 011: ausführbare Dateien nur
  nach Rückfrage). Grenze: **4 GiB** je Eintrag (größere → „erst entpacken (F5)“), dazu die Bomben-Grenzen des Archivs.
- **Passwort fehlt/falsch** → Passwortdialog, danach dieselbe Aktion noch einmal.

### E6 – 7z packen ✅

Nicht-solid (ein Block je Datei, `push_archive_entry`): Abbruch und Fortschritt je Block, zufälliger Zugriff beim
Ansehen im Panel ohne Vorgänger zu dekodieren; Stufe 1–9 → `Lzma2Options::from_level`. Leere Ordner und Rechte
(Unix-Erweiterung `0x8000 | mode << 16`) und Änderungszeit werden gespeichert. Mit Passwort: `AesEncoderOptions` vor
LZMA2, Header verschlüsselt. Default-Format bleibt **ZIP** (mr: 7z) – ZIP öffnet jedes Betriebssystem ohne Zusatzprogramm;
die Formatwahl merkt sich der Dialog nicht (wie 016).

### E7 – ZIP-Zeiten ✅

DOS-Zeiten haben keine Zeitzone; Konvention (Info-ZIP, 7-Zip, Windows) ist **Ortszeit**. Lesen: zuerst das Extended
Timestamp-Feld (`0x5455`, UTC-Sekunden), sonst DOS-Zeit als Ortszeit. Schreiben: DOS-Zeit in Ortszeit **und** Extended
Timestamp (UTC) – andere Programme zeigen die richtige Zeit, wir lesen sekundengenau. Ortszeit-Versatz zu einem Zeitpunkt
in `platform::local_offset_secs` (Unix `localtime_r`/`tm_gmtoff`, Windows `SystemTimeToTzSpecificLocalTime`) – kein
Zeitzonen-Crate. Folge: ZIPs aus 016 (DOS-Zeit als UTC, ohne Extended Timestamp) erscheinen um den Versatz verschoben –
einmalig, unkritisch.

### E8 – Konfliktdialog und Texte ✅

„Cancel copying“ → Text je Job-Art (`extract`: „Cancel extracting“, `pack`: „Cancel packing“, `move`: „Cancel moving“,
sonst wie bisher). Die Liste der Archiv-Endungen kennt `.7z` und `.rar`; Badge „7Z/RAR · read-only“, „· encrypted“.

### E9 – In Archive schreiben: offen ⬜

Geprüft: ZIP ließe sich mit `raw_copy_file` (Einträge ohne Neukomprimieren, auch verschlüsselte) in eine Temp-Datei
umschreiben und atomar ersetzen; TAR ebenso stromweise; **TAR.GZ und solide 7z** müssten vollständig neu komprimiert
werden (Minuten bei großen Archiven), RAR gar nicht (Lizenz). Dazu kämen: Ziel „Ordner im Archiv“ in Kopier-/Drop-Dialog,
Konflikte gegen Archiv-Einträge, Löschen ohne Papierkorb (Rückfrage), Verschlüsselung neuer Einträge bei bekanntem
Passwort, Watcher/Index-Cache des umgeschriebenen Archivs, Rechte/Zeiten des Originals, Sperre gegen paralleles
Schreiben – ein eigenes Feature der Größe M–L. Für „lieber weniger, dafür sicher“ wird es **nicht** in 025 gebaut;
Vorschlag als Folge-Prompt („Archive bearbeiten: ZIP/TAR zuerst“), Archive bleiben im Panel schreibgeschützt.

### E10 – Freigaberegeln ✅

- Unpack (Alt+F9): `.zip .tar .tar.gz .tgz .7z .rar` (`isArchiveEntry`).
- Pack-Formate: ZIP, 7Z, TAR, TAR.GZ (kein RAR). Kompression bei 7Z wie ZIP (1–9).
- Im Archiv frei: F3 (`OPEN_VIEW_DLG`), Schnellvorschau (`QUICK_VIEW`), Enter auf Dateien; gesperrt bleiben alle
  schreibenden Aktionen, Eigenschaften, Tools/F4, Terminal, Suche.

## 3. Verträge

### Rust

```rust
pub enum ArchiveFormat { Zip, Tar, TarGz, SevenZ, Rar }        // "zip" | "tar" | "tarGz" | "sevenZ" | "rar"
pub struct ArchiveInfo { …, encrypted: bool, password_known: bool }   // neu: irgendein Eintrag/der Header verschlüsselt
IndexEntry { …, encrypted: bool }
FsErrorCode::ArchivePasswordRequired ("archive_password_required"),
            ArchivePasswordWrong   ("archive_password_wrong")
#[tauri::command] async fn set_archive_password(archive: String, password: String) -> Result<(), FsError>
JobSpec::Pack { …, #[serde(default, skip_serializing)] password: Option<Secret> }   // format "sevenZ" neu
JobSpec::ViewEntry { path: String }                                 // kind "viewEntry", parallel
Summary { …, view_path: Option<String> }                            // skip_serializing_if None
// read_preview(path) – unverändert, nimmt jetzt auch virtuelle Pfade (Cache, ≤ 256 MiB)
```

### TypeScript

`fs.models.ts`: `ArchiveFormat` + `'sevenZ' | 'rar'`, `ArchiveInfo.encrypted/passwordKnown`, neue Codes (+
`describeFsError`); `jobs.models.ts`: `pack.password?`, Spec `viewEntry`, `JobSummary.viewPath?`;
`core/archive/archive-api.ts` (`ArchiveApi.setPassword`, Fake in `src/testing/`); `archive-names.ts`: Endungen.

### UI-Skizze

```
Passwort (Dialog, role=dialog)          Pack (Alt+F5) – neu
┌───────────────────────────────┐       Format (•)ZIP ( )7Z ( )TAR ( )TAR.GZ
│ „Fotos.7z“ is encrypted.      │       Password        [••••••    ]  (optional)
│ Password [••••••••        ]   │       Repeat password [••••••    ]
│ Wrong password.   (role=alert)│       ZIP: AES-256 – Windows Explorer/macOS Archive Utility cannot open it.
│           [Cancel] [Open]     │       7Z: names are encrypted too.
└───────────────────────────────┘
Unpack (Alt+F9) – neu: Password [      ] (optional; nur wenn verschlüsselt oder Archiv nicht geöffnet)
```

Fokus: Passwortfeld zuerst (`data-autofocus`), Enter = Öffnen, Esc = Abbrechen, Fehler per `role=alert` und
`aria-invalid`; Rückgabe des Fokus an die Liste (Modal).

## 4. Tests

- **Rust** (`archive/tests.rs`, `archive/tests_formats.rs`, `jobs/tests_archive.rs`): 7z-Index (Unicode, Ordner,
  leere Datei, Link per Unix-Erweiterung, unsichere Namen – erzeugt mit `sevenz-rust2`), Fixtures aus 7-Zip
  (solid, verschlüsselte Namen), Entpacken 7z (Teil/Alles, Zip-Slip, Konflikt, Abbruch), Wörterbuch-Grenze;
  RAR-Index/Entpacken (Fixtures aus `unrar.rs`, selbst erzeugtes RAR4 mit `../`, `/abs`, Unix-Link, gelogene Größe);
  Passwörter: ZIP AES/ZipCrypto (7-Zip-Fixtures + selbst erzeugt), 7z, RAR, falsch/fehlend, `Secret` nie im
  Debug/JSON; Packen 7z/ZIP-AES ↔ Entpacken; ZIP Extended Timestamp; Cache (Wiederverwendung, Grenze, schreibgeschützt,
  Aufräumen fremder alter Läufe); `viewEntry`.
- **Frontend**: `archive-names` (7z/rar), Passwortdialog (Store-Ablauf, falsch), Unpack mit Passwort, Pack 7z +
  Passwort-Wiederholung, Enter im Archiv → `viewEntry` → `openFile`, F3 frei im Archiv, Konflikttext je Job-Art.
- **E2E**: s. Prompt.

## 5. Annahmen

- Mehrteilige 7z/RAR-Archive werden nicht unterstützt; `.7z.001` ist keine Archiv-Endung.
- RAR-Namen über 1 023 Zeichen werden von der DLL gekürzt (Feld `FileNameW[1024]`) – praktisch irrelevant.
- 7z-Archive mit nur verschlüsselten Inhalten (ohne `-mhe`) listen ohne Passwort; die Liste zeigt dann „· encrypted“.

## 6. Abweichungen bei der Umsetzung

| Punkt | Design | umgesetzt | Grund |
|---|---|---|---|
| Fehlendes Passwort beim Entpacken | Fehler je Eintrag | Job **scheitert vor dem ersten Schreiben** mit `archive_password_required` (Job-Fehler); ein falsches Passwort beendet den Job mit `archive_password_wrong` – das Frontend fragt und startet denselben Job neu | sonst entstünde eine Liste gleicher Fehler und halb entpackte Ordner |
| Prüfung im Unpack-Dialog | – | Passwortfeld im Unpack-Dialog (wie mr): geprüft per `set_archive_password` vor dem Start; bei mehreren Archiven zählen nur echte Fehler | ein Dialog statt zwei, falsches Passwort bleibt im Dialog |
| Passwortdialog aus F3 | – | Die Ansicht schließt sich, fragt und öffnet sich danach wieder (immer nur ein Dialog, `DialogService`) | Dialoge stapeln sich nicht |
| Schnellvorschau | Passwortdialog | zeigt nur den Fehler | jede Cursorbewegung würde sonst fragen |
| `set_archive_password` | Archivpfad | nimmt auch einen virtuellen Pfad (steht für sein Archiv) | Fehlerpfade der Vorschau zeigen auf den Eintrag |
| ZIP-Zeiten beim Auflisten | Extended Timestamp | Liste: DOS-Zeit als Ortszeit; **Entpacken**: Extended Timestamp | das Feld liegt im lokalen Header; ihn für jede Zeile zu lesen hieße 200 000 Sprünge im Archiv – die Liste ist auf 2 s genau |
| Pause bei RAR | je Block | zwischen Einträgen | eine Pause im UnRAR-Callback hielte die globale Bibliothekssperre |
| `viewEntry` | – | kein Hilfsjob: erscheint kurz in Tasks | große Einträge sollen Fortschritt und Abbruch zeigen |
| Lizenzhinweis | `docs/licenses.md` | im Generator `scripts/licenses.mjs` (Abschnitt „Bundled source“) | der Bericht wird erzeugt – ein Handeintrag ginge verloren |
| Ratio-Test 7z | – | Grenzen über `unpack_limit_for` getestet, keine 7z-Bombe als Fixture | der Writer erzeugt keine lügenden Größen; die Crate prüft Länge + CRC |

### E2E (Xvfb :95, Debug-Build, `HOME=/tmp/e2e-025/home`)

- 7z (7-Zip, solid, Unicode/Emoji): Enter öffnet als Ordner (Badge „7Z · read-only“), **F3** zeigt `🎉.txt`, **Enter** öffnet die
  Kopie mit LibreOffice (Standard-App), Kopie unter `~/.cache/io.github.krocon.filesandfolders/archive-view/run-…/1/` mit
  Rechten 700 (Ordner) / 444 (Datei); F4/F7/F8 gesperrt, F5 entpackt `Ünïcödé dir` samt `sub/` in den Zielordner.
- 7z mit verschlüsselten Namen: Enter → Passwortdialog; falsches Passwort → „Wrong password.“ im Dialog, Feld geleert;
  richtiges → Liste, Badge „7Z · read-only · 🔒 encrypted“.
- ZIP AES (7-Zip): Liste ohne Passwort; F3 → Passwortdialog → danach zeigt die Ansicht den Inhalt.
- RAR (selbst erzeugtes RAR 4): Liste mit „2 unsafe entries hidden“, Link als Link.
- Alt+F5 auf `Quelle ä` (versteckte Datei, Emoji, Link): Format 7Z, Passwort + Wiederholung, Hinweis „7z … encrypts the
  file names too“ → `Quelle ä.7z`; `7z l -pgeheim` zeigt alle Einträge, `7z l -pfalsch` „Wrong password?“; der Link wird
  gemeldet („1 error – details in Tasks“).
- Beenden über Datei → Beenden: der Lauf-Ordner im Cache ist weg.
- Funde → behoben: Passwortdialog aus F3 nannte den Eintrag statt des Archivs; Beschriftung „Password (if encrypted)“ im
  Pack-Dialog → „Password (optional)“. Bekannt: im Fehlerbanner des Panels steht die Meldung zweimal (Text + Rust-Meldung,
  ein Punkt Unterschied) – kosmetisch, bis zur Eingabe sichtbar.
- Nicht prüfbar: macOS/Windows (UnRAR-Build mit Xcode/MSVC, `SystemTimeToTzSpecificLocalTime`, Breitzeichen-Pfade unter
  Windows) – erst in der CI; gesperrter Ordner (root); dunkles Design nur über Tokens.

## 7. Review

Selbst-Review des Diffs `main...feat/archive-erweitert` (frischer Durchgang, Schwerpunkte laut Rahmen):

| # | Befund | Schwere | Umgang |
|---|---|---|---|
| 1 | RAR im Entpack-Modus: auch **übersprungene** Einträge eines soliden Archivs werden dekodiert – die Wörterbuchprüfung lief nur vor `test_into` | mittel | behoben: `next_header` prüft im Entpack-Modus jeden Kopf (`dict > 1 GiB` → `archive_too_large`) |
| 2 | 7z mit falschem Passwort: nach dem Fehler im Block wurden leere Dateien (ohne Block) trotzdem angelegt → beim Neustart des Jobs Konfliktfrage | mittel | behoben (Test `encrypted_entries_need_the_password_before_anything_is_written` war rot): nach einem Passwortfehler wird nichts mehr geschrieben |
| 3 | `HeaderDataEx`/`OpenArchiveDataEx` werden von C beschrieben, aber als `*const` übergeben | gering | Zeiger aus `&raw mut` (veränderliche Herkunft), Layout im Sys-Crate per `const`-Assertions geprüft |
| 4 | Callback in C++: Panik würde abbrechen | gering | `catch_unwind`, Rückgabe −1; kein `unwrap`/Index im Callback |
| 5 | UnRAR-Fehlerzustand ist global (`ErrHandler`) | gering | nur `RAROpenArchiveEx` (setzt/liest ihn) hinter einem `Mutex`; Lesen/Dekodieren je Handle parallel (die DLL meidet den globalen Code dort ausdrücklich) – s. externes Review #3 |
| 6 | Passwort im Job-Spec | – | `skip_serializing` + eigener `Debug`; Test `a_password_is_never_sent_back`; Frontend hält es nur bis zum Absenden, Felder `type=password` |
| 7 | 7z-Header mit PPMd-Kodierung könnte viel Speicher anfordern (Header wird von der Crate ohne unsere Prüfung dekodiert) | gering | offen (Crate-Grenze `MAX_MEM_LIMIT_KB`); LZMA/LZMA2 allozieren das Fenster schrittweise (`lzma-rust2`), Datenblöcke prüft `check_memory` |
| 8 | Cache-Lauf eines zweiten App-Fensters könnte nach 3 Tagen Leerlauf gelöscht werden | gering | bewusst: Lauf-Ordner werden bei jeder Kopie frisch (mtime); offene Dateien darin bleiben unter Unix lesbar |
| 9 | Pfade opak im Frontend | – | keine Zerlegung; der Passwortdialog zeigt den ganzen Archivpfad |
| 10 | Commands async | – | `set_archive_password` ist `async` (`commands::command_rules` grün) |
| 11 | Texte en+de | – | `catalogs.spec.ts` grün (`RAR` als gleichlautend erlaubt) |

### Externes Review (20.10.2026)

Unabhängiger Reviewer, Probe-Archive und rote Tests unter `/tmp/review-025/`. Jeder Befund zuerst als roter Test.

| Nr | Schwere | Befund | Status | Test |
|---|---|---|---|---|
| 1 | hoch | 7z-Header wird von `sevenz-rust2` ungebremst ausgepackt (`hdrbomb.7z`: 2 GiB Spitze) | ✅ `archive/sevenz_header.rs`: Start-Header + Encoded-Header selbst parsen, ausgepackte Größe ≤ **64 MiB**, sonst `archive_too_large` – vor `Archive::read` (Listing, Entpacken, Passwortprüfung). **Upstream-Hinweis für `sevenz-rust2`:** `Archive::read` mit Grenzen (Header-Bytes, Dateien) anbieten; heute `take(declared).read_to_end` und `vec![…; num_files]` | `archive/tests_formats.rs` › `seven_zip_header_bombs_are_refused_before_reading` (`testdata/bomb-header.7z`, 19 KB → 128 MiB) |
| 2 | hoch | `num_files` nur durch die Header-Länge begrenzt (`files-bomb.7z`: 20 Mio. Einträge, 1,9 GB) | ✅ LZMA/LZMA2-Header (ohne Verschlüsselung) werden hier begrenzt ausgepackt (`lzma-rust2`, schon im Baum) und `kFilesInfo` gelesen: > 200 000 → `archive_too_large`; verschlüsselte Header (`-mhe`) nur über die Größengrenze (Restrisiko, braucht das Passwort) | wie 1 (`testdata/bomb-files.7z`, 424 Byte, 2 Mio. Einträge) |
| 3 | hoch | RAR: Pause im Callback hielt die globale Sperre; Sperre für die ganze Dekodierzeit | ✅ Sperre nur noch um `RAROpenArchiveEx`; Lesen/Testen je Handle ohne Sperre (DLL ist dafür ausgelegt); Pause im Callback hält damit nur diesen Job an | `jobs/tests_formats.rs` › `rar_parallel::a_slow_rar_entry_does_not_block_other_rar_archives` (war rot: 3 s gewartet) |
| 4 | mittel | 7z: Schreibfehler ließ den Rest des Eintrags ungelesen → solider Block versetzt (CRC-Fehler, verschlüsselt „falsches Passwort“) | ✅ nach jedem Eintrag wird der ungelesene Rest gelesen und verworfen; RAR verwirft nach einem Schreibfehler den Rest statt abzubrechen | `an_unwritable_entry_does_not_desync_a_solid_block` (`sevenzip-solid3*.7z` vom Reviewer, `chattr +i`) |
| 5 | mittel | übersprungene Daten ohne Abbruch; Vorschau ohne Abbruch-Token | ✅ `drain` prüft je 64 KiB den Abbruch; RAR-Callback bricht bei gesetztem Abbruch-Flag ab (auch ohne Sink), solide RAR werden im Entpack-Modus per Test statt `RAR_SKIP` übersprungen (Callback sieht die Daten); Vorschau: Abbruch-Token je Slot (`viewer`/`quick`), eine neue Anfrage bricht die alte ab | `draining_skipped_data_stops_on_cancel`, `rar_parallel::a_cancelled_rar_test_stops`, `view::tests::a_newer_preview_cancels_the_older_one_of_its_slot` |
| 6 | mittel | kein Mark-of-the-Web/keine Quarantäne auf entpackten Dateien | ✅ `platform/origin_mark.rs`: Windows `Zone.Identifier`-Stream, macOS `com.apple.quarantine` (über den Deskriptor, vor dem Umbenennen) vom Archiv auf jede entpackte Datei – F5/Alt+F9 und `viewEntry`/Vorschau (gleicher Extract-Code); Linux no-op. **Nur in der CI kompiliert** | `platform::origin_mark::tests::marks_are_copied_where_the_os_has_them` (prüft unter Windows/macOS das Kopieren) |
| 7 | niedrig | Passwortprüfung in solidem RAR dekodierte alles bis zum kleinsten Eintrag, ohne Grenze | ✅ solide: erster verschlüsselter Eintrag, insgesamt höchstens 16 MiB dekodiert (danach gilt das Passwort als passend, RAR 5 prüft ohnehin per Prüfwert) | Code; `rar_tests::rar_passwords` |
| 8 | niedrig | 7z-Prüfung las nur 16 MiB des ersten Eintrags ohne CRC | ✅ ein Block ≤ 16 MiB wird ganz gelesen (CRC jedes Eintrags); größere Blöcke wie bisher teilweise – ein durchgerutschtes falsches Passwort scheitert beim Entpacken am CRC und wird erneut erfragt (bewusst: sonst ließe sich ein solches Archiv nie öffnen) | `a_wrong_7z_password_fails_on_a_whole_small_solid_block` |
| 9 | niedrig | nur `Secret` genullt | ✅ Breitzeichen-Passwort für UnRAR als `Zeroizing`; Grenzen (Crate-Puffer, WebView) in E4 dokumentiert | Code |
| 10 | niedrig | Rohzeiger auf Box-Inhalt (Stacked Borrows) | ✅ `Box::into_raw` beim Öffnen, nur noch der Rohzeiger, `Box::from_raw` im `Drop` nach dem Schließen | Code (Miri nicht im Container) |
| 11 | niedrig | UnRAR nimmt höchstens 511 Zeichen; längere Passwörter endlos „falsch“ | ✅ Rust lehnt mit klarer Meldung ab (`rar::MAX_PASSWORD_CHARS`), das Frontend schon vorher (übersetzt) | `rar_passwords_longer_than_unrar_takes_are_refused_clearly`, `archive-025.spec.ts` › „review 025 #11 …“ |
| – | – | Kleinigkeiten: 24 h vs. 3 Tage; keine Größengrenze für Enter | ✅ Design auf 3 Tage korrigiert; Enter höchstens 4 GiB je Eintrag (`view::OPEN_LIMIT`) | Code |

E2E nach den Fixes (Xvfb :95, Debug-Build): `bomb-header.7z` und `bomb-files.7z` öffnen → sofort „The archive exceeds the safety limits … header would unpack to 128 MiB“ bzw. „declares 2000000 entries“, Speicherspitze der App 185 MB (vorher > 2 GB); Alt+F9 auf die Bombe → Job „Failed“ mit derselben Meldung. RAR-Entpacken (256 MB, gespeichert, Ziel mit `FNF_TEST_SLOW` gebremst – der Hook gilt jetzt auch für Entpacken) bei 32 MB pausiert → ein anderes RAR lässt sich währenddessen sofort öffnen; Abbrechen lässt keine `.part`-Datei zurück.

Nebenbefund beim Gesamtlauf: `jobs::tests_link::many_links_and_cancel` (aus 031, `main`) scheiterte oft – der „Blocker“ war eine Simulation, die parallel läuft, der abgebrochene Link-Job startete also sofort. Behoben (gleichzeitig auch in `main`, dessen Fassung beim Merge übernommen wurde): ein serieller, pausierter Link-Job davor.

### Nachprüfung (21.10.2026)

Zweiter Blick des Koordinators auf `archive/sevenz_header.rs`. Grundsatz jetzt **fail-closed**: was der Vorab-Parser
nicht sicher beurteilen kann, wird als `archive_error` („The 7z header cannot be checked (…) – not opened“) abgelehnt –
`sevenz-rust2` liest nur noch Header, deren Größe und Dateizahl vorher feststehen.

| Nr | Schwere | Befund | Status | Test |
|---|---|---|---|---|
| B1 | hoch | `size == 0` bzw. jeder Parse-Fehler ließ durch; Start-Header-CRC 0 + 20 Nullbytes → die Crate sucht im letzten MiB ohne CRC nach einem Header (`try_to_locale_end_header`) | ✅ Start-Header muss zur CRC passen, genullter Start-Header wird abgelehnt, Next-Header-CRC wird geprüft; `size == 0` nur mit gültiger CRC (leeres Archiv); Parse-Fehler → `archive_error` | `seven_zip_headers_the_check_cannot_judge_are_refused` (`bomb-zero-start.7z`, 424 Byte) |
| B2 | hoch | `digests()` legte `vec![true; n]` an, bevor die CRC-Bytes gegen den Rest geprüft waren (n bis ~6·10¹¹) | ✅ `Cursor` prüft jede Anzahl gegen die restlichen Bytes (`count`: höchstens 1 Element je Byte; Bitvektor `⌈n/8⌉`, CRCs `4·definiert`), zählt definierte Bits statt einen Vektor zu bauen; nur je Ordner (≤ Restbytes) wird ein Vektor angelegt | wie B1 (`bomb-digests.7z`, 48 Byte: 2³⁶ Streams) + Unit-Test `sevenz_header::tests::counts_need_bytes_behind_them` |
| B3 | hoch | Encoded-Header mit AES/PPMd/BZip2/Copy/Deflate → nur 64-MiB-Grenze (bis 64 Mio. Einträge) | ✅ nur **LZMA/LZMA2**, optional hinter **AES-256** (genau ein Ordner, ein Pack-Stream); alles andere abgelehnt (7-Zip schreibt Header immer mit LZMA). AES-Header werden hier mit dem bekannten Passwort entschlüsselt (Schlüsselableitung wie 7-Zip, ≤ 2²⁴ Runden wie die Crate; `aes`/`cbc`/`crc32fast` waren im Baum) und dann gezählt – ohne Passwort zuerst `archive_password_required`, Müll nach dem Entschlüsseln = falsches Passwort. `MAX_HEADER` 64 → **32 MiB** (gepackt und ausgepackt) | wie B1 (`bomb-bzip2-header.7z`, `bomb-aes-header.7z` mit `geheim`: ohne Passwort „password required“, mit → „declares 2000000 entries“); echte Archive (PPMd/BZip2/Deflate/Copy/BCJ-Daten, `-mhc=off`, `-mhe` mit LZMA2) öffnen weiter |
| B4 | niedrig | Prüfung und `Archive::read` öffneten die Datei getrennt (TOCTOU) | ✅ `check(&mut File, …)`: `sevenz::open` und `verify_7z` öffnen einmal, prüfen, spulen zurück und geben **dieselbe** Datei an die Crate | Code |
| A1 | niedrig | UnRAR schreibt die globalen `ErrHandler`-Zähler und die statischen SSE-Konstanten von BLAKE2s (`blake2s_init_sse`, bei jedem `blake2s_init_param`) ungeschützt parallel | dokumentiert, nicht geändert: die SSE-Konstanten werden bei jedem Aufruf mit **denselben** Werten überschrieben (formal ein Data Race, praktisch harmlos); ein einmaliges Vorab-Init ginge nur über einen RAR-5-Hash-Lauf unter der Sperre – kein Zugang über die DLL-API. `ErrHandler`-Zähler lesen wir nicht: Ergebnisse kommen aus den Rückgabewerten je Handle (`RARReadHeaderEx`/`RARProcessFileW`). Sauber nur upstream (UnRAR) | – |

E2E (Xvfb :95, Debug-Build): `bomb-zero-start.7z`, `bomb-digests.7z`, `bomb-bzip2-header.7z` öffnen → sofort Banner
„The archive is broken or uses an unsupported feature … The 7z header cannot be checked (…) – not opened“;
`bomb-aes-header.7z` → Passwortdialog, mit `geheim` → „The archive declares 2000000 entries (at most 200000) – refused“
im Dialog; `sevenzip-enc-names.7z` mit `geheim` öffnet weiter (Badge „encrypted“).

Damit erledigt sich auch Selbst-Review #7 (PPMd-Header ohne Speichergrenze): solche Header werden nicht mehr gelesen.

## 8. Fortschritt

- [x] Phase 1: Prompt + dieses Dokument
- [x] Phase 2 Rust: `archive/{sevenz,rar,secrets,view}.rs`, `platform/clock.rs`, Jobs `extract` (Sink, 7z, RAR, Passwort),
  `pack` (7z, ZIP-AES, Extended Timestamp), `viewEntry`, Command `set_archive_password`, `read_preview` mit virtuellen
  Pfaden – 34 neue Tests (`archive/tests_formats.rs`, `jobs/tests_formats.rs`, `secrets`, `clock`), Fixtures in
  `archive/testdata/` (Herkunft: `README.md`); auch `--no-default-features` (ohne RAR) clippy-grün
- [x] Phase 3 Frontend: `ArchiveApi` (+ Fake), `ArchivePasswordPrompt`, Passwortdialog, Pack (7Z, Passwort + Wiederholung,
  Hinweise), Unpack-Passwort, Enter/F3 im Archiv, Konflikttext je Job-Art, Badge „encrypted“ – 8 neue Specs
  (`archive-025.spec.ts`) + angepasste
- [x] Phase 4 E2E (s. §6)
- [x] Phase 5 Doku: `docs/architecture.md`, `docs/feature-parity.md`, `docs/licenses.md` (+ Generator), README,
  `prompts/README.md`
- [x] Phase 6: `pnpm check` grün, Review (§7), Merge von `origin/main` (022, 024, 031)

## 9. Offen

- In Archive schreiben (E9) – Folge-Prompt „Archive bearbeiten“ (ZIP/TAR zuerst, `raw_copy_file`).
- Vorschlag an `sevenz-rust2`: `Archive::read` mit Grenzen (Header-Bytes, Dateien) und ohne CRC-lose Header-Suche.
- Doppelte Fehlermeldung im Panel-Banner bei Passwortfehlern (kosmetisch).
- Mehrteilige Archive, `.tar.bz2`/`.tar.xz`, Suche in Archiven, Passwort im Schlüsselbund merken.
