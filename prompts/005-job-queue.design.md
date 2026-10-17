# Design 005: Job-Engine im Rust-Backend

> **Status:** ✅ freigegeben (2026-10-17, E1–E8 wie empfohlen) – in Umsetzung · **Datum:** 2026-10-17 · **Branch:** `feat/job-queue`
> (von `feat/navigation-liste`)
> **Grundlage:** legacy §6, mr §6, Designs 003 (Ordnergröße mit Token-Map, wird hier abgelöst) und 004 (Schließen).

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| `DirSizeJobs` (003) | Token-Map, Channel je Aufruf | **wird ersetzt**: Ordnergröße wird ein Job-Typ (läuft parallel, ohne Konflikte) |
| `fs_atomic.rs` | temp + rename für Config-Dateien | **Muster** für Dateikopien (temp im Zielordner + rename) |
| Aktionen (002) | `OPEN_TASK_DLG`, Tasks-Button gedimmt | **Handler** + Fortschritt im Button |
| `FileBrowserStore.refresh()` | Cursor/Markierung per Pfad | **passt** für „betroffene Ordner neu laden“ |
| Schließen (004) | `CloseRequested` speichert die Sitzung | **erweitern**: laufende Jobs → Rückfrage |

## 2. Entscheidungen (Empfehlungen)

### E1 – Ereignisse über **einen abonnierten Channel** statt globaler App-Events ✅

`subscribe_jobs(channel)`: Rust merkt sich die Channels der Abonnenten (heute ein Fenster, später mehrere) und
schickt jedes `JobEvent` an alle. Typisiert, geordnet, ohne Event-Capability; tote Channels werden beim Senden
entfernt. Ein Snapshot (`list_jobs`) gleicht nach einem WebView-Reload ab.

### E2 – **Eigener Thread je laufendem Job** (`std::thread`) ✅

Jobs blockieren absichtlich (Konfliktfrage, Pause) – das gehört nicht in den Tokio-Blocking-Pool. Steuerung je Job
über einen `Control`-Block: `AtomicBool cancel`, Pause und Entscheidung über `Mutex + Condvar` (Abbruch weckt jede
Wartestelle sofort auf → Reaktion < 200 ms auch während einer Konfliktfrage). Der `JobManager` (Arc<Mutex>) hält nur
Zustand und Warteschlange, nie während I/O gesperrt.

### E3 – Fehler pro Eintrag: **weitermachen und sammeln** ✅

Rechte, gesperrte Datei, Pfad zu lang, Platte voll: Eintrag kommt in die Fehlerliste, der Job läuft weiter.
Ausnahme „Platte voll“ (`StorageFull`/`ENOSPC`): Job pausiert mit Frage (weiter/abbrechen), weil jede weitere Datei
ebenfalls scheitert. Abschluss: `Done`, `DoneWithErrors` (teilweise erledigt, deutlich markiert) oder `Cancelled`.
Einstellung „bei Fehler fragen“ kommt mit 015.

### E4 – Eine serielle Warteschlange, Option „im Hintergrund“ ✅

Default: Kopieren/Verschieben/Löschen laufen nacheinander (eine Platte wird nicht von mehreren Jobs zerhackt).
`background: true` startet sofort parallel (TC „im Hintergrund“). Ordnergrößen laufen immer parallel. Parallel je
Laufwerk: nur im Design vorgesehen, nicht umgesetzt.

### E5 – **Kopieren als erste echte Operation** statt `Simulate` ✅

Nur eine echte Kopie prüft Konflikte, temp + rename, Byte-Fortschritt und volle Platten realistisch. 005 liefert
den Job `copy` (Dateien und Ordner rekursiv) und ein **minimales F5** (Rückfrage „n Einträge nach … kopieren?“);
006 baut den vollständigen Kopierdialog (Ziel ändern, Optionen) und Verschieben/Löschen/Mkdir/Umbenennen auf der
Engine. Zusätzlich `simulate` nur in Debug-Builds für Last- und Drosselungstests.

### E6 – Kopiersemantik ✅

- **Planung zuerst** (abbrechbar): Liste aller Dateien, Gesamtbytes, Zielpfade; Quelle = Ziel, Ziel innerhalb der
  Quelle → Fehler vor dem Start (Rust validiert, nie nur das Frontend).
- **Datei**: in `.<name>.fnf-part-<id>` im Zielordner kopieren (64 KiB-Blöcke, Abbruch je Block), Änderungszeit und
  Rechte übernehmen, dann `rename` auf den Zielnamen (ersetzt bei „überschreiben“ atomar). Abbruch/Fehler → Temp-Datei
  wird gelöscht; es bleibt nie eine halbe Zieldatei mit echtem Namen.
- **Symlinks** werden als Link kopiert, nicht verfolgt (Windows ohne Symlink-Recht → Eintrag in der Fehlerliste).
- **Konflikt** (Ziel existiert): Job → `WaitingForDecision`, Event `Conflict { conflictId, source, target, sourceMeta,
  targetMeta }`; Antwort `resolve_conflict(jobId, conflictId, decision, applyToAll)` mit `overwrite | skip |
  rename(newName) | overwriteIfNewer | cancel`. Ordner-auf-Ordner = zusammenführen (kein Konflikt), Datei-auf-Ordner
  und umgekehrt = Fehler.

### E7 – Panels aktualisieren über `DirsChanged` ✅

Jobs melden betroffene Zielordner gedrosselt (max. 2/s) und am Ende; Panels mit diesem Pfad laden neu (Cursor und
Markierung bleiben per Pfad). 012 (Überwachung) ergänzt das später.

### E8 – Beenden mit laufenden Jobs → Rückfrage ✅

`CloseRequested`/`ExitRequested` bei aktiven Jobs: Schließen anhalten, Event `QuitRequested` → Dialog „n Jobs
laufen – abbrechen und beenden?“ → `cancel_all_and_quit` (Temp-Dateien werden aufgeräumt) oder weiterlaufen.

## 3. Verträge

```rust
enum JobSpec { Copy { sources: Vec<String>, target_dir: String, background: bool },
               DirSize { path: String }, Simulate { items: u32, item_ms: u32 } /* debug */ }
enum JobState { Queued, Planning, Running, Paused, WaitingForDecision, Done, DoneWithErrors, Failed, Cancelled }
struct Progress { bytes_done, bytes_total, items_done, items_total, current: Option<String>, rate_bps }
#[serde(tag = "type")]
enum JobEvent { Added{job}, State{id, state}, Progress{id, progress}, Conflict{id, conflict},
                ItemFailed{id, path, error: FsError}, DirsChanged{dirs}, Finished{id, summary}, QuitRequested{running} }
```

| Command | Rückgabe |
|---|---|
| `subscribe_jobs(channel: Channel<JobEvent>)` | `JobInfo[]` (aktueller Stand) |
| `start_job(spec)` | `JobId` / `FsError` (`invalid_path`, `target_inside_source` *(neu)*, `same_source_target` *(neu)*) |
| `cancel_job(id)`, `pause_job(id)`, `resume_job(id)` | `()` |
| `resolve_conflict(id, conflictId, decision, applyToAll)` | `()` |
| `list_jobs()` | `JobInfo[]` |
| `clear_finished()` | `()` |
| `cancel_all_and_quit()` | `()` |

Fortschritt höchstens **10 Events/s je Job** (Test: 10 000 kleine Dateien → ≤ Laufzeit·10 + Endereignisse).
`calc_dir_size`/`cancel_dir_size` aus 003 werden zu `start_job(DirSize)` / `cancel_job`.

## 4. Frontend

- `core/jobs/`: `jobs.models.ts` (TS-Union zu `JobEvent`), `JobsApi` (Fassade), `FakeJobsApi`.
- `JobsStore` (Root): Jobs nach Id, offene Konflikte (FIFO), Fehlerlisten; abonniert beim Start.
- **Tasks-Button**: Fortschritt „2 / 5“ + schmaler Balken, Klick/`OPEN_TASK_DLG` öffnet die Job-Liste.
- **Job-Liste** (Dialog, schließen verliert nichts): je Job Art, Quelle → Ziel, Balken, Bytes, Rate, Restzeit,
  Pause/Weiter/Abbrechen, Fehlerliste aufklappbar, „Erledigte entfernen“.
- **Konfliktdialog** (`role="alertdialog"`): beide Dateien mit Größe und Datum, Buttons Überschreiben / Überspringen /
  Umbenennen (Feld mit Vorschlag `name (1).ext`) / Wenn neuer / Abbrechen, Checkbox „für alle“, Tastatur
  (Alt+Buchstabe je Button, Enter = Überspringen als sichere Vorgabe, Esc = Abbrechen-Frage).
- **F5 (minimal)**: markierte Einträge oder Cursor → Zielpanel, Rückfrage, Start; Statuszeile „Kopiere …“.

## 5. Tests

| Ebene | Fälle |
|---|---|
| Rust (ohne Tauri) | Kopie Datei/Ordner rekursiv mit Umlauten/Leerzeichen; Änderungszeit erhalten; Abbruch mitten in einer großen Datei → keine Teil-Datei unter echtem Namen, Temp gelöscht; Pause/Resume (Fortschritt steht); Konflikt overwrite/skip/rename/newer/cancel, „für alle“; Abbruch während Konfliktfrage; Fehler pro Eintrag (gesperrte Quelle) → `DoneWithErrors`; Ziel in Quelle / Quelle = Ziel → Fehler vor Start; Symlink als Link kopiert; serielle Warteschlange vs. background; Drosselung bei 10 000 Dateien; Ordnergröße als Job |
| Frontend | `JobsStore` (Events → Zustand, Konflikt-FIFO, Reload-Abgleich), Konfliktdialog (Rollen, Tastatur, „für alle“), Tasks-Button-Fortschritt, F5-Ablauf mit `FakeJobsApi` |
| Ende-zu-Ende | Kopie eines großen Ordners mit Abbruch, Konflikt per Tastatur, Fehlerliste, Beenden mit laufendem Job |

## 6. Fortschritt

- [x] Phase 1: dieses Dokument
- [x] Freigabe (2026-10-17)
- [x] Phase 2: Rust – `jobs/` (control, manager, copy, report), Commands, Beenden-Rückfrage; Ordnergröße als Job
- [ ] Phasen 2–6
