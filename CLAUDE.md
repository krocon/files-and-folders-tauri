# CLAUDE.md – Files and Folders (Tauri)

> Leitfaden für Claude (und Menschen) zur Arbeit an **Files and Folders**: einem plattformübergreifenden
> Dateimanager für macOS, Windows und Linux in Richtung Total Commander.
> Autor: Marc Kronberg · Repo: https://github.com/krocon/files-and-folders-tauri
>
> Neuauflage der älteren Projekte `node-files-and-folders-client` (AngularJS) und `node-files-and-folders-server`
> (Node, WebSockets) als **Desktop-App**: Tauri 2 + Angular 22 + Rust. Die Dateiliste ist eine
> **GuiExpert Table** (`@guiexpert/table`, Quellcode im Mono-Repo `guiexperttable/mono`, gleicher Autor).

---

## 1. Stand

- Phase 1 (Walking Skeleton) ist fertig: Rust listet Verzeichnisse, Angular zeigt sie an, Navigation in Unterordner
  und nach oben, Tastatur, Fehlerzustände. Details: `docs/roadmap.md`.
- Weiterentwicklung über **Feature-Prompts** in `prompts/` (Index und Reihenfolge: `prompts/README.md`, gemeinsame
  Regeln: `prompts/000-arbeitsweise.md`). Fachliche Grundlage: `docs/legacy-analysis.md` (Analyse des alten Codes).

## 2. Befehle (Root, pnpm 10 via `packageManager`, Node ≥ 22.22.3, Rust stable ≥ 1.90)

| Zweck | Befehl |
|---|---|
| Install | `pnpm install` |
| App starten (Dev) | `pnpm tauri dev` (Angular-Dev-Server auf Port 1420 + Fenster) |
| Nur Frontend im Browser | `pnpm start` (kein Backend → Hinweis „desktop backend is not available“) |
| Frontend-Tests | `pnpm test` (Vitest + jsdom, über `ng test`), `pnpm test:watch` |
| Lint / Format | `pnpm lint`, `pnpm format`, `pnpm format:check` |
| Frontend-Build | `pnpm build` |
| Rust | `pnpm rust:fmt`, `pnpm rust:lint` (clippy `-D warnings`), `pnpm rust:test` |
| Alles prüfen | `pnpm check` |
| Release-Build | `pnpm tauri build` (Signierung/Notarisierung noch nicht eingerichtet) |

Nicht ausführbare Checks im Abschlussbericht mit Grund nennen. `pnpm tauri dev` braucht ein Fenster – in einer
Container-Sitzung ohne Display: `pnpm tauri build --debug --no-bundle` und die Binary unter `Xvfb` starten
(Screenshot mit `import -window root`, Tasten mit `xdotool`). So wurde Phase 1 verifiziert.

## 3. Layout

```
src/                         Angular 22 (zoneless, Signals, OnPush, Standalone)
  app/core/fs/               DTOs (fs.models.ts), Fehler-Mapping (fs-error.ts), FsApi = einzige invoke()-Stelle
  app/features/browser/      FileBrowserStore (Zustand je Panel), FileBrowser, FileTable (wird durch GuiExpert ersetzt)
  app/shared/                Formatierung (Größe, Datum)
  testing/                   Fixtures, FakeFsApi (nie im Produktivcode importieren)
  styles.scss                Design-Tokens (CSS Custom Properties, light/dark)
src-tauri/                   Rust (Tauri 2)
  src/commands.rs            dünne Command-Schicht (validieren, Default auflösen, spawn_blocking)
  src/listing.rs, paths.rs   reine std-Logik, unit-getestet, ohne Tauri
  src/model.rs, error.rs     DTOs (serde camelCase) und FsError { code, message, path }
  capabilities/default.json  nur core:default
docs/                        architecture.md, roadmap.md, feature-parity.md, legacy-analysis.md
prompts/                     Feature-Prompts (s. o.)
```

## 4. Architekturregeln (verbindlich)

- **Frontend ruft das Backend nur über typisierte Fassaden** (`FsApi` und künftige `*Api`-Klassen in `app/core/`).
  Komponenten rufen nie `invoke()` direkt. Tests ersetzen die Fassade (`FakeFsApi`).
- **DTO-Vertrag**: Rust `model.rs` ↔ TS `fs.models.ts` von Hand synchron; jede Änderung auf beiden Seiten + Test.
  Fehler immer als `FsError { code: snake_case, message, path }`; neue Codes in beiden Dateien und in
  `describeFsError()`.
- **Pfade sind opake Strings** aus dem Backend. Kein Split/Join mit `/` oder `\` im Frontend; Eltern, Segmente,
  Zielpfade rechnet Rust (`std::path`). Kein `canonicalize` für Navigation (Symlinks, `\\?\`-Präfix unter Windows).
- **Zustand je Panel**: Stores sind `@Injectable()` ohne `providedIn: 'root'` und werden im Komponenten-Provider
  erzeugt – Dual-Pane und Tabs brauchen unabhängige Instanzen. Globales (Einstellungen, Job-Queue, Keymap) in
  Root-Services.
- **Veraltete Antworten verwerfen** (Request-Sequenz wie in `FileBrowserStore.load`), bei Listing, Suche, Vorschau.
- **Blockierende I/O nie auf dem Async-Runtime-Thread**: `tauri::async_runtime::spawn_blocking` oder eigene Worker.
  Lange Operationen (Kopieren, Suche) als Job mit Fortschritt über `tauri::ipc::Channel` und Abbruch-Token.
- **Destruktive Operationen** (Löschen, Überschreiben, Verschieben) werden im Rust-Backend validiert und getestet
  (tempfile), nie nur im Frontend. Standard beim Löschen ist der Papierkorb.
- **Sicherheit**: keine Tauri-Plugins mit breitem Dateisystem- oder Shell-Zugriff; jede Fähigkeit als schmaler,
  validierter Command. Kein beliebiges Shell-Kommando aus dem Frontend; externe Tools nur aus der Konfiguration mit
  Argument-Arrays (kein String an eine Shell). CSP strikt (Ausnahme `style-src` wegen Angulars Laufzeit-Styles, s.
  `docs/architecture.md`). Keine Dateiinhalte oder vollständigen Nutzerpfade unnötig loggen.
- **Plattformcode** hinter `cfg`-Funktionen bzw. einem Modul `platform/` mit gleicher Signatur je OS.
- **Neue Abhängigkeiten** (npm oder crates) nur mit kurzer Begründung in `docs/architecture.md` (Tabelle
  „Abhängigkeiten“). Keine UI-Frameworks (Material o. ä.); Styling mit SCSS + Tokens.

## 5. GuiExpert Table als Dateiliste

- Pakete: `@guiexpert/table` (Core, 0 Runtime-Deps) + `@guiexpert/angular-table` mit **gleicher Major wie Angular**
  (Angular 22 → `@guiexpert/angular-table@^22.1.99`, Core `^1.1.99`, Stand Okt. 2026). Komponente `TableComponent`,
  Selektor `guiexpert-table`, Inputs `tableModel`, `tableOptions`, `loading`, Outputs u. a. `tableReady` (`TableApi`),
  `mouseClicked` (`GeMouseEvent` mit `clickCount`), `contextmenu`, `selectionChanged`, `focusChanged`.
- **Referenz für jede API-Aussage**: das Mono-Repo. Lokal unter
  `/Users/marckronberg/WebstormProjects/video/2026/guiexpert-table/mono`, sonst
  https://github.com/guiexperttable/mono. Dort: `CLAUDE.md` (§3 Architektur, §3.6 Interaktion, §3.7 Options),
  `instructions.md`, `packages/angular-table/instructions.md`, Quellen `packages/table/src/lib/table/…`.
  Nur APIs verwenden, die dort existieren; Namen nicht raten (z. B. `showCheckboxWihoutExtraColumn` ist absichtlich
  so geschrieben).
- Wichtige Fakten:
  - Host braucht eine **feste Höhe** (Flex-Kind mit `min-height: 0` reicht).
  - Neues `tableModel`/`tableOptions`-Objekt = **Neuaufbau** der Tabelle. Beim Verzeichniswechsel deshalb
    Zeilen tauschen (`tableApi.setRows(rows)` + `repaintHard()`) statt ein neues Modell zu bauen, wenn Spalten und
    Optionen gleich bleiben – so bleiben Spaltenbreiten und Sortierung erhalten.
  - Tastatur: `ShortcutService` verarbeitet nur gemappte Tasten (`shortcutActionIdMapping`, `ActionId`) und stoppt
    dann die Propagation. Nicht gemappte Tasten (z. B. `Insert`, `F5`, `Backspace` ohne Editing-Option) bubbeln zum
    App-Handler. Default-Mapping: `home`/`end` = Zeilenanfang/-ende (Spalten!) – für eine Dateiliste auf
    `NAVIGATE_FIRST_CELL`/`NAVIGATE_LAST_CELL` umbiegen.
  - Cursor (Total Commander) ↔ `FocusModel`; markierte Dateien ↔ `SelectionModel("row", …)`. Vor der Umsetzung im
    Code prüfen (Prompt 001).
  - Filter extern: `externalFilterFunction` + `tableApi.externalFilterChanged()`; Sortierung über `ColumnDef.sortable`
    / `sortComparator` bzw. `tableApi.sort(fn)`.
  - Renderer ohne Angular (`CellRendererIf`) sind schneller als Angular-Komponenten; Daten nie unescaped in
    `innerHTML` (Dateinamen sind Nutzerdaten!).
  - Farben über `--ge-table-*`-Variablen; light/dark über `html[data-theme]` – mit unseren Tokens verbinden.
- **Lücken in der Table** (fehlendes API, Bug): nicht hier umgehen, wenn es sauber nur im Core geht. Stattdessen
  im Mono-Repo nach dessen Regeln lösen (`mono/prompts/000-arbeitsweise.md`, Bugfix = zuerst roter Test) oder als
  Eintrag in `mono/TODO.md` vorschlagen und hier mit `// TODO(guiexpert): …` markieren. Ein lokaler Test gegen
  unveröffentlichte Table-Änderungen: `pnpm add @guiexpert/table@link:<mono>/packages/table/dist`
  (+ Angular-Build `angular-builds/ng22/dist`) – vor dem Commit wieder auf die npm-Version zurückstellen.

## 6. Tests & Verifikation

- **Rust**: Unit-Tests neben dem Code (`#[cfg(test)]`), Dateisystem mit `tempfile`; Unicode, Leerzeichen, Symlinks,
  fehlende Rechte (Achtung: als root greifen Rechte nicht), nicht-UTF-8 (Linux). Plattformspezifisches mit `#[cfg]`.
- **Angular**: Vitest (`*.spec.ts` neben dem Code), Store-Tests mit `FakeFsApi`, Komponenten-Tests für Zustände
  (Laden, leer, Fehler, Tastatur). Die GuiExpert Table rendert in jsdom nur eingeschränkt (kein Layout): Logik in
  Stores/Adaptern testen, Tabellen-Verhalten im echten Fenster prüfen.
- **Ende-zu-Ende**: echte App starten (lokal `pnpm tauri dev`, im Container Xvfb, s. §2) und die Akzeptanzkriterien
  des Prompts durchklicken; Screenshots im Bericht beschreiben.
- Jeder Bugfix bekommt zuerst einen roten Test.

## 7. Git & Zusammenarbeit

- Pro Prompt ein Branch `feat/<slug>` von `main`. **Commits zwischendurch sind erwünscht** (nach jeder grünen
  Phase, Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`), immer mit grünem `pnpm check` bzw.
  begründeter Ausnahme.
- **Kein Push, kein Force-Push, kein `git reset --hard`, keine Releases** ohne ausdrückliche Anweisung. Fremde
  Änderungen nie verwerfen.
- `.github/workflows/` kann aus der Remote-Sitzung nicht geschrieben werden – Workflow-Dateien Marc übergeben.
- README, `docs/architecture.md`, `docs/roadmap.md`, `docs/feature-parity.md` bei relevanten Änderungen mitpflegen.

## 8. Lizenzen & Referenzen

- Eigene Lizenz: noch nicht festgelegt (`license` leer) – nicht eigenmächtig setzen.
- GuiExpert Table: MIT (aktuelle Releases).
- Alte Projekte: `krocon/node-files-and-folders-client`, `krocon/node-files-and-folders-server`, npm
  `files-and-folders` (MIT laut package.json) – fachliche Vorlage, Code wird nicht übernommen (AngularJS/Node passt
  nicht), Ideen und Formate (Shortcuts, Rename-Makros, Farbschemata) dürfen übernommen werden.
- `krocon/files-and-folders-mr`: Custom Source-Available License – **kein Code übernehmen**, nur Funktionsreferenz.
