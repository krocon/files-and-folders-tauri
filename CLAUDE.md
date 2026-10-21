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
  (Verzeichnis-Überwachung, Drag & Drop; Ziehen ins System → 028), Prompt 013 (Farbschemata: Mechanik,
  Live-Editor, System folgen), Prompt 014 (Kontextmenü, Menüleiste nativ/HTML aus einem Menümodell), Prompt 019
  (die acht alten Designs, `--fnf-*`-Import/Export, WCAG-Korrektur), Prompt 016 (Archive ZIP/TAR als Ordner,
  Packen/Entpacken, Duplikate), Prompt 015 (Einstellungen, Deutsch/Englisch zur Laufzeit), Prompt 017 (Version aus einer Quelle, App-Icon, Pakete je OS, About,
  CI-/Release-Vorlagen in `docs/ci/`, `docs/release.md`), Prompt 018 (Feature-Parität gegen `old_project/`,
  Matrix in `docs/feature-parity.md`), Prompt 020 (Actions-Menü wie mr), Prompt 021 (Shell-Leiste mit Pipes) und Prompt
  029 (bedienbar bei langen Jobs/langsamen Laufwerken, Branch `feat/reaktionsfaehig-bei-jobs`) und Prompt 030 (Ordner-Cache
  für langsame Laufwerke; `getattrlistbulk` gemessen und wieder ausgebaut) und Prompt 028 (Ziehen ins System, nur
  Kopieren) und Prompt 022 (Konfigurations-Editoren: Buttons, Dateitypen, dauerhafte Suchvorlagen, Vollbild F11), Prompt
  024 (Attribute ändern: Rechte/Oktal, R/H/S/A, macOS versteckt, Zeitstempel als Job `attributes`; Eigentümer/Gruppe
  offen), Prompt 025 (Archive: 7z lesen/packen, RAR lesen, Passwörter nur im Speicher, Einträge ansehen/öffnen über
  einen App-Cache; in Archive schreiben offen), Prompt 026 (Import alter Konfiguration aus mr: Assistent, Vorschau,
  Sicherungen) und Prompt 031 (Tabs ziehen, Verknüpfungen per Drag/Dialog; Verschieben ins System bewusst nicht) und
  Prompt 032 (Starter-Menü: Menü „Start“, `Alt+S`, Editor, TC-Parameter `%P%N` …, `starter.json`) und Prompt 033
  (Speicherbelegung: Scan als Job `diskUsage`, Tab „Belegung“, Ringe/Kacheln, Sammelkorb, `Mod+Shift+D`) und Prompt 034
  (Server-Verbindungen FTP/FTPS/SFTP: Pfade `remote://<profil>/…`, Passwörter nur im Schlüsselbund, `Mod+K`) und Prompt
  040 (Panel-Aktionen: Seiten tauschen, Ziel = Quelle, Strg+←/→) und Prompt 027 (Ordnergedächtnis je Tab über einen
  Neustart in `folder-memory.json`, letzte Dialogeingaben in `dialogs.recent`) und Prompt 039 (Prüfsummen erzeugen/prüfen, Jobs `checksum`/
  `verifyChecksums`) und Prompt 037 (Dateien vergleichen: Command `diff_files`, Tool `diff`) sind fertig, 022–031 mit externem Review. **023 (eingebauter Editor) ist verworfen.** Als Nächstes: die Prompts 035, 036, 038, 041–044
  (Reihenfolge `prompts/README.md` „Nächste Prompts“), vor allem aber die CI für macOS/Windows (`TODO.md` §3).
  Details: `docs/roadmap.md`, `prompts/README.md`.
- **Vorlage/SOLL** ist die alte Version `files-and-folders-mr`, Quellcode lokal unter **`old_project/`** (gitignored;
  in Remote-Sitzungen per `device_bash` als `tar` ohne Bilder/Fonts holen). Nur lesen, Lizenz §8.
- Weiterentwicklung über **Feature-Prompts** in `prompts/` (erledigte 001–034, 037, 039, 040 ohne 023 samt Design-Dokumenten unter `prompts/done/`; Kürzel wie „029 E11“ im Code verweisen dorthin) (Index und Reihenfolge: `prompts/README.md`, gemeinsame
  Regeln: `prompts/000-arbeitsweise.md`). Fachliche Grundlage: `docs/legacy-analysis.md` (AngularJS/Node 2016),
  `docs/legacy-analysis-mr.md` (Angular 20/NestJS 2025, maßgeblich bei Abweichungen), **`docs/ui-layout.md`**
  (verbindlicher Fensteraufbau: zwei Seiten mit Header, Tabs, Liste, Statuszeile; Button-Leiste) und
  `docs/legacy-themes/` (die acht Default-Designs).

## 2. Befehle (Root, pnpm 10 via `packageManager`, Node ≥ 22.22.3, Rust stable ≥ 1.93 – `sevenz-rust2`, Design 025)

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
| Screenshots | `pnpm screenshots` (alle Farbschemata × Szenen → `screenshots/`, s. `docs/screenshots.md`), `pnpm screenshots:docs` (eingecheckte Bilder der README in `docs/screenshots/`), einmalig `pnpm screenshots:install` |
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
  app/core/memory/           FolderMemoryApi + DTOs (`folder-memory.json`, 027); Logik in browser/folder-memory-logic.ts,
                             Dialogeingaben: shared/dialog-memory.ts + shared/restore-fields.ts
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
  app/core/archive/ (025)    archive-api.ts (`set_archive_password`), archive-password-prompt.ts; features/archive/
                             password-dialog.ts (Passwort nur im Speicher von Rust)
  app/core/attributes/       DTOs des Jobs `attributes` (`AttrChange`, `TimeValue`, `ApplyTo`)
  app/features/attributes/   attributes-logic.ts (rein: Dreifach-Zustand, Oktal, Änderung bauen), AttributesStore (Root) +
                             Dialog, Aktion OPEN_CHANGE_ATTRIBUTES_DLG (024)
  app/core/config/           ConfigApi + DTOs (buttons.json, filetypes.json, toggle_fullscreen); core/file-icon/
                             file-types.json + file-types-logic.ts (`FILE_TYPES`-Signal, 022)
  app/features/config/       ButtonConfigStore, FileTypesStore, Dialoge Buttons/Dateitypen, button-config-logic.ts (022)
  app/core/mrimport/, features/mrimport/  Import alter mr-Konfiguration: MrImportApi, mr-import-logic.ts (rein), Root-Store,
                             Assistent (026)
  app/core/starter/          StarterApi (load/save/run_starter), DTOs des Startermenüs (032)
  app/features/starter/      StarterStore (Root: Einträge → Extra-Aktionen `starter:<id>` + `ActionService.starterTree`),
                             starter-logic.ts (rein: Baum, Einfügen/Anordnen), Editor „Startermenü ändern“, Aktionen
                             OPEN_STARTER_MENU (Alt+S, Popup über `MenuService.openStarter`)/OPEN_STARTER_CONFIG_DLG
  app/features/duplicates/   DuplicatesStore + Dialog, duplicates-logic.ts (Auswahlhilfen, rein) – Ergebnis im SearchStore
  app/core/diskusage/        DiskUsageApi (`disk_usage_*`), DTOs (033)
  app/features/diskusage/    DiskUsageStore (Root: Scans, Ebene/Verlauf/Korb je Scan, Tab `usage:<scanId>`), usage-rows.ts,
                             basket-logic.ts, chart-layout.ts (Ringe/Kacheln, rein), usage-colors.ts, DiskUsageChart
                             (andere Seite), Spalten-Renderer, Aktionen OPEN_DISK_USAGE(_VOLUME) + Veto im Tab
  app/core/remote/           Server-Verbindungen (034): RemoteApi, DTOs, remote-path.ts (Präfix-Test, Anzeige),
                             RemoteConnectPrompt (Brücke Panel → Verbinden)
  app/features/remote/       RemoteStore (Root: Profile, Zustände, Ablauf Passwort/Host-Key/Zertifikat), Dialog
                             „Mit Server verbinden“, Prompt-Dialog, remote-logic.ts (rein), Aktionen + OFF_ON_SERVER
  app/core/watch/            WatchApi (subscribe_watch, watch_dirs, describe_paths), WatchService (Root: Ordner beider
                             Panels → Rust, Ereignisse an die Panels); app/core/dnd/ DragDropApi (Tauri-Drop von außen),
                             OsDragApi (`start_os_drag`: aus dem Fenster in andere Programme, 028)
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
  app/features/workspace/    Workspace (Grid, Splitter), WorkspaceStore (Root: Tabs, aktive Seite, Favoriten), TabDragStore
                             (Root: Tabs ziehen) + tab-drag-logic.ts (rein, 031),
                             FilePanel (eine Seite), TabBar, ContextMenu, ButtonBar (+ buttons.json), Texte
  app/shared/                Formatierung (Größe, Datum), dialog/ (DialogService, Modal mit Fokusfalle,
                             tool-dialog.css), preview-grid/ (GuiExpert Table für Vorschauen)
  assets/                    font-awesome-4.5.0/ (Font Awesome 4.5.0 Fonts + CSS)
  testing/                   Fixtures, FakeFsApi, FakeSessionApi, FakeTableBridge, Fake{Config,Archive,MrImport}Api (nie im Produktivcode importieren)
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
  src/folder_memory.rs       Ordnergedächtnis je Tab-Id (027, nur Form/Größe geprüft); Commands in commands/config.rs
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
                             report (Drosselung), attributes (024: Rekursion mit Filter, kein fremdes FS), link (031:
                             symbolische Links, `relative_target`, nie überschreiben), view (025: Archiv-Eintrag für
                             Enter); tests_engine.rs, tests_ops.rs, tests_tools.rs, tests_attributes.rs, tests_link.rs
  src/preview/               read_preview (Kopf 8 KiB, Limits), detect.rs (Magic Bytes, Endung passt nicht),
                             encoding.rs (UTF-8/16, 1252, Latin-1), ImageTokens + serve_image für Schema `fnfpreview`
  src/properties.rs          Eigenschaften (Zeiten, Unix-Modus/Eigentümer, Windows-Attribute, Link-Ziel)
  src/watch/                 Ordner-Überwachung: mod.rs (WatchHub, notify + PollWatcher, Thread), batch.rs (Entprellen,
                             rein), netfs.rs (Netzlaufwerk?); Commands in commands/watch.rs
  src/attributes.rs          Attribute als Differenz, Validierung je OS (024); platform/attributes.rs: `Dir` (Ordner-
                             Deskriptor, *at-Aufrufe ohne Link-Folgen / Windows-Handle + FileBasicInfo)
  src/config_file.rs         gemeinsamer Lader für Nutzerdateien; buttons.rs, filetypes.rs, commands/config.rs (022)
  src/mr_import/             Import der mr-Konfiguration (026): mod.rs Fundort/Scan/apply, keys.rs Id-Tabelle/Notation/†,
                             tests.rs + fixtures/; commands/mr_import.rs
  src/archive/               Archive: Index (ZIP/TAR/TAR.GZ, 7z `sevenz.rs` + fail-closed Vorabprüfung
                             `sevenz_header.rs`, RAR `rar.rs` = einziges FFI/`unsafe`, Feature `rar`), `secrets.rs`
                             (Passwörter), `view.rs` (App-Cache zum Ansehen), testdata/ (+ Generatoren), `sanitize` (Zip-Slip), Bomben-Grenzen, LRU,
                             `list_directory_or_archive` (virtuelle Pfade); Jobs `jobs/extract.rs`, `jobs/pack.rs`,
                             `jobs/ask.rs` (Konfliktfrage), Tests `archive/tests.rs`, `jobs/tests_archive.rs`
  src/disk_usage/            Speicherbelegung (033): tree.rs (Arena, Summen, view/largest/locate/remove/graft), walk.rs
                             (Worker, Gerät+Inode, Gerätemenge), mod.rs (Hub ≤ 3 Scans, Plan, DTOs), tests.rs; Job
                             `jobs/disk_usage.rs`, Commands `commands/disk_usage.rs`, `platform/disk_usage.rs` (Blöcke,
                             Volume-Wurzel, macOS-Data-Volume)
  src/remote/                Server-Verbindungen (034): path.rs (RemotePath), profiles.rs (connections.json, URL),
                             credentials.rs (Schlüsselbund über keyring-core, Sitzungs-Geheimnisse), trust.rs
                             (known_hosts, FTPS-Pin), fs.rs (Trait RemoteFs), ftp.rs (suppaftp), sftp.rs (russh,
                             eigene Tokio-Laufzeit), mod.rs (Hub: Pool, Verbinden, Listing), view.rs, danger.rs;
                             testserver.rs (libunftp + russh-Server im Test), testdata/; Jobs `jobs/transfer.rs`,
                             `jobs/remote_delete.rs`; Commands `commands/remote.rs`
  src/secret.rs              `Secret` (Zeroizing, kein Serialize) für Archiv- und Server-Passwörter
  src/diff.rs                Dateien vergleichen (037): Text nebeneinander (`similar`), binär; Command `diff_files`;
                             Frontend core/diff/, features/diff/ (compare-files-logic.ts rein, DiffStore, Dialog)
  src/checksum.rs            Prüfsummen (039): Hashing MD5/SHA-1/SHA-256/SHA-512, GNU/BSD-Zeilen, `resolve` (feindliche
                             Namen); Jobs `jobs/checksum.rs` (+ tests_checksum.rs); Frontend features/checksum/
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
  src/starter.rs             Startermenü (032): `starter.json`, `sanitize`/`problems`, TC-Platzhalter → Tool-Platzhalter,
                             `to_tool`; Commands `commands/starter.rs` (Start über `commands::launch_tool`)
  src/os_drag.rs             Ziehen ins System (028): Pfade prüfen; Command `commands/os_drag.rs` (Main-Thread)
  src/platform.rs, platform/ Plattformcode je OS: Umbenennen ohne Ersetzen, `volumes.rs` (Laufwerke mit Timeout),
                             `desktop.rs` (Finder/Explorer/FileManager1, Terminal), `os_drag.rs` (nativer Drag:
                             Crate `drag` auf macOS/Windows, eigenes GTK unter Linux), `origin_mark.rs` (Mark-of-the-Web/
                             Quarantäne aufs Entpackte, 025), `clock.rs`; `make_symlink`, `entry_id` in platform.rs
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
- **Job-Pfade** (Review 024/031): `JobManager::start` normalisiert jeden Pfad jeder Job-Art (`paths::validate_job_path`,
  ohne `.`/abschließenden Separator), `..` wird abgelehnt; der Job arbeitet genau mit dem geprüften Pfad. Die
  Gefahrenprüfung (`paths::DangerCheck`) prüft zusätzlich den physischen Ort (Elternordner kanonisch).
- **Server-Verbindungen** (034): Serverpfade `remote://<profil-id>/<serverpfad>` sind opak wie alle Pfade (Rust
  `remote::RemotePath`); Geheimnisse nur im Schlüsselbund des OS (`remote::credentials`), nie in Dateien, Events,
  Logs oder im Frontend nach dem Senden; nichts verbindet ohne Zutun des Nutzers; neue Commands mit Pfaden prüfen
  `remote::is_remote` zuerst (lokale Commands lehnen Serverpfade über `validate_input_path` ab).
- **Fremde Archive sind feindlich** (025): Vorabprüfungen fail-closed (was nicht sicher beurteilt wird, wird abgelehnt),
  jede Anzahl/Größe vor der Allokation begrenzen; Passwörter nur im Speicher (`archive::secrets`, `Zeroizing`), nie
  serialisiert, geloggt oder in Events; Entpacktes erbt die Herkunftsmarke des Archivs.
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
  (Angular 22 → `@guiexpert/angular-table@22.1.100`, Core `1.1.100`, Stand Okt. 2026). Wir nutzen die
  signal-native Komponente **`TableSignalComponent`**, Selektor `guiexpert-table-signal` (erst ab 22.1.100):
  Signal-Inputs `tableModel`, `tableOptions`, `loading`, die API als Signal per **`[(tableApi)]="api"`** mit
  `api = signal<TableApi | undefined>(undefined)` – **kein `tableReady`**, verdrahtet wird in einem `effect()` auf
  `api()` (Listener über `api.subscribe` mit `onCleanup` lösen; neue Tabelle = neue API). Outputs u. a. `mouseClicked`,
  `contextMenu` (nicht `contextmenu`), `selectionChanged`, `focusChanged`. Die klassische `TableComponent`
  (`<guiexpert-table>`, `tableReady`) nicht mehr verwenden. Vorbild: `mono/apps/angular-signal-demo/src/orders.component.ts`.
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
    Begründung und alle Workarounds (G1–G14): `prompts/done/001-guiexpert-dateiliste.design.md`.
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

**Farbschemata ändern (Rezept, `src/app/core/theme/`)**
- Drei Arten: eingebaute `themes/{light,dark,crimson}.json` (light/dark = `src/styles.css`, Test prüft Gleichheit);
  die acht alten Designs `legacy/<name>.json` (= `docs/legacy-themes/`, **nie ändern**) → Ids `classic-<name>`.
- **Ein altes Design anpassen** (z. B. „Norton“ ≠ `crimson`!): nur `legacy-tweaks.ts`, Eintrag `<name>` –
  `--color-*` setzt App-Tokens nach der Umrechnung, `--fnf-*` ersetzt alte Variablen davor; gilt auch für Importe
  gleichen Namens. Test in `legacy-theme.spec.ts` („fill the gaps of the old files“) ergänzen.
- **Neues Token** (eigene Farbe für ein UI-Teil): `tokens.ts` (`t(name, group, label)`), Default in `styles.css`
  (`:root`, meist `var(--color-surface)`/`var(--color-text)`), dieselbe Zeile in allen drei `themes/*.json`,
  deutsches Label in `theme-labels.de.ts`, bei Text/Hintergrund ein Kontrastpaar `p(...)` in `theme-logic.ts`
  (`CONTRAST_PAIRS`). Alte Designs bekommen Defaults automatisch.
- Neues Paar/Token ändert `docs/legacy-themes-contrast.md`: neu schreiben mit
  `UPDATE_LEGACY_REPORT=1 pnpm test`.
- Komponenten-CSS ist gekapselt: geteilte Komponenten (z. B. `context-menu.css`) über lokale Variablen mit
  Fallback öffnen (`var(--context-menu-bg, var(--color-surface))`), gesetzt per Klasse am Host (`tab-bar.css`
  `.folder-dropdown`). Hover/Fokus-Farbe gegen den neuen Hintergrund prüfen (Norton: `--color-selection` ≈ Türkis).
- Werte eines Designs nachsehen: Wegwerf-Spec mit `expect(keys.map(k => theme.tokens[k])).toEqual([])` und
  `pnpm exec ng test --watch=false --include <spec>`. Sichtprüfung ohne Tauri:
  `pnpm screenshots --theme classic-norton,crimson --scene actions-menu,folder-menu,context-menu --out <dir>`
  (~15 s, Szenen in `scripts/screenshots/scenes.json`).

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
