# Prompt 035: Archive bearbeiten (in Archive kopieren, darin löschen)

> **Slug:** `archive-bearbeiten` · **Braucht:** 005 (Jobs), 006 (Kopieren/Löschen), 016/025 (Archive als Ordner,
> Passwörter), 029/030 (Auffrischen, Cache) · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/025-archive-erweitert.design.md` **E9** (Begründung,
> warum es dort nicht gebaut wurde) und E10 (Freigaberegeln), `prompts/done/016-archive-duplikate.design.md`.

## Ziel

Archive sind im Panel heute schreibgeschützt. Danach lassen sich in **ZIP und TAR** Dateien und Ordner hineinkopieren
(F5, Drag & Drop) und Einträge darin löschen (F8) sowie Ordner anlegen (F7). 7z folgt als zweite Stufe im selben
Prompt, wenn die erste stabil ist; TAR.GZ nur, wenn das Design die Kosten (vollständiges Neukomprimieren) vertretbar
findet; **RAR nie** (Lizenz).

## Leitplanken (aus 025 E9)

- **Nie in-place schreiben:** neues Archiv in eine Temp-Datei im selben Ordner, danach atomar ersetzen
  (`platform::rename`-Muster aus `fs_atomic.rs`); Rechte und Zeiten des Originals übernehmen. Abbruch oder Fehler
  lässt das Original unberührt.
- ZIP: unveränderte Einträge mit `raw_copy_file` übernehmen (kein Neukomprimieren, auch verschlüsselte); TAR
  stromweise.
- Als **Job** (`JobSpec::ArchiveWrite` o. ä.) mit Fortschritt, Abbruch, Konfliktfrage gegen vorhandene Einträge
  (`jobs/ask.rs`); Sperre gegen zwei schreibende Jobs auf dasselbe Archiv.
- Löschen im Archiv geht nicht in den Papierkorb → eigene Rückfrage mit klarem Text.
- Fremde Archive sind feindlich (CLAUDE.md §4): dieselben Grenzen wie beim Lesen; was nicht sicher beurteilt werden
  kann (z. B. merkwürdige Header, Zip64-Sonderfälle), wird abgelehnt statt umgeschrieben.
- Passwort bekannt (`archive::secrets`) → neue Einträge werden mit derselben Methode verschlüsselt, oder das Design
  entscheidet begründet, das abzulehnen.
- Index-Cache (LRU) und Watcher des umgeschriebenen Archivs invalidieren; offene Panels im Archiv frischen auf.

## Aufgaben

1. Design: Matrix Format × Operation (kopieren hinein, löschen, Ordner anlegen, umbenennen?, verschieben hinein =
   kopieren + löschen der Quelle erst nach erfolgreichem Ersetzen).
2. Rust: Umschreib-Kern je Format, Job, Commands-Validierung (virtuelle Pfade nur aus `list_directory_or_archive`).
3. Frontend: Vetos `OFF_IN_ARCHIVE` für die freigegebenen Aktionen lockern, Ziel „Ordner im Archiv“ im
   Kopieren-Dialog und beim Drop, Rückfragen, Texte en/de.
4. `docs/feature-parity.md` („Zip-Browsing“), `docs/architecture.md` (Entscheidung, ggf. neue Crates begründen).

## Akzeptanzkriterien

- Datei in ein ZIP im anderen Panel kopieren → erscheint im Archiv; Archiv lässt sich mit `unzip -t` prüfen.
- Ordner mit Umlauten/Emoji in ein TAR kopieren → Struktur und Namen stimmen (`tar tvf`).
- Eintrag im ZIP löschen → Rückfrage, danach weg; die übrigen Einträge sind bitgleich (CRC unverändert).
- Abbruch mitten im Umschreiben eines großen Archivs → Original unverändert, keine Temp-Datei bleibt liegen.
- Konflikt mit vorhandenem Eintrag → Konfliktdialog wie beim normalen Kopieren.
- RAR, solide 7z (falls nicht unterstützt) und TAR.GZ (falls nicht unterstützt) zeigen einen klaren Hinweis.

## Tests

- Rust (tempfile + `archive/testdata`): Hinzufügen/Löschen/Ordner je Format, verschlüsselte Einträge bleiben
  lesbar, Abbruch → Original bitgleich, Rechte/Zeiten, Zip-Slip-Namen werden abgelehnt, parallele Jobs gesperrt.
- Frontend: Vetos, Dialogziele, Rückfragen (Fakes).
- E2E unter Xvfb mit `unzip -t`/`tar tvf` als Prüfung. Externes Review (Schwerpunkt: Datenverlust, feindliche Archive).
