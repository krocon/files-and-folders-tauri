# Prompt 057: Dialog-Knöpfe per Tastatur – Esc = Abbrechen, Enter = Hauptknopf, Kürzel für Nebenknöpfe

> **Slug:** `dialog-tasten` · **Braucht:** 002 (Aktionssystem, Keymaps je OS, Kürzel-Darstellung `shortcut.ts`), 006 (Löschen, Gefahrenprüfung), 015 (Texte en/de) und alle Dialoge, die `app-modal` nutzen · **Umfang:** M (eine zentrale Mechanik + Durchgang durch ~39 Dialoge, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md`, `shared/dialog/modal.ts` (+ `dialog.service.ts`, `confirm-dialog.ts`),
> `features/ops/delete-dialog.ts` (Schutzregel `cancelFirst`) und APG „Dialog (Modal)“. Design-Dokument
> `prompts/057-dialog-tasten.design.md` 🛑 mit den Entscheidungen E1–E4 und der Dialog-Tabelle – **vor** dem Durchgang
> durch alle Dialoge Marc zeigen.
> Screenshot von Marc (01.11.2026): [`057-dialog-tasten-beispiel.png`](057-dialog-tasten-beispiel.png) (Delete:
> Cancel · Delete permanently · Move to trash).

## Auftrag (Marc)

In Dialogen sollen die wichtigen Knöpfe per Tastatur gehen: **Esc → Abbrechen**, **Enter → Hauptknopf** (steht
rechts), **eine andere Tastenkombination → Nebenknopf** (z. B. „Delete permanently“). Hinweis als Tooltip? Oder
`⌘`/`Ctrl` + erster Buchstabe? Das soll für **viele Dialoge** gleich funktionieren.

## Ist-Zustand (Code gelesen, 01.11.2026)

- `Modal` (`shared/dialog/modal.ts`) ist der gemeinsame Rahmen (39 Verwender): Fokusfalle, **Esc schließt schon**
  (`closed.emit()`), Fokus beim Öffnen auf `[data-autofocus]` bzw. das erste fokussierbare Element.
- **Enter** löst heute nur aus, was gerade fokussiert ist (nativer Button-Klick) bzw. ein `(submit)` in Dialogen mit
  Formular (34 Stellen). Steht der Fokus in einer Checkbox, einem Select oder auf „Abbrechen“, passiert mit Enter etwas
  anderes oder nichts – kein verlässliches „Enter = Hauptknopf“.
- Für **Nebenknöpfe** gibt es keine Tastatur außer Tab-Tab-Leertaste.
- Schutzregel im Löschdialog: Bei endgültigem Löschen, gefährlichen Pfaden oder ganzen Dubletten-Gruppen liegt der
  Fokus auf **Abbrechen** (`cancelFirst`, „Enter must not destroy“) – das muss erhalten bleiben.
- Nebenbei im Screenshot: „You can restore **it** from the trash.“ bei 5 Einträgen (`ops-texts.ts` `trashHint`) –
  Mehrzahl fehlt (en/de). Im selben Zug beheben (roter Test zuerst).

## Entscheidungen fürs Design

- **E1 Rollen und Markierung.** Jeder Dialog-Knopf bekommt deklarativ eine Rolle, z. B. Direktive/Attribut
  `fnfDialogKey="primary" | "secondary" | "cancel"` (optional `fnfDialogKey="secondary:P"` für einen festen Buchstaben).
  Der `Modal` wertet die Tasten **zentral** aus – keine eigenen `keydown`-Handler je Dialog (CLAUDE.md §4: Dialoge
  dürfen eigene Tasten haben, aber eine Mechanik für alle ist hier das Ziel).
- **E2 Enter = Hauptknopf – wann nicht.** Enter löst den `primary`-Knopf aus, egal wo der Fokus im Dialog steht,
  **außer**: Fokus auf einem anderen Knopf (dann gilt dieser – erwartetes Verhalten), in `textarea`, in einem offenen
  Select/Combobox/Menü/Autovervollständigen, in einer Tabelle/Liste mit eigenem Enter (GuiExpert-Vorschau, Palette),
  während einer IME-Eingabe (`isComposing`), bei Auto-Repeat (`evt.repeat`), wenn der Knopf `disabled` ist.
  **Schutzregel:** Ist der Hauptknopf destruktiv und nicht wiederherstellbar (endgültig löschen, überschreiben,
  gefährlicher Pfad – heute `cancelFirst`), löst Enter **nicht** aus, sondern bleibt bei „Abbrechen“; dafür gibt es das
  ausdrückliche Kürzel aus E3. Esc schließt zuerst innere Popups (Select, Kontextmenü), erst dann den Dialog.
- **E3 Kürzel für Nebenknöpfe – Vorschlag mit Abwägung:**
  - **Empfohlen: `Mod+<Buchstabe>`** (macOS `⌘`, sonst `Ctrl`), Buchstabe = erster Buchstabe des Labels bzw. ein im
    Design festgelegter. Vorteil: eine Regel auf allen OS, kollidiert nicht mit Tippen in Feldern. Zu prüfen:
    Kollisionen mit Textfeld-Standards (`Mod+A/C/V/X/Z` in Eingaben **nie** belegen), mit macOS-Systemkürzeln
    (`⌘Q`, `⌘W`, `⌘H`, `⌘M`) und mit globalen App-Kürzeln, die in Dialogen ohnehin unterdrückt werden. Bekannte
    macOS-Muster übernehmen: `⌘D` = „Nicht sichern/Verwerfen“, `⌘⌫` = Löschen-artige Nebenaktion.
  - Alternative **`Alt+<Buchstabe>` mit unterstrichenem Buchstaben** (Windows-Mnemonics): unter Windows/Linux vertraut,
    auf macOS ungewohnt (`⌥` erzeugt Zeichen, Erkennung über `e.code`).
  - Alternative **`Mod+Enter`** für genau einen Nebenknopf: einfach, aber nur einer und nicht selbsterklärend.
  - **Destruktive Nebenknöpfe** (Delete permanently): zusätzlich `Shift` verlangen (`Mod+Shift+D` o. ä.) oder im Design
    begründen, warum ein einfaches Kürzel genügt (es gibt keine zweite Rückfrage!).
  - Buchstaben je Dialog eindeutig; Konflikt → nächster Buchstabe des Labels; Labels sind übersetzt → Buchstabe je
    Sprache aus dem Label ableiten **oder** sprachunabhängig fest (Design; fest ist berechenbarer, Label-basiert
    selbsterklärender).
- **E4 Hinweis an den Knöpfen.** Empfehlung: Tooltip (`title`) **und** `aria-keyshortcuts` an jedem Knopf mit Kürzel
  („Delete permanently (⌘⇧D)“, Darstellung über die vorhandene Kürzel-Formatierung, nie hart codiert); zusätzlich
  **beim Gedrückthalten von `Mod`** (bzw. `Alt`) erscheint an den Knöpfen ein kleines Kürzel-Badge oder der Buchstabe
  wird unterstrichen (wie die Badges der Button-Leiste, `badgeFor` + gehaltene Modifier, 002). Kein dauerhaftes Badge
  (Dialoge sollen ruhig bleiben). Enter/Esc brauchen kein Badge; optional dezenter Hinweis „↵“ im Hauptknopf – im
  Design entscheiden.

## Aufgaben

1. **Bestand aufnehmen:** Tabelle aller `app-modal`-Dialoge (Datei, Titel, Knöpfe, welcher ist Haupt-/Neben-/Abbrechen,
   destruktiv?, Formular/Enter heute, Felder mit eigenem Enter). Ins Design-Dokument.
2. **Zentrale Mechanik:** Rollen-Direktive (E1), Tastenauswertung im `Modal` (E2/E3), Modifier-Anzeige (E4); Fokusfalle
   und Autofokus bleiben. Formulare: `(submit)` und `primary` dürfen nicht doppelt auslösen (genau ein Aufruf).
3. **Durchgang durch die Dialoge** (in sinnvollen Commits, z. B. „Datei-Operationen“, „Werkzeuge“, „Konfiguration“):
   Rollen setzen, destruktive Fälle markieren, Konfliktdialog (Überschreiben/Überspringen/Umbenennen, „für alle“) und
   Bestätigungsdialoge (`confirm-dialog.ts`) besonders prüfen. Dialoge ohne Hauptknopf (Ansicht F3, About, Tasks)
   bekommen nur Esc.
4. **Löschdialog** (Marcs Beispiel): Enter = „Move to trash“, Esc = Cancel, Kürzel E3 = „Delete permanently“; bei
   `cancelFirst` löst Enter nichts Destruktives aus. `trashHint` Einzahl/Mehrzahl (en/de).
5. Texte en/de (Tooltip-Format), `catalogs.spec.ts`; Doku: `docs/ui-layout.md` (Abschnitt Dialoge: Tastenregel),
   README-Bedienhinweis, Kürzel-Übersicht (⌨-Dialog) um einen Abschnitt „In Dialogen“ ergänzen.

## Akzeptanzkriterien

1. In jedem Dialog mit Abbrechen schließt **Esc** ohne Wirkung (offene Popups im Dialog zuerst).
2. In jedem Dialog mit Hauptknopf löst **Enter** ihn aus, auch wenn der Fokus in einem Textfeld, einer Checkbox oder
   einem Radio steht – außer in den E2-Ausnahmen; der Knopf wird dabei genau einmal ausgelöst.
3. Destruktive, nicht wiederherstellbare Aktionen lösen **nie** per bloßem Enter aus (endgültiges Löschen, gefährliche
   Pfade, Überschreiben ohne Rückfrage) – bestehende Schutzregeln (`cancelFirst`) bleiben grün.
4. Nebenknöpfe haben das gewählte Kürzel; es ist im Tooltip und als `aria-keyshortcuts` sichtbar und erscheint beim
   Halten des Modifiers am Knopf. Kürzel kollidieren nicht mit Textbearbeitung (`Mod+A/C/V/X/Z`) in Feldern.
5. Löschdialog wie in Aufgabe 4; Hinweis „restore them“/„wiederherstellen“ in der richtigen Zahl.
6. Gilt für alle in Aufgabe 1 gelisteten Dialoge (Tabelle im Bericht mit ✓ je Dialog).

## Tests

- `modal.spec.ts` (neu oder erweitert): Enter → primary aus Textfeld/Checkbox; nicht aus `textarea`, offenem Select,
  bei `isComposing`, `repeat`, `disabled`; Enter auf fokussiertem Nebenknopf löst diesen aus; Esc; Kürzel → secondary;
  destruktiver primary nicht per Enter; kein Doppelauslösen mit `(submit)`.
- `delete-dialog`/`ops.spec.ts`: Marcs Fall (Trash per Enter, Permanent per Kürzel, `cancelFirst`), Mehrzahl-Text
  (roter Test zuerst).
- Spec, der über alle Dialog-Komponenten prüft, dass jeder `.btn.primary` eine Rolle trägt (Regression für neue Dialoge).
- E2E unter Xvfb: Löschdialog, Kopieren-Dialog, Konfliktdialog nur mit Tastatur. `pnpm check` grün.

## Nicht in diesem Prompt

- Frei konfigurierbare Dialog-Kürzel im Kürzel-Dialog (höchstens Vorschlag im Bericht).
- Neue Knöpfe oder Umgestaltung einzelner Dialoge.
