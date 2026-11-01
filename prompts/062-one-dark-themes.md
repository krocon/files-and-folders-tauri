# Prompt 062: Neue Farbschemata „One Dark“ (wie JetBrains One Dark)

> **Slug:** `one-dark-themes` · **Braucht:** 013 (Farbschemata), 019 (alte Designs, Kontrast-Korrektur), 015 (Einstellungen)
> · **Umfang:** S (reines Frontend, Daten + Tests)
> Lies zuerst `prompts/000-arbeitsweise.md`, `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“, `core/theme/builtin-themes.ts`,
> `core/theme/themes/{dark,crimson}.json`, `core/theme/tokens.ts`, `core/theme/theme-logic.ts` (`CONTRAST_PAIRS`).
> Kein Design-Dokument; Zuordnung (Tabelle unten) und Abweichungen im Bericht.
> **Vorlagen von Marc (01.11.2026)** in [`062-one-dark/`](062-one-dark/): die JetBrains-Themes `one_dark.theme.json`,
> `one_dark_vivid.theme.json`, `one_dark_islands.theme.json`, `one_dark_islands_vivid.theme.json` (UI-Farben) und
> die Editor-Schemata `one_dark.xml`, `one_dark_vivid.xml` (Syntaxfarben). Screenshot (IntelliJ mit One Dark):
> [`062-one-dark-themes-beispiel.png`](062-one-dark-themes-beispiel.png).

## Auftrag (Marc)

Neue Themes „One Dark“, Farben wie im Bild bzw. wie in den JSON-Dateien.

## Herkunft und Lizenz

„One Dark“ für JetBrains von Mark Skelton (Plugin `one-dark-theme`, MIT; ursprünglich Atom One Dark, MIT). Wir übernehmen
**nur Farbwerte** in unser eigenes Token-Format, keine Dateien in den Build. Trotzdem: Herkunft im Kopf der neuen
JSON-Dateien (Feld `"source"` o. ä., falls das Schema es erlaubt – sonst in `docs/architecture.md`/Theme-Doku) und eine
Zeile in `THIRD-PARTY-NOTICES` prüfen (`pnpm notices` erfasst nur Pakete – ggf. manuell in die Vorlage). Im Bericht
festhalten. Die Dateien unter `prompts/062-one-dark/` bleiben reine Referenz (nicht importieren).

## Umfang

Zwei eingebaute Schemata wie `crimson` (Basis `dark`, `builtIn: true`, in `BUILT_IN_THEMES`):

| Id | Name | Quelle | Unterschied |
|---|---|---|---|
| `one-dark` | One Dark | `one_dark.theme.json` + `one_dark.xml` | Text `#abb2bf`, klassische Syntaxfarben |
| `one-dark-vivid` | One Dark Vivid | `one_dark_vivid.theme.json` + `one_dark_vivid.xml` | Text `#bbbbbb`, kräftigere Farben (Keyword `#d55fde`, String `#89ca78`, Fehler `#ef596f`) |

Die **Islands**-Varianten unterscheiden sich in JetBrains vor allem durch Form (abgerundete „Inseln“ auf dunklerem
Rahmen) – das bilden unsere Tokens nicht ab. Prüfen, ob „Islands“ über Farben allein sichtbar anders wird (Rahmen/Header/
Statuszeile `#202329`, Listen `#282c34`, Rahmen der Liste = Hintergrund, Vivid-Islands `borderColor #444b57`). Nur wenn
der Unterschied im Screenshot deutlich ist, als drittes/viertes Schema (`one-dark-islands`, `one-dark-islands-vivid`);
sonst weglassen und im Bericht begründen.

## Palette (aus den Vorlagen)

| Rolle | One Dark | Vivid | Herkunft |
|---|---|---|---|
| Fensterrahmen, Seitenleisten | `#202329` | `#202329` | `backgroundColor` |
| Editor-/Listenfläche | `#282c34` | `#282c34` | `Editor.background`, `Table.background` |
| Erhöht (Popup, Tooltip, Buttons) | `#3d424b` | `#3d424b` | `ToolTip`, `Button.startBackground`, `CompletionPopup` |
| Hover | `#323844` | `#323844` | `hoverBackground`, `TabbedPane.hoverColor` |
| Zeilenstreifen / inaktive Auswahl | `#2c313a` | `#2c313a` | `Table.stripeColor`, `selectionInactiveBackground` |
| Rahmen | `#333841` | `#333841` | `borderColor` |
| Trenner | `#32363c` | `#32363c` | `separatorColor` |
| Text | `#abb2bf` | `#bbbbbb` | `foregroundColor` |
| Text gedämpft | `#7e8491` / `#5c6370` | gleich | `infoForeground` (Kommentare `#5c6370`) |
| Akzent (Fokus, Unterstrich, Primär-Button) | `#568af2` | `#568af2` | `accentColor` |
| Auswahl/Cursor in Liste/Baum | `#4d78cc` + `#ffffff` | gleich | `List/Tree.selectionBackground` – im Screenshot die blaue Zeile „initCreationForm…“ |
| Button-Fokus / dunkles Blau | `#4269b9` | gleich | `Button.default.focusedBorderColor` |
| Fehler | `#e06c75`, `#cd3359` | `#ef596f`, `#cd3359` | `SpeedSearch.errorForeground`, `errorForeground` |
| Fehler-Fläche | `#4d232e` / `#802d43` | gleich | `Notification.errorBackground`, `ValidationTooltip` |
| Warnung-Fläche | `#735822` | gleich | `ValidationTooltip.warningBackground` |
| Erfolg | `#98c379` / `#89ca78` | `#89ca78` | String bzw. `Label.successForeground` |
| Gelb (Klassen) | `#e5c07b` | `#e5c07b` | `DEFAULT_CLASS_NAME` |
| Orange (Zahlen) | `#d19a66` | `#d19a66` | `DEFAULT_NUMBER` |
| Violett (Keywords) | `#c678dd` | `#d55fde` | `DEFAULT_KEYWORD` |
| Blau (Funktionen) | `#61afef` | `#61afef` | `DEFAULT_FUNCTION_DECLARATION` |
| Cyan | `#56b6c2` | `#2bbac5` (in der XML prüfen) | Atom One Dark |
| Link | `#6494ed` | gleich | `Link.*` |
| Fortschritt | Spur `#1d1d26`, Balken `#568af2` | gleich | `ProgressBar` |
| Dateifarben (Hintergründe) | Grün `#293a24`, Blau `#24354f`, Gelb `#3d3026`, Rosa `#3d1e2b`, Violett `#2d1942` | gleich | `FileColor.*` |
| Splitter / Gutter | `#21252b` | gleich | `DIFF_SEPARATORS_BACKGROUND`, `Popup.borderColor` |

## Zuordnung zu unseren Tokens (Vorschlag, im Bericht bestätigen)

- `--color-bg` `#202329`, `--color-surface` `#21252b`/`#202329`, `--color-surface-raised` `#3d424b`, `--color-border`
  `#333841`, `--color-text` Text, `--color-muted` `#7e8491`.
- Liste: `--color-list-bg` `#282c34`, `--color-list-text` Text, `--color-list-border` `#333841`, Kopf `#21252b`,
  `--color-row-hover` `#323844`, `--color-group-alt-bg` `#2c313a`.
- Cursor: aktiv `#4d78cc`/`#ffffff` (wie die Baumauswahl im Bild), inaktiv `#2c313a`/Text bzw. `#3d424b`.
- Markierte Dateien (TC-Markierung): gut unterscheidbar vom Cursor – Vorschlag Text `#e5c07b` (Gelb), Fläche
  `#3d3026`; „Cursor auf markierter Zeile“ Text `#ffd88a` o. ä., Kontrast prüfen.
- Aktives Panel: Kopf/Tab mit Akzent-Unterstrich `#568af2` (wie Editor-Tab im Bild), inaktives Panel ohne.
- Header/Tabs: Hintergrund `#21252b`, gewählter Tab `#282c34` + Unterstrich Akzent; Pfadfeld `#282c34`.
- Statuszeile/Footer/Button-Leiste: `#21252b`, Text gedämpft; Buttons `#3d424b`/`#a0a7b4`, Rahmen `#464c55`;
  Kürzel-Badge `#3d424b` + Akzent.
- Dialoge: `#282c34` (Popup), Eingabe `#1b1d23`/`#282c34` mit Rahmen `#333841`, Primär-Button `#568af2`/`#ffffff`,
  Fokus `#568af2`.
- Gefahr: `--color-danger` `#e06c75` (Vivid `#ef596f`), `--color-danger-bg` `#4d232e`, `--color-danger-text` `#ffb3bb`.
- Suche-Treffer `#4d78cc`-artig oder `#735822` (Gelb-Fläche) – im Text-Viewer lesbar halten.
- Diff: hinzugefügt `#293a24`, entfernt `#4d232e`, geändert `#3d3026`.
- Datei-Icons aus der Syntaxpalette: Ordner `#e5c07b` *oder* Blau `#61afef`(Bild: Paketordner bläulich – Marc
  fragen, sonst Gelb), Code `#61afef`, Bild `#c678dd`, Video `#e06c75`, Audio `#56b6c2`, Archiv `#d19a66`,
  Ausführbar `#98c379`, Dokument Text.
- Shell-Leiste: Hintergrund `#21252b`, Prompt `#98c379`, Fehler `#e06c75`, Info `#61afef`.
- Speicherbelegung (`--color-usage-*`): Blau/Violett/Orange aus der Palette, frei `#2c313a`.
- Scrollbar: Spur `#282c34`, Daumen `#4b5263`, aktiv `#5c6370`.
- Schrift bleibt (`--font-list` wie `dark`); keine neuen Tokens nötig – falls doch, Rezept §9 „Neues Token“.

## Aufgaben

1. `themes/one-dark.json` und `themes/one-dark-vivid.json` (alle Tokens wie `dark.json`, gleiche Schlüssel-Reihenfolge),
   Eintrag in `builtin-themes.ts` und Reihenfolge im Dialog „Colour schemes…“ (nach Dark/Crimson). Name in beiden
   Sprachen „One Dark“ (Eigenname), Labels prüfen (`theme-labels.de.ts` nur falls Namen übersetzt werden).
2. **Kontrast:** alle `CONTRAST_PAIRS` mit WCAG AA (wie die anderen eingebauten Schemata; *keine* automatische
   Korrektur wie bei den alten Designs – Werte so wählen, dass sie passen). Wo One Dark selbst zu schwach ist
   (`#5c6370` auf `#282c34` ≈ 2,6:1), für unsere Rolle eine hellere Abstufung nehmen und im Bericht nennen.
3. Sichtprüfung: `pnpm screenshots --theme one-dark,one-dark-vivid --scene <alle> --out <dir>` und mit dem
   Beispielbild vergleichen (Gesamteindruck: dunkler Rahmen, Liste `#282c34`, blaue Auswahl, gelbe/violette Akzente).
   Zwei bis drei Screenshots (Hauptfenster, Dialog, Kontextmenü) im Bericht beschreiben.
4. Optional (wenn klein): Text-Viewer (F3) hat keine Syntaxfarben – nichts nachbauen; nur notieren, dass die
   XML-Palette für ein späteres Highlighting bereitliegt.
5. Doku: README/`site/` (Liste der Farbschemata, falls vorhanden), `docs/feature-parity.md` nur falls betroffen,
   `pnpm screenshots:readme` nicht neu erzeugen (Norton bleibt das README-Bild).

## Akzeptanzkriterien

1. Im Dialog „Colour schemes…“ stehen „One Dark“ und „One Dark Vivid“; Auswahl wirkt sofort und übersteht einen Neustart.
2. Das Hauptfenster wirkt wie das Beispielbild: Rahmen `#202329`, Liste `#282c34`, Text `#abb2bf` (Vivid `#bbbbbb`),
   Cursor blau `#4d78cc` mit weißer Schrift, Akzent `#568af2` am aktiven Panel/Tab.
3. Markierte Dateien, Cursor, Cursor auf Markiertem, versteckte Dateien, Symlinks und Fehler sind klar unterscheidbar.
4. Alle Kontrastpaare bestehen (Test), Export als `.theme.json` und Re-Import ergibt dasselbe Schema.
5. `pnpm check` grün.

## Tests

- `builtin-themes.spec.ts`: neue Schemata vorhanden, gleiche Token-Schlüssel wie `dark` (keine fehlen/überzählig),
  `dark: true`, gültige CSS-Werte.
- `theme-logic.spec.ts`: Kontrastpaare für beide Schemata ≥ Grenzwert.
- `theme.service.spec.ts`: Auswahl per Id, Persistenz.
- Ggf. `docs/legacy-themes-contrast.md` unberührt (nur alte Designs) – prüfen.

## Nicht in diesem Prompt

- Syntax-Highlighting im Viewer, abgerundete „Islands“-Optik (Form statt Farbe), weitere JetBrains-Themes.
