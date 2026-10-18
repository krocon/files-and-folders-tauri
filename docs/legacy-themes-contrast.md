# Kontrastbericht: die acht Designs der alten Version (Prompt 019)

> Erzeugt von `src/app/core/theme/legacy-theme.spec.ts` – nicht von Hand ändern. Neu schreiben:
> `UPDATE_LEGACY_REPORT=1 npx vitest run src/app/core/theme/legacy-theme.spec.ts`.
> Quelle: `docs/legacy-themes/*.json` (unverändert). WCAG 2.x, Text ≥ 4.5:1, Linien/Fokus ≥ 3:1.
> „Original“ = die alten Farben nach der Abbildung auf unsere Tokens, „App“ = nach der minimalen
> Korrektur (Mischung Richtung Schwarz/Weiß, Design 019 E4). Werte abgerundet.

## light (hell)

10 von 57 Paaren unter AA im Original, 9 Farben angepasst.

| Paar | Original | App |
|---|---:|---:|
| List | 12.63 | 12.63 |
| Active panel list | 21.00 | 21.00 |
| Cursor | 3.22 ⚠ | 4.56 |
| Marked | 4.97 | 4.97 |
| Marked, active panel | 4.97 | 4.97 |
| Marked under the cursor | 1.26 ⚠ | 4.56 |
| Column header | 12.63 | 12.63 |
| Panel header | 18.92 | 18.92 |
| Tabs | 18.92 | 18.92 |
| Selected tab | 12.63 | 12.63 |
| Selected tab, active panel | 3.22 ⚠ | 4.56 |
| Status line | 18.92 | 18.92 |
| Function buttons | 20.82 | 20.82 |
| Dialogs | 12.63 | 12.63 |
| Primary buttons | 6.51 | 6.51 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-accent` | `#0098db` | `#007db5` | Accent as text |
| `--color-selection` | `#0098db` | `#007db5` | Selection |
| `--color-cursor-bg` | `#0098db` | `#007db5` | Cursor |
| `--color-cursor-marked-text` | `#f0809a` | `#ffffff` | Marked under the cursor |
| `--color-cursor-inactive-bg` | `#b3e0f4` | `#eaf7fc` | Marked under the inactive cursor |
| `--color-active-panel-tab-text` | `#0098db` | `#007db5` | Selected tab, active panel |
| `--color-footer-error-text` | `#e00034` | `#de0034` | Status line warning |
| `--color-header-focus` | `#0098db` | `#0094d5` | Focus ring on the panel header |
| `--color-footer-focus` | `#0098db` | `#0094d5` | Focus ring on the status line |

## paper (hell)

37 von 57 Paaren unter AA im Original, 27 Farben angepasst.

| Paar | Original | App |
|---|---:|---:|
| List | 4.21 ⚠ | 4.55 |
| Active panel list | 16.67 | 16.67 |
| Cursor | 3.76 ⚠ | 4.58 |
| Marked | 3.17 ⚠ | 4.56 |
| Marked, active panel | 13.16 | 13.16 |
| Marked under the cursor | 1.02 ⚠ | 4.57 |
| Column header | 3.67 ⚠ | 4.55 |
| Panel header | 10.93 | 10.93 |
| Tabs | 10.93 | 10.93 |
| Selected tab | 3.67 ⚠ | 4.55 |
| Selected tab, active panel | 3.17 ⚠ | 4.56 |
| Status line | 11.26 | 11.26 |
| Function buttons | 20.82 | 20.82 |
| Dialogs | 4.21 ⚠ | 4.55 |
| Primary buttons | 6.51 | 6.51 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-text` | `#6c6b6b` | `#666666` | Text on the window |
| `--color-muted` | `#91908e` | `#676664` | Muted text |
| `--color-accent` | `#0098db` | `#006c9c` | Accent as text |
| `--color-accent-text` | `#000000` | `#e4e4e4` | Text on accent |
| `--color-selection` | `#6c6b6b` | `#5f5e5e` | Selection |
| `--color-search-hit` | `#e0ce00` | `#f1e889` | Search hit |
| `--color-focus` | `#0098db` | `#008ac7` | Focus ring |
| `--color-list-text` | `#6c6b6b` | `#666666` | List |
| `--color-group-alt-bg` | `#e1dfd9` | `#e6e5e0` | List, every other duplicate group |
| `--color-list-header-text` | `#657786` | `#596875` | Column header |
| `--color-marked` | `#ff0000` | `#cf0000` | Marked |
| `--color-hidden-text` | `#91908e` | `#676664` | Hidden entries |
| `--color-error-text` | `#e00034` | `#cd0030` | Unreadable entries |
| `--color-cursor-bg` | `#6c6b6b` | `#5f5e5e` | Cursor |
| `--color-cursor-marked-text` | `#6f6d67` | `#d9d9d7` | Marked under the cursor |
| `--color-cursor-inactive-bg` | `#c2c0bc` | `#eeeeec` | Cursor, inactive panel |
| `--color-active-panel-tab-text` | `#ff0000` | `#cf0000` | Selected tab, active panel |
| `--color-active-panel-accent` | `#e7e5df` | `#83827f` | Active panel line |
| `--color-tab-selected-text` | `#657786` | `#596875` | Selected tab |
| `--color-favorite` | `#a87300` | `#a37000` | Favourite star |
| `--color-footer-error-text` | `#e00034` | `#bf002c` | Status line warning |
| `--color-dialog-text` | `#6c6b6b` | `#666666` | Dialogs |
| `--color-input-text` | `#6c6b6b` | `#666666` | Inputs |
| `--color-button-text` | `#6c6b6b` | `#666666` | Buttons |
| `--color-header-focus` | `#0098db` | `#0081bb` | Focus ring on the panel header |
| `--color-dialog-focus` | `#0098db` | `#008ac7` | Focus ring in dialogs |
| `--color-footer-focus` | `#0098db` | `#0081bb` | Focus ring on the status line |

## bitbucket (hell)

28 von 57 Paaren unter AA im Original, 21 Farben angepasst.

| Paar | Original | App |
|---|---:|---:|
| List | 5.19 | 5.19 |
| Active panel list | 21.00 | 21.00 |
| Cursor | 2.83 ⚠ | 4.55 |
| Marked | 4.37 ⚠ | 4.57 |
| Marked, active panel | 4.97 | 4.97 |
| Marked under the cursor | 1.15 ⚠ | 4.57 |
| Column header | 11.09 | 11.09 |
| Panel header | 8.53 | 8.53 |
| Tabs | 8.53 | 8.53 |
| Selected tab | 2.83 ⚠ | 4.55 |
| Selected tab, active panel | 3.22 ⚠ | 4.56 |
| Status line | 8.53 | 8.53 |
| Function buttons | 8.53 | 8.53 |
| Dialogs | 5.19 | 5.19 |
| Primary buttons | 6.51 | 6.51 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-muted` | `#828cb7` | `#646b8d` | Muted text |
| `--color-accent` | `#0098db` | `#0074a6` | Accent as text |
| `--color-accent-text` | `#000000` | `#f0f0f0` | Text on accent |
| `--color-selection` | `#0098db` | `#0074a6` | Selection |
| `--color-search-hit` | `#e0ce00` | `#efe579` | Search hit |
| `--color-focus` | `#0098db` | `#0092d2` | Focus ring |
| `--color-row-hover` | `#0747a6` | `#d9e3f1` | List, row under the mouse |
| `--color-marked` | `#e00034` | `#da0033` | Marked |
| `--color-hidden-text` | `#828cb7` | `#646b8d` | Hidden entries |
| `--color-error-text` | `#e00034` | `#da0033` | Unreadable entries |
| `--color-cursor-bg` | `#0098db` | `#0074a6` | Cursor |
| `--color-cursor-marked-text` | `#e6789a` | `#fcedf1` | Marked under the cursor |
| `--color-cursor-inactive-bg` | `#a5d6f4` | `#e3f2fb` | Cursor, inactive panel; Marked under the inactive cursor |
| `--color-active-panel-tab-text` | `#0098db` | `#007db5` | Selected tab, active panel |
| `--color-active-panel-accent` | `#ffffff` | `#939393` | Active panel line |
| `--color-tab-selected-text` | `#0098db` | `#0074a6` | Selected tab |
| `--color-favorite` | `#a87300` | `#bd953d` | Favourite star |
| `--color-footer-error-text` | `#e00034` | `#f4a9ba` | Status line warning |
| `--color-header-focus` | `#0098db` | `#20a5df` | Focus ring on the panel header |
| `--color-dialog-focus` | `#0098db` | `#0092d2` | Focus ring in dialogs |
| `--color-footer-focus` | `#0098db` | `#20a5df` | Focus ring on the status line |

## cypress (dunkel)

25 von 57 Paaren unter AA im Original, 17 Farben angepasst.

| Paar | Original | App |
|---|---:|---:|
| List | 3.43 ⚠ | 4.59 |
| Active panel list | 15.90 | 15.90 |
| Cursor | 4.62 | 4.62 |
| Marked | 6.96 | 6.96 |
| Marked, active panel | 5.69 | 5.69 |
| Marked under the cursor | 2.98 ⚠ | 4.55 |
| Column header | 3.43 ⚠ | 4.59 |
| Panel header | 15.42 | 15.42 |
| Tabs | 15.42 | 15.42 |
| Selected tab | 6.96 | 6.96 |
| Selected tab, active panel | 6.96 | 6.96 |
| Status line | 15.88 | 15.88 |
| Function buttons | 20.82 | 20.82 |
| Dialogs | 3.43 ⚠ | 4.59 |
| Primary buttons | 9.20 | 9.20 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-text` | `#657786` | `#7c8c98` | Text on the window |
| `--color-muted` | `#4d5e6d` | `#7e8b95` | Muted text |
| `--color-search-hit` | `#e0ce00` | `#272300` | Search hit |
| `--color-list-text` | `#657786` | `#7c8c98` | List |
| `--color-group-alt-bg` | `#1a2736` | `#182331` | List, every other duplicate group |
| `--color-list-header-text` | `#657786` | `#7c8c98` | Column header |
| `--color-hidden-text` | `#4d5e6d` | `#7e8b95` | Hidden entries |
| `--color-error-text` | `#e00034` | `#ea5476` | Unreadable entries |
| `--color-cursor-marked-text` | `#82e1c7` | `#fafefd` | Marked under the cursor |
| `--color-cursor-inactive-text` | `#657786` | `#9ba7b0` | Cursor, inactive panel |
| `--color-active-panel-accent` | `#162332` | `#656e77` | Active panel line |
| `--color-favorite` | `#f2c14e` | `#b38e3a` | Favourite star |
| `--color-dialog-text` | `#657786` | `#7c8c98` | Dialogs |
| `--color-input-text` | `#657786` | `#7c8c98` | Inputs |
| `--color-button-text` | `#657786` | `#7c8c98` | Buttons |
| `--color-header-focus` | `#04c38e` | `#03a77a` | Focus ring on the panel header |
| `--color-footer-focus` | `#04c38e` | `#03a77a` | Focus ring on the status line |

## blackboard (dunkel)

13 von 57 Paaren unter AA im Original, 9 Farben angepasst.

| Paar | Original | App |
|---|---:|---:|
| List | 8.03 | 8.03 |
| Active panel list | 8.03 | 8.03 |
| Cursor | 3.47 ⚠ | 4.58 |
| Marked | 18.88 | 18.88 |
| Marked, active panel | 13.54 | 13.54 |
| Marked under the cursor | 3.25 ⚠ | 4.55 |
| Column header | 8.03 | 8.03 |
| Panel header | 12.28 | 12.28 |
| Tabs | 12.28 | 12.28 |
| Selected tab | 5.85 | 5.85 |
| Selected tab, active panel | 18.88 | 18.88 |
| Status line | 12.28 | 12.28 |
| Function buttons | 12.93 | 12.93 |
| Dialogs | 8.03 | 8.03 |
| Primary buttons | 6.51 | 6.51 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-muted` | `#7a7b80` | `#7c7d81` | Muted text |
| `--color-selection` | `#758129` | `#636d23` | Selection |
| `--color-search-hit` | `#e0ce00` | `#443f00` | Search hit |
| `--color-hidden-text` | `#7a7b80` | `#7c7d81` | Hidden entries |
| `--color-error-text` | `#e00034` | `#e7355f` | Unreadable entries |
| `--color-cursor-bg` | `#758129` | `#636d23` | Cursor |
| `--color-cursor-marked-text` | `#e4e4b2` | `#eaeac2` | Marked under the cursor |
| `--color-footer-error-text` | `#e00034` | `#ee728e` | Status line warning |
| `--color-tooltip-text` | `#0c1021` | `#747780` | Tooltip |

## coffee (dunkel)

6 von 57 Paaren unter AA im Original, 5 Farben angepasst, aus Fallbacks: `--fnf-tooltip-bg-color`, `--fnf-tooltip-color`, `--fnf-tooltip-background-input-color`, `--fnf-tooltip-input-color`.

| Paar | Original | App |
|---|---:|---:|
| List | 17.40 | 17.40 |
| Active panel list | 17.40 | 17.40 |
| Cursor | 17.40 | 17.40 |
| Marked | 8.81 | 8.81 |
| Marked, active panel | 8.81 | 8.81 |
| Marked under the cursor | 5.50 | 5.50 |
| Column header | 7.49 | 7.49 |
| Panel header | 12.08 | 12.08 |
| Tabs | 12.08 | 12.08 |
| Selected tab | 15.00 | 15.00 |
| Selected tab, active panel | 5.39 | 5.39 |
| Status line | 12.08 | 12.08 |
| Function buttons | 13.63 | 13.63 |
| Dialogs | 17.40 | 17.40 |
| Primary buttons | 6.51 | 6.51 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-search-hit` | `#e0ce00` | `#827700` | Search hit |
| `--color-error-text` | `#e00034` | `#e8456b` | Unreadable entries |
| `--color-cursor-inactive-bg` | `#5f5f5f` | `#494949` | Marked under the inactive cursor |
| `--color-active-panel-accent` | `#000000` | `#676767` | Active panel line |
| `--color-footer-error-text` | `#e00034` | `#ef7b96` | Status line warning |

## combat (dunkel)

8 von 57 Paaren unter AA im Original, 7 Farben angepasst.

| Paar | Original | App |
|---|---:|---:|
| List | 9.22 | 9.22 |
| Active panel list | 14.00 | 14.00 |
| Cursor | 5.74 | 5.74 |
| Marked | 7.67 | 7.67 |
| Marked, active panel | 4.30 ⚠ | 4.55 |
| Marked under the cursor | 2.33 ⚠ | 4.57 |
| Column header | 9.22 | 9.22 |
| Panel header | 8.46 | 8.46 |
| Tabs | 8.46 | 8.46 |
| Selected tab | 19.02 | 19.02 |
| Selected tab, active panel | 11.70 | 11.70 |
| Status line | 8.46 | 8.46 |
| Function buttons | 6.41 | 6.41 |
| Dialogs | 9.22 | 9.22 |
| Primary buttons | 6.51 | 6.51 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-search-hit` | `#e0ce00` | `#4e4700` | Search hit |
| `--color-error-text` | `#e00034` | `#e6355e` | Unreadable entries |
| `--color-cursor-marked-text` | `#f88099` | `#fddee4` | Marked under the cursor |
| `--color-active-marked-bg` | `#101010` | `#070707` | Marked, active panel |
| `--color-footer-error-text` | `#e00034` | `#e41d4b` | Status line warning |
| `--color-tooltip-text` | `#a6a4a4` | `#3b3a3a` | Tooltip |
| `--color-tooltip-input-text` | `#a6a4a4` | `#3b3a3a` | Tooltip input |

## norton (dunkel)

15 von 57 Paaren unter AA im Original, 13 Farben angepasst, aus Fallbacks: `--fnf-table-selected-row-fg-color`, `--fnf-tooltip-bg-color`, `--fnf-tooltip-color`, `--fnf-tooltip-background-input-color`, `--fnf-tooltip-input-color`.

| Paar | Original | App |
|---|---:|---:|
| List | 16.00 | 16.00 |
| Active panel list | 16.00 | 16.00 |
| Cursor | 4.77 | 4.77 |
| Marked | 14.63 | 14.63 |
| Marked, active panel | 14.63 | 14.63 |
| Marked under the cursor | 4.53 | 4.53 |
| Column header | 8.98 | 8.98 |
| Panel header | 11.78 | 11.78 |
| Tabs | 11.78 | 11.78 |
| Selected tab | 8.98 | 8.98 |
| Selected tab, active panel | 14.91 | 14.91 |
| Status line | 11.78 | 11.78 |
| Function buttons | 4.39 ⚠ | 4.58 |
| Dialogs | 2.82 ⚠ | 4.60 |
| Primary buttons | 7.14 | 7.14 |

| Token | Original | App | wegen |
|---|---|---|---|
| `--color-search-hit` | `#e0ce00` | `#827700` | Search hit |
| `--color-row-hover` | `#c0c0c0` | `#757575` | List, row under the mouse |
| `--color-error-text` | `#e00034` | `#ea5376` | Unreadable entries |
| `--color-active-panel-accent` | `#1e3f4e` | `#57707b` | Active panel line |
| `--color-footer-error-text` | `#e00034` | `#e41d4b` | Status line warning |
| `--color-footer-button-bg` | `#008080` | `#058383` | Function buttons |
| `--color-dialog-bg` | `#05a8a8` | `#048080` | Dialogs |
| `--color-muted` | `#b3b3d9` | `#fafafc` | Muted text in dialogs |
| `--color-input-text` | `#a8a8a8` | `#737373` | Inputs |
| `--color-button-text` | `#a8a8a8` | `#757575` | Buttons |
| `--color-dialog-focus` | `#0098db` | `#9dd8f1` | Focus ring in dialogs |
| `--color-tooltip-bg` | `#05a8a8` | `#048080` | Tooltip |
| `--color-tooltip-input-text` | `#a8a8a8` | `#737373` | Tooltip input |
