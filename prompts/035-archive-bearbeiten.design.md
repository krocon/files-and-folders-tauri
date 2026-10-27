# Design 035: Archive bearbeiten (in Archive kopieren, darin löschen, Ordner anlegen)

> **Status:** umgesetzt (27.10.2026), Branch `feat/archive-bearbeiten` · ohne Freigabe-Halt (Marc: „selbständig“) ·
> keine neue Crate (`zip` 9 `raw_copy_file`, `tar` 0.4 Rohpositionen, `flate2`).

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `archive::read_index` (+ LRU `index_of`), `resolve`, `inner_of`, `sanitize` | Archiv lesen, virtuelle Pfade | **passt**; neu `archive::forget_index` (Cache nach dem Umschreiben verwerfen) |
| `archive::TarEntries` (Rohmodus, eigene Grenzen für Meta-Header) | TAR-Einträge mit Position | **passt** – `raw_file_position` + Größe ergeben den Byte-Bereich jedes Eintrags |
| `zip::ZipWriter::raw_copy_file` | unveränderte ZIP-Einträge ohne Neukomprimieren (auch verschlüsselte) | **passt** |
| `jobs/pack.rs` (`Writer::add_dir/add_file`, `zip_options` mit AES-256) | neue Einträge schreiben | **teilweise** – Optionen/Kopfdaten übernommen, eigener Schreiber für „Bestand + Neues“ |
| `jobs/ask.rs` (`Asker::ask_meta`) | Konfliktfrage gegen Archiv-Einträge | **passt** |
| `copy::walk` | Quellen planen (Links nie verfolgt) | **passt** |
| `archive::secrets` | Passwort des Archivs | **passt** |
| Frontend: `OFF_IN_ARCHIVE`, `OpsStore` (Kopieren/Löschen/Ordner), `isArchivePath` | Vetos, Dialoge | **muss erweitert werden** |

## 2. Entscheidungen

### E1 – Matrix Format × Operation ✅

| | hineinkopieren (F5, Drop) | hineinverschieben (F6) | löschen (F8) | Ordner anlegen (F7) | umbenennen |
|---|---|---|---|---|---|
| ZIP | ✅ | ✅ | ✅ | ✅ | ⬜ offen |
| TAR | ✅ | ✅ | ✅ | ✅ | ⬜ |
| TAR.GZ | ✅ (alles neu komprimiert) | ✅ | ✅ | ✅ | ⬜ |
| 7z | ✖ Hinweis „7z wird noch nicht geändert“ | ✖ | ✖ | ✖ | ✖ |
| RAR | ✖ nie (Lizenz) | ✖ | ✖ | ✖ | ✖ |

**TAR.GZ:** Umschreiben ist stromweise (zweimal entpacken, einmal packen, linear) – bei 1 GB etwa eine Minute. Das ist
für eine bewusst gestartete Operation vertretbar; der Fortschritt zeigt die Bytes. **7z** (auch nicht-solide) ließe
sich mit `sevenz-rust2` nicht ohne Neukomprimieren aller Einträge umschreiben (kein Roh-Kopieren gepackter Ströme) –
zweite Stufe, bis dahin ein klarer Hinweis. **Umbenennen** im Archiv bleibt offen (ZIP ginge mit
`raw_copy_file_rename`, TAR bräuchte neue Kopfdaten; nicht verlangt).

### E2 – Nie in-place, immer prüfen ✅

1. **Annehmen** (`validate`): Pfade normalisiert, liegen alle in **einem** Archiv (`archive::resolve`).
2. **Sperre** je Archiv (statische Menge): ein zweiter schreibender Job auf dasselbe Archiv bricht mit
   `archive_busy` ab (Jobs dieser Art laufen ohnehin seriell; die Sperre schützt auch vor „Sofort starten“).
3. **Beschreibbar?** (`archive::write::writable`): Format ZIP/TAR/TAR.GZ, das Archiv ist eine reguläre Datei und
   **kein Symlink** (sonst würde der Link durch eine Datei ersetzt), es lässt sich mit allen Lese-Grenzen indizieren,
   **keine unsicheren Namen** (`..`, absolut …), **keine doppelten Namen**, ZIP ohne vorangestellte Daten (SFX,
   `offset() == 0`). Was nicht sicher beurteilt wird → `archive_read_only` mit Grund, nichts wird geschrieben.
4. **Neu schreiben** in `.fnf-<job>.part` im Ordner des Archivs: ZIP – unveränderte Einträge mit `raw_copy_file`
   (bitgleich, auch verschlüsselte), neue danach; Kommentar übernommen. TAR – die Byte-Bereiche der behaltenen Einträge
   (inkl. ihrer GNU-/PAX-Kopfzeilen, auch Sparse-Daten) unverändert kopiert, neue Einträge mit `tar::Builder`
   angehängt, Endblöcke neu. TAR.GZ – dasselbe auf dem entpackten Strom (zwei Durchläufe), neu komprimiert (Stufe 6).
5. **Gegenprobe:** die Temp-Datei wird mit `read_index` gelesen und muss genau die erwarteten Namen enthalten.
6. **Original unverändert?** Größe, mtime und Identität wie beim Start – sonst Abbruch („wurde währenddessen
   geändert“), die Temp-Datei geht.
7. **Ersetzen** atomar per `rename` (gleicher Ordner); die Rechte des Originals werden übernommen. **Abweichung vom
   Prompt:** die Änderungszeit ist die neue (jetzt) – ein geänderter Inhalt mit alter mtime würde Backups,
   `rsync` und den Ordnerabgleich (036) täuschen. Hardlinks auf das Archiv zeigen danach auf die alte Fassung (neue
   Inode) – wie bei jedem Editor, der atomar speichert.
8. Danach: Index-Cache verworfen, `dirsChanged` für den Ordner des Archivs und die betroffenen virtuellen Ordner.

Abbruch oder Fehler in 4–7: das Original bleibt unberührt, die Temp-Datei wird entfernt.

### E3 – Konflikte ✅

Gleiches Muster wie Kopieren (`Conflict`, `Asker`, „für alle“): Datei auf vorhandene Datei → überschreiben /
überspringen / umbenennen (`name (1).ext` unter den Namen im Archiv) / abbrechen; Ordner auf Ordner → zusammenführen;
Datei ↔ Ordner → Fehler für diesen Eintrag. Der Dialog-Default (`conflictDefault`) gilt wie beim Kopieren.

### E4 – Verschlüsselung ✅

Behaltene Einträge bleiben, wie sie sind (roh kopiert). Neue Einträge in ein ZIP mit verschlüsselten Einträgen:
mit dem bekannten Passwort (`archive::secrets`) als **AES-256** – auch wenn die alten ZipCrypto nutzen (ZipCrypto
schreiben wir nie, wie beim Packen, 025 E4). Passwort unbekannt → `archive_password_required` (der Nutzer gibt es wie
beim Öffnen ein und startet erneut). Unverschlüsselte Archive bleiben unverschlüsselt.

### E5 – Löschen ohne Papierkorb ✅

Ein Eintrag im Archiv hat keinen Papierkorb: F8 im Archiv zeigt immer den Bestätigungsdialog mit dem Hinweis
„Einträge im Archiv werden endgültig entfernt (kein Papierkorb)“, auch wenn „Papierkorb ohne Rückfrage“ eingestellt
ist. Shift+F8 dasselbe.

### E6 – Verschieben hinein ✅

= Kopieren hinein; die Quellen werden **erst nach dem erfolgreichen Ersetzen** entfernt – nur die tatsächlich
aufgenommenen Dateien (übersprungene bleiben), jede nur, wenn sie noch dieselbe Datei ist (Gerät + Inode), Ordner
danach nur, wenn leer.

### E7 – Frontend ✅

- `OFF_IN_ARCHIVE` lockert `OPEN_MKDIR_DLG`, `OPEN_DELETE_DLG`, `DELETE_PERMANENT` für ZIP/TAR/TAR.GZ; F5/F6 **in**
  ein Archiv der anderen Seite (Dialog, Drop) erlaubt; F6 *aus* einem Archiv bleibt gesperrt (Entpacken ist F5).
- `OpsStore.runCopyMove`: Ziel ist ein virtueller Archivpfad → Job `archiveAdd`; `openDelete` im Archiv → Job
  `archiveDelete`; `runName('mkdir')` im Archiv → Job `archiveMkdir` (statt Command).
- 7z/RAR: die Aktionen bleiben gesperrt mit Text „7z/RAR können nicht geändert werden“.

## 3. Verträge

```rust
JobSpec::ArchiveAdd { sources: Vec<String>, target_dir: String /* virtuell oder das Archiv */,
                      #[serde(default)] options: CopyOptions, #[serde(default)] move_sources: bool }
JobSpec::ArchiveDelete { paths: Vec<String> /* virtuell, ein Archiv */ }
JobSpec::ArchiveMkdir { parent: String /* virtuell */, name: String }
FsErrorCode::ArchiveReadOnly ("archive_read_only"), ArchiveBusy ("archive_busy")
```

`kind()` = `archiveAdd`/`archiveDelete`/`archiveMkdir`, seriell, keine Hilfs-Jobs; `changed_paths` = das Archiv
(Überwachung pausiert), `target_dirs` = Ordner des Archivs.

## 4. Tests

- Rust (`archive/write_tests.rs`, `jobs/tests_archive_write.rs`, tempfile + Testdaten): hinzufügen/löschen/Ordner je
  Format; übrige ZIP-Einträge bitgleich (CRC, Rohdaten), verschlüsselte bleiben lesbar und neue sind verschlüsselt;
  Umlaute/Emoji im TAR; Konflikt überschreiben/überspringen/umbenennen; Abbruch mitten im großen Archiv → Original
  bitgleich, keine Temp-Datei; geändertes Original → Abbruch; Rechte übernommen; Symlink-Archiv, unsichere Namen, SFX,
  7z/RAR abgelehnt; Sperre; Verschieben entfernt nur Aufgenommenes; Zip-Slip-Namen der Quellen (nicht UTF-8) abgelehnt.
- Frontend: Vetos je Format, Kopieren-Dialog mit Archivziel startet `archiveAdd`, Löschen im Archiv immer mit Rückfrage
  und `archiveDelete`, F7 → `archiveMkdir`.
- E2E: `unzip -t`, `tar tvf` als Prüfung.

## 5. Fortschritt

- [x] Design
- [ ] Rust
- [ ] Frontend
- [ ] E2E, Review, Doku
