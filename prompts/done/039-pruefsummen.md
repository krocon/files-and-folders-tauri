# Prompt 039: Prüfsummen erzeugen und prüfen

> **Slug:** `pruefsummen` · **Braucht:** 005 (Jobs), 016 (Duplikate: Crate `sha2`), 010 (Ansicht) · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `src-tauri/src/duplicates.rs` (Hashing) und das Design 016.
> Vorbild: Total Commander „CRC-Prüfsummen erzeugen/prüfen“.

## Ziel

Für die markierten Dateien (rekursiv in markierten Ordnern) Prüfsummen erzeugen – eine gemeinsame Datei
(`CHECKSUMS.sha256`) oder eine je Datei (`<name>.sha256`) – und vorhandene Prüfsummendateien prüfen.

## Aufgaben

1. **Algorithmen:** SHA-256 (Default), SHA-512, SHA-1, MD5, ggf. BLAKE3/CRC32 – neue Crates nur mit Begründung in
   `docs/architecture.md` (RustCrypto `md-5`/`sha1` passen zu `sha2`).
2. **Format:** GNU coreutils (`<hex>  <relativer Pfad>`, `*` für Binärmodus beim Lesen tolerieren), Pfade relativ zum
   Ordner der Prüfsummendatei mit `/`; beim Prüfen auch BSD-Format (`SHA256 (name) = hex`) und `.md5`/`.sha1`
   erkennen.
3. **Erzeugen** als Job `checksum` (Fortschritt in Bytes, Abbruch, große Dateien stromweise, Konflikt, wenn die
   Zieldatei existiert). Dialog: Algorithmus, eine Datei vs. je Datei, Zielname.
4. **Prüfen** als Job `verify`: Enter/Aktion auf einer Prüfsummendatei; Ergebnis als Liste OK/abweichend/fehlt/
   nicht lesbar mit Summen; abweichende markierbar. Pfade aus der Datei sind feindlich: kein `..`, keine absoluten
   Pfade außerhalb des Ordners (ablehnen und melden).
5. **Schnell:** Aktion „Prüfsumme in die Zwischenablage“ für die Datei unter dem Cursor (Algorithmus wählbar),
   Anzeige auch im Eigenschaften-Dialog (010) auf Knopfdruck.
6. Aktionen `OPEN_CHECKSUM_CREATE_DLG`, `CHECKSUM_VERIFY`, Menü „Dateien“, Texte en/de.

## Akzeptanzkriterien

- Drei markierte Dateien → `CHECKSUMS.sha256`; `sha256sum -c CHECKSUMS.sha256` im Terminal meldet OK.
- Eine Datei danach ändern → Prüfen meldet genau diese als abweichend.
- Datei mit `../etc/passwd` in der Prüfsummendatei → abgelehnt, kein Lesen außerhalb.
- 4-GiB-Datei → Fortschritt, abbrechbar, kein hoher Speicherverbrauch.
- Namen mit Leerzeichen, Umlauten, Zeilenumbruch im Namen (GNU-Escape `\` am Zeilenanfang).

## Tests

- Rust: bekannte Testvektoren je Algorithmus, Format lesen/schreiben (GNU, BSD, Escapes), Pfad-Validierung,
  Abbruch, große Dateien (sparse).
- Frontend: Dialog, Ergebnisliste, Markieren der Abweichungen (Fakes).
- E2E unter Xvfb mit `sha256sum -c` als Gegenprobe.
