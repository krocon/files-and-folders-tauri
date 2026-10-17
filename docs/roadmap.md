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
- ✅ ESLint, Prettier, rustfmt, clippy, CI-Workflow
- 🟡 Manuell geprüft nur unter Linux (Xvfb); macOS/Windows noch nicht praktisch getestet

## Phase 2 – Navigation & Liste ⬜

Breadcrumbs (Daten liegen schon in `segments`), Zurück/Vorwärts, Sortierung per Spaltenkopf,
Hidden-Toggle (Flag vorhanden), Mehrfachauswahl (Shift/Ctrl/Insert), Spaltenbreiten,
Performance-Messung mit ≥ 50 000 Einträgen → ggf. Virtualisierung (CDK).

## Phase 3 – Sichere Basisoperationen ⬜

Mkdir, Rename, Copy, Move, Delete (Papierkorb), Konflikte, Fortschritt/Abbruch, Fehler pro Eintrag –
alles im Rust-Backend validiert und getestet.

## Phase 4 – Suche & Filter ⬜
## Phase 5 – Total-Commander-Bedienung (Tabs, Dual-Pane, F-Tasten, Kontextmenü, DnD) ⬜
## Phase 6 – Vorschau & Eigenschaften ⬜
## Phase 7 – OS-Integration (Laufwerke, Öffnen mit, Im Finder zeigen, Papierkorb) ⬜
## Phase 8 – Einstellungen & UX-Politur (Themes, i18n de/en) ⬜
## Phase 9 – Stabilität, Sicherheit, Performance ⬜
## Phase 10 – Distribution & Release (Signierung, Notarisierung, Pakete) ⬜
## Phase 11 – Abgleich mit `files-and-folders` ⬜ (Matrix vorbereitet)

## Bekannte Einschränkungen (aktuell)

- Navigation in Ordner mit nicht-UTF-8-Namen nicht möglich (nur Linux/Unix relevant).
- Keine Laufwerksauswahl unter Windows (Phase 7); „Up“ endet am Laufwerks-Root.
- UI-Texte nur Englisch.
- Lizenz des Projekts noch nicht festgelegt.
