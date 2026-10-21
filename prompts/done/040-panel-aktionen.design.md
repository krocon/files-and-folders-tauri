# Design 040: Panel-Aktionen

> **Status:** umgesetzt (21.10.2026), Branch `feat/panel-aktionen` · kleines Frontend-Feature, Phasen zusammengelegt,
> ohne Freigabe-Halt (wie 032) · kein Rust, keine neuen Abhängigkeiten.

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `WorkspaceStore.panels` (Tabs per Id, 004/031) | Tabs tauschen | **passt** – ein Tab trägt Pfad, Verlauf, Cursor, Filter, Table-Zustand und ggf. `search`; `FilePanel` zeigt den Tab, dessen Id aktiv ist (`showTab`), das Gedächtnis (`memory(tabId)`) hängt an der Id |
| `WorkspaceStore.requestNavigate(side, path)` | andere Seite navigieren | **passt** – `FilePanel` lädt den Pfad (auch Archiv- und Serverpfade; Ergebnis-Tab wird dabei Ordner-Tab, Review 009 #3) |
| `WorkspaceStore.actionDir()` | Ordner der aktiven Seite | **passt** – im Ergebnis-Tab der Suchordner |
| `FileListController.cursorEntry()/openCursor()` | Eintrag unter dem Cursor | **passt** – „..“ ist ein Ordner-Eintrag mit dem Elternpfad (`parentRow`) |
| Keymaps, `TABLE_NAVIGATION_KEYS` | Kürzel | `Mod+ArrowLeft/Right` sind frei (nur `Mod+ArrowUp/Down` gehören der Table) |

## 2. Entscheidungen

- **E1 – Tauschen = Tabs tauschen.** `SWAP_PANELS` tauscht die aktiven Tab-Objekte (mit Id) zwischen den Seiten statt nur
  die Pfade: Verlauf, Cursor, Filter und Ergebnis-/Belegungs-Tabs wandern mit, das Gedächtnis bleibt am Tab, ein
  zweites Tauschen stellt alles wieder her. Die aktive Seite bleibt aktiv und behält den Fokus (TC). `SWAP_PANELS_WITH_TABS`
  tauscht beide `PanelTabs` als Ganzes.
- **E2 – Transfer-Regel** (`panel-transfer-logic.ts`, rein): Ordner, Link auf Ordner, „..“ und – außerhalb von Archiven
  und Servern – Archive öffnen sich selbst; sonst (Datei, verlustbehafteter Name, synthetische Belegungs-Zeile, kein
  Cursor) der Ordner der aktiven Seite. Ist die genannte Seite die aktive, wirkt die Aktion wie Enter auf dem Ordner,
  bei einer Datei passiert nichts. Fokus bleibt auf der aktiven Seite.
- **E3 – Kürzel:** Windows/Linux wie TC `Ctrl+U`, `Ctrl+Shift+U`, `Ctrl+←/→`; `Ctrl+Alt+O` für *Ziel = Quelle* (in TC
  ohne Default-Kürzel). macOS `⌘U`, `⌘⇧U`, `⌘⌥O`, aber `⌘⌥←/→` statt `⌘←/→`: Auf macOS werden Kürzel mit `⌘` native
  Menü-Accelerators (014 E6); `⌘←/→` sind in Textfeldern „Zeilenanfang/-ende“ und sollen dort nie vom Menü
  abgefangen werden. In Textfeldern lässt der Dispatcher ohnehin jede Taste dem Feld (014 #1).
- **E4 – Menüs:** Fenster-Menü (nativ/HTML) nach den Seiten-Einträgen; im Actions-Menü (020) *Swap Panels* und
  *Target = Source* neben *Toggle Panels*. Palette automatisch.

## 3. Tests

- `workspace.store.spec.ts`: Tauschen per Id (andere Tabs bleiben, aktive Indizes, Sitzung), Tab-Leisten tauschen.
- `panel-transfer-logic.spec.ts`: Ordner, Link, „..“, Datei, verlustbehafteter Name, synthetische Zeile, kein Cursor,
  Archiv (auch im Archiv/auf dem Server).
- `workspace-actions.spec.ts`: alle fünf Aktionen inkl. Fokus und „genannte Seite = aktive Seite“.
- E2E unter Xvfb (Debug-Build): siehe Fortschritt.

## 4. Fortschritt

- [x] Logik, Store, Aktionen, Keymaps, Menüs, Texte en/de, Specs
- [x] Doku (README, features.md, feature-parity A.4, roadmap, CLAUDE.md)
- [x] `pnpm check` grün (Linux): 928 Frontend-Tests, 631 Rust-Tests, Lint, Format, Build
- [x] E2E Linux (Xvfb, Debug-Build, eigener `HOME` mit Testordnern `A` – `sub`, `Ünter Ordner`, `b ä.txt`, `pack.zip`,
  `x.txt` – und `B`): `Ctrl+U` tauscht A/B, der Cursor auf `x.txt` wandert mit, links bleibt aktiv; erneut `Ctrl+U` →
  wie vorher. `Ctrl+→` auf `sub`, `Ünter Ordner`, `pack.zip` (ZIP als Ordner, „read-only“) und „..“ öffnet das jeweils
  rechts, auf `b ä.txt` den Ordner A; Fokus bleibt links. `Ctrl+Alt+O` im ZIP → rechts dasselbe ZIP. `Ctrl+←` auf der
  linken Seite = Enter. Links drei Tabs (`Ctrl+T` ×2), rechts einer → `Ctrl+Shift+U` tauscht die Leisten samt aktivem
  Tab. Palette („panel“) listet alle Aktionen mit Kürzeln.
- Offen: macOS (natives Fenster-Menü, `⌘U`, `⌘⌥←/→`) und Windows bei Marc bzw. in der CI.
