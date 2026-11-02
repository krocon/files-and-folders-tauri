# Prompt 070: Farbschema-Auswahl mit Vorschaubildern („Theme-Picker“) + Schemata im Hauptmenü

> **Slug:** `theme-picker` · **Braucht:** 013/019 (Farbschemata, `ThemeService`, Dialog „Colour schemes…“), 014/056 (Menü-
> modell, Menüleiste „Configuration“), 022 (Button-Leiste, 🎨-Knopf), 057 (Dialog-Tasten), 062–069 (24 Schemata) ·
> **Umfang:** M (reines Frontend, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md`, `prompts/done/013-themes-farbschemata.design.md`,
> `features/themes/theme-dialog.ts` (Editor, `swatch`), `features/workspace/button-bar/button-bar.ts` (`themeItems`,
> `openThemeMenu`, `onThemeChosen`) und `features/menus/menu-model.ts` (`MENU_BAR`). Kurzes Design-Dokument
> `prompts/070-theme-picker.design.md` (E1–E5 unten).
> Vorbild von Marc (02.11.2026, eigene App „editlicious“): Hauptmenü
> [`070-theme-picker-menue-beispiel.webp`](070-theme-picker-menue-beispiel.webp) (Untermenü „Colour scheme“ mit allen
> Namen, ✓ am aktiven, „Next colour scheme“) und Picker
> [`070-theme-picker-beispiel.webp`](070-theme-picker-beispiel.webp) (Raster aus kleinen Vorschaubildern mit Namen,
> „Follow the system“ als geteiltes Hell/Dunkel-Bild, Pfeiltasten probieren, Enter behält, Esc zurück, OK/Cancel).

## Auftrag (Marc)

Einen Theme-Picker wie in editlicious ergänzen: jedes Farbschema mit **kleinem Vorschaubild (Thumb)**. Im **Hauptmenü**
steht eine Auswahl der Schema-Namen; über den **🎨-Knopf** (Icon in der Button-Leiste) geht der **Picker mit den Thumbs**
auf. Dort eventuell ein **Filterfeld im Kopf**.

## Ist-Zustand (kurz, im Design prüfen)

- 🎨 in der Button-Leiste öffnet ein Popup-Menü (`themeItems`: „Follow the system“, eigene Schemata, eingebaute, alte
  Designs als Radio-Einträge) – reiner Text; bei 24 eingebauten + 8 alten + eigenen Schemata eine lange Liste.
- Hauptmenü: unter *View* nur `NEXT_THEME`, `THEME_FOLLOW_SYSTEM`, `OPEN_THEMES_DLG` (Editor) – keine Namen.
- Der Dialog „Colour schemes…“ ist ein **Editor** (Tokens, Import/Export), keine Auswahl mit Vorschau.

## Ziel

1. **Picker-Dialog** (neu, z. B. `features/themes/theme-picker.ts`, `DialogKind` `theme-picker`): Raster aus Karten,
   je Karte ein Vorschaubild + Name (+ „hell/dunkel“). Erste Karte „Follow the system“ (geteilt: das helle und das
   dunkle Schema der Systemeinstellung nebeneinander). Gruppen: eigene, eingebaut, alte Designs (oder Sortierung hell →
   dunkel wie editlicious – E3).
   - **Live-Vorschau:** Pfeiltasten/Hover wählen und wenden das Schema sofort an (`ThemeService` vorläufig), **Enter**/OK
     behält, **Esc**/Cancel stellt das vorherige Schema wieder her (auch beim Schließen über den Rahmen).
   - **Filterfeld im Kopf** (Marcs Vorschlag): tippt man, bleiben nur passende Karten (Name, Gruppe, „dark“/„light“);
     ↓ aus dem Feld springt ins Raster; Treffer-Zahl als Live-Region.
   - Tastatur nach APG (Grid oder Listbox mit `aria-activedescendant`), sichtbarer Fokusrahmen in der Akzentfarbe,
     Rollen nach 057 (`primary` = OK, `cancel`), Hinweiszeile wie im Vorbild.
   - Link „Edit colour schemes…“ öffnet den bestehenden Editor (`OPEN_THEMES_DLG`) mit dem gewählten Schema.
2. **Vorschaubild (Thumb):** kein Screenshot-Bild, sondern eine **Mini-Ansicht aus den Tokens** des Schemas, gerendert
   mit CSS-Variablen auf der Karte (Ausschnitt eines Dual-Panels: Kopfzeile, gewählter Tab in Listenfarbe (069), drei
   Zeilen mit Ordner/Datei/markiert, Cursorzeile, Statuszeile in Footer-Farbe). Skaliert mit, kostet keinen Speicher
   für Bilder, zeigt eigene/importierte Schemata automatisch. Tokens nur über `resolveColor`/sichere Werte (`isSafeValue`),
   nie unescaped in `style`-Strings.
3. **🎨-Knopf** öffnet den Picker statt des Popup-Menüs (E1: Popup ganz ersetzen oder Rechtsklick/Pfeil = altes Menü).
4. **Hauptmenü:** Untermenü **„Colour scheme ▸“** (unter *View* oder *Configuration* – E2) mit
   „Colour scheme…“ (= Picker), Trenner, „Follow the system“, allen Schemata als Radio-Einträge mit ✓ am aktiven,
   Trenner, „Next colour scheme“ (`NEXT_THEME`), „Edit colour schemes…“ (Editor). Native macOS-Menüleiste über
   `toNativeSpec` (Untermenü-Tiefe ≤ `MAX_DEPTH`, Anzahl ≤ `MAX_NODES`; Radio/✓ im nativen Menü prüfen – ggf. als
   „✓ “-Präfix oder `checked`-Feld im Spec, dann Rust `app_menu.rs` erweitern und testen). Einträge sind dynamisch
   (eigene Schemata, Sprache) – Neuaufbau des nativen Menüs bei Änderung wie bei `@tools`/`@starter`.
5. Neue Aktion `OPEN_THEME_PICKER` (Katalog + de, Palette, Menü), Kürzel-Vorschlag im Design (z. B. `Mod+K Mod+T` wie
   VS Code oder frei); `OPEN_THEMES_DLG` bleibt der Editor (Label ggf. „Edit colour schemes…“, mit 054/055-Regel „…“).

## Entscheidungsfragen (Design)

- **E1** 🎨: Picker ersetzt das Popup vollständig, oder Klick = Picker und ▾/Rechtsklick = bisheriges Schnellmenü?
- **E2** Ort des Untermenüs im Hauptmenü: *View* (wie editlicious) oder *Configuration* (056, dort steht der Editor)?
- **E3** Reihenfolge/Gruppen im Picker: eigene → eingebaute → alte Designs, oder hell → dunkel (Vorbild), mit
  Gruppenüberschriften?
- **E4** Thumb: Token-Mini-Ansicht (Empfehlung) oder vorgerenderte PNGs (`pnpm screenshots`)? Größe der Karten
  (Vorbild ~240×130 px), Spaltenzahl responsiv.
- **E5** Filter: nur Name, oder auch Gruppe/hell/dunkel/Herkunft („rainglow“, „classic“)? Leeres Ergebnis-Verhalten.

## Akzeptanzkriterien

1. 🎨 öffnet den Picker mit einem Vorschaubild je Schema (alle eingebauten, alten und eigenen); das aktive ist markiert
   und beim Öffnen fokussiert.
2. Pfeiltasten/Hover zeigen ein Schema sofort im ganzen Fenster; Enter/OK behält es (gespeichert wie bisher), Esc/Cancel
   stellt das vorherige wieder her.
3. Das Filterfeld grenzt die Karten beim Tippen ein; ↓ führt ins Raster; ohne Treffer ein Hinweis.
4. Hauptmenü (HTML und nativ macOS) hat „Colour scheme ▸“ mit allen Namen und ✓ am aktiven; Auswahl wirkt sofort;
   „Colour scheme…“ öffnet den Picker.
5. Thumbs geben die Schemata erkennbar wieder (Listenfarbe, Cursor, Kopf/Status), auch für importierte Schemata.
6. Tastatur und Screenreader nach APG; Kontraste der Picker-Oberfläche in light, dark und `classic-norton` geprüft.

## Tests

- Picker: Rendern aller Karten, Filter, Pfeiltasten wählen + wenden vorläufig an, Enter behält, Esc stellt zurück,
  Fokus beim Öffnen auf dem aktiven Schema (`theme-picker.spec.ts`).
- Thumb: Token-Werte landen als CSS-Variablen auf der Karte, unsichere Werte nicht.
- `menu-model.spec.ts`: Untermenü mit allen Schemata, ✓ am aktiven, native Spec innerhalb der Grenzen.
- Button-Leiste: 🎨 öffnet den Picker (E1).
- `catalogs.spec.ts`, Screenshot-Szene `theme-picker` (light, dark, classic-norton); `pnpm check` grün.

## Nicht in diesem Prompt

- Änderungen am Editor „Colour schemes…“ selbst (außer Aufruf aus dem Picker).
- Neue Farbschemata.
