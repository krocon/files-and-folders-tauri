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
- Fehler einzelner Dateien werden gesammelt und in der Task-Liste gelistet; Beenden mit laufenden Jobs fragt nach.
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
- Helles/dunkles Farbschema über CSS Custom Properties (`prefers-color-scheme`).

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
| Go to path… | `Ctrl+L`, `Alt+F10` | `⌘L`, `⌘⌃D` |
| Folder menu, left panel | `Alt+F1` | `⌥F1` |
| Folder menu, right panel | `Alt+F2` | `⌥F2` |
| Calculate folder sizes | `Alt+Shift+Enter` | `⌥⇧Enter` |
| Toggle filter | `Ctrl+Alt+F` | `⌘⌥F` |
| Toggle hidden files | `Ctrl+H` | `⌘⇧.` |
| Toggle shell | `Shift+F11` | `⇧F11` |
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
| View | `F3` | `F3` |
| Edit | `F4` | `F4` |
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
| Keyboard shortcuts… | `Ctrl+Shift+K` | `⌘⇧K` |
| Tasks… | `Ctrl+F11` | `⌃K F6` |

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
