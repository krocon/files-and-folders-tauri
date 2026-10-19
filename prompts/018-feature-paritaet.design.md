# Design 018: Feature-Parität (zusammen mit 020)

> **Status:** ✅ umgesetzt (2026-10-19) · **Branch:** `feat/feature-paritaet` · **Vorlage:** `old_project/`
> (files-and-folders-mr) · Ergebnis: [`docs/feature-parity.md`](../docs/feature-parity.md)

## 1. Vorgehen

- `old_project/` (Quellcode der mr-Version, gitignored) per `device_bash` als `tar` (ohne Bilder/Fonts, 4 MB) in den
  Container geholt. Ein separater Agent hat **nur lesend** alle Aktions-Ids, Default-Kürzel je OS, Button-Sätze,
  Dialoge und Optionen, Listenverhalten, Panels/Tabs, Operationen, Konfigurationsdateien, Shell/KI/Electron und die
  Fehlerlisten (mr §11, legacy §9) gegen die Neuauflage inventarisiert und jeden Testverweis per grep geprüft.
- Daraus `docs/feature-parity.md` neu aufgebaut (Abschnitte A–I mit Referenz alt, Umsetzung neu, Status, Tests,
  Abweichung); kleine Lücken (J) geschlossen, große (K) als Folge-Prompts 021–028 vorgeschlagen.
- Prompt 020 (Actions-Menü) gleich mit umgesetzt – Design `020-actions-menue.design.md` §5.

## 2. Entscheidungen

- **E1 – Kürzel**: Nur Kürzel der alten Version übernehmen, die dort wirklich feuerten. mr verglich rohe Strings in
  fester Modifier-Reihenfolge; alles mit `cmd+alt…`, `cmd+ctrl…`, `cmd+shift…` war tot (in der Matrix mit † markiert)
  und wird nicht „wiederhergestellt“. Übernommen (J1–J6): macOS ⌃⌘D = alle abwählen (war in der Neuauflage
  Pfadeingabe), ⌃⌥D bzw. Strg+Alt+D = Pfadeingabe, ⌃⌘C/M/R/A, ⌃⌥N/M/G, ⌃F6, ⌃⌥⇧D, ⌃⌥⇧F bzw. Strg+Alt+Shift+F,
  ⌃⌥A bzw. Strg+Alt+A. `Ctrl+Alt+9` nicht (AltGr+9 = `]` auf deutschen Tastaturen).
- **E2 – Actions-Menü per Tastatur** (mr `OPEN_MENU`): neue Id `OPEN_ACTIONS_MENU`, macOS ⌃K ⌃M (Akkord wie mr),
  Windows/Linux `Ctrl+F12` (mr); die Befehlspalette gibt `Ctrl+F12` dafür ab (behält `Ctrl+Shift+P`).
- **E3 – Leertaste**: `TOGGLE_MARK_AND_RETREAT` (Shift+Leertaste, mit Auto-Repeat) und `TOGGLE_MARK`
  (Mod+Shift+Leertaste, ohne Bewegen) wie mr `SHIFT_SPACE_PRESSED`/`TOGGLE_SELECTION_CURRENT_ROW`.
- **E4 – Go to anything** listet wieder Ordner (Tabs beider Seiten, ihre Verläufe, Favoriten, zuletzt), nur bei
  Eingabe und nicht im Dialog „Call action“ (F10); Enter öffnet den Ordner im aktiven Panel.
- **E5 – Tab-Verlauf** als Untermenü „History ▸“ im Tab-Kontextmenü (mr: Long-Press, das mit dem Kontextmenü
  kollidierte – mr-Bug 12); Shift+Klick schließt einen Tab wie in mr.
- **E6 – Bewusst nicht**: Strg/⌘+Alt+Klick zum Abwählen (Alt+Klick zieht unter Linux oft das Fenster), feste Kürzel
  für Default-Tools, Download/Server-Shell/Electron (Transport der Web-App), tote Ids der alten Version.
  Shell-Leiste: CLAUDE.md §4 verbietet beliebige Shell-Kommandos aus dem Frontend → eigener Prompt 021 mit PTY und
  Sicherheitsmodell.

## 3. E2E-Arbeitstag (Linux, Xvfb, Debug-Build)

Navigieren in `work/src`, drei Dateien mit `Insert` markiert, `F5` → Konfliktdialog bei `notes.txt` → „Overwrite“
(`Alt+O`), Inhalt im Ziel geprüft; Multi-Rename (`Ctrl+M`) mit `Episode [C].[E]` → `Episode 0001…0003.mkv`; Gruppieren
(`Alt+G`) „Running number“ → Kopie nach `dst/Episode/`; Suche `Alt+F7` `*.txt` → Ergebnis-Tab mit 2 Treffern; `Ctrl+T`
klont den Tab; Neustart → Tabs wieder da; Actions-Menü ▴ mit 4 Spalten, Trennern und Badges.

Gefundene Fehler (je zuerst ein roter Test):
1. „Cancel copying“ im Konfliktdialog **unsichtbar** im Design Classic light: Gefahr-Buttons nutzten
   `--color-danger-text` (in den alten Designs hell für das rote Fehlerpanel) auf Dialog-Hintergrund. Jetzt immer mit
   `--color-danger-bg` (geprüftes Kontrastpaar); Spec über alle Styles (`danger-pairs.spec.ts`).
2. Ein **Ergebnis-Tab** hieß nach einem Neustart „…“ (leerer Titel): er merkt sich jetzt den Titel seines Ordners.
3. Linux: `Ctrl+Q` beendet nicht – gewollt (`Ctrl+Q` = Schnellansicht wie TC, Design 010); in der Matrix als ✖.

Nicht möglich im Container: macOS und Windows (Checkliste in `TODO.md`).

## 4. Fortschritt

- [x] Inventur (separater Agent, nur lesend) · [x] Matrix · [x] kleine Lücken J1–J7, J9–J13 mit Tests ·
  [x] Actions-Menü (020) · [x] E2E Linux · [x] Doku (README, roadmap, prompts/README, CLAUDE.md, TODO)
