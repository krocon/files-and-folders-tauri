# Prompt 046: Bedingt markieren – „Select if…“

> **Slug:** `select-if` · **Braucht:** 001 (Dateiliste, `FileListController`), 002 (Aktionssystem, Keymaps,
> `MarkPatternDialog`, `pattern.ts`), 014/020 (Menüleiste, Kontextmenü, Actions-Menü), 015 (Einstellungen, i18n,
> Export/Import), 022 (`FileTypesStore`), 027 (`dialogs.recent`), 038 (Flache Ansicht: `SearchHit.dir`) · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/002-aktionen-tastatur.design.md` (Markierung),
> `prompts/done/022-konfig-editoren.design.md` (E4–E7: Dateityp-Kategorien) und
> `prompts/done/027-persistenz-je-ordner.design.md` (E5: `dialogs.recent`). Neu – weder die alte Version noch mr hatten
> eine regel-/beziehungsbasierte Markierung; in `docs/feature-parity.md` unter A.4 „Nur neu“ eintragen.
> Vorlage / Beispiel aus Marcs Ordner (31.10.2026): [`046-select-if-beispiel.jpg`](046-select-if-beispiel.jpg).

## Auftrag & Leitbeispiel

Der Nutzer öffnet einen Dialog **„Select if…“** und beschreibt über Vorlagen oder kombinierbare Bedingungen, welche
Einträge der aktuellen Liste markiert werden sollen – insbesondere abhängig von **Begleitdateien (Sidecars)** im selben
Ordner und optional **inklusive** dieser Begleitdateien.

Konkretes Leitbeispiel aus [`046-select-if-beispiel.jpg`](046-select-if-beispiel.jpg) (31 Dateien, 4 Ordner):

- **Markiert (18 Dateien, 71 GB):** 9 Paare aus Film (`.mkv`) und zugehörigem Cover-Bild (`.jpg`) mit identischem
  Basisnamen, z. B. `By Any Means (2026).mkv` + `By Any Means (2026).jpg`, `Coup (2019).mkv` + `Coup (2019).jpg`,
  `Die Hoelle der roten Berge - Red Mountain (1951).mkv` + `.jpg`, `Real Genius (1985).mkv` + `.jpg` …
- **Nicht markiert:**
  - `Meine Schwester und ich (2005).mkv` (2,2 GB) – ist zwar ein Film, hat aber **kein** Cover-Bild;
  - `mainboard_1.webp` (66 KB) – ist zwar ein Bild, gehört aber zu **keinem** Film;
  - alle `.pdf`-Dokumente sowie die 4 Unterordner.

Dasselbe generische Prinzip löst ohne Sonderfälle auch die Gegenrichtung und verwandte Workflows:
*„Alle Filme **ohne** Cover-Bild“* (was muss noch gepflegt werden?), *„Verwaiste Cover/Untertitel/`.xmp`-Sidecars ohne
Hauptdatei“*, *„RAW-Fotos ohne zugehöriges `.jpg`“* (nach dem Aussortieren der JPEGs), *„Filme mit `.srt`-Untertitel
(inkl. `.de.srt`)“*, *„Dateien > 100 MB, die im anderen Panel noch fehlen“* oder *„Leere Dateien (0 Byte)“*.

## Abgrenzung zum Bestehenden

- **`OPEN_MARK_PATTERN_DLG` / `OPEN_UNMARK_PATTERN_DLG`** (`Num+` / `Num−`, 002) bleibt der schnelle Einzeiler für ein
  einzelnes Glob-/Regex-Muster auf dem Dateinamen allein.
- **`COMPARE_DIRS`** (`Shift+F2`, 036) bleibt der Ein-Tasten-Schnellvergleich zweier Ordner.
- **`OPEN_SELECT_IF_DLG` („Select if…“)** arbeitet wie `Num+` **rein im Speicher** auf den aktuell angezeigten
  Einträgen (`list.displayedEntries()`, ohne Dateisystem-I/O) und ergänzt **Beziehungen zwischen Einträgen**
  (Begleitdatei im selben Ordner, Gegenstück im anderen Panel), **Eigenschaftsfilter** (Dateityp-Kategorie, Muster,
  Größe, Änderungsdatum/Alter), **Mitmarkieren gefundener Begleitdateien** sowie **Mengen-Modi**
  (Ersetzen / Hinzufügen / Entfernen / Einschränken).
- Funktioniert überall, wo Einträge markierbar sind: normale Ordner, **Flache Ansicht** (038), **Suchergebnisse** (009),
  **Archive** (016/025), **Serverordner** (`remote://`, 034) und ungeprüfte Cache-Listings (030 – Markieren ändert
  nichts auf der Platte, gehört also **nicht** in `OFF_WHILE_UNCHECKED`).

## Aufgaben

1. **Bestand prüfen** (Phase 1, Design `046-select-if.design.md` 🛑): `MarkPatternDialog` und `compilePattern`
   (`features/actions/pattern.ts`), `FileTypesStore` und `file-types-logic.ts` (022), `FileListController` und
   `FileBrowserStore.setMarked`/`clearMarks`/`markedEntries`, `stemLength` (`features/ops/ops-logic.ts`),
   `SearchHit.dir`/`relDir` (`features/flat/flat-logic.ts`), `dialogs.recent` (`shared/dialog-memory.ts`) und
   `search.templates` (`settings-schema.json`, `settings.rs`) als Vorbild für eigene Vorlagen.
2. **Generisches Regelmodell & reine Auswertungs-Engine (`features/selectif/select-if-engine.ts`):**
   - Synthetische Zeilen (`isParentRow` für `..`, `isVirtualPath` für Aggregate aus 033) sind **nie** Kandidaten und
     **nie** Begleitdateien.
   - **Baustein `MatcherSpec`** (wiederverwendet für Kandidaten **und** Begleitdateien):
     - `any` (alle Einträge der gewählten Art),
     - `category` (Kategorie-Name aus `FileTypesStore`, z. B. `movies`, `images`, `audio`, `documents`, `code` sowie
       eigene Kategorien des Nutzers aus `filetypes.json`; existiert eine gespeicherte Kategorie nicht mehr, meldet die
       Validierung das klar, statt still alles oder nichts zu treffen),
     - `glob` (Platzhalter-Syntax aus `pattern.ts`, inkl. Leerzeichen-ODER, `a|b` und `-ausschluss`),
     - `regex` (regulärer Ausdruck, Syntaxfehler sauber als Validierungsfehler ausweisen).
   - **1. Kandidaten („Prüfe“):**
     - Eintragsart: `files` (Default, inkl. Symlinks mit `targetKind === 'file'`), `dirs` (`isNavigableDir`), `both`.
     - Kandidaten-Filter: `MatcherSpec` (z. B. Kategorie `movies`).
   - **2. Bedingungen („Wenn…“, 1 bis `MAX_CONDITIONS = 8`)** mit Verknüpfung `all` (**UND**, Default) oder `any`
     (**ODER**):
     - **`companion` – Begleitdatei / Partner-Eintrag im selben Ordner** *(Standard-Bedingung)*:
       - Operator: `exists` (*hat Begleitdatei*) | `missing` (*hat keine Begleitdatei*).
       - Partner-Art (`files` Default | `dirs` | `both`) + Partner-Filter (`MatcherSpec`, Default Kategorie `images`).
       - Ein Eintrag ist **nie** seine eigene Begleitdatei (`partner.path !== candidate.path` – dadurch findet z. B.
         *„Bilder mit Begleitdatei Bilder“* gezielt Bilder, die in mehreren Formaten wie `.png` + `.webp` vorliegen).
       - **Basisnamen-Zuordnung (`stemMatch`):**
         - `exact` (*gleicher Basisname ohne letzte Endung*, Default: `Film (2026).mkv` ↔ `Film (2026).jpg`, bestimmt
           über `stemLength`; Dotfiles wie `.gitignore` behalten ihren vollen Namen).
         - `prefix` (*Basisname oder Basisname + Trenner `.`, `-`, `_`*: findet zusätzlich `Film (2026).de.srt`,
           `Film (2026)-poster.jpg`, `user.component.ts` ↔ `user.component.spec.ts`, ohne dass `Coup.mkv` fälschlich
           auf `Couples.jpg` passt).
         - Vergleich immer **Unicode-NFC-normalisiert** (`.normalize('NFC')` – wichtig auf macOS wegen NFD/NFC bei
           Umlauten wie `Die Hölle…`) und ohne Groß-/Kleinschreibung.
       - **Ordner-Grenze:** In Flacher Ansicht (038) und Suchergebnissen (009) paaren sich nur Einträge mit demselben
         Elternordner (`SearchHit.dir`, im normalen Ordner für alle Einträge identisch).
       - **`includeCompanions: boolean`** (nur bei `exists`): Markiert zu jedem Kandidaten, der **die gesamte Regel**
         erfüllt, auch die passenden Begleitdateien dieser Bedingung. **Wichtig:** Scheitert ein Kandidat an einer
         weiteren `UND`-Bedingung (z. B. Mindestgröße), dürfen seine Begleitdateien aus Bedingung 1 **nicht** markiert
         werden; bei `ODER` werden nur Begleitdateien erfüllter Teilbedingungen mitgenommen.
     - **`otherPanel` – Abgleich mit der anderen Seite:**
       - Prüft gegen die Einträge des gegenüberliegenden Panels (`ws.otherPanel()`, ohne `..`/virtuelle Zeilen).
       - Operator: `exists` (*existiert im anderen Panel*) | `missing` (*fehlt im anderen Panel*).
       - Vergleich nach: `sameName` (Name + Endung, Default), `sameStem` (gleicher Basisname ohne Endung),
         `sameNameAndSize` (Name + Größe gleich), `newer` / `older` (gleicher Name, `modifiedMs` größer/kleiner).
     - **`size` – Größe:**
       - Operatoren: `gt` (`>`), `lt` (`<`), `between` (`zwischen`), `empty` (`= 0 Byte`). Einheiten `B`, `KB`, `MB`,
         `GB`. Für Dateien `entry.size`, für Ordner eine bereits berechnete Größe aus `dirSizes` (sonst `null` → kein
         Treffer).
     - **`modified` – Änderungsdatum / Alter:**
       - Operatoren: `withinLast` (innerhalb der letzten `N` Stunden/Tagen, relativ zu einem injizierbaren `nowMs` für
         deterministische Tests), `olderThan` (älter als `N` Stunden/Tagen), `after` / `before` / `between`
         (Kalenderdatum). `modifiedMs === null` trifft nie zu.
     - **`name` – Zusätzliches Namensmuster:**
       - Operatoren: `matches` (*passt auf*) | `notMatches` (*passt nicht auf*) mit `glob` oder `regex` (z. B.
         `-*sample* -*trailer*` oder `\(19\d\d\)`).
   - **3. Wirkung auf die bestehende Markierung (`combineMode`):**
     - `replace` (**Ersetzen**, Default: `H`),
     - `add` (**Hinzufügen**, `M ∪ H`),
     - `remove` (**Entfernen**, `M \ H`),
     - `intersect` (**Einschränken**, `M ∩ H` – Bedingungen wie Begleitdateien prüfen weiterhin gegen alle
       `displayedEntries()` des Ordners; erst die Treffermenge `H` wird mit der bestehenden Markierung `M` geschnitten).
   - **Komplexität:** `exact`-Companion und `otherPanel` über vorberechnete Hash-Maps in **`O(N)`**; `prefix`-Companion
     über sortierte Basisnamen + Binärsuche je Ordner in **`O(N log N)`** (kein `O(N²)`-Vergleich, damit 50 000 Zeilen
     in der Flachen Ansicht verzögerungsfrei live ausgewertet werden).
3. **Vorlagen (eingebaut & eigene) + Dialog-Gedächtnis:**
   - **Eingebaute Schnellvorlagen** (ein Klick füllt Kandidaten, Bedingungen und Optionen):
     1. *Filme mit Cover-Bild (inkl. Cover)* – `movies` + `companion: exists (images, exact, includeCompanions: true)`
     2. *Filme ohne Cover-Bild* – `movies` + `companion: missing (images, exact)`
     3. *Filme mit Untertiteln (inkl. Untertitel)* – `movies` + `companion: exists (*.srt *.sub *.idx *.ass *.ssa *.vtt, prefix, includeCompanions: true)`
     4. *Verwaiste Bilder ohne Film* – `images` + `companion: missing (movies, exact)`
     5. *RAW-Fotos ohne JPEG* – `*.arw *.cr2 *.cr3 *.nef *.dng *.raf *.orf *.rw2` + `companion: missing (*.jpg *.jpeg, exact)`
     6. *Fehlt im anderen Panel* – `any` (`files`) + `otherPanel: missing (sameName)`
     7. *Leere Dateien (0 Byte)* – `any` (`files`) + `size: empty`
   - **Eigene Vorlagen speichern / überschreiben / löschen** (analog `search.templates` aus 022 E8): neuer Schlüssel
     `selectIf.templates` in `src/app/core/settings/settings-schema.json` (mit sinnvollen Grenzen `maxItems`/`maxBytes`
     und `sanitize` beim Laden; dadurch automatisch im Einstellungs-Bündel Export/Import enthalten).
   - **Letzte Eingaben merken:** `'selectIf'` in `RememberedDialog` (`shared/dialog-memory.ts`; `maxItems` von
     `dialogs.recent` in `settings-schema.json` prüfen und ggf. von 8 auf 12 anheben, damit kein bestehender Dialog aus
     dem Gedächtnis fällt).
4. **Dialog `SelectIfDialog` (`features/selectif/`):**
   - Modal über `DialogService` (`DialogKind` `'select-if'`), `<app-modal>` mit Fokusfalle und Fokus-Rückgabe.
   - Übersichtlich und satzartig gegliedert:
     - Vorlagen-Leiste (eingebaute + eigene Vorlagen, „Vorlage speichern…“, eigene löschen);
     - Abschnitt **„Prüfe“** (Art + `MatcherSpec`);
     - Abschnitt **„Wenn“** (Bedingungszeilen mit `+ Bedingung`, `×` Entfernen, ab 2 Zeilen `Alle (UND)` /
       `Mindestens eine (ODER)`); bei `companion` mit `exists` direkt die Checkbox *„Gefundene Begleitdateien
       mitmarkieren“* sowie *„Basisname: Exakt / Präfix“*;
     - Abschnitt **„Wirkung“** (`Ersetzen` / `Hinzufügen` / `Entfernen` / `Einschränken`);
     - **Live-Zusammenfassung (`aria-live="polite"`):** zeigt sofort die Auswirkung, getrennt nach Haupt- und
       Begleitdateien sowie Gesamtgröße, z. B. *„18 von 35 Einträgen werden markiert (9 Hauptdateien + 9
       Begleitdateien · 71 GB)“*;
     - **Kompakte Vorschau** (aufklappbar oder direkt integriert, im Design entscheiden): zeigt die getroffenen Zeilen
       mit Kennzeichnung (*Hauptdatei* vs. *Begleitdatei*) und optionalem Schalter *„Nicht zutreffende Kandidaten
       zeigen“* (zeigt z. B. `Meine Schwester und ich (2005).mkv` als ausgeschlossen).
   - `Strg/⌘+Enter` (bzw. primärer Button) übernimmt das berechnete Markierungs-Set auf das aktive Panel und schließt
     den Dialog; `Esc` schließt ohne Änderung. Styling ausschließlich über Tokens aus `src/styles.css` (light & dark).
5. **Aktion, Kürzel, Menüs & i18n:**
   - Neue Aktion `OPEN_SELECT_IF_DLG` (`category: 'selection'`, `availableIn: '046'`) in `action-catalog.ts` /
     `action-catalog.de.ts` und `actions-texts.ts`. Bezeichnung so wählen, dass **„Select if“** in der Befehlspalette
     auf Englisch **und** Deutsch gefunden wird (s. Entscheidungsfragen).
   - Freies Tastenkürzel in `macos.json`, `windows.json`, `linux.json` vergeben (Vorschlag `Mod+Alt+S` / `⌘⌥S`, ggf.
     zusätzlich `Shift+NumpadAdd` – vorab auf Konflikte testen).
   - Einhängen in: Menüleiste (`Bearbeiten` unter `OPEN_UNMARK_PATTERN_DLG`), Actions-Menü ▴ (Spalte 2 unter
     `OPEN_UNMARK_PATTERN_DLG`), Kontextmenü (`empty` und `marked`), Befehlspalette.
   - Alle Texte zweisprachig (`select-if-texts.ts` + `.de.ts`), Katalog-Vollständigkeitstest grün.
6. **Doku:** `docs/feature-parity.md` (A.4 „Nur neu“), `docs/architecture.md`, `docs/roadmap.md`, `README.md`
   (Tastenkürzel & Feature-Übersicht), `prompts/README.md`.

## Entscheidungsfragen fürs Design (Phase 1 🛑)

- **Benennung de/en:** Englisch `Select if…`; Deutsch `Markieren, wenn…` oder `Bedingt markieren (Select if)…`?
  (Empfehlung mit Blick auf Kürze in Menüs und Auffindbarkeit unter `Select if` in der Befehlspalette.)
- **Startzustand beim allerersten Öffnen** (wenn `dialogs.recent` noch leer ist): mit Vorlage 1 (*Filme mit Cover-Bild*)
  starten oder kontextsensitiv vom Eintrag unter dem Cursor ableiten (z. B. Cursor auf einer Videodatei → Kategorie
  `movies`, sonst `Alle Dateien` + leere/Standard-Begleitbedingung)?
- **Vorschau im Dialog:** immer sichtbar (mit fester Maximalhöhe / `shared/preview-grid/`) oder per Details-Schalter
  aufklappbar, damit der Dialog kompakt wie `MarkPatternDialog` bleibt?
- **Größen-Einheiten im Kriterium `size`:** Einstellung `view.sizeFormat` (Binär 1024 vs. Dezimal 1000) übernehmen oder
  explizit `MiB`/`MB` ausweisen?

## Akzeptanzkriterien

- **Marcs Beispielordner** (aus `046-select-if-beispiel.jpg` als Fixture):
  - Vorlage *„Filme mit Cover-Bild (inkl. Cover)“* → Live-Zähler meldet **18 Treffer (9 Hauptdateien + 9
    Begleitdateien)**; nach Ausführen sind genau die 9 `.mkv` und ihre 9 `.jpg` markiert, `Meine Schwester und ich
    (2005).mkv`, `mainboard_1.webp`, alle `.pdf` und die 4 Ordner sind **nicht** markiert.
  - Vorlage *„Filme ohne Cover-Bild“* → markiert ausschließlich `Meine Schwester und ich (2005).mkv` (1 Datei).
  - Vorlage *„Verwaiste Bilder ohne Film“* → markiert ausschließlich `mainboard_1.webp` (1 Datei).
- **Unicode-Normalisierung:** `Die Hölle (1951).mkv` (NFC) und `Die Hölle (1951).jpg` (NFD, zerlegtes `o + ¨`) werden
  als Paar erkannt und gemeinsam markiert.
- **Präfix-Modus:** `Film (2026).mkv` findet `Film (2026).de.srt` und `Film (2026)-poster.jpg`, während `Coup.mkv`
  **nicht** `Couples.jpg` markiert.
- **UND-Invariante bei Begleitdateien:** Regel `Filme` + `hat Begleitdatei: Bilder (mitmarkieren)` **UND** `Größe >
  100 MB` markiert bei einem 5-MB-Sample `Sample.mkv` + `Sample.jpg` **weder** `Sample.mkv` **noch** `Sample.jpg`.
- **Mengen-Modi:** `Ersetzen`, `Hinzufügen`, `Entfernen` und `Einschränken` arbeiten korrekt; bei `Einschränken` wird
  die Existenz der Begleitdatei gegen den gesamten Ordner geprüft, bevor mit der bestehenden Auswahl geschnitten wird.
- **Flache Ansicht (038):** `OrdnerA/Film.mkv` paart sich nur mit `OrdnerA/Film.jpg`, nie mit `OrdnerB/Film.jpg`.
- **Vorlagen & Neustart:** Eigene Vorlage speichern und letzte Eingabe ändern → überleben einen Neustart und sind im
  Einstellungs-Export/Import enthalten; eine gelöschte Dateityp-Kategorie in einer Vorlage erzeugt einen klaren Hinweis
  statt eines Fehlers.
- **Performance & Bedienung:** 50 000 Einträge (Flache Ansicht) werden in `< 50 ms` ausgewertet; Dialog komplett per
  Tastatur bedienbar (`Tab`, `Strg/⌘+Enter`, `Esc`), Fokus kehrt in die Dateiliste zurück, Kontraste in light und dark.

## Tests

- **Frontend (rein):** `select-if-engine.spec.ts` mit tabellengetriebenem Katalog `select-if-engine.cases.json`:
  Marcs Ordner aus dem Screenshot als Referenzfall (alle drei Richtungen), NFC/NFD-Umlaute, Dotfiles, Dateien mit
  mehreren Punkten (`Archiv.2026.tar.gz`, `Film.1080p.mkv`), `exact` vs. `prefix`, Selbst-Ausschluss
  (`images` ↔ `images`), `UND`/`ODER` mit `includeCompanions`, alle 4 `combineMode`-Varianten, `otherPanel`
  (`sameName`, `sameStem`, `sameNameAndSize`, `newer`/`older`), `size` (inkl. Ordner mit/ohne berechneter Größe),
  `modified` (mit festem `nowMs`), `name` (Glob/Regex + ungültige Regex), `..` und virtuelle Zeilen, Flache Ansicht mit
  gleichen Dateinamen in verschiedenen Unterordnern, Laufzeittest mit 50 000 Einträgen.
- **Frontend (Dialog & Integration):** Vorlagen wählen/speichern/löschen, `dialogs.recent` Wiederherstellung (inkl.
  kaputter Einträge), Live-Zusammenfassung, Tastatur (`Strg/⌘+Enter`, `Esc`), Aktions-Registrierung, Menü- und
  Keymap-Tests (keine Doppelbelegung auf macOS/Windows/Linux), i18n-Vollständigkeit en/de.
- **Rust:** Schema-/Sanitize- und Bundle-Export/Import-Test in `settings.rs` für `selectIf.templates` (und ggf. das
  erhöhte `maxItems` von `dialogs.recent`).
- **E2E unter Xvfb:** Fixture nach Marcs Screenshot anlegen, Dialog per Kürzel öffnen, Vorlage *„Filme mit Cover-Bild“*
  ausführen → 18 markierte Zeilen in der Statuszeile prüfen, Gegenprobe *„Filme ohne Cover-Bild“* → 1 markierte Zeile.

## Nicht in diesem Prompt (→ „Offen“ im Design)

- Datei-Inhalte, Medien-Metadaten (Auflösung/Codec/Dauer per ffprobe/Bildheader) oder Prüfsummen beim Markieren lesen –
  `Select if…` arbeitet bewusst verzögerungsfrei auf den bereits gelisteten Metadaten im Speicher.
- Rekursives Nachladen nicht geöffneter Unterordner (dafür vorher `Mod+B` Flache Ansicht einschalten und dort
  `Select if…` ausführen).

