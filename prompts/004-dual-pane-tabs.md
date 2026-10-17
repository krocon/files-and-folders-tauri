# Prompt 004: Zwei Panels, Tabs und Sitzungszustand

> **Slug:** `dual-pane-tabs` · **Braucht:** 001–003 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §5 (Panels, Tabs, Verlauf,
> Persistenz), §2 (`SELECT_LEFT_PANEL`, `SELECT_RIGHT_PANEL`, `TOGGLE_PANEL`, `ADD_NEW_TAB`, `REMOVE_TAB`).

## Ziel

Das Herz eines Total Commanders: zwei unabhängige Panels mit je eigenen Tabs, ein aktives Panel als **Quelle**, das
andere als **Ziel**. Der komplette Sitzungszustand (Tabs, Pfade, Sortierung, aktives Panel, Spaltenbreiten) wird
automatisch gespeichert und beim Start wiederhergestellt.

## Altes Verhalten (Kurzfassung)

- Zwei feste Panels; Tab wechselt das aktive Panel; Alt+1/Alt+2 aktivieren ein Panel und schalten bei erneutem
  Drücken zum nächsten Tab. Ziel = immer das andere Panel.
- Tabs: Klick wählt, Doppelklick schließt (Konflikt mit Doppelklick auf Leiste = Neu laden), „+“ klont, Shift+T
  schließt. Such-Tabs enthalten eine Ergebnisliste statt eines Pfads (Prompt 009).
- Speichern nur manuell (Strg+Shift+S) bzw. beim Favoritensetzen, in `temp/<username>.json` (Sicherheitslücke).

## Aufgaben

1. **Layout**: zwei Panels nebeneinander (Splitter, Verhältnis gemerkt), optional untereinander (Einstellung,
   später). Jedes Panel = `FileBrowser` mit eigenem `FileBrowserStore` + eigener Table-Instanz. Aktives Panel
   deutlich markiert (Rahmen/Kopf), Fokus folgt.
2. **Workspace-Store** (Root): aktives Panel, `source()`/`target()` als Signals für alle Aktionen (Kopieren,
   Verschieben, Vergleichen …). Aktionen `TOGGLE_PANEL` (Tab), `SELECT_LEFT_PANEL`/`SELECT_RIGHT_PANEL`
   (Alt+1/2, Zyklus über Tabs), „Gleicher Ordner im anderen Panel“ (TC Strg+Pfeil?), „Panels tauschen“ (Strg+U).
3. **Tabs je Panel**: Tab = { Pfad, Verlauf, Sortierung, Filter, Cursor, Scroll, gesperrt? }; neu (klont aktuellen),
   schließen (letzter bleibt), wechseln (Strg+Tab/Strg+Shift+Tab bzw. Strg+1…9 – WebView-Konflikte prüfen),
   per Maus umsortieren (Drag) optional; Mittelklick schließt. Tab-Leiste mit `role="tablist"`.
   Kein Doppelklick-Konflikt mehr (Doppelklick auf freie Fläche = neuer Tab, wie in Browsern – entscheiden).
4. **Ordner im neuen Tab öffnen** (Strg+Enter / Mittelklick auf Ordner).
5. **Sitzungszustand** automatisch speichern (entprellt + beim Schließen des Fensters) in eine Datei im
   App-Config-Verzeichnis (Rust schreibt atomar: temp-Datei + rename). Versioniertes Schema (`version: 1`),
   unbekannte/fehlerhafte Inhalte → Defaults + Warnung. Fensterposition/-größe merken (Tauri-API oder
   `tauri-plugin-window-state` – Abhängigkeit begründen).
6. **Start**: gespeicherte Tabs laden; nicht mehr existierende Pfade → nächster existierender Elternordner +
   Hinweis. Ohne Zustand: links Home, rechts Home (oder erster weiterer Startpunkt).
7. Table: je Tab eigene Zeilen/Scrollposition – prüfen, ob eine Table-Instanz je Panel mit `setRows` +
   `getState`/`applyState` reicht (Empfehlung) oder eine Instanz je Tab nötig ist (Speicher!).

## Entscheidungsfragen

- Eine Table je Panel (Zustand je Tab gesichert) oder je Tab?
- Kürzel für Tab-Wechsel auf macOS (⌘+Shift+[ ]?) und Windows/Linux; Strg+Tab kollidiert mit TC-Konvention?
- Speicherort/Format des Sitzungszustands (eigene JSON-Datei vs. `tauri-plugin-store`).

## Akzeptanzkriterien

- Tab wechselt das Panel, Alt+1/2 wie beschrieben, aktives Panel jederzeit erkennbar (auch für Screenreader:
  Ansage „linkes Panel, /Users/marc“).
- Tabs anlegen, schließen, wechseln, umsortieren; jeder Tab behält Pfad, Sortierung, Cursor und Verlauf.
- Nach Neustart sind Panels, Tabs, aktives Panel, Splitter und Fenstergröße wie vorher; gelöschter Pfad führt zum
  Elternordner mit Hinweis.
- Zustandsdatei mit Müll → App startet mit Defaults und Warnung (Rust-Test).
