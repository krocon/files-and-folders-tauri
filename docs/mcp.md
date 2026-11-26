# MCP-Schnittstelle

Files and Folders hat einen **MCP-Server** ([Model Context Protocol](https://modelcontextprotocol.io)): Ein KI-Agent
(Claude Desktop, Claude Code, andere MCP-Clients) arbeitet mit der **laufenden App**. Er sieht, was du siehst
(Panels, Tabs, Cursor, markierte Dateien), nutzt die Engines der App (Suche, Namensindex, Speicherbelegung, Dubletten,
Ordnervergleich, Prüfsummen) und **schlägt** Dateioperationen **vor** – ausgeführt wird erst, wenn du im normalen
Dialog der App bestätigst.

> Ein MCP-Client kann nichts, was ein Nutzer mit Maus und Tastatur nicht auch könnte – und nichts, was Dateien
> ändert, ohne Bestätigung im Fenster.

Design, Entscheidungen und Bedrohungsmodell: [`prompts/done/071-mcp-schnittstelle.design.md`](../prompts/done/071-mcp-schnittstelle.design.md).
Stand: macOS und Linux. Windows: noch kein Transport (die Einstellung zeigt „auf dieser Plattform noch nicht
verfügbar“).

## Einschalten

MCP ist **aus**, bis du es einschaltest: **Einstellungen → MCP (KI-Agenten)**.

| Einstellung | Default | Bedeutung |
| --- | --- | --- |
| `mcp.enabled` – KI-Agenten mit dieser App arbeiten lassen | aus | Aus: nichts lauscht, der Socket existiert nicht. An: lokale Clients können sich verbinden. |
| `mcp.allowContent` – Dateiinhalte erlauben | aus | `read_text` und die Inhaltssuche. Aus: nur Namen, Größen, Zeiten. Auch an: nie Dateien mit Zugangsdaten, und nichts aus dem privaten Teil des Home-Ordners (s. Sicherheitsmodell 7). |
| `mcp.roots` – Ordner, die Agenten sehen dürfen | leer = Home-Ordner | Ein Ordner je Zeile. Alles außerhalb wird abgelehnt (`out_of_scope`), auch über einen Symlink. Ein hier eingetragener Ordner im privaten Teil des Home (`~/.config/meinprojekt`) ist damit auch für Inhalte offen. |
| `mcp.clients` – Clients, die immer erlaubt sind | leer | Namen, bei denen du „Immer erlauben“ gewählt hast. Zeile löschen = widerrufen. |

Die App muss laufen. Die Brücke startet sie nie.

## Client einrichten

Der Client startet die **Brücke**: dieselbe Programmdatei wie die App mit dem Argument `--mcp`. Sie öffnet kein
Fenster, spricht MCP über stdin/stdout und reicht die Aufrufe über einen lokalen Socket an die laufende App weiter.

Pfad der Programmdatei:

- macOS: `/Applications/Files and Folders.app/Contents/MacOS/files-and-folders-tauri`
- Linux (deb/rpm): `/usr/bin/files-and-folders-tauri`, AppImage: der Pfad der AppImage-Datei

**Claude Code**

```bash
claude mcp add files-and-folders -- "/Applications/Files and Folders.app/Contents/MacOS/files-and-folders-tauri" --mcp
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "files-and-folders": {
      "command": "/Applications/Files and Folders.app/Contents/MacOS/files-and-folders-tauri",
      "args": ["--mcp"]
    }
  }
}
```

Beim ersten Tool-Aufruf fragt die App im Fenster: **Ablehnen / Immer erlauben / Einmal erlauben**. Erlauben geht nur
per Klick (die Knöpfe sind einen Moment gesperrt), Esc lehnt ab. Nach jedem Nein wartet die nächste Frage länger
(30 s, 1 min, 2 min, 4 min – egal unter welchem Namen); nach fünf wird nicht mehr gefragt, bis du MCP aus- und wieder
einschaltest. Eine Verbindung, die nie erlaubt wurde, wird nach fünf Minuten getrennt. Solange ein Client
verbunden ist, steht er in der Button-Leiste (`⇄ MCP: Claude Code`); ein Klick (oder die Aktion „MCP: Verbindungen und
Protokoll…“) zeigt die Verbindungen mit „Trennen“ und das Protokoll der Aufrufe.

Läuft die App nicht oder ist MCP aus, antwortet die Brücke auf jeden Aufruf mit dem Fehler `mcp_disabled` („Files and
Folders is not running or MCP is switched off …“). Nach dem Start der App oder dem Einschalten verbindet sie sich beim
nächsten Aufruf von selbst – der Client muss nicht neu gestartet werden.

## Tools

Drei Stufen. **Stufe 3 gibt es nicht.**

### Stufe 0 – lesen

| Tool | Zweck |
| --- | --- |
| `get_workspace` | beide Seiten: aktive Seite, Tabs (Art, Titel, Ordner) |
| `get_selection` | Ordner, Cursor-Eintrag und markierte Einträge einer Seite (`side`: `active`/`other`/`left`/`right`) |
| `list_directory` | Einträge eines Ordners (`showHidden`, `offset`, `limit`); Archive nur, wenn sie in einem Tab offen sind; Server nur bei bestehender Verbindung |
| `get_properties` | Eigenschaften (Art, Größe, Zeiten, Rechte, Link-Ziel, erkanntes Format) – keine Inhalte |
| `search` | rekursive Suche (Name als Glob/Regex/Text, Größe, Zeit, optional Inhalt); `showAsTab` öffnet zusätzlich einen Ergebnis-Tab |
| `find_files` | Namensindex der Befehlspalette |
| `disk_usage` | Größe eines Ordners, größte Unterordner und Dateien |
| `find_duplicates` | Gruppen gleicher Dateien (`content`) oder ähnlicher Bilder (`similarImages`), verschwendete Bytes |
| `compare_folders` | zwei Ordnerbäume vergleichen (`date`/`size`/`content`) |
| `checksum` | MD5/SHA-1/SHA-256/SHA-512 berechnen – schreibt nichts |
| `read_text` | Anfang einer Textdatei – nur mit `mcp.allowContent` |
| `list_jobs`, `get_job` | Jobs dieses Clients: Zustand, Fortschritt, bei lesenden Jobs das Ergebnis |

Lange Tools laufen als normale Jobs (sichtbar unter „Tasks“). Ein Tool wartet bis 30 s; danach antwortet es mit
`status: "running"` und `jobId`, `get_job` liefert das Ergebnis. Bricht der Client den Aufruf ab, endet der Job.

### Stufe 1 – Ansicht steuern (sichtbar, ändert keine Datei)

`navigate`, `open_tab` (`activate` Default aus), `set_cursor`, `mark` (`replace`/`add`/`remove`, nur Einträge des
gezeigten Ordners), `quick_view` (Eintrag im Ordner der aktiven Seite), `show_results` (Ergebnis-Tab mit genau diesen
Pfaden, ohne `side` auf der anderen Seite), `cancel_job` (nur Jobs dieser Verbindung).

Navigieren öffnet nie eine Datei: `navigate` und `open_tab` nehmen nur Ordner (`not_a_directory` für einen
Dateipfad, die Anfrage erreicht das Fenster nicht). Dass ein **getippter** Dateipfad im Pfadfeld die Datei öffnet
(Design 079), hängt an der Enter-Taste des Nutzers in diesem Feld – „Öffnen“ wäre Stufe 3 und existiert nicht.

Diese Tools ändern keine Datei – aber sie ändern, worauf deine nächste Taste wirkt. Deshalb:

- MCP nimmt nie den Tastaturfokus (kein Seitenwechsel durch `show_results`/`open_tab`).
- Nach jeder Ansichtsänderung durch einen Client tun dateiändernde Aktionen (F5, F6, F8 …), Tools, Enter auf einer
  Datei und Enter in der Shell-Leiste **1,5 s lang nichts**.
- Solange die Markierung noch die des Clients ist (bis du sie änderst) bzw. Cursor oder Ordner (bis du den Cursor
  bewegst oder ins Panel klickst), zeigt die Button-Leiste „MCP: ‹Client› hat die Ansicht geändert“, und Kopieren,
  Verschieben und Löschen fragen **wie bei einem Vorschlag**: Hinweis, vollständige Liste, kein Enter – auch wenn
  „Papierkorb ohne Rückfrage“ eingestellt ist.

### Stufe 2 – vorschlagen (du bestätigst)

`propose_copy`, `propose_move`, `propose_delete`, `propose_rename` (Paare alt → neu im Multi-Rename-Dialog, Modus
„Liste“), `propose_mkdir`.

Jedes dieser Tools öffnet den **normalen Dialog**, vorbelegt, mit dem Hinweis „Vorschlag von ‚…‘“. Der Dialog

- zeigt **alle** Einträge (scrollbar) mit Pfad, nicht nur eine Zahl,
- startet mit dem Fokus auf „Abbrechen“,
- bestätigt **nie** mit Enter – nur per Klick oder Strg/⌘+Enter,
- ist gesperrt, bis 0,8 s lang **keine Taste** gedrückt wurde (eine Taste, die du gerade ohnehin drücken wolltest,
  startet die Wartezeit neu statt zu bestätigen),
- hat für „Endgültig löschen“ kein Kürzel (nur Klick),
- löscht in den Papierkorb (auch wenn „endgültig löschen“ in den Einstellungen der Standard ist).

Das Tool antwortet, wenn der Dialog zu ist: `{ "outcome": "confirmed", "jobId": "…" }` oder `{ "outcome":
"cancelled" }`. Die Operation selbst ist ein normaler Job mit Fortschritt, Konfliktfragen (die beantwortest du),
Abbruch und – beim Umbenennen – Rückgängig.

### Stufe 3 – gibt es nicht

Kein Tool für: Shell, externe Tools, Startermenü, Doppelklick-Aktionen, Datei öffnen/ausführen, Terminal,
Attribute/Rechte, Archiv-Passwörter, mit Servern verbinden, Profile/Schlüsselbund, Einstellungen/Kürzel/Farben/Buttons,
Import alter Konfiguration, App beenden, Konflikte beantworten. Ein Aufruf mit einem solchen Namen endet mit
`Unknown tool` (Test `mcp::tools::tests::tier_3_does_not_exist`).

Noch offen (nicht registriert): `propose_pack`, `propose_extract`, `propose_dedupe`.

## Fehlercodes

Ein Tool-Fehler kommt als `isError: true` mit `{ "error": { "code", "message" } }`.

| Code | Bedeutung |
| --- | --- |
| `mcp_disabled` | App läuft nicht oder MCP ist aus |
| `not_paired` | du hast den Client abgelehnt (oder nicht geantwortet) |
| `busy` | in der App ist ein Dialog offen, oder ein anderer Vorschlag wartet |
| `timeout` | der Vorschlag blieb 10 Minuten unbeantwortet |
| `cancelled` | der Client hat den Aufruf abgebrochen |
| `out_of_scope` | Pfad außerhalb von `mcp.roots`, im Ordner der App, Archiv nicht in einem Tab offen |
| `content_not_allowed` | `mcp.allowContent` ist aus, keine Textdatei, eine Datei mit Zugangsdaten oder im privaten Teil des Home-Ordners |
| `not_connected` | Serverpfad ohne bestehende Verbindung – die App verbindet nie für einen Agenten |
| `limit_exceeded`, `rate_limited` | Grenze erreicht (s. u.) |
| `invalid_arguments`, `not_available`, `not_found` | Argumente passen nicht zum Schema / Fenster nicht bereit / kein Job dieses Clients |
| `invalid_path`, `not_found`, `permission_denied`, `not_a_directory`, `invalid_name`, `invalid_pattern` … | wie bei den Commands der App (`FsError`-Codes). `invalid_name` auch für vorgeschlagene Namen mit Steuer- oder unsichtbaren Zeichen (Bidi, Zero-Width, Variationsselektoren) |

Meldungen des Betriebssystems werden nicht durchgereicht (sie können Pfade nennen), nur der Code.

## Grenzen

| | |
| --- | --- |
| Nachricht | 1 MiB je Zeile |
| Verbindungen | 4 |
| Aufrufe je Verbindung | 4 gleichzeitig, 20 je Sekunde (Vorrat 40) |
| laufende Jobs je Verbindung | 2 |
| Listen | Default 200, höchstens 2000 Einträge – `truncated` sagt, dass es mehr gibt |
| Pfade je Aufruf | 100–2000 je nach Tool, ein Vorschlag höchstens 5000 Einträge |
| `read_text` | Default 64 KiB, höchstens 256 KiB |
| offene Vorschläge | einer |

## Sicherheitsmodell

1. **Aus per Default.** Ohne `mcp.enabled` existiert kein Socket; beim Ausschalten werden alle Verbindungen sofort
   getrennt.
2. **Nur lokal, nur du.** Unix-Domain-Socket `…/io.github.krocon.filesandfolders/mcp/fnf.sock` im Daten-Ordner der
   App: Ordner `0700`, Socket `0600`, und bei jeder Verbindung wird die Nutzer-Id der Gegenseite geprüft. Kein Port –
   eine Webseite im Browser oder ein anderer Rechner erreicht ihn nicht.
3. **Kopplung sichtbar.** Rückfrage beim ersten Aufruf, Anzeige solange verbunden, Protokoll, „Trennen“.
   Der Name eines Clients ist nicht prüfbar (er nennt ihn selbst) – die Rückfrage sagt das dazu.
4. **Nichts Destruktives ohne Fenster.** Rust startet für einen Client nur lesende Jobs (`search`, `duplicates`,
   `compare`, `diskUsage`, `checksum` mit Ausgabe „nur anzeigen“). Alles andere startet das Fenster nach deiner
   Bestätigung – über dieselben Stores und dieselbe Prüfung (`JobManager::start`) wie per Tastatur.
5. **Eingaben sind Daten.** Dateinamen und Inhalte können Anweisungen an den Agenten enthalten (Prompt Injection).
   Die App verlässt sich nicht darauf, dass der Agent sie ignoriert: Schutz sind die Stufen, die Prüfung in Rust und
   deine Bestätigung. Tool-Beschreibungen kennzeichnen Namen und Inhalte als Daten; Ergebnisse sind JSON; in der UI
   werden Namen nie als HTML gesetzt.
6. **Gleiche Prüfungen wie die UI.** Jeder Pfad: absolut, kein `..`, kein NUL, physisch (Symlinks aufgelöst) in einer
   erlaubten Wurzel.
7. **Geheimnisse bleiben drin.** Die Ordner der App (Einstellungen, `connections.json`, Caches) sind nie sichtbar –
   auch nicht in Suchtreffern, Vergleichszeilen oder der Belegung. Für alles, was **Inhalte** ansieht (`read_text`,
   `checksum`, Inhaltssuche, Dubletten, Vergleich nach Inhalt), gilt eine Pfadregel:
   - immer zu: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.docker`, `~/.config/gcloud`, `~/.config/gh`,
     `~/.password-store`, `~/Library/Keychains`, `~/Library/Cookies`, und überall `.env*`, `.netrc`, `.npmrc`,
     `.pypirc`, `.git-credentials`;
   - per Default zu: alle Punkt-Einträge direkt im Home (`~/.zsh_history`, `~/.claude.json`, `~/.config/…`) und
     `~/Library` – außer du trägst einen Ordner dort ausdrücklich in `mcp.roots` ein.

   Namen, Größen und Zeiten solcher Dateien sind sichtbar (wie in der Dateiliste), ihr Inhalt nicht. Kein Tool für
   Passwörter, Profile oder Verbindungen. Ein Import von Einstellungen ändert die `mcp.*`-Werte nie.
8. **Begrenzt.** Siehe „Grenzen“.
9. **Protokoll ohne Pfade.** Tool, Zeit, Client, Anzahl, Ergebnis – nur im Speicher, weg beim Ausschalten oder
   Beenden.
10. **Eigene Threads.** Der Server blockiert nie das Fenster.

**Was MCP nicht verhindert:** Ein Programm, das unter deinem Benutzerkonto läuft, kann sich als erlaubter Client
ausgeben. Es könnte deine Dateien aber auch ohne MCP lesen und ändern – über MCP bekommt es zusätzlich nur die Sicht
auf Markierung und Cursor, und für jede Änderung weiterhin deinen Klick.

## Für Entwickler

- Rust: `src-tauri/src/mcp/` (reines std, ohne Tauri; Übersicht in `mod.rs`), Commands `commands/mcp.rs`.
- Frontend: `src/app/core/mcp/` (API, DTOs, `ProposalService`), `src/app/features/mcp/` (`McpStore`, Dialoge).
- Ein neues Tool braucht eine Entscheidung über seine Stufe; der Test `the_list_is_exactly_this` hält die Liste fest.
- Ende-zu-Ende im Prozess: `cargo test --lib mcp::` (echter Socket in einem Temp-Ordner, Test-Client, Fake-Fenster).
- `FNF_MCP_SOCKET=<pfad>` verlegt den Socket: für die Brücke immer, für die App nur im Debug-Build.
- Die Brücke ohne App prüfen: `node scripts/mcp-bridge-check.mjs [pfad-zur-binary]`.
