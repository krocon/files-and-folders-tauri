# Prompt 048: Fehlerhafte Tasks wiederholen (Retry für fehlgeschlagene Operationen)

> **Slug:** `fehlerhafte-tasks-wiederholen` · **Braucht:** 005 (Job-Engine, Tasks-Dialog), 006 (Kopieren/Verschieben/Löschen), 007 (Multi-Rename / `undo_log`-Muster), 008 (Gruppieren/Aufräumen), 016/025/035 (Archive), 024 (Attribute), 030 (`expected`), 031 (Links), 034 (Server-Transfer), 036 (Sync), 039 (Prüfsummen), 042 (Dedupe) · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/005-job-queue.design.md`, `prompts/done/006-basis-operationen.design.md`, `prompts/done/007-multi-rename.design.md` (E7) und `prompts/done/030-ordner-cache-smb.design.md` (E5).
> Auftrag & Problem-Screenshot von Marc (31.10.2026): [`048-fehlerhafte-tasks-wiederholen-beispiel.jpg`](048-fehlerhafte-tasks-wiederholen-beispiel.jpg).

## Auftrag & Problemanalyse

### Ausgangssituation (Screenshot)

Im Dialog **Tasks** (`JobListDialog`, `OPEN_TASK_DLG`) wurde ein großer Verschiebe-Auftrag auf ein SMB-Netzlaufwerk ausgeführt (`Move 3 entries → /Volumes/Media/music/Audiobooks/_todo_hoerbuch`, siehe [`048-fehlerhafte-tasks-wiederholen-beispiel.jpg`](048-fehlerhafte-tasks-wiederholen-beispiel.jpg)):

- **Status:** `Done with errors` (`JobState::DoneWithErrors`), `9406 done · 0 skipped · 7 failed`.
- **Fehlerursache:** Tief innerhalb eines der 3 verschobenen Top-Level-Ordner (`…/__todo/Andreas Franz/Andreas Franz - Julia Durant Reihe 19 - Der Panther/Andreas Franz, Daniel Holbe - Julia Durant 19 - Der Panther (ungeküzt)/Der Panther - 082.mp3` u. a.) schlugen 7 einzelne `.mp3`-Dateien wegen eines vorübergehenden Netzwerk-/SMB-Timeouts (`Operation timed out (os error 60)`) fehl.
- **UI-Lücke:** Rechts in der Spalte `Actions` steht für fertige Tasks mit Fehlern bisher nur der Knopf `[7 errors]` (`job-rows.ts`, `act: 'details'`), der lediglich die Zeile auswählt, um unten die Fehlerliste zu zeigen – **es gibt keine Aktion, um die fehlgeschlagenen Elemente (oder einen komplett fehlgeschlagenen Task `Failed`) erneut anzustoßen**. Der Nutzer müsste die 7 tief verschachtelten Dateien im Quellbaum einzeln suchen, im anderen Panel den exakt passenden Ziel-Unterordner öffnen und sie von Hand nachschieben.

### Nebenbefund aus dem Screenshot: Irreführender Fehlertext bei Datei-Timeouts

In der Fehlerliste des Screenshots steht für jede `.mp3`-Datei:

> `…/Der Panther - 082.mp3 – The folder could not be read. (Operation timed out (os error 60))`

Ursache: `FsError::from_io` (`src-tauri/src/error.rs`, Z. 148–158) bildet `io::ErrorKind::TimedOut` sowie alle sonstigen Datei-Lese-/Schreibfehler auf `FsErrorCode::Io` ab, und `FS_ERROR_TEXTS.io` / `unknown` (`src/app/core/fs/fs-error-texts.ts`, Z. 68–69, 136–137) ist auf Ordner-Listings zugeschnitten (`"The folder could not be read."` / `"Der Ordner konnte nicht gelesen werden."`) – selbst wenn beim Kopieren oder Verschieben eine **Datei** betroffen ist. Das soll hier gleich sauber mitbehoben werden (E4).

### Warum ein naiver Frontend-Retry scheitert (drei Architektur-Fallen)

1. **Falle 1 – `sources = summary.errors.map(e => e.path)` zerstört Unterordner-Pfade und Quell-Aufräumen:**
   Im Screenshot hatte `JobSpec::Move` **3 Top-Level-Ordner** als `sources` und `/Volumes/…/_todo_hoerbuch` als `target_dir`. Die 7 Pfade in `summary.errors` liegen jedoch drei Ordner-Ebenen tiefer. Ein naiver Retry `Move { sources: [7 mp3-Pfade], target_dir: "_todo_hoerbuch" }` würde die 7 Dateien **flach direkt nach `_todo_hoerbuch/Der Panther - 082.mp3`** verschieben statt in ihren relativen Ziel-Unterordner `_todo_hoerbuch/Andreas Franz/…/Der Panther (ungeküzt)/Der Panther - 082.mp3` – und die an der Quelle verbliebenen, danach leeren Elternordner würden nicht aufgeräumt (`copy.rs`, Z. 1016–1024). Hinzu kommt: Pfade sind im Frontend opak (`CLAUDE.md` §1: nie mit `/` oder `\` splitten/zusammensetzen), `Summary.errors` ist auf `MAX_REPORTED_ERRORS = 1000` gekappt, und beim Fehlschlagen eines Zielordners (`copy.rs`, Z. 863/892) steht in `ItemError.path` der **Zielpfad** `item.dst` statt `item.src`.
2. **Falle 2 – Stumpfes Neustarten der gesamten `JobSpec` bei `DoneWithErrors`:**
   - Bei **`Copy`** liegen die 9 406 erledigten Dateien weiterhin in Quelle **und** Ziel: Ein kompletter Neustart würde 9 406 Konfliktabfragen (`File already exists`) auslösen oder bereits übertragene Gigabyte erneut übers Netz kopieren.
   - Bei **`Move`** existieren komplett verschobene Top-Level-Quellen an der Quelle nicht mehr (`check_pairs` würde falsche `NotFound`-Fehler melden), und Dateien, die der Nutzer im ersten Lauf bewusst per `Skip` übersprungen hat, würden ungewollt erneut angefasst.
3. **Falle 3 – `JobState::Failed` vs. `JobState::DoneWithErrors`:**
   Endete ein Task als `Failed` (Abbruch vor/während der Planung, z. B. NAS-Volume noch nicht gemountet, Server getrennt, Archiv belegt, `0 done`), wurde noch kein Teilbaum abgearbeitet – hier muss die **gesamte ursprüngliche `JobSpec`** wiederholt werden. Bei `DoneWithErrors` hingegen darf gezielt nur die fehlgeschlagene Restarbeit laufen.

## Lösungskonzept: Typisierter `RetryPlan` im Rust-`JobManager` + Retry-Aktion im Tasks-Dialog

Die gesamte Pfad- und Restarbeits-Logik liegt – analog zu `undo_rename` / `undo_log` (`src-tauri/src/jobs/manager.rs`, Design 007 E7) – rein in Rust (`src-tauri/src/jobs/`):

- **DTO & Command-Schnittstelle:**
  - `JobInfo` erhält `retry_available: bool` (`#[serde(default)]`, synchron in `src/app/core/jobs/jobs.models.ts`), dazu `JobEvent::RetryAvailable { id: String, available: bool }` (analog `UndoAvailable`).
  - Neuer `async` Tauri-Command `retry_job(id: String) -> Result<String, FsError>` (`JobManager::retry_job`), angebunden über `JobsApi.retry(id)` und `JobsStore.retry(id)`. Gibt die `id` des neu eingereihten/gestarteten Tasks zurück.
- **Zwei Retry-Modi im Backend (`RetryPlan`, nur im Rust-Speicher, kein IPC-Overhead):**
  1. **Gesamt-Retry (`JobState::Failed` sowie atomare Ganz-Jobs):**
     - Jeder sichtbare Nicht-Helper-Task (`!spec.is_helper()`), der mit `JobState::Failed` endet, speichert seine normalisierte `JobSpec` als `RetryPlan`.
     - Dasselbe gilt bei `DoneWithErrors` für atomare Ganz-Archiv-/Listen-Jobs (`Pack`, `ArchiveAdd`, `ArchiveDelete`, `ArchiveMkdir`, `VerifyChecksums`, `ViewEntry` sowie `Checksum` mit `ChecksumOutput::List`, da eine gemeinsame Prüfsummen-Listendatei alle Pfade enthalten muss).
  2. **Gezielter Teil-Retry nur der fehlgeschlagenen Elemente (`JobState::DoneWithErrors`):**
     - **Lokales `Copy` / `Move` (`copy.rs`) und Server-Transfer (`transfer.rs`):**
       Während des Laufs sammelt der Worker die tatsächlich fehlgeschlagenen Paare `(src, dst)` (bis zu einer großzügigen Speichergrenze wie `MAX_RETRY_ITEMS = 100_000`, unabhängig von `MAX_REPORTED_ERRORS = 1_000`):
       - Schlug eine Datei / ein Symlink fehl (inkl. `Move`, bei dem die Zielkopie gelang, aber `remove_entry(&src)` fehlschlug) → exaktes Paar `(item.src, item.dst)` merken; fehlende Ziel-Elternordner werden beim Retry vorab als echte Ordner sichergestellt.
       - Schlug bereits das Lesen eines Quellordners (`check_pairs` / `walk`) oder das Anlegen eines Zielordners (`failed_dirs`, wodurch dessen Kinder als `items_skipped` gezählt wurden) fehl → das Ordner-Paar `(dir_src, dir_dst)` merken, sodass der Retry diesen Teilbaum frisch traversiert und alle darunterliegenden Einträge nachholt.
       - Vom Nutzer im Konfliktdialog bewusst übersprungene Einträge (`Decision::Skip` bzw. `OverwriteIfNewer` bei nicht neuerer Quelle) landen **nicht** im `RetryPlan`.
       - **Quellordner-Aufräumen bei `Move`:** Für `Move` speichert der `RetryPlan` zusätzlich die Kette der Quell-Elternordner zwischen den ursprünglichen Top-Level-`sources` und den fehlgeschlagenen Einträgen (samt ihrer Datei-IDs / ohne Symlinks zu folgen). Nach dem Verschieben der Retry-Elemente entfernt der Job diese Ordner von unten nach oben per `remove_dir` (bzw. Server-`rmdir`), sofern sie nun leer sind – genau wie `copy.rs` Z. 1016–1024. Im Screenshot-Fall verschwindet damit nach dem Nachholen der 7 `.mp3`-Dateien auch der leere Quellordner-Baum `Andreas Franz/…`, während Ordner mit bewusst übersprungenen Dateien stehen bleiben.
       - Die sichtbare `JobInfo.spec` des Retry-Tasks bleibt eine normale `JobSpec::Copy` / `JobSpec::Move` (mit den fehlgeschlagenen Quellpfaden als `sources` und dem ursprünglichen `target_dir` + `options`), sodass `jobTitle` (z. B. `Move 7 entries → /Volumes/Media/music/Audiobooks/_todo_hoerbuch`), `touched_paths()`, `changed_paths()`, `target_dirs()`, Watcher-Pausierung und `start_now`-Überlappungsprüfung ohne Sonderfälle greifen.
     - **`Group` (`group.rs`):** Teilmenge der fehlgeschlagenen `GroupItem`s (`{ path, group }` enthält den Ziel-Gruppenordner bereits).
     - **`Delete` (`delete.rs`, `remote_delete.rs`):** Fehlgeschlagene Pfade (bei `Trash` die fehlgeschlagenen Top-Level-`paths`; bei `Permanent` die fehlgeschlagenen Einträge samt anschließendem Aufräumen nun leerer Elternordner bis zu den ursprünglichen `paths`; passende `expected`-Einträge bleiben erhalten).
     - **Übrige Element-Listen-Jobs:**
       - `Rename`: fehlgeschlagene `RenameItem`s (erzeugt für die im Retry erfolgreichen Umbenennungen regulär wieder einen `undo_log`-Eintrag).
       - `Clean`: fehlgeschlagene `CleanItem`s (Kinder vor Eltern, mit voller `clean::verify`-Prüfung).
       - `Sync`: fehlgeschlagene `SyncOp`s (mit voller `sync`-Sicherheitsprüfung).
       - `Dedupe`: `DedupeGroup`s gefiltert auf ihre fehlgeschlagenen `remove`-Einträge (mit unverändertem `keep` und voller `dedupe`-Prüfung).
       - `Extract`: fehlgeschlagene Archiv-`entries` (mit denselben `target_dir`-, `into_subfolder`- und `options`-Werten).
       - `Link`: fehlgeschlagene `sources` (`rename_to` bleibt bei genau 1 Quelle erhalten).
       - `Checksum` (`PerFile` / `Show`): fehlgeschlagene `paths`.
       - `Attributes`: fehlgeschlagene `paths` / Teilbäume.
- **Speicher- & Sicherheitsgrenzen:**
  - `retry_log` im `JobManager` wird beim Entfernen fertiger Tasks (`clear_finished`) bereinigt und zusätzlich durch eine feste Obergrenze (z. B. `RETRY_LOG_SIZE = 50`, älteste Einträge setzen `retry_available = false`) begrenzt.
  - Überschreitet ein extrem großer Lauf `MAX_RETRY_ITEMS`, fällt der `RetryPlan` kontrolliert zurück (z. B. kein Teil-Plan / Gesamt-Retry nur wo sicher, dokumentiert im Design).
  - Keine Sicherheitsprüfung (`normalize`, `validate`, `DangerCheck`, `expect` 030 E5, `dedupe` 042 E5, `clean` 008 E3, `sync` 036 E4, `.part`-Tempdateien) wird für einen Retry umgangen.
- **UI im Dialog `Tasks` (`job-list-dialog.ts`, `job-rows.ts`, `job-table.ts`):**
  - **Spalte `Actions`:** Zeilen mit `job.retryAvailable` zeigen neben `[7 errors]` / `[Details]` (und ggf. `[Undo]`) einen primären Knopf **`[Retry]` / `[Wiederholen]`** (`act: 'retry'`, `slot: 'retry'`, `look: 'primary'`). Die bestehende Spaltenbreite (`320px`) und Fokus-Wiederherstellung per `data-job` + `data-slot` (`JobTable.swapRows`) bleiben gewahrt.
  - **Detailbereich unten:** Neben der Fehlerüberschrift (`7 errors` bzw. bei `summary.error`) steht ebenfalls ein Knopf (`Retry failed` / `Fehlgeschlagene wiederholen` bei `doneWithErrors`, `Retry` / `Wiederholen` bei `failed`), damit man direkt nach dem Lesen der Fehlermeldungen starten kann.
  - Klick auf `Retry` startet `jobs.retry(id)`, setzt im Dialog `selected.set(newId)` auf den neuen Task und deaktiviert `retryAvailable` am alten Task (bzw. ersetzt ihn gemäß E1).

## Aufgaben

1. **Bestand prüfen & Design (`prompts/048-fehlerhafte-tasks-wiederholen.design.md` 🛑):**
   - `src-tauri/src/jobs/mod.rs`, `manager.rs` (`finish`, `undo_log` / `undo_rename`, `clear_finished`, `start_now`), `copy.rs`, `transfer.rs`, `delete.rs`, `remote_delete.rs`, `group.rs`, `rename.rs`, `clean.rs`, `sync.rs`, `dedupe.rs`, `extract.rs`, `link.rs`, `checksum.rs`, `attributes.rs`, `archive_write.rs`, `pack.rs`,
   - `src-tauri/src/error.rs` & `src/app/core/fs/fs.models.ts`, `fs-error.ts`, `fs-error-texts.ts`,
   - `src/app/core/jobs/jobs.models.ts`, `jobs-api.ts`, `jobs.store.ts`,
   - `src/app/features/jobs/job-rows.ts`, `job-table.ts`, `job-list-dialog.ts`, `job-list-dialog.css`, `job-format.ts`, `job-format.de.ts`.

2. **Fehlercodes & Fehlertexte schärfen (`error.rs`, `fs.models.ts`, `fs-error.ts`, `fs-error-texts.ts`):**
   - `io::ErrorKind::TimedOut` in `FsError::from_io` auf einen passenden Fehlercode abbilden (z. B. `FsErrorCode::TimedOut`, E4), damit SMB-/Netzwerk-Timeouts (`os error 60`) klar als Zeitüberschreitung benannt werden.
   - `FS_ERROR_TEXTS.io` und `unknown` (en/de) neutral formulieren, sodass Datei-Operationen nicht mehr fälschlich `"The folder could not be read."` / `"Der Ordner konnte nicht gelesen werden."` melden (bestehende Tests auf den Wortlaut prüfen und anpassen).

3. **Rust-Backend – `RetryPlan` & `JobManager::retry_job` (Phase 2):**
   - `JobInfo.retry_available: bool`, `JobEvent::RetryAvailable { id, available }` und Fehlercode für nicht (mehr) verfügbaren Retry (z. B. `RetryUnavailable` oder Wiederverwendung/Abgrenzung zu `UndoUnavailable` im Design klären) ergänzen.
   - In `copy.rs` und `transfer.rs` einen Modus/Einstieg für paarweisen Retry `(src → exact_dst)` + optionales Bottom-up-Aufräumen geleerter Quell-Elternordner (`Move`) ergänzen, ohne bestehenden Normal- und `Sync`-Code (`run_targets`) zu duplizieren.
   - Fehlgeschlagene Elemente in den Job-Runnern erfassen, `RetryPlan` für `Failed` und `DoneWithErrors` über alle Nicht-Helper-`JobSpec`-Varianten bauen, im `JobManager` begrenzt ablegen und bei `clear_finished` mitaufräumen.
   - `JobManager::retry_job(&self, id: &str) -> Result<String, FsError>` implementieren und als `#[tauri::command(async)] pub fn retry_job` in `commands.rs` + `lib.rs` registrieren.

4. **Frontend – Store, Tabelle & Detailbereich (Phase 3):**
   - DTOs (`JobInfo.retryAvailable`, `JobEvent` `'retryAvailable'`, ggf. neuer `FsErrorCode`) in `jobs.models.ts` / `fs.models.ts` synchronisieren; `JobsApi.retry(id)` + `JobsStore.retry(id)` ergänzen (inkl. Event-Verarbeitung in `JobsStore.apply` und Statusmeldung, falls ein Retry-Task später bei geschlossenem Dialog wieder mit Fehlern endet).
   - `job-rows.ts`: `JobAct` um `'retry'` erweitern; in `buttonsOf` für fertige Tasks mit `job.retryAvailable` den Retry-Knopf vor `[n errors]` / `[Details]` einreihen.
   - `job-list-dialog.ts` / `.css`: `case 'retry'` verdrahten (`selected.set(newId)`), im Detailbereich neben der Fehleranzeige ebenfalls einen Retry-Knopf anbieten; in `detail()` bei automatischer Vorauswahl unretried Problem-Tasks (`j.retryAvailable`) bevorzugen.
   - Falls ein `extract`-Task wegen `archive_password_required` / `archive_password_wrong` fehlschlug, beim Klick auf `Retry` im Tasks-Dialog (analog `ArchiveStore`) den Passwort-Dialog öffnen bzw. nach Passworteingabe erneut starten.
   - Zweisprachige Texte in `job-format.ts` + `job-format.de.ts` und `fs-error-texts.ts` ergänzen.

5. **Doku & Abschluss:**
   - `docs/architecture.md`, `docs/features.md`, `docs/roadmap.md`, `CLAUDE.md` und `prompts/README.md` nachziehen.

## Entscheidungsfragen fürs Design (Phase 1 🛑)

- **E1 Umgang mit der alten Fehlerzeile nach Klick auf „Wiederholen“:**
  _(a, empfohlen analog `undo_rename`)_ Der ursprüngliche Task (z. B. `9406 done · 7 failed`) bleibt als Protokollzeile in der Tabelle sichtbar, verliert aber `retryAvailable` (kein versehentlicher Doppel-Retry; Auswahl und `detail()` wechseln auf den neuen Retry-Task; `Fertige entfernen` räumt später alles auf) – oder _(b)_ der Klick auf `Wiederholen` entfernt die alte Fehlerzeile sofort zugunsten des neuen Retry-Tasks?
- **E2 Abgebrochene Tasks (`JobState::Cancelled`):**
  `Wiederholen` bewusst **nur** bei Fehlern (`Failed` und `DoneWithErrors`) anbieten – oder auch für vom Nutzer abgebrochene Tasks (`Cancelled`)? _(Hinweis: Bei einem Abbruch mitten im Lauf sind die noch nicht besuchten Einträge keine Fehler; ein Teil-Retry wäre dort unvollständig.)_
- **E3 Granularität im Detailbereich:**
  Genügt ein Retry-Knopf pro Task (in der Spalte `Actions` + oben an der Fehlerliste im Detailbereich für **alle** fehlgeschlagenen Einträge dieses Tasks), oder soll zusätzlich an einzelnen Einträgen der Fehlerliste (`ul.errors`) ein Einzel-Retry-Knopf erscheinen?
- **E4 Fehlercode & Text für Timeouts / Datei-I/O:**
  Eigenen `FsErrorCode::TimedOut` für `io::ErrorKind::TimedOut` einführen (`"The operation timed out."` / `"Zeitüberschreitung beim Dateizugriff."`) und `FS_ERROR_TEXTS.io` / `unknown` neutral formulieren (`"Read or write error."` / `"Lese- oder Schreibfehler."` statt `"Der Ordner konnte nicht gelesen werden."`)?

## Akzeptanzkriterien

1. **Marcs Screenshot-Szenario (`Move` tiefer Ordnerbaum mit einzelnen Fehlern):**
   Ein `Move` von 3 Quellordnern in einen Zielordner verschiebt viele Dateien erfolgreich, während einzelne tief verschachtelte Dateien wegen eines vorübergehenden Fehlers scheitern (`Done with errors`). Nach Behebung der Fehlerursache verschiebt ein Klick auf `Wiederholen` / `Retry` **ausschließlich** die fehlgeschlagenen Dateien in ihre **exakten relativen Ziel-Unterordner** (nicht flach in `target_dir`) und entfernt danach die nun vollständig geleerten Quell-Ordner bis hinauf zu den ursprünglichen Quellordnern.
2. **Kein erneutes Kopieren & keine falschen Konflikte bei `Copy` (`DoneWithErrors`):**
   Schlagen beim Kopieren eines Ordners mit 100 Dateien 3 Dateien fehl (`97 done · 3 failed`), kopiert `Wiederholen` nur diese 3 Dateien in ihre jeweiligen Ziel-Unterordner – ohne die 97 bereits kopierten Dateien erneut zu kopieren oder für sie Konfliktdialoge zu öffnen.
3. **Bewusst übersprungene Einträge (`Skip`) bleiben unberührt:**
   Hat der Nutzer während eines `Copy`- oder `Move`-Tasks Konflikte mit `Skip` beantwortet (`itemsSkipped > 0`) und andere Dateien schlugen mit I/O-Fehlern fehl (`itemsFailed > 0`), wiederholt `Wiederholen` nur die fehlgeschlagenen Einträge – nicht die bewusst übersprungenen; Quellordner, in denen übersprungene Dateien liegen, werden beim `Move`-Retry nicht gelöscht.
4. **Fehlgeschlagener Ziel-/Quellordner beim Teil-Retry:**
   Konnte während `Copy`/`Move` ein ganzer Unterordner nicht gelesen oder am Ziel nicht angelegt werden, holt `Wiederholen` den gesamten Unterordner samt Inhalt nach.
5. **Komplett fehlgeschlagener Task (`JobState::Failed`):**
   Schlägt ein Task schon beim Start/Planen fehl (z. B. Zielordner war vorübergehend nicht erreichbar), startet `Wiederholen` die gesamte `JobSpec` erneut, sobald das Ziel wieder da ist.
6. **Weitere Task-Arten & Queue-Verhalten:**
   `Delete` (Papierkorb & endgültig), Server-`Copy`/`Move`/`Delete` (034), `Rename`, `Group`, `Clean`, `Sync`, `Dedupe`, `Extract`, `Link`, `Checksum` und `Attributes` bieten bei Fehlern ebenfalls `Wiederholen` an; der neue Retry-Task läuft regulär durch die Queue (inkl. `[Sofort starten]` mit Überlappungswarnung, Pause, Abbruch, Konfliktdialog und `DirsChanged`-Panel-Reload) und verletzt keine Sicherheitsprüfung (`expect`, `dedupe`, `clean`, `sync`).
7. **Verständliche Fehlermeldung bei Datei-Timeouts:**
   Ein `io::ErrorKind::TimedOut` (wie `os error 60` auf macOS/SMB) auf einer `.mp3`-Datei zeigt im Tasks-Dialog keine Ordner-Fehlermeldung (`"The folder could not be read."`) mehr, sondern benennt die Zeitüberschreitung bzw. den Lese-/Schreibfehler korrekt auf Englisch und Deutsch.

## Tests

- **Rust (`cargo test`, mit `tempfile`):**
  - `copy` / `manager`: `Move` eines mehrstufigen Ordnerbaums (`force_copy_on_move`), bei dem einzelne tiefe Dateien im ersten Lauf fehlschlagen (z. B. über Rechte / blockierenden Zielnamen) → `DoneWithErrors`, `retry_available == true` → nach Behebung `retry_job(&id)` → tiefe Dateien landen im exakten relativen Ziel-Unterordner, Quell-Elternordner sind entfernt, bereits im ersten Lauf verschobene Geschwister-Top-Level-Ordner erzeugen kein `NotFound`.
  - `Copy` mit 1 erledigten, 1 per `Decision::Skip` übersprungenen und 1 fehlgeschlagenen Datei → `retry_job` kopiert nur die fehlgeschlagene Datei (keine Konfliktabfrage für die erledigte, kein Nachholen der übersprungenen).
  - Fehlgeschlagener Unterordner (`create_dir` / unlesbarer Quell-Unterordner) → `retry_job` holt den Unterordner samt Kindern nach.
  - `JobState::Failed` (z. B. `target_dir` fehlt beim ersten Lauf, existiert beim zweiten) → `retry_job` wiederholt die ganze `JobSpec` bis `JobState::Done`.
  - Stichproben für Listen-basierte Specs (`Delete`, `Rename` inkl. eigenem `undo_available` auf dem Retry-Job, `Group`, `Sync`, `Dedupe` verweigert weiterhin zwischenzeitlich veränderte Dateien) sowie `clear_finished` / Doppel-Aufruf von `retry_job` (liefert klaren Fehler, kein zweiter Lauf).
  - `error.rs`: `io::ErrorKind::TimedOut` wird auf den neuen/passenden `FsErrorCode` abgebildet.
- **Frontend (Vitest):**
  - `job-rows.spec.ts` / `job-format.spec.ts`: Retry-Button erscheint genau bei `retryAvailable` (neben `n errors` und ggf. `Undo`), Label/Aria-Label in en/de, Fokus-Slot `'retry'`.
  - `dialogs.spec.ts` (`JobListDialog`): Klick auf `Retry` in der Tabellenzeile sowie im Detailbereich ruft `jobs.retry(id)` auf und selektiert den neuen Task; `detail()` bevorzugt unretried Fehler-Tasks.
  - `jobs.store.spec.ts`: Snapshot + `RetryAvailable`-Event aktualisieren `retryAvailable`.
  - `catalogs.spec.ts`: vollständige Übersetzungen en/de (`job-format` + `fs-error-texts`).
- **E2E unter Xvfb:**
  - Kopier-/Verschiebe-Task mit provoziertem Teilfehler (`Done with errors`) im `Tasks`-Dialog prüfen → `[Wiederholen]` / `[Retry]` klicken → neuer Task läuft auf `100 %` / `Fertig`, Datei liegt im richtigen Ziel-Unterordner und das Ziel-Panel aktualisiert sich automatisch.

## Nicht in diesem Prompt

- Automatische Hintergrund-Retries mit Backoff während eines laufenden Kopiervorgangs (ein Netzwerk-Hänger soll sichtbar gemeldet und bewusst vom Nutzer angestoßen werden, statt endlos im Hintergrund zu blockieren).
- Persistenz von `RetryPlan`s über einen kompletten App-Neustart hinweg (analog `undo_log`: gilt für die laufende Sitzung).

