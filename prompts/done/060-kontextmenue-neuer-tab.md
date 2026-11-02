# Prompt 060: Kontextmenü in Ergebnis-Tabs – „Open folder in new tab“

> **Slug:** `kontextmenue-neuer-tab` · **Braucht:** 004 (Tabs), 009 (Such-Ergebnis-Tabs, `GOTO_FILE`), 014 (Kontextmenüs, `contextKind`), 033/047 (Belegungs-Tab), 038 (Flache Ansicht), 042 (Dubletten-Tab) · **Umfang:** XS–S (reines Frontend)
> Lies zuerst `prompts/000-arbeitsweise.md`, `features/menus/menu-model.ts` (`CONTEXT`, `contextKind`),
> `features/actions/workspace-actions.ts` (`OPEN_IN_NEW_TAB`), `features/browser/file-list/file-list-controller.ts`
> (`openCursorInNewTab`, `hooks.openInNewTab`). Kein Design-Dokument; Entscheidungen im Bericht.
> Screenshot von Marc (01.11.2026): [`060-kontextmenue-neuer-tab-beispiel.png`](060-kontextmenue-neuer-tab-beispiel.png)
> (Belegungs-Tab rechts, Rechtsklick auf den Ordner „Sherlock Holmes – …“).

## Auftrag (Marc)

Im Kontextmenü (Popup) einen Eintrag ergänzen: **„Open folder in new tab“** o. ä.

## Ist-Zustand

- Die Aktion gibt es schon: `OPEN_IN_NEW_TAB` „Open folder in new tab“ (`Mod+Enter`), Handler
  `list()?.openCursorInNewTab()` – nur für navigierbare Ordner (`isNavigableDir`, kein `lossyName`).
- Im Kontextmenü steht sie bei `folder` und `archiveFile`, **nicht** bei `result`. `contextKind` liefert für **jeden**
  Eintrag in einem Ergebnis-Tab `result` (Suche, Flache Ansicht, Dubletten, Speicherbelegung) – deshalb fehlt der
  Eintrag in Marcs Screenshot, obwohl der Cursor auf einem Ordner steht. Das Menü dort beginnt mit „Go to file (search
  result)“, „Open“, View/Edit (für Ordner gedimmt) …
- „Open“ (`NAVIGATE_OPEN`) auf einem Ordner im Belegungs-Tab steigt im Belegungs-Baum ab; „Go to file“ springt im selben
  Panel zum Eintrag. Einen Ordner in einem **echten Ordner-Tab** neben dem Ergebnis zu öffnen, geht nur über `Mod+Enter`
  – falls der Hook `openInNewTab` in Ergebnis-Tabs überhaupt gesetzt ist (prüfen!).

## Aufgaben

1. **Menü:** `OPEN_IN_NEW_TAB` ins `result`-Kontextmenü, direkt nach „Open“ (wie bei `folder`). Für Dateien im
   Ergebnis ist die Aktion deaktiviert – besser: nur zeigen, wenn der Cursor auf einem Ordner steht. Dafür `contextKind`
   um eine Unterscheidung erweitern (z. B. `resultFolder` vs. `result`, oder `result` mit bedingtem Eintrag) –
   kleinste saubere Lösung wählen. Die Reihenfolge im `resultFolder`-Menü ordnerfreundlich: „Open“, „Open folder in new
   tab“, „Go to file“, dann Copy/Move/Delete …; View/Edit für Ordner weglassen statt gedimmt zeigen (optional, im
   Bericht begründen).
2. **Verhalten im Ergebnis-Tab:** Der neue Tab ist ein **normaler Ordner-Tab** mit dem Pfad des Ordners (nicht ein
   Ergebnis-/Belegungs-Tab), öffnet auf **derselben Seite** direkt neben dem Ergebnis-Tab und wird aktiv – wie
   `Mod+Enter` in einem Ordner-Tab. Hook `openInNewTab` in Ergebnis-Tabs (Such-, Flach-, Dubletten-, Belegungs-Tab)
   prüfen und ggf. setzen; `Mod+Enter` funktioniert danach dort ebenfalls. Pfad kommt aus dem Eintrag (opak, nie im
   Frontend zusammensetzen), Server-Pfade (`remote://…`) und Ordner in Archiven wie bisher.
3. **Datei im Ergebnis (optional, kleine Ergänzung):** Eintrag „Open containing folder in new tab“ (neue Aktion, z. B.
   `OPEN_PARENT_IN_NEW_TAB`, Cursor auf den Eintrag setzen) – nur, wenn es ohne neues Rust-Command geht (Elternordner
   liefert `SearchHit.relDir`/der Eintrag bereits?). Sonst als Vorschlag in den Bericht.
4. **Alternative Seite (optional):** Untermenü/Eintrag „Open folder in other panel“ über die vorhandenen
   `OPEN_CURSOR_IN_LEFT`/`OPEN_CURSOR_IN_RIGHT` (040) – passend zur Seite nur eines zeigen. Bei Belegung (047: Diagramm
   ggf. auf der Gegenseite) prüfen, dass es nicht mit dem Diagramm-Tab kollidiert.
5. Hauptmenü: `OPEN_IN_NEW_TAB` steht schon unter „Datei“ – Wirkung in Ergebnis-Tabs dort ebenfalls prüfen.
6. Texte: Label existiert (`Open folder in new tab` / de prüfen); neue Aktionen en/de, `catalogs.spec.ts`.

## Akzeptanzkriterien

1. Rechtsklick auf einen **Ordner** im Belegungs-, Such-, Flach- und Dubletten-Tab zeigt „Open folder in new tab“
   (mit Kürzel `⌘↵`/`Ctrl+Enter`); Klick öffnet einen normalen Ordner-Tab mit genau diesem Ordner auf derselben Seite,
   der Ergebnis-Tab bleibt erhalten.
2. Auf einer **Datei** im Ergebnis-Tab erscheint der Eintrag nicht (bzw. gemäß Aufgabe 3 die Elternordner-Variante).
3. `Mod+Enter` auf einem Ordner im Ergebnis-Tab tut dasselbe.
4. Die Kontextmenüs der normalen Ordner-Tabs bleiben unverändert.

## Tests

- `menu-model.spec.ts`: `contextKind`/`contextMenuFor` für Ordner und Datei im Ergebnis-Tab.
- Spec für Ergebnis-Tab (z. B. `file-panel.spec.ts` oder `search.store.spec.ts`): `OPEN_IN_NEW_TAB` auf Ordner-Treffer
  öffnet einen Ordner-Tab daneben mit dem Pfad, aktiver Tab wechselt, Ergebnis-Tab bleibt.
- E2E unter Xvfb: Belegungs-Tab → Rechtsklick Ordner → neuer Tab. `pnpm check` grün.

## Nicht in diesem Prompt

- Icons im Kontextmenü (→ 051/052-Mechanik, falls gewünscht später).
