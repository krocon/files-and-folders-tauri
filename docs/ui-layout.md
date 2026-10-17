# Fensteraufbau (Ziel)

> Verbindliche Beschreibung des Hauptfensters. Quellen: Marcs Screenshot der alten Version
> (`docs/legacy-screenshots/fnf-node-2016.png`) und das Layout von `files-and-folders-mr` (`docs/legacy-analysis-mr.md`
> §1). Umgesetzt in Prompt 004 (Gerüst), befüllt von 002 (Buttons, Menüs), 003 (Header-Inhalte, Statuszeile),
> 011 (Shell-Zeile), 014 (Menüs), 013/019 (Farben).

## Aufbau

Zwei gleichberechtigte Seiten wie im Norton/Total Commander. Jede Seite hat dieselben vier Zeilen, darunter liegen
zwei Zeilen über die volle Breite.

```
┌──────────────────────────────────────┬─┬──────────────────────────────────────┐
│ / Volumes / 2TB / jdownload / deu  ★ │ │ / Volumes                          ☆ │  1 Pfad-Header (Breadcrumb + Favorit)
├──────────────────────────────────────┤ ├──────────────────────────────────────┤
│ [▾] │ deu │ marc │ + −      👁  ⏷ [ ] │ │ [▾] │ new │ ebooks │ Volumes │ + −  │  2 Tab-Reiter
├──────────────────────────────────────┤ ├──────────────────────────────────────┤
│ ↓ Name               Ext  Size  Date │ │ Name               Ext  Size   Date  │
│ 📁 [Al Togo]              <DIR> …    │S│ 📁 [2TB]                <DIR>  …     │  3 Dateiliste (GuiExpert Table)
│ ▓▓ [Astronautenfamilie]  <DIR> … ▓▓ │p│ 📄 .DS_Store              6,148 …     │     Cursor nur im aktiven Panel
│ ✔ [Barbara Wolf]   354 MB …  (rot)  │l│                                      │     markiert = rot mit Häkchen
├──────────────────────────────────────┤i├──────────────────────────────────────┤
│ 7.71 MB / 7.71 MB in 0 / 1 Files, 4 / 49 Folders │ 0 B / 6 B in 0 / 1 Files, 0 / 3 Folders │  4 Statuszeile je Seite
├──────────────────────────────────────┴─┴──────────────────────────────────────┤
│ path> Shell-Befehl …                                     (nur wenn eingeblendet) │  5 Shell-Zeile (optional)
├───────────────────────────────────────────────────────────────────────────────┤
│ [F4 Edit] [F5 Copy] [F6 Move] [F7 MkDir] [F8 Delete] [Actions ▴] [Tasks 🐝] [🎨▴] [⌨] │  6 Button-Leiste
└───────────────────────────────────────────────────────────────────────────────┘
```

## Regeln

### Zwei Seiten und Splitter

- Zeilen 1–4 sind je in **links | Trenner | rechts** geteilt; **ein** Splitter verschiebt alle vier Zeilen gemeinsam
  (CSS-Grid mit gemeinsamer Spaltenbreite). Doppelklick auf den Trenner = 50 / 50. Die Position wird **gespeichert**
  (alt: nicht gespeichert).
- Klick irgendwo in eine Seite (Header, Tabs, Liste, Statuszeile) macht sie zum **aktiven Panel** (Quelle). Das andere
  ist Ziel. `Tab` wechselt die Seite.
- Aktives Panel deutlich erkennbar: eigene Farben für Liste und gewählten Tab (`--fnf-activepanel-*` aus den alten
  Designs). Der Zeilen-Cursor wird im inaktiven Panel nur gedämpft angezeigt (alt: gar nicht; beide Varianten im
  Design von 004 entscheiden).

### Zeile 1 – Pfad-Header

- Breadcrumb `/ Segment / Segment / …`, jedes Segment klickbar; bei langen Pfaden rechtsbündig, sodass das Ende des
  Pfads sichtbar bleibt. Daneben der **Favoriten-Stern** (an/aus).
- Ergebnis-Tab einer Suche: statt des Pfads `Search: "<Muster>"`; Doppelklick öffnet die Suche erneut (Prompt 009).

### Zeile 2 – Tab-Reiter

Von links nach rechts:
1. **Menü-Button ▾**: Laufwerke/Volumes, Favoriten, zuletzt besuchte Ordner (je Gruppe getrennt, ohne Dubletten).
   `Alt+1`/`Alt+2` aktivieren die Seite und öffnen dieses Menü (mr-Verhalten).
2. **Tabs** mit dem letzten Pfadsegment als Titel (Such-Tabs mit Lupe). Rechtsklick: Neu laden, Schließen, In anderes
   Panel verschieben, In anderes Panel klonen, Nach links/rechts verschieben. Langer Druck oder eigener Eintrag:
   Verlauf des Tabs. Doppelklick: neu laden.
3. **+ / −**: Tab klonen / aktuellen Tab schließen (letzter bleibt).
4. Rechtsbündig: **versteckte Dateien** ein/aus (👁), **Filter** ein/aus (⏷) und das Filter-Eingabefeld (nur sichtbar,
   wenn aktiv). Beide Einstellungen gelten **je Tab**.

### Zeile 3 – Dateiliste

GuiExpert Table (Prompt 001): Spalten Name, Ext, Size, Date; Ordner oben; `..`-Zeile (Prompt 003); markierte
Einträge rot mit Häkchen; Cursor als ganze Zeile. Darstellungsvarianten der alten Version (Ordner als `[Name]`,
Dateiname ohne Endung, Datum als `yyyy-mm-dd` + kleine Uhrzeit) werden in Prompt 015 als Einstellung angeboten.

### Zeile 4 – Statuszeile je Seite

`<Größe markiert> / <Größe gesamt> in <Dateien markiert> / <Dateien> Files, <Ordner markiert> / <Ordner> Folders`
(ohne `..`; markierte Zahlen im aktiven Panel hervorgehoben; Tooltip mit exakten Bytes). Einheiten korrekt (die
AngularJS-Version lag um Faktor 1000 daneben).

### Zeile 5 – Shell-Zeile (optional, Prompt 011)

`<Pfad>>` + Eingabefeld, Befehl läuft im Ordner des aktiven Panels; Ausgabe in einem Bereich darunter. Ein/aus per
Aktion (alt `Shift+F11`). Nur mit ausdrücklicher Sicherheitsentscheidung (Prompt 011).

### Zeile 6 – Button-Leiste

- **Funktions-Buttons** mit Tastenkürzel-Badge links und Kurzlabel. Der Satz wechselt mit gedrückter Modifier-Taste
  (Total-Commander-Prinzip, Konfiguration wie mr `button/defaults/data.json`):

  | gedrückt | Buttons |
  | --- | --- |
  | – | Edit, Copy, Move, MkDir, Delete |
  | Shift | Create File, Copy, Rename, MkDir, Delete |
  | ⌘ (macOS) bzw. Strg | View, Copy, Multi Rename, MkDir, Delete |
  | Alt/⌥ | View, Copy, Multi Rename, MkDir, Delete |

  Das Badge zeigt das Kürzel ohne die gerade gehaltenen Modifier (Shift gehalten → Rename zeigt `F6`). Deaktivierte
  Buttons (z. B. Rename bei Mehrfachauswahl) sind sichtbar, aber gedimmt. Die Freigaberegeln stehen in mr §3
  („Button enable states“).
- **Actions ▴**: Menü in vier Spalten (Navigation/Ansicht · Auswahl/Panels/Tabs · Dateioperationen · Konfiguration und
  Tools), jeder Eintrag mit Kürzel (mr §1.8).
- **Tasks**: Status der Job-Warteschlange (Fortschritt `fertig / gesamt`), Klick öffnet die Job-Liste (Prompt 005).
- **🎨 Theme-Menü** (die acht Designs + eigene, Prompt 013/019) und **⌨ Tastenkürzel-Übersicht** (Prompt 002).

## Abweichungen von der alten Version (bewusst)

- Splitter-Position, Sortierung und aktive Seite werden gespeichert.
- Kein Vollbild-Button im Fenster (Betriebssystem-Vollbild genügt); kein Debug-/Bug-Button.
- Modifier-Satz auch für **Strg** (Windows/Linux), `Alt` wird als `⌥` bzw. `Alt` korrekt angezeigt.
- Tastenkürzel werden auf `keydown` mit kanonischer Notation ausgewertet (Prompt 002), nicht auf `keyup`.
