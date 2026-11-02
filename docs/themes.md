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
