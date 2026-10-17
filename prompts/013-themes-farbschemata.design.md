# Design 013: Themes und Farbschemata

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) – alle Empfehlungen übernommen ·
> **Datum:** 2026-10-18 · **Branch:** `feat/themes-farbschemata` (von `main`, 001–010 fertig)
> **Grundlage:** Prompt 013, legacy §8 (32 Variablen) und §3 (Color-Config ohne Speichern), mr §8 (76 `--fnf-*`,
> kein Hell/Dunkel-Flag), `docs/legacy-themes/` + Prompt 019 (die acht Designs bauen auf diesem Format auf).
> **Phasen:** alle sechs; Rust nur für die Datei (`themes.json`, Import/Export).

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| Tokens `src/styles.scss` | ~45 Farb-Tokens, light in `:root`, dark per `@media (prefers-color-scheme)` | **Quelle** bleibt; Liste/Kopf/Fußleiste/Dialog/Scrollbar/Tooltip bekommen eigene Tokens (§3) |
| Brücke `src/styles/ge-table-theme.scss` | `--ge-table-*` auf `.ge-table` → unsere Tokens; Zeilenklassen `fnf-cursor/marked/hidden/unreadable` | **erweitern**: Listen-Tokens, aktives Panel, `fnf-symlink`, markiert-Hintergrund |
| GuiExpert Table | `html, html[data-theme=light]` + `html[data-theme=dark]` Default-Variablen (in den Komponenten-Styles) | `data-theme` setzen wir passend zu `dark` – Variablen, die wir nicht mappen (Editor, Overlay-Inhalt), folgen dann |
| Aktion `OPEN_THEMES_DLG` | Katalog „kommt in 013“, 🎨 in der Button-Leiste | **Handler** (Dialog); 🎨 wird Menü (mr) |
| Dateien `keymap.rs`, `rename_presets.rs`, `fs_atomic.rs` | Muster: atomar, kaputt → `.bad`, Lesefehler → nicht überschreiben | **übernehmen** für `themes.rs` |
| Einstellungen (015) | gibt es noch nicht | Auswahl im Theme-Dialog + Menü + Palette; 015 bindet den Dialog ein |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Ein Schema = `{ id, name, dark, tokens }`, Werte als CSS-Strings, `var(--token)`-Verweise erlaubt ✅

- `tokens` ist eine Map `--token-name → Wert` (Farbe, `var(--anderes-token)`, bei wenigen Tokens Länge/Schatten/Font).
  Fehlende Tokens füllt die App aus dem eingebauten Schema mit gleichem `dark` (`light`/`dark`) – neue Tokens in
  späteren Versionen brechen also keine gespeicherten Schemata. **Unbekannte Tokens bleiben erhalten** (werden
  gesetzt, im Editor unter „Weitere“) – Prompt 019 kann alte `--fnf-*`-Dateien damit verlustfrei importieren.
- `dark: boolean` (mr hatte keines) steuert `color-scheme` (native Controls, Scrollbars), `html[data-theme]` der
  GuiExpert Table und welches eingebaute Schema Lücken füllt.
- Eingebaut: `light`, `dark` als JSON (`core/theme/themes/*.json`) – **dieselben Werte** wie `styles.scss`
  (`:root` bzw. `@media dark`); ein Test vergleicht beide, damit `styles.scss` die lesbare Quelle bleibt und der
  erste Frame vor dem Laden schon stimmt. Prompt 019 legt die acht Designs als weitere eingebaute JSONs daneben.
- Anwenden: `document.documentElement.style.setProperty` für jedes Token (wie legacy/mr), dazu `data-theme`,
  `style.colorScheme`, `<meta name="theme-color">`. Werte werden vorher geprüft (E5).

### E2 – Token-Katalog in Gruppen (passt auf die 76 `--fnf-*` von 019) ✅

Ein Katalog `core/theme/tokens.ts` (Name, Gruppe, Art `color|length|font|shadow`, Bezeichnung) ist die eine Stelle
für Editor, Prüfung und Vollständigkeitstest. Gruppen: **Allgemein, Liste, Aktives Panel, Kopf, Fußleiste, Dialoge,
Scrollbar, Tooltip** (Tabelle §3). Schriftgröße/-art der Liste sind Tokens (`--font-size-list`, `--font-list`);
die **Zeilenhöhe** ist bei der GuiExpert Table eine JS-Option (`defaultRowHeights`) – sie kommt als Einstellung
„kompakt/normal“ mit Prompt 015 (neues Tabellen-Modell), nicht als CSS-Token (Annahme A3).

### E3 – Auswahl: „System folgen“ (Default) oder festes Schema; Wechsel live ✅

`selection = { mode: 'system' | 'fixed', theme, light, dark }`. „System folgen“ nimmt `light`-/`dark`-Schema je nach
`prefers-color-scheme` (Listener, live); die beiden Zuordnungen sind im Dialog wählbar (019: `light`/`coffee`).
Wählen: Theme-Dialog (Liste), 🎨-Menü in der Button-Leiste (mr: „System folgen“, eigene zuerst, dann eingebaute,
„Farbschemata bearbeiten…“), Befehlspalette (Einträge „Theme: <Name>“), Aktion `NEXT_THEME` (nächstes Schema).
mr hatte `Strg+⌘+Alt+F1…F8` je Schema – das ist an Positionen gebunden und kollidiert mit Fensterverwaltungen; statt
acht Positions-Aktionen eine Aktion „nächstes Schema“ (`Mod+Ctrl+Alt+T` macOS, `Ctrl+Alt+Shift+T` sonst).

### E4 – Speicherung: eigene Datei `themes.json` im App-Config-Verzeichnis (Rust, ohne Plugin) ✅

Wie `rename-presets.json`: Version 1, Rust prüft nur Form und Größe (≤ 50 Schemata, ≤ 300 Tokens, Id `[a-z0-9-]`,
Name ≤ 100 Zeichen, Wert ≤ 200 Zeichen ohne `; { } < > \` und ohne `url(`/`expression(`/`@import`), atomar
schreiben, kaputt → `.bad` + Hinweis, Lesefehler → nicht überschreiben. Die Datei hält eigene Schemata **und** die
Auswahl (bis 015 eine Einstellungsdatei bringt; dann zieht nur `selection` um).

### E5 – Import/Export über Dateien im Dateimanager, nicht über Dateidialoge ✅

Kein `tauri-plugin-dialog` (breite Fähigkeit). Stattdessen dateimanagertypisch:
- **Export** schreibt `<Name>.theme.json` in den Ordner des aktiven Panels (`export_theme(dir, name, theme)`; Rust
  prüft Namen mit `validate_name`, schreibt `create_new`, bei Namensgleichheit `<Name> (2).theme.json` …) und meldet
  den Pfad; das Panel lädt neu.
- **Import** liest die Datei unter dem Cursor des aktiven Panels (`import_theme(path)`, ≤ 256 KiB, muss JSON sein) –
  Formate: unseres (`{name, dark, tokens}`) und das alte (`{name, colors}` – Werte unverändert übernommen, `dark`
  aus der Helligkeit des Hintergrunds geschätzt; die Zuordnung `--fnf-*` → Tokens macht 019).
- Das Frontend normalisiert und prüft (gleiche Regeln wie Rust); verworfene Werte werden gemeldet.

### E6 – Live-Editor im Theme-Dialog ✅

Links Liste der Schemata (Radiogruppe, eingebaute zuerst? – mr: **eigene zuerst**), rechts die Tokens je Gruppe:
`<input type="color">` (nur bei auflösbarer, deckender Farbe) + Textfeld, Vorschau sofort (Override auf `:root`),
Kontrast-Hinweis je Paar (E7). Knöpfe: **Speichern** (eigenes Schema) / **Speichern als…** (Kopie, auch von
eingebauten), **Löschen**, **Zurücksetzen** (Änderungen verwerfen), **Importieren**, **Exportieren**. Esc/Schließen
ohne Speichern verwirft die Vorschau. Eingebaute Schemata sind schreibgeschützt (Bearbeiten → „Speichern als…“).

### E7 – Kontrastprüfung (WCAG 2.x) als reine Logik + Test über alle mitgelieferten Schemata ✅

`color.ts` (Parser für Hex 3/4/6/8, `rgb()/rgba()`, einfache Namen, `transparent`; Alpha wird auf den Hintergrund
gemischt), `contrast.ts` mit den Paaren (Text ≥ 4,5:1, Fokus/Akzentlinie ≥ 3:1): Liste, Cursor aktiv/inaktiv,
markiert, markiert + Cursor, versteckt, Symlink, Fehler, Kopf, Tabs, Fußleiste, Kürzel-Badge, Dialog, Eingabe,
Buttons, Fehlerpanel, Tooltip, Suchtreffer. Test: alle eingebauten Schemata bestehen. Der Editor zeigt ⚠ mit dem
Verhältnis an verletzten Paaren (Hinweis, kein Speicherverbot).

## 3. Token-Modell

Neu (★) bzw. bestehend; Default im eingebauten Schema meist `var(<Basis>)`.

| Gruppe | Tokens | alt legacy §8 (32) | alt mr/019 (`--fnf-`) |
|---|---|---|---|
| Allgemein | `--color-bg`, `-surface`, `-surface-raised`, `-text`, `-muted`, `-border`, `-accent`, `-accent-text`, `-focus`, `-selection`, `-selection-text`, `-danger`, `-danger-bg`, `-danger-text`, `-favorite`, `-search-hit`, `-splitter-active`, `-backdrop`, `--shadow-popup` | `primary-background-color` → bg/surface, `primary-color` → text, `secondary-muted-color`, `item-muted-color` → muted, `header-fav-star-selected-color` → favorite, `dropdown-focussed-background-color` → selection | `material-primary` → accent, `material-warn` → danger, `error-panel-bg/fg` → danger-bg/-text, `material-secondary/accent/unthemed` → Akzent (019 entscheidet) |
| Liste | ★`--color-list-bg`, ★`-list-text`, ★`-list-border`, ★`-list-header-bg`, ★`-list-header-text`, `-row-hover`, `-cursor-bg`, `-cursor-text`, `-cursor-inactive-bg`, ★`-cursor-inactive-text`, `-marked`, ★`-marked-bg`, `-cursor-marked-text`, ★`-hidden-text`, ★`-symlink-text`, ★`-error-text`, ★`--font-size-list`, ★`--font-list` | `cursor-row-background-color/-color` → cursor-bg/-text, `item-selected-color` → marked | `table-bg/fg/border`, `table-header-bg/fg`, `table-hover-row-bg`, `table-focused-row-bg/fg` → cursor, `table-selected-row-bg/fg` → marked(-bg), `table-font-size` |
| Aktives Panel | ★`--color-active-list-bg`, ★`-active-list-text`, ★`-active-list-header-bg`, ★`-active-marked`, ★`-active-marked-bg`, `-active-panel-accent`, ★`-active-header-bg`, `-active-panel-tab-bg`, `-active-panel-tab-text` | – | `activepanel-table-*`, `activepanel-header-bg/border`, `activepanel-header-selected-tab-bg/fg` |
| Kopf | `--color-header-bg`, ★`-header-text`, ★`-header-border`, ★`-header-input-bg`, ★`-header-input-text`, ★`-header-input-border`, ★`-tab-text`, `-tab-selected-bg`, ★`-tab-selected-text` | `header-link-*`, `nav-tabs-border-color` | `header-bg/fg/border`, `header-input-*`, `header-selected-tab-bg/fg` |
| Fußleiste | `--color-footer-bg`, ★`-footer-text`, ★`-footer-border`, ★`-footer-button-bg`, ★`-footer-button-text`, ★`-footer-button-border`, `-shortcut-bg`, `-shortcut-text`, ★`-footer-error-text` | `footer-primary-*`, `footer-filecount-*`, `footer-btn-secondary-*` | `footer-bg/fg`, `footer-button-*`, `footer-shortcut-*`, `footer-error-fg` |
| Dialoge | ★`--color-dialog-bg`, ★`-dialog-text`, ★`-dialog-border`, ★`-input-bg`, ★`-input-text`, ★`-input-border`, ★`-button-bg`, ★`-button-text`, ★`-button-border`, ★`-button-primary-bg`, ★`-button-primary-text` | `secondary-background-color`, `button-secondary-background-color` | `dialog-primary/secondary-*`, `dialog-input-*`, `dialog-button-primary-*`, übrige `dialog-button-*` → Akzent (019) |
| Scrollbar | ★`--color-scrollbar-track`, ★`-scrollbar-thumb`, ★`-scrollbar-thumb-border`, ★`-scrollbar-thumb-active` | `scrollbar-*` (4) | `scrollbar-*` (4) |
| Tooltip | ★`--color-tooltip-bg`, ★`-tooltip-text`, ★`-tooltip-input-bg`, ★`-tooltip-input-text` | `tooltip-*` (4) | `tooltip-*` (4) |

Panel-Statuszeile = Fußleiste (Hintergrund/Text), Button-Leiste = Fußleiste + `footer-button-*`. Tooltip-Tokens
sind gesetzt und im Editor; die App nutzt heute nur native `title`-Tooltips (nicht stylbar) – eigene Tooltips
kommen mit 014.

**GuiExpert-Brücke** (`ge-table-theme.scss`, einzige Stelle mit `--ge-table-*`): `bg/body-*-bg` → `list-bg`,
`body-*-text` → `list-text`, `header-*-bg/text` → `list-header-*`, `border`/`*-border` → `list-border`,
`hover-row-bg` → `row-hover`, `cell-editor-*` → `input-*`/`focus`, `overlay-*`/`spinner` → muted/accent;
im aktiven Panel (`.fnf-active-panel .ge-table`) die `active-*`-Tokens. Zeilenklassen: `fnf-cursor`
(inaktiv/aktiv), `fnf-marked` (+ `-bg`), `fnf-cursor.fnf-marked`, `fnf-hidden`, `fnf-symlink`, `fnf-unreadable`.

## 4. Verträge

### Rust (`themes.rs`, Commands in `commands.rs`)

```rust
pub struct ThemesFile { version: u32 /*1*/, selection: Selection, themes: Vec<UserTheme> }
pub struct Selection { mode: String /*"system"|"fixed"*/, theme: String, light: String, dark: String }
pub struct UserTheme { id: String, name: String, dark: bool, tokens: BTreeMap<String, String> }
pub struct LoadedThemes { file: ThemesFile, warning: Option<String> }    // + persist (skip)

#[command] load_themes() -> LoadedThemes                        // fehlend → Default, kaputt → .bad + warning
#[command] save_themes(file: ThemesFile) -> ()                   // bound(), atomar; blockiert nach Lesefehler
#[command] import_theme(path: String) -> serde_json::Value       // Datei ≤ 256 KiB, JSON-Objekt
#[command] export_theme(dir: String, name: String, theme: Value) -> String  // geschriebener Pfad
```

Fehler: `not_found`, `not_a_file`, `not_a_directory`, `invalid_name`, `invalid_path` (zu groß/kein JSON), `io`.

### TypeScript (`core/theme/`)

```ts
interface Theme { id: string; name: string; dark: boolean; tokens: Record<string, string>; builtIn?: boolean }
interface ThemeSelection { mode: 'system' | 'fixed'; theme: string; light: string; dark: string }
interface ThemesFile { version: 1; selection: ThemeSelection; themes: Theme[] }
abstract class ThemeApi { load(); save(file); importFile(path): Promise<unknown>; exportFile(dir, name, theme): Promise<string> }
ThemeService (root): themes(), selection(), active(), systemDark(), select(id|'system'), next(), preview(tokens|null),
  saveTheme(theme), deleteTheme(id), importFrom(path), exportTo(dir, id)
```

## 5. UI-Skizze (Theme-Dialog, `role="dialog"`)

```
┌ Farbschemata ───────────────────────────────────────────────────────────┐
│ ( ) System folgen  hell: [light ▾]  dunkel: [dark ▾]                     │
│ ┌ Schemata (radiogroup) ┐ ┌ Name [Mein Schema   ]  [x] dunkel ─────────┐ │
│ │ ● Mein Schema         │ │ ▸ Allgemein                                │ │
│ │ ○ light (eingebaut)   │ │   Text  [■] [#1d2027 ]                      │ │
│ │ ○ dark  (eingebaut)   │ │ ▸ Liste      ⚠ Cursor 3.9:1 (min 4.5)       │ │
│ └───────────────────────┘ │   …                                         │ │
│                           └─────────────────────────────────────────────┘ │
│ [Importieren] [Exportieren]   [Löschen] [Zurücksetzen] [Speichern als…] [Speichern] [Schließen] │
└──────────────────────────────────────────────────────────────────────────┘
```

Fokus: Modus → Schema-Liste (↑/↓ wählt = Vorschau, APG radiogroup) → Name/dunkel → Token-Felder → Knöpfe.
Kontrast-Warnungen als Text (`role="status"`-Zusammenfassung), nicht nur Farbe.

## 6. Tests

- **Rust** (`themes::tests`): Round-Trip (Umlaute, Leerzeichen im Pfad), fehlend/kaputt/Version → `.bad`,
  Lesefehler → nicht überschreiben, `bound` (Limits, Id-Muster, Dubletten, gefährliche Werte), Import (zu groß,
  kein JSON, Ordner), Export (Name prüfen, kein Überschreiben → `(2)`).
- **Frontend**: `color.spec` (Parser, Kontrast bekannter Paare), `theme-logic.spec` (Verweise auflösen, Zyklen,
  normalisieren alter/neuer Formate, Werte-Filter), `builtin-themes.spec` (**alle eingebauten Schemata bestehen die
  Kontrastprüfung**, Vollständigkeit gegen Katalog, `styles.scss` = `light.json`/`dark.json`), `theme.service.spec`
  (System folgen live, Auswahl speichern/laden, Fallback bei fehlender Id, Vorschau/Zurücksetzen, Import/Export
  über `FakeThemeApi`), Dialog-Komponente (Zustände, Kontrast-Hinweis), Palette-Einträge.
- **E2E**: light/dark/System, eigenes Schema speichern → Neustart → aktiv, Export/Import, Table folgt.

## 7. Annahmen

- A1: Default beim ersten Start „System folgen“ (`light`/`dark`); 019 ändert ggf. auf `light` fest.
- A2: Die Auswahl liegt bis 015 in `themes.json`, nicht in der Sitzung (gehört zu den Einstellungen, nicht zum
  Fensterzustand).
- A3: Zeilenhöhe/Dichte kommt mit 015 als Tabellen-Option; Schriftgröße/-art sind schon Tokens.
- A4: Import liest die Datei **unter dem Cursor** (dateimanagertypisch, kein Datei-Öffnen-Dialog); Export schreibt in
  den Ordner des aktiven Panels.

## 8. Abweichungen bei der Umsetzung

(siehe Fortschritt)

## 9. Review

**Selbstprüfung:** (Phase 6)

### Review (separater Agent) – Ergebnis

| # | Fund | Stand |
|---|---|---|

## 10. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [ ] Phase 2 Rust
- [ ] Phase 3 Frontend
- [ ] Phase 4 E2E
- [ ] Phase 5 Doku

## 11. Offen

- Zeilenhöhe/Dichte (015), eigene Tooltips (014), die acht alten Designs + `--fnf-*`-Abbildung (019).
