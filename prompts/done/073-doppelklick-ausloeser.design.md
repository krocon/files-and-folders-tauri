# 073 Doppelklick-Aktionen – Auslöser mit Modifier-Tasten – Design

Status: **freigegeben** (Marc, 09.11.2026, mit E22–E24) · Datum: 2026-11-09 · Branch `feat/doppelklick-ausloeser`
Fortsetzung von [`done/072-doppelklick-aktionen.design.md`](072-doppelklick-aktionen.design.md) (E1–E10).

Auftrag (Marc, 09.11.2026): Auslöser erweiterbar (Doppelklick mit Shift, Strg, ohne Taste …), Regelliste ~10 Zeilen
hoch, Add/Remove/Up/Down in die Fußzeile neben Help/Cancel/Save.

## Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `file-actions.models.ts` `FileActionTrigger = 'doubleClick'` | Art | passt, bekommt `modifiers` daneben |
| Rust `enum Trigger { DoubleClick }` | Art | **muss geändert werden**: eine unbekannte Art lässt heute die ganze Datei scheitern (`.bad`), der Prompt verlangt einen Problem-Code |
| `file_actions::problems`/`to_tool` | Prüfung beim Laden/Speichern/Start | wird um Code `trigger` erweitert |
| `settings.rs` Export/Import (`fileActions`) | Bündel | nutzt `FileActionRule` per serde → neues Feld reist mit; Test ergänzen |
| `ClickInput` (`shiftKey`, `toggleKey`) | Klick → Controller | um `altKey` erweitern; `toggleKey` ist schon „Mod“ |
| `FileListController.onClick` | 1. Klick markiert (Mod/Shift), 2. Klick (`clickCount ≥ 2`) → Hook | Hook bekommt die Modifier, Markierung wird bei Treffer zurückgesetzt (E14) |
| `FileBrowserStore.marked` / `replaceMarks` | Markierung | passt für Merken/Wiederherstellen |
| `FileActionsStore.handleDoubleClick` | Regel finden, starten | bekommt die Modifier |
| Dialog: `<ul class="listbox">` (`config-dialog.css`: `max-height: 12rem`, `min-height: 4rem`) | Regelliste | eigene Höhe für 10 Zeilen (E16) |
| `DialogKey` `secondary:<L>` (057) | Mod+Buchstabe | für Add/Remove/Up/Down (E17) |
| `shortcut.ts` `formatStroke` (Apple-Reihenfolge ⌃⌥⇧⌘) | Anzeige | gleiche Reihenfolge/Zeichen für die Auslöser-Anzeige |

## Entscheidungen

- **E11 Modell = Art + Modifier-Liste.** `trigger: 'doubleClick'` bleibt, neu `modifiers: ('mod' | 'alt' | 'shift')[]`,
  leer = ohne Taste. Kanonisch: ohne Doppelte, Reihenfolge `mod`, `alt`, `shift` (wie `Mod+Alt+Shift+…` der
  Kürzel-Notation 002). `mod` = ⌘ auf macOS, Strg auf Windows/Linux. Die Alternative „Kürzel-Zeichenkette
  `Shift+DoubleClick`“ verworfen: der Parser von 002 kennt nur Tasten, man müsste ihn um Pseudo-Tasten erweitern und
  Rust bräuchte einen zweiten Parser; zwei Felder sind kleiner und Checkboxen bilden sie 1:1 ab. Weitere Arten
  (Mittelklick, `Enter`) kommen später als neuer Wert von `trigger` mit denselben `modifiers` hinzu.
- **E12 Kein eigenes `ctrl`.** Auf macOS ist Ctrl+Klick das Kontextmenü (die Liste beendet dort den Druck und öffnet
  das Menü), ein Ctrl-Doppelklick ist also nicht zuverlässig; auf Windows/Linux ist Strg schon `mod`. Der reine Helfer
  `availableModifiers(platform)` liefert deshalb überall `mod`, `alt`, `shift` (Beschriftung je OS verschieden:
  `⌘ ⌥ ⇧` bzw. `Ctrl Alt Shift`) – er ist die eine Stelle, an der ein `ctrl` später nur für Windows/Linux dazukäme.
  Hinweis für die Hilfe: Manche Linux-Fenstermanager nutzen Alt+Ziehen zum Verschieben von Fenstern; dort kann
  Alt+Doppelklick ins Leere gehen.
- **E13 Rust hält Art und Modifier als Zeichenketten** (`trigger: String`, Default `"doubleClick"`;
  `modifiers: Vec<String>`, Default leer, höchstens 8). `sanitize` sortiert die bekannten kanonisch und entfernt
  Doppelte; Unbekanntes bleibt erhalten (nichts geht still verloren) und ergibt den **Problem-Code `trigger`** (vor
  allen anderen Prüfungen). Eine Regel mit Problem läuft nicht (072 E7), der Dialog zeigt den Text und lässt erst nach
  Korrektur speichern (Art im Select wählen bzw. Checkbox ändern schreibt nur bekannte Werte). Geschrieben wird
  `modifiers` immer (auch `[]`), eine Datei aus 072 (ohne das Feld) lädt als „ohne Taste“. `VERSION` bleibt 1.
- **E14 Exakter Vergleich, sonst Standard.** `findRule(rules, trigger, modifiers, entry)` verlangt gleiche Art und
  **gleiche Modifier-Menge**; erste passende Regel von oben gewinnt (E5). Kein Rückfall: Shift+Doppelklick trifft keine
  Regel „ohne Taste“. Trifft nichts, gilt das Verhalten von heute (`behavior.doubleClick`, sonst Öffnen) – auch mit
  gedrückter Taste.
- **E15 Markierung bei Treffer zurücksetzen.** Ursache: Der Doppelklick kommt als zwei Klick-Ereignisse; der erste
  (`clickCount = 1`) markiert bei Mod (umschalten) bzw. Shift (Bereich) sofort, erst der zweite ist der Doppelklick.
  Lösung: Der Controller merkt sich beim ersten Klick mit Mod/Shift die Markierung **vor** der Änderung (Set + Pfad
  des Klicks + Zeit). Der Hook meldet jetzt, *wer* den Doppelklick übernommen hat: `'rule' | 'handled' | 'open'`.
  Bei `'rule'` stellt der Controller die gemerkte Markierung wieder her (`marked.set(snapshot)` über eine neue,
  schmale Store-Methode `restoreMarks`), sofern der zweite Klick auf derselben Zeile liegt. Bei `'handled'`/`'open'`
  bleibt alles wie heute. Auch der Anker für Shift+Klick (`previousCursor`) bleibt dann unverändert.
  *Verworfen*: Markieren bis zum Ablauf der Doppelklick-Zeit verzögern – die Zeit des OS ist im WebView nicht
  bekannt, und jedes normale Strg/⌘-Markieren würde träge. Folge: Bei einem Treffer ist die Markierung für die Dauer
  zwischen den beiden Klicks (≤ ~0,5 s) kurz sichtbar und verschwindet dann – ein bewusst hingenommenes kurzes
  Aufblitzen.
- **E16 Regelliste 10 Zeilen.** Die Zeilen bekommen eine feste Höhe `--fa-row-h` (aus `--control-height`), die Liste
  `height: calc(10 * var(--fa-row-h) + Rahmen)`, begrenzt mit `max-height: 45vh` für kleine Fenster; darüber scrollt
  sie, der Cursor bleibt per `scrollIntoView({block:'nearest'})` sichtbar (auch nach Add/Up/Down). Nur dieser Dialog
  (Klasse `rules`), die anderen Konfigurationsdialoge bleiben wie sie sind.
- **E17 Knöpfe in der Fußzeile.** `foot`: links `Help`, `Add`, `Remove`, `Up`, `Down`; rechts `Cancel`, `Save`.
  Tasten (057): Add `Mod+N`, Remove `Mod+R`, Up `Mod+U`, Down `Mod+D` (A/C/V/X/Y/Z/Q/W/H/M sind reserviert; die
  Buchstaben kollidieren mit keinem anderen Knopf des Dialogs; globale Kürzel greifen im Modal nicht). Enter = Save,
  Esc = Cancel, Alt+↑/↓ und Entf in der Liste wie bisher; gedimmte Zustände wie bisher. Bei schmalem Fenster bricht
  die Fußzeile um (`flex-wrap`). Fokusreihenfolge: Liste → Felder rechts → Fußzeile (DOM-Reihenfolge).
- **E18 Auslöser-Feld.** Select „Art“ aus dem Katalog `TRIGGER_KINDS` (vorerst nur `doubleClick`) + eine Zeile
  Checkboxen je `availableModifiers(platform)` mit OS-Beschriftung (`⌘ Command`, `⌥ Option`, `⇧ Shift` bzw. `Ctrl`,
  `Alt`, `Shift`) in einer `fieldset` mit `legend` „Keys held“. Kombinationen (Shift+Alt) gehen von selbst.
- **E19 Zeilenanzeige.** Jede Zeile: Auslöser kompakt (`⇧`, `⌥⇧`, `⌘` auf macOS; `Shift`, `Alt+Shift`, `Ctrl` sonst;
  ohne Taste nichts) in fester schmaler Spalte, dann Muster, dann Kommando. Reine Funktion
  `modifierLabel(mods, platform)`.
- **E20 Verdeckte Regel = Hinweis.** Eine Regel, über der eine Regel mit gleicher Art, gleichen Modifiern und
  gleichem Muster steht (Muster verglichen als Menge der Globs ohne Groß-/Kleinschreibung), wird nie ausgelöst. Sie
  wird markiert (Zeile gedämpft, `⚠`, `aria-description`) und rechts erklärt; Speichern geht trotzdem. Reine Funktion
  `shadowedRules(rules): Set<id>`. Überschneidende, aber nicht gleiche Muster bleiben ohne Hinweis.
- **E21 Hilfe/Intro**: Abschnitt „Keys held“ in `file-actions-help.ts` mit Beispiel „Shift+Doppelklick auf `*.js` → im
  Terminal mit `node %N`, Doppelklick ohne Taste → normal öffnen“, plus Satz zu E12 (Linux-Alt) und E15. Texte en/de.

## Nachtrag zur Freigabe (Marc, 09.11.2026, Screenshot des Dialogs)

- **E22 Dialog breiter**: `62rem` statt `48rem` (Modal begrenzt weiter auf `100vw - 2rem`), damit die rechte Spalte
  mit ihren Hilfetexten in der Regel ohne Scrollbalken auskommt.
- **E23 Weniger Weißraum oben**: `Modal` bekommt die Eingabe `compact` (Titel ohne die 24 px Abstand darunter);
  nur dieser Dialog nutzt sie, die anderen bleiben unverändert.
- **E24 Überschrift der rechten Spalte**: die gewählte Regel als `h3` über den Feldern, z. B. „⇧ Double click on
  *.js“ (ohne Muster: „New rule“); sie ist zugleich das `aria-labelledby` der Gruppe. Alle Knöpfe stehen unten in
  einer Zeile (E17).

## Verträge

```ts
// core/fileactions/file-actions.models.ts
export type FileActionTrigger = 'doubleClick';
export type FileActionModifier = 'mod' | 'alt' | 'shift';
export const MODIFIER_ORDER: readonly FileActionModifier[] = ['mod', 'alt', 'shift'];
export interface FileActionRule { …; readonly trigger: FileActionTrigger; readonly modifiers: readonly FileActionModifier[]; … }
export type FileActionProblemCode = 'trigger' | 'pattern' | 'program' | 'params_quote' | 'params_files' | 'too_long';

// features/fileactions/file-actions-logic.ts (rein)
availableModifiers(platform: Platform): readonly FileActionModifier[]
normalizeModifiers(mods: Iterable<string>): FileActionModifier[]
modifierLabel(mods: readonly FileActionModifier[], platform: Platform): string
findRule(rules, trigger, modifiers, entry): FileActionRule | null
shadowedRules(rules): ReadonlySet<string>

// features/browser/file-list/file-list-controller.ts
interface ClickInput { …; shiftKey; toggleKey; altKey: boolean }
type DoubleClickResult = 'rule' | 'handled' | 'open';
interface FileListHooks { doubleClick?(entry: DirEntry, modifiers: readonly FileActionModifier[]): DoubleClickResult }

// FileActionsStore
handleDoubleClick(entry, modifiers, panel): boolean
```

```rust
// file_actions.rs
pub const TRIGGERS: &[&str] = &["doubleClick"];
pub const MODIFIERS: &[&str] = &["mod", "alt", "shift"]; // kanonische Reihenfolge
pub struct FileActionRule { …, #[serde(default = "double_click")] pub trigger: String,
                            #[serde(default)] pub modifiers: Vec<String>, … }
// Problem-Code "trigger": Art unbekannt oder ein Modifier unbekannt
```

Kein neuer Command, keine neue Abhängigkeit, Keymaps unverändert.

## UI-Skizze

```
┌ Double-click actions ─────────────────────────────────────────────────────────┐
│ Intro …                                                                        │
│ Rules                                   │ Trigger  [Double click        ▾]     │
│ ┌─────────────────────────────────────┐ │ Keys held ☐ ⇧ Shift ☐ ⌘ Command ☐ ⌥  │
│ │    *.js        node %N              │ │ File pattern [*.js            ]      │
│ │ ⇧  *.js        code %N              │ │ ☑ Ask first   ☐ Terminal window      │
│ │ ⚠  *.js        node %N   (verdeckt) │ │ Command [node %N               ]     │
│ │ …  (10 Zeilen, dann Scrollen)       │ │ help / problem / shadowed hint        │
│ └─────────────────────────────────────┘ │                                       │
│ Alt+↑/↓ move, Delete removes.           │                                       │
├────────────────────────────────────────────────────────────────────────────────┤
│ [Help] [Add] [Remove] [Up] [Down]                          [Cancel] [Save]      │
└────────────────────────────────────────────────────────────────────────────────┘
```

ARIA: Liste `role="listbox"` wie bisher; Modifier-Gruppe `fieldset`/`legend`; verdeckte Zeile `aria-description`.

## Tests

- Rust `file_actions.rs`: Datei im Format von 072 (ohne `modifiers`, `trigger` vorhanden/fehlend) → ohne Taste;
  Normalisierung (Reihenfolge, Doppelte); unbekannter Modifier / unbekannte Art → Problem `trigger`, Wert bleibt
  erhalten (Round-Trip); Laden/Speichern Round-Trip mit Modifiern; `settings.rs` Export/Import mit Modifiern.
- `file-actions-logic.spec.ts`: `findRule` exakt (Shift trifft nicht „ohne“, umgekehrt; Reihenfolge der Liste;
  Modifier-Reihenfolge egal), `availableModifiers`/`modifierLabel` je OS, `shadowedRules`.
- `file-list-controller.spec.ts`: Doppelklick reicht Modifier durch; Mod- und Shift-Doppelklick mit Treffer →
  Markierung wie vorher; ohne Treffer → Markierung wie heute.
- `file-actions.spec.ts`: Checkboxen ↔ Regel, Zeilenanzeige des Auslösers, Knöpfe in der Fußzeile (+ Tasten),
  Hinweis bei verdeckter Regel, Problemtext `trigger`; `catalogs.spec.ts`.
- E2E auf dem Mac (`pnpm tauri dev`): Akzeptanzkriterien 1, 2, 4.

## Abweichung bei der Umsetzung

- Die Tasten-Gruppe ist ein `div role="group"` mit Beschriftung statt `fieldset`/`legend` (gleiche Semantik, ohne die
  Sonderformatierung von `fieldset`).

## Phasen

Klein: Phase 2 (Rust) und 3 (Frontend) getrennt committen, 4–6 zusammen.

## Fortschritt

- [x] Design freigegeben (09.11.2026)
- [x] Rust (`5847eb0`): `trigger`/`modifiers` als Zeichenketten, Problem `trigger`, Tests (072-Format, Normalisierung,
  Unbekanntes bleibt erhalten, Export/Import).
- [x] Frontend (`a6080dc` + Nachtrag): Logik/Controller/Store/Dialog, Specs; `pnpm check` grün (einmal
  `pnpm install --force`, weil der pnpm-Store für `notices:check` einen Index vermisste – kein Befund des Codes).
- [x] Sichtprüfung per `pnpm screenshots --scene file-actions-dialog` (light/dark, 1280×760): Liste 10 Zeilen, alle
  Knöpfe in der Fußzeile, Überschrift der Regel. Dabei gefunden: der globale `label { margin-top: 24px }` und die
  Mindesthöhe der Checkbox-Labels machten die rechte Spalte unnötig hoch – im Dialog zurückgesetzt. Bei 760 px
  Fensterhöhe scrollt die rechte Spalte noch um eine Zeile (Modal max. 80vh).
- [ ] E2E in der echten App (Shift-/⌘-Doppelklick, Markierung) – offen, bei Marc auf dem Mac.
- [x] Doku, Prompt nach `done/`
