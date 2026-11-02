# Prompt 059: Warnzeile im Löschdialog – roter Text statt weiß auf rotem Grund

> **Slug:** `warntext-rot` · **Braucht:** 006 (Löschdialog), 013/019 (Farbschemata, Tokens, Kontrastpaare, alte Designs) · **Umfang:** XS (CSS + ggf. ein Token, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md` und `CLAUDE.md` §9 „Farbschemata ändern (Rezept)“. Kein Design-Dokument.
> Screenshot von Marc (01.11.2026): [`059-warntext-rot-beispiel.png`](059-warntext-rot-beispiel.png).

## Auftrag (Marc)

Im Dialog „Delete permanently“ steht die Frage „Delete 3 entries permanently? This cannot be undone.“ als **weißer Text
auf rotem Balken**. Das ist zu laut – **roter Text** (auf dem normalen Dialog-Hintergrund) ist Hervorhebung genug.

## Ist-Zustand

- `features/ops/delete-dialog.ts`: `<p id="fnf-delete-message" class="message" [class.danger-text]="showsPermanent()">`
  – gilt im endgültigen Modus und im Papierkorb-Dialog, solange „Delete permanently“ gehovert/fokussiert ist (`armed`).
- `features/ops/ops-dialog.css` `.danger-text`: `color: var(--color-danger-text); background: var(--color-danger-bg);
  padding; border-radius; font-weight: 600`. In `light` ist das dunkelrot auf hellrosa; in Marcs Farbschema (alte Designs
  setzen `--color-danger-text`/`-bg` über `error-panel-fg/bg-color`, `legacy-theme-map.ts`) wird daraus weiß auf rot.
- Ein Kontrastpaar für **roten Text auf dem Dialog-Hintergrund** gibt es noch nicht (`theme-logic.ts` `CONTRAST_PAIRS`
  hat `--color-error-text` nur gegen Listen-Hintergründe, `--color-danger-text` nur gegen `--color-danger-bg`).

## Aufgaben

1. `.danger-text` (nur diese Zeile, nicht die `.danger-box` für gefährliche Pfade/Dubletten – die bleibt ein Kasten):
   kein Hintergrund, kein Padding/Radius, Farbe rot, `font-weight: 600` bleibt. Die Zeile darf beim Wechsel
   normal ↔ rot (Hover auf „Delete permanently“) weder springen noch die Breite ändern.
2. **Farbe über ein Token**, das in jedem Design lesbar ist: neues Token `--color-dialog-danger-text` (Gruppe Dialoge,
   Label „Warning text in dialogs“, de „Warntext in Dialogen“), Default `var(--color-danger)` in `styles.css` `:root`,
   dieselbe Zeile in allen drei `themes/*.json`, deutsches Label in `theme-labels.de.ts`, **Kontrastpaar**
   `p('--color-dialog-danger-text', '--color-dialog-bg', 'Warning text in dialogs')` (Text, WCAG AA 4,5:1).
   Alte Designs bekommen den Default automatisch; die minimale WCAG-Korrektur (`contrast-fix.ts`) greift, wo Rot auf
   dem Dialog-Hintergrund zu schwach ist. `UPDATE_LEGACY_REPORT=1 pnpm test` → `docs/legacy-themes-contrast.md` neu.
   (Alternative ohne neues Token: `--color-danger` direkt + Kontrastpaar – im Bericht begründen, falls gewählt.)
3. Andere Stellen mit demselben Muster „ganze Textzeile weiß auf rot“ in Dialogen suchen (`grep -rn "danger-bg"
   src/app`), nur **auflisten** und Marc vorschlagen – nicht ungefragt ändern. Fehlerzeilen `.error` (`role="alert"`)
   unverändert lassen.
4. Sichtprüfung: Screenshot-Szene des Löschdialogs (oder neu: `delete-permanent`) in `light`, `dark`, `crimson`,
   `classic-norton` und Marcs aktuellem Design (alle `classic-*` durchlaufen lassen).

## Akzeptanzkriterien

1. Die Frage im endgültigen Löschdialog (und im Papierkorb-Dialog bei Hover/Fokus auf „Delete permanently“) ist roter,
   halbfetter Text auf dem normalen Dialog-Hintergrund – kein Balken.
2. In allen eingebauten und alten Designs erreicht der rote Text mindestens 4,5:1 gegen den Dialog-Hintergrund
   (Kontrastbericht grün).
3. Kein Layout-Sprung beim Umschalten normal ↔ rot.
4. `.danger-box` (gefährliche Pfade, ganze Dubletten-Gruppen, „nur nach Größe“) unverändert.

## Tests

- `theme-logic`/`builtin-themes`/`legacy-theme`-Specs grün (neues Token in allen Schemata, Kontrastpaar); Theme-Editor
  zeigt das neue Token mit Label en/de.
- `dialogs.spec.ts`: Frage hat im endgültigen Modus die Warnklasse (Logik unverändert).
- `pnpm check` grün; Screenshots im Bericht beschreiben.

## Nicht in diesem Prompt

- Anzahl/Größe im Löschdialog → **058** (Hinweis: auch auf diesem Screenshot fehlt die Größen-Zeile, obwohl `bak`
  groß ist – in 058 als zweiter Fall vermerkt).
- Tastenbedienung → **057**.
