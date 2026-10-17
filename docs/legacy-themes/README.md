# Default-Designs der alten Version

Acht Farbschemata, die Marc am 2026-10-17 als **Default-Designs der alten Version** übergeben hat – unverändert
abgelegt (Quelle der Wahrheit für Prompt 019, nicht von Hand ändern). Format: `{ "name": "...", "colors": { "--fnf-…": "…" } }`.

| Datei | Charakter | Hintergrund Liste | Text | Cursor (bg / fg) | markiert (fg) | Kopf |
|---|---|---|---|---|---|---|
| `light.json` | hell, neutral | `#fff` | `#333` | `#0098db` / `#fff` | `#e00034` | `#f3f3f3` |
| `paper.json` | hell, Papier | `#E7E5DF` | `#6c6b6b` | `#6C6B6B` / `#DDD9CE` | `red` | `#DDD9CE` |
| `bitbucket.json` | hell, Blau | `#ebf0ff` | `#556198` | `#0098db` / `#ebf0ff` | `#e00034` | `#0747A6` |
| `cypress.json` | dunkel, Petrol | `rgb(22, 35, 50)` | `#657786` | `#657786` / `#fff` | `#04C38E` | `#fff` |
| `blackboard.json` | dunkel, Tafel | `#0c1021` | `#a9a9a9` | `#758129` / `#e8e9de` | `#fff` | `#303139` |
| `coffee.json` | dunkel, Kaffee | `#1a1a1a` | `#fff` | `#fff` / `#1a1a1a` | `orange` | `#363636` |
| `combat.json` | dunkel, grau | `#101010` | `#b6b4b4` | `#666666` / `#fff` | `#a6a4a4` | `#000` |
| `norton.json` | Norton Commander | `#000080` | `#fff` | `#008080` / `#fff` | – (fehlt) | `#000` |

(Werte nach Auflösung der `var()`-Verweise; „Cursor“ = `--fnf-table-focused-row-*`, „markiert“ =
`--fnf-table-selected-row-fg-color`.)

## Schema (76 Variablen, Präfix `--fnf-`)

- **Liste:** `table-bg|fg|border-color`, `table-header-bg|fg-color`, `table-hover-row-bg-color`,
  `table-focused-row-bg|fg-color` (Cursor), `table-selected-row-bg|fg-color` (markiert), `table-font-size` (überall 13px)
- **Aktives Panel:** `activepanel-table-bg|fg|border-color`, `activepanel-table-header-bg-color`,
  `activepanel-table-selected-row-bg|fg-color`, `activepanel-header-bg|border-color`,
  `activepanel-header-selected-tab-bg|fg-color`
- **Kopf (Pfad, Tabs):** `header-bg|fg|border-color`, `header-input-background-color|border|color`,
  `header-selected-tab-bg|fg-color`
- **Fußleiste:** `footer-bg|fg-color`, `footer-button-bg|fg|border-color`, `footer-shortcut-bg|fg-color`, `footer-error-fg-color`
- **Dialoge:** `dialog-primary|secondary-bg|fg|border-color`, `dialog-input-bg|fg|border-color`,
  `dialog-button-{primary,secondary,accent,warn,unthemed}-bg|fg|border-color`
- **Akzentfarben:** `material-{primary,secondary,accent,warn,unthemed}-color`
- **Sonstiges:** `error-panel-bg|fg-color`, `scrollbar-track-bg-color`, `scrollbar-thumb-bg|border|active-bg-color`,
  `tooltip-bg-color`, `tooltip-color`, `tooltip-background-input-color`, `tooltip-input-color`

## Bekannte Lücken

- `coffee.json`: keine `tooltip-*`-Variablen (4).
- `norton.json`: keine `tooltip-*`-Variablen (4) und kein `table-selected-row-fg-color`.
- Die Werte verweisen intern mit `var(--fnf-…)` aufeinander; alle Verweise sind innerhalb der Datei definiert.
