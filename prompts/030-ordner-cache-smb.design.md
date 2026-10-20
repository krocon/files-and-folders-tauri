# Design 030: Ordner-Cache und schnelleres Listing für langsame Laufwerke

> Status: **in Arbeit** · Branch `feat/ordner-cache-smb` (von `feat/reaktionsfaehig-bei-jobs`, 029 noch nicht in `main`)
> · Prompt: [030-ordner-cache-smb.md](030-ordner-cache-smb.md) · Marc hat am 20.10.2026 „Go“ gegeben; Entscheidungen
> werden ihm mitgeteilt, gearbeitet wird ohne Haltepunkt.

## Entscheidungen

**E1 Ein Cache je Pfad im Frontend** (`core/fs/listing-cache.ts`, Root-Service `ListingCache`): Pfad (wie Rust ihn
liefert) → `{ listing, listedAt, durationMs }`. Gecacht wird nur, was langsam ist: `durationMs ≥ 300` **oder**
`listing.network`. Grenze 200 000 Einträge insgesamt (LRU nach letzter Nutzung), nur im Speicher. Archive (virtuelle
Pfade) nie – Rust hat dafür schon einen Index-Cache. Ein schnelles neues Listing eines lokalen Ordners entfernt
dessen Eintrag. Der Tab-Cache aus 029 E5 entfällt; der Tab-Wechsel nutzt denselben Weg (`load`).

**E2 Anzeige aus dem Cache = immer unbestätigt.** `load(path)` (Navigation, nicht `background`) mit Cache-Treffer:
sofort `showListing` (Verlauf, Cursor, Marken wie bei einer Antwort), `cachedAt = listedAt` (Signal), dann sofort ein
Hintergrund-Load desselben Pfads. Seine Antwort ersetzt Liste und Cache-Eintrag und setzt `cachedAt = null`. Jede
Anzeige aus dem Cache ist also unbestätigt, bis Rust geantwortet hat – damit braucht es keine eigene Invalidierung
durch Jobs/Watcher (zu kompliziert für wenig Gewinn; der Watcher überwacht Netzlaufwerke per Default ohnehin nicht).
Ctrl+R liest wie bisher frisch. Fehler des Hintergrund-Loads (Ordner weg): Fehlerbox, Eintrag raus, Liste bleibt
unbestätigt.

**E3 Kennzeichnung.** Solange `cachedAt` gesetzt ist: Statuszeile „· Stand 10:05 · wird geprüft …“ (Uhrzeit nach
Sprache, `title` mit Datum), Pfadzeile gedimmt (`.unconfirmed`), ein `role="status"`-Text nur beim Wechsel in den
Zustand. Tokens vorhanden (muted).

**E4 Nichts Destruktives auf unbestätigtem Stand – Frontend.** Neue Veto-Quelle wie beim Archiv (`ActionService`):
solange das aktive Panel `cachedAt !== null` hat, sind Löschen, Verschieben, Umbenennen (F2), Multi-Rename,
Gruppieren, Aufräumen, Packen/Entpacken *in* den Ordner und Ordner/Datei anlegen gesperrt (Hinweis „wird noch
geprüft“). Kopieren aus dem Ordner, Ansicht, Eigenschaften bleiben. Drag & Drop öffnet nur den Dialog; Verschieben dort
schützt E5.

**E5 Nichts Destruktives auf altem Stand – Rust.** `JobSpec::Delete` und `JobSpec::Move` bekommen optional
`expected: Vec<ExpectedEntry { path, kind, size?, modifiedMs? }>` (serde default, leer = keine Prüfung). Vor dem
Löschen/Verschieben eines obersten Eintrags vergleicht der Job: Art immer; bei Dateien Größe und mtime (bei Ordnern
nur die Art – deren mtime ändert sich bei jedem Inhalt). Abweichung → Eintrag wird **nicht** angefasst, als
`ItemFailed` mit neuem Code `changed_since_listing` gemeldet (Summary „x übersprungen“). Das Frontend schickt
`expected` für Quellen aus Panels mit `listing.network` oder unbestätigtem Cache. Umbenennen bekommt keine Prüfung
(kein Datenverlust, Ziel wird nie überschrieben – 006); E4 sperrt es ohnehin.

**E6 `network` im Listing.** `DirectoryListing.network: bool` (Rust `netfs::is_network`, ein `statfs` je Listing,
`#[serde(default)]`, TS optional) – DTO-Vertrag beidseitig + Test.

**E7 macOS: `getattrlistbulk`.** In `platform/bulk_list.rs`:
- **rein und überall testbar:** `parse_entries(buf, count) -> Vec<RawEntry>` liest die gepackten Einträge nach
  `getattrlistbulk(2)`: `u32 length`, `attribute_set_t returned`, falls zurückgegeben `u32 error` (direkt nach
  `returned`, wie im Beispiel der Man-Page), dann in Bit-Reihenfolge `ATTR_CMN_NAME` (`attrreference_t`, Offset relativ
  zur Referenz, Länge inkl. NUL), `ATTR_CMN_OBJTYPE` (u32), `ATTR_CMN_MODTIME` (`timespec`, 16 Byte), `ATTR_CMN_FLAGS`
  (u32), `ATTR_FILE_DATALENGTH` (off_t, nur Dateien); jedes Feld nur, wenn sein Bit in `returned` gesetzt ist; Lesen
  mit `read_unaligned` und Längenprüfung (kaputter Puffer → Fehler, nie UB). `raw_to_dto(dir, raw)` macht daraus das
  `DirEntryDto` wie `listing::entry_from_metadata` (Symlink-Ziel weiter per `fs::metadata`, `UF_HIDDEN`, Punktdateien,
  nicht-UTF-8 lossy, `ATTR_CMN_ERROR`/fehlende Art → `Unknown` + unlesbar).
- **nur macOS (im Container nicht kompilierbar – Marc baut/testet):** `open(O_RDONLY|O_DIRECTORY|O_CLOEXEC)`,
  Schleife `getattrlistbulk` mit 256-KiB-Puffer bis 0, `close`. Jeder Fehler → `None` → bisheriger Weg.
- Gleichheitstest gegen `listing::list_directory` (`#[cfg(target_os = "macos")]`) und ein ignorierter Mess-Test
  `listing_speed` (`FNF_BENCH_DIR=<pfad>`), der beide Wege je 3× misst.

**E8 Kein rekursives Vorladen** (Prompt D).

## Tests

Rust: Parser mit handgebauten Puffern (Datei, Ordner, Symlink, Fehler-Eintrag, fehlende Bits, Unicode/nicht-UTF-8,
kaputte Längen), `raw_to_dto` auf tempfile-Baum, `expected`-Prüfung in Delete/Move (ersetzt, vergrößert, Datei→Ordner,
unverändert), `network`-Feld. Frontend: Cache (Schwelle, network, LRU nach Einträgen, Archive nie), Store (Treffer →
sofort + Hintergrund, `cachedAt`, Fehler, Ctrl+R), Veto, `expected` im Ops-Store, Tab-Wechsel über den Cache, Kataloge.
E2E: Xvfb mit `FNF_TEST_SLOW`.

## Fortschritt

- [x] Design
- [ ] Rust
- [ ] Frontend
- [ ] E2E, Doku, Review
