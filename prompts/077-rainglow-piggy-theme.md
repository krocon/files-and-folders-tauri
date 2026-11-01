# Prompt 077: Neues Farbschema „Piggy“ (Rainglow)

> **Slug:** `rainglow-piggy-theme` · **Braucht:** **076** (Rainglow-Schemata: Zuordnung, Namensgebung, ggf.
> Umrechnungs-Skript), 013, 015 · **Umfang:** XS (reines Frontend, Daten + Tests)
> Lies zuerst `prompts/000-arbeitsweise.md`, **`prompts/076-rainglow-themes.md`** (Aufbau der Rainglow-Themes,
> Token-Zuordnung, Kontrast-Regeln, Tests – gilt hier unverändert) und das Ergebnis von 076 (`themes/rainglow-*.json`,
> ggf. `scripts/rainglow-theme.mjs`). Kein Design-Dokument; Abweichungen im Bericht.
> **Vorlage:** [`076-rainglow/piggy.json`](076-rainglow/piggy.json) (aus `github.com/ahmadawais/vscode-1`, `themes/`,
> Stand 01.11.2026; Lizenz MIT wie 076, `076-rainglow/LICENSE`). Screenshot von Marc (01.11.2026):
> [`077-rainglow-piggy-beispiel.png`](077-rainglow-piggy-beispiel.png) (Statuszeile pink, Keywords/Tags rot-pink).

## Auftrag (Marc)

Prompt für das Theme „Piggy“.

## Palette (aus `piggy.json`)

| Rolle (Schlüssel) | Wert |
|---|---|
| Titel / Eingabe / Dropdown | `#31262a` / `#2f2428` / `#372b2f` |
| **Editor/Liste** | `#3d2f34` |
| Aktivitätsleiste / Tab-Leiste, Hover / inaktiver Tab | `#433339` / `#46363b` / `#49383e` |
| **Seitenleiste** / Abschnittskopf / Panel | `#4b3a40` / `#544148` / `#5a454d` |
| Zeilennummern / Kommentare | `#775b65` / `#685259` |
| **Text** | `#edebe6` |
| **Statuszeile**, Fokus, Tags (Signatur) | `#f52e62` (Pink) |
| **Listen-Auswahl** (Fläche / Schrift), Keywords, Button | `#fd6a5d` / `#3d2f34` |
| Funktionen, Fortschritt | `#ff5d80` |
| Strings, Zahlen | `#ff453e` |
| Textauswahl | `#f52e6255` |
| Rot | `#ba0e2e` |
| Nebenfarben in `tokenColors` | Grün `#8fbe00` (mit Alpha), Gelb `#e6db74`, Grau-Rosa `#92757e` |

**Bild ≠ JSON:** Der Screenshot zeigt eine ältere Rainglow-Version mit fast neutralem Dunkelgrau (`#2a2626`-artig); die
aktuelle JSON hat einen leicht **rosa-braunen** Grundton (`#3d2f34`). Maßgeblich ist die JSON (wie in 076); im Bericht
beide nebeneinander zeigen und Marc fragen, falls der neutrale Ton gewünscht ist.

## Besonderheit: fast alle Akzente sind Rot/Pink

Signatur, Cursor, Keywords, Strings, Funktionen und Fehler liegen alle zwischen `#ba0e2e` und `#ff5d80`. Die Zuordnung
aus 076 („Markiert = String-Farbe“) würde Markiert, Cursor und Fehler **ununterscheidbar** machen. Deshalb hier:
- **Markiert:** Gelb `#e6db74` (aus `tokenColors`), Fläche dezent; Cursor auf Markiertem: Cursorfläche + dunkle Schrift
  + gelbe Unterstreichung/Fettung – Lesbarkeit prüfen.
- **Fehler/Gefahr:** `#ba0e2e` als Fläche mit weißer Schrift; Fehler-**Text** deutlich anders als Keywords (z. B. heller
  `#ff8fa3` + Icon) – Unterscheidung nie nur über Farbe (Icon/Text bleiben).
- **Symlinks** Grün `#8fbe00` (ohne Alpha), **versteckt** `#92757e`.
- Datei-Icons: Pink/Rot-Familie für Code, Gelb für Archive, Grün für Ausführbares, Text für Dokumente – sonst wird alles
  rosa.

## Kontrast

- Weiß auf `#f52e62` (Statuszeile) ≈ 3,9:1 – unter AA → dunkle Schrift (`#31262a`) oder Fläche abdunkeln.
- Cursor `#fd6a5d` + `#3d2f34` ≈ 4,5:1 – genau an der Grenze; bei Rundungsproblemen Schrift `#2f2428`.
- Weiß auf Button `#fd6a5d` ≈ 2,8:1 → dunkle Schrift.
- Kommentare/Zeilennummern (`#685259`, `#775b65`) ≈ 1,7–2,2:1 → gedämpfter Text heller (z. B. `#b8a3aa`).
Alle `CONTRAST_PAIRS` müssen bestehen; Abweichungen im Bericht.

## Aufgaben

1. `themes/rainglow-piggy.json` wie die Schemata aus 076 (gleiche Zuordnung, gleiche Namensregel, Id `rainglow-piggy`,
   Name „Piggy“ ggf. mit „(Rainglow)“), registrieren, Reihenfolge nach den 076-Schemata. Gibt es das Skript aus 076,
   damit erzeugen und dann von Hand die Abweichungen oben einarbeiten.
2. Kontrast prüfen und anpassen.
3. Sichtprüfung: `pnpm screenshots --theme rainglow-piggy --scene <alle> --out <dir>`, Vergleich mit dem Beispielbild;
   ein bis zwei Screenshots im Bericht.

## Akzeptanzkriterien

1. „Piggy“ steht im Dialog „Colour schemes…“, Auswahl wirkt sofort und übersteht einen Neustart.
2. Gesamteindruck wie das Beispielbild: dunkle Flächen, pinke Statuszeile/aktives Panel, rot-pinke Akzente.
3. Cursor, Markiert (gelb), Cursor auf Markiertem, versteckt, Symlink, Fehler sind klar unterscheidbar – trotz der
   roten Palette.
4. Alle Kontrastpaare bestehen (Test); Export/Re-Import ergibt dasselbe Schema; `pnpm check` grün.

## Tests

- Wie 076: `builtin-themes.spec.ts` (Schlüssel vollständig, `dark: true`, Id eindeutig), `theme-logic.spec.ts`
  (Kontrast), `theme.service.spec.ts`; falls Skript: Fixture `piggy.json` ergänzen.

## Nicht in diesem Prompt

- Weitere Rainglow-Themes, Syntax-Highlighting im Viewer.
