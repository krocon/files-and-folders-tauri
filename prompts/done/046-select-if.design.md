# Design 046: Bedingt markieren – „Select if…“

> **Status:** umgesetzt (31.10.2026), Branch `feat/select-if` · ohne Freigabe-Halt (Marc: „go“) · keine neuen npm- oder
> Cargo-Abhängigkeiten · rein im Speicher auf den gelisteten Panel-Metadaten (kein Dateisystem-I/O).

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `compilePattern` (`features/actions/pattern.ts`, 002) | Glob (Leerzeichen-ODER, `a\|b`, `-ausschluss`) & Regex | **passt** – direkt für `MatcherSpec` (`glob`/`regex`) und `name`-Bedingung nutzbar |
| `FileTypesStore`, `file-types-logic.ts` (022) | Dateityp-Kategorien (`movies`, `images`, eigene aus `filetypes.json`) | **passt** – `categories()` liefert aktuelle Liste + Endungs-Set; fehlende Kategorie klar validierbar |
| `stemLength` (`features/ops/ops-logic.ts`, 006) | Basisname ohne letzte Endung (Dotfiles behalten vollen Namen) | **passt** – Grundlage für `exact`- und `prefix`-Basisnamen |
| `SearchHit.dir` (`core/search/search.models.ts`, 009/038) | Elternordner einer Zeile in Suche & Flacher Ansicht | **passt** – `(entry as Partial<SearchHit>).dir ?? ''` trennt Unterordner ohne Pfad-Splitting |
| `FileBrowserStore` / `FileListController` (001/002) | `displayedEntries`, `markedPaths`, `isParentPath`, `isUnmarkable`, `applyDirSize` | **ergänzen** – `replaceMarks(paths)` setzt das berechnete Markierungs-Set atomar in einem Signal-Schreibvorgang |
| `rememberDialog` / `recallDialog` (`shared/dialog-memory.ts`, 027) | Letzte Eingaben in `dialogs.recent` | **ergänzen** – `'selectIf'` aufnehmen; `maxItems` in `settings-schema.json` von `8` auf `12` erhöhen |
| `search.templates` (`settings-schema.json`, `settings.rs`, 022 E8) | Eigene Vorlagen mit Schema-Limits & Bündel-Export/Import | **Vorbild** – analog `selectIf.templates` (`maxItems: 50`, `maxBytes: 131072`) |
| `PreviewGrid` (`shared/preview-grid/`, 008) & `tool-dialog.css` | Virtuelle Vorschau-Tabelle & einheitliches Werkzeugdialog-Layout | **passt** – rendert 50 000 Vorschauzeilen verzögerungsfrei mit Zeilenklassen |
| `DISPLAY.sizeFormat` & `formatSize` (`core/settings/display.ts`, `shared/format.ts`) | Binäre (1024) vs. dezimale (1000) Größeneinheiten | **passt** – konsistent zwischen Größen-Bedingung und Live-Zusammenfassung |

### Vor-Start-Befund (`pnpm check`)

Beim Vorab-Lauf auf `main` schlug ausschließlich `scripts/site.test.mjs:46` fehl, weil im lokal vorhandenen (gitignorierten)
Ordner `screenshots/classic-norton/` vom 23.10. die später in Prompt 043 ergänzte Datei `palette-files.png` noch nicht
lag (`site/img/palette-files.png` ist vorhanden). Alle übrigen Checks (`version:check`, `format:check`, `lint`, `test`,
`build`, `rust:fmt`, `rust:lint`, `rust:test`, `notices:check`) liefen vorab grün.

## 2. Entscheidungen

- **E1 – Aktion & Benennung (de/en):**
  Neue Aktion `OPEN_SELECT_IF_DLG` (`category: 'selection'`, `availableIn: '046'`).
  - Englisch: Katalog & Menü `Select if…`.
  - Deutsch: Im Aktionskatalog (`ACTION_LABELS_DE`, Befehlspalette & Tastenkürzel-Liste) **`Bedingt markieren (Select if)…`**,
    damit die Suche nach `Select if` in der Befehlspalette in beiden Sprachen sofort trifft; in kompakten Menüs
    (`ACT_TEXTS.menu.selectIf`) **`Markieren, wenn…`**.
- **E2 – Reine Auswertungs-Engine & Komplexität (`select-if-engine.ts`):**
  - Synthetische und nicht markierbare Zeilen (`isParentRow` für `..`, `isVirtualPath` für Aggregate aus 033 sowie
    `unmarkablePaths` wie Hardlinks im Duplikat-Tab aus 016) werden vorab ausgefiltert – sie sind weder Kandidaten noch
    Begleitdateien. Bestehende Markierungen außerhalb von `displayedEntries` bleiben unangetastet; unmarkierbare Pfade
    gelangen nie ins Ziel-Set.
  - **Ordner-Schlüssel ohne Pfad-Splitting:** `folderKey(entry) = (entry as Partial<SearchHit>).dir ?? ''`. Im normalen
    Ordner haben alle Einträge `''`, in Flacher Ansicht (038) und Suchergebnissen (009) paaren sich nur Einträge mit
    identischem `dir`.
  - **Basisname (`stemOf`):** Für Dateien `entry.name.slice(0, stemLength(entry.name))`, für Ordner `entry.name`;
    verglichen wird immer **Unicode-NFC-normalisiert und kleingeschrieben** (`s.normalize('NFC').toLowerCase()`).
  - **`exact`-Companion in `O(N)`:** Pro `companion`-Bedingung wird eine `Map<string, DirEntry[]>` über
    `folderKey + '\u0000' + normStem` aller Einträge aufgebaut, die Partner-Art und Partner-`MatcherSpec` erfüllen.
    Beim Prüfen eines Kandidaten werden Treffer mit `partner.path !== candidate.path` nachgeschlagen.
  - **`prefix`-Companion in `O(N log N)`:** Neben dem exakten Lookup werden je `folderKey` die eindeutigen normalisierten
    Partner-Basisnamen nach UTF-16-Code-Units sortiert abgelegt. Für einen Kandidaten-Basisnamen `s` findet eine
    `lowerBound`-Binärsuche in `[s + sep, s + String.fromCharCode(sep.charCodeAt(0) + 1))` für `sep ∈ ['.', '-', '_']`
    alle Partner mit Präfix `s.`, `s-` oder `s_` (z. B. `Film (2026).de.srt`, `Film (2026)-poster.jpg`,
    `user.component.spec.ts`), ohne `Coup.mkv` mit `Couples.jpg` zu verwechseln und ohne quadratischen Paarvergleich.
  - **`UND`/`ODER`-Invariante bei `includeCompanions`:** Jede Bedingung liefert `(matched: boolean, companions: DirEntry[])`.
    Begleitdateien einer `companion`-Bedingung (`operator === 'exists' && includeCompanions`) werden **nur dann** in die
    Treffermenge aufgenommen, wenn (1) diese Teilbedingung selbst zutrifft **und** (2) der Kandidat die **gesamte**
    Regel (`matchMode: 'all' | 'any'`) erfüllt.
  - **`otherPanel` in `O(N + M)`:** Einmaliger Index über `otherEntries` (gefiltert ohne `..`/virtuelle Zeilen) nach
    normalisiertem Namen (`sameName`, `sameNameAndSize`, `newer`, `older`) bzw. Basisnamen (`sameStem`). Bei mehreren
    Einträgen gleichen Namens im anderen Panel (z. B. Flache Ansicht drüben) gilt `exists`, sobald mindestens ein
    Gegenstück das Vergleichskriterium erfüllt (`missing` ist die exakte Negation `!exists`).
- **E3 – Startzustand beim Öffnen:**
  `SelectIfStore.open()` liest `recallDialog(settings, 'selectIf')`. Ist dort eine gültige letzte Regel gespeichert, wird
  sie wiederhergestellt; beim allerersten Öffnen startet der Dialog direkt mit **Vorlage 1 (*Filme mit Cover-Bild, inkl.
  Cover*)**, weil sie das Leitbeispiel unmittelbar erklärt und auf jedem Medienordner sofort eine nachvollziehbare
  Vorschau zeigt.
- **E4 – Dialog-Layout & integrierte Vorschau (`SelectIfDialog`):**
  Modal `width="min(62rem, 96vw)"` `height="min(46rem, 92vh)"` `[fill]="true"` auf Basis von `tool-dialog.css` mit
  **dauerhaft sichtbarem `<app-preview-grid>`** im unteren Flex-Bereich:
  - So sieht der Nutzer bei jeder Änderung sofort *welche* Dateien als *Hauptdatei* bzw. *Begleitdatei* markiert (oder
    bei `remove` abgewählt) werden.
  - Optionaler Schalter *„Nicht zutreffende Kandidaten zeigen“* blendet ausgeschlossene Kandidaten gedimmt (`fnf-mr-unchanged`)
    mit Grund ein (z. B. `Meine Schwester und ich (2005).mkv` → *Ausgeschlossen*).
- **E5 – Größen- und Datums-Einheiten:**
  - `size` übernimmt den Multiplikator aus `DISPLAY.sizeFormat()` (`1000` bei `'decimal'`, sonst `1024`); das Einheiten-Select
    zeigt passend `B / KB / MB / GB` (bzw. wie `formatSize` in der App). Ordner nutzen `entry.size` (von `applyDirSize`
    befüllt; `null` = unbekannt → trifft nie zu).
  - `modified` akzeptiert ein injizierbares `nowMs` (Default `Date.now()` beim Öffnen/Ändern): `withinLast` (`nowMs - modifiedMs <= deltaMs` und `modifiedMs <= nowMs + 60_000` Toleranz bzw. `nowMs - modifiedMs <= deltaMs`, konkret `modifiedMs >= nowMs - deltaMs`), `olderThan` (`modifiedMs < nowMs - deltaMs`), `after` (`modifiedMs >= startOfLocalDay(date)`), `before` (`modifiedMs < startOfNextLocalDay(date)`), `between` (inklusive beider Kalendertage). `modifiedMs === null` trifft nie zu.
- **E6 – Vorlagen & Persistenz:**
  - 7 eingebaute Schnellvorlagen (`select-if-presets.ts`, sprachunabhängige IDs + lokalisierte Labels aus `SI_TEXTS`).
  - Eigene Vorlagen in `selectIf.templates` (`type: 'json'`, `default: []`, `maxItems: 50`, `maxBytes: 131072`) in
    `settings-schema.json` – dadurch automatisch von Rust validiert, im Einstellungs-Dialog unter *Verhalten* rücksetzbar
    und im Einstellungs-Bündel Export/Import enthalten.
  - `dialogs.recent` `maxItems` in `settings-schema.json` von `8` auf `12` angehoben (`MAX_REMEMBERED` in
    `dialog-memory.ts` direkt aus `SCHEMA['dialogs.recent'].maxItems` abgeleitet).
- **E7 – Tastenkürzel, Menüs & Vetos:**
  - Default-Kürzel **`Mod+Alt+S`** (`⌘⌥S` auf macOS, `Ctrl+Alt+S` auf Windows/Linux) – in allen drei Keymaps frei.
  - Eingehängt in: Menüleiste `Bearbeiten` (direkt unter `OPEN_UNMARK_PATTERN_DLG`), Actions-Menü ▴ (Spalte 2 unter
    `OPEN_UNMARK_PATTERN_DLG`), Kontextmenü (`empty` und `marked`, unter `INVERT_SELECTION`), Befehlspalette.
  - In `OFF_IN_USAGE` (`disk-usage-actions.ts`) gesperrt wie `OPEN_MARK_PATTERN_DLG`; **nicht** in `OFF_IN_ARCHIVE`,
    `OFF_ON_REMOTE` oder `OFF_WHILE_UNCHECKED` (reine Speicher-Markierung funktioniert überall).
- **E8 – Formular-Semantik & Barrierefreiheit (`modern-web-guidance`):**
  - Echte `<form>` mit `<button type="submit">` + `Mod+Enter`-Kürzel; vor jedem `Enter`-Submit (Formular & Vorlagenname)
    wird `!evt.isComposing` geprüft (IME-Schutz).
  - `<fieldset>` + `<legend>` mit sichtbaren Radio-Buttons für `combineMode` (4 Optionen < 6) und `matchMode` (2 Optionen < 6).
  - `autocorrect="off" autocapitalize="off" spellcheck="false" autocomplete="off"` auf allen Glob-/Regex- und
    Vorlagennamen-Feldern.
  - Programmierbarer Fehlerzustand (`aria-invalid="true"` + Fehlermeldung) für Tippfehler in Regex/Zahlen/Datumsbereichen
    wird erst gesetzt, nachdem das Feld verlassen (`blur`) oder das Formular abgeschickt (`submit`) wurde, und beim
    Weitertippen (`input`) sofort zurückgenommen; gelöschte Dateityp-Kategorien aus geladenen Vorlagen werden sofort als
    Hinweis ausgewiesen.

### Offen / Nicht im Scope

- Lesen von Datei-Inhalten, Prüfsummen oder Medien-Headern (`ffprobe`, Bildauflösung) während der Markierung.
- Automatisches rekursives Nachladen ungeöffneter Unterordner (Workflow dafür: `Mod+B` Flache Ansicht → `Mod+Alt+S`).

## 3. Verträge

### Regelmodell (`src/app/features/selectif/select-if-engine.ts`)

```ts
export type EntryKindFilter = 'files' | 'dirs' | 'both';
export type StemMatchMode = 'exact' | 'prefix';
export type ConditionJoin = 'all' | 'any';
export type CombineMode = 'replace' | 'add' | 'remove' | 'intersect';
export type SizeUnit = 'B' | 'KB' | 'MB' | 'GB';
export type AgeUnit = 'hours' | 'days';
export type OtherPanelCompare = 'sameName' | 'sameStem' | 'sameNameAndSize' | 'newer' | 'older';

export type MatcherSpec =
  | { readonly kind: 'any' }
  | { readonly kind: 'category'; readonly category: string }
  | { readonly kind: 'glob'; readonly pattern: string }
  | { readonly kind: 'regex'; readonly pattern: string };

export type ConditionSpec =
  | {
      readonly id: string;
      readonly kind: 'companion';
      readonly operator: 'exists' | 'missing';
      readonly partnerKind: EntryKindFilter;
      readonly partnerMatcher: MatcherSpec;
      readonly stemMatch: StemMatchMode;
      readonly includeCompanions: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'otherPanel';
      readonly operator: 'exists' | 'missing';
      readonly compare: OtherPanelCompare;
    }
  | {
      readonly id: string;
      readonly kind: 'size';
      readonly operator: 'gt' | 'lt' | 'between' | 'empty';
      readonly min: string;
      readonly max: string;
      readonly unit: SizeUnit;
    }
  | {
      readonly id: string;
      readonly kind: 'modified';
      readonly operator: 'withinLast' | 'olderThan' | 'after' | 'before' | 'between';
      readonly amount: string;
      readonly ageUnit: AgeUnit;
      readonly dateFrom: string; // YYYY-MM-DD
      readonly dateTo: string;   // YYYY-MM-DD
    }
  | {
      readonly id: string;
      readonly kind: 'name';
      readonly operator: 'matches' | 'notMatches';
      readonly mode: 'glob' | 'regex';
      readonly pattern: string;
    };

export interface SelectIfRule {
  readonly targetKind: EntryKindFilter;
  readonly targetMatcher: MatcherSpec;
  readonly matchMode: ConditionJoin;
  readonly conditions: readonly ConditionSpec[]; // 1..MAX_CONDITIONS (8)
  readonly combineMode: CombineMode;
}
```

### Settings-Schema (`src/app/core/settings/settings-schema.json`)

```json
"selectIf.templates": { "type": "json", "default": [], "maxItems": 50, "maxBytes": 131072 },
"dialogs.recent": { "type": "json", "default": [], "maxItems": 12, "maxBytes": 16384 }
```

### Dialog-Aufbau, Fokus & ARIA (`SelectIfDialog`)

```
┌─ Bedingt markieren (Select if) ──────────────────────────────────────── [×] ─┐
│ <form class="tool">                                                          │
│  [1] Vorlage: [ ▾ Schnellvorlagen / Eigene ] [Vorlage speichern…] [Löschen]  │
│  [2] Prüfe:   Art [Dateien ▾] · Filter [Kategorie ▾] [Filme ▾ / Muster …]    │
│  [3] Wenn:    (• Alle (UND)  ○ Mindestens eine (ODER))      [+ Bedingung]    │
│      ├─ [Begleitdatei im Ordner ▾] [existiert ▾] [Dateien ▾] [Kategorie ▾]   │
│      │  [Bilder ▾] · Basisname [Exakt ▾] · [✓] Begleitdateien mitmarkieren [×]│
│  [4] Wirkung (<fieldset>): (• Ersetzen ○ Hinzufügen ○ Entfernen ○ Einschr.)  │
│  [5] Vorschau-Kopf: "Vorschau" · [ ] Nicht zutreffende Kandidaten zeigen     │
│      <app-preview-grid role="grid" aria-labelledby="fnf-si-preview-label">   │
│        #  │ Name                          │ Rolle             │ Größe        │
│        1  │ By Any Means (2026).mkv       │ Hauptdatei        │ 6,6 GB       │
│        2  │ By Any Means (2026).jpg       │ Begleitdatei      │ 97 KB        │
│  [6] Fuß: <p aria-live="polite">18 von 35 Einträgen werden markiert          │
│            (9 Hauptdateien + 9 Begleitdateien · 71 GB)</p>                   │
│           <p role="alert">…</p>               [Abbrechen] [Markieren (⌘↵)]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Fokus beim Öffnen (`data-autofocus`): Vorlagen-Auswahl `[1]`, danach lineare Tab-Folge `[1] → [2] → [3] → [4] → [5] → [6]`.
`Esc` schließt ohne Änderung (bzw. bricht das Benennen einer Vorlage ab); `Strg/⌘+Enter` übernimmt die Markierung und
kehrt mit dem Fokus in die aktive Dateiliste zurück.

## 4. Tests

- **Rust (`src-tauri/src/settings.rs`):** `selectIf.templates` im eingebetteten Schema, `maxItems: 50` / `maxBytes`
  Sanitizing, Export/Import im Einstellungs-Bündel, `dialogs.recent` akzeptiert 12 Dialog-Schlüssel.
- **Reine Engine (`select-if-engine.spec.ts` + `select-if-engine.cases.json`):**
  - Marcs Beispielordner aus `046-select-if-beispiel.jpg` (31 Dateien + 4 Ordner): Vorlage 1 → 18 Treffer (9 `.mkv` +
    9 `.jpg`), Vorlage 2 → 1 Treffer (`Meine Schwester und ich (2005).mkv`), Vorlage 4 → 1 Treffer (`mainboard_1.webp`);
  - NFC/NFD-Umlaute (`Die Hölle`), Dotfiles (`.gitignore`), Mehrfach-Punkte (`Film.1080p.mkv` ↔ `Film.1080p.de.srt`),
    `exact` vs. `prefix` (`Coup.mkv` ≠ `Couples.jpg`), Selbst-Ausschluss (`images` ↔ `images`), fehlende Kategorie;
  - `UND`- und `ODER`-Invariante bei `includeCompanions`;
  - alle 4 `combineMode`-Varianten (`replace`, `add`, `remove`, `intersect` prüft Begleitdatei im gesamten Ordner);
  - `otherPanel` (`sameName`, `sameStem`, `sameNameAndSize`, `newer`, `older`, `missing`);
  - `size` (Binär/Dezimal, `empty`, `between`, Ordner mit/ohne berechneter Größe);
  - `modified` (`withinLast`, `olderThan`, `after`, `before`, `between` mit festem `nowMs`, `modifiedMs: null`);
  - `name` (`matches`/`notMatches`, Glob & Regex, ungültige Regex);
  - `..`, virtuelle Zeilen, `unmarkablePaths`, Flache Ansicht (`OrdnerA/Film.mkv` ≠ `OrdnerB/Film.jpg`);
  - Performance-Benchmark: 50 000 Einträge in Flacher Ansicht in `< 50 ms`.
- **Dialog, Store & Integration (`select-if.spec.ts`):** Vorlagen wählen/speichern/überschreiben/löschen,
  `dialogs.recent` Wiederherstellung (inkl. defekter JSON-Werte), Live-Zusammenfassung, Vorschau inkl. ausgeschlossener
  Kandidaten, verzögertes `aria-invalid` nach `blur`/Submit, IME-Schutz (`isComposing`), `Mod+Enter` & `Esc`,
  Aktions-/Menü-/Keymap-Registrierung, `catalogs.spec.ts` & `workspace-dialogs.spec.ts`.
- **Sichtprüfung & E2E:** Screenshot-Szene / Playwright-Prüfung in Hell & Dunkel mit Marcs Beispielordner.

## 5. Fortschritt

- [x] Phase 1: Bestand geprüft, Design `046-select-if.design.md` erstellt
- [x] Phase 2: Schema (`selectIf.templates`, `dialogs.recent` `maxItems: 12`) & Rust-Tests (`settings.rs`)
- [x] Phase 3: Engine, Fallkatalog, Vorlagen, Store, Dialog, Aktion/Keymaps/Menüs, Specs en/de
- [x] Phase 4: E2E- & Sichtprüfung (`screenshots/{light,dark,classic-norton}/select-if-dialog.png`, vertikale Ausrichtung der `Check`-Überschrift nachgeschärft)
- [x] Phase 5: Doku (`feature-parity.md`, `architecture.md`, `roadmap.md`, `features.md`, `README.md`, `CLAUDE.md`, `prompts/done/`)
- [x] Phase 6: `pnpm check` & `pnpm tauri build --debug --no-bundle` grün
