# Design 071: MCP-Schnittstelle

> **Status:** umgesetzt (Stufen 0–2, Unix) · **Datum:** 2026-11-25 · **Auftrag:** `071-mcp-schnittstelle.md`
> Ohne Haltepunkt nach Phase 1 (Anordnung von Marc für diesen Lauf); das Sicherheits-Review (Phase 6) macht ein
> separater Agent. Offenes steht unter „Offen“, der Stand unter „Fortschritt“.

## Entscheidungen (Kurzfassung)

| | Entscheidung |
|---|---|
| **E1** | **stdio-Brücke** in derselben Binary (`files-and-folders-tauri --mcp`) ↔ **Unix-Domain-Socket** `…/<App-Daten>/mcp/fnf.sock` (Ordner `0700`, Socket `0600`, Peer-UID geprüft). Kein HTTP, kein Port. Windows: in v1 **nicht** (s. Offen). |
| **E2** | App läuft nicht / MCP aus → die Brücke antwortet selbst mit `mcp_disabled` und klarem Text. Die App wird **nie** gestartet. |
| **E3** | **Eigenes, schmales JSON-RPC** (nur Tools) statt `rmcp` – keine neue Abhängigkeit. |
| **E4** | Rückfrage im Fenster je Verbindung: **einmal / immer / ablehnen**; „immer“ = Name in `mcp.clients`. **Kein Token** (schützt nicht gegen Prozesse desselben Nutzers; gegen andere Nutzer schützen Socket-Rechte + Peer-UID). |
| **E5** | `read_text` nur mit `mcp.allowContent` (Default aus), höchstens 256 KiB (Default 64 KiB), nur Text laut `preview/detect.rs`, nur echte lokale Dateien (kein Archiv, kein Server), nie aus Geheimnis-Ordnern. Dasselbe gilt für `search.content`. |
| **E6** | `mcp.roots`, Default **leer = nur der Home-Ordner**. Geprüft wird der **physische** Ort (kanonisch). Die Ordner der App (Konfiguration, Daten, Cache) sind immer ausgenommen. Archive nur, wenn sie **in einem Tab offen** sind; Server nur bei **bestehender** Verbindung und nur `list_directory`. |
| **E7** | Multi-Rename bekommt den **Modus „Liste“**: feste Paare statt Regeln, gleiche Vorschau-Table, gleiches `plan_rename`, gleicher Job `rename`, gleiches Undo. |
| **E8** | Lange Tools sind **Jobs**; das Tool wartet bis **30 s**, danach `status: "running"` + `jobId` (+ bisherige Treffer); `get_job` liefert später das Ergebnis. `notifications/cancelled` bricht den Job ab. |
| **E9** | **`busy`**: Ist ein Dialog offen (oder wartet schon ein Vorschlag), wird jede Anfrage an die UI abgelehnt – keine Warteschlange. Nur die Kopplungs-Rückfrage wartet, bis das Fenster frei ist. |
| **E10** | v1 **nur Tools**. Keine Resources, keine Prompts. |

## Bestand

| Baustein | wofür | passt / fehlt |
|---|---|---|
| `JobManager::start` (`normalize` + `validate`) | jede Job-Art, Pfadprüfung, Gefahrenprüfung | passt – einziger Weg für Jobs, auch für MCP |
| `JobsState` (ein Sink → Frontend-Kanäle) | Ereignisse der Jobs | erweitert: **Abgriff** (`taps`) für Rust-Zuhörer |
| `paths::validate_job_path`, `archive::resolve`, `remote::is_remote`, `listing::describe_paths` | Prüfungen der Commands | passt – MCP ruft dieselben |
| `list_directory_or_archive`, `properties::properties`, `palette::Hub::query` (`detached`), `DiskUsageHub`, Jobs `search`/`duplicates`/`compare`/`diskUsage`/`checksum` | Stufe 0 | passt |
| `WorkspaceStore`, `FileBrowserStore` (je Panel) | Zustand der Panels | fehlt in Rust → **Spiegel** (`mcp_publish_state`) |
| `OpsStore.openCopyMoveFor`, `DeleteRequest`, `MultiRenameStore`, `MultiMkdirStore` | Dialoge der Stufe 2 | erweitert: Öffnen für **gegebene** Einträge, Vorschlag-Hinweis, Enter-Regel |
| `DialogKey`/`Modal` (057/076) | Dialog-Tasten | erweitert: Rolle **`confirm`** = `Mod+Enter`, nie Enter |
| `subscribe_menu` (014) | Rust → Frontend | Vorbild für `subscribe_mcp` |
| `run_shell` (021) | Einstieg von außen absichern | Vorbild: Einstellung in Rust lesen, nur Hauptfenster |

## E1 Transport

- **(a) stdio-Brücke + Unix-Socket – gewählt.** Claude Desktop und Claude Code starten `command` + `args`; dieselbe
  Binary mit `--mcp` braucht keine zweite signierte Datei (macOS: liegt im App-Bündel, `Contents/MacOS/…`). `main.rs`
  prüft das Argument **vor** `tauri::Builder` – es entsteht kein Fenster, kein WebView.
- **(b) HTTP auf 127.0.0.1 – verworfen für v1.** Ein Port ist für jede Webseite im Browser erreichbar (DNS-Rebinding,
  `fetch` auf localhost); Token + `Origin`/`Host`-Prüfung wären nötig und bleiben eine dauerhafte Angriffsfläche. Ein
  Unix-Socket ist für den Browser gar nicht erreichbar.
- **Socket-Pfad:** `mcp::socket_path()` rechnet ihn ohne Tauri (die Brücke hat keins): macOS
  `~/Library/Application Support/io.github.krocon.filesandfolders/mcp/fnf.sock`, Linux
  `$XDG_DATA_HOME|~/.local/share/…/mcp/fnf.sock`. App und Brücke benutzen dieselbe Funktion (ein Test hält den
  Bezeichner gegen `tauri.conf.json`). Zu langer Pfad (> 100 Bytes) → Fehler `socket_path_too_long` im Status.
  `FNF_MCP_SOCKET` überschreibt den Pfad für die Brücke immer, für die App **nur im Debug-Build** (Tests, Isolation).
- **Mehrere Instanzen:** Antwortet am Socket schon eine App, lauscht die zweite nicht (Status `in_use`). Ein toter
  Socket (Absturz) wird ersetzt.
- **Brücke:** reicht Zeilen (JSON-RPC, eine Nachricht je Zeile) durch. Ohne Verbindung beantwortet sie `initialize`
  und `tools/list` selbst (dieselbe Tabelle, dieselbe Binary) und versucht bei jedem `tools/call` neu zu verbinden;
  gelingt es, spielt sie das gemerkte `initialize` nach. So übersteht der Client einen Neustart der App oder das
  Aus- und Einschalten von MCP.
- **Windows:** Named Pipe mit ACL nur für den Nutzer und `windows_subsystem = "windows"` (kein stdio) sind hier nicht
  prüfbar → v1 meldet dort `unsupported` (Einstellung wirkungslos, Hinweis in den Einstellungen).

## E3 SDK

`rmcp` 3.11.0 (crates.io, 17.11.2026, Apache-2.0, MSRV 1.88; Features u. a. `server`, `transport-io`,
`transport-async-rw`, Default mit Makros/`schemars`) gegen ein eigenes Modul:

- Wir brauchen nur `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/cancelled`, `notifications/progress`
  über Zeilen-JSON – etwa 250 Zeilen, vollständig testbar, ohne Async-Laufzeit im Weg der Tools (Regel 10: eigene
  Threads).
- Die Brücke muss ohnehin selbst JSON-RPC sprechen (Antworten ohne App).
- Keine neue Abhängigkeit, kein neuer Lizenztext, kleinere Angriffsfläche; die Positivliste der Tools ist eine
  Tabelle in `tools.rs`, kein Makro.
- Preis: Protokoll-Neuerungen pflegen wir selbst. Unterstützte Versionen: `2024-11-05`, `2025-03-26`, `2025-06-18`,
  `2025-11-25` (Antwort = Version des Clients, sonst `2025-06-18`).

## E4 Kopplung – was schützt wirklich?

| Schutz | gegen |
|---|---|
| Socket `0600` im Ordner `0700` + Peer-UID | andere Nutzer des Rechners |
| kein Port | Webseiten, Netz |
| Rückfrage je Verbindung, Anzeige im Fenster, Protokoll, „Trennen“ | stiller Zugriff eines Prozesses des Nutzers |
| Stufen, Prüfungen in Rust, Bestätigung im Fenster | fehlgeleiteter oder kompromittierter Agent |

Ein Prozess desselben Nutzers kann den Namen eines „immer“ erlaubten Clients angeben – ein Token in der
Client-Konfiguration könnte er ebenso lesen. Deshalb kein Token; „immer“ ist Bequemlichkeit, die Grenze bleibt
Stufe 2. Die Rückfrage kommt beim **ersten Tool-Aufruf** (nicht bei `initialize`: Clients haben dort kurze
Zeitlimits), wartet höchstens 120 s und höchstens einmal je 30 s und Name (kein Fragen-Sturm). Namen werden auf 64
sichtbare Zeichen gekürzt.

## E6 Bereich

`Scope::check(path)`: `validate_job_path` (absolut, kein NUL, **kein `..`**) → `remote://` abgelehnt (eigener Weg) →
tiefster vorhandener Vorfahre **kanonisch** + Rest muss unter einer kanonischen Wurzel liegen und in keinem
App-Ordner. Ein Symlink in der Wurzel, der hinausführt, ist damit draußen. Treffer von Suche, Palette, Dubletten und
Vergleich werden zusätzlich lexikalisch gefiltert (App-Ordner). Für Inhalte (`read_text`, `search.content`) sind
außerdem `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, `~/Library/Keychains`, `.netrc`, `.env*`
gesperrt.

## Verträge

### Einstellungen (`settings-schema.json`)

`mcp.enabled` bool **false** · `mcp.allowContent` bool false · `mcp.roots` Liste (≤ 16, leer = Home) ·
`mcp.clients` Liste der „immer“ erlaubten Namen (≤ 16). Rust liest sie **selbst** aus `settings.json`
(`mcp::config`), nie aus einem Parameter des Frontends.

### Commands (`commands/mcp.rs`, nur Hauptfenster, alle asynchron)

| Command | Zweck |
|---|---|
| `subscribe_mcp(onEvent)` → `McpStatus` | Kanal für Anfragen an die UI und Statuswechsel |
| `mcp_sync()` → `McpStatus` | Einstellungen neu lesen: Server starten/stoppen, Wurzeln/Clients übernehmen |
| `mcp_publish_state(state)` | Spiegel der Panels (begrenzt, entprellt vom Frontend) |
| `mcp_reply(id, reply)` | Antwort auf eine Anfrage an die UI |
| `mcp_status()` → `McpStatus` | Zustand, Verbindungen, Protokoll (ohne Pfade) |
| `mcp_disconnect(connection?)` | eine oder alle Verbindungen trennen |

`McpEvent` = `{type:"request", id, request}` | `{type:"status", status}`.
`UiRequest.kind`: `pair`, `navigate`, `openTab`, `setCursor`, `mark`, `quickView`, `showResults`, `proposeCopy`,
`proposeMove`, `proposeDelete`, `proposeRename`, `proposeMkdir` – Einträge kommen als `DirEntry`/`SearchHit` aus Rust.
`UiReply` = `{ok:true, outcome?, jobId?, decision?}` | `{ok:false, code}`.

### Fehlercodes (Tool-Ergebnis `isError`, `{error:{code,message}}`)

`mcp_disabled`, `not_paired`, `busy`, `timeout`, `limit_exceeded`, `rate_limited`, `out_of_scope`,
`content_not_allowed`, `not_connected`, `invalid_arguments`, `not_available`, `cancelled`, `not_found` (Job) sowie die
`FsError`-Codes (`invalid_path`, `not_found`, `permission_denied`, …) – immer der Code, nie Rusts `message`.
Unbekanntes Tool: JSON-RPC-Fehler `-32602 Unknown tool`.

### Tools (registriert)

Stufe 0: `get_workspace`, `get_selection`, `list_directory`, `get_properties`, `search`, `find_files`, `disk_usage`,
`find_duplicates`, `compare_folders`, `checksum`, `read_text`, `list_jobs`, `get_job`.
Stufe 1: `navigate`, `open_tab`, `set_cursor`, `mark`, `quick_view`, `show_results`, `cancel_job`.
Stufe 2: `propose_copy`, `propose_move`, `propose_delete`, `propose_rename`, `propose_mkdir`.
Schemata: `mcp/tools.rs` (`additionalProperties: false`, Grenzen als `maximum`/`maxItems`).

### Grenzen (`mcp/limits.rs`)

Zeile ≤ 1 MiB · ≤ 4 Verbindungen · je Verbindung ≤ 4 Aufrufe zugleich, 20 Aufrufe/s (Token-Eimer, 40 Vorrat) ·
≤ 2 laufende Jobs je Verbindung · Listen: Default 200, hart 2000 Einträge · Pfade je Aufruf ≤ 1000 · Vorschlag ≤ 5000
Einträge · Warten auf Job 30 s · Vorschlag offen ≤ 10 min · Kopplung 120 s · Protokoll 200 Zeilen.

## Module

```
src-tauri/src/mcp/
  mod.rs        McpHub: Konfiguration, Verbindungen, Kopplung, Aufruf (Stufe, Grenze, Protokoll)
  config.rs     Einstellungen aus settings.json, socket_path()
  protocol.rs   JSON-RPC je Zeile (rein): initialize, ping, tools/list, tools/call, cancelled
  server.rs     Unix-Socket: Ordner 0700, Socket 0600, Peer-UID, Threads je Verbindung
  stdio.rs      Brücke `--mcp` (stdin/stdout ↔ Socket, Antworten ohne App)
  tools.rs      Positivliste: Name, Stufe, Beschreibung, Schema; Dispatch
  read.rs       Stufe 0   · view.rs Stufe 1 · propose.rs Stufe 2
  scope.rs      Wurzeln (physisch), App-Ordner, Geheimnis-Ordner
  state.rs      Spiegel des UI-Zustands (begrenzt)
  bridge.rs     Anfragen an die UI: Waiter, Timeout, Abbruch, ein Vorschlag
  jobs.rs       Abgriff der Job-Ereignisse, Sammler, Positivliste der Job-Arten
  limits.rs     Grenzen, Token-Eimer · pairing.rs Kopplung · log.rs Protokoll im Speicher
  tests.rs      Ende-zu-Ende im Prozess (Socket in tempfile, Test-Client, Fake-UI)
src/app/core/mcp/      McpApi, DTOs, ProposalService (welcher Vorschlag gehört zum offenen Dialog)
src/app/features/mcp/  McpStore (Root), mcp-logic.ts (rein), Kopplungs- und Protokolldialog, Anzeige, Aktionen, Texte
```

## UI

```
┌ Zugriff über MCP ─────────────────────────────┐   Statuszeile (Button-Leiste, rechts):
│ „Claude Code“ möchte auf Files and Folders     │   [⇄ Claude Code]  ← Klick: Protokoll
│ zugreifen (lesen, Ansicht steuern, Vorschläge).│
│ Der Name stammt vom Programm selbst.           │   ┌ MCP ────────────────────────────────┐
│            [Ablehnen] [Immer] [Einmal]         │   │ Claude Code · seit 14:02 [Trennen]  │
└────────────────────────────────────────────────┘   │ 14:03 get_selection  ok   3         │
   Fokus: Ablehnen · Enter = nichts (kein primary)   │ 14:03 propose_rename cancelled 3    │
                                                     │             [Alle trennen] [Schließen]│
Vorschlag in jedem betroffenen Dialog:               └─────────────────────────────────────┘
  ┌───────────────────────────────────────────────┐
  │ ⇄ Vorschlag von „Claude Code“ – prüfen Sie    │  role="note"; Fokus beim Öffnen auf „Abbrechen“;
  │   die Liste, bevor Sie bestätigen.            │  Bestätigen: Klick oder Mod+Enter, nie Enter;
  └───────────────────────────────────────────────┘  der Knopf ist die ersten 800 ms gesperrt.
```

Der Löschdialog zeigt bei einem Vorschlag **alle** Einträge (scrollbar) statt der ersten fünf, mit den Zählern aus 058.

## Bedrohungsmodell

| Angreifer | Weg | Schutz |
|---|---|---|
| Anderer Nutzer des Rechners | verbindet sich mit dem Socket | Ordner `0700`, Socket `0600`, Peer-UID ≠ eigene → getrennt (`server.rs`) |
| Prozess desselben Nutzers | spricht MCP direkt, gibt sich als erlaubter Client aus | kann ohnehin alle Dateien des Nutzers lesen/ändern; MCP gibt ihm nichts darüber hinaus: Stufe 2 braucht den Klick, Verbindung ist sichtbar, Protokoll, Trennen. **Restrisiko** (dokumentiert): er sieht Markierung/Cursor |
| Webseite im Browser | `fetch`/WebSocket auf localhost, DNS-Rebinding | es gibt keinen Port |
| Entfernter Rechner | Netz | Unix-Socket, kein Listen auf einer Schnittstelle |
| Bösartiger Dateiname / Dateiinhalt (Prompt Injection) | bringt den Agenten dazu, zu löschen/verschieben/exfiltrieren | Stufe 3 existiert nicht (keine Shell, kein Öffnen, kein Verbinden); Ändern nur als Vorschlag mit vollständiger Liste; kein Enter; Inhalte nur mit `mcp.allowContent`; Tool-Beschreibungen kennzeichnen Namen/Inhalte als Daten; UI escaped wie überall |
| Kompromittierter Agent | ruft beliebige Tools mit beliebigen Argumenten | Positivliste (`tools.rs`), jedes Argument geprüft (`Scope`, `validate_job_path`), Jobs nur lesende Arten (`jobs::READ_KINDS`), `JobSpec::Shell` ist nicht konstruierbar (Test), Grenzen und Rate-Limit, `busy` statt Dialog-Stapel |
| Agent drängt zum Bestätigen | öffnet Dialoge im Sekundentakt, hofft auf Enter/Klick im falschen Moment | ein Vorschlag zugleich, `busy` bei offenem Dialog, Fokus auf Abbrechen, Enter bestätigt nie, 800 ms Sperre des Knopfs |
| Agent will Geheimnisse | liest `connections.json`, Schlüsselbund, `~/.ssh` | App-Ordner außerhalb des Bereichs; Geheimnis-Ordner für Inhalte gesperrt; kein Tool für Profile, Passwörter, Einstellungen; Serverpfade nur bei bestehender Verbindung, nie `connect` |
| Agent will aus dem Bereich | Symlink, `..`, Archiv-Pfad, `remote://` | kanonische Prüfung, `..` abgelehnt, Archive nur wenn in einem Tab offen, `remote://` nur `list_directory` bei `Connected` |
| Agent überlastet die App | Riesen-Suche, viele Aufrufe | Jobs laufen auf eigenen Threads, ≤ 2 je Verbindung, Listen begrenzt, Rate-Limit, der Nutzer sieht und stoppt sie in „Tasks“ |

## Tests

- **Rust** (`mcp/*`, `mcp/tests.rs`): Schemata vollständig; Stufe-3-Namen → `Unknown tool`; `Scope` (Unicode, `..`,
  Symlink hinaus, App-Ordner, Geheimnis-Ordner, Archiv ohne Tab, `remote://`); Rate-Limit; Kopplung
  (einmal/immer/ablehnen/widerrufen/Timeout); Bridge (Antwort, Timeout, `busy`, Abbruch); Socket-Rechte, „aus = kein
  Socket“, fremde Zeile zu lang; Brücke ohne App → `mcp_disabled`; Job-Positivliste; Abbruch des Aufrufs bricht den
  Job ab; Ende-zu-Ende über einen echten Socket mit Test-Client und Fake-UI.
- **Frontend:** `mcp-logic.spec.ts` (Spiegel, Grenzen), `mcp.store.spec.ts` (nur bei `mcp.enabled`, entprellt, Anfragen
  → Stores, `busy`, Kopplung), `proposal.spec.ts`, Dialoge (Hinweis, kein Enter, alle Einträge), Multi-Rename „Liste“,
  `modal.spec.ts` (Rolle `confirm`), Kataloge.
- **Nur im Fenster prüfbar:** Aussehen (über `pnpm screenshots`), echter Client (Claude Desktop/Code).

## Offen

- **`propose_pack`, `propose_extract`, `propose_dedupe`** – nicht registriert. Die Dialoge hängen am Zustand des
  aktiven Panels (`ArchiveStore.openPack/openUnpack`) bzw. eines Dubletten-Tabs (`DuplicatesStore.openDedupe`) und
  haben keinen Einstieg für gegebene Einträge; den sauber zu bauen (mit `expected`, Passwörtern, Gruppenprüfung) ist
  ein eigener Schritt. Ersatz bis dahin: `find_duplicates` + `show_results`/`propose_delete`.
- **Windows** – kein Transport (Named Pipe + ACL, Binary ohne Konsole), s. E1.
- **`quick_view`** zeigt nur einen Eintrag aus dem Ordner der aktiven Seite (setzt dort den Cursor und schaltet die
  Schnellvorschau ein) – die Schnellvorschau folgt dem Cursor.
- **Echter Client** (Claude Desktop/Code, MCP Inspector) und das Fenster selbst sind in dieser Sitzung nicht
  durchgespielt (laufende App von Marc, s. Fortschritt).

## Fortschritt

- [x] Phase 1 Design (dieses Dokument)
- [x] Phase 2 Rust
- [x] Phase 3 Frontend
- [x] Phase 4 E2E im Prozess (echter Socket, Test-Client); Fenster nur über Screenshots
- [x] Phase 5 Doku
- [ ] Phase 6 Sicherheits-Review (separater Agent)
