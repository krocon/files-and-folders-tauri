# Prompt 069: Gewählter Tab in der Farbe seiner Liste („aus einem Guss“)

> **Slug:** `tab-wie-panel` · **Braucht:** 013/019 (Tokens, Kontrast), 062–068 (neue Farbschemata) · **Umfang:** XS (nur Farbschemata + Regel-Spec, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md` und `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“. Kein Design-Dokument.
> Bilder von Marc (02.11.2026): Ist [`069-tab-wie-panel-ist.webp`](069-tab-wie-panel-ist.webp) (Piggy: gewählter Tab der
> aktiven Seite pink, hebt sich von der Liste ab), Soll [`069-tab-wie-panel-soll.webp`](069-tab-wie-panel-soll.webp)
> (gewählter Tab in der Hintergrundfarbe der Liste darunter).

## Auftrag (Marc)

Grundsätzlich soll der **gewählte Tab als Hintergrund die Hintergrundfarbe des zugehörigen FilePanels** (der Liste)
haben. Dann sieht man, dass Tab und Liste aus einem Guss sind und zusammengehören. Sämtliche neuen Farbschemata
(062–068) daraufhin prüfen.

## Ist-Zustand

- Tokens: `--color-tab-selected-bg/-text` (gewählter Tab der inaktiven Seite) und `--color-active-panel-tab-bg/-text`
  (gewählter Tab der aktiven Seite), `tab-bar.css`. Die Listen-Hintergründe sind `--color-list-bg` bzw.
  `--color-active-list-bg`.
- Crimson und One Dark, Matrix, Solarized Light halten die Regel schon ein. Abweichend (aktive Seite): Mystico – C64,
  True Dark, True Black, True Light und alle fünf Rainglow-Schemata (Signaturfarbe als Tab-Hintergrund).

## Aufgaben

1. In den neuen Schemata `--color-tab-selected-bg` = `var(--color-list-bg)` und `--color-active-panel-tab-bg` =
   `var(--color-active-list-bg)`, die Texte entsprechend `var(--color-list-text)` / `var(--color-active-list-text)`
   (damit die Kontrastpaare automatisch stimmen).
2. Regel-Spec in `builtin-themes.spec.ts`: Für alle Schemata aus `EXTRA_THEMES` gleichen die aufgelösten Tab-Farben den
   Listen-Hintergründen beider Seiten.
3. Die aktive Seite bleibt erkennbar über die vorhandenen Mittel (Akzentlinie, Statuszeile, Cursor) – die
   Signaturfarbe der Rainglow-Schemata bleibt in Statuszeile und Button-Leiste.
4. `docs/themes.md` (Abweichungen) nachziehen; Sichtprüfung per `pnpm screenshots` (Szene `main`) für alle neuen
   Schemata.

## Nicht in diesem Prompt

- `light`, `dark` und die acht alten Designs (eigene Optik mit farbigem aktiven Tab bzw. Vorlage aus mr) – bei Bedarf
  eigener Prompt.

## Akzeptanzkriterien

1. In allen Schemata 062–068 hat der gewählte Tab jeder Seite exakt die Hintergrundfarbe der Liste darunter.
2. Kontrast-Specs (WCAG AA) grün; die aktive Seite ist weiter zu erkennen.
