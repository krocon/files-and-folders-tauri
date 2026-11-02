# Prompt 055: Actions-Menü – Ellipse „…“ einheitlich: genau dort, wo ein Dialog aufgeht

> **Slug:** `actions-menue-ellipse` · **Braucht:** 020 (Actions-Menü), 015 (Texte en/de), **054** (Wording „Create folder“) · **Umfang:** XS (nur Texte + Specs, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md` (Kurzform genügt). 054 und 055 ändern dieselbe Datei – sinnvoll **zusammen**
> in einem Branch umsetzen. **055 hat Vorrang** bei der Ellipse: „Create folder“ aus 054 wird hier zu „Create folder…“.

## Auftrag (Marc, 01.11.2026)

Die Ellipse „…“ im Actions-Menü einheitlich einsetzen: **Wo ein Dialog aufgeht, ist „…“ das Suffix** – sonst nicht.

## Ist-Zustand

Das Actions-Menü (`features/actions/actions-menu-def.ts`, Spalten wie mr) hat eigene Labels in
`features/actions/actions-texts.ts` (`ACT_EN.menu`, deutsch `menu` weiter unten). Die Ellipse wurde aus mr übernommen
und ist uneinheitlich: `Rename…`, `Pack…`, `Find…` haben sie; `Copy`, `Move`, `Delete`, `Enhance Selection` öffnen
ebenfalls einen Dialog, haben sie aber nicht; `Disk Usage…` hat sie, startet aber (vermutlich) direkt einen Scan.

## Regel

- **„…“**, wenn der Eintrag einen **Dialog** (Modal über `DialogService`/`dialogs.show`, auch Bestätigungsdialog wie
  Löschen) oder die **Befehlspalette** öffnet, also vor der eigentlichen Ausführung noch etwas fragt.
- **Kein „…“**, wenn der Eintrag sofort etwas tut (umschalten, neu laden, kopieren in die Zwischenablage, markieren,
  Seite wechseln, Tab anlegen/schließen, Scan starten, Tool starten).
- **Grenzfall** `OPEN_CHDIR_DLG` „Change Dir…“: öffnet keinen Dialog, sondern das Pfadfeld im Header (`requestPathEdit`,
  s. 053). Es fragt aber eine Eingabe ab → **„…“ behalten** und die Regel im Code-Kommentar so formulieren: *„… = öffnet
  einen Dialog oder fragt vorher eine Eingabe ab“*. (Weicht das von Marcs Wortlaut ab: im Bericht nennen.)
- Eine Abweichung gibt es, wenn ein Eintrag je nach Einstellung mal sofort ausführt, mal fragt (z. B. Löschen ohne
  Bestätigung, falls es so eine Einstellung gibt): dann zählt der **Standard** – prüfen und im Bericht nennen.

## Aufgaben

1. **Jeden Eintrag am Handler prüfen, nicht am Namen raten** (`*_DLG` heißt nicht automatisch Dialog): Handler über
   `actions.register({ ID: … })` finden (`grep -rn "ID: {" src/app/features`) und festhalten, was er öffnet. Ergebnis als
   Tabelle in den Bericht (Id · öffnet · Label en/de vorher → nachher).
2. Vorläufige Einschätzung (zu bestätigen):

   | Id | heute (en) | erwartet |
   |---|---|---|
   | `OPEN_MARK_PATTERN_DLG` / `OPEN_UNMARK_PATTERN_DLG` | Enhance/Reduce Selection | **mit …** (`dialogs.show('mark-pattern')`) |
   | `OPEN_COPY_DLG`, `OPEN_MOVE_DLG` | Copy, Move | **mit …** (Kopieren/Verschieben-Dialog) |
   | `OPEN_DELETE_DLG`, `DELETE_PERMANENT` | Delete, Delete permanently | **mit …** (`ops.openDelete`, Bestätigung) |
   | `OPEN_MKDIR_DLG` | MkDir (054: Create folder) | **Create folder…** |
   | `OPEN_DISK_USAGE` | Disk Usage… | prüfen – startet `usageStart` direkt einen Scan → **ohne …** |
   | `OPEN_ATTRIBUTE_DLG` | File Attributes… | prüfen (`props.open()` = Eigenschaften-Dialog?) |
   | `OPEN_COMMAND_PALETTE`, `OPEN_FIND_DLG`, `OPEN_SELECT_IF_DLG`, `OPEN_CONNECTIONS_DLG`, `OPEN_RENAME_DLG`, `OPEN_CHANGE_ATTRIBUTES_DLG`, `OPEN_UNPACK_DLG`, `OPEN_PACK_DLG`, `OPEN_MULTIRENAME_DLG`, `OPEN_MULTIMKDIR_DLG`, `OPEN_GROUPFILES_DLG`, `OPEN_SERIES_GROUP_DLG`, `OPEN_DELETE_EMPTY_FOLDERS_DLG`, `OPEN_FIND_DUPLICATES_DLG`, `OPEN_SETUP_DLG`, `OPEN_THEMES_DLG`, `OPEN_BUTTON_CONFIG_DLG`, `OPEN_TOOL_CONFIG_DLG`, `OPEN_SHORTCUT_DLG`, `OPEN_ABOUT_DLG` | mit … | mit … (bestätigen) |
   | `RELOAD_DIR`, `TOGGLE_*`, `QUICK_VIEW`, `COPY_2_CLIPBOARD_*`, `INVERT_MARKS`, `SELECT_ALL`, `DESELECT_ALL`, `NAVIGATE_*`, `SELECT_*_PANEL`, `TOGGLE_PANEL`, `SWAP_PANELS`, `TARGET_EQUALS_SOURCE`, `CLONE_TAB`, `CLOSE_TAB` | ohne | ohne |
   | `@tools` (konfigurierte Tools) | Tool-Label | ohne (Start ohne Rückfrage) – Labels kommen aus `tools.json`, nicht anfassen |

3. `actions-texts.ts`: **Englisch und Deutsch** gleich behandeln (`'Kopieren…'`, `'Verschieben…'`, `'Löschen…'`,
   `'Endgültig löschen…'`, `'Auswahl erweitern…'`, `'Auswahl verkleinern…'`, `'Ordner anlegen…'`, ggf.
   `'Speicherbelegung'` ohne). Immer das echte Zeichen `…` (U+2026), nie `...` – vorhandene `...` mit ersetzen.
4. **Regressionstest**, damit es so bleibt: `actions-menu.spec.ts` prüft für alle Menü-Einträge beider Sprachen
   „endet auf `…` ⇔ Id steht in einer Liste `OPENS_DIALOG`“ (Liste in `actions-menu-def.ts` neben den Spalten, mit dem
   Regel-Kommentar). Zusätzlich: kein Label enthält `...`.
5. Nur als **Befund** im Bericht (nicht umbauen): Folgt der Aktionskatalog (`action-catalog.ts`/`.de.ts` – Palette,
   Button-Leiste über `shortLabel`, native Menüleiste, Kontextmenü) derselben Regel? Wo nicht, Liste für einen
   Folge-Prompt.

## Akzeptanzkriterien

1. Im Actions-Menü (en und de) endet jeder Eintrag, der einen Dialog/die Palette öffnet (bzw. eine Eingabe abfragt), auf
   „…“; kein sofort ausführender Eintrag hat „…“.
2. Copy, Move, Delete, Delete permanently, Enhance/Reduce Selection und Create folder tragen jetzt „…“; Disk Usage gemäß
   Prüfung.
3. Der neue Spec schlägt fehl, sobald ein Label der Regel widerspricht oder `...` verwendet.
4. Menübreite und Buchstabensprung funktionieren unverändert (Sichtprüfung `pnpm screenshots --theme light --scene
   actions-menu`).

## Tests

- `actions-menu.spec.ts` (Regel-Test aus Aufgabe 4, angepasste erwartete Labels).
- `catalogs.spec.ts` grün; `pnpm check` grün.

## Nicht in diesem Prompt

- Ellipsen im Aktionskatalog, in der nativen Menüleiste und in Kontextmenüs angleichen (nur Befund, ggf. Folge-Prompt).
