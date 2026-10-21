# Feature-Prompts – Files and Folders (Tauri)

Arbeitsaufträge für die Weiterentwicklung, jeweils für **eine neue Claude-Sitzung** im Repo. Jeder Prompt führt in
Phasen vom Design über Rust- und Frontend-Tests bis zur Ende-zu-Ende-Prüfung und hält nach dem Design an
(Freigabe). Gemeinsame Regeln: [000-arbeitsweise.md](000-arbeitsweise.md).

**So startet man einen Prompt:** neue Sitzung im Repo, dann z. B.
„Lies `prompts/000-arbeitsweise.md` und führe `prompts/031-apple.md` aus.“

**Erledigte Prompts** (001–022, 024–026, 028–034, je Auftrag + `*.design.md`) liegen unter [`done/`](done/). Die Design-Dokumente
bleiben Referenz: Kürzel wie „029 E11“ oder „G1–G14“ in Code und Doku verweisen auf ihre Entscheidungen.

Herkunft: Analyse der alten Versionen – `docs/legacy-analysis.md` (AngularJS/Node 2016, `node-files-and-folders-*`)
und `docs/legacy-analysis-mr.md` (Angular 20/NestJS 2025, `files-and-folders-mr`) –, Marcs Vorgabe zum Fensteraufbau
(`docs/ui-layout.md`, Screenshot in `docs/legacy-screenshots/`), die Default-Designs (`docs/legacy-themes/`) und die
GuiExpert Table 1.1.99 als Dateiliste.

**Ausführungsreihenfolge:** 001 → **004** → 002 → 003 → 005 → 006 → … (004 ist das Fenstergerüst und kommt deshalb
direkt nach 001; die Nummern bleiben, damit Verweise stabil sind).

## Reihenfolge

| Nr. | Prompt | Inhalt | Braucht | Umfang |
|---|---|---|---|---|
| 000 | [000-arbeitsweise.md](000-arbeitsweise.md) | gemeinsamer Ablauf, Phasen, Regeln | – | – |
| 001 | [001-guiexpert-dateiliste.md](done/001-guiexpert-dateiliste.md) | Dateiliste mit der GuiExpert Table, Cursor/Markierung, Sortierung, Performance | MVP | M |
| 002 | [002-aktionen-tastatur.md](done/002-aktionen-tastatur.md) | Aktionsregister, Keymaps je OS + Override, TC-Auswahl, Befehlspalette, Button-Leiste mit Modifier-Sätzen, Actions-Menü | 001, 004 | M |
| 003 | [003-navigation-liste.md](done/003-navigation-liste.md) | „..“, Zurück/Vor, Menü ▾ (Laufwerke/Favoriten/zuletzt), Hidden + Filter je Tab, Quick-Search, Ordnergröße, Auswahl je Ordner merken, Datei öffnen | 001, 004, 002 | M |
| 004 | [004-dual-pane-tabs.md](done/004-dual-pane-tabs.md) | **Fensteraufbau**: zwei Seiten mit Pfad-Header, Tab-Reitern, Liste, Statuszeile; Splitter; Button-Leiste (Gerüst); Sitzungszustand – **direkt nach 001** | 001 | L |
| 005 | [005-job-queue.md](done/005-job-queue.md) | Job-Engine in Rust: Fortschritt, Abbruch, Pause, Konfliktprotokoll, Job-UI | 004 | L |
| 006 | [006-basis-operationen.md](done/006-basis-operationen.md) | Ordner anlegen, Umbenennen, Kopieren, Verschieben, Löschen (Papierkorb) | 005 | L |
| 007 | [007-multi-rename.md](done/007-multi-rename.md) | Multi-Rename (Muster, Zähler, Regex, Makros, Vorschau, Undo) | 005, 006 | M |
| 008 | [008-gruppieren-leere-ordner.md](done/008-gruppieren-leere-ordner.md) | Dateien gruppieren, leere Ordner löschen | 005, 006 | S–M |
| 009 | [009-suche.md](done/009-suche.md) | Suche mit Ergebnis-Tab, Ordner-Finder | 004, 005 | L |
| 010 | [010-vorschau-eigenschaften.md](done/010-vorschau-eigenschaften.md) | Ansicht F3, Schnellvorschau, Eigenschaften | 004 | M |
| 011 | [011-os-integration-tools.md](done/011-os-integration-tools.md) | Laufwerke, Finder/Explorer, Terminal, externe Tools (ohne Shell), Zwischenablage | 002, 004 | M |
| 012 | [012-ueberwachung-drag-drop.md](done/012-ueberwachung-drag-drop.md) | Verzeichnis-Überwachung, Drag & Drop | 006 | M |
| 013 | [013-themes-farbschemata.md](done/013-themes-farbschemata.md) | Farbschemata (light/dark/blackboard/classic), Live-Editor, GuiExpert-Brücke | 001 | S–M |
| 019 | [019-alte-designs.md](done/019-alte-designs.md) | die acht Default-Designs der alten Version (light, paper, bitbucket, cypress, blackboard, coffee, combat, norton) | 013, 004, 006 | M |
| 014 | [014-kontextmenue-menueleiste.md](done/014-kontextmenue-menueleiste.md) | Kontextmenü, Menüleiste (nativ/HTML) | 002, 006 | S–M |
| 015 | [015-einstellungen-i18n.md](done/015-einstellungen-i18n.md) | Einstellungsdienst + Dialog, Deutsch/Englisch | 002–004, 013 | M |
| 016 | [016-archive-duplikate.md](done/016-archive-duplikate.md) | Archive (ZIP/TAR), Duplikate – optional | 005, 006, 009 | L |
| 017 | [017-release-distribution.md](done/017-release-distribution.md) | CI, Pakete je OS, Version, Icons, Signierung (vorbereiten) | – | M |
| 018 | [018-feature-paritaet.md](done/018-feature-paritaet.md) | Abgleich mit dem alten Programm, Matrix mit Testbelegen | 001–015 | S–M |
| 020 | [020-actions-menue.md](done/020-actions-menue.md) | Actions-Menü nach Vorbild der alten Version (4 kuratierte Spalten, Trennlinien, Shortcut-Badges nach mr §1.8) | 002, 004, 014 | S–M |
| 021 | [021-shell-leiste.md](done/021-shell-leiste.md) | Shell-Leiste (`TOGGLE_SHELL`): Befehlszeile im Ordner des aktiven Panels, gestreamte Ausgabe als Job, `cd` navigiert das Panel, Verlauf, Sicherheitsmodell | 004, 005, 011, 012 | M |
| 022 | [022-konfig-editoren.md](done/022-konfig-editoren.md) | Konfigurations-Editoren: Button-Leiste je Modifier-Satz (`buttons.json`), Dateitypen (`filetypes.json`, Icons/Farben/Markier-Vorlagen), dauerhafte Suchvorlagen, Vollbild F11 (J14), Export/Import | 002, 009, 014, 015, 018 | M |
| 024 | [024-attribute-aendern.md](done/024-attribute-aendern.md) | Attribute ändern: Rechte (Unix, oktal, Set-ID/Sticky), R/H/S/A (Windows), „versteckt“ (macOS), Zeitstempel – als Job `attributes`, Dreifach-Zustand, rekursiv mit Filter, Links nie folgen | 005, 006, 010, 016, 030 | M |
| 025 | [025-archive-erweitert.md](done/025-archive-erweitert.md) | Archive erweitert: 7z lesen/entpacken/packen, RAR lesen/entpacken (UnRAR-Quellen, Feature `rar`), Passwörter (Dialog, nur im Speicher), Dateien im Archiv ansehen/öffnen über einen App-Cache, ZIP-Zeiten | 016, 010, 011 | L |
| 026 | [026-import-alte-konfig.md](done/026-import-alte-konfig.md) | Import alter Konfiguration (mr): Assistent mit Vorschau je Bereich – Kürzel (Ids/Notation übersetzt, † gemeldet), Buttons, Dateitypen, Suchmuster, Tools, Farbschemata, zwei Einstellungen; Zusammenführen/Ersetzen, Sicherung `.bak` jeder geänderten Datei | 002, 011, 015, 019, 022 | M |
| 023 | – | ~~Eingebauter Editor~~ – **verworfen** (Marc, 20.10.2026): F4 bleibt das konfigurierbare Tool `edit` (011) | – | – |
| 027 | [027-persistenz-je-ordner.md](027-persistenz-je-ordner.md) | Persistenz je Ordner: Cursor/Markierung über einen Neustart, letzte Eingaben von Gruppieren/Aufräumen/Multi-MkDir | 003, 004, 008, 015 | S–M |
| 028 | [028-drag-ins-system.md](done/028-drag-ins-system.md) | Drag & Drop erweitert, Teil 1: Einträge aus der Liste in andere Programme ziehen (nur Kopieren; Tabs ziehen, Verknüpfung offen) | 012, 011 | S–M |
| 029 | [029-reaktionsfaehig-bei-jobs.md](done/029-reaktionsfaehig-bei-jobs.md) | Bedienbar bleiben bei langen Jobs/langsamen Laufwerken: Auffrischen ohne Sperre, Watcher unter Last, langsames Listing abbrechbar, schonendere Kopie, async Commands | 001, 005, 006, 012 | M |
| 030 | [030-ordner-cache-smb.md](done/030-ordner-cache-smb.md) | Langsame Laufwerke (SMB): Cache je Pfad (sofort zeigen, im Hintergrund prüfen, sichtbar gekennzeichnet), nichts Destruktives auf ungeprüftem Stand; `getattrlistbulk` gemessen und verworfen; kein rekursives Vorladen | 029, 012 | M |
| 031 | [031-drag-tabs-links.md](done/031-drag-tabs-links.md) | Drag & Drop erweitert, Teil 2: Tabs ziehen (umsortieren, andere Seite, Kopie) + Tab-Aktionen, Verknüpfungen per Drag/Dialog (Job `link`); Verschieben ins System bewusst nicht | 004, 006, 012, 028 | M |
| 032 | [032-startermenue.md](done/032-startermenue.md) | Starter-Menü (TC „Start“): Menü „Start“ + `Alt+S`, Editor „Startermenü ändern“, Programme/Skripte/Ordner/Untermenüs, TC-Parameter `%P%N` …, Kürzel je Eintrag | 002, 011, 014, 015, 022 | S–M |
| 033 | [033-speicherbelegung.md](done/033-speicherbelegung.md) | Speicherbelegung: Scan als Job (Baum in Rust, Hardlinks einmal, keine Symlinks, Dateisystemgrenzen/macOS-Firmlinks), Liste nach Größe + Sunburst/Treemap, Hineinnavigieren, „Größte Dateien“, Sammelkorb → Löschen (Papierkorb, `expected`) | 003, 005, 006, 009, 010, 011, 013, 015, 030 | L |
| 034 | [034-server-verbindungen.md](done/034-server-verbindungen.md) | Server-Verbindungen: Profile (FTP, FTPS, SFTP) mit Dialog nach Vorlage, Passwörter/Passphrasen im Schlüsselbund des OS (nie im Klartext), Host-Key/Zertifikat prüfen, Serverordner im Panel (Tabs, Verlauf, Cache), Kopieren/Verschieben/Löschen/Anlegen/Umbenennen als Jobs, F3 über App-Cache | 003–006, 010, 011, 015, 016/025, 022, 029/030 | L |
| 035 | [035-archive-bearbeiten.md](035-archive-bearbeiten.md) | Archive bearbeiten: in ZIP/TAR kopieren, darin löschen/Ordner anlegen (Temp-Datei + atomar ersetzen, als Job), danach 7z; RAR nie | 005, 006, 016/025, 029/030 | L |
| 036 | [036-ordner-synchronisieren.md](036-ordner-synchronisieren.md) | Ordner vergleichen (Shift+F2 markiert Unterschiede) und synchronisieren: Vergleich als Job (Name/Größe/Datum/Inhalt), Vorschau mit Aktion je Zeile, Abgleich in eine oder beide Richtungen; Serverordner als 2. Stufe | 004–006, 009, 016, 029/030, 034 | L |
| 037 | [037-dateien-vergleichen.md](037-dateien-vergleichen.md) | Dateien vergleichen: Text-Diff nebeneinander (nur lesend), Binär als Hex mit Abweichungen, alternativ externes Tool `diff` mit zwei Pfaden | 010, 011 | M |
| 038 | [038-flache-ansicht.md](038-flache-ansicht.md) | Flache Ansicht (TC Strg+B): alle Dateien unterhalb des Ordners in einer Liste mit Pfad-Spalte, alle Operationen darauf | 001, 003, 005/006, 009 | M |
| 039 | [039-pruefsummen.md](039-pruefsummen.md) | Prüfsummen erzeugen/prüfen (SHA-256/512, SHA-1, MD5; GNU/BSD-Format) als Jobs, Prüfsumme in die Zwischenablage | 005, 010, 016 | S–M |
| 040 | [040-panel-aktionen.md](040-panel-aktionen.md) | Panel-Aktionen: Seiten tauschen (auch mit allen Tabs), Ziel = Quelle, Ordner unter dem Cursor in der linken/rechten Seite öffnen (TC Strg+U, Strg+←/→) | 002, 004, 014, 031 | S |
| 041 | [041-spalten-ansichten.md](041-spalten-ansichten.md) | Spaltenauswahl (ein-/ausblenden, Reihenfolge, Breiten bleiben), Datumsspalte für US-Format, Kurzansicht und Miniaturen – soweit die GuiExpert Table es trägt | 001, 010, 015 | M–L |

Umfang: S ≈ 1 Sitzung, M ≈ 2–3, L ≈ 3–5. Grobe Schätzung, nur zum Planen.

## Nächste Prompts (Stand 21.10.2026)

Vorgeschlagene Reihenfolge der offenen Prompts, kleine zuerst: **040** (Panel-Aktionen, S) → **027** (Persistenz,
S–M) → **039** (Prüfsummen, S–M) → **037** (Dateien vergleichen, M) → **038** (Flache Ansicht, M) → **036** (Ordner
synchronisieren, L) → **035** (Archive bearbeiten, L) → **041** (Spalten und Ansichten, M–L, hängt an der GuiExpert
Table). Unabhängig davon bleibt die CI für macOS/Windows (`TODO.md` §3) der wichtigste nicht-funktionale Punkt.

## Warum diese Reihenfolge

- **001 zuerst:** Die Dateiliste ist das Bauteil, auf dem alles sitzt. Der Umstieg auf die GuiExpert Table klärt
  früh, wie Cursor und Markierung abgebildet werden, und deckt Lücken der Table auf, solange sie im Mono-Repo noch
  günstig zu schließen sind.
- **004 direkt nach 001:** Marcs Vorgabe zum Fensteraufbau (zwei Seiten wie im Norton Commander, je mit Header,
  Tab-Reitern, Liste und Statuszeile, darunter die Button-Leiste) ist das Gerüst, in das alle weiteren Funktionen
  eingehängt werden. Wer es früh baut, muss später nichts umbauen.
- **002 vor allem anderen Bedienbaren:** Jede spätere Funktion ist eine Aktion. Wer Kürzel, Menüs und Palette
  zuerst baut, muss später nichts umverdrahten (im alten Programm war das Aktions-Id-Modell die tragende Idee).
- **003 nach 004:** Menü ▾, Filter und Hidden sitzen in der Tab-Leiste und gelten je Tab – sie brauchen das Gerüst.
- **005 vor 006:** Kopieren/Verschieben/Löschen sind nur sicher mit Abbruch, Konfliktabfrage und Fehlerbericht.
  Die Engine trägt später auch Multi-Rename, Gruppieren, Suche und Duplikate.
- **007–009:** die Spezialwerkzeuge, die das alte Programm ausmachten (Multi-Rename, Gruppieren, Ordner-Finder).
- **010–014:** Komfort und Integration; untereinander weitgehend unabhängig, Reihenfolge nach Bedarf tauschbar.
- **019 nach 013:** die Designs der alten Version (`docs/legacy-themes/`) brauchen die Theme-Mechanik aus 013
  sowie aktives Panel (004) und Dialoge (006), damit alle Variablengruppen eine Entsprechung haben. Nummer 019,
  weil der Prompt nachträglich dazukam – ausgeführt wird er nach 013.
- **015 spät:** sammelt die bis dahin verstreuten Einstellungen in einem Dienst und einem Dialog.
- **017 jederzeit:** CI lohnt sich früh – sobald Marc den Workflow eingecheckt hat (Remote-Sitzungen dürfen
  `.github/workflows/` nicht schreiben).
- **018 zuletzt:** Nachweis der Parität mit Tests.

## Gemeinsame Konventionen

- Branch `feat/<slug>`, Design-Dokument `prompts/NNN-<slug>.design.md` (Slug steht im Kopf jedes Prompts).
- Commits nach jeder grünen Phase; nichts pushen, taggen oder veröffentlichen ohne ausdrückliche Anweisung.
- Lücken der GuiExpert Table werden im Mono-Repo gelöst bzw. dort vorgeschlagen (`CLAUDE.md` §5), nicht hier
  umgangen.

## Status

Erledigte Prompts hier abhaken; das Design-Dokument bleibt als Entscheidungsprotokoll liegen.

- [x] Phase 1 – Walking Skeleton (vor den Prompts, `docs/roadmap.md`)
- [x] 001 (Performance auf dem Mac nachmessen; Lücken G1–G14 an `mono/TODO.md` melden) · [x] 002 · [x] 003 · [x] 004 · [x] 005 · [x] 006 · [x] 007 · [x] 008 · [x] 009 · [x] 010 · [x] 011 ·
  [x] 012 (Ziehen ins System → 028) · [x] 013 · [x] 014 · [x] 015 (Button-Editor, Spaltenauswahl, weitere Sprachen offen) · [x] 016 (7z, Passwörter, in Archive schreiben offen) · [x] 017 (Workflows als Vorlage in `docs/ci/`, Signierung nur vorbereitet, Lizenz offen) · [x] 018 (Matrix + kleine Lücken; Folge-Prompts 021–028 vorgeschlagen; macOS/Windows-Durchlauf bei Marc) · [x] 019 · [x] 020 · [x] 021 (Pipes statt PTY; Dateinamen-Vervollständigung, Windows-Ausführung in der CI und macOS-`PATH` bei Marc offen) · [x] 029 (Branch `feat/reaktionsfaehig-bei-jobs`; macOS-Test am echten langsamen Laufwerk bei Marc offen) · [x] 030 (`getattrlistbulk` auf SMB ohne Gewinn – ausgebaut) · [x] 028 (Ziehen ins System; macOS/Windows bei Marc bzw. in der CI offen) · [x] 022 (Vollbild unter macOS/Windows nur per CI/Marc prüfbar) · ~~023~~ verworfen · [x] 024 (Eigentümer/Gruppe offen; macOS/Windows-Code erst in der CI) · [x] 025 (in Archive schreiben → Folge-Prompt; RAR-/7z-Code auf macOS/Windows erst in der CI) · [x] 026 · [x] 031 (Verschieben ins System bewusst nicht) · [x] 032 (Starter-Menü; macOS/Windows bei Marc) · [x] 033 (Speicherbelegung; macOS-Firmlinks/Windows bei Marc, externes Review eingearbeitet) · [x] 034 (Server-Verbindungen; Schlüsselbund macOS/Windows und Herkunftsmarke bei Marc, externes Review eingearbeitet) – 022–031 mit externem Review und behobenen Befunden (Abschnitte „Externes Review“ in den Designs)
