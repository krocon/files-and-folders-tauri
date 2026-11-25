# Design 071: MCP-Schnittstelle

> **Status:** umgesetzt (Stufen 0–2, macOS/Linux; Sicherheits-Review eingearbeitet, s. „Review“) · **Datum:** 2026-11-25 · **Auftrag:** `071-mcp-schnittstelle.md`
> Ohne Haltepunkt nach Phase 1 (Anordnung von Marc für diesen Lauf); das Sicherheits-Review (Phase 6) macht ein
> separater Agent. Offenes steht unter „Offen“, der Stand unter „Fortschritt“.

## Entscheidungen (Kurzfassung)

| | Entscheidung |
|---|---|
| **E1** | **stdio-Brücke** in derselben Binary (`files-and-folders-tauri --mcp`) ↔ **Unix-Domain-Socket** `…/<App-Daten>/mcp/fnf.sock` (Ordner `0700`, Socket `0600`, Peer-UID geprüft). Kein HTTP, kein Port. Windows: in v1 **nicht** (s. Offen). |
| **E2** | App läuft nicht / MCP aus → die Brücke antwortet selbst mit `mcp_disabled` und klarem Text. Die App wird **nie** gestartet. |
| **E3** | **Eigenes, schmales JSON-RPC** (nur Tools) statt `rmcp` – keine neue Abhängigkeit. |
| **E4** | Rückfrage im Fenster je Verbindung: **einmal / immer / ablehnen**; „immer“ = Name in `mcp.clients`. **Kein Token** (schützt nicht gegen Prozesse desselben Nutzers; gegen andere Nutzer schützen Socket-Rechte + Peer-UID). |
| **E5** | `read_text` nur mit `mcp.allowContent` (Default aus), höchstens 256 KiB (Default 64 KiB), nur Text laut `preview/detect.rs`, nur echte lokale Dateien (kein Archiv, kein Server). **Eine** Pfadregel für alles, was Inhalte ansieht (`Scope::content_allowed`: `read_text`, `checksum`, Inhaltssuche, Dubletten, Inhaltsvergleich): nie Orte mit Zugangsdaten, und der private Teil des Home-Ordners (Punkt-Einträge direkt im Home, `~/Library`) nur, wenn der Nutzer dort ausdrücklich eine Wurzel eingetragen hat (Review #1). |
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
App-Ordner. Ein Symlink in der Wurzel, der hinausführt, ist damit draußen. Was die Engines finden, wird vor der Antwort **mit derselben
Prüfung** gefiltert: Treffer von Suche, Palette und Dubletten, Zeilen des Vergleichs, Kinder und größte Dateien der
Belegung (Review #5 – der erste Entwurf filterte Vergleich und Belegung nicht; die Summen der Belegung zählen die
App-Ordner weiter mit).

Für Inhalte gilt zusätzlich `Scope::content_allowed` (eine Liste, ein Pfadprädikat – Review #1):

- **immer zu:** `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.docker`, `~/.config/gcloud`, `~/.config/gh`,
  `~/.password-store`, `~/Library/Keychains`, `~/Library/Cookies`, und überall `.netrc`, `.npmrc`, `.pypirc`,
  `.git-credentials`, `.env`, `.env.*`;
- **per Default zu:** jeder Punkt-Eintrag direkt im Home (`~/.zsh_history`, `~/.claude.json`, `~/.config/…`) und
  `~/Library` – offen nur unterhalb einer Wurzel, die der Nutzer **dort** in `mcp.roots` eingetragen hat (das Home
  selbst als Wurzel öffnet nichts davon).

Eine Inhaltssuche darf an so einem Ort nicht starten (Wurzel wird geprüft) und meldet von dort keine Treffer – auch
nicht in den Ergebnis-Tab.

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
  session.rs    eine Verbindung: Zeilen lesen (begrenzt), Antworten, Tool-Aufrufe auf eigenen Threads
  stdio.rs      Brücke `--mcp` (stdin/stdout ↔ Socket, Antworten ohne App)
  tools.rs      Positivliste: Name, Stufe, Beschreibung, Schema; Dispatch
  read.rs       Stufe 0   · view.rs Stufe 1 · propose.rs Stufe 2
  scope.rs      Wurzeln (physisch), App-Ordner, Geheimnis-Ordner
  state.rs      Spiegel des UI-Zustands (begrenzt)
  bridge.rs     Anfragen an die UI: Waiter, Timeout, Abbruch, ein Vorschlag
  jobs.rs       Abgriff der Job-Ereignisse, Sammler, Positivliste der Job-Arten
  limits.rs     Grenzen, Token-Eimer · pairing.rs Kopplung · log.rs Protokoll im Speicher
  tests.rs      Ende-zu-Ende im Prozess (Socket in tempfile, Test-Client, Fake-UI)
src/app/core/mcp/      McpApi, DTOs, McpStatusService, ProposalService (welcher Vorschlag gehört zum offenen Dialog)
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
  │ ⇄ Vorschlag von „Claude Code“. Prüfe ihn,     │  role="note"; Fokus beim Öffnen auf „Abbrechen“;
  │   bevor du bestätigst.                        │  Bestätigen: Klick oder Mod+Enter, nie Enter;
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
| Kompromittierter Agent | ruft beliebige Tools mit beliebigen Argumenten, gibt sich per zweitem `initialize` einen anderen Namen | Positivliste (`tools.rs`), jedes Argument geprüft (`Scope`, `validate_job_path`), gezeigte Texte ohne Steuer-/Format-Zeichen, `initialize` einmal je Verbindung, Jobs gehören der Verbindung, Jobs nur lesende Arten (`jobs::READ_KINDS`), `JobSpec::Shell` ist nicht konstruierbar (Test), Grenzen und Rate-Limit, `busy` statt Dialog-Stapel |
| Agent drängt zum Bestätigen | öffnet Dialoge im Sekundentakt, hofft auf Enter/Klick im falschen Moment | ein Vorschlag zugleich, `busy` bei offenem Dialog, Fokus auf Abbrechen, Enter bestätigt nie, Knopf erst nach 800 ms **ohne Tastendruck** scharf, „Endgültig löschen“ ohne Kürzel; Kopplungsfrage nur per Klick, wird nach jedem Nein seltener und hört nach 5 auf |
| Agent richtet den nächsten Tastendruck des Nutzers aus (Stufe 1) | `mark`/`set_cursor`/`navigate`/`show_results` kurz bevor der Nutzer F8, F5, Enter drückt | kein Fokuswechsel durch MCP; 1,5 s Sperre für dateiändernde Aktionen, Öffnen und Shell-Enter; Kopieren/Verschieben/Löschen über eine vom Client gesetzte Auswahl oder ein gesetztes Ziel fragen wie ein Vorschlag; sichtbarer Hinweis (`McpGuardService`) |
| Agent will Geheimnisse | liest `connections.json`, Schlüsselbund, `~/.ssh`, Verläufe, Konfigurationen anderer Programme; nutzt Suche/Vergleich/Hash als Orakel | App-Ordner außerhalb des Bereichs und aus allen Ergebnissen gefiltert; **eine** Inhaltsregel für Lesen, Hashen, Suchen, Vergleichen (Zugangsdaten immer zu, privater Teil des Home per Default zu); ein Einstellungs-Import ändert `mcp.*` nie; kein Tool für Profile, Passwörter, Einstellungen; Serverpfade nur bei bestehender Verbindung, nie `connect` |
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
- **Echter Client** (Claude Desktop, Claude Code, MCP Inspector): nicht ausprobiert. Geprüft ist das Protokoll mit
  eigenen Test-Clients (Rust im Prozess, `scripts/mcp-e2e.mjs` über die Brücke gegen die echte Debug-App).
- **Bestätigen im echten Fenster** (Klick/`Mod+Enter` im Vorschlagsdialog, „Immer erlauben“, Trennen per Knopf) ist nur
  über Vitest und Bilder (`pnpm screenshots`, Szenen `mcp-*`) geprüft, nicht von Hand durchgeklickt.
- **Fortschritts-Meldungen** (`notifications/progress`) werden gesendet, wenn der Client ein `progressToken` schickt –
  ohne Test.
- **Linux**: gebaut und getestet wurde auf macOS; der Linux-Zweig (`SO_PEERCRED`, `XDG_DATA_HOME`) ist nur übersetzt
  gedacht, nicht gelaufen.

## Abweichungen vom Entwurf (beim Bauen entschieden)

- **Trennen ist synchron:** `McpHub::disconnect` schließt den Transport **und** nimmt die Verbindung sofort aus der
  Liste (vorher erst, wenn der Lese-Thread das Ende sah) – „Trennen wirkt sofort“ gilt auch für den Status.
- **Suche holt mehr als `limit`:** Treffer in den Ordnern der App werden zurückgehalten; der Job sucht darum
  `limit + 100` und die Antwort behält `limit` der erlaubten.
- **`checksum`** rechnet nur Dateien, die auch gelesen werden dürften (keine Geheimnis-Ordner) – ein Hash ist eine
  Funktion des Inhalts. `mcp.allowContent` braucht es dafür nicht.
- **Vorschläge vergleichen immer:** Verschieben und Löschen bekommen `expected` (Größe/Zeit je Eintrag aus dem Moment
  des Vorschlags) – was sich bis zur Bestätigung ändert, lässt der Job stehen (wie 030 E5 für ungeprüfte Listings).
- **Kopplungsdialog:** kein Knopf nimmt Enter; „Immer“/„Einmal“ nur per Klick, nach der Sperre (Review #3).
- **Anzeige** in der Button-Leiste (Werkzeug-Gruppe), nicht in der Statuszeile eines Panels – sie ist fensterweit.

## Geprüft

| Was | Wie |
| --- | --- |
| Rust: Protokoll, Positivliste, Schemata, Scope, Kopplung, Bridge, Grenzen, Jobs, Transport, Brücke | `cargo test --lib mcp::` – 72 Tests, 10× hintereinander grün (echter Socket in `tempfile`) |
| Frontend: Spiegel, Anfragen → Stores, `busy`, Kopplung, Vorschläge, Enter-Regel, Sperre, Listenmodus | Vitest: `mcp.store.spec.ts` (17), `proposal-dialogs.spec.ts` (8), `mcp-logic.spec.ts` (6), `proposal.service.spec.ts` (4), `modal.spec.ts` (+2) |
| Brücke der gebauten Binary ohne App → `mcp_disabled` | `node scripts/mcp-bridge-check.mjs` |
| Echte Debug-App (eigenes HOME, eigener Socket) über die Brücke: Tabs im Spiegel, Listing, `navigate`/`mark`/`set_cursor`/`open_tab` wirken im echten Panel, Suche + Ergebnis-Tab, Prüfsumme, `propose_delete` öffnet den echten Dialog (`busy` für alles andere), Abbruch schließt ihn, nichts gelöscht, `run_shell` unbekannt | `node scripts/mcp-e2e.mjs` – 26 Prüfungen grün |
| Aussehen light/dark: Kopplung, Protokoll, Anzeige, Einstellungen, Lösch- und Umbenenn-Vorschlag | `pnpm screenshots --scene mcp-pairing,mcp-log,mcp-indicator,mcp-settings,mcp-propose-delete,mcp-propose-rename` |

## Review (Sicherheit, separater Agent, 25.11.2026)

Kein kritischer Befund; zehn Befunde, alle angenommen und behoben. Tests: Rust `mcp/tests.rs` (`review_*`),
`mcp/pairing.rs`, `mcp/jobs.rs`, `mcp/log.rs`, `mcp/scope.rs`, `settings.rs`; Vitest `features/mcp/*.spec.ts`,
`core/mcp/*.spec.ts`, `features/shell/shell.spec.ts`.

| # | Befund | Behebung | Test |
| --- | --- | --- | --- |
| 1 | Inhaltssuche umging den Geheimnisschutz (Ausschluss nur als Namens-Glob, nicht für die Wurzel; `.git-credentials`, `.config/gh` fehlten); `~/.claude.json`, `~/.zsh_history`, `~/Library/…` lesbar | eine Pfadregel `Scope::content_allowed` für alle Inhalts-Wege; Wurzeln einer Inhaltssuche geprüft, Treffer (auch für `showAsTab`) gefiltert; privater Teil des Home per Default zu, `McpConfig.explicit_roots` | `review_1_a_content_search_never_reaches_credentials`, `review_1_an_explicit_root_opens_a_private_place_but_never_credentials`, `scope::…the_private_part_of_home_is_closed_for_contents_unless_named_as_a_root` |
| 2 | Stufe 1 ändert, worauf der nächste Tastendruck wirkt (Markierung/Cursor/Ziel/Fokus) | (a) `show_results`/`open_tab` nehmen nie den Fokus, `activate` Default aus, `show_results` Default andere Seite; (b) 1,5 s Sperre nach jeder Ansichtsänderung für Aktionen der Kategorie „files“, Tools/Starter, Datei öffnen und Shell-Enter (`McpGuardService.locked`); (c) solange Markierung (bis sie sich ändert) bzw. Cursor/Ordner (bis der Nutzer Cursor bewegt oder ins Panel klickt) vom Client stammen, sind Kopieren/Verschieben/Löschen wie ein Vorschlag geschützt (`changedBy`: Hinweis, volle Liste, kein Enter, Sperre, `confirmTrash=false` ignoriert); (d) Anzeige „MCP: ‹Client› hat die Ansicht geändert“ | `mcp.store.spec.ts` › „review #2 …“ (7), `mcp-guard.service.spec.ts`, `proposal-dialogs.spec.ts` › „review #2 …“, `shell.spec.ts` › „071 review #2 …“ |
| 3 | Kopplungsfrage ohne Sperrzeit, `Mod+L` kollidiert, beliebig oft auslösbar | „Immer“/„Einmal“ nur per Klick, gleiche Sperre wie Vorschläge; Pause verdoppelt sich nach jedem Nein (global, nicht je Name), nach 5 bis zum Aus-/Einschalten keine Frage mehr | `pairing::denials_slow_the_question_down_and_then_stop_it`, `review_3_denials_stop_the_pairing_question`, `proposal-dialogs.spec.ts` › „review #3 …“ |
| 4 | `Mod+Enter`/`Mod+Shift+D` sind Tasten des Panels; ein Akkord löschte endgültig | im geschützten Dialog hat „Endgültig löschen“ kein Kürzel; die Sperre zählt ab dem **letzten Tastendruck** (800 ms Ruhe), nach jeder Taste neu | `proposal.service.spec.ts` › „review #4 …“, `proposal-dialogs.spec.ts` › „review #4 …“ |
| 5 | `compare_folders`/`disk_usage` nannten Pfade im App-Ordner | Zeilen, Kinder und größte Dateien mit `Scope::allows` gefiltert; Inhaltsvergleich und Dubletten zusätzlich mit der Inhaltsregel | `review_5_engines_do_not_tell_about_the_folders_of_the_app` |
| 6 | erneutes `initialize` änderte den Namen; Job-Besitz am Namen | `initialize` einmal je Verbindung; Besitz an der Verbindungs-Id | `review_6_a_second_initialize_is_refused_and_jobs_belong_to_the_connection` |
| 7 | Bidi-/Format-Zeichen in gezeigten Texten | `pairing::is_plain` (Cc, Cf, Zl/Zp, Füllzeichen, Variationsselektoren): `newName`, `names`, `title` abgelehnt; Client-Name gefiltert, Anführungszeichen entfernt | `review_7_shown_texts_carry_no_format_characters`, `pairing::names_lose_every_hidden_character_and_quotes` |
| 8 | ein `claim`-Platz für alle Threads, Zählen/Starten nicht atomar | Claim je Thread, Zählen + Starten unter einem Lock (`JobTap::start(…, max_running)`) | `jobs::concurrent_starts_keep_their_jobs_apart_and_the_limit` |
| 9 | Status-Ereignis je Aufruf, `pair_lock` vor der Listenprüfung, kein Leerlauf-Limit, Protokoll flutbar | Status höchstens alle 500 ms; „immer“ erlaubte Clients warten nie hinter einer Frage; ungekoppelte Verbindungen nach 5 min getrennt; Ablehnungen eines Clients in einer Protokollzeile gezählt | `review_9_idle_unpaired_connections_go_and_calls_do_not_flood_the_window`, `log::repeated_refusals_are_counted_in_one_line` |
| 10 | Einstellungs-Import konnte `mcp.*` setzen (bestätigt) | Import lässt `mcp.*` aus und behält die eigenen Werte | `settings::import_never_touches_the_mcp_settings` |

Rot zuerst gelaufen sind die Tests zu 1, 5, 6 und 7 (über den Test-Client gegen den alten Stand); die Tests zu 2, 3, 4,
8, 9, 10 brauchen neue Schnittstellen und entstanden mit der Behebung.

**Bewusst so belassen / Restrisiko:**

- (2c) deckt Kopieren, Verschieben und Löschen (`OpsStore`). Die anderen Dialoge (Multi-Rename, Packen, Attribute,
  Gruppieren …) haben nur die Sperre (2b) – sie zeigen ihre vollständige Vorschau ohnehin vor der Bestätigung.
- Namen mit Emoji-Sequenzen (ZWJ, Variationsselektor) lehnt `propose_rename`/`propose_mkdir` ab (Folge von #7).
- `disk_usage`: die Summen der übergeordneten Ordner zählen die App-Ordner mit (Größe, keine Namen).
- Eine Inhaltssuche vom Home aus liest im Prozess auch private Dateien (der Job kennt keinen Pfad-Ausschluss) –
  gemeldet wird davon nichts; `truncated` kann dadurch früher wahr werden.

## Fortschritt

- [x] Phase 1 Design (dieses Dokument)
- [x] Phase 2 Rust
- [x] Phase 3 Frontend
- [x] Phase 4 E2E im Prozess (echter Socket, Test-Client) und gegen die echte Debug-App in eigenem HOME (`scripts/mcp-e2e.mjs`)
- [x] Phase 5 Doku
- [x] Phase 6 `pnpm check` + Debug-Build; Sicherheits-Review durch separaten Agenten, zehn Befunde behoben (Abschnitt „Review“)
