# Prompt 029: Bedienbar bleiben bei langen Jobs und langsamen Laufwerken

> **Slug:** `reaktionsfaehig-bei-jobs` · **Braucht:** 001, 005, 006, 012 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`.
> Anlass: Marcs Beobachtung vom 20.10.2026 – beim Kopieren einer 15-GB-Datei auf ein langsames Laufwerk
> (~14 MB/s) ist die UI „manchmal nicht nutzbar“; das Ziel-Panel zeigt minutenlang immer wieder „Loading…“.
> Grundlage: Code-Analyse vom selben Tag (unten „Befund“). Verwandte Entscheidungen: `prompts/012-ueberwachung-drag-drop.design.md`
> (E2–E4: Watcher, Entprellen, „höchstens ein Reload“), `prompts/005-job-queue.design.md` (Fortschritt, Drosselung),
> `prompts/001-guiexpert-dateiliste.design.md` (Overlay, `TableBridge`).

## Ziel

Während ein langer Job läuft – vor allem ein Kopieren/Verschieben auf ein langsames USB- oder Netzlaufwerk – bleibt
die ganze App bedienbar: beide Panels reagieren auf Maus und Tastatur, ein Panel auf dem ausgelasteten Laufwerk
zeigt seine bisherige Liste weiter, und ein Ordnerwechsel, der lange dauert, lässt sich erkennen und abbrechen. Die
Kopie selbst belastet Laufwerk und System nicht mehr als nötig.

## Befund (Analyse 20.10.2026)

Der Main-Thread friert **nicht** ein: Die Kopie läuft in einem eigenen Thread (`fnf-job-*`), Fortschritt ≤ 10/s
(`jobs/report.rs`), Listing/Watcher/Vorschau über `spawn_blocking`, Manager-Locks werden nie während I/O gehalten.
Unbedienbar wird das **Panel** auf dem ausgelasteten Laufwerk:

1. **Hintergrund-Reloads zeigen das blockierende Overlay.** `FileBrowserStore.refresh()` ruft `load()` →
   `loading = true` → `[loading]` der Table → Overlay „Loading…“ mit dem Default `blockInteractionWhileLoading: true`
   (Table ignoriert Mausereignisse im Body). Auslöser: Watcher-`rescan`, Job-`dirsChanged` (≤ alle 500 ms), der
   nachgeholte Reload nach einem Load. Auf dem ausgelasteten Laufwerk braucht `list_directory` Sekunden → das Panel
   ist öfter gesperrt als bedienbar.
2. **Der Watcher des Zielordners erzeugt Reloads.** Eigene `.fnf-*.part`-Dateien werden schon ignoriert
   (`watch/batch.rs::is_own_temp`). Aber: FSEvents meldet unter Last `MustScanSubDirs` (`need_rescan`) → `touch_all`
   → Rescan **beider** Panels; Ereignisse am Ordner selbst (`SelfChanged`) sind nicht durch `RESCAN_GAP` gedrosselt;
   ein Netzlaufwerk im Poll-Modus (`PollWatcher`, alle 2 s, bis 20 000 Einträge) stat't den ganzen Ordner auf dem
   Laufwerk, das gerade beschrieben wird.
3. **Ein langsames Listing ist weder erkennbar noch abbrechbar.** Tab gewechselt, Pfadzeile zeigt noch den alten
   Ordner, nur ein Spinner – bis Rust antwortet.
4. **Die Kopie belastet mehr als nötig.** 64-KiB-Blöcke (`jobs/copy.rs::BLOCK`), Schreiben durch den Datei-Cache:
   15 GB verdrängen auf macOS den Cache des ganzen Systems; viele kleine Schreibaufträge halten die Warteschlange des
   Ziellaufwerks voll.
5. **Kleinere Punkte:** (a) die synchronen Job-Commands (`start_job`, `cancel_job`, `pause_job`, `resume_job`,
   `resolve_conflict`, `list_jobs`, `clear_finished_jobs`, `undo_rename`, `check_paths`, `cancel_clean_scan`) laufen in
   Tauri 2 auf dem Main-Thread – heute harmlos, aber nur solange niemand dort I/O einbaut; (b) der Watcher ist **ein**
   Thread, `resolve()` stat't geänderte Namen und den Ordner selbst – hängt das Laufwerk, kommen auch die Ereignisse
   des anderen Panels verspätet; (c) die Task-Zeile bricht „1.0 GB of 15 GB · 14 MB/s · 17:08 left“ in drei Zeilen um.

## Aufgaben

### A. Hintergrund-Reload ohne Sperre (Befund 1) – Kern

- `FileBrowserStore` trennt **Navigation** (`load` mit neuem Ziel: Overlay erlaubt) von **Auffrischen** (`refresh`
  desselben Ordners durch Watcher/Job/Ctrl+R): beim Auffrischen bleibt die bisherige Liste sichtbar und bedienbar,
  kein Overlay; eigenes Signal (z. B. `refreshing`) für einen dezenten Hinweis (Statuszeile), Ergebnis wie heute per
  Request-Sequenz, Cursor/Marken bleiben.
- Navigation: Overlay erst nach Verzögerung (heute 150 ms) und **nicht blockierend**
  (`overlayOptions.blockInteractionWhileLoading: false` – die alte Liste darf weiter bedient werden; eine Aktion auf
  der alten Liste ist gültig, weil Pfade opak und absolut sind). Entscheiden und begründen.
- **Adaptive Drossel** für Auffrischen: frühestens `max(1 s, 2 × Dauer des letzten Listings)` nach dem Ende des
  letzten, höchstens einer wartet (bestehende Regel „höchstens ein Reload“ aus 012 E4 bleibt).
- Watcher-Deltas während eines Auffrischens wie bisher puffern (`deltasDuringLoad`).

### B. Watcher unter Last (Befund 2)

- `need_rescan` ohne Pfad trifft nur Ordner, deren Watcher das betrifft (FSEvents-Stream ist je Watcher – prüfen,
  was notify liefert; sonst bleibt `touch_all`, aber mit `RESCAN_GAP`).
- `RESCAN_GAP` gilt auch für `SelfChanged` ohne Identitätswechsel (der Ordner wurde nicht ersetzt).
- **Ordner, in die ein laufender Job schreibt** (Ziel von Copy/Move/Extract/Pack/Group; neue Methode wie
  `JobSpec::target_dirs()`): ihr Watcher meldet Einzeländerungen weiter, Rescans werden aber bis zum Jobende
  zurückgehalten (ein Rescan danach); ein **Poll**-Watch solcher Ordner pausiert für die Dauer des Jobs (Mechanik
  `pause_under`/`resume` – sie ist heute nur unter Windows aktiv, das neue Guard gilt auf allen Plattformen). Der Job
  meldet seine Änderungen ohnehin per `dirsChanged`.
- Tests in `watch/batch.rs` (rein) und `jobs/tests_ops.rs` (Guard wird für Ziele gerufen und wieder gelöst, auch bei
  Abbruch und Panik).

### C. Langsames Listing erkennbar und abbrechbar (Befund 3)

- Dauert eine Navigation länger als ~2 s: Hinweis im Panel („Ordner antwortet langsam …“ / „Folder is slow to
  respond…“, Live-Region) mit **Abbrechen**. Abbrechen (Knopf oder `Esc` im Panel, als Aktion – keine eigenen
  `keydown`-Handler außer im Widget) verwirft die Anfrage (`supersede`) und lässt die bisherige Liste stehen.
- Tab-Wechsel: Tab, Pfadzeile und Liste müssen zusammenpassen – während der Ordner des neuen Tabs lädt, zeigt die
  Pfadzeile das Ziel (gedimmt/„lädt“), nicht den alten Ordner. Abbrechen nach einem Tab-Wechsel entscheiden (zurück
  zum vorigen Tab oder Tab behält leere Liste mit Hinweis + „Erneut versuchen“) – im Design festlegen.
- Rust kann ein hängendes `read_dir` nicht abbrechen; der blockierende Thread läuft aus. Sicherstellen, dass
  wiederholtes Navigieren auf ein hängendes Laufwerk nicht unbegrenzt Threads stapelt (z. B. ein Listing je Ordner
  gleichzeitig; eine zweite Anfrage für denselben Ordner hängt sich an die laufende).

### D. Kopie schonender (Befund 4)

- Blockgröße für Copy/Move/Extract größer (1 MiB; begründen/messen), Abbruch/Pause weiter je Block prüfbar
  (bei 1 MiB und 1 MB/s ≤ 1 s Reaktionszeit – akzeptabel? sonst kleinere Blöcke bei langsamen Raten).
- Datei-Cache umgehen bzw. entlasten, plattformspezifisch hinter `platform/`: macOS `F_NOCACHE` auf Quelle und Ziel,
  Linux `posix_fadvise(POSIX_FADV_DONTNEED)` nach dem Schreiben bzw. für die Quelle, Windows vorerst nichts (dokumentieren).
  Dafür ggf. Crate `libc` (in `docs/architecture.md` begründen) – Kopie muss ohne diese Hinweise genauso korrekt sein.
- Messung im Container: Durchsatz und Dauer einer 1–2-GB-Kopie vorher/nachher (lokal, tmpfs/Platte) im Bericht.

### E. Kleinere Punkte (Befund 5)

- (a) Synchrone Commands als `#[tauri::command(async)]` (laufen dann auf dem Runtime-Pool, nicht auf dem
  Main-Thread); Regel in `CLAUDE.md` §4 ergänzen: „Commands immer `async` bzw. `(async)`“ + Test/Check, der neue
  synchrone Commands findet (z. B. Spec über `commands*.rs`).
- (b) Watcher: das Stat'en in `resolve()` darf andere Ordner nicht aufhalten – z. B. Auflösen je Ordner in einem
  kleinen Worker mit „höchstens eine Auflösung je Ordner gleichzeitig“, Ergebnisse in Reihenfolge je Ordner. Im
  Design abwägen (Komplexität vs. Nutzen); Minimum: der Lock `watchers` wird nicht während `statfs`/`watch` auf einem
  Laufwerk gehalten, das ein anderer Aufruf braucht – dokumentieren, wenn bewusst so belassen.
- (c) Task-Liste: Zahlen einer Zeile („1.0 GB of 15 GB · 14 MB/s · 17:08 left“) brechen nicht mitten im Wert um;
  Pfad bekommt den Rest (Ellipse), schmale Fenster: Zahlen in eigener Zeile.

## Testbarkeit (langsames Laufwerk im Container)

Im Container gibt es kein langsames Laufwerk. Deshalb ein **nur im Debug-Build** aktiver Testschalter (Umgebungs-
variable, z. B. `FNF_TEST_SLOW=<pfad-präfix>:<listing-ms>:<block-ms>`, `#[cfg(debug_assertions)]`, nie im
Release, in `docs/architecture.md` dokumentiert): verzögert `list_directory` und das Schreiben je Block unter dem
Präfix. Damit E2E unter Xvfb: Kopie auf das „langsame“ Ziel, währenddessen in beiden Panels klicken, navigieren,
Tabs wechseln, abbrechen.

## Akzeptanzkriterien

1. Während eine Kopie in den Ordner des rechten Panels schreibt, lassen sich **beide** Panels jederzeit mit Maus und
   Tastatur bedienen (Cursor bewegen, markieren, Ordner öffnen, Kontextmenü); das rechte Panel zeigt kein
   blockierendes „Loading…“ beim Auffrischen.
2. Die Liste des Zielordners aktualisiert sich während der Kopie (neue Dateien erscheinen) – höchstens etwa alle
   `max(1 s, 2 × Listing-Dauer)`; nach Jobende ist sie vollständig (ein Rescan).
3. Ein Ordnerwechsel auf das „langsame“ Laufwerk zeigt nach ~2 s „Ordner antwortet langsam …“ mit Abbrechen; `Esc`
   bzw. der Knopf bricht ab, die vorige Liste bleibt bedienbar. Pfadzeile und Tab passen jederzeit zur Anzeige.
4. Wiederholtes Navigieren in einen hängenden Ordner stapelt keine Threads (ein laufendes Listing je Ordner).
5. Kopie mit größeren Blöcken und Cache-Hinweisen ist nicht langsamer als vorher (Messung), Pause/Abbruch reagieren
   weiterhin innerhalb von ~1 s; alle bestehenden Kopier-Tests grün.
6. Keine synchronen `#[tauri::command]` mehr; ein Test schlägt fehl, wenn einer dazukommt.
7. Task-Zeile: Zahlen ohne Umbruch im Wert, auch bei 900 px Fensterbreite.
8. `pnpm check` grün, Debug-Build gebaut, E2E unter Xvfb mit Testschalter (Screenshots beschreiben).

## Review-Schwerpunkte

- Veraltete Antworten: Auffrischen und Navigieren überholen sich nicht falsch (Sequenzen, Abbruch, Tab-Wechsel).
- Watcher: keine verlorenen Änderungen (zurückgehaltener Rescan kommt sicher, auch bei Abbruch/Panik des Jobs;
  Pause/Resume-Zähler mit überlappenden Jobs).
- Kopie: Korrektheit bei `F_NOCACHE`/`fadvise`-Fehlern (nur Hinweise, nie Abbruch), Abbruch-Latenz.
- Testschalter wirklich nur im Debug-Build.

## Freigabe

Marc hat am 20.10.2026 den autonomen Durchlauf freigegeben („arbeite selbständig“): Das Design-Dokument wird
geschrieben, aber **nicht** auf Freigabe gewartet. Entscheidungen im Design begründen, Abweichungen im Bericht nennen.
Push des Branches ist erlaubt (`CLAUDE.md` §7), Merge nach `main` macht Marc.

## Nicht in diesem Prompt

- Echte Abbrechbarkeit von `read_dir` im Kernel (geht nicht portabel).
- Drosselung der Kopierrate durch den Nutzer (Bandbreitenlimit) – mögliche Folgeidee.
- Windows-spezifische Cache-Hinweise (`FILE_FLAG_SEQUENTIAL_SCAN`/`NO_BUFFERING`) – nur dokumentieren.
