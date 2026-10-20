# Design 003: Navigation, Verlauf, Filter und Statuszeile

> **Status:** ✅ umgesetzt (freigegeben 2026-10-17, E1–E10 wie empfohlen) · **Datum:** 2026-10-17 · **Branch:** `feat/navigation-liste`
> (von `feat/aktionen-tastatur`)
> **Grundlage:** legacy §4/§5, mr §1.3/§1.4/§3/§4, `docs/ui-layout.md` Zeilen 1–2, Designs 001/002/004.

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| Breadcrumb + Stern (004) | klickbar, Favoriten in `session.json` | **passt**, bekommt Bearbeiten-Modus |
| `TabSession` (004) | `history` (max. 15, neueste zuerst), `hiddenVisible`, `filterActive`, `filterText` | **passt** – Felder existieren schon, werden jetzt benutzt |
| Comparatoren (001 E3) | „..“ war vorgesehen | **passt** |
| `FileBrowserStore.marked` | Set je Ordner, beim Ordnerwechsel geleert | **erweitern**: je Ordner merken |
| Statuszeile (004) | Zielformat, nur Dateigrößen | **erweitern** um berechnete Ordnergrößen |
| Aktionen (002) | `NAVIGATE_BACK/FORWARD`, `TOGGLE_HIDDEN_FILES`, `TOGGLE_FILTER`, `OPEN_CHDIR_DLG` als „kommt in 003“ | **Handler** registrieren |
| GuiExpert | `externalFilterFunction` + `externalFilterChanged()` | **passt** für Hidden und Filter |
| Rust | `list_directory`, `paths.rs` | **erweitern**: `~`, `calc_dir_size`, `open_file` |

## 2. Entscheidungen (Empfehlungen)

### E1 – „..“-Zeile **im Tabellenmodell** ✅

Eine synthetische erste Zeile (`ListRow = DirEntry & { parentLink: true }`, Pfad = `listing.parent`), nur wenn es
einen Elternordner gibt. Die Comparatoren halten sie in beiden Richtungen oben (001 E3), der externe Filter lässt
sie immer durch, Markieren überspringt sie, Statuszeile und „alles markieren“ zählen sie nicht. Enter/Doppelklick =
hoch (Cursor auf den Herkunftsordner). Alternative „fester Kopfbereich außerhalb der Table“ verworfen: eigener
Fokus- und Scrollzustand neben der Table, Cursor könnte nicht wie gewohnt darauf stehen.

### E2 – Dateien öffnen: **eigener Command mit der Crate `open`** ✅

`open_file(path, allowExecutable)`: Rust prüft (existiert, ist Datei, kein Ordner) und ruft `open::that_detached`
(startet `open` / `ShellExecuteW` / `xdg-open` mit Argument-Array, keine Shell). Kein `tauri-plugin-opener`: das
bräuchte eine breite Pfad-Capability fürs Frontend. **Ausführbare Dateien** (Unix: Ausführungsbit; Windows: `.exe
.bat .cmd .com .ps1 .vbs .msi .lnk .scr`; macOS: zusätzlich `.app`, `.command`) → Fehlercode `executable` → Rückfrage
im Frontend („Ausführen?“, Standard = Abbrechen) → zweiter Aufruf mit `allowExecutable: true`.
Neue Abhängigkeit: `open` (klein, MIT/Apache, auch die Basis von `tauri-plugin-opener`).

### E3 – Verlauf: Zurück/Vor-Stapel je Tab im Speicher, Liste „zuletzt“ persistent ✅

- **Zurück/Vor** je Tab: Stapel mit je max. 50 Einträgen `{ path, cursor, scrollTop }`, keine direkten Dubletten;
  nur im Speicher (nach Neustart leer). Kürzel aus 002 (`Alt+←/→`, macOS `⌘[`/`⌘]`), Maustasten 4/5.
- **Verlauf des Tabs** (`TabSession.history`, persistent, max. 15, neueste zuerst) für das Verlaufsmenü des Tabs
  (Kontextmenü-Eintrag „Verlauf…“).
- **Zuletzt besucht** global: max. 20, ohne Dubletten, ohne Favoriten → neues Feld `recent` in `session.json`
  (Favoriten liegen dort schon; 015 kann beides in einen Einstellungsdienst ziehen).
- **Cursor, Markierung, Scroll je Ordner** (mr `selection0/1`): im Speicher je Tab, LRU 50 Ordner; Rückkehr stellt
  sie wieder her (auch per „..“ und Breadcrumb).

### E4 – Menü ▾ links in der Tab-Leiste ✅

Gruppen: **Start** (Home; Laufwerke/Volumes folgen in 011) · **Favoriten** · **Zuletzt** – APG-Menü
(`ContextMenu` aus 004 mit Gruppenüberschriften). Neue Aktionen `OPEN_FOLDER_MENU_LEFT/RIGHT` mit `Alt+F1`/`Alt+F2`
(Total Commander: Laufwerksmenü) – `Alt+1`/`Alt+2` bleiben „Panel wählen“.

### E5 – Hidden und Filter je Tab, über den externen Filter der Table ✅

- 👁 rechts in der Tab-Leiste und `TOGGLE_HIDDEN_FILES` (Win/Linux `Strg+H`, macOS `⌘⇧.` wie Finder). Default
  „aus“ (versteckte ausgeblendet); Einstellung in 015.
- ⏷ + Eingabefeld (sichtbar, wenn aktiv) und `TOGGLE_FILTER` (`Strg/⌘+Alt+F`; `Strg/⌘+F` bleibt „Suchen“ aus 002).
  Syntax wie der Markier-Dialog (Wildcards/Teilstring, `|`, `-ausschließen`), Esc leert und schließt, Doppelklick
  leert. Der Filter bleibt sichtbar (alt: verschwand nach 6,7 s – bewusst geändert).
- Umsetzung: `externalFilterFunction` = `(row) => parentLink || (hiddenOk && filterOk)`, danach
  `externalFilterChanged()` + Cursor per Pfad (wie nach dem Sortieren). Markierte, aber ausgeblendete Einträge
  bleiben markiert, zählen in der Statuszeile aber nicht als sichtbar (Hinweis „+n ausgeblendet markiert“).

### E6 – Typ-Ahead (Quick-Search) ✅

Druckbare Zeichen ohne Mod/Ctrl/Alt bei Fokus in der Liste bilden ein Präfix (Reset nach 1,5 s oder Esc), Cursor
springt zum ersten passenden Namen (Präfix, ohne Groß/klein, `Intl.Collator` mit `sensitivity: 'base'` → `a` findet
`Ä`), sonst nächster Teilstring-Treffer. Kein Filter. Live-Region sagt den Treffer an. Kollisionsfrei: Keymaps
belegen keine einzelnen Buchstaben (Test aus 002).

### E7 – Ordnergröße als abbrechbarer Job ✅

- `calc_dir_size(path, onProgress: Channel)` → `{ files, dirs, bytes, unreadable }`; Fortschritt alle ~100 ms;
  **folgt keinen Symlinks** (`symlink_metadata`, Zyklen ausgeschlossen); unlesbare Unterordner werden gezählt, nicht
  abgebrochen. Abbruch: `cancel_dir_size(jobId)` (Token in einer kleinen Job-Map; Prompt 005 ersetzt sie durch die
  Job-Engine).
- Auslöser: Leertaste auf einem Ordner = markieren **und** Größe berechnen (002 D3); zusätzlich Aktion
  `CALC_DIR_SIZES` für alle markierten Ordner (`Alt+Shift+Enter`, TC). Ergebnis in der Größenspalte (kursiv
  während der Berechnung), in der Statuszeile mitgezählt. Ordnerwechsel bricht laufende Berechnungen ab.

### E8 – Pfadeingabe ✅

Klick in den freien Bereich der Pfadleiste oder `Strg/⌘+L` (`OPEN_CHDIR_DLG` bekommt diese Bedeutung, Label
„Pfad eingeben…“) → Eingabefeld mit dem aktuellen Pfad (markiert), Enter navigiert, Esc bricht ab. `~` und `~/…`
expandiert Rust (`paths.rs`); Fehler (nicht vorhanden, keine Berechtigung, keine Ordner) als Meldung unter dem
Feld, das Feld bleibt offen. Datei-Pfad → Elternordner öffnen, Cursor auf die Datei.

### E9 – Neu laden ✅

Bleibt `Strg+R` / `⌘R` (002). F5 bleibt Kopieren (TC). Cursor und Markierung bleiben per Pfad (heute schon so).

### E10 – Keine neuen `DirEntry`-Felder ✅

`created/accessed/readonly` erst mit den Eigenschaften (010).

## 3. Verträge

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `list_directory` | `path?` – neu: `~`, `~/x` | wie bisher | wie bisher |
| `resolve_location` | `input: string` | `{ dir, select: string \| null }` (Datei → Elternordner + Datei) | `not_found`, `permission_denied`, `invalid_path` |
| `calc_dir_size` | `path`, `jobId: string`, `onProgress: Channel<DirSize>` | `DirSize { files, dirs, bytes, unreadable, cancelled }` | `not_a_directory`, `io` |
| `cancel_dir_size` | `jobId` | `()` | – |
| `open_file` | `path`, `allowExecutable: bool` | `()` | `not_found`, `not_a_file` *(neu)*, `executable` *(neu)*, `io` |

Neue Fehlercodes `not_a_file`, `executable` in `error.rs`, `fs.models.ts`, `describeFsError()`.
Session: `recent: string[]` (max. 20) in `session.rs`/`session.models.ts`.

## 4. UI

```
 / Users / marc / Projekte ☆                 [Strg+L → ▭ /Users/marc/Projekte________ ]
 [▾] │ marc │ Projekte │ + −                                   [👁] [⏷] [▭ *.ts -spec ]
 ↑ ..                                          (Cursor, nie markiert)
 📁 src                       <DIR>  → 1,2 MB nach Leertaste
```

Fokus-Reihenfolge je Seite: Breadcrumb → Stern → Menü ▾ → Tabs → + → − → 👁 → ⏷ → Filterfeld → Liste.
👁/⏷ als Umschalter mit `aria-pressed`; Filterfeld `role="searchbox"` mit `aria-controls` auf die Liste.

## 5. Tests

| Ebene | Fälle |
|---|---|
| Rust | `~`-Expansion (inkl. `~user` → Fehler), `resolve_location` (Ordner, Datei, fehlt, Umlaute); `calc_dir_size` (Größen bekannt, Symlink-Zyklus endet, Symlink auf Ordner nicht verfolgt, unlesbarer Unterordner gezählt, Abbruch); `open_file`-Prüfung als reine Funktion (Ordner → Fehler, ausführbar erkannt je OS) – das eigentliche Öffnen nur Ende-zu-Ende |
| Frontend | „..“: oben in beiden Sortierrichtungen, nicht markierbar, nicht gezählt; Filter/Hidden je Tab (Muster, Esc, Persistenz im Tab), 100 000 Zeilen < 50 ms für das Filterprädikat; Typ-Ahead (Präfix, Umlaute, Reset); Zurück/Vor-Stapel (Limit, Dubletten, Cursor/Scroll); Zuletzt-Liste; Merken je Ordner; Statuszeile mit Ordnergrößen; Pfadeingabe (Fehler bleibt im Feld); Menü ▾ (Gruppen, Tastatur) |
| Ende-zu-Ende | alle Akzeptanzkriterien; Öffnen einer Textdatei unter Linux (xdg-open im Container ggf. nicht vorhanden → nennen) |

## 6. Fortschritt

- [x] Phase 1: dieses Dokument
- [x] Freigabe (2026-10-17)
- [x] Phase 2: Rust – `dirsize.rs`, `opener.rs`, `expand_tilde`, `resolve_location`, `calc_dir_size`/`cancel_dir_size`,
  `open_file`, Fehlercodes `not_a_file`/`executable`, `recent` in `session.rs`; Abhängigkeit `open` 5
- [x] Phase 3: Frontend – „..“-Zeile, Zurück/Vor + Merken je Ordner (`tab-memory.ts`), Zuletzt-Liste, Menü ▾,
  👁/⏷ mit Filterfeld je Tab, Typ-Ahead, Ordnergröße (Leertaste, `Alt+Shift+Enter`), Pfadeingabe (`Strg/⌘+L`),
  Datei öffnen mit Rückfrage bei Programmen (`ConfirmService`); 174 Vitest-Tests
- [x] Phase 4: Ende-zu-Ende unter Xvfb: „..“, Hidden standardmäßig aus und `Strg+H`, Typ-Ahead „mei“, Leertaste
  berechnet 197 KB (Symlink-Zyklus im Baum endet), Zurück/Vor mit Cursor, Pfadeingabe `~/Dokumente/brief.txt`
  (Cursor auf der Datei), Filter `*e*` + Esc, Menü ▾ (`Alt+F1`), kaputter Symlink → Fehlermeldung
- [x] Phase 5/6: Doku, `pnpm check`, Debug-Build, Review durch separaten Agenten

### Review (separater Agent)

| Befund | Umsetzung |
|---|---|
| Windows/macOS: Endungen fehlten, die Code ausführen (`.js .hta .wsf .cpl .reg .url .jar …`, `.terminal .fileloc`) | Listen erweitert |
| Ausführungsbit auf FAT/exFAT/NTFS/SMB machte jedes Dokument zum „Programm“ | Endung zuerst, Bit nur ohne Endung oder mit `#!` (Test) |
| Markierungen eines geklonten Tabs im selben Ordner tauchten im anderen Tab auf | Tab-Wechsel gilt immer als neuer Ordner (Test) |
| Gelöschtes Zurück-Ziel blockierte den Verlauf, alte Scrollposition blieb hängen | `not_found` entfernt den Eintrag; Scroll nur bei Erfolg (Test) |
| Größen-Job eines alten Tabs konnte den neuen Tab umschreiben | Jobs beim Tab-Wechsel abbrechen, Fehler nur im eigenen Ordner melden |
| Ordnergröße lief in andere Dateisysteme (`/proc`, Netzlaufwerke), Abbruch nur zwischen Ordnern, `is_dir` auf dem Async-Thread | gleiches Gerät (Unix), Abbruch je Eintrag, Prüfung im Blocking-Task |
| Job-Ids nach WebView-Reload doppelt | zufälliges Präfix, Rust weist Dubletten ab |
| Tab aus der Pfadeingabe sprang in die Liste; Gruppen im Menü ▾ nicht angesagt | Blur schließt nur; `role="group"` mit Label |

### Befunde

- Berechnete Ordnergrößen gehen beim Verlassen des Ordners verloren (kein Cache) – bewusst einfach; Kandidat für
  012 (Überwachung) bzw. einen Größen-Cache.
- „Öffnen mit Standard-App“ nur bis zum Aufruf von `xdg-open` geprüft (Container ohne Desktop); macOS/Windows offen.
- Fehlermeldung `not_found` heißt jetzt „Datei oder Ordner existiert nicht“ (galt vorher nur Ordnern).
