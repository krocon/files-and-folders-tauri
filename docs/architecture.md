# Architektur

Stand: Prompt 001 (GuiExpert-Dateiliste). Dieses Dokument beschreibt Entscheidungen, nicht Wünsche – geplante Teile
sind als solche markiert.

## Überblick

```
┌──────────────── WebView (Angular 22, zoneless) ────────────────┐
│  FileBrowser ── FileList ─ <guiexpert-table> (GuiExpert Table)  │
│                  └ FileListController ─ TableBridge (Fassade)    │
│      │                                                         │
│  FileBrowserStore (Signals, pro Panel bereitgestellt)          │
│      │                                                         │
│  FsApi (abstrakt) ── TauriFsApi: einziger invoke()-Aufrufer     │
└──────┼─────────────────────────────────────────────────────────┘
       │  IPC: invoke('list_directory', { path })
┌──────┼──────────────── Rust (Tauri 2) ─────────────────────────┐
│  commands.rs  Eingabe validieren, Default (Home) auflösen,     │
│               Arbeit per spawn_blocking vom Async-Runtime fern  │
│  listing.rs   read_dir + symlink_metadata, Sortierung          │
│  paths.rs     Validierung, lexikalische Normalisierung,        │
│               Eltern/Breadcrumbs (nur std::path)               │
│  model.rs / error.rs  DTOs (camelCase) und FsError {code,..}   │
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
| Abhängigkeiten | Laufzeit: Angular, `@tauri-apps/api`, `@guiexpert/table` + `@guiexpert/angular-table` (Major = Angular-Major), `tauri`, `serde`. Dev: `tempfile`, `serde_json` (Rust-Tests), angular-eslint, Prettier, Vitest/jsdom | GuiExpert Table: virtuelles Scrollen für 100 000+ Zeilen, 0 Runtime-Abhängigkeiten, MIT, gleicher Autor (Lücken werden im Mono-Repo geschlossen). Router, Forms und das Log-Plugin des Templates wurden entfernt. |
| Dateiliste | GuiExpert Table, **ein** `TableModel` je Panel, Ordnerwechsel nur über `setRows` + `reSort` + `repaintHard` | Spaltenbreiten und Sortierung bleiben erhalten; ein neues Modell-Objekt würde die Table neu aufbauen. Details und Belege: `prompts/001-guiexpert-dateiliste.design.md`. |
| Cursor | Table-Fokus (`FocusModel`, Spalte 0) ↔ `FileBrowserStore.cursorPath`, Abgleich über den Pfad; Darstellung als Zeilenklasse `fnf-cursor` | Fokus der Table ist index-basiert und zellbasiert; der Pfad ist sortierfest. Nach Header-Sortierung (Doppelklick, ohne Ereignis) stellt ein Capture-Listener den Cursor per Pfad wieder her. |
| Markierung | eigenes `Set<path>` im Store, `SelectionModel` der Table auf `none` | Das `SelectionModel` ist index-basiert und überlebt kein Sortieren. Anzeige: Klasse `fnf-marked` + Häkchen statt Icon (wie die alte Version), Screenreader-Text „marked“. |
| Sortierung | Comparatoren je Spalte (`f * …`-Trick: Ordner oben, leere Werte unten in beiden Richtungen), natürliche Namensordnung per `Intl.Collator` mit Selbsttest | Der Collator fällt auf `en` zurück, wenn die Laufzeit nach Codepunkten sortiert (WebKitGTK mit `LANG=C.UTF-8`, im Container beobachtet). |
| Tastatur/Maus | Table-Aktionen über `shortcutService.addListener` (Leertaste, Strg/⌘+A, Strg/⌘+Shift+A), ungemappte Tasten am Host (Enter, Backspace, Einfg, Shift+Pfeile), Klicks über `api.subscribe` (ohne 150-ms-Entprellung des Wrappers) | Übergangslösung bis zum Aktionssystem (Prompt 002). `Pos1`/`Ende` per `shortcutActionIdMapping` auf erste/letzte Zeile, Strg/⌘+X aus dem Live-Mapping entfernt. |
| Farbbrücke | `src/styles/ge-table-theme.scss` setzt `--ge-table-*` auf dem Table-Host aus unseren Tokens | Einzige Stelle, die die Table-Variablen kennt; Grundlage für Prompt 013/019. |

## DTO-Vertrag

Rust `model.rs` ↔ TypeScript `src/app/core/fs/fs.models.ts` (manuell synchron gehalten; geplant:
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

## Geplante Erweiterungen (noch nicht implementiert)

- **Dateioperationen (Phase 3):** eigener Rust-Job-Manager mit IDs, Fortschritt über Tauri-Events,
  Abbruch per Cancel-Token, Konflikt-Callbacks; Papierkorb über eine plattformübergreifende Crate
  (Kandidat: `trash`, vor Einführung prüfen).
- **Suche (Phase 4):** Streaming-Ergebnisse über Tauri-Channels, Abbruch, kein Hintergrundindex.
- **Plattform (Phase 7):** Modul `platform/` mit `cfg`-Implementierungen für Laufwerke/Mountpoints,
  „Im Finder/Explorer zeigen“, Öffnen mit Standard-App (nur über schmale, validierte Commands).
