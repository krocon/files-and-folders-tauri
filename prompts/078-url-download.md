# Prompt 078: URL-Download – URLs mit yt-dlp in den Zielordner laden

> **Slug:** `url-download` · **Braucht:** 002 (Aktionen), 005 (Jobs), 011 (`tools.rs`: Start ohne Shell,
> Argument-Arrays), 015 (Einstellungen), 020/056 (Actions-Menü + Spiegel im Hauptmenü), 021/061 (Prozessgruppe
> `platform/process.rs`, `Batcher`, Login-`PATH`), 022 (Konfig-Dateien, Export/Import), 027 (letzte
> Dialogeingaben), 048 (fehlerhafte Tasks wiederholen), 057/076 (Dialog-Tasten), 075 (Netz-Regeln) · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/021-shell-leiste.design.md` (E1 Sicherheitsmodell,
> Prozesse, Ausgabe-Batching), `prompts/done/061-login-path-shell.md` (Login-`PATH` auf dem Mac) und
> `prompts/done/075-update-pruefen.design.md` (E1–E4: Netz nur auf Wunsch, Antworten sind feindlich).

## Auftrag (Marc, 25.11.2026)

Das Tool **yt-dlp** (<https://github.com/yt-dlp/yt-dlp>) in Files and Folders einbauen, so dass man **URLs in einen
Zielordner herunterladen** kann: ein Dialog unter **Actions**, in dem man **eine oder mehrere URLs** angibt und die
**Output-Optionen** des Tools einstellt.

## Ausgangslage: yt-dlp (recherchiert am 25.11.2026 – in Phase 1 nachprüfen, das Projekt ändert sich schnell)

- Kommandozeilen-Programm, aktuelle Version **2026.10.21**, sehr häufige Releases; alte Versionen brechen bei
  YouTube regelmäßig. Die Release-Seite warnt, dass alte Executables beim Selbst-Update per Man-in-the-Middle
  angreifbar sind.
- Lizenz: Quelltext Unlicense, aber die **offiziellen PyInstaller-Binaries sind als Ganzes GPLv3+**.
- Offizielle Binaries: `yt-dlp_macos` (universal, 10.15+), `yt-dlp.exe` (Win10+, x64), `yt-dlp_linux`,
  `yt-dlp_linux_aarch64` u. a.; daneben Homebrew, winget, pipx, Distributionspakete.
- **ffmpeg + ffprobe** sind praktisch Pflicht: Zusammenführen getrennter Video-/Audio-Spuren, `-x` (nur Audio),
  Einbetten von Thumbnail/Metadaten.
- **YouTube braucht seit 2025.11.12 eine externe JavaScript-Laufzeit** (empfohlen Deno, Mindestversion laut
  Release 2026.08.19: Deno 2.3.0 bzw. Node 22); die Komponente `yt-dlp-ejs` steckt in den offiziellen Executables.
  Ohne Laufzeit fehlen Formate oder der Download scheitert.
- Wichtige Optionen: `-P` (Zielpfad), `-o` (Namensvorlage), `-f`/`-S` (Format/Sortierung), `-x`, `--audio-format`,
  `--merge-output-format`, `--embed-thumbnail`, `--embed-metadata`, `--write-subs`, `--no-playlist`,
  `--cookies-from-browser`, `--ffmpeg-location`, `--js-runtimes`, `--newline`, `--progress-template`, `--print`.
- **Gefährliche Optionen:** `--exec` (führt beliebige Befehle aus), `--netrc-cmd`, `--config-locations`,
  `--plugin-dirs`, `--batch-file`, `--load-info-json`, `--cookies`, `-o`/`-P` mit fremden Pfaden.

Beobachtungen, die das Design tragen müssen:

1. **Nicht bündeln.** GPLv3+-Binary in einer MIT-App, Notarisierung eines fremden PyInstaller-Binaries auf dem Mac
   und ein Binary, das nach Wochen veraltet ist – drei Gründe dagegen. yt-dlp ist ein **externes Programm des
   Nutzers** wie die Tools aus 011.
2. **Eine GUI-App erbt den Shell-`PATH` nicht** (Mac): `yt-dlp`, `ffmpeg` und `deno` liegen meist unter Homebrew.
   Die Lösung dafür gibt es schon (061, `launch_tool_with_env`) – wiederverwenden, nicht neu bauen.
3. `CLAUDE.md` §4: kein beliebiges Kommando aus dem Frontend, externe Programme nur mit Argument-Arrays, lange
   Operationen sind Jobs, nichts verbindet ohne Zutun des Nutzers. Ein freies Feld „weitere yt-dlp-Optionen“ wäre
   wegen `--exec` ein beliebiges Kommando durch die Hintertür.
4. **Alles, was yt-dlp ausgibt, ist feindlich:** Titel, Dateinamen, Fehlermeldungen stammen von der Webseite.
5. In der Shell-Leiste (021) geht `yt-dlp <url>` schon heute. Neu ist der Komfort: Dialog, Vorlagen, Job mit
   Fortschritt je URL, Abbruch, Wiederholen.

## Ziel

```
Von URLs laden                                   Ziel: [Rechts · /…/Filme.nosync                          ▾]
                                                       │ Links  · /…/Download.nosync    (aktives Panel) │
                                                       │ Rechts · /…/Filme.nosync                       │

 URLs (eine je Zeile)                                                         [Aus Zwischenablage einfügen]
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ https://…                                                                                             │
 │ https://…                                                                                             │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 2 URLs · 0 ungültig

 Vorlage:    [Bestes Video ▾]
 Inhalt:     (•) Video   ( ) nur Audio        Höchstens: [beliebig ▾]   Container: [mp4 ▾]   Audio: [mp3 ▾]
 Dateiname:  [%(title)s [%(id)s].%(ext)s                    ▾]    z. B. „Mein Video [abc123].mp4“
 Playlist:   (•) nur das Video der URL   ( ) ganze Playlist   ☐ Unterordner je Playlist
 Extras:     ☐ Untertitel [de,en]   ☐ Thumbnail einbetten   ☐ Metadaten einbetten   ☐ Vorhandene überschreiben
 Anmeldung:  Cookies aus Browser [keine ▾]

 yt-dlp 2026.10.21 ✓ · ffmpeg ✓ · JavaScript-Laufzeit: deno 2.5 ✓                          [Befehl kopieren]
                                                                        [Esc Abbrechen]   [↩ Laden]
```

Enter startet **einen Job**; der Dialog schließt, der Fortschritt läuft im Tasks-Dialog, die Dateien erscheinen im
Zielordner (Watcher).

## Abgrenzung zum Bestand

- **011/072** starten Programme losgelöst (`spawn_detached`) – ohne Fortschritt und Abbruch. **021** hat
  Prozessgruppe, gestreamte Ausgabe und Job, aber über eine Shell und nur aus dem Shell-Feld. Hier: **ohne Shell,
  als eigene Job-Art**, Argumente baut ausschließlich Rust.
- `JobSpec::Shell` und `run_shell` bleiben unangetastet (021 E1); die Ausnahme Shell-Zeile wird **nicht** erweitert.
- Kein eingebauter Downloader in Rust, kein Nachbau von Extraktoren.

## Entscheidungsfragen (Phase 1, Design `078-url-download.design.md`: Optionen, Empfehlung, Begründung)

- **E-a Woher kommt yt-dlp?** A: nur suchen (Einstellung `download.ytDlpPath`, leer = Login-`PATH` + bekannte
  Orte); fehlt es, zeigt der Dialog eine Installationshilfe je OS (Homebrew / winget / pipx, Link zur Projektseite)
  – **Empfehlung für diesen Prompt**. B: „yt-dlp verwalten“ – das offizielle Binary auf Knopfdruck von der festen
  GitHub-URL in den App-Datenordner laden, Prüfsumme/Signatur prüfen, Update-Knopf (Infrastruktur aus 075).
  B als Folge-Prompt skizzieren, hier nicht bauen. Dasselbe für `ffmpeg` und die JS-Laufzeit: nur suchen.
- **E-b Zielordner (Marc, 25.11.2026: Selectbox):** Das Ziel wird in einer **Selectbox** gewählt, die genau zwei
  Einträge zeigt – den Ordner des **aktiven Tabs der linken** und den des **aktiven Tabs der rechten Seite**
  („Links · <Pfad>“, „Rechts · <Pfad>“, das aktive Panel gekennzeichnet). Kein freies Pfadfeld. Eine Seite, die
  keinen echten lokalen Ordner zeigt (Archiv, `remote://`, Ergebnis-Tab), erscheint gesperrt mit Grund. Offen fürs
  Design: Vorbelegung mit der **Gegenseite** (Ziel-Panel wie F5, Empfehlung) oder dem aktiven Panel; lange Pfade
  in der Box kürzen (Mitte), voller Pfad als Tooltip; der Dialog hält die **Tab-Id** und den Pfad zum Zeitpunkt
  des Starts fest (Navigieren während der Dialog offen ist, aktualisiert die Einträge).
- **E-c Ein Prozess für alle URLs oder einer je URL?** Empfehlung: **je URL ein Prozess**, nacheinander – sauberer
  Status je URL, Abbruch, Wiederholen (048) nur der fehlgeschlagenen. Parallelität (2–3 gleichzeitig) als Option
  prüfen, Default 1.
- **E-d Freie Zusatzoptionen:** Empfehlung: **kein freies Feld im Dialog**. Eigene Vorlagen leben in einer
  Konfig-Datei (`url-download.json`, Argument-Array je Vorlage, wie `tools.json`), und auch dort gilt eine
  **Erlaubnisliste** von Optionen (keine Verbotsliste – yt-dlp bekommt laufend neue Optionen). Was nicht auf der
  Liste steht, wird beim Laden mit Grund abgelehnt.
- **E-e Abbruch und Reste:** `.part`-Dateien behalten (Fortsetzen beim nächsten Versuch) oder aufräumen?
  Empfehlung: behalten, im Bericht nennen. Pause: nicht anbieten, wenn die Engine das je Job-Art erlaubt.
- **E-f URLs merken?** Vorlage und Optionen über `dialogs.recent` (027); die **URL-Liste nicht** speichern
  (Privatsphäre) – bestätigen lassen.
- **E-g Zwischenablage:** Enthält sie beim Öffnen http(s)-URLs, werden sie vorgeschlagen (ein Klick) statt
  ungefragt eingefügt? Lesen der Zwischenablage nur beim Öffnen durch den Nutzer.
- **E-h Aktion und Platz:** Id `OPEN_URL_DOWNLOAD_DLG`, Label „Download from URLs…“ / „Von URLs laden…“; Spalte im
  Actions-Menü und Kürzel aus dem Bestand ableiten (freie Tasten in allen drei Keymaps prüfen).

## Aufgaben

1. **Bestand prüfen:** `tools.rs` (`Invocation`, `command`, `spawn_error`), `file_actions.rs`
   (`launch_tool_with_env`), `shell/env.rs` (Login-`PATH`), `platform/process.rs` (`spawn_group`, Beenden der
   Gruppe je OS – yt-dlp startet `ffmpeg` als Kind), `jobs/shell.rs` (`Batcher`, Kodierung, ANSI), `jobs/manager.rs`
   + `jobs/report.rs` + `jobs/retry.rs`, `update_check.rs` (Umgang mit fremden Antworten). Tabelle „Baustein →
   passt / fehlt“. yt-dlp-Fakten oben gegen README und aktuelle Release-Notes prüfen.
2. **Reines Modul `url_download/` (Rust, ohne Tauri):**
   - **URLs prüfen:** nur `http`/`https`, geparst (nicht per Regex), Länge und Anzahl begrenzt, Duplikate
     zusammengeführt, keine Steuerzeichen. Fehler je Zeile zurück an den Dialog.
   - **Argumente bauen** aus einem typisierten `DownloadOptions`-DTO (kein Argument-String aus dem Frontend):
     immer `--ignore-config`, `--no-exec`, `--color never`, `--newline`, festes `--progress-template`,
     `--print after_move:filepath` (Ergebnisdateien), `-P <Ziel>`, `-o <Vorlage>`, dann `--` und **genau eine
     URL**. Tabellengetriebene Tests: Optionen → erwartetes Argument-Array.
   - **Namensvorlage prüfen:** nicht absolut, kein `..`, kein Laufwerk/UNC, Unterordner nur über die Option
     „Unterordner je Playlist“; Länge begrenzt. yt-dlp schreibt nie außerhalb des Zielordners – als Test mit einem
     Fake-Programm, das die Argumente protokolliert.
   - **Fortschritt parsen:** Vertrag der Fortschrittszeile im Design festlegen (eigener Präfix, feste Trenner),
     Zeilenlänge begrenzen, Steuerzeichen entfernen, Unbekanntes ignorieren. Fixtures aus **echten
     Aufzeichnungen** (Video, Audio mit Nachbearbeitung, Playlist, Fehler, „bereits vorhanden“).
   - **Programme finden:** yt-dlp, ffmpeg/ffprobe, JS-Laufzeit über Einstellung → Login-`PATH` → bekannte Orte;
     `--version` mit Timeout; Ergebnis als `DownloadTools { ytDlp, ffmpeg, jsRuntime }` mit Version oder Grund.
     Gefundene Pfade gehen als `--ffmpeg-location` / `--js-runtimes` an yt-dlp (Syntax prüfen).
3. **Job-Art `download`** (`jobs/download.rs`, `JobSpec::Download`): Elemente = URLs; je URL Status (läuft,
   fertig, übersprungen „bereits vorhanden“, Fehler mit bereinigter letzter Fehlerzeile), Fortschritt in Bytes,
   soweit bekannt, sonst unbestimmt; Phasen „lädt“ / „verarbeitet (ffmpeg)“. Abbruch beendet die **ganze
   Prozessgruppe** (auch `ffmpeg`), getestet auf Unix, Windows per `cfg`. Zielordner über
   `paths::validate_job_path`; Serverpfade (`remote::is_remote`), Archive und Ergebnis-Tabs werden abgelehnt;
   Ziel muss existieren und beschreibbar sein. Ende: Bericht mit Dateien und Summen, Panel frischt auf, optional
   Cursor auf die erste neue Datei. Wiederholen (048): nur die fehlgeschlagenen URLs.
4. **Commands** (dünn, async): `download_tools()` (Status der Programme), `download_check(urls, options)`
   (Prüfung für die Vorschau: ungültige Zeilen, Beispiel-Dateiname ohne Netz), Start über `JobsStore.start`.
   Optional `download_command_line(options)` für „Befehl kopieren“ (Quotierung über `shell_quote`).
   DTOs in `model.rs` ↔ TS, neue `FsError`-Codes (`download_tool_missing`, `download_invalid_url`,
   `download_invalid_template`, `download_failed` …) auf beiden Seiten + `describeFsError()`.
5. **Vorlagen:** eingebaut „Bestes Video“, „Video bis 1080p (mp4)“, „Nur Audio (mp3)“, „Nur Audio (Original,
   m4a/opus)“ – genaue `-f`/`-S`-Ausdrücke im Design begründen und gegen die README prüfen. Dateinamen-Vorlagen
   zur Auswahl: `%(title)s [%(id)s].%(ext)s` (yt-dlp-Default), `%(title)s.%(ext)s`,
   `%(uploader)s - %(title)s.%(ext)s`, `%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s`, für Playlists
   `%(playlist_index)02d - %(title)s.%(ext)s`; dazu freie Eingabe mit Prüfung und einer kurzen Platzhalter-Hilfe.
   Eigene Vorlagen nach E-d in `url-download.json` (Defaults-Datei, Export/Import wie 022).
6. **Dialog** (`features/urldownload/`, `UrlDownloadStore`, `UrlDownloadApi` + Fake in `src/testing/`): Aufbau
   wie in der Skizze. Ziel-Selectbox nach E-b (natives `<select>` bzw. das vorhandene Auswahl-Widget, per Tastatur
   bedienbar, Einträge aus dem `WorkspaceStore` per Tab-Id). Statuszeile der Programme mit Zuständen fehlt/zu alt/ok; fehlt yt-dlp → Formular gesperrt
   und Installationshilfe; fehlt ffmpeg → Optionen, die es brauchen, gesperrt mit Grund; fehlt die JS-Laufzeit →
   Hinweis „YouTube braucht …“, kein Sperren. Cookies aus Browser: Default „keine“, beim Einschalten ein Hinweis,
   dass yt-dlp die Cookies des Browsers liest (Schlüsselbund-Abfrage auf dem Mac); kein Feld für
   Benutzername/Passwort. Tasten: ↩ = Laden, Esc, im URL-Feld Enter = neue Zeile (Start dort über das
   Dialog-Kürzel nach 057/076), Rollen und Tastenkappen nach 076. „Vorhandene überschreiben“ ist nie vorgewählt.
7. **Einstellungen (015):** `download.ytDlpPath`, `download.ffmpegPath`, `download.jsRuntimePath` (leer =
   suchen), ggf. `download.parallel`. Keine automatische Netzverbindung, kein Selbst-Update von yt-dlp durch die
   App (`-U` wird nie übergeben; Hinweis im Dialog, wenn die Version älter als z. B. 90 Tage ist).
8. **Aktion & Einstiege:** nach E-h im Aktionskatalog, Actions-Menü, Hauptmenü (Spiegel-Test 056),
   Befehlspalette, Button-Leiste konfigurierbar. Gesperrt, wenn **keine** der beiden Seiten einen echten lokalen Ordner zeigt. **Nicht**
   über MCP (071) erreichbar.
9. **Geheimnisse und Protokoll:** URLs, Cookies-Optionen und die Ausgabe von yt-dlp nie loggen; im Job-Bericht
   nur Host + gekürzter Pfad je URL, bis der Nutzer die Zeile aufklappt (im Design entscheiden).
10. **Texte** en/de (`urldownload-texts.ts` + `.de.ts`), Mehrzahl als Katalogfunktionen; neutrale Benennung
    („Download from URLs“, nicht „YouTube-Downloader“).
11. **Doku:** `docs/architecture.md` (Entscheidungen, Sicherheitsmodell als eigener Absatz neben der
    Shell-Ausnahme, keine neue Abhängigkeit bzw. Begründung), `docs/licenses.md` (yt-dlp wird nicht mitgeliefert),
    README-Feature mit Screenshot (044) und dem Satz, dass yt-dlp/ffmpeg selbst zu installieren sind und der
    Nutzer für die Rechte an den Inhalten verantwortlich ist, `docs/roadmap.md`, `CLAUDE.md` §3/§4, Index
    `prompts/README.md`.

## Akzeptanzkriterien

- Dialog über Actions-Menü, Hauptmenü, Palette und Kürzel; die Ziel-Selectbox zeigt genau die Ordner der aktiven
  Tabs links und rechts, ist nach E-b vorbelegt und per Tastatur umschaltbar; der Job lädt in den gewählten Ordner.
- Drei URLs, eine davon `ftp://…` und eine doppelt → „2 URLs · 1 ungültig (Zeile 2)“, Start erst ohne ungültige
  Zeile. Eine „URL“ `--exec=…` oder `-o /tmp/x` wird als ungültig abgelehnt und erreicht yt-dlp nie als Option.
- Namensvorlage `../x`, `/etc/x`, `C:\x` → abgelehnt mit Grund, Knopf gesperrt.
- Job mit Fake-yt-dlp: Fortschritt je URL, zweite URL scheitert → „Done with errors“, Bericht nennt den Grund,
  **Retry** lädt nur diese URL erneut. Abbruch mitten im Download beendet auch den Kindprozess; kein Prozess
  bleibt übrig.
- yt-dlp fehlt → Installationshilfe statt Formular; ffmpeg fehlt → „Nur Audio (mp3)“ gesperrt mit Grund.
- Auf Marcs Mac (aus dem Finder gestartet, Homebrew): yt-dlp, ffmpeg und deno werden gefunden; ein echtes Video
  und eine Audio-Extraktion landen im Zielordner, das Panel zeigt die Datei ohne manuelles Auffrischen.
- Zeigt eine Seite ein Archiv, `remote://…` oder einen Ergebnis-Tab → ihr Eintrag in der Selectbox ist gesperrt
  (Grund sichtbar), die andere Seite ist vorgewählt; gilt das für beide Seiten, ist die Aktion gesperrt. Rust lehnt
  ein solches Ziel ebenfalls ab.
- Titel mit Emoji, Umlauten, `/`, sehr langem Namen → gültige Datei im Zielordner, nichts außerhalb.
- Bedienung komplett per Tastatur, light und dark, Texte deutsch/englisch.

## Tests

- **Rust:** URL-Prüfung, Argument-Bau (Tabelle; jede Option, immer `--` vor der URL, nie eine Option aus
  Nutzertext), Vorlagenprüfung, Erlaubnisliste der Konfig-Vorlagen, Fortschritts-Parser gegen Fixtures (auch
  kaputte/überlange Zeilen, CRLF, Nicht-UTF-8), Programmsuche mit künstlichem `PATH`. Job-Tests mit einem
  **Fake-Programm** (Skript bzw. kleines Test-Binary: gibt aufgezeichnete Zeilen aus, schläft, startet ein Kind,
  endet mit Fehlercode) – **kein Netz in den Tests**. `commands::command_rules` bleibt grün.
- **Frontend:** Store mit `FakeUrlDownloadApi` (Zeilen zählen, Vorlage → Optionen, Sperren je fehlendem Programm,
  veraltete Antworten, Ziel-Selectbox: Einträge/Vorbelegung/gesperrte Seite, Start nur mit gültigen URLs, URLs
  nicht in `dialogs.recent`), `dialog-roles.spec.ts`,
  `catalogs.spec.ts`, Spiegel-Test des Menüs.
- **E2E:** im Container mit dem Fake-Programm (Pfad über die Einstellung); der Lauf mit echtem yt-dlp und Netz
  ist Marcs Abnahme auf dem Mac – im Bericht ausdrücklich so nennen.
- **Review durch einen separaten Agenten** (000 Phase 6), Schwerpunkte: Argument-Injektion (URL, Vorlage,
  Konfig-Vorlagen), Schreiben außerhalb des Ziels, Prozessbaum beim Abbruch, feindliche Ausgabe im UI
  (kein `innerHTML`), Geheimnisse in Logs/Events.

## Nicht in diesem Prompt (→ „Offen“ im Design)

- yt-dlp/ffmpeg/Deno durch die App herunterladen und aktuell halten (E-a Variante B).
- Formatliste je URL vorab abfragen (`-F`/`--dump-json`) und im Dialog auswählen.
- URLs aus dem Browser per Drag & Drop auf ein Panel (012) oder über ein URL-Schema annehmen.
- Download-Archiv (`--download-archive`), Abos/Kanäle zeitgesteuert, SponsorBlock, Kapitel-Splitting.
- Benutzername/Passwort, `--cookies`-Datei, Proxy-Einstellungen.
- Download direkt auf Serverpfade oder in Archive.
