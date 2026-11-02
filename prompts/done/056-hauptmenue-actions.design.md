# Design 056: Funktionen des Actions-Menüs im Hauptmenü

Status: umgesetzt (02.11.2026, selbständig ohne Rückfrage – Marc war nicht erreichbar) · Variante **A** (TC-Vorbild)

## Befund

Kein Eintrag fehlte wirklich (Spec „every action in the menu bar“ war grün); gefühlt fehlten sie, weil „File“ ~37
Einträge hatte (alle Werkzeuge) und die Labels anders hießen als im Actions-Menü. Die Rückfrage an Marc („welche
Einträge vermisst?“) war nicht möglich – bitte beim Durchklicken nachholen.

## Struktur (en / de)

```
File / Datei            Open, Open in new tab, View, Edit · New file, Create folder, Create several folders ·
                        Copy, Move, Link, Rename, Rename in list, Delete, Delete permanently · Pack, Unpack ·
                        Properties, Change attributes (· Quit, Win/Linux)
Edit / Bearbeiten       (macOS: Undo … Select all) · Markieren … · Copy to clipboard ▸            (unverändert)
View / Ansicht          wie bisher + „Actions menu“ (OPEN_ACTIONS_MENU, Alt+A) am Ende
Go / Gehe zu            unverändert
Commands / Befehle  NEU Find, Search again · Multi rename, Undo rename, Group files, Group series, Clean folders ·
                        Compare files, Compare folders, Synchronise · Find duplicates, Checksums ▸ (3),
                        Disk usage, Disk usage of the drive · Open with tool ▸, Call action
Configuration /         (Win/Linux: Settings) Theme editor, Buttons, Tools, Starter menu, File types, Shortcuts ·
  Konfiguration         Import old configuration   (= Spalte 4 des Actions-Menüs; vorher „Tools/Werkzeuge“)
Start, Window, Help     unverändert
```

Kein Top-Menü hat mehr als 25 Einträge auf oberster Ebene (Spec).

## Labels

Entscheidung: Für jede Aktion, die im Actions-Menü steht, zeigt die Menüleiste (HTML und nativ) **das Label des
Actions-Menüs** (`ACT_TEXTS.menu`, mr-Wortlaut, von Marc in 054/055 gepflegt) – so heißt „Clean Folders…“ an beiden
Stellen gleich. Alle übrigen Aktionen behalten das Katalog-Label; Palette und Kontextmenüs bleiben beim Katalog.
Alternative (Actions-Menü auf Katalog-Labels umstellen) bewusst nicht gewählt, weil sie Marcs Wortwahl aus 054/055
(„Enhance Selection…“ usw.) wieder ändern würde – leicht umzuschalten (`menuBarLabels()` in `menu-model.ts`).

## Tests

`menu-model.spec.ts`: Spiegel-/Label-Test (en + de), ≤ 25 Einträge, keine Id doppelt je Top-Menü, Datei ohne
Werkzeuge; „every action in the menu bar“ jetzt inkl. `OPEN_ACTIONS_MENU`. `menus.spec.ts`: Tastatur der HTML-Leiste mit
den neuen Top-Menüs.
