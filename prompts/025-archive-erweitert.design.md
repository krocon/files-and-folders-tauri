# Design 025: Archive erweitert – 7z, RAR, Passwörter, Dateien im Archiv öffnen

> **Status:** umgesetzt ohne Freigabe-Halt (Marc, 20.10.2026: „jetzt und selbständig“, Rahmen in `prompts/025-*.md`) ·
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
| Wo liegt das Passwort? | **Rust, im Speicher**, je Archivpfad (`archive::secrets`), Typ `Secret` (Debug = `***`, beim Verwerfen genullt über `zeroize`) | Listing, Vorschau, Öffnen und Entpacken brauchen es wiederholt; das Frontend hält es nur bis zum Absenden des Dialogs |
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
  eigene Lauf, beim Start fremde Läufe, die älter als 24 h sind (Absturz-Reste; parallele Instanzen bleiben unberührt).
- **F3 / Schnellvorschau:** `read_preview(path)` erkennt einen virtuellen Pfad (`archive::resolve`) und liest die Kopie
  im Cache – Einträge über **256 MiB** → `archive_too_large` („erst entpacken (F5)“). Die Vorschau zeigt den Namen aus
  dem Archiv.
- **Enter:** Job **`viewEntry { path }`** (parallel, kein Hilfsjob – große Einträge zeigen Fortschritt in Tasks und
  lassen sich abbrechen), Ergebnis `Summary.viewPath` = Kopie im Cache → `open_file` (wie 011: ausführbare Dateien nur
  nach Rückfrage). Grenze: die Bomben-Grenzen des Archivs.
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

(wird während der Umsetzung gefüllt)

## 7. Review

(Phase 6)

## 8. Fortschritt

- [x] Phase 1: Prompt + dieses Dokument
- [ ] Phase 2 Rust
- [ ] Phase 3 Frontend
- [ ] Phase 4 E2E
- [ ] Phase 5 Doku
- [ ] Phase 6 Abschluss

## 9. Offen

- In Archive schreiben (E9) – Folge-Prompt.
- Mehrteilige Archive, `.tar.bz2`/`.tar.xz`, Suche in Archiven, Passwort im Schlüsselbund merken.
