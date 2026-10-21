# Prompt 033: Speicherbelegung – große Platzverbraucher finden und entfernen

> **Slug:** `speicherbelegung` · **Braucht:** 003 (Ordnergröße `dirsize.rs`, Navigation), 004 (Tabs/Seiten),
> 005 (Job-Engine), 006 (Löschen mit Papierkorb, Gefahrenprüfung), 009 (Ergebnis-Tabs als Muster), 010
> (Schnellvorschau im Ziel-Panel als Muster), 011 (Laufwerke), 013/019 (Farbschemata), 015 (Einstellungen, i18n),
> 030 (`expected` beim Löschen) · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/009-suche.design.md` (Ergebnis-Tabs, Treffer
> streamen), `prompts/done/010-vorschau-eigenschaften.design.md` (Schnellvorschau im Ziel-Panel),
> `prompts/done/016-archive-duplikate.design.md` (Duplikate: Ergebnis → markieren → löschen) und
> `prompts/done/030-ordner-cache-smb.design.md` (E5 `expected`). Auftrag von Marc (21.10.2026). Neu – weder die
> alte Version noch mr hatten das; in `docs/feature-parity.md` unter A.4 „Nur neu“ eintragen.

## Auftrag (wörtlich)

> baue bitte eine Funktion, die (wenn man einen oder mehrere Ordner selektiert hat, oder die vom '/' ausgeht) die
> Festplattenbelegung anzeigt. man soll dann in Unterverzeichnisse navigieren können (innerhalb dieser Anzeige) und
> dort wieder die Darstellung nach Belegung sehen. Ziel ist das Auffinden von großen Verbrauchern an Platz, um sie
> leicht löschen zu können (auch in dieser Anzeige). Vorlagen:
> https://www.111tipps.de/wp-content/uploads/2020/01/Linux_038.jpg,
> https://www.insanelymac.com/blog/wp-content/uploads/2025/07/disk-drill-cleanup-scaled.jpg . siehe auch
> https://www.insanelymac.com/blog/de/best-disk-space-analyzers-mac/

## Vorlagen – was wir daraus übernehmen

- **Baobab** („Festplattenbelegung analysieren“, Linux, erstes Bild): links eine Liste/Baum *Ordner · Größe · Inhalt
  (Objekte) · Geändert*, absteigend nach Größe; rechts ein **Ringdiagramm (Sunburst)** – Mitte = aktueller Ordner mit
  Gesamtgröße, jeder Ring eine Ebene tiefer, Winkel ∝ Größe; Umschalter Ring/Kacheln (Treemap) unten. Nicht lesbare
  Ordner rot/ohne Größe (`.dbus`).
- **Disk Drill / „Clean Up“** (macOS, zweites Bild): Kacheln, Größe = Fläche, Farbe nach Gewicht (groß = orange/rot,
  klein = grün); Brotkrumen *Macintosh HD › Applications*; rechts Kopf mit Name, „19,2 GB / 735 items“ und Liste
  nach Größe mit `›` zum Hineinnavigieren; Reiter **Everything / Heavy Files** (größte Dateien im ganzen Baum);
  unten ein **Sammelkorb** („Drop unneeded files and folders into this caddy“ + „Remove“).
- Aus dem Artikel (DaisyDisk, GrandPerspective, OmniDiskSweeper, Disk Inventory X …): Ergebnisse erscheinen schon
  **während** des Scans; Anteil, der nicht erfasst werden konnte („versteckt“/kein Zugriff), wird ausgewiesen;
  Löschen erst nach Sammeln und Bestätigen.

## Ziel

Aus der Dateiliste heraus wird für markierte Ordner, den Ordner unter dem Cursor oder die Wurzel des Laufwerks
(`/`, unter Windows `C:\` usw.) die Belegung ermittelt und angezeigt: Liste nach Größe **und** Diagramm, in dem man
per Maus und Tastatur in Unterordner hinein- und wieder herausnavigiert. Große Verbraucher lassen sich direkt dort in
einen Sammelkorb legen und in den Papierkorb (oder endgültig) löschen – sicher, als Job, mit derselben Gefahrenprüfung
wie F8. Der Scan läuft als abbrechbarer Job, bleibt in Rust und wird nur ebenenweise ans Frontend geliefert.

## Bestand

- `src-tauri/src/dirsize.rs` (003 E7): iterativ, folgt keinen Symlinks, bleibt auf dem Gerät (`device_of`), zählt
  unlesbare Ordner, abbrechbar, Fortschritt per Callback; summiert **nur** `len()` (logische Größe), kein Baum, keine
  Hardlink-Erkennung. Job-Art `DirSize { path }`, Leertaste/`CALC_DIR_SIZES`.
- Job-Engine (005): `JobSpec` in `jobs/mod.rs`, `manager.rs` (`validate`, `run`), `report.rs` (Drosselung),
  Abbruch/Pause; Löschen `Delete { paths, mode, allow_dangerous, expected }` mit `paths::DangerCheck`.
- Ergebnis-Tabs (009/016): `SearchStore` mit `ResultKind = 'search' | 'duplicates'`, `FilePanel.showSearch` – Muster
  für eine weitere Tab-Art ohne echtes Verzeichnis. Duplikate (016) zeigen schon „Ergebnis → Auswahlhilfen →
  Löschen“.
- Schnellvorschau (010): Inhalt in der **anderen** Seite, folgt dem Cursor – Muster für „Liste links, Diagramm
  rechts“.
- Laufwerke im Ordnermenü (011, `VolumesStore`, `platform/volumes.rs`), Farbschemata/Tokens (013/019, Rezept
  `CLAUDE.md` §9), `ListingCache`/`expectedFor` (030).
- GuiExpert Table: prüfen, ob/wie sie Baumzeilen kann (im Bundle gibt es `rowgroup/`, `TreeRow`-Spuren) – Referenz
  ist das Mono-Repo (`CLAUDE.md` §5), nicht raten.

## Aufgaben

1. **Scan als Job `diskUsage`** (Rust, reines Modul `disk_usage/` ohne Tauri):
   - Eingabe: eine oder mehrere Wurzeln (markierte Ordner; ohne Markierung der Ordner unter dem Cursor bzw. der
     aktuelle Ordner; oder „Laufwerk“ = Wurzel des Volumes des aktiven Panels). Verschachtelte Wurzeln
     zusammenfassen (eine in der anderen → nur die äußere). Mehrere Wurzeln = virtuelle Wurzel „Auswahl“.
   - Baum im Speicher von Rust: je Ordner Größe (logisch **und** belegt: `st_blocks*512` bzw.
     `GetCompressedFileSizeW`/Cluster), Anzahl Dateien/Ordner, jüngste Änderung, Status (ok / teilweise / nicht
     lesbar). Dateien nicht einzeln für den ganzen Baum halten, sondern je Ordner die *N* größten + Rest als
     Sammelposten („n kleinere Dateien“) – Speicherbedarf für 1–5 Mio. Einträge im Design abschätzen und begrenzen.
   - **Hardlinks** einmal zählen (Gerät + Inode, unter Windows Datei-Index), **Symlinks nie folgen** (als Eintrag
     mit Größe des Links), Zyklen unmöglich machen, unlesbare Ordner zählen und markieren.
   - **Dateisystemgrenzen**: Standard „nicht überschreiten“ (`/proc`, `/sys`, Netz- und Wechsellaufwerke, Time
     Machine). **macOS-Sonderfall untersuchen:** `/` (System-Volume, read-only) und `/System/Volumes/Data` sind über
     Firmlinks verbunden (`/Users`, `/Applications` …) – eine naive Geräteprüfung schneidet dort die Nutzerdaten ab,
     eine naive Rekursion zählt sie doppelt. Lösung im Design belegen (Firmlink-Liste
     `/usr/share/firmlinks`, `ATTR_CMNEXT_*`/`getattrlist`, oder Scan des Data-Volumes mit Pfad-Abbildung).
   - Fortschritt gedrosselt (Dateien, Bytes, aktueller Ordner – Pfad nicht loggen); **Teilergebnisse** während des
     Scans abrufbar (obere Ebenen wachsen sichtbar). Abbruch → was erfasst ist, bleibt anzeigbar („unvollständig“).
   - Abschluss: Volume-Daten (gesamt/frei per `statvfs`/`GetDiskFreeSpaceExW`) und „nicht erfasst“ = belegt − gescannt
     (bei Laufwerks-Scan), damit sichtbar wird, wie viel hinter fehlenden Rechten/Snapshots/purgeable steckt.
   - Parallelität: Einzel-Thread vs. parallel (eigene Worker oder Crate wie `jwalk`) **messen** (SSD, Home-Ordner,
     SMB) und begründet entscheiden; neue Crate nur mit Eintrag in `docs/architecture.md`. (030 hat
     `getattrlistbulk` gemessen und verworfen – Ergebnis berücksichtigen.)
2. **Abfrage-Commands** (async, dünn): `disk_usage_children(scanId, path, limit)` → Kinder eines Knotens nach Größe,
   mit Sammelposten unterhalb einer Mindestgröße; `disk_usage_largest_files(scanId, path, limit)` („Heavy Files“
   über den Teilbaum); `disk_usage_release(scanId)`. Scans im Speicher begrenzen (LRU, max. 2–3), Freigabe beim
   Schließen der Ansicht. DTOs in `model.rs` ↔ TS synchron, Fehlercodes in `describeFsError()`.
3. **Ansicht „Belegung“** (Entscheidung E1): Liste (GuiExpert Table, Spalten Name · Größe · Anteil mit Balken ·
   Inhalt · Geändert, absteigend nach Größe, Renderer ohne Angular) + Diagramm. Brotkrumen ab der Scan-Wurzel,
   Kopf mit Name, Größe, Objekten, Scan-Zeitpunkt, ggf. „unvollständig“/„n nicht lesbar“, Laufwerksbalken
   belegt/frei/nicht erfasst.
4. **Navigation in der Ansicht**: Enter/Doppelklick bzw. Klick aufs Segment = hinein, Backspace/Klick auf die Mitte
   bzw. Brotkrume = hinaus, Zurück/Vor; Cursor in der Liste und Hervorhebung im Diagramm sind gekoppelt (beide
   Richtungen, Hover zeigt Tooltip mit Pfad/Größe/Anteil). Reiter/Umschalter „Alles“ / „Größte Dateien“.
   „Im Panel öffnen“ (Ordner bzw. Datei im Panel zeigen, verlässt die Ansicht nicht zwingend), „Im Finder/Explorer
   zeigen“ (011), Pfad kopieren, Teilbaum neu scannen.
5. **Diagramm** (Entscheidung E2), selbst gezeichnet (SVG oder Canvas, keine UI-/Chart-Frameworks): Layout als
   **reine Funktionen** (Sunburst: Winkel ∝ Größe, Mindestwinkel → Sammelsegment, max. Ringtiefe; Treemap:
   squarified, Fläche ∝ Größe), Farben aus **Tokens** (neue Tokens nach `CLAUDE.md` §9, alle drei eingebauten
   Schemata, Defaults für die alten Designs, Kontrast für Beschriftungen), Größen-/Typ-Farbskala im Design
   festlegen. Nicht lesbare Ordner und Sammelposten unterscheidbar (nicht nur über Farbe). Beschriftung nur, wo
   Platz ist. 60 fps beim Hineinnavigieren nicht nötig, aber kein Ruckeln bei 1000 Segmenten; Animation abschaltbar
   (`prefers-reduced-motion`).
6. **Entfernen** (Entscheidung E3): Einträge per Taste/Kontextmenü/Ziehen in einen **Sammelkorb** legen (Summe
   sichtbar, einzeln wieder herausnehmen, verschachtelte Einträge zusammenfassen), „Entfernen…“ öffnet den
   bestehenden Löschdialog (Papierkorb Standard, endgültig wie bei F8/Shift) und startet **einen** Job `Delete` mit
   `expected` aus dem Scan (Größe/mtime – der Scan ist ein alter Stand, 030 E5) und `DangerCheck` (Wurzel, Home,
   Systemordner, App-Bundles unter `/Applications`/`/System` mit zusätzlicher Warnung). F8/Entf direkt in der Ansicht
   = gleicher Weg für den Eintrag unter dem Cursor. Nach dem Job: gelöschte Knoten aus dem Baum entfernen und Summen
   bis zur Wurzel korrigieren (kein Voll-Scan), Übersprungenes/Fehler aus dem Job-Protokoll anzeigen; Panels frischen
   über `dirsChanged` auf.
7. **Einstiege**: Aktion (Id im Design, z. B. `OPEN_DISK_USAGE`) mit Kürzel je OS (gegen alle Keymaps geprüft),
   Befehlspalette, Menü (Befehle/Werkzeuge), Kontextmenü auf Ordnern, Eintrag „Belegung analysieren“ je Laufwerk im
   Ordnermenü (011). Gesperrt in Archiven (virtuelle Pfade) und im Ergebnis-Tab; auf Netzlaufwerken mit Hinweis
   „langsam“, aber erlaubt.
8. **Einstellungen** (015, Schema in Rust + TS): Größe logisch/belegt, Dateisystemgrenzen überschreiten ja/nein,
   versteckte Einträge zählen (Standard ja – der Platz ist belegt), Diagrammart, Ringtiefe, Mindestanteil für
   Segmente, Anzahl „Größte Dateien“. Texte en/de.

## Entscheidungsfragen (im Design mit Optionen, Empfehlung, Begründung)

- **E1 Wo lebt die Ansicht?** (a) eigene Tab-Art „Belegung“ im aktiven Panel (Liste) + Diagramm in der anderen Seite
  wie die Schnellvorschau; (b) Tab-Art mit Liste und Diagramm nebeneinander in *einer* Seite (wie Baobab); (c) großer
  Dialog/Vollbild-Overlay; (d) eigenes Fenster. Kriterien: Dual-Pane-Gefühl, Platz fürs Diagramm, Sitzung/Tabs
  (Scan nach Neustart weg → Tab mit „neu scannen“?), Tastaturfokus, Aufwand. Mit ASCII-Skizze je Variante.
- **E2 Diagrammart:** Sunburst, Treemap oder beide umschaltbar (Baobab hat beides). Empfehlung begründen; eine Art
  muss vollständig per Tastatur und Screenreader nutzbar sein (die Liste ist die zugängliche Alternative, das
  Diagramm `role="img"` mit Beschreibung bzw. `group` mit fokussierbaren Segmenten?).
- **E3 Löschen:** nur Sammelkorb, nur direkt oder beides; was passiert mit Einträgen, deren Größe/mtime seit dem Scan
  abweicht (`expected` → überspringen und melden).
- **E4 Datenhaltung:** ganzer Baum in Rust + ebenenweise Abfrage (Vorschlag) vs. alles ans Frontend; Grenzen für
  Speicher und Anzahl gleichzeitiger Scans; Teilergebnisse während des Scans.
- **E5 „Laufwerk“ als Startpunkt:** Wurzel des Volumes des aktiven Panels vs. Auswahl aus den Laufwerken; macOS
  Firmlinks (s. Aufgabe 1), Windows alle Laufwerke nacheinander?
- **E6 Belegt vs. logisch** als Standard (APFS-Klone und Kompression lassen sich nicht immer korrekt zuordnen – was
  zeigen wir und wie erklären wir Abweichungen zu Finder/Explorer?).
- **E7 Verhältnis zu `dirsize.rs`:** gemeinsamer Walker (DirSize wird ein Sonderfall) oder getrennt lassen.

## Akzeptanzkriterien

1. Zwei Ordner markiert → Aktion → Ansicht mit virtueller Wurzel „Auswahl“, deren Größe = Summe beider; ohne
   Markierung wird der Ordner unter dem Cursor gescannt; aus dem Laufwerksmenü die ganze Wurzel (`/`).
2. Während des Scans wachsen Liste und Diagramm sichtbar, Fortschritt in der Task-Liste; Abbruch lässt ein als
   „unvollständig“ gekennzeichnetes Ergebnis stehen.
3. Liste absteigend nach Größe mit Anteil-Balken; Diagramm zeigt dieselben Proportionen (Summe der Segmente =
   Größe des Knotens, Sammelsegment für Kleines).
4. Enter/Klick auf einen Unterordner (Liste oder Segment) navigiert hinein, Backspace/Mitte/Brotkrume hinaus;
   Cursor und Hervorhebung bleiben gekoppelt; alles ohne Maus bedienbar.
5. „Größte Dateien“ listet die größten Dateien des aktuellen Teilbaums mit Pfad relativ zur Scan-Wurzel.
6. Ein großer Ordner wandert in den Sammelkorb, „Entfernen…“ → Bestätigung → Papierkorb; danach sind Baum, Summen
   und Diagramm ohne Neu-Scan korrekt, das Panel zeigt den Ordner nicht mehr.
7. Wurde eine Datei nach dem Scan geändert, wird sie beim Entfernen übersprungen und gemeldet.
8. Hardlink-Paar zählt einmal, Symlink auf einen großen Ordner zählt nicht dessen Inhalt, nicht lesbarer Ordner
   erscheint markiert und in „n nicht lesbar“.
9. Home-Ordner/Wurzel in den Sammelkorb → Löschen wird abgelehnt (bzw. nur mit der doppelten Bestätigung wie F8).
10. In einem ZIP-Ordner und im Such-Ergebnis-Tab ist die Aktion gesperrt (Hinweis).
11. Light, dark, `crimson` und mindestens zwei alte Designs (z. B. `classic-norton`, `classic-paper`) sehen lesbar
    aus; deutsch/englisch vollständig.

## Tests

- **Rust** (`tempfile`): Summen logisch/belegt, Sparse-Datei (belegt < logisch, Linux), Hardlinks einmal, Symlinks
  (auf Datei, auf Ordner, dangling, Zyklus), unlesbarer Ordner (ohne root), Dateisystemgrenze (bedingt), Unicode/
  Leerzeichen/Emoji/nicht-UTF-8 (Linux), verschachtelte Wurzeln, Abbruch mit Teilergebnis, Top-N-Dateien und
  Sammelposten, Kinderabfrage sortiert/limitiert, Baum nach Löschen korrigieren, LRU/Freigabe, Speichergrenze,
  Wire-Format der DTOs; Leistung: generierter Baum mit ≥ 200 000 Einträgen (Zeit im Design notieren, Release-Build).
- **Frontend** (Vitest): Layout-Funktionen (Sunburst-Winkel summieren sich, Mindestwinkel, Tiefe; Treemap-Flächen
  proportional, keine Überlappung, stabile Reihenfolge), Farbskala/Kontrast, Store (Scan starten, Teilergebnisse,
  Navigation/Verlauf, Cursor ↔ Hervorhebung, Sammelkorb inkl. Verschachtelung, Löschjob mit `expected`, Korrektur
  nach Job), Sperren (Archiv, Ergebnis-Tab), Komponenten (Laden, leer, Fehler, unvollständig, Tastatur), Texte en/de
  (`catalogs.spec.ts`).
- **E2E** unter Xvfb: Akzeptanzkriterien mit einem Testbaum (groß/klein, Umlaute, Emoji, versteckt, Symlink,
  Hardlink, gesperrter Ordner); Screenshots der Ansicht in light/dark für den Bericht und eine neue Szene in
  `scripts/screenshots/scenes.json` (Mock-Backend um `diskUsage` erweitern). macOS (Firmlinks, APFS) und Windows
  (Laufwerke, belegte Größe) bei Marc bzw. in der CI.
- **Review** durch einen separaten Agenten, Schwerpunkte: Löschen aus einem veralteten Scan (`expected`,
  `DangerCheck`, Sammelkorb mit verschachtelten Pfaden), Symlink-/Hardlink-/Grenzfälle im Walker, Speicherverbrauch
  bei sehr großen Bäumen, keine Pfade in Logs, Dateinamen nie unescaped im SVG/HTML.

## Nicht im Umfang

- Scannen mit erhöhten Rechten (sudo/UAC), Snapshots/Time-Machine-Inhalte aufschlüsseln, „purgeable“ freigeben.
- Dauerhafte Speicherung von Scans über einen Neustart (höchstens im Design als Folgeidee).
- Automatische Aufräum-Vorschläge (Caches, Logs, alte Downloads) – Folgeidee, falls gewünscht.
