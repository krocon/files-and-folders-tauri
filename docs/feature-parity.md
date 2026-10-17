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
| Kopieren / Verschieben (in Queues) | 005/006 | 🟡 | Rust `jobs/tests_engine.rs`, `job-actions.spec.ts`, E2E | Kopieren als Job mit Byte-Fortschritt, Pause, Abbruch, **Konfliktabfrage** (alt: überschrieb still), Fehlerliste (alt: Queue stoppte); F5 vorerst mit einfacher Rückfrage, Kopierdialog und Verschieben in 006 |
| Ordner erstellen, Multi-Mkdir | 3 | ⬜ | | |
| Löschen, leere Ordner rekursiv löschen | 3 | ⬜ | | |
| Umbenennen, Multi-Rename (Muster/Makros) | 3/8 | ⬜ | | AI-Rename von -mr: offen, ggf. ✖ |
| Group Files (nach Namensmuster in Ordner) | 8+ | ⬜ | | |
| Suche (Find) | 4 | ⬜ | | |
| Change-Dir-Baumdialog, „Go to anything“ | 002/003 | 🟡 | `command-palette.spec.ts` | Befehlspalette mit allen Aktionen (unscharfe Suche, Kürzel); Ordner aus Verlauf/Favoriten in 003, Baumdialog offen |
| Bookmarks | 004/003 | ✅ | `file-panel.spec.ts` | Favoriten-Stern + Menü ▾ (Home, Favoriten, zuletzt) |
| Namen/Pfade in Zwischenablage (Text/JSON) | 5 | ⬜ | | |
| Externe Tools / App-Launcher, „Terminal hier“ | 7 | ⬜ | | nur über schmale, konfigurierte Commands |
| Integriertes Terminal (xterm, -mr) | – | ⬜ | | Sicherheitsabwägung nötig |
| Viewer / Editor | 6 | ⬜ | | |
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
