# Design 014: Kontextmenü und Menüleiste

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) · **Datum:** 2026-10-18 ·
> **Branch:** `feat/kontextmenue-menueleiste` (von `main`, 001–011 fertig; 012/013 parallel)
> **Grundlage:** legacy §2 („Menu-only actions“), §3 (Kontextmenü = Platzhalter), mr §1.4/§1.8 (Actions ▴,
> Tab-Kontextmenü), CLAUDE.md §4 (jede Funktion ist eine Aktion, schmale Commands), APG Menu/Menubar.
> **Phasen:** alle sechs; Rust ist klein (ein Modul `app_menu.rs` + zwei Commands).

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| `features/workspace/context-menu.ts` | APG-Popup (`role="menu"`, ↑/↓/Pos1/Ende, Enter/Leertaste, Esc/Tab), Gruppen mit Überschrift, deaktivierte Einträge; genutzt vom Tab-Menü und vom Ordnermenü ▾ | **erweitern**: Kürzel-Badge, Trenner, Untermenüs (→/← bzw. Enter), Tooltip – bleibt ein generisches Widget (Ids rein, `chosen(id)` raus) |
| `features/actions/actions-menu.ts` | Actions ▴: vier Spalten aus dem Katalog, Kürzel, gedimmt + „Coming in prompt …“, Tools am Ende | **passt**; der Eintrags-Aufbau (Label, Badge, Zustand, Hinweis) wandert in eine gemeinsame Funktion `actionEntry()` (eine Quelle für alle Menüs) |
| `ActionService` (002/011) | `state(id)`, `run(id)`, `shortcutLabel(id)`, Tools als `extras` (`tool:<id>`), `runExtra` | **erweitern** um `runAny(id)` (Katalog-Id oder Tool-Id) – sonst nichts |
| `KeyboardDispatcher` | Capture-Handler; „schlichte“ Tasten nur in der Liste | **erweitern**: Aktionen mit Fokus-Bezug (`OPEN_CONTEXT_MENU`) feuern nur in der Liste (sonst bekommt der Tab-Reiter sein `Shift+F10`) |
| GuiExpert `onContextmenu` | `GeMouseEvent` mit `rowIndex` (angezeigt), `-1` auf freier Fläche; Core ruft kein `preventDefault` | **passt** (`api.subscribe`) – keine Lücke |
| `FileListController.moveCursorTo(path)` | Cursor setzen + Store | **passt** für „Rechtsklick setzt den Cursor“ |
| `selectionForAction` (006) | Markierung, sonst Cursor, nie `..` | **bleibt die Regel** – das Menü zeigt an, worauf es wirkt |
| Tauri `Menu` (muda 0.20) | macOS bekommt heute Tauris Default-Menü | **ersetzen** durch unser Menü (macOS) |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Kontextmenü: eigenes HTML-Menü (APG) statt nativem `popup` ✅

Nativ (`Menu::popup`) hieße: pro Öffnen ein IPC-Rundlauf mit kompletter Spezifikation, keine Themes (013), keine
Tooltips („kommt in Prompt …“), Fokusrückgabe und Tests nur im echten Fenster, Linux-GTK-Popups unter Xvfb
wacklig. Das HTML-Menü existiert schon (Tab-Menü), ist mit Vitest testbar und sieht auf allen OS gleich aus.
Untermenüs: **Mit Tool öffnen ▸** (die Tools aus 011) und **Kopieren als ▸** (Namen, Pfade, JSON).
Fokus: erstes aktives Element; Esc → zurück in die Liste; Klick außerhalb → Fokus bleibt, wo er hinging.

### E2 – Einträge je Kontext, deaktiviert statt fehlend ✅

Reine Funktion `contextMenuFor(kind)` liefert Aktions-Ids, Trenner und Untermenüs:

| Kontext | Erkennung | Inhalt (Kurzform) |
|---|---|---|
| `file` | Cursor auf Datei, keine Markierung | Öffnen, Ansehen, Bearbeiten, Mit Tool ▸ · Kopieren, Verschieben, Umbenennen, Löschen · Kopieren als ▸, Im Dateimanager zeigen, Eigenschaften |
| `folder` | Cursor auf Ordner | Öffnen, In neuem Tab, Ordnergröße · Kopieren … Löschen · Kopieren als ▸, Im Dateimanager, Terminal hier, Eigenschaften |
| `marked` | ≥ 1 Markierung | Überschrift „N markiert“ · Kopieren, Verschieben, Löschen, Multi-Rename, Gruppieren, Packen · Mit Tool ▸, Kopieren als ▸, Eigenschaften · Markierung aufheben, umkehren |
| `empty` | freie Fläche oder `..` | Neuer Ordner, Neue Datei, Mehrere Ordner · Neu laden, Versteckte, Filter, Ordnergrößen · Alle markieren, Muster … · Terminal hier, Im Dateimanager |
| `result` | Ergebnis-Tab (009) | Gehe zu Datei, Öffnen, Ansehen, Bearbeiten, Mit Tool ▸ · Kopieren, Verschieben, Löschen · Kopieren als ▸, Im Dateimanager, Erneut suchen, Eigenschaften |

Einträge ohne Handler bzw. mit `enabled() === false` erscheinen gedimmt (`aria-disabled`), mit Tooltip
„Coming in prompt NNN“. Ein Menü-Eintrag ist **immer** eine Aktion (`ActionService.runAny`) – keine Menü-Logik.

### E3 – Rechtsklick und Auswahl (TC) ✅

Rechtsklick auf eine Zeile setzt den Cursor dorthin (`moveCursorTo`), **die Markierung bleibt immer unverändert**
(auch auf einer nicht markierten Zeile). Weil alle Aktionen „Markierung, sonst Cursor“ nehmen, zeigt das Menü dann
den Kontext `marked` mit der Überschrift „3 marked entries“ – sichtbar, worauf es wirkt. Alternative (Finder:
Markierung durch die Zeile ersetzen) verwirft Arbeit des Nutzers; Alternative (TC: nur diese Datei, Markierung
behalten) bräuchte eine Auswahl-Überschreibung in jeder Aktion = Menü-Logik. Rechtsklick auf `..`/freie Fläche:
Cursor bleibt, Kontext `empty` (bzw. `marked`, wenn markiert ist).

### E4 – Tastatur: neue Aktion `OPEN_CONTEXT_MENU` (`Shift+F10`, Kontextmenü-Taste) ✅

Öffnet das Menü an der Cursor-Zeile (sonst oben links in der Liste). Feuert nur, wenn der Fokus in der Liste ist
(oder nirgends) – Tab-Reiter behalten ihr eigenes `Shift+F10`.

### E5 – Menüleiste: nativ unter macOS, HTML-Menüleiste unter Windows/Linux ✅

| Option | macOS | Windows/Linux |
|---|---|---|
| nativ (Tauri `Menu`) | Pflicht: ohne Bearbeiten-Menü gehen ⌘C/⌘V/⌘A in Textfeldern nicht, App-Menü (Über, Einstellungen ⌘,, Dienste, Ausblenden, Beenden) erwartet jeder | GTK/Win32-Accelerator fangen Tasten **vor** der WebView ab (GTK `AccelGroup`): `Mod+A` im Textfeld würde „Alle markieren“; Kürzel ohne Registrierung anzeigen kann muda nicht |
| HTML (APG `menubar`) | widerspricht der Plattform | gleiche Optik wie die App, Themes, Kürzel nur als Badge, Ereignisse bleiben im Dispatcher |

→ **macOS nativ**, **Windows/Linux HTML** (eine Zeile über den Panels, `docs/ui-layout.md` Zeile 0). Beide aus
**einem** Modell `MENU_BAR` (Aktions-Ids). `FNF_NATIVE_MENU=1` erzwingt das native Menü auch unter
Windows/Linux (Diagnose/E2E; dann ohne die HTML-Leiste).

### E6 – Eine Quelle für Kürzel: die Keymap erzeugt die Accelerator ✅

Das Frontend schickt die Menü-Spezifikation mit Kürzeln in **Keymap-Notation** (`Mod+Shift+P`, kanonisch, schon
mit Override aufgelöst); Rust übersetzt sie (`Mod` → `Cmd` auf macOS bzw. `Ctrl`) und nimmt nur, was sicher ist:
**mit `Mod`/`Ctrl` oder eine F-Taste**, ein einzelner Strich. Ohne Accelerator bleiben schlichte Tasten (Enter,
Leertaste, Tab, Backspace, Numpad) und `Alt+Buchstabe` (⌥ tippt unter macOS Zeichen) – sonst fingen Menüs Tasten in
Textfeldern ab. Akkorde (`Ctrl+K F6`) haben nie einen. Weil das Modell bei jeder Keymap-Änderung neu geschickt
wird, wirkt ein Override sofort (Akzeptanz: „nach Neustart“ ist damit erfüllt).

**Doppelauslösung:** WKWebView gibt ⌘-Tasten zuerst der Seite; der Dispatcher ruft `preventDefault`, das Menü
feuert dann nicht. Als Sicherung verwirft die Menü-Brücke ein Menü-Ereignis für dieselbe Aktion, die der
Dispatcher < 400 ms vorher ausgelöst hat. Bei offenem Dialog sind alle Aktions-Einträge deaktiviert (wie der
Dispatcher); die Bearbeiten-Einträge (nativ, `PredefinedMenuItem`) bleiben aktiv – genau dann braucht man sie.

### E7 – Schmale Command-/Event-Schicht ✅

`set_app_menu(spec)` (baut/ersetzt das Menü, gibt `true` zurück, wenn es nativ installiert wurde) und
`subscribe_menu(channel)` (ein `tauri::ipc::Channel<MenuEvent>`, wie `subscribe_jobs`). `on_menu_event` schickt
nur Ids, die in der Spezifikation standen. Validierung in Rust (reine Funktionen, unit-getestet): Ids
`[A-Za-z0-9_:.-]{1,80}`, Labels ≤ 120 Zeichen ohne Steuerzeichen, Tiefe ≤ 3, ≤ 600 Knoten, vordefinierte Einträge
aus einer festen Liste. Ungültiges → `FsError { code: "invalid_menu" }`.

Native Aktualisierung: das Frontend schickt das Modell entprellt (150 ms) und nur bei Änderung (JSON-Vergleich);
der Zustand „aktiv“ steckt im Modell, ein Neuaufbau kostet < 1 ms bei ~120 Einträgen.

### E8 – Gliederung der Menüleiste ✅

| Menü | Inhalt |
|---|---|
| *App* (nur macOS) | Über (nativ), Einstellungen… ⌘, (`OPEN_SETUP_DLG`), Tastenkürzel…, Dienste, Ausblenden, Andere ausblenden, Alle einblenden, Beenden |
| Datei | Öffnen, In neuem Tab, Ansehen, Bearbeiten, Neue Datei, Neuer Ordner, Mehrere Ordner · Kopieren, Verschieben, Umbenennen, In der Liste umbenennen, Löschen, Endgültig löschen · Multi-Rename, Rückgängig, Gruppieren, Leere Ordner, Packen, Entpacken, Duplikate · Eigenschaften · (Win/Linux) Beenden |
| Bearbeiten | (macOS nativ: Widerrufen, Wiederholen, Ausschneiden, Kopieren, Einsetzen, Alles auswählen) · Alle markieren, Markierung aufheben, Umkehren, Markieren/Entmarkieren nach Muster, Markieren und weiter · In die Zwischenablage ▸ |
| Ansicht | Neu laden, Versteckte, Filter, Ordnergrößen, Schnellansicht, Shell, Panels 50/50, Themes… |
| Gehe zu | Übergeordnet, Zurück, Vorwärts, Pfad…, Ordnermenü links/rechts, Ordner finden…, Gehe zu allem…, Gehe zu Datei, Favorit, Im Dateimanager, Terminal hier |
| Werkzeuge | Suchen…, Erneut suchen, Mit Tool öffnen…, *die Tools*, Tool-Konfiguration…, Tastenkürzel…, Buttons…, Aktion aufrufen…, (Win/Linux) Einstellungen… |
| Fenster | Panel wechseln, Linkes/Rechtes Panel, Nächster/Vorheriger Tab, Tab klonen, Tab schließen, Aufgaben… · (macOS nativ: Minimieren, Zoomen, Vollbild) |
| Hilfe | Tastenkürzel…, Gehe zu allem…, (Win/Linux) Über… |

Test: **jede** Katalog-Aktion außer den reinen Tasten-Aktionen (`MARK_*`, `NAVIGATE_OPEN` ist drin) kommt in der
Menüleiste vor.

### E9 – Neue Aktionen ✅

| Id | Label | Kürzel | Handler |
|---|---|---|---|
| `OPEN_CONTEXT_MENU` | Context menu | `Shift+F10`, `ContextMenu` (alle OS) | Menü-Service |
| `FOCUS_MENU_BAR` | Menu bar | `Alt+M` (Win/Linux), keins auf macOS | HTML-Leiste: erster Eintrag fokussiert; macOS/nativ: deaktiviert |
| `QUIT_APP` | Quit | keins (Alt+F4/⌘Q sind Sache des OS) | Command `close_main_window` (geht durch `CloseRequested` → laufende Jobs fragen, Sitzung sichern) |

Dazu Keymap: `OPEN_SETUP_DLG` = `Mod+,` (alle OS; noch ohne Handler bis 015).

### E10 – Browser-Kontextmenü der WebView ✅

Rechtsklick außerhalb unserer Menüs zeigt sonst WebKits Menü (Neu laden, Untersuchen). Ein globaler Handler
unterdrückt es überall außer in Textfeldern und bei markiertem Text (Kopieren bleibt).

### E11 – Systemkontextmenü des OS (Aufgabe 3, nur bewertet) ✅

Windows `IContextMenu` (Shell-Erweiterungen: 7-Zip, Git, …) bräuchte COM, ein HWND-Popup außerhalb der WebView und
führt fremden Code im Prozess aus; macOS hat keine öffentliche API für Finder-Kontextmenüs (Dienste ja: das
native App-Menü enthält „Dienste“); Linux hat keinen Standard (Nautilus/Dolphin je eigene Erweiterungen). →
**nicht umgesetzt**, Eintrag in `docs/feature-parity.md`; Ersatz: „Im Dateimanager zeigen“ + Tools (011).

## 3. Verträge

```rust
// app_menu.rs (rein) + commands.rs
#[serde(tag = "kind", rename_all = "camelCase")]
enum MenuNode { Item { id, label, accelerator: Option<String>, enabled: bool },
                Submenu { label, items: Vec<MenuNode> }, Separator, Predefined { name: String } }
struct MenuSpec { menus: Vec<MenuNode> /* nur Submenu */ }
struct MenuEvent { id: String }
#[tauri::command] fn set_app_menu(app, state, spec: MenuSpec) -> Result<bool, FsError>
#[tauri::command] fn subscribe_menu(state, channel: Channel<MenuEvent>)
#[tauri::command] fn close_main_window(app) -> Result<(), FsError>
fn native_accelerator(canonical: &str, macos: bool) -> Option<String>   // E6
fn validate_spec(&MenuSpec) -> Result<(), String>                        // E7
```

TS: `core/menu/menu-api.ts` (`MenuApi.setAppMenu`, `subscribe`, `closeMainWindow`), DTOs `menu.models.ts`;
`features/menus/`: `menu-model.ts` (rein: `MENU_BAR`, `contextMenuFor`, `resolve()` → `MenuItem[]`,
`toNativeSpec()`), `menu.service.ts` (Root: Kontextmenü-Zustand, nativ/HTML, Brücke), `menu-bar.ts` (HTML-Leiste).

## 4. UI-Skizze

```
┌ File  Edit  View  Go  Tools  Window  Help ───────────────── (nur Win/Linux, role="menubar") ┐
│ Pfad links            ☆ │ Pfad rechts             ☆ │
│ …                                                    │
│  report.pdf     ┌──────────────────────────┐         │
│  Ölbild.png     │ Open                   ↩ │         │
│                 │ View                  F3 │         │
│                 │ Open with tool       ▸ ┐ │         │
│                 │ ──────────────────────── │         │
│                 │ Copy…                 F5 │         │
│                 │ Copy as              ▸   │         │
└─────────────────└──────────────────────────┘─────────┘
```

Menüleiste (APG): `role="menubar"`, Einträge `menuitem` mit `aria-haspopup="menu"`/`aria-expanded`; ←/→ wandern
(auch bei offenem Menü), ↓/Enter/Leertaste öffnen, Esc schließt (Fokus zurück auf den Eintrag), zweites Esc/Tab →
zurück in die Liste. Kontextmenü: Untermenü `aria-haspopup`, → / Enter öffnet, ← / Esc schließt nur das Untermenü.

## 5. Tests

- Rust: `native_accelerator` (Mod je OS, F-Tasten, schlichte Tasten/Alt/Akkorde → `None`, Satzzeichen), `validate_spec`
  (Tiefe, Ids, Steuerzeichen, unbekannte Predefined, Anzahl), Serde-Form (camelCase/tag).
- Frontend: `menu-model.spec` (Kontexte, jede Aktion in der Leiste, Tools-Untermenü, gedimmt + Hinweis, nativer
  Spec: Dialog offen → deaktiviert, Kürzel aus dem Override), `context-menu.spec` (Untermenü per Tastatur, Badge,
  Trenner), `menu-bar.spec` (APG-Tastatur), Dispatcher (Fokus-Bezug), Menü-Service (Kontext aus Store, Dedupe).
- E2E (Xvfb): Rechtsklick Datei/Ordner/markiert/frei, `Shift+F10`, Untermenü Tools, Aktion wirkt (F5-Dialog mit
  richtiger Auswahl), HTML-Menüleiste mit Kürzeln, Override → Badge ändert sich, `FNF_NATIVE_MENU=1` GTK-Menü.

## 6. Annahmen

- 012 (DnD) und 013 (Themes) laufen parallel; das Kontextmenü nutzt nur bestehende Tokens, Themes greifen
  automatisch. `OPEN_THEMES_DLG` bleibt bis zum Merge gedimmt.
- Kein „Einfügen“ von Dateien aus der OS-Zwischenablage (gibt es noch nicht als Aktion) – nicht im Menü.
- „Über“ unter macOS = natives About-Fenster (Name, Version aus `tauri.conf.json`); unter Win/Linux bleibt
  `OPEN_ABOUT_DLG` gedimmt bis 015.

## 7. Abweichungen bei der Umsetzung

- **Menüleiste im App-Root**, nicht im Grid des Workspace (`app.ts`: Flex-Spalte Menüleiste + Workspace) – keine
  Umnummerierung der Grid-Zeilen (weniger Konflikte mit 012/013). Bei offenem Dialog ist sie `inert`; der
  Hintergrund des Dialogs dimmt sie nicht mit (nur optisch).
- **`Mod+,` nicht mehr reserviert** (`RESERVED_MACOS`): es ist jetzt das Kürzel von `OPEN_SETUP_DLG` = Einstellungen
  im App-Menü.
- **Fokus nach dem Rechtsklick:** GuiExpert fokussiert beim Loslassen der Maustaste seinen Host – das Kontextmenü
  holt den Fokus beim `pointerup` zurück (nur im echten Fenster prüfbar, jsdom hat das Verhalten nicht → kein roter
  Unit-Test, E2E geprüft). Hover verschiebt den Fokus (eine Hervorhebung für Maus und Tastatur).
- **Menüs ohne aktiven Eintrag** (z. B. Edit, bevor die Liste bereit ist): der Fokus geht auf den ersten
  (gedimmten) Eintrag – APG erlaubt fokussierbare deaktivierte Einträge, sonst wäre `Esc` wirkungslos.
- Die Aktionen der Menüs (Actions ▴, Kontextmenü, Menüleiste, nativ) laufen alle durch `resolveMenu()` bzw.
  `toNativeSpec()` – Actions ▴ wurde darauf umgestellt (gleiches Verhalten).
- GTK-Accelerator (nur mit `FNF_NATIVE_MENU=1`) greifen vor der WebView: im E2E löste `Ctrl+Alt+I` die Aktion genau
  einmal aus (über das Menü-Ereignis). Deshalb bleibt nativ unter Linux/Windows nur Diagnose.

## 8. Review (separater Agent) – Ergebnis

| # | Befund | Bewertung | Umsetzung |
|---|---|---|---|

## 9. Fortschritt

- [x] Phase 1 Design
- [x] Phase 2 Rust: `app_menu.rs` (6 Tests: Accelerator je OS, F-Tasten, schlichte Tasten/Alt/Akkorde, Spec-Validierung,
  JSON-Form), Commands `set_app_menu`, `subscribe_menu`, `close_main_window`, Fehlercode `invalid_menu`
- [x] Phase 3 Frontend: Menümodell + Specs, ContextMenu mit Untermenüs/Badges/Trennern, MenuService, MenuBar,
  Aktionen `OPEN_CONTEXT_MENU`/`FOCUS_MENU_BAR`/`QUIT_APP`, Dispatcher (Fokus-Bezug, Echo-Erkennung)
- [x] Phase 4 E2E (Xvfb, Linux): Rechtsklick Ordner/frei/markiert (Cursor wandert, Markierung bleibt, Überschrift
  „2 marked entries“, Pack gedimmt), Copy… aus dem Menü → Dialog mit den 2 markierten Dateien, `Shift+F10` an der
  Cursor-Zeile, Untermenü „Open with tool“ per → mit den Tools, HTML-Menüleiste per `Alt+M`/↓/→ mit Badges, „Invert
  marks“ aus der Leiste wirkt; Override `INVERT_MARKS = Mod+Alt+I` → nach Neustart im nativen GTK-Menü
  (`FNF_NATIVE_MENU=1`) als `Ctrl+Alt+I`, Klick im nativen Menü und Tastendruck lösen die Aktion je einmal aus.
  Nicht geprüft: macOS-Menü (kein Mac), Windows, Ergebnis-Tab-Kontext nur per Unit-Test.
- [x] Phase 5 Doku: architecture, feature-parity, roadmap, ui-layout, README, CLAUDE.md, prompts/README

## 10. Offen

- Menüleiste unter Windows/Linux ein-/ausblendbar (Einstellung, 015).
- Native Menüs aktualisieren Einträge per Neuaufbau, nicht per `set_enabled` (reicht bei ~120 Einträgen).
- Systemkontextmenü des OS (E11).
