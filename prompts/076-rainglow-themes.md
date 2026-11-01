# Prompt 076: Vier neue Farbschemata aus Rainglow – „Bold“, „Earthsong“, „Legacy“, „Heroku“

> **Slug:** `rainglow-themes` · **Braucht:** 013 (Farbschemata), 015 (Einstellungen), am besten nach **062–066**
> (gleiches Vorgehen, gleiche Tests) · **Umfang:** S (reines Frontend, Daten + Tests)
> Lies zuerst `prompts/000-arbeitsweise.md`, `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“, `prompts/062-one-dark-themes.md`
> (Aufbau, Akzeptanz, Tests gelten hier genauso), `core/theme/builtin-themes.ts`, `core/theme/themes/dark.json`,
> `core/theme/theme-logic.ts` (`CONTRAST_PAIRS`). Kein Design-Dokument; Zuordnung und Abweichungen im Bericht.
> **Vorlagen von Marc (01.11.2026)** in [`076-rainglow/`](076-rainglow/): die VS-Code-Themes `bold.json`,
> `earthsong.json`, `legacy.json`, `heroku.json` (geladen aus `github.com/ahmadawais/vscode-1`, Ordner `themes/`, Stand
> 01.11.2026) und `LICENSE`. Screenshots (VS Code, React-`App.js`):
> [Bold](076-rainglow-bold-beispiel.png) (Statuszeile türkis), [Earthsong](076-rainglow-earthsong-beispiel.png) (grün),
> [Legacy](076-rainglow-legacy-beispiel.png) (blau), [Heroku](076-rainglow-heroku-beispiel.png) (violett).
> Nummer 076 auf Marcs Wunsch – 067–075 sind (noch) frei.

## Auftrag (Marc)

Vier neue Themes: bold, earthsong, legacy, heroku.

## Herkunft und Lizenz

„Rainglow“ von Dayle Rees (Repo `rainglow/vscode`, Fork `ahmadawais/vscode-1`), **MIT** (`LICENSE`, „Copyright 2017-18
Dayle Rees“). Wir übernehmen nur Farbwerte in unser Token-Format; Herkunft wie in 062 vermerken (Theme-Doku bzw.
`docs/architecture.md`, Hinweis in `THIRD-PARTY-NOTICES` prüfen). `prompts/076-rainglow/` bleibt Referenz.

## Aufbau der Rainglow-Themes

Jedes Rainglow-Theme hat **eine Grundfläche in fünf Helligkeitsstufen** plus **drei bis vier Akzentfarben**; alle UI- und
Syntaxfarben werden daraus abgeleitet. Deshalb hier eine Tabelle je Schema mit genau diesen Bausteinen (Schlüssel aus der
JSON in Klammern).

| Rolle | Bold | Earthsong | Legacy | Heroku |
|---|---|---|---|---|
| Titel (`titleBar.activeBackground`) | `#1f1c1c` | `#2b2723` | `#191f27` | `#121218` |
| Eingabe (`input.background`) | `#1d1a1a` | `#282421` | `#171d24` | `#101015` |
| Dropdown (`dropdown.background`) | `#252121` | `#302c27` | `#1d242d` | `#17171e` |
| **Editor/Liste** (`editor.background`) | `#2a2626` | `#36312c` | `#212933` | `#1b1b24` |
| Aktivitätsleiste | `#2f2b2b` | `#3c3631` | `#252e39` | `#1f1f2a` |
| Tab-Leiste, Hover, aktuelle Zeile | `#322d2d` | `#3e3933` | `#27303c` | `#22222d` |
| inaktiver Tab | `#353030` | `#413b35` | `#29333f` | `#242430` |
| **Seitenleiste** (`sideBar.background`) | `#373232` | `#443e37` | `#2b3542` | `#262633` |
| Abschnittskopf | `#3f3939` | `#4c453e` | `#313d4c` | `#2c2c3b` |
| Panel, Widgets | `#453e3e` | `#524a43` | `#354252` | `#313141` |
| Zeilennummern, Scrollbar | `#605656` | `#6e645a` | `#495b71` | `#47475e` |
| Kommentare | `#534b4b` | `#7a7267` | `#425972` | `#505067` |
| **Text** (`editor.foreground`) | `#ffffff` | `#ebd1b7` | `#aec2e0` | `#c8c7d5` |
| **Statuszeile** (+ weiße Schrift) | `#3d8e91` türkis | `#95cc5e` grün | `#267fb5` blau | `#585480` violett |
| Fokus, Badge | `#3d8e91` | `#95cc5e` | `#267fb5` | `#585480` |
| **Listen-Auswahl** (Hintergrund / Schrift) | `#f0624b` / `#2a2626` | `#db784d` / `#36312c` | `#ffffff` / `#212933` | `#7873ae` / `#1b1b24` |
| Button | `#f0624b` | `#db784d` | `#ffb20d` | `#7873ae` |
| Fortschritt | `#b4b7ad` | `#60a365` | `#ffb20d` | `#ffffff` |
| Textauswahl (33 % Alpha) | `#3d8e9155` | `#db784d55` | `#ff410d55` | `#7873ae55` |
| Syntax: Keyword | `#f0624b` | `#db784d` | `#748aa6` | `#7873ae` |
| Syntax: String | `#f7a21b` | `#f8bb39` | `#ff410d` | `#a6fa62` |
| Syntax: Zahl | `#f7a21b` | `#f8bb39` | `#c7f026` | `#a6fa62` |
| Syntax: Funktion | `#b4b7ad` | `#60a365` | `#ffb20d` | `#ffffff` |
| Syntax: Tag / Library | `#3d8e91` | `#95cc5e` | `#267fb5` | `#585480` / `#a6fa62` |
| Rot (alle) | `#ba0e2e` | `#ba0e2e` | `#ba0e2e` | `#ba0e2e` |

Die Screenshots zeigen die Themes in einer älteren Rainglow-Version (Syntaxfarben leicht anders, z. B. Bold mit
Lachs-Keywords und Gelb-Strings) – **maßgeblich sind die JSON-Dateien**, die Bilder für den Gesamteindruck.

## Zuordnung zu unseren Tokens (Vorschlag, je Schema gleich)

- Flächen: `--color-list-bg` = Editor; `--color-bg`/`--color-surface` = Seitenleiste; Header = Tab-Leiste; Footer und
  Button-Leiste = Aktivitätsleiste/Titel; Dialoge = Panel/Widget; Eingaben = `input.background`; Menüs = Dropdown;
  `--color-row-hover` = Hover; Gruppen-Wechsel = inaktiver Tab.
- Text = `editor.foreground`; `--color-muted` aus den Zeilennummern **aufgehellt** (s. Kontrast).
- **Statuszeile** des Fensters = unsere Statuszeile je Panel (`--color-footer-*`) in der Signaturfarbe – sie macht den
  Charakter aus (Türkis/Grün/Blau/Violett). Alternativ nur das **aktive Panel** in Signaturfarbe, das inaktive neutral –
  im Bericht entscheiden und zeigen.
- **Cursor** = Listen-Auswahl (`list.activeSelection*`); inaktiver Cursor = Hover/Abschnittskopf mit Text.
- **Markiert:** die String-Farbe (Bold `#f7a21b`, Earthsong `#f8bb39`, Legacy `#ffb20d`, Heroku `#a6fa62`) – klar anders
  als Cursor und Text. Cursor auf Markiertem: Cursorfläche + dunkle Schrift, markiert über Unterstrich/fett, Lesbarkeit prüfen.
- Akzent/Fokus = Signaturfarbe; Primär-Button = `button.background`; Gefahr = `#ba0e2e` (Fläche) bzw. aufgehellt als Text.
- Datei-Icons aus Akzent + Syntaxfarben (Ordner = Signaturfarbe oder String-Farbe, Code = Funktion, Bild = Keyword …).
- Shell: Fläche = Editor, Prompt = Signaturfarbe, Fehler = Rot aufgehellt, Info = Funktion.
- Scrollbar: Daumen = Zeilennummernfarbe mit Alpha (`…aa`), aktiv = Signaturfarbe.
- Speicherbelegung: Signatur, String, Keyword, Funktion; frei = Abschnittskopf.

## Kontrast – bekannte Stolpersteine (nicht 1:1 übernehmen)

- **Weiße Schrift auf Statuszeile/Button:** Bold türkis ≈ 3,9:1, Earthsong grün ≈ 1,8:1, Legacy blau ≈ 4,4:1,
  Legacy-Button Gelb `#ffb20d` ≈ 1,9:1, Bold-Button `#f0624b` ≈ 3,2:1 – alle unter AA. Dunkle Schrift (= Editorfläche)
  nehmen oder die Fläche abdunkeln; Heroku (`#585480` ≈ 7:1) passt.
- **Cursor:** Earthsong `#db784d` + `#36312c` ≈ 4,2:1, Heroku `#7873ae` + `#1b1b24` ≈ 4,0:1 – knapp darunter; Fläche
  leicht aufhellen oder Schrift dunkler (Titelfarbe). Bold (≈ 4,7:1) und Legacy (Weiß) passen.
- **Kommentare/Zeilennummern** (`#534b4b`, `#425972`, `#505067` …) haben 1,5–2,5:1 – nur für Linien/Deko; gedämpfter
  Text deutlich heller.
- Rot `#ba0e2e` als Text auf dunkel ≈ 2–3:1 → Fehler-Text aufhellen (z. B. `#ff6b81`), Fläche mit weißer Schrift ok.
Alle `CONTRAST_PAIRS` müssen bestehen (keine automatische Korrektur); jede Abweichung von der Vorlage im Bericht.

## Aufgaben

1. `themes/rainglow-bold.json`, `themes/rainglow-earthsong.json`, `themes/rainglow-legacy.json`,
   `themes/rainglow-heroku.json` (alle Tokens wie `dark.json`, gleiche Reihenfolge); Registrierung in `builtin-themes.ts`,
   Namen „Bold“, „Earthsong“, „Legacy“, „Heroku“ (Eigennamen; ggf. mit Zusatz „(Rainglow)“ im Dialog, damit „Legacy“
   nicht mit den alten Designs `classic-*` verwechselt wird – im Bericht entscheiden). Ids mit Präfix `rainglow-`.
2. Optional, wenn klein: die Umrechnung als **Skript** (`scripts/rainglow-theme.mjs`: JSON → Token-Datei nach der
   Zuordnung oben), damit weitere Rainglow-Themes (es gibt > 100) später mit einem Befehl dazukommen; Ergebnis von Hand
   nachkorrigieren (Kontrast). Wenn zu groß: als Vorschlag in den Bericht.
3. Kontrast prüfen und Werte anpassen.
4. Sichtprüfung: `pnpm screenshots --theme rainglow-bold,rainglow-earthsong,rainglow-legacy,rainglow-heroku --scene
   <alle> --out <dir>`, Vergleich mit den vier Beispielbildern; je Schema ein bis zwei Screenshots im Bericht beschreiben.

## Akzeptanzkriterien

1. Im Dialog „Colour schemes…“ stehen die vier Schemata (eindeutig benannt); Auswahl wirkt sofort und übersteht einen Neustart.
2. Jedes Schema wirkt wie sein Beispielbild: Grundfläche und Seitenleiste in der Tabelle oben, Signaturfarbe an der
   Statuszeile/aktiven Panel.
3. Cursor, Markiert, Cursor auf Markiertem, versteckt, Symlink, Fehler sind in allen vier klar unterscheidbar.
4. Alle Kontrastpaare bestehen (Test); Export/Re-Import ergibt dasselbe Schema; `pnpm check` grün.

## Tests

- `builtin-themes.spec.ts`: vier Schemata, Schlüssel vollständig wie `dark`, `dark: true`, Ids eindeutig.
- `theme-logic.spec.ts`: Kontrastpaare ≥ Grenzwert für alle vier.
- `theme.service.spec.ts`: Auswahl per Id, Persistenz.
- Falls Skript (Aufgabe 2): `scripts/rainglow-theme.test.mjs` (node --test) mit einer der vier Dateien als Fixture.

## Nicht in diesem Prompt

- Weitere Rainglow-Themes (nur über das Skript, eigener Prompt), Syntax-Highlighting im Viewer.
