# Design 019: Die Default-Designs der alten Version

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) – alle Empfehlungen übernommen ·
> **Datum:** 2026-10-18 · **Branch:** `feat/alte-designs` (von `main`, 001–013 fertig)
> **Grundlage:** Prompt 019, `docs/legacy-themes/` (acht Dateien, unverändert), Design 013 (Schema, Tokens,
> Kontrastpaare, Brücke), mr `file-table.component.global.css` (Verhalten aktives/inaktives Panel).
> **Phasen:** alle; Rust nur der Default der Auswahl (Phase 2 klein).

---

## 1. Bestand

| Baustein | heute (013) | Bewertung |
|---|---|---|
| Schema `{id, name, dark, tokens}`, Katalog `tokens.ts` | 84 Tokens in 8 Gruppen, `light`/`dark` = `styles.scss` | **passt**; +4 Tokens (§3) → 88 |
| Import alter Dateien | `--fnf-*` als „unbekannt“ gespeichert, nie angewendet | **wird Umrechnung** (E2) |
| Kontrastpaare (`CONTRAST_PAIRS`) | 53 Paare, Test über alle eingebauten Schemata | **passt**; Fokusring je Fläche (E5) |
| mr: aktives Panel | Cursor nur im aktiven Panel, markiert + Cursor = Cursorfarben | inaktiver Cursor/markiert + Cursor werden **abgeleitet** (E3) |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Umrechnen auf unsere Tokens, alte Namen nur im Import/Export ✅

Die acht Dateien liegen byte-gleich unter `src/app/core/theme/legacy/` (Test vergleicht mit `docs/legacy-themes/`)
und werden **zur Laufzeit** beim Laden des Moduls umgerechnet (`convertLegacy`, < 10 ms für alle). Ids
`classic-<name>`, Namen wie in der alten Version (groß geschrieben: Light, Paper, …). Die 013-Schemata heißen jetzt
„Modern light/dark“ (Ids `light`/`dark` bleiben – sie sind die Basis, die Lücken füllt).

### E2 – Umrechnung: auflösen, Lücken füllen, abbilden, ableiten, flach machen ✅

1. `var(--fnf-…)`-Ketten der Datei auflösen; `inherit`/fehlend → Fallback-Kette (§4) bzw. Basiswert.
   Rahmen-Kurzform (`solid 1px #aaa`) → Farbe; der Tippfehler `#rgb(22, 35, 50)` (cypress) → `rgb(22, 35, 50)`.
2. Basis = 013-`light`/`dark` nach Helligkeit des Listenhintergrunds (`dark` = Luminanz < 0,2).
3. Abgeleitet (gibt es alt nicht): `surface-raised` = Liste + 6 % Text, `border` = + 25 %, `muted`/`hidden-text` =
   Text + 30 % Hintergrund, inaktiver Cursor = Liste + 30 % Cursor (Text = Listentext), markiert unter dem Cursor =
   Mitte aus Markier- und Cursortextfarbe, Text auf Akzent/Primärknopf/Löschen = Schwarz oder Weiß (besser lesbar).
4. Abbilden nach Tabelle §3 (spätere Einträge gewinnen, z. B. `dialog-button-warn-bg` vor `material-warn`).
5. Alle Farb-Tokens auf Literale auflösen (die Korrektur ändert einzelne Tokens, nicht ganze Ketten).
6. Kontrastkorrektur (E4). Variablen ohne Token und unbekannte `--fnf-*` bleiben im Schema (gespeichert, nie
   angewendet) – für den Export im alten Format.

### E3 – Semantik ✅

alt „selected“ = **markiert** (`fnf-marked`), „focused“ = **Cursor** (`fnf-cursor`); `activepanel-*` gilt nur im Panel
mit Fokus (`.fnf-active-panel`, neue Brücke für `active-list-border`). mr zeigte im inaktiven Panel keinen Cursor und
unter dem Cursor keine Markierung – wir behalten beides (004/013) und leiten die Farben ab (E2.3).

### E4 – Jedes Design besteht WCAG AA: minimale, automatische Korrektur, dokumentiert ✅

Auftrag: alle Designs bestehen den Kontrasttest; wo das Original es nicht schafft, minimal nachdunkeln/aufhellen.
`fixContrast` (rein, `contrast-fix.ts`): je verletztem Paar die Farbe, die am wenigsten wandern muss, in sRGB
Richtung Schwarz oder Weiß mischen, bis Mindestwert + 0,05 erreicht ist (Binärsuche); bis 12 Runden, bis nichts mehr
verletzt ist. Regeln: Fenster-/Listenhintergründe bewegen sich nie; Hover/Suchtreffer/inaktiver Cursor bewegen sich
(nur Richtung Listenhintergrund) statt des Listentexts; Text auf Akzent, markiert unter dem Cursor, Fokusringe,
Favoritenstern, Aktiv-Linie bewegen sich statt ihres Hintergrunds. **Import alter Dateien nutzt dieselbe
Funktion** → gleiche Datei = gleiches Schema (Test). Die Liste aller Änderungen mit Verhältnis vorher/nachher steht in
**`docs/legacy-themes-contrast.md`** (vom Test erzeugt und geprüft). Die Originaldateien bleiben unverändert;
ein Test prüft, dass jedes abgebildete Token den Originalwert hat oder als Korrektur gelistet ist.

### E5 – Fokusring je Fläche ✅

bitbucket (dunkelblauer Kopf, hellblaue Liste) und norton (Dialog cyan, Liste navy) können mit **einer**
Fokusfarbe nicht überall 3:1 erreichen. Neu: `--color-header-focus` (Kopf, Tabs), `--color-footer-focus` (Statuszeile,
Button-Leiste), `--color-dialog-focus` (Modal) – Default `var(--color-focus)`; die Container setzen
`--color-focus: var(--color-…-focus)`, die Komponenten bleiben unverändert.

### E6 – Auswahl: Default fest `light` (alt), „System folgen“ = `light`/`coffee` ✅

`DEFAULT_SELECTION` (TS + Rust `Selection::default`) = fest `classic-light`, Paar `classic-light`/`classic-coffee`.
Fehlt das gewählte Schema, gilt das Default, dann 013-`light`/`dark`. Liste (Dialog, 🎨-Menü, Palette): eigene, die
acht alten, Modern light/dark. Rust `bound` behält jetzt auch `mode: "system"` (vorher fiel alles außer `fixed` auf den
Default – mit dem neuen Default wäre „System folgen“ verloren gegangen).

### E7 – Import/Export alter Dateien ✅

Import (Datei unter dem Cursor, 013) erkennt `{name, colors}` → `convertLegacy`; die Meldung nennt unbekannte
Variablen (behalten) und die Zahl der Kontrastkorrekturen. Neuer Knopf **„Export (old format)“** schreibt
`{name, colors}` mit allen 76 Variablen (erstes Token je Variable; ausgelassene aus den behaltenen `--fnf-*`).

## 3. Abbildung `--fnf-*` → Tokens (Code: `core/theme/legacy-theme-map.ts`, Test: vollständig = 76)

Präfixe weggelassen (`--fnf-`, `--color-`). Neu: `active-list-border`, `header-focus`, `footer-focus`, `dialog-focus`.

| alt | Token(s) | Bemerkung |
|---|---|---|
| `material-primary-color` | `accent`, `focus`, `splitter-active` | Accent: links, focus ring, splitter |
| `material-warn-color` | `danger` | Warnings, delete button |
| `material-accent-color` | `search-hit` | Accent colour for search hits (viewer) |
| `material-secondary-color` | — | Material “secondary” buttons – we have none |
| `material-unthemed-color` | — | Material default for unthemed buttons – see dialog-button-unthemed-* |
| `table-bg-color` | `list-bg`, `surface`, `bg` |  |
| `table-fg-color` | `list-text`, `text` |  |
| `table-border-color` | `list-border` |  |
| `table-header-bg-color` | `list-header-bg` |  |
| `table-header-fg-color` | `list-header-text` |  |
| `table-hover-row-bg-color` | `row-hover` |  |
| `table-focused-row-bg-color` | `cursor-bg`, `selection` | Cursor (old “focused”) |
| `table-focused-row-fg-color` | `cursor-text`, `selection-text` |  |
| `table-selected-row-bg-color` | `marked-bg` | Marked (old “selected”) |
| `table-selected-row-fg-color` | `marked` |  |
| `table-font-size` | `--font-size-list` |  |
| `activepanel-table-bg-color` | `active-list-bg` |  |
| `activepanel-table-fg-color` | `active-list-text` |  |
| `activepanel-table-border-color` | `active-list-border` |  |
| `activepanel-table-header-bg-color` | `active-list-header-bg` |  |
| `activepanel-table-selected-row-bg-color` | `active-marked-bg` |  |
| `activepanel-table-selected-row-fg-color` | `active-marked` |  |
| `activepanel-header-bg-color` | `active-header-bg` |  |
| `activepanel-header-border-color` | `active-panel-accent` | The line of the active panel |
| `activepanel-header-selected-tab-bg-color` | `active-panel-tab-bg` |  |
| `activepanel-header-selected-tab-fg-color` | `active-panel-tab-text` |  |
| `header-bg-color` | `header-bg` |  |
| `header-fg-color` | `header-text`, `tab-text` |  |
| `header-border-color` | `header-border` |  |
| `header-input-background-color` | `header-input-bg` |  |
| `header-input-border` | `header-input-border` | Colour of the border shorthand |
| `header-input-color` | `header-input-text` |  |
| `header-selected-tab-bg-color` | `tab-selected-bg` |  |
| `header-selected-tab-fg-color` | `tab-selected-text` |  |
| `footer-bg-color` | `footer-bg` |  |
| `footer-fg-color` | `footer-text` |  |
| `footer-button-bg-color` | `footer-button-bg` |  |
| `footer-button-fg-color` | `footer-button-text` |  |
| `footer-button-border-color` | `footer-button-border` |  |
| `footer-shortcut-bg-color` | `shortcut-bg` |  |
| `footer-shortcut-fg-color` | `shortcut-text` |  |
| `footer-error-fg-color` | `footer-error-text`, `error-text` |  |
| `error-panel-bg-color` | `danger-bg` |  |
| `error-panel-fg-color` | `danger-text` |  |
| `scrollbar-track-bg-color` | `scrollbar-track` |  |
| `scrollbar-thumb-bg-color` | `scrollbar-thumb` |  |
| `scrollbar-thumb-border-color` | `scrollbar-thumb-border` |  |
| `scrollbar-thumb-active-bg-color` | `scrollbar-thumb-active` |  |
| `tooltip-bg-color` | `tooltip-bg` |  |
| `tooltip-color` | `tooltip-text` |  |
| `tooltip-background-input-color` | `tooltip-input-bg` |  |
| `tooltip-input-color` | `tooltip-input-text` |  |
| `dialog-primary-bg-color` | `dialog-bg` |  |
| `dialog-primary-fg-color` | `dialog-text` |  |
| `dialog-primary-border-color` | `dialog-border` |  |
| `dialog-secondary-bg-color` | — | Second dialog area (Material header/footer) – we have none |
| `dialog-secondary-fg-color` | — | see dialog-secondary-bg-color |
| `dialog-secondary-border-color` | — | see dialog-secondary-bg-color |
| `dialog-input-bg-color` | `input-bg` |  |
| `dialog-input-fg-color` | `input-text` |  |
| `dialog-input-border-color` | `input-border` |  |
| `dialog-button-primary-bg-color` | `button-primary-bg` |  |
| `dialog-button-primary-fg-color` | `button-primary-text` |  |
| `dialog-button-primary-border-color` | — | Our primary button has no own border colour |
| `dialog-button-secondary-bg-color` | — | No secondary buttons |
| `dialog-button-secondary-fg-color` | — | No secondary buttons |
| `dialog-button-secondary-border-color` | — | No secondary buttons |
| `dialog-button-accent-bg-color` | — | No accent buttons |
| `dialog-button-accent-fg-color` | — | No accent buttons |
| `dialog-button-accent-border-color` | — | No accent buttons |
| `dialog-button-warn-bg-color` | `danger` | Delete button (overrides material-warn) |
| `dialog-button-warn-fg-color` | `on-danger` |  |
| `dialog-button-warn-border-color` | — | The delete button uses its background as border |
| `dialog-button-unthemed-bg-color` | `button-bg` | Normal buttons – only with an own text colour (else white on dark designs); nur wenn `dialog-button-unthemed-fg-color` gesetzt |
| `dialog-button-unthemed-fg-color` | `button-text` |  |
| `dialog-button-unthemed-border-color` | `button-border` | nur wenn `dialog-button-unthemed-fg-color` gesetzt |

**Fallbacks (§ Lücken):** table-selected-row-fg-color ← activepanel-table-selected-row-fg-color · tooltip-bg-color ← dialog-primary-bg-color → header-bg-color · tooltip-color ← dialog-primary-fg-color → header-fg-color · tooltip-background-input-color ← dialog-input-bg-color → header-input-background-color · tooltip-input-color ← dialog-input-fg-color → header-input-color · scrollbar-track-bg-color ← table-bg-color. Norton-Markierung damit Gelb `#fcfc54` (wie im aktiven Panel/Norton Commander),
Tooltips aus Dialog-, sonst Kopffarben.

## 4. Tests

- `legacy-theme.spec`: Dateien = `docs/legacy-themes`, Tabelle vollständig (76, jedes Token im Katalog, Auslassung mit
  Grund), Originalwerte unverändert außer gelisteten Korrekturen, Lücken/Fallbacks, Rahmen-Kurzform, unbekannte
  Variablen behalten, Import besteht Kontrast, Export alt → wieder einlesen, Kontrastbericht aktuell.
- `builtin-themes.spec`: alle 10 eingebauten Schemata vollständig, sicher, **bestehen alle 54 Paare**; Reihenfolge.
- `theme.service.spec`: Default (fest classic-light, System → coffee), Import `coffee.json` = mitgeliefertes Design,
  Export alt. Rust: Default + `system` bleibt.

## 5. Annahmen

- A1: Marcs Fragen (Fallbacks, Paar für „System folgen“) mit den Vorschlägen des Prompts beantwortet: Norton gelb,
  Tooltip aus Dialog/Kopf, `light`/`coffee`; Default fest `light`.
- A2: Der Auftrag „jedes Design besteht AA, minimal anpassen“ hat Vorrang vor „Originalfarben nicht ändern“ aus dem
  Prompt: die Originaldateien bleiben unverändert, die App zeigt die korrigierten Werte, jede Abweichung steht im
  Bericht (Marc kann einzelne Werte über „Save as new“ zurückdrehen).
- A3: Weiße `dialog-button-unthemed-bg` (Material-Default, auch in dunklen Designs) gilt nur, wenn das Design eine
  eigene Textfarbe setzt (norton); sonst folgen Knöpfe der Dialogfläche.

## 6. Abweichungen bei der Umsetzung

- (während der Umsetzung ergänzt)

## 7. Review

**Selbstprüfung:** (Phase 5)

### Review (separater Agent) – Ergebnis

| # | Fund | Stand |
|---|---|---|

## 8. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [ ] Phase 2 Rust: Default-Auswahl, `system` bleibt (Test)
- [ ] Phase 3 Frontend
- [ ] Phase 4 E2E
- [ ] Phase 5 Doku

## 9. Offen

- (Phase 5)
