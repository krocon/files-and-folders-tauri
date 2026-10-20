# Design 022: Konfigurations-Editoren – Buttons, Dateitypen, Suchvorlagen, Vollbild

> Status: **in Arbeit** · Branch `feat/konfig-editoren` · Prompt: [022-konfig-editoren.md](022-konfig-editoren.md)
> · Marc hat am 20.10.2026 Umfang und Ablauf festgelegt (ohne Haltepunkt nach Phase 1) – die Entscheidungen stehen hier.

## 1. Bestand → wofür → passt/fehlt

| Baustein | wofür | Stand |
|---|---|---|
| `button-bar/buttons.json`, `button-config.ts` (`BUTTON_SETS`, `modifierSet`) | eingebaute Sätze, Satzwahl | passt als Standard; `BUTTON_SETS` wird zu „eingebaut“, die Leiste liest den Store |
| `OPEN_BUTTON_CONFIG_DLG` im Katalog (`m(…,'022')`), Menü Werkzeuge | Einstieg | fehlt: Handler, Dialog |
| `core/file-icon/file-icon.service.ts` `FILE_CATEGORIES`, `CATEGORY_DEFAULT_ICONS`, `CATEGORY_COLOR_GROUPS` | Icons + Icon-Farben der Liste | muss erweitert werden: Kategorien aus einem Store, Icon/Farbe je Kategorie im Modell |
| `file-renderers.ts` (`iconNameForEntry`, `iconColorGroupForEntry`), `file-list.ts` (Repaint bei `DISPLAY`) | Renderer ohne Injection | passt – liest künftig ein Modul-Signal wie `DISPLAY` |
| `actions/pattern.ts` `PATTERN_PRESETS` (Markier-Dialog) | Markieren nach Typ | wird aus den Dateitypen gebildet (mr: Selection-Dialog nutzte `filetype`) |
| `search/search-presets.json`, `SearchStore.templates` (Speicher), `search.recent` (settings) | Suchvorlagen | eigene Vorlagen nur Sitzung, kein Löschen im UI → dauerhaft + Löschen |
| `keymap.rs`, `rename_presets.rs`, `fs_atomic.rs` | Muster Konfig-Datei | Muster; ein gemeinsamer Lader spart Dopplung |
| `settings.rs` Bündel (`PARTS`, `ConfigFiles`, `import`) | Export/Import | erweitern um `buttons`, `fileTypes` |
| `commands.rs` (`*_State.write_blocked`), `command_rules` | Commands | neue Datei `commands/config.rs` (in `SOURCES`) |
| `menu-model.ts` (Fenster-Menü `{native:'fullscreen'}` nur macOS) | Vollbild | fehlt unter Windows/Linux (J14) |
| `MenuApi` (`close_main_window`) | Fenster-Commands | erweitert um `toggleFullscreen()` |
| Einstellungsdialog (Abschnitte, `SETTINGS_PARTS`, `reload`) | Einstiege, Import | erweitern: Abschnitt „Buttons & Dateitypen“, zwei Teile |
| mr `config/{button,filetype}` (Monaco-JSON), `fnf-api` `button|filetype|search/{defaults,custom}/data.json` | Vorbild | Formate übernommen/lesbar, Editor strukturiert statt JSON |

## 2. Entscheidungen

**E1 `buttons.json` überschreibt je Satz.** Datei im App-Konfig-Ordner:
`{ "version": 1, "sets": { "shift": ["OPEN_CREATE_FILE_DLG", …] } }`. Ein Satz, der in `sets` steht, ersetzt den
eingebauten Satz ganz; fehlende Sätze bleiben eingebaut (so kommen spätere Änderungen der eingebauten Leiste beim
Nutzer an). Rust (`buttons.rs`) prüft nur Form und Größe: bekannte Satznamen (`default|shift|ctrl|alt|cmd`), Id-Form
`[A-Z][A-Z0-9_]{0,63}`, je Satz höchstens **10** Slots (`MAX_SLOTS`), doppelte Ids im Satz fallen weg (erste gewinnt),
leere Sätze sind erlaubt (= keine Buttons mit diesem Modifier). Version ≠ 1 oder kaputtes JSON → Datei wird
`buttons.json.bad`, Standardleiste (Muster `keymap.rs`). Das Frontend kennt den Katalog: unbekannte Ids verwirft
`resolveButtonSets` und meldet sie einmal beim Laden (`ActionService.report`) und im Dialog. Für 026: das mr-Format
`{default,shift,cmd,alt}` ist genau der Inhalt von `sets`.

**E2 Ein gemeinsamer Lader** `config_file.rs`: `read_config(file, max_bytes, parse) → Loaded<T>` mit Warnung als
**Code** (`broken` + Pfad der `.bad`-Datei bzw. ohne Pfad, wenn das Beiseitelegen scheiterte; `unreadable`) – das
Frontend übersetzt (015-Regel „Fehler/Hinweise aus Katalogen“). `persist: false`, wenn eine kaputte Datei liegen
blieb oder nicht lesbar war → Speichern verweigert (`write_blocked` je Datei, wie Keymap/Presets). `keymap.rs` und
`rename_presets.rs` bleiben unverändert (kein Umbau fremder Dateien in diesem Prompt).

**E3 Button-Dialog (strukturiert, kein JSON).**
```
┌ Button configuration ───────────────────────────────────────────────┐
│ [Without modifier] [Shift] [Ctrl|⌘] [Alt]        ← tablist (APG Tabs)│
│ Preview: [F4 Edit] [F5 Copy] [F6 Move] [F7 Folder] [F8 Delete]       │
│ ┌ Buttons (listbox) ───────────┐  [Move up] [Move down] [Remove]     │
│ │ 1  Edit                (F4)  │                                     │
│ │ 2  Copy…               (F5)  │  Add/replace: [combobox  ▾]         │
│ └──────────────────────────────┘  [Add] [Replace]                    │
│ Notice: unknown ids dropped …                                        │
│ [Reset this set] [Reset all]                    [Cancel] [Save]      │
└──────────────────────────────────────────────────────────────────────┘
```
Gezeigt werden die vier Sätze, die auf dieser Plattform vorkommen (`cmd` auf macOS, sonst `ctrl`; der andere bleibt
in der Datei unangetastet). Fokusfolge: Tabs → Liste → Verschieben/Entfernen → Combobox → Hinzufügen/Ersetzen →
Reset → Abbrechen/Speichern. Liste: `role="listbox"` mit `aria-activedescendant`, ↑/↓/Home/End wählen,
Alt+↑/↓ verschiebt, Entf entfernt. Combobox nach APG (wie die Befehlspalette): Eingabe filtert per `fuzzyMatch`
über Label **und** Id, ↑/↓ + Enter wählt, Esc schließt erst die Vorschlagsliste (stoppt die Propagation, damit der
Modal nicht schließt). Angeboten werden alle Katalog-Aktionen mit Handler-Status egal (Buttons ohne Handler sind
gedimmt wie heute). Arbeitsstand ist ein Entwurf im Dialog; **Speichern** schreibt die Datei, die Leiste übernimmt
sofort (Root-Store-Signal). Ein Satz gleich dem eingebauten wird beim Speichern aus `sets` entfernt (Datei bleibt
minimal). „Satz zurücksetzen“/„Alle zurücksetzen“ setzen den Entwurf auf eingebaut (wirksam mit Speichern).
Obergrenze 10 Slots: Hinzufügen ist dann deaktiviert.

**E4 `filetypes.json` ersetzt die eingebauten Kategorien ganz.**
`{ "version": 1, "categories": [{ "label": "Comics", "extensions": [".cbz"], "icon": "fa-book", "color": "document" }] }`.
Gelesen wird auch das mr-Format (nacktes Array `[{label, extensions}]`, Version implizit 1). Rust (`filetypes.rs`):
≤ 100 Kategorien, Label getrimmt 1–64 Zeichen, eindeutig ohne Groß/Klein (erste gewinnt), ≤ 200 Endungen je
Kategorie; Endung normalisiert (trim, klein, führender Punkt), 2–33 Zeichen, ohne Leerraum, `/ \ * ? :`, doppelte
fallen weg; Icon nur `fa-[a-z0-9-]{1,40}`, Farbe nur eine der acht Gruppen, sonst weg (das Frontend prüft Icon gegen
die feste Liste). Keine Datei → eingebaute Liste `core/file-icon/file-types.json` (die bisherigen 11 mr-Kategorien,
jetzt mit `icon`/`color`). „Zurücksetzen“ = `save_file_types(null)` **löscht** die Nutzerdatei (nur diese feste Datei
im Konfig-Ordner; fehlend ist kein Fehler). Warum ganz ersetzen statt je Kategorie: Umbenennen, Löschen und
Reihenfolge (erste Kategorie gewinnt eine Endung) sind sonst nicht ausdrückbar – mr machte es genauso (custom ersetzt
defaults).

**E5 Renderer lesen ein Modul-Signal.** `FILE_TYPES` (Signal mit Index Endung → Kategorie) in
`file-icon.service.ts`; der Root-`FileTypesStore` setzt es. Die reinen Funktionen (`iconNameForEntry`,
`iconColorGroupForEntry`) bleiben injektionsfrei; `file-list.ts` liest das Signal im Repaint-Effekt wie `DISPLAY`
→ neue Icons erscheinen sofort.

**E6 Icon und Farbe je Kategorie.** Feste Icon-Liste `FILE_TYPE_ICONS` (24 FA-4.5-Namen, geprüft gegen
`font-awesome.css`), Farben = `IconColorGroup` (8) + „keine“. Die feinen Office/PDF-Icons (`fa-file-pdf-o`,
`fa-file-word-o` …) verfeinern nur das generische Dokument-Icon `fa-file-text-o` – wer einer Kategorie ein eigenes
Icon gibt, sieht es auch für `.pdf`. Ohne Icon: `fa-file-o`; ohne Farbe: Textfarbe.

**E7 Wer die Kategorien nutzt.** (a) Icons/Farben der Dateiliste (E5), (b) Markier-Dialog: Vorlagen = die
Kategorien (`*.ext …`) + „Alles“ (mr-Verhalten; ersetzt `PATTERN_PRESETS`). Eingebaute Labels (`movies`, `audio` …)
werden über eine Übersetzungstabelle angezeigt, eigene wörtlich. (c) **Nicht** die Suche: mr hatte dafür eine eigene
Datei (`search/data.json` mit Kombinationen wie „movies & images“); die eingebauten Suchvorlagen bleiben
`search-presets.json`, dazu die eigenen (E8). Gruppieren/Aufräumen nutzen heute keine Kategorien.

**E8 Eigene Suchvorlagen in `settings.json`** (Schlüssel `search.templates`, `json`, ≤ 50 Einträge, ≤ 128 KiB):
dieselbe Ablage wie `search.recent`, also ohne neues Rust-Modul, mit Entprellung, `.bad`-Behandlung und Export/Import
des Teils `settings`. Eintrag `{ label, form }` (`form` = komplettes `FindForm`, beim Lesen wie `search.recent` über
`restoreForm` geprüft). Speichern mit gleichem Namen ersetzt. Löschen: wer eine eigene Vorlage im Auswahlfeld wählt,
bekommt daneben „Vorlage ‚X‘ löschen“. Im Einstellungsdialog (Abschnitt Verhalten) Anzahl + „Alle löschen“. Für 026:
mr-`search/custom/data.json` (`[{label, extensions}]`) wird zu `{label, form: {…DEFAULT_FORM, name: presetGlob(…)}}`.

**E9 Vollbild:** Aktion `TOGGLE_FULLSCREEN` (Ansicht), Command `toggle_fullscreen` in `commands/config.rs`,
`async`, nur Hauptfenster (`MAIN_WINDOW`; fehlt es → `false`), `is_fullscreen` → `set_fullscreen(!x)`, Rückgabe der
neue Zustand. Das ist Rust-Fenster-API, **keine** Capability (`core:window:allow-set-fullscreen` wäre JS-seitig und
breiter). Kürzel: Windows/Linux `F11` (frei; Shift+F11 = Shell, Mod+F11 = Tasks); macOS kein Eintrag – das native
Menü hat ⌃⌘F, ein zweites Kürzel würde doppelt schalten. Menü „Ansicht“ (nur Win/Linux, macOS hat Fenster ▸ Vollbild),
Palette auf allen OS.

**E10 Export/Import:** `PARTS` += `buttons`, `fileTypes`. Bündel enthält die geprüfte Nutzerdatei (Buttons: das
`sets`-Objekt; Dateitypen: die Kategorien oder `null` ohne eigene Datei – wie `tools`). Import schreibt über die
Module (sanitize, atomar), hebt `write_blocked` auf; das Frontend lädt die Stores neu. Ein `null`-Teil wird wie
bisher als `part_skipped` gemeldet.

**E11 Einstiege:** Menü Werkzeuge: „Button-Konfiguration…“ (vorhanden), neu „Dateitypen…“; Einstellungsdialog neuer
Abschnitt „Buttons & Dateitypen“ (Anzahl geänderter Sätze/Kategorien, zwei Knöpfe); Befehlspalette automatisch.
Keine Tastenkürzel für die beiden Dialoge (mr hatte exotische `cmd+ctrl+shift+F4/F5`; selten gebraucht).

**E12 Dateityp-Dialog.**
```
┌ File types ─────────────────────────────────────────────────────────┐
│ ┌ Categories (listbox) ┐  Name        [Comics            ]          │
│ │ 🎬 Movies (7)        │  Extensions  [.cbz .cbr          ] (textarea)│
│ │ 🎵 Audio (7)         │  Icon        [fa-book ▾] 📖                │
│ │ …                    │  Colour      [Document ▾]                  │
│ └──────────────────────┘  Error: name already used                  │
│ [Add] [Remove] [Move up] [Move down]                                 │
│ [Reset to defaults]                            [Cancel] [Save]      │
└──────────────────────────────────────────────────────────────────────┘
```
Endungen als Text (Leerzeichen, Komma, Semikolon oder Zeilen; `*.jpg`, `jpg`, `.JPG` → `.jpg`). Prüfung im Frontend
(Name nötig/eindeutig, ≤ Grenzen) mit `aria-invalid` und Fehlertext; Speichern nur ohne Fehler. Speichern einer
Liste gleich der eingebauten löscht die Nutzerdatei (wie Reset).

**E13 Barrierefreiheit:** beide Dialoge über `app-modal` (Fokusfalle, Esc, Fokus zurück), Listboxen mit
`aria-activedescendant`, Live-Region für „gespeichert“/Hinweise, sichtbarer Fokus über die vorhandenen Tokens.

## 3. Verträge

Rust (alle `async`, Fehler `FsError`):
```rust
load_buttons() -> Loaded<ButtonsOverride>         // { value: { sets: {set: [id]} }, warning: ConfigWarning|null }
save_buttons(sets: BTreeMap<String, Vec<String>>) -> ()   // io / write_blocked → code `io`
load_file_types() -> Loaded<Option<Vec<FileType>>>// value null = keine Nutzerdatei
save_file_types(categories: Option<Vec<FileType>>) -> ()  // None = Nutzerdatei löschen
toggle_fullscreen() -> bool
// ConfigWarning { code: "broken" | "unreadable", path: Option<String> }
// FileType { label, extensions: Vec<String>, icon: Option<String>, color: Option<String> }
```
TS: `core/config/config.models.ts` (DTOs), `core/config/config-api.ts` (`ConfigApi`: `loadButtons`, `saveButtons`,
`loadFileTypes`, `saveFileTypes`), Fake `src/testing/fake-config-api.ts`; `MenuApi.toggleFullscreen()`.
Settings: `search.templates` im Schema (Rust + TS). Bündel-Teile `buttons`, `fileTypes`.

## 4. Tests

- Rust: `config_file` (fehlend, kaputt → `.bad`, Lesefehler, zu groß), `buttons` (Round-Trip mit Unicode-Pfad,
  Grenzen, Satznamen, Id-Form, Duplikate, Version), `filetypes` (Round-Trip, mr-Array, Normalisierung, Grenzen,
  Icon/Farbe, Löschen), `settings` (Bündel mit neuen Teilen, Import), `command_rules` (neue Datei in `SOURCES`).
- Frontend: `button-config-logic.spec` (auflösen + unbekannte Ids, verschieben, ersetzen, Grenze, minimale Sätze),
  `button-config.store.spec` (Laden mit Hinweis, Speichern, Leiste folgt), `button-config-dialog.spec` (Tabs,
  Liste per Tastatur, Combobox), `file-types-logic.spec` (Endungen parsen, prüfen, Index, Glob), `file-types.store.spec`,
  `file-types-dialog.spec`, `file-icon.service.spec` (Icon/Farbe aus dem Store), `pattern`/Markier-Dialog-Vorlagen,
  `search.store.spec` (Vorlagen dauerhaft, löschen), `find-dialog`, Vollbild-Aktion, `catalogs.spec` (en/de).
- E2E unter Xvfb (DISPLAY :92): Button-Satz Shift ändern → Shift halten, Leiste prüfen; Neustart; kaputte
  `buttons.json`; Dateityp „Comics“ → Icon; Suchvorlage + Neustart; F11.

## 5. Fortschritt

- [x] Phase 1: Prompt + Design
- [ ] Phase 2: Rust
- [ ] Phase 3: Frontend
- [ ] Phase 4: E2E
- [ ] Phase 5: Doku
- [ ] Phase 6: Abschluss + Review

## 6. Review

(folgt)

## 7. Offen

- Import der mr-Dateien (`button/custom`, `filetype/custom`, `search/custom`) → 026 (Formate siehe E1, E4, E8).
- Buttons für Tools (`tool:<id>` aus `tools.json`) – heute nur Katalog-Aktionen.
