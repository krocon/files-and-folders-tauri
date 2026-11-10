# Prompt 073: Doppelklick-Aktionen – Auslöser mit Modifier-Tasten, größere Regelliste

> **Slug:** `doppelklick-ausloeser` · **Braucht:** 002 (Keymaps, Kürzel-Notation), 015 (i18n), 057 (Dialog-Tasten),
> 072 (Doppelklick-Aktionen) · **Umfang:** S–M (Frontend + kleiner Rust-Teil)
> Lies zuerst `prompts/000-arbeitsweise.md` und `prompts/done/072-doppelklick-aktionen.design.md` (E1–E10), dann
> `core/fileactions/file-actions.models.ts`, `features/fileactions/` (`file-actions-logic.ts`, `file-actions.store.ts`
> `handleDoubleClick`, `file-actions-dialog.ts`, `file-actions-help.ts`, Texte), `src-tauri/src/file_actions.rs`
> (`Trigger`, `FileActionRule`, Prüfung), `features/browser/file-list/file-list.ts` (Hook `doubleClick`, `ClickInput`
> aus `evt.originalEvent`) und `file-list-controller.ts` (`onClick`: `clickCount`, `toggleKey`, `shiftKey`).
> Design-Dokument: `prompts/073-doppelklick-ausloeser.design.md` (kurz, Fortsetzung der Nummerierung E11 ff. aus 072).
> Screenshot von Marc (09.11.2026): [`073-doppelklick-ausloeser-beispiel.png`](073-doppelklick-ausloeser-beispiel.png)
> (Dialog „Double-click actions“ mit einer Regel `*.js` → `node %N`).

## Auftrag (Marc)

1. **Auslöser erweiterbar machen**: z. B. Doppelklick nur bei gedrückter Shift-Taste, oder Strg-Taste, oder ohne
   Taste usw.
2. Die Box **„Rules“** ist sehr schmal – höher machen, **etwa 10 Zeilen sichtbar**.
3. Die Knöpfe **Add / Remove / Up / Down** ganz nach unten, in die Zeile von **Help / Cancel / Save**.

## Ist-Zustand

- `FileActionTrigger = 'doubleClick'` (TS) bzw. `enum Trigger { DoubleClick }` (Rust, `#[serde(default)]`); 072 hat das
  Feld bewusst für spätere Auslöser offen gelassen. Das Select im Dialog hat genau eine Option.
- Der Doppelklick kommt über `FileListController.onClick` (`clickCount >= 2`) → Hook `doubleClick(entry)` →
  `FileActionsStore.handleDoubleClick(entry, panel)` → `findRule(rules, 'doubleClick', entry)`. Modifier werden **nicht**
  weitergereicht; `ClickInput` kennt nur `shiftKey` und `toggleKey` (macOS ⌘, sonst Strg).
- Einfachklick mit Modifier hat schon eine Bedeutung: `toggleKey`+Klick = Markierung umschalten, Shift+Klick = Bereich
  markieren. Ein Doppelklick mit Modifier löst also vorher (beim ersten Klick, ggf. auch beim zweiten) diese
  Markier-Logik aus.
- macOS: **Ctrl+Klick = Kontextmenü** (Rechtsklick-Ersatz). Ein Ctrl-Doppelklick ist dort vermutlich nicht nutzbar.
- Regelliste: `<ul class="listbox">` ohne feste Höhe (wirkt im Screenshot ~2 Zeilen hoch); darunter Hilfezeile und
  die Knopfreihe Add/Remove/Up/Down in der linken Spalte.

## Aufgaben

### A. Datenmodell (TS + Rust, von Hand synchron)

1. Auslöser als **Art + Modifier** modellieren, so dass weitere Arten (später z. B. Mittelklick, `Enter` mit Modifier)
   ohne Formatbruch dazukommen. Vorschlag (im Design entscheiden):
   - `trigger: 'doubleClick'` bleibt (Art), neues Feld `modifiers: ('shift' | 'mod' | 'alt' | 'ctrl')[]`, sortiert und
     ohne Doppelte; leer = **ohne Taste**. `mod` = ⌘ auf macOS, Strg auf Windows/Linux – wie die Keymap-Notation (002).
     `ctrl` nur, falls auf macOS ein eigenes Ctrl sinnvoll und technisch möglich ist (s. Ist-Zustand), sonst weglassen.
   - Alternative: eine Zeichenkette in Kürzel-Notation (`"Shift+DoubleClick"`) mit dem vorhandenen Parser. Wähle die
     kleinste saubere Lösung und begründe sie.
2. **Rückwärtskompatibel**: alte `file-actions.json` ohne `modifiers` laden als „ohne Taste“, nichts geht verloren;
   Rust-Test mit einer Datei im Format von 072. Unbekannte Modifier/Arten → Problem-Code (z. B. `trigger`) statt
   stillem Verwerfen, in beiden Dateien und in den Texten.
3. Exportbündel/Import (015/026) und `.bad`-Verhalten unverändert; nur prüfen, dass das neue Feld mitreist.

### B. Auswertung

4. Der Doppelklick reicht die **gedrückten Modifier** bis zum Store durch (`ClickInput` um `altKey` und die rohen
   Ctrl/Meta erweitern, Hook `doubleClick(entry, modifiers)`). `findRule` vergleicht Art **und Modifier exakt**
   (Shift+Doppelklick trifft keine Regel „ohne Taste“ und umgekehrt). Erste passende Regel von oben gewinnt (072 E5).
5. Passt keine Regel: **Standardverhalten wie heute** (`behavior.doubleClick` bzw. Öffnen) – auch bei gedrücktem
   Modifier. Im Design festhalten.
6. **Markier-Nebenwirkung**: Ein Doppelklick mit Shift/Mod darf die Markierung des Panels nicht verändert hinterlassen,
   **wenn eine Regel greift**. Ursache und Lösung im Design (z. B. Markierung vor dem ersten Klick merken und beim
   Treffer wiederherstellen, oder Markier-Logik erst nach dem Doppelklick-Fenster anwenden). Greift keine Regel, bleibt
   das heutige Verhalten. Kein Flackern der Markierung, wenn vermeidbar.
7. Kontextmenü (macOS Ctrl+Klick, rechte Taste) bleibt unberührt. Welche Modifier je OS angeboten werden, entscheidet
   ein kleiner reiner Helfer (`availableModifiers(os)`), den Dialog und Prüfung gemeinsam nutzen.
8. Keine neuen Kollisionen mit globalen Kürzeln: Doppelklick ist kein Tastaturereignis, die Keymaps bleiben unverändert.

### C. Dialog

9. **Auslöser-Feld**: Art (Select, vorerst nur „Double click“) plus **Modifier-Checkboxen** (Shift, ⌘/Ctrl, ⌥/Alt –
   Beschriftung je OS wie die Kürzel-Badges), oder ein Select mit den sinnvollen Kombinationen – im Design entscheiden
   (Empfehlung: Checkboxen, weil Kombinationen wie Shift+Alt dann von selbst gehen). Die Liste der Arten kommt aus einem
   Katalog, nicht aus hart verdrahtetem HTML.
10. Jede Zeile der Regelliste zeigt den Auslöser kompakt vor dem Muster (z. B. `⇧ *.js   node %N`, ohne Taste nichts),
    damit gleiche Muster mit verschiedenen Tasten unterscheidbar sind.
11. **Doppelte Regel** (gleiche Art, gleiche Modifier, sich überschneidendes Muster) ist erlaubt (erste gewinnt), aber
    eine Regel, die von einer **identischen** darüber vollständig verdeckt wird (gleiche Art, Modifier und Muster), wird
    als Hinweis markiert (kein Speicherfehler).
12. **Regelliste höher**: ca. **10 Zeilen sichtbar** (Höhe aus Zeilenhöhe × 10, z. B. `calc(10 * var(--row-h))` oder
    `lh`-Einheit, keine Pixel-Magie), bei mehr Regeln scrollt die Liste; Cursor-Zeile bleibt per `scrollIntoView`
    sichtbar. Der Dialog darf dafür höher werden, muss aber bei kleinem Fenster weiter passen (max. Höhe, die rechte
    Spalte scrollt wie heute).
13. **Knöpfe nach unten**: Add / Remove / Up / Down in die Fußzeile des Dialogs, in dieselbe Zeile wie Help /
    Cancel / Save (links nach Help, rechts bleiben Cancel/Save). Prüfen, wie `Modal` die Fußzeile aufbaut (057:
    `Mod+Buchstabe` für Nebenknöpfe, Badges beim Halten des Modifiers) – Buchstaben dürfen nicht kollidieren, Enter
    bleibt Save. Die Hilfezeile „Alt+↑/↓ move, Delete removes.“ bleibt unter der Liste. Gedimmte Zustände (Up/Down an
    den Enden, Remove ohne Regel) wie bisher. Fokusreihenfolge sinnvoll (Liste → Felder → Fußzeile).
14. Hilfe (`file-actions-help.ts`, E10) und Intro: Auslöser mit Modifier erklären, Beispiel „Shift+Doppelklick auf
    `*.js` → im Terminal, Doppelklick ohne Taste → normal öffnen“. Texte en/de, `catalogs.spec.ts` grün.

## Akzeptanzkriterien

1. Zwei Regeln für `*.js`: „Double click“ → `node %N` (Terminal), „Shift + Double click“ → `code %N`. Doppelklick auf
   `a.js` startet node, Shift+Doppelklick startet code; Mod+Doppelklick (keine Regel) öffnet wie ohne Regeln.
2. Nach einem Shift-/Mod-Doppelklick, der eine Regel auslöst, ist die Markierung des Panels unverändert.
3. Eine `file-actions.json` aus 072 lädt unverändert und verhält sich wie vorher.
4. Die Regelliste zeigt ca. 10 Zeilen ohne Scrollen; Add/Remove/Up/Down stehen unten in der Zeile von Help/Cancel/Save;
   Tastatur (Alt+↑/↓, Delete, Enter = Save, Esc = Cancel) funktioniert wie vorher.
5. Auf macOS gibt es keine Option, die mit Ctrl+Klick = Kontextmenü kollidiert (oder sie ist begründet vorhanden).

## Tests

- Rust (`file_actions.rs`): altes Format ohne `modifiers`, Normalisierung (Sortierung, Doppelte), unbekannter
  Modifier/Art → Problem, Round-Trip Laden/Speichern.
- `file-actions-logic.spec.ts`: `findRule` mit Modifiern (exakt, Reihenfolge, kein Rückfall auf „ohne Taste“),
  `availableModifiers` je OS, Erkennung verdeckter Regeln.
- `file-list-controller.spec.ts`: Doppelklick mit Shift/Mod reicht Modifier durch; Markierung bleibt bei Treffer
  erhalten, ohne Treffer heutiges Verhalten.
- `file-actions.spec.ts`: Dialog – Checkboxen ↔ Regel, Zeilenanzeige des Auslösers, Knöpfe in der Fußzeile.
- E2E (macOS lokal oder Xvfb, `xdotool keydown shift` + Doppelklick): Akzeptanzkriterien 1, 2 und 4; Screenshot des
  Dialogs im Bericht beschreiben. `pnpm check` grün.

## Doku

- `prompts/073-doppelklick-ausloeser.design.md` (E11 ff.), `prompts/README.md` (Zeile 073, „Nächste Prompts“),
  CLAUDE.md §1 Stand, ggf. README-Abschnitt der Doppelklick-Aktionen.

## Nicht in diesem Prompt

- Weitere Auslöser-Arten (Mittelklick, `Enter`/`Shift+Enter`, Ordner als Ziel) – nur das Modell dafür offen halten.
- Regeln für Ordner, Archive, Server (072 E7 bleibt).
