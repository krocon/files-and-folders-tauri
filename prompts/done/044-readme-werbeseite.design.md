# Design 044: README mit Feature-Screenshots (Norton) und Werbeseite

> **Status:** fertig · freigegeben von Marc am 22.10.2026 (F1 `img/`-Ordner, F2–F4 ja) · **Datum:** 22.10.2026 · **Branch:** `feat/readme-werbeseite`
> Auftrag: [044-readme-werbeseite.md](044-readme-werbeseite.md) · Regeln: [000-arbeitsweise.md](../000-arbeitsweise.md)

## Entscheidungen (Kurzfassung)

| # | Frage | Empfehlung |
|---|---|---|
| E1 | Welche Features? | **16 Features mit Bild**, Rangfolge nach Nutzen (Tabelle unten); weitere ~12 als Liste „And more“ ohne Bild |
| E2 | Wie viele neue Szenen? | **7 neue Szenen** (Konflikt, flache Ansicht, Archiv als Ordner, Server im Panel, Shell mit Ausgabe, Startermenü, Attribute), 2 vorhandene verbessert (Duplikate mit Vorschaubildern, Server-Profile auf Englisch) |
| E3 | Wie entstehen die Bilder? | neuer Block `"readme"` in `scenes.json` + `pnpm screenshots:readme` (= `run.mjs --readme`), Norton, Linux, Englisch, 1280 × 760 @1x, pngquant |
| E4 | @2x für die Webseite? | **nein** – die Seite zeigt die Bilder höchstens ~640–1100 CSS-px breit; 1280 px ist dort schon (fast) Retina. Spart ~3 MB im Repo |
| E5 | „Konstante“ für die Bild-URL ohne JavaScript? | **umgesetzt:** relative `img/…`, Basis im Kopfkommentar (`IMG_BASE: img/`), der Test erzwingt sie. `pnpm site` legt `site/dist/` an (Seite + `img/` + Favicon) |
| E6 | Bilder von GitHub vs. DSGVO | **Marc (F1): `img/`-Ordner** – die Seite lädt nichts von fremden Servern; weicht bewusst vom Auftrag (raw-GitHub) ab |
| E7 | Download-Knopf ohne Release | Knopf „Releases on GitHub“ + Hinweis „first public release coming soon – build from source today“; keine Versprechen |
| E8 | Alte Doku-Bilder `docs/screenshots/*.png` | bleiben (`pnpm screenshots:docs`, Galerie für andere Doku); die README nutzt nur noch `colour-schemes-overview.png` daraus |
| E9 | Phasen | klein: Phase 2 (Rust) entfällt; Phase 3 = Szenen/Mock + README + Seite + Tests; Phase 4 = Sichtprüfung der Bilder und der Seite (375/1440 px, axe) |

## 1. Bestand

| Baustein | wofür | Stand |
|---|---|---|
| `scripts/screenshots/run.mjs` (`--theme --scene --out --flat --docs`) | Bilder erzeugen | passt; `--readme` ergänzen (wie `--docs`, eigener Block + Zielordner) |
| `scenes.json` (36 Szenen) | Szenen | 10 der 16 Bilder vorhanden, 7 fehlen (E2) |
| `mock-backend.js` (Demo-FS, Jobs über Channel) | Antworten | fehlt: Konfliktfrage, Archiv-Listing, Remote-Listing, Shell-Ausgabe, Startermenü-Einträge, Duplikat-Vorschaubilder; Server-Profile heißen deutsch („Mein Server“, „NAS im Keller“) → englisch |
| `demo-fs.mjs` | Demo-Daten | `Italy 2026 best of.zip` braucht Inhalt (Einträge); Daten für die flache Ansicht sind da (Fotos in Unterordnern) |
| `scripts/screenshots.test.mjs` | Smoke | um „jede readme-Szene existiert, alle Aktionen auslösbar“ ergänzen |
| README.md (heute, 295 Zeilen) | | Inhalt gut und aktuell; Aufbau wird umgestellt (je Feature ein Abschnitt), Texte weitgehend übernommen |
| `docs/features.md` | deutsche Referenz | bleibt unverändert |
| Probelauf `pnpm screenshots --theme classic-norton` (36/36 in 50 s) | | alle Szenen laufen; `shell` ist leer, `duplicate-results` zeigt nur Datei-Icons statt Bilder |

## 2. Recherche: die „tollen“ Features (E1)

Quellen: `prompts/done/*`, `docs/features.md`, `docs/feature-parity.md` (Abschnitt A.4 „nur neu“), README.
Kriterium: Was überzeugt jemanden, der heute Finder/Explorer, Total Commander, Double Commander oder Marta nutzt?
„Neu ggü. mr“ = gibt es in der alten Version nicht.

| Rang | Feature (Anker) | Nutzen in einem Satz | Bild (Szene) | Kürzel Win/Linux · macOS | neu ggü. mr |
|---|---|---|---|---|---|
| 1 | **Two panels, tabs** (`two-panels`) | Quelle und Ziel nebeneinander, beliebig viele Tabs, alles übersteht einen Neustart | `main` (Hero) | `Tab`, `Ctrl+T`, `Ctrl+U` · `Tab`, `⌘⌥T`, `⌘U` | Tabs ziehen, Panel-Aktionen |
| 2 | **Keyboard first + Command Palette** (`keyboard`) | jede Funktion hat eine Aktion; tippen statt suchen | `command-palette` | `Ctrl+Shift+P`, `Ctrl+F12` · `⌘⇧P` | Palette |
| 3 | **Background jobs** (`jobs`) | Kopieren/Verschieben/Packen laufen weiter, während man arbeitet: Pause, Abbruch, Rate, Restzeit | `task-list` | `F5`/`F6`, Tasks `Ctrl+F11` | ✅ (mr hatte keine Pause) |
| 4 | **Safe by default** (`safety`) | Papierkorb, nie halbe Dateien unter echtem Namen, Konflikte „für alle“ | **neu** `conflict-dialog` | `F8` / `Shift+F8` · `F8`, `⌘⌫` | Konfliktdialog war in mr nicht da |
| 5 | **Multi rename + undo** (`multi-rename`) | hunderte Dateien in einem Rutsch, Vorschau vor dem Klick, Undo danach | `multi-rename-dialog` | `Ctrl+M` · `⌘F6` | Undo, Vorlagen |
| 6 | **Search into a tab** (`search`) | Treffer strömen in einen Tab, mit dem man wie mit einem Ordner arbeitet | `search-results` | `Alt+F7` · `⌥F7` | |
| 7 | **Flat view** (`flat-view`) | alle Dateien unterhalb eines Ordners in einer Liste – sortieren, markieren, umbenennen | **neu** `flat-view` | `Ctrl+B` · `⌘B` | ✅ |
| 8 | **Duplicates + similar images** (`duplicates`) | Speicher freiräumen; Regeln entscheiden, welche Kopie bleibt; ähnliche Fotos per pHash | `duplicate-results` (mit Vorschaubildern) | `Alt+Shift+F7` · `⌥⇧F7` | ✅ |
| 9 | **Disk usage** (`disk-usage`) | sehen, was den Platz frisst – Ringe/Kacheln, sammeln, entfernen | `disk-usage` | `Ctrl+Shift+D` · `⌘⇧D` | ✅ |
| 10 | **Archives as folders** (`archives`) | ZIP/TAR/7z/RAR öffnen wie Ordner, ansehen, packen/entpacken, Passwörter nur im Speicher | **neu** `archive-folder` | `Enter`, `Alt+F5`/`Alt+F9` · `⌥F5`/`⌥F9` | 7z, RAR, Passwörter |
| 11 | **FTP/FTPS/SFTP** (`servers`) | Server als Ordner im Panel, Passwörter nur im Schlüsselbund | **neu** `remote-panel` (Listing `remote://…`) | `Ctrl+K` · `⌘K` | ✅ |
| 12 | **Viewer + quick view** (`viewer`) | Text, Hex, Bilder; Schnellansicht im anderen Panel beim Blättern | `quick-view` | `F3`, `Ctrl+Q` · `F3`, `⌃Q` | Schnellansicht |
| 13 | **Compare files** (`compare`) | zwei Dateien nebeneinander mit Unterschieden, Binär byteweise | `compare-files` | Menü *File* · Menü *File* | ✅ |
| 14 | **Group files / clean folders** (`organize`) | Ordnung schaffen: Dateien nach Namen in Ordner, leere Ordner und Müll weg | `group-files-dialog` | `Alt+G`, `Ctrl+Alt+R` · `⌥G`, `⌘⌥R` | |
| 15 | **Shell line + starter menu** (`shell`) | Befehl im aktuellen Ordner, Ausgabe live; eigenes Startmenü mit TC-Parametern | **neu** `shell-output` (+ **neu** `starter-menu` als zweites Bild) | `Shift+F11`, `Alt+S` · `⇧F11`, `⌥S` | Startermenü ✅ |
| 16 | **Colour schemes** (`themes`) | die acht klassischen Designs + Live-Editor mit WCAG-Prüfung | `colour-schemes-dialog` + `colour-schemes-overview.png` | Menü *Tools* | Live-Editor, WCAG |

**Ohne Bild, als Liste „And more“:** Attribute ändern (Bild `attributes-dialog` wird erzeugt, aber nur auf der Seite
in einem kleinen Raster gezeigt – oder weglassen, s. F3), Prüfsummen, Ordnergedächtnis/Sitzung, Drag & Drop + Links,
Ziehen in andere Programme, Auto-Refresh, externe Tools ohne Shell, Ordner-Finder, Button-Leiste/Dateitypen-Editor,
Einstellungen mit Export/Import, Import der alten Konfiguration, Deutsch/Englisch, Langsame Laufwerke/Cache.

Texte je Feature: ein Satz Nutzen (fett), zwei, drei Sätze Details (aus `docs/features.md`, auf Englisch), eine
Kürzelzeile `Windows/Linux: … · macOS: …` – **aus den Keymap-JSONs abgeleitet**, nicht abgeschrieben (die heutige
README hat einzelne Abweichungen, z. B. Multi Rename).

## 3. Neue und geänderte Szenen (E2)

| Szene | Schritte | Mock |
|---|---|---|
| `conflict-dialog` | Vorlauf, dann `OPEN_TASK_DLG` → Konfliktfrage öffnet sich | `mock.jobs` + ein Job mit `conflict` (Quelle/Ziel mit Größe/Datum, Bild-Dateinamen) |
| `flat-view` | rechts `TOGGLE_FLAT_VIEW` auf „Italy 2026“ | Such-Job der Art `flat` liefert die Fotos aus Unterordnern (`relDir` gefüllt) |
| `archive-folder` | rechts Cursor auf `Italy 2026 best of.zip` (Demo-FS), `Enter` | `list_directory` für virtuelle Pfade `…zip/…` mit `archive`-Info |
| `remote-panel` | rechts Pfad `remote://k3x9a2/var/www` (über Verbinden-Dialog „Connect“) | `remote_connect` ok, `list_directory` für `remote://…`, Statuszeile „SFTP · example.org“; Hosts nur `example.org`/`nas.local` |
| `shell-output` | `TOGGLE_SHELL`, `git status` tippen, `Enter` | Job `shell` streamt feste Ausgabe (git status mit 3 Zeilen), keine echte Ausführung |
| `starter-menu` | `OPEN_STARTER_MENU` | `load_starter` mit 6 Einträgen (VS Code, GIMP, Terminal, Untermenü „Scripts“ …) |
| `attributes-dialog` | Vorlauf (4 Fotos markiert), `OPEN_CHANGE_ATTRIBUTES_DLG` | vorhandenes `get_properties` reicht vermutlich |
| `duplicate-results` (geändert) | wie heute | `duplicate_thumbnails` liefert Demo-Bilder (wie die Bildvorschau heute: generiertes SVG/PNG) |
| `connections-dialog` (geändert) | wie heute | Profilnamen englisch: „My server“, „NAS“, „Customer webspace“ |

Wenn eine Szene im Mock unverhältnismäßig aufwendig wird (Kandidat: `remote-panel`), nehme ich die vorhandene
Szene (`connections-dialog`) und notiere das im Fortschritt.

Keine Änderung am Produktivcode. Alle Daten sind Demo-Daten (`/home/marc/...` wie bisher), keine echten Hosts, keine
Geheimnisse.

## 4. Werkzeug (E3)

```jsonc
// scenes.json
"readme": {
  "out": "docs/screenshots/readme",
  "theme": "classic-norton", "platform": "linux", "lang": "en", "width": 1280, "height": 760,
  "images": [ { "file": "two-panels.png", "scene": "main" }, … ]
}
```

- `pnpm screenshots:readme` = `node scripts/screenshots/run.mjs --readme` (baut, fotografiert, pngquant wie `--docs`).
- Dateiname = Anker des Features (`two-panels.png`, `keyboard.png`, …), damit README, Seite und Test dieselbe Liste
  nutzen. Geschätzt 17 Bilder à ~80–150 KB nach pngquant ≈ 2 MB.

## 5. README (Aufbau)

1. Logo, Titel **Files and Folders (FnF)**, Pitch: *“A fast, keyboard-first two-panel file manager for macOS,
   Windows and Linux – in the spirit of Norton and Total Commander.”*
2. Badges: Lizenz MIT, Plattformen, Status „in development“ (keine Tech-Badges mehr – gehören nach unten).
3. Hero-Bild (`two-panels.png`), darunter „Become a master of file management“-Ton, persönlich (Marc, seit 2016).
4. Hinweis (ehrlich): noch kein Release, Pakete unsigniert; Tests laufen in der CI auf Linux, macOS und Windows,
   einzelne Plattformfunktionen sind dort noch nicht im Alltag erprobt – Formulierung nach dem Stand von `TODO.md` §3.
5. **Main features** – Liste der 16 mit Ankern.
6. Je Feature: `## <Titel>` · fetter Nutzen-Satz · Details · Kürzelzeile · Bild (relativ `docs/screenshots/readme/…`).
7. And more (Liste) · All colour schemes (Übersichtsbild) · Install/Download · Keyboard shortcuts (Auswahl, wie
   heute) · Customization (gekürzt) · Development (kurz, Verweis `CLAUDE.md`, `docs/`) · History · License.

## 6. Werbeseite `../../site/index.html`

- Eine Datei, CSS inline, **kein JavaScript nötig** (gar keins vorgesehen), keine Fonts/CDNs/Tracker; Schrift:
  System-UI + `ui-monospace` für Akzente.
- Abschnitte: Hero (Name, Pitch, Hero-Bild, Knöpfe „Releases on GitHub“, „Source on GitHub“) · Feature-Abschnitte
  abwechselnd links/rechts (16) · Keyboard/Command Palette mit Tasten-Kacheln (`kbd`) · Farbschemata (Übersichtsbild) ·
  Plattformen (ehrlich) · FAQ (kostenlos? MIT · signiert? noch nicht · Daten? bleiben lokal, Passwörter im
  Schlüsselbund, keine Telemetrie) · Footer: Impressum/Datenschutz → `https://krocon.de`, Lizenz, GitHub.
- Optik Norton: Dunkelblau `#0000a8`-artig, Türkis-Akzent, Gelb für Knöpfe/Hervorhebung, Monospace-Überschriften mit
  Rahmen im DOS-Stil (CSS-Rahmen, keine Bilder); hell/dunkel über `prefers-color-scheme` (hell = Papier/Blau),
  Kontrast AA, sichtbarer Fokus, `prefers-reduced-motion`, mobil zuerst, keine horizontale Scrollleiste.
- `<img … width="1280" height="760" loading="lazy" decoding="async" alt="…">` (Hero ohne `lazy`), Open Graph:
  Titel, Beschreibung, `og:image` = Hero (absolute raw-URL), `lang="en"`.
- `../../site/README.md`: Hochladen (nur `../../site/index.html`, optional `favicon.png` aus `docs/logo/`), Basis umstellen, Hinweis
  Datenschutz (F1).

## 7. Tests und Prüfung

- `scripts/screenshots.test.mjs`: jede `readme`-Szene existiert in `scenes`, Aktionen sind auf allen drei Systemen
  auslösbar (vorhandene Prüfung erweitert), Dateinamen eindeutig.
- `scripts/readme-images.test.mjs` (neu, `node --test`, läuft in `pnpm check` über `scripts:test`): jedes Bild in
  README und `../../site/index.html` unter `docs/screenshots/readme/` existiert; alle `<img>` der Seite nutzen die eine
  Basis; jeder README-Anker der Feature-Liste hat eine Überschrift; jedes Bild aus `scenes.json` → `readme` wird
  benutzt.
- Sichtprüfung: alle 17 Bilder ansehen; Seite mit Playwright in 375 px und 1440 px (hell + dunkel) rendern; axe-core
  (falls per npm im Container ladbar, nur temporär, keine neue Abhängigkeit) → Ziel 0 Verstöße. Lighthouse nicht im
  Container.
- Nach dem Push: `curl -I` auf die raw-URLs (aus dem Container über den Proxy, sonst Marc).
- `pnpm check` grün.

## Offene Fragen an Marc

- **F1 (DSGVO):** Bilder direkt von `raw.githubusercontent.com` zu laden heißt, jeder Besucher von krocon.de/products/fnf
  schickt seine IP an GitHub. Möglichkeiten: (a) so lassen und in der Datenschutzerklärung von krocon.de erwähnen,
  (b) die Seite mit einem Ordner `img/` daneben hochladen (die Basis ist ein Suchen/Ersetzen, `pnpm site:base img/`),
  (c) beides vorbereiten, du entscheidest beim Hochladen. **Empfehlung: (c)**, Standard = raw-GitHub wie beauftragt.
- **F2:** 16 Features mit Bild – passt die Rangfolge? Etwas, das unbedingt nach vorn (oder raus) soll?
- **F3:** „Attribute ändern“ bekommt nur einen Listeneintrag (kein eigener Abschnitt). Ok?
- **F4:** Ton „persönlich“: darf die README in der Ich-Form von dir sprechen („I've been building file managers
  since 2016 …“)?

## Antworten (22.10.2026)

F1: `img/`-Ordner neben der Seite (statt raw-GitHub). F2: Rangfolge passt. F3: Attribute nur als Listeneintrag.
F4: README in der Ich-Form.

## Abweichungen bei der Umsetzung

- **18 Bilder** statt 17: zusätzlich `actions-menu.png` (README: aufklappbar unter „Keyboard first“, Seite: Abschnitt
  Tastatur). Szene `attributes-dialog` existiert, wird aber nicht benutzt (F3).
- Duplikate: neue Szene **`similar-images`** (Modus „ähnliche Bilder“ mit Vorschaubildern, Token `name#v` = getönte
  Variante) statt die alte `duplicate-results` zu ändern – die bleibt für `pnpm screenshots`.
- Starter und Shell: eine gemeinsame Rubrik wurde zu zwei Abschnitten (Shell line, Starter menu), README listet 17
  Features + „And more“.
- Szenen können `"ready"` setzen (Text, auf den der Runner wartet) – Archiv- und Serverszene zeigen kein
  `IMG_4711.jpg`.
- Neue Mock-Optionen: `conflict`, `photoFolders`, `archive`, `remote`, `shellHeight`; neue Commands im Mock:
  `run_shell` (feste `git status`-Ausgabe), `duplicate_thumbnails`; `load_starter` mit Demo-Einträgen.
- Die Werbeseite zeigt „Two panels“ als Hero statt als eigenen Abschnitt.

## Fortschritt

- [x] Phase 1: Recherche, Probelauf aller Szenen in Norton (36/36), Entwurf, Freigabe
- [x] Phase 3a: 8 Szenen + Mock + `pnpm screenshots:readme` (18 Bilder, pngquant 2,9 MB → 1 MB), alle angesehen
- [x] Phase 3b: README (17 Features + „And more“), `../../site/index.html`, `../../site/README.md`, `pnpm site`, Tests
  (`scripts/site.test.mjs`, `scripts/screenshots.test.mjs`)
- [x] Phase 4: Seite mit Playwright in 375 px und 1440 px, hell und dunkel: keine horizontale Scrollleiste, axe-core
      4.10 (WCAG 2.1 A/AA + best practice) ohne Verstoß; Lighthouse nicht im Container
- [x] Phase 5/6: Doku (`docs/screenshots.md`, CLAUDE.md, Index, Roadmap), `pnpm check`
- [ ] Bei Marc: `pnpm site` und `site/dist/` nach krocon.de/products/fnf hochladen; Seite einmal im echten Browser ansehen
