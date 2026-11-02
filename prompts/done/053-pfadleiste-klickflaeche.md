# Prompt 053: Freie Fläche der Pfadleiste – Pfad eingeben, sauber anzeigen, Klickbarkeit dezent zeigen

> **Slug:** `pfadleiste-klickflaeche` · **Braucht:** 003 (Navigation, „Go to path“ `OPEN_CHDIR_DLG`), 004 (Header), 034 (Server-URLs im Pfadfeld) · **Umfang:** S (reines Frontend, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md` und **049** (Header-Höhe) – 053 und 049 ändern dieselben Stellen
> (`file-panel.html/.css`, `.crumbs`, `.path-form`, `.path-input`); wer zuerst umgesetzt wird, prüft die Akzeptanzkriterien
> des anderen mit, damit nichts doppelt oder gegeneinander gebaut wird.
> Screenshots von Marc (01.11.2026): [`053-pfadleiste-klickflaeche-beispiel.png`](053-pfadleiste-klickflaeche-beispiel.png)
> (rot markiert: die freie Fläche links neben den Brotkrumen) und
> [`053-pfadleiste-klickflaeche-bearbeiten.png`](053-pfadleiste-klickflaeche-bearbeiten.png) (rechts nach dem Klick).

## Auftrag (Marc)

Klickt man in die freie Fläche der Pfadleiste, soll man ein Verzeichnis eingeben können, zu dem gewechselt wird. Bei
Mouse-over soll dezent (Hinweis oder Icon) erkennbar sein, dass die Fläche klickbar ist.

## Ist-Zustand (Code gelesen, 01.11.2026)

Die Grundfunktion **gibt es schon**, ist aber unauffindbar und sieht beim Bearbeiten kaputt aus:

- `FilePanel` hat am Host `(click)` → `onHeaderClick`: Ein Klick, dessen Ziel das Element `.crumbs` selbst ist (nicht ein
  Segment), ruft `startPathEdit()` (Feld fokussiert, Text markiert). Tastatur: `OPEN_CHDIR_DLG` „Go to path…“
  (`Mod+L`, macOS zusätzlich `Ctrl+Alt+D`) über `ws.pathEditRequest`. Enter wechselt (auch `remote://…` bzw. Server-URL
  → Verbinden-Dialog, 034), Esc bricht ab und gibt den Fokus an die Liste zurück, Blur schließt.
- Einziger Hinweis auf die Klickbarkeit: `.crumbs { cursor: text }` – praktisch unsichtbar.
- **Fehler beim Bearbeiten** (zweiter Screenshot, rechte Seite): Das Eingabefeld nimmt nur etwa die halbe Breite ein,
  rechts daneben steht der Pfad **ein zweites Mal** als Text. Ursache (prüfen): Im Bearbeiten-Zweig steht zusätzlich
  `<span class="crumbs" [id]="pathId" hidden>` (Ziel für `aria-labelledby` o. ä.), aber `.crumbs { display: flex; flex: 1 }`
  überschreibt das UA-Stylesheet `[hidden] { display: none }` – der „versteckte“ Span ist sichtbar und teilt sich die
  Breite mit `.path-form` (`flex: 1`). Gegenprobe: gibt es eine globale Regel `[hidden] { display: none !important }`?
  (In `src/styles.css`/`controls.css` laut grep nicht.) Erst roter Test.
- Im Feld steht der Anfang des Pfades abgeschnitten (`stormProjects/astro-krocon-de/dist/download`) – bei langen Pfaden
  soll das **Ende** sichtbar sein (wie bei den rechtsbündigen Brotkrumen), Markierung trotzdem komplett.

## Aufgaben

1. **Bearbeiten-Ansicht reparieren** (`file-panel.html/.css`):
   - Versteckten Span wirklich verstecken (`.crumbs[hidden] { display: none }` bzw. allgemein `[hidden] { display: none
     !important }` in `styles.css` – Folgen für andere Komponenten prüfen) oder ihn ersetzen, falls er nur für
     `aria-labelledby`/Tests existiert (dann z. B. `.sr-only`). Wer referenziert `pathId` ohne `-input`? (grep, Specs.)
   - Das Feld füllt die ganze freie Breite bis zum Stern; Text in Mono wie die Brotkrumen (049 regelt die Höhe).
   - Nach dem Öffnen: alles markiert **und** ans Ende gescrollt (`input.scrollLeft = input.scrollWidth` nach `select()`;
     in WebKit/macOS prüfen, `setSelectionRange(0, len, 'backward')` als Alternative), damit der Ordnername sichtbar ist.
2. **Klickfläche eindeutig machen:**
   - Die gesamte freie Fläche zwischen linkem Rand bzw. Badges und den Brotkrumen (rot markiert) zählt, auch der Abstand
     zwischen Segmenten und Trennern (`/`) – heute nur, wenn das Klickziel exakt `.crumbs` ist; Trenner (`.sep`) und
     Platzhalter prüfen. Klick auf ein Segment navigiert weiterhin, auf Stern/Badges/Server-Knopf tut er, was er tut.
   - Kein Bearbeiten bei Textauswahl per Ziehen, Doppelklick auf ein Segment oder Rechtsklick; ebenso nicht in
     Ergebnis-/Belegungs-/Dubletten-Köpfen (dort gibt es eigene `dblclick`-Verhalten wie `editSearch`) – nur im
     Ordner-Kopf.
   - Erreichbarkeit: Die Fläche ist für die Maus; für Tastatur/Screenreader bleibt `Mod+L`. Im `title` der Fläche und
     per `aria-description` (oder `aria-keyshortcuts` am Pfad-`nav`) den Weg nennen.
3. **Dezenter Hover-Hinweis** – im Design eine Variante wählen und begründen (Phase 1 kurz, kein großes Design-Dokument):
   - **a)** Beim Überfahren der freien Fläche erscheint links ein gedämpftes Stift-Icon (`fa-pencil`, FA 4.5) plus ein
     leiser Text „Pfad eingeben… ⌘L“ / „Enter path… Ctrl+L“ (Kürzel aus der Keymap über `shortcutLabel`, nie
     hart codiert); nur auf der Fläche, nicht über den Segmenten.
   - **b)** Die freie Fläche bekommt beim Hover einen sehr dezenten Hintergrund bzw. eine Feld-Andeutung
     (`color-mix` aus Header-Hintergrund und `--color-header-input-bg`, 1px-Innenschatten statt Rahmen – keine
     Layoutverschiebung, 049), Cursor `text`.
   - **c)** Kombination: Feld-Andeutung + Stift-Icon, kein Text; Tooltip trägt den Text mit Kürzel.
   - Empfehlung: **c** – ruhig, verrät „hier ist ein Eingabefeld“, ohne bei jedem Mausweg Text aufblitzen zu lassen.
     Erscheinen mit kurzer Verzögerung (~150 ms) und ohne Animation bei `prefers-reduced-motion`.
   - Farben nur über vorhandene Tokens (`--color-header-text`, `--color-muted` im Header = `--color-tab-text`,
     `--color-header-input-bg`). Falls ein eigenes Token nötig wird: Rezept `CLAUDE.md` §9 (alle `themes/*.json`, Label
     de, Kontrastpaar). In `light`, `dark`, `crimson`, `classic-norton` lesbar, aber deutlich schwächer als die Brotkrumen.
   - Die Fläche ist im **aktiven und inaktiven** Panel klickbar (ein Klick aktiviert auch die Seite – `activate` läuft
     schon über `pointerdown`), der Hinweis erscheint in beiden.
4. **Texte** en/de in `features/workspace/texts.ts` + `texts.de.ts` (Hinweis, Tooltip mit Kürzel); `catalogs.spec.ts`.
5. **Doku:** `docs/ui-layout.md` (Header: freie Fläche = Pfad eingeben), README-Kürzel-/Bedienhinweis, falls dort
   „Go to path“ erwähnt ist; `docs/feature-parity.md`, falls mr das (Klick in die Pfadzeile) schon konnte.

## Akzeptanzkriterien

1. Klick in die freie Fläche der Pfadleiste (rot markierter Bereich, auch links neben kurzen Pfaden wie `/Users/marckronberg`)
   öffnet das Pfadfeld mit dem aktuellen Pfad, komplett markiert, Ende sichtbar; Tippen ersetzt, Enter wechselt, Esc
   bricht ab (Fokus zurück in die Liste), ungültiger Pfad zeigt den Fehler wie bisher.
2. Beim Bearbeiten erscheint der Pfad **nur einmal**: das Feld reicht über die ganze freie Breite bis zum Stern.
3. Klick auf ein Brotkrumen-Segment navigiert wie bisher und öffnet **nicht** das Feld; Stern, Archiv-/Server-Badge und
   Trennen-Knopf verhalten sich unverändert.
4. Mouse-over über der freien Fläche zeigt den gewählten dezenten Hinweis (ohne dass sich Höhe oder Lage irgendeines
   Elements ändert); über Segmenten erscheint er nicht; Tooltip nennt das Kürzel aus der aktuellen Keymap.
5. Such-, Flach-, Dubletten- und Belegungs-Köpfe bleiben unverändert (kein Pfadfeld per Klick, kein Hinweis).
6. Funktioniert links und rechts, im aktiven und inaktiven Panel, in allen geprüften Designs.

## Tests

- `file-panel.spec.ts`: **roter Test zuerst** – im Bearbeiten-Zustand ist kein zweites sichtbares `.crumbs`-Element
  vorhanden (`hidden` wirksam bzw. Element entfernt; jsdom kennt kein Layout → Attribut/Stil prüfen, plus
  Stylesheet-Prüfung per `node:fs` wie `builtin-themes.spec.ts`); Klick auf `.crumbs`/`.sep`/freie Fläche startet das
  Bearbeiten, Klick auf `.crumb` nicht; nicht in Ergebnis-Köpfen; Tooltip enthält das Kürzel aus der Keymap.
- E2E unter Xvfb (`CLAUDE.md` §2): Klick links neben kurzen Brotkrumen → Feld volle Breite, Pfad einmal, Ende sichtbar;
  Hover-Hinweis per Screenshot (vorher/nachher, beide Seiten). Hinweis: `xdotool click` ggf. als `mousedown`/`mouseup`.
- Screenshot-Szene `path-edit` (falls 049 sie schon angelegt hat: mitnutzen) in `light`, `dark`, `classic-norton`.
- `pnpm check` grün.

## Nicht in diesem Prompt

- Autovervollständigung/Vorschläge im Pfadfeld (Ordnernamen, Verlauf, Favoriten) – guter Folge-Prompt.
- Änderungen an der Header-Höhe selbst → 049.
