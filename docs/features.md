# Files and Folders – Funktionen im Detail

> Ausführliche Referenz (deutsch) zu allen Funktionen, Tastenkürzeln und zur Entwicklung. Überblick: [README](../README.md).

Plattformübergreifender Dateimanager für macOS, Windows und Linux in Richtung Total Commander –
gebaut mit **Tauri 2**, **Angular 22** (Signals, zoneless), **TypeScript**, **CSS** und einem
**Rust**-Backend.

> **Status:** in Entwicklung, noch kein Release. Fortschritt: [roadmap.md](roadmap.md), [prompts/README.md](../prompts/README.md),
> Abgleich mit der Vorgängerversion: [feature-parity.md](feature-parity.md).

## Was funktioniert

- **Fensteraufbau** nach [docs/ui-layout.md](ui-layout.md): links und rechts je Pfad-Header (Breadcrumb,
  klickbar, bei langen Pfaden rechtsbündig; Favoriten-Stern), Tab-Leiste, Dateiliste und Statuszeile
  (`markiert / gesamt in Dateien / Ordner`); ein Splitter für alle Zeilen; darunter die Button-Leiste (noch
  fehlende Funktionen gedimmt, „kommt in Prompt …“).
- **Aktive Seite** = Quelle, andere = Ziel; Klick in eine Seite oder `Tab` wechselt, Ansage für Screenreader.
- **Panel-Aktionen** (Prompt 040, wie Total Commander): *Seiten tauschen* (`Strg+U` / `⌘U`; der gewählte Tab wandert
  mit Verlauf, Cursor und Filter), *mit allen Tabs* (`Strg+Shift+U` / `⌘⇧U`), *Ziel = Quelle* (`Strg+Alt+O` / `⌘⌥O`)
  und *in der linken/rechten Seite öffnen* (`Strg+←/→` / `⌘⌥←/→`): Ordner, „..“ oder Archiv unter dem Cursor öffnet
  sich dort, bei einer Datei der aktuelle Ordner; der Fokus bleibt auf der aktiven Seite.
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
- **Archive** (Prompt 016): Enter auf `.zip`, `.tar`, `.tar.gz`/`.tgz` öffnet das Archiv wie einen Ordner (nur
  lesend, Hinweis im Header, Einträge mit unsicheren Namen ausgeblendet und gezählt). `F5` im Archiv entpackt die
  Markierung, `Alt+F9` entpackt markierte Archive (optional in einen Unterordner ihres Namens), `Alt+F5` packt die
  Markierung als ZIP, TAR oder TAR.GZ. Zip-Slip (`../`, absolute Pfade, Laufwerke), Links im Archiv und Zip-Bomben
  werden abgewiesen; vorhandene Dateien lösen die Konfliktfrage aus.
- **Duplikate** (`Alt+Shift+F7`): gleicher Inhalt (Größe → SHA-256 von Anfang/Ende → voller SHA-256) oder nur gleiche
  Größe, optional gleicher Name; Ergebnis-Tab mit Spalte „Group“, „Keep: newest / oldest / first“ markiert alle bis auf
  eine Datei je Gruppe, `F8` löscht in den Papierkorb (Warnung, wenn von einer Gruppe nichts übrig bliebe).
- **Speicherbelegung** (Prompt 033, `Strg+Umschalt+D` / `⌘⇧D`; „Speicherbelegung des Laufwerks…“ aus Palette und
  Menü): scannt die markierten Ordner, sonst den Ordner unter dem Cursor bzw. das ganze Laufwerk, als Job im
  Hintergrund (Ergebnis wächst sichtbar, Stopp behält den Teil). Tab „Belegung“ mit der normalen Liste – nach Größe,
  Spalten *Anteil* (Balken) und *Objekte* –, daneben in der anderen Seite Ringe oder Kacheln und der Sammelkorb.
  Enter/Klick geht in einen Ordner, Backspace/Mitte/Brotkrume hinaus, *Größte Dateien* zeigt die größten Dateien
  des Teilbaums. Markierungen gelten über alle Ebenen; `F8` bzw. *Entfernen…* löscht sie (Papierkorb, Gefahrenprüfung
  wie immer, was sich seit dem Scan geändert hat, bleibt liegen), danach stimmen die Summen ohne neuen Scan. Belegte
  Größe (Blöcke) als Standard, Hardlinks einmal, Links nie verfolgt, andere Laufwerke nur gezeigt.
- **Server-Verbindungen** (Prompt 034, `Strg+K`/`Strg+N` / `⌘K`/`⌘N`, Menü „Gehe zu“, Ordnermenü ▾ Abschnitt
  „Server“, `sftp://…`/`ftp://…` im Pfadfeld): FTP, FTPS (explizit/implizit) und SFTP als Ordner im Panel – Tabs,
  Verlauf, Favoriten, Cache wie bei Netzlaufwerken. Dialog „Mit Server verbinden“ mit Profilliste und Formular
  (Art, Server, Port, Benutzer, anonym, Schlüsseldatei/SSH-Agent, Startordner, Zeitlimit, Verbindungen, Keepalive),
  *Testen*, *Als Favorit*. Passwörter/Passphrasen werden beim Verbinden abgefragt und **nur im Schlüsselbund des
  Systems** gespeichert (ohne Schlüsselbund nur für die Sitzung); `connections.json` enthält nie ein Geheimnis.
  Unbekannte SSH-Host-Keys und nicht vertraute FTPS-Zertifikate zeigen den Fingerabdruck zur Bestätigung; ein
  geänderter Host-Key wird abgelehnt; Klartext-FTP ist rot markiert. `F5`/`F6` in beide Richtungen und zwischen
  Servern (als Job, `.part`-Datei, Konflikte), `F7`, `F2`, `F8` (endgültig – Server haben keinen Papierkorb), `F3`
  und Enter über eine Kopie im App-Cache, Ordnergröße. Nach einem Neustart verbindet nichts von selbst: Server-Tabs
  zeigen „Verbinden“. Gesperrt auf Servern: Attribute, Shell, Terminal/Finder, Packen/Entpacken, Suche,
  Speicherbelegung, Multi-Rename, Ziehen ins System.
- **Wird entfernt**: Solange ein Lösch-, Verschiebe- oder Aufräum-Job läuft, sind seine Einträge in der Liste
  durchgestrichen, kursiv, gedämpft und schraffiert; in der Spalte *Größe* dreht ein kleiner Kreisel mit dem
  Fortschritt des Jobs (`…` solange er plant bzw. beim Papierkorb für einen einzelnen Eintrag). Im Diagramm der
  Speicherbelegung pulsieren die betroffenen Segmente samt Inhalt, im Sammelkorb sind sie durchgestrichen.
- Fehler einzelner Dateien werden gesammelt und in der Task-Liste gelistet; Beenden mit laufenden Jobs fragt nach.
- Meldungen unten rechts verschwinden nach 60 Sekunden von selbst (oder vorher mit *Dismiss*).
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
- **Shell-Zeile** (Prompt 021, `Shift+F11`): Befehlszeile über der Button-Leiste im Ordner des aktiven Panels (im
  Ergebnis-Tab im Suchordner, im Archiv gesperrt). Ausgabe gestreamt (stderr farbig, Exit-Code), Esc bzw. `Ctrl+C`
  bricht samt Kindprozessen ab; `cd`, `cd ..`, `cd ~`, `cd -` navigieren das Panel, `clear`/`cls` leert. ↑/↓ blättern im
  Verlauf (100 Befehle, `shell-history.json`), Vorschläge aus dem Verlauf, `Strg/⌘+Shift+Enter` bzw.
  `Strg/⌘+Alt+Enter` fügen markierte Namen/Pfade quotiert ein. Pipes statt Terminal: interaktive Programme (vim, ssh,
  top) über **Terminal hier**. macOS/Linux lesen einmal den `PATH` der Login-Shell (Homebrew, cargo; zsh liest dabei `.zprofile`, nicht `.zshrc`), Windows
  wahlweise `cmd.exe` oder PowerShell; abschaltbar unter Einstellungen › Shell.
- **Ansicht** (`F3`): Text mit Zeilennummern, Suche (`Strg/⌘+F`, Enter/`F3` = nächster Treffer), Umbruch, Kodierung
  (Auto, UTF-8, UTF-16 LE/BE, Windows-1252, Latin-1), Hex-Ansicht für Binärdateien, Bilder mit Einpassen/Zoom;
  `←`/`→` blättert durch die Dateien des Panels (der Cursor folgt), `Esc` schließt. Der Typ wird am **Inhalt** erkannt
  (`bild.txt`, das ein PNG ist, wird als Bild gezeigt, mit Hinweis); große Dateien zeigen nur den Anfang (1 MiB Text,
  4 KiB Hex) – auch eine 2-GB-Datei öffnet sofort.
- **Schnellvorschau** (`Strg+Q`, macOS `⌃Q`): das andere Panel zeigt die Datei unter dem Cursor.
- **Eigenschaften** (`Alt+Enter`, macOS auch `⌘I`): Typ, Größe (Ordner per Knopf als Job), Zeiten, Rechte `rwxr-xr-x`
  und Eigentümer bzw. Windows-Attribute, Link-Ziel; Knopf **Ändern…**. **Attribute ändern** (024, `Strg+Umschalt+F2`,
  macOS `⌘⇧F2`): Rechte rwx für Eigentümer/Gruppe/Andere, Set-ID/Sticky (mit Warnung), oktal; Windows
  Schreibgeschützt/Versteckt/System/Archiv, macOS „versteckt“; Änderungs-/Zugriffszeit (Erstellzeit unter
  Windows/macOS) auf ein Datum oder „jetzt“ – für viele Einträge mit Dreifach-Zustand (nur Angefasstes ändert sich),
  auf Wunsch samt Ordnerinhalt (nur Dateien / nur Ordner / beides). Links werden nie verfolgt. Läuft als Job.
  **Bearbeiten** (`F4`) startet das Tool `edit` (Default: Standard-App, s. Externe Tools).
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
- **Farbschemata** (Prompt 013, 019): die acht Designs der alten Version (**Light** – Standard beim ersten Start –,
  Paper, Bitbucket, Cypress, Blackboard, Coffee, Combat, Norton) plus „Modern light/dark“; „Follow the system“ (folgt
  `prefers-color-scheme` live, Paar Light/Coffee) oder ein festes Schema – über 🎨 in der Button-Leiste, die Befehlspalette
  („Colour scheme: …“) oder `Strg+Alt+Shift+T` / `⌘⌃⌥T` (nächstes Schema). Der Dialog **Colour schemes…** ist ein
  Live-Editor: jede Farbe (Liste, Cursor aktiv/inaktiv, markiert, versteckt, Symlink, Kopf, Tabs, Statuszeile,
  Buttons, Dialoge, Scrollbar, Tooltip) mit Farbwähler und Textfeld, Vorschau sofort, Kontrastprüfung (WCAG AA) mit
  Liste der verletzten Paare; „Save as new“/„Save“/„Delete“/„Reset“. **Import** liest die Datei unter dem Cursor
  (auch alte `{name, colors}`-Dateien – ergibt dasselbe Design wie das mitgelieferte), **Export** schreibt
  `<Name>.theme.json` in den Ordner des aktiven Panels, **Export (old format)** im alten `--fnf-*`-Format. Alle
  Designs bestehen WCAG AA; wo die alten Farben das nicht schafften, sind sie minimal angepasst
  ([Kontrastbericht](legacy-themes-contrast.md)).
  Gespeichert in `themes.json` im App-Config-Verzeichnis.
- **Einstellungen** (`Strg+,` / `⌘,`, Prompt 015): Dialog mit Suche über alle Bereiche; jede Änderung wirkt sofort
  (oder sagt „wirkt beim nächsten Start“). Ansicht (Größen binär/dezimal/Bytes, Datum in Sprache oder ISO,
  Zeilenhöhe, `[Ordner]`, Namen ohne Endung, Menüleiste), Verhalten (Papierkorb, Bestätigung, Doppelklick,
  Leertaste, Start-Ordner), Tastatur (Konflikte, Kürzel bearbeiten/zurücksetzen), Tools, Farben, Daten (alles als
  eine Datei exportieren/importieren). Gespeichert in `settings.json`; kaputte Datei → Defaults + Warnung (`.bad`).
- **Actions-Menü ▴** in der Button-Leiste (Prompt 020): vier Spalten wie in der alten Version (Navigation/Ansicht,
  Auswahl/Seiten/Tabs, Dateioperationen, Konfiguration + Tools) mit Trennlinien, kurzen Namen und Kürzeln als dunkle
  Badges (`^` `⌘` `alt` `⇧`, Akkorde als zwei Badges); Pfeiltasten, `Pos1`/`Ende`, `Enter`, `Esc`.
- **Deutsch und Englisch**: Oberfläche, Menüs, Fehlertexte, Datums- und Zahlenformat; Umschalten ohne Neustart
  (Vorgabe: Systemsprache).

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
| Go to path… | `Ctrl+L`, `Ctrl+Alt+D` | `⌘L`, `⌃⌥D` |
| Find folder (change dir)… | `Alt+F10` | `⌥F10` |
| Go to file (search result) | `Ctrl+Shift+G` | `⌘⇧G` |
| Folder menu, left panel | `Alt+F1` | `⌥F1` |
| Folder menu, right panel | `Alt+F2` | `⌥F2` |
| Calculate folder sizes | `Alt+Shift+Enter` | `⌥⇧Enter` |
| Context menu | `Shift+F10`, Kontextmenü-Taste | `⇧F10` |
| Menu bar | `Alt+M` | – (nativ) |
| Einstellungen… | `Ctrl+,` | `⌘,` |
| Toggle filter | `Ctrl+Alt+F` | `⌘⌥F` |
| Toggle hidden files | `Ctrl+H` | `⌘⇧.` |
| Toggle shell | `Shift+F11` | `⇧F11` |
| Namen in die Shell einfügen | `Ctrl+Shift+Enter` | `⌘⇧Enter` |
| Volle Pfade in die Shell einfügen | `Ctrl+Alt+Enter` | `⌘⌥Enter` |
| Copy names to clipboard | `Ctrl+Alt+N` | `⌘⌥N` |
| Copy full paths to clipboard | `Ctrl+Alt+C` | `⌘⌥C` |
| Show in file manager | `Ctrl+Shift+F` | `⌘⇧F` |
| Open terminal here | `Ctrl+Shift+C` | `⌘⇧C` |
| Command Palette… | `Ctrl+Shift+P` | `⌘⇧P`, `⌘⌃G` |
| Actions menu ▴ | `Ctrl+F12` | `⌃K ⌃M` |
| Toggle mark and move up / in place | `Shift+Space` / `Ctrl+Shift+Space` | `⇧Space` / `⌘⇧Space` |
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
| Swap panels / with all tabs (040) | `Ctrl+U` / `Ctrl+Shift+U` | `⌘U` / `⌘⇧U` |
| Target = source (040) | `Ctrl+Alt+O` | `⌘⌥O` |
| Open in the left / right panel (040) | `Ctrl+←` / `Ctrl+→` | `⌘⌥←` / `⌘⌥→` |
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
| Change attributes… | `Ctrl+Shift+F2` | `⌘⇧F2` |
| Pack… | `Alt+F5` | `⌥F5` |
| Unpack… | `Alt+F9` | `⌥F9` |
| Find duplicates… | `Alt+Shift+F7` | `⌥⇧F7` |
| Disk usage… | `Ctrl+Shift+D` | `⌘⇧D` |
| Keyboard shortcuts… | `Ctrl+Shift+K` | `⌘⇧K` |
| Open with tool… | `Ctrl+Shift+X` | `⌘⇧X` |
| Tasks… | `Ctrl+F11` | `⌃K F6` |
| Next colour scheme | `Ctrl+Alt+Shift+T` | `⌘⌃⌥T` |

Maus: Doppelklick öffnet, `Strg/⌘+Klick` schaltet die Markierung um, `Shift+Klick` markiert einen Bereich,
Doppelklick auf einen Spaltenkopf sortiert. Tab-Leiste: `←` `→` `Pos1` `Ende`, `Entf`, `Shift+F10`; Splitter: Ziehen,
`←` `→` `Pos1` `Ende`, Doppelklick/`Enter` = 50 / 50. Mit gedrückter Shift-/Alt-/⌘- bzw. Strg-Taste zeigt die
Button-Leiste den passenden Satz (Total-Commander-Prinzip).

## Installation für Nutzer

Noch gibt es **kein veröffentlichtes Release**. Pakete entstehen über den Release-Workflow (Vorlage
[`docs/ci/release.yml`](ci/release.yml), Ablauf: [docs/release.md](release.md)) als Entwurf eines
GitHub-Releases:

| OS | Paket | Installation |
| --- | --- | --- |
| macOS 12+ (Apple Silicon und Intel) | `Files and Folders_<v>_universal.dmg` | DMG öffnen, App nach „Programme“ ziehen |
| Windows 10/11 | `Files and Folders_<v>_x64-setup.exe` (ohne Admin) oder `.msi` | Installer starten; WebView2 wird bei Bedarf nachgeladen |
| Linux (x86_64) | `.deb` (Debian/Ubuntu), `.rpm` (Fedora/openSUSE), `.AppImage` | `sudo apt install ./files-and-folders_<v>_amd64.deb` bzw. `sudo dnf install ./….rpm`; AppImage: `chmod +x` und starten |

**Bekannte Einschränkungen je Plattform**

- **Unsignierte Pakete** (solange keine Zertifikate eingerichtet sind): macOS meldet „nicht verifizierter
  Entwickler“ → im Finder Rechtsklick → *Öffnen* (bzw. Systemeinstellungen → Datenschutz & Sicherheit → *Trotzdem
  öffnen*); Windows SmartScreen → *Weitere Informationen* → *Trotzdem ausführen*.
- **macOS:** Zugriff auf Schreibtisch, Dokumente, Downloads, externe/Netz-Volumes fragt das System beim ersten
  Mal ab. Papierkorb über den Finder (einmalige Erlaubnis „Finder steuern“). Praktisch erst wenig getestet.
- **Windows:** Auf Laufwerken ohne Papierkorb (Netz, manche USB-Sticks) kann Windows beim „Löschen in den
  Papierkorb“ endgültig löschen (eigene Prüfung noch offen, Design 006 E1). Praktisch erst wenig getestet (die CI
  kompiliert und testet, s. `docs/ci/`).
- **Linux:** braucht WebKitGTK 4.1 (Ubuntu 22.04+, Debian 12+, Fedora 36+). AppImage benötigt FUSE
  (`libfuse2`) oder `--appimage-extract-and-run`.
- Keine automatischen Updates (Updater bewertet, nicht aktiviert).

Die Version steht im Dialog **About** (Menü Hilfe bzw. macOS „Über Files and Folders“, oder Befehlspalette).

## Voraussetzungen (Entwicklung)

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
pnpm version:check    # Version gleich in package.json, tauri.conf.json, Cargo.toml/.lock
pnpm scripts:test     # Tests der Skripte (Version, Release Notes, Lizenzbericht)
pnpm check            # alles oben nacheinander
```

Release-Build: `pnpm tauri build` (Bundles in `src-tauri/target/release/bundle/`; Linux: deb, rpm, AppImage).
Version setzen: `pnpm version:set X.Y.Z`; Release Notes: `pnpm release:notes`; Lizenzbericht:
`pnpm licenses:report > docs/licenses.md`. Signierung und Notarisierung sind vorbereitet, nicht eingerichtet –
[docs/release.md](release.md), CI-Vorlagen: [docs/ci/](ci/README.md). App-Icon: Quelle
`src-tauri/icons/source/app-icon.svg` → `pnpm tauri icon src-tauri/icons/source/app-icon.svg` (danach die
Ordner `android/`, `ios/` und `64x64.png` löschen).

## Projektstruktur

```
src/                       Angular-Frontend
  app/core/fs/             DTO-Typen, Fehler-Mapping, FsApi (einziger Ort mit invoke())
  app/features/browser/    FileBrowserStore (Signals), FileBrowser
    file-list/             FileList (GuiExpert Table), Controller, Bridge, Spalten, Renderer
  app/shared/              Formatierung (Größe, Datum)
  styles.css               Design-Tokens (CSS Custom Properties)
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

Dieses Projekt steht unter der [MIT-Lizenz](../LICENSE). Lizenzen der Abhängigkeiten: [licenses.md](licenses.md).
