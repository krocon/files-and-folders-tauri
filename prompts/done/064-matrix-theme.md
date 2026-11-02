# Prompt 064: Neues Farbschema „Matrix“ (grün auf schwarz)

> **Slug:** `matrix-theme` · **Braucht:** 013 (Farbschemata), 015 (Einstellungen), am besten nach **062/063** (gleiches
> Vorgehen, gleiche Tests) · **Umfang:** XS–S (reines Frontend, Daten + Tests)
> Lies zuerst `prompts/000-arbeitsweise.md`, `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“, `prompts/062-one-dark-themes.md`
> (Aufbau, Akzeptanz, Tests gelten hier genauso), `core/theme/builtin-themes.ts`, `core/theme/themes/dark.json`,
> `core/theme/theme-logic.ts` (`CONTRAST_PAIRS`). Kein Design-Dokument; Zuordnung und Abweichungen im Bericht.
> **Vorlage von Marc (01.11.2026):** nur ein Screenshot (VS Code mit grünem „Matrix“-Theme, Python-Code):
> [`064-matrix-theme-beispiel.png`](064-matrix-theme-beispiel.png). Keine Theme-Datei – die Farben unten sind **aus dem
> Bild gemessen** (häufigste Pixelwerte je Bereich).

## Auftrag (Marc)

Neues Theme „Matrix“, Farben wie im Bild.

## Herkunft

Eigenes Schema nach dem Eindruck des Screenshots (grün auf schwarz, Terminal-/„Matrix“-Look). Es wird keine fremde
Theme-Datei übernommen; Name „Matrix“ ist ein Gattungsbegriff (kein Logo, keine Filmgrafik, kein „digital rain“).

## Palette (aus dem Bild gemessen)

| Rolle | Wert | Wo im Bild |
|---|---|---|
| Fensterrahmen, Aktivitätsleiste, Statuszeile, Titel | `#000000` | außen |
| Editor-/Listenfläche | `#0c0c0c` | Code-Bereich, Zeilennummern-Spalte |
| Rahmen der aktuellen Zeile, Minimap | `#080808` | Zeile 9 |
| Einrückungslinien | `#2c2c2c` / `#121212` | senkrechte Hilfslinien |
| **Grün hell** (Keywords, Zahlen, Aufrufe) | `#88ff88` | `def`, `while`, `True`, `print`, `0` |
| **Grün Haupt** (Bezeichner, Chrome-Text, Linien) | `#00cc00` | `getNum`, `userNum`, Statuszeilen-Text, aktuelle Zeilennummer |
| Grün blass (Strings) | `#bbffbb` | `"Please enter any number : "` |
| Grün fast weiß (Cursor) | `#ddffdd` | Textcursor in Zeile 9 |
| Grün mittel (Builtins, Breadcrumb) | `#008800` | `float`, `int`, „Python Stuff › …“ |
| Grün dunkel (Kommentare, Zeilennummern, Icons) | `#006600` | `# A python library …`, Zeilennummern, Icons links |
| Akzentlinie (Statuszeile oben, Aktivitätsleiste rechts) | `#00cc00` | 1-px-Linien |
| Klammerpaar 1 | `#e6b422` (Gold) | `(` `)` äußere Ebene |
| Klammerpaar 2 | `#c70067` (Magenta) | `input(` … `)` innere Ebene |
| Scrollbar-Daumen | `#074307` / `#083608` | rechts |
| Datei-Icon Python | `#fdd835` / `#3c78aa` | Tab-Symbol |

Die Schrift im Bild ist kursiv/monospaced (Code-Font des Editors) – Schriftart bleibt wie bei `dark` (`--font-list`);
ein Monospace-Font für die Liste ist **optional** (nur wenn er auf allen drei OS vorhanden ist bzw. ein Fallback-Stapel
wie `ui-monospace, Menlo, Consolas, monospace` reicht) – im Bericht entscheiden, Marc zeigen.

## Zuordnung zu unseren Tokens (Vorschlag)

- Flächen: `--color-bg` `#000000`, `--color-list-bg` / Dialoge `#0c0c0c`, `--color-surface-raised` `#121212`,
  Header/Footer/Button-Leiste `#000000` mit grüner Trennlinie `#00cc00` (wie Statuszeile im Bild).
- Text: `--color-text` / `--color-list-text` `#00cc00`, betonter Text `#88ff88`, `--color-muted` **nicht** `#006600`
  (siehe Kontrast) sondern ≈ `#00a000`.
- Rahmen: `--color-border` `#1f3d1f` o. ä. (dezentes Dunkelgrün), aktive Linien `#00cc00`.
- **Cursor** (aktives Panel): Fläche `#00cc00`, Schrift `#000000` – der klassische invertierte Terminal-Cursor; inaktiv
  `#0f3d0f` mit `#88ff88`. Alternative im Bericht: Fläche `#0f3d0f` + Rahmen `#00cc00`.
- **Markiert:** Gold `#e6b422` (Klammerfarbe 1) – klar anders als jedes Grün; Cursor auf Markiertem: Fläche `#00cc00`,
  Schrift `#000000` fett bzw. Gold-Unterstrich – Lesbarkeit prüfen.
- Versteckte Dateien `#008800`/`#00a000`, Symlinks `#bbffbb` kursiv o. ä. (wie Strings), Fehler Magenta aufgehellt.
- Gefahr: Magenta-Familie (`#c70067` als Fläche mit weißer Schrift, als Text heller z. B. `#ff5fa8`).
- Akzent/Fokus `#88ff88`, Primär-Button `#00cc00` mit `#000000`, normale Buttons `#0c0c0c` mit Rahmen `#006600`.
- Suchtreffer: `#3a3a00`-artige Fläche mit Gold-Schrift oder Gold-Rahmen.
- Diff: hinzugefügt `#0d2e0d`, entfernt `#3a0020`, geändert `#3a3000`.
- Datei-Icons: alles in Grün-Stufen (Ordner `#88ff88`, Dokument `#00cc00`, Code `#bbffbb`, Bild/Video/Audio/Archiv in
  `#00cc00`/`#008800`), nur Ausführbar Gold – Ziel: monochromer Look; Unterscheidung kommt über das Icon selbst.
- Shell-Leiste: Hintergrund `#000000`, Prompt `#88ff88`, Ausgabe `#00cc00`, Fehler Magenta hell, Info `#bbffbb`.
- Scrollbar: Spur `#000000`, Daumen `#074307`, aktiv `#00cc00`.
- Speicherbelegung: Grün-Stufen + Gold für „größte“, frei `#121212`.

## Kontrast (Werte aus dem Bild reichen nicht überall)

- `#006600` auf `#0c0c0c` ≈ 2,7:1, `#008800` ≈ 4,2:1 – für gedämpften **Text** zu schwach; ≥ `#009900` (≈ 5:1) nehmen.
  Als Linien-/Icon-Farbe dürfen die dunklen Grüns bleiben.
- `#00cc00` ≈ 9:1, `#88ff88` ≈ 16:1 – unkritisch. Schwarz auf `#00cc00` ≈ 9:1 – Cursor gut lesbar.
- Magenta `#c70067` als Text ≈ 3,4:1 – zu schwach; als Fläche mit weißer Schrift ≈ 5,6:1 ok.
- Alle `CONTRAST_PAIRS` müssen bestehen (keine automatische Korrektur); Abweichungen vom Bild im Bericht.

## Aufgaben

1. `themes/matrix.json` (alle Tokens wie `dark.json`, gleiche Reihenfolge), Registrierung in `builtin-themes.ts`
   (Id `matrix`, Name „Matrix“, `dark: true`), Reihenfolge im Dialog nach 062/063.
2. Kontrast prüfen und Werte anpassen.
3. Sichtprüfung: `pnpm screenshots --theme matrix --scene <alle> --out <dir>` und mit dem Beispielbild vergleichen
   (Gesamteindruck: schwarz, Code-Fläche minimal heller, alles grün in drei bis vier Helligkeiten, Gold/Magenta nur als
   seltene Akzente). Zwei bis drei Screenshots im Bericht beschreiben.
4. Optional Monospace-Liste (s. o.) – nur als Token-Wert dieses Schemas, keine neue Einstellung.

## Akzeptanzkriterien

1. Im Dialog „Colour schemes…“ steht „Matrix“; Auswahl wirkt sofort und übersteht einen Neustart.
2. Das Hauptfenster wirkt wie das Beispielbild: Schwarz/`#0c0c0c`, Text grün `#00cc00`, Betontes `#88ff88`, grüne
   1-px-Trennlinien.
3. Cursor, Markiert (Gold), Cursor auf Markiertem, versteckt, Symlink, Fehler sind klar unterscheidbar.
4. Alle Kontrastpaare bestehen (Test); Export/Re-Import ergibt dasselbe Schema; `pnpm check` grün.

## Tests

- `builtin-themes.spec.ts`: Schema vorhanden, Schlüssel vollständig wie `dark`, `dark: true`.
- `theme-logic.spec.ts`: Kontrastpaare ≥ Grenzwert.
- `theme.service.spec.ts`: Auswahl per Id, Persistenz.

## Nicht in diesem Prompt

- Animationen („digital rain“), Glow-/CRT-Effekte, neue Tokens nur für dieses Schema, Syntax-Highlighting im Viewer.
