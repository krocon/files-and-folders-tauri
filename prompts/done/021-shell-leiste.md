# Prompt 021: Shell-Leiste (`TOGGLE_SHELL`)

> **Slug:** `shell-leiste` · **Braucht:** 004, 005, 011, 012 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`.
> Altes Verhalten: `docs/legacy-analysis-mr.md` §1.7 (Shell-Panel, Zeile 5), §9 (`POST /api/shell`), §11 Punkt 12
> (offenes TODO ↑/↓/Esc); `docs/ui-layout.md` „Zeile 5 – Shell-Zeile“; Entscheidung `prompts/done/011-os-integration-tools.design.md`
> E7; Matrix `docs/feature-parity.md` Abschnitt H. Quellcode: `old_project/apps/fnf/src/app/feature/main/footer/shellpanel/`
> (Frontend) und `old_project/apps/fnf-api/src/app/shell/` (Backend, `shell-spawn-manager.ts`).

## Ziel

`TOGGLE_SHELL` (`Shift+F11`) blendet über der Button-Leiste die **Shell-Zeile** ein (Zeile 5 in `docs/ui-layout.md`):
`<Pfad>>` + Eingabefeld, der Befehl läuft im Ordner des aktiven Panels, die Ausgabe erscheint in einem Bereich
darunter. Das ist die Kommandozeile des Total Commander bzw. das Shell-Panel aus mr – **kein** eingebettetes
Vollterminal und **keine** Server-Shell (bleibt ✖, mr §11 Drop).

Damit hat die Aktion endlich einen Handler. Bisher ist `TOGGLE_SHELL` im Katalog, in den Keymaps und im Actions-Menü
vorhanden, aber ohne Handler, also immer gedimmt.

## Altes Verhalten und Lehren

- **mr-Shell-Panel:** `mat-form-field` mit Präfix `{{path}}>`, Platzhalter „Enter shell command“, rotes `!` bei
  Fehler. Autocomplete (500 ms entprellt) aus Verlauf + `GET /api/shell-autocomplete`. Enter → `POST /api/shell
  [{path, cmd, para:''}]` → `exec` im Node-Server. Ausgabe (stdout) in einem **Bottom-Sheet** mit Monaco (`vs-dark`).
  Verlauf `shell-history` (max. 20, localStorage), Sichtbarkeit `shellVisible` (localStorage, Default aus). Fokus im
  Feld schaltet die globalen Tasten ab.
- **Offen geblieben in mr:** ↑/↓ im Verlauf und Esc (TODO im Code).
- **Lehren:** `exec` mit zusammengesetztem String, `cmd.split(' ')` für Argumente, stdout erst am Ende (kein
  Streaming), kein Abbruch, `cd` per Sonderbehandlung im Server, die das Panel nicht mitnahm. Ausgabe über Monaco war
  für ein paar Zeilen Text überdimensioniert.
- **Server-Shell** (`/shell`, `spawn`/`cancelspawn`, node-pty): entfällt; „Terminal hier“ (011, `Mod+Shift+C`) deckt
  das interaktive Terminal ab.

## Sicherheitsmodell (zuerst im Design festhalten) 🛑

`CLAUDE.md` §4 verbietet „beliebige Shell-Kommandos aus dem Frontend“. Die Shell-Zeile ist **genau das**, nur eben
bewusst und vom Nutzer gewollt. Deshalb braucht sie eine dokumentierte, eng geschnittene Ausnahme statt einer
stillschweigenden Lücke:

1. **Nur ausdrückliche Eingabe:** Ein Befehl entsteht ausschließlich aus Tastatureingaben des Nutzers in der
   Shell-Zeile und wird nur durch Enter in diesem Feld abgeschickt. Nie aus Konfiguration, Dateinamen, Tools,
   Drag & Drop, Menüs, der Befehlspalette oder Nachrichten zusammengesetzt.
2. **Ein einziger Aufrufer:** Nur die Shell-Zeilen-Komponente ruft `ShellApi.run`. Ein Test (oder eine
   ESLint-Regel) stellt sicher, dass kein anderer Code die Fassade importiert.
3. **Rust validiert, was es kann:** Den Arbeitsordner prüft das Backend (existiert, ist ein echter Ordner, nicht in
   einem Archiv). Er wird per `Command::current_dir` gesetzt, nie in den Befehlsstring eingebaut. Der Befehl geht als
   **ein** Argument an die Shell des Nutzers (`$SHELL -c <cmd>`, Windows siehe unten). Kein `split(' ')`, keine
   eigene Quotierung.
4. **Nur das Hauptfenster:** Der Command ist nur dem Hauptfenster erlaubt (Capability, kein globales Plugin;
   kein `tauri-plugin-shell`).
5. **Abschaltbar:** Einstellung `shell.enabled` (015). Der Default ist im Design zu begründen. Vorschlag: an, weil
   die Zeile erst nach `Shift+F11` erscheint und nur Eingetipptes ausführt.
6. **Kein Logging** von Befehlen oder Ausgaben (Pfade/Inhalte, `CLAUDE.md` §4). Der Verlauf liegt nur lokal in einer
   Datei im App-Config-Verzeichnis.

Die Ausnahme kommt mit Begründung in `CLAUDE.md` §4 und `docs/architecture.md` (Sicherheit).

## Aufgaben

1. **Design** (`prompts/done/021-shell-leiste.design.md`). Zu entscheiden und zu begründen:
   - **Pipes vs. PTY:** `std::process::Command` mit Pipes (stdout/stderr getrennt, stdin geschlossen bzw.
     `/dev/null`, damit nichts auf Eingabe wartet) gegen `portable-pty` + Terminal-Darstellung (xterm.js). Vorschlag:
     Pipes für die Zeile (wie TC/mr), interaktive Programme (`vim`, `top`, `ssh`, Passwortabfragen) laufen über
     „Terminal hier“. Was passiert, wenn jemand trotzdem `vim` eintippt? (stdin zu → Programm endet bzw. Hinweis.)
   - **Ausführung als Job** (`CLAUDE.md` §4: lange Operationen sind Jobs): neue Job-Art `shell` mit Ausgabe über
     `tauri::ipc::Channel` (gestreamt, zeilen- oder blockweise), Exit-Code, Abbruch per Esc/`Ctrl+C`/Button. Der
     Abbruch beendet die **ganze Prozessgruppe** (Unix `setsid`/`killpg`, Windows Job Object), so wie die Tools aus 011
     ihre eigene Prozessgruppe haben. Läuft ein Befehl noch, wenn ein neuer kommt: ablehnen, anhängen oder den alten
     abbrechen? (Vorschlag: ablehnen mit Hinweis, einer zur Zeit.)
   - **Shell je OS:** macOS/Linux `$SHELL` (Fallback `/bin/sh`) mit `-c`. Login-Shell (`-l`) ja/nein? Windows: `cmd.exe /C`
     oder PowerShell (`pwsh`/`powershell -NoProfile -Command`), wählbar per Einstellung. Achtung: Bei `cmd.exe /C`
     gelten eigene Quotierungsregeln (`raw_arg`).
   - **`PATH` unter macOS:** Aus dem Finder gestartete Apps haben nur einen minimalen `PATH` (`/usr/bin:/bin:…`).
     `brew`-, `node`- oder `cargo`-Programme würden fehlen. Lösung festlegen: die Umgebung einmal aus der Login-Shell
     lesen (`$SHELL -lc env` beim ersten Gebrauch, mit Timeout) oder `-l` bei jedem Aufruf. Kosten messen.
   - **`cd`:** `cd <ziel>` (auch `cd ..`, `cd ~`, `cd` ohne Argument, Windows `cd /d`) wird **nicht** an die Shell
     geschickt. Rust löst das Ziel relativ zum Arbeitsordner auf und prüft es. Das **aktive Panel navigiert** dorthin
     (wie im Total Commander). Ein Fehler erscheint in der Ausgabe. Weitere eingebaute Befehle (`cls`/`clear` leert
     die Ausgabe) entscheiden.
   - **Ausgabe-Bereich:** Monospace, unter der Eingabe, Höhe per Ziehen änderbar (gemerkt), ein- und ausklappbar. stderr
     farblich abgesetzt, Exit-Code ≠ 0 sichtbar. Obergrenze (z. B. 10 000 Zeilen oder 2 MB, ältere fallen raus).
     Text nur per `textContent` (wie der Viewer in 010, kein `innerHTML`). ANSI-Farben: entfernen oder die Grundfarben
     (SGR 30–37/90–97, fett) auf Theme-Tokens abbilden, als eigene reine Funktion mit Tests. Kodierung: UTF-8, auf
     Windows die OEM-Codepage bzw. `chcp 65001` bedenken, ungültige Bytes verlustbehaftet ersetzen. Kopieren der
     Ausgabe, „Leeren“.
   - **Arbeitsordner:** `ws.actionDir()`, also der angezeigte Ordner oder in einem Ergebnis-Tab der Suchordner. Im
     Archiv ist die Zeile gesperrt (Veto aus 016, virtuelle Pfade). Ohne Ordner (Home-Tab vor dem ersten Listing) ist
     sie deaktiviert. Der Präfix `<Pfad>>` folgt dem aktiven Panel live und wird bei langen Pfaden in der Mitte gekürzt
     (voller Pfad im Tooltip).
   - **Nach dem Befehl:** Das aktive Panel aktualisiert sich (der Watcher aus 012 deckt das meist ab; sonst gezielt
     `refresh` des Arbeitsordners, nicht beider Panels). Markierung und Cursor bleiben erhalten.
   - **Einfügen aus der Liste** (TC-Komfort): z. B. `Ctrl+Enter` fügt den Cursor-Namen ein, `Ctrl+Shift+Enter` den
     vollen Pfad, ein weiteres Kürzel die markierten Namen. Die **Quotierung je Shell macht Rust** (eigener schmaler
     Command `shell_quote(names, shell)`). Das Frontend splittet und joint keine Pfade (`CLAUDE.md` §4). Kürzel nur in
     den Keymap-JSONs, Konflikte mit bestehenden Bindungen prüfen.
   - **Verlauf:** ↑/↓ blättert (der aktuell getippte Text bleibt als „Entwurf“ erhalten), Esc leert das Feld bzw.
     bricht einen laufenden Befehl ab. Ein zweites Esc gibt den Fokus an die Liste zurück, `Shift+F11` blendet aus.
     100 Einträge, ohne Dubletten (der neueste gewinnt), im App-Config-Verzeichnis gespeichert (Rust, wie Sitzung und
     Vorlagen; kaputte Datei → `.bad` und leer weiter). Autovervollständigung aus dem Verlauf (Präfix), optional
     Dateinamen aus dem aktuellen Listing des Panels für das letzte Wort (ohne Pfadlogik im Frontend).
   - **Sichtbarkeit und Fokus:** Ob die Zeile eingeblendet ist, steht im Sitzungszustand (004). `Shift+F11` blendet ein
     und fokussiert. Ist die Zeile sichtbar, aber nicht fokussiert, entscheiden: fokussieren oder ausblenden? (Vorschlag:
     fokussieren; ausblenden, wenn schon fokussiert.) Der `KeyboardDispatcher` lässt in Textfeldern schon nur
     Funktionstasten durch. Prüfen, dass `Tab` (Panel wechseln), `Enter`, `Esc` und `↑/↓` im Feld bleiben und
     `F5`/`F8` nicht versehentlich auf die Liste wirken.
   - **Layout:** Zeile 5 über die volle Breite (über beiden Seiten, kein Splitter), Theme-Tokens aus 013/019
     (`--color-shell-*` neu, in allen acht alten Designs abbilden und im Kontrastbericht aufnehmen). Die Liste
     schrumpft, wenn die Zeile bzw. die Ausgabe erscheint, und die GuiExpert Table misst sich neu (Resize).
2. **Rust** (`src-tauri/src/shell.rs` bzw. `jobs/shell.rs`, `platform/` für OS-Teile): Job-Art `shell`, `cd`-Auflösung,
   Quotierung, Verlauf lesen/schreiben, Umgebung/`PATH`. DTOs in `model.rs` ↔ `*.models.ts`, neue Fehlercodes in
   `describeFsError()`. Tests mit `tempfile`:
   - Arbeitsordner wird respektiert. Ein Ordnername wie `x"; touch pwned; "` führt **nichts** aus (er wird nie Teil
     des Befehls).
   - stdout/stderr getrennt und gestreamt, Exit-Code, Ausgabe-Obergrenze.
   - Abbruch beendet auch Kindprozesse (`sh -c 'sleep 30 & sleep 30'`), kein Zombie.
   - stdin geschlossen: `cat` ohne Argument endet sofort.
   - `cd` relativ/absolut/`..`/`~`/nicht vorhanden/Datei statt Ordner.
   - Quotierung je Shell mit Leerzeichen, `'`, `"`, `$`, `` ` ``, `%`, `!`, `^`, führendem `-` und Unicode
     (Round-Trip: Quotieren → `sh -c 'printf %s "$1"'` liefert den Namen unverändert).
   - Verlauf: Dubletten, Grenze, kaputte Datei.
3. **Frontend** (`features/shell/`): `ShellApi` (Fassade, `FakeShellApi` für Tests), `ShellStore` (root: Sichtbarkeit,
   Verlauf, laufender Job, Ausgabe-Puffer), `ShellBar`-Komponente in `workspace.html` (Zeile 5), Aktion `TOGGLE_SHELL`
   per `ActionService.register` (enabled: Einstellung an und `ws.actionDir() !== null` und nicht im Archiv). Weitere
   Aktionen für Leeren und Abbrechen nach Bedarf (Katalog, Texte en/de, Keymaps). Texte nur aus Katalogen.
   Die Hinweise „kommt mit Prompt 021“ entfernen.
4. **Doku:** `docs/feature-parity.md` (Zeilen `TOGGLE_SHELL`, H „Shell-Leiste“, J11, mr 12b → ✅ mit Testbelegen),
   `docs/ui-layout.md` Zeile 5 (Verweis auf 021 statt 011), `docs/architecture.md` (Sicherheit, ggf. Abhängigkeiten),
   `CLAUDE.md` §4 (Ausnahme), `prompts/README.md` (Tabelle + Status).

## Akzeptanzkriterien

- [ ] `Shift+F11` und der Eintrag „Toggle Shell“ im Actions-Menü/in der Menüleiste sind aktiv und blenden die
  Shell-Zeile ein bzw. aus. Die Sichtbarkeit übersteht einen Neustart.
- [ ] `ls -la` (Windows `dir`) zeigt die Ausgabe des Ordners im aktiven Panel. Nach einem Panel- oder Tabwechsel
  stimmt der Präfix sofort.
- [ ] Ein langer Befehl (`sleep 30`, `ping -t`) streamt seine Ausgabe, lässt die UI bedienbar und ist per Esc
  abbrechbar, samt Kindprozessen.
- [ ] `cd ..` und `cd unterordner` navigieren das aktive Panel. Ein ungültiges Ziel meldet einen Fehler, ohne dass
  sich das Panel bewegt.
- [ ] `touch neu.txt` lässt `neu.txt` in der Liste erscheinen, ohne manuelles Reload.
- [ ] ↑/↓ blättern im Verlauf, Esc wie entworfen, der Verlauf übersteht einen Neustart.
- [ ] Ein Ordner- oder Dateiname mit Shell-Sonderzeichen wird nie ausgeführt (Rust-Test). Eingefügte Namen sind
  korrekt quotiert (Round-Trip-Test je Unix-Shell. Windows: Tests für die Quotierfunktion, Ausführung in der CI).
- [ ] Unter macOS aus dem Finder gestartet findet die Zeile Programme aus Homebrew (`which brew`) – Vorgehen
  dokumentiert, wenn hier nicht prüfbar.
- [ ] In einem Archiv-Ordner ist die Zeile gesperrt, in einem Ergebnis-Tab läuft sie im Suchordner.
- [ ] Nur `ShellBar` nutzt `ShellApi.run` (Test).
- [ ] Alle acht alten Designs und die neuen Themes haben lesbare Farben für die Zeile (Kontrastbericht aktualisiert).
- [ ] `pnpm check` und `pnpm test` grün, `cargo test` grün, `cargo clippy` ohne Warnungen.

## Review-Schwerpunkte

Die Ausnahme vom Shell-Verbot: Ist der einzige Weg zur Ausführung wirklich die Tastatur im Feld? Kann eine Datei,
ein Name, ein Theme oder eine Konfiguration einen Befehl auslösen oder vorbelegen? Prozessgruppen und Abbruch je OS.
Windows-Quotierung (`cmd.exe` ist berüchtigt), Umgebung/`PATH`, Kodierung der Ausgabe, Speicher bei endloser
Ausgabe (`yes`), Verhalten bei Programmen, die auf stdin warten. Fokus- und Tastenkonflikte mit der Dateiliste.

## Nicht in diesem Prompt

- Vollterminal mit PTY und xterm.js im Fenster (falls das Design Pipes wählt: als Notiz für später).
- Server-Shell (✖), mehrere parallele Shell-Sitzungen, Skripte/Makros aus der Konfiguration.
