# Prompt 063: Neue Farbschemata „True Dark“, „True Black“, „True Light“

> **Slug:** `true-dark-themes` · **Braucht:** 013 (Farbschemata), 019 (Kontrast-Korrektur), 015 (Einstellungen), am besten
> nach **062** (One Dark – gleiches Vorgehen, gleiche Tests) · **Umfang:** S (reines Frontend, Daten + Tests)
> Lies zuerst `prompts/000-arbeitsweise.md`, `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“, `prompts/062-one-dark-themes.md`
> (Aufbau, Akzeptanz, Tests gelten hier genauso), `core/theme/builtin-themes.ts`, `core/theme/themes/*.json`,
> `core/theme/theme-logic.ts` (`CONTRAST_PAIRS`). Kein Design-Dokument; Zuordnung und Abweichungen im Bericht.
> **Vorlagen von Marc (01.11.2026)** in [`063-true-dark/`](063-true-dark/): JetBrains-Themes `TrueDark`, `TrueBlack`,
> `TrueLight` (je `.theme.json` = UI-Farben, `.xml` = Editor-Syntaxfarben) und ihre `…Islands`-Varianten. Screenshot
> (Kotlin-Code in True Dark): [`063-true-dark-themes-beispiel.png`](063-true-dark-themes-beispiel.png).

## Auftrag (Marc)

Neue Themes „True Dark“, Farben wie im Bild bzw. wie in den JSON-Dateien.

## Herkunft und Lizenz

JetBrains-Themes „True Dark / True Black / True Light“ von Ahmed Elshaer. **Lizenz vorab klären** (Marketplace-Seite /
GitHub-Repo des Plugins) und im Bericht nennen. Wir übernehmen nur Farbwerte in unser Token-Format, keine Dateien in den
Build; Herkunft wie in 062 vermerken (`docs/architecture.md` bzw. Theme-Doku, ggf. `THIRD-PARTY-NOTICES`). Ist die Lizenz
unklar oder restriktiv: Marc fragen, bevor die Schemata eingebaut werden. `prompts/063-true-dark/` bleibt reine Referenz.

## Umfang

Drei eingebaute Schemata (`builtIn: true`, in `BUILT_IN_THEMES`, Reihenfolge im Dialog nach den One-Dark-Schemata):

| Id | Name | Basis | Charakter |
|---|---|---|---|
| `true-dark` | True Dark | `dark` | fast schwarz `#121212`, violetter Akzent `#8b5cf6`, kräftige Syntaxfarben (Bild) |
| `true-black` | True Black | `dark` | reines Schwarz `#000000` (OLED), keine Akzentfarbe – Grau/Weiß |
| `true-light` | True Light | `light` | bläuliches Weiß `#f2f4fe`, Auswahl hellblau `#c1cefb`, Text fast schwarz |

**Islands-Varianten weglassen:** Die `…Islands`-Dateien haben dieselben Grundfarben, nur mit Rundungen und ein paar
Hover-Feinheiten (`#1f1f1f`/`#2a2a2a`, `#e0e6fa`). Diese Hover-/Banner-Werte dürfen in die drei Schemata einfließen
(z. B. `--color-row-hover`, Warn-/Fehler-Flächen aus `Banner.*`); eigene Islands-Schemata nur, wenn Marc es wünscht.

## Palette (aus den Vorlagen)

### True Dark (`TrueDark.theme.json`, `TrueDark.xml`)

| Rolle | Wert | Herkunft |
|---|---|---|
| Hintergrund überall (Rahmen, Liste, Popup) | `#121212` | `primary`/`secondary`, `TEXT.BACKGROUND` |
| Hover, inaktive Auswahl, Tooltip | `#1f1f1f` | `inactiveSelection` |
| aktive Auswahl (neutral), gewählter Tab | `#2d2d2d` | `activeSelection` |
| Rahmen / Trenner | `#1e1e1e` / `#1f1f1f` | `borderColor`, `separatorColor` |
| Text UI / Editor | `#d1d1d1` / `#dfdfe0` | `Tree/List.foreground`, `TEXT` |
| gedämpft | `#7f8c98` (Kommentare), Zeilennummern `#5a6577` | XML |
| Akzent (Fokus, Unterstrich, Primär-Button, Liste-Auswahl) | `#8b5cf6` + Text `#ffffff` | `accentColor`, `List.selection*` |
| Violett-Abstufungen | `#a78bfa`, `#9f7aea`, `#b794f6`, `#c8a8e9` | Fortschritt, Links |
| aktuelle Zeile / Hinweis-Blau | `#1c1c1c` / `#8c9eff` | `CARET_ROW_COLOR`, Zeilennummer am Cursor |
| Textauswahl | `#2a3a5c` | `SELECTION_BACKGROUND` |
| Link | `#6699ff` | `HYPERLINK` |
| Fehler / Warnung / Erfolg / Info (Status) | `#f87171` / `#fbbf24` / `#10b981` / `#60a5fa` | `FILESTATUS_*` |
| Banner-Flächen | Fehler `#4f1520`, Warnung `#4f3520`, Erfolg `#2c3520`, Info `#2c2540` | Islands `Banner.*` |
| Suchtreffer | `#eeed38` (sehr hell – nur mit dunkler Schrift) | `SearchMatch` |
| Syntax (Bild) | Keyword `#ff7ab2`, String `#ff8170`, Funktion `#78c2b3`/`#5ac8db`, Klasse `#6bdfff`/`#dabaff`, Konstante `#b281eb`, Zahl `#d9c97c`, Entity `#ffa14f` | `TrueDark.xml` |

### True Black (`TrueBlack.theme.json`, `TrueBlack.xml`)

Hintergrund `#000000`, Hover/inaktiv `#353535`, aktive Auswahl `#505050`, Rahmen `#1c1c1c`, Text `#ffffff` (UI) /
`#dfdfe0` (Editor), Kürzel `#777777`, Fortschritt weiß auf `#353535`, Primär-Button = schwarz mit **weißem Rahmen**,
Popup-Flächen `#1c1c1c`/`#2a2a2a` (Islands), Textauswahl `#2a3a5c`, Bezeichner unter Cursor `#383a60`. Syntax wie True
Dark. Kein Farbakzent – Fokus/aktives Panel über Weiß bzw. `#505050`.

### True Light (`TrueLight.theme.json`, `TrueLight.xml`)

Hintergrund `#f2f4fe` (Editor `#f1f4ff`), Auswahl `#c1cefb`, inaktiv `#d0d0d0`, Hover `#e0e6fa`, Rahmen `#dce4fd`,
Text `#1c1a1a` (UI) / `#404a66` (Editor), gedämpft `#7f8aaa`/`#677290`, Link `#2d69eb`/`#0c90f8`, Primär-Button =
hell mit dunklem Rahmen `#1c1a1a`, aktuelle Zeile `#e7edff`, Textauswahl `#c6d4f8`, Suchtreffer `#e6f27b`,
Banner Fehler `#fce4ec`/`#ef9a9a`, Warnung `#fff8e1`/`#ffe082`, Info `#e3f2fd`/`#90caf9`, Erfolg `#e8f5e9`/`#a5d6a7`.
Syntax: Keyword `#9543be`, String `#ae3a93`, Funktion `#6e51da`, Klasse `#008d92`, Zahl/Konstante `#0086a6`,
Fehler `#d90070`/`#dd002e`, Grün `#008c4c` (XML-Werte ohne führende Nullen: `8d92` = `#008d92`, `8c4c` = `#008c4c`,
`86a6` = `#0086a6`, `7abb` = `#007abb`).

## Zuordnung zu unseren Tokens (Vorschlag, im Bericht bestätigen)

Wie in 062, je Schema:
- Flächen: `--color-bg`/`--color-surface`/`--color-list-bg` = Grundfarbe; `--color-surface-raised`, Kopf, Footer,
  Button-Leiste eine Stufe heller (Dark `#1f1f1f`, Black `#1c1c1c`, Light `#e7edff`), damit die Bereiche trotz „alles
  eine Farbe“ unterscheidbar bleiben. `--color-row-hover` = Hover-Wert, `--color-group-alt-bg` knapp daneben.
- **Cursor:** Dark = Akzent-Violett mit weißer Schrift (wie `List.selectionBackground`), Black = `#505050`/`#ffffff`,
  Light = `#c1cefb`/`#1c1a1a`. Inaktiver Cursor = inaktive Auswahl.
- **Markiert** (TC): klar anders als der Cursor – Dark Text `#ffa14f` (Orange) oder `#ff7ab2` (Pink), Black `#fbbf24`,
  Light `#ae3a93`/`#9543be`; Fläche dezent (Banner-Warnfarbe). Kontrast und Unterscheidbarkeit im Bericht.
- Aktives Panel: Unterstrich/Rahmen in Akzent (Dark `#8b5cf6`, Black `#ffffff`, Light `#2d69eb`).
- Gefahr: aus `FILESTATUS_DELETED`/`Banner.error*` (Dark `#f87171` auf `#4f1520`, Light `#d90070` auf `#fce4ec`).
- Diff: Erfolg/Fehler/Warnung-Flächen aus `Banner.*` bzw. `DIFF_*` (Light).
- Datei-Icons aus der Syntaxpalette (Dark: Ordner `#dabaff` oder `#6bdfff`, Code `#78c2b3`, Bild `#ff7ab2`, Video
  `#ff8170`, Audio `#5ac8db`, Archiv `#ffa14f`, Ausführbar `#10b981`; Light entsprechend dunklere Töne).
- Shell-Leiste: Prompt Erfolgsgrün, Fehler Fehlerrot, Info Link-Blau.
- Scrollbar: Daumen `inactiveSelection`, aktiv Akzent (Dark) bzw. `#505050` (Black), Light `#c3d4ff`/`#93aae5`.

## Kontrast – bekannte Stolpersteine (Werte nicht 1:1 übernehmen)

- **Weiß auf `#8b5cf6` ≈ 4,2:1** – unter AA. Für Cursor/Primär-Button ein dunkleres Violett (z. B. `#7c3aed` ≈ 5,7:1)
  oder dunkle Schrift; Akzent für Linien/Fokus darf `#8b5cf6` bleiben.
- Zeilennummern-Grau `#5a6577` auf `#121212` ≈ 3:1 – für `--color-muted` `#7f8c98` (≈ 5,4:1) nehmen.
- True Light: `#7f8aaa` auf `#f2f4fe` ≈ 3,3:1, `#677290` ≈ 4,3:1 – für gedämpften Text dunkler (≥ 4,5:1) wählen.
- True Black: Rahmen `#1c1c1c` auf Schwarz ist kaum sichtbar – für Panel-Grenzen/Splitter einen helleren Wert
  (`#353535`) nehmen, sonst verschwimmen die beiden Seiten.
- Suchtreffer `#eeed38`/`#e6f27b`: nur mit dunkler Schrift, in dunklen Schemata als Fläche eher gedämpft (`#565246`,
  `WARNING_ATTRIBUTES`).
Alle `CONTRAST_PAIRS` müssen bestehen (wie 062, keine automatische Korrektur); Abweichungen vom Original im Bericht.

## Aufgaben

1. `themes/true-dark.json`, `themes/true-black.json`, `themes/true-light.json` (alle Tokens wie `dark.json`/`light.json`,
   gleiche Reihenfolge), Registrierung in `builtin-themes.ts`, Namen sind Eigennamen (keine Übersetzung).
2. Kontrast prüfen und Werte anpassen (Abschnitt oben).
3. Sichtprüfung: `pnpm screenshots --theme true-dark,true-black,true-light --scene <alle> --out <dir>`, Vergleich mit dem
   Beispielbild (Gesamteindruck True Dark: tiefes Schwarzgrau, violetter Akzent, pinke/türkise/lila Akzente); zwei bis
   drei Screenshots je Schema im Bericht beschreiben.
4. „System folgen“ (013): prüfen, ob ein Paar „True Light ↔ True Dark“ als hell/dunkel wählbar ist (falls die Einstellung
   Schema-Paare kennt); sonst nur notieren.
5. Doku wie in 062 (README/`site/` Liste der Schemata, falls vorhanden).

## Akzeptanzkriterien

1. Im Dialog „Colour schemes…“ stehen „True Dark“, „True Black“, „True Light“; Auswahl wirkt sofort, übersteht einen Neustart.
2. True Dark wirkt wie das Beispielbild: Hintergrund `#121212`, Text `#d1d1d1`/`#dfdfe0`, Akzent violett.
3. True Black hat echtes Schwarz und trotzdem erkennbare Panel-Grenzen, aktives Panel und Cursor.
4. In allen drei Schemata sind Cursor, Markiert, Cursor auf Markiertem, versteckt, Symlink, Fehler klar unterscheidbar.
5. Alle Kontrastpaare bestehen (Test); Export/Re-Import ergibt dasselbe Schema; `pnpm check` grün.

## Tests

- `builtin-themes.spec.ts`: drei neue Schemata, Schlüssel vollständig (wie `dark`/`light`), `dark`-Flag korrekt.
- `theme-logic.spec.ts`: Kontrastpaare für alle drei ≥ Grenzwert.
- `theme.service.spec.ts`: Auswahl per Id, Persistenz.

## Nicht in diesem Prompt

- Syntax-Highlighting im Viewer (XML-Paletten liegen bereit), Islands-Optik (Rundungen), weitere JetBrains-Themes.
