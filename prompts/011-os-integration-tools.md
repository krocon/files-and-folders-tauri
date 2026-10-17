# Prompt 011: Betriebssystem-Integration, externe Tools und Zwischenablage

> **Slug:** `os-integration-tools` · **Braucht:** 002, 004 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §7 (Startpunkte, Tools mit
> `$file`/`$dir`/`fileLimit`), §6 (`open`, `shell`), §2 (Clipboard-Aktionen), §9 (Sicherheitslücken).

## Ziel

Die App fügt sich ins System ein: Laufwerke und Volumes als Startpunkte, „Im Finder/Explorer zeigen“, „Terminal
hier“, konfigurierbare externe Tools mit Platzhaltern, Namen und Pfade in die Zwischenablage – **sicher**: keine
zusammengesetzten Shell-Strings, keine beliebigen Kommandos aus dem Frontend.

## Altes Verhalten und Lehren

- Startpunkte: Windows per `wmic`, macOS Home + `/Users` + `/Volumes/*`, Linux `/`, `/home`, `/dev/*` (unsinnig).
- Tools `{id, label, shortcut, cmd, para, fileLimit}`, `$file` (ein Aufruf je Datei, bis `fileLimit`), `$dir`;
  Defaults: Editor, Terminal, Finder. **Kommandos per String-Verkettung + `exec` (Injection!)**.
- `open`: Linux nur PDF-Viewer. Clipboard: Namen / volle Pfade, je als Text (Tab-getrennt) oder JSON – nur Dateien.

## Aufgaben

1. **Laufwerke/Volumes** (Rust `platform/volumes.rs`): Windows Laufwerksbuchstaben + Typ + Label + frei/gesamt,
   macOS `/Volumes/*`, Linux Mountpoints ohne Pseudo-Dateisysteme (proc, sysfs, tmpfs …). Crate (`sysinfo` o. ä.)
   oder eigene Implementierung begründen. Anzeige als Laufwerksleiste/Dropdown je Panel; Wechsel per Alt+F1/F2
   (TC). Netzlaufwerke/nicht erreichbare Volumes mit Timeout, ohne die UI zu blockieren.
2. **Im System-Dateimanager zeigen** (Datei markiert), **Terminal hier öffnen** (Default-Terminal je OS,
   konfigurierbar) – als schmale Commands, Pfad im Backend validiert.
3. **Externe Tools**: Konfiguration (JSON im App-Config-Verzeichnis, Defaults je OS) `{ id, label, shortcut,
   program, args: string[], perFile: bool, fileLimit, workingDir }` mit Platzhaltern **pro Argument**
   (`{file}`, `{files}`, `{dir}`, `{targetDir}`, `{name}`), Start per `std::process::Command` ohne Shell
   (Argument-Array). Tools erscheinen im Menü, in der Befehlspalette (002) und mit eigenem Kürzel. Ausführen nur von
   Programmen aus der Konfiguration (Frontend schickt Tool-Id + Kontext, nicht das Kommando). Bewertung
   `tauri-plugin-shell` vs. eigener Command im Design.
4. **Zwischenablage**: Aktionen „Namen kopieren“, „Pfade kopieren“, je als Text (Zeilen) und JSON, für Markierung
   bzw. Cursor; Ordner einbeziehbar (anders als alt – entscheiden). Optional: Dateien als echte Datei-Zwischenablage
   des Systems (Kopieren im Finder/Explorer einfügen) – Machbarkeit je OS prüfen, sonst Notiz.
5. **Datei öffnen mit …** (Auswahl der App) – je OS prüfen (macOS `open -a`, Windows „Öffnen mit“-Dialog,
   Linux `xdg-open`/Portal); mindestens Standard-App (aus 003) und „Mit Tool öffnen“.
6. Linux-Desktop-Unterschiede (GNOME/KDE, Terminal-Erkennung) dokumentieren.

## Akzeptanzkriterien

- Laufwerksauswahl zeigt die realen Volumes je OS; nicht erreichbares Netzlaufwerk blockiert nicht.
- Tool mit Dateiname `"; rm -rf ~"` als Argument führt **nichts** Ungewolltes aus (Test mit harmlosem
  Echo-Programm).
- Clipboard-Formate stimmen (Test), Finder/Explorer-Anzeige und Terminal funktionieren (nicht Prüfbares nennen).

## Review-Schwerpunkte

Command-Injection, Pfad-Validierung, Capability-Umfang, Verhalten mit Netzlaufwerken und fehlenden Programmen.
