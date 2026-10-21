# Design 039: Prüfsummen erzeugen und prüfen

> **Status:** umgesetzt (21.10.2026), Branch `feat/pruefsummen` · Phasen zusammengelegt, ohne Freigabe-Halt (Marc:
> „danach den nächsten prompt“) · neue Crates `md-5` und `sha1` (RustCrypto, gleiche `digest`-Version wie `sha2`).

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `duplicates.rs` (SHA-256 über `sha2`) | Hashing | Muster; eigenes Modul `checksum.rs`, weil vier Verfahren und Dateiformate dazukommen |
| Job-Engine (`jobs/`, `Reporter`) | Fortschritt in Bytes, Abbruch, Pause | **passt** – zwei neue Job-Arten |
| `platform::open_regular_file` | nie Gerät/FIFO/Ordner lesen | **passt** |
| `fs_atomic::write_atomic` | Liste/Einzeldatei schreiben (Temp + Umbenennen) | **passt** |
| `PreviewGrid`, `tool-dialog.css` | Ergebnisliste | **passt** |
| `ClipboardApi` (011) | Prüfsumme in die Zwischenablage | **passt** |

## 2. Entscheidungen

- **E1 – Verfahren:** SHA-256 (Default), SHA-512, SHA-1, MD5. BLAKE3/CRC32 weggelassen (kein Bedarf in `sha256sum`-
  kompatiblen Abläufen, weitere Crates). `md-5`/`sha1` 0.10 teilen `digest` 0.10 mit `sha2`.
- **E2 – Format:** Schreiben im GNU-Format `<hex>  <name>` (Textmodus wie `sha256sum`), Namen relativ zum Ordner der
  Liste mit `/`, sortiert; Namen mit `\` oder Zeilenumbruch mit führendem `\` und Escapes (GNU). Lesen: GNU (Text- und
  `*`-Binärmodus, Escapes), BSD (`SHA256 (name) = hex`), Kommentare `#`, CRLF. Verfahren aus dem Dateinamen
  (`.sha256`, `SHA256SUMS`, `md5sum.txt` …) oder aus der Länge des Hex-Werts; widersprechen sich Name und Länge, ist
  die Zeile ungültig.
- **E3 – Feindliche Listen:** Ein Name wird nur gelesen, wenn er relativ ist, kein `..`/Wurzel/Laufwerk enthält und –
  nach Auflösen von Verknüpfungen (kanonisch) – unter dem Ordner der Liste bleibt (`checksum::resolve`); sonst
  „außerhalb – nicht gelesen“. Listen > 128 MiB oder kein UTF-8 werden abgelehnt. Bericht: alle Zähler, höchstens
  10 000 Probleme mit Namen.
- **E4 – Erzeugen** als Job `checksum` mit drei Ausgaben: `list` (eine Datei im aktuellen Ordner, Default
  `CHECKSUMS.<algo>` bzw. `<datei>.<algo>` für eine einzelne Datei; nie stillschweigend überschreiben – Rust lehnt mit
  `already_exists` ab, der Dialog zeigt „ersetzen“ als Häkchen), `perFile` (`<datei>.<algo>` daneben, vorhandene
  bleiben – gezählt als übersprungen), `show` (nur Digests, für die Zwischenablage, parallel, höchstens 100 Dateien).
  Ordner rekursiv; **Verknüpfungen werden nie verfolgt** (übersprungen), Geräte/FIFOs ebenso; die entstehende Liste
  wird nicht mitgehasht, bei `perFile` keine vorhandenen `.<algo>`-Dateien.
- **E5 – Prüfen** als Job `verifyChecksums` (Cursor auf einer Prüfsummendatei); Ergebnisdialog mit Zählern und
  Problemliste, „Geänderte Dateien markieren“ markiert geänderte/unlesbare Dateien, die das Panel noch zeigt.
  Enter auf der Liste öffnet sie weiterhin normal (TC-Verhalten über eigene Aktion).
- **E6 – Aktionen:** `OPEN_CHECKSUM_CREATE_DLG`, `CHECKSUM_VERIFY`, `COPY_CHECKSUM` (SHA-256 der Cursor-Datei) – ohne
  Default-Kürzel (TC hat keine), im Menü „Datei“ und in der Palette; im Archiv und auf Servern gesperrt (Vetos 025/034),
  Erzeugen nicht in Ergebnis-Tabs (Namen relativ zum Ordner). Verfahren und Modus werden als letzte Eingabe gemerkt
  (`dialogs.recent`, 027).
- **Nicht gebaut:** Prüfsumme im Eigenschaften-Dialog (010) – die Aktion „SHA-256 in die Zwischenablage“ deckt den
  Bedarf; Fortsetzen unterbrochener Prüfungen.

## 3. Verträge

```
JobSpec::Checksum { paths, baseDir, algo: md5|sha1|sha256|sha512, output: {kind:list,name,overwrite?}
                    | {kind:perFile,overwrite?} | {kind:show} }
JobSpec::VerifyChecksums { file }
Summary.checksums: { algo, file, digests[{path,hex}], ok, mismatched, missing, unreadable, invalid, refused,
                     problems[{name, path, kind: mismatch|missing|unreadable|invalid|refused}] }
Validierung: Pfade geprüft (validate_input_path, keine Serverpfade); bei `list` alle Pfade unter baseDir; Name
über paths::validate_name.
```

## 4. Tests

- Rust `checksum.rs`: Testvektoren (MD5/SHA-1/SHA-256/SHA-512, leer), Abbruch und Fortschritt, Zeilen-Round-Trip mit
  Escapes (Umlaute, Emoji, `\`, Zeilenumbruch, `*`, führendes Leerzeichen), GNU/Binär/BSD, kaputte Zeilen, Verfahren
  aus dem Namen, relative Namen, feindliche Namen (`..`, absolut, NUL, Link nach außen, fehlende Datei hinter Link).
- Rust `jobs/tests_checksum.rs`: Liste erzeugen und prüfen, nicht überschreiben/überschreiben, Probleme aller Arten,
  je Datei mit Überspringen, `show`, Links nie verfolgt, Validierung, Abbruch bei 512 MiB.
- Frontend `checksum.spec.ts`: Namen, Default-Name folgt dem Verfahren, Ersetzen-Häkchen, Job-Spec, Bericht, gemerkte
  Eingabe, Prüfen + Markieren, Zwischenablage.

## 5. Fortschritt

- [x] Rust, Frontend, Texte en/de, Specs
- [x] Doku (README, features.md, feature-parity A.4, architecture, roadmap, CLAUDE.md)
- [x] E2E Linux (Xvfb, Debug-Build): Ordner `Daten` mit `a ä.txt`, 3 MB `big.bin`, `sub/tief 😀.txt`; alles markiert →
  Palette „Create checksums“ → `CHECKSUMS.sha256` (Namen relativ, sortiert), **`sha256sum -c` meldet alle OK**. Danach
  `a ä.txt` geändert und Zeilen `../../../../etc/passwd` und `fehlt.txt` angehängt → „Verify checksums“: „2 files OK ·
  3 problems“ (geändert, außerhalb – nicht gelesen, fehlt), „Mark changed files“ markiert `a ä.txt`.
- [x] Gefunden im E2E und behoben: die beiden Dialoge saßen im `@case` von „Ordner aufräumen“ – unsichtbar, aber ihr
  Dialogtyp hielt die Tastatur fest. Wächter-Test `workspace-dialogs.spec.ts` (jede `DialogKind` hat einen eigenen
  `@case` mit genau einer Dialog-Komponente; rot gegen den alten Stand).
- [x] `pnpm check` grün (Linux).
- Offen: macOS/Windows bei Marc bzw. in der CI; Zwischenablage unter Xvfb nicht geprüft (Store-Test mit Fake).
