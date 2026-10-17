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
| Markieren: Einfg/Leertaste, Shift, Strg/⌘+Klick, alles/nichts | 001 | ✅ | `file-list-controller.spec.ts` | Markierung per Pfad, übersteht Sortieren; Num+/−/* und Muster in 002 |
| Markierte Zeilen rot mit Häkchen | 001 | ✅ | `file-renderers.spec.ts` | wie in der alten Version |
| Hidden-Dateien umschalten | 2 | 🟡 | Rust (Flag) | Flag wird geliefert und gedimmt angezeigt, Toggle fehlt |
| Sortierung („smart sorting“) | 001 | ✅ | `file-columns.spec.ts` | Spaltenkopf (Doppelklick), Ordner oben in beiden Richtungen, natürlich statt `localeCompare` (bewusst besser) |
| Verzeichnis-Historie | 003 | 🟡 | `workspace.store.spec.ts` | Verlauf je Tab wird seit 004 geführt und gespeichert (max. 15); Bedienung in 003 |
| Filter nach Name/Endung/Art | 4 | ⬜ | | |
| Dual-Panel | 004 | ✅ | `workspace.store.spec.ts`, `file-panel.spec.ts`, E2E (Xvfb) | gemeinsamer Splitter (Maus/Tastatur/Doppelklick), aktive Seite = Quelle, `Tab` wechselt; Splitter-Position wird gespeichert (alt: nicht) |
| Tabs, Tab-Presets | 004 | 🟡 | `workspace.store.spec.ts`, `tab-bar.spec.ts`, E2E | Tabs je Seite mit Kontextmenü (alt/mr vollständig), Zustand je Tab und Neustart; Presets offen. Abweichung: `Shift+Tab` = Fokus rückwärts statt nächster Tab (Barrierefreiheit), nächster Tab `Strg+Tab` |
| Kopieren / Verschieben (in Queues) | 3 | ⬜ | | |
| Ordner erstellen, Multi-Mkdir | 3 | ⬜ | | |
| Löschen, leere Ordner rekursiv löschen | 3 | ⬜ | | |
| Umbenennen, Multi-Rename (Muster/Makros) | 3/8 | ⬜ | | AI-Rename von -mr: offen, ggf. ✖ |
| Group Files (nach Namensmuster in Ordner) | 8+ | ⬜ | | |
| Suche (Find) | 4 | ⬜ | | |
| Change-Dir-Baumdialog, „Go to anything“ | 5 | ⬜ | | |
| Bookmarks | 004/003 | 🟡 | `file-panel.spec.ts` | Favoriten-Stern im Pfad-Header, gespeichert; Menü in 003 |
| Namen/Pfade in Zwischenablage (Text/JSON) | 5 | ⬜ | | |
| Externe Tools / App-Launcher, „Terminal hier“ | 7 | ⬜ | | nur über schmale, konfigurierte Commands |
| Integriertes Terminal (xterm, -mr) | – | ⬜ | | Sicherheitsabwägung nötig |
| Viewer / Editor | 6 | ⬜ | | |
| Pack/Unpack (ZIP, TAR, 7z) | 8+ | ⬜ | | |
| Duplikate finden, Dateiattribute (-mr) | 6+ | ⬜ | | |
| Farbschemata (Light/Dark/…) | 1/8 | 🟡 | – | Light/Dark via Tokens; weitere Themes offen |
| Tastaturkürzel pro OS, konfigurierbar | 5/8 | 🟡 | Angular | Basis-Navigation fest verdrahtet |
| Sitzung wiederherstellen (Tabs, aktive Seite, Fenster) | 004 | ✅ | Rust `session.rs`, E2E | alt: localStorage; jetzt Datei, gelöschter Ordner → Elternordner mit Hinweis, kaputte Datei → Defaults + Warnung |
| Button-Leiste mit Modifier-Sätzen | 004/002 | 🟡 | `button-config.spec.ts` | Gerüst und `buttons.json`; Umschaltung und Aktionen in 002 |
| Auth-Modul | – | ✖ | | Desktop-App, nicht nötig |
| Docker-/Web-Betrieb | – | ✖ | | Desktop-only |
