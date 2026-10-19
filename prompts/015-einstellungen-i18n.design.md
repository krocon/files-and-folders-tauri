# Design 015: Einstellungen und Internationalisierung (de/en)

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) · **Datum:** 2026-10-18 ·
> **Branch:** `feat/einstellungen-i18n` (von `main`, 001–014 fertig; 016/019 parallel)
> **Grundlage:** legacy §5 (Persistenz), §7 (Konfigurationsdateien, Merge-Reihenfolge), §9 (kein Options-Dialog,
> Pfad-Traversal über `username`), mr §5/§9 (`setup/data.json`, Config-CRUD), die „kommt mit 015“-Stellen in
> den Design-Dokumenten 001–014, CLAUDE.md §4.
> **Phasen:** alle sechs; Rust ist klein (ein Modul `settings.rs` + Bundle-Export/-Import).

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| `session.json` (004, Rust `session.rs`) | Tabs, Pfade, Cursor, Table-Zustand, Favoriten, Splitter; oft geschrieben | **bleibt getrennt** (Zustand, keine Einstellung) |
| `keymap.json` (002) | Override je Aktion, Kürzel-Dialog | **bleibt** – Dialog wird aus „Settings → Tastatur“ geöffnet |
| `rename-presets.json` (007), `themes.json` (013), `tools.json` (011) | je eigene Validierung, Import/Export bzw. Bearbeiten im Editor | **bleiben**; landen im Gesamt-Export (E4) |
| `fs_atomic.rs` | `write_atomic`, `keep_broken_file` (`.bad`) | **passt** |
| `*-texts.ts` (13 Dateien) | englische Kataloge `XX_TEXTS` (Strings + Funktionen), Komponenten halten `t = XX_TEXTS` | **Grundlage** der i18n (E5); Reste in Templates, Aktionskatalog, Token-Labels, `describeFsError()` |
| `shared/format.ts` | `formatSize` binär mit „KB“, Datum `Intl` mit Systemsprache | **erweitern**: Einheit + Datumsformat + Locale aus den Einstellungen |
| `file-table-model.ts` | `ROW_HEIGHT = 24` fest, Spaltentitel bei der Erstellung kopiert | Zeilenhöhe zur Laufzeit über `body.defaultRowHeight` + `repaintHard()`; Titel über `header.setValue(0, col, …)` (öffentliche `AreaModelIf`-API, keine Lücke) |
| `MenuService` (014) | natives Menü aus einem `computed`-Spec, Struktur-Schlüssel enthält die Labels | **passt** – Labels lesen das Sprach-Signal, Sprachwechsel baut das native Menü neu |
| `WatchService` (012) | `POLL_NETWORK = false` fest | Einstellung `watch.pollNetwork` |
| `OPEN_SETUP_DLG`, `Mod+,` (014) | ohne Handler, gedimmt | Handler + Dialog |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – `settings.json` **ergänzt** die Fachdateien, ersetzt sie nicht ✅

Eine neue Datei `<app_config_dir>/settings.json` hält alle **skalaren Einstellungen** (Sprache, Ansicht,
Verhalten, Überwachung, Menüleiste) und kleine, gemerkte Listen (letzte Suchen). Die Fachdateien bleiben:

- `session.json` ist Zustand (bei jeder Navigation geschrieben) – eine Einstellungsänderung soll ihn nicht mitschreiben
  und umgekehrt; Favoriten bleiben dort (Sitzungsdatei 003).
- `keymap.json`, `themes.json`, `rename-presets.json`, `tools.json` haben eigene, getestete Validierung, eigene
  Größen und eigenen Import/Export bzw. werden (Tools) bewusst im Editor bearbeitet. Ein Zusammenlegen wäre eine
  Migration mit Risiko ohne Nutzen. Die Theme-Auswahl bleibt in `themes.json` (sie verweist auf die eigenen Schemata
  derselben Datei – eine Quelle, atomar konsistent; Abweichung von 013 A2, s. §7).
- Der Nutzer sieht trotzdem **einen** Dialog und **eine** Export-Datei (E4).

### E2 – Schema als JSON, gemeinsam für Rust und TS ✅

`src/app/core/settings/settings-schema.json`: Schlüssel (`bereich.name`) → `{ type, default, values?, min?, max?,
maxItems?, maxBytes? }`. Typen: `bool`, `enum`, `int`, `json` (gemerkte Listen, Größe begrenzt). Rust bindet die
Datei mit `include_str!` ein (eine Quelle, kein Abdriften), das Frontend importiert sie für Typen/Defaults.

Datei: `{ "version": 1, "settings": { "view.sizeFormat": "decimal", … } }` – **nur Abweichungen vom Default**
werden geschrieben (ein späterer Default-Wechsel erreicht Nutzer, die nie etwas geändert haben).

Rust `settings::sanitize`: bekannte Schlüssel mit gültigem Wert bleiben; ungültiger Wert → entfernt (= Default) +
Warnung `invalid_value` mit Schlüssel; **unbekannte Schlüssel bleiben erhalten** (neuere Version, max. 200, je
≤ 4 KiB JSON); Werte gleich dem Default werden entfernt.

Migration: `migrate(version, map)` – v1 ist die erste Version; fehlende Version = Fehler (kaputt). Eine **neuere**
Version wird gelesen (bekannte Schlüssel), aber **nicht überschrieben** (`persist: false`, Warnung
`newer_version`) – sonst zerstörte ein Downgrade die neuere Datei. Kaputt (kein JSON, falsche Form, unlesbar) →
Defaults, Datei als `settings.json.bad` beiseite (Konvention aller Dateien seit 002; der Prompt schreibt `.bak` –
gemeint ist dasselbe), Warnung `broken` mit Pfad; konnte sie nicht beiseitegelegt werden → `persist: false`.

Warnungen sind **Codes** (`{ code, key?, path? }`), keine Sätze – das Frontend übersetzt (E5).

### E3 – Settings-Service im Frontend ✅

`SettingsApi` (Fassade: `load`, `save`, `exportAll`, `importAll`), `FakeSettingsApi` in `src/testing/`.
`SettingsStore` (Root): `values` als Signal (Defaults + Datei), typisiertes `get(key)` als `computed`, `set(key,
value)`, `reset(keys)` (je Bereich), `resetAll()`. Speichern **entprellt 300 ms**, nur die Abweichungen; beim
Schließen geht ein ausstehender Stand sofort raus (`pagehide`). Ungültige Werte prüft schon das Frontend gegen das
Schema (gleiche Regeln), Rust ist die Grenze.

Wirkung: die Verbraucher lesen die Signale (`format.ts`, Datei-Liste, Menüleiste, Watcher, Löschen, Doppelklick,
Leertaste); nichts braucht einen Neustart außer „Start-Ordner“ (wirkt naturgemäß beim nächsten Start – der Dialog
sagt das).

| Schlüssel | Typ / Werte | Default | Wirkung |
|---|---|---|---|
| `general.language` | `system` / `en` / `de` | `system` | sofort (Texte, Menüs, `Intl`, `<html lang>`) |
| `general.startFolder` | `session` / `home` | `session` | beim nächsten Start: Tabs wiederherstellen oder beide Seiten im Home-Ordner |
| `view.sizeFormat` | `binary` (KiB) / `decimal` (kB) / `bytes` | `binary` | sofort |
| `view.dateFormat` | `locale` / `iso` (`yyyy-mm-dd hh:mm`, Uhrzeit klein, mr) | `locale` | sofort |
| `view.density` | `condensed` 22 px / `normal` 24 px / `spacious` 34 px (mr) | `normal` | sofort |
| `view.folderBrackets` | bool – Ordner als `[Name]` (alt) | `false` | sofort |
| `view.hideExtension` | bool – Dateiname ohne Endung (Endung bleibt in „Ext“) | `false` | sofort |
| `view.showHidden` | bool – versteckte Dateien in **neuen** Tabs | `false` | neue Tabs |
| `view.menuBar` | bool – Menüleiste (Windows/Linux, HTML) | `true` | sofort; `FOCUS_MENU_BAR` blendet sie bis zum Schließen ein |
| `behavior.deleteToTrash` | bool – F8 in den Papierkorb (sonst endgültig, immer mit Rückfrage) | `true` | sofort |
| `behavior.confirmTrash` | bool – vor dem Papierkorb fragen | `true` | sofort |
| `behavior.doubleClick` | `open` (Standard-App) / `view` (Ansicht F3) | `open` | sofort (Ordner öffnen immer) |
| `behavior.spaceCalcSize` | bool – Leertaste auf Ordner berechnet die Größe (mr `loadFolderSizeAfterSelection`) | `true` | sofort |
| `watch.pollNetwork` | bool – Netzlaufwerke per Polling überwachen (012) | `false` | sofort (nächste Anmeldung der Ordner) |
| `search.recent` | `json`, ≤ 10 Einträge, ≤ 64 KiB | `[]` | letzte Suchen über Neustarts (009) |

mr-Setup-Flags: `open…InNewWindow` entfallen (Desktop, Dialoge); `loadFolderSizeAfterSelection` →
`behavior.spaceCalcSize`; `condensedPresentationStyle` → `view.density`.

### E4 – Export/Import aller Einstellungen als eine Datei ✅

`export_settings(dir)` schreibt `files-and-folders-settings.json` (nie überschreiben, sonst `… (2).json`):
`{ format: "files-and-folders-settings", version: 1, settings, keymap, themes, renamePresets, tools }` – jeder Teil
so, wie Rust ihn lädt (validiert). `import_settings(path, parts)` liest ≤ 2 MiB, prüft jeden Teil mit dem Sanitizer
seines Moduls und schreibt die gewählten Teile atomar; Antwort: importierte Teile + Warnungen. **Tools** sind beim
Import abgewählt (sie starten Programme – Hinweis im Dialog). Danach lädt das Frontend die betroffenen Stores neu
(Einstellungen, Keymap, Themes, Tools, Vorlagen). Die Sitzung ist kein Teil (Zustand). Pfade wie bei 013: Ordner
bzw. Datei als Eingabefeld (kein Datei-Dialog-Plugin, CLAUDE.md §4).

### E5 – i18n: eigene Laufzeit-Lösung, keine Bibliothek ✅

`@angular/localize` übersetzt beim Build (eine App je Sprache, Wechsel = Neustart/Neuladen, Funktionen mit
Pluralen schwerfällig); ngx-translate/Transloco wären Laufzeit-Abhängigkeiten. Die Texte liegen **schon** als
typisierte Objekte vor. Lösung (`core/i18n/i18n.ts`, ~80 Zeilen):

- `language` = Signal (`en` | `de`). `translatable(en, { de })` liefert einen **Proxy**: jeder Zugriff
  `t.copy` / `t.entries(n)` liest das Signal und gibt den Wert der aktuellen Sprache (fehlt er: Englisch).
  Templates und `computed`s hängen damit automatisch an der Sprache – **Umschalten ohne Neustart**, die
  Komponenten bleiben unverändert (`readonly t = OPS_TEXTS`).
- Deutsche Kataloge `xx-texts.de.ts` sind als `Translation<typeof XX_EN>` typisiert: der Compiler verlangt
  **jeden Schlüssel mit derselben Signatur** (Funktionen mit Parametern bleiben Funktionen – Plural im Code mit
  `Intl.PluralRules` bzw. `n === 1`). Ein Spec läuft zusätzlich über alle registrierten Kataloge (Laufzeit:
  Schlüssel, Typen, Funktionen liefern Strings, keine leeren Texte, Deutsch ≠ Englisch außer Ausnahmeliste).
- Aktionen: `ACTIONS[id].label` wird ein Getter auf `ACTION_LABELS` (Katalog je `ActionId`); Kategorien ebenso.
  Token- und Kontrastlabels (013): Katalog mit englischem Text als Schlüssel (`trLabel()`), Spec prüft Vollständigkeit.
- `describeFsError()` übersetzt nach **`code`**; Rust-`message` bleibt technisch (Details-Zeile, Log).
- `Intl` (Datum, Zahlen, Sortierung) mit `locale()` = `de-DE`/`en-US`… aus Sprache + Systemregion.
- Default `system`: `navigator.language` beginnt mit `de` → Deutsch, sonst Englisch.
- Performance: ein Proxy-Zugriff + Signal-Read je Text (ns); die Datei-Liste liest beim Rendern keine Kataloge
  außer `formatSize`/`formatModified` (gecachte `Intl`-Formatter je Locale).

### E6 – Einstellungsdialog ✅

`OPEN_SETUP_DLG` (`Mod+,`, alle OS; macOS-App-Menü „Einstellungen…“ aus 014), Dialog `settings`:

```
┌ Settings ─────────────────────────────────────────────── × ┐
│ [Search settings…                               ]          │
│ ┌──────────────┐ ┌───────────────────────────────────────┐ │
│ │ General     ▸│ │ Language        (•) System ( ) English │ │
│ │ View         │ │                 ( ) Deutsch            │ │
│ │ Behaviour    │ │ Start folder    [Restore tabs ▾]       │ │
│ │ Keyboard     │ │                 ⓘ applies at next start│ │
│ │ Tools        │ │ …                                      │ │
│ │ Colours      │ │                        [Reset section] │ │
│ │ Data         │ └───────────────────────────────────────┘ │
│ └──────────────┘                                           │
└────────────────────────────────────────────────────────────┘
```

- Kategorien = APG **Tabs vertikal** (`role="tablist" aria-orientation="vertical"`, ↑/↓/Pos1/Ende, roving
  tabindex), rechts `role="tabpanel"`. Fokus: Suche (Autofokus) → Tablist → Panel → Schließen; Fokusfalle und
  Rückgabe über `Modal`.
- Suche filtert über **alle** Kategorien (Label, Beschreibung, Werte, Schlüsselwörter der aktuellen Sprache) und
  zeigt die Treffer gruppiert; `aria-live` meldet die Trefferzahl.
- Jede Einstellung wirkt sofort; „Start-Ordner“ zeigt „wirkt beim nächsten Start“. Je Bereich „Zurücksetzen“.
- Tastatur: Anzahl Kürzel-Konflikte (gleiches Kürzel für zwei Aktionen) mit Liste, „Kürzel bearbeiten…“
  (vorhandener Dialog 002), „Alle Kürzel zurücksetzen“. Tools: Datei öffnen (011), neu laden. Farben: aktuelles
  Schema, „Farbschemata…“ (013). Daten: Export, Import (mit Teil-Auswahl), alles zurücksetzen, Warnungen beim Laden.
- Ein Dialog zur Zeit (DialogService): „Kürzel bearbeiten…“ ersetzt den Einstellungsdialog.

### E7 – About-Dialog ✅

`OPEN_ABOUT_DLG` (bisher „kommt mit 015“): Name, Version (`package.json`), Lizenzhinweis GuiExpert Table, Links
als Text. Klein, mit übersetzten Texten. `OPEN_BUTTON_CONFIG_DLG` (Button-Editor als Override) → „Offen“.

## 3. Verträge

```rust
// settings.rs (rein, getestet); Commands in commands.rs
pub struct LoadedSettings { settings: Map<String, Value>, warnings: Vec<SettingsWarning>, persist: bool }
pub struct SettingsWarning { code: String /* broken|unreadable|newer_version|invalid_value|unknown_dropped */,
                             key: Option<String>, path: Option<String> }
#[command] load_settings() -> LoadedSettings
#[command] save_settings(settings: Map) -> Result<Vec<SettingsWarning>, FsError>   // sanitized, atomar
#[command] export_settings(dir: String) -> Result<String /*Pfad*/, FsError>
#[command] import_settings(path: String, parts: Vec<String>) -> Result<ImportReport, FsError>
pub struct ImportReport { imported: Vec<String>, warnings: Vec<SettingsWarning> }
```

Fehlercodes: vorhandene (`io`, `not_found`, `already_exists`, `invalid_path`) + neu **`invalid_settings`** (Datei ist
kein Settings-Export / zu groß / falsches Format) – in `error.rs`, `fs.models.ts`, `fs-error.ts`, beiden Katalogen.

```ts
export abstract class SettingsApi {
  load(): Promise<LoadedSettings>; save(values: SettingsValues): Promise<SettingsWarning[]>;
  exportAll(dir: string): Promise<string>; importAll(path: string, parts: SettingsPart[]): Promise<ImportReport>;
}
```

Kürzel: `OPEN_SETUP_DLG` = `Mod+,` (vorhanden, 014). Keine neuen Aktionen außer Handlern für `OPEN_SETUP_DLG` und
`OPEN_ABOUT_DLG`.

## 4. Tests

| Ebene | Fälle |
|---|---|
| Rust `settings.rs` | Round-Trip (Unicode-Pfad), nur Abweichungen, unbekannte Schlüssel bleiben, ungültige Werte → Default + Warnung je Schlüssel, Größenlimits, kaputte Datei → Defaults + `.bad` + Warnung, fehlende Datei → Defaults ohne Warnung, neuere Version → `persist: false`, Schema-Defaults sind gültig; Export/Import: Bundle-Form, nicht überschreiben, zu groß/kein Export → `invalid_settings`, Teil-Auswahl, Tools nur gewählt |
| TS `i18n` | Proxy folgt dem Signal, Fallback Englisch, `systemLanguage()`; **Vollständigkeit aller Kataloge** (Schlüssel, Signaturen, keine leeren/unübersetzten Texte), Aktions- und Token-Labels |
| TS `settings` | Store: Defaults, `set`/`reset` je Bereich, Entprellen, nur Abweichungen, Validierung gegen Schema, Warnungen → Meldung; Dialog: Kategorien per Tastatur, Suche, sofortige Wirkung, Zurücksetzen |
| TS Wirkung | `formatSize` (binär/dezimal/Bytes, Locale), `formatModified` (iso/locale), Namen mit `[ ]`/ohne Endung, Löschen-Default, Doppelklick, Leertaste |
| E2E | Dialog mit Mod+, ; Sprache umschalten (Liste, Menüleiste, Dialoge), Größen/Datum/Dichte sofort; Neustart erhält; kaputte `settings.json` → Start + Warnung + `.bad`; Export/Import |

## 5. Annahmen

- A1: Favoriten bleiben in `session.json` (004/003) und gehören nicht zum Export.
- A2: Theme-Auswahl bleibt in `themes.json` (E1).
- A3: `view.showHidden` gilt für neue Tabs – vorhandene Tabs behalten ihren Schalter (Strg+H).
- A4: Sprachen nur `en`/`de`; weitere Sprachen = weitere `*.xx.ts`-Dateien + Eintrag in `LANGUAGES`.
- A5: Rust-Warnungen beim Laden der **anderen** Dateien (keymap, themes, tools) bleiben englische Sätze – sie
  sind selten und technisch; nur die neuen Settings-Warnungen kommen als Codes.
- A6: Die nativen GTK/macOS-Standardeinträge (Bearbeiten → Ausschneiden … unter macOS) übersetzt das OS bzw. Tauri
  nicht für uns; unsere eigenen Labels schon.

## 6. Review (separater Agent) – Ergebnis

| # | Befund | Bewertung | Umsetzung |
|---|---|---|---|
| 1 | `ROW_HEIGHTS.normal = 24`, main baut die Liste seit dem Merge mit 30 px | hoch | ✅ 24/30/34 px, Spec `normal === ROW_HEIGHT` |
| 2 | `createFileTable` las Kataloge im `computed`: Sprachwechsel baute die Tabelle neu (englisch, Breiten weg); Titel/Dichte nicht angewendet, wenn die Einstellungen vor `tableReady` kamen | hoch | ✅ untracked + Anwenden in `onTableReady`, roter Test zuerst (auch im E2E gefunden) |
| 3 | Beenden (Menü, Jobs-Dialog) und Verbergen schreiben die Einstellungen nicht sofort | mittel | ✅ `settings.flush()` dort |
| 4 | Import: IO-Fehler eines späteren Teils bricht nach schon geschriebenen Teilen ab | mittel | ✅ Warnung `part_failed` (Teil + Datei), Rest läuft weiter (Rust-Test) |
| 5 | Viele Meldungen zeigen die englische Rust-`message` | mittel | ✅ `errorText()` (Drag, Multi-Rename, Tools, Multi-MkDir, Jobs, Suche, Duplikate); „zu viele Tabs“ im Katalog. Theme-Dialog: Rust-Meldungen laufen über das Phrasebook |
| 6 | Tests zur Wirkung fehlen (Papierkorb, Bestätigung …) | mittel | ✅ `ops.spec.ts` (Papierkorb aus, ohne Bestätigung, nie bei Gefahr); Leertaste/Start-Ordner/Netzlaufwerke nur E2E bzw. offen |
| 7 | `search.recent` über 64 KiB wird still komplett verworfen | niedrig–mittel | ✅ älteste Formulare fallen weg (Test) |
| 8 | Import-Rennen mit dem entprellten Speichern | niedrig | ✅ `load()` verwirft einen ausstehenden Save (Test) |
| 9 | Ladefehler erscheint als „konnte nicht gespeichert werden“, Datei würde überschrieben | niedrig | ✅ Warnung `unreadable`, `persist = false` (Test) |
| 10 | Export benennt eine kaputte Datei als Nebenwirkung in `.bad` um | niedrig | – so wie beim Start; bewusst gelassen |
| 11 | Bundle-Version `as u32` | niedrig | ✅ `u64::from` (Test) |
| 12 | Import-Warnungen außer `part_skipped` nicht angezeigt | niedrig | ✅ alle Warnungen (Spec) |
| 13 | „1 Dateien“ | niedrig | ✅ Singular |
| 14 | `loadingText` folgt keinem Sprachwechsel | niedrig | `TODO(guiexpert)` (Overlay-Texte nur beim Erzeugen) |
| 15 | Tab-Panel ohne `tabindex="0"` | niedrig | ✅ |
| 16 | Kommentar an falscher Stelle (`find-form.ts`) | niedrig | ✅ |

## 7. Abweichungen bei der Umsetzung

- (013 A2) Theme-Auswahl zieht nicht nach `settings.json` um (E1).
- Merge mit 016/017/019: der About-Dialog aus 017 bleibt (E7 entfällt), seine Texte sind übersetzt; Kataloge für
  Archive, Duplikate, About; Zeilenhöhen folgen main (normal 30 px). `settings-dialog.scss` → `.css` (SCSS auf main
  durch CSS ersetzt).
- E2E (Linux, Xvfb): Menütitel wurden beim Laden des Moduls gelesen (blieben englisch) → Getter; eine neue
  Zeilenhöhe schnitt die letzte Zeile ab → `recalcHeightAndPadding` + `recalcWrappers`.

## 8. Fortschritt

- [x] Phase 1 Design
- [x] Phase 2 Rust (`settings.json`, Schema, sanitize, Export/Import-Bündel)
- [x] Phase 3 Frontend (Settings-Store, Dialog, Laufzeit-i18n de/en, Specs) – Stand 2026-10-18: `pnpm check` grün;
  nicht gemergt, weil Review und E2E fehlen (Arbeit wegen Nutzungslimit unterbrochen)
- [x] Phase 4 E2E (2026-10-19, Linux/Xvfb): `Strg+,` öffnet den Dialog; Sprache Englisch ↔ Deutsch ohne Neustart
  (Liste, Spaltentitel, Menüleiste, Button-Leiste, Dialog); Neustart startet deutsch mit den Tabs; Größen Bytes /
  dezimal, Datum ISO, Zeilenhöhe 34 px, `[Ordner]`, Namen ohne Endung sofort; kaputte `settings.json` → Start mit
  Defaults, Hinweis, `settings.json.bad`; Export in den Ordner der Seite, Import mit Teil-Auswahl und Warnung
  „ungültiger Wert“. Nicht geprüft: macOS-App-Menü „Einstellungen…“, Windows.
- [x] Phase 5 Doku (README, architecture, roadmap, feature-parity, prompts/README, CLAUDE.md)
- [x] Phase 6 Abschluss: Review eingearbeitet, `pnpm check` grün, nach `main` gemergt

## 9. Offen

- Button-Konfiguration als Override (`OPEN_BUTTON_CONFIG_DLG`), Dateitypen/Suchvorlagen/Prompts-Editor (mr).
- Spaltenauswahl (ein-/ausblenden, Reihenfolge) als Einstellung.
- Dialog-Optionen 008 (Gruppieren/Aufräumen/Multi-MkDir) und Viewer-Umbruch 010 dauerhaft (Typ `json` ist da).
- Weitere Sprachen.
