# Architektur

Stand: Phase 1 (MVP). Dieses Dokument beschreibt Entscheidungen, nicht Wünsche – geplante Teile
sind als solche markiert.

## Überblick

```
┌──────────────── WebView (Angular 22, zoneless) ────────────────┐
│  FileBrowser ── FileTable (präsentational, Tastatur)           │
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
| Abhängigkeiten | Laufzeit: Angular, `@tauri-apps/api`, `tauri`, `serde`. Dev: `tempfile` (Rust-Tests), angular-eslint, Prettier, Vitest/jsdom | Router und Forms wurden entfernt (noch nicht benötigt); das Log-Plugin des Templates ebenfalls. |

## DTO-Vertrag

Rust `model.rs` ↔ TypeScript `src/app/core/fs/fs.models.ts` (manuell synchron gehalten; geplant:
Generierung oder ein Vertragstest, sobald mehr Commands existieren).

```ts
DirectoryListing { path, parent | null, segments[{name,path}], entries[], unreadableEntries }
DirEntry { name, path, kind: 'file'|'directory'|'symlink'|'unknown', targetKind,
           size | null, modifiedMs | null, hidden, lossyName }
FsError { code, message, path | null }
```

## Geplante Erweiterungen (noch nicht implementiert)

- **Dateioperationen (Phase 3):** eigener Rust-Job-Manager mit IDs, Fortschritt über Tauri-Events,
  Abbruch per Cancel-Token, Konflikt-Callbacks; Papierkorb über eine plattformübergreifende Crate
  (Kandidat: `trash`, vor Einführung prüfen).
- **Suche (Phase 4):** Streaming-Ergebnisse über Tauri-Channels, Abbruch, kein Hintergrundindex.
- **Plattform (Phase 7):** Modul `platform/` mit `cfg`-Implementierungen für Laufwerke/Mountpoints,
  „Im Finder/Explorer zeigen“, Öffnen mit Standard-App (nur über schmale, validierte Commands).
