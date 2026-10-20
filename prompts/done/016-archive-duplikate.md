# Prompt 016: Archive und Duplikate (optional, später)

> **Slug:** `archive-duplikate` · **Braucht:** 005, 006, 009 · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`. Herkunft: im alten Programm nur geplant („Find duplicates“-Platzhalter,
> TODO.txt: Archive, Merge/Split; legacy §3, §9); das neuere `files-and-folders-mr` hat Pack/Unpack und Duplikate –
> dort **nur Funktionsreferenz**, kein Code (Lizenz, `CLAUDE.md` §8).

## Ziel

Zwei Total-Commander-Klassiker: in Archive hineinschauen wie in Ordner (ZIP zuerst, dann TAR/TAR.GZ), entpacken und
packen; Duplikate finden (Größe → Hash) mit sicherer Auswahl zum Löschen.

## Aufgaben

1. **Archive** (Rust, Crates `zip`, `tar`, `flate2` o. ä. – Lizenzen/Sicherheit prüfen): Archiv als virtueller
   Ordner im Panel (Enter auf `.zip`), Navigation, Kopieren aus dem Archiv = Entpacken (Job, Konflikte),
   Packen der Markierung (Alt+F5), Entpacken (Alt+F9). **Zip-Slip** (`../`-Pfade, absolute Pfade, Symlinks im
   Archiv) zwingend abwehren; Größen-/Anzahl-Limits gegen Zip-Bomben. 7z/RAR nur bewerten (Lizenz, Abhängigkeit).
2. **Duplikate**: Suche in Ordnern (Optionen: gleiche Größe, gleicher Inhalt per Hash – schnell vorab erste/letzte
   64 KB, dann voll; gleicher Name), Ergebnis als Gruppen (GuiExpert Row Grouping oder Baum), Auswahlhilfen
   („alle außer neuester“), Löschen über 006 (Papierkorb).
3. Fortschritt/Abbruch über 005.

## Akzeptanzkriterien

- ZIP mit Unicode-Namen öffnen, navigieren, Teile entpacken, Markierung packen; Zip-Slip-Testarchiv wird
  abgewiesen (Rust-Test).
- Duplikatsuche über 100 000 Dateien abbrechbar, Ergebnis korrekt (Test mit bekannten Dubletten).

## Ergänzungen aus files-and-folders-mr (mr §3, §5, §7)

- **Zip-Browsing** über Pfade `datei.zip:` (Archiv wie Ordner), Pack-Dialog (Dateiname, Zielordner, Passwort, Format,
  Kompressionsstufe), Unpack (Zielordner, Passwort); mr nutzte 7-Zip (`node-7z` + `7zip-bin`) – hier Rust-Crates oder
  ein mitgelieferter 7-Zip-Sidecar (Lizenz prüfen).
- „Find duplicates“ hatte in mr nur ein Kürzel, keine Umsetzung.
