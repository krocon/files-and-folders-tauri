# Design 028: Ziehen aus der App ins System

> Status: **in Arbeit** · Branch `feat/drag-ins-system` · Prompt: [028-drag-ins-system.md](028-drag-ins-system.md)
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

**E2 Command `start_os_drag(paths: string[])`** in `commands/os_drag.rs`, `async`: nur Hauptfenster
(`main_only`-Muster, Code `not_allowed`), höchstens 10 000 Pfade (`too_many`), jeder Pfad über
`validate_input_path` (absolut, ohne `..`) und `symlink_metadata` (existiert; virtuelle Archivpfade scheitern hier).
Leere Liste → `invalid_path`. Der Start läuft per `run_on_main_thread`; das Ergebnis des Starts kommt über einen
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
Leerzeichen, `%`, `#` und nicht-UTF-8-Namen kämen kaputt an. Linux baut URIs mit `glib::filename_to_uri`
(prozentkodiert, Bytes statt Text) – reine Funktion `file_uris`, unit-getestet.

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
pub async fn start_os_drag<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, paths: Vec<String>)
    -> Result<(), FsError>;
// Fehlercodes: invalid_path, not_found (u. a.), too_many, not_allowed, io (Start fehlgeschlagen)
```
TS:
```ts
export abstract class OsDragApi { abstract startOsDrag(paths: readonly string[]): Promise<void>; }
```
Neue Fehlercodes: keine (vorhandene `too_many`, `not_allowed`? → prüfen; fehlt einer, beidseitig ergänzen).

## 4. Tests

- Rust: `validate_drag_paths` (leer, relativ, `..`, fehlend, Archivpfad, zu viele, Unicode/Leerzeichen, Symlink
  dangling = erlaubt), `file_uris` (Leerzeichen, `%`, `#`, Umlaut, Emoji, nicht-UTF-8).
- Frontend: `leftWindow`; `DragStore.handOff` (startet mit den Pfaden, beendet den Drag, Archiv → Meldung ohne Start,
  Fehler → Meldung); `file-list`-Verhalten nur E2E (jsdom ohne Layout).
- E2E (Xvfb): GTK-Testfenster (`python3.12` + PyGObject) neben der App, Drag per `xdotool` aus der Liste hinaus auf das
  Fenster → das Fenster schreibt die empfangenen URIs in eine Datei.

## 5. Fortschritt

- [x] Prompt + Design
- [ ] Rust
- [ ] Frontend
- [ ] E2E
- [ ] Doku
