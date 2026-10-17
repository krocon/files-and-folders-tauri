# Prompt 003: Navigation, Verlauf, Filter und Statuszeile

> **Slug:** `navigation-liste` · **Braucht:** 001, 002 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §4 (Dateiliste, Sortierung,
> Quick-Filter, Ordnergröße, Statuszeile), §5 (Breadcrumb, Favoriten, Verlauf, zuletzt besuchte Ordner).

## Ziel

Ein Panel lässt sich so schnell bedienen wie im Total Commander: klickbare Pfadleiste, „..“-Zeile, Zurück/Vor,
zuletzt besuchte Ordner und Favoriten, versteckte Dateien ein/aus, Schnellfilter und Typ-Ahead-Suche, Ordnergröße
per Tastendruck und eine korrekte Statuszeile. Dateien öffnen sich mit der Standard-App.

## Altes Verhalten (Kurzfassung) und bekannte Fehler

- Breadcrumb mit klickbaren Segmenten, Stern = Favorit, Dropdown „zuletzt“ (Startpunkte + 15 Ordner).
- **Keine „..“-Zeile, keine Hidden-Behandlung**, Verlauf nur „zurück“, unbegrenzt, mit Dubletten.
- Datumsspalte zeigte **atime** statt mtime; Statuszeile um Faktor 1000 falsch; Sortierung nicht natürlich.
- Quick-Filter (Teilstring) blendet sich nach 6,7 s aus; Leertaste = Ordnergröße (rekursiv, ohne Abbruch).
- Enter auf Datei = Standard-App (Linux nur PDF-Viewer – Fehler).

## Aufgaben

1. **Pfadleiste**: Segmente aus `DirectoryListing.segments` (Rust liefert sie schon), Klick = Navigation,
   Tastatur erreichbar; Bearbeiten-Modus (Klick/Strg+L) mit Pfadeingabe und Validierung über das Backend
   (Fehler als `FsError`), `~` expandiert Rust.
2. **„..“-Zeile** oben (nicht im Root), wird nie markiert, nicht sortiert, nicht gezählt; Enter = hoch. Umsetzung
   mit der GuiExpert Table entscheiden (eigene erste Zeile im Modell oder fester Kopfbereich).
3. **Verlauf je Panel** (später je Tab): Zurück/Vor-Stack mit Limit (z. B. 100), keine direkten Dubletten,
   Cursor-/Scrollposition je Eintrag gemerkt; Kürzel Alt+←/→ (macOS ⌘+[ / ⌘+]), Maustasten 4/5.
4. **Zuletzt besucht + Favoriten**: Dropdown mit Startpunkten (Home; Laufwerke kommen in Prompt 011),
   zuletzt besuchten Ordnern (dedupliziert, Limit) und Favoriten (Stern in der Pfadleiste). Persistenz über den
   Einstellungsdienst (vorläufig einfache JSON-Datei im App-Config-Verzeichnis, Prompt 015 baut darauf auf).
5. **Versteckte Dateien** umschalten (Strg/⌘+H bzw. TC Strg+.?) – Flag `hidden` existiert bereits; Filter im
   Frontend, Zustand je Panel und als Default in den Einstellungen.
6. **Schnellfilter** (Strg/⌘+F bzw. eigenes Kürzel): Eingabefeld über der Liste, Glob/Teilstring, filtert über
   `externalFilterFunction`; Esc leert. **Typ-Ahead**: Tippen in der Liste springt zum ersten passenden Namen
   (Präfix, Unicode-fähig, Reset nach Pause) – kein Filter.
7. **Ordnergröße**: Rust-Command `calc_dir_size(path)` als abbrechbarer Job mit Fortschritt (Channel), folgt keinen
   Symlinks (Zyklen!), zählt Dateien/Ordner/Bytes, meldet unlesbare Unterordner; Ergebnis erscheint in der
   Größenspalte; Abbruch bei Ordnerwechsel. Auslöser je nach Entscheidung in Prompt 002 (Leertaste).
8. **Statuszeile je Panel**: „3 von 120 Dateien (1,2 MB von 45 MB) · 1 von 8 Ordnern“ – Binäreinheiten wie
   `formatSize`, Ordnergrößen nur wenn berechnet; Live-Region für Ansagen.
9. **Datei öffnen**: Enter/Doppelklick auf Datei → Standard-App des Systems. Weg im Design entscheiden
   (`tauri-plugin-opener` mit eng begrenzter Capability **oder** eigener Command je OS); Pfad wird im Backend
   validiert (existiert, ist Datei). Ausführbare Dateien: Rückfrage oder Sperre (Design).
10. **Neu laden** (Strg+R/F5? – Konflikt mit TC-F5 = Kopieren klären), Cursor und Markierung bleiben per Pfad.
11. Rust: `DirEntry` um `created_ms`, `accessed_ms`, `readonly` erweitern, falls für Spalten/Eigenschaften nötig
    (nur, wenn der Prompt es braucht – sonst Prompt 010).

## Entscheidungsfragen

- „..“-Zeile im Tabellenmodell oder außerhalb?
- Öffnen über `tauri-plugin-opener` oder eigenen Command? Capability-Umfang.
- Kürzel für Neu laden, Hidden, Filter in allen drei Keymaps (Abgleich mit Prompt 002).

## Akzeptanzkriterien

- Pfadsegment-Klick, Pfadeingabe (inkl. Fehlermeldung bei ungültigem Pfad), „..“, Zurück/Vor funktionieren und
  stellen Cursor + Scrollposition wieder her.
- Favorit setzen/entfernen bleibt nach Neustart erhalten; zuletzt besuchte Ordner ohne Dubletten.
- Hidden-Umschalter, Schnellfilter und Typ-Ahead arbeiten auf 100 000 Einträgen ohne spürbare Verzögerung.
- Ordnergröße eines großen Baums lässt sich abbrechen; Symlink-Zyklus führt nicht zu Endlosschleife (Rust-Test).
- Statuszeile stimmt (Test mit bekannten Größen); Datei öffnet sich in der Standard-App (macOS/Windows/Linux, nicht
  Prüfbares im Bericht nennen).
