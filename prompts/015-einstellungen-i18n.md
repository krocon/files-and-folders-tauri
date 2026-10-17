# Prompt 015: Einstellungen und Internationalisierung (de/en)

> **Slug:** `einstellungen-i18n` · **Braucht:** 002–004, 013 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §7 (Konfigurationsdateien
> und Merge-Reihenfolge), §5 (Persistenz), §9 (kein Options-Dialog, Pfad-Traversal über `username`).

## Ziel

Ein robuster Einstellungsdienst (eine Datei, versioniertes Schema, atomar geschrieben) und ein
Einstellungsdialog für alles, was bisher hart verdrahtet ist; dazu deutsche und englische Oberfläche.

## Aufgaben

1. **Settings-Service** (Rust schreibt/liest, Frontend-Fassade `SettingsApi`, Root-Store mit Signals):
   Schema mit `version`, Migrationen, Validierung (unbekannte Schlüssel behalten, ungültige Werte → Default +
   Warnung), atomares Schreiben, entprellt. Bisher verstreute Dateien (Sitzung 004, Favoriten 003, Keymap-Override
   002, Tools 011, Themes 013) zusammenführen oder bewusst getrennt lassen (Design).
2. **Einstellungsdialog** (⌘, bzw. Strg+,): Ansicht (Spalten, Datumsformat, Größen in Bytes/KB/binär oder
   dezimal, versteckte Dateien, Zeilenhöhe/Schrift), Verhalten (Bestätigungen, Papierkorb-Default, Doppelklick,
   Leertaste-Verhalten, Start-Ordner), Tastatur (Keymap-Editor mit Konfliktanzeige, Zurücksetzen), Tools,
   Themes, Sprache. Suchfeld im Dialog.
3. **i18n**: Angular-eigene i18n vs. Laufzeit-Lösung (Sprache ohne Neubau umschalten) – entscheiden; alle Texte
   aus Komponenten und `describeFsError()` in Kataloge (en = Quelle, de vollständig), Datums-/Zahlenformat über
   `Intl` mit gewählter Locale; Pluralregeln. Rust-Fehlermeldungen bleiben technisch (Codes werden übersetzt).
4. Export/Import aller Einstellungen (eine JSON-Datei).

## Akzeptanzkriterien

- Jede Einstellung wirkt sofort oder sagt, dass ein Neustart nötig ist; nach Neustart erhalten.
- Kaputte Settings-Datei → Start mit Defaults, Original wird als `.bak` gesichert, Warnung (Rust-Test).
- Sprache de/en vollständig umschaltbar (Test: keine fehlenden Schlüssel), Formate folgen der Locale.
