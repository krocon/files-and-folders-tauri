# Design 048: Fehlerhafte Tasks wiederholen

> **Status:** umgesetzt (selbständig entschieden, Marc 02.11.2026: keine Haltepunkte) · **Datum:** 2026-11-02
> Auftrag: [`048-fehlerhafte-tasks-wiederholen.md`](048-fehlerhafte-tasks-wiederholen.md)
> **Phasen:** 1 Design · 2 Rust (Fehlercodes + Retry) · 3 Frontend · 5 Doku. Ende-zu-Ende (Phase 4) war in dieser
> Sitzung nicht möglich (kein Fenster) – offen.

## Entscheidungen

| | Frage | Entscheidung |
|---|---|---|
| E1 | Alte Fehlerzeile nach „Wiederholen“ | **(a)** Die Zeile bleibt als Protokoll stehen, verliert `retryAvailable` (Event `retryAvailable: false`); Auswahl springt auf den neuen Task. Schlägt der Start fehl, bleibt der Plan erhalten (wie `undo_rename`). |
| E2 | Abgebrochene Tasks | **Nein** – nur `failed` und `doneWithErrors`. Nach einem Abbruch sind nicht besuchte Einträge keine Fehler; ein Teil-Retry wäre unvollständig, ein Gesamt-Retry bei Copy/Move gefährlich (Konflikte, doppelte Arbeit). |
| E3 | Granularität | **Ein Knopf je Task** (Spalte Actions + Detailbereich). Kein Einzel-Retry je Fehlerzeile: die Liste ist auf 1000 gekappt, der Plan nicht. |
| E4 | Timeout-Code & Texte | **Ja**: `FsErrorCode::TimedOut` (`timed_out`) für `io::ErrorKind::TimedOut`; `io`/`unknown` neutral („Read or write error.“ / „Lese- oder Schreibfehler.“). |
| E5 | Fehlercode „kein Retry“ | Eigener Code `retry_unavailable` (nicht `undo_unavailable` – anderer Text, andere Ursache). |

## Bestand (Baustein → wofür → Befund)

| Baustein | wofür | Befund |
|---|---|---|
| `JobManager::undo_log` / `undo_rename` | Muster | übernommen als `retry_log` (`RETRY_LOG_SIZE = 50`) + `retry_job` |
| `Summary.errors` | Fehlerliste | auf 1000 gekappt → nur für Listen-Jobs nutzbar, und nur wenn vollständig (`errors.len() == items_failed`) |
| `copy.rs` `Run.fail` | Fehler je Eintrag | kennt das Zielpaar nicht → eigene Notiz `(src, dst, id, copied)` an jeder Fehlerstelle |
| `copy::execute` | Planung + Ausführung | wiederverwendet: Retry baut nur die `Top`s anders (exakte Paare) |
| `transfer.rs` | Server-Copy/Move | Ausführung in `execute` ausgelagert, Retry baut Tops aus Paaren |
| `Control` | je Job, überall durchgereicht | trägt jetzt die **Retry-Notizen** (`retry::Notes`) – keine Signaturänderung der Runner |
| `expect` (030 E5) | „noch, was das Panel zeigte?“ | Retry von Delete bekommt einen **frischen Schnappschuss** (Zustand nach Lauf 1) als `expected` |

## Verträge

- Rust `JobInfo.retry_available: bool` ↔ TS `JobInfo.retryAvailable: boolean`.
- Event `JobEvent::RetryAvailable { id, available }` ↔ `{ type: 'retryAvailable', id, available }`.
- Command `retry_job(id: String) -> Result<String, FsError>` (async) → `JobsApi.retry(id)` → `JobsStore.retry(id)`;
  Fehler `retry_unavailable`.
- Neue Codes `timed_out`, `retry_unavailable` in `error.rs`, `fs.models.ts`, `fs-error.ts`, `fs-error-texts.ts`.

## Retry-Plan (nur im Rust-Speicher)

`retry::RetryPlan { spec: JobSpec, extra: Option<Arc<RetryExtra>> }` – `spec` ist die **sichtbare, normale**
`JobSpec` (Titel, `touched_paths`, Watcher, `start_now` greifen ohne Sonderfall), `extra` steuert die Ausführung:

| Art | `failed` | `doneWithErrors` |
|---|---|---|
| alle Nicht-Helper | ganze `JobSpec` erneut | – |
| `pack`, `archiveAdd/Delete/Mkdir`, `verifyChecksums`, `viewEntry`, `checksum` (Liste) | – | ganze `JobSpec` (atomar) |
| `copy`/`move` lokal | | `extra = Pairs`: exakte Paare *(Quelle → Ziel)* aus den Notizen; sichtbar `sources` = Quellen der Paare, `target_dir` wie vorher |
| `copy`/`move` Server (`transfer`) | | ebenso (`Loc` lokal/Server) |
| `delete` Papierkorb | | fehlgeschlagene Top-Pfade |
| `delete` endgültig (lokal + Server) | | fehlgeschlagene Einträge (tief) + `extra = Cleanup`: danach leere Elternordner bis zu den ursprünglichen Pfaden per `remove_dir` |
| `rename`, `group`, `clean`, `sync`, `dedupe`, `link` | | Teilmenge der Elemente, deren Pfad (bzw. Zielpfad) ein Fehlerpfad ist oder enthält |
| `checksum` (je Datei / anzeigen), `attributes` | | die Fehlerpfade selbst |
| `extract` | | sichtbar gleiche Spec, `extra = ExtractOnly`: nur Einträge, deren virtueller Pfad fehlschlug (gleiche Zielposition!) |

**Nicht wiederholt** (würden Fremdes treffen oder sind sinnlos): Fehler mit `not_found` (auch „changed while
moving/deleting“), `changed_since_listing`, `duplicate_changed`, `invalid_path` (Mount, Wurzel), `unsafe_entry`,
`symlink_skipped`, `same_source_target`, `target_inside_source`. Bleibt nichts übrig → kein Retry.

**Copy/Move-Notizen** (`copy.rs`): je Fehlerstelle `(src, dst tatsächlich, Datei-Id aus der Planung, copied)`:
Top-Level nicht lesbar, Quellordner nicht lesbar (Ordnerpaar → Retry traversiert neu), Zielordner nicht anlegbar
(Ordnerpaar), Datei/Link fehlgeschlagen, Ziel kopiert aber Quelle nicht löschbar (`copied = true`). Konflikt-`Skip`
und `OverwriteIfNewer` ohne neuere Quelle landen nie in den Notizen. Beim Move zusätzlich die **Kette der
Quell-Elternordner** (mit Id) bis zur Top-Quelle.

**Retry-Lauf Copy/Move** (`copy::run_retry`): Ziel-Wurzel muss Ordner sein (sonst `failed`); je Paar
1. Move: Quelle muss noch dieselbe Datei-Id haben (sonst Fehler „changed“, **nichts verschoben**);
2. fehlende Ziel-Elternordner unterhalb der Ziel-Wurzel Komponente für Komponente anlegen, nie durch Links;
3. `copied`: liegt am Ziel noch eine Datei gleicher Größe und Änderungszeit → nur die Quelle löschen, sonst normal;
4. Rest läuft durch das normale `execute` (Konflikte, `.part`, Pause, Abbruch, „disk full“).
Danach Quell-Elternordner der Kette tiefste zuerst per `remove_dir` (nur leere, nur gleiche Id). Ordner mit
übersprungenen Dateien bleiben (nicht leer).

**Grenzen:** `MAX_RETRY_ITEMS = 100_000` Notizen je Job; darüber kein Teil-Retry (`retry_available = false`).
Listen-Jobs nur, wenn `Summary.errors` vollständig ist. `retry_log` ≤ 50 Einträge, `clear_finished` räumt mit auf.
`retry_job` nimmt den Plan aus dem Log (zweiter Aufruf → `retry_unavailable`) und startet über `JobManager::start`
(Normalisierung, `validate`, `DangerCheck`); Sync/Clean/Dedupe prüfen im Lauf wie immer.

## UI

```
| Status | Menge | % | Aktion                       | [Retry] [7 errors]       |
Detailbereich:  7 errors                      [Retry failed]
                …/Der Panther - 082.mp3 – The operation timed out.
```
- Knopf `retry` (Slot `retry`, `primary`) vor `[n errors]`/`[Details]`; Detail-Knopf „Retry failed“ bzw. „Retry“
  (bei `failed`). Klick → `jobs.retry(id)` → `selected.set(newId)`; Fehler als Statusmeldung.
- `detail()` wählt automatisch bevorzugt Problem-Tasks mit `retryAvailable`.
- Extract mit `archive_password_*`: Retry fragt erst über `ArchivePasswordPrompt` nach dem Passwort.

## Tests

Rust (`jobs/tests_retry.rs`): Move-Baum mit tiefen Fehlern (blockierter Zielname) → exakter Unterordner +
Quellbaum weg; Copy mit erledigt/Skip/Fehler → nur der Fehler; Ordnerpaar (Zielordner nicht anlegbar); `failed` →
ganze Spec; Move-Quelle ausgetauscht → nichts verschoben; Delete endgültig + Aufräumen, Delete mit Fremdem im Ordner;
Rename/Group/Link-Stichprobe; Doppel-Aufruf, `clear_finished`; `TimedOut`-Mapping.
Frontend: `job-rows`, `dialogs` (Tabelle + Detail), `jobs.store` (Snapshot + Event), Kataloge.

## Review (separater Agent, Schwerpunkt Move/Delete)

Nichts wird doppelt verschoben, nichts außerhalb der Ziel-Wurzel geschrieben, kein nicht leerer Ordner und kein Link
beim Aufräumen entfernt. Befunde und Umgang:

1. Windows: `file_id` ist dort `None` → Move-Retry ohne Identitätsprüfung. **Behoben:** Notizen und Prüfung nutzen
   `platform::entry_id` (Volume-Serial + File-Index).
2. Paare aus Planungsfehlern/Transfers ohne Id. **Behoben:** Id beim Notieren nachgeholt (lokal), Serverquellen tragen
   Größe + Zeit (`RetryPair.seen`) und werden bei Abweichung nicht verschoben (Test
   `move_retry_leaves_a_replaced_unreadable_folder_alone`).
3. Server-Move `copied` ohne Zeitstempel → nur Größe entschied. **Behoben:** ohne Zeiten normaler Move mit Konfliktfrage.
4. Delete: Ordner-Schnappschuss prüft nur die Art. **Behoben:** fehlgeschlagene Ordner tragen Id + Änderungszeit
   (`RetryExtra::Cleanup.guard`), geänderte bleiben stehen (`changed_since_listing`); lokale Pfade ohne Schnappschuss
   werden nicht wiederholt (Test `delete_retry_leaves_a_failed_folder_alone_whose_content_changed`). Rest: Neues
   *tiefer* in einem fehlgeschlagenen Ordner ändert dessen Zeit nicht – bewusst offen (der Ordner war ausgewählt).
5. Ziel-Wurzel selbst könnte inzwischen ein Link sein. **Offen (niedrig):** das Original folgt dem Link ebenso
   (`fs::metadata`); der Nutzer darf in einen verlinkten Ordner kopieren.
6. Ein unvollständig gelesener Ordner wird als Ganzes neu durchlaufen → Konfliktfragen für schon Erledigtes. **Offen
   (niedrig):** selten, verliert nichts.

## Fortschritt

- [x] Phase 1 Design
- [x] Phase 2 Rust
- [x] Phase 3 Frontend
- [ ] Phase 4 Ende-zu-Ende (nicht möglich in dieser Sitzung)
- [x] Phase 5 Doku
- [x] Review (Befunde 1–4 behoben, 5–6 bewusst offen)
