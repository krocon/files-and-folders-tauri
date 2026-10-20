# Design 028: Ziehen aus der App ins System

> Status: **umgesetzt** (macOS/Windows ungeprüft) · Branch `feat/drag-ins-system` · Prompt: [028-drag-ins-system.md](028-drag-ins-system.md)
> · Marc hat am 20.10.2026 Umfang (nur Ziehen ins System) und Ablauf („Prompt + umsetzen“) freigegeben – gearbeitet
> wird ohne Haltepunkt nach Phase 1, Entscheidungen stehen hier.

## 1. Bestand → wofür → passt/fehlt

| Baustein | wofür | Stand |
|---|---|---|
| `file-list.ts` Pointer-Drag (012 E5) | Drag beginnt, Capture, Esc | passt – erkennt künftig das Verlassen des Fensters |
| `DragStore` | interner Drag, Zonen, Dialog | erweitert um `handOff()` |
| `DragDropApi` / `onDragDropEvent` (012 E6) | Drop von außen | passt – fängt auch den Rückweg ins eigene Fenster |
| `WatchApi.describePaths` | Drop von außen beschreiben | unverändert |
| Rust `commands/watch.rs`, `commands/shell.rs` (`main_only`) | Muster für Command + Fensterprüfung | Muster |
| Crate `drag` 2.1.1 | nativer Drag-Source | neu (macOS, Windows) |
| `gtk` 0.18 (schon über Tauri im Baum) | GTK-Drag unter Linux | neu als direkte Linux-Abhängigkeit (kein neuer Code im Build) |

## 2. Entscheidungen

**E1 Übergabe am Fensterrand, nicht sofort nativ.** Der Drag beginnt wie bisher App-intern (Pointer-Events,
Ghost, Zielzeile, Shift/⌘ = Verschieben, Esc). Erst wenn der Zeiger das Fenster verlässt, endet der interne Drag und
ein nativer Drag mit denselben Einträgen startet. Grund: Ein sofort nativer Drag würde Drops in der App über
`onDragDropEvent` laufen lassen – ohne Modifier (immer Kopieren), mit anderem Hinweis und ohne Esc-Abbruch der App.
Erkennung: `pointermove` mit Koordinaten außerhalb von `0 ≤ x < innerWidth`, `0 ≤ y < innerHeight` (dank Capture
liefern WebKit/WebView2 diese weiter) **oder** `mouseout` mit `relatedTarget === null` am Dokument (falls eine
Plattform außerhalb nichts liefert). Reine Funktion `leftWindow(x, y, w, h)` in `dnd-logic.ts`.

**E2 Command `start_os_drag(paths: string[])`** in `commands/os_drag.rs`, `async`: startet am aufrufenden Fenster (es gibt nur
das Hauptfenster; eine eigene Prüfung bräuchte einen neuen Fehlercode ohne Nutzen), höchstens 10 000 Pfade (`too_many`), jeder Pfad über
`validate_input_path` (absolut, ohne `..`) und `symlink_metadata` (existiert; virtuelle Archivpfade scheitern hier).
Leere Liste → `invalid_path`. **Nur bei gedrückter Maustaste** (Review #1): auf dem Main-Thread prüft Rust die
primäre Taste (Windows `GetAsyncKeyState` mit `SM_SWAPBUTTON`, macOS `CGEventSourceButtonState`, GTK
`device_position` → `BUTTON1_MASK`), sonst neuer Code `drag_not_held` – kein Drag ohne Geste des Nutzers, kein
sofortiger Drop unter Windows nach schnellem Loslassen. Das Frontend übergibt nur bei `buttons & 1` und meldet
`drag_not_held` nicht. Der Start läuft per `run_on_main_thread`; das Ergebnis des Starts kommt über einen
Kanal zurück (Windows: `DoDragDrop` ist modal, die Antwort kommt erst nach dem Drop – unkritisch, der Command ist
async). Nicht `tauri-plugin-drag` (nimmt beliebige Pfade und Bilder vom Frontend).
Abweichung von 012 E7 („nur Pfade der aktuellen Listings“): Rust kennt die Listings der Panels nicht, und
Ergebnis-Tabs der Suche zeigen Einträge aus beliebigen Ordnern. Gezogen werden ohnehin nur Pfade, die der Nutzer mit
gedrückter Maus aus der Liste zieht; die Fähigkeit „einem anderen Programm einen Pfad anbieten“ entspricht „Pfad
kopieren“ (011) und ist nicht destruktiv.

**E3 Nur Kopieren anbieten** (`DragMode::Copy`, GTK `COPY`, `DROPEFFECT_COPY`). Ein Verschieben führt das Zielprogramm
aus – eine destruktive Operation ohne unsere Prüfung (CLAUDE.md §4). Folge: Finder/Explorer kopieren auch auf
demselben Laufwerk; der Papierkorb im Dock nimmt den Drag nicht an. Verschieben ins System bleibt offen.

**E4 Plattformcode `platform/os_drag.rs`** mit `start(window, paths, image) -> Result<(), FsError>` je OS:
macOS/Windows über die Crate `drag` (`[target.'cfg(any(target_os = "macos", windows))'.dependencies]`), Linux eigene
GTK-Umsetzung (≈ 60 Zeilen nach dem Muster der Crate), weil deren Linux-Code URIs als `file://{path.display()}` baut:
Leerzeichen, `%`, `#` und nicht-UTF-8-Namen kämen kaputt an. Linux baut URIs mit dem vorhandenen `desktop::file_uri`
(prozentkodiert, Bytes statt Text) – reine Funktion `file_uris`, unit-getestet. Unter GTK läuft höchstens ein
Drag zugleich (Review #4).

**E5 Vorschaubild:** das App-Icon 32×32 (`icons/32x32.png`, `include_bytes!`) – keine Bilder vom Frontend.

**E6 Frontend.** Fassade `OsDragApi` (`core/dnd/os-drag-api.ts`, `invoke('start_os_drag')`, Fake für Tests).
`DragStore.handOff()`: beendet den internen Drag; Quellen nur aus einem echten Ordner oder Ergebnis-Tab, nicht aus
einem Archiv (`listing.archive` → Statusmeldung „Einträge in Archiven lassen sich nicht in andere Programme ziehen“);
Fehler → `jobs.report(errorText(...))`. `file-list.ts` ruft `handOff` und beendet Press/Capture **vor** dem nativen
Start (Capture freigeben, damit das System die Maus bekommt). Der Ghost-Hinweis ergänzt „aus dem Fenster: in andere
Programme“.

**E7 Rückweg:** Wird der native Drag zurück ins eigene Fenster gezogen, kommt er als Drop von außen (012 E6): Ziel
hervorgehoben, Kopieren-Dialog, gleicher Ordner = nichts. Kein Sonderfall.

## 3. Verträge

Rust:
```rust
#[tauri::command]
pub async fn start_os_drag<R: Runtime>(window: WebviewWindow<R>, paths: Vec<String>) -> Result<(), FsError>;
// Fehlercodes: invalid_path (leer, relativ, NUL), not_found/not_a_directory/permission_denied (aus symlink_metadata),
// too_many, io (Start fehlgeschlagen)
```
TS:
```ts
export abstract class OsDragApi { abstract startOsDrag(paths: readonly string[]): Promise<void>; }
```
Neuer Fehlercode: `drag_not_held` (Rust `error.rs`, TS `fs.models.ts`, `fs-error.ts`, Texte en/de). `DragState` bekommt `inArchive` (Quelle ist ein Archiv-Listing, E6).

## 4. Tests

- Rust: `validate_drag_paths` (leer, relativ, `..`, fehlend, Archivpfad, zu viele, Unicode/Leerzeichen, Symlink
  dangling = erlaubt), `file_uris` (Leerzeichen, `%`, `#`, Umlaut, Emoji, nicht-UTF-8).
- Frontend: `leftWindow`; `DragStore.handOff` (startet mit den Pfaden, beendet den Drag, Archiv → Meldung ohne Start,
  Fehler → Meldung); `file-list`-Verhalten nur E2E (jsdom ohne Layout).
- E2E (Xvfb): GTK-Testfenster (`python3.12` + PyGObject) neben der App, Drag per `xdotool` aus der Liste hinaus auf das
  Fenster → das Fenster schreibt die empfangenen URIs in eine Datei.

## 5. Fortschritt

- [x] Prompt + Design
- [x] Rust (`os_drag.rs`, `platform/os_drag.rs`, `commands/os_drag.rs`; `command_rules` kennt die neue Datei)
- [x] Frontend (`OsDragApi`, `DragStore.handOff`, `file-list.ts`, Ghost klappt am rechten Rand nach links)
- [x] E2E unter Xvfb (Linux, 20.10.2026) – Debug-Build, GTK-Testfenster (`python3.12` + PyGObject), Drag per `xdotool`:
  - eine Datei `Grüße mit Leerzeichen %41 #1.txt` → kam als
    `file:///tmp/e2e/home/Test/Gr%C3%BC%C3%9Fe%20mit%20Leerzeichen%20%2541%20%231.txt` an;
  - zwei markierte Einträge (`Ordner äö`, `emoji 🎉.txt`) → beide URIs, Reihenfolge des Listings;
  - Drag aus dem Fenster und zurück auf das rechte Panel → „Copy 1 item here → home“, Loslassen öffnet den
    Kopieren-Dialog (E7); Vorschaubild = App-Icon;
  - Drag aus einem ZIP-Ordner hinaus → Statusmeldung „Entries inside an archive cannot be dragged …“, nichts kam an;
  - interner Drag auf das andere Panel öffnet weiterhin den Dialog, Esc bricht ab.
- [x] Doku (architecture, feature-parity, roadmap, README, CLAUDE.md, TODO.md, prompts/README.md)
- [ ] macOS/Windows: im Container nicht kompilierbar (kein Target, kein SDK) – erst die CI bzw. Marc

## 6. Review (separater Agent, 20.10.2026)

| # | Befund | Schwere | Ergebnis |
|---|---|---|---|
| 1 | Nativer Drag kann nach dem Loslassen starten (Windows: sofortiger Drop; ohne Geste aufrufbar) | hoch | behoben: Tastenprüfung in Rust + `buttons & 1` im Frontend, Code `drag_not_held` |
| 2 | Crate `drag` kanonisiert unter Windows jeden Pfad auf dem UI-Thread (hängendes SMB friert ein; dangling Link bricht ab) | mittel | offen, dokumentiert – eigener OLE-Code wäre nötig |
| 3 | WebView sieht nach dem nativen Drag kein `pointerup` | mittel | unter Linux bestätigt (erster Klick nach dem Drop ging verloren, in Xvfb reproduzierbar) und behoben: GTK schickt am `drag-end` ein synthetisches Loslassen an den WebView; danach E2E zweimal grün. macOS/Windows bei Marc prüfen |
| 4 | Zwei GTK-Drags zugleich → zweiter `drag-data-get` | niedrig | behoben: ein Drag zugleich |
| 5 | Archivprüfung nur im Frontend | niedrig | ok – Rust lehnt virtuelle Pfade ohnehin ab |
| 6 | Design nannte `glib::filename_to_uri` / Hauptfenster-Prüfung | niedrig | Design korrigiert |

## 7. Offen

- macOS (`NSDraggingSession` über `drag`) und Windows (`DoDragDrop`) ungeprüft – Finder, Schreibtisch, Mail, Explorer;
  dabei auch: erster Klick nach dem Drop (Review #3), Loslassen direkt am Fensterrand (#1).
- Windows: Pfade auf hängenden Netzlaufwerken frieren beim Start kurz das Fenster ein (Review #2).
- Verschieben ins System (E3), Tabs zwischen den Seiten ziehen, Verknüpfung per Drag (012 E5).
