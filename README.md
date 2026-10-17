# Files and Folders (Tauri)

Plattformübergreifender Dateimanager für macOS, Windows und Linux in Richtung Total Commander –
gebaut mit **Tauri 2**, **Angular 22** (Signals, zoneless), **TypeScript**, **SCSS** und einem
**Rust**-Backend.

> **Status: Phase 1 (MVP / Walking Skeleton).** Die App listet Verzeichnisse über Rust, zeigt sie
> in Angular an und erlaubt Navigation in Unterordner und nach oben. Dateien werden nur angezeigt
> und ausgewählt – es gibt noch **keine** Dateioperationen. Siehe [docs/roadmap.md](docs/roadmap.md) und [prompts/README.md](prompts/README.md).

## Was funktioniert (Phase 1)

- Start im Home-Ordner des aktuellen Benutzers (über Tauris `path().home_dir()`).
- Rust-Command `list_directory(path: Option<String>)` liefert Name, Pfad, Typ (Datei/Ordner/Symlink
  inkl. Ziel-Typ), Größe, Änderungszeit und Hidden-Kennzeichen (Dot-Files sowie natives
  Hidden-Flag unter Windows/macOS).
- Tabelle mit Ordnern zuerst, Sortierung nach Name (case-insensitive).
- Ordner/Symlinks auf Ordner öffnen per Doppelklick oder `Enter`; nach oben per „Up“-Button oder
  `Backspace` (der Herkunftsordner wird wieder ausgewählt).
- Tastatur: `↑`/`↓`, `PageUp`/`PageDown`, `Home`/`End`, `Enter`, `Backspace`.
- Lade-, Leer- und Fehlerzustände (z. B. „Access denied“) ohne Absturz; die vorherige Ansicht
  bleibt bei Fehlern erhalten.
- Unicode, Umlaute, Leerzeichen; Pfadlogik ausschließlich über `std::path`.
- Helles/dunkles Farbschema über CSS Custom Properties (`prefers-color-scheme`).

## Voraussetzungen

| Werkzeug | Version                                                                                   |
| -------- | ----------------------------------------------------------------------------------------- |
| Node.js  | `^22.22.3`, `^24.15.0` oder `>=26` (Vorgabe von Angular 22)                              |
| pnpm     | 10.x (siehe `packageManager` in `package.json`; z. B. `corepack enable`)                  |
| Rust     | stable ≥ 1.90 (`rustup`)                                                                  |
| System   | [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/) je Betriebssystem      |

- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Microsoft C++ Build Tools und WebView2 (bei Windows 10/11 meist vorhanden).
- **Linux (Debian/Ubuntu):**
  `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## Installation und Start

```bash
pnpm install
pnpm tauri dev        # startet Angular-Dev-Server (Port 1420) + Desktop-App
```

`pnpm start` allein startet nur das Frontend im Browser; dort gibt es kein Backend, und die App
zeigt den Hinweis „The desktop backend is not available“.

## Checks

```bash
pnpm format:check     # Prettier
pnpm lint             # ESLint (angular-eslint)
pnpm test             # Angular-Unit-Tests (Vitest, jsdom)
pnpm build            # Production-Build des Frontends
pnpm rust:fmt         # cargo fmt --check
pnpm rust:lint        # cargo clippy -D warnings
pnpm rust:test        # cargo test
pnpm check            # alles oben nacheinander
```

Release-Build: `pnpm tauri build` (Bundles in `src-tauri/target/release/bundle/`). Signierung und
Notarisierung sind noch nicht eingerichtet.

## Projektstruktur

```
src/                       Angular-Frontend
  app/core/fs/             DTO-Typen, Fehler-Mapping, FsApi (einziger Ort mit invoke())
  app/features/browser/    FileBrowserStore (Signals), FileBrowser, FileTable
  app/shared/              Formatierung (Größe, Datum)
  styles.scss              Design-Tokens (CSS Custom Properties)
src-tauri/                 Rust-Backend (Tauri 2)
  src/commands.rs          Tauri-Commands (dünne Schicht)
  src/listing.rs           Verzeichnis-Listing (rein std, getestet)
  src/paths.rs             Pfadvalidierung, Eltern-/Breadcrumb-Logik
  src/model.rs, error.rs   DTOs und strukturierte Fehler
docs/                      Architektur, Roadmap, Feature-Parität, Analyse des alten Codes
prompts/                   Feature-Prompts für die nächsten Ausbaustufen (Index: prompts/README.md)
CLAUDE.md                  Leitfaden für die Arbeit am Repo (Regeln, Befehle, GuiExpert Table)
```

## Referenzen und Lizenzen

Fachliche Referenzen (nur Funktionsumfang, kein übernommener Code):

- npm [`files-and-folders`](https://www.npmjs.com/package/files-and-folders) – MIT (laut package.json)
- [krocon/node-files-and-folders](https://github.com/krocon/node-files-and-folders) – MIT (laut package.json)
- [krocon/files-and-folders](https://github.com/krocon/files-and-folders) – „ISC“ in package.json, keine LICENSE-Datei
- [krocon/files-and-folders-mr](https://github.com/krocon/files-and-folders-mr) – Custom Source-Available License (CSAL) v1.0; **kein Code übernehmen**, nur als Funktionsreferenz

Die Lizenz dieses Projekts ist noch nicht festgelegt (`license` in `Cargo.toml`/`package.json` leer).
