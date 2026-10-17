# Files and Folders (Tauri)

Plattformübergreifender Dateimanager für macOS, Windows und Linux in Richtung Total Commander –
gebaut mit **Tauri 2**, **Angular 22** (Signals, zoneless), **TypeScript**, **SCSS** und einem
**Rust**-Backend.

> **Status: Prompt 006 (Basisoperationen) auf Basis von 001–005.** Zwei Seiten wie im Norton/Total Commander mit Pfad-Header, Tabs,
> GuiExpert-Dateiliste und Statuszeile, gemeinsamer Splitter, Button-Leiste (Gerüst); Tabs, aktive Seite, Splitter,
> Favoriten und Fenstergröße werden gespeichert. Kopieren, Verschieben, Löschen (Papierkorb), Ordner/Datei anlegen, Umbenennen, Multi-Rename mit Rückgängig, Dateien gruppieren, Ordner aufräumen, mehrere Ordner anlegen. Siehe [docs/roadmap.md](docs/roadmap.md) und [prompts/README.md](prompts/README.md).

## Was funktioniert

- **Fensteraufbau** nach [docs/ui-layout.md](docs/ui-layout.md): links und rechts je Pfad-Header (Breadcrumb,
  klickbar, bei langen Pfaden rechtsbündig; Favoriten-Stern), Tab-Leiste, Dateiliste und Statuszeile
  (`markiert / gesamt in Dateien / Ordner`); ein Splitter für alle Zeilen; darunter die Button-Leiste (noch
  fehlende Funktionen gedimmt, „kommt in Prompt …“).
- **Aktive Seite** = Quelle, andere = Ziel; Klick in eine Seite oder `Tab` wechselt, Ansage für Screenreader.
- **Tabs je Seite**: klonen (`+`), schließen (`−`, der letzte bleibt), Kontextmenü (Neu laden, Schließen, ins andere
  Panel verschieben/klonen, nach links/rechts), Doppelklick lädt neu, Mittelklick schließt; jeder Tab behält Pfad,
  Sortierung, Spaltenbreiten, Cursor und Scrollposition.
- **Sitzung**: Tabs beider Seiten, aktive Seite, Splitter, Favoriten und Fenstergröße/-position werden in
  `session.json` im App-Config-Verzeichnis gespeichert und beim Start wiederhergestellt; gelöschte Ordner →
  nächster existierender Elternordner mit Hinweis; kaputte Datei → Defaults + Warnung (alte Datei als `.bad`).
- Ohne gespeicherte Sitzung: beide Seiten im Home-Ordner des aktuellen Benutzers.
- **Navigation** (Prompt 003): „..“-Zeile, Zurück/Vor je Tab (auch Maustasten 4/5) mit Cursor und Scrollposition,
  Cursor und Markierung je Ordner gemerkt, Menü ▾ mit Home, Favoriten und zuletzt besuchten Ordnern (`Alt+F1`/`Alt+F2`),
  Pfadeingabe (`Strg/⌘+L`, `~` erlaubt, Datei → Ordner mit Cursor darauf).
- **Versteckte Dateien** (👁, `Strg+H` / `⌘⇧.`) und **Schnellfilter** (⏷, `Strg/⌘+Alt+F`, z. B. `*.jpg -thumb`) je Tab;
  **Typ-Ahead**: Buchstaben tippen springt zum passenden Namen.
- **Ordnergröße**: Leertaste auf einem Ordner markiert ihn und berechnet die Größe (abbrechbar, folgt keinen Symlinks);
  `Alt+Shift+Enter` für alle markierten Ordner.
- **Dateien öffnen** mit der Standard-App (Enter/Doppelklick); Programme erst nach Rückfrage.
- **Kopieren und Verschieben** (`F5`/`F6`, Prompt 005/006): Dialog mit Live-Zählung (Dateien, Ordner, Größe), Zielordner
  (Textfeld + Vorschläge: andere Seite, Tabs, Favoriten, zuletzt besucht), neuem Namen bei einer einzelnen Quelle
  (Kopie im selben Ordner), Vorgabe bei vorhandenen Dateien und „im Hintergrund“. Läuft als Job mit Fortschritt, Rate
  und Restzeit (Tasks-Button, Task-Liste `Strg+F11` / `⌃K F6`), Pause, Weiter, Abbruch; nie eine halbe Datei unter dem
  echten Namen. Existiert eine Datei schon: Überschreiben, Überspringen (Vorgabe), Umbenennen, wenn neuer, Abbrechen –
  auch „für alle“. Verschieben benennt auf demselben Laufwerk nur um; über Laufwerke wird jede Datei erst kopiert und
  dann gelöscht.
- **Löschen**: `F8`/`Entf` (macOS `⌘⌫`) in den Papierkorb, `Shift+F8`/`Shift+Entf` (macOS `⌘⌥⌫`) endgültig mit rotem
  Dialog (Enter = Abbrechen); schreibgeschützte Einträge fragen nach. Wurzel, Laufwerke, Home- und Systemordner
  brauchen eine zweite Bestätigung.
- **Ordner anlegen** (`F7`, auch `a/b/c`; Vorschlag `S03` nach `S01`, `S02`), **Datei anlegen** (`Shift+F4`),
  **Umbenennen** (`Shift+F6` als Dialog, `F2` direkt in der Liste; die Endung ist nicht markiert). Der Cursor steht
  danach auf dem Ergebnis. Alle Operationen nehmen die markierten Einträge, sonst den unter dem Cursor.
- **Multi-Rename** (`Strg+M`/`Strg+F6`, macOS `⌘F6`): Muster mit `[N]` `[E]` `[C]` `[P]` `[Q]` `[R]` `[D]` `[T]`,
  Bereichen (`[N2-5]`), Zähler, Schreibweise (bis Chicago Manual of Style), Umlaute/riskante Zeichen/Leerzeichen,
  vier Ersetzungszeilen mit Regex und „nur wenn“, Makros, Vorlagen; Live-Vorschau (GuiExpert Table, 10 000 Einträge)
  mit Prüfung gegen die Platte. `README`, Ordner und `.gitignore` bleiben ganz, `a.tar.gz` behält `tar.gz`; Tausch
  `a↔b` und Ketten laufen sicher, nie wird überschrieben. **Rückgängig** in der Task-Liste oder per Befehlspalette
  („Undo last multi rename“).
- **Dateien gruppieren** (`Alt+G`, `Strg+Alt+G`): markierte (sonst alle angezeigten) Einträge nach laufender Nummer,
  Minus-Trenner, erstem Wort, ersten Buchstaben oder in einen neuen Ordner – Vorschau-Tabelle, Mindestgröße, Klammern
  ignorieren; Ziel `<anderes Panel oder Quellordner>/<Gruppe>/<Name>` per Kopieren oder Verschieben, Konflikte über
  den Dialog der Job-Engine.
- **Ordner aufräumen** (`Strg+Alt+R`, macOS `⌘⌥R`): leere Ordner (optional mit Systemmüll wie `.DS_Store`) und
  Dateien nach Muster (`*.bak`) unterhalb des aktuellen bzw. der markierten Ordner – Vorschau, Papierkorb als Standard,
  nie oberhalb des Startordners, Links werden nie verfolgt; jeder Eintrag wird vor dem Löschen erneut geprüft.
- **Mehrere Ordner anlegen** (`Strg+F7`, macOS `⌘F7`): Vorlage mit Zähler (`S[C]` → `S01` … `S05`), Buchstabe `[L]`,
  Elternordner `[P]`, Schreibweise.
- **Suche** (`Alt+F7`, Prompt 009): Name als Glob (`*.mp3;*.flac`), Regex oder Text, Groß/klein, ganzer Name/Teil;
  Dateien/Ordner/Links, Größe, Änderungsdatum (letzte N Tage, von–bis), Text im Inhalt (mit Größenlimit), versteckte
  Einträge, Links folgen (zyklensicher), max. Tiefe, Ausschlüsse (`.git; node_modules`), max. Treffer; Vorlagen
  (Filme, Bilder, Audio, Comics …), eigene Vorlagen und letzte Suchen (für die Sitzung). Treffer streamen in einen
  **Ergebnis-Tab** (Lupe, Spinner, Spalte „Folder“): markieren, kopieren, verschieben, löschen wie im Ordner,
  „Zur Datei“ (`Strg+Shift+G` / `⌘⇧G`) öffnet den Ordner in neuem Tab mit Cursor auf der Datei, Enter auf einem Ordner
  ebenso; `Stop`, `Search again` (`Strg+Shift+F7`), Doppelklick auf den Header ändert die Suche. Unlesbare Ordner
  werden gemeldet; Ergebnis-Tabs werden nicht gespeichert.
- **Ordner-Finder** (`Alt+F10`, alt „Change Dir“): alle Unterordner bis Tiefe 5 (Regler 1–10/∞), Filter unscharf und
  live, `↑ ↓ Bild↑ Bild↓`, Enter wechselt dorthin, Esc bricht ab.
- Fehler einzelner Dateien werden gesammelt und in der Task-Liste gelistet; Beenden mit laufenden Jobs fragt nach.
- **Laufwerke** (Prompt 011): das Ordnermenü ▾ (`Alt+F1`/`Alt+F2`) zeigt die Laufwerke mit Dateisystem und freiem
  Platz – Linux Mountpoints (ohne `proc`, `tmpfs`, Snaps …), macOS `/Volumes`, Windows Laufwerksbuchstaben. Ein totes
  Netzlaufwerk erscheint nach 1,5 s als „not reachable“, die Oberfläche blockiert nicht.
- **Im Dateimanager zeigen** (`Strg/⌘+Shift+F`: Finder `open -R`, Explorer `/select`, Linux über D-Bus
  `FileManager1`, sonst der Ordner) und **Terminal hier** (`Strg/⌘+Shift+C`: macOS Terminal, Windows Terminal bzw.
  `cmd`, Linux `$TERMINAL` → `x-terminal-emulator` → konsole/gnome-terminal/… je Desktop; eigenes Terminal in
  `tools.json`, z. B. `"terminal": {"program": "open", "args": ["-a", "iTerm", "{dir}"]}`).
- **Externe Tools**: `tools.json` im App-Config-Verzeichnis (Tool configuration… → „Open tools.json“ legt sie mit den
  Defaults an). Je Tool `program` + `args` (Array, **keine Shell**), Platzhalter je Argument `{file}`, `{files}`,
  `{name}`, `{dir}`, `{targetDir}`, `perFile` (höchstens 50 Starts je Aufruf), `fileLimit`, `shortcut`
  (Keymap-Notation), `workingDir` (absolut nach dem Ersetzen). `program` ist ein blanker Name (Suche im `PATH`) oder
  ein absoluter Pfad. **Empfohlen: `{file}`/`{files}`** (volle Pfade) statt `{name}` – `{name}` am Argumentanfang wird
  bei führendem `-` zu `./-name`. Tools, die an die Standard-App übergeben (`xdg-open`, `open`, `explorer`, … oder
  `"defaultApp": true`), fragen bei Programmen/Skripten nach wie `Enter`. Einträge im alten Format
  (`cmd`, `para`, `$file`, `$dir`) werden beim Laden umgestellt. Tools stehen in der Befehlspalette, im Actions-Menü,
  unter **Open with tool…** (`Strg/⌘+Shift+X`) und auf ihrem Kürzel; `F4` startet das Tool `edit` (macOS
  Text-Editor, Windows Notepad, Linux Standard-App – für einen Editor z. B.
  `{"id": "edit", "label": "Edit", "program": "gnome-text-editor", "args": ["{files}"]}` eintragen).
- **Zwischenablage**: Namen (`Strg/⌘+Alt+N`) bzw. volle Pfade (`Strg/⌘+Alt+C`) der markierten Einträge (sonst
  Cursor, Ordner eingeschlossen) als Zeilen; als JSON über Befehlspalette/Actions-Menü.
- **Ansicht** (`F3`): Text mit Zeilennummern, Suche (`Strg/⌘+F`, Enter/`F3` = nächster Treffer), Umbruch, Kodierung
  (Auto, UTF-8, UTF-16 LE/BE, Windows-1252, Latin-1), Hex-Ansicht für Binärdateien, Bilder mit Einpassen/Zoom;
  `←`/`→` blättert durch die Dateien des Panels (der Cursor folgt), `Esc` schließt. Der Typ wird am **Inhalt** erkannt
  (`bild.txt`, das ein PNG ist, wird als Bild gezeigt, mit Hinweis); große Dateien zeigen nur den Anfang (1 MiB Text,
  4 KiB Hex) – auch eine 2-GB-Datei öffnet sofort.
- **Schnellvorschau** (`Strg+Q`, macOS `⌃Q`): das andere Panel zeigt die Datei unter dem Cursor.
- **Eigenschaften** (`Alt+Enter`, macOS auch `⌘I`): Typ, Größe (Ordner per Knopf als Job), Zeiten, Rechte `rwxr-xr-x`
  und Eigentümer bzw. Windows-Attribute, Link-Ziel. **Bearbeiten** (`F4`) startet das Tool `edit` (Default: Standard-App, s. Externe Tools).
- **Automatische Aktualisierung** (012): die sichtbaren Ordner beider Panels werden überwacht (`notify`, nicht
  rekursiv); Dateien, die andere Programme anlegen, ändern, umbenennen oder löschen, erscheinen nach < 1 s – Cursor,
  Markierung und Scrollposition bleiben, ein gelöschter Cursor-Eintrag gibt den Cursor an den nächsten weiter.
  Massenänderungen (z. B. 50 000 entpackte Dateien) laden höchstens alle 1,5 s neu; ein gelöschter Ordner führt zum
  nächsten vorhandenen Elternordner. Netzlaufwerke werden nicht überwacht (Hinweis in der Statuszeile, `Strg/⌘+R`).
- **Drag & Drop** (012): Markierung (bzw. die Zeile) in das andere Panel oder auf eine Ordnerzeile ziehen öffnet den
  Kopieren-Dialog (mit `Shift`, macOS `⌘`: Verschieben); `Esc` bricht ab. Dateien aus Finder/Explorer/Dateimanager auf
  ein Panel oder eine Ordnerzeile ziehen öffnet den Kopieren-Dialog. Ziehen aus der App ins System: noch nicht.
- **Kontextmenü** (Rechtsklick, `Shift+F10`, Kontextmenü-Taste): passend zu Datei, Ordner, Markierung, freier
  Fläche oder Ergebnis-Tab, mit Kürzeln und Untermenüs (**Open with tool** mit den Tools, **Copy to clipboard**);
  nicht verfügbare Einträge sind gedimmt. Rechtsklick setzt den Cursor, die Markierung bleibt – mit Markierung wirkt
  das Menü auf die markierten Einträge (Überschrift „N marked entries“).
- **Menüleiste** File · Edit · View · Go · Tools · Window · Help mit allen Aktionen und ihren Kürzeln: unter macOS
  nativ (App-Menü mit About, Settings `⌘,`, Services, Hide, Quit; Edit mit Copy/Paste für Textfelder), unter
  Windows/Linux in der App (`Alt+M` fokussiert sie). Kürzel kommen aus der Keymap inkl. Override.
- Rust-Command `list_directory(path: Option<String>)` liefert Name, Pfad, Typ (Datei/Ordner/Symlink
  inkl. Ziel-Typ), Größe, Änderungszeit und Hidden-Kennzeichen (Dot-Files sowie natives
  Hidden-Flag unter Windows/macOS).
- Dateiliste mit der [GuiExpert Table](https://gui.expert) (virtuelles Scrollen, 100 000 Einträge flüssig):
  Spalten Name, Erweiterung, Größe (`<DIR>` für Ordner), Geändert; Spaltenbreiten veränderbar und beim
  Ordnerwechsel erhalten.
- Sortieren per **Doppelklick** auf den Spaltenkopf; Ordner bleiben in beiden Richtungen oben, Namen natürlich
  sortiert (`file2` vor `file10`), leere Werte unten.
- Zeilen-Cursor (aktiv/inaktiv), markierte Einträge rot mit Häkchen, versteckte Einträge gedimmt.
- Lade-, Leer- und Fehlerzustände (z. B. „Access denied“) ohne Absturz; die vorherige Ansicht bleibt bei Fehlern.
- Unicode, Umlaute, Leerzeichen; Pfadlogik ausschließlich über `std::path`.
- **Farbschemata** (Prompt 013): `Light` und `Dark` mitgeliefert, „Follow the system“ (Standard, folgt
  `prefers-color-scheme` live) oder ein festes Schema – über 🎨 in der Button-Leiste, die Befehlspalette
  („Colour scheme: …“) oder `Strg+Alt+Shift+T` / `⌘⌃⌥T` (nächstes Schema). Der Dialog **Colour schemes…** ist ein
  Live-Editor: jede Farbe (Liste, Cursor aktiv/inaktiv, markiert, versteckt, Symlink, Kopf, Tabs, Statuszeile,
  Buttons, Dialoge, Scrollbar, Tooltip) mit Farbwähler und Textfeld, Vorschau sofort, Kontrastprüfung (WCAG AA) mit
  Liste der verletzten Paare; „Save as new“/„Save“/„Delete“/„Reset“. **Import** liest die Datei unter dem Cursor
  (auch alte `{name, colors}`-Dateien), **Export** schreibt `<Name>.theme.json` in den Ordner des aktiven Panels.
  Gespeichert in `themes.json` im App-Config-Verzeichnis.

### Tastenkürzel (Stand Prompt 002)

Jede Funktion ist eine Aktion mit stabiler Id; Kürzel kommen aus einer Keymap je Betriebssystem
(`src/app/core/actions/keymaps/`) und lassen sich im Dialog **Keyboard shortcuts** (⌨ in der Button-Leiste,
`Strg+Shift+K` / `⌘⇧K`) ändern – gespeichert in `keymap.json` im App-Config-Verzeichnis. Alle Aktionen findet die
Befehlspalette (`Strg+Shift+P` / `⌘⇧P`). Aktionen späterer Prompts sind schon gelistet und gedimmt.
Einfache Tasten (Leertaste, Enter, Tab, Buchstaben) wirken nur, wenn die Dateiliste den Fokus hat; die
Navigation (`↑ ↓ Bild↑ Bild↓ Pos1 Ende`) bleibt bei der Tabelle.

| Aktion | Windows / Linux | macOS |
| --- | --- | --- |
| Open | `Enter` | `Enter` |
| Parent folder | `Backspace` | `Backspace` |
| Open folder in new tab | `Ctrl+Enter` | `⌘Enter` |
| Reload | `Ctrl+R` | `⌘R` |
| History back | `Alt+ArrowLeft` | `⌘[` |
| History forward | `Alt+ArrowRight` | `⌘]` |
| Go to path… | `Ctrl+L` | `⌘L`, `⌘⌃D` |
| Find folder (change dir)… | `Alt+F10` | `⌥F10` |
| Go to file (search result) | `Ctrl+Shift+G` | `⌘⇧G` |
| Folder menu, left panel | `Alt+F1` | `⌥F1` |
| Folder menu, right panel | `Alt+F2` | `⌥F2` |
| Calculate folder sizes | `Alt+Shift+Enter` | `⌥⇧Enter` |
| Context menu | `Shift+F10`, Kontextmenü-Taste | `⇧F10` |
| Menu bar | `Alt+M` | – (nativ) |
| Settings… (ab 015) | `Ctrl+,` | `⌘,` |
| Toggle filter | `Ctrl+Alt+F` | `⌘⌥F` |
| Toggle hidden files | `Ctrl+H` | `⌘⇧.` |
| Toggle shell | `Shift+F11` | `⇧F11` |
| Copy names to clipboard | `Ctrl+Alt+N` | `⌘⌥N` |
| Copy full paths to clipboard | `Ctrl+Alt+C` | `⌘⌥C` |
| Show in file manager | `Ctrl+Shift+F` | `⌘⇧F` |
| Open terminal here | `Ctrl+Shift+C` | `⌘⇧C` |
| Go to anything… | `Ctrl+Shift+P`, `Ctrl+F12` | `⌘⇧P`, `⌘⌃G` |
| Call action… | `F10` | `F10` |
| Toggle mark and move down | `Space`, `Insert` | `Space`, `⌃0` |
| Mark and move down | `Shift+ArrowDown` | `⇧ArrowDown` |
| Mark and move up | `Shift+ArrowUp` | `⇧ArrowUp` |
| Mark to the first entry | `Shift+Home` | `⇧Home` |
| Mark to the last entry | `Shift+End` | `⇧End` |
| Mark all | `Ctrl+A`, `Ctrl+NumpadAdd` | `⌘A`, `⌘NumpadAdd` |
| Unmark all | `Ctrl+Shift+A`, `Ctrl+NumpadSubtract` | `⌘⇧A`, `⌘NumpadSubtract` |
| Invert marks | `NumpadMultiply` | `NumpadMultiply` |
| Mark by pattern… | `NumpadAdd` | `NumpadAdd` |
| Unmark by pattern… | `NumpadSubtract` | `NumpadSubtract` |
| Switch panel | `Tab` | `Tab` |
| Left panel | `Alt+1` | `⌥1` |
| Right panel | `Alt+2` | `⌥2` |
| Next tab | `Ctrl+Tab` | `⌃Tab` |
| Previous tab | `Ctrl+Shift+Tab` | `⌃⇧Tab` |
| Clone tab | `Ctrl+T` | `⌘⌥T` |
| Close tab | `Ctrl+W` | `⌘⌥W` |
| Toggle favourite | `Ctrl+D` | `⌘D` |
| Find… | `Alt+F7`, `Ctrl+F` | `⌥F7`, `⌘F` |
| Search again | `Ctrl+Shift+F7` | `⌘⇧F7` |
| View | `F3` | `F3` |
| Quick view in the other panel | `Ctrl+Q` | `⌃Q` |
| Edit (default app until 011) | `F4` | `F4` |
| Create file… | `Shift+F4` | `⇧F4` |
| Copy… | `F5` | `F5` |
| Move… | `F6` | `F6` |
| Rename… | `Shift+F6` | `⇧F6` |
| Create folder… | `F7`, `Shift+F7` | `F7`, `⇧F7` |
| Delete… | `F8`, `Delete` | `F8`, `⌘Backspace` |
| Multi rename… | `Ctrl+F6`, `Ctrl+Alt+M`, `Ctrl+M` | `⌘F6` |
| Create several folders… | `Ctrl+F7` | `⌘F7` |
| Group files… | `Alt+G`, `Ctrl+Alt+G` | `⌥G`, `⌘⌥G` |
| Clean folders (delete empty folders)… | `Ctrl+Alt+R`, `Ctrl+Alt+Shift+D` | `⌘⌥R`, `⌘⌥⇧D` |
| Properties… | `Alt+Enter` | `⌥Enter`, `⌘I` |
| Keyboard shortcuts… | `Ctrl+Shift+K` | `⌘⇧K` |
| Open with tool… | `Ctrl+Shift+X` | `⌘⇧X` |
| Tasks… | `Ctrl+F11` | `⌃K F6` |
| Next colour scheme | `Ctrl+Alt+Shift+T` | `⌘⌃⌥T` |

Maus: Doppelklick öffnet, `Strg/⌘+Klick` schaltet die Markierung um, `Shift+Klick` markiert einen Bereich,
Doppelklick auf einen Spaltenkopf sortiert. Tab-Leiste: `←` `→` `Pos1` `Ende`, `Entf`, `Shift+F10`; Splitter: Ziehen,
`←` `→` `Pos1` `Ende`, Doppelklick/`Enter` = 50 / 50. Mit gedrückter Shift-/Alt-/⌘- bzw. Strg-Taste zeigt die
Button-Leiste den passenden Satz (Total-Commander-Prinzip).

## Voraussetzungen

| Werkzeug | Version                                                                                   |
| -------- | ----------------------------------------------------------------------------------------- |
| Node.js  | `^22.22.3`, `^24.15.0` oder `>=26` (Vorgabe von Angular 22)                              |
| pnpm     | 10.x (siehe `packageManager` in `package.json`; z. B. `corepack enable`)                  |
| Rust     | stable ≥ 1.90 (`rustup`)                                                                  |
| System   | [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/) je Betriebssystem      |

- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** Microsoft C++ Build Tools und WebView2 (bei Windows 10/11 meist vorhanden).
- **Linux (Debian/Ubuntu):**
  `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## Installation und Start

```bash
pnpm install
pnpm tauri dev        # startet Angular-Dev-Server (Port 1420) + Desktop-App
```

`pnpm start` allein startet nur das Frontend im Browser; dort gibt es kein Backend, und die App
zeigt den Hinweis „The desktop backend is not available“.

## Checks

```bash
pnpm format:check     # Prettier
pnpm lint             # ESLint (angular-eslint)
pnpm test             # Angular-Unit-Tests (Vitest, jsdom)
pnpm build            # Production-Build des Frontends
pnpm rust:fmt         # cargo fmt --check
pnpm rust:lint        # cargo clippy -D warnings
pnpm rust:test        # cargo test
pnpm check            # alles oben nacheinander
```

Release-Build: `pnpm tauri build` (Bundles in `src-tauri/target/release/bundle/`). Signierung und
Notarisierung sind noch nicht eingerichtet.

## Projektstruktur

```
src/                       Angular-Frontend
  app/core/fs/             DTO-Typen, Fehler-Mapping, FsApi (einziger Ort mit invoke())
  app/features/browser/    FileBrowserStore (Signals), FileBrowser
    file-list/             FileList (GuiExpert Table), Controller, Bridge, Spalten, Renderer
  app/shared/              Formatierung (Größe, Datum)
  styles.scss              Design-Tokens (CSS Custom Properties)
src-tauri/                 Rust-Backend (Tauri 2)
  src/commands.rs          Tauri-Commands (dünne Schicht)
  src/listing.rs           Verzeichnis-Listing (rein std, getestet)
  src/paths.rs             Pfadvalidierung, Eltern-/Breadcrumb-Logik
  src/model.rs, error.rs   DTOs und strukturierte Fehler
docs/                      Architektur, Roadmap, Feature-Parität, Analyse des alten Codes
prompts/                   Feature-Prompts für die nächsten Ausbaustufen (Index: prompts/README.md)
CLAUDE.md                  Leitfaden für die Arbeit am Repo (Regeln, Befehle, GuiExpert Table)
```

## Referenzen und Lizenzen

Fachliche Referenzen (nur Funktionsumfang, kein übernommener Code):

- npm [`files-and-folders`](https://www.npmjs.com/package/files-and-folders) – MIT (laut package.json)
- [krocon/node-files-and-folders](https://github.com/krocon/node-files-and-folders) – MIT (laut package.json)
- [krocon/files-and-folders](https://github.com/krocon/files-and-folders) – „ISC“ in package.json, keine LICENSE-Datei
- [krocon/files-and-folders-mr](https://github.com/krocon/files-and-folders-mr) – Custom Source-Available License (CSAL) v1.0 (Rechteinhaber: GUI Expert GmbH); Nutzung als Referenz, Code-Übernahme nur nach Marcs ausdrücklicher Freigabe
- [GuiExpert Table](https://github.com/guiexperttable/mono) – MIT (aktuelle Releases)

Die Lizenz dieses Projekts ist noch nicht festgelegt (`license` in `Cargo.toml`/`package.json` leer).
