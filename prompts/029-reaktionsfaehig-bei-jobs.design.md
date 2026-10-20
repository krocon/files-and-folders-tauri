# Design 029: Bedienbar bleiben bei langen Jobs und langsamen Laufwerken

> Status: **umgesetzt** (autonomer Durchlauf, Freigabe vorab durch Marc am 20.10.2026) · Branch
> `feat/reaktionsfaehig-bei-jobs` · Prompt: [029-reaktionsfaehig-bei-jobs.md](029-reaktionsfaehig-bei-jobs.md)

## 1. Bestand (zusätzlich zum Befund im Prompt)

| Baustein | wofür | Befund |
|---|---|---|
| `FileBrowserStore.load/refresh/requestRefresh` | Listing, Reload | `refresh` = `load` → `loading` → Overlay; Reload-Wunsch während eines Loads wird gemerkt (012 E4) – passt, aber ohne Drossel |
| `FilePanel.showTab` | Tab-Wechsel | **setzt `navigationLocked` bis das Listing des neuen Tabs da ist**; bis dahin zeigt das Panel die Liste und Pfadzeile des *alten* Tabs und ignoriert jede Navigation (Marcs Screenshot: Tab „Serien“ aktiv, Pfad `/Users/marckronberg`, Spinner). Zweite Hauptursache neben dem Overlay. |
| Table-Overlay | „Loading…“ | `loadingDelayInMs: 150`, `blockInteractionWhileLoading` nicht gesetzt (Default `true`) |
| `watch/batch.rs` | Entprellen | eigene `.part` werden schon ignoriert; `ready_at` drosselt Rescans nicht, wenn `self_changed` dabei ist; `need_rescan` → `touch_all` |
| `WatchHub.pause_under/resume` | Windows-Guard | Mechanik passt für Poll-Pausen; nur unter Windows verdrahtet |
| `jobs/copy.rs` | Kopie | `BLOCK` 64 KiB, Datei-Cache, Abbruch je Block |
| Commands | IPC | 15 synchrone `#[tauri::command] fn` → Main-Thread |

## 2. Entscheidungen

**E1 Auffrischen ≠ Navigieren.** `load(path, { background: true })` setzt statt `loading` das Signal `refreshing`;
Liste bleibt sichtbar und bedienbar, kein Overlay. `refresh()` (Ctrl+R, nach F7/Umbenennen) und `requestRefresh()`
(Watcher, Job) nutzen es. Deltas werden während *beider* Arten gepuffert (`busy = loading || refreshing`).

**E2 Adaptive Drossel nur für automatische Reloads.** `requestRefresh()` wartet nach dem Ende des letzten Listings
`gap = dauer < 200 ms ? 0 : clamp(2 × dauer, 1 s, 10 s)`. Schnelle Laufwerke verhalten sich wie bisher (keine
Wartezeit, bestehende Specs bleiben), langsame werden gedrosselt. Ausdrückliches `refresh()` (Nutzer, Ops) wartet
nie. Höchstens ein Reload wartet; `supersede()` (Navigation) verwirft ihn samt Timer.
*Abweichung vom Prompt (max(1 s, …) immer):* ein fester 1-s-Boden hätte auch lokale Ordner nach jedem Job verzögert.

**E3 Overlay nicht blockierend.** `overlayOptions.blockInteractionWhileLoading: false`. Während einer Navigation
bleibt die alte Liste bedienbar; Aktionen darauf sind gültig (Pfade sind absolut), Enter auf einen anderen Ordner
überholt die laufende Anfrage (Request-Sequenz).

**E4 „Ordner antwortet langsam …“.** Läuft eine Navigation (nicht Auffrischen) länger als 2 s, setzt der Store
`slow`; das Panel zeigt über der Liste eine Leiste (`role="status"`) mit **Abbrechen**. Neue Aktion
`CANCEL_LOADING` (Gruppe navigation, Kürzel `Escape` auf allen OS, nur aktiv solange geladen wird; feuert wie alle
plain keys nur mit Fokus in der Liste oder nirgends). Abbrechen = `supersede()`, `loading`/`slow` aus.

**E5 Tab-Wechsel ohne Sperre der alten Liste.**
- Das Panel merkt sich je Tab das zuletzt gezeigte Listing (LRU, 16 Tabs). Ist es für den Pfad des Tabs vorhanden,
  wird es **sofort** gezeigt (Cursor/Marken/Scroll wie beim Laden) und danach im Hintergrund aufgefrischt (E1).
  Kein Lock.
- Ohne Cache: Liste wird geleert, die Pfadzeile zeigt den Pfad des Tabs gedimmt mit „lädt …“ – Tab, Pfadzeile und
  Liste passen zusammen. Lock wie bisher (es gibt keine alte Liste, auf die sich Navigation beziehen könnte).
- Abbrechen während ein Tab öffnet: zurück zum vorher gezeigten Tab derselben Seite (aus dem Cache → sofort). Gibt es
  keinen: leere Liste, Hinweis „abgebrochen“ mit **Erneut versuchen**.
- Fehler beim Öffnen (nicht lesbar): Fehlerbox wie bisher, Pfadzeile zeigt den Pfad des Tabs.

**E6 Listing-Anfragen bündeln (Rust).** `list_directory`: Läuft für denselben Pfad schon ein Listing, das älter als
1 s ist (hängt vermutlich), hängt sich die neue Anfrage an dessen Ergebnis statt einen weiteren blockierenden Thread
zu starten. Frische Listings (< 1 s) werden nicht geteilt – ein geteiltes Ergebnis könnte eine Änderung verpassen,
die zwischen den beiden Anfragen passierte; bei einem hängenden Laufwerk ist das hinnehmbar (der Watcher und der
nächste Reload holen es nach). Warten ohne Thread (`async_runtime::channel`).

**E7 Watcher-Drossel.** `RESCAN_GAP` gilt für jeden Rescan außer „Ordner entfernt/ersetzt“ (`self_removed`).
`need_rescan` trifft die Ordner, die zu den Pfaden des Ereignisses gehören (Vorfahr oder Nachkomme); nur ohne Pfade
alle.

**E8 Zielordner laufender Jobs.** `JobSpec::target_dirs()` (Copy/Move/Group: Ziel bzw. Wurzel, Extract/Pack: Ziel).
Der Manager ruft ein zweites Guard (`set_target_guard`, auf allen Plattformen verdrahtet) → `WatchHub::busy(dirs)`:
- beobachtete Ordner **an oder unter** einem Ziel gelten als „beschäftigt“: der Debounce-Thread hält ihre Rescans
  zurück (Einzeländerungen fließen weiter); beim Lösen kommt ein zurückgehaltener Rescan sofort.
- ein **Poll**-Watch eines beschäftigten Ordners wird pausiert (bestehende `pause_under`-Zähler, Resume mit Rescan).
- Lösen auch bei Abbruch/Panik (wie das bestehende Guard, nach `catch_unwind`).

**E9 Watcher-Auflösung außerhalb des Debounce-Threads.** Das Stat'en einer fälligen Charge (`resolve`) läuft in einem
kurzlebigen Thread je Ordner; solange einer für einen Ordner läuft, sammelt der Batcher dessen Änderungen weiter
und gibt die nächste Charge erst danach frei (Reihenfolge je Ordner bleibt). Ein hängendes Laufwerk hält so nur
seine eigenen Ordner auf. `set_dirs` hält den Lock weiterhin während `statfs`/`watch` – bewusst (seltene Aufrufe,
seriell aus dem Frontend), dokumentiert.

**E10 Kopie.** `BLOCK` = 1 MiB (Copy/Extract). Cache-Hinweise in `platform::io_hints` (Crate `libc`, schon
transitiv da): macOS `F_NOCACHE` auf Quelle und Ziel; Linux `POSIX_FADV_SEQUENTIAL` + `POSIX_FADV_DONTNEED` für
gelesene Bereiche der Quelle (Dirty Pages des Ziels lassen sich ohne erzwungenes Sync nicht verwerfen – bewusst
nicht); Windows nichts. Hinweise sind best effort: Fehler werden ignoriert.

**E11 Commands async.** Alle Commands ohne Main-Thread-Bedarf werden `async` bzw. `#[tauri::command(async)]`.
Ausnahme (bleiben synchron): `set_app_menu`, `set_menu_enabled`, `subscribe_menu`, `close_main_window` – sie
bauen/ändern das native Menü bzw. das Fenster; auf macOS ist der Main-Thread dort der sichere Ort und es gibt kein
I/O. Ein Rust-Test liest `commands.rs`/`commands/*.rs` und schlägt bei neuen synchronen Commands außerhalb dieser
Liste fehl.

**E12 Task-Zeile.** Zahlenblock `white-space: nowrap` je Wert, Pfad schrumpft mit Ellipse.

**E13 Testschalter.** `FNF_TEST_SLOW=<präfix>:<listing-ms>:<block-ms>` nur mit `debug_assertions`: verzögert
`list_directory` und jeden geschriebenen Block unter dem Präfix (`src/test_slow.rs`). Im Release ist der Code nicht
enthalten.

## 3. Verträge

- Rust: keine neuen Commands, keine DTO-Änderung. Neu intern: `JobSpec::target_dirs()`, `JobManager::set_target_guard`,
  `WatchHub::busy`, Msg `Busy`, `platform::io_hints::{prepare_read, prepare_write, after_read}`.
- TS: `FileBrowserStore` `refreshing`, `slow`, `cancelLoad()`, `present(listing, options)`; `LoadOptions.background`.
  Aktion `CANCEL_LOADING`. Texte `slowFolder`, `cancelLoading`, `openCancelled`, `retry`, `opening` (en/de).

## 4. Tests

- Rust: batch (Gap auch mit SelfChanged, kein Gap bei SelfRemoved, Busy hält Rescan zurück und gibt ihn frei, busy
  blockiert nicht Child-Änderungen), need_rescan mit Pfaden, Manager ruft Target-Guard (Copy, Abbruch, Panik),
  Listing-Join (zwei Anfragen, eine Ausführung), Kopie mit 1-MiB-Blöcken (bestehende Tests), Command-Check.
- Frontend: Store (Auffrischen ohne `loading`, Deltas während Auffrischen, Drossel mit Fake-Timern, `slow` nach 2 s,
  `cancelLoad`), Panel (Tab mit Cache sofort + Refresh, ohne Cache leere Liste + Pfad des Tabs, Abbrechen zurück zum
  vorigen Tab), Aktion `CANCEL_LOADING`, Kataloge.
- E2E (Xvfb, `FNF_TEST_SLOW`): Kopie auf langsames Ziel, beide Panels bedienen, Tab-Wechsel + Esc.

## 5. Fortschritt

- [x] Prompt + Design
- [ ] Rust
- [ ] Frontend
- [ ] E2E
- [ ] Doku, Review
