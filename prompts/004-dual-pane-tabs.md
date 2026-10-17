# Prompt 004: Fensteraufbau – zwei Seiten, Tabs, Header, Statuszeile, Button-Leiste

> **Slug:** `dual-pane-tabs` · **Braucht:** 001 · **Umfang:** L · **Ausführen direkt nach 001** (vor 002/003).
> Lies zuerst `prompts/000-arbeitsweise.md` und **`docs/ui-layout.md`** (verbindlicher Zielaufbau, Screenshot unter
> `docs/legacy-screenshots/`). Altes Verhalten: `docs/legacy-analysis-mr.md` §1 (Layout, Splitter, Breadcrumb,
> Tab-Panel, Summary, Button-Panel), §4 (Tab-Zustand, Persistenz); `docs/legacy-analysis.md` §5.

## Ziel

Das Hauptfenster bekommt seinen endgültigen Aufbau: **zwei Seiten** (links/rechts) mit je Pfad-Header, Tab-Reitern,
Dateiliste und Statuszeile, ein gemeinsamer Splitter, darunter die **Button-Leiste**. Ein aktives Panel ist Quelle, das
andere Ziel. Tabs und Sitzungszustand werden automatisch gespeichert. Alle späteren Prompts füllen dieses Gerüst nur
noch.

## Abgrenzung

- **Hier:** Grid-Layout, Splitter, aktive Seite, Tabs (Modell, Leiste, Kontextmenü), Pfad-Header mit Breadcrumb und
  Favoriten-Stern (Grundfunktion), Statuszeile im Zielformat, Button-Leiste **als Gerüst** (Buttons lösen die
  vorhandenen Aktionen aus bzw. sind gedimmt, solange es die Funktion nicht gibt), Sitzungszustand.
- **Später:** Aktionssystem, Keymaps, Modifier-Sätze und Actions-Menü (002), Menü-Button ▾ mit Laufwerken/Favoriten/
  Verlauf, Filter und Hidden-Umschalter (003), Tasks (005), Theme-Menü (013/019), Shell-Zeile (011).

## Aufgaben

1. **Layout** (`features/workspace/` o. ä.): CSS-Grid mit Zeilen *Header · Tabs · Liste · Statuszeile · (Shell) ·
   Buttons*; die ersten vier Zeilen als *links | Trenner | rechts* mit **gemeinsamer** Spaltenbreite (eine CSS-Variable),
   damit ein Splitter alle Zeilen verschiebt. Splitter per Maus und Tastatur (`role="separator"`, `aria-valuenow`,
   Pfeiltasten), Doppelklick = 50/50, Position gespeichert. Mindestbreiten, Fenster-Resize.
2. **Panel-Komponente** je Seite: Header, Tabs, `FileList` (aus 001), Statuszeile. Jede Seite hat eigene Stores (der
   `FileBrowserStore` bleibt je Panel/Tab, `providers` im Komponentenbaum).
3. **Workspace-Store** (Root): `activePanel`, `source()`/`target()` als Signals (für Kopieren, Verschieben …),
   `setActive(side)`. Klick irgendwo in eine Seite aktiviert sie; `Tab` wechselt (bis 002 als einfacher Handler).
   Aktives Panel sichtbar (Farben aus Tokens: `--color-active-panel-*`, Vorbereitung für `--fnf-activepanel-*` in 019)
   und für Screenreader angesagt („linkes Panel, /Users/marc“).
4. **Tabs je Seite**: Tab = { id, Pfad, Verlauf (max. 15, für 003), Sortierung, Spaltenbreiten, Filter-/Hidden-Status
   (für 003), Cursor, Scrollposition }. Leiste mit `role="tablist"`, Titel = letztes Pfadsegment, Tooltip = Pfad;
   `+` klont, `−` schließt (letzter bleibt); Kontextmenü: Neu laden · Schließen · In anderes Panel verschieben · In
   anderes Panel klonen · Nach links/rechts verschieben; Doppelklick auf Tab = neu laden; Mittelklick = schließen.
   Ordner im neuen Tab öffnen (Strg/⌘+Enter, Mittelklick auf Ordnerzeile).
5. **Eine Table je Panel** (Empfehlung aus 001, E4): beim Tab-Wechsel Zeilen per `setRows` tauschen und Spalten,
   Sortierung, Scroll über `getState/applyState(['columns','sort','scroll'])` je Tab sichern/wiederherstellen. Prüfen
   und im Design begründen (Alternative: eine Table je Tab).
6. **Pfad-Header**: Breadcrumb aus `DirectoryListing.segments` (rechtsbündig bei Überlänge), Segment-Klick navigiert,
   Favoriten-Stern schaltet um (Speicherung im Sitzungszustand; das Menü dazu kommt in 003).
7. **Statuszeile** im Zielformat aus `docs/ui-layout.md` (markierte Größe/Anzahl gegen Gesamt, ohne `..`), aktive Seite
   hervorgehoben. Ordnergrößen erst ab 003 (Leertaste/Job), bis dahin zählen nur Dateien.
8. **Button-Leiste (Gerüst)**: fünf Funktions-Buttons in der Reihenfolge aus `docs/ui-layout.md` mit Badge-Platz, rechts
   Platzhalter für Actions ▴, Tasks, 🎨, ⌨. Klick löst – sofern schon vorhanden – die Aktion aus, sonst gedimmt mit
   Tooltip „kommt in Prompt …“. Konfigurationsformat der Buttons (je Modifier-Satz) schon jetzt als JSON-Datei anlegen,
   damit 002 nur noch die Umschaltung baut.
9. **Sitzungszustand** automatisch speichern (entprellt + beim Schließen) in eine Datei im App-Config-Verzeichnis
   (Rust schreibt atomar: temp + rename; Schema mit `version`; Müll → Defaults + Warnung, Rust-Test). Inhalt: Tabs
   beider Seiten inkl. aktiver Tab, aktive Seite, Splitter, Favoriten, Fenstergröße/-position (Tauri-Fenster-API oder
   `tauri-plugin-window-state` – Abhängigkeit begründen).
10. **Start**: gespeicherte Tabs laden; nicht mehr vorhandene Pfade → nächster existierender Elternordner + Hinweis.
    Ohne Zustand: links und rechts Home.

## Entscheidungsfragen

- Cursor im inaktiven Panel: ausblenden (alt) oder gedämpft (heute)?
- Eine Table je Panel (Zustand je Tab gesichert) oder je Tab?
- Speicherort/Format des Sitzungszustands (eigene JSON-Datei vs. `tauri-plugin-store`).
- Kürzel für Tab-Wechsel (alt: `Shift+Tab` = nächster Tab; WebView-Konflikte von `Strg+Tab` prüfen) – Abstimmung mit 002.

## Akzeptanzkriterien

- Fenster entspricht `docs/ui-layout.md` (Zeilen 1–4 je Seite, Splitter für alle Zeilen, Button-Leiste); Screenshot im
  Bericht neben dem alten Screenshot.
- Klick/`Tab` wechselt die aktive Seite; Quelle/Ziel stimmen; aktive Seite für Screenreader angesagt.
- Tabs anlegen, klonen, schließen, verschieben/klonen ins andere Panel, umsortieren; jeder Tab behält Pfad, Sortierung,
  Spaltenbreiten, Cursor und Scrollposition.
- Nach Neustart: Tabs, aktive Seite, Splitter, Favoriten und Fenstergröße wie vorher; gelöschter Pfad → Elternordner
  mit Hinweis; kaputte Zustandsdatei → Defaults + Warnung.
- Statuszeile stimmt (Test mit bekannten Größen).
