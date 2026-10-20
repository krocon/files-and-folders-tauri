# CLAUDE.md – Files and Folders (Tauri)

> Leitfaden für Claude (und Menschen) zur Arbeit an **Files and Folders**: einem plattformübergreifenden
> Dateimanager für macOS, Windows und Linux in Richtung Total Commander.
> Autor: Marc Kronberg · Repo: https://github.com/krocon/files-and-folders-tauri
> MIT
>
> Neuauflage des älteren Projektes , siehe Folder: '/old_project', (https://github.com/krocon/files-and-folders-mr)
> (Node, WebSockets) als **Desktop-App**: Tauri 2 + Angular 22 + Rust. Die Dateiliste ist eine
> **GuiExpert Table** (`@guiexpert/table`, Quellcode im Mono-Repo `guiexperttable/mono`, gleicher Autor).

---

## 1. Stand

- Phase 1 (Walking Skeleton), Prompt 001 (Dateiliste mit der GuiExpert Table), Prompt 004 (Fensteraufbau, Tabs,
  Sitzungszustand), Prompt 002 (Aktionssystem, Keymaps je OS, Befehlspalette, Button-Leiste), Prompt 003
  (Navigation, Verlauf, Filter/Hidden, Ordnergröße, Datei öffnen), Prompt 005 (Job-Engine: Kopieren mit
  Fortschritt, Pause, Abbruch, Konflikten), Prompt 006 (Kopieren/Verschieben/Löschen mit Papierkorb, Ordner/Datei
  anlegen, Umbenennen inkl. F2 in der Liste), Prompt 007 (Multi-Rename mit Vorschau, Vorlagen, Rückgängig),
  Prompt 008 (Dateien gruppieren, Ordner aufräumen, Multi-MkDir), Prompt 009 (Suche mit Ergebnis-Tabs,
  Ordner-Finder), Prompt 010 (Ansicht F3, Schnellvorschau, Eigenschaften), Prompt 011 (Laufwerke im Ordnermenü,
  Finder/Explorer/Terminal, externe Tools ohne Shell, F4 = Tool `edit`, Zwischenablage), Prompt 012
  (Verzeichnis-Überwachung, Drag & Drop; Ziehen ins System offen), Prompt 013 (Farbschemata: Mechanik,
  Live-Editor, System folgen), Prompt 014 (Kontextmenü, Menüleiste nativ/HTML aus einem Menümodell), Prompt 019
  (die acht alten Designs, `--fnf-*`-Import/Export, WCAG-Korrektur), Prompt 016 (Archive ZIP/TAR als Ordner,
  Packen/Entpacken, Duplikate), Prompt 015 (Einstellungen, Deutsch/Englisch zur Laufzeit), Prompt 017 (Version aus einer Quelle, App-Icon, Pakete je OS, About,
  CI-/Release-Vorlagen in `docs/ci/`, `docs/release.md`), Prompt 018 (Feature-Parität gegen `old_project/`,
  Matrix in `docs/feature-parity.md`), Prompt 020 (Actions-Menü wie mr), Prompt 021 (Shell-Leiste mit Pipes) und Prompt
  029 (bedienbar bei langen Jobs/langsamen Laufwerken, Branch `feat/reaktionsfaehig-bei-jobs`) und Prompt 030 (Ordner-Cache
  für langsame Laufwerke; `getattrlistbulk` gemessen und wieder ausgebaut) sind fertig. Als Nächstes: Folge-Prompts 022–028 (Vorschlag in `docs/feature-parity.md`, noch zu schreiben).
  Details: `docs/roadmap.md`, `prompts/README.md`.
- **Vorlage/SOLL** ist die alte Version `files-and-folders-mr`, Quellcode lokal unter **`old_project/`** (gitignored;
  in Remote-Sitzungen per `device_bash` als `tar` ohne Bilder/Fonts holen). Nur lesen, Lizenz §8.
- Weiterentwicklung über **Feature-Prompts** in `prompts/` (Index und Reihenfolge: `prompts/README.md`, gemeinsame
  Regeln: `prompts/000-arbeitsweise.md`). Fachliche Grundlage: `docs/legacy-analysis.md` (AngularJS/Node 2016),
  `docs/legacy-analysis-mr.md` (Angular 20/NestJS 2025, maßgeblich bei Abweichungen), **`docs/ui-layout.md`**
  (verbindlicher Fensteraufbau: zwei Seiten mit Header, Tabs, Liste, Statuszeile; Button-Leiste) und
  `docs/legacy-themes/` (die acht Default-Designs).

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
| Screenshots | `pnpm screenshots` (alle Farbschemata × Szenen → `screenshots/`, s. `docs/screenshots.md`), einmalig `pnpm screenshots:install` |
| Version | `pnpm version:check`, `pnpm version:set X.Y.Z` (Quelle `package.json`), `pnpm release:notes` |
| Release-Build | `pnpm tauri build` (Signierung/Notarisierung vorbereitet, nicht eingerichtet – `docs/release.md`) |

Nicht ausführbare Checks im Abschlussbericht mit Grund nennen. Langsames Laufwerk im Debug-Build simulieren:
`FNF_TEST_SLOW=<pfad-präfix>:<listing-ms>:<block-ms>` (029 E13). `pnpm tauri dev` braucht ein Fenster – in einer
Container-Sitzung ohne Display: `pnpm tauri build --debug --no-bundle` und die Binary unter `Xvfb` starten
(Screenshot mit `import -window root`, Tasten mit `xdotool`). So wurde Phase 1 verifiziert.

## 3. Layout

```
src/                         Angular 22 (zoneless, Signals, OnPush, Standalone)
  app/core/fs/               DTOs (fs.models.ts), Fehler-Mapping (fs-error.ts), FsApi (invoke list_directory),
                             ListingCache (Root: Listings langsamer Ordner, 030)
  app/core/session/          Sitzungs-DTOs, SessionApi (invoke load_session/save_session)
  app/core/jobs/             Job-DTOs, JobsApi (ein Ereigniskanal), JobsStore (Root: alle Jobs, Konflikte, Waiter)
  app/core/rename/           Multi-Rename-DTOs, RenameApi (plan_rename, undo_rename, Vorlagen)
  app/features/jobs/         Task-Liste, Konfliktdialog (auch „schreibgeschützt“), Aktion Tasks
  app/features/ops/          Dateioperationen: OpsStore (Auswahl, Ziele, Ausführung), Dialoge Kopieren/Verschieben,
                             Löschen, Name (Ordner/Datei anlegen, Umbenennen), Aktionen F2/F5–F8
  app/features/multirename/  rename-engine.ts (reine Regel-Engine + Testkatalog .cases.json), MultiRenameStore,
                             Dialog mit Vorschau-Table, Aktionen OPEN_MULTIRENAME_DLG/UNDO_RENAME
  app/core/folders/          FoldersApi (find_empty_dirs, create_folders), DTOs der Ordner-Werkzeuge
  app/features/groupfiles/   group-engine.ts (rein, Testkatalog .cases.json), GroupFilesStore + Dialog (Job `group`)
  app/features/cleanfolders/ CleanFoldersStore + Dialog (Suche in Rust, Job `clean`, Papierkorb als Default)
  app/features/multimkdir/   mkdir-engine.ts (rein), MultiMkdirStore + Dialog (create_folders)
  app/core/os/               OsApi (Laufwerke, Dateimanager, Terminal, Tools), ClipboardApi + clipboardText
  app/core/file-icon/        FileIconService (Icon-Zuordnung nach Dateiendung/Kategorie zu Font Awesome)
  app/features/osintegration/ OsStore (Tools als Extra-Aktionen, Zwischenablage, Terminal), VolumesStore (Laufwerke
                             im Ordnermenü), Tool-Konfigurationsdialog
  app/core/search/           Such-DTOs (Kriterien, Treffer, Statistik) – Treffer kommen als Job-Ereignis `searchHits`
  app/features/search/       SearchStore (Root: Ergebnisse je Ergebnis-Tab, Drosselung), FindStore + Suchdialog
                             (find-form.ts rein, search-presets.json), Ordner-Finder (Store, Logik, Dialog), Aktionen
  app/core/preview/          PreviewApi (read_preview, get_properties, Bild-URL über Schema `fnfpreview`), DTOs
  app/features/preview/      Ansicht (ViewerStore + Dialog), Schnellvorschau (QuickViewStore, im Ziel-Panel),
                             Eigenschaften, Provider-Liste (views/: Text per textContent, Bild, Hex, Info), reine
                             Helfer (text-search, hex, permissions)
  app/core/theme/            Farbschemata: Token-Katalog (tokens.ts), eingebaute Schemata (themes/*.json = styles.css),
                             Kontrast/Farben (color.ts, theme-logic.ts), ThemeService (Root), ThemeApi; alte Designs:
                             legacy/*.json (= docs/legacy-themes), legacy-theme-map.ts (76 `--fnf-*` → Tokens),
                             legacy-theme.ts (Umrechnung, alter Export), contrast-fix.ts (minimale WCAG-Korrektur)
  app/features/themes/       Dialog „Colour schemes…“ (Live-Editor, Import/Export), Aktionen, Texte
  app/core/archive/          archive-names.ts (Endungen wie Rust, Default-Archivname) – Archive kommen über
                             `list_directory` (virtuelle Pfade, `DirectoryListing.archive`)
  app/features/archive/      ArchiveStore (Pack/Unpack/Extract als Jobs), Dialoge, Aktionen + Veto im Archiv
  app/features/duplicates/   DuplicatesStore + Dialog, duplicates-logic.ts (Auswahlhilfen, rein) – Ergebnis im SearchStore
  app/core/watch/            WatchApi (subscribe_watch, watch_dirs, describe_paths), WatchService (Root: Ordner beider
                             Panels → Rust, Ereignisse an die Panels); app/core/dnd/ DragDropApi (Tauri-Drop von außen)
  app/features/dnd/          DragStore (Root: Ziehen, Zonen, Übergabe an den Kopieren/Verschieben-Dialog), dnd-logic.ts
                             (rein), DragGhost (Hinweis am Zeiger)
  app/core/actions/          Aktionskatalog, Kürzel-Notation, Keymaps je OS (JSON), ActionService, KeyboardDispatcher,
                             KeymapApi (invoke load/save_keymap_override)
  app/features/actions/      Befehlspalette, Markier-Dialog, Kürzel-Dialog, Actions-Menü, Workspace-Aktionen
  app/core/about/, features/about/  AboutApi (get_app_info), About-Dialog (Version, Plattform, Kopieren)
  app/core/shell/            ShellApi (nur `run_shell`, einziger Importeur: ShellBar), ShellSupportApi (Quotieren, Verlauf)
  app/features/shell/        ShellStore (Root: Sichtbarkeit, Verlauf, laufender Job, Ausgabepuffer), ShellBar (Zeile 5,
                             Combobox), shell-logic.ts (rein: Verlauf, Vorschläge, Puffer, Kürzung), Aktionen
  app/core/i18n/             Laufzeit-i18n: translatable() (Proxy auf das Sprach-Signal), Translation<T>, localeFor();
                             Kataloge je Feature `*-texts.ts` (en) + `*-texts.de.ts`, Vollständigkeit: catalogs.spec.ts
  app/core/settings/         settings-schema.json (gemeinsam mit Rust), SettingsApi, SettingsStore (Root, entprellt),
                             display.ts (Formate für Renderer)
  app/features/settings/     Einstellungsdialog (vertikale Tabs, Suche, Export/Import), settings-logic.ts (rein)
  app/core/menu/             MenuApi (set_app_menu, subscribe_menu, close_main_window), DTOs des nativen Menüs
  app/features/menus/        menu-model.ts (rein: Menüleiste, Kontext-Menüs, nativer Spec), MenuService (Root:
                             Kontextmenü, nativ/HTML, Ereignis-Brücke), MenuBar (HTML, Win/Linux), Menü-Aktionen
  app/features/browser/      FileBrowserStore (Zustand je Panel), file-list/ (GuiExpert Table, Controller, Bridge)
  app/features/workspace/    Workspace (Grid, Splitter), WorkspaceStore (Root: Tabs, aktive Seite, Favoriten),
                             FilePanel (eine Seite), TabBar, ContextMenu, ButtonBar (+ buttons.json), Texte
  app/shared/                Formatierung (Größe, Datum), dialog/ (DialogService, Modal mit Fokusfalle,
                             tool-dialog.css), preview-grid/ (GuiExpert Table für Vorschauen)
  assets/                    font-awesome-4.5.0/ (Font Awesome 4.5.0 Fonts + CSS)
  testing/                   Fixtures, FakeFsApi, FakeSessionApi, FakeTableBridge (nie im Produktivcode importieren)
  styles.css                 Design-Tokens, Font-Awesome-Import (@import assets/font-awesome-4.5.0/...)
  styles/ge-table-theme.css  GuiExpert-Brücke: einzige Stelle mit `--ge-table-*`
  styles/controls.css        `.btn` + Eingabefelder/Selects/Checkboxen in Dialogen (eine Höhe `--control-height`);
                             Dialog-CSS setzt nur Breite/Schrift, nie Rahmen/Padding/Farben von Controls
src-tauri/                   Rust (Tauri 2)
  src/commands.rs            dünne Command-Schicht (validieren, Default auflösen, spawn_blocking)
  src/listing.rs, paths.rs   reine std-Logik, unit-getestet, ohne Tauri
  src/listing_gate.rs        ein Listing je hängendem Ordner (029 E6); test_slow.rs: Testschalter FNF_TEST_SLOW (nur Debug,
                             Präfix gilt auch als Netzlaufwerk)
  src/model.rs, error.rs     DTOs (serde camelCase) und FsError { code, message, path }
  src/session.rs             Sitzungsdatei (Schema v1, sanitize, atomar), window_state.rs (Fenstergeometrie)
  src/keymap.rs, fs_atomic.rs  Kürzel-Override-Datei; atomares Schreiben / kaputte Dateien beiseitelegen
  src/settings.rs            settings.json (Schema, sanitize, .bad, neuere Version), Export/Import-Bündel aller Teile
  src/about.rs               Daten für About (Version aus tauri.conf.json → package.json, Plattform)
  src/app_menu.rs            natives Menü aus dem Spec des Frontends (Validierung, Keymap → Accelerator)
  src/dirsize.rs, opener.rs  Ordnergröße (ohne Symlinks, abbrechbar); Datei mit Standard-App öffnen (geprüft)
  src/fileops.rs             Ordner/Datei anlegen, Umbenennen (nie überschreiben); Gefahrenprüfung (`check_danger`)
  src/jobs/                  Job-Engine: manager (Warteschlange, Threads, Zählen), control (Abbruch/Pause/Antwort),
                             copy (Kopieren + Verschieben: Planung, Temp + Umbenennen, Konflikte), delete
                             (Papierkorb/endgültig), rename (Multi-Rename: Prüfung, Ketten/Zyklen, Undo-Paare),
                             group (Gruppenordner + Copy/Move-Paare), clean (Aufräumen, prüft jeden Eintrag neu),
                             search (Treffer gebündelt streamen),
                             report (Drosselung); tests_engine.rs, tests_ops.rs, tests_tools.rs
  src/preview/               read_preview (Kopf 8 KiB, Limits), detect.rs (Magic Bytes, Endung passt nicht),
                             encoding.rs (UTF-8/16, 1252, Latin-1), ImageTokens + serve_image für Schema `fnfpreview`
  src/properties.rs          Eigenschaften (Zeiten, Unix-Modus/Eigentümer, Windows-Attribute, Link-Ziel)
  src/watch/                 Ordner-Überwachung: mod.rs (WatchHub, notify + PollWatcher, Thread), batch.rs (Entprellen,
                             rein), netfs.rs (Netzlaufwerk?); Commands in commands/watch.rs
  src/archive/               Archive: Index (ZIP/TAR/TAR.GZ), `sanitize` (Zip-Slip), Bomben-Grenzen, LRU,
                             `list_directory_or_archive` (virtuelle Pfade); Jobs `jobs/extract.rs`, `jobs/pack.rs`,
                             `jobs/ask.rs` (Konfliktfrage), Tests `archive/tests.rs`, `jobs/tests_archive.rs`
  src/duplicates.rs          Duplikate: Größe → SHA-256 Kopf/Ende → voll (Crate `sha2`), Job `jobs/duplicates.rs`
  src/clean.rs               find_empty_dirs: leere Ordner/Musterdateien finden (keine Links, kein fremdes FS)
  src/search.rs              Suche: Kriterien, Glob/Regex/Text (Crate `regex`), zyklensichere Tiefensuche, Inhalt
                             mit Größenlimit; Job `jobs/search.rs` bündelt Treffer (≤ 500 / 50 ms)
  src/shell/                 Shell-Zeile (rein): Shell-Wahl, `cd`/`clear`, Quotieren je Shell, ANSI/Kodierung,
                             Login-Umgebung, `shell-history.json`; Job `jobs/shell.rs`, Prozesse `platform/process.rs`,
                             Commands `commands/shell.rs`
  src/rename_presets.rs      Multi-Rename-Vorlagen (`rename-presets.json`, nur Form/Größe geprüft)
  src/themes.rs              Farbschemata (`themes.json`, harmlose CSS-Werte), Import/Export von `.theme.json`
  src/tools.rs               externe Tools: `tools.json` (Defaults je OS, mr-Import), Platzhalter je Argument, Start ohne Shell
  src/platform.rs, platform/ Plattformcode je OS: Umbenennen ohne Ersetzen, `volumes.rs` (Laufwerke mit Timeout),
                             `desktop.rs` (Finder/Explorer/FileManager1, Terminal)
  capabilities/default.json  nur core:default
  icons/source/app-icon.svg  Quelle des App-Icons (`pnpm tauri icon …`)
scripts/                     version.mjs (eine Version), release-notes.mjs, licenses.mjs; Tests `*.test.mjs` (node --test);
                             screenshots/ (Playwright + Mock-Backend + Demo-Dateisystem, Szenen in scenes.json)
docs/                        architecture.md, roadmap.md, feature-parity.md, ui-layout.md, release.md, licenses.md,
                             ci/ (Workflow-Vorlagen),
                             legacy-analysis(-mr).md, legacy-themes/, legacy-screenshots/
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
- **Tabs und Seiten**: der Root-`WorkspaceStore` hält die Tabs beider Seiten; ein `FilePanel` liest seinen aktiven
  Tab dort und schreibt Pfad, Titel, Cursor und Table-Zustand zurück – Tabs werden **per Id** adressiert, nie per
  Index über Seiten hinweg.
- **Jede Funktion ist eine Aktion**: Id in `core/actions/action-catalog.ts`, Handler per `ActionService.register`,
  Kürzel nur in den Keymap-JSONs. Keine eigenen `keydown`-Handler für Funktionen (Ausnahmen: Dialoge, Menüs,
  Tab-Leiste, Splitter – also Widgets nach APG).
- **Lange oder destruktive Operationen sind Jobs** (`JobSpec` in Rust, `JobsStore.start` im Frontend): Fortschritt,
  Abbruch und Konflikte kommen von der Engine; neue Operationen (006 ff.) werden als Job-Art ergänzt, nicht als
  eigener Command mit eigenem Kanal.
- **Zustand je Panel**: Stores sind `@Injectable()` ohne `providedIn: 'root'` und werden im Komponenten-Provider
  erzeugt – Dual-Pane und Tabs brauchen unabhängige Instanzen. Globales (Einstellungen, Job-Queue, Keymap) in
  Root-Services.
- **Veraltete Antworten verwerfen** (Request-Sequenz wie in `FileBrowserStore.load`), bei Listing, Suche, Vorschau.
- **Commands nie synchron** (029 E11): `async fn` oder `#[tauri::command(async)]` – synchrone Commands laufen in Tauri 2
  auf dem Main-Thread und frieren bei jedem Hänger das Fenster ein. Ausnahme nur Menü/Fenster (`set_app_menu`,
  `set_menu_enabled`, `subscribe_menu`, `close_main_window`); der Test `commands::command_rules` prüft das.
- **Ungeprüfte Listings** (030 E4/E5): Was aus dem `ListingCache` kommt (`cachedAt`), ist bis zur Antwort von Rust
  ungeprüft – Aktionen, die Einträge ändern oder entfernen, kommen in `OFF_WHILE_UNCHECKED`; Delete/Move schicken für
  Netzlaufwerke und ungeprüfte Listings `expected` mit (`expectedFor`).
- **Auffrischen ≠ Navigieren** (029 E1): Reloads durch Watcher/Jobs/Ctrl+R laufen mit `background` (kein Overlay, Liste
  bleibt bedienbar), automatische nur über `requestRefresh` (Drossel nach langsamen Listings).
- **Blockierende I/O nie auf dem Async-Runtime-Thread**: `tauri::async_runtime::spawn_blocking` oder eigene Worker.
  Lange Operationen (Kopieren, Suche) als Job mit Fortschritt über `tauri::ipc::Channel` und Abbruch-Token.
- **Destruktive Operationen** (Löschen, Überschreiben, Verschieben) werden im Rust-Backend validiert und getestet
  (tempfile), nie nur im Frontend. Standard beim Löschen ist der Papierkorb.
- **Sicherheit**: keine Tauri-Plugins mit breitem Dateisystem- oder Shell-Zugriff; jede Fähigkeit als schmaler,
  validierter Command. Kein beliebiges Shell-Kommando aus dem Frontend; externe Tools nur aus der Konfiguration mit
  Argument-Arrays (kein String an eine Shell). CSP strikt (Ausnahme `style-src` wegen Angulars Laufzeit-Styles, s.
  `docs/architecture.md`). Keine Dateiinhalte oder vollständigen Nutzerpfade unnötig loggen.
- **Ausnahme Shell-Zeile (Design 021 E1)**: Ein Befehl entsteht nur aus dem, was der Nutzer ins Shell-Feld tippt, und
  läuft nur nach Enter dort – nie aus Konfiguration, Dateinamen, Menüs, Palette oder anderem Code. Einziger Einstieg
  ist der Command `run_shell` (Hauptfenster, `shell.enabled`); `JobSpec::Shell` bleibt `skip_deserializing`, nur
  `ShellBar` importiert `ShellApi` (Spec prüft das). Arbeitsordner nur per `current_dir`, Befehl als ein Argument an
  die Shell, eingefügte Namen quotiert Rust (`shell_quote`). Befehle und Ausgaben nie loggen.
- **Plattformcode** hinter `cfg`-Funktionen bzw. einem Modul `platform/` mit gleicher Signatur je OS.
- **Neue Abhängigkeiten** (npm oder crates) nur mit kurzer Begründung in `docs/architecture.md` (Tabelle
  „Abhängigkeiten“). Keine UI-Frameworks (Material o. ä.); Styling mit CSS (natives Nesting) + Tokens – kein SCSS.
- **Texte** nur aus Katalogen (`*-texts.ts` + `*.de.ts`, Englisch = Quelle) – nie beim Laden eines Moduls in
  Konstanten kopieren (Getter/Funktionen nutzen) und keine Tabellen/Modelle in einem `computed` bauen, das Texte
  liest. Fehler im UI über `errorText()`/`describeFsError()`, nicht Rusts `message`.
- **Icons**: In der gesamten UI nutzen wir die **Font Awesome 4.5.0**-Icons (Assets unter `src/assets/font-awesome-4.5.0/`,
  eingebunden in `src/styles.css`). Datei-Icons werden im Dateipanel über den `FileIconService`
  (`app/core/file-icon/file-icon.service.ts`) dynamisch anhand der Dateierweiterung bzw. Kategorie aufgelöst.

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
  - Cursor (Total Commander) ↔ `FocusModel` (über den Pfad abgeglichen); markierte Dateien = eigenes `Set<path>` im
    Store, **nicht** `SelectionModel` (index-basiert, überlebt kein Sortieren). Umsetzung: `features/browser/file-list/`,
    Begründung und alle Workarounds (G1–G14): `prompts/001-guiexpert-dateiliste.design.md`.
  - Sortieren per Spaltenkopf geht nur per **Doppelklick**; der Handler ruft `stopPropagation()` und es gibt kein
    Sortier-Ereignis. `setRows` sortiert nicht neu (`reSort()` danach).
  - Table-API nur über `TableBridge` (`file-list/table-bridge.ts`) ansprechen – dort sind die Workarounds gebündelt.
  - Umbenennen in der Liste (F2): `FileBodyModel.isEditable` nur für die Namenszelle des Eintrags, eigener Editor
    (`rename-editor.ts`, `getEditRenderer`), `tableApi.startEditing`; das Modell schreibt nie (`setValue` → false).
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
- ~~**Kein Push, kein Force-Push, kein `git reset --hard`, keine Releases** ohne ausdrückliche Anweisung. Fremde
  Änderungen nie verwerfen.~~ du darfst pushen.
- `.github/workflows/` kann aus der Remote-Sitzung nicht geschrieben werden – Workflow-Dateien Marc übergeben.
- README, `docs/architecture.md`, `docs/roadmap.md`, `docs/feature-parity.md` bei relevanten Änderungen mitpflegen.

## 8. Lizenzen & Referenzen

- Eigene Lizenz: **MIT** (`LICENSE`, `license` in `package.json`, `Cargo.toml`, `bundle.license` in `tauri.conf.json`).
- GuiExpert Table: MIT (aktuelle Releases).
- Alte Projekte: `krocon/node-files-and-folders-client`, `krocon/node-files-and-folders-server`, npm
  `files-and-folders` (MIT laut package.json) – fachliche Vorlage, Code wird nicht übernommen (AngularJS/Node passt
  nicht), Ideen und Formate (Shortcuts, Rename-Makros, Farbschemata) dürfen übernommen werden.
- `krocon/files-and-folders-mr` (lokal im Repo unter `old_project/`, gitignored): Custom Source-Available License,
  Rechteinhaber GUI Expert GmbH (Marc). Als Referenz für Verhalten, Layout und Konfiguration nutzen; Code nur nach
  Marcs ausdrücklicher Freigabe übernehmen. Die acht Default-Designs: `docs/legacy-themes/`.

## 9. Arbeitsumgebung für Claude (Remote-Sitzung) – zuerst lesen, spart Zeit

**Wo was läuft**
- Das Repo liegt auf Marcs Mac (`~/WebstormProjects/files-and-folders-tauri`). Die Geräte-Shell (`device_bash`) ist
  eine **Linux-VM (aarch64) ohne pnpm/cargo** – dort keine Checks, nur `git` (status/log/branch/merge/bundle) und Lesen.
- `git` auf dem Gerät braucht **Löschrechte** (Lock-Dateien): einmal je Sitzung
  `device_request_delete_permission` für den Repo-Ordner. Dort gibt es keine Git-Identität: Commits mit
  `git -c "user.name=Marc Kronberg" -c user.email=krocon@gmail.com …` – oder Marc den Befehl nennen (er führt ihn gern
  selbst aus).
- Gebaut und getestet wird in der **Cloud-Umgebung** (Klon des Repos).

**Ablauf (bewährt)**
1. Gerät: `git switch -c feat/<slug> main && mkdir -p .tmp-bundle && git bundle create .tmp-bundle/repo.bundle --all`
2. `device_stage_files` → Container: `git clone -b feat/<slug> /mnt/user-data/uploads/files-and-folders-tauri/.tmp-bundle/repo.bundle ~/fnf`
3. Container einrichten (einmal je Sitzung, im Hintergrund starten und währenddessen lesen):
   `apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev xdotool imagemagick`
   (Xvfb ist da), `pnpm install --frozen-lockfile` (~10 s), `cd src-tauri && cargo build --tests` (~3,5 min beim
   ersten Mal). Node im Container ist zu alt für die Angular-CLI (22.22.0 < 22.22.3, `ng lint` bricht ab): `npm pack node-linux-x64@22.23.3` (npm-Registry ist erreichbar, nodejs.org nicht), entpacken und `package/bin/node` über `/opt/node22/bin/node` kopieren. `pnpm check` dauert dann ~3 min.
4. Zurück: Container `git bundle create /mnt/user-data/outputs/<slug>.bundle origin/main..feat/<slug>` →
   `device_commit_files` nach `.tmp-bundle/<slug>.bundle` → Marc (oder Gerät):
   `git pull --ff-only .tmp-bundle/<slug>.bundle feat/<slug>`. `.tmp-bundle/` ist in `.gitignore`.

- Seit 2026-10-17 darf gepusht werden (§7): im Container `origin` = GitHub (Zugang über `add_repo` mit `push`),
  dann ist der Bundle-Weg (Schritt 4) unnötig – Marc holt mit `git pull`. Git-Identität im Container:
  `Claude <noreply@anthropic.com>` (Stop-Hook verlangt das).
- Parallel arbeiten mit `git worktree add` (je Worktree eigenes `src-tauri/target`, ~5 GB!). Platte ist knapp:
  `export CARGO_INCREMENTAL=0`, `target/release` nach Messungen löschen, `df -h /` im Blick. Eigene Xvfb-Displays je
  Worktree, Prozesse nur per PID beenden. Offene Punkte für die nächste Sitzung: `TODO.md`.

**Referenzquellen (lesbar ohne Marcs Mac)**
- Alte Version (AngularJS): `git clone --depth 1 https://github.com/krocon/node-files-and-folders-client` – z. B.
  `src/fnf/commands/multirename/` (Makros, Umlaut-Tabelle, `titleCaps`).
- mr (Angular 20): `git clone --depth 1 https://github.com/krocon/files-and-folders-mr` (nur lesen, Lizenz §8) – z. B.
  `apps/fnf/src/app/feature/cmd/<feature>/`.
- GuiExpert Table: https://github.com/guiexperttable/mono (oder die API im installierten `node_modules/@guiexpert/table`).

**Sparsam lesen** – statt alles zu öffnen:
- `docs/architecture.md` Tabelle „Entscheidungen“ + das Design-Dokument des Vorgänger-Prompts (Abschnitte
  „Verträge“ und „Fortschritt“) reichen meist als Überblick. Aus `docs/legacy-analysis*.md` nur die im Prompt
  genannten Abschnitte (`grep -n "^### "` zuerst).
- Einstiegspunkte: Rust `jobs/mod.rs` (`JobSpec`, `kind()`, `is_parallel()`), `jobs/manager.rs` (`run`-match,
  `validate`), `fileops.rs` (`rename_entry`, `check_danger`), `platform::rename_noreplace`, `paths::validate_name`,
  `commands.rs` + Registrierung in `lib.rs`. Frontend: `features/ops/ops.store.ts` (Muster für Anfrage → Dialog →
  Ausführung), `ops-logic.ts` (`selectionForAction`), `shared/dialog/dialog.service.ts` (`DialogKind` ergänzen),
  `modal.ts`, `workspace.ts` (bindet die Dialoge ein), `core/actions/action-catalog.ts` (`m(label, group, prompt)` =
  noch ohne Handler), Keymaps `core/actions/keymaps/{linux,macos,windows}.json`, `button-bar/buttons.json`,
  `browser/file-list/file-table-model.ts` (Muster für ein GuiExpert-Modell mit Zeilenklassen).
- E2E unter Xvfb (013): `xdotool click` geht im WebKitGTK-Fenster manchmal verloren – `mousedown`, kurz warten,
  `mouseup`; `xdotool type` kann keine Mehrbyte-Zeichen (Umlaute, Emoji) – solche Namen per Datei anlegen.
  `GTK_THEME=Adwaita:dark` beim Start schaltet `prefers-color-scheme: dark` der WebView. Specs dürfen Dateien mit
  `node:fs` lesen (`// @ts-expect-error` am Import, s. `builtin-themes.spec.ts`).
- Bekannte Fakten: `FileBrowserStore.markedEntries` hat die Reihenfolge des Listings aus Rust, **nicht** die
  aktuelle Sortierung der Table. `DirectoryListing.segments` beginnt mit der Wurzel (Name = Wurzelpfad, z. B. `/`).
