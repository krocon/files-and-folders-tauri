# Design 032 – Starter-Menü (eigener Schnellstart)

> Status: **umgesetzt** (21.10.2026, Branch `feat/starter-menue`). Phasen zusammengelegt (kleines Feature, Auftrag
> ohne Freigabe-Halt). Vorbild: Total Commander „Start“ → „Startermenü ändern“.

## Bestand → wofür

| Baustein | wofür | passt / erweitert |
|---|---|---|
| `tools.rs` (011): `Tool`, `plan`, `expand`, `split_words`, `spawn_detached`, `check_default_app_files` | Start ohne Shell, Platzhalter je Argument, Default-App-Prüfung | passt; `expand` kann zusätzlich `{stem}`/`{ext}` |
| `commands::run_tool` | Pfade prüfen, starten | Kern als `launch_tool` herausgezogen (Tools + Starter) |
| `config_file.rs`, `fs_atomic` (022) | Nutzerdatei laden (kaputt → `.bad`), atomar schreiben | passt |
| `ActionService.setExtras` (011 E4) | Extra-Aktionen mit eigenen Kürzeln | **erweitert**: Extras je Quelle (`tools`, `starter`), `starterTree`, `category`/`hint` |
| `menu-model.ts` (014) | Menüleiste, nativer Spec, Kontextmenü | **erweitert**: `'@starter'` (Baum), `'@tools'` nur noch `tool:*`, Top-Menü `start` |
| `MenuService` (014) | Popup an der Liste | `openStarter()` mit eigenem Namen |
| `settings.rs` Bündel (015) | Export/Import | neuer Teil `starter` (wie Tools nur auf Wunsch angehakt) |

## Entscheidungen

- **E1 Datei** `starter.json` im App-Config-Ordner: `{version: 1, items: [...]}`; Eintrag `{id, kind, label,
  program, params, workingDir, folder, shortcut, items}` mit `kind` = `program` | `folder` | `submenu` | `separator`.
  Rust bringt den Baum in Form (`sanitize`: Ids gültig/eindeutig, Felder je Art, ≤ 5 Ebenen unter der obersten,
  ≤ 500 Einträge, Labels ohne Steuerzeichen) und prüft jeden Eintrag (`problems`: Codes je Id). Ungültige Einträge
  bleiben in der Datei, erscheinen gedimmt mit Grund und werden nicht gestartet.
- **E2 Parameter wie TC, Ausführung wie die Tools.** Parameter sind *eine Zeile* (`"%P%N" -x`), Rust zerlegt sie in
  Wörter (Anführungszeichen gruppieren, `tools::split_words`), übersetzt die TC-Platzhalter in die der Tools
  (`%P%N` → `{file}`, `%N` → `{name}`, `%O` → `{stem}`, `%E` → `{ext}`, `%P`/`%T` → `{dir}`/`{targetDir}` +
  Trenner, `%S` → `{files}` als eigenes Wort, `%%` → `%`) und startet über `tools::plan` + `spawn_detached` – **jedes
  Wort ist ein Argument, keine Shell** (`; rm -rf ~` bleibt drei harmlose Argumente). `{…}`-Platzhalter der Tools
  gehen auch. `%P%N` & Co. meinen die **Datei unter dem Cursor**, nur `%S` alle markierten (TC-Semantik;
  `StarterContext.cursor` zusätzlich zu `files`). Startordner: leer = Ordner der aktiven Seite, sonst absolut bzw.
  `%P`/`%T`/`~`. Kommando: Name aus `PATH` oder absoluter Pfad (`~` erlaubt), nie relativ; macOS-`.app` →
  `open -a <app> …`. Launcher wie `open`/`xdg-open` fragen bei ausführbaren Dateien wie Enter (`executable`).
- **E3 Nur per Id starten.** Das Frontend schickt `run_starter(id, context)`; Programm und Argumente kommen nur aus der
  in Rust geladenen Datei (wie `run_tool`). Der Editor schreibt die Datei über `save_starter` (dieselbe
  Vertrauensstufe wie das Bearbeiten von Hand); Rust speichert nur, wenn kein Eintrag ein Problem hat (`saved:
  false` + Probleme je Eintrag, der Dialog markiert und wählt den ersten). Import über das Einstellungsbündel nur
  auf Wunsch (wie Tools), mit Warnhinweis.
- **E4 Aktionen.** Jeder Programm-/Ordner-Eintrag ist eine Extra-Aktion `starter:<id>` (Palette in der Gruppe
  „Startermenü“, Kürzel aus der Datei, Keymap gewinnt, Konflikte als Meldung wie bei Tools). Katalog:
  `OPEN_STARTER_MENU` (Popup, **`Alt+S`** auf allen OS – frei; unter macOS greift der Dispatcher über `code`, ⌥S
  tippt in Textfeldern weiter „ß“) und `OPEN_STARTER_CONFIG_DLG` („Startermenü ändern…“, auch im Actions-Menü).
  Das Kürzel des Menüs ändert man im Kürzel-Dialog (Keymap-Override), die der Einträge im Editor.
- **E5 Menüs.** Top-Menü „Start“ zwischen „Werkzeuge“ und „Fenster“: `['@starter', '-', OPEN_STARTER_CONFIG_DLG]`;
  dieselben Defs für das Popup. Leeres Menü zeigt „Noch keine Einträge“ (gedimmt), leere Untermenüs ebenso.
  „Mit Tool öffnen“ (Palette und Menüs) zeigt weiter nur Tools.
- **E6 Editor** (Dialog `starter-config`): links ein APG-Baum (flach, `aria-level`, Einrückung), rechts die Felder
  des gewählten Eintrags; Knöpfe Hinzufügen (Programm, Ordner, Untermenü, Trennlinie, aktueller Ordner, Datei unter
  dem Cursor) und Anordnen (Hoch/Runter, ins Untermenü darüber, heraus, Entfernen), Tastatur Alt+↑/↓/→/←, Entf.
  Neue Einträge kommen hinter die Auswahl (auf einem Untermenü als erstes Kind). Kürzel prüft das Frontend
  (Notation, Keymap, Tools, andere Einträge), alles andere Rust beim Speichern. Kein Datei-Auswahldialog (kein
  Dialog-Plugin, CLAUDE.md §4) – dafür die Schnell-Einträge aus dem Panel.

## Verträge

| Command | Parameter | Rückgabe |
|---|---|---|
| `load_starter` | – | `LoadedStarter { items, warning: ConfigWarning?, problems: [{id, code}], file }` |
| `save_starter` | `items` | `SavedStarter { saved, items, problems }` (zu viele Einträge → `too_many`) |
| `run_starter` | `id`, `context {files, cursor, dir, targetDir}`, `allowExecutable?` | `{kind: 'started', count}` \| `{kind: 'folder', path}`; Fehler `unknown_tool`, `invalid_path`, `program_not_found`, `executable`, `too_many_files` |

Problem-Codes: `label`, `program`, `folder`, `params_quote`, `params_files`, `working_dir`, `too_deep`, `too_long`.

## Tests

- Rust `starter.rs`: Platzhalter-Übersetzung, Parameter als Wörter (keine Shell), `%S`, `%N` mit `-`, Probleme je
  Eintrag, `sanitize` (Ids, Felder, Tiefe, Anzahl), `find`/`count`, Speichern/Laden/kaputte Datei, macOS `.app`;
  `settings.rs`: Teil `starter` im Bündel; `command_rules` kennt `commands/starter.rs`.
- Frontend `starter-logic.spec.ts` (Baum, Einfügen, Anordnen, Tiefe), `starter.spec.ts` (Extras + Kürzel, Menü
  Start nativ/HTML, leeres Menü, Start mit Cursor/`%S`, Ordner → Navigation, Alt+S-Popup, Editor mit Tastatur,
  belegtem Kürzel, Rust-Problemen und Speichern, Schnell-Einträge); `menu-model`/`menus.spec.ts` angepasst.
- E2E unter Xvfb (Linux): s. Fortschritt.

## Fortschritt

- [x] Rust (Modul, Commands, Bündel) · [x] Frontend (Store, Menüs, Popup, Editor, Texte de/en) · [x] `pnpm check`
- [x] E2E Linux (Xvfb, Debug-Build, eigener `HOME`/`XDG_CONFIG_HOME` mit vorbereiteter `starter.json`): Menü „Start“
  in der HTML-Menüleiste mit Einträgen, Untermenü „Mehr“, Trennlinie, gedimmtem „Kaputt“ und „Change starter
  menu…“; `Alt+S` öffnet das Popup an der Liste (↑/↓, → öffnet das Untermenü); Enter auf „Touch cursor file“
  (`touch "%P%N.touched"`) legt `b.txt.touched` neben der Cursor-Datei an, `Alt+Shift+1` (Kürzel aus der Datei)
  ebenso; der Eintrag mit `; rm -rf ~` in den Parametern bekommt das als Argumente an `touch` (Fehler von `touch`,
  `HOME` unberührt); Ordner-Eintrag `~/Ziel ä` wechselt die aktive Seite; Editor zeigt das Problem von „Kaputt“
  (rot markiert, Hinweis), nach Korrektur auf `/usr/bin/true` speichert er `starter.json` (Format wie oben).
  Nachgebessert: Titel-Feld in der Dialogschrift statt Mono.
- Offen: macOS (natives Menü „Start“, ⌥S in der Liste, `.app`-Einträge) und Windows (`.bat`/`.cmd` als Kommando)
  bei Marc bzw. in der CI.
