# Prompt 066: Neues Farbschema „Mystico – C64“

> **Slug:** `mystico-c64-theme` · **Braucht:** 013 (Farbschemata), 015 (Einstellungen), am besten nach **062–065**
> (gleiches Vorgehen, gleiche Tests) · **Umfang:** XS–S (reines Frontend, Daten + Tests)
> Lies zuerst `prompts/000-arbeitsweise.md`, `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“, `prompts/062-one-dark-themes.md`
> (Aufbau, Akzeptanz, Tests gelten hier genauso), `core/theme/builtin-themes.ts`, `core/theme/themes/dark.json`,
> `core/theme/theme-logic.ts` (`CONTRAST_PAIRS`). Kein Design-Dokument; Zuordnung und Abweichungen im Bericht.
> **Vorlagen von Marc (01.11.2026):** zwei Screenshots des VS-Code-Themes „Mystico – C64“
> ([`066-mystico-c64-theme-beispiel.png`](066-mystico-c64-theme-beispiel.png): `main.js`, kompakt;
> [`066-mystico-c64-theme-beispiel-2.png`](066-mystico-c64-theme-beispiel-2.png): VS Code for the Web mit Explorer, Tabs,
> Split) und die Notepad++-Umsetzung [`066-mystico-c64/MysticoNpp_C64.xml`](066-mystico-c64/MysticoNpp_C64.xml).
> **Maßgeblich sind die Bilder** – die Farben unten sind aus ihnen gemessen. Die N++-Datei mischt Zenburn-Syntaxfarben
> hinein und passt nur bei Grundfläche und Rändern.

## Auftrag (Marc)

Neues Theme „Mystico – C64“, Farben wie im Bild.

## Herkunft und Lizenz

- Original: VS-Code-Theme „Mystico C64“ von chibanti (`github.com/chibanti/mystico-c64-vscode-theme`) – **Lizenz dort
  prüfen** und im Bericht nennen.
- `MysticoNpp_C64.xml` von luk3Z, **GPL-2** – nur als Referenz, **nichts daraus kopieren** außer einzelnen Farbwerten
  (Farbwerte sind keine Schöpfung; trotzdem Herkunft vermerken). Die Datei wird nicht ins Produkt übernommen.
- Die Grundfarben sind die Farben des Commodore 64 (Blau/Hellblau des Startbildschirms) – Name „C64“ nur beschreibend,
  kein Commodore-Logo, keine C64-Schrift (Lizenzen der Retro-Fonts sind meist restriktiv).

## Palette (aus den Bildern gemessen)

| Rolle | Wert | Wo im Bild |
|---|---|---|
| Editor-/Listenfläche, Seitenleiste, Statuszeile (Bild 2) | `#3c319c` | C64-Blau, große Flächen |
| Rahmen, Titel, Aktivitätsleiste, Statuszeile (Bild 1), Kopf der Seitenleiste | `#7a70d3` | C64-Hellblau (der „Rand“) |
| Tab-Leiste | `#695ece` | Leiste hinter den Tabs, Breadcrumb |
| aktiver Tab, aktuelle Zeile, Auswahl | `#8e85da` | `main.js`-Tab, Zeile 25 |
| Kommandofeld / Hover | `#8177d5`, `#9a92de` | Suchfeld oben (Bild 2) |
| Trennlinien, Zeile-Auswahl (Explorer) | `#554ab2`, `#584fa9` | Einrückungslinien, `readme.md` im Explorer |
| Badge, Icons dunkel | `#332974` | Badge „3“, Aktivitäts-Icons |
| Schrift hell / Keywords | `#ffffff` | `const`, `let`, `if`, `=>`, Titel |
| Variablen | `#8e85da` | `document`, `count`, `btn` |
| Funktionen | `#8abdc5` (Türkis) | `getElementById`, `render`, `addEventListener` |
| Strings | `#b9e893` (Hellgrün) | `'btn'`, `` `Count: …` `` |
| Zahlen | `#d2dc7f` (Gelb) | `0`, `10`, `1` |
| Operatoren | `#b17a70` (Braun-Rosa) | `=`, `+=`, `<` |
| Kommentare | `#808080` kursiv | `// Count from 1 to 10.` |
| Fehler-/Warnmarke (Bild 2) | Orange-Rot (`hello.ts 1`), Remote-Knopf Grün | Tab `hello.ts`, Statuszeile links |
| aus der N++-Datei (passend) | Fläche `#3e31a2`, Zeilennummern `#7c70da`, Markierungen `#68a941` (grün), `#70a4b2` (cyan), `#d0dc71` (gelb) | `GlobalStyles` |

Die zusätzlichen N++-Werte `#68a941`, `#70a4b2`, `#d0dc71`, `#7c70da` sind ebenfalls C64-Palette (Grün, Cyan, Gelb,
Hellblau) – gut als Akzente für Icons, Diff und Speicherbelegung.

## Zuordnung zu unseren Tokens (Vorschlag, im Bericht bestätigen)

- Flächen: `--color-list-bg`, Dialoge, Menüs `#3c319c`; Rahmen der App, Header, Footer, Button-Leiste, Tabs
  `#7a70d3`/`#695ece` (der typische C64-„Rand um den Bildschirm“); `--color-surface-raised` `#554ab2`;
  `--color-row-hover` `#4a40a8`; Gruppen-Wechsel `#41369f`.
- Text: Liste `#ffffff` bzw. sehr helles Lila (`#e2e0f0`); `--color-muted` heller als die Variablenfarbe
  (s. Kontrast), z. B. `#c2bee0`.
- **Cursor** (aktives Panel): C64-„Reverse“ – Fläche `#ffffff` (oder `#d6d2f5`), Schrift `#3c319c`; inaktiv `#8e85da`
  als Rahmen/Fläche mit weißer, fetter Schrift nur wenn Kontrast reicht (sonst `#554ab2` + `#ffffff`).
- **Markiert:** Gelb `#d2dc7f` (Schrift) – deutlich anders als Cursor und Text; Cursor auf Markiertem: Fläche Weiß,
  Schrift dunkles Gelb/Braun (`#6b5a00`) oder Fläche `#d2dc7f` + `#3c319c`.
- Versteckt `#c2bee0` kursiv, Symlink Türkis `#8abdc5`, Fehler Rosa/Rot (`#ff8a8a`, Kontrast prüfen).
- Akzent/Fokus `#b9e893` oder `#ffffff`; Primär-Button `#b9e893` mit `#2a2270` (C64-Grün auf Blau), normale Buttons
  `#554ab2` mit `#ffffff`.
- Gefahr: Fläche `#a0305a`-artig mit weißer Schrift, Text `#ffb3b3`.
- Suchtreffer: Gelb `#d2dc7f` als Fläche mit `#3c319c`.
- Diff: hinzugefügt `#2f6b4f`-Mischung (grün auf blau), entfernt `#7a2f5e`, geändert `#6b6431`.
- Datei-Icons: Ordner `#d2dc7f`, Code `#8abdc5`, Bild `#b9e893`, Video `#b17a70`, Audio `#70a4b2`, Archiv `#d0dc71`,
  Ausführbar `#68a941`, Dokument `#e2e0f0`.
- Shell-Leiste: Fläche `#3c319c`, Text `#7a70d3`/`#ffffff`, Prompt im C64-Stil (`READY.`-Optik nur über Farbe, nicht
  über Text), Fehler Rosa, Info Türkis.
- Scrollbar: Spur `#3c319c`, Daumen `#7a70d3`, aktiv `#8e85da`.
- Speicherbelegung: C64-Farben Grün/Cyan/Gelb/Braun, frei `#554ab2`.

## Kontrast (Blau ist mittelhell – Vorsicht)

- `#8e85da` (Variablen) auf `#3c319c` ≈ 3,1:1, `#808080` (Kommentare) ≈ 2,5:1 – als Text zu schwach; nur für
  Deko/Linien oder aufhellen.
- Weiß auf `#3c319c` ≈ 9,9:1 – gut. Weiß auf `#7a70d3` ≈ 4,1:1 – knapp unter AA → Header/Footer-Text fett/größer reicht
  laut Test nicht; Fläche `#695ece` (≈ 5,1:1) nehmen oder Text dunkel `#1a1450` nur wenn ≥ 4,5:1.
- Weiß auf `#8e85da` (aktiver Tab) ≈ 3,2:1 → Tab-Text dunkel `#2a2270` oder Fläche dunkler.
- `#d2dc7f`, `#b9e893`, `#8abdc5` auf `#3c319c` jeweils ≥ 6:1 – gut für Text.
Alle `CONTRAST_PAIRS` müssen bestehen (keine automatische Korrektur); Abweichungen vom Bild im Bericht.

## Aufgaben

1. `themes/mystico-c64.json` (alle Tokens wie `dark.json`, gleiche Reihenfolge), Registrierung in `builtin-themes.ts`
   (Id `mystico-c64`, Name „Mystico – C64“, `dark: true`), Reihenfolge im Dialog nach 065.
2. Kontrast prüfen und Werte anpassen.
3. Sichtprüfung: `pnpm screenshots --theme mystico-c64 --scene <alle> --out <dir>` und mit beiden Beispielbildern
   vergleichen (Gesamteindruck: hellblauer Rahmen um dunkelblaue Flächen, weiße Schrift, Gelb/Grün/Türkis als Akzente).
   Zwei bis drei Screenshots im Bericht beschreiben.
4. Lizenz des VS-Code-Originals klären (s. o.).

## Akzeptanzkriterien

1. Im Dialog „Colour schemes…“ steht „Mystico – C64“; Auswahl wirkt sofort und übersteht einen Neustart.
2. Das Hauptfenster wirkt wie die Beispielbilder: Listen `#3c319c`, Rahmen/Kopf/Footer Hellblau, weiße Schrift.
3. Cursor, Markiert, Cursor auf Markiertem, versteckt, Symlink, Fehler sind klar unterscheidbar.
4. Alle Kontrastpaare bestehen (Test); Export/Re-Import ergibt dasselbe Schema; `pnpm check` grün.

## Tests

- `builtin-themes.spec.ts`: Schema vorhanden, Schlüssel vollständig wie `dark`, `dark: true`.
- `theme-logic.spec.ts`: Kontrastpaare ≥ Grenzwert.
- `theme.service.spec.ts`: Auswahl per Id, Persistenz.

## Nicht in diesem Prompt

- C64-Schriftart, Blinkcursor-Animation, `READY.`-Texte, Syntax-Highlighting im Viewer, Übernahme der GPL-Datei.
