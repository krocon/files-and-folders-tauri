# Prompt 013: Themes und Farbschemata

> **Slug:** `themes-farbschemata` · **Braucht:** 001 · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §8 (32 CSS-Variablen,
> light/dark/blackboard), §3 (Color-Config-Dialog ohne Speichern).

## Ziel

Farbschemata als Dateien mit CSS-Variablen – wie im alten Programm, aber vollständig: Hell, Dunkel, Blackboard und
ein klassisches Total-Commander-Schema, Auswahl „System folgen“, ein Live-Editor mit Speichern, und eine saubere
Brücke zu den `--ge-table-*`-Variablen der GuiExpert Table.

## Aufgaben

1. **Token-Modell**: die Tokens aus `src/styles.scss` als Quelle; Zuordnung der alten 32 Variablen
   (legacy §8: `--cursor-row-*`, `--item-selected-color` …) auf neue Tokens als Tabelle im Design (Migration alter
   Schema-Dateien möglich). Fehlende Tokens ergänzen: Cursor-Zeile aktiv/inaktives Panel, markiert, markiert +
   Cursor, versteckt, Symlink, Fehler, Panel-Kopf aktiv/inaktiv, Fußleiste, Scrollbar.
2. **GuiExpert-Brücke**: jedes relevante `--ge-table-*` auf ein Token mappen (eine Stelle, z. B.
   `src/styles/ge-table-theme.scss`); `html[data-theme]` der Table mit unserem Theme-Schalter synchronisieren.
3. **Schemata**: `light`, `dark`, `blackboard` (Werte aus legacy §8 übernehmen), `classic` (TC-Blau);
   Auswahl in Einstellungen + Befehlspalette, „System folgen“ (Default, `prefers-color-scheme` live).
4. **Live-Editor**: Liste der Tokens mit nativer Farbauswahl (`<input type="color">` + Texteingabe), Vorschau
   sofort, Speichern als eigenes Schema (JSON im App-Config-Verzeichnis), Import/Export, Zurücksetzen.
   Kontrast-Hinweis (WCAG AA) für Text/Hintergrund-Paare.
5. Schriftart und -größe der Liste (kompakt/normal), Zeilenhöhe – als Tokens, in Einstellungen (Prompt 015).

## Akzeptanzkriterien

- Vier Schemata + „System folgen“; Wechsel ohne Neustart, auch in der Table.
- Eigenes Schema speichern, nach Neustart aktiv; Export/Import einer JSON-Datei.
- Alle Schemata erfüllen die Kontrastprüfung für Liste, Cursor und Markierung (Test, der die Werte prüft).
