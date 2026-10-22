# Design 038: Flache Ansicht (alle Dateien unterhalb eines Ordners)

> **Status:** ✅ umgesetzt (Freigabe Marc 22.10.2026) · **Datum:** 2026-10-22 · **Branch:** `feat/flache-ansicht` (von `main` 9106c8c)
> **Grundlage:** Prompt 038, Design 009 (Ergebnis-Tabs, `SearchStore`, Job `search`, E4), Design 029 E1 (Auffrischen ≠
> Navigieren), Design 012 (Überwachung), Total Commander „Flache Ansicht“ (Strg+B). In legacy/mr gibt es kein Vorbild
> (`docs/legacy-analysis*.md`: kein Treffer) – neue Funktion, Zeile in `docs/feature-parity.md` unter „über mr hinaus“.
> **Phasen:** alle sechs; Phase 2 (Rust) ist klein (eine Feldergänzung am Treffer + Tests).

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| Job `search` (`search::walk`, `jobs/search.rs`) | zyklensichere Tiefensuche, Links nie betreten (ohne `followLinks`), Tiefe ≤ 256, `maxHits` ≤ 100 000 + `truncated`, Abbruch, Treffer gebündelt (≤ 500 / 50 ms), unlesbare Ordner gesammelt, `/proc` usw. übersprungen; Name leer = alle | **passt** – flache Ansicht = Suche ohne Namensfilter |
| `SearchHit` | `dir` (voller Elternpfad), `parentNames` | **erweitern**: `relDir` (Elternordner relativ zur Wurzel) – das Frontend zerlegt keine Pfade (CLAUDE.md §4) |
| `SearchStore` (Root) | Ergebnisse je Key, `rerun` leert die Treffer und füllt neu | **erweitern**: Art `flat`, `startFlat`, **stilles Auffrischen** (alte Zeilen bleiben bis zum Ende des neuen Laufs, Cursor/Marken bleiben) |
| `TabState.search` (`SearchTabRef`) | Ergebnis-Tab; `path` = Wurzel, nicht gespeichert (wird Ordner-Tab) | **erweitern**: `flat`-Teil (Zustand vor dem Umschalten). Der Tab behält Id, `path`, Verlauf |
| `FileBrowserStore.showSearch` | Ergebnis ohne `..`, `path()` = `null`, `locationKey()` = `search:<key>` | **passt**; Art `flat` (`ResultKind`) |
| `OpsStore`, Multi-Rename, Packen, F3, Löschen, Drag aus der Liste | gehen im Ergebnis-Tab (Quellen = volle Pfade, Umbenennen im Ordner des Treffers, `removePaths` nach Löschen/Verschieben) | **passt** – nichts Neues nötig; Auffrischen statt `rerun` in der flachen Ansicht |
| Ordner-Aktionen (F7, Datei anlegen, Multi-MkDir, Ziel eines Drops) | brauchen `store.path()` → im Ergebnis-Tab aus | **passt** (= Veto) |
| Datei-Table | Spalte `dir` („Folder“) nur im Such-Tab | **erweitern**: Spalte `relDir` („Path“) nur in der flachen Ansicht |
| `FilePanel` | zeigt Such-Tabs über `tab.search`; ein Tab wechselt seine Art bisher nur durch Navigieren | **erweitern**: Umschalten im selben Tab (an/aus) ohne Tab-Wechsel |
| Überwachung (`WatchService`) | beobachtet `store.path()` je Panel (nicht rekursiv) | **erweitern**: in der flachen Ansicht die Wurzel |
| `JobsStore.changedDirs` | Ordner, die ein Job geändert hat | **passt** – Auffrischen, wenn einer an/unter der Wurzel liegt |
| Esc (`CANCEL_LOADING`) | nur beim Öffnen eines Ordners | **erweitern**: hält auch eine laufende Auflistung (und Suche) an |
| Keymaps | `Mod+B` ist auf allen drei OS frei | **neu** `TOGGLE_FLAT_VIEW` |

## 2. Entscheidungen (Empfehlungen)

### E1 – Modus des bestehenden Tabs, technisch ein Ergebnis-Tab der Art `flat` ✅ empfohlen

| Option | + | − |
|---|---|---|
| A: eigener neuer Tab (wie Suche) | nichts am Tab-Lebenszyklus ändern | TC-Bedienung bricht: Strg+B ist ein Umschalter, „zurück“ wäre Tab schließen; zwei Tabs für denselben Ordner |
| **B: derselbe Tab bekommt `search = { key, …, flat }`** | Id, `path` (= Wurzel), Verlauf, Filter, Hidden bleiben; Strg+B schaltet zurück; alle Wege des Ergebnis-Tabs (Ops, Vetos, Sitzung) gelten ohne Zusatzcode | Panel muss auf „Art des Tabs ändert sich ohne Tab-Wechsel“ reagieren (kleiner Effekt) |
| C: eigener Listing-Modus im `FileBrowserStore` (ohne `SearchStore`) | – | doppelt: Streaming, Drosselung, Abbruch, `removePaths`, Ops-Sonderfälle für Ergebnisse nochmals |

**Empfehlung B** (= Empfehlung des Prompts). `SearchTabRef` bekommt `flat?: FlatRef`:

```ts
interface FlatRef {
  readonly root: string;            // = tab.path beim Einschalten (opak)
  readonly parent: string | null;   // Elternordner der Wurzel (aus dem Listing) – für „nach oben“
  readonly cursorBefore: string | null; // Cursor der normalen Ansicht → beim Ausschalten zurück
  readonly tableBefore: TableState | null; // Spaltenbreiten/Sortierung der normalen Ansicht
  readonly showDirs: boolean;       // „Ordner zeigen“
}
```

- **Einschalten** (`Mod+B` in einem lokalen Ordner-Tab): `SearchStore.startFlat(side)` startet den Job, danach
  `ws.updateTab(id, { search: { key, label: <Ordnername>, rootTitle, flat } , cursor: null })`. Kein neuer Tab.
- **Ausschalten** (`Mod+B` erneut, Back `Alt+←`/`⌘[`, Button im Header): `updateTab(id, { search: null, cursor:
  cursorBefore, table: tableBefore })`, das Panel lädt die Wurzel neu (Cursor dort, wo er war – Akzeptanz). Der
  `SearchStore` gibt das Ergebnis frei (Tab zeigt den Key nicht mehr) und bricht einen laufenden Job ab.
- **Sitzung:** wie Such-Tabs – gespeichert wird der Ordner-Tab der Wurzel (`toPanelSession`, schon vorhanden). Nach
  dem Neustart ist die Ansicht wieder normal (Annahme; TC merkt sich das auch nicht).
- **Tab klonen** (`Mod+T`) teilt das Ergebnis wie bei Such-Tabs.

### E2 – Rust: Job `search` mit festen Kriterien, `SearchHit.relDir` neu ✅ empfohlen

Kein neuer Job, kein neuer Command. Das Frontend baut die Kriterien (`flatCriteria(root, opts)` in
`features/flat/flat-logic.ts`, rein):

| Feld | Wert | Grund |
|---|---|---|
| `roots` | `[root]` | |
| `name` | `""` (alle) | |
| `kinds` | `files`, `links` immer; `dirs` = „Ordner zeigen“ | Links werden als Eintrag gezeigt, **nie betreten** |
| `followLinks` | `false` | Symlink-Zyklus → keine Endlosschleife (schon durch Test `search.rs` abgedeckt, 038 ergänzt einen eigenen) |
| `includeHidden` | `tab.hiddenVisible` | ohne Hidden werden versteckte Ordner nicht betreten (sonst stünden Dateien aus `.git/` in der Liste, obwohl der Ordner unsichtbar ist); Umschalten von Hidden frischt auf (E5) |
| `maxDepth` | – (256) | |
| `excludes` | `[]` | die Ansicht zeigt alles; Filter (E4) schränkt ein |
| `maxHits` | `100 000` (= `search::MAX_HITS`) | Obergrenze, danach `truncated` → Hinweis im Header |
| `skipVirtualFs` | `true` | |

**Neues Feld** `SearchHit.rel_dir: String` – Elternordner relativ zur Wurzel, mit dem Separator des OS, `""` für
Einträge direkt in der Wurzel (`dir.strip_prefix(root)`; die Wurzel wird je Stapeleintrag mitgeführt). Kostet je
Treffer einen kurzen String; Such-Tabs bekommen es mit (später als Spalte nutzbar). Duplikat-Treffer: `""`.
Nicht-UTF-8 wie `dir` (lossy, Eintrag ist ohnehin `lossyName`).

### E3 – Liste: Spalte „Path“, Sortierung, Kopf und Tab ✅ empfohlen

- Spalte **`relDir`** („Path“, de „Pfad“), Gewicht wie `dir` im Such-Tab, nur in der Art `flat` sichtbar; `dir`
  („Folder“) ist in der flachen Ansicht aus. Leerer relativer Pfad = „.“ (gedämpft), damit Dateien der Wurzel nicht
  wie „ohne Ordner“ aussehen. Sortier-Vergleich: `relDir` (natürlich, ohne Groß/klein), dann Name.
- **Default-Sortierung** beim Einschalten: `relDir` aufsteigend (= Fundreihenfolge: Wurzel, dann Unterordner
  vorsortiert); Name/Größe/Datum per Doppelklick auf den Spaltenkopf wie immer. Beim Ausschalten kommt die
  Sortierung der normalen Ansicht zurück (`tableBefore`).
- **Kopf:** `[≡] Flat view: <Wurzel>` · `12 345 files` · Spinner + **Stop** während der Auflistung · Hinweise
  „Limit reached – list incomplete“ (`truncated`), „cancelled – incomplete“, „N folders unreadable“ · Checkbox
  **Show folders** · Button **Normal view** (`Mod+B`). Doppelklick: nichts (kein Dialog). Live-Region wie im Such-Tab
  (Start/Ende).
- **Tab-Titel:** Ordnername mit Icon `fa-list` (Font Awesome 4.5) statt der Lupe; `aria-busy` während der
  Auflistung. Tooltip: „Flat view: <Pfad>“.
- **Statuszeile** zählt die sichtbaren Einträge der Liste (wie im Such-Tab: `visibleEntries`) – E2E prüft das.

### E4 – Filter, Hidden, „Ordner zeigen“ ✅ empfohlen

- **Schnellfilter** (Filterfeld) wirkt wie immer auf den **Namen** (`rowFilter`), sofort, ohne neuen Lauf.
- **Hidden umschalten** in der flachen Ansicht: stilles Auffrischen mit neuem `includeHidden` (versteckte Ordner
  werden dann betreten bzw. nicht) – nicht nur ein Zeilenfilter.
- **„Ordner zeigen“** (`FlatRef.showDirs`, Default aus): stilles Auffrischen mit `kinds.dirs`. Alternative
  „immer Ordner holen und im Frontend filtern“ verworfen: Ordner zählten gegen die Obergrenze und Statuszeile/Marken
  bräuchten einen zweiten Filterweg. Aktion **`TOGGLE_FLAT_VIEW_DIRS`** (ohne Kürzel, Menü Ansicht, Header-Checkbox),
  nur in der flachen Ansicht an. Der Wert gilt für den Tab; ein neues Einschalten nimmt den zuletzt benutzten Wert der
  Sitzung (kein neuer Einstellungseintrag – Annahme).

### E5 – Auffrischen: nach Jobs + Wurzel-Watch + Strg+R, kein rekursiver Watch ✅ empfohlen

| Option | + | − |
|---|---|---|
| rekursiver Watch (`notify` `Recursive`) | sieht fremde Änderungen überall | Linux: ein inotify-Watch je Ordner (Grenze `max_user_watches`, bei 100 000 Dateien in Tausenden Ordnern realistisch erreicht), Aufbau dauert auf großen Bäumen; Netzlaufwerke pollen ohnehin; jedes Ereignis = komplette Neuauflistung |
| **Auffrischen nach eigenen Jobs + Watch der Wurzel + `RELOAD_DIR`** | billig; eigene Operationen (der Normalfall auf dieser Liste) sind immer sichtbar | Änderungen anderer Programme **in Unterordnern** erst nach Strg+R |

**Empfehlung:** zweite Option. Konkret:

- `JobsStore.changedDirs` mit einem Ordner an/unter der Wurzel (`isSameOrBelow`, schon da) → stilles Auffrischen.
  Löschen/Verschieben entfernen die Zeilen wie im Such-Tab sofort (`removePaths`), das Auffrischen gleicht danach ab.
- Watcher der Wurzel (nicht rekursiv): Ereignis → stilles Auffrischen (gedrosselt wie `requestRefresh`, 029 E2:
  frühestens 1 s nach dem Ende des letzten Laufs).
- `RELOAD_DIR` (Strg+R) = stilles Auffrischen; Umbenennen/Multi-Rename = stilles Auffrischen (statt `rerun`).
- **Stilles Auffrischen** (`SearchStore.refresh(key)`): neuer Job, die alten Zeilen bleiben stehen, die neuen werden
  erst am Ende (oder bei Abbruch gar nicht) übernommen → Cursor, Marken (`intersect`), Scrollposition bleiben, kein
  Flackern. Läuft schon ein Auffrischen, wird nur eins nachgeholt (wie 012 E4). Der Kopf zeigt währenddessen einen
  kleinen Spinner, keinen leeren Zustand.

### E6 – Navigation in der flachen Ansicht ✅ empfohlen

| Eingabe | Verhalten |
|---|---|
| Enter auf Datei | Standard-App (wie überall) |
| Enter auf Ordner (mit „Ordner zeigen“) / Archiv | flache Ansicht aus, **im selben Tab** in diesen Ordner (Verlauf: Wurzel) – TC-Verhalten; Archiv öffnet wie ein Ordner |
| `Mod+Enter` (in neuem Tab) | wie im Such-Tab: Ordner des Treffers in neuem Tab |
| `GOTO_FILE` (Strg/⌘+Shift+G) | wie im Such-Tab: Ordner des Treffers in **neuem** Tab, Cursor auf der Datei |
| Back (`Alt+←`) | flache Ansicht aus (= Strg+B) |
| `NAVIGATE_PARENT` (Backspace) | flache Ansicht aus und in den Elternordner der Wurzel, Cursor auf der Wurzel |
| Esc | während der Auflistung: anhalten (Teil bleibt, Hinweis „abgebrochen – unvollständig“); sonst wie immer |
| `..`-Zeile | keine (wie Ergebnis-Tab) |

### E7 – Operationen und Vetos ✅ empfohlen

Alles, was im Such-Tab geht, geht hier unverändert (gleicher Code): Markieren (auch `+`/`-`/Muster), F3/Schnellvorschau,
F4, Kopieren/Verschieben (F5/F6, Konflikte gleichnamiger Dateien aus verschiedenen Unterordnern fragt die Job-Engine –
Akzeptanz), Löschen (F8/Papierkorb), Umbenennen F2/Shift+F6 (im Ordner des Treffers), Multi-Rename (je Treffer im
eigenen Ordner, `[P]` aus `parentNames`), Packen, Prüfsummen, Eigenschaften/Attribute, Dateien vergleichen, Ziehen
aus der Liste, Pfade kopieren, Tools.

Aus (Veto über fehlendes `store.path()`, schon heute so): Ordner/Datei anlegen (F7, Shift+F4), Multi-MkDir,
Ordner aufräumen, Einfügen aus der Zwischenablage, Drop **in** die Liste, Speicherbelegung des „aktuellen Ordners“
(nutzt `actionDir` = Wurzel – bleibt an, weil sinnvoll). `TOGGLE_FLAT_VIEW` selbst ist aus in Archiven, auf Servern
(`OFF_ON_SERVER`), in Such-/Duplikat-/Belegungs-Tabs und bei ungeprüften Listings aus dem Cache
(`OFF_WHILE_UNCHECKED`: die Auflistung soll nicht auf einem hängenden Laufwerk starten, ohne dass der Ordner erreichbar
ist – Annahme; Netzlaufwerke an sich sind erlaubt).

Menü **Ansicht**: `TOGGLE_FLAT_VIEW` (Häkchen-Zustand über `checked`, falls das Menümodell es kann – sonst Text),
`TOGGLE_FLAT_VIEW_DIRS`. Kontextmenü: nichts Neues.

### E8 – Kürzel ✅ empfohlen

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `TOGGLE_FLAT_VIEW` (neu) | **Strg+B** (TC) | **⌘B** (`Mod+B`; im Finder unbelegt, kein Format-Menü in der App) |
| `TOGGLE_FLAT_VIEW_DIRS` (neu) | – | – |

## 3. Verträge

### Rust

```rust
// search.rs – SearchHit
pub struct SearchHit {
    #[serde(flatten)] pub entry: DirEntryDto,
    pub dir: String,
    /// Folder of the entry relative to its search root (OS separators), "" directly in the root (038).
    pub rel_dir: String,
    pub parent_names: [String; 3],
    pub group: Option<u32>,
}
// walk(): Stapel (PathBuf, depth, root_index); rel_dir = dir.strip_prefix(&roots[root_index])
```

Keine neuen Commands, Job-Arten, Fehlercodes oder Events.

### TypeScript

```ts
// core/search/search.models.ts
type SearchHit = DirEntry & { dir: string; relDir: string; parentNames: …; group?: number };
// features/search/search.store.ts
type ResultKind = 'search' | 'duplicates' | 'flat';           // browser: + 'usage'
startFlat(side: Side, opts: { showDirs: boolean }): Promise<FsError | null>;   // dreht den aktiven Tab um
leaveFlat(side: Side, then?: { navigate: string; cursor: string | null }): void;
refresh(key: string, patch?: Partial<FlatOptions>): void;      // still: alte Zeilen bis zum Ende
// features/workspace/workspace.store.ts
interface SearchTabRef { key; label; rootTitle?; flat?: FlatRef }
// features/flat/flat-logic.ts (rein)
flatCriteria(root: string, o: { includeHidden: boolean; showDirs: boolean }): SearchCriteria;
compareRelDir(a: SearchHit, b: SearchHit): number;
shouldRefresh(root: string, changed: readonly string[]): boolean;
// features/flat/flat-actions.ts – TOGGLE_FLAT_VIEW, TOGGLE_FLAT_VIEW_DIRS (+ Vetos)
```

## 4. UI-Skizze

```
┌ Tabs: [📁 Projekte] [≡ src ◌] [📁 Downloads] ───────────────────────────────┐
│ ≡ Flat view: /home/u/src · 12 345 files · ◌ [Stop]  [ ] Show folders [Normal view] │
│ Name            │ Ext │ Size  │ Modified        │ Path                      │
│ main            │ rs  │ 2 KB  │ 2026-10-22 08:01│ .                         │
│ Bücher 📚       │ txt │ 1 KB  │ …               │ docs/ä ö                  │
│ lib             │ rs  │ 9 KB  │ …               │ crates/core/src           │
│ …                                                                            │
│ 3 of 12 345 files marked (12 KB)                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Fokus bleibt in der Liste; Header-Elemente (Stop, Checkbox, Button) per Tab erreichbar wie im Such-Tab.
- Checkbox mit `<label>`, Button mit Text (kein reines Icon); Status als Text, nicht nur Farbe; Live-Region meldet
  „Flat view: 12 345 files“ bzw. „list incomplete (limit)“ am Ende.
- Texte in `features/flat/flat-texts.ts` + `.de.ts` (Katalog), Aktionen in `action-catalog(.de).ts`.

## 5. Tests

| Ebene | Fälle |
|---|---|
| Rust `search.rs` | `rel_dir`: Wurzel → `""`, 3 Ebenen → `a/b/c` (OS-Separator), Umlaute/Leerzeichen/Emoji; zwei Wurzeln; flache Kriterien über einen **Symlink-Zyklus** (`a/loop → ..`) enden, Link erscheint als Eintrag; Hidden aus → versteckter Ordner nicht betreten; 3 Ebenen vollständig; `maxHits` → `truncated` (vorhanden); Abbruch (vorhanden); Wire-Format `relDir` |
| Frontend rein | `flatCriteria` (Hidden, Ordner, Limit, keine Links folgen), `compareRelDir`, `shouldRefresh` (gleich/unter/daneben/Präfix-Falle `/a/b` vs `/a/bc`) |
| `SearchStore` (Fakes) | `startFlat` dreht den Tab um (gleiche Id, Pfad, Verlauf), `leaveFlat` stellt Cursor/Table her und gibt das Ergebnis frei (Job abgebrochen), `refresh` hält alte Zeilen bis zum Ende und verwirft bei Abbruch, zweites `refresh` während eines Laufs → genau eins nachgeholt |
| `FilePanel`/Workspace | Strg+B an/aus im selben Tab, Cursor danach wie vorher; Back/Backspace/Enter auf Ordner; Auffrischen nach `changedDirs` unter der Wurzel (nicht daneben); Hidden-Umschalten frischt auf; Sitzung speichert die Wurzel |
| Aktionen | `TOGGLE_FLAT_VIEW` aus im Archiv/Server/Such-Tab/ungeprüft; Ordner-Aktionen aus in flach; Esc stoppt den Lauf; Spalte `relDir` nur in flach (Bridge-Fake) |
| E2E (Xvfb) | Ordner mit 3 Ebenen (Umlaute, Leerzeichen, Emoji, versteckte Dateien, Symlink-Zyklus, gesperrter Ordner) → Strg+B, Spalte Pfad, Sortieren, Filter, Statuszeile; markiert aus mehreren Unterordnern F5 in Ziel → Konfliktdialog; Multi-Rename benennt in den Unterordnern; Löschen; Strg+B zurück, Cursor; 100 000+ Dateien → bedienbar, Hinweis „Limit“, Esc bricht ab; light und dark |

## 6. Annahmen

- Flache Ansicht wird nicht gespeichert (Neustart → normale Ansicht der Wurzel).
- Obergrenze fest 100 000 Einträge (wie die Suche); eine Einstellung dafür erst bei Bedarf.
- Änderungen anderer Programme in Unterordnern erst nach Strg+R (E5).
- „Ordner zeigen“ gilt je Tab, Startwert = zuletzt benutzt in der Sitzung.
- Keine Server-/Archiv-Ordner (Job `search` arbeitet nur lokal; Server-Suche ist „Folgeidee“ aus 034).

## 7. Abweichungen bei der Umsetzung

- **Kopf:** zeigt `Flat view: <Ordnername>` (Tab-Titel) statt des vollen Pfads – in schmalen Panels verschwand der
  Pfad sonst ganz (E2E); der volle Pfad steht im Tooltip. Hinweise kürzer („Obergrenze 100 000 – unvollständig“),
  sie dürfen sich mit Ellipse kürzen.
- **Sortierung:** `relDir` über den gemeinsamen `fileComparator` – Ordner (mit „Ordner zeigen“, auch Links auf Ordner)
  stehen wie überall oben, danach Wurzel zuerst, dann natürlich ohne Groß/klein.
- **Kein Häkchen im Menü:** das Menümodell kennt keinen `checked`-Zustand; die Einträge stehen als Text im Menü Ansicht.
- **`isSameOrBelow`** liegt jetzt in `shared/path-prefix.ts` (Re-Export aus `search.store.ts`), sonst Importzyklus
  `search.store` ↔ `flat-logic`.
- **Cursor nach Umbenennen** (Review B7): `SearchResult.focus` – F2 gibt den neuen Pfad aus Rust, Multi-Rename Ordner +
  neuen Namen (kein Zusammensetzen von Pfaden im Frontend); das Panel setzt den Cursor nach dem stillen Auffrischen.
- **Wieder zeigen:** ein Tab mit flacher Ansicht, der nach einem anderen Tab wieder gezeigt wird, frischt auf (Review
  B8) – im Hintergrund war er nicht überwacht.
- **Esc/Stop** wirken auch während des stillen Auffrischens (Review B4) und verwerfen ein nachgeholtes (B3).

## 8. Review

Separater Agent (hat den Code nicht geschrieben) auf `4506d6c..d49b001`, Schwerpunkte Auffrischen/Rennen,
Operationen auf Treffern in Unterordnern, Zyklen/Grenzen, CLAUDE.md §4. Alle Befunde behoben (Commit `c07f9ce`),
B1–B3 zuerst mit rotem Test in `features/flat/flat.spec.ts` („review B1 …“ bis „review B7 …“):

| # | Schwere | Befund | Behebung |
|---|---|---|---|
| B1 | hoch | Ergebnis, das während des Job-Starts eines Auffrischens freigegeben wird, kam wieder (Job lief durch) | `start()` prüft nach dem `await`, ob ein Tab den Key noch zeigt, sonst Job abbrechen; `release` stoppt auch Starts |
| B2 | hoch/mittel | `startFlat` ohne anzeigenden Tab (Mod+B doppelt, schnell navigiert) hinterließ ein verwaistes Ergebnis | `attach` gibt `boolean`, sonst `release`; Sperre gegen Doppelstart im Panel |
| B3 | mittel | Esc während der Auflistung startete danach ein nachgeholtes Auffrischen | `stop()` leert `queued` und den Watcher-Timer |
| B4 | niedrig/mittel | Stilles Auffrischen nicht anhaltbar | `resultBusy` und Stop-Knopf auch bei `refreshing` |
| B5/B6 | niedrig | Hidden-Effekt konnte bei abgelehntem Start kreisen; schnelles Doppelumschalten zeigte kurz Verstecktes | Effekt nur auf Hidden, Vergleich mit den neuesten (auch nachgeholten) Optionen; `queued` bei Fehler leeren |
| B7 | niedrig/mittel | Cursor sprang nach F2/Multi-Rename nach oben | `focus` (s. §7) |
| B8 | niedrig | Flache Ansicht im Hintergrund-Tab veraltet | Auffrischen beim Wieder-Zeigen |
| B9 | niedrig | „Ordner zeigen“ in geklonten Tabs falsch angezeigt | Checkbox liest `r.criteria.kinds.dirs` |
| B10 | niedrig | Zahlenformat der englischen Ansage | `formatCount` |

Als in Ordnung bestätigt: Operationen nutzen `SearchHit.dir`, `removePaths` auch im laufenden Auffrischen, Umschalten
im selben Tab und Verlauf, `rel_dir` mit mehreren Wurzeln, keine Verstöße gegen CLAUDE.md §4.

## 9. Fortschritt

- [x] Phase 1: Bestand, Entscheidungen, Verträge (2026-10-22) – freigegeben von Marc (22.10.2026)
- [x] Phase 2: Rust (`rel_dir`, 5 neue Tests) – `916a3d9`
- [x] Phase 3: Frontend (`features/flat/`, SearchStore, FilePanel, Spalte, Aktionen; Specs `flat.spec.ts`,
  `file-panel.spec.ts` „flat view“) – `d49b001`
- [x] Phase 4: E2E unter Xvfb (Debug-Build, Linux): 3 Ebenen mit Umlauten/Emoji/Leerzeichen, Symlink-Zyklus und
  Link-Datei, versteckte Dateien, gesperrter Ordner (als root lesbar – nicht prüfbar); Strg+B an/aus mit Cursor,
  F5 mit zwei `gleich.txt` aus verschiedenen Unterordnern → Warnung im Dialog + Konfliktfrage, Multi-Rename in
  `eins/` und `eins/zwei/`, Ordner zeigen, Hidden, Enter auf Ordner + Verlauf, 110 000 Dateien (bedienbar während
  der Auflistung, Esc hält an, Strg+R bis zur Obergrenze 100 000 mit Hinweis, Cursor bleibt), light/Crimson/dark.
  Kopf-Layout danach korrigiert – `e21ee44`
- [x] Phase 5: Doku (README, features.md, feature-parity, architecture, roadmap, CLAUDE.md, Index) – Prompt nach `done/`
- [x] Phase 6: `pnpm check` grün, Debug-Build, Review (§8) behoben
