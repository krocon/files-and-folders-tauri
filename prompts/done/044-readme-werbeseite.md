# Prompt 044: README mit Feature-Screenshots (Norton) und Werbeseite für krocon.de/products/fnf

> **Slug:** `readme-werbeseite` · **Braucht:** Screenshot-Werkzeug (`pnpm screenshots`, `docs/screenshots.md`,
> Mock-Backend + Demo-Dateisystem unter `scripts/screenshots/`), die erledigten Feature-Prompts (`prompts/done/`),
> `docs/features.md`, `docs/feature-parity.md` · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md` (Phasen; hier keine Rust-/Frontend-Änderung nötig, außer neuen Szenen),
> dann `docs/screenshots.md`, `scripts/screenshots/scenes.json` und die heutige `../../site/README.md`. Auftrag von Marc
> (21.10.2026).

## Auftrag (wörtlich)

> das readme.md im projektroot bitte ändern:
>
> analog: https://www.npmjs.com/package/files-and-folders
>
> zu jedem tollen(*) Feature ein Screenshot (im Style Norton) mit Beschreibung des Feature.
>
> bitte auch eine SinglePage-Werbe-Seite auf englisch bauen, die auf die Bilder im Github-Repo verweist, da ich die
> Seite auf krocon.de/products/fnf hosten werde.
>
> *: recherchiere , was die tollen features sind.

## Vorbild

Die README von `files-and-folders` auf npm (Marcs alte Version, 2016): Titel mit Kürzel „FnF“, kurzer Pitch,
Liste „Main features“, danach **je Funktion eine kurze Überschrift mit ein, zwei Sätzen** und – bei den
wichtigen – **einem Screenshot** (Farbschemata, Multi Rename, Group Files, Change Dir). Ton persönlich und
werbend („Become a master of file management“), Installation in wenigen Schritten. Das wird hier modern und
vollständig umgesetzt: jedes ausgewählte Feature bekommt ein Bild.

## Aufgaben

1. **Recherche „tolle Features“ (Phase 1, Ergebnis im Design-Dokument):** aus `prompts/done/*` (Ziele, Akzeptanz­
   kriterien), `docs/features.md`, `docs/feature-parity.md` (was ist **neu** gegenüber mr) und der heutigen README
   eine Rangliste von 12–18 Features bilden, die einen Nutzer überzeugen – nach Nutzen, nicht nach Aufwand.
   Kandidaten (prüfen, ergänzen, kürzen): Zwei-Panel-Layout mit Tabs, Tastatur zuerst + Command Palette,
   Jobs im Hintergrund mit Pause/Konflikten, Papierkorb/Sicherheit, Multi-Rename mit Vorschau und Undo,
   Dateien gruppieren / Ordner aufräumen, Suche mit Ergebnis-Tab, Archive (ZIP/7z/RAR) wie Ordner,
   Server-Verbindungen FTP/FTPS/SFTP mit Schlüsselbund, Speicherbelegung (Ringe/Kacheln), Duplikate, Vorschau/
   Schnellansicht, Attribute ändern, Shell-Zeile, Farbschemata (die acht klassischen + Live-Editor), Starter-Menü,
   Panel-Aktionen, Ordnergedächtnis, Drag & Drop/Links, Import der alten Konfiguration, Deutsch/Englisch.
   Je Feature: ein Satz Nutzen, zwei, drei Sätze Details, Tastenkürzel (Win/Linux und macOS).
2. **Screenshots im Design „Norton“** (`classic-norton`), eines je ausgewähltem Feature, mit dem vorhandenen
   Werkzeug (Playwright + Mock-Backend, reproduzierbar, kein echtes Nutzerverzeichnis): fehlende Szenen in
   `scripts/screenshots/scenes.json` ergänzen (z. B. Server-Dialog, Starter-Menü, Shell-Zeile mit Ausgabe,
   Schnellansicht, Attribute, Ordnergedächtnis ist kein Bild → weglassen oder kombinieren). Das Mock-Backend um
   die nötigen Antworten erweitern (Demo-Daten, keine Geheimnisse, keine echten Hosts). Neues Ziel
   `pnpm screenshots:readme` → `docs/screenshots/readme/<feature>.png` (pngquant, Breite einheitlich, z. B.
   1280 × 760, @1x; optional @2x für die Webseite). Ein Übersichtsbild „alle Farbschemata“ bleibt.
3. **README.md neu** (Englisch, wie heute): Titel „Files and Folders (FnF)“, Ein-Satz-Pitch, Hero-Bild (Norton),
   Badges nur wenn sinnvoll (Lizenz, Plattformen), „Main features“ als kurze Liste mit Ankern, dann je Feature
   Überschrift + Text + Screenshot + Kürzel; danach Installation/Download (Stand `docs/release.md` ehrlich: noch
   unsigniert), Tastenkürzel-Auswahl, Anpassen, Entwicklung (kurz, Verweis auf `CLAUDE.md`/`docs/`),
   Geschichte (2016 AngularJS/Node → 2025 mr → Tauri), Lizenz. Ton: persönlich, werbend, aber nichts versprechen,
   was nicht geht (macOS/Windows ungeprüft kennzeichnen, solange die CI fehlt). Bilder relativ verlinkt.
   `docs/features.md` bleibt die ausführliche deutsche Referenz.
4. **Werbeseite (Single Page, Englisch)** unter `../../site/index.html` (eine Datei, CSS inline, kein Build, kein
   Framework, keine externen Tracker/Fonts/CDNs – DSGVO, Hosting auf `krocon.de/products/fnf`):
   - Bilder **aus dem GitHub-Repo** einbinden: `https://raw.githubusercontent.com/krocon/files-and-folders-tauri/main/docs/screenshots/readme/<feature>.png`
     (Konstante am Seitenanfang, damit Branch/Pfad an einer Stelle änderbar sind); `alt`-Texte, `loading="lazy"`,
     feste `width`/`height` gegen Springen.
   - Aufbau: Hero (Name, Pitch, Hauptbild, Knöpfe „Download“ → GitHub Releases, „Source on GitHub“), Feature-
     Abschnitte abwechselnd Bild links/rechts, Abschnitt Tastatur/Command Palette, Farbschemata-Galerie, Plattformen,
     FAQ (kostenlos? MIT; signiert? noch nicht; Daten? bleibt lokal, Passwörter im Schlüsselbund), Footer mit
     Impressum-Link auf `https://krocon.de` (Marc pflegt das Impressum dort) und Lizenz.
   - Optik angelehnt an Norton (Blau/Türkis/Gelb, Monospace-Akzente), modern, responsiv (Mobil zuerst, keine
     horizontale Scrollleiste), hell/dunkel über `prefers-color-scheme`, Kontrast WCAG AA, Fokus sichtbar,
     `prefers-reduced-motion` respektiert. Meta: Titel, Beschreibung, Open-Graph-Bild (Hero), `lang="en"`.
   - Optional `../../site/README.md`: wie Marc die Seite hochlädt (nur `../../site/index.html` + ggf. Favicon), keine Server-Logik.
5. **Prüfen:** Links und Anker der README (Bilder existieren), Seite lokal mit Playwright in 375 px und 1440 px
   Breite rendern und ansehen, Lighthouse/axe falls verfügbar (Ziel: Barrierefreiheit ≥ 95), keine 404 bei den
   raw-GitHub-URLs nach dem Push.

## Akzeptanzkriterien

- README zeigt 12–18 Features, jedes mit Norton-Screenshot, kurzer Beschreibung und Kürzeln; Reihenfolge nach Nutzen.
- Alle Screenshots entstehen reproduzierbar mit einem Befehl aus dem Repo (kein Handbetrieb), Design `classic-norton`.
- `../../site/index.html` ist eine einzelne, statische Datei, lädt Bilder nur von `raw.githubusercontent.com` (Repo
  `krocon/files-and-folders-tauri`), funktioniert ohne JavaScript und sieht auf Handy und Desktop gut aus.
- Keine Aussage auf README/Seite, die der Stand nicht hält (Signierung, Plattformen, Funktionen).

## Tests

- `scripts/screenshots.test.mjs`: neue Szenen laufen im Mock-Backend durch (Smoke).
- Ein kleiner Node-Test prüft, dass jede in README und `../../site/index.html` referenzierte Bilddatei unter
  `docs/screenshots/readme/` existiert.
- Sichtprüfung der Seite (Screenshots im Bericht beschreiben).
