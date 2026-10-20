# Design 026: Import alter Konfiguration (mr)

> Status: **umgesetzt** (Kürzel-/Tool-Dateien von macOS/Windows nur per Unit-Test, nicht in der echten App geprüft) · Branch `feat/import-alte-konfig` · Prompt: [026-import-alte-konfig.md](026-import-alte-konfig.md)
> · Marc hat am 20.10.2026 Umfang und Ablauf festgelegt (ohne Haltepunkt nach Phase 1) – die Entscheidungen stehen hier.

## 1. Bestand → wofür → passt/fehlt

| Baustein | wofür | Stand |
|---|---|---|
| mr `apps/fnf-api/src/assets/<bereich>/{custom,defaults}` | Quelle | `shortcut/<os>.json`, `button/data.json`, `filetype/data.json`, `search/data.json` (**vertauscht**: mr schreibt eigene Muster nach `search/defaults/`), `tool/<os>.json`, `color/<name>.json`, `setup/data.json` (ohne defaults) |
| `keymap.rs` (`Bindings`, `save`, `bound`), `resolveKeymap` (TS) | Ziel Kürzel | passt; Konflikte/Defaults kennt nur das Frontend (Katalog, Keymap-JSONs) |
| `buttons.rs` (`Sets`, `save`), `resolveButtonSets` | Ziel Buttons | passt (mr-Format = Inhalt von `sets`, 022 E1) |
| `filetypes.rs` (`FileType`, `save`, liest mr-Array) | Ziel Dateitypen | passt |
| `search.templates` (settings, 022 E8), `presetGlob`, `DEFAULT_FORM` | Ziel Suchmuster | passt |
| `tools.rs` `from_mr`, `convert_mr_shortcut`, `validate`, `check_file` | Ziel Tools | passt; `from_mr`-Fehler sind englische Sätze → für die Vorschau als Code |
| `ThemeService.importFile` (019: `--fnf-*` → Tokens, WCAG-Korrektur) | Ziel Farben | passt; wählt das Schema aus → für den Massenimport abschaltbar machen |
| `settings::import` (Bündel-Teile, je Modul geprüft, atomar) + Entsperren in `import_settings` | Schreiben | passt als Schreibweg; Sicherung fehlt |
| `fs_atomic.rs` (`write_atomic`, `keep_broken_file`) | Sicherung | fehlt: `backup_copy` |
| Einstellungsdialog ▸ Daten (Pfadfeld, Export/Import, `reload`) | Einstieg | erweitern um Knopf „Aus Files and Folders (alt) importieren…“ |

## 2. Entscheidungen

**E1 Arbeitsteilung.** Rust liest und **übersetzt** (Formate, Ids, Notation, Gründe als Codes) – reine Funktionen in
`mr_import/`, unit-getestet. Das Frontend **plant** gegen den aktuellen Zustand (Konflikte, Zusammenführen/Ersetzen),
weil nur es Katalog, Default-Keymaps, eingebaute Dateitypen/Suchvorlagen und Theme-Namen kennt – reine Funktionen in
`mr-import-logic.ts`. Geschrieben wird in **einem** Command, der vorher sichert und über `settings::import` (je Modul
geprüft, atomar) schreibt; Tools führt Rust selbst mit `tools.json` zusammen, Farben gehen danach über
`ThemeService.importFile` (vorher gesichert).

**E2 Fundort.** `scan_old_config(path)`: Kandidaten in dieser Reihenfolge – `p`, `p/assets`, `p/src/assets`,
`p/apps/fnf-api/src/assets`, `p/apps/fnf-api/assets`, `p/fnf-api/src/assets`; ist `p` selbst ein Bereichsordner
(`shortcut`, `button`, …) oder dessen `custom`/`defaults`, gilt der passende Elternordner. Ein Ordner gilt als
`assets`, wenn er mindestens einen Bereichsordner enthält. Danach eine begrenzte Suche (Tiefe ≤ 4, ≤ 2000 Ordner,
keine Symlinks, ohne `node_modules`/`.git`) nach einem `assets`-Ordner, der das erfüllt (gepackte Electron-App).
Nichts gefunden → `FsError` `not_found` mit Pfad („kein Files-and-Folders-Ordner“). Pfad über `resolve_input` (`~`).

**E3 Nur Abweichungen von den mr-Defaults.** mr legte beim ersten Speichern eine **vollständige Kopie** der Defaults
in `custom/` an. Übernommen wird deshalb nur, was von `defaults/` daneben abweicht (Kürzel je Eintrag, Buttons je
Satz, Dateitypen als Liste, Tools je Id, Farben je Datei); gleiche Einträge zählen als „unverändert“. Fehlt
`defaults/`, gilt alles als eigen. Suchmuster: mr schrieb eigene Muster über die mitgelieferte Datei
(`search/defaults/data.json`, sonst `search/custom/data.json`). mr hat seine mitgelieferten Suchmuster als Kopien seiner
Dateitypen ausgeliefert: ein Muster mit Name und Endungen einer Kategorie aus `filetype/defaults` zählt als
mitgeliefert (E2E-Befund: sonst kamen 11 mr-Standardmuster als „eigene“ an). Das Frontend lässt außerdem Muster weg,
deren Endungsmenge einer eingebauten Vorlage gleicht, und gleich benannte mit gleichem Glob („unverändert“).

**E4 Kürzel übersetzen** (nur `shortcut/custom/<os>.json` des laufenden OS: `osx`/`windows`/`linux`).
- Ids: Tabelle `map_action` nach `docs/feature-parity.md` A.1 (z. B. `ADD_NEW_TAB` → `CLONE_TAB`,
  `NAVIGATE_LEVEL_DOWN` → `NAVIGATE_PARENT`, `OPEN_GOTO_ANYTHING_DLG` → `OPEN_COMMAND_PALETTE`, `SPACE_PRESSED` →
  `TOGGLE_MARK_AND_ADVANCE`, `TOGGLE_SELECTION` → `INVERT_MARKS`, `CMD_SHELL` → `OPEN_TERMINAL_HERE`). Gründe:
  `table_navigation` (`ARROW_*`, `HOME/END/PAGEUP/PAGEDOWN_PRESSED`), `no_equivalent` (`SAVE_CONFIG`, `RELOAD_DIR_0/1`,
  `CHANGE_LAF_*`, `OPEN_SHELL_DLG`, `OPEN_DOWNLOAD_DLG`, `OPEN_PROMPT_CONFIG_DLG`, Pseudo-Ids, `EDIT_FILE`),
  `unknown_action` (sonst). Ein Default-Kürzel, das in `custom` fehlt, wird als `removed` gemeldet (nicht entfernt) –
  nur, wenn seine Aktion noch existiert (ein fehlendes `SAVE_CONFIG` ist keine Nachricht).
- † (`never_fired`): mr verglich den Event-String `ctrl+alt+shift+cmd` roh mit dem Schlüssel – Modifier in anderer
  Reihenfolge oder doppelt, und die Tasten `delete`/`plus`/`minus` (Event lieferte `del`, `+`, `-`) feuerten nie.
  Solche Einträge werden gemeldet, **nicht** übernommen (sie haben nie gewirkt).
- Notation: macOS `cmd`→`Mod`, `ctrl`→`Ctrl`; Windows/Linux `ctrl`→`Mod`, `cmd` = Windows-Taste → `meta_key`
  (gibt es in der neuen Keymap nicht). Tasten: Buchstaben/Ziffern groß, `f1`–`f24`, Pfeile → `Arrow…`,
  `space/enter/tab/esc/backspace/insert/home/end/pageup/pagedown`, Satzzeichen; Akkorde („`ctrl+k f6`“) je Teil.
  Unbekannte Taste → `unknown_key`.
- Planung im Frontend: `canonicalShortcut` (ungültig → `invalid_shortcut`, Tabellen-/macOS-reserviert →
  `reserved`), Katalog (`unknown_action`). Schon so belegt → „vorhanden“ (zählt nicht). Sonst bekommt die Aktion das
  Kürzel **zusätzlich** zu ihren heutigen (Override-Liste = heutige Liste + neu, ≤ 8), ein anderer Besitzer verliert es
  (Konflikt, Import gewinnt). Modus **Ersetzen**: Grundlage ist ein leerer Override (die eigenen Änderungen fallen weg,
  die Defaults gelten), dann wie oben; die wegfallenden eigenen Einträge stehen als Konflikte in der Vorschau (ebenso bei
  Buttons und Suchvorlagen). Nach einem Import springt der Modus auf „Zusammenführen“ zurück.

**E5 Buttons.** `button/custom/data.json`, Sätze `default|shift|alt` gleichnamig, mr-`cmd` → `cmd` (macOS) bzw.
`ctrl` (Windows/Linux – dort hält Strg die Leiste um, 022 E3). Ids über `map_action` (Gründe wie E4, ohne †);
> 10 Slots → Rest `too_many`. Nur Sätze, die von `button/defaults` abweichen. Zusammenführen: importierter Satz
ersetzt den gleichnamigen der Nutzerdatei (Konflikt, wenn dort schon einer stand); Ersetzen: Nutzerdatei = nur die
importierten Sätze.

**E6 Dateitypen.** `filetype/custom/data.json` (mr-Array), über `filetypes::sanitize` (Grenzen 022 E4). Gleich den
Defaults → nichts. Zusammenführen: heutige Liste (Nutzerdatei oder eingebaut) – Kategorien gleichen Namens (ohne
Groß/Klein) werden ersetzt (Konflikt), neue angehängt; Ersetzen: die mr-Liste. Kategorien ohne Icon/Farbe mit einem
eingebauten Namen behalten dessen Aussehen (022 E4).

**E7 Suchmuster** → `search.templates` als `{label, form: {...DEFAULT_FORM, name: presetGlob(p), nameMode: 'glob',
wholeName: true}}` (wie der Suchdialog Vorlagen anwendet). Zusammenführen: gleicher Name ersetzt (Konflikt);
Ersetzen: nur die importierten. Höchstens 50 (Schema) – Rest `too_many`.

**E8 Tools** (`tool/custom/<os>.json`): je Eintrag über den vorhandenen mr-Import (`from_mr` + `validate`); Gründe
`old_script` (`$clidir`/`$__dirname`), `invalid`. Gleich dem mr-Default derselben Id → unverändert. Die Vorschau zeigt
die übersetzten Tools; **geschrieben** wird nicht, was das Frontend schickt: `apply_old_config` bekommt nur den
`assets`-Ordner (`toolsFrom`) und liest die Tools dort selbst noch einmal (Selbst-Review: Programme und Argumente
kommen nie aus dem Frontend, CLAUDE.md §4). Anwenden in Rust:
eigene `tools.json` lesen (fehlt → neu, kaputt → Abbruch des Bereichs, nichts überschreiben), Tools gleicher Id
ersetzen (Konflikt, wenn die Id schon wirksam ist – eingebaut oder eigen), neue anhängen; Ersetzen: eigene Tools =
die importierten (`terminal`, `replaceDefaults` bleiben). Standardmäßig **nicht** angehakt (Tools starten Programme,
wie beim Bündel-Import 015).

**E9 Farben** (`color/custom/*.json`, ≤ 50 Dateien à ≤ 256 KiB, nur `.json`, keine Symlinks): Rust liefert nur
Name + Pfad der Dateien, die von `color/defaults/<name>.json` abweichen. Das Frontend importiert jede über
`ThemeService.importFile(path, { select: false })` (neue Option, Standard wie bisher) – Umrechnung `--fnf-*`,
WCAG-Korrektur und eindeutige Namen („Name (2)“) sind die von 019. Gleicher Name wie ein **eigenes** Schema = schon übernommen
(„unverändert“, E2E-Befund: sonst legte jeder weitere Import eine Kopie an); gleicher Name wie ein eingebautes =
Konflikt (wird als Kopie „Name (2)“ angelegt). Kein Ersetzen-Modus.

**E10 Einstellungen** (`setup/data.json`): `condensedPresentationStyle: true` → `view.density = condensed`,
`loadFolderSizeAfterSelection: true` → `behavior.spaceCalcSize = true`; `false` ist mrs Default und wird nicht
übertragen. `open…InNewWindow: true` → `not_applicable` (Dialoge laufen im Hauptfenster). Konflikt = der heutige Wert
weicht vom Default ab und vom importierten.

**E11 Schreiben + Sicherung.** `apply_old_config(plan)` (async, `spawn_blocking`): für jeden Teil zuerst
`fs_atomic::backup_copy(file)` – vorhandene Datei nach `<name>.bak` kopieren, ist die belegt `<name>.bak-2` … `-99`
(`create_new`, eine ältere Sicherung wird nie überschrieben); scheitert die Sicherung, wird der Teil **nicht**
geschrieben (`part_failed`). Dann `settings::import` mit dem Teil (Keymap, Buttons, Dateitypen; Einstellungen als
**Zusammenführung** mit der geladenen `settings.json`, damit nur die Import-Schlüssel sich ändern; Tools als fertige
`tools.json`). `themes.json` wird gesichert, wenn Farben angehakt sind (geschrieben vom ThemeService danach). Rückgabe
`{ imported, warnings, backups }`; geschriebene Teile werden wie beim Bündel-Import entsperrt (`write_blocked`).
Das Frontend speichert vorher entprellte Einstellungen (`flush`) und lädt danach die Stores neu (wie `import_settings`).

**E12 Rückfrage.** Die Vorschau ist die erste Rückfrage; „Importieren“ fragt zusätzlich nach (Bestätigungsdialog), wenn
in den angehakten Bereichen Konflikte stehen („N vorhandene Einträge ändern sich (siehe „Einzelheiten“)“ – auch ein
Default-Kürzel, das zur importierten Aktion wechselt) oder „Ersetzen“ gewählt ist. Der Assistent-Zustand liegt im Root-Store und überlebt den Bestätigungsdialog (ein Dialog zur
Zeit, `DialogService`).

**E13 UI und Einstiege.** Aktion `OPEN_IMPORT_OLD_CONFIG_DLG` („Import from Files and Folders (old)…“, Gruppe
`config`, kein Kürzel), Menü Werkzeuge, Palette, Einstellungen ▸ Daten (Knopf).
```
┌ Import from Files and Folders (old version) ─────────────────────────┐
│ Folder of the old installation [/home/me/fnf-mr            ] [Search]│
│ hint: repository folder, apps/fnf-api/src/assets or assets           │
│ Found: /home/me/fnf-mr/apps/fnf-api/src/assets                       │
│ ┌ What to import (fieldset) ───────────────────────────────────────┐ │
│ │ [x] Keyboard shortcuts (Linux)  5 new · 2 conflicts · 3 skipped  │ │
│ │     ▸ Details (details/summary: Liste mit Gründen)               │ │
│ │ [x] Buttons  1 set                                               │ │
│ │ [ ] Tools  2 tools – tools start programs                        │ │
│ │ [–] Colour schemes  not found (disabled)                         │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ On conflicts (radiogroup): (•) Merge – the import wins ( ) Replace   │
│ Backups (.bak) are kept next to every changed file.                  │
│ <status, aria-live>                                                  │
│                                           [Close] [Import]           │
└──────────────────────────────────────────────────────────────────────┘
```
Fokus: Pfadfeld (Autofokus) → Suchen → Checkboxen/Details → Radios → Schließen/Importieren. Enter im Pfadfeld sucht.
Pfadfeld vorbelegt mit dem Ordner unter dem Cursor bzw. dem Ordner des aktiven Panels. Ergebnis und Fehler in einer
Live-Region; Bereiche ohne Fund deaktiviert mit Grund. Keine Ordnerauswahl per Systemdialog (kein Dialog-Plugin;
die vorhandenen Dialoge nutzen ebenfalls Pfadfeld + Panel-Vorbelegung).

**E14 Grenzen und Sicherheit.** Gelesen werden nur die bekannten Dateinamen unter dem gefundenen `assets` (JSON ≤ 1 MiB,
Farben ≤ 256 KiB), keine Symlinks bei den Farbdateien und der Suche. Geschrieben werden nur die festen Dateien im
Konfig-Ordner (keine Pfade vom Frontend). Alle Werte gehen durch die vorhandenen `sanitize`/`bound`/`validate`.
Programme in Tools werden nicht gestartet, nur übernommen.

## 3. Verträge

Rust (`src-tauri/src/mr_import/`, Commands `commands/mr_import.rs`, beide `async`):
```rust
scan_old_config(path: String) -> MrScan
apply_old_config(plan: MrApply) -> MrApplyReport

MrScan { root: String, os: String /* osx|windows|linux */,
         shortcuts: Option<MrArea<Vec<MrShortcut>>>, buttons: Option<MrArea<Sets>>,
         file_types: Option<MrArea<Vec<FileType>>>, search: Option<MrArea<Vec<MrPattern>>>,
         tools: Option<MrArea<Vec<Tool>>>, colors: Option<MrArea<Vec<MrColorFile>>>,
         setup: Option<MrArea<Map<String, Value>>> }      // None = Datei nicht gefunden
MrArea<T> { file: String, error: Option<String /* broken|too_big */>, items: T,
            unchanged: u32, skipped: Vec<MrSkipped> }
MrSkipped { item: String /* z. B. "cmd+alt+up → NAVIGATE_BACK" */, reason: String, detail: Option<String> }
MrShortcut { id: String, shortcut: String, source: String }
MrPattern { label: String, extensions: Vec<String> }
MrColorFile { name: String, path: String }
MrApply { keymap: Option<Bindings>, buttons: Option<Sets>, file_types: Option<Vec<FileType>>,
          settings: Option<Map<String, Value>> /* nur zu setzende Schlüssel */,
          tools_from: Option<String> /* assets-Ordner, Rust liest neu */, tools_replace: bool, backup_themes: bool }
MrApplyReport { imported: Vec<String> /* Bündel-Teile */, warnings: Vec<SettingsWarning>, backups: Vec<String> }
```
Gründe (`reason`): `table_navigation`, `no_equivalent`, `unknown_action`, `never_fired`, `meta_key`, `unknown_key`,
`too_many`, `old_script`, `invalid`, `not_applicable`; im Frontend zusätzlich `invalid_shortcut`, `reserved`.
TS: `core/mrimport/mr-import.models.ts`, `MrImportApi` (`scan`, `apply`), Fake `src/testing/fake-mr-import-api.ts`.

## 4. Tests

- Rust (`mr_import/tests.rs`, Testdaten `mr_import/fixtures/` = gekürzte Kopien aus mr `apps/fnf-api/src/assets`):
  Fundort (Root, assets, Bereichsordner, gepackt, fremd), Kürzel (Ids, Notation je OS, †, Meta, Akkorde,
  Defaults-Abgleich), Buttons (`cmd` → `cmd`/`ctrl`, Grenzen), Dateitypen, Suche (vertauschte Ordner), Tools
  (`$clidir`, Default gleich), Farben (abweichend, Symlink, zu groß), Setup, kaputtes JSON, `backup_copy` (Folge
  `.bak`, `.bak-2`), Anwenden (Teile, Einstellungen zusammengeführt, Tools ersetzt/angehängt, kaputte `tools.json`).
  `command_rules`: neue Datei in `SOURCES`.
- Frontend: `mr-import-logic.spec.ts` (Kürzel: vorhanden/neu/Konflikt/Ersetzen/reserviert/unbekannt; Buttons, Dateitypen,
  Suche, Tools, Farben, Setup), `mr-import.store.spec.ts` (Scan, Vorschau, Rückfrage, Anwenden, Neuladen, Fehler),
  `mr-import-dialog.spec.ts` (Rollen, Tastatur, deaktivierte Bereiche), `catalogs.spec.ts`.
- E2E (Xvfb `:96`, eigenes `HOME`): Kopie der mr-Assets mit eigenen Änderungen → Vorschau, Import, Wirkung (Kürzel,
  Leiste, Icons, Suchvorlage, Tool in der Palette, Farbschema), Sicherungen auf der Platte, zweiter Import → `.bak-2`.

## 5. Fortschritt

- [x] Phase 1: Prompt + Design (`8c9e6c0`)
- [x] Phase 2: Rust – `mr_import/{mod,keys,tests}.rs` + Testdaten `mr_import/fixtures/`, `fs_atomic::backup_copy`,
  `tools::{from_mr_value, merge_file}`, Commands `commands/mr_import.rs` (in `command_rules::SOURCES`),
  `unblock_imported` aus `import_settings` herausgelöst (`92df2a2`)
- [x] Phase 3: Frontend – `core/mrimport/` (DTOs, `MrImportApi`), Fake `src/testing/fake-mr-import-api.ts`,
  `features/mrimport/` (Logik, Root-Store, Dialog, Texte en/de, Aktion), `ThemeService.importFile(path, {select})`,
  Katalog/Menü Werkzeuge/Einstellungen ▸ Daten (`092c249`)
- [x] Phase 4: E2E unter Xvfb `:96` – Befunde behoben (`817fc5b`; Review-Fix Tools `375613d`)
- [x] Phase 5: Doku (README, `docs/architecture.md`, `docs/feature-parity.md`, `prompts/README.md`)
- [x] Phase 6: `pnpm check` grün, Debug-Build, E2E wiederholt, Selbst-Review (unten)

### E2E-Protokoll (Linux, WebKitGTK, 1100×720, eigenes `HOME`)

Testdaten: Kopie aller JSON-Dateien aus mr `apps/fnf-api/src/assets` nach `/tmp/e2e-026/data/fnf mr ä/…` mit eigenen
Änderungen (Linux-Kürzel `ctrl+alt+t`, `ctrl+f` → Go to anything, Akkord `ctrl+k ctrl+c`, `alt+shift+f12`,
† `cmd+alt+n`, `ctrl+cmd+s` gelöscht; Shift-Satz mit `OPEN_GOTO_ANYTHING_DLG`, `cmd`-Satz + Suchen; Dateityp „Comics“;
Suchmuster „Comics & covers“; Tool MELD; `color/custom/norton.json` geändert, `paper.json` = Default; Setup
`condensedPresentationStyle: true`). Daneben Umlaut-/Leerzeichen-Ordner, versteckte Datei, Symlink, gesperrter Ordner.
Vorher eigener Override `OPEN_SETUP_DLG: F12` und eine eigene `tools.json` (MELD → kdiff3, `mine`).

| Schritt | Ergebnis |
|---|---|
| Palette „import from files“ → Dialog; Cursor auf `fnf mr ä` | Pfadfeld mit dem Ordner unter dem Cursor vorbelegt ✅ |
| Enter im Pfadfeld (Repo-Root) | „Found: …/apps/fnf-api/src/assets“; Kürzel „4 to import · 1 conflict · 1 not transferred · 95 unchanged“, Details: „Ctrl+F: Find… → Go to anything…“, „cmd+alt+n → OPEN_MKDIR_DLG – never worked in the old version“ ✅; Tools nicht angehakt, mit Warnung ✅ |
| `/tmp/e2e-026/home` | „No configuration of the old version was found in /tmp/e2e-026/home.“ (rot, `role=alert`) ✅ |
| Importieren → Rückfrage → Importieren | `keymap.json` (CLONE_TAB +`Mod+Alt+T`, COPY_2… +`Mod+K Mod+C`, OPEN_COMMAND_PALETTE +`Mod+F`, OPEN_FIND_DLG nur noch `Alt+F7`, OPEN_SETUP_DLG `F12` + `Alt+Shift+F12`), `keymap.json.bak` = alter Override; `buttons.json` (`shift`, `ctrl`), `filetypes.json` (+Comics), `search.templates` (3: „movies & images“, „ebooks & covers“, „Comics & covers“), `view.density = condensed`, Schema „norton (mine)“ – aktives Schema unverändert ✅ |
| Danach Strg+F / Shift halten | Strg+F öffnet „Go to anything“; Shift-Leiste zeigt „Go to anything“ an Stelle 2; Zeilen dichter (condensed) ✅ |
| Zweiter Blick (gleicher Ordner) | alles „nothing new“, Farbschemata „2 unchanged“ (eigenes Schema erkannt) ✅ |
| Tools angehakt, Import | `tools.json.bak` = alte Datei; MELD ersetzt (meld, `{file}`, `Mod+Shift+M`), `mine` bleibt ✅ |
| Modus „Replace“, Kürzel | Rückfrage „Replace: …“; `keymap.json.bak-2` = Stand davor, `.bak` unverändert; `F12` entfällt ✅ |
| Deutsch + dunkel (`general.language = de`, System folgt `Adwaita:dark`) | Titel, Bereiche, Gründe, Zusammenfassungen deutsch; lesbar in dunkel ✅ |

Befunde und Fixes aus dem E2E: (1) 11 mitgelieferte mr-Suchmuster kamen als eigene an → Abgleich mit
`filetype/defaults` (E3); (2) „`ctrl+cmd+s → SAVE_CONFIG` entfernt“ war Rauschen → nur noch für existierende Aktionen
(E4); (3) jeder weitere Import legte eine Kopie des Farbschemas an → eigenes Schema gleichen Namens = unverändert (E9);
(4) nach „Ersetzen“ zeigte die Vorschau alles erneut als neu → Modus springt zurück (E4); (5) Rückfrage sprach von
„eigenen“ Einträgen, obwohl ein Default-Kürzel wechselte → neue Formulierung (E12). Nicht geprüft: der Eintrag im Menü
Werkzeuge – der Klick auf die HTML-Menüleiste kam unter Xvfb nicht an (xdotool, CLAUDE.md §9); dass die Aktion in der
Menüleiste steht, prüft `menu-model.spec.ts` › „has every action of the catalog in the menu bar (mouse reaches everything)“.

## 6. Review (Selbst-Review des Diffs `main...feat/import-alte-konfig`)

| # | Befund | Stand |
|---|---|---|
| 1 | `apply_old_config` nahm Tools (Programm + Argumente) aus dem Frontend entgegen – neue Fähigkeit, `tools.json` mit beliebigen Programmen zu schreiben | behoben: nur `toolsFrom` (Ordner), Rust liest die mr-Datei neu (`apply_merges_or_replaces_tools_and_keeps_a_broken_file`) |
| 2 | Geschrieben werden nur feste Dateien im Konfig-Ordner (`ConfigFiles`), jede über ihr Modul (`bound`, `sanitize`, `validate`); vor jedem Schreiben `backup_copy` (`create_new`, nie überschreiben); scheitert die Sicherung, unterbleibt der Teil | ok |
| 3 | Lesen: nur bekannte Dateinamen, Größenlimits, Farben ohne Symlinks, Suche nach `assets` begrenzt (Tiefe 4, 2000 Ordner, keine Symlinks, ohne `node_modules`/`.git`) | ok |
| 4 | Beide Commands `async` + `spawn_blocking`, Datei in `command_rules::SOURCES` | ok |
| 5 | Texte en/de vollständig (`catalogs.spec.ts`), Gründe als Codes aus Rust; Pfade nur angezeigt, im Frontend nie zerlegt | ok |
| 6 | Barrierefreiheit: `app-modal` (Fokusfalle, Esc), Checkboxen mit `aria-describedby` auf die Zusammenfassung, `details/summary`, Radios in `fieldset/legend`, Status `aria-live`, Fehler `role=alert` | ok |
| 7 | Nach der Rückfrage öffnet der Dialog neu; der Fokus geht an das Pfadfeld statt an den Import-Knopf | offen, gering (wie Einstellungen ▸ Zurücksetzen) |
| 8 | Tools gelten bei jedem Blick als „zu importieren“ (das Frontend kennt die Argumente vorhandener Tools nicht) – ein zweiter Import ersetzt sie gleich, mit Sicherung | offen, gering |
| 9 | Ab der 99. Sicherung einer Datei scheitert der Teil (`part_failed`) – bewusst, statt alte Sicherungen zu überschreiben | bewusst |
| 10 | `settings.json` wird in Rust zusammengeführt; der `SettingsStore` speichert vorher (`flush`) und lädt danach neu | ok |

## 7. Offen

- macOS/Windows: Kürzel-Übersetzung (`osx`: `cmd` → `Mod`, `ctrl` → `Ctrl`; Windows: `cmd` → `meta_key`) ist
  unit-getestet, aber nur unter Linux in der echten App geprüft.
- KI-Prompts (`prompt/custom/*.yaml`) – es gibt noch keine KI-Funktionen (Parität H).
- Review #7, #8.
