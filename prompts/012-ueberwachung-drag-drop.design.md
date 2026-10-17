# Design 012: Verzeichnis-Überwachung und Drag & Drop

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) – alle Empfehlungen übernommen ·
> **Datum:** 2026-10-17 · **Branch:** `feat/ueberwachung-drag-drop` (von `main`: 001–008, 010 fertig; 009/011 auf
> eigenen Branches)
> **Grundlage:** legacy §1.1 (Listing-Cache 120 s), §1.2 (Event-Cache 16 ms, `created/removed/update`), §3 (Drop-Dialog
> „not implemented“), legacy §10 („`notify` statt Cache“), mr (chokidar `depth 0`, Ereignisse inkrementell in die
> Table), Design 001 (Table-Bridge), 005/006 (Jobs, `dirsChanged`, Kopieren/Verschieben-Dialog).
> **Phasen:** alle sechs; Rust und Frontend sind beide betroffen.

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| `listing.rs` | ganzes Listing, Eintrag aus `symlink_metadata` | **erweitern**: `stat_entry(path)` für einzelne Einträge (gleiches DTO wie im Listing) |
| `FileBrowserStore.refresh()` | lädt neu, Cursor + Markierung bleiben | **passt**, dazu `requestRefresh()` (zusammenfassen) und `applyChanges()` (inkrementell) |
| `JobsStore.changedDirs` → `FilePanel` | Job meldet Ordner → `refresh()` | **bleibt** (autoritativ, auch für nicht überwachte Ordner); läuft künftig über `requestRefresh()` |
| GuiExpert Table | kein `updateRows`/`addRows`; `setRows` + `reSort` + `repaintHard` (100 000 Zeilen 0,2–0,4 s) | Zeilen-Tausch bleibt der Weg; Deltas ändern nur das Array im Store, ohne Änderung kein Repaint |
| Table Row-Drag (`rowDragOptions`) | Ziehgriff je Zeile, Ziel = „zwischen Zeilen“ (Umsortieren) | **passt nicht** für Dateien → eigene Pointer-Logik |
| Zeile unter dem Zeiger | kein API; Zellen tragen `data-area="body"` + `data-row-index` (Anzeige-Index) | in der `TableBridge` gekapselt (`rowIndexAt(element)`), Lücke **G18** fürs Mono-Repo |
| `OpsStore.openCopyMove` | Quelle = aktive Seite, Ziel = andere Seite | **erweitern**: `openCopyMoveFor(...)` mit vorgegebenen Quellen und Ziel |
| `cursorAfterRemoval` (006) | Cursor auf den nächsten verbleibenden Eintrag | **passt** für gelöschte Dateien aus der Überwachung |
| Tauri Drag-&-Drop-Ereignis | `getCurrentWebview().onDragDropEvent` (enter/over/drop/leave, Pfade, physische Position), Capability `core:event:default` ist in `core:default` | **passt** für Drop von außen, ohne Plugin |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Crate `notify` 8 (CC0/MIT/Apache, Basis von cargo-watch, watchexec, rust-analyzer, deno) ✅

Ein nativer Watcher für alle überwachten Ordner (inotify / FSEvents / ReadDirectoryChangesW), **nicht rekursiv**,
dazu bei Bedarf ein `PollWatcher` (gleiche Crate). Eigene Entprellung statt `notify-debouncer-*`: die Regeln
(Namen sammeln, Massen-Schwelle, Rescan-Abstand) sind wenige Zeilen, rein testbar und brauchen keine zweite Crate.

### E2 – Was überwacht wird ✅

- Genau die **sichtbaren Ordner beider Panels** (aktiver Tab je Seite; gleiche Ordner einmal). Das Frontend meldet
  die Menge mit `watch_dirs(dirs)` (ersetzt die bisherige Menge); ein Ordnerwechsel meldet ab, was nicht mehr sichtbar
  ist. Höchstens 8 Ordner (Schutz gegen falsche Aufrufe).
- **Modus je Ordner:** `native` · `poll` (2 s) · `off`. Netzlaufwerke (Linux `statfs`: NFS, SMB/CIFS, AFS, Coda, 9p,
  Ceph; macOS ohne `MNT_LOCAL`; Windows UNC-Pfad oder `GetDriveTypeW = DRIVE_REMOTE`) → `off` per Default,
  `poll` wenn `pollNetwork: true` (Einstellung kommt mit 015, bis dahin `false`). Scheitert der native Watcher
  (z. B. inotify-Grenze), → `poll`. FUSE (sshfs, ntfs-3g) gilt als lokal (Änderungen über den Mount werden gemeldet).
- Statuszeile: bei `off` ein Hinweis „nicht überwacht – Strg+R“ (macOS ⌘R), bei `poll` „langsam überwacht“.

### E3 – Entprellen, inkrementell, Massenänderungen ✅

Ein Thread sammelt je Ordner die **Namen** der betroffenen direkten Kinder (Ereignis auf tieferen Pfaden → das
direkte Kind; auf dem Ordner selbst → `gone`, wenn er weg ist, sonst Rescan; `notify`-Flag `Rescan` bzw. Fehler →
Rescan). Ausgeliefert wird, wenn **150 ms Ruhe** sind oder **spätestens 400 ms** nach dem ersten Ereignis:

| Lage | Ereignis an das Frontend |
|---|---|
| ≤ 500 Namen | `changes { dir, upserted: DirEntry[], removed: path[] }` – jeder Name wird beim Ausliefern neu ge-`stat`et (Ergebnis = Zustand jetzt, nicht die Ereignisart) |
| > 500 Namen oder Rescan-Flag | `rescan { dir }` → Frontend lädt einmal neu |
| Folge-Rescans (Flut, z. B. 50 000 entpackte Dateien) | höchstens **einer je 1,5 s** und Ordner; dazwischen wird nur gezählt |
| Ordner gelöscht/umbenannt | `gone { dir }` → Panel geht zum nächsten vorhandenen Elternordner |

Frontend: `applyChanges` ersetzt/ergänzt per Pfad, entfernt Markierungen gelöschter Einträge, der Cursor springt
von einem gelöschten Eintrag auf den nächsten (`cursorAfterRemoval`), Scroll bleibt. Ändert ein Delta nichts
(gleiche Werte), bleibt das Listing-Objekt gleich → kein Repaint. Berechnete Ordnergrößen bleiben erhalten.
Deltas, die während eines Ladevorgangs desselben Ordners eintreffen, werden nach dem Laden erneut angewendet
(sonst könnte ein älteres Listing sie überschreiben).

### E4 – Jobs und Überwachung ohne doppelte Arbeit ✅

`dirsChanged` der Jobs bleibt die verlässliche Quelle (auch für `off`/Netzlaufwerke). Beide Wege laufen über
`requestRefresh()`: läuft schon ein Laden, wird **ein** weiteres vorgemerkt, nie mehrere. Watcher-Deltas nach einem
Job-Neuladen sind dann No-Ops (gleiche Werte → kein Repaint). Die Temp-Dateien der Jobs (`.fnf-*.part`) sind
versteckte Dateien und erscheinen nur bei sichtbaren Hidden-Dateien kurz – wie im Listing.

### E5 – Drag & Drop in der App: eigene Pointer-Logik, immer über den Dialog ✅

- **Warum nicht HTML5-DnD / Row-Drag:** Tauri fängt mit `dragDropEnabled` (für den Drop von außen nötig) unter
  Windows die HTML5-Ereignisse ab; der Row-Drag der Table ist fürs Umsortieren gebaut. Pointer-Ereignisse
  funktionieren auf allen Plattformen und sind unter Xvfb mit `xdotool` prüfbar.
- **Start:** linke Taste auf einer Zeile (nicht `..`, nicht im F2-Editor), Bewegung > 6 px. Gezogen wird die
  **Markierung, wenn die Zeile markiert ist**, sonst nur die Zeile (Explorer/TC).
- **Ziel:** Ordnerzeile unter dem Zeiger (auch `..` = Elternordner; nicht eine der gezogenen Zeilen) → dieser Ordner;
  sonst der Ordner des Panels. Gleiches Panel ohne Ordnerzeile → kein Ziel. Ziel-Panel bzw. -Zeile wird hervorgehoben,
  am Zeiger ein Hinweis „Kopieren: 3 Einträge → Ziel“ (`role="status"`, `aria-live`).
- **Art:** ohne Modifier **Kopieren**; Verschieben mit **Shift** (Windows/Linux) bzw. **⌘** (macOS, Finder); der
  Hinweis zeigt die Art live. **Verknüpfung** (Strg+Shift / ⌥⌘) ist reserviert, aber offen – es gibt noch keine Job-Art
  „Link anlegen“ (→ 011/016).
- **Ablegen = Kopieren/Verschieben-Dialog aus 006** (vorbelegtes Ziel, Konfliktvorgabe, Enter startet) – nie direkt
  ausführen. Esc oder Loslassen ohne Ziel bricht ab. Der Klick nach dem Loslassen wird geschluckt.
- Tastatur-Alternative: F5/F6 (bestehend).

### E6 – Drop von außen: Tauri-Ereignis → Dialog ✅

`onDragDropEvent` (Fassade `DragDropApi` in `core/dnd/`): Position (physisch → `/ devicePixelRatio`) →
`elementFromPoint` → gleiche Zielauflösung wie E5, Hervorhebung bei `over`, bei `drop` → `describe_paths(paths)`
(Rust: absolut, existiert, DTO wie im Listing, gemeinsamer Elternordner) → **Kopieren**-Dialog mit Ziel = Panel bzw.
Ordner unter dem Zeiger. Das Ereignis kennt keine Modifier → immer Kopieren (Verschieben: F6 danach). Höchstens 10 000
Pfade.

### E7 – Ziehen aus der App ins System: bewusst offen ✅

Tauri 2 hat kein Kern-API für einen Drag-Source. Geprüft: `tauri-plugin-drag` / Crate `drag` (CrabNebula, MIT/Apache):
macOS `NSDraggingSession`, Windows `DoDragDrop` (OLE), Linux GTK `drag_begin`. Dagegen jetzt: das Plugin bringt einen
Command, der **beliebige Pfade** vom Frontend zum OS-Drag macht (müsste durch einen eigenen, gegen das Listing
geprüften Command ersetzt werden), drei native Pfade, die hier nur unter Linux/Xvfb (ohne echten Drag-Partner)
laufen würden, und ein zusätzliches Vorschaubild-Format. Empfehlung: in einem eigenen Schritt mit der Crate `drag`
(nicht dem Plugin) hinter `start_os_drag(paths)` (nur Pfade der aktuellen Listings) – auf dem Mac und unter Windows
prüfen. Bis dahin: Datei per „Im Finder/Explorer zeigen“ (011) oder Pfad kopieren.

## 3. Verträge

### Rust

```rust
// watch/mod.rs
enum WatchMode { Native, Poll, Off }
struct WatchStatus { dir: String, mode: WatchMode, reason: Option<String> }   // reason: "network" | "error: …"
#[serde(tag = "type")] enum WatchEvent {
  Changes { dir: String, upserted: Vec<DirEntryDto>, removed: Vec<String> },
  Rescan  { dir: String },
  Gone    { dir: String },
}
// listing.rs
pub fn stat_entry(path: &Path) -> Option<DirEntryDto>          // None = existiert nicht
```

| Command | Rückgabe / Fehler |
|---|---|
| `subscribe_watch(onEvent: Channel<WatchEvent>)` | – (ein Kanal je WebView) |
| `watch_dirs(dirs: string[], pollNetwork: bool)` | `WatchStatus[]` · `invalid_path`, `too_many` (> 8) |
| `describe_paths(paths: string[])` | `{ entries: DirEntry[], parent: string \| null, missing: number }` · `invalid_path`, `too_many` (> 10 000) |

Neuer Fehlercode `too_many` (Rust `error.rs`, `fs.models.ts`, `describeFsError`).

### TypeScript

```ts
// core/watch/
type WatchMode = 'native' | 'poll' | 'off';
interface WatchStatus { dir: string; mode: WatchMode; reason: string | null }
type WatchEvent = { type: 'changes'; dir; upserted: DirEntry[]; removed: string[] } | { type: 'rescan'; dir } | { type: 'gone'; dir };
abstract class WatchApi { subscribe(cb); watchDirs(dirs, pollNetwork): Promise<WatchStatus[]>; describePaths(paths) }
WatchService (root): setPanelDir(side, path|null) → watch_dirs (zusammengefasst), status(dir), on(dir → events)
// core/dnd/
abstract class DragDropApi { onDragDrop(cb: (e: { type: 'enter'|'over'|'drop'|'leave'; paths; x; y }) => void): Promise<() => void> }
// features/dnd/
DragStore (root): Zustand des Ziehens (Quellen, Art, Ziel), Zonen je Seite; reine Logik in dnd-logic.ts
OpsStore.openCopyMoveFor({ kind, side, sourceDir, sources, target })
FileBrowserStore.applyChanges(upserted, removed, cursorFallback) · requestRefresh()
TableBridge.rowIndexAt(element): number   // -1 = keine Zeile
```

### UI-Skizze

```
┌ links ───────────────────────┐┌ rechts ──────────────────────┐
│ ..                           ││ ..                           │
│ 📁 Fotos                     ││ 📁 Archiv   ◀── hervorgehoben │
│ ✔ a.txt   ── ziehen ──────────┼──▶  ┌───────────────────────┐ │
│ ✔ b.txt                      ││    │ Copy 2 entries → Archiv│ │ (am Zeiger, role=status)
└──────────────────────────────┘└────┴───────────────────────┴─┘
Statuszeile:  3 Dateien … · ⏸ not watched (network drive) – Ctrl+R
```

Fokus bleibt beim Ziehen im Quell-Panel; der Dialog übernimmt danach den Fokus wie bei F5.

## 4. Tests

- **Rust:** `watch/batch.rs` rein (Namen sammeln, Ruhe/Max-Latenz, Schwelle → Rescan, Rescan-Abstand, Kind-Zuordnung
  bei tieferen Pfaden, Selbst-Ereignis); `stat_entry` (Datei, Ordner, Link, dangling, fehlt, Unicode);
  `describe_paths` (Elternordner, fehlende, zu viele); Netz-Erkennung lokal = nicht Netz; **echter Watcher** mit
  tempfile: Datei anlegen/umbenennen/löschen → `changes` < 1 s; 2 000 Dateien → `rescan`; Ordner löschen → `gone`;
  Unterordner-Inhalt ändert nur das Kind.
- **Frontend:** `applyChanges` (neu, geändert, gelöscht, Cursor-Nachfolger, Markierung, Ordnergröße bleibt, No-Op,
  Re-Apply nach Laden), `requestRefresh` (zusammenfassen), `WatchService` (Vereinigung beider Seiten, Abmelden,
  Status), `dnd-logic` (Quellen aus Markierung/Zeile, Ziel-Auflösung, Art je OS-Modifier, ungültige Ziele),
  `openCopyMoveFor`.
- **E2E (Xvfb):** Datei von außen (`touch`/`mv`/`rm`) → Panel < 1 s, Cursor bleibt; 50 000 Dateien → kein Einfrieren
  (Zeit messen); Ziehen links → rechts mit `xdotool mousedown/mousemove/mouseup` → Dialog; Ordnerzeile als Ziel; Esc.
  Drop von außen: unter Xvfb ohne Dateimanager nicht echt prüfbar → nur Logik.

## 5. Annahmen

- „Konfigurierbar“ beim Polling = Parameter `pollNetwork` des Commands; Oberfläche dafür erst mit 015 (Einstellungen).
- Der Drop von außen nimmt keine Modifier entgegen (Tauri liefert keine) → immer Kopieren.
- Verknüpfungen per Drag bleiben offen, bis es eine Job-Art „Link anlegen“ gibt.
- 009/011 laufen parallel: neue Commands liegen in `commands/watch.rs` (Untermodul), um Merge-Konflikte in
  `commands.rs` klein zu halten.

## 6. Abweichungen bei der Umsetzung

- `refresh()` übernimmt jetzt den Cursor zum Zeitpunkt der **Antwort** (`keepCursor`), nicht der Anfrage: in der
  E2E-Flut (50 000 Dateien) sprang der Cursor sonst nach jedem Neuladen auf den alten Eintrag zurück (roter Test in
  `watch-changes.spec.ts`).
- WebKitGTK meldet im `keyup` einer Modifier-Taste die Taste noch als gedrückt (X11-Zustand vor dem Ereignis): die
  Button-Leiste blieb im Shift-Satz hängen, und Shift loslassen schaltete beim Ziehen nicht auf Kopieren zurück.
  `modifiersAfter()` in `shortcut.ts` (Dispatcher und Ziehen), roter Test in `keyboard-dispatcher.spec.ts`.
  Betraf vermutlich schon 002 unter Linux.
- Ein Link, dessen **Ziel** sich ändert (z. B. gelöscht), wird nicht neu gelesen – es gibt kein Ereignis für den
  Link selbst. Erst Neuladen (`Strg/⌘+R`) oder ein Job zeigt ihn als „dangling“. Bewusst so (Ziele zu überwachen
  hieße fremde Ordner zu beobachten).
- Unter Xvfb (Debug-Build, Software-Rendering) kommen Zeiger-Ereignisse mit bis zu ~1 s Verzögerung an; das Ziehen
  funktioniert, wirkt dort aber träge. Auf echter Hardware zu prüfen.

### GuiExpert Table

- **G18 – kein „Zeile unter dem Punkt“-API:** die Zielzeile wird über `data-area="body"` + `data-row-index` des
  DOM gefunden (`TableBridge.rowIndexAt`, `// G18`). Vorschlag für `mono/TODO.md`:
  `TableApi.getRowIndexAt(clientX, clientY): number` (Anzeige-Index, -1 außerhalb des Bodys).
- **G19 – kein `updateRows`/`addRows`/`removeRows`:** Deltas tauschen die Zeilen (`setRows` + `reSort` +
  `repaintHard`, bei 50 000 Zeilen spürbar, aber unkritisch). Vorschlag: `TableApi.upsertRows(rows, keyFn)` /
  `removeRows(keys)` mit Sortierung und Filter, ohne Neuaufbau.

## 7. Review

### Selbstprüfung

- Rust validiert alle Pfade (`validate_input_path`), begrenzt Ordner (8) und Drop-Pfade (10 000), blockierende
  Arbeit (`statfs`, `stat`) nie auf dem Async-Runtime-Thread (eigener Watch-Thread, `spawn_blocking`).
- Keine neuen Capabilities/Plugins; `onDragDropEvent` liegt in `core:default`. Kein Pfad wird im Frontend zerlegt
  (Drop-Elternordner rechnet Rust).
- Ablegen ist nie destruktiv: immer der Dialog aus 006 mit Konfliktvorgabe; Verschieben prüft Rust wie bei F6.
- Speicher bei Fluten begrenzt: höchstens 500 Namen je Ordner, danach nur ein Flag.
- Offen geprüft: Windows-`GetDriveTypeW`-Pfad und macOS-`MNT_LOCAL` sind ungetestet (nur Linux im Container).

### Review (separater Agent) – Ergebnis

| # | Befund | Schwere | Umgang |
|---|---|---|---|
| | | | |

## 8. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [x] Phase 2 Rust: `watch/` (batch, netfs, Hub mit notify + PollWatcher), `listing::stat_entry`/`describe_paths`,
  `commands/watch.rs`, Fehlercode `too_many` – 15 neue Rust-Tests (6 mit echtem Watcher)
- [x] Phase 3 Frontend: `WatchApi`/`WatchService`, `DragDropApi`, `FileBrowserStore.applyChanges/requestRefresh/
  goToExistingAncestor`, Statuszeilen-Hinweis, `DragStore`, `dnd-logic`, `DragGhost`, Pointer-Ziehen in `FileList`,
  `OpsStore.openCopyMoveFor` – 20 neue Frontend-Tests (`watch-changes.spec.ts`, `dnd.spec.ts`, `file-panel.spec.ts`,
  `keyboard-dispatcher.spec.ts`)
- [x] Phase 4 Ende-zu-Ende (Xvfb :98, Debug-Build, eigenes `HOME` unter `/tmp/claude-0/e2e-012`): anlegen/löschen/
  umbenennen/ändern von außen → nach < 0,6 s sichtbar, Cursor bleibt bzw. geht an den nächsten; 50 000 Dateien
  (Erzeugen 3,9 s): Zwischenstände 5 628 → 28 465 → 50 000, Endstand ~7 s nach Ende, Pfeiltasten reagieren während der
  Flut; Löschen der 50 000: nach ~2 s leer; Ordner von außen gelöscht → Panel springt zum Elternordner; Ziehen links →
  rechts (Kopieren-Dialog), auf Ordnerzeile `Archiv` (Zeile hervorgehoben, Ziel `…/Archiv`, Kopie geprüft), zwei
  markierte mit Shift (Verschieben-Dialog, beide verschoben, beide Panels aktuell), Esc bricht ab.
  Nicht prüfbar: Drop aus einem Dateimanager (kein Dateimanager unter Xvfb – nur Logik), Netzlaufwerke, macOS/Windows,
  gesperrter Ordner (als root greifen Rechte nicht), Dark-Mode nur über Tokens.
- [x] Phase 5 Doku · [x] Phase 6 Abschlussprüfung (`pnpm check`, Debug-Build), Selbstprüfung (§7)

## 9. Offen

- Ziehen aus der App ins System (E7).
- Verknüpfung per Drag (E5), Modifier beim Drop von außen (E6).
- Polling-Einstellung in der Oberfläche (015).
- Link-Ziele werden nicht beobachtet (§6).
- G18/G19 an das Mono-Repo melden.
