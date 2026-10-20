# Prompt 025: Archive erweitert – 7z, RAR, Passwörter, Dateien im Archiv öffnen

> **Slug:** `archive-erweitert` · **Braucht:** 016 (Archive als Ordner, Jobs `extract`/`pack`), 010 (Ansicht,
> Schnellvorschau), 011 (Datei mit Standard-App öffnen), 005/006 (Job-Engine, Konfliktfrage) · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/016-archive-duplikate.design.md` (E1–E5, §7 Review,
> §9 Offen). Anlass: `docs/feature-parity.md` (Zeilen „Entpacken“, „Packen“, „Packen/Entpacken“, „Freigaberegeln“,
> Folge-Prompt 025) und `TODO.md` §4. Marc hat am 20.10.2026 den Rahmen festgelegt und die Umsetzung **ohne
> Freigabe-Halt** freigegeben („lieber weniger, dafür sicher und getestet“).

## Ziel

Archive verhalten sich wie im alten Programm (mr: node-7z, Passwort, 7z als Default) – aber ohne externes 7-Zip:
7z und RAR lassen sich wie ZIP/TAR als Ordner öffnen und entpacken, 7z lässt sich packen, verschlüsselte Archive
lassen sich mit Passwort öffnen, entpacken und erzeugen, und Dateien im Archiv lassen sich ansehen (F3,
Schnellvorschau) und mit der Standard-App öffnen (Enter), ohne sie vorher von Hand zu entpacken.

## Bestand

- `archive/mod.rs`: Index (ZIP/TAR/TAR.GZ), `sanitize` (Zip-Slip), Grenzen (Anzahl, Summe, Verhältnis), LRU,
  virtuelle Pfade über `list_directory`. Jobs `jobs/extract.rs` (Temp + `rename_noreplace`, Konfliktfrage, Links nie
  angelegt), `jobs/pack.rs` (Temp-Datei, `copy::walk`, Links übersprungen).
- Frontend: `ArchiveStore` (Pack-/Unpack-Dialog, Extract-Jobs), Veto `OFF_IN_ARCHIVE` (F3, Schnellvorschau, F4 …),
  Enter auf eine Datei im Archiv meldet „erst entpacken (F5)“.
- 016 „Offen“: 7z/RAR, Passwörter, in Archive schreiben, Dateien im Archiv öffnen, ZIP-Zeiten, Konfliktdialog-Text.

## Aufgaben

1. **7z lesen, entpacken, packen** mit einer reinen Rust-Crate (Lizenz, Pflege, Größe in `docs/architecture.md`
   begründen); 7z als Ordner browsen wie ZIP.
2. **RAR lesen und entpacken** (kein Packen – Lizenz). Optionen prüfen (Crate mit den UnRAR-Quellen vs. Weglassen),
   entscheiden, begründen; falls aufgenommen: Lizenzhinweis in `docs/licenses.md`.
3. **Passwörter:** verschlüsselte ZIP (ZipCrypto + AES) und 7z browsen/entpacken, Packen mit Passwort (ZIP AES-256,
   7z AES-256). Passwortabfrage als Dialog; Passwort nie loggen, nie in Sitzung/Einstellungen speichern, nur im
   Speicher je Archiv für die Laufzeit. Fehlercodes `archive_password_required`/`archive_password_wrong`.
4. **Dateien im Archiv öffnen/ansehen:** F3, Schnellvorschau, Enter → Eintrag in ein privates Verzeichnis der App
   entpacken (Grenzen beachten, beim Beenden bzw. alte Reste beim Start aufräumen), dann wie eine normale Datei.
   Kein Zurückschreiben.
5. **In Archive schreiben** (wenn sauber machbar): Kopieren in einen geöffneten Archiv-Ordner und Löschen darin →
   Archiv über eine Temp-Datei neu schreiben und atomar ersetzen, Konflikte über die vorhandene Konfliktfrage, als
   Job. Sonst begründet auf ZIP beschränken oder offen lassen.
6. **Kleinkram:** ZIP-Zeiten korrekt (Extended Timestamp, DOS-Zeit = Ortszeit), Konfliktdialog sagt bei Archiv-Jobs
   nicht mehr „Cancel copying“.
7. **Freigaberegeln:** Unpack für 7z/RAR, Veto im Archiv anpassen (F3/Schnellvorschau erlaubt).

## Akzeptanzkriterien

- Eine mit 7-Zip erzeugte 7z-Datei (Unicode-Namen, Unterordner, solid) öffnet per Enter als Ordner; F5 entpackt
  Teile, Alt+F9 das Ganze; Alt+F5 packt die Markierung als 7z, das Ergebnis öffnet 7-Zip.
- Eine RAR-Datei öffnet als Ordner und lässt sich entpacken; Packen bietet kein RAR an.
- Ein Archiv mit verschlüsselten Namen (7z `-mhe`, RAR mit Header-Verschlüsselung) fragt beim Öffnen nach dem
  Passwort; ein falsches Passwort wird im Dialog gemeldet; danach öffnet es ohne erneute Frage (bis zum Neustart).
- Ein ZIP mit AES- oder ZipCrypto-Einträgen listet sofort; Entpacken/Ansehen fragt nach dem Passwort.
- Packen mit Passwort: ZIP (AES-256) und 7z (AES-256, Namen verschlüsselt); 7-Zip öffnet beide mit dem Passwort.
- F3 und die Schnellvorschau zeigen Dateien in Archiven; Enter öffnet sie mit der Standard-App (Kopie im
  App-Cache, schreibgeschützt); nach dem Beenden ist der Cache leer.
- Zip-Slip, Links und Bomben-Grenzen gelten für 7z und RAR genauso (Tests).

## Tests

- Rust: 7z/RAR-Index (Unicode, Ordner, Links, unsichere Namen), Entpacken (Zip-Slip, Link im Ziel, Konflikte,
  Abbruch), falsches/fehlendes Passwort (ZIP AES, ZipCrypto, 7z, 7z mit verschlüsselten Namen, RAR), beschädigtes
  Archiv, Grenzen (Anzahl, Summe, Wörterbuchgröße), Packen 7z/ZIP mit Passwort → Entpacken = gleiche Bytes,
  ZIP-Zeiten (Extended Timestamp), Ansicht (Cache, Grenzen, Aufräumen). Testarchive klein in `archive/testdata/`
  (Herkunft in `testdata/README.md`).
- Frontend: Namen/Endungen, Passwort-Dialog (Ablauf, falsches Passwort), Pack-Dialog (7z, Passwort-Wiederholung),
  Enter/F3 im Archiv, Veto, Konflikttext je Job-Art, Fassade per Fake.
- E2E unter Xvfb: 7z/RAR/verschlüsseltes ZIP öffnen, ansehen, entpacken, packen; Passwortdialog; Cache-Aufräumen.
