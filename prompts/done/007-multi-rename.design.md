# Design 007: Multi-Rename

> **Status:** ✅ freigegeben (Marc: „Nimm deine Annahmen … du hast das Go für alles“, 2026-10-17) – alle Empfehlungen übernommen · **Datum:** 2026-10-17 · **Branch:** `feat/multi-rename` (von `main`
> nach dem Merge von 006)
> **Grundlage:** legacy §3.1 und §9, mr §5 (Dialog, `[Q]`/`[R]`, „Ignore Extension“, Makros), Quellcode der alten
> Version (`node-files-and-folders-client/src/fnf/commands/multirename/`) und von mr
> (`feature/cmd/multirename/multi-rename.service.ts`), Design 005/006 (Job-Engine, `rename_noreplace`,
> `validate_name`, `danger_of`).
> **Phasen:** alle sechs (Rust und Frontend sind beide betroffen).

---

## 1. Bestand

| Baustein | heute (006) | Bewertung |
|---|---|---|
| Aktion `OPEN_MULTIRENAME_DLG` | im Katalog, „kommt in 007“; Kürzel `Mod+F6` (+ `Mod+Alt+M` unter Windows/Linux); Button-Leiste mit ⌘/Strg/Alt | **passt**, nur Handler registrieren |
| `selectionForAction` | „Markierung, sonst Cursor“, ohne `..` | **passt**, aber Reihenfolge: `markedEntries` folgt dem Listing aus Rust, nicht der Sortierung der Table → **erweitern** um die Anzeigereihenfolge (Zähler `[C]` muss der sichtbaren Reihenfolge folgen) |
| `DirectoryListing.segments` | Breadcrumbs von Rust (Wurzel zuerst) | **passt** für `[P]`/`[Q]`/`[R]` ohne Pfad-Splitting im Frontend |
| `DirEntry.modifiedMs`, `kind` | vorhanden | **passt** für `[D]`/`[T]` und „Ordner haben keine Endung“ |
| `fileops::rename_entry` | ein Eintrag, nie überschreiben, nur Groß/klein über Zwischennamen | **Kern wiederverwenden** (ohne Danger-Check pro Aufruf) – Funktion `rename_in_dir` herauslösen |
| `platform::rename_noreplace` | atomar (`renameat2`/`renamex_np`), sonst Hard-Link | **passt** |
| `paths::validate_name` | Windows-Regeln unter Windows, Länge | **passt** |
| `paths::danger_of` | Wurzel/Home/System | **passt** (Multi-Rename solcher Pfade wird abgelehnt, ohne Zweitbestätigung) |
| Job-Engine (005/006) | `JobSpec`, serielle Warteschlange, Abbruch, Fehler je Eintrag, `DirsChanged` | **erweitern** um `JobSpec::Rename` |
| `DialogService`/`Modal` | Fokusfalle, `inert` | **passt**; `DialogKind` + `'multi-rename'` |
| GuiExpert Table | Muster `FileBodyModel` (Zeilenklassen, externer Filter) | **passt** für die Vorschau (eigenes kleines Modell) |
| Speicherort für Vorlagen | – (Sitzungsdatei ist ein festes Schema v1) | **fehlt** → eigene Datei (E6) |

## 2. Entscheidungen (Empfehlungen)

### E1 – Engine nur im Frontend (TypeScript), Rust prüft und führt aus ✅ empfohlen

| Option | + | − |
|---|---|---|
| **A: Namen in TS, Prüfung + Ausführung in Rust** | Vorschau ohne IPC (10 000 Namen in wenigen ms); die Makros und Nutzerausdrücke sind **JavaScript-Regex** (`/re/flags`, `$1`, Lookahead) – genau diese Syntax kennen die Nutzer aus der alten Version | Regex-Endlosschleifen (ReDoS) blockieren das Fenster (E10) |
| B: Engine in Rust + Vorschau-Command | eine Sprache für alles | Crate `regex` kann kein Lookaround/Backreference, Ersetzungssyntax anders (`${1}`) → alte Makros brechen; bräuchte `fancy-regex` (neue Abhängigkeit); IPC je Tastendruck |
| C: beide + gemeinsamer JSON-Testkatalog | – | doppelte Logik, die auseinanderläuft |

**Empfehlung A.** Es gibt keine doppelte Logik: TS **berechnet** neue Namen, Rust **rechnet nie Namen aus**, sondern
bekommt Paare `{ path, newName }` und entscheidet allein, ob sie gültig und ausführbar sind (Name, Dubletten,
vorhandene Dateien, Zyklen, gefährliche Pfade). Der Testkatalog (`rename-engine.cases.json`) gilt der TS-Engine;
Rust hat eigene Tests für Prüfung und Ausführung.

### E2 – Name und Endung zerlegen (behebt `README` → `.README`) ✅

| Eintrag | Name `[N]` | Endung `[E]` |
|---|---|---|
| Ordner (auch Link auf Ordner) | ganzer Name | leer |
| `README` | `README` | leer |
| `.gitignore` (Punkt nur vorne) | `.gitignore` | leer |
| `.config.json` | `.config` | `json` |
| `archiv.tar.gz` | `archiv` | `tar.gz` (Option „Doppelendungen“, Standard an: `tar.gz`, `tar.bz2`, `tar.xz`, `tar.zst`) |
| `datei.` | `datei.` | leer |

**Punkt vor leerer Endung:** Ein Punkt im Muster direkt vor einem `[E…]`-Token entfällt, wenn das Token leer
ergibt – `[N].[E]` lässt `README` und Ordner unverändert.

### E3 – Muster-Sprache: Tokenizer statt Kette von `replace` ✅

Die alten Versionen ersetzten nacheinander mit `String.replace` – dadurch wurde `$&` in Dateinamen interpretiert,
ein Name mit `[E]` darin noch einmal ersetzt und jede Bereichsform nur beim ersten Vorkommen. Neu: das Muster wird
**einmal** in Tokens zerlegt, Fehler (z. B. `[N5-2]`) werden gemeldet.

| Token | Bedeutung |
|---|---|
| `[N]` `[E]` | Name / Endung (nach Schreibweise und Optionen, E4) |
| `[P]` `[Q]` `[R]` | Name des Eltern-, Großeltern-, Urgroßelternordners (aus `segments`; Wurzel = leer) |
| `[N2-5]` `[N2-]` `[N-5]` | Bereich, 0-basiert, Ende exklusiv – gleiches für `E P Q R`; gezählt in **Zeichen** (Codepoints), nicht UTF-16-Einheiten (Emoji bleiben ganz) |
| `[C]` | Zähler `start + i × schritt`, mit Nullen auf *Stellen* aufgefüllt; `i` = Position in der **Anzeigereihenfolge** |
| `[D]` `[T]` | Änderungsdatum/-zeit der Datei, lokal: `2026-10-17` / `20-52-07` (kein `:` – unter Windows/macOS ungültig bzw. im Finder `/`); ohne Datum leer |
| `[[` `]]` | wörtliche `[` `]` |

Unbekannte Tokens (`[X]`) bleiben wörtlich stehen und werden als Hinweis unter dem Feld gezeigt. Neben dem Feld
eine Token-Leiste (`[N] [E] [C] [P] [D] …`) zum Einfügen an der Schreibmarke; Doppelklick auf das Feld setzt
`[N].[E]` (legacy).

### E4 – Reihenfolge der Schritte (wie legacy, mit „Endung schützen“ aus mr) ✅

1. Name auf **NFC** normalisieren (E8).
2. **Schreibweise** (unverändert · GROSS · klein · Erster Buchstabe · Wörter · Chicago Manual of Style).
3. **Optionen** in fester Reihenfolge: Umlaute ersetzen → riskante Zeichen entfernen → Leerzeichen → `_` →
   Elternordner-Namen entfernen (erstes Vorkommen).
4. **Muster** einsetzen (E3), Zähler.
5. **Suchen und Ersetzen** (4 Zeilen, nur wenn der Hauptschalter an ist): je Zeile an/aus, Suchen, Ersetzen,
   Regex, „nur wenn passt“ (Regex oder Teilstring). Mehrfache Leerräume werden vorher zu einem Leerzeichen.

**„Endung schützen“** (mr `ignoreExtension`, Standard **an**): Schritte 2, 3 und 5 wirken nur auf den Namensteil;
in Schritt 5 wird das *Ergebnis des Musters* nach E2 zerlegt, ersetzt und die Endung wieder angehängt. Aus: alles
wirkt auf den ganzen Namen. Damit funktionieren die mr-Makros („Trenner ._- → Leerzeichen“, „Filme mit Jahr“), die
ohne Schutz die Endung zerstören. Die drei legacy-Makros „Wörter umstellen“ erwarten die Endung im Text
(`\.([^.]+)`) – sie werden auf den Namensteil umgeschrieben (gleiches Ergebnis, Test je Beispiel aus dem alten
Hilfetext).

Details, die sich gegenüber alt ändern (Abweichungen → `docs/feature-parity.md`):

| Punkt | alt | neu | Grund |
|---|---|---|---|
| Ersetzen ohne Regex | nur erstes Vorkommen | **alle** Vorkommen | erwartet; mit Regex steuert `g` das Verhalten |
| Regex-Haken an, Text ohne `/…/` | still als Text ersetzt | Text = Ausdruck, Flags `g` | kein stilles Umschalten |
| Nach Regex `,,` → `,` | immer | entfällt | verfälscht fremde Namen; die Makros brauchen es nicht |
| Ungültiger Ausdruck | Absturz (legacy) / Name `ERROR` (mr) | Fehler am Feld, alle Zeilen „Fehler“, Umbenennen gesperrt | Prompt |
| Riskante Zeichen | `[^a-zA-Z0-9_ \[\]()\-.]` | gleich; leeres Ergebnis → Fehler „leerer Name“ | – |
| Zähler-Schritt „50“ | Wert 30 | 50 (Test) | Bug |
| Chicago-Style | nur ASCII-Wörter (`[A-Za-z]`) | Unicode-Buchstaben (`\p{L}`), sonst wie Resigs `titleCaps` (MIT) | „über“ wurde nie groß |
| Sortierung der Vorschau | nach Status, dann Nr. | Nr. (= Zählerreihenfolge) + Filter „nur geänderte“ / „nur Fehler“ | Zähler bleibt nachvollziehbar |
| Freigabe | > 1 Eintrag | ≥ 1 Eintrag | Regex auf eine Datei ist nützlich |

### E5 – Prüfung in Rust: `plan_rename` ✅

Eingabe: alle Paare (auch unveränderte, damit Rust Dubletten gegen stehen bleibende Namen erkennt). Rust prüft je
Eintrag, **ohne** etwas zu schreiben:

1. Quelle existiert (`symlink_metadata`), Pfad gültig, nicht `danger_of` → sonst `not_found` / `dangerous_path`.
2. `validate_name(newName)` → `invalid_name` (Trenner, leer, `.`/`..`, Länge, Windows-Zeichen/-Namen).
3. **Dubletten** im selben Ordner: Schlüssel = Name, auf case-insensitiven Dateisystemen kleingeschrieben
   → `duplicate_target` (neu) für alle Beteiligten. Case-Sensitivität wird je Ordner **gemessen** (Name eines
   vorhandenen Eintrags mit vertauschter Groß-/Kleinschreibung → gleicher Inode/Datei-Index?); geht das nicht
   (kein Eintrag mit Buchstaben): Plattform-Default (macOS/Windows: insensitiv, Linux: sensitiv).
4. **Ziel vorhanden:** `symlink_metadata(dir/newName)` – das Dateisystem selbst entscheidet über Groß/klein und
   Unicode-Normalisierung (APFS). Ist der gefundene Eintrag (Gerät + Inode bzw. Datei-Index) eine Quelle dieses
   Plans, ist es eine **Kette/ein Tausch** (erlaubt), sonst `already_exists`.
5. Kein Konflikt und Name gleich → `unchanged`.

Rückgabe je Zeile `ok | unchanged | error(FsError)`. Die Vorschau zeigt die neuen Namen sofort (TS) und die
Rust-Prüfung, sobald sie da ist (entprellt 120 ms, veraltete Antworten werden per Sequenz verworfen). Gleiches
Prüfprogramm läuft beim Start des Jobs noch einmal (Zustand kann sich geändert haben).

### E6 – Ausführung als Job `rename`, Ketten und Zyklen ✅

- `JobSpec::Rename { items: [{ path, newName }] }`, serielle Warteschlange, Fortschritt in Einträgen.
- **Reihenfolge:** Graph „Ziel von *i* ist Quelle von *j*“. Erst alle Einträge, deren Ziel frei ist; dadurch
  werden Ziele anderer frei (Kette `a→b`, `b→c`: zuerst `b→c`). Übrig bleiben nur Zyklen (`a↔b`): ein Element
  über einen eindeutigen Zwischennamen (`.fnf-rename-…`, wie 006), dann der Rest, dann das Element ans Ziel.
- Jede Umbenennung mit `rename_noreplace` (nie überschreiben); nur Groß/klein über `rename_in_dir` (006).
- **Abbruch** zwischen zwei Einträgen. Ein Zyklus wird nie halb verlassen: liegt ein Eintrag gerade auf einem
  Zwischennamen, wird er erst auf sein Ziel bzw. – wenn das nicht geht – zurück auf den alten Namen gebracht.
- Fehler je Eintrag (`ItemFailed`), Rest läuft weiter; Ziel ist inzwischen belegt → `already_exists`, nie
  überschreiben. `DirsChanged` mit den betroffenen Ordnern, danach Neuladen.
- Dauer: 10 000 Umbenennungen sind ~1–3 s – deshalb Job mit Fortschritt statt Command.

### E7 – Rückgängig ✅

- Rust merkt sich je fertigem `rename`-Job die **tatsächlich ausgeführten** Paare (neuer Pfad → alter Name), im
  Speicher, die letzten 20 Jobs. `undo_rename(jobId)` startet einen neuen `rename`-Job mit den umgekehrten Paaren –
  dieselbe Prüfung, Ketten- und Zyklenlogik (ein Tausch wird so auch rückwärts korrekt). Wurde eine Datei inzwischen
  geändert/verschoben: Fehler je Eintrag, der Rest wird zurückbenannt. Ein Undo ist selbst wieder rückgängig zu
  machen.
- Bedienung: Knopf **„Rückgängig“** am fertigen Job in der Task-Liste und Aktion `UNDO_RENAME` (Befehlspalette;
  nimmt den letzten Rename-Job) – **ohne** Standard-Kürzel (Strg/⌘+Z gehört in Textfeldern dem Feld; im Panel
  wäre es überraschend, solange nur Umbenennen rückgängig geht). Nach dem Umbenennen meldet die Live-Region
  „12 Einträge umbenannt – Rückgängig in der Befehlspalette/Task-Liste“.
- **Nicht persistent** (Entscheidungsfrage 3): nach einem Neustart ist der Stand ohnehin fraglich, und eine
  Protokolldatei mit vollständigen Pfaden widerspräche „keine Nutzerpfade unnötig speichern“ (CLAUDE.md §4). Falls
  gewünscht später als Export in 015.
- Einzel-Umbenennen (F2/Shift+F6) bleibt ohne Undo (Command, kein Job) – möglicher Nachtrag.

### E8 – Unicode-Normalisierung ✅

- Alle berechneten Namen sind **NFC** (`String.normalize('NFC')`, auch die Eingaben aus Ersetzen-Feldern).
- „Unverändert“ heißt `NFC(alt) == neu` – eine reine NFD→NFC-Änderung (alte HFS+-Namen) ist **keine** Umbenennung.
  Regex und Bereiche arbeiten auf der NFC-Form (sonst trifft `/ü/` ein NFD-`ü` nicht).
- Konflikte gegen die Platte entscheidet das Dateisystem (E5 Punkt 4) – APFS ist normalisierungs-insensitiv,
  ext4 nicht; dadurch braucht Rust keine Normalisierungs-Crate.

### E9 – Vorlagen speichern ✅

- Eigene Datei `<app_config_dir>/rename-presets.json` (`version: 1`, `last` + benannte Vorlagen, max. 100),
  Commands `load_rename_presets` / `save_rename_presets` – Rust prüft Form und Größe (wie `keymap.json`, atomar
  schreiben, kaputt → `.bad`). Die Sitzungsdatei bleibt schlank; 015 kann die Datei in den Einstellungsdienst
  übernehmen.
- Gespeichert werden die Einstellungen, nie Dateinamen. „Zuletzt“ wird beim Umbenennen gemerkt; der Dialog öffnet
  damit (Zähler-Werte inklusive). Vorgaben im Kopf des Dialogs: Auswahlliste Vorlagen · Speichern unter… · Löschen ·
  Zurücksetzen.

### E10 – Leistung und Regex-Endlosschleifen ⚠ Entscheidung

Ziel: 10 000 Dateien, Vorschau < 300 ms nach Eingabe (gemessen: Eingabe → Table neu gezeichnet, Konsole
`[fnf:perf]`). Die Engine ist linear; nach Erfahrung aus 001 (`setRows` + Repaint für 100 000 Zeilen < 0,4 s) liegt
das deutlich darunter. Risiko: ein Ausdruck wie `/(a+)+$/` kann die WebView einfrieren.

| Option | Aufwand |
|---|---|
| **a) Hauptthread, entprellt 80 ms** (empfohlen) | gering; Risiko dokumentiert, nur durch die eigene Eingabe auslösbar |
| b) Web Worker mit Zeitlimit (1 s → „Ausdruck zu langsam“) | mittel: Worker-Build, CSP `worker-src 'self'`, Tests mit Fake-Worker |

Empfehlung **a)**; zeigt die Messung ein Problem oder willst du die Absicherung gleich, baue ich b).

### E11 – KI-Modus (mr) ✖ nicht in 007

Dateinamen an einen Online-Dienst zu senden braucht eine Einwilligung, Schlüsselverwaltung im OS-Schlüsselbund
(neue Crate `keyring`), Netzwerk-Capability und eine eigene CSP-Ausnahme. Empfehlung: eigener späterer Prompt
(nach 015), Vorschau bleibt Pflicht. `strategy` (Manual/AI) entfällt bis dahin. In `docs/feature-parity.md` als
„offen“ markiert.

## 3. Verträge

### Rust

```rust
// jobs/mod.rs
enum JobSpec { …, Rename { items: Vec<RenameItem> } }      // kind "rename", seriell
struct RenameItem { path: String, new_name: String }        // camelCase: { path, newName }

// rename.rs (neu, rein std, ohne Tauri)
pub fn plan(items: &[RenameItem], home: Option<&Path>) -> RenamePlan;
pub fn run(id, items, &Control, &emit) -> (JobState, Summary, Vec<RenameItem> /* Undo-Paare */);

struct RenamePlan { rows: Vec<PlanRow>, ok: u32, unchanged: u32, errors: u32 }
struct PlanRow { status: PlanStatus /* ok | unchanged | error */, error: Option<FsError> }  // Index = Eingabe
```

| Command | Rückgabe / Fehler |
|---|---|
| `plan_rename(items)` | `RenamePlan` (prüft, schreibt nie; `spawn_blocking`) |
| `start_job({ kind: 'rename', items })` | Job-Id · `invalid_path` (leer), Plan mit Fehlern → `invalid_name`/`duplicate_target`/… (Job wird nicht angenommen) |
| `undo_rename(jobId)` | Id des neuen Jobs · `undo_unavailable`* (kein Protokoll, schon rückgängig gemacht) |
| `load_rename_presets()` / `save_rename_presets(presets)` | `RenamePresets` · `invalid_path`, `io` |
| `JobInfo` | + `undoAvailable: bool` (Knopf in der Task-Liste) |

`*` neue Fehlercodes: `duplicate_target`, `undo_unavailable` – in `error.rs`, `fs.models.ts`, `describeFsError()`.

### TypeScript

```ts
// features/multirename/rename-engine.ts – rein, ohne Angular
interface RenameRules {
  pattern: string;                       // '[N].[E]'
  counter: { start: number; step: number; digits: number };
  capitalize: 'none' | 'upper' | 'lower' | 'firstLetter' | 'words' | 'chicago';
  protectExtension: boolean;             // mr ignoreExtension, Standard true
  compoundExtensions: boolean;           // tar.gz …, Standard true
  umlauts: boolean; riskyChars: boolean; spaceToUnderscore: boolean; removeParent: boolean;
  replaceEnabled: boolean;
  replacements: { enabled: boolean; find: string; replace: string; regex: boolean; onlyIf: string | null }[]; // 4
}
interface RenameSource { name: string; isDir: boolean; modifiedMs: number | null; parents: [p, q, r] }
function compileRules(r: RenameRules): CompiledRules | RuleError;   // Muster + Regex einmal je Eingabe
function newName(c: CompiledRules, s: RenameSource, index: number): string;
```

`RenamePresets { version: 1, last: RenameRules | null, presets: { name, rules }[] }`; `RenameRules` in Rust als
`serde_json::Value` mit Größen-/Tiefenlimit gespeichert (Rust muss die Regeln nicht verstehen).

### Aktionen und Kürzel

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `OPEN_MULTIRENAME_DLG` (vorhanden) | Strg+F6, Strg+Alt+M, **neu Strg+M** (TC) | ⌘F6 (⌘M = Fenster minimieren, bleibt frei) |
| `UNDO_RENAME` *(neu)* | – (Palette, Task-Liste) | – |
| im Dialog | Strg+Enter = Umbenennen, Esc = Abbrechen, Alt+Buchstabe für Felder | ⌘Enter |

Strg+M ist in den Keymaps noch frei (geprüft).

## 4. UI-Skizze

```
┌ Multi-Rename – 1 234 Einträge ───────────────────── Vorlage [Zuletzt ▾] [Speichern…] [⟲] ┐
│ Neuer Name [ [N].[E]                                ] [N][E][C][P][Q][R][D][T]            │
│ Schreibweise [unverändert ▾]  Zähler ab [1 ▾] Schritt [1 ▾] Stellen [0004 ▾]              │
│ [x] Endung schützen [x] Doppelendungen  [ ] Umlaute [ ] Riskante Zeichen [ ] ␣→_ [ ] Elternordner │
│ [x] Suchen und Ersetzen                                                                   │
│  [x] [ /([^.\s-]+)\s(…)/g  ][▾ Makros] durch [ $2, $1 - $3 ] [x] Regex [x] nur wenn [ … ] │
│  [ ] [                     ][▾]       durch [            ] [ ] Regex [ ] nur wenn [   ]   │
│  … (4 Zeilen)                                                                              │
│ ┌ Nr. ┬ Alt ───────────────┬ Info ─────────┬ Neu ─────────────────────┐  Zeigen:         │
│ │ 1   │ Sebastian Fitzek - …│ OK            │ Fitzek, Sebastian - …    │  (•) alle         │
│ │ 2   │ README              │ unverändert   │ README                   │  ( ) geänderte    │
│ │ 3   │ a.txt               │ ⚠ existiert   │ b.txt                    │  ( ) Fehler       │
│ └─────┴─────────────────────┴───────────────┴──────────────────────────┘                  │
│ 1 100 umbenennen · 130 unverändert · 4 Fehler                   [Abbrechen] [Umbenennen ⏎]│
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Fokus: „Neuer Name“ (markiert) → Token-Leiste → Schreibweise → Zähler → Optionen → Ersetzen-Zeilen (je Zeile:
  Haken, Suchen, Makros, Ersetzen, Regex, nur wenn) → Vorschau-Table → Filter → Buttons → Vorlagen.
- `role="dialog"`, `aria-modal`, Fokusfalle (Modal), Größe ~ 92vw × 86vh. Die Table ist ein eigenes, kleines
  GuiExpert-Modell (Spalten fest, nur lesen), Fehlerzeilen per Zeilenklasse (`fnf-mr-error`, Token `--fnf-danger-*`
  light/dark), Filter über `externalFilterFunction`, Info-Spalte mit Text (nicht nur Farbe).
- Fehlermeldung des Musters/Regex unter dem jeweiligen Feld (`aria-describedby`, `aria-invalid`), Zusammenfassung
  in einer Live-Region (entprellt). „Umbenennen“ ist gesperrt bei Fehlern, bei 0 Änderungen und solange die
  Rust-Prüfung zur aktuellen Eingabe fehlt.
- Makro-Menü nach APG-Menü-Muster (Kategorien als Gruppen: „Zeichen ersetzen“, „Wörter extrahieren“, „Wörter
  umstellen“); Auswahl füllt die Zeile und schaltet sie und „Suchen und Ersetzen“ ein.
- Texte zentral (`multirename-texts.ts`), englisch wie die übrigen Dialoge (i18n in 015).

## 5. Tests

| Ebene | Fälle |
|---|---|
| TS-Engine (tabellengetrieben, `rename-engine.cases.json`) | jede Schreibweise inkl. Chicago-Grenzfälle (Kleinwörter am Anfang/Ende, nach `:`, `v.`/`vs.`, `AT&T`, Umlaute); jede Option einzeln und in Reihenfolge; Muster `[N] [E] [P] [Q] [R] [C] [D] [T]`, Bereiche aller Formen, mehrfaches Vorkommen, `[[`/`]]`, unbekannt, `$&` im Namen bleibt wörtlich; Zerlegung E2 (Ordner, `README`, `.gitignore`, `.config.json`, `tar.gz` an/aus, `datei.`); Zähler (Schritt 50 = 50, Stellen, Start 0); Ersetzen (Text alle Vorkommen, Regex mit/ohne `g`, `i`, ohne Slashes, ungültig → Fehler, „nur wenn“ als Regex und Teilstring, Leerraum-Normalisierung); Endung schützen an/aus; alle Makros mit den Beispielen aus den alten Hilfetexten; NFD-Eingabe → NFC, „unverändert“ bei reiner Normalisierung; Emoji in Bereichen |
| Rust | `plan`: ok/unverändert, ungültig je OS, leer, Dublette (sensitiv/insensitiv gemessen), Ziel existiert, Kette, Tausch, Groß/klein-only, Quelle fehlt, gefährlicher Pfad; `run` mit `tempfile`: einfache Umbenennung, Kette `a→b→c`, Tausch `a↔b`, Dreierzyklus, Groß/klein-only, Ziel taucht nach der Planung auf (kein Überschreiben), Abbruch mittendrin (kein Zwischenname bleibt liegen), Unicode/Leerzeichen/Emoji, Symlink (Link wird umbenannt, nicht das Ziel), 10 000 Dateien; Undo (stellt Ausgangszustand her, auch nach Tausch; geänderte Datei → Fehler je Eintrag; Undo des Undo); Vorlagen-Datei (laden, kaputt → `.bad`, Limits); Wire-Format |
| Frontend | Store: Auswahl in **Anzeigereihenfolge**, Eltern aus `segments`, Sequenz verwirft alte Plan-Antworten, Sperre von „Umbenennen“, Start → Markierung weg, Cursor folgt dem umbenannten Eintrag, Undo-Aktion; Dialog: Fehler am Feld, Filter, Makro füllt Zeile, Token einfügen an Schreibmarke, Strg+Enter, Vorlagen speichern/laden/zuletzt |
| Leistung | 10 000 Einträge: Engine allein (Vitest, Grenze großzügig) und im echten Fenster Eingabe → Vorschau (Ziel < 300 ms) und `plan_rename` (Ziel < 300 ms im Container) – Messwerte in den Bericht |
| Ende-zu-Ende (Xvfb) | Testordner mit Umlauten (NFC und NFD), Leerzeichen, Emoji, `README`, `.gitignore`, `x.tar.gz`, Ordner, Symlink, schreibgeschütztem Ordner; Muster + Zähler, Makro „Wörter umstellen“, Konflikt mit vorhandener Datei (gesperrt), Tausch `a↔b` per Regex, Undo, Vorlage speichern und nach Neustart „zuletzt“ |

**Nicht im Container prüfbar:** APFS (Groß/klein-insensitiv, NFD/NFC-Gleichheit), NTFS/Windows (reservierte Namen,
Datei-Index statt Inode) – die Messung der Case-Sensitivität wird unter Linux auf ext4 (sensitiv) und, falls
verfügbar, einem `vfat`-Loop-Mount (insensitiv) getestet; sonst nur mit Plattform-Default.

## 6. Entscheidungsfragen – Zusammenfassung

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Engine TS, Rust oder beide? | **TS** berechnet, **Rust** prüft und führt aus (E1) |
| 2 | Unicode-Normalisierung? | Ergebnis immer **NFC**; reine Normalisierung ist keine Änderung; Konflikte entscheidet das Dateisystem (E8) |
| 3 | Undo persistent? | **Nein**, im Speicher, letzte 20 Jobs (E7) |
| 4 | ReDoS-Schutz per Worker? | **Nein** vorerst, messen (E10) |
| 5 | KI-Modus? | **Nicht in 007**, eigener Prompt später (E11) |
| 6 | Abweichungen in E4 (Ersetzen aller Vorkommen, kein `,,`-Kollaps, ≥ 1 Eintrag, Sortierung nach Nr.) | wie in der Tabelle |
| 7 | Strg+M zusätzlich unter Windows/Linux? | **Ja** (TC-Gewohnheit) |

## 7. Abweichungen bei der Umsetzung (mit Begründung)

| Punkt | Design | umgesetzt | Grund |
|---|---|---|---|
| Ort von `plan`/`run` | `rename.rs` | `src-tauri/src/jobs/rename.rs` (rein std) | braucht `Control`/`JobEvent`/`Reporter` der Job-Engine |
| Prüfung bei `start_job` | Plan mit Fehlern → Job nicht angenommen | `start_job` prüft nur Form (nicht leer, ≤ 100 000, Pfade gültig); der Job prüft im eigenen Thread und **scheitert ohne eine einzige Umbenennung**, sobald ein Paar fehlerhaft ist (Summary-Fehler „Nothing was renamed: …“) | `start_job` ist ein synchroner Command – 10 000 `stat` gehören nicht auf den Haupt-Thread; Ergebnis für den Nutzer gleich (nichts passiert, Meldung) |
| Undo-Job | – | `JobSpec::Rename { items, undoOf }`: mit `undoOf` laufen die gültigen Paare, der Rest scheitert je Eintrag | E7 „Fehler je Eintrag, der Rest wird zurückbenannt“ |
| `undo_rename(jobId)` | Id Pflicht | `jobId: Option` – `null` = letzter Rename-Job | Aktion `UNDO_RENAME` braucht keine Id; auch wenn die Task-Liste schon geleert ist |
| Neues Ereignis | – | `JobEvent::UndoAvailable { id, available }` (vor `finished` gesendet) | Knopf erscheint/verschwindet (Undo, Verdrängung aus den letzten 20) |
| Ersetzungszeile | `onlyIf: string \| null` | `onlyIf: boolean` + `condition: string` | Haken und Feld getrennt (UI wie alt), Text bleibt beim Abschalten erhalten |
| Makro-Menü | APG-Menü | natives `<select>` mit `<optgroup>` je Kategorie; die Wahl bleibt sichtbar | barrierefrei ohne eigenes Widget; Pfeiltasten probieren Makro für Makro durch (E2E: ein Rücksetzen auf „Makros…“ wendete sonst immer das erste an) |
| Makros | 3 legacy | 5 (legacy 3 + mr „Trenner ._- → Leerzeichen“, „Filme mit Jahr“), alle auf den Namensteil umgeschrieben; Makro 3 ohne `,,`-Kollaps (`([^.\s,]+),\s*`) | Beispiele der alten Hilfetexte als Tests |
| Doppelklick setzt `[N].[E]` | legacy | entfällt, Knopf „Reset“ | Doppelklick markiert in Textfeldern ein Wort |
| Umlaute | legacy `Ä → AE` | `Ä → Ae`, `ß → ss`, Akzente ohne Zeichen (Tabelle erweitert, `ž` global) | korrektes Deutsch; alte Tabelle hatte tote Zeilen |
| Entprellung | Engine 80 ms (E10 a) | Engine **ab 1 000 Einträgen** 80 ms (kleiner sofort); Rust-Prüfung 120 ms | E2E: ohne Entprellung stauten sich bei 10 000 Einträgen die Tastendrücke |
| Modal | – | `Modal` hat ein `height`-Input (großer Dialog 92vw × 86vh) | |

## 8. Annahmen

- Abbruch eines Rename-Jobs wird zwischen zwei Einträgen geprüft; ein begonnener Zyklus wird immer zu Ende geführt
  oder vollständig zurückgenommen (kein Zwischenname bleibt liegen; nur wenn auch die Rücknahme scheitert, nennt die
  Fehlermeldung den Zwischennamen).
- Ein Ziel, das ein **Hard-Link** derselben Datei ist, gilt als „existiert“ (nicht als derselbe Eintrag) – sonst würde
  `rename` beide Namen stehen lassen.
- Die Vorschau zeigt für `[D]`/`[T]` die lokale Zeit des WebViews.

## 9. Review

Ein separater Review-Agent stand in dieser Sitzung nicht zur Verfügung (keine Subagenten-Werkzeuge). Stattdessen
gründliche Selbstprüfung der Schwerpunkte, jeweils mit Test belegt:
- **Nie überschreiben:** jede Umbenennung über `rename_noreplace`; nur „dieselbe Datei“ (gleicher Inode, ein Link)
  geht über `rename_same_entry` (prüft vorher die exakte Schreibweise) – `run_never_overwrites_a_target_that_appears_after_planning`,
  `plan_refuses_dangerous_paths_and_hard_links`, `rename_case_only_does_not_overwrite_a_distinct_entry` (006).
- **Zyklen/Abbruch:** Ketten in Abhängigkeitsreihenfolge (O(n)), Zyklen über eindeutige Zwischennamen mit
  Rücknahme – `run_simple_chain_swap_and_three_cycle`, `cycle_failure_is_rolled_back_without_temporary_names`,
  `cancel_stops_between_entries_and_completes_no_half_cycle`, `rename_job_swap_undo_and_undo_of_undo` (zählt die
  Einträge des Ordners: kein Zwischenname).
- **Undo:** stellt den Ausgangszustand her (auch Tausch, Dreierzyklus, NFD-Name byte-genau im E2E), geänderte Datei
  → Fehler je Eintrag, Undo des Undo, Log-Grenze 20 – `tests_ops.rs`.
- **Regex-Fehler:** ungültiger Ausdruck/Bedingung → Fehler am Feld, alle Zeilen „Fehler“, keine Rust-Anfrage, kein
  Umbenennen – Fehlerfälle im Katalog, `multirename.spec.ts`, Dialog-Test. ReDoS bleibt bewusst offen (E10 a).

### Review (separater Agent) – Ergebnis

Nachträglich hat ein separater Agent den Diff geprüft; die Funde sind mit je einem zuerst roten Test behoben
(`jobs/rename.rs` bzw. `tests_ops.rs`, `rename_presets.rs`, `platform.rs`).

| # | Fund | Stand |
|---|---|---|
| 1 mittel | Undo-Paar war nur {Pfad, alter Name}: ein zwischenzeitlich gelöschtes und neu angelegtes Ziel wäre umbenannt worden | ✅ `RenameItem.expect` = `platform::entry_stamp` (Unix: Gerät + Inode + Geburtszeit – Inode-Nummern werden sofort wiederverwendet; Windows: Größe + mtime als Rückfall), nur von der Engine gesetzt (`serde(skip)`); abweichend → Fehler je Eintrag „changed since the rename“ (`undo_unavailable`) – `rename_undo_leaves_a_replaced_entry_alone`, `entry_stamp_survives_a_rename_but_not_a_replacement`, `expect_is_not_part_of_the_wire_format` |
| 2 mittel (DoS) | Blockade-Schleife O(n²) (lange Kette, letztes Ziel belegt) | ✅ `block_waiters`: Rückwärtsabhängigkeiten (Besetzer → Wartende) einmal per Worklist, O(n) – `blocking_a_long_chain_is_linear` (100 000 synthetisch, vorher > 30 s), `plan_of_a_blocked_chain_of_twenty_thousand` (echte Dateien, ~0,7 s debug) |
| 3 gering | Groß/klein-Messung mit vollem Unicode-Case (ß→SS, İ), NotFound sofort „sensitiv“, Hard-Link als „gleich“ | ✅ nur ASCII-Buchstaben tauschen; Hard-Link (`nlink > 1`) oder verschwundener Eintrag → nächstes Mitglied, sonst Plattform-Default. Abweichung vom Vorschlag: NotFound bei noch vorhandenem Original gilt als eindeutig „sensitiv“ (mit ASCII-Tausch kein Faltungsproblem mehr) – `swap_case_is_ascii_only`, `case_measurement_ignores_hard_links_and_uses_the_next_member` |
| 4 gering | Hard-Link eines Plan-Mitglieds wurde als Kette erkannt; `waiting_for` überschrieb Wartende | ✅ `Occupied(j)` nur bei einem Link oder wenn das Ziel wirklich `j`s Name ist, sonst „existiert“; `waiting_for` als `Map<usize, Vec<usize>>` – `hard_link_of_a_member_is_not_a_chain` |
| 5 gering | Liegengebliebener Zwischenname fehlte im Undo; Panik mitten im Job verlor erledigte Paare | ✅ gescheiterte Rücknahme → Undo-Paar {Zwischenname → alter Name}; Undo-Liste als geteilter Puffer (`&mut Vec`, Manager behält ihn nach `catch_unwind`) – `stuck_temporary_name_is_in_the_undo_log`, `panic_keeps_the_pairs_done_so_far` (Puffer-Umbau vor dem Test, daher nicht rot) |
| 6 gering (Windows) | `platform::rename_noreplace`: Rückfall „prüfen + rename“ für Ordner/Links ist unter Windows nicht atomar | ⏳ offen: `MoveFileExW` ohne `MOVEFILE_REPLACE_EXISTING` (bzw. `std::fs::rename` prüfen) braucht einen Windows-Test – auf Windows nachziehen |
| 7 gering | `undo_of` war vom Frontend setzbar und schaltete den Partial-Modus frei | ✅ `#[serde(skip_deserializing)]`, nur `JobManager::undo_rename` setzt es; serialisiert weiter (Task-Liste) – `rename_undo_of_is_not_accepted_from_the_frontend` |
| 8 gering | `rename_presets::load`: jeder Lesefehler wurde als kaputte Datei nach `.bad` verschoben | ✅ nur Parse-/Versionsfehler; I/O-Fehler → Datei unberührt, `persist = false` – `read_errors_leave_the_file_alone` |

## 10. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [x] Phase 2 Rust: `jobs/rename.rs` (plan, run, Undo-Paare), `JobSpec::Rename`, Undo-Log im `JobManager`,
  Commands `plan_rename`, `undo_rename`, `load/save_rename_presets`, `rename_presets.rs`, Fehlercodes
  `duplicate_target`, `undo_unavailable` – 18 neue Rust-Tests (inkl. 10 000 Dateien: Plan 113 ms release)
- [x] Phase 3 Frontend: Engine + Testkatalog (99 Fälle), Store, Dialog, Vorschau-Table, Aktionen
  `OPEN_MULTIRENAME_DLG` (+ `Strg+M` unter Windows/Linux) und `UNDO_RENAME`, „Undo“ in der Task-Liste
- [x] Phase 4 Ende-zu-Ende (Xvfb, Debug-Build): Muster + Zähler + Umlaute auf Ordner/`README`/`x.tar.gz`/NFD-`über.txt`,
  Makro „first last - title“ per Tastatur, Konflikt mit vorhandener Datei (gesperrt, Zeile rot), Tausch `a↔b` über drei
  Ersetzungszeilen, Undo aus Task-Liste und Befehlspalette, „zuletzt“ nach Neustart, 10 000 Dateien (Vorschau
  < 350 ms nach der Eingabe, Umbenennen ~1 s, Undo). Nicht prüfbar: APFS/NTFS (Groß/klein-insensitiv,
  Normalisierung, Windows-Namen), gesperrter Ordner (als root greifen Rechte nicht), Dark-Mode nur über Tokens.
- [x] Phase 5 Doku · [x] Phase 6 Abschlussprüfung (`pnpm check`, Debug-Build), Selbst-Review (§9)

## 11. Offen

- KI-Modus (E11), Web-Worker gegen ReDoS (E10 b), Undo über einen Neustart, Undo für Einzel-Umbenennen (F2).
- Review #6: atomares „nie ersetzen“ für Ordner/Links unter Windows.
- Fehlertexte aus Rust sind englisch (i18n in 015).
