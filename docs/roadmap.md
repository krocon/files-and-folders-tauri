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
| 5 Total-Commander-Bedienung | 004 (Fensteraufbau ✅), 002 (als Nächstes) (Aktionen/Tastatur), 012 (Drag & Drop ✅, ins System offen), 014 (Kontextmenü, Menüleiste ✅) |
| 6 Vorschau & Eigenschaften | 010 (Ansicht, Schnellvorschau, Eigenschaften ✅) |
| 7 OS-Integration | 011 (Laufwerke, Tools, Zwischenablage ✅), 012 (Überwachung, Drag & Drop ✅) |
| 8 Einstellungen & UX | 013 (Farbschemata ✅), 019 (alte Designs ✅), 015 (Einstellungen, i18n) |
| 9 Stabilität, Sicherheit, Performance | in jedem Prompt (Review-Schwerpunkte), 018 |
| 10 Distribution | 017 (✅ vorbereitet: Version, Icon, Pakete, Vorlagen, Doku; offen: Lizenz, Signierung, Prüfung macOS/Windows) |
| 11 Feature-Parität | 018 (Spezialwerkzeuge: 007 ✅, 008 ✅, 016 Archive/Duplikate ✅ – 7z/Passwörter offen) |

Fensteraufbau: [ui-layout.md](ui-layout.md). Status je Prompt: [`prompts/README.md`](../prompts/README.md#status).

## Bekannte Einschränkungen (aktuell)

- Navigation in Ordner mit nicht-UTF-8-Namen nicht möglich (nur Linux/Unix relevant).
- „Up“ endet am Laufwerks-Root; Laufwerke wechseln über das Ordnermenü (`Alt+F1`/`Alt+F2`, 011).
- macOS/Windows-Teile von 011 (Volumes, Finder/Explorer, Terminal) nur auf Linux gebaut und getestet.
- UI-Texte nur Englisch.
- Lizenz des Projekts noch nicht festgelegt.
