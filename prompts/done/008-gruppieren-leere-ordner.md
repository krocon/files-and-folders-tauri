# Prompt 008: Dateien gruppieren, Ordner aufräumen, Multi-MkDir

> **Slug:** `gruppieren-leere-ordner` · **Braucht:** 005, 006 · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §3.2 (Group Files),
> §3 und §6 (Delete empty folders, `delempty`).

## Ziel

Zwei Spezialwerkzeuge des alten Programms, neu und sicher: **Dateien in Unterordner gruppieren** (nach laufender
Nummer, Trennzeichen, erstem Wort, Anfangsbuchstaben …) per Kopieren oder Verschieben, und **leere Ordner
rekursiv löschen** – ohne den alten Fehler, dass Elternordner oberhalb des Startordners gelöscht werden konnten.

## Gruppieren (legacy §3.2)

- Modi: Laufende Nummer (Default), Neuer Ordner (manuell), Minus-Trenner, Erstes Wort, Erster Buchstabe
  (normal/klein/groß), Zwei Buchstaben (normal/klein/groß).
- Optionen: Klammern ignorieren (Default an), minimale Gruppengröße (keine, 2 Default, 3, 4, 5, 10), Quellordner
  statt anderem Panel als Wurzel; Anzeige der Gruppenzahl; Ziel `<wurzel>/<gruppe>/<name>`.
- Neu: Vorschau-Tabelle (Datei → Gruppe), Unicode-Wörter statt nur `\w` (ASCII), Gruppennamen validieren (ungültige
  Zeichen, Länge), Konflikte über die Job-Engine (005), Ausführung = Kopieren/Verschieben aus 006.

## Leere Ordner löschen (legacy §3, §6)

- Startordner = aktueller Ordner bzw. markierte Ordner; löscht von unten nach oben alle Ordner ohne Einträge.
- **Fehler beheben**: nie oberhalb des Startordners; der Startordner selbst nur auf ausdrücklichen Wunsch.
- Option: Ordner, die nur „Systemmüll“ enthalten (`.DS_Store`, `Thumbs.db`, `desktop.ini`), als leer betrachten
  (Liste konfigurierbar, Default aus).
- Vorschau (Liste der zu löschenden Ordner) → Papierkorb (Default) oder endgültig; als Job mit Abbruch.

## Aufgaben

1. Gruppierungs-Logik als reine Funktion (TS oder Rust – wie in Prompt 007 entschieden) mit tabellengetriebenen
   Tests aus den alten Regeln (Beispiele aus Dateinamen wie „Band - Titel 01.mp3“).
2. Rust: `find_empty_dirs(roots, options)` (folgt keinen Symlinks, meldet unlesbare Ordner) + Löschen als Job.
3. Dialoge (Alt+G für Gruppieren; leere Ordner Strg/⌘+Alt+R wie alt – mit Keymap 002 abgleichen).
4. Tests: Grenzen (Startordner, Symlink auf leeren Ordner außerhalb), Systemmüll-Option, Abbruch.

## Akzeptanzkriterien

- Alle Gruppierungsmodi mit Vorschau; Ausführen per Kopieren und Verschieben, Konflikte über den Dialog aus 005.
- Leere Ordner: nie etwas außerhalb des Startordners (Rust-Test), Vorschau vor dem Löschen, Papierkorb als Default.

## Ergänzungen aus files-and-folders-mr (mr §5)

- **Gruppieren**: 11 Modi (u. a. zusätzlich `ebook_mode`), optional KI-Strategie (wie 007: nur optional).
- **Clean Folders** statt nur „leere Ordner löschen“: Muster für zu löschende Dateien (Glob, Default `**/*.bak`) **und**
  Option „leere Ordner löschen“ – mit Vorschau, Papierkorb, nie außerhalb des Startordners.
- **Multi-MkDir**: Ordnernamen-Vorlage mit Zähler (Start/Ende/Schritt/Stellen) und Groß-/Kleinschreibung.
