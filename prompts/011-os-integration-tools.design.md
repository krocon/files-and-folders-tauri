# Design 011: Betriebssystem-Integration, externe Tools und Zwischenablage

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) · **Datum:** 2026-10-17 ·
> **Branch:** `feat/os-integration-tools` (von `main`, 001–008 fertig)
> **Grundlage:** legacy §2/§6/§7.3/§7 (Startpunkte)/§9 (Injection), mr §1.7/§1.8/§9 (Tools-Format, Shell-Zeile),
> CLAUDE.md §4 (Sicherheit: externe Tools nur aus der Konfiguration mit Argument-Arrays, `cfg`-Plattformcode).

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| `platform.rs` | Plattformfunktionen mit einer Signatur je OS | **erweitern**: Untermodule `platform/volumes.rs`, `platform/desktop.rs` (Datei `platform.rs` bleibt, kein Umbenennen – weniger Merge-Konflikte mit 009/010) |
| `opener.rs` (003) | Standard-App über die Crate `open` (Argument-Array) | **passt** für „Öffnen“; Linux-Fallback von „Im Dateimanager zeigen“ |
| `fs_atomic.rs`, `rename_presets.rs` | Konfigurationsdatei laden (kaputt → `.bad`), atomar schreiben | **Muster** für `tools.json` |
| Ordnermenü ▾ (003, `Alt+F1`/`Alt+F2`) | Home, Favoriten, Zuletzt | **erweitern** um die Gruppe „Laufwerke“ – das ist die Laufwerksauswahl je Panel (TC: `Alt+F1`/`Alt+F2`) |
| Aktionskatalog (002) | `COPY_2_CLIPBOARD_*`, `OPEN_EDIT_DLG`, `OPEN_TOOL_CONFIG_DLG`, `TOGGLE_SHELL` „kommt in 011“; Ids statisch (`ActionId`) | **Handler**; neu `REVEAL_IN_FILE_MANAGER`, `OPEN_TERMINAL_HERE`, `OPEN_TOOLS_DLG`; Tools sind **dynamische** Aktionen (Id aus der Konfiguration) → kleine Erweiterung `ActionService.setExtras` |
| Befehlspalette (002) | alle `ACTION_IDS` | **erweitern** um die Tools (Kategorie „Tools“) und einen Modus „nur Tools“ (= „Mit Tool öffnen …“) |
| `selectionForAction` (006) | Markierung, sonst Cursor, nie `..` | **passt** für Zwischenablage und Tools |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Laufwerke/Volumes: eigene Implementierung statt `sysinfo` ✅

`sysinfo` ruft `statvfs` für jeden Mountpoint synchron auf (ein totes NFS/SMB blockiert den Aufruf) und bringt
viel Fremdes mit (Prozesse, CPU). Eigene Umsetzung in `platform/volumes.rs`, ohne neue Crate:

| OS | Kandidaten | Größe/Label |
|---|---|---|
| Linux | `/proc/self/mountinfo` (Oktal-Escapes `\040`), `/` immer zuerst; ohne Pseudo-Dateisysteme (proc, sysfs, tmpfs, devtmpfs, devpts, cgroup*, overlay außer `/`, squashfs, autofs, fuse.portal, fuse.gvfsd-fuse …) und ohne Systempfade (`/proc`, `/sys`, `/dev`, `/run` außer `/run/media`, `/boot`, `/snap`, `/var/lib/docker` …); doppelte Mountpoints einmal | `statvfs`; Typ aus mountinfo (nfs/cifs/smb3/sshfs/… = Netz; `/media`, `/run/media` = Wechselmedium) |
| macOS | `/` + Einträge von `/Volumes` (nur Namen, kein `stat`; der Link auf `/` entfällt) | `statfs` (`f_fstypename`, `MNT_LOCAL` → Netz) |
| Windows | `GetLogicalDrives` → `C:\` … | `GetDriveTypeW` (Netz, Wechselmedium, CD …), `GetVolumeInformationW` (Label, FS), `GetDiskFreeSpaceExW` – FFI auf `kernel32` von Hand (drei Funktionen, keine Crate) |

**Timeout ohne UI-Blockade:** jede Abfrage (statvfs/statfs/Volume-Info) läuft in einem eigenen Thread, das
Ergebnis wird höchstens 1,5 s abgewartet; danach gilt das Volume als „nicht erreichbar“ (`reachable: false`, ohne
Größen). Ein hängender Thread wird nicht erneut gestartet, solange er hängt (Menge der laufenden Abfragen) – wiederholtes
Öffnen des Menüs stapelt keine Threads. Der Command läuft in `spawn_blocking`; das Menü zeigt sofort „Laufwerke
werden gelesen …“ und füllt sich, sobald die Antwort da ist.

### E2 – „Im Dateimanager zeigen“ und „Terminal hier“: schmale Commands mit `cfg`-Code ✅

`platform/desktop.rs`, Pfad im Backend validiert (`validate_input_path`, muss existieren), kein Shell-String:

| OS | Im Dateimanager zeigen | Terminal hier (Default) |
|---|---|---|
| macOS | `open -R <pfad>` | `open -a Terminal <ordner>` |
| Windows | `explorer.exe` + `raw_arg("/select,\"<pfad>\"")` (Explorer versteht nur diese Form; `"` ist in Windows-Pfaden verboten → abgelehnt, falls doch) | `wt.exe -d <ordner>`, sonst `cmd.exe /K` mit `current_dir` + `CREATE_NEW_CONSOLE`. **`;` im Pfad → immer `cmd.exe`** (Windows Terminal wertet `;` als Befehlstrenner – sonst Injection über einen Ordnernamen) |
| Linux | D-Bus `org.freedesktop.FileManager1.ShowItems` per `dbus-send` (URI prozent-kodiert, auch `,` – `dbus-send` trennt Arrays an Kommas), Antwort-Timeout 3 s; sonst Elternordner mit der Standard-App | `$TERMINAL`, `x-terminal-emulator`, dann je Desktop (`XDG_CURRENT_DESKTOP`: KDE → konsole; GNOME → kgx/ptyxis/gnome-terminal), dann xfce4-terminal, mate-terminal, tilix, alacritty, kitty, wezterm, foot, xterm – jeweils mit dem passenden Arbeitsordner-Argument und `current_dir` |

Konfigurierbar: `tools.json` → `terminal: { program, args }` mit `{dir}` (z. B. iTerm:
`{"program":"open","args":["-a","iTerm","{dir}"]}`).

### E3 – Externe Tools: eigener Command statt `tauri-plugin-shell` ✅

`tauri-plugin-shell` würde dem Frontend über Capabilities das Starten von Programmen erlauben (Scope mit Regex
für Argumente) – die Prüfung läge in JSON-Capabilities, und das Frontend schickte das Kommando. Eigener Command
`run_tool(toolId, context)`: das **Frontend schickt nur die Tool-Id und den Kontext** (Dateien, Ordner,
Zielordner); Programm und Argumente kommen ausschließlich aus der im Backend geladenen Konfiguration.

- Format (`tools.json` im App-Config-Ordner, Schema v1):
  `{ version, replaceDefaults, terminal?, tools: [{ id, label, shortcut?, program, args: string[], perFile, fileLimit, workingDir? }] }`.
- Platzhalter **je Argument**: `{file}`, `{name}`, `{dir}`, `{targetDir}` dürfen in einem Argument stehen
  (`--file={file}` bleibt **ein** Argument); `{files}` nur als ganzes Argument (wird zu n Argumenten). Unbekanntes
  bleibt wörtlich. Pfade bleiben `OsString` (nicht-UTF-8 unter Linux geht durch).
- `perFile: true` → ein Aufruf je Datei (alt `$file`); sonst ein Aufruf mit allen. Mehr als `fileLimit` Dateien
  (Default 10, max. 1 000) → Fehler `too_many_files` (nicht still kürzen). Tool braucht Dateien, keine da → `invalid_path`.
- Start: `std::process::Command` (Argument-Array, keine Shell), stdin/stdout/stderr = null, Unix eigene
  Prozessgruppe, ein Thread wartet auf das Ende (keine Zombies). Programm fehlt → `program_not_found`.
- Kontext im Backend geprüft: jeder Pfad über `validate_input_path`, Dateien müssen existieren, Ordner müssen Ordner sein.
- Defaults je OS (keine absoluten Nutzerpfade): **Editor** `edit` (macOS `open -t {files}`, Windows
  `notepad.exe {file}` je Datei, Linux `xdg-open {file}` je Datei – auf Linux gibt es keinen „Standard-Editor“; im
  README steht, wie man `gnome-text-editor`/`kate`/`code` einträgt), **VS Code** (`open -a "Visual Studio Code"`
  auf macOS, weil GUI-Apps dort den Shell-`PATH` nicht erben; sonst `code` / `code.cmd`), Windows zusätzlich
  **7-Zip** (`C:\Program Files\7-Zip\7zFM.exe {file}`). Terminal und „im Finder zeigen“ sind eigene Aktionen (E2),
  keine Tools mehr.
- **mr-Format importierbar:** ein Eintrag mit `cmd` (+ `para`) statt `program` wird beim Laden umgestellt: Zeile
  in Wörter (einfache/doppelte Anführungszeichen beachtet), erstes = Programm, `$file` → `{file}` (+ `perFile`),
  `$dir` → `{dir}`; `$clidir`/`$__dirname` → Eintrag verworfen mit Warnung. Kürzel `control shift f` → `Mod+Shift+F`.
- Eigene Einträge ersetzen gleichnamige Defaults (`id`), sonst angehängt; `replaceDefaults: true` = nur die Datei.
- **F4 (`OPEN_EDIT_DLG`)** startet das Tool `edit`.
- Ungültige Einträge (Id-Zeichen, leeres Programm, `{` im Programm, `{files}` in einem Teilargument, > 64 Argumente)
  werden übersprungen und als Warnung gemeldet; die Datei bleibt unangetastet.
- **Konfiguration bearbeiten** (`OPEN_TOOL_CONFIG_DLG`): legt `tools.json` mit den Defaults an, falls sie fehlt,
  öffnet sie mit der Standard-App und lädt sie danach auf Wunsch neu („Tools neu laden“ im Dialog). Ein Editor in
  der App kommt mit 015 (Einstellungen).

### E4 – Tools als dynamische Aktionen ✅

`ActionService.setExtras(list)` nimmt Aktionen mit Id `tool:<id>`, Label, Kürzel und Handler. Palette und
Actions-Menü (Spalte „Konfiguration & Tools“) zeigen sie; der `KeyboardDispatcher` fragt nach dem Keymap-Lookup die
Extras. **Kürzel der Keymap gewinnen**; ein Tool-Kürzel, das schon belegt oder ungültig ist, wird ignoriert und
gemeldet (alt: `f4` des Tools überschrieb Edit). Die Keymap-Notation gilt auch für Tools (`Mod+Shift+4`).

### E5 – Zwischenablage über die Webview, ohne Crate/Plugin ✅

`navigator.clipboard.writeText` (Tauri-Ursprung ist ein sicherer Kontext, Aktion = Nutzergeste), Rückfall
`document.execCommand('copy')` über ein unsichtbares Textfeld. Kein `tauri-plugin-clipboard-manager`/`arboard`
nötig (Begründung: nur Text schreiben; die Webview kann das; X11-Besitz der Zwischenablage regelt WebKitGTK). Fassade
`ClipboardApi` (Tests mit Fake).

- Formate: **Text = eine Zeile je Eintrag (`\n`)** (alt: Tab-getrennt – Zeilen lassen sich in Terminal und Editor
  besser nutzen), **JSON = Array von Strings**, eingerückt mit 2 Leerzeichen.
- Inhalt: Markierung, sonst Cursor, nie `..`; **Ordner sind dabei** (anders als alt – Pfade von Ordnern braucht man
  genauso oft). Reihenfolge = **Anzeige der Liste** (Sortierung/Filter der Table), nicht die des Listings.
- Echte Datei-Zwischenablage (im Finder/Explorer einfügen): macOS `NSPasteboard` mit Datei-URLs, Windows
  `CF_HDROP`, Linux `x-special/gnome-copied-files` + `text/uri-list` – machbar, aber je OS eigener nativer Code
  bzw. eine Crate mit Fensterbesitz (X11/Wayland). **Offen** (eigener Schritt, eher mit 012 Drag & Drop).

### E6 – „Öffnen mit …“ ✅

Mindestumfang: Standard-App (003, `Enter`) und **„Mit Tool öffnen …“** (`OPEN_TOOLS_DLG`, `Mod+Shift+X`) = Palette nur
mit den Tools. Die System-Auswahl der App (macOS `open -a` mit App-Liste, Windows `OpenAs_RunDLL`/„Öffnen mit“,
Linux Portal `OpenURI` mit `ask`) bleibt **offen** – je OS eigener Dialog, hier nicht prüfbar.

### E7 – Shell-Zeile (mr §1.7) ✅ Entscheidung, Umsetzung offen

Sicherheitsregel für später: Befehle laufen nur nach ausdrücklicher Eingabe des Nutzers in der Shell-Zeile, in
seinem Kontext (wie ein Terminal), nie aus Konfiguration oder Dateinamen zusammengesetzt; Ausgabe nur anzeigen.
Besser gleich ein echtes Terminal per PTY (`portable-pty`). `TOGGLE_SHELL` bleibt in diesem Prompt ohne Handler
(Zeitrahmen) – Terminal hier (E2) deckt den häufigsten Fall ab.

### E8 – Kürzel ✅

| Aktion | Linux/Windows | macOS | Herkunft |
|---|---|---|---|
| `REVEAL_IN_FILE_MANAGER` | `Mod+Shift+F` | `Mod+Shift+F` | mr „Reveal in Finder“ |
| `OPEN_TERMINAL_HERE` | `Mod+Shift+C` | `Mod+Shift+C` | mr `CMD_SHELL` |
| `OPEN_TOOLS_DLG` | `Mod+Shift+X` | `Mod+Shift+X` | neu |
| `COPY_2_CLIPBOARD_FULLNAMES` | `Mod+Alt+C` | `Mod+Alt+C` | neu (Mod+C bleibt frei für die Datei-Zwischenablage) |
| `COPY_2_CLIPBOARD_NAMES` | `Mod+Alt+N` | `Mod+Alt+N` | neu |
| `OPEN_EDIT_DLG` | `F4` | `F4` | TC (schon belegt) |
| Laufwerke | `Alt+F1`/`Alt+F2` | wie bisher | TC (Ordnermenü) |

JSON-Varianten ohne Kürzel (Palette, Actions-Menü).

## 3. Verträge

### Rust

```rust
// platform/volumes.rs
struct Volume { path: String, label: String, kind: VolumeKind /* fixed|removable|network|optical|ram|unknown */,
                fs_type: Option<String>, total: Option<u64>, free: Option<u64>, reachable: bool }
pub fn list_volumes(timeout: Duration) -> Vec<Volume>;
// platform/desktop.rs
pub fn reveal(path: &Path) -> Result<(), FsError>;
pub fn open_terminal(dir: &Path, custom: Option<&ProgramSpec>) -> Result<(), FsError>;
// tools.rs (rein std, ohne Tauri)
struct Tool { id, label, shortcut: Option<String>, program, args: Vec<String>, per_file: bool, file_limit: u32, working_dir: Option<String> }
struct ToolContext { files: Vec<String>, dir: Option<String>, target_dir: Option<String> }
pub fn plan(tool: &Tool, ctx: &ResolvedContext) -> Result<Vec<Invocation>, FsError>;  // Invocation { program, args: Vec<OsString>, cwd }
pub fn spawn(inv: &Invocation) -> Result<(), FsError>;
```

| Command | Rückgabe / Fehler |
|---|---|
| `list_volumes()` | `Volume[]` (nie Fehler; nicht erreichbar = `reachable: false`) |
| `reveal_in_file_manager(path)` | `()` · `invalid_path`, `not_found`, `program_not_found`, `io` |
| `open_terminal(dir)` | `()` · `invalid_path`, `not_found`, `not_a_directory`, `program_not_found` |
| `load_tools()` | `{ tools: ToolInfo[], warnings: string[], file: string \| null }` – `ToolInfo` ohne Programm/Argumente außer zur Anzeige |
| `run_tool(toolId, context)` | Anzahl gestarteter Prozesse · `unknown_tool`, `too_many_files`, `invalid_path`, `not_found`, `program_not_found` |
| `open_tools_config()` | Pfad der Datei (angelegt mit Defaults, falls fehlend) · `io` |

Neue Fehlercodes (Rust + `fs.models.ts` + `describeFsError`): `program_not_found`, `unknown_tool`, `too_many_files`.

### TypeScript

```ts
// core/os/os.models.ts
interface Volume { path; label; kind: VolumeKind; fsType: string | null; total: number | null; free: number | null; reachable: boolean }
interface ToolInfo { id; label; shortcut: string | null; perFile: boolean; fileLimit: number; needsFiles: boolean; program: string }
interface LoadedTools { tools: ToolInfo[]; warnings: string[]; file: string | null }
interface ToolContext { files: string[]; dir: string | null; targetDir: string | null }
// core/os/os-api.ts – Fassade OsApi (listVolumes, reveal, openTerminal, loadTools, runTool, openToolsConfig)
// core/os/clipboard.ts – ClipboardApi (writeText) + clipboardText(entries, 'names' | 'paths', 'lines' | 'json')
// core/actions/action.service.ts
interface ExtraAction { id: string; label: string; shortcut: string | null; enabled(): boolean; run(): unknown }
setExtras(list: readonly ExtraAction[]): void;  extraFor(stroke: string): ExtraAction | null; runExtra(id): Promise<boolean>
```

## 4. UI-Skizzen

```
Ordnermenü ▾ (Alt+F1 links / Alt+F2 rechts), role="menu", Gruppen mit role="group"
┌───────────────────────────────────────────┐
│ Home                                      │
│ LAUFWERKE                                 │
│   /            ext4 · 12.0 GB frei / 252 GB│
│   USBSTICK     vfat · 3.1 GB frei / 7.5 GB │
│   nas          nfs4 · nicht erreichbar     │  (aria-disabled nicht: Wechsel versuchen erlaubt)
│ FAVORITEN …                               │
│ ZULETZT …                                 │
└───────────────────────────────────────────┘

Tool-Konfiguration (Dialog, role="dialog", Fokusfalle)
  Datei: ~/.config/…/tools.json            [Öffnen im Editor] [Neu laden] [Schließen]
  Tools: Editor (F4) · VS Code · …          Warnungen (role="alert")
```

Meldungen (Tool gestartet / Fehler / „3 Pfade kopiert“) über die bestehende Meldungszeile des `ActionService`
bzw. die Live-Region des Workspace.

## 5. Tests

- **Rust** `tools.rs`: Platzhalter (eingebettet, `{files}` als n Argumente, `perFile`, fileLimit, fehlender Ordner),
  Validierung, mr-Import (Wörter mit Anführungszeichen, `$clidir` verworfen, Kürzel), Laden (fehlt/kaputt → `.bad`),
  Merge mit Defaults; **Injection-Test** (Unix): Dateien namens `"; rm -rf ~"`, `$(touch PWNED)`, `` `touch PWNED2` ``,
  `a && touch PWNED3` an `/usr/bin/printf '%s\n' {files}` – Ausgabe exakt die Namen, keine PWNED-Datei;
  fehlendes Programm → `program_not_found`.
  `platform/volumes.rs`: mountinfo-Parser (Escapes, Pseudo-FS, Systempfade, Duplikate, Netz/Wechselmedium), Timeout
  mit hängender Abfrage (kein zweiter Thread), echtes `list_volumes` enthält `/`.
  `platform/desktop.rs`: Terminal-Kandidaten (Argumente je Programm), Datei-URI-Kodierung, Windows `;`-Regel
  (reine Funktion, auf allen OS getestet); macOS/Windows-Aufrufe nur hinter `#[cfg]`.
- **Frontend**: `clipboardText` (Zeilen/JSON, Ordner, Reihenfolge), Clipboard-Aktionen mit Fake, Tools-Store
  (Kontext aus beiden Panels, Fehler, Extras/Kürzel-Konflikt), Dispatcher mit Extra-Kürzel, Palette zeigt Tools,
  Ordnermenü mit Laufwerken.
- **E2E** (Xvfb): Laufwerke im Ordnermenü, Tool mit Echo-Programm und bösartigem Dateinamen, Zwischenablage
  (Einfügen ins Pfadfeld), Terminal/Dateimanager unter Linux nur, soweit im Container vorhanden.

## 6. Annahmen

- A1: Tools-Datei heißt `tools.json` (App-Config-Ordner wie Session/Keymap); Schema-Version 1.
- A2: Ein Tool ohne `{file}`/`{files}`/`{name}` braucht keine Dateien (z. B. „Ordner in VS Code“ mit `{dir}`).
- A3: Laufwerke erscheinen nur im Ordnermenü (keine eigene Laufwerksleiste) – spart Platz im Header; eine Leiste
  kann mit 014 (Menüleiste) kommen.
- A4: `TOGGLE_SHELL` und die Dateityp-Konfiguration (mr) bleiben offen (Zeitrahmen), s. E7 und §10.

## 7. Abweichungen bei der Umsetzung

- **`VolumesStore` getrennt von `OsStore`**: die Tab-Leiste braucht nur die Laufwerke; mit `OsStore` hätte sie das
  ganze Aktionssystem gezogen (DI in den bestehenden Komponenten-Tests). `OsApi`/`ClipboardApi` sind zusätzlich
  `providedIn: 'root'` mit der Tauri-/Webview-Implementierung als Default (außerhalb von Tauri: `no_backend`).
- `run_tool` prüft vor dem Start auch den Arbeitsordner (sonst sähe ein fehlender Ordner wie ein fehlendes Programm aus).
- Der Test des `ActionService` nutzte `Mod+Alt+C` als Beispiel-Override – jetzt Default von „Pfade kopieren“; der
  Test verwendet `Mod+Alt+J`.
- Kaputte `tools.json` wird **nicht** nach `.bad` verschoben (anders als Session/Keymap/Vorlagen): die Datei schreibt
  nur der Nutzer von Hand; die App nimmt dann die Defaults und meldet den Fehler.

## 7a. Linux-Desktops (Aufgabe 6)

| Desktop | Dateimanager zeigen | Terminal |
|---|---|---|
| GNOME (Nautilus) | `FileManager1.ShowItems` markiert die Datei | `kgx` (GNOME Console), `ptyxis` (Fedora 41+), `gnome-terminal` – jeweils `--working-directory=` |
| KDE (Dolphin) | `FileManager1.ShowItems` | `konsole --workdir` |
| Xfce (Thunar ≥ 4.16), Cinnamon (Nemo), MATE (Caja) | `FileManager1` (Thunar/Nemo/Caja bieten den Dienst) | `xfce4-terminal`/`mate-terminal` `--working-directory=` |
| ohne Dienst (Fenstermanager, Container) | Rückfall: Ordner mit der Standard-App (`xdg-open`) | `$TERMINAL`, `x-terminal-emulator` (Debian-Alternative), dann alacritty, kitty, wezterm, foot, tilix, terminator, xterm (`current_dir`) |

`XDG_CURRENT_DESKTOP` entscheidet nur die Reihenfolge; Flatpak/Snap-Builds würden Portale brauchen (offen, 017).

## 8. Review

Selbstprüfung (Schwerpunkte des Prompts):

- **Command-Injection:** kein Shell-Aufruf im ganzen Feature; Programme und Argumente nur aus `tools.json`, Pfade
  als einzelne `OsString`-Argumente (`{files}` = n Argumente, eingebettet bleibt es ein Argument). Rust-Test mit
  `"; rm -rf ~"`, `$(touch PWNED)`, Backticks, `&&`, `|`, Zeilenumbruch + E2E mit Argument-Logger: nichts ausgeführt.
  Sonderfälle: Windows Terminal (`;` → `cmd.exe`), Explorer (`raw_arg` nur mit Pfad ohne `"`), `dbus-send`
  (URI prozent-kodiert inkl. `,`), Windows-`.cmd`-Tools (`code.cmd`): Rust std escapt Batch-Argumente bzw. lehnt
  unsichere ab (CVE-2024-24576, seit 1.77).
- **Pfad-Validierung:** jeder Pfad über `validate_input_path` (absolut, kein NUL), Dateien müssen existieren, Ordner
  Ordner sein, Arbeitsordner existieren; Tool-Id muss in der Backend-Konfiguration stehen (`unknown_tool`), mehr als
  `fileLimit` (≤ 1 000) bzw. bei `perFile` mehr als 50 → `too_many_files`; Programme nur als blanker Name oder absolut, Arbeitsordner absolut; Standard-App-Tools prüfen Ausführbares wie Enter (Review #1–#7).
- **Capability-Umfang:** unverändert `core:default`; kein Plugin, keine neue Crate.
- **Netzlaufwerke:** Abfrage je Volume in eigenem Thread, 1,5 s Gesamtzeit, hängende Abfrage nicht doppelt
  (Test mit künstlich hängender Abfrage); macOS liest `/Volumes` ohne `stat` (`d_type`). Restrisiko: ein dauerhaft
  hängender Thread je totem Mount bleibt bis zum Ende der App bestehen (einer je Mount, nicht je Aufruf).
- **Fehlende Programme:** `program_not_found` mit Programmname (E2E: „The program "fnf-not-installed" was not found“);
  kein Terminal gefunden → Hinweis auf `tools.json`/`$TERMINAL`.

### Review (separater Agent) – Ergebnis

| # | Fund | Stand |
|---|---|---|
| 1 | mittel – F4 (Linux `xdg-open {file}`) umging die Ausführbar-Rückfrage aus 003 | ✅ `tools::uses_default_app` (Flag `defaultApp` oder Launcher `xdg-open`/`gio`/`kde-open`/`open`/`explorer` …) + `check_default_app_files` (je Datei `opener::check_openable`, Ordner erlaubt); `run_tool(…, allowExecutable)`; `OsStore.runTool` fragt bei `executable` über `confirmExecutable` des Panels und wiederholt. Tests `default_app_tools_check_executables`, `os.spec` „F4 (default app) asks …“ |
| 2 | gering – `{name}` Option-Injection (`-rf`) | ✅ `{name}` am Argumentanfang mit führendem `-` → `./-rf` (eingebettet wie `--title={name}` unverändert); README empfiehlt `{file}`. Test `names_with_a_leading_dash_are_no_options` |
| 3 | gering – Windows-Systemprogramme relativ (`explorer.exe`, `cmd.exe` aus dem aktuellen Ordner) | ✅ `desktop::system_programs()` = `%SystemRoot%\explorer.exe`, `%SystemRoot%\System32\cmd.exe` (Rückfall `C:\Windows`), `cfg(windows)`; Test `windows_system_programs_are_absolute` (nur unter Windows, hier nicht kompiliert – kein Windows-Target im Container) |
| 4 | gering – `program` relativ, `workingDir` relativ | ✅ `tools::program_ok`: blanker Name (ohne `/`, `\`, `:`, nicht `.`/`..`) oder absolut, auch für `terminal`; `workingDir` nach dem Ersetzen `is_absolute()`, sonst `invalid_path`. Test `programs_and_working_folders_are_not_relative` |
| 5 | gering – Terminal-Suche Linux (leere/relative PATH-Einträge, Ausführbar-Bit, Startfehler) | ✅ `find_in_path` überspringt relative Einträge, prüft unter Unix Datei + `x`-Bit; `spawn_first_terminal` versucht bei Startfehler das nächste. Tests `path_lookup_skips_relative_entries_and_non_executables`, `the_next_terminal_is_tried_when_one_fails_to_start` |
| 6 | gering – `unescape_octal` (`\777` überläuft `u8`, Escape am Feldende nicht dekodiert) | ✅ in `u16`, nur ≤ `0o377`, sonst unverändert; Grenze `i + 4 <= len`. Test `octal_escapes_and_non_utf8` |
| 7 | gering – `perFile` unbegrenzt (bis `fileLimit` 1 000 Fenster), `cmd.exe` ohne `/K` | ✅ `MAX_PER_FILE_STARTS = 50` → `too_many_files` mit Hinweis auf `perFile`; `{files}`-Aufrufe unberührt. `cmd.exe /K` wie im Design. Tests `per_file_starts_are_bounded`, `windows_terminal_never_gets_a_semicolon` |

## 9. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [x] Phase 2 Rust: `platform/volumes.rs`, `platform/desktop.rs`, `tools.rs`, sechs Commands, drei Fehlercodes –
  23 neue Rust-Tests (Linux; macOS/Windows-Zweige nur hinter `#[cfg]`, hier nicht kompiliert)
- [x] Phase 3 Frontend: `OsApi`, `ClipboardApi`, `OsStore`, `VolumesStore`, `ActionService.setExtras` + Dispatcher,
  Palette (Scope „tools“), Actions-Menü, Ordnermenü „Drives“, Tool-Konfigurationsdialog, 6 neue Aktionen/Kürzel –
  12 neue Frontend-Tests (`clipboard.spec.ts`, `os.spec.ts`)
- [x] Phase 4 E2E (Xvfb :95, Linux, eigenes `XDG_CONFIG_HOME`, Logger statt echter Programme): Laufwerke im Menü mit
  Größen (`/`, `fuse.rclone`, ext4-Mounts) und Wechsel per Tastatur; Tool mit Kürzel und bösartigen Namen
  (je ein Argument, keine `PWNED`-Datei); mr-Tool je Datei; fehlendes Programm → Meldung; `$clidir`-Tool → Warnung;
  Zwischenablage (Einfügen ins Pfadfeld); Terminal (Fallback-Kette bis `xterm`, Arbeitsordner stimmt); Dateimanager
  (kein FileManager1 im Container → Ordner per `xdg-open`); F4 → Tool `edit`; Tool-Dialog, „Open tools.json“;
  Tools im Actions-Menü. **Nicht geprüft:** echtes totes Netzlaufwerk (kein NFS im Container; Unit-Test), D-Bus
  `ShowItems` mit echtem Nautilus/Dolphin, macOS und Windows komplett, dark mode des neuen Dialogs nur über Tokens.
- [x] Phase 5 Doku: architecture, roadmap, feature-parity, README, CLAUDE.md §1/§3, prompts/README

## 10. Offen

- Echte Datei-Zwischenablage je OS (E5), System-„Öffnen mit“-Dialog (E6), Shell-Zeile/PTY (E7, `TOGGLE_SHELL`).
- Dateityp-Konfiguration (mr `filetype/defaults/data.json`) für „Auswahl nach Typ“ und Icons.
- Tool-Editor in der App (015); Flatpak/Snap über Portale (017).
- macOS/Windows: `cargo check` für diese Ziele war hier nicht möglich (Ziel-Toolchains fehlen) – CI-Build nötig.
