# Design 037: Dateien vergleichen

> **Status:** umgesetzt (21.10.2026), Branch `feat/dateien-vergleichen` · Phasen zusammengelegt, ohne Freigabe-Halt
> (Marc: „go“) · neue Crate `similar` (Apache-2.0) · nur lesend, kein Editor (023 bleibt verworfen).

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `preview/encoding.rs`, `detect.rs` (010) | Kodierung erkennen/dekodieren, Text oder binär | **passt** – gleiche Regeln wie F3 |
| `PreviewGrid` (008) | zwei Spalten mit Zeilennummern | **passt** – virtuell (GuiExpert Table), Zeilenklassen, `activeIndex` scrollt |
| Tools mit `{files}` (011) | externes Diff-Programm | **passt** – nur Default-Einträge `diff` und `OsStore.runToolWith` fehlten |
| `hexDump` (010) | Hex | nur Offset ab 0 → eigenes `hexLines` mit absolutem Offset |

## 2. Entscheidungen

- **E1 – Welche zwei Dateien** (`pickFiles`, rein): genau zwei markierte Dateien der aktiven Seite; sonst die
  Cursor-Datei (oder die eine markierte) der aktiven Seite gegen die Cursor-Datei der anderen Seite. Die Datei der
  linken Seite steht links. Klare Meldungen: mehr als zwei markiert, andere Seite ohne Datei, keine Dateien,
  dieselbe Datei.
- **E2 – Text-Diff in Rust** (`diff.rs`): Crate `similar` (Myers mit Deadline 10 s), Zeilenenden `\n`, `\r\n`, `\r`
  vereinheitlicht und je Seite gemeldet (LF/CRLF/CR/gemischt), Kodierung wie die Ansicht (UTF-8/16, 1252, Latin-1) –
  gleicher Text in UTF-8 und Latin-1 ist gleich. Optionen: Leerraum ignorieren (Folgen von Leerraum = ein Leerzeichen,
  Ränder weg), Groß/klein ignorieren; angezeigt wird immer der Originaltext. Ergebnis als fertige Zeilen für die
  Ansicht (`equal/removed/added/changed/skip`), Standard 3 Kontextzeilen, „Ganze Datei“ auf Wunsch; höchstens
  400 000 Zeilen (sonst gekürzt + Hinweis). Grenzen: 16 MiB Text je Datei.
- **E3 – Binär** (eine Seite sieht binär aus, oder Option): Byte für Byte in 1-MiB-Blöcken, Anzahl abweichender
  Bytes, die ersten 1 000 Bereiche, 128 Bytes Hex um die erste Abweichung (auch wenn nur die Länge abweicht);
  bis 512 MiB je Datei – darüber das externe Programm.
- **E4 – Command statt Job:** `diff_files` ist ein schmaler, lesender, begrenzter Command (`spawn_blocking`), kein
  Job – Ergebnis gehört in einen Dialog, nicht in die Task-Liste; veraltete Antworten verwirft der Store (Sequenz).
- **E5 – Ansicht:** Dialog fast bildschirmfüllend, oben beide Pfade mit Größe/Kodierung/Zeilenende, Optionen, Zeile
  „N Unterschiede · Unterschied i von N“ (Live-Region), Gitter mit Spalten Nr. | links | Nr. | rechts, Monospace,
  Farben über neue Tokens `--color-diff-added/removed/changed` (alle Schemata, Kontrastpaare gegen den Listentext;
  alte Designs bekommen die minimale WCAG-Korrektur automatisch). „Nächster/Vorheriger“ als Knöpfe und **F7 /
  Shift+F7** im Dialog. Tabs als vier Leerzeichen, Leerzeichen bleiben erhalten (NBSP), Text nie als HTML.
- **E6 – Externes Programm:** Default-Tool `diff` je OS (macOS `opendiff` = FileMerge, Windows WinMerge, Linux Meld)
  mit `{files}`, Limit 2; ist ein Tool mit der Id `diff` konfiguriert, zeigt der Dialog „In … öffnen“. Start ohne
  Shell wie alle Tools (011).
- **E7 – Aktion** `COMPARE_FILES` ohne Default-Kürzel (TC hat keins), Menü „Datei“ und Kontextmenü bei Markierung,
  Palette; im Archiv und auf Servern gesperrt (Vetos 025/034). Ordnervergleich (036) kann sie später aus einer
  `≠`-Zeile öffnen.

## 3. Verträge

```
Command diff_files(left, right, options?: { ignoreWhitespace, ignoreCase, context: number|null, binary })
  → { kind: 'text', left, right: { size, encoding, eol }, rows: [{ kind, left: [nr, text]|null, right, skipped? }],
      changes, truncated }
  | { kind: 'binary', left, right, identical, ranges: [{offset,len}], differingBytes, windowOffset,
      leftWindow: number[], rightWindow: number[] }
Fehler: same_source_target (dieselbe Datei), too_many (zu groß), not_a_file/not_found …
```

## 4. Tests

- Rust `diff.rs`: Zeilenenden, eingefügt/entfernt/geändert nebeneinander (Umlaut, Emoji), Kontext mit
  übersprungenen Zeilen, gleiche Dateien, Leerraum/Groß-klein, UTF-8 gegen Latin-1 mit CRLF, Binär (Bereiche, Fenster,
  gleich, nur Länge), Grenzen und Ablehnungen.
- Frontend `diff.spec.ts`: Auswahlregeln und Meldungen, Blockanfänge, Zellentext, Hex mit absolutem Offset; Store
  (Aufruf mit Optionen, Schritte, Neuladen mit Optionen, Fehler), Dialog (Seiten, Zähler, F7/Shift+F7, „gleich“),
  Binäransicht, externes Tool bekommt beide Dateien.
- Sichtprüfung im Screenshot-Werkzeug (Szene `compare-files`, Mock-Antwort) in Hell, Dunkel und Norton.

## 5. Fortschritt

- [x] Rust, Frontend, Tokens, Texte en/de, Specs, Szene für die Screenshots
- [x] Doku (README, features.md, feature-parity A.4, architecture, roadmap, CLAUDE.md)
- [x] E2E Linux (Xvfb, Debug-Build): links `L/text ä.txt` (UTF-8, LF), rechts `R/text ä.txt` (Windows-1252, CRLF, eine
  Zeile geändert, eine angehängt) → Palette „Compare files“: Kopf zeigt „utf-8 · LF“ bzw. „windows-1252 · CRLF“,
  „Grüße“ gleich, „2 differences · difference 1 of 2“, Zeile 3 als aktueller Unterschied, Zeile 5 grün; Leerraum/Groß-klein
  per Leertaste umgeschaltet → neu geladen. Binär `data.bin` (200 KB, zwei Bytes ab 1000 geändert): „2 bytes differ in
  1 range · First difference at offset 0x3e8“, Hex beider Seiten ab 0x3c8 (rechts `42 42`). „Open in Compare (Meld)“
  sichtbar (Default-Tool unter Linux).
- [x] Gefunden im E2E und behoben: die beiden Hex-Spalten liefen ineinander (Spalten `minmax(0, 1fr)`, jede scrollt).
- [x] `pnpm check` grün (Linux).
- Offen: macOS (FileMerge/`opendiff`) und Windows (WinMerge) bei Marc bzw. in der CI.
