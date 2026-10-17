# Feature-Prompts – Files and Folders (Tauri)

Arbeitsaufträge für die Weiterentwicklung, jeweils für **eine neue Claude-Sitzung** im Repo. Jeder Prompt führt in
Phasen vom Design über Rust- und Frontend-Tests bis zur Ende-zu-Ende-Prüfung und hält nach dem Design an
(Freigabe). Gemeinsame Regeln: [000-arbeitsweise.md](000-arbeitsweise.md).

**So startet man einen Prompt:** neue Sitzung im Repo, dann z. B.
„Lies `prompts/000-arbeitsweise.md` und führe `prompts/001-guiexpert-dateiliste.md` aus.“

Herkunft: Analyse des alten Codes (`docs/legacy-analysis.md`, Okt. 2026) aus
`krocon/node-files-and-folders-client` und `krocon/node-files-and-folders-server`, abgeglichen mit dem Stand nach
Phase 1 (Walking Skeleton) und der GuiExpert Table 1.1.99 als Dateiliste.

## Reihenfolge

| Nr. | Prompt | Inhalt | Braucht | Umfang |
|---|---|---|---|---|
| 000 | [000-arbeitsweise.md](000-arbeitsweise.md) | gemeinsamer Ablauf, Phasen, Regeln | – | – |
| 001 | [001-guiexpert-dateiliste.md](001-guiexpert-dateiliste.md) | Dateiliste mit der GuiExpert Table, Cursor/Markierung, Sortierung, Performance | MVP | M |
| 002 | [002-aktionen-tastatur.md](002-aktionen-tastatur.md) | Aktionsregister, Keymaps je OS + Override, TC-Auswahl, Befehlspalette „Go to anything“, F-Tasten-Leiste | 001 | M |
| 003 | [003-navigation-liste.md](003-navigation-liste.md) | Pfadleiste, „..“, Zurück/Vor, Favoriten/zuletzt, Hidden, Schnellfilter, Typ-Ahead, Ordnergröße, Statuszeile, Datei öffnen | 001, 002 | M |
| 004 | [004-dual-pane-tabs.md](004-dual-pane-tabs.md) | zwei Panels, Quelle/Ziel, Tabs, Sitzungszustand speichern | 001–003 | M |
| 005 | [005-job-queue.md](005-job-queue.md) | Job-Engine in Rust: Fortschritt, Abbruch, Pause, Konfliktprotokoll, Job-UI | 004 | L |
| 006 | [006-basis-operationen.md](006-basis-operationen.md) | Ordner anlegen, Umbenennen, Kopieren, Verschieben, Löschen (Papierkorb) | 005 | L |
| 007 | [007-multi-rename.md](007-multi-rename.md) | Multi-Rename (Muster, Zähler, Regex, Makros, Vorschau, Undo) | 005, 006 | M |
| 008 | [008-gruppieren-leere-ordner.md](008-gruppieren-leere-ordner.md) | Dateien gruppieren, leere Ordner löschen | 005, 006 | S–M |
| 009 | [009-suche.md](009-suche.md) | Suche mit Ergebnis-Tab, Ordner-Finder | 004, 005 | L |
| 010 | [010-vorschau-eigenschaften.md](010-vorschau-eigenschaften.md) | Ansicht F3, Schnellvorschau, Eigenschaften | 004 | M |
| 011 | [011-os-integration-tools.md](011-os-integration-tools.md) | Laufwerke, Finder/Explorer, Terminal, externe Tools (ohne Shell), Zwischenablage | 002, 004 | M |
| 012 | [012-ueberwachung-drag-drop.md](012-ueberwachung-drag-drop.md) | Verzeichnis-Überwachung, Drag & Drop | 006 | M |
| 013 | [013-themes-farbschemata.md](013-themes-farbschemata.md) | Farbschemata (light/dark/blackboard/classic), Live-Editor, GuiExpert-Brücke | 001 | S–M |
| 019 | [019-alte-designs.md](019-alte-designs.md) | die acht Default-Designs der alten Version (light, paper, bitbucket, cypress, blackboard, coffee, combat, norton) | 013, 004, 006 | M |
| 014 | [014-kontextmenue-menueleiste.md](014-kontextmenue-menueleiste.md) | Kontextmenü, Menüleiste (nativ/HTML) | 002, 006 | S–M |
| 015 | [015-einstellungen-i18n.md](015-einstellungen-i18n.md) | Einstellungsdienst + Dialog, Deutsch/Englisch | 002–004, 013 | M |
| 016 | [016-archive-duplikate.md](016-archive-duplikate.md) | Archive (ZIP/TAR), Duplikate – optional | 005, 006, 009 | L |
| 017 | [017-release-distribution.md](017-release-distribution.md) | CI, Pakete je OS, Version, Icons, Signierung (vorbereiten) | – | M |
| 018 | [018-feature-paritaet.md](018-feature-paritaet.md) | Abgleich mit dem alten Programm, Matrix mit Testbelegen | 001–015 | S–M |

Umfang: S ≈ 1 Sitzung, M ≈ 2–3, L ≈ 3–5. Grobe Schätzung, nur zum Planen.

## Warum diese Reihenfolge

- **001 zuerst:** Die Dateiliste ist das Bauteil, auf dem alles sitzt. Der Umstieg auf die GuiExpert Table klärt
  früh, wie Cursor und Markierung abgebildet werden, und deckt Lücken der Table auf, solange sie im Mono-Repo noch
  günstig zu schließen sind.
- **002 vor allem anderen Bedienbaren:** Jede spätere Funktion ist eine Aktion. Wer Kürzel, Menüs und Palette
  zuerst baut, muss später nichts umverdrahten (im alten Programm war das Aktions-Id-Modell die tragende Idee).
- **003 → 004:** erst ein Panel vollständig, dann zwei. Tabs und Sitzungszustand brauchen Verlauf, Filter und
  Sortierung als Teil des Tab-Zustands.
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
- [ ] 001 · [ ] 002 · [ ] 003 · [ ] 004 · [ ] 005 · [ ] 006 · [ ] 007 · [ ] 008 · [ ] 009 · [ ] 010 · [ ] 011 ·
  [ ] 012 · [ ] 013 · [ ] 014 · [ ] 015 · [ ] 016 · [ ] 017 · [ ] 018 · [ ] 019
