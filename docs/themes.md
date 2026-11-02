# Built-in colour schemes – origin

Besides the base schemes `light`/`dark` (= `src/styles.css`), Crimson and the eight classic designs of the old
version (`legacy/`, design 019), the app ships schemes modelled on popular editor themes
(`src/app/core/theme/themes/*.json`, registered in `EXTRA_THEMES` of `builtin-themes.ts`).

- Only **colour values** are taken over and mapped onto our tokens by hand; no file of the originals is part of
  the build. Colour values are no copyrightable work, so no licence text is needed in `THIRD-PARTY-NOTICES.txt`;
  the origin is named here out of courtesy.
- Every scheme defines all tokens and passes all `CONTRAST_PAIRS` (WCAG AA) **without** the automatic correction of
  the classic designs – where an original colour is too weak for its role here, a lighter/darker step is used
  (listed below).
- The templates (theme files, screenshots) stay in `prompts/done/<NNN>-…/` as reference only.

| Id | Name | Original | Licence of the original | Prompt |
|---|---|---|---|---|
| `one-dark` | One Dark | JetBrains plugin „One Dark theme“ by Mark Skelton (after Atom One Dark) | MIT | 062 |
| `one-dark-vivid` | One Dark Vivid | same, „Vivid“ variant | MIT | 062 |
| `true-dark` | True Dark | JetBrains theme „True Dark“ by Ahmed Elshaer (`ahmed3elshaer/IntelliJ-True-Black-Theme`) | MIT (README of the repo) | 063 |
| `true-black` | True Black | same, „True Black“ | MIT | 063 |
| `true-light` | True Light | same, „True Light“ | MIT | 063 |
| `matrix` | Matrix | own scheme after a screenshot of a green VS Code theme (colours measured from the image, no theme file) | – | 064 |
| `solarized-light` | Solarized Light | VS Code built-in „Solarized (light)“ (`microsoft/vscode`, `extensions/theme-solarized-light`), palette by Ethan Schoonover | MIT (both) | 065 |

## Deviations from the originals (contrast)

**One Dark / One Dark Vivid (062)**

- Muted text `#8f96a2` instead of `#7e8491` (3.7:1 on the list `#282c34`; comments `#5c6370` only 2.3:1).
- Cursor `#3d63b0` instead of the tree selection `#4d78cc`: white on `#4d78cc` is 4.3:1, and the yellow of a marked
  entry under the cursor (`#ffe599`) needs the darker blue (4.7:1).
- Primary button `#4269b9` with white text (the accent `#568af2` only gives 3.3:1 with white); the accent stays for
  lines, focus rings and the active panel.
- Error text `#e8848c` (Vivid `#f47a8b`) instead of `#e06c75`/`#ef596f` (4.4:1 / 4.2:1 on the list).
- The „Islands“ variants are left out: they differ from One Dark mainly in shape (rounded islands on a darker
  frame); their colours (frame `#202329`, list `#282c34`) are already those of One Dark.
- Folder icons yellow `#e5c07b` (class colour), not blue.

**True Dark / True Black / True Light (063)**

- True Dark: cursor and primary button `#6d28d9` with white text (accent `#8b5cf6` only 4.2:1 with white); the
  accent for lines/text is `#9469f7` (`#8b5cf6` as text on `#121212`: 4.4:1). Muted text `#8a96a2` (line numbers
  `#5a6577`: 3:1). Panels, header and status line one step lighter (`#1f1f1f`) so the areas stay apart. Marked =
  orange `#ffa14f`, under the cursor `#ffd9a8`.
- True Black: no colour accent – focus, active panel line and primary button white; borders and splitter `#353535`
  (the original `#1c1c1c` vanishes on black); cursor `#505050`, inactive `#353535`; marked amber `#fbbf24`.
- True Light: accent `#2a62dc` instead of `#2d69eb` (4.4:1 on `#f2f4fe`), muted text `#566180` (`#7f8aaa`/`#677290`
  too weak), marked `#96287e` (string colour `#ae3a93`, darkened for the inactive cursor `#d0d0d0`), errors
  `#c4002a`. The primary button is dark ink `#1c1a1a` with light text – the original's outlined light button cannot
  be expressed (the button border follows its background).
- „Islands“ variants left out (same colours, only rounded shapes); their hover values went into the row hover.
- *Follow the system* can pair True Light with True Dark/Black (any light and any dark scheme can be chosen).

**Matrix (064)**

- Muted/hidden text `#00a000` (the image's dark greens `#006600`/`#008800` reach only 2.7:1/4.2:1; they stay for
  borders, the splitter and the archive icon). Errors and danger in light magenta `#ff5fa8` (the image's `#c70067`
  is 3.4:1 as text; it stays as badge background with white text).
- Cursor inverted like a terminal: `#00cc00` with black text; marked = gold `#e6b422`, under the cursor dark brown
  `#4a3200`; inactive cursor `#0f3d0f` with `#88ff88`.
- The list uses a monospace stack `ui-monospace, Menlo, Consolas, monospace` (only a token value of this scheme).
- File icons in shades of green (executables gold) – the icon shape tells the type.

**Solarized Light (065)**

- Text on the cream/beige areas: chrome `#4a5d63`, list `#586e75` (base00 `#657b83` is 4.1:1 on `#fdf6e3`); muted
  `#56676b`. Comments `#93a1a1` only for decoration (usage chart).
- Cursor `#dfca88` with `#073642` instead of `#6c6c6c` (3.2:1); inactive cursor `#d1cbb8`.
- Marked = dark Solarized red `#a3221a` on `#f6e3c8` (`#dc322f` is 4.3:1 and unreadable on the gold cursor).
- Primary button `#ac9d57` with `#002b36` (white: 2.7:1); inputs/buttons `#ddd6c1` with `#3f5157`.
- Active panel line gold `#a07800` (= `#b58900` darkened to 3:1 on the list; gold like badge and progress, blue stays
  for folder icons); focus ring `#8f6f4c` (focusBorder `#b49471` is 2.3:1); accent as text `#7a5c00`.
- Icons from the palette, cyan/green darkened (`#1f8a82`, `#738500`) for 3:1; diff areas lighter than suggested
  (`#fce9e2`, `#fbecdb`) so the list text keeps 4.5:1.
- *Follow the system* offers it as light scheme; a „Solarized Dark“ would be the natural partner (own prompt).
