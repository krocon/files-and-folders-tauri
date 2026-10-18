# Architektur

Stand: Prompt 009 (Suche) auf Basis von 001–008. Dieses Dokument beschreibt Entscheidungen, nicht Wünsche – geplante Teile
sind als solche markiert.

## Überblick

```
┌──────────────── WebView (Angular 22, zoneless) ────────────────┐
│  Workspace (Grid, Splitter) ── WorkspaceStore (Root: Tabs beider│
│   │                             Seiten, aktive Seite, Favoriten)│
│   ├ FilePanel ×2 (Header, TabBar, FileList, Statuszeile)        │
│   │   └ FileList ─ <guiexpert-table> ─ FileListController       │
│   │                 └ TableBridge (Fassade, State je Tab)       │
│   │   FileBrowserStore (Signals, pro Panel bereitgestellt)      │
│   └ ButtonBar (Gerüst, buttons.json)                           │
│  FsApi / SessionApi (abstrakt) ── Tauri*Api: einzige invoke()s  │
└──────┼─────────────────────────────────────────────────────────┘
       │  IPC: list_directory, load_session, save_session
┌──────┼──────────────── Rust (Tauri 2) ─────────────────────────┐
│  commands.rs  Eingabe validieren, Default (Home) auflösen,     │
│               Arbeit per spawn_blocking vom Async-Runtime fern  │
│  listing.rs   read_dir + symlink_metadata, Sortierung          │
│  paths.rs     Validierung, lexikalische Normalisierung,        │
│               Eltern/Breadcrumbs (nur std::path)               │
│  model.rs / error.rs  DTOs (camelCase) und FsError {code,..}   │
│  session.rs   Sitzungsdatei (laden, sanitize, atomar speichern)│
│  window_state.rs  Fenstergeometrie wiederherstellen/erfassen   │
└────────────────────────────────────────────────────────────────┘
```

## Entscheidungen

| Thema | Entscheidung | Begründung |
| --- | --- | --- |
| Projektgerüst | `ng new` (Angular 22.2) + `tauri init` statt `create-tauri-app` | Das Template bringt nicht garantiert Angular 22; so sind beide Toolchains aktuell und offiziell. Angular nutzt den `@angular/build`-Builder (esbuild/Vite). |
| Change Detection | zoneless, `OnPush`, Signals | Vorgabe; weniger Overhead, klarer Datenfluss. |
| Zustand | `FileBrowserStore` als `@Injectable()` **ohne** `providedIn: 'root'`, im Komponenten-Provider | Ein Store pro Panel → Tabs/Dual-Pane (Phase 5) ohne Umbau. |
| Backend-Zugriff | Abstrakte Klasse `FsApi` als DI-Token, `TauriFsApi` als Implementierung | UI ruft nie direkt `invoke()`; Tests nutzen `FakeFsApi`. |
| Veraltete Antworten | Monotone Request-ID im Store | Schnelles Navigieren kann ältere Antworten nicht mehr anzeigen. |
| Fehler | Rust `FsError { code, message, path }` mit `snake_case`-Codes; Frontend `toFsError()` + `describeFsError()` | Stabile Codes für UI-Texte, Originalmeldung als Detail. |
| Pfade | Pfade sind opake Strings aus dem Backend; Eltern/Breadcrumbs berechnet Rust | Keine Separator-Annahmen im Frontend (Windows `C:\`, UNC, Unix). |
| Pfadvalidierung | absolut, nicht leer, kein NUL; `.`/`..` lexikalisch aufgelöst; **kein** `canonicalize` | `canonicalize` löst Symlinks auf (Navigation „springt“) und erzeugt unter Windows `\\?\`-Präfixe. |
| Symlinks | `symlink_metadata` für den Eintrag, `metadata` für den Ziel-Typ (`targetKind`); Symlinks auf Ordner sind navigierbar | Total-Commander-ähnlich; „Up“ aus einem verlinkten Ordner führt lexikalisch zurück. |
| Hidden | Dot-Name auf allen Plattformen + `FILE_ATTRIBUTE_HIDDEN` (Windows) + `UF_HIDDEN` (macOS) | Plattformspezifik hinter `cfg`-Funktionen gekapselt. |
| Nicht-UTF-8-Namen | Name verlustbehaftet angezeigt, `lossyName: true`, Navigation gesperrt | Pfade laufen als JSON-Strings über IPC; volle Unterstützung braucht eine Byte-/Token-Repräsentation (später). |
| Einzelfehler | Ein nicht lesbarer Eintrag lässt das Listing nicht scheitern (`kind: unknown`, `unreadableEntries`) | Robustheit bei gesperrten/flüchtigen Dateien. |
| Blockierende I/O | `async` Command + `tauri::async_runtime::spawn_blocking` | UI- und IPC-Threads bleiben frei. |
| Sicherheit | Capabilities nur `core:default`; keine fs/shell-Plugins; strikte CSP | Minimale Angriffsfläche. Eigene Commands sind über `invoke_handler` registriert. |
| CSP & Styles | `dangerousDisableAssetCspModification: ["style-src"]` | Tauri ergänzt sonst Hashes in `style-src`, wodurch `'unsafe-inline'` ignoriert wird und Angulars zur Laufzeit eingefügte Komponenten-Styles blockiert würden (in der App verifiziert). `script-src` bleibt strikt. |
| Styling | SCSS + Design-Tokens in `src/styles.scss`, Dark-Mode per `prefers-color-scheme` | Kein UI-Framework nötig. |
| Abhängigkeiten | Laufzeit: Angular, `@tauri-apps/api`, `@guiexpert/table` + `@guiexpert/angular-table` (Major = Angular-Major), `tauri`, `serde`, `serde_json` (seit 004: Sitzungsdatei lesen/schreiben; ohnehin über Tauri im Baum), `open` 5 (seit 003: Standard-App starten ohne Shell, MIT/Apache, Basis von `tauri-plugin-opener`), `libc` (nur Unix, seit 006: Umbenennen ohne Ersetzen mit `renameat2`/`renamex_np`), `trash` 5.2 (seit 006: Papierkorb je OS, MIT, ohne Default-Features; Windows `IFileOperation` mit Rückgängig, macOS Finder mit „Zurücklegen“, Linux freedesktop – Verhalten in `prompts/006-basis-operationen.design.md` E1), `regex` 1.13 (seit 009: Namens-/Inhaltssuche mit garantiert linearer Laufzeit und Größenlimit – kein Backtracking, also kein ReDoS durch Nutzermuster; MIT/Apache, war über Tauri schon im Baum). 010 und 011 (Laufwerke, Tools, Terminal, Zwischenablage) ohne neue Abhängigkeit. 010: Kodierungen (UTF-8/16, Windows-1252, Latin-1) und Typ-Erkennung selbst (`preview/`), kein `encoding_rs`, keine `image`-Crate, kein Monaco. `notify` 8 (seit 012: Ordner überwachen, CC0/MIT/Apache, Standard im Rust-Ökosystem – cargo-watch, watchexec, rust-analyzer; eigene Entprellung statt `notify-debouncer-*`). Dev: `tempfile`, angular-eslint, Prettier, Vitest/jsdom | GuiExpert Table: virtuelles Scrollen für 100 000+ Zeilen, 0 Runtime-Abhängigkeiten, MIT, gleicher Autor (Lücken werden im Mono-Repo geschlossen). Router, Forms und das Log-Plugin des Templates wurden entfernt. |
| Dateivorschau (010) | `read_preview` liest höchstens 8 KiB Kopf + Text bis 1 MiB (max. 8 MiB) bzw. 4 KiB Hex (max. 64 KiB); Typ per Magic Bytes, Endung nur für den Hinweis „passt nicht“; FIFOs/Geräte werden nie geöffnet (`O_NONBLOCK`); Inhalte werden nie geloggt | 2-GB-Dateien füllen keinen Speicher; Endungen sind nicht vertrauenswürdig. Details: `prompts/010-vorschau-eigenschaften.design.md` E2. |
| Bilder in der Vorschau (010) | eigenes URI-Schema `fnfpreview` (`register_asynchronous_uri_scheme_protocol`, eigener Thread): liefert nur Dateien, die `read_preview` als Bild erkannt hat, über 128-Bit-Einmal-Token (max. 16), prüft beim Abruf erneut (reguläre Datei, ≤ 256 MiB, Magic Bytes), `nosniff`, `no-store`, SVG mit eigener CSP. **CSP:** `img-src 'self' data: fnfpreview: http://fnfpreview.localhost` | Asset-Protocol bräuchte einen Scope über alle Nutzerdateien; `data:`-URLs großer Fotos blähen IPC und JS-Heap; Verkleinern in Rust bräuchte die `image`-Crate. Keine Plugins, keine neuen Capabilities. |
| Text in der Ansicht (010) | DOM nur per `textContent` (Zeilen-Elemente in Blöcken zu 500 mit `content-visibility: auto`), Treffer als `<mark>`; HTML/SVG/Markdown werden als Quelltext gezeigt, nie gerendert | Dateiinhalte sind Nutzerdaten; kein `innerHTML`, kein Skript-Ausführen. |
| Dateiliste | GuiExpert Table, **ein** `TableModel` je Panel, Ordnerwechsel nur über `setRows` + `reSort` + `repaintHard` | Spaltenbreiten und Sortierung bleiben erhalten; ein neues Modell-Objekt würde die Table neu aufbauen. Details und Belege: `prompts/001-guiexpert-dateiliste.design.md`. |
| Cursor | Table-Fokus (`FocusModel`, Spalte 0) ↔ `FileBrowserStore.cursorPath`, Abgleich über den Pfad; Darstellung als Zeilenklasse `fnf-cursor` | Fokus der Table ist index-basiert und zellbasiert; der Pfad ist sortierfest. Nach Header-Sortierung (Doppelklick, ohne Ereignis) stellt ein Capture-Listener den Cursor per Pfad wieder her. |
| Markierung | eigenes `Set<path>` im Store, `SelectionModel` der Table auf `none` | Das `SelectionModel` ist index-basiert und überlebt kein Sortieren. Anzeige: Klasse `fnf-marked` + Häkchen statt Icon (wie die alte Version), Screenreader-Text „marked“. |
| Sortierung | Comparatoren je Spalte (`f * …`-Trick: Ordner oben, leere Werte unten in beiden Richtungen), natürliche Namensordnung per `Intl.Collator` mit Selbsttest | Der Collator fällt auf `en` zurück, wenn die Laufzeit nach Codepunkten sortiert (WebKitGTK mit `LANG=C.UTF-8`, im Container beobachtet). |
| Tastatur/Maus | Table-Aktionen über `shortcutService.addListener` (Leertaste, Strg/⌘+A, Strg/⌘+Shift+A), ungemappte Tasten am Host (Enter, Backspace, Einfg, Shift+Pfeile), Klicks über `api.subscribe` (ohne 150-ms-Entprellung des Wrappers) | Übergangslösung bis zum Aktionssystem (Prompt 002). `Pos1`/`Ende` per `shortcutActionIdMapping` auf erste/letzte Zeile, Strg/⌘+X aus dem Live-Mapping entfernt. |
| Fensteraufbau | CSS-Grid mit gemeinsamer Spaltenbreite (`--fnf-split`), Panels als `display: contents`, ein Trenner über die Zeilen 1–4 | Ein Splitter verschiebt alle Zeilen; Zeilenhöhen beider Seiten bleiben gleich. Details: `prompts/004-dual-pane-tabs.design.md`. |
| Tabs | Tab-Liste beider Seiten im Root-`WorkspaceStore`; **eine** Table je Panel, beim Tab-Wechsel Zustand über `getState/applyState(['columns','sort','scroll'])` | n Tables wären n× Speicher und versteckte Tables ohne Layout; der Ordner wird beim Wechsel ohnehin neu gelesen. |
| Sitzungszustand | eigene JSON-Datei `<app_config_dir>/session.json` (`version: 1`), geschrieben von Rust (temp + rename), Frontend speichert entprellt (400 ms) und beim Verstecken; kaputte Datei → Defaults + Warnung + `session.json.bad` | Keine Plugins mit generischem Zugriff; Rust begrenzt alle Werte (`sanitize`). Fenstergeometrie schreibt/liest nur Rust (Fenster startet unsichtbar, Position nur auf vorhandenem Monitor) – das Frontend braucht keine Fenster-Berechtigungen. |
| Aktionen | Katalog mit stabilen Ids (`core/actions/action-catalog.ts`), Handler registrieren Features beim Root-`ActionService`; fehlende Handler = gedimmt mit „kommt in Prompt …“ | Jede Funktion ist über Kürzel, Button, Menü und Palette gleich erreichbar; spätere Prompts registrieren nur. Details: `prompts/002-aktionen-tastatur.design.md`. |
| Tastatur | ein Capture-Handler an `document` (`KeyboardDispatcher`), kanonische Notation `Mod+Ctrl+Alt+Shift+Taste` aus `key` mit `code`-Rückfall (Ziffern, Numpad, ⌥ auf macOS), Auswertung auf `keydown` | Vermeidet die Matching-Fehler von mr (Modifier-Reihenfolge, Aliasse) und funktioniert mit deutscher Tastatur; einfache Tasten wirken nur in der Liste, Navigationstasten bleiben bei der GuiExpert Table. |
| Keymaps | Defaults als JSON je OS im Frontend, Nutzer-Override `keymap.json` (Rust schreibt atomar, kaputt → `.bad`), je Aktion gemischt, Konflikte/Fehler als Hinweis | Eine Quelle für Dispatcher, Badges, Menü und Palette; Rust prüft nur Form und Größe. |
| Navigation | „..“ als synthetische Zeile im Tabellenmodell; Zurück/Vor und Zustand je Ordner in `TabMemory` je Tab (nur im Speicher, LRU 50); „zuletzt besucht“ in `session.json` | Siehe `prompts/003-navigation-liste.design.md`. |
| Filter | Hidden + Schnellfilter je Tab als `externalFilterFunction` der Table (ein Prädikat aus dem Store) | 100 000 Zeilen in wenigen ms; Markierung bleibt bei ausgeblendeten Einträgen erhalten (Hinweis in der Statuszeile). |
| Ordnergröße | `calc_dir_size` iterativ, folgt keinen Symlinks, Abbruch-Token, Fortschritt über `Channel` | Zyklensicher; Job-Engine kommt mit 005. |
| Dateien öffnen | eigener Command `open_file` + Crate `open` (Argument-Array), Programme nur nach Rückfrage | Kein `tauri-plugin-opener` mit breiter Pfad-Capability. |
| Jobs | Rust `jobs/`: `JobManager` mit serieller Warteschlange (+ Hintergrund-Jobs), ein Thread je laufendem Job, `Control` (Abbruch-Flag, Pause und Konfliktantwort über `Mutex`+`Condvar`, jede Wartestelle wacht beim Abbruch auf); Ereignisse über **einen** `Channel` je WebView; Fortschritt max. 10/s | Jobs blockieren absichtlich (Frage, Pause) – nicht im Tokio-Pool. Details: `prompts/005-job-queue.design.md`. |
| Kopieren | Planung zuerst (Ziel in Quelle / auf sich selbst abgelehnt), Datei → `.fnf-<job>-<n>.part` im Zielordner → Hard-Link bzw. `rename`; Symlinks als Link; Konflikte als Frage; Fehler je Eintrag gesammelt; „Platte voll“ pausiert | Nie eine halbe Datei unter dem echten Namen; eine während des Kopierens aufgetauchte Datei wird nicht ersetzt. |
| Verschieben | gleiches Volume: `rename` (ganzer Eintrag, Ordner mit freiem Ziel ebenso); sonst und beim Zusammenführen je Datei: Hard-Link + Quellname löschen (scheitert atomar, wenn das Ziel existiert) bzw. Kopie wie oben und Quelle **erst danach** löschen; geleerte Quellordner nur per `remove_dir` | Abbruch, Fehler oder „Platte voll“ lassen jede Datei an genau einem Ort. |
| Löschen | Papierkorb (Standard) mit Crate `trash`; endgültig: Kinder zuerst, Links werden entfernt, nie verfolgt; schreibgeschützte Einträge fragen (`Conflict.kind = readOnly`) | Sicherer Default; Windows warnt selbst, wenn ein Laufwerk keinen Papierkorb hat. |
| Schnelle Operationen | `make_dir` (auch `a/b/c`), `create_file`, `rename_entry` als Commands ohne Job – sie überschreiben nie | Kein Fortschritt nötig; Umbenennen nur der Groß-/Kleinschreibung über einen Zwischennamen. |
| Schutz | `paths::validate_name` (Windows-Regeln unter Windows), `paths::danger_of` (Wurzel, Volume, Home, Systemordner): Verschieben, Umbenennen, Löschen nur mit `allowDangerous` nach zweiter Bestätigung | Rust entscheidet, das Frontend zeigt nur an. |
| Dialoge der Operationen | `OpsStore` (Root) baut die Anfrage (Auswahl „Markierung, sonst Cursor“, Zielvorschläge, Live-Zählung als Hilfs-Job `count`) und führt aus; Dialoge sind dünn | Nach der Operation: Cursor auf das Ergebnis bzw. den nächsten Eintrag, Markierungen weg, betroffene Ordner laden über `dirsChanged` neu. Details: `prompts/006-basis-operationen.design.md`. |
| Umbenennen in der Liste (F2) | Editor der GuiExpert Table in der Namenszelle (`startEditing`, eigener `CellRendererIf`); das Modell schreibt nie (`setValue` → false), der Name geht an Rust | Kein Overlay nötig; Entwurf überlebt Repaints. |
| Multi-Rename | Namen rechnet nur die TS-Engine (`features/multirename/rename-engine.ts`, JS-Regex wie in den alten Versionen), Rust rechnet nie Namen: `plan_rename` prüft Paare `{ path, newName }` (Name, Dubletten mit gemessener Groß/klein-Empfindlichkeit, Ziel vorhanden per Inode/Datei-Index, Ketten/Tausch), der Job `rename` führt aus (`rename_noreplace`, Ketten in Reihenfolge, Zyklen über `.fnf-rename-…` mit Rücknahme bei Fehlern) | Eine Quelle der Wahrheit je Aufgabe; Vorschau ohne IPC je Tastendruck; Ausführung und Prüfung im Backend (destruktiv). Design 007 |
| Rückgängig (Rename) | Rust merkt sich je Rename-Job die ausgeführten Paare (neuer Pfad → alter Name), nur im Speicher, letzte 20; `undo_rename` startet einen neuen Rename-Job (Teilausführung erlaubt); `JobInfo.undoAvailable` + Ereignis `undoAvailable` | Keine Protokolldatei mit Nutzerpfaden; ein Undo ist selbst wieder rückgängig zu machen |
| Multi-Rename-Vorlagen | `<app_config_dir>/rename-presets.json` (`version: 1`, `last` + max. 100 benannte), Rust prüft nur Form und Größe (Regeln als `serde_json::Value`), kaputt → `.bad` | Wie `keymap.json`; 015 kann die Datei übernehmen |
| Gruppieren (008) | Gruppe je Eintrag rechnet die TS-Engine (`features/groupfiles/group-engine.ts`, Unicode-Wörter, geprüfte Gruppennamen); Job `group` legt je Gruppe `<wurzel>/<gruppe>` an (nur echter Ordner wird zusammengeführt, Datei/Link = Fehler der Gruppe) und gibt Paare *Quelle → Zielordner* an die Copy/Move-Engine (`copy::run_pairs`) | Ein Job, eine Konfliktfrage-Reihe, ein Abbruch; Konflikte, Temp+Umbenennen und Pause wie 005/006. Design 008 E1/E2 |
| Ordner aufräumen (008) | `find_empty_dirs` (Command, schreibt nie, abbrechbar per `scan_id` + `cancel_clean_scan`): folgt keinen Links, betritt keine fremden Dateisysteme, nie oberhalb des Startordners, Startordner nur auf Wunsch, Systemmüll und Namensmuster optional, Grenze 500 000 Einträge. Job `clean` prüft **jeden** Eintrag erneut (in einer Wurzel, kein Link auf dem Weg, nicht gefährlich, jetzt leer bzw. nur Müll, Datei passt noch) und löscht Kinder vor Eltern – Papierkorb oder endgültig – unter Unix relativ zur Wurzel per `openat(O_NOFOLLOW)` + `unlinkat` (`platform::remove_below`), nie `remove_dir_all` | Die Vorschau ist nur ein Vorschlag; was sich seit der Suche geändert hat, bleibt stehen. Design 008 E3 |
| Multi-MkDir (008) | Namen aus der TS-Engine (`mkdir-engine.ts`), `create_folders(parent, names)` legt je Name an (nie überschreiben, Fehler je Name, max. 1 000) | Kurz und nicht destruktiv → Command wie `make_dir` |
| Laufwerke (011) | eigene Implementierung in `platform/volumes.rs` statt `sysinfo`: Linux `/proc/self/mountinfo` ohne Pseudo-FS/Systempfade, macOS `/Volumes` (nur Namen), Windows `GetLogicalDrives`/`GetDriveTypeW`/`GetVolumeInformationW`/`GetDiskFreeSpaceExW` (FFI auf `kernel32` von Hand); Größe/Label je Volume in eigenem Thread, max. 1,5 s, hängende Abfragen werden nicht erneut gestartet | `sysinfo` ruft `statvfs` synchron je Mountpoint (ein totes NFS blockiert) und bringt viel Fremdes mit; drei Windows-Funktionen rechtfertigen keine Crate |
| Dateimanager / Terminal (011) | `platform/desktop.rs`: macOS `open -R` / `open -a Terminal`, Windows `explorer.exe /select,"…"` (raw arg) / `wt.exe -d` (bei `;` im Pfad `cmd.exe`, da `wt` `;` als Befehlstrenner liest), Linux D-Bus `FileManager1.ShowItems` per `dbus-send` (sonst Ordner mit Standard-App) / Terminal-Kette `$TERMINAL` → `x-terminal-emulator` → Desktop (KDE/GNOME/…) → bekannte Terminals; eigenes Terminal in `tools.json` | Schmale Commands, Pfad im Backend geprüft, Argument-Arrays; keine Plugins |
| Externe Tools (011) | `tools.rs` + Command `run_tool(toolId, context)`: Programm/Argumente nur aus `<app_config_dir>/tools.json` (Defaults je OS, mr-Format beim Laden umgestellt), Platzhalter je Argument (`{files}` = n Argumente), `std::process::Command` ohne Shell, eigene Prozessgruppe, Reaper-Thread; Frontend schickt nur Id + Pfade | Kein `tauri-plugin-shell` (Scope in Capabilities, Frontend schickte das Kommando); Injection über Dateinamen ausgeschlossen (Test `tools::tests::file_names_are_never_run_as_commands`) |
| Tools als Aktionen (011) | `ActionService.setExtras` (Id `tool:<id>`), Palette/Actions-Menü/Dispatcher kennen Extras; Keymap-Kürzel gewinnen, Konflikte werden gemeldet | Tool-Ids kommen aus der Konfiguration, der Katalog bleibt statisch |
| Zwischenablage (011) | `ClipboardApi` → `navigator.clipboard.writeText`, Rückfall `execCommand('copy')`; Text = Zeilen, JSON = Array | Kein Plugin/keine Crate nötig – die Webview schreibt Text (in WebKitGTK geprüft); Datei-Zwischenablage je OS offen |
| Suche (009) | Job `search` (parallel, Hilfs-Job ohne Nachfrage beim Beenden): eigene Tiefensuche in `search.rs` (keine Crate `walkdir`/`ignore`), Namen per Crate `regex` (Glob → Regex, Text, Regex; Größenlimit des Automaten), Links nur mit Option und dann je Ordner-Identität (dev+ino bzw. kanonischer Pfad) höchstens einmal betreten, unlesbare Ordner gesammelt, `maxHits` ≤ 100 000, Inhalt in 64-KiB-Blöcken bis zum Größenlimit. Treffer gebündelt (≤ 500 bzw. alle 50 ms) als Ereignis `searchHits` über den **einen** Job-Kanal – nie im `JobInfo`. Frontend: `SearchStore` (Root) sammelt je Ergebnis, veröffentlicht höchstens alle 300 ms, verwirft fremde Job-Ids, neue Suche bricht die alte ab | Lange Operation = Job (Abbruch, Fehler, Ende wie alle); kleine Ereignisse statt eines riesigen DTOs (Erfahrung 001). Design 009 E1/E2 |
| Ergebnis-Tabs (009) | `TabState.search = { key, label }` verweist auf ein Ergebnis im `SearchStore`; das Panel zeigt es über `FileBrowserStore.showSearch` (synthetisches Listing, `path()` = `null`, `locationKey()` = `search:<key>`); Spalte „Folder“ per `setColumnVisible`; Kopieren/Verschieben/Löschen arbeiten auf vollen Pfaden, Gelöschtes verlässt das Ergebnis; Such-Tabs werden beim Speichern zu Ordner-Tabs | Keine zweite Dateiliste; alles, was einen Ordner braucht, ist dort automatisch aus. Design 009 E4 |
| Kürzel 009 + 010 (Merge) | `Alt+F10` (macOS `⌥F10`) gehört dem Ordner-Finder `OPEN_FOLDER_FINDER_DLG` (TC: Alt+F10 = Verzeichnisbaum), `OPEN_CHDIR_DLG` behält `Mod+L` (macOS zusätzlich `⌘⌃D`). 010 bringt `QUICK_VIEW` (`Ctrl+Q`, macOS `⌃Q`) und `OPEN_ATTRIBUTE_DLG` (`Alt+Enter`, macOS auch `⌘I`), 009 `RERUN_SEARCH` (`Mod+Shift+F7`) und `GOTO_FILE` (`Mod+Shift+G`) – keine Doppelbelegung | Beim Zusammenführen geprüft: jedes Kürzel je OS nur einer Aktion. |
| Bundle-Budget (Merge 009 + 010) | `angular.json`: initial Warnung 1,2 MB, Fehler 1,5 MB (vorher 500 kB / 1 MB) – mit Suche und Vorschau zusammen liegt das Initial-Bundle bei ~1,01 MB (~230 kB gzip) | Desktop-App lädt lokal aus dem Bundle, kein Netz; Budget bleibt als Wächter gegen Ausreißer. Lazy-Loading der Dialoge (`@defer`) wäre die Alternative, wenn das Bundle weiter wächst. |
| F4 (Merge 010 + 011) | `OPEN_EDIT_DLG` (F4) gehört dem Tool `edit` (`os-actions.ts`); dessen Default je OS übergibt an die Standard-App (Linux `xdg-open`) bzw. den Texteditor – das 010-Verhalten ist damit der Default. Der Handler aus `preview-actions.ts` entfällt. Kürzel 011 (`Mod+Alt+N/C`, `Mod+Shift+F/C/X`) per Skript gegen 009/010 geprüft: keine Doppelbelegung je OS | Eine Aktion, ein Handler; Tools sind konfigurierbar. |
| Menüs (014) | **Ein** Menümodell `features/menus/menu-model.ts` (Aktions-Ids, Trenner, Untermenüs, `@tools`) für Kontextmenü, HTML-Menüleiste, Actions ▴ und das native Menü; jeder Eintrag ruft `ActionService.runAny(id)`. Kontextmenü = eigenes APG-Widget (`context-menu.ts`, Untermenüs, Badges), Rechtsklick setzt den Cursor, Markierung bleibt; `OPEN_CONTEXT_MENU` (`Shift+F10`, Kontextmenü-Taste) nur mit Fokus in der Liste | Keine Menü-Logik, Themes/Tests wie der Rest der App; natives `popup` hätte je Öffnen einen IPC-Rundlauf gebraucht. Design 014 E1–E4 |
| Menüleiste (014) | macOS **nativ** (`app_menu.rs`, `set_app_menu(spec)` + Kanal `subscribe_menu`; reine Statusänderungen nur per `set_menu_enabled(items)`, kein Neuaufbau, App-/Bearbeiten-/Fenster-Menü mit `PredefinedMenuItem`); Windows/Linux **HTML** (`menu-bar.ts`, APG menubar, `Alt+M`). Accelerator kommen aus der Keymap (Rust übersetzt nur `Mod`/`Ctrl`/F-Tasten, ein Strich) – schlichte Tasten und `Alt+Buchstabe` bleiben bei der Seite. Echo eines Tastendrucks (< 400 ms) wird verworfen, bei offenem Dialog sind Aktions-Einträge aus. `FNF_NATIVE_MENU=1` erzwingt nativ (Diagnose) | Ohne Bearbeiten-Menü kein ⌘C/⌘V in Textfeldern auf macOS; GTK/Win32-Accelerator fangen Tasten vor der WebView ab. Design 014 E5–E7 |
| Vorschau-Tabellen | `shared/preview-grid/` – GuiExpert Table mit Spalten/Zeilenklasse als Input, Modell einmal gebaut, `setRows` + `repaintHard` | Gemeinsam für Gruppieren, Aufräumen, Multi-MkDir |
| Überwachung (012) | Rust `watch/`: **ein** `notify`-Watcher (inotify/FSEvents/ReadDirectoryChangesW) für die sichtbaren Ordner beider Panels (max. 8, nicht rekursiv), `PollWatcher` (2 s) als Rückfall; Netzlaufwerke (`statfs`/`MNT_LOCAL`/`GetDriveTypeW`) `off` per Default. Ein Thread entprellt je Ordner (150 ms Ruhe, spätestens 400 ms), stat-et die betroffenen Namen neu → `changes`; > 500 Namen oder verlorene Ereignisse → `rescan` (höchstens alle 1,5 s); Ordner selbst weg → `gone`. Ein `Channel` je WebView (`subscribe_watch`), `watch_dirs` ersetzt die Menge | Frontend wendet Deltas per Pfad an (kein Repaint ohne Änderung, Deltas während eines Ladens werden danach erneut angewendet); Jobs (`dirsChanged`) und Watcher laufen über `requestRefresh` – ein Neuladen gleichzeitig, eins vorgemerkt. Design 012 E1–E4 |
| Drag & Drop (012) | eigene Pointer-Logik (kein HTML5-DnD: Tauri fängt es unter Windows ab; kein Row-Drag der Table: der sortiert um), Zielzeile über `TableBridge.rowIndexAt` (Lücke G18), Ablegen öffnet **immer** den Kopieren/Verschieben-Dialog (`OpsStore.openCopyMoveFor`); von außen: `onDragDropEvent` des Webviews (Capability `core:event:default`), Pfade prüft `describe_paths` | Nie destruktiv ohne Bestätigung; keine Plugins. Ziehen ins System bewusst offen (Design 012 E7) |
| Modale Dialoge | Fenster dahinter `inert` | Fokus und Klicks bleiben im Dialog (aria-modal allein reicht nicht). |
| Farbbrücke | `src/styles/ge-table-theme.scss` setzt `--ge-table-*` auf dem Table-Host aus unseren Listen-Tokens (`--color-list-*`, im aktiven Panel `--color-active-*`); `html[data-theme]` = `light`/`dark` aus dem Schema | Einzige Stelle, die die Table-Variablen kennt; Grundlage für Prompt 019. |
| Farbschemata (013) | Ein Schema = `{ id, name, dark, tokens }` (CSS-Werte, `var()`-Verweise erlaubt); Katalog `core/theme/tokens.ts` (Gruppen, Art); eingebaut `light.json`/`dark.json` = `styles.scss` (Test); `ThemeService` (Root) setzt die Tokens inline auf `<html>`, ergänzt fehlende aus light/dark, Auswahl `system`/`fixed`; `<app_config_dir>/themes.json` (eigene Schemata + Auswahl), Rust prüft Form/Größe und harmlose Werte (kein `url(`, `;{}<>\@`), kaputt → `.bad`; Import/Export als Datei über `import_theme`/`export_theme` (kein Dialog-Plugin) | Ein Design ist nur ein Satz Token-Werte. Kontrast (WCAG AA) als reine Logik + Test über alle Schemata. Design 013 |
| Alte Designs (019) | Die acht `{name, colors}`-Dateien der alten Version liegen unverändert unter `core/theme/legacy/` und werden zur Laufzeit umgerechnet (`legacy-theme.ts`: `var()` auflösen, Lücken füllen, `--fnf-*` → Tokens nach `legacy-theme-map.ts`, Fehlendes ableiten, flach machen) und von `fixContrast` minimal (Richtung Schwarz/Weiß) auf WCAG AA gebracht; Import alter Dateien nutzt denselben Weg. Fokusring je Fläche (`--color-header/footer/dialog-focus`, per Container-Override von `--color-focus`) | Gleiche Datei = gleiches Schema (Import = eingebaut); keine handgepflegten Kopien; jede Abweichung vom Original steht im generierten Bericht `docs/legacy-themes-contrast.md` (Test). Design 019 |

## DTO-Vertrag

Rust `model.rs` ↔ TypeScript `src/app/core/fs/fs.models.ts`, Rust `session.rs` ↔ `src/app/core/session/session.models.ts` (manuell synchron gehalten; geplant:
Generierung oder ein Vertragstest, sobald mehr Commands existieren).

```ts
DirectoryListing { path, parent | null, segments[{name,path}], entries[], unreadableEntries }
DirEntry { name, path, kind: 'file'|'directory'|'symlink'|'unknown', targetKind,
           size | null, modifiedMs | null, hidden, lossyName }
FsError { code, message, path | null }
```

## Performance (Messung Prompt 001, Okt. 2026)

Ordner mit 100 020 Einträgen (`node scripts/make-big-dir.mjs <ziel>`), Linux-Container unter Xvfb, Release-Build:

| Schritt | Zeit |
| --- | --- |
| Rust `list_directory` (Metadaten lesen, sortieren) | 0,80 s |
| JSON-Serialisierung (20 MB, ~205 Byte/Eintrag) | 0,06 s |
| `list_directory` gesamt inkl. IPC (gemessen im Frontend) | 1,5 s |
| Table `setRows` + Sortieren + erstes Rendern | 0,17–0,40 s |
| Umsortieren per Spaltenkopf | 0,16 s |
| Scrollen / Strg+Ende | ohne spürbare Verzögerung |

Das Ziel „< 500 ms bis zur ersten Anzeige“ wird im Container verfehlt; der Engpass ist Backend + Transport, nicht die
Table. Auf dem Mac noch zu messen (Konsole: `[fnf:perf]`). Optionen (noch nicht umgesetzt, Kandidaten für Prompt
003/012): schlankeres DTO (Ordnerpfad einmal statt voller Pfad je Eintrag), Streaming in Blöcken über
`tauri::ipc::Channel` (erste Zeilen sofort), paralleles `stat`, binäres Format. Messung Rust allein:
`FNF_PERF_DIR=<ordner> cargo test --release perf -- --ignored --nocapture` (in `src-tauri`).

### Multi-Rename (Messung Prompt 007, Okt. 2026)

10 000 Dateien, Linux-Container unter Xvfb, Debug-Build: TS-Engine + Vorschauzeilen 10–25 ms (Vitest/jsdom),
`plan_rename` in Rust 280 ms (debug) bzw. 113 ms (release, `cargo test --release ten_thousand`); im Fenster steht die
neue Vorschau < 350 ms nach dem letzten Tastendruck (Namen ab 1 000 Einträgen 80 ms entprellt, damit die Eingabe
flüssig bleibt), die Rust-Prüfung ~1 s später (120 ms Entprellung + Prüfung + IPC im Debug-Build). Umbenennen von
10 000 Dateien als Job: ~1 s.

## Geplante Erweiterungen (noch nicht implementiert)

- **Vorschau-Provider (nach 010):** PDF, Markdown (sanitisiert im `sandbox`-iframe), Audio/Video (Range-Requests im Schema `fnfpreview`).
- **Suchindex:** bewusst keiner (009). Sinnvoll erst bei wiederholten Suchen über sehr große Bäume (> 1 Mio.
  Einträge) oder Inhaltssuche über viele GB – dann opt-in je Wurzel mit Überwachung (012), oder die Plattform-Indizes
  (Spotlight, Windows Search, `locate`) als externe Werkzeuge (011). Design 009 E7.
- **Plattform (nach 011):** echte Datei-Zwischenablage (NSPasteboard, `CF_HDROP`, `x-special/gnome-copied-files`),
  System-Dialog „Öffnen mit …“, Shell-Zeile/PTY (Design 011 E7).

### Suche (Messung Prompt 009, Okt. 2026)

200 000 leere Dateien in 400 Ordnern, Linux-Container, Release (`cargo test --release search_200k -- --ignored
--nocapture`): erster Treffer nach 2 ms, ganzer Baum 0,5 s, Abbruch-Reaktion < 1 ms (Prüfung je Eintrag). Im
Debug-Build der App: `*.mp3` über denselben Baum ~4 s, `Stop` beendet sofort (E2E).
