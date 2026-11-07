# 072 Doppelklick-Aktionen – Design

Auftrag (Marc, 06.11.2026): Dialog, mit dem ein Doppelklick auf eine passende Datei eine Aktion auslöst, z. B.
`*.js` → `node %name`. Felder: Auslöser (Doppelklick), Dateimuster, Abfrage nötig (ja/nein), Kommando.

## Entscheidungen

- **E1 Keine Shell.** Das Kommando wird in Wörter zerlegt (`tools::split_words`), das erste ist das Programm, jedes
  weitere ein Argument. Pipes, `&&` oder `>` wirken also nicht. Die Regel der Shell-Leiste (Design 021 E1: Befehle nur
  aus dem Shell-Feld) bleibt unberührt; es gelten die Tool-Regeln (011).
- **E2 Das Programm ist nie die angeklickte Datei.** Platzhalter als erstes Wort werden abgelehnt (`program`).
- **E3 Platzhalter wie im Startermenü** (`%N`, `%P%N`, `%O`, `%E`, `%T`, `%%`, `{name}` …), zusätzlich `%name` = `%N`.
  `%P` und der Arbeitsordner meinen den **Ordner der Datei**, nicht den des Panels (flache Ansicht, Ergebnis-Tabs).
- **E4 Muster im Frontend, Regeln in Rust.** Der Doppelklick-Hook der Liste ist synchron, deshalb prüft
  `file-actions-logic.ts` das Muster (`*`, `?`, getrennt durch `;` oder Leerzeichen, ohne Groß-/Kleinschreibung). Rust
  prüft die Regel beim Speichern und beim Start und nimmt nur eine Id entgegen.
- **E5 Erste passende Regel von oben gewinnt**, die Reihenfolge ist im Dialog änderbar. Eine Regel geht vor der
  Einstellung `behavior.doubleClick`. Enter bleibt wie bisher „Öffnen“: Auftrag war nur der Doppelklick.
- **E6 Umgebung wie die Shell-Leiste** (`commands::shell::tool_env`, `shell.loginPath`): Eine aus dem Finder gestartete
  App erbt keinen Login-`PATH` und fände `node` sonst nicht.
- **E7 Nicht angewendet** auf Ordner, `..`, nicht adressierbare Namen, in Archiven, auf Servern und in der
  Dubletten-Ansicht – dort öffnet der Doppelklick wie gewohnt. Regeln mit Problem laufen nicht.
- **E8 Abfrage** nutzt `ConfirmService` wie „Programm ausführen“: Enter/Esc = Abbrechen, gestartet wird nur über den
  roten Button (Klick oder `Mod+Shift+<Buchstabe>`). Sie ist bei neuen Regeln und bei Dateien ohne das Feld an. Im Einstellungsbündel ist der Teil `fileActions`
  beim Import abgewählt, weil er Programme startet (wie `tools`, `starter`).

## Grenzen

- Das Programm läuft losgelöst (`spawn_detached`): Ausgabe und Exit-Code sind nicht sichtbar. Nur ein Fehlstart
  (Programm nicht gefunden) wird gemeldet.
- Der Auslöser ist vorerst nur Doppelklick; das Feld `trigger` hält die Datei für weitere offen.

## Nachtrag: Terminalfenster und Hilfe (Marc, 2026-11-07)

- **E9 Terminalfenster je Regel** (`terminal`, Default aus): Total Commanders Dialog hat dafür keine Option, dort steht
  `cmd /k` im Kommando; das ist je OS anders und bräuchte eine Shell-Zeile, deshalb hier eine Checkbox. Terminals nehmen
  kein einheitliches Argument-Array an (Terminal.app gar keins), also schreibt `platform/terminal_run.rs` ein Skript mit
  einmaligem Namen in den Temp-Ordner (`create_new`, Unix 0700), das sich beim Start selbst löscht: jedes Wort quotiert
  (POSIX `'…'` auf Bytes; Batch mit `%%`, `"`/Steuerzeichen abgelehnt), danach bleibt die Shell des Nutzers offen (`cmd /K`).
  Das Fenster zeigt vorher die Kommandozeile (`$ node 'a b.js'`) und danach `[exit code N]`; vom Login-Environment wird
  nur `PATH` gesetzt (das Terminal bringt Sprache/Locale des Nutzers selbst mit, Marc 2026-11-07). Die Regel „nichts aus Dateinamen wird Shell-Syntax“ bleibt so erhalten; Test mit feindlichem Namen. macOS: `open -a
  Terminal`, Linux: `$TERMINAL`, dann die Liste von 011, Windows: `cmd.exe` in neuer Konsole. Ein eigenes `terminal` aus
  `tools.json` gilt hier nicht (dort fehlt ein Platzhalter für den Befehl). Windows und Linux sind nur per Unit-Test geprüft.
- **E9 gilt auch im Startermenü** (`StarterItem.terminal`, nur `program`, in `starter.json` nur wenn an): gleicher Start,
  ebenfalls mit Login-`PATH`; ohne die Option startet ein Eintrag unverändert ohne diese Umgebung.
- **E10 Hilfe**: eigener Dialog `file-actions-help.ts` über dem Regel-Dialog (Geschwister-`app-modal`, Esc schließt nur die
  Hilfe). Platzhalter und Beispiele sind sprachneutral im Code, die Erklärungen im Katalog.
