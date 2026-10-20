# Prompt 030: Ordner-Cache und schnelleres Listing für langsame Laufwerke (SMB)

> **Slug:** `ordner-cache-smb` · **Braucht:** 029 (Tab-Cache E5, Drossel E2, Listing-Gate E6, `FNF_TEST_SLOW`), 012
> · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/029-reaktionsfaehig-bei-jobs.design.md` (E1–E6, Review #5–#9).
> Anlass: Marcs Frage vom 20.10.2026 – auf SMB-Freigaben unter macOS dauert jeder Ordnerwechsel, auch zurück in einen
> gerade besuchten Ordner (z. B. nach dem Kopieren dorthin). Kurzanalyse und Empfehlung im selben Gespräch: Cache
> je Pfad nach „sofort zeigen, im Hintergrund prüfen“, **kein** rekursives Vorladen, dazu das Listing auf macOS selbst
> beschleunigen.

## Ziel

1. **Zurück ist sofort da.** Ein Ordner, der in dieser Sitzung schon gelesen wurde und langsam ist, erscheint beim
   erneuten Besuch (Zurück/Vor, `..`, Breadcrumb, Verlauf, Favorit, Tab) sofort aus dem Cache und wird im Hintergrund
   neu gelesen. Der Nutzer sieht jederzeit, dass er einen gemerkten Stand sieht.
2. **Nichts Gefährliches auf altem Stand.** Löschen, Verschieben und Umbenennen wirken nie auf Einträge, die nur der
   Cache kennt, ohne dass geprüft wurde, dass sie noch so existieren.
3. **Das Listing selbst wird auf macOS-Netzlaufwerken schneller** (`getattrlistbulk` statt eines `stat` je Eintrag).

## Bestand (aus 029)

- `FilePanel.tabListings`: letztes Listing je Tab (16, mit `listedAt`), Anzeige per `FileBrowserStore.showListing` +
  `requestRefresh()`. → wird durch den Cache je Pfad **ersetzt** (ein Mechanismus, nicht zwei).
- `FileBrowserStore`: `background`-Load (`refreshing`, kein Overlay), Drossel `refreshGapMs`, `slow`, `cancelLoad`.
- Rust: `listing_gate` (ein Listing je hängendem Ordner), `list_dir` → `archive::list_directory_or_archive` →
  `listing::list_directory` (`read_dir` + `symlink_metadata` je Eintrag + `metadata` je Symlink).
- Watcher: Netzlaufwerke sind per Default **nicht** überwacht (`watch.pollNetwork` aus) – ein Cache auf SMB wird also
  nicht vom Watcher aktuell gehalten.

## Aufgaben

### A. Cache je Pfad (Frontend) – Kern

- Root-Service `ListingCache` (beide Panels teilen ihn): Pfad → `{ listing, listedAt, durationMs, confirmed }`.
- **Was gecacht wird:** nur „langsame“ Ordner – Listing-Dauer ≥ Schwelle (Vorschlag 300 ms) **oder** Ordner auf einem
  Netzlaufwerk (Rust kennt das: `netfs::is_network`; Weg ins Frontend im Design festlegen, z. B. Feld in
  `DirectoryListing` → DTO-Vertrag beidseitig + Test). Lokale schnelle Ordner nie (kein Nutzen, nur Risiko).
- **Grenzen:** nach Gesamtzahl der Einträge (Vorschlag 200 000), LRU; keine Persistenz über einen Neustart. Archive
  (virtuelle Pfade) haben schon ihren eigenen Index-Cache in Rust – entscheiden, ob sie dazugehören (Empfehlung: nein).
- **Anzeige aus dem Cache:** `load()` schaut vor der Rust-Anfrage in den Cache; Treffer → sofort `showListing`
  (Cursor/Marken/Scroll wie bei einem normalen Load, Verlauf wie bei einer Navigation), danach Hintergrund-Refresh
  (E1), Ergebnis ersetzt den Eintrag. Der Tab-Cache aus 029 E5 entfällt (Tab-Wechsel nutzt denselben Weg).
- **Kennzeichnung:** solange das Listing aus dem Cache stammt und nicht bestätigt ist, zeigt die Statuszeile
  „Stand 10:05 · wird aktualisiert …“ (Zeit des Listings, Live-Region nur beim Wechsel, nicht bei jedem Tick); dezente
  Markierung der Liste (z. B. gedimmte Pfadzeile) – Design entscheidet, light/dark prüfen.
- **Invalidierung:** Job-Ereignis `dirsChanged` und Watcher-`rescan` markieren betroffene Einträge als unbestätigt;
  Watcher-Deltas (`changes`) werden auch auf Cache-Einträge nicht angezeigter Ordner angewendet, sofern überwacht.
  Eigene Operationen (F7, F2, Kopieren in den Ordner) dürfen den Eintrag gezielt nachführen, wenn das einfach und
  sicher geht – sonst „unbestätigt“ markieren (Entscheidung im Design).
- „Neu laden“ (Ctrl+R) liest immer frisch und wartet nie auf den Cache.

### B. Sicherheit: nichts Destruktives auf ungeprüftem Stand

Entscheidung im Design (Empfehlung: beides):
1. **Frontend:** Löschen (F8), Verschieben (F6), Umbenennen (F2, Multi-Rename), Gruppieren/Aufräumen sind deaktiviert,
   solange das Panel ein unbestätigtes Cache-Listing zeigt (Hinweis in der Statuszeile/Tooltip: „wird noch geprüft“).
   Kopieren *aus* dem Panel und Ansehen bleiben erlaubt (Rust liest die Quelle ohnehin neu).
2. **Rust (Verteidigung in der Tiefe):** Delete/Move/Rename-Jobs können je Eintrag den erwarteten Stand mitbekommen
   (`expect: { size, modifiedMs, kind }`, optional); weicht der echte Eintrag ab, wird gefragt (Konfliktdialog wie
   bei Kopieren) bzw. der Eintrag übersprungen und gemeldet – nie still gelöscht. DTO-Vertrag beidseitig, Tests mit
   `tempfile` (Datei zwischen Listing und Job ersetzt/vergrößert/zum Ordner geworden).

### C. Schnelleres Listing auf macOS (`getattrlistbulk`)

- Hinter `platform/` eine macOS-Implementierung des Listings mit `getattrlistbulk` (über `libc`, schon Abhängigkeit):
  Name, Typ, Größe, mtime, Flags (`UF_HIDDEN`) in Blöcken statt eines `stat` je Eintrag. Symlinks brauchen weiterhin
  ein `metadata` für das Ziel (nur für Links). Ergebnis muss **identisch** zu `listing::list_directory` sein
  (gleiche `DirEntryDto`, gleiche Sortierung, gleiche Behandlung nicht lesbarer Einträge, nicht-UTF-8-Namen).
- Rückfall auf den bisherigen Weg bei jedem Fehler von `getattrlistbulk` (z. B. Dateisystem ohne Unterstützung).
- Linux/Windows unverändert (Windows: `FindFirstFileEx` liefert die Attribute schon mit – `std` nutzt das; nur prüfen).
- Tests: auf macOS (`#[cfg(target_os = "macos")]`) Gleichheit mit dem alten Weg auf einem tempfile-Baum mit Umlauten,
  Emoji, versteckten Dateien, Symlinks (auch dangling, auf Ordner), nicht lesbarem Eintrag. Im Container nicht
  ausführbar → im Bericht nennen; Marc führt `cargo test` auf dem Mac aus.
- **Messung (bei Marc):** Ordner mit ~200 und ~2 000 Einträgen auf seiner SMB-Freigabe, alt vs. neu, je 3 Läufe kalt
  (nach erneutem Mounten) – Ergebnis in `docs/architecture.md` (Performance). Ein kleines Mess-Werkzeug (ignorierter
  Test oder `examples/`) bereitstellen, das beide Wege auf einem übergebenen Pfad misst.

### D. Ausdrücklich nicht: rekursives Vorladen

Unterordner auf Verdacht zu lesen belastet genau das Laufwerk, das schon langsam ist (oft während einer Kopie dorthin).
Nicht umsetzen. Falls im Design doch erwogen: höchstens eine Ebene, nur im Leerlauf, nie während ein Job auf dasselbe
Laufwerk schreibt, abbrechbar – und mit Messung, dass es nicht schadet.

## Testbarkeit

`FNF_TEST_SLOW` (029 E13) simuliert das langsame Laufwerk für Cache und Kennzeichnung im Container. Für „Netzlaufwerk“
ggf. den Testschalter erweitern (z. B. Präfix gilt auch als Netzlaufwerk) – nur Debug-Build.

## Akzeptanzkriterien

1. Mit `FNF_TEST_SLOW=<slow>:3000:…`: in einen langsamen Ordner, dann in einen Unterordner, dann `..` / Zurück → der
   Elternordner erscheint **sofort** mit Cursor auf dem Unterordner; Statuszeile zeigt „Stand … · wird aktualisiert“;
   nach ~3 s ist die Liste bestätigt (Hinweis weg), Änderungen von außen sind dann sichtbar.
2. Lokaler schneller Ordner: kein Cache-Eintrag, Verhalten wie vor 030.
3. Während ein Cache-Listing unbestätigt ist, sind F8/F6/F2/Multi-Rename deaktiviert (Palette, Buttons, Menü,
   Kontextmenü), Kopieren/Ansicht gehen.
4. Rust: ein Delete/Move/Rename mit veraltetem `expect` löscht/verschiebt nichts still (Tests).
5. Nach einer Kopie in den Ordner zeigt der Rückweg den neuen Eintrag spätestens nach dem Hintergrund-Refresh.
6. Speicher: Cache bleibt unter der Grenze (Test mit vielen großen Listings), geschlossene Tabs/alte Pfade fallen raus.
7. macOS: `getattrlistbulk`-Listing identisch zum alten (Test auf dem Mac), Messung dokumentiert.
8. `pnpm check` grün, Debug-Build, E2E unter Xvfb, Doku (architecture, roadmap, CLAUDE.md, Prompt-Index, TODO).

## Review-Schwerpunkte

- Veraltete Antworten: Cache-Anzeige, Hintergrund-Refresh, Navigation und Tab-Wechsel überholen sich nicht falsch
  (Request-Sequenzen; Cache-Eintrag nur aus der jeweils neuesten Antwort schreiben).
- Destruktives auf altem Stand: alle Wege (Tastatur, Palette, Menüs, Drag & Drop als Verschieben!) gesperrt bzw. in
  Rust abgefangen.
- `getattrlistbulk`: Puffer-Parsing (Längen, Ausrichtung, `ATTR_CMN_RETURNED_ATTRS`), Fehlerpfade, keine UB.
- Speichergrenze und LRU.

## Nicht in diesem Prompt

- Persistenter Cache über Neustarts.
- Rekursives Vorladen (s. D).
- SMB-spezifische Einstellungen des Systems (Mount-Optionen, `nsmb.conf`) – höchstens als Hinweis in die Doku.
