# Werbeseite krocon.de/products/fnf

Eine statische Seite auf Englisch (Prompt 044): `index.html` mit CSS inline, **ohne JavaScript, ohne Webfonts,
ohne Tracker, ohne Anfragen an fremde Server**. Die Bilder liegen in `img/` neben der Seite.

## Hochladen

```bash
pnpm screenshots           # nur wenn sich die Oberfläche geändert hat (Bilder in screenshots/classic-norton/)
pnpm site                  # baut site/dist/: index.html, favicon.png, img/*.png
```

Den **Inhalt** von `site/dist/` in den Ordner `/products/fnf` des Webspaces kopieren (z. B. per FTP – FnF selbst kann das:
`Ctrl+K` / `⌘K`). Danach ist die Seite unter `https://krocon.de/products/fnf/` erreichbar. Serverlogik gibt es keine.

```
/products/fnf/index.html
/products/fnf/favicon.png
/products/fnf/img/main.png … (19 Bilder, zusammen ~3,1 MB)
```

## Hinweise

- **Datenschutz:** Die Seite lädt nichts von anderen Servern, setzt keine Cookies und hat kein JavaScript. Es
  bleiben nur die üblichen Zugriffsprotokolle des eigenen Webservers. Impressum und Datenschutzerklärung: Link im
  Fuß auf `https://krocon.de`.
- **Open-Graph-Bild** (Vorschau beim Teilen): `https://krocon.de/products/fnf/img/main.png` – passt nur, wenn die
  Seite wirklich unter `/products/fnf/` liegt; sonst `og:url`/`og:image` im Kopf der Seite anpassen.
- **Bilder an anderer Stelle:** Alle `<img>` beginnen mit `img/` (Kommentar `IMG_BASE` im Kopf); ein Test
  (`scripts/site.test.mjs`) prüft das und dass jedes Bild existiert.
- **Texte ändern:** direkt in `index.html`. Was die Seite verspricht, muss der Stand halten (Signierung,
  Plattformen, Funktionen) – gleiche Aussagen wie in der README.
- Lokal ansehen: `site/index.html` oder `site/dist/index.html` im Browser öffnen.
