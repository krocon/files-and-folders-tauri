# Prompt 006: Basisoperationen – Ordner, Umbenennen, Kopieren, Verschieben, Löschen

> **Slug:** `basis-operationen` · **Braucht:** 005 · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §3 (Dialoge Copy, Move,
> Delete, Make Directory, Rename), §6 (Server-Operationen und deren Fehler), §4 („Which rows an action uses“).

## Ziel

Die fünf Grundoperationen sicher, plattformübergreifend und nativ in Rust – mit Dialogen im Total-Commander-Stil,
Konfliktbehandlung, Papierkorb und vollständigen Tests. Erst nach diesem Prompt darf die App Nutzerdaten verändern.

## Altes Verhalten und zu behebende Fehler

- Copy/Move-Dialog: Quelle mit rekursiver Zählung („X Dateien, Y Ordner (Größe)“), Ziel = anderes Panel mit
  Dropdown (Favoriten, Tabs, Verlauf). „Options“ war ein TODO; **Überschreiben ohne Rückfrage**.
- Delete löschte **endgültig** und ignorierte den Cursor, wenn nichts markiert war; Rename brauchte eine Markierung.
- Mkdir: Vorschlag = Name der ersten Markierung ohne Endung, kein rekursives Anlegen; neuer Ordner bekommt den Cursor.
- Regel „markierte Zeilen, sonst Cursor-Zeile“ (`getRowsForAction`) gilt **für alle** Operationen einheitlich.

## Aufgaben

1. **Rust `ops/`** (rein, getestet) + Job-Integration aus 005:
   - `mkdir(parent, name)` – auch verschachtelt (`a/b/c`), Namensvalidierung je OS (verbotene Zeichen und Namen
     unter Windows: `CON`, `NUL`, …, Länge), existiert → Fehler.
   - `rename(path, new_name)` – nur Name, nicht Pfad; Groß-/Kleinschreibung-Wechsel auf case-insensitiven
     Dateisystemen (macOS/Windows) korrekt (Zwischenname).
   - `copy(sources, target_dir, options)` – rekursiv, Metadaten (mtime, Rechte; xattr optional), Symlinks als
     Symlinks kopieren (Default) statt folgen, Zyklen ausgeschlossen; Ziel ≠ Quelle, Ziel nicht innerhalb der
     Quelle; Schreiben in temp-Datei + atomic rename, Abbruch räumt auf.
   - `move(sources, target_dir)` – gleiches Volume: `rename`; anderes Volume: copy + delete (nur nach
     erfolgreicher Kopie, pro Eintrag).
   - `delete(paths, mode)` – `trash` (Default, Crate `trash` o. ä. – Abhängigkeit prüfen und begründen,
     Verhalten je OS dokumentieren) oder `permanent` (Shift+Entf/Shift+F8, eigene Bestätigung).
   - Alle Commands validieren Eingaben im Backend (existiert, Rechte, Grenzen); nie nur dem Frontend vertrauen.
2. **Dialoge** (Angular, gemeinsame Dialog-Komponente mit Fokusfalle, Strg/⌘+Enter = primär, Esc = abbrechen):
   - Kopieren/Verschieben (F5/F6): Quelle (Name oder „N Einträge“ + Live-Zählung), Ziel (Text + Dropdown:
     anderes Panel, Favoriten, Tabs, Verlauf), Optionen (Konfliktvorgabe, Symlinks folgen?, im Hintergrund),
     Umbenennen beim Kopieren in denselben Ordner (Einzeldatei: Zielname editierbar wie TC).
   - Löschen (F8/Entf): Zusammenfassung, Papierkorb vs. endgültig deutlich unterscheidbar, Default-Button
     sicher wählen.
   - Neuer Ordner (F7) und Umbenennen (Shift+F6, zusätzlich Inline-Umbenennen in der Liste per F2 – Table-Editor
     prüfen oder eigenes Eingabefeld); Endung beim Umbenennen nicht vorselektieren.
3. **Nach der Operation**: Cursor auf neuen/umbenannten Eintrag, Markierungen der verarbeiteten Einträge
   aufheben, beide Panels aktualisieren (über `changedDirs`), Fehlerbericht.
4. **Sicherheit**: Pfadgrenzen (kein Löschen von `/`, Home-Root, Laufwerkswurzel ohne Extra-Bestätigung),
   Operationen auf Systemordnern warnen. Keine Shell-Aufrufe.
5. **Tests**: tempfile-Bäume mit Unicode, Leerzeichen, tiefen Pfaden, Symlinks (Datei, Ordner, dangling,
   Zyklus), schreibgeschützten Dateien, großen Dateien (Fortschritt), Konflikten (alle Entscheidungen),
   Abbruch an verschiedenen Stellen, Verschieben über Volumes (wenn im Test möglich, sonst simuliert).

## Entscheidungsfragen

- Papierkorb-Crate (Reife, Lizenz, Windows/macOS/Linux-Verhalten) – Empfehlung.
- Symlinks: kopieren als Link (Default) vs. Ziel kopieren – Option im Dialog?
- Inline-Umbenennen mit dem Table-Editor (`START_EDITING`, F2) oder eigenes Overlay?

## Akzeptanzkriterien

- Alle fünf Operationen in der App mit Testordnern durchgespielt, inkl. Konflikt „für alle“, Abbruch, Papierkorb
  (wiederherstellbar) und endgültigem Löschen.
- Einheitliche Regel „Markierung, sonst Cursor“; nach Rename/Mkdir steht der Cursor auf dem Ergebnis.
- Kopieren eines Ordners in sich selbst wird verweigert (Rust-Test); Symlink-Zyklus endet nicht in Rekursion.
- `pnpm check` grün; Review durch separaten Agenten ohne offene kritische Punkte.

## Review-Schwerpunkte

Datenverlust-Szenarien (Move über Volumes, Abbruch, Platte voll), Pfad-Traversal, Groß-/Kleinschreibung,
Windows-Sonderfälle (lange Pfade `\\?\`, reservierte Namen, schreibgeschützte Attribute), Rechte und Zeitstempel.
