# Prompt 052: Icons im Tab-Kontextmenü

> **Slug:** `tabmenue-icons` · **Braucht:** 004 (Tabs), 014 (`ContextMenu`), 018 J12 (Tab-Verlauf), 031 (Tabs auf die andere Seite) · **Umfang:** XS–S (reines Frontend)
> Lies zuerst `prompts/000-arbeitsweise.md` und `features/workspace/tab-bar.ts` (`menuItems`, `onMenuChosen`). **Baut auf 051 auf:** das Feld `MenuItem.icon` samt Icon-Spalte in `ContextMenu` führt 051 ein. Wird 052 zuerst umgesetzt, legt 052 es an (gleicher Vertrag wie in 051 Teil A beschrieben) und 051 nutzt es nur noch.
> Screenshot von Marc (31.10.2026): [`052-tabmenue-icons-beispiel.png`](052-tabmenue-icons-beispiel.png).

## Ist-Zustand

Rechtsklick (oder Kontextmenü-Taste) auf einen Tab öffnet `TabBar.menuItems`: Reload, Close tab, Move tab to
left/right panel, Clone tab for left/right panel, Move tab to the left, Move tab to the right, History ▸ (Untermenü
mit bis zu 15 Ordnern). Alles reiner Text – im Vergleich zur Dateiliste mit Icons wirkt das Menü karg, und die
ähnlich lautenden „Move tab …“-Einträge sind schwer auseinanderzuhalten.

## Auftrag

Jeder Eintrag bekommt links ein Font-Awesome-4.5-Icon (`MenuItem.icon`). Vorschlag – Namen in
`src/assets/font-awesome-4.5.0/` prüfen, Richtung **abhängig von der Seite** (`this.side()`):

| Eintrag | Icon |
|---|---|
| Reload | `fa-refresh` |
| Close tab | `fa-times` |
| Move tab to other panel | `fa-share` bzw. Pfeil zur anderen Seite: links → `fa-arrow-right`, rechts → `fa-arrow-left` |
| Clone tab for other panel | `fa-clone` (seit 4.4) bzw. `fa-files-o` |
| Move tab to the left / right (Reihenfolge) | `fa-angle-left` / `fa-angle-right` (bewusst anders als „andere Seite“) |
| History ▸ | `fa-history` |
| History-Untermenü: Ordner | `fa-folder-o` (Server-Pfad `remote://…`: `fa-server`) |

- Zusätzlich prüfen: Kürzel-Badges (`MenuItem.shortcut`) für Einträge mit eigener Aktion (Reload = `RELOAD_DIR`,
  Close = `CLOSE_TAB`, Tab verschieben = Aktionen aus 040/031) aus der Keymap über `ActionService.shortcutLabel` – wenn
  es diese Aktionen gibt, gleich mitzeigen (wie im Dateikontextmenü, 014).
- Gleiche Icons in der Befehlspalette/Menüleiste für dieselben Aktionen wären konsistent – nur wenn das Aktionsmodell
  bereits ein Icon-Feld hat; sonst nicht in diesem Prompt (Vorschlag im Bericht).
- Deaktivierte Einträge: Icon mitgedimmt.

## Akzeptanzkriterien

1. Alle Einträge des Tab-Menüs und des History-Untermenüs zeigen ein Icon, Texte bündig.
2. Die Pfeil-Icons zeigen in die tatsächliche Richtung (linkes Panel → rechts, rechtes Panel → links).
3. Tastatur, Typeahead, Untermenü und `disabled`-Hinweise funktionieren unverändert; Icons sind `aria-hidden`.
4. Sichtprüfung in `light`, `dark`, `classic-norton` (Hover-/Fokusfarbe mit Icon lesbar).

## Tests

- `tab-bar.spec.ts`: Icons je Eintrag, Richtung je Seite, History-Einträge mit Ordner-/Server-Icon.
- Screenshot-Szene für das Tab-Menü ergänzen, falls keine existiert (`scripts/screenshots/scenes.json`).
- `pnpm check` grün.

## Nicht in diesem Prompt

- Neue Einträge im Tab-Menü; Icons im Dateikontextmenü (eigener Prompt, falls gewünscht).
