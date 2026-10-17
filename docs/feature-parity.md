# Feature-Parität mit `files-and-folders`

Vorläufige Inventur (Phase 0). Wird in Phase 11 systematisch vervollständigt; „kompatibel“ gilt erst,
wenn Implementierung **und** Tests vorliegen.

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
| Verzeichnis anzeigen, navigieren | 1 | ✅ | Rust + Angular | |
| Hidden-Dateien umschalten | 2 | 🟡 | Rust (Flag) | Flag wird geliefert und gedimmt angezeigt, Toggle fehlt |
| Sortierung („smart sorting“) | 2 | 🟡 | Rust | nur fest: Ordner zuerst, Name |
| Verzeichnis-Historie | 2 | ⬜ | | |
| Filter nach Name/Endung/Art | 4 | ⬜ | | |
| Dual-Panel | 5 | ⬜ | | Store ist bereits pro Panel |
| Tabs, Tab-Presets | 5 | ⬜ | | |
| Kopieren / Verschieben (in Queues) | 3 | ⬜ | | |
| Ordner erstellen, Multi-Mkdir | 3 | ⬜ | | |
| Löschen, leere Ordner rekursiv löschen | 3 | ⬜ | | |
| Umbenennen, Multi-Rename (Muster/Makros) | 3/8 | ⬜ | | AI-Rename von -mr: offen, ggf. ✖ |
| Group Files (nach Namensmuster in Ordner) | 8+ | ⬜ | | |
| Suche (Find) | 4 | ⬜ | | |
| Change-Dir-Baumdialog, „Go to anything“ | 5 | ⬜ | | |
| Bookmarks | 5 | ⬜ | | |
| Namen/Pfade in Zwischenablage (Text/JSON) | 5 | ⬜ | | |
| Externe Tools / App-Launcher, „Terminal hier“ | 7 | ⬜ | | nur über schmale, konfigurierte Commands |
| Integriertes Terminal (xterm, -mr) | – | ⬜ | | Sicherheitsabwägung nötig |
| Viewer / Editor | 6 | ⬜ | | |
| Pack/Unpack (ZIP, TAR, 7z) | 8+ | ⬜ | | |
| Duplikate finden, Dateiattribute (-mr) | 6+ | ⬜ | | |
| Farbschemata (Light/Dark/…) | 1/8 | 🟡 | – | Light/Dark via Tokens; weitere Themes offen |
| Tastaturkürzel pro OS, konfigurierbar | 5/8 | 🟡 | Angular | Basis-Navigation fest verdrahtet |
| Auth-Modul | – | ✖ | | Desktop-App, nicht nötig |
| Docker-/Web-Betrieb | – | ✖ | | Desktop-only |
