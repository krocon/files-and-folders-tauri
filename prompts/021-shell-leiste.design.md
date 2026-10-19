# Design 021: Shell-Leiste (`TOGGLE_SHELL`)

> **Status:** ✅ freigegeben (Marc, 2026-10-19: alle Empfehlungen; F-Tasten wie TC; Login-`PATH` macOS **und** Linux) ·
> umgesetzt · **Datum:** 2026-10-19 · **Branch:** `feat/shell-leiste` (von `main`
> inkl. `fix: parent names of search hits …`)
> **Grundlage:** Prompt 021, mr §1.7/§9/§11-12 (Shell-Panel, `POST /api/shell`, offenes ↑/↓/Esc), `docs/ui-layout.md`
> Zeile 5, Design 011 E7, Matrix `docs/feature-parity.md` H. Quellcode mr: `shellpanel/` (Frontend),
> `fnf-api/src/app/shell/` (Controller mit `exec`).
> **Vorgabe von Marc:** Pipes (kein PTY).
> **Phasen:** alle sechs; Phase 2 (Rust) und 3 (Frontend) getrennt committen.

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| Aktion `TOGGLE_SHELL` (Katalog, Keymaps `Shift+F11`, Actions-Menü, Menüleiste) | ohne Handler, Hinweis „021“ | **Handler ergänzen**, Hinweis entfällt |
| Job-Engine (`JobSpec`, `Control`, ein Ereigniskanal `subscribe_jobs`) | `searchHits` streamt gebündelt | **erweitern**: Job-Art `shell`, Ereignis `shellOutput`; Muster aus `jobs/search.rs` (Bündeln, Drosseln) |
| `JobSpec` kommt aus dem Frontend (`start_job`) | jede Art startbar | **Problem**: dann könnte *jeder* Frontend-Code Befehle starten → `Shell` wird wie `Rename.undo_of` **nicht deserialisierbar**, nur der eigene Command `run_shell` erzeugt ihn (E3) |
| Hilfsjobs (`is_helper`: nicht in der Task-Liste, von Rust nach Ende entfernt) | DirSize, Count, Search, Duplicates | **passt**: Shell ist Hilfsjob – Ausgabe lebt in der Leiste, nicht in der Task-Liste |
| `JobEvent::DirsChanged` (Panels mit diesem Ordner laden neu, Cursor/Markierung bleiben) | nach Kopieren usw. | **wiederverwendet** nach jedem Befehl für den Arbeitsordner (E9) |
| `tools.rs::spawn_detached` (011) | eigene Prozessgruppe, kein stdin/stdout | Muster; Shell braucht Pipes + Abbruch der Gruppe → eigenes Modul |
| `platform/` | Plattformcode je OS | **erweitern**: `platform/process.rs` (Sitzung/Gruppe, Abbruch, Windows Job Object, OEM-Codepage) |
| `settings-schema.json` + `settings.rs` (Rust liest das Schema mit) | 15 Schlüssel | **erweitern** (E10) |
| Sitzung (`session.rs` v1, sanitize) | Tabs, Splitter, Favoriten | **erweitern**: optionales Feld `shell` mit `serde(default)` – v1 bleibt lesbar |
| `KeyboardDispatcher` | in Textfeldern nur Funktionstasten | **erweitern**: zwei Einfüge-Aktionen dürfen auch aus dem Shell-Feld laufen (E12) |
| Archiv-Veto (`ArchiveStore`, `actions.setVeto`) | sperrt Aktionen in Archiven | Leiste bleibt ein-/ausblendbar, nur das Feld ist im Archiv gesperrt; Rust lehnt virtuelle Pfade ohnehin ab |
| `ws.actionDir()` | Ordner bzw. Suchordner im Ergebnis-Tab | **passt** als Arbeitsordner |
| Theme-Tokens (013/019), Kontrastpaare, `legacy-theme-map.ts` | 76 alte Variablen | **erweitern**: `--color-shell-*` + Paare, Abbildung aus den alten Footer-/Tabellenfarben |
| `preview/encoding.rs` | UTF-8/16, 1252, Latin-1 | Windows-OEM-Codepage fehlt → über die Windows-API (E7) |

## 2. Entscheidungen

### E1 – Sicherheitsmodell ✅ (Vorschlag)

Die Shell-Zeile ist die eine, bewusst gewollte Ausnahme von „kein beliebiges Shell-Kommando aus dem Frontend“
(`CLAUDE.md` §4). Sie ist so eng wie möglich geschnitten:

1. **Nur ausdrückliche Eingabe.** Ein Befehl entsteht nur aus dem Text im Shell-Feld und läuft nur nach Enter in
   diesem Feld. Kein anderer Weg: nicht aus Konfiguration, Tools, Dateinamen, Drag & Drop, Menüs, Palette, Themes
   oder Ereignissen. Einfügen von Namen (E12) schreibt nur **in das Feld**; ausgeführt wird erst nach Enter.
   Verlaufseinträge werden nur ins Feld geholt, nie direkt ausgeführt.
2. **Ein Aufrufer.** Nur `ShellBar` importiert `ShellApi` (Test, der alle `src/**/*.ts` außer `shell-bar.ts`,
   `shell-api.ts`, Fakes und Specs nach dem Import durchsucht). `ShellStore` bekommt die laufende Job-Id von der
   Komponente gereicht, ruft aber nie `run`.
3. **Nicht über `start_job`.** `JobSpec::Shell` hat `#[serde(skip_deserializing)]`; `start_job` mit `kind: "shell"`
   ist ein Deserialisierungsfehler (Test). Einziger Einstieg: Command `run_shell`.
4. **Rust prüft, was es kann.** Arbeitsordner: absolut, existiert, echter Ordner (kein Archiv-/virtueller Pfad),
   gesetzt per `Command::current_dir` – nie Teil des Befehls. Der Befehl geht als **ein** Argument an die Shell
   (`<shell> -c <cmd>`, Windows E5). Kein `split(' ')`, keine eigene Quotierung des Befehls. Länge ≤ 32 KiB, kein
   NUL, kein Zeilenumbruch (das Feld ist einzeilig; ein `\n` per IPC wäre ein zweiter Befehl → `invalid_command`).
5. **Nur das Hauptfenster.** `run_shell`, `cancel_shell` prüfen `window.label() == "main"` (es gibt nur dieses
   Fenster; die Prüfung hält das fest, falls später Viewer-Fenster kommen). Kein `tauri-plugin-shell`.
6. **Abschaltbar.** `shell.enabled` (Default **an**: die Zeile erscheint erst nach `Shift+F11` und führt nur
   Eingetipptes aus – dasselbe Risiko wie „Terminal hier“). Rust liest die Einstellung bei jedem `run_shell` aus
   `settings.json` (klein, im Worker-Thread) und lehnt mit `shell_disabled` ab – die Sperre gilt also nicht nur im UI.
7. **Kein Logging** von Befehlen, Ausgaben, Pfaden. Der Verlauf liegt nur in `shell-history.json` im
   App-Config-Verzeichnis. Hinweis: `JobInfo.spec` enthält den Befehl (Task-Daten im Speicher, wie Pfade bei Kopieren)
   – Shell-Jobs sind Hilfsjobs und werden nach Ende entfernt.
8. **Kein Zugriff auf das startende Terminal.** Der Kindprozess bekommt eine **neue Sitzung** (`setsid`), stdin
   `/dev/null`. Damit können `ssh`, `sudo`, `git` nicht über `/dev/tty` im Terminal fragen, aus dem die App evtl.
   gestartet wurde – sie scheitern mit ihrer eigenen Meldung.

Die Ausnahme kommt mit dieser Begründung in `CLAUDE.md` §4 und `docs/architecture.md`.

### E2 – Pipes statt PTY ✅ (Vorgabe)

`std::process::Command` mit stdin = null, stdout/stderr getrennt als Pipes, je ein Lesethread. Interaktive
Programme laufen über „Terminal hier“ (`Mod+Shift+C`, 011). Was passiert bei `vim`, `top`, `less`, `ssh`?

| Eingabe | Ergebnis mit Pipes + stdin null + `setsid` |
|---|---|
| `cat` (ohne Argument), `read` | liest EOF → endet sofort |
| `vim x` | „Input is not from a terminal“, liest EOF, endet |
| `top`, `htop` | Fehler „no tty“, Exit ≠ 0 |
| `less x`, `more x`, `git log` | ohne tty verhalten sie sich wie `cat` → nützliche Ausgabe |
| `ssh host`, `sudo …` | kein `/dev/tty` → Fehlermeldung des Programms, Exit ≠ 0 |
| `python`/`node` ohne Skript | REPL liest EOF → endet |

Kein Sonderfall im Code; unter der Ausgabe steht dauerhaft der Hinweis „Interaktive Programme: Terminal hier
(Mod+Shift+C)“ (einmalig klein, über einen Info-Text der Leiste). PTY + xterm.js bleibt als Notiz unter „Offen“.

### E3 – Ausführung als Hilfsjob `shell` ✅

- `JobSpec::Shell { cwd, command, shell }` (`skip_deserializing`, nur von `run_shell` gebaut), `is_parallel = true`
  (wartet nicht hinter einer Kopie), `is_helper = true` (nicht in der Task-Liste, kein Quit-Dialog; beim Beenden
  bricht `cancel_all` ihn samt Prozessgruppe ab).
- **Einer zur Zeit:** läuft schon ein Shell-Job, lehnt `run_shell` mit `shell_busy` ab; das Frontend zeigt den
  Hinweis in der Leiste („Ein Befehl läuft noch – Esc bricht ab“). Kein Anhängen, kein stilles Abbrechen.
- **Ausgabe:** Ereignis `JobEvent::ShellOutput { id, chunks, dropped }` über den bestehenden Job-Kanal. Gebündelt
  wie die Suche: spätestens alle 50 ms, höchstens 64 KiB je Ereignis. **Flutschutz** (`yes`): mehr als 256 KiB je
  250 ms werden in Rust verworfen (nur das Ende des Fensters wird gesendet), `dropped` zählt die Bytes; die Leiste
  zeigt „… n KB ausgelassen“. Rust liest die Pipes trotzdem weiter (sonst blockiert das Programm).
- **Ende:** `Summary.shell = { exitCode: Option<i32>, signal: Option<i32> }`. Exit ≠ 0 → `DoneWithErrors`,
  abgebrochen → `Cancelled`, Programm/Shell nicht startbar → `Failed` + `program_not_found`.
- **Abbruch** (Esc, `Ctrl+C` ohne Textauswahl, Stopp-Knopf → `cancel_job`): Unix `killpg(SIGTERM)`, nach 1 s
  `SIGKILL` an die Gruppe; der Lesethread endet mit den Pipes, `wait()` erntet den Prozess (kein Zombie). Windows:
  Kindprozess startet in einem **Job Object** mit `KILL_ON_JOB_CLOSE`; Abbruch = `TerminateJobObject`. Ein Programm,
  das selbst `setsid` aufruft (Dämon), entkommt unter Unix – dokumentiert, nicht abfangbar.

### E4 – Shell unter macOS/Linux ✅

- `$SHELL`, wenn der Basisname in {`sh`, `bash`, `zsh`, `dash`, `ksh`, `mksh`, `fish`, `yash`} liegt und die Datei
  ausführbar ist; sonst `/bin/sh`. Grund: nur für diese Shells ist die Quotierung (E12) sicher bekannt (nu, xonsh,
  elvish, pwsh als Login-Shell → `/bin/sh`).
- Aufruf `<shell> -c <cmd>`, **keine** Login-Shell je Befehl (Kosten s. E6), aber mit der Login-Umgebung (E6).
- Umgebung zusätzlich: `TERM=dumb`, `NO_COLOR=1`, `PAGER=cat`, `GIT_PAGER=cat` (kein Pager wartet), `CLICOLOR` und
  `CLICOLOR_FORCE` entfernt. Alles andere bleibt (`HOME`, `LANG` …).

### E5 – Shell unter Windows ✅

- Einstellung `shell.windowsShell`: `cmd` (Default, TC-Verhalten) oder `powershell` (`pwsh.exe` aus `PATH`, sonst
  `powershell.exe`).
- `cmd.exe /D /S /C "<cmd>"` per `raw_arg` (`/D` ohne AutoRun, `/S` entfernt genau die äußeren Anführungszeichen –
  der Befehl bleibt, wie getippt).
- PowerShell: `-NoLogo -NoProfile -NonInteractive -Command <prefix; cmd>` als normales Argument, Präfix
  `[Console]::OutputEncoding=[Text.Encoding]::UTF8;` (sonst OEM-Ausgabe).
- Fenster: `CREATE_NO_WINDOW`. Prozess im Job Object (E3).
- Nicht im Container prüfbar: Ausführung nur in der CI/auf Windows; die Quotier- und Argumentfunktionen sind reine
  Funktionen mit Tests auf allen Plattformen.

### E6 – `PATH` unter macOS (Login-Umgebung) ✅

Aus dem Finder gestartete Apps haben `PATH=/usr/bin:/bin:/usr/sbin:/sbin`; `brew`, `node`, `cargo` fehlen.

| Option | Kosten | Bewertung |
|---|---|---|
| `-l` bei jedem Befehl | Profil je Befehl: im Container 9 ms vs. 2 ms (`bash -lc true`), auf echten Macs mit `brew shellenv`/nvm typ. 100–600 ms **pro Befehl**; Profile mit Ausgabe verschmutzen jede Ausgabe | ✗ |
| **Login-Umgebung einmal lesen** (`<shell> -l -c 'env -0'`, stdin null, `setsid`, Timeout 3 s), im Speicher cachen | einmal beim ersten Befehl (bzw. vorab, sobald die Leiste eingeblendet wird) | ✅ |

Übernommen werden nur `PATH` und, falls gesetzt, `MANPATH`, `LANG`/`LC_*` (nicht die ganze Umgebung – Profile
setzen auch Zufälliges). Timeout/Fehler → App-Umgebung, einmalige Info-Zeile in der Ausgabe. Gilt für macOS **und**
Linux (gleiches Problem bei Starts aus manchen Desktop-Menüs; harmlos, wenn schon alles stimmt). Einstellung
`shell.loginPath` (Default an) zum Abschalten. Abnahme „`which brew` aus dem Finder“ ist hier nicht prüfbar →
Vorgehen in `docs/architecture.md`, Prüfung durch Marc auf dem Mac.

### E7 – Ausgabe: Kodierung, ANSI, Puffer ✅

- **Kodierung (Rust):** gültiges UTF-8 bleibt; sonst Windows: OEM-Codepage (`GetOEMCP` + `MultiByteToWideChar`),
  Unix: verlustbehaftet (`U+FFFD`). Dekodiert wird je Zeilen-/Blockgrenze, eine an der Blockgrenze zerschnittene
  UTF-8-Sequenz wird bis zum nächsten Block aufgehoben (Test).
- **ANSI:** Rust entfernt Escape-Sequenzen (CSI `ESC [ … final`, OSC `ESC ] … BEL/ST`, einzelne `ESC x`) und `\r`
  vor `\n`; ein alleinstehendes `\r` (Fortschrittsbalken) ersetzt die laufende Zeile nicht, sondern bricht um (einfach,
  vorhersehbar). Reine Funktion `strip_ansi` mit Tests. Farben auf Theme-Tokens abbilden wäre möglich, aber
  `TERM=dumb`/`NO_COLOR` machen sie selten → später („Offen“).
- **Darstellung (Frontend):** Monospace (`--font-mono`), nur `textContent`, je Abschnitt ein `<pre>`-Block je Strom
  (stderr in `--color-shell-error-text`). Kopfzeile je Befehl: `<Pfad>> <Befehl>`; Fußzeile bei Exit ≠ 0
  „Exit-Code n“ bzw. „Abgebrochen“.
- **Obergrenze:** 10 000 Zeilen oder 2 MB im Puffer (`ShellStore`), älteste Zeilen fallen raus, Hinweis oben.
- „Kopieren“ (gesamte Ausgabe als Text über `ClipboardApi`), „Leeren“, Ein-/Ausklappen, Höhe per Ziehen
  (Splitter-Muster aus `workspace`, APG „window splitter“, `↑/↓` am Griff), Höhe und Klappzustand in der Sitzung.

### E8 – Arbeitsordner und Präfix ✅

- `ws.actionDir()` des **aktiven** Panels: angezeigter Ordner bzw. im Ergebnis-Tab der Suchordner.
- Im Archiv (`store.archive() !== null`) ist das Feld `disabled` mit Hinweis „Im Archiv nicht verfügbar“; ohne Ordner
  (vor dem ersten Listing) ebenso. Rust lehnt virtuelle Pfade zusätzlich ab (`not_a_directory`).
- Präfix `<Pfad>>` folgt dem aktiven Panel live (Signal). Lange Pfade werden **in der Mitte** gekürzt (nur
  Zeichenanzahl, keine Trennzeichen-Logik: Anfang … Ende, Breite per `ResizeObserver`), voller Pfad im `title`.

### E9 – Nach dem Befehl ✅

Rust sendet nach jedem Shell-Job `DirsChanged { dirs: [cwd] }`. Panels, die diesen Ordner zeigen (auch beide),
laden über den bestehenden Weg neu (`requestRefresh`, Cursor und noch vorhandene Markierungen bleiben). Der Watcher
(012) liefert meist schon vorher; doppelt schadet nicht (eine Ladung wird zusammengefasst).

### E10 – Einstellungen und Sitzung ✅

`settings-schema.json` (gemeinsam mit Rust):

| Schlüssel | Typ | Default |
|---|---|---|
| `shell.enabled` | bool | `true` |
| `shell.loginPath` | bool | `true` |
| `shell.windowsShell` | enum `cmd`/`powershell` | `cmd` |

Sitzung (`session.json` v1, neues optionales Feld, `serde(default)`, sanitize: Höhe 60–800 px):
`shell: { visible: bool, outputOpen: bool, outputHeight: number }` (Default `false`, `true`, `160`).

### E11 – `cd` und eingebaute Befehle (in Rust) ✅

`run_shell` erkennt Eingebautes **bevor** eine Shell startet; die Erkennung ist eine reine Funktion `parse_builtin`.

| Eingabe | Wirkung |
|---|---|
| `cd` / `cd ~` | Panel → Home |
| `cd <ziel>` (relativ, absolut, `..`, `~/x`, `'a b'`, `"a b"`, Windows auch `cd /d D:\x`, `D:`) | Rust löst relativ zum Arbeitsordner auf (`paths::normalize_lexically`), prüft „ist Ordner“, Antwort `navigate { path }` → aktives Panel navigiert (Verlauf wie Enter) |
| `cd -` | Panel zurück im Verlauf (`NAVIGATE_BACK`) |
| `cls` / `clear` | Ausgabe leeren |
| alles andere, auch `cd x && make`, `cd $VAR`, `cd *` | geht an die Shell (`cd` in der Shell wirkt nur dort) |

Als eingebaut gilt eine Zeile nur, wenn sie genau `cd` + höchstens **ein** Argument ist, das ganz in `'…'`/`"…"`
steht oder keine Shell-Sonderzeichen (`;&|<>$\`*?(){}[]!`) enthält. Fehler (gibt es nicht, ist eine Datei, keine
Rechte) erscheinen als Fehlerzeile in der Ausgabe; das Panel bleibt stehen. Eingebautes kommt auch in den Verlauf.

### E12 – Namen einfügen (Quotierung in Rust) ✅

Zwei Aktionen, aus der Liste **und** aus dem Shell-Feld nutzbar (blendet die Leiste ggf. ein und fokussiert sie):

| Aktion | Kürzel (alle OS) | fügt ein |
|---|---|---|
| `SHELL_INSERT_NAMES` | `Mod+Shift+Enter` | markierte Namen, sonst den Cursor-Namen |
| `SHELL_INSERT_PATHS` | `Mod+Alt+Enter` | dieselben als volle Pfade |

TC nutzt `Ctrl+Enter`, das ist bei uns `OPEN_IN_NEW_TAB` → beide Kürzel sind frei (geprüft in den drei Keymaps).
Einfügen an der Caret-Position, mit Leerzeichen getrennt. Quotieren macht Command `shell_quote(items)`; Rust kennt
die Shell (dieselbe Wahl wie E4/E5):

- POSIX (sh/bash/zsh/dash/ksh/fish): ohne Sonderzeichen unverändert, sonst `'…'` mit `'` → `'\''`; führendes `-` →
  `./-x` nur bei Namen (nicht bei absoluten Pfaden).
- PowerShell: `'…'` mit `'`, `‘`, `’` verdoppelt.
- cmd.exe: `"…"`; Namen mit `%` oder `!` lassen sich in `cmd /C` **nicht** sicher quotieren → Fehler
  `unquotable_name` („Für cmd.exe nicht sicher quotierbar – PowerShell wählen“).
- Steuerzeichen (`\n`, `\t`, `\x1b` …) → `unquotable_name` (das Feld ist einzeilig; ein Zeilenumbruch würde
  verschluckt und den Befehl ändern).

Der `KeyboardDispatcher` lässt diese zwei Ids zusätzlich zu, wenn das Ziel im `app-shell-bar` liegt (Menge
`SHELL_FIELD_ACTIONS`); alle anderen Kürzel mit Modifier bleiben im Textfeld gesperrt.

### E13 – Tastatur und Fokus ✅

`ShellBar` ist ein **Combobox-Widget** (APG „editable combobox with list autocomplete“) und behandelt seine Tasten
selbst (Ausnahme „Widgets nach APG“, `CLAUDE.md` §4):

| Taste im Feld | Wirkung |
|---|---|
| Enter | Vorschlag übernehmen (Liste offen) bzw. ausführen |
| ↑ / ↓ | Vorschlagsliste offen: wählen; sonst Verlauf blättern (der getippte Text bleibt als Entwurf, ↓ am Ende holt ihn zurück) |
| Esc | 1. Vorschläge schließen → 2. Befehl läuft: abbrechen → 3. Text da: leeren → 4. Fokus an die Liste des aktiven Panels |
| `Ctrl+C` (auch macOS: Ctrl, nicht ⌘) | ohne Textauswahl und bei laufendem Befehl: abbrechen; sonst normal |
| Tab / Shift+Tab | normaler Fokuswechsel (Stopp/Kopieren/Leeren-Knöpfe, dann weiter) – **nicht** Panelwechsel |
| F-Tasten (F3, F5, F8 …) | wirken wie im Total Commander weiter auf das aktive Panel (Dispatcher lässt Funktionstasten durch) |
| `Shift+F11` | Leiste ausblenden, Fokus an die Liste |

`TOGGLE_SHELL`: ausgeblendet → einblenden + fokussieren; eingeblendet, Fokus woanders → fokussieren; eingeblendet
und fokussiert → ausblenden. Aktiv, wenn `shell.enabled` (sonst gedimmt mit Hinweis „in den Einstellungen aus“).
Im Archiv/ohne Ordner bleibt die Aktion aktiv (Leiste zeigt den Grund). Zusätzlich `SHELL_CLEAR_OUTPUT` (ohne
Kürzel, Palette/Menü). Autovervollständigung nur aus dem Verlauf (Präfix, neueste zuerst, max. 8); Dateinamen
für das letzte Wort → „Offen“.

### E14 – Verlauf ✅

Rust, Datei `shell-history.json` (`{ "version": 1, "entries": [...] }`, neueste zuerst), 100 Einträge, ohne
Dubletten (der neueste gewinnt), Einträge ≤ 4 KiB, atomar geschrieben, kaputte Datei → `.bad` und leer weiter
(Muster `rename_presets.rs`). `run_shell` trägt **selbst** ein (vor dem Start, auch eingebaute Befehle) – das
Frontend kann den Verlauf nur lesen (`load_shell_history`) und leeren (`clear_shell_history`, Knopf in den
Einstellungen). Nicht eingetragen: leere Zeilen, abgelehnte (`shell_busy`, `shell_disabled`).

### E15 – Layout und Farben ✅

- Zeile 5 über die volle Breite (Grid-Zeile zwischen Panels und Button-Leiste, kein Splitter). Reihenfolge:
  Ausgabe (einklappbar, Höhe ziehbar) **über** der Eingabezeile, damit das Feld direkt über den Buttons sitzt wie in mr.
- Neue Tokens (light + dark in `styles.css`, alle `themes/*.json`, Editor-Gruppe „Shell“):
  `--color-shell-bg`, `--color-shell-text`, `--color-shell-prompt`, `--color-shell-error-text`,
  `--color-shell-border`. Kontrastpaare: Text/bg, Prompt/bg, Fehler/bg (≥ 4.5:1).
- Alte Designs (019): abgeleitet aus `--fnf-footer-bg-color`/`--fnf-footer-fg-color` bzw.
  `--fnf-table-*` und `--fnf-footer-error-fg-color`; Korrektur über `contrast-fix.ts`; Kontrastbericht neu erzeugt.
- Die GuiExpert Table misst sich bei Größenänderung selbst (Host mit fester Höhe per Flex, `min-height: 0`, wie heute
  beim Splitter) – im echten Fenster prüfen.

## 3. Verträge

### Rust

```rust
// src/shell/mod.rs (rein, ohne Tauri): parse_builtin, resolve_cd, quote, strip_ansi, Decoder, choose_shell, History
pub enum ShellKind { Posix { program: PathBuf }, Cmd, PowerShell { program: PathBuf } }
pub enum Builtin { Cd { target: Option<String> }, CdBack, Clear }
pub fn parse_builtin(line: &str, windows: bool) -> Option<Builtin>;
pub fn resolve_cd(cwd: &Path, target: Option<&str>, home: &Path) -> Result<PathBuf, FsError>;
pub fn quote(items: &[String], kind: &ShellKind, names: bool) -> Result<String, FsError>;   // E12
pub fn strip_ansi(s: &str) -> String;
// src/jobs/shell.rs: run(id, spec, control, emit) -> (JobState, Summary); src/platform/process.rs: spawn_group, kill_group

// JobSpec::Shell { cwd: String, command: String }  #[serde(skip_deserializing)], kind "shell", parallel, helper
// JobEvent::ShellOutput { id, chunks: Vec<ShellChunk>, dropped: u64 }
#[serde(rename_all = "camelCase")] pub struct ShellChunk { pub stream: ShellStream /* stdout|stderr|info */, pub text: String }
// Summary.shell: Option<ShellSummary { exit_code: Option<i32>, signal: Option<i32> }>

#[serde(tag = "type", rename_all = "camelCase")]
pub enum ShellRunResult { Started { job_id: String }, Navigate { path: String }, Back, Clear }

#[command] run_shell(window, cwd: String, command: String) -> Result<ShellRunResult, FsError>
  // Fehler: shell_disabled, shell_busy, invalid_command, not_a_directory, not_found, permission_denied
#[command] shell_quote(items: Vec<String>, names: bool) -> Result<String, FsError>   // unquotable_name
#[command] load_shell_history() -> Result<Vec<String>, FsError>
#[command] clear_shell_history() -> Result<(), FsError>
// Abbruch: bestehender cancel_job(id)
```

Neue Fehlercodes (Rust `FsErrorCode`, TS `FsErrorCode`, `describeFsError`, Texte en/de): `shell_disabled`,
`shell_busy`, `invalid_command`, `unquotable_name`. Vorhanden und genutzt: `program_not_found`, `not_a_directory`,
`not_found`, `permission_denied`.

### TypeScript

```ts
// core/shell/shell.models.ts
export type ShellRunResult =
  | { type: 'started'; jobId: string } | { type: 'navigate'; path: string } | { type: 'back' } | { type: 'clear' };
export interface ShellChunk { readonly stream: 'stdout' | 'stderr' | 'info'; readonly text: string }
// core/jobs/jobs.models.ts: JobEvent + { type: 'shellOutput'; id; chunks; dropped }, Summary.shell?, JobSpec 'shell'
// core/shell/shell-api.ts: ShellApi { run, quote, loadHistory, clearHistory } + src/testing/fake-shell-api.ts
// features/shell/: shell.store.ts (root: Sichtbarkeit, Verlauf, laufende Job-Id, Puffer, Höhe), shell-logic.ts
//   (rein: Verlaufsnavigation mit Entwurf, Vorschläge, Puffer mit Obergrenze, Mitten-Kürzung),
//   shell-bar.ts/.html/.css, shell-actions.ts, shell-texts.ts + .de.ts
// session.models.ts: Session.shell?: { visible; outputOpen; outputHeight }
```

### UI-Skizze (Zeile 5, eingeblendet)

```
┌ Panels links | rechts ────────────────────────────────────────────────────────────┐
├──────────────────────────────── ═══ (Griff, role=separator) ═══ ───────────────────┤
│ /home/marc/Projekte> ls -la                                    [Kopieren][Leeren][▾]│  region "Shell output"
│ total 12                                                                             │  <pre> je Strom,
│ drwxr-xr-x  3 marc marc 4096 …                                                       │  aria-live=off
│ ls: cannot access 'x': No such file or directory      (stderr-Farbe)                 │
│ Exit-Code 2                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ /home/…/Projekte> [ git status_______________________________ ] [■ Stopp] (läuft)   │  role=combobox
│                    ┌ git status ┐  ← Vorschläge (role=listbox)                       │  aria-expanded
├──────────────────────────────────────────────────────────────────────────────────────┤
│ F3 View  F4 Edit  F5 Copy …                                                          │  Button-Leiste
```

Fokus-Reihenfolge: Feld → Stopp (nur wenn läuft) → Kopieren → Leeren → Ein/Aus-Klappen → Griff. Statusmeldungen
(„Befehl beendet, Exit-Code 2“, „abgebrochen“) über die bestehende Live-Region des Workspace (nicht die Ausgabe
selbst – die wäre zu laut).

## 4. Tests

**Rust** (`tempfile`, Unix-Prozess-Tests mit `#[cfg(unix)]`):
- Arbeitsordner wird respektiert (`pwd`); Ordnername `x"; touch pwned; "` → keine Datei `pwned` (auch als cwd).
- stdout/stderr getrennt (`echo a; echo b >&2`), Reihenfolge je Strom, Exit-Code 3 (`exit 3`), Signal.
- Streaming: erste Ausgabe kommt vor Prozessende (`echo a; sleep 2; echo b`, erstes Ereignis < 1 s).
- Flutschutz: `yes | head -c 5000000` → `dropped > 0`, Ereignisgrößen ≤ 64 KiB.
- Abbruch: `sh -c 'sleep 30 & sleep 30'` → beide PIDs weg (per `kill -0`), Job `Cancelled` < 2 s, kein Zombie.
- stdin: `cat` endet sofort, `read x` ebenso.
- Kein tty: `tty` meldet „not a tty“; `setsid` → `ps -o sid` ≠ App-SID.
- `parse_builtin`/`resolve_cd`: relativ, absolut, `..`, `~`, `~/x`, `cd` leer, `cd -`, Quotes, `cd x && y` (nicht
  eingebaut), nicht vorhanden, Datei statt Ordner, Windows-Formen (`cd /d D:\x`, `D:`) als reine Funktion.
- `quote` je Shell: Leerzeichen, `'`, `"`, `$`, `` ` ``, `%`, `!`, `^`, führendes `-`, Unicode/Emoji; Round-Trip
  `sh -c 'printf %s "$1"' _ <quoted>` (bash, dash; zsh/fish wenn installiert); cmd-Fälle `%`/`!` → Fehler;
  Steuerzeichen → Fehler.
- `strip_ansi`, Decoder (UTF-8 über Blockgrenze, ungültige Bytes → U+FFFD).
- Verlauf: Dubletten, Grenze 100, kaputte Datei → `.bad`.
- `start_job` mit `{"kind":"shell",…}` scheitert (Wire-Format-Test); `shell.enabled=false` → `shell_disabled`;
  zweiter Start → `shell_busy`.
- Login-Umgebung: Parser für `env -0`, Timeout greift (Test-Shell mit `sleep`).

**Frontend** (Vitest):
- Nur `shell-bar.ts` importiert `ShellApi` (Datei-Scan wie `builtin-themes.spec.ts`).
- `shell-logic`: Verlauf mit Entwurf, Vorschläge, Puffergrenze (Zeilen und Bytes), Mitten-Kürzung.
- `ShellStore`/`ShellBar` mit `FakeShellApi` + `FakeJobsApi`: Enter → `run` mit actionDir; `navigate` → aktives
  Panel lädt; `clear`; Ausgabe kommt per `shellOutput` an; Esc-Kaskade; `Ctrl+C`; `shell_busy`-Hinweis; Archiv →
  Feld gesperrt; Ergebnis-Tab → Suchordner; Sichtbarkeit in der Sitzung; `TOGGLE_SHELL`-Zyklus; Einfügen ruft
  `quote` und setzt am Caret ein; Dispatcher lässt nur `SHELL_INSERT_*` im Feld durch, `F5` weiter, `Tab` nicht.
- Kataloge en/de vollständig, Keymaps ohne Doppelbelegung (bestehende Tests), Token-Vollständigkeit, Kontrast.

**Ende-zu-Ende** (Xvfb): Akzeptanzkriterien des Prompts; Testordner mit Umlauten/Emoji/Leerzeichen/Symlink/
gesperrtem Ordner; light/dark; ein altes Design.

## 5. Annahmen

- Eine Shell-Zeile für das Fenster (nicht je Panel) – sie folgt dem aktiven Panel.
- Ausgabe bleibt über Befehle hinweg stehen (wie ein Terminal), bis „Leeren“/`clear`.
- Kein Neustart-Erhalt der Ausgabe (nur Verlauf, Sichtbarkeit, Höhe).

## 6. Offen (nicht in diesem Prompt)

- PTY + xterm.js für interaktive Programme in der App.
- ANSI-Farben auf Theme-Tokens.
- Dateinamen-Vervollständigung für das letzte Wort (bräuchte Wortgrenzen der Shell → in Rust).
- Mehrere gleichzeitige Befehle.

## 7. Antworten von Marc (2026-10-19)

1. `shell.enabled` Default an – ja. 2. `Mod+Shift+Enter` / `Mod+Alt+Enter` – ja. 3. F-Tasten im Feld wie im Total
Commander (wirken auf das Panel). 4. Login-`PATH` unter macOS und Linux.

## 8. Abweichungen bei der Umsetzung

- **Zwei Fassaden statt einer:** `ShellApi` hat nur `run` (einziger Importeur `ShellBar`, Spec scannt `src/`);
  Quotieren und Verlauf liegen in `ShellSupportApi` (Store, Einstellungsdialog) – so bleibt die Regel „nur die
  Leiste startet Befehle“ prüfbar, ohne dass der Einstellungsdialog die Lauf-Fassade braucht.
- **Hinweise als Codes:** `run_shell` liefert `notices` (z. B. `loginEnvUnavailable`), der Text kommt aus dem
  Katalog. `ShellChunk` hat nur `stdout`/`stderr` (kein `info`-Strom aus Rust).
- **Ende des Jobs:** Er endet, wenn die Shell beendet ist und die Pipes zu sind – oder 500 ms danach
  (`LINGER`), wenn Hintergrundprozesse (`sleep 60 &`) die Pipes offen halten. Diese laufen weiter wie im Terminal;
  nur ein **Abbruch** beendet die ganze Gruppe.
- **Hinweis zu interaktiven Programmen** steht nur, solange die Ausgabe leer ist.
- **Tokens:** zusätzlich `--color-shell-info-text` (Meldungen). Alle Shell-Tokens zeigen auf allgemeine Tokens
  (`var(--color-surface)` …); die alten Designs bekommen sie darüber und über die Kontrastkorrektur – keine neuen
  `--fnf-*`-Abbildungen nötig.
- **Einstellungen:** eigener Bereich „Shell“ mit „Shell-Verlauf leeren“; `shell.windowsShell` nur unter Windows,
  `shell.loginPath` nur unter macOS/Linux sichtbar.
- **Fund aus dem E2E:** `WorkspaceStore.panel()` las eine normale `Map` – ein `computed` (Arbeitsordner der Leiste),
  das vor der Registrierung der Panels gelesen wurde, blieb `null`. Jetzt Signal-Version (roter Test zuerst).
- **Nicht prüfbar hier:** Windows (Ziel-`rust-std` aus dem Container nicht ladbar – die Windows-Teile von
  `platform/process.rs` sind gegen die `windows-sys`-0.61-Quellen geschrieben, aber nicht kompiliert; Quotier- und
  Argumentfunktionen für cmd/PowerShell sind plattformunabhängig getestet); macOS „aus dem Finder gestartet findet
  `brew`“ (Vorgehen: App aus dem Finder starten, `which brew` in der Shell-Zeile).

## 9. Fortschritt

- [x] Phase 1: Bestand, Entscheidungen, Verträge (2026-10-19), freigegeben
- [x] Phase 2: Rust – `shell/`, `platform/process.rs`, `jobs/shell.rs`, `commands/shell.rs`; 30 neue Tests (u. a.
  Prozessgruppe, Flutschutz, Round-Trip-Quotierung in sh/bash/dash), clippy ohne Warnungen
- [x] Phase 3: Frontend – `core/shell`, `features/shell`, Dispatcher, Einstellungen, Tokens; 17 neue Specs
- [x] Phase 4: Ende-zu-Ende (Xvfb :99, Debug-Build, eigenes `HOME`/`XDG_*`, Ordner mit Umlauten, Emoji, Leerzeichen,
  verstecktem Eintrag, Symlink, gesperrtem Ordner und einem Ordner `x"; touch pwned; "`): Shift+F11 ein/aus und
  Fokus, Sichtbarkeit nach Neustart, `ls -la` mit Unicode, stderr rot + „Exit code 3“, `cd ..`/`cd gibtsnicht`,
  Streaming + Esc-Abbruch (Kindprozess `sleep 60` beendet), `touch neu.txt` erscheint ohne Reload, `cat`/`vim`
  enden sofort, ↑ aus dem Verlauf, Einfügen von Name und Pfad (quotiert), Archiv gesperrt, lange Zeilen umbrechen,
  hell/dunkel/„Blackboard“ lesbar
- [x] Phase 5: Doku (feature-parity, ui-layout, architecture, roadmap, README, CLAUDE.md §1/§3/§4, prompts/README)
- [ ] Phase 6: Abschlussprüfung + Review (separater Agent)
