# Design 043: Command Palette als universeller Einstieg

> **Status:** umgesetzt und extern reviewt (27.10.2026), Branch `feat/command-palette-universal` · ohne Freigabe-Halt (Marc: „selbständig“)
> · neue Crates **keine** im Baum: `icu_normalizer` 2.3 (über `url`/`idna`, dieselbe Zeile wie Branch 036),
> `icu_properties` 2.3 (ebenso, Kategorie M wie `\p{M}`) und `memchr` 2 (über `regex`) werden nur direkt genannt.

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `features/actions/command-palette.ts` (002, 018 E4) | Combobox + Listbox, unscharfe Suche über Aktionen, Tools, Farbschemata, bekannte Ordner | **umgebaut**: Gruppen, Treffer aus Rust, virtualisierte Liste, Treffer-Aktionen, Vorschau; F10/„Mit Tool öffnen“ bleiben reine Aktions-/Tool-Listen |
| `search.rs` (009) | Glob/Regex, Tiefensuche, Ausschlüsse | **wiederverwendet**: `globs_to_regex`, `build`, `is_virtual_fs` sind `pub(crate)` |
| Job-Engine | lange Operationen | **nicht** für Palettenanfragen (E4) |
| `WatchHub` (012) | Panel-Ordner überwachen | **angezapft**: jede Änderung eines Panel-Ordners geht auch an den Index (`palette::notice_watch`) |
| `OpsStore.openCopyMoveFor`, Namensdialog | Kopieren/Verschieben/Umbenennen | **passt**; neu `openRenameFor(side, parent, entry)` für Einträge außerhalb der Panels |
| `DiskUsageStore.start`, `SearchStore.findDuplicates` | Ordner analysieren, ähnliche Dateien | **passt**; Duplikatsuche bekommt `reference` (E8) |
| `SearchStore` (Ergebnis-Tabs) | „alle Treffer als Ergebnis-Tab“ | **erweitert**: `showFixed` – ein Ergebnis ohne Job, „erneut suchen“ fragt die Palette neu |
| `WorkspaceStore.requestNavigate` | Ordner öffnen | **erweitert** um `cursor` („Zum Speicherort“) |
| Einstellungen (015) | Index, Wurzeln, Grenzen | Abschnitt „Palette & Index“, Typ `int` bekommt ein Zahlenfeld, Listen von Pfaden/Mustern ein Textfeld |

## 2. Entscheidungen

### E1 – Quellen: Index zuerst, Live-Suche dazu, Systemsuche optional ✅

Gemessen im Container (2 Kerne, Release-Build; `cargo test --release -- --ignored bench_index bench_first --nocapture`):

| Messung | Ergebnis |
|---|---|
| Index im Speicher, 1 000 001 Einträge (synthetisch, 20 000 Ordner) | **47 MiB**, aufgebaut in 0,23 s (ohne Platte) |
| Anfrage über 1 Mio. Einträge (`invoice 2025`, `inv`, `budget final 2010`, `zzz`, `ext:pdf size>40k`) | **31–64 ms** (vorher mit `str::contains` und Heap ohne Schwelle 72–142 ms) |
| Index von der Platte, 50 401 Einträge (200 Ordner × 250 Dateien, tmpfs) | 211 ms, 2,3 MiB; erste Treffer nach **3–9 ms** |
| App (Release) mit 1 000 001 Dateien in 20 000 Ordnern unter `$HOME` (ext4) | Index nach ≈ 13 s bereit (1 040 006 Einträge), RSS +≈ 95 MB (180 → 275 MB, ohne WebView-Prozesse); `invoice 2025` → 5 915 Treffer, die besten 300 nach **146 ms** komplett (inkl. Prüfung jedes Treffers per `lstat`) |

Bewertung:

- **(a) Live-Suche** in festgelegten Wurzeln: nichts im Speicher, immer aktuell, aber die Zeit bis zum Treffer hängt an
  der Tiefe (ein Home mit 1 Mio. Dateien braucht Sekunden bis Minuten) – als *alleinige* Quelle verfehlt sie < 100 ms.
  Bleibt als Ergänzung für die **bekannten Orte** (Tabs, Favoriten, zuletzt; 3 Ebenen, 1,5 s, 20 000 Ordner) und als
  Ersatz, solange der Index baut oder ausgeschaltet ist (Wurzeln 8 Ebenen tief, gleiche Grenzen).
- **(b) eigener Namensindex** – **empfohlen und umgesetzt**: < 100 ms bei 1 Mio. Einträgen, ~50 MB je Million, keine
  Fremdabhängigkeit, auf jedem OS gleich. Aufbau einmal im Hintergrund (3 s nach dem Start), danach Watcher + stündlich neu.
- **(c) Systemsuche** (Spotlight `mdfind`, `plocate`/`locate`): wo vorhanden sehr schnell und ohne eigenen Speicher,
  aber Ergebnisse folgen fremden Regeln (Spotlight lässt Ordner aus, `locate` ist bis zu einem Tag alt, Windows Search
  braucht COM/OLE DB). **Optional, Default aus**, nur als externes Programm mit fester Argumentliste (`--` vor dem Wort),
  Ende nach 0,8 s, höchstens 5 000 Zeilen; jede Zeile wird geprüft (absolut, unter einer Wurzel, kein übersprungener
  Teil, existiert, passt zur ganzen Abfrage). Windows: nicht angeboten (Einstellungstext sagt es).

### E2 – Der Index (Rust `palette/index.rs`) ✅

- **Inhalt nur Namen, Größe, Datum** (keine Inhalte, keine Rechte), **nur im Speicher** – nichts im App-Ordner, damit
  nichts zu löschen bleibt; „Aus dem Speicher entfernen“ und „Neu aufbauen“ in den Einstellungen.
- Layout: parallele Arrays je Eintrag (Eltern, Namens-Offset/-Länge, Flags, Größe, mtime in s, erstes Kind, Geschwister =
  31 Byte) + alle Namen in einem `String`. Eltern stehen immer vor ihren Kindern → **ein Durchlauf** kennt für jeden
  Eintrag die Wörter der Ordner darüber (Bitmaske je Eintrag, `down[i] = down[parent] | eigene Bits`).
- **Speichergrenze** (Einstellung, Default 256 MB, 8–2048): die Arrays wachsen in Schritten (kein Verdoppeln über die
  Grenze), `bytes()` zählt die Kapazität; voll → `truncated`, der Rest kommt aus der Live-Suche.
- Wurzeln (Default Home; `~` wird aufgelöst), **kein fremdes Dateisystem** (Gerät der Wurzel), keine Links verfolgt (keine
  Zyklen), `/proc` `/sys` `/dev` nie, versteckte nur mit Einstellung, Ausschlüsse als Glob (Default `node_modules; .git`),
  Namen ohne gültiges UTF-8 und alles darunter fehlen (sie wären nicht adressierbar). Wurzeln in Wurzeln zählen einmal.
- **Aktualisierung**: (1) rekursiver `notify`-Watcher über die Wurzeln (FSEvents/ReadDirectoryChangesW; unter Linux nur bis
  50 000 Ordner, sonst wären die inotify-Watches erschöpft), (2) Ereignisse der Panel-Ordner (`WatchHub`), (3) Treffer,
  die bei der Prüfung fehlen, (4) stündlicher Neuaufbau. Geänderte Ordner werden entprellt (1,5 s) **außerhalb** der
  Sperre gelesen und dann übernommen (`apply_dir`: weg → entfernt mit Unterbaum, geändert → aktualisiert, neu → angehängt,
  neue Ordner bis 20 000 Einträge gefüllt). Mehr als 10 000 geänderte Ordner oder ein Drittel entfernt → Neuaufbau.

### E3 – Abfragesprache (`palette/query.rs` + `palette-query.ts`, ein Testkatalog) ✅

Wörter (alle müssen vorkommen) im Namen **oder einem Ordnernamen darunter** – unter dem Home-Ordner zählen die Ordner ab
dort, außerhalb nur der Name der Wurzel (sonst passte „data“ auf alles unter `/data`). Groß/klein und Akzente egal
(NFD ohne Zeichen der Kategorie M, wie die Typeahead der Liste). `"zwei Wörter"` ist ein Wort, `-wort` schließt aus, ein
Wort mit Trenner wird geteilt (`docs/2025` = `docs` und `2025`). Präfixe: `>` nur Aktionen, `/` `~` `C:\` `\\server` = Pfad
(Vervollständigung in diesem Ordner, E5). Filter: `ext:pdf,docx`, `in:Projekte` (ein Ordner darüber) / `in:/abs`
(darunter), `size>10m`, `size<1g`, `modified:2025|2025-03|2025-03-14|today|yesterday|7d|2w`, `modified>X` (nach dem
Zeitraum), `modified<X` (davor), `is:file|dir` (auch `type:`, deutsch `datei`/`ordner`). Unbekanntes `x:y` ist ein Wort.
Grenzen: 12 Wörter, 6 Ausschlüsse, 6 `in:`, 16 Endungen, 512 Byte. Daten in Ortszeit (Offset vom Frontend).

**Rangfolge** (`query::score`): je Wort im Namen +100, am Namensanfang +40, an einer Wortgrenze +25, nur im Pfad +10; Name =
Wörter (ohne Endung) +80; −2 je Ebene, −Länge/8; **Bonus** unter einem zuletzt benutzten Ordner 150 − 10 × Platz (10
Ordner), unter einem Tab-/Favoriten-Ordner 80. Im Index entscheidet zuerst eine schnelle Vorstufe (Wörter im Namen,
Tiefe, Bonus) über die besten 3 × Limit, die dann genau bewertet werden. Markierungen der Wörter kommen als UTF-16-Bereiche
(NFD-Akzente gehören zum Zeichen davor).

Der Katalog `src/app/features/palette/palette-query.cases.json` (Parsen, Treffer, Reihenfolge) wird von Rust
(`palette/query/tests.rs`) und vom Frontend (`palette-query.spec.ts`) gelesen.

### E4 – `palette_query` als Command mit eigenem Kanal, kein Job ✅

Ein Job erschiene je Tastendruck in der Task-Liste und lebte dort nach. Die Anfrage ist interaktiv und kurz (Index < 0,1 s,
Live ≤ 1,5 s), deshalb ein schmaler Command `palette_query(request, onEvent)` mit eigener `Channel`: er startet einen
eigenen Thread (blockierendes I/O nie auf dem Runtime-Thread) und gibt sofort die Id zurück. **Jede neue Anfrage bricht die
vorige ab** (ein `AtomicBool` je Anfrage, vom Hub ersetzt); eine abgebrochene sendet kein `Done`. Das Frontend verwirft
zusätzlich alles einer älteren Anfrage (Sequenz je Tastendruck, 25 ms entprellt). Ereignisse: `hits` (Index: ein Bündel,
geprüft; Live: ≤ 100 oder alle 50 ms) und `done` mit Statistik (`matched` = alle Treffer im Index, `firstHitMs`,
`truncated`, `liveExhausted`, `stale`). Grenzen: Limit 1–2 000 (Einstellung, Default 300), Text ≤ 2 KiB, 200 Orte.

Server- und Archivpfade: Tabs mit solchen Pfaden sind Orte, werden aber **nicht** betreten; nur in den Einstellungen als
Suchordner eingetragene Server-/Archivordner werden live durchsucht (nie indiziert, nie automatisch verbunden – ein nicht
verbundener Server liefert nichts). Ein getippter Server-/Archivpfad (Pfadmodus) ist ebenfalls eine ausdrückliche Wahl.

### E5 – Oberfläche ✅

- Gruppen **Aktionen · Ordner · Dateien** mit Kopfzeile (Zahl, „x von N“ wenn Rust mehr fand) und „N weitere…“ (Aktionen
  ab 5, Ordner ab 6; Dateien alle bis zum Limit). Eine **starke** Aktion (der Text steht an einem Wortanfang des Labels)
  stellt die Aktionen nach oben, sonst kommen sie zuletzt. Filter (`ext:` …) blenden Aktionen aus. `>` und die leere
  Eingabe zeigen die Aktionsliste wie bisher (ohne Kopfzeilen).
- Ordner-Treffer aus Rust kommen zu den bekannten Ordnern (doppelte Pfade einmal). Im Pfadmodus: „Gehe zu …“ und die
  Einträge des Ordners.
- Zeile: Icon (`iconFor`/`FileIconService`), Name mit markierten Wörtern, Ordner gekürzt in der Mitte, voller Pfad im
  Tooltip, Größe, „›“ für die Aktionen.
- **Virtualisiert**: feste Zeilenhöhe 30 px, nur die sichtbaren Zeilen ± 6 im DOM (`visibleWindow`), der Abstandshalter
  hat die volle Höhe. Die aktive Zeile wird beim Bewegen in den sichtbaren Bereich gescrollt, `aria-activedescendant`
  zeigt nur auf gerenderte Optionen, `aria-setsize`/`aria-posinset` an jeder Option.
- **Ladeanzeige ohne Springen**: die alten Treffer bleiben, bis die ersten neuen kommen; Fußzeile „Suche läuft…“, Zahl der
  Treffer, Markierte, Indexzustand; Live-Region „N Treffer“ erst nach dem Ende.
- Vorschau (F3) rechts neben der Liste (`PreviewContent`, Bild-Slot des Viewers), folgt dem aktiven Treffer.

### E6 – Treffer-Aktionen ✅

| Aktion | Kürzel in der Palette | Wirkung |
|---|---|---|
| Öffnen | Enter (= `NAVIGATE_OPEN`) | Ordner im aktiven Panel; Datei mit der Standard-App über `FileBrowserStore.openFile` (Programme fragen) |
| Vorschau | F3 (= `OPEN_VIEW_DLG`), Strg+Q | Vorschau neben der Liste ein/aus |
| Zum Speicherort | Strg+Umschalt+G (= `GOTO_FILE`) | aktive Seite zeigt den Ordner, Cursor auf dem Treffer |
| … im neuen Tab | Strg+Enter (= `OPEN_IN_NEW_TAB`) | dito in einem neuen Tab |
| Kopieren / Verschieben | F5 / F6 | **der normale Dialog** (`openCopyMoveFor`) mit den Treffern als Quelle, Ziel = andere Seite – alle Prüfungen bleiben |
| Umbenennen | Umschalt+F6, F2 | Namensdialog (`openRenameFor`, Ordner = Ordner des Treffers) |
| Ähnliche Dateien finden | Alt+Umschalt+F7 | Bild: ähnliche Bilder im Ordner des Treffers und darunter; sonst gleiche Inhalte unter den Suchordnern – nur die Gruppe des Treffers (E8) |
| Übergeordneten Ordner analysieren | Strg+Umschalt+D | Speicherbelegung des Ordners (033) |
| Markieren | Einfg, Strg+Umschalt+Leertaste | Mehrfachauswahl; Kopieren/Verschieben nehmen alle Markierten |
| Alle Treffer als Ergebnis-Tab | Alt+F7 (= Suche) | Ergebnis-Tab (009); „erneut suchen“ fragt Rust mit Limit 2 000 |

Tab oder → (am Textende) öffnet die Liste dieser Aktionen am Treffer (eigene Listbox, ↑/↓/Pos1/Ende, Enter, Esc/←/Tab
zurück, Esc schließt **nicht** die Palette); Rechtsklick ebenso. Die Aktionen sind **Katalog-Aktionen** `PALETTE_*`
(versteckt im Menü, nur aktiv bei offener Palette mit Treffer). Sie haben **keine eigenen Kürzel**: in der Palette gilt die
Taste der Panel-Aktion daneben (`HIT_ACTIONS.via`) – F5 kopiert den Treffer, wie es im Panel den Cursor-Eintrag kopiert,
und eine geänderte Belegung gilt für beide. Leertaste und normale Tasten bleiben Eingabe (Abweichung vom Prompt: Leertaste
= Vorschau ginge nicht, das Leerzeichen trennt die Wörter).

### E7 – Einstellungen „Palette & Index“ ✅

`palette.index` (an), `palette.roots` (Liste, eine je Zeile, leer = Home), `palette.excludes` (`;`-getrennt, Default
`node_modules; .git`), `palette.maxMemoryMb` (256, 8–2048), `palette.includeHidden` (aus), `palette.systemSearch` (aus),
`palette.maxHits` (300, 50–2000). Der `PaletteStore` schickt sie beim Start und 400 ms nach jeder Änderung an Rust
(`palette_configure`); geänderte Wurzeln/Ausschlüsse/Grenzen bauen neu, ein laufender Aufbau bricht ab. Der Abschnitt zeigt
Zustand, Einträge, MB von MB, „voll“, „nicht überwacht“ und die Knöpfe „Neu aufbauen“ / „Aus dem Speicher entfernen“.

### E8 – „Ähnliche Dateien“ über `DuplicateCriteria.reference` ✅

Die Duplikatsuche (042) bekommt `reference: Option<String>`: nur die Gruppe dieser Datei bleibt; im exakten Modus werden
nach dem Durchlauf nur Dateien ihrer Größe gehasht (schnell auch unter dem ganzen Home). Liegt die Datei nicht unter den
Wurzeln, gibt es keine Gruppe.

### E9 – Datenschutz und Sicherheit ✅

Keine Dateiinhalte, der Index nur im Speicher, nichts geloggt (keine Pfade, keine Anfragen). Die Systemsuche ist ein
festes Programm (`/usr/bin/mdfind`, `/usr/bin/plocate`, `/usr/bin/locate`, `/usr/local/bin/plocate`) ohne Shell mit
fester Argumentliste; das Suchwort ist ein Argument nach `--` (mdfind: `-name <wort>`), höchstens 200 Zeichen.

## 3. Verträge

- Rust `palette::{PaletteConfig, PaletteRequest, PaletteHit, PaletteEvent, QueryStats, IndexStatus}` ↔ TS
  `core/palette/palette.models.ts`; Commands `palette_configure`, `palette_status`, `palette_query`, `palette_cancel`,
  `palette_rebuild`, `palette_clear` (alle `async`).
- `PaletteHit` = `SearchHit` + `score`, `source` (`index|live|system|path`), `ranges` (UTF-16).
- `DuplicateCriteria.reference` (Rust + TS).
- `WorkspaceStore.requestNavigate(side, path, cursor?)`, `OpsStore.openRenameFor`, `SearchStore.showFixed`.

## 4. Tests

- Rust: `palette::query::tests` (Katalog, Falten, UTF-16-Bereiche, Grenzen, Größen, Daten), `palette::index::tests`
  (Abnahme `invoice 2025`, Ausschlüsse/versteckt, Ordner als Pfad, `in:`, Bonus/`in:/x`, Limit und Zahl, Speichergrenze,
  Abbruch, `apply_dir` mit Ersetzen/Entfernen, Unicode/NFD, Links/Zyklus, Nicht-UTF-8, verschachtelte Wurzeln, Messung),
  `palette::live` (Pfad unter Home, Tiefe/abgedeckt/doppelt, Zeitgrenze, Archive/Server nur ausdrücklich, Links),
  `palette::system` (Argumentliste), `palette::tests` (Hub: Abnahme aus dem Index, ohne Index live, Orte + Bonus, veraltete
  Treffer, neue Anfrage bricht ab, Limit, Pfadmodus, leere/Aktions-Anfragen, Archiv-Wurzel, Einstellungen, Änderungen
  übernehmen, Leeren/Neu aufbauen, Messung), `duplicates::tests::a_reference_keeps_only_its_group`.
- Frontend: `palette-query.spec.ts` (Katalog), `palette-logic.spec.ts` (Gruppen, Reihenfolge, Bewegen, Markieren der
  Wörter, Kürzen, Zusammenführen, Fenster), `palette.spec.ts` (Anfrage mit Orten, veraltete Antworten, `>`, Virtualisierung,
  F5 → Dialog mit Quelle/Ziel, Tab-Untermenü + Esc, Zum Speicherort mit Cursor, Ordner öffnen, Ordner analysieren,
  Markieren + Kopieren mehrerer, Vorschau, Ergebnis-Tab + erneut suchen, Einstellungen an Rust, Schließen bricht ab).

## 5. Externes Review (27.10.2026) und Folgen

| # | Befund | Folge |
|---|---|---|
| 1 | Linux-Watcher: `notify` folgt Links, betritt fremde Dateisysteme, `OPEN`-Ereignisse lösen Neulesen aus | `Config::with_follow_symlinks(false)`, `Access` ignoriert, unter Linux **eine nicht rekursive Watch je indiziertem Ordner** (≤ 50 000), sonst rekursiv über die Wurzeln |
| 2 | hängender Netzordner: je Taste ein blockierter Thread | Orte auf Netzlaufwerken (`watch::netfs`) werden nicht live betreten; **eine** Live-Suche zugleich (die nächste wartet ≤ 300 ms, sonst nur Index); Abbruch auch zwischen Einträgen; Test mit langsamem Ort |
| 3 | `palette_cancel` ohne Id, Ergebnis-Tab teilt sich den Abbruch | `palette_cancel(id)` bricht nur die laufende Anfrage dieser Id ab (das Frontend wartet auf die Id); „erneut suchen“ läuft `detached` und endet spätestens nach 15 s |
| 4 | neuer Ordner > 20 000 Einträge still abgeschnitten, Lesen unter der Schreibsperre | `Index::collect` liest außerhalb der Sperre, `graft` fügt ein; Budget erreicht → `truncated` (die Live-Suche deckt den Rest) |
| 5 | Untermenü zerstört die Liste, danach leer gescrollt | Liste bleibt im DOM (`hidden`), Scroll-Position bleibt; Test |
| 6 | Vorauswahl verliert den besten Namen | `quick_bonus` (Namensanfang, Name = Wort) schon in der Vorauswahl; Test mit 400 schwächeren Namen |
| 7 | Speicher über der Grenze (alter + neuer Index, Puffer je Anfrage) | Puffer (8 B/Eintrag) einmal je Hub und **in der Grenze mitgezählt**; beim Neuaufbau geht ein alter Index über der halben Grenze vorher |
| 8 | ausdrückliche Serverordner je Taste neu gelistet | Listings 60 s zwischengespeichert (≤ 2 000 Ordner) |
| 9 | eine falsche Wurzel legt den Index lahm; `configure` blockiert den Runtime-Thread | ungültige Wurzeln/Ausschlüsse werden ausgelassen und in `IndexStatus.problems` gezeigt; `palette_configure` über `spawn_blocking` |
| 10 | Watcher-Filter nur über den Namen, Wurzel wörtlich verglichen | versteckt auch per Flag (`~/Library`, `AppData`), kanonische Wurzel → konfigurierte zurückgerechnet (`/private/tmp`); Ordner außerhalb des Index werden nicht gelesen |
| 11 | Systemsuche: Abbruch bei Nicht-UTF-8, gefaltetes Wort, ganze Datenbank | Zeilen als Bytes, das Wort wie getippt, `locate` je Wurzel mit Muster `<wurzel>/*<wort>*` (Platzhalter maskiert) |
| 12 | `modified>7d` fand nie etwas | relative Zeiträume: `>` = neuer als ihr Beginn, `<` = älter; Katalog-Fälle |
| 13 | Rust/TS-Unterschiede (Kürzen, Zeichen M, Schluss-Sigma, Leerraum, Jahre < 100, Home im Pfad) | beide kürzen auf 512 Zeichen, Rust nimmt Kategorie M (`icu_properties`), TS faltet je Zeichen, Leerraum wie `char::is_whitespace`, `setUTCFullYear`, bekannte Ordner ohne den Wurzelpfad; Katalog um Griechisch, Tamil, U+0085/U+FEFF ergänzt |
| 14 | „Ähnliche Dateien“ für Treffer außerhalb der Wurzeln leer | der Ordner des Treffers kommt dann zu den Wurzeln |
| 15 | Tests prüften Abbruch/`Gone`/Virtualisierung nicht | echte Prüfungen: kein `Done` nach Abbruch, später Abbruch einer alten Id lässt die neue laufen, `Gone` senkt die Zahl der Einträge, Scroll/`aria-activedescendant` nach dem Untermenü |

## 6. Fortschritt

- Phase 1–5 in einer Sitzung (27.10.2026): Rust `palette/` mit Tests und Messungen, Frontend (Store, Logik, Palette,
  Einstellungen), Doku, README/Werbeseite (`palette.png`, `site/img/palette-files.png`).
- E2E unter Xvfb mit der Release-Binary und 1 Mio. Dateien unter `$HOME`: Index bereit nach ≈ 13 s, Tippen bleibt
  flüssig (Anfragen laufen im eigenen Thread), `invoice 2025` → 300 von 5 915 in 146 ms; Esc schließt sofort.
- Nicht im Container prüfbar: Spotlight (`mdfind`), FSEvents/ReadDirectoryChangesW (→ `TODO.md` §2), Windows Search
  (nicht umgesetzt).
