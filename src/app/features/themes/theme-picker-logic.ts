import { CLASSIC_PREFIX, DARK, LIGHT } from '../../core/theme/builtin-themes';
import { toHex } from '../../core/theme/color';
import { completeTokens, resolveColor } from '../../core/theme/theme-logic';
import { Theme } from '../../core/theme/theme.models';

/** Groups of the picker (design 070 E3): own schemes, built-in, the old designs. */
export type PickerGroup = 'own' | 'builtIn' | 'classic';

export interface PickerCard {
  /** `system` = follow the system, otherwise the scheme id. */
  readonly id: string;
  readonly name: string;
  readonly dark: boolean;
  readonly group: PickerGroup | 'system';
}

export function groupOf(t: Theme): PickerGroup {
  return !t.builtIn ? 'own' : t.id.startsWith(CLASSIC_PREFIX) ? 'classic' : 'builtIn';
}

/**
 * Filter (design 070 E5): every word must occur in the name, the group or "light"/"dark"
 * (also in the user's language, `words`); case does not matter.
 */
export function matchesFilter(
  card: PickerCard,
  filter: string,
  words: { readonly light: string; readonly dark: string; readonly group: string },
): boolean {
  const hay = `${card.name} ${card.dark ? `dark ${words.dark}` : `light ${words.light}`} ${
    card.group
  } ${words.group}`.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
    .every((w) => hay.includes(w));
}

/** The colours a thumbnail paints (design 070 E4), resolved to `#rrggbb` – nothing else gets in. */
export const THUMB_TOKENS = [
  '--color-header-bg',
  '--color-header-text',
  '--color-tab-text',
  '--color-active-panel-tab-bg',
  '--color-active-panel-tab-text',
  '--color-active-panel-accent',
  '--color-active-list-bg',
  '--color-active-list-text',
  '--color-list-bg',
  '--color-list-text',
  '--color-list-header-bg',
  '--color-cursor-bg',
  '--color-cursor-text',
  '--color-active-marked',
  '--color-icon-folder',
  '--color-icon-document',
  '--color-footer-bg',
  '--color-footer-text',
  '--color-splitter',
] as const;

/** `--thumb-<name>` → colour for the card's style; unresolvable tokens are left out. */
export function thumbStyle(theme: Pick<Theme, 'tokens' | 'dark'>): Record<string, string> {
  const tokens = completeTokens(theme, LIGHT, DARK);
  const out: Record<string, string> = {};
  for (const name of THUMB_TOKENS) {
    const c = resolveColor(name, tokens);
    if (c) {
      out[name.replace('--color-', '--thumb-')] = toHex(c);
    }
  }
  return out;
}
