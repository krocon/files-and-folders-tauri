# Roadmap

Legende: ✅ erledigt · 🟡 teilweise · ⬜ offen

## Phase 0 – Bestandsaufnahme ✅

- Repository war leer (keine Commits, nur `.idea/`, leere `.agents/skills`, `.gemini/skills`).
- Remote `origin` = `https://github.com/krocon/files-and-folders-tauri.git` (leer).
- Referenzprojekte gesichtet, siehe [feature-parity.md](feature-parity.md).

## Phase 1 – Walking Skeleton ✅

- ✅ Tauri 2.12 + Angular 22.2 + pnpm, zoneless, Signals
- ✅ `list_directory(path?)`, Home als Startordner
- ✅ Tabelle, Ordner öffnen, „Up“, Tastatur, Lade-/Leer-/Fehlerzustände
- ✅ Rust-Tests (Pfade, Listing, Symlinks, Unicode, Fehler), Angular-Tests (Store, UI-Zustände, Tastatur)
- ✅ ESLint, Prettier, rustfmt, clippy
- 🟡 CI: `.github/workflows/ci.yml` (Marc) läuft auf ubuntu/macOS/Windows; Erweiterung + Release-Workflow als
  Vorlagen in `docs/ci/` (017), von Marc zu übernehmen
- 🟡 Manuell geprüft nur unter Linux (Xvfb); macOS/Windows noch nicht praktisch getestet

## Ab hier: Feature-Prompts

Die weiteren Phasen sind als Arbeitsaufträge in [`prompts/`](../prompts/README.md) beschrieben, abgeleitet aus der
Analyse des alten Codes ([legacy-analysis.md](legacy-analysis.md)). Zuordnung zu den ursprünglichen Phasen:

| Ursprüngliche Phase | Prompts |
| --- | --- |
| 2 Navigation & Liste | 001 (GuiExpert-Dateiliste), 003 (Navigation, Filter, Statuszeile) |
| 3 Sichere Basisoperationen | 005 (Job-Engine ✅), 006 (Operationen ✅), 007 (Multi-Rename ✅), 008 (Gruppieren, Ordner aufräumen, Multi-MkDir ✅) |
| 4 Suche & Filter | 003 (Schnellfilter ✅), 009 (Suche, Ergebnis-Tabs, Ordner-Finder ✅) |
| 5 Total-Commander-Bedienung | 004 (Fensteraufbau ✅), 002 (als Nächstes) (Aktionen/Tastatur), 012 (Drag & Drop ✅), 028 (ins System ✅), 014 (Kontextmenü, Menüleiste ✅) |
| 6 Vorschau & Eigenschaften | 010 (Ansicht, Schnellvorschau, Eigenschaften ✅) |
| 7 OS-Integration | 011 (Laufwerke, Tools, Zwischenablage ✅), 012 (Überwachung, Drag & Drop ✅) |
| 8 Einstellungen & UX | 013 (Farbschemata ✅), 019 (alte Designs ✅), 015 (Einstellungen, Deutsch/Englisch ✅) |
| 9 Stabilität, Sicherheit, Performance | in jedem Prompt (Review-Schwerpunkte), 018 (✅ alle Fehler aus mr §11/legacy §9 behoben oder entfallen) |
| 10 Distribution | 017 (✅ vorbereitet: Version, Icon, Pakete, Vorlagen, Doku; offen: Signierung, Prüfung macOS/Windows) |
| 11 Feature-Parität | 018 ✅ Matrix gegen `old_project/` (mr) in [feature-parity.md](feature-parity.md): 195 ✅, 26 🟡, 9 ⬜, 23 ✖ (Stand 021); 020 ✅ Actions-Menü |
| 12 Nach der Parität | 021 Shell-Leiste ✅ (Pipes, Sicherheitsmodell), 022 Konfigurations-Editoren ✅ (Buttons, Dateitypen, Suchvorlagen, Vollbild F11), ~~023 eingebauter Editor~~ (verworfen), 024 Attribute ändern ✅ (Eigentümer/Gruppe offen), 025 Archive erweitert ✅ (7z, RAR lesen, Passwörter, im Archiv ansehen/öffnen), 035 Archive bearbeiten ✅ (ZIP/TAR/TAR.GZ: hineinkopieren/-verschieben, löschen, Ordner anlegen; 7z/Umbenennen offen), 026 Import alter Konfiguration ✅, 027 Persistenz je Ordner ✅ (Ordnergedächtnis je Tab über Neustart, letzte Dialogeingaben), 039 Prüfsummen ✅ (erzeugen/prüfen, GNU/BSD, Zwischenablage), 037 Dateien vergleichen ✅ (Text nebeneinander, binär, externes Tool), 038 Flache Ansicht ✅ (Strg+B im selben Tab, Spalte Pfad, Auffrischen im Hintergrund), 036 Ordner synchronisieren ✅ (Shift+F2 markiert Unterschiede, Vergleich/Abgleich als Jobs, NFC/NFD, Inhalt byteweise; Serverordner als zweite Stufe offen), 028 Ziehen ins System ✅, 029 Bedienbar bei langen Jobs ✅, 030 Ordner-Cache für langsame Laufwerke ✅, 031 Tabs ziehen + Verknüpfungen ✅ (Verschieben ins System bewusst nicht), 032 Starter-Menü ✅ (Menü „Start“, `Alt+S`, TC-Parameter), 033 Speicherbelegung ✅ (Scan als Job, Ringe/Kacheln, Sammelkorb; macOS-Firmlinks/Windows bei Marc), 034 Server-Verbindungen ✅ (FTP/FTPS/SFTP als Ordner, Passwörter nur im Schlüsselbund; macOS-Keychain/Windows bei Marc), 040 Panel-Aktionen ✅ (Seiten tauschen, Ziel = Quelle, Strg+←/→), 042 Dubletten ✅ (nach Inhalt mit Hardlinks/Cache/paranoid, Regel-Engine „welche Datei bleibt“, Gruppenansicht, Löschen nach Bestätigung mit Prüfung je Kopie, ähnliche Bilder und Comics per pHash; HEIC/AVIF nicht). 044 README + Werbeseite ✅ (je Feature ein Norton-Bild per `pnpm screenshots:readme`, `site/` für krocon.de/products/fnf). Neue Prompts 027, 035–041 geschrieben (`prompts/README.md` „Nächste Prompts“). 022–031 je mit externem Review (21.10.2026), alle Befunde behoben |

Fensteraufbau: [ui-layout.md](ui-layout.md). Status je Prompt: [`prompts/README.md`](../prompts/README.md#status).

## Bekannte Einschränkungen (aktuell)

- Navigation in Ordner mit nicht-UTF-8-Namen nicht möglich (nur Linux/Unix relevant).
- „Up“ endet am Laufwerks-Root; Laufwerke wechseln über das Ordnermenü (`Alt+F1`/`Alt+F2`, 011).
- macOS/Windows-Teile von 011 (Volumes, Finder/Explorer, Terminal) nur auf Linux gebaut und getestet.
- Lizenz des Projekts: MIT.
