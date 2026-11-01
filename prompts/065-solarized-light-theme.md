# Prompt 065: Neues Farbschema „Solarized Light“

> **Slug:** `solarized-light-theme` · **Braucht:** 013 (Farbschemata), 015 (Einstellungen), am besten nach **062–064**
> (gleiches Vorgehen, gleiche Tests) · **Umfang:** XS–S (reines Frontend, Daten + Tests)
> Lies zuerst `prompts/000-arbeitsweise.md`, `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“, `prompts/062-one-dark-themes.md`
> (Aufbau, Akzeptanz, Tests gelten hier genauso), `core/theme/builtin-themes.ts`, `core/theme/themes/light.json`,
> `core/theme/theme-logic.ts` (`CONTRAST_PAIRS`). Kein Design-Dokument; Zuordnung und Abweichungen im Bericht.
> **Vorlagen von Marc (01.11.2026)** in [`065-solarized-light/`](065-solarized-light/): das VS-Code-Theme
> `solarized-light-color-theme.jsonc` (JSON **mit Kommentaren** – nicht mit `JSON.parse` lesen), Screenshot (VS Code,
> Explorer + `config.js` + Terminal): [`065-solarized-light-theme-beispiel.png`](065-solarized-light-theme-beispiel.png).

## Auftrag (Marc)

Neues Theme „Solarized Light“, Farben wie im Bild und in der JSON.

## Herkunft und Lizenz

Das mitgelieferte VS-Code-Theme „Solarized (light)“ (Repo `microsoft/vscode`, `extensions/theme-solarized-light`, MIT)
auf Basis der Solarized-Palette von Ethan Schoonover (MIT). Wir übernehmen nur Farbwerte in unser Token-Format; Herkunft
wie in 062 vermerken. Die Datei unter `prompts/065-solarized-light/` bleibt Referenz.

## Palette

### Solarized (Ethan Schoonover) – Grundlage für alles

| Name | Wert | Rolle hier |
|---|---|---|
| base03 / base02 | `#002b36` / `#073642` | dunkelste Schrift, Schrift auf Akzentflächen |
| base01 / base00 | `#586e75` / `#657b83` | Haupttext (UI / Editor) |
| base1 / base0 | `#93a1a1` / `#839496` | Kommentare, sehr gedämpft (als Text zu hell, s. Kontrast) |
| base2 / base3 | `#eee8d5` / `#fdf6e3` | Flächen: Seitenleiste/Statuszeile / Editor |
| yellow / orange | `#b58900` / `#cb4b16` | Badge, Fortschritt, „geändert“ / Klassen |
| red / magenta | `#dc322f` / `#d33682` | Fehler / Zahlen |
| violet / blue | `#6c71c4` / `#268bd2` | Vererbung / Variablen, Funktionen, Links |
| cyan / green | `#2aa198` / `#859900` | Strings / Keywords, „eingefügt“ |

### UI-Farben aus der JSON (im Bild bestätigt)

| Rolle | Wert | Schlüssel |
|---|---|---|
| Editor-/Listenfläche | `#fdf6e3` | `editor.background`, `tab.activeBackground`, Terminal |
| Seitenleiste, Statuszeile, Titel, Widgets, aktuelle Zeile | `#eee8d5` | `sideBar.background`, `statusBar.background`, `editor.lineHighlightBackground` |
| Aktivitätsleiste, Rahmen, Eingabefelder | `#ddd6c1` | `activityBar.background`, `editorGroup.border`, `input.background` |
| Tab-Leiste / inaktiver Tab | `#d9d2c2` / `#d3cbb7` | `editorGroupHeader.tabsBackground`, `tab.inactiveBackground` |
| Hover-Fläche (Tooltip) | `#ccc4b0` | `editorHoverWidget.background` |
| Auswahl aktiv | `#dfca88` + Text `#6c6c6c` | `list.activeSelection*` |
| Auswahl inaktiv | `#d1cbb8` | `list.inactiveSelectionBackground` (im Bild: Zeile `config.js`) |
| Hover in Listen | `#dfca88` 27 % (`#dfca8844`) | `list.hoverBackground` |
| Treffer in Listen | `#b58900` | `list.highlightForeground` |
| Fokusrahmen | `#b49471` | `focusBorder` |
| Dropdown-Rahmen, aktive Option | `#d3af86` | `dropdown.border`, `inputOption.activeBorder` |
| Button | `#ac9d57` | `button.background` |
| Badge / Fortschritt | `#b58900` (Badge mit `AA`-Alpha) | `badge.background`, `progressBar.background` |
| Aktivitätsleiste Icons | `#584c27` | `activityBar.foreground` |
| Statuszeile / Tabs Text | `#586e75` | `statusBar.foreground`, `tab.inactiveForeground` |
| geänderter Tab | `#cb4b16` | `tab.activeModifiedBorder` |
| Gefahr (Rahmen) | `#ab395b` | `debugExceptionWidget.border` |
| Scrollbar-Daumen (Bild) | `#c0bcb0` | gemessen |

Im Bild außerdem: Ordner-Icons zu `#4a616c` (geschlossen) und Türkis (offen), JS-Icon `#f4bf75`, Zeilennummern
`#2e93b0`/`#479eb6` – das sind Icon-Theme bzw. VS-Code-Details; als Anregung für `--color-icon-*` nutzen.

## Zuordnung zu unseren Tokens (Vorschlag, im Bericht bestätigen)

- Flächen: `--color-list-bg` `#fdf6e3`; `--color-bg`/`--color-surface`, Header, Footer, Button-Leiste, Menüs `#eee8d5`;
  Rahmen/Splitter `#ddd6c1`; Kopf der Liste `#eee8d5`; `--color-row-hover` `#f3e9c7` (≈ `#dfca88` über `#fdf6e3` mit
  27 %), Gruppen-Wechsel `#f5efdc`.
- Text: `--color-text`/`--color-list-text` **`#586e75`** (nicht `#657b83`, s. Kontrast), stark `#073642`,
  `--color-muted` ≥ 4,5:1 (z. B. `#5f6f6f`/`#657b83` nur auf `#fdf6e3` prüfen).
- **Cursor:** Fläche `#dfca88` (wie `list.activeSelectionBackground`), Schrift `#073642` statt `#6c6c6c`; inaktiver
  Cursor `#d1cbb8` mit `#586e75`.
- **Markiert:** Solarized-Rot `#dc322f` oder Magenta `#d33682` als Schrift (TC-Tradition: rot) – auf `#fdf6e3`
  Kontrast prüfen (`#dc322f` ≈ 4,1:1 → ggf. `#c0281f`); Fläche dezent `#f6e3c8`. Cursor auf Markiertem: `#dfca88` +
  rote Schrift, Lesbarkeit prüfen.
- Aktives Panel: Akzent `#b58900` (Unterstrich/Rahmen, wie Badge/Fortschritt) oder `#268bd2` – eins wählen, im Bericht
  begründen; Fokusrahmen `#b49471`.
- Buttons: normal `#ddd6c1` mit `#586e75`, Rahmen `#d3af86`; Primär `#ac9d57` mit **dunkler** Schrift `#002b36`.
- Eingabefelder `#ddd6c1`/`#586e75`, Platzhalter `#586e75` mit Alpha (`AA`).
- Gefahr: `--color-danger` `#dc322f` (als Text ggf. dunkler), Fläche `#f7dcd3`, Rahmen `#ab395b`.
- Suchtreffer: `#b58900`-Familie (Fläche `#f3e2a8`), Treffertext `#b58900` nur als Linie/Icon.
- Diff: hinzugefügt grün `#859900` → Fläche `#eef0c8`, entfernt `#dc322f` → `#f7dcd3`, geändert `#cb4b16` → `#f6e0cc`.
- Datei-Icons aus der Palette: Ordner `#268bd2` oder `#4a616c`, Dokument `#586e75`, Bild `#d33682`, Video `#dc322f`,
  Audio `#6c71c4`, Archiv `#cb4b16`, Code `#2aa198`, Ausführbar `#859900`.
- Shell-Leiste: Fläche `#fdf6e3`, Prompt wie Terminal im Bild (Benutzer `#859900`, Pfad `#b58900`, Branch `#2aa198`),
  Fehler `#dc322f`, Info `#268bd2`.
- Scrollbar: Spur `#eee8d5`, Daumen `#c0bcb0`, aktiv `#aba99f`.
- Speicherbelegung: Palette blau/cyan/violett/orange, frei `#eee8d5`.

## Kontrast (Solarized ist bekannt kontrastarm)

- `#657b83` auf `#fdf6e3` ≈ 4,1:1 – unter AA → Text `#586e75` (≈ 5:1) oder `#073642`.
- `#93a1a1` (Kommentare) ≈ 2,4:1 – nur für Linien/Deko, nie für Text.
- `#6c6c6c` auf `#dfca88` ≈ 3,2:1 → Cursor-Schrift `#073642`.
- Weiß auf `#ac9d57` ≈ 2,7:1 → Primär-Button mit `#002b36` (≈ 5,5:1).
- Akzentfarben (`#b58900`, `#2aa198`, `#859900`) auf Hell sind als **Text** meist < 4,5:1 → nur Flächen/Linien/Icons
  oder abgedunkelte Varianten.
Alle `CONTRAST_PAIRS` müssen bestehen (keine automatische Korrektur); jede Abweichung von der Vorlage im Bericht.

## Aufgaben

1. `themes/solarized-light.json` (alle Tokens wie `light.json`, gleiche Reihenfolge), Registrierung in
   `builtin-themes.ts` (Id `solarized-light`, Name „Solarized Light“, `dark: false`), Reihenfolge im Dialog nach 064.
2. Kontrast prüfen und Werte anpassen.
3. Sichtprüfung: `pnpm screenshots --theme solarized-light --scene <alle> --out <dir>`, Vergleich mit dem Beispielbild
   (Creme-Liste `#fdf6e3`, Seitenteile `#eee8d5`, beige Rahmen, gelb-goldene Auswahl). Zwei bis drei Screenshots im
   Bericht beschreiben.
4. „System folgen“ (013): falls hell/dunkel-Paare wählbar sind, prüfen, ob Solarized Light dort angeboten wird; ein
   „Solarized Dark“ ist **nicht** Teil dieses Prompts (Vorschlag im Bericht).

## Akzeptanzkriterien

1. Im Dialog „Colour schemes…“ steht „Solarized Light“; Auswahl wirkt sofort und übersteht einen Neustart.
2. Das Hauptfenster wirkt wie das Beispielbild (Farben der Tabelle oben).
3. Cursor, Markiert, Cursor auf Markiertem, versteckt, Symlink, Fehler sind klar unterscheidbar.
4. Alle Kontrastpaare bestehen (Test); Export/Re-Import ergibt dasselbe Schema; `pnpm check` grün.

## Tests

- `builtin-themes.spec.ts`: Schema vorhanden, Schlüssel vollständig wie `light`, `dark: false`.
- `theme-logic.spec.ts`: Kontrastpaare ≥ Grenzwert.
- `theme.service.spec.ts`: Auswahl per Id, Persistenz.

## Nicht in diesem Prompt

- Solarized Dark (eigener Prompt, falls gewünscht), Syntax-Highlighting im Viewer, neue Tokens nur für dieses Schema.
