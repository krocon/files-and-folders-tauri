# Prompt 026: Import alter Konfiguration – Kürzel, Buttons, Dateitypen, Suchmuster, Tools, Farben aus mr

> **Slug:** `import-alte-konfig` · **Braucht:** 002 (Keymap-Override), 011 (Tools, mr-Import), 015 (Einstellungen,
> Bündel-Import), 019 (`--fnf-*`-Import), 022 (Nutzerdateien Buttons/Dateitypen, Suchvorlagen) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/022-konfig-editoren.design.md` (E1, E4, E8: Formate) und
> `docs/feature-parity.md` („Lesehilfe Kürzel alt“, Abschnitt A, „Folge-Prompts“ 026).
> Marc hat am 20.10.2026 den Umfang festgelegt (unten); Details entscheidet das Design, ohne Haltepunkt nach Phase 1.

## Ziel

Wer `files-and-folders-mr` benutzt und angepasst hat, holt seine Anpassungen mit einem Assistenten in die neue App:
Ordner der alten Installation angeben, Vorschau je Bereich ansehen, angehakte Bereiche übernehmen. Nichts wird ohne
Rückfrage überschrieben, jede geänderte Datei bekommt vorher eine Sicherung.

## Bestand

- mr speichert Nutzerkonfiguration unter `apps/fnf-api/src/assets/<bereich>/custom/` (Defaults daneben in
  `defaults/`): `shortcut/custom/<os>.json` (ganze Tabelle `taste → ID`), `button/custom/data.json`
  (`{default,shift,cmd,alt}`), `filetype/custom/data.json` (`[{label, extensions}]`), Suchmuster in
  `search/defaults/data.json` (mr vertauscht custom/defaults), `tool/custom/<os>.json` (`cmd` + `para`),
  `color/custom/<name>.json` (`{name, colors: {--fnf-…}}`), `setup/data.json` (sechs Schalter).
- Neu vorhanden: Keymap-Override (`keymap.rs`, `resolveKeymap`), `buttons.json`/`filetypes.json` (022),
  `search.templates` (022 E8), Tool-Import `tools.rs` (`from_mr`, `convert_mr_shortcut`), Theme-Import
  (`ThemeService.importFile`, 019), Bündel-Import mit Teilen (`settings::import`).

## Aufgaben

1. **Assistent** (Aktion + Dialog, Einstieg Einstellungen ▸ Daten, Menü, Palette): Pfadfeld (vorbelegt aus dem
   aktiven Panel), Rust sucht `assets` (Repo-Root, `apps/fnf-api/src/assets`, `assets`, ein Bereichsordner),
   Vorschau je Bereich (gefunden / Anzahl / Konflikte / nicht übertragbar mit Grund), Import nur der angehakten
   Bereiche.
2. **Kürzel:** nur das OS der laufenden App; mr-Ids übersetzen (Tabelle wie `docs/feature-parity.md` A.1), Notation
   übersetzen (`cmd` = Meta auch unter Windows/Linux → nicht übertragbar), † (nie gefeuert) melden statt übernehmen,
   Tabellen-Navigation und entfallene Funktionen melden. Nur Abweichungen von den mr-Defaults daneben übernehmen.
   Konflikte mit dem bestehenden Override: zusammenführen (Import gewinnt) oder ersetzen – Option.
3. **Buttons, Dateitypen, Suchmuster** → 022-Nutzerdateien; **Tools** über den vorhandenen mr-Import, **Farben** über
   den vorhandenen Theme-Import (nur verdrahten).
4. Reine Übersetzung in Rust (unit-getestet mit kleinen Kopien der mr-Dateien als Testdaten, Herkunftsvermerk),
   Commands async, Sicherung jeder überschriebenen Datei (`.bak`, nie eine ältere Sicherung überschreiben).

## Akzeptanzkriterien

- Repo-Root von mr, `assets` oder ein Bereichsordner werden erkannt; ein fremder Ordner gibt eine klare Meldung.
- Vorschau nennt je Bereich Anzahl, Konflikte und nicht übertragbare Einträge mit Grund (en/de).
- Importierte Kürzel wirken sofort; ein vergebenes Kürzel wechselt zur importierten Aktion (Zusammenführen) oder der
  Override wird ersetzt; † und Navigationstasten werden nicht übernommen.
- Button-Sätze, Dateitypen, Suchvorlagen, Tools und Farbschemata erscheinen ohne Neustart.
- Vor jedem Schreiben liegt eine Sicherung `<datei>.bak` (bzw. `.bak-2` …) neben der Datei.

## Tests

- Rust: Fundort, jede Übersetzung (Ids, Notation, †, Meta, Defaults-Abgleich), kaputte/zu große Dateien,
  Sicherungen, Anwenden mit Konflikten, Unicode-Pfade.
- Frontend: Zusammenführen/Ersetzen je Bereich (rein), Store (Scan → Vorschau → Anwenden → Stores neu geladen),
  Dialog (Tastatur, Checkboxen, Live-Region), Texte en/de.
- E2E unter Xvfb mit einer Kopie der mr-Assets und eigenen Änderungen.
