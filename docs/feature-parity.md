# Feature-Parität mit `files-and-folders`

Vorläufige Inventur (Phase 0). Die detaillierte Analyse des alten Codes steht in
[legacy-analysis.md](legacy-analysis.md); Prompt 018 baut diese Matrix daraus vollständig neu auf.
„Kompatibel“ gilt erst, wenn Implementierung **und** Tests vorliegen.

## Quellen

| Projekt | Art | Stack | Lizenz |
| --- | --- | --- | --- |
| npm `files-and-folders` 0.0.14 (2017) | Launcher-Paket für Client/Server | Node, hängt von `files-and-folders-client`/`-server` ab | MIT (package.json) |
| `krocon/node-files-and-folders` | App (Client/Server), Quelle des npm-Pakets | Node + AngularJS 1.x, WebSockets | MIT (package.json, keine LICENSE-Datei gefunden) |
| `krocon/files-and-folders` (2022) | App (Browser-UI + Node-API, Docker) | Nx, Angular 13, NestJS, ag-grid | „ISC“ in package.json, keine LICENSE-Datei |
| `krocon/files-and-folders-mr` (2026) | App (Web + Electron) | Angular 20, NestJS 10, Electron 30 | Custom Source-Available License – **kein Code übernehmen** |

Das npm-Paket bietet **keine** programmatische Bibliotheks-API im engeren Sinn, sondern startet eine
Client/Server-App. Parität wird daher **funktional** (Bedienung/Features) angestrebt, nicht als
API-Kompatibilität. Die WebSocket-/REST-Schnittstellen der Referenzen werden bewusst **nicht**
nachgebildet – hier ersetzt Tauri-IPC sie.

## Matrix

Status: ✅ umgesetzt+getestet · 🟡 teilweise · ⬜ offen · ✖ bewusst abweichend

| Referenzfunktion (dokumentiert in README von node-files-and-folders / -mr) | Phase | Status | Tests | Anmerkung |
| --- | --- | --- | --- | --- |
| Verzeichnis anzeigen, navigieren | 1/001 | ✅ | Rust + Angular | GuiExpert Table |
| Markieren: Einfg/Leertaste, Shift, Strg/⌘+Klick, alles/nichts, Num+/−/*, Muster | 001/002 | ✅ | `file-list-controller.spec.ts`, `pattern.spec.ts`, `dialogs.spec.ts` | Markierung per Pfad, übersteht Sortieren; Muster mit Wildcards **und** Regex, Vorlagen; `Shift+Bild↑/↓` offen |
| Markierte Zeilen rot mit Häkchen | 001 | ✅ | `file-renderers.spec.ts` | wie in der alten Version |
| Hidden-Dateien umschalten | 003 | ✅ | `navigation.spec.ts`, `file-panel.spec.ts` | 👁 und `Strg+H`/`⌘⇧.`, je Tab gespeichert (alt: keine Hidden-Behandlung) |
| Sortierung („smart sorting“) | 001 | ✅ | `file-columns.spec.ts` | Spaltenkopf (Doppelklick), Ordner oben in beiden Richtungen, natürlich statt `localeCompare` (bewusst besser) |
| Verzeichnis-Historie | 003 | ✅ | `navigation.spec.ts` | Zurück/Vor je Tab mit Cursor und Scroll, Maustasten 4/5; Cursor + Markierung je Ordner gemerkt; „zuletzt besucht“ (20) im Menü ▾ |
| Filter nach Name/Endung/Art | 003 | ✅ | `navigation.spec.ts` | Schnellfilter je Tab (Wildcards, `|`, `-ausschließen`), bleibt sichtbar (alt: verschwand nach 6,7 s); Typ-Ahead |
| Dual-Panel | 004 | ✅ | `workspace.store.spec.ts`, `file-panel.spec.ts`, E2E (Xvfb) | gemeinsamer Splitter (Maus/Tastatur/Doppelklick), aktive Seite = Quelle, `Tab` wechselt; Splitter-Position wird gespeichert (alt: nicht) |
| Tabs, Tab-Presets | 004 | 🟡 | `workspace.store.spec.ts`, `tab-bar.spec.ts`, E2E | Tabs je Seite mit Kontextmenü (alt/mr vollständig), Zustand je Tab und Neustart; Presets offen. Abweichung: `Shift+Tab` = Fokus rückwärts statt nächster Tab (Barrierefreiheit), nächster Tab `Strg+Tab` |
| Kopieren / Verschieben (in Queues) | 005/006 | ✅ | Rust `jobs/tests_engine.rs`, `jobs/tests_ops.rs`, `ops/ops.spec.ts`, `ops/dialogs.spec.ts`, E2E (Linux) | Dialog mit Live-Zählung, Zielvorschlägen (Tabs, Favoriten, zuletzt), Kopie unter neuem Namen, Konfliktvorgabe; **Konfliktabfrage** (alt: überschrieb still), Fehlerliste (alt: Queue stoppte); Verschieben über Laufwerke kopiert und löscht je Datei erst danach |
| Ordner erstellen, Multi-Mkdir | 006/008 | ✅ | Rust `fileops.rs` (`create_folders_never_touches_existing_entries`), `ops-logic.spec.ts`, `mkdir-engine.spec.ts`, `tools.spec.ts`, E2E | Ordner (auch `a/b/c`) mit Serien-Vorschlag (mr) und Datei anlegen ✅; Multi-MkDir (mr, `Strg+F7`): Vorlage mit `[C]` (Start/Ende/Schritt/Stellen), `[L]`, `[P]` `[Q]` `[R]`, Schreibweise, Vorschau; vorhandene Namen werden nie angefasst (Fehler je Name, Dialog bleibt offen) |
| Löschen, leere Ordner rekursiv löschen | 006/008 | ✅ | Rust `jobs/tests_ops.rs` (inkl. Papierkorb unter Linux), `clean.rs`, `jobs/tests_tools.rs`; `tools.spec.ts`, `tools-dialogs.spec.ts`, E2E | **Papierkorb** als Standard (alt: endgültig), endgültig mit Shift, schreibgeschützt fragt, Wurzel/Home/System nur mit zweiter Bestätigung. **Clean Folders** (008, `Strg+Alt+R`): Vorschau, Papierkorb (Default), leere Ordner + optional Systemmüll (`.DS_Store`, `Thumbs.db`, `desktop.ini`, editierbar) + optional Namensmuster (mr `**/*.bak` → `*.bak`). **Behoben:** löschte Ordner oberhalb des Startordners – jetzt strukturell ausgeschlossen (Rust-Test), Startordner nur auf Wunsch, Links nie verfolgt. Abweichung: verschachtelte leere Ordner = mehrere Papierkorb-Einträge; Suche ohne Fortschritt/Abbruch (Grenze 500 000) |
| Umbenennen, Multi-Rename (Muster/Makros) | 006/007 | ✅ | Rust `fileops.rs`, `jobs/rename.rs`, `tests_ops.rs`; `rename-engine.cases.json`, `multirename.spec.ts`, E2E | Umbenennen per Dialog und **F2 in der Liste** ✅. Multi-Rename (007): alle Muster, Bereiche, Zähler, Schreibweisen, Optionen, 4 Ersetzungszeilen mit Regex/„nur wenn“, 5 Makros (legacy + mr, auf den Namensteil umgeschrieben), `[Q]` `[R]` `[D]` `[T]`, Vorlagen + „zuletzt“, Prüfung gegen die Platte, Tausch/Ketten, Rückgängig. Behoben: `README` → `.README`, Ordner zerlegt, Zähler-Schritt 50 = 30, `$&` im Namen, Absturz bei ungültigem Regex. Abweichungen: Ersetzen ohne Regex ersetzt **alle** Vorkommen, kein `,,`-Kollaps, Umlaute `Ä → Ae` (alt `AE`), Vorschau nach Nr. sortiert (+ Filter), ≥ 1 Eintrag. Offen: KI-Modus (mr) ✖ bis nach 015; Undo nicht über einen Neustart |
| Group Files (nach Namensmuster in Ordner) | 008 | 🟡 | `group-engine.cases.json` (41 Fälle), `tools.spec.ts`, Rust `jobs/tests_tools.rs`, E2E | Alle 10 legacy-Modi mit Vorschau-Tabelle, Klammern ignorieren, Mindestgröße, Quellordner als Wurzel, Gruppenzahl; Kopieren/Verschieben als ein Job mit Konfliktdialog (005). Neu: Unicode-Wörter/-Ziffern, geprüfte Gruppennamen, Mindestgröße für alle Modi außer „Neuer Ordner“, ohne Markierung alle angezeigten Einträge. Offen: mr `ebook_mode`, KI-Strategie, Undo |
| Suche (Find) | 009 | ✅ | Rust `search.rs` (Glob/Regex/Text, Typen, Größe, Datum, Inhalt über Blockgrenzen, **Symlink-Zyklus**, unlesbare Ordner, `maxHits`, Abbruch; 200 000 Dateien `--ignored`), `jobs/tests_tools.rs` (Bündelung ≤ 500, Abbruch < 200 ms); `find-form.spec.ts`, `search.store.spec.ts`, E2E (Linux) | Rust-Job `search` mit gebündelten Treffern, **abbrechbar** (alt: kein Abbruch), Links nur auf Wunsch und zyklensicher (alt: Zyklen möglich), Glob **und** Regex/Text mit Groß/klein (alt: nur JS-Regex, case-sensitiv), Typ/Größe/Datum/Tiefe/Ausschlüsse/Inhalt (neu), mr-Vorlagen `[{label, extensions}]` + eigene/letzte (nur Sitzung), „nur Ordner“ liefert Ordner (mr-Fehler behoben). **Ergebnis-Tab** mit Spalte Folder, Kopieren/Verschieben/Löschen, „Zur Datei“ (neuer Tab), erneut suchen; nicht in der Sitzung gespeichert. Offen: Laufwerke als Suchort (011), dauerhafte Vorlagen (015), F2/Werkzeuge im Ergebnis-Tab |
| Change-Dir-Baumdialog, „Go to anything“ | 002/003/009 | ✅ | `command-palette.spec.ts`, `folder-finder-logic.spec.ts`, E2E | Befehlspalette mit allen Aktionen (unscharfe Suche, Kürzel); Ordner aus Verlauf/Favoriten in 003. **Ordner-Finder** (009, `Alt+F10`): Unterordner bis Tiefe 1–10/∞ (mr: Regler bis 5), unscharfer Live-Filter (Name vor Pfad), Enter wechselt, Abbruch beim Schließen. Abweichung: flache Liste statt Baum |
| Bookmarks | 004/003 | ✅ | `file-panel.spec.ts` | Favoriten-Stern + Menü ▾ (Home, Favoriten, zuletzt) |
| Namen/Pfade in Zwischenablage (Text/JSON) | 011 | ✅ | `clipboard.spec.ts`, `os.spec.ts`, E2E (Linux) | `Strg/⌘+Alt+N` Namen, `Strg/⌘+Alt+C` Pfade, JSON über Palette/Menü; **eine Zeile je Eintrag** (alt: Tab-getrennt), **Ordner dabei** (alt: nur Dateien), Reihenfolge der Anzeige; Webview-Zwischenablage ohne Plugin. Echte Datei-Zwischenablage (im Finder/Explorer einfügen) offen |
| Externe Tools / App-Launcher, „Terminal hier“ | 011 | ✅ | Rust `tools.rs` (inkl. Injection-Test), `platform/desktop.rs`, `os.spec.ts`, E2E (Linux) | `tools.json` (Programm + Argument-Array, Platzhalter `{file}` `{files}` `{name}` `{dir}` `{targetDir}` je Argument, `perFile`, `fileLimit`), mr-Format beim Laden umgestellt, Tools in Palette/Actions-Menü/eigenem Kürzel, `Strg/⌘+Shift+X` „Mit Tool öffnen“, F4 = Tool `edit`. **Keine Shell** (alt: String-Verkettung + `exec`). Terminal hier `Strg/⌘+Shift+C`, im Dateimanager zeigen `Strg/⌘+Shift+F`; macOS/Windows nicht E2E-geprüft |
| Laufwerke / Startpunkte | 011 | ✅ | Rust `platform/volumes.rs`, `os.spec.ts`, E2E (Linux) | Gruppe „Drives“ im Ordnermenü (`Alt+F1`/`Alt+F2`): Linux Mountpoints ohne Pseudo-FS (alt: `/dev/*`), macOS `/Volumes`, Windows Laufwerksbuchstaben mit Label/frei/gesamt; tote Netzlaufwerke nach 1,5 s „not reachable“ ohne UI-Blockade |
| „Öffnen mit …“ (App-Auswahl des Systems) | 011 | 🟡 | | Standard-App (003) und „Mit Tool öffnen“; System-Dialog je OS offen |
| Integriertes Terminal (xterm, -mr) | – | ⬜ | | Sicherheitsentscheidung in Design 011 E7: nur ausdrückliche Eingabe, später PTY (`portable-pty`); `TOGGLE_SHELL` noch ohne Handler |
| Viewer / Editor | 010 | 🟡 | Rust `preview/` (`encoding.rs`, `detect.rs`, `mod.rs`: 2-GB-Datei, Kodierungen, `bild.txt`, FIFO), `commands::tests::preview_scheme_serves_only_valid_tokens`; `preview.spec.ts`, `preview-logic.spec.ts`, E2E | **Neu** (alt: nur „Edit“ mit Sublime, keine Ansicht): Ansicht F3 als Overlay (Text mit Zeilennummern, Suche, Umbruch, Kodierung, Hex, Bild mit Zoom, ←/→ durch das Panel), Schnellvorschau Strg+Q, Typ am Inhalt. F4 = Tool `edit` (011, Default Standard-App). Offen: eingebauter Editor (mr Monaco), PDF/Markdown/Audio/Video-Provider, weitere Kodierungen |
| Eigenschaften / Attribute | 010 | 🟡 | Rust `properties.rs`; `preview.spec.ts` (Zeilen je Plattform), E2E | Anzeige: Typ, Größe (Ordner als Job), Zeiten, Unix `rwx` + Eigentümer, Windows R/H/S/A, Link-Ziel. Offen: Ändern von Rechten/Attributen/Datum (mr Attribute-Dialog) |
| Pack/Unpack (ZIP, TAR, 7z) | 8+ | ⬜ | | |
| Duplikate finden, Dateiattribute (-mr) | 6+ | ⬜ | | |
| Farbschemata (Light/Dark/…) | 1/8 | 🟡 | – | Light/Dark via Tokens; weitere Themes offen |
| Tastaturkürzel pro OS, konfigurierbar | 002 | ✅ | `keymap.spec.ts`, `shortcut.spec.ts`, `keyboard-dispatcher.spec.ts`, Rust `keymap.rs` | macOS/Windows/**Linux** (alt: fehlte), kanonische Notation (mr-Matching-Fehler behoben), Override je Aktion gemischt (mr: ersetzte alles), Editor mit Tastenaufnahme |
| Sitzung wiederherstellen (Tabs, aktive Seite, Fenster) | 004 | ✅ | Rust `session.rs`, E2E | alt: localStorage; jetzt Datei, gelöschter Ordner → Elternordner mit Hinweis, kaputte Datei → Defaults + Warnung |
| Button-Leiste mit Modifier-Sätzen, Actions-Menü | 002 | ✅ | `button-bar.spec.ts` | Sätze default/Shift/⌘ bzw. Strg/Alt, Badge ohne gehaltene Modifier, Freigaben; Actions-Menü in 4 Spalten |
| „..“-Zeile, Ordnergröße, Datei öffnen | 003 | ✅ | `navigation.spec.ts`, Rust `dirsize.rs`/`opener.rs` | „..“ nie markiert/gezählt; Größe als abbrechbarer Job ohne Symlinks; Standard-App mit Rückfrage bei Programmen (alt: Linux nur PDF) |
| Job-Warteschlange (Tasks) | 005 | ✅ | `jobs.store.spec.ts`, `dialogs.spec.ts` (jobs) | seriell + Hintergrund, Pause/Weiter/Abbruch, Fehlerliste, „Erledigte entfernen“; Rückfrage beim Beenden |
| Auth-Modul | – | ✖ | | Desktop-App, nicht nötig |
| Docker-/Web-Betrieb | – | ✖ | | Desktop-only |
