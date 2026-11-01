# Prompt 049: Panel-Header behält seine Höhe beim Bearbeiten des Pfads

> **Slug:** `header-hoehe-pfadeingabe` · **Braucht:** 003 (Navigation, Pfad eingeben), 004 (Fensteraufbau), 013/019 (Farbschemata, Header-Tokens) · **Umfang:** S (reines CSS/Frontend, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md` und `docs/ui-layout.md` (Header-Zeile). Kein eigenes Design-Dokument nötig – Entscheidungen kurz im Abschlussbericht und in `docs/architecture.md` („Entscheidungen“), falls neu.
> Problem-Screenshot von Marc (31.10.2026): [`049-header-hoehe-pfadeingabe-beispiel.png`](049-header-hoehe-pfadeingabe-beispiel.png).

## Problem

Klickt man in die Brotkrumen-Zeile eines Panels (oder `Ctrl+L` o. ä.), ersetzt `FilePanel` die Brotkrumen durch das
Eingabefeld (`editingPath()` → `<form class="path-form"><input class="path-input">`). Dabei **wird die Header-Zeile ein
paar Pixel höher** – Tab-Leiste, Spaltenkopf und Liste darunter rutschen nach unten, beim Verlassen (Enter, Esc, Blur)
wieder hoch. Gleiches gilt, wenn der Fehlerhinweis `.path-error` erscheint. Die UI wirkt dadurch unruhig; auf Marcs
Screenshot steht das Feld (links, mit Fokusrahmen) sichtbar höher als die Brotkrumen der rechten Seite.

## Vermutete Ursachen (prüfen, nicht raten)

In `src/app/features/workspace/file-panel.css`:

- `.crumbs` / `.crumb`: Systemschrift (`font-stretch: condensed`), `font-size-sm`, `padding: 1px 2px`, **kein Rahmen**.
- `.path-input`: `font-family: var(--font-mono)` (andere Zeilenhöhe als die Sans-Schrift bei `line-height: normal`),
  `padding: 1px var(--spacing-1)` **plus** `border: var(--border-width) solid …` (2 px mehr) – der Rahmen ist sehr
  wahrscheinlich der Hauptgrund, die Mono-Zeilenhöhe ein zweiter.
- `.header` hat keine feste Höhe (`display: flex; align-items: center; padding: var(--spacing-1) …`) – die Zeile wird so
  hoch wie ihr höchstes Kind. Das gilt auch für andere Kopf-Varianten (Such-, Flach-, Dubletten-, Belegungs-Tab); 038 E3
  hat das für die flache Ansicht schon einzeln gelöst („as high as the breadcrumbs – switching must not move the panel“).

Zuerst **messen** (E2E unter Xvfb oder ein Spec mit `getComputedStyle` reicht nicht – jsdom hat kein Layout): Höhe von
`nav.part.header` im Ruhezustand, beim Bearbeiten, mit Fehlerhinweis, in den Ergebnis-Tab-Varianten, je in mindestens
`light`, `dark` und `classic-norton` (andere Schriftgrößen/Tokens).

## Lösungsrichtung

Marcs Idee: ein Element mit **fester Höhe** um den Inhalt, `overflow: visible`, damit ein etwas größeres Feld (Rahmen,
Fokusring) übersteht, ohne die Zeile zu verschieben. Bitte bewerten und die robusteste Variante wählen:

- **A – Feste Höhe der Header-Zeile:** `.header { height: var(--panel-header-height); box-sizing: border-box; }` mit
  einem neuen Layout-Token (Default = heutige Ruhe-Höhe, z. B. aus Schriftgröße + Polsterung berechnet, nicht als
  Pixelzahl geraten). Kinder richten sich per `align-items: center` aus; `overflow: visible`, damit der Fokusring
  (`outline`, belegt ohnehin keinen Platz) und ein evtl. 1–2 px höheres Feld nicht abgeschnitten werden. Wirkt für
  **alle** Header-Varianten auf einmal (Such-, Flach-, Dubletten-, Belegungs-Tab, Archiv-/Server-Badge).
- **B – Eingabefeld passend machen:** `.path-input` bekommt `box-sizing: border-box`, `height`/`line-height` exakt wie
  die Brotkrumen, Polsterung um die Rahmenbreite verkleinern (`padding-block: 0`) bzw. den Rahmen als
  `box-shadow: inset 0 0 0 var(--border-width) …` oder `outline` zeichnen (kein Layoutplatz). Mono-Schrift beibehalten,
  aber `line-height` fest setzen.
- Empfehlung: **A + B kombinieren** – A garantiert „Header springt nie“, B sorgt dafür, dass das Feld innerhalb der festen
  Höhe sauber sitzt und nicht über die Tab-Leiste ragt. Ein zusätzliches Wrapper-`div` nur, wenn `nav.header` selbst
  keine feste Höhe bekommen kann (Begründung im Bericht).
- `.path-error` darf die Höhe ebenfalls nicht ändern (eine Zeile, `ellipsis`, Schriftgröße so, dass sie in die Höhe
  passt) – ggf. als `title`/`aria-describedby` vollständig zugänglich.
- Vorsicht bei kleinen Knöpfen/Selects im Kopf (`.head-btn`, `.btn.small`, Dubletten-Regel-Select 042, Belegungs-Modi
  033): bei fester Höhe nicht abschneiden; die bestehenden Ausnahmen für „kompakte Controls im Header“ prüfen.
- Gilt die Ruhe auch für die Tab-Leiste (Hover/aktiver Tab, `+`/`−`) und die Statuszeile? Kurz mitprüfen; falls dort
  dasselbe Muster auftritt, im selben Zug beheben, sonst als Befund im Bericht.

## Aufgaben

1. Messen (s. o.), Ursache(n) im Bericht mit Zahlen festhalten.
2. CSS umsetzen (`file-panel.css`, ggf. neues Layout-Token in `src/styles.css` – **kein** Farb-Token, also keine
   Änderung an `themes/*.json`/`tokens.ts` nötig; falls doch, Rezept in `CLAUDE.md` §9 beachten).
3. Keine Logikänderung an `editingPath`/`submitPath`/`closePathEdit` – außer ein Test zeigt, dass ein Teil des Sprungs aus
   dem DOM-Tausch kommt (z. B. das versteckte `<span class="crumbs" hidden>`).
4. Screenshot-Szene ergänzen (`scripts/screenshots/scenes.json`): Panel mit offenem Pfadfeld neben Panel mit
   Brotkrumen – zeigt auf einen Blick, dass beide Header gleich hoch sind. Mit `pnpm screenshots --theme
   light,dark,classic-norton --scene <neu>` sichtprüfen.
5. `docs/ui-layout.md` (Header-Zeile: feste Höhe) mitpflegen.

## Akzeptanzkriterien

1. Pfadfeld öffnen/schließen (Klick, Tastatur, Enter, Esc, Blur) verändert die Höhe von `nav.part.header` um **0 px**;
   Tab-Leiste und Liste bewegen sich nicht (E2E: `getBoundingClientRect()` vorher/nachher im echten Fenster).
2. Ebenso 0 px beim Erscheinen von `.path-error` (ungültiger Pfad) und beim Wechsel zwischen Ordner-, Such-, Flach-,
   Dubletten- und Belegungs-Tab.
3. Linker und rechter Header sind immer gleich hoch, auch wenn nur eine Seite das Feld zeigt (Marcs Screenshot).
4. Fokusring und Rahmen des Feldes bleiben vollständig sichtbar (nicht abgeschnitten), Text vertikal zentriert, lange
   Pfade weiterhin horizontal scrollbar im Feld.
5. Gilt in allen eingebauten und alten Designs (mind. `light`, `dark`, `crimson`, `classic-norton` geprüft) und bei
   größerer Systemschrift (Zoom 125 %) ohne Abschneiden.

## Tests

- Vitest: ein schlanker Spec, der sicherstellt, dass `.header` eine feste Höhe aus dem Token bekommt (Stylesheet lesen
  per `node:fs`, wie `builtin-themes.spec.ts`) – als Regression gegen „feste Höhe wieder entfernt“.
- E2E unter Xvfb (`CLAUDE.md` §2): Höhen messen wie in Kriterium 1–2, Screenshots vorher/nachher im Bericht beschreiben.
- `pnpm check` grün.

## Nicht in diesem Prompt

- Neugestaltung des Headers (Brotkrumen-Stil, Pfadfeld mit Vorschlägen/Autovervollständigung).
- Änderungen an der GuiExpert Table.
