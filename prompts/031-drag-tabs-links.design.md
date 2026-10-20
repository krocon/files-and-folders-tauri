# Design 031: Tabs ziehen, Verknüpfungen, Verschieben ins System

> Status: **in Arbeit** · Branch `feat/drag-tabs-links` · Prompt: [031-drag-tabs-links.md](031-drag-tabs-links.md)
> · Marc hat am 20.10.2026 Rahmen und Ablauf („selbständig, ohne Freigabe-Halt“) festgelegt – die Entscheidungen stehen
> hier, Rückfragen waren nicht möglich.

## 1. Bestand → wofür → passt/fehlt

| Baustein | wofür | Stand |
|---|---|---|
| `WorkspaceStore.moveTab/moveTabToOther/cloneTabToOther` | Tab-Kontextmenü | passt für ±1 und „ans Ende der anderen Seite“; **fehlt**: Einfügen an beliebiger Position, per Id |
| Tab-Kontextmenü (`TabBar.menuItems`) | Maus/Shift+F10 | passt; Aktionen + Kürzel dafür **fehlen** |
| `TabBar` (APG-Tabliste, Drop-Zone für Dateien 028 §8) | Tabs | erweitert um eigenen Pointer-Drag |
| `WorkspaceStore.snapshot` → `save_session` | Sitzung | passt – speichert jede neue Ordnung entprellt |
| `DragStore`, `dnd-logic.ts` (`DragKind`, `dragKind`) | Ziehen von Einträgen | erweitert um `link` |
| `OpsStore.openCopyMoveFor` + `CopyMoveDialog` | Dialog nach dem Drop | erweitert um `link` (eigene Felder) |
| Job-Engine `JobSpec`, `manager::validate/run` | Jobs | neue Art `link` |
| `platform.rs` | OS-Unterschiede | neu `make_symlink` (Unix `symlink`, Windows `symlink_file/dir`) |
| `start_os_drag` (028) | Ziehen ins System | bleibt bei Kopieren (E12) |
| mr / legacy | Vorlage | kein Link-Dialog, kein Tab-Drag (nur TODO „Tab-Drag&Drop“); TC: Strg+Umschalt+F5 „Verknüpfung anlegen“ |

## 2. Entscheidungen

### Tabs

**E1 Eigener Pointer-Drag in der Tab-Leiste, keine HTML5-DnD.** Gleicher Grund wie 012 E5 (Tauri fängt HTML5-Drag mit
`dragDropEnabled` unter Windows ab; Pointer-Ereignisse sind unter Xvfb mit `xdotool` prüfbar). Linke Taste auf einem
Tab-Kopf, Bewegung > 6 px (`DRAG_THRESHOLD`), Pointer-Capture am Tab; Esc bricht ab; der Klick nach dem Loslassen wird
geschluckt (sonst würde er den Tab unter dem Zeiger auswählen). Ein Klick ohne Bewegung wählt wie bisher.
Zustand im Root-`TabDragStore` (`features/workspace/tab-drag.store.ts`), Regeln rein in `tab-drag-logic.ts`.

**E2 Ziele.** (a) Die Tab-Leiste einer Seite: Einfügeposition = vor dem ersten Tab, dessen Mitte rechts vom Zeiger
liegt, sonst ans Ende (`insertionIndex`). (b) Die übrige Fläche der **anderen** Seite (Header, Liste, Statuszeile):
ans Ende ihrer Tabs. Die eigene Liste ist kein Ziel (dort gibt es keine Position). Ein Drop, der nichts ändert (gleiche
Stelle), ist kein Ziel. Anzeige: Einfügemarke als senkrechter Balken am Tab (`insert-before`/`insert-after`,
Akzentfarbe), Hinweis am Zeiger „Tab verschieben → rechts, Position 2“ bzw. „kein Ziel“ und dieselbe Meldung in einer
Live-Region (`role="status"`).

**E3 Kopieren mit Modifier nach Plattformkonvention:** macOS **⌥** (Finder/Safari: Option = Kopie), Windows/Linux
**Strg** (Explorer, Nautilus, Browser-Tabs). Live auswertbar wie bei Dateien (Modifier drücken/lösen ohne Bewegung).
Kopie = neue Id, gleicher Ordner, gleiche Ansichtseinstellungen; ein Ergebnis-Tab teilt sich das Ergebnis (wie
`cloneTabToOther`), sein Navigationsgedächtnis beginnt neu.

**E4 Regeln.** Der **letzte Tab einer Seite bleibt** (Verschieben weg von einer Seite mit einem Tab = kein Ziel,
Hinweis „Der letzte Tab einer Seite bleibt – Strg: kopieren“; Kopieren geht). Höchstens `MAX_TABS` (50) je Seite. Nach
dem Drop ist der Tab auf der Zielseite ausgewählt und die Zielseite aktiv (wie ein Browser); in der eigenen Leiste
bleibt die Auswahl beim selben Tab (per Id). Alles per Id: `WorkspaceStore.placeTab(tabId, toSide, index, copy)`
(Index = Einfügeposition **vor** dem Entfernen; die Korrektur beim Umsortieren rechnet die reine Funktion
`placeIndex`). Ergebnis-Tabs (009) und Archiv-Tabs (016) sind gewöhnliche Tabs – Pfad/Ergebnis-Schlüssel wandern mit,
`searchKeys` gibt ein Ergebnis erst frei, wenn kein Tab es mehr zeigt. Die Sitzung speichert über den Snapshot.

**E5 Tastatur = Aktionen** (Gruppe „Auswahl, Panels & Tabs“): `MOVE_TAB_LEFT`, `MOVE_TAB_RIGHT` (Win/Linux
**Strg+Umschalt+Bild↑/Bild↓**, Konvention von Firefox/Chrome; macOS **⌃⇧Bild↑/Bild↓** wie Firefox auf dem Mac),
`MOVE_TAB_TO_OTHER_SIDE`, `COPY_TAB_TO_OTHER_SIDE` (ohne Vorgabe-Kürzel – Befehlspalette, Tab-Kontextmenü
Umschalt+F10; frei belegbar im Kürzel-Dialog). Sie wirken auf den aktiven Tab der aktiven Seite; „auf die andere
Seite“ macht die andere Seite aktiv und gibt ihr den Fokus (der Tab „folgt“). Im Tab-Kopf selbst bleibt die
APG-Tastatur (Pfeile wählen) unverändert; die Kürzel mit Bild↑/↓ erreichen den globalen Dispatcher, weil die
Tab-Leiste sie nicht behandelt.

**E6 Barrierefreiheit.** Ziehen ist eine reine Maus-Ergänzung; jede Funktion gibt es per Tastatur (E5, Kontextmenü).
Nach einer Tastatur-Aktion behält der verschobene Tab den Fokus, wenn er ihn hatte – ein Screenreader liest dann
„Tab 2 von 3“ aus der Tabliste. Die Live-Region meldet während des Ziehens Ziel und Art.

### Verknüpfungen

**E7 Drag mit Link-Modifier.** `DragKind = 'copy' | 'move' | 'link'`. macOS **⌘⌥** (Finder: Alias), Windows/Linux
**Strg+Umschalt** (Explorer: Verknüpfung, Nautilus/Dolphin: Link). Shift bzw. ⌘ allein bleibt Verschieben. Nicht
Alt unter Linux (Fenster-Ziehen vieler Fenstermanager). Ablegen öffnet wie immer einen Dialog (012 E5) – hier
„Verknüpfung anlegen“. Drops von außen kennen keine Modifier (012 E6) – bleibt Kopieren.

**E8 Dialog und Aktion.** Neue Aktion `OPEN_LINK_DLG` „Verknüpfung anlegen…“ (Gruppe Dateien), Kürzel
**Strg/⌘+Umschalt+F5** (TC). Der Kopieren/Verschieben-Dialog bekommt `kind: 'link'`: Ziel (gleiche Vorschläge),
Name im Ziel (ein Eintrag), Ankreuzfeld **„Relativer Link“** (Vorgabe aus), Auswahl **„Wenn der Name existiert“**:
*Fehler melden* (Vorgabe) / *Beide behalten (neuer Name)*. Kein Zähl-Job, kein Hintergrund-Schalter (Links sind
schnell), kein Gefahren-Hinweis (nichts wird verändert). Aktiv mit Auswahl in einem echten Ordner oder Ergebnis-Tab,
**nicht in einem Archiv** (virtuelle Pfade) – und kein Ziel in einem Archiv (`openCopyMoveFor` prüft schon).
Gleicher Ordner ohne neuen Namen und ohne „Beide behalten“ → „Quelle und Ziel sind gleich“.

**E9 Job-Art `link`** (`jobs/link.rs`, seriell wie Kopieren):
`{ kind: 'link', sources, targetDir, options: { relative, renameTo, keepBoth } }`.
- `validate`: Quellen nicht leer, ≤ 100 000, jeder Pfad und das Ziel über `validate_input_path`, `renameTo` über
  `validate_name` und nur bei genau einer Quelle.
- Lauf: Ziel muss ein echter Ordner sein (`metadata`, folgt Links; virtueller Archivpfad → `not_found` → Job
  scheitert). Je Quelle: `symlink_metadata` (existiert, auch dangling Link; Archivpfad → `not_found` als Eintragsfehler),
  Name = `renameTo` oder Dateiname (`validate_name`), Link mit `platform::make_symlink`.
- **Nie überschreiben**: `symlink()`/`CreateSymbolicLinkW` schlagen atomar fehl, wenn der Name existiert →
  Eintragsfehler `already_exists`; mit `keepBoth` freier Name `name (1).ext` (`copy::suggest_name`), bei einem
  Wettlauf bis zu 3 Versuche.
- **Absolut ist die Vorgabe** (Ziel = der Pfad der Quelle, wie gelistet – kein `canonicalize`, CLAUDE.md §4): bleibt
  gültig, wenn der Link verschoben wird; Finder-Alias und TC arbeiten ebenso. **Relativ** auf Wunsch (Bäume, die
  zusammen wandern): rein lexikalisch `relative_target(quelle, linkordner)` (gemeinsame Wurzel nötig – sonst, z. B.
  anderes Laufwerk unter Windows, Fehler `relative_link_impossible`). Weil `..` im Dateisystem physisch aufgelöst
  wird, kann ein lexikalisch relativer Pfad über einen verlinkten Ordner woanders hinzeigen. Deshalb prüft Rust
  **vor** dem Anlegen, dass `linkordner/relativ` (ohne den letzten Link zu folgen) derselbe Eintrag ist wie die Quelle
  (Unix: Gerät + Inode; Windows: Art, Größe, Änderungszeit als Näherung) – sonst `relative_link_impossible`,
  nichts entsteht.
- Ordner unter Windows: `symlink_dir`, wenn die Quelle (Links gefolgt) ein Ordner ist, sonst `symlink_file`; ohne
  Recht/Entwicklermodus (`ERROR_PRIVILEGE_NOT_HELD`, 1314) → neuer Code **`link_not_permitted`** mit Hinweis auf den
  Entwicklermodus. Keine `.lnk`-Dateien (Shell-Verknüpfungen sind für andere Programme keine Dateisystem-Links und
  bräuchten COM). Unter Unix meldet `EPERM` ein Dateisystem ohne Links (FAT/exFAT, manche Freigaben) → ebenfalls
  `link_not_permitted`.
- Kein Gefahren-Check (nichts wird verändert, ein Link auf `/` ist harmlos); keine `expected`-Prüfung (030 E5 gilt
  für Löschen/Verschieben). Ein Link in einen Unterordner der Quelle (Zyklus) ist erlaubt – Listing, Suche und
  Ordnergröße folgen keinen Links bzw. sind zyklensicher.
- Fortschritt: Einträge (`itemsTotal/itemsDone`), Abbruch zwischen Einträgen, am Ende `dirsChanged(target)`;
  `target_dirs()` enthält das Ziel (029 E8).

**E10 Kein `.lnk`, keine Hardlinks** (schmal halten; Hardlinks gehen nicht für Ordner und nicht über Laufwerke).

### Verschieben ins System

**E11 Nicht aufgenommen – 028 E3 bleibt (nur Kopieren).** Geprüft und verworfen:
- **Windows:** Liefert `DoDragDrop` `DROPEFFECT_MOVE` ohne „optimized move“ (z. B. auf ein anderes Laufwerk), erwartet
  die Shell, dass die **Quelle** die Originale löscht – wir müssten nach einer Kopie, deren Erfolg wir nicht prüfen
  können, löschen. Das widerspricht CLAUDE.md §4 (Destruktives nur validiert in Rust).
- **macOS:** Die Operation handelt das Ziel aus (Finder verschiebt auf demselben Volume ohne Modifier, sobald die
  Quelle `Move` erlaubt); ein „nur mit ausdrücklichem Modifier“ lässt sich nur über die Maske beim Start erzwingen und
  wäre ab dann nicht mehr umkehrbar. Ungetestet in diesem Container.
- **GTK:** `ACTION_MOVE` mit `text/uri-list` – manche Ziele verschieben selbst, andere senden `drag-data-delete` an die
  Quelle (wie Windows). Uneinheitlich.
- Ersatz: ins System ziehen (Kopie) und danach F8 (Papierkorb) – zwei sichtbare, geprüfte Schritte. Innerhalb der App
  bleibt Verschieben per Shift/⌘ mit Dialog. Festgehalten in `docs/feature-parity.md` (Zeile Drag & Drop).

## 3. Verträge

Rust (`jobs/mod.rs`):
```rust
JobSpec::Link { sources: Vec<String>, target_dir: String, #[serde(default)] options: LinkOptions }
#[serde(rename_all = "camelCase")] pub struct LinkOptions { relative: bool, rename_to: Option<String>, keep_both: bool }
// kind() = "link", is_parallel() = false, is_helper() = false, target_dirs() = [target_dir]
// platform::make_symlink(target: &Path, link: &Path, dir_hint: bool) -> io::Result<()>
// jobs::link::relative_target(source: &Path, link_dir: &Path) -> Option<PathBuf>   (rein)
```
Neue Fehlercodes (Rust `error.rs`, TS `fs.models.ts`, `fs-error.ts` + Texte en/de): `link_not_permitted`,
`relative_link_impossible`.

TS:
```ts
| { kind: 'link'; sources: readonly string[]; targetDir: string; options?: LinkOptions }
interface LinkOptions { relative?: boolean; renameTo?: string | null; keepBoth?: boolean }
type DragKind = 'copy' | 'move' | 'link';
WorkspaceStore.placeTab(tabId: string, to: Side, index: number, copy: boolean): string | null  // Id des platzierten Tabs
interface TabDropTarget { side: Side; index: number }   // tab-drag-logic.ts
```
Aktionen: `MOVE_TAB_LEFT`, `MOVE_TAB_RIGHT`, `MOVE_TAB_TO_OTHER_SIDE`, `COPY_TAB_TO_OTHER_SIDE`, `OPEN_LINK_DLG`.

UI-Skizze (Tab-Leiste rechts, Tab „Bilder“ wird zwischen „home“ und „src“ gezogen):
```
▾ [home]┃[src][docs]  + −          ┃ = Einfügemarke (Akzentfarbe)
          └ Hinweis am Zeiger: „Tab verschieben: Bilder → rechts, Position 2 · Strg: kopieren · Esc: abbrechen“
```

## 4. Tests

- Rust (`jobs/tests_link.rs`, `jobs/link.rs`): absolut (Datei, Ordner, Unicode/Leerzeichen/Emoji), relativ (gleicher
  Ordner, Geschwister, Elternordner), relativ über einen verlinkten Linkordner → `relative_link_impossible`, nichts
  angelegt; Konflikt → `already_exists`, Original unverändert; `keepBoth` → `x (1)`; `renameTo`; dangling Quelle;
  fehlende Quelle/Archivpfad → Eintragsfehler; Ziel ist Datei/fehlt → Job scheitert; Validierung (leer, relativ,
  `renameTo` bei mehreren, ungültiger Name); Abbruch; `relative_target` (rein, auch ohne gemeinsame Wurzel); Wire-Format.
- Frontend: `tab-drag-logic.spec.ts` (`insertionIndex`, `placeIndex`, Regeln letzter Tab/no-op/Kopie), 
  `workspace.store.spec.ts` (`placeTab`: umsortieren, andere Seite, Kopie, letzter Tab, MAX_TABS, Suche),
  `tab-drag.spec.ts` (Store + Tab-Leiste: Schwelle, Einfügemarke, Modifier, Esc, Klick geschluckt),
  `workspace-actions.spec.ts` (neue Aktionen), `dnd.spec.ts` (`dragKind` Link, Drop → Link-Dialog),
  `ops.spec.ts`/`dialogs.spec.ts` (Link-Anfrage, Job-Spec, Archiv, gleicher Ordner), `job-format.spec.ts` (Titel).
- E2E (Xvfb, Linux): Tab umsortieren, auf andere Seite ziehen (mit/ohne Strg), letzter Tab, Neustart; Link per
  Strg+Umschalt-Drag und per Strg+Umschalt+F5, relativ und absolut, Konflikt.

## 5. Fortschritt

- [x] Prompt + Design
- [ ] Rust (Job `link`, Plattform, Fehlercodes)
- [ ] Frontend (Tab-Drag, Aktionen, Link-Drag + Dialog)
- [ ] E2E unter Xvfb
- [ ] Doku (architecture, feature-parity, README, prompts/README)
- [ ] Abschluss: `pnpm check`, Debug-Build, Selbst-Review

## 6. Review

(folgt)

## 7. Offen

- macOS/Windows: `make_symlink` (Windows `symlink_dir/file`, 1314) und die Kürzel ⌃⇧Bild↑/↓, ⌘⌥-Drag nur in der CI
  bzw. bei Marc prüfbar.
