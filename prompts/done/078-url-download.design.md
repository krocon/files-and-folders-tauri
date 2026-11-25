# Design 078: URL-Download – URLs mit yt-dlp in den Zielordner laden

> **Status:** umgesetzt (Phasen 1–5), Abnahme mit echtem yt-dlp und Netz sowie externes Review stehen aus (Marc) · **Datum:** 25.11.2026
> · **Auftrag:** [078-url-download.md](078-url-download.md) · **Branch:** `feat/url-download`
> **Kein Haltepunkt nach Phase 1** (Marc, 25.11.2026): die Entscheidungen E-a … E-h sind hier getroffen und begründet.

## Kurzfassung der Entscheidungen

| | Entscheidung |
|---|---|
| E-a | yt-dlp, ffmpeg/ffprobe und die JS-Laufzeit werden **nur gesucht** (Einstellung → Login-`PATH` → bekannte Orte), nie geladen oder aktualisiert. „yt-dlp verwalten“ = Folge-Prompt (Skizze unter „Offen“). |
| E-b | Ziel = **Selectbox** mit genau zwei Einträgen (Links/Rechts, aktiver Tab), vorbelegt mit der **Gegenseite** (wie F5); gesperrte Seite mit Grund; der Dialog hält Seite + Tab-Id, der Pfad wird beim Start gelesen. |
| E-c | **Je URL ein Prozess**, nacheinander. Keine Option `download.parallel`: die Job-Art läuft neben der seriellen Warteschlange, ein zweiter Download-Job läuft also ohnehin parallel. |
| E-d | **Kein freies Optionsfeld.** Eigene Vorlagen in `url-download.json` als Argument-Array, geprüft gegen eine **Erlaubnisliste** (Option → Werte-Prüfer); Unbekanntes wird beim Laden mit Grund abgelehnt. Das Frontend schickt nur die **Id** der Vorlage. |
| E-e | `.part`-Dateien **bleiben** nach Abbruch/Fehler (yt-dlp setzt beim nächsten Versuch fort). **Keine Pause** für diese Job-Art. |
| E-f | Optionen/Vorlage über `dialogs.recent` (`urlDownload`); die **URL-Liste wird nie gespeichert**. |
| E-g | Die Zwischenablage wird **nur auf Knopfdruck** („Aus Zwischenablage einfügen“) gelesen, nie beim Öffnen: kein Lesen ohne Zutun, kein Rechte-Dialog des Systems beim Öffnen. Übernommen werden nur Zeilen, die wie `http(s)://…` aussehen. |
| E-h | Aktion `OPEN_URL_DOWNLOAD_DLG`, „Download from URLs…“ / „Von URLs laden…“, Kategorie `files`; Actions-Menü Spalte 3 unter „Pack…“; Hauptmenü „Commands“; Kürzel **`Mod+Alt+U`** (in allen drei Keymaps frei). |

## 1. Bestand

| Baustein | Wofür | passt / fehlt |
|---|---|---|
| `tools.rs` (`command`, `spawn_error`, `program_ok`) | Start ohne Shell, „Programm nicht gefunden“ | `spawn_error` passt; `Invocation`/`spawn_detached` nicht (losgelöst, ohne Pipes) |
| `commands/shell.rs::tool_env` + `shell/env.rs` (061) | Login-`PATH` + bekannte Orte (`/opt/homebrew/bin` …) | **passt unverändert** – liefert `PATH`, `LANG`, `LC_*` |
| `platform/process.rs` (`spawn_group`, `terminate`, `kill`) | eigene Prozessgruppe (Unix `setsid`/`killpg`, Windows Job Object) | **passt** – yt-dlp startet `ffmpeg` als Kind in derselben Gruppe |
| `jobs/shell.rs` (`Batcher`, Reader-Threads) | Ausgabe streamen | Reader-Muster übernommen; `Batcher` **nicht** (wir senden keine Ausgabe ans Fenster, nur geparste Zahlen) |
| `shell/text.rs` (`Decoder`, `strip_ansi`) | Kodierung/ANSI | **passt** |
| `shell/env.rs::new_marker` | Zufallsmarke (061) | **passt** – Marke je Prozess vor jeder Protokollzeile |
| `jobs/manager.rs`, `retry.rs`, `report.rs` | Job-Art, Retry | **erweitern**: `JobSpec::Download`, `normalize`/`validate`, Retry nur der fehlgeschlagenen URLs |
| `mcp/jobs.rs` (`READ_KINDS`) | MCP startet nur lesende Jobs | **passt** – `download` steht nicht darin (Test ergänzt) |
| `config_file.rs`, `settings.rs` (Bündel) | Konfig-Datei, Export/Import | **erweitern**: Teil `urlDownload`; neuer Einstellungstyp `string` (Programmpfade) |
| `shared/dialog-memory.ts` (027) | letzte Eingaben | **erweitern**: `urlDownload` |
| `McpGuardService` (071) | Sperre nach Ansichtsänderung durch einen Client | **passt**: Kategorie `files` → die Aktion ist während der Sperre vetiert |
| `url`-Crate | URLs parsen | schon im Baum (2.5.8 über `reqwest`/`tauri`), jetzt **direkte** Abhängigkeit |

### yt-dlp-Fakten, nachgeprüft am 25.11.2026

Quelle: die lokal installierte Version **2026.11.23** (Homebrew, neuer als die 2026.10.21 im Auftrag) – `--help`,
die mitgelieferte `README.md` und der installierte Python-Quelltext. Kein Lauf gegen eine URL.

- Lizenz: Unlicense; die PyInstaller-Binaries als Ganzes GPLv3+ (README „Licensing“) → **nicht bündeln**.
- `--print` „Implies `--quiet`“ (`opts.quiet` wird gesetzt, sobald `forceprint` da ist) – der Fortschritt braucht
  deshalb ausdrücklich `--progress`. Mit `before_dl:`/`after_move:` wird nicht simuliert; `--no-simulate` steht
  trotzdem dabei.
- `--js-runtimes RUNTIME[:PATH]`, Mindestversionen im Quelltext: deno 2.3.0, node 22.0.0 (bun 1.2.11, quickjs
  2023-12-09 – beide suchen wir nicht).
- **`-P` ist unbrauchbar für fremde Pfade:** `get_output_path` ruft `expand_path(paths['home'].strip())` – Leerzeichen
  am Rand gehen verloren, `$VAR`/`~` werden ersetzt. → Wir übergeben **kein `-P`**, sondern setzen den Zielordner als
  **Arbeitsordner** des Prozesses (`current_dir`). Abweichung vom Auftrag („`-P <Ziel>`“), begründet durch den
  Quelltext.
- **`-o` wird ebenfalls expandiert** (`_outtmpl_expandpath`) und als `[TYPES:]TEMPLATE` gelesen: `$HOME` als Vorlage
  ergäbe einen absoluten Pfad. → Vorlagenprüfung verbietet `$`, führendes `~`, jeden Trenner, `:` außerhalb von
  Feldern und einen Typ-Präfix.
- Feldwerte werden für Dateinamen bereinigt (`/` → `⧸`, Steuerzeichen weg), aber ein Wert `..` bleibt `..`
  (`sanitize_filename` mit `is_id=NO_DEFAULT` streift führende Punkte nicht ab). Als ganzer Pfadbestandteil wäre das
  ein Ausbruch um eine Ebene → der Playlist-Unterordner heißt immer `<Titel> [<Id>]` (nie nur Punkte), alle
  anderen Vorlagen sind ein einziger Bestandteil, der auf `.%(ext)s` endet.
- Fortschritt: `--progress-template "download:…"` mit `progress.status|downloaded_bytes|total_bytes|
  total_bytes_estimate|speed|eta`, `"postprocess:…"` mit `progress.status|postprocessor`; fehlende Werte = `NA`.
  Ausgabe über `stdout`, Fehler als `ERROR: …` über `stderr`.
- Ausgabe-Kodierung = Locale (`preferredencoding`); eine aus dem Finder gestartete App hat kein `LANG` →
  `--encoding utf-8` plus `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`.
- „Bereits vorhanden“: yt-dlp setzt intern `info['__real_download'] = False`; in `--quiet` gibt es keine Meldung.
  Wir drucken das Feld mit (`%(__real_download|NA)s`); fehlt es in einer künftigen Version, zählt die Datei als
  geladen (kein Fehler). **Internes Feld – Punkt für Marcs Abnahme.**

## 2. Entscheidungen im Einzelnen

### E-a Woher kommt yt-dlp? → nur suchen ✅
Optionen: A suchen · B durch die App laden und aktuell halten. **A.** Gründe wie im Auftrag (GPLv3+-Binary in
einer MIT-App, Notarisierung, Verfallsdatum). Suche je Programm: Einstellung (`download.ytDlpPath`,
`download.ffmpegPath`, `download.jsRuntimePath`; leer = suchen; absoluter Pfad zur Datei) → Ordner des
Start-`PATH` (`tool_env`: Login-`PATH` nach 061 + `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` …; Windows:
`PATH` + `.exe`). JS-Laufzeit: `deno`, sonst `node`. `--version` (ffmpeg `-version`) mit Zeitlimit (yt-dlp 20 s –
ein PyInstaller-Binary entpackt sich beim ersten Start –, sonst 5 s); die Versionsausgabe wird auf
`[0-9A-Za-z.+_-]{1,40}` gekürzt. Zustände je Programm: `ok` · `missing` · `tooOld` (JS-Laufzeit unter der
Mindestversion) · `failed` (startet nicht / antwortet nicht) · zusätzlich `outdated` für yt-dlp, wenn das
Versionsdatum älter als 90 Tage ist (Hinweis, kein Sperren). Die App übergibt nie `-U`.

### E-b Zielordner → Selectbox, Gegenseite vorgewählt ✅
Natives `<select>` (Tastatur ohne Zutun, Screenreader). Einträge „Links · ‹Pfad›“ / „Rechts · ‹Pfad›“, das aktive
Panel mit „(aktives Panel)“; lange Pfade in der Mitte gekürzt (`…`), voller Pfad als `title` und in der Zeile
darunter. Eine Seite ist **gesperrt** (`disabled`, Grund im Text), wenn ihr aktiver Tab keinen echten lokalen
Ordner zeigt: Ergebnis-/Belegungs-Tab, Archiv (`listing.archive`), Server (`remote://`), noch kein Ordner.
Vorbelegung: Gegenseite, wenn sie frei ist, sonst das aktive Panel; sind beide gesperrt, ist die Aktion gesperrt.
Der Store hält **Seite und Tab-Id**; die Einträge sind `computed` aus dem `WorkspaceStore` (Navigieren bei offenem
Dialog aktualisiert sie). Wechselt der aktive Tab der gewählten Seite, bleibt die Seite gewählt und zeigt den
neuen Ordner – **der Pfad, der im Dialog steht, ist der, der beim Start gilt**. Rust prüft das Ziel erneut.

### E-c Ein Prozess je URL ✅
Sauberer Status je URL, Abbruch trifft genau einen Prozessbaum, Retry nur der fehlgeschlagenen. Kosten: yt-dlp
startet je URL neu (≈ 1 s). Parallelität innerhalb eines Jobs: nicht gebaut (YouTube drosselt, der Fortschritt
würde unlesbar); `JobSpec::Download` ist `is_parallel()` – ein Download blockiert Kopieren/Verschieben nicht und
ein zweiter Download-Job läuft daneben. Kein Helfer-Job: Beenden der App fragt nach.

### E-d Kein freies Feld, Erlaubnisliste ✅
`url-download.json` im App-Konfigurationsordner:

```json
{ "version": 1,
  "presets": [ { "id": "720p-mkv", "label": "Video 720p (mkv)",
                 "args": ["-S", "res:720", "--merge-output-format", "mkv"] } ] }
```

Jedes Argument ist ein erlaubter **Schalter** oder eine erlaubte **Option mit Wert** (Wert = nächstes Element oder
`--opt=wert`); Kurzformen werden auf die Langform abgebildet, an yt-dlp geht immer `--lang=wert` (ein Wert kann nie
als Option gelesen werden). Erlaubt (Stand 078): `-f/--format`, `-S/--format-sort`, `-x/--extract-audio`,
`--audio-format`, `--audio-quality`, `--merge-output-format`, `--remux-video`, `--recode-video`, `--embed-thumbnail`,
`--embed-metadata`, `--embed-chapters`, `--embed-subs`, `--write-subs`, `--write-auto-subs`, `--sub-langs`,
`--sub-format`, `--convert-subs`, `--convert-thumbnails`, `-r/--limit-rate`, `-N/--concurrent-fragments`,
`-R/--retries`, `--fragment-retries`, `-I/--playlist-items`, `--max-filesize`, `--min-filesize`,
`--sponsorblock-remove`, `--sponsorblock-mark`, `--mtime`, `--no-mtime`. Jeder Wert hat einen eigenen Prüfer
(Zeichenmenge, Länge). **Nicht** erlaubt und nie erlaubbar über die Datei: alles, was Programme startet oder
Pfade nimmt (`--exec`, `--netrc-cmd`, `--downloader`, `--postprocessor-args`, `--use-postprocessor`,
`--config-locations`, `--plugin-dirs`, `--batch-file`, `--load-info-json`, `--cookies`, `-o`, `-P`, `--paths`,
`--ffmpeg-location`, `--print-to-file`, `--download-archive`, `--cache-dir`, `--proxy` …). Eine Vorlage mit einem
abgelehnten Argument wird **als Ganzes** verworfen und im Dialog mit Grund genannt (`downloadPresets.problems`).
Eine gewählte eigene Vorlage ersetzt die Gruppe „Inhalt/Höchstens/Container/Audio“; Dateiname, Playlist, Extras und
Cookies kommen weiter aus dem Dialog. Die Datei wird beim ersten Lesen mit leerer Liste und einem Beispiel
(`example`, wird nicht ausgewertet) angelegt; sie reist im Export/Import-Bündel als Teil `urlDownload`.

### E-e Abbruch, Reste, Pause ✅
Abbruch: `SIGTERM` an die Gruppe, nach 1 s `SIGKILL` (Windows: Job Object beenden); danach wird gewartet, bis die
Gruppe leer ist (höchstens 3 s). `.part`/`.ytdl` bleiben liegen – yt-dlp setzt fort (`--continue` ist Default); der
Bericht nennt das. Pause: `SIGSTOP` hielte Verbindungen offen, bis der Server sie schließt → nicht angeboten
(`canPause` im Frontend schließt `download` aus, `JobManager::pause` ignoriert die Art).

### E-f URLs nicht merken ✅
`rememberDialog('urlDownload', form)` speichert nur das Formular (Vorlage, Felder, Dateinamen-Vorlage). Die URLs
stehen im `JobSpec` des laufenden/fertigen Jobs (Speicher, Tasks-Dialog) und nirgends sonst; ein Test prüft, dass
`dialogs.recent` keine URL enthält. Die Wahl „Cookies aus Browser“ wird **nicht** gemerkt (jedes Mal bewusst).

### E-g Zwischenablage nur auf Knopfdruck ✅
Abweichung von der Neigung im Auftrag („beim Öffnen vorschlagen“): schon das Vorschlagen setzt das Lesen voraus.
Der Knopf liest über die vorhandene `ClipboardApi`, übernimmt nur `http(s)://`-Zeilen (höchstens 200, je 2048
Zeichen), hängt sie an und meldet die Zahl; alles andere bleibt unsichtbar.

### E-h Aktion und Platz ✅
`OPEN_URL_DOWNLOAD_DLG` (Kategorie `files` → Veto während der MCP-Sperre, Veto in Bilder-Übersicht nicht nötig:
der Dialog arbeitet nicht auf der Auswahl). Actions-Menü Spalte 3 (Dateien) nach „Pack…“ mit Trennlinie davor –
mr hatte dort „Download“ (HTTP-Transport), der Platz ist historisch. Hauptmenü „Commands“ nach der Speicherbelegung.
Kürzel `Mod+Alt+U` (U wie URL) auf macOS, Windows, Linux; Palette und Button-Leiste folgen aus dem Katalog.

### Weitere Entscheidungen

- **E-i Woher der Job die Programme kennt.** `JobSpec::Download { urls, targetDir, options }` ist normal
  deserialisierbar (Start über `JobsStore.start`, Retry über den Spec). Programmpfade, Umgebung und eigene Vorlagen
  stehen **nicht** im Spec: der `JobManager` bekommt in `lib.rs` einen `DownloadEnv`-Lieferanten
  (`set_download_env`), der beim Start des Jobs Einstellungen, `tool_env` und `url-download.json` liest. Das Frontend
  kann also weder ein Programm noch ein Argument bestimmen; Tests setzen den Lieferanten auf ein Fake-Programm.
- **E-j Protokoll statt Bildschirmausgabe.** Jede Zeile, die wir auswerten, beginnt mit einer Zufallsmarke
  (32 Hex-Zeichen, je Prozess neu): eine Webseite kann über Titel oder Fehlertexte keine Protokollzeile fälschen.
  Titel und Dateipfad kommen als JSON (`%(…)j`, einzeilig). Alles andere auf `stdout` wird verworfen; von `stderr`
  bleibt nur die letzte `ERROR:`-Zeile (sonst die letzte Zeile) – ohne Steuer- und Bidi-Zeichen, auf 300 Zeichen
  gekürzt – als `message` des `download_failed`-Fehlers.
- **E-k Anzeige der URL.** `Progress.current` trägt nur `host/…/letztes-Segment` (ohne Query); die volle URL steht im
  Spec und in `ItemError.path` (Details des Tasks, vom Nutzer aufgeklappt) – beides nur im Speicher, nie im Log.
- **E-l MCP (071).** Kein Werkzeug startet die Job-Art (`READ_KINDS`, Test), keine Vorschlagsart „download“. Der
  Dialog braucht **keinen** eigenen `McpGuardService`-Anschluss: er wirkt nicht auf Markierung/Cursor; ein von
  einem Client gewechselter Ordner steht ausgeschrieben in der Selectbox, die URLs tippt der Nutzer selbst, und im
  URL-Feld ist Enter ein Zeilenwechsel – ein „blindes Enter“ startet nichts. Die kurze Sperre nach einer
  Ansichtsänderung greift über die Kategorie `files` wie bei jeder Dateiaktion.
- **E-m Plugins/Cache von yt-dlp** bleiben, wie der Nutzer sie eingerichtet hat (`--ignore-config` betrifft nur
  Konfigurationsdateien): PO-Token-Provider für YouTube sind Plugins. Kein `--no-plugin-dirs`.
- **E-n Neuer Einstellungstyp `string`** (`maxLength`), weil Programmpfade weder Enum noch Liste sind; Rust und
  TS prüfen gleich (keine Steuerzeichen, Länge).

## 3. Verträge

### Rust `url_download/` (rein, ohne Tauri)

```rust
// mod.rs
pub struct DownloadOptions {            // serde camelCase, deny_unknown_fields, alles mit Default
    pub preset: Option<String>,         // Id einer eigenen Vorlage aus url-download.json
    pub content: Content,               // video | audio
    pub max_height: Option<u32>,        // 2160|1440|1080|720|480|360
    pub container: Container,           // auto | mp4 | mkv
    pub audio_format: AudioFormat,      // best | mp3 | m4a | opus
    pub template: String,               // Dateinamen-Vorlage
    pub playlist: bool, pub playlist_subfolder: bool,
    pub subtitles: bool, pub sub_langs: String,
    pub embed_thumbnail: bool, pub embed_metadata: bool,
    pub overwrite: bool,
    pub cookies_browser: Option<Browser>, // brave|chrome|chromium|edge|firefox|opera|safari|vivaldi
}
// urls.rs
pub fn check_text(text: &str) -> UrlCheck          // { urls, problems:[{line, reason}], duplicates, tooMany }
pub fn check_one(url: &str) -> Result<String, UrlReason>   // invalid|scheme|noHost|credentials|control|tooLong
// template.rs
pub fn validate(template: &str) -> Result<(), TemplateReason>
pub fn example(template: &str, options: &DownloadOptions) -> String
// presets.rs
pub fn load(file) -> Loaded<PresetFile>;  pub fn check_args(args) -> Result<Vec<String>, String>
// args.rs
pub fn build(options, env: &DownloadEnv, marker, url) -> Result<Vec<String>, FsError>
// progress.rs
pub fn parse(marker, line) -> Option<Line>         // Item{title} | Download{..} | Post{..} | File{real, path}
// tools.rs
pub fn locate(settings, path_dirs) -> Located;  pub fn probe(located) -> DownloadTools
```

Argumente, immer in dieser Reihenfolge (`--opt=wert`, nie zwei Elemente):

```
--ignore-config --no-exec --no-simulate --color=never --encoding=utf-8
--newline --progress --progress-delta=0.25
--progress-template=download:<M>|dl|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s
--progress-template=postprocess:<M>|pp|%(progress.status)s|%(progress.postprocessor)s
--print=before_dl:<M>|item|%(title)j
--print=after_move:<M>|file|%(__real_download|NA)s|%(filepath)j
--trim-filenames=160
[--ffmpeg-location=<pfad>] [--js-runtimes=<deno|node>:<pfad>]
<Format: aus den Feldern oder aus der eigenen Vorlage>
--no-playlist | --yes-playlist
[--write-subs --sub-langs=<l>] [--embed-thumbnail] [--embed-metadata] [--force-overwrites]
[--cookies-from-browser=<browser>]
--output=<[<Playlist-Ordner>/]Vorlage>
-- <URL>
```

Format aus den Feldern (README „Format selection examples“ / „Sorting formats“):

| Wahl | Argumente |
|---|---|
| Video, beliebig, Container auto („Bestes Video“) | – (yt-dlp-Default `bv*+ba/b`) |
| Höchstens *H* | `--format-sort=res:H` (größte Auflösung bis *H*, sonst die kleinste darüber) |
| Container mp4 | `--format=bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b --merge-output-format=mp4` |
| Container mkv | `--merge-output-format=mkv` |
| nur Audio, Original | `--format=ba/b --extract-audio` |
| nur Audio mp3 | `--format=ba/b --extract-audio --audio-format=mp3 --audio-quality=0` |
| nur Audio m4a / opus | `--format=ba[ext=m4a]/ba/b` bzw. `ba[ext=webm]/ba/b`, `--extract-audio --audio-format=…` |

Eingebaute Vorlagen (Frontend, setzen nur Felder): „Bestes Video“ (video/beliebig/auto), „Video bis 1080p (mp4)“
(video/1080/mp4), „Nur Audio (mp3)“, „Nur Audio (Original)“. Brauchen ffmpeg: Audio, Container ≠ auto, Thumbnail/
Metadaten einbetten – ohne ffmpeg im Dialog gesperrt, in Rust `download_tool_missing`.

Namensvorlage: 1–200 Zeichen; verboten: Steuerzeichen, `/`, `\`, `$`, führendes `~`, `"*<>?|`, `:` außerhalb von
`%(…)`, jedes `%`, das kein Feld `%(…)[flags][breite][.genauigkeit]typ` oder `%%` ist; muss auf `.%(ext)s` enden.
Playlist-Unterordner (nur `playlist && playlistSubfolder`): Präfix
`%(playlist_title|Playlist).80s [%(playlist_id|-).40s]/` – von Rust, nie aus Nutzertext.

### Job `download`

```rust
JobSpec::Download { urls: Vec<String>, target_dir: String, #[serde(default)] options: DownloadOptions }
```

`normalize`: `target_dir` über `validate_job_path` (Serverpfade vorher abgelehnt). `validate`: 1–200 URLs, jede
= `check_one(url)` (schon normalisiert), Ziel ist ein vorhandener, beschreibbarer Ordner (Archivpfade scheitern an
„kein Ordner“), Vorlage und Optionen gültig. Lauf je URL: Marke, Argumente, `spawn_group` mit `current_dir(ziel)`
und der Umgebung; Zeilen lesen (höchstens 16 KiB je Zeile, Rest verworfen); `Progress` = `itemsDone/itemsTotal`
(URLs), `bytesDone/bytesTotal` der laufenden Datei (unbekannt = 0), `rateBps`, `current` (gekürzte URL),
`phase` (`downloading` | `processing`, neu, optional). Ergebnis je URL: Exit 0 → fertig bzw. „übersprungen“, wenn
alle gemeldeten Dateien schon da waren; sonst `ItemError { path: url, error: download_failed }`. Gemeldete
Dateipfade werden gegen das Ziel aufgelöst und **nur behalten, wenn sie im Ziel liegen**. Nach jeder URL
`dirsChanged([ziel])`. `Summary.download = { files (≤ 500), fileCount, cancelledParts }`. Zustand: `done` /
`doneWithErrors` / `cancelled` / `failed` (yt-dlp fehlt, Ziel weg). Retry (048): `failed` → derselbe Spec;
`doneWithErrors` → Spec mit genau den fehlgeschlagenen URLs (String-Gleichheit, Fehlerliste vollständig).

### Commands (`commands/url_download.rs`, alle `async`)

| Command | Parameter → Rückgabe |
|---|---|
| `download_tools` | – → `DownloadTools { ytDlp, ffmpeg, jsRuntime }` je `{ state, version?, path?, name? }` + `ytDlpOutdated` |
| `download_presets` | – → `{ presets: [{id,label}], problems: [{id, reason}], warning? }` |
| `download_check` | `text, options` → `{ urls, problems, duplicates, tooMany, template: reason?, example }` |
| `download_command_line` | `options` → `string` (für „Befehl kopieren“: `yt-dlp … -- <URL>`, POSIX/PowerShell-quotiert, Marke `…`) |

Neue Fehlercodes: `download_tool_missing`, `download_invalid_url`, `download_invalid_template`,
`download_invalid_options`, `download_failed` (Rust `FsErrorCode`, TS `FsErrorCode`, `describeFsError()`).

### Frontend

`core/urldownload/` (`UrlDownloadApi`, Modelle), `features/urldownload/` (`UrlDownloadStore` Root, `url-download-
logic.ts` rein, Dialog, Aktionen, Texte en/de), `src/testing/fake-url-download-api.ts`. `DialogKind` `'url-download'`.

```
┌ Von URLs laden ─────────────────────────────────────────────────────────────┐
│ Ziel   [Rechts · /…/Filme.nosync ▾]                    1 select (Autofokus: 2) │
│ URLs (eine je Zeile)                       [Aus Zwischenablage einfügen ⌘P]    │
│ ┌ textarea ─────────────────────────┐                  2 textarea (Autofokus)  │
│ └───────────────────────────────────┘                                          │
│ 2 URLs · 1 ungültig (Zeile 2: kein http/https)         aria-live=polite        │
│ Vorlage [..▾]  Inhalt (•)( )  Höchstens [▾] Container [▾] Audio [▾]   3–7      │
│ Dateiname [combobox: input + datalist]  z. B. „…“ / Grund                8     │
│ Playlist (•)( ) ☐ Unterordner   Extras ☐☐☐☐ [de,en]   Cookies [keine ▾]  9–    │
│ yt-dlp 2026.11.23 ✓ · ffmpeg 9.1 ✓ · deno 2.9.8 ✓        [Befehl kopieren]     │
│                                             [Esc Abbrechen] [⌘↩ Laden]         │
└────────────────────────────────────────────────────────────────────────────────┘
```

Tasten: Esc schließt; Enter in einem Feld außer dem URL-Feld = Laden; im URL-Feld Enter = neue Zeile, Laden mit
`Mod+Enter` (eigener `keydown` am Feld; der Knopf hat die Rolle `primary` mit Tastenkappe nach 076, ein Hinweis
unter dem Feld nennt die Taste); „Aus Zwischenablage“ `secondary:P`, „Befehl kopieren“ `secondary:K`, „Erneut
suchen“ `secondary:R` (`V` und `C` sind in Dialogen reserviert, 057 E3). yt-dlp fehlt → statt des Formulars die Installationshilfe (Befehle je OS als Text zum Kopieren,
Projektseite als Text – kein Link, der ohne Zutun öffnet) und „Erneut suchen“. Alle Texte von yt-dlp (Titel,
Fehler) erscheinen nur über Interpolation (`textContent`), nie `innerHTML`.

## 4. Sicherheitsmodell (Kurz)

1. **Kein Kommando aus dem Frontend:** das Programm kommt aus Einstellung/Suche, die Argumente baut `args::build`
   aus Enums, geprüften Zahlen und zwei geprüften Texten (Vorlage, Untertitelsprachen); eigene Vorlagen nur über die
   Erlaubnisliste. Jede Option mit Wert ist **ein** Element `--opt=wert`.
2. **Die URL** ist geparst, hat Schema http/https und wird in der Form des Parsers übergeben – nach `--`.
3. **Schreiben nur im Ziel:** Arbeitsordner = Ziel, Vorlage ohne Trenner/`..`/Expansion, Unterordner nur aus Rust.
   Verbleibendes Vertrauen: yt-dlp bereinigt Feldwerte (geprüft im Quelltext 2026.11.23).
4. **Ausgabe ist feindlich:** Marke je Prozess, Zeilenlänge begrenzt, Zahlen als Zahlen, Texte bereinigt und gekürzt,
   Pfade nur innerhalb des Ziels. Nichts davon wird geloggt; es gibt in `jobs/download.rs` und `url_download/` keinen
   `log::`-Aufruf mit URL, Argument oder Ausgabe.
5. **Shell-Ausnahme unberührt:** `JobSpec::Shell`/`run_shell` unverändert; `download` startet nie eine Shell.
6. **Kein Netz ohne Zutun:** `download_tools` startet nur `--version` lokaler Programme; yt-dlp läuft erst nach
   „Laden“. Kein Selbst-Update.

## 5. Tests

- **Rust rein:** URL-Tabelle (ftp, `--exec=…`, `-o /tmp/x`, Leerzeichen, Steuerzeichen, Zugangsdaten, IDN, Länge,
  Duplikate, 201 URLs); Argument-Tabelle (jede Option; `--` ist vorletztes Element; kein Element außer dem letzten
  beginnt ohne `--`); Vorlagen (`../x`, `/etc/x`, `C:\x`, `$HOME`, `~`, `thumbnail:x`, `%s`, ohne `.%(ext)s`);
  Erlaubnisliste (`--exec`, `--downloader`, Wert mit Steuerzeichen, Kurzformen); Parser gegen Fixtures (CRLF,
  überlang, Nicht-UTF-8, falsche Marke, `NA`, Gleitkomma); Programmsuche mit künstlichen Ordnern; Versionsparser.
- **Job mit Fake-Programm** (`sh`-Skript in `tempfile`, nur Unix): Fortschritt + Datei im Ziel; zweite URL Exit 1
  → `doneWithErrors`, Retry-Plan nur mit dieser URL; Abbruch beendet auch das Kind (`sleep`) – Gruppe leer; „bereits
  vorhanden“ → übersprungen; gemeldeter Pfad außerhalb des Ziels wird verworfen; Argumente protokolliert: `--` vor
  genau einer URL, Arbeitsordner = Ziel; Ziel = Datei/Server/`..` → abgelehnt; MCP: `JobTap::start` lehnt `download` ab.
- **Frontend:** Store (Zählen, Vorlage → Felder, Sperren ohne ffmpeg, veraltete Prüf-Antworten, Selectbox:
  Einträge/Vorbelegung/gesperrte Seite, Start nur gültig, URLs nicht in `dialogs.recent`), Logik rein, Dialog
  (`dialog-roles.spec.ts`), `catalogs.spec.ts`, Menü-Spiegel, Keymaps, `describeFsError`.
- **Fixtures sind synthetisch** (aus dem festgelegten `--progress-template` und dem Quelltext abgeleitet, nicht
  aufgezeichnet – kein Lauf gegen eine URL in dieser Sitzung). Aufzeichnen für die Abnahme (nutzt das Netz):
  `FNF_RECORD_URL='https://…' [FNF_RECORD_AUDIO=1] cargo test record_protocol_lines -- --ignored --nocapture`
  schreibt die Protokollzeilen eines echten Laufs – mit genau den Argumenten eines Jobs – nach
  `src-tauri/src/url_download/testdata/recorded-*.txt` (Marke durch `M` ersetzt, s. `testdata/README.md`).
- **Ohne Netz gegen das echte Programm** (ignorierte Tests, lokal gelaufen mit yt-dlp 2026.11.23):
  `real_yt_dlp_accepts_the_arguments` – jeder Optionsname, den wir übergeben (auch die ganze Erlaubnisliste), steht
  in `yt-dlp --help`, und `yt-dlp <unsere Argumente ohne URL> --version` nimmt die Werte an; `probe_this_machine` –
  die Suche findet yt-dlp, ffmpeg und deno unter `/opt/homebrew/bin`.

## 6. Offen (nicht in diesem Prompt)

- **yt-dlp verwalten (E-a B):** Knopf „yt-dlp laden/aktualisieren“ – feste URL
  `github.com/yt-dlp/yt-dlp/releases/latest/download/<name je OS>` + `SHA2-256SUMS` (und deren Signatur
  `SHA2-256SUMS.sig` gegen den im Code hinterlegten öffentlichen Schlüssel), Ablage im App-Datenordner, nie im
  Bündel; Infrastruktur aus 075 (`reqwest` + rustls). Lizenzhinweis GPLv3+ im Dialog vor dem ersten Laden.
- Formatliste je URL (`-F`/`--dump-json`), URLs per Drag & Drop/URL-Schema, Download-Archiv, Abos, SponsorBlock im
  Dialog, Benutzername/Passwort, `--cookies`-Datei, Proxy, `--extractor-args`, Ziel auf Server/in Archive.
- Editor für `url-download.json` im Fenster (heute: Datei von Hand, Export/Import über das Bündel).
- Parallelität innerhalb eines Jobs.

## Fortschritt

- [x] Phase 1 Design (dieses Dokument)
- [x] Phase 2 Rust: `url_download/` (urls, template, args, presets, progress, tools), Job `jobs/download.rs`, Commands,
      Einstellungstyp `string`, Bündel-Teil `urlDownload`; 52 neue Tests (+ 3 ignorierte gegen das echte Programm/Netz)
- [x] Phase 3 Frontend: `core/urldownload/`, `features/urldownload/` (Logik, Store, Dialog, Texte en/de), Aktion,
      Menüs, Keymaps, Job-Anzeige (keine Pause, Phase „verarbeitet“), `ClipboardApi.readText`; 28 neue Tests
- [x] Phase 4: Debug-Build gebaut und mit eigenem `HOME` gestartet (`node scripts/mcp-e2e.mjs`, 30 Prüfungen – darunter
      „kein Werkzeug startet einen Download“); Screenshots hell/dunkel/Norton (`url-download-dialog`,
      `url-download-missing`, `url-download-no-ffmpeg`)
- [x] Phase 5 Doku: `docs/architecture.md`, `roadmap.md`, `feature-parity.md`, `licenses.md`, README (+ Bild), `CLAUDE.md`,
      `TODO.md` §2, Index
- [ ] Phase 6: externes Review (veranlasst Marc), Abnahme mit echtem yt-dlp und Netz

## Stand der Akzeptanzkriterien

| Kriterium | Stand |
|---|---|
| Dialog über Actions-Menü, Hauptmenü, Palette, Kürzel; Selectbox links/rechts, Vorbelegung, Tastatur | **Tests** (Katalog, Menüs, Keymaps, Store, DOM des Dialogs) + Screenshots. Im echten Fenster **nicht durchgeklickt**. |
| „2 URLs · 1 ungültig (Zeile 2)“, Start erst ohne ungültige Zeile; `--exec=…`/`-o /tmp/x` nie als Option | **Tests** Rust (`urls`, `args`, `manager::validate` über `tests_download`) und Frontend. Gezählt wird nach dem Zusammenführen: die Zeilen A, `ftp://…`, B, B ergeben „2 URLs · 1 ungültig (Zeile 2: nur http und https) · 1 doppelt“; A, `ftp://…`, A ergeben „1 URL · 1 ungültig · 1 doppelt“. |
| Vorlage `../x`, `/etc/x`, `C:\x` abgelehnt mit Grund | **Tests** Rust + Frontend |
| Fake-yt-dlp: Fortschritt, zweite URL scheitert, Retry nur diese, Abbruch beendet das Kind | **Tests** `jobs/tests_download.rs` (Unix; echte Prozesse, auch ein Kind, das `SIGTERM` ignoriert) |
| yt-dlp fehlt → Installationshilfe; ffmpeg fehlt → „Nur Audio“ gesperrt mit Grund | **Tests** + Screenshots |
| Auf Marcs Mac aus dem Finder: Programme gefunden, echtes Video + Audio, Panel frischt auf | Suche vom Terminal aus **geprüft** (`probe_this_machine`); aus dem Finder, echter Download, Auffrischen: **nicht geprüft** (Abnahme Marc) |
| Archiv / `remote://` / Ergebnis-Tab gesperrt, Aktion aus, Rust lehnt ab | **Tests** Frontend + Rust (`what_is_no_plain_url_or_no_local_folder_never_starts`) |
| Titel mit Emoji, Umlauten, `/`, sehr langem Namen → gültige Datei im Ziel | **nicht geprüft** – hängt an yt-dlps Bereinigung (im Quelltext nachgelesen) und `--trim-filenames=160` (Zeichen, nicht Bytes: ein sehr langer CJK-/Emoji-Titel kann über 255 Bytes kommen → yt-dlp meldet einen Fehler; Abhilfe `%(title).100B` in der Vorlage) |
| Tastatur, light/dark, deutsch/englisch | Screenshots light/dark/Norton (englisch); Texte de/en über `catalogs.spec.ts`; Tastatur nur über Tests (Enter/`Mod+Enter` im URL-Feld, natives `<select>`) |

Nicht gebaut (bewusst): Cursor auf die erste neue Datei nach dem Job (im Auftrag „optional“); Editor für
`url-download.json`; Eintrag auf der Werbeseite `site/` (nur README).

Windows: `platform/process.rs` (Job Object) ist unverändert der Code der Shell-Leiste; der neue Code ist für Windows
nur typgeprüft gedacht (`pnpm rust:cross` in dieser Sitzung nicht gelaufen), die Job-Tests laufen nur unter Unix.
