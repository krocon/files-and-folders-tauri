# Prompt 005: Job-Engine im Rust-Backend (Fortschritt, Abbruch, Konflikte)

> **Slug:** `job-queue` · **Braucht:** 004 · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §6 (Queue, Operationen,
> Fehler), §3 (Job-Queue-Dialog), §1.3 (Ereignisse `created`/`removed`/`focus`/`unselect`).

## Ziel

Eine gemeinsame, getestete Grundlage für alle langen oder destruktiven Operationen (Kopieren, Verschieben, Löschen,
Multi-Rename, Gruppieren, Ordnergröße, Suche): Jobs mit Id, echtem Byte-Fortschritt, Abbruch und Pause,
Konfliktabfrage („überschreiben / überspringen / umbenennen / für alle“), Fehler pro Eintrag und einer sichtbaren
Warteschlange. Dieser Prompt baut die **Engine und eine Test-Operation**; die eigentlichen Operationen folgen in 006.

## Altes Verhalten (Kurzfassung) und Lehren

- Client-seitige Queue, strikt eine Aktion nach der anderen, Fortschritt = erledigte/gesamte Aktionen, **kein
  Abbruch, kein Byte-Fortschritt**, Fehler stoppt die Queue („Restart Queue“ setzt fort).
- Server kopierte per `cp`/`xcopy` (Linux nahm den Windows-Zweig!), überschrieb **stillschweigend**.
- Ereignisse `created`/`removed`/`focus`/`unselect` aktualisierten die Panels ohne Neuladen; ab 30 Einträgen
  („bulk“) nur ein Refresh am Ende.

## Aufgaben

1. **Rust-Modul `jobs/`** (ohne Tauri testbar): `JobManager` (Arc/Mutex oder Kanal-basiert), `JobId`,
   `JobKind`, `JobState` (Queued, Running, Paused, WaitingForDecision, Done, Failed, Cancelled),
   `CancellationToken` (atomar), Pause/Resume, Fortschritt (`bytes_done/total`, `items_done/total`, aktuelle Datei,
   Rate) gedrosselt (z. B. max. 10 Updates/s).
2. **Planung vor Ausführung**: Job zuerst „scannen“ (Anzahl, Größe, Konflikte vorab ermitteln, abbrechbar), dann
   ausführen – so kennt der Fortschritt die Gesamtmenge.
3. **Konfliktprotokoll**: bei existierendem Ziel pausiert der Job und sendet eine Anfrage
   `{ jobId, conflictId, source, target, sourceMeta, targetMeta }`; das Frontend antwortet per Command
   `resolve_conflict(jobId, conflictId, decision, applyToAll)` mit `overwrite | skip | rename(newName) |
   overwriteIfNewer | cancel`. Timeout gibt es nicht; Abbruch ist immer möglich.
4. **Fehler pro Eintrag** (Rechte, gesperrte Datei, Pfad zu lang, Platte voll): sammeln, Job läuft weiter (Default)
   oder fragt (Einstellung); Abschlussbericht mit Liste. Teilweise erledigte Jobs sind klar als solche markiert.
5. **Tauri-Schnittstelle**: Commands `start_job(spec) -> JobId`, `cancel_job`, `pause_job`, `resume_job`,
   `list_jobs`, `resolve_conflict`; Fortschritt und Anfragen über `tauri::ipc::Channel<JobEvent>` (pro Abonnent)
   oder App-Events – im Design entscheiden. `JobEvent` als getaggtes Enum (serde `tag = "type"`), TS-Union dazu.
6. **Panel-Aktualisierung**: Jobs melden betroffene Ordner (`changedDirs`), Panels mit diesen Pfaden laden neu
   (Cursor/Markierung per Pfad erhalten). (Datei-Überwachung kommt in Prompt 012 und ersetzt das teilweise.)
7. **Parallelität**: Default eine Queue (seriell), optional „im Hintergrund parallel“ pro Job (TC-Verhalten);
   Kopien auf verschiedene Laufwerke dürfen parallel laufen (Design, nicht zwingend umsetzen).
8. **Frontend**: `JobsApi` (Fassade), `JobsStore` (Root), Fortschrittsanzeige in der Fußzeile (kompakt) +
   Job-Dialog/-Panel (Liste, Pause, Abbruch, Details, Fehlerliste, „erneut versuchen“), Konfliktdialog
   (Vorschau beider Dateien: Größe, Datum; Buttons + „für alle“; Tastatur; `role="alertdialog"`).
9. **Test-Operation** zum Beweis der Engine: `JobKind::Simulate` nur in Debug-Builds **oder** direkt
   „Kopieren“ als erste echte Operation (dann überschneidet sich 006 – im Design entscheiden).

## Entscheidungsfragen

- Channel pro Job vs. globales Event „jobs://update“? (Mehrere Fenster später?)
- Eigene Threads (`std::thread` + Kanäle) oder `tokio::task::spawn_blocking`? Begründung (Abbruch, Pause).
- Default bei Fehlern: weitermachen und sammeln oder fragen?

## Akzeptanzkriterien

- Rust-Tests: Abbruch mitten im Job hinterlässt keinen halb geschriebenen Zieldatei-Rest (temp + rename) bzw.
  ist dokumentiert; Pause/Resume; Konflikt mit „für alle“; Fehler pro Eintrag; 10 000 kleine Dateien ohne
  Event-Flut (Drosselung gemessen).
- UI: Fortschritt flüssig, Abbruch reagiert < 200 ms, Konfliktdialog per Tastatur bedienbar, Fehlerliste nach Ende.
- Kein Frontend-Zustand geht verloren, wenn der Job-Dialog geschlossen wird; laufende Jobs beim Beenden der App
  → Rückfrage.

## Review-Schwerpunkte (separater Agent)

Race Conditions (Abbruch während Konfliktfrage), Deadlocks, Speicherwachstum bei großen Jobs, Fortschritt bei
Sparse-/großen Dateien, Verhalten bei vollem Datenträger.
