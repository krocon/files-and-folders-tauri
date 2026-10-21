# Screenshots für jedes Farbschema

`pnpm screenshots` fotografiert die App in jedem Farbschema und in jeder Szene aus
[`scripts/screenshots/scenes.json`](../scripts/screenshots/scenes.json): Hauptfenster, Menüs und alle Dialoge.
Das Werkzeug entspricht dem Screenshot-Tool der Vorgängerversion (`files-and-folders-mr/apps/screenshot`,
Puppeteer + `data.json`). Hier läuft aber nicht die echte Tauri-App, sondern ihr gebautes Frontend in
Chromium mit einem nachgebauten Backend.

```bash
pnpm screenshots:install          # einmalig: Chromium für Playwright laden (~150 MB)
pnpm screenshots                  # baut das Frontend, dann 11 Farbschemata × 33 Szenen → screenshots/
```

Ergebnis: `screenshots/<farbschema>/<szene>.png` (der Ordner ist in `.gitignore`). Ein voller Lauf dauert
einige Minuten.

## Optionen

| Option | Bedeutung |
| --- | --- |
| `--theme classic-norton,dark` | nur diese Farbschemata (Liste: `--list`) |
| `--scene main,actions-menu` | nur diese Szenen |
| `--out docs/screenshots` | anderer Zielordner (relativ zum Repo) |
| `--flat` | ohne Unterordner je Farbschema (nur mit genau einem `--theme`) |
| `--platform linux\|windows\|macos` | Kürzel, Badges und Menüleiste dieses Systems (Standard `linux`: Menüleiste im Fenster) |
| `--lang en\|de` | Sprache der Oberfläche (Standard `en`) |
| `--width 1280 --height 760` | Fenstergröße in CSS-Pixeln |
| `--scale 2` | Retina-Auflösung (doppelte Pixel) |
| `--jobs 4` | parallele Browser-Seiten |
| `--no-build` | vorhandenes `dist/` nehmen statt `pnpm build` |
| `--chrome` | installiertes Google Chrome statt Playwrights Chromium (dann ist `screenshots:install` unnötig) |
| `--headed` | Browser sichtbar (zum Nachsehen beim Schreiben neuer Szenen) |
| `--verbose` | Konsole des Browsers ausgeben |
| `--docs` | die Bilder für README/Doku (s. u., = `pnpm screenshots:docs`) |

## Bilder für README und Doku

`pnpm screenshots:docs` erzeugt die eingecheckten Bilder in `docs/screenshots/` neu: die Auswahl aus
`scenes.json` → `"docs"."images"` (Szene + Farbschema + Dateiname) und `colour-schemes-overview.png`, eine
Kachelübersicht der Szene `main` in allen Farbschemata (Namen aus `"themeNames"`). Ist `pngquant` installiert
(`brew install pngquant`), werden die Bilder danach verlustarm komprimiert (~65 % kleiner; zusammen unter
1 MB). Feste Dateinamen: ein neuer Lauf überschreibt nur, `git diff` zeigt, welches Bild sich geändert hat.

Neu erzeugen nur, wenn sich die Oberfläche sichtbar geändert hat – jede Version eines Bildes bleibt in der
Git-Historie. Der volle Satz aus `pnpm screenshots` (~350 Bilder, ~60 MB) wird nicht eingecheckt
(`screenshots/` steht in `.gitignore`); für eine Galerie eignen sich ein Release-Anhang oder GitHub Pages.

Beispiele:

```bash
# nur zwei Szenen in einem Schema, ohne Unterordner
pnpm screenshots --theme classic-norton --scene main,actions-menu --out /tmp/fnf --flat
# alle Dialoge auf Deutsch mit macOS-Kürzeln in doppelter Auflösung
pnpm screenshots --lang de --platform macos --scale 2 --theme light
```

Umgebungsvariable `FNF_SCREENSHOT_CHROMIUM=<pfad>`: eigenes Chromium-Binary (z. B. in der Container-Sitzung
`/opt/pw-browsers/chromium`).

## Wie es funktioniert

```
scripts/screenshots/
  run.mjs           Runner: baut dist/, startet einen kleinen HTTP-Server, steuert Chromium (Playwright)
  mock-backend.js   läuft vor der App in der Seite: setzt window.__TAURI_INTERNALS__ (wie @tauri-apps/api/mocks)
                    und beantwortet invoke() aus dem Demo-Dateisystem; Jobs (Suche, Zählen) über den Channel
  demo-fs.mjs       Demo-Dateisystem unter /home/marc: Fotos „Italy 2026“, Downloads, Musik … und das echte
                    Repo (git ls-files) als Projektordner; feste Namen, Größen und Zeiten
  lib.mjs           reine Helfer (Keymap-Notation → Playwright-Tasten, Optionen) – Tests in scripts/screenshots.test.mjs
  scenes.json       Farbschemata, gemeinsamer Vorlauf (prelude) und Szenen
```

- Die App merkt nichts davon: `isTauri()` ist wahr, `invoke()` landet im Mock. Es gibt keinen Produktivcode
  für Screenshots und kein Feature-Flag.
- Der Mock ändert nie etwas. Speichern, Kopieren, Löschen usw. antworten „ok“ bzw. bleiben als laufender Job
  stehen.
- Sitzung: links der Projektordner (+ Tabs Downloads, Music), rechts die Fotos (+ Tab Home). Der Vorlauf
  markiert vier Fotos. Datum im ISO-Format und Zeitzone UTC, damit die Bilder auf jedem Rechner gleich sind.
- Schriften: die App nutzt die Systemschrift. Bilder vom Mac sehen daher etwas anders aus als Bilder aus
  Linux.

## Szene hinzufügen

Ein Eintrag in `scenes.json`:

```json
{ "name": "copy-dialog", "steps": [{ "action": "OPEN_COPY_DLG" }] }
```

Schritte:

- `{ "action": "ID" }`: drückt das erste Kürzel der Aktion aus der Keymap des gewählten Systems. Aktionen ohne
  Kürzel laufen über die Befehlspalette (englischer Name aus `action-catalog.ts`).
- `{ "key": "ArrowDown" }`: eine Taste (Playwright-Notation, z. B. `Control+KeyA`).
- `{ "type": "*.jpg" }`: Text tippen.
- `{ "wait": 500 }`: warten (ms).
- `{ "click": "css-selector" }`: klicken.

Weitere Felder sind `"prelude": false` (ohne gemeinsamen Vorlauf), `"mock": { "jobs": true }`
(Task-Liste mit Beispieljobs) und `"mock": { "bigFiles": true }` (ein paar große Dateien in sonst leeren
Ordnern, damit die Speicherbelegung etwas zu zeigen hat – Szene `disk-usage`). Braucht eine neue Szene einen Command, den der Mock noch nicht kennt
(Antwort `null`), ergänzt man ihn in `mock-backend.js` mit der Form aus dem passenden `*.models.ts`.
`pnpm scripts:test` prüft, dass jede Aktion der Szenen auf allen drei Systemen auslösbar ist.
