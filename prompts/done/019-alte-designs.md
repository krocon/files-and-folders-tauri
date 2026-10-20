# Prompt 019: Die Default-Designs der alten Version übernehmen

> **Slug:** `alte-designs` · **Braucht:** 013 (Theme-Mechanik), 004 (aktives/inaktives Panel), 006 (Dialoge) ·
> **Umfang:** M · Reihenfolge: direkt nach 013 bzw. sobald 004/006 stehen.
> Lies zuerst `prompts/000-arbeitsweise.md`. Quelle: `docs/legacy-themes/` (acht JSON-Dateien + README, von Marc
> als Default-Designs der alten Version übergeben – **unverändert lassen**).

## Ziel

Die acht Designs der alten Version – **light, paper, bitbucket, cypress, blackboard, coffee, combat, norton** – sind
die mitgelieferten Farbschemata der App. Wer sie aus der alten Version kennt, erkennt sie wieder: gleiche Farben für
Liste, Cursor, markierte Dateien, aktives Panel, Kopf, Fußleiste und Dialoge. Alte Theme-Dateien im Format
`{ name, colors: { "--fnf-…": … } }` lassen sich importieren.

## Ausgangslage

- Prompt 013 baut die Theme-Mechanik (Tokens, Umschalten, Live-Editor, Speichern, GuiExpert-Brücke). Dieser Prompt
  liefert die **Inhalte** und die Abbildung des alten Variablenschemas.
- Das alte Schema hat 76 Variablen mit Präfix `--fnf-` in Gruppen (Liste, aktives Panel, Kopf, Fußleiste, Dialoge,
  Akzentfarben, Scrollbar, Tooltip, Fehlerpanel) – Übersicht in `docs/legacy-themes/README.md`.
- Lücken: `coffee`/`norton` ohne `tooltip-*`, `norton` ohne `table-selected-row-fg-color`.
- Hinweis: `docs/legacy-analysis.md` §8 beschreibt die **noch ältere** Variante (32 Variablen, light/dark/blackboard)
  der AngularJS-Version. Maßgeblich für diesen Prompt sind die acht Dateien hier.

## Aufgaben

1. **Abbildung `--fnf-*` → App-Tokens** als Tabelle im Design-Dokument und als Code (eine Stelle, z. B.
   `src/app/core/theme/legacy-theme-map.ts`): jede der 76 Variablen auf ein Token aus `src/styles.scss` bzw. auf
   eine GuiExpert-Variable (`--ge-table-*`, über die Brücke aus 013). Fehlende Tokens ergänzen (aktives vs.
   inaktives Panel, Cursor im inaktiven Panel, markiert + Cursor, Tab aktiv/inaktiv, Funktionstasten-Leiste,
   Dialog-Buttons). Was keine Entsprechung hat (z. B. `material-*` für Angular Material, das wir nicht nutzen),
   begründet als „Akzentfarbe für …“ verwenden oder bewusst weglassen.
2. **Semantik prüfen** – im alten Programm hieß „selected“ = markiert und „focused“ = Cursor; das entspricht hier
   `fnf-marked` und `fnf-cursor` (Prompt 001). Aktives Panel: `activepanel-*` gilt nur für das Panel mit Fokus.
3. **Themes erzeugen**: die acht JSON-Dateien beim Build oder zur Laufzeit in Theme-Objekte des 013-Formats
   umwandeln (Variablen auflösen, `var()`-Ketten erhalten oder auflösen – entscheiden), Fallbacks für die Lücken
   (Tooltip aus Kopf-/Dialogfarben, Norton-Markierung z. B. Gelb `#ffff00` wie im Norton Commander – **Marc fragen**,
   nicht still festlegen).
4. **Auswahl**: alle acht in Einstellungen und Befehlspalette; „System folgen“ wählt ein helles und ein dunkles
   Design (Vorschlag: `light` / `coffee` – Marc entscheidet). Default beim ersten Start: `light`.
5. **Import/Export** alter Dateien (`{ name, colors }`) über den Theme-Dialog aus 013; unbekannte Variablen werden
   gemeldet, nicht verworfen.
6. **Kontrastbericht**: Für jedes Design WCAG-Kontrast für Text/Liste, Cursor, markiert, Kopf und Fußleiste
   berechnen (Test, der die Werte ausgibt). Die Originalfarben **nicht eigenmächtig ändern** – Abweichungen unter
   AA (4.5:1) im Bericht auflisten und Marc Vorschläge machen (z. B. `cypress` Text `#657786` auf `rgb(22,35,50)`).
7. **Ende-zu-Ende**: Screenshot je Design (light/dark-Umgebung egal) mit Dual-Pane, Cursor, Markierungen, Dialog;
   Vergleich mit der alten Version, falls Marc Screenshots liefert.

## Entscheidungsfragen

- Variablen 1:1 als `--fnf-*` übernehmen und unsere Tokens darauf zeigen lassen – oder auf unsere Tokens
  umrechnen (Empfehlung: umrechnen, alte Namen nur im Import)?
- Fallback-Farben für die Lücken (Marc).
- Paar für „System folgen“ (Marc).

## Akzeptanzkriterien

- Alle acht Designs wählbar, wirken auf App **und** GuiExpert Table, ohne Neustart.
- Jede der 76 Variablen ist abgebildet oder begründet ausgelassen (Test prüft Vollständigkeit der Tabelle).
- Import einer alten Datei ergibt dasselbe Design wie das mitgelieferte (Test).
- Kontrastbericht liegt vor; Originalwerte unverändert (Test vergleicht mit `docs/legacy-themes/*.json`).
