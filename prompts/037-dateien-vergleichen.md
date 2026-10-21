# Prompt 037: Dateien vergleichen (Diff)

> **Slug:** `dateien-vergleichen` · **Braucht:** 010 (Ansicht F3, Text/Hex, Kodierung), 011 (externe Tools,
> Platzhalter) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/010-vorschau-eigenschaften.design.md` und
> `prompts/done/011-os-integration-tools.design.md` (Platzhalter, Start ohne Shell). Vorbild: TC „Nach Inhalt
> vergleichen“. Ein eingebauter **Editor** bleibt verworfen (023) – der Vergleich ist nur lesend.

## Ziel

Zwei Dateien – die Datei unter dem Cursor links und rechts, oder genau zwei markierte Dateien einer Seite – werden
nebeneinander verglichen. Text zeigt Zeilen-Unterschiede, Binärdateien die Hex-Ansicht mit markierten Abweichungen.
Wer lieber ein externes Programm nutzt, konfiguriert ein Tool `diff`.

## Aufgaben

1. **Aktion** `COMPARE_FILES` (Kürzel im Design, Menü „Dateien“, Kontextmenü bei zwei markierten Dateien). Regeln,
   welche zwei Dateien gemeint sind, als reine Funktion (`compare-files-logic.ts`) – mit klarer Meldung, wenn es nicht
   eindeutig ist.
2. **Rust-Command** `diff_files(left, right, options)` (async): liest beide Dateien mit Größenlimit (Einstellung,
   Default z. B. 10 MiB Text), Kodierung wie `preview/encoding.rs`, Text-Diff zeilenweise (Crate z. B. `similar` –
   in `docs/architecture.md` begründen), Optionen: Leerraum ignorieren, Groß/klein ignorieren. Binär: erste N
   abweichende Offsets + Anzahl. Ergebnis als kompaktes DTO (Hunks), nicht die ganzen Dateien zweimal.
3. **Ansicht**: Dialog/Vollbild wie F3 mit zwei Spalten, synchronem Scrollen, Zeilennummern, Farben über Tokens
   (neue Tokens `--color-diff-added/removed/changed` für alle Schemata, Kontrastpaare), „nächster/voriger
   Unterschied“ (F7/Shift+F7 o. ä.), nur Unterschiede mit Kontext. Text immer per `textContent`.
4. **Externes Tool**: Default-Eintrag `diff` in `tools.json` je OS (z. B. `opendiff`/FileMerge auf macOS, `meld` unter
   Linux, WinMerge unter Windows – nur als Vorschlag, deaktiviert, wenn nicht gefunden) mit zwei Pfad-Platzhaltern;
   Einstellung „Vergleich mit externem Tool“.
5. Ordnervergleich (036) kann aus einer `≠`-Zeile diesen Vergleich öffnen (falls 036 schon da ist).

## Akzeptanzkriterien

- Zwei Textdateien mit eingefügten, gelöschten, geänderten Zeilen → richtige Markierung, Sprung zum nächsten
  Unterschied per Tastatur.
- UTF-8 vs. UTF-16/Latin-1 gleichen Inhalts → mit Option „Kodierung ignorieren“ gleich.
- Zwei Binärdateien → Hex-Ansicht, erste Abweichung angesprungen, Anzahl genannt.
- Datei über dem Limit → Hinweis, Angebot externes Tool.
- Externes Tool konfiguriert → startet mit beiden Pfaden, ohne Shell.

## Tests

- Rust: Diff-Fälle (leer, nur Zeilenende-Unterschiede CRLF/LF, sehr lange Zeilen, Limit), Binärvergleich.
- Frontend: Auswahl der zwei Dateien, Navigation zwischen Unterschieden, Renderer ohne `innerHTML`.
- E2E unter Xvfb, light und dark ansehen.
