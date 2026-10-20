import { ActionId, isActionId } from '../../../core/actions/action-catalog';
import { HeldModifiers } from '../../../core/actions/shortcut';
import { Platform } from '../../../core/actions/platform';
import buttonSets from './buttons.json';

/**
 * Function buttons of the button bar (row 6 of `docs/ui-layout.md`): one set per
 * held modifier (`buttons.json`, format of files-and-folders-mr plus `ctrl` for
 * Windows/Linux). Labels and shortcuts come from the action catalog/keymap.
 */
export type ModifierSet = 'default' | 'shift' | 'cmd' | 'ctrl' | 'alt';

export const MODIFIER_SETS: readonly ModifierSet[] = ['default', 'shift', 'ctrl', 'alt', 'cmd'];

/** The sets this platform shows (⌘ on macOS, Ctrl elsewhere; design 022 E3). */
export function setsForPlatform(platform: Platform): readonly ModifierSet[] {
  return ['default', 'shift', platform === 'macos' ? 'cmd' : 'ctrl', 'alt'];
}

/** The built-in sets (the user's `buttons.json` overrides them per set, design 022 E1). */
export const BUTTON_SETS: Readonly<Record<ModifierSet, readonly ActionId[]>> = Object.fromEntries(
  Object.entries(buttonSets).map(([set, ids]) => [set, (ids as string[]).filter(isActionId)]),
) as Record<ModifierSet, ActionId[]>;

/** Which set is shown while modifiers are held (mr: ⌘ before Alt before Shift; Ctrl on Windows/Linux). */
export function modifierSet(held: HeldModifiers, platform: Platform): ModifierSet {
  if (held.mod) {
    return platform === 'macos' ? 'cmd' : 'ctrl';
  }
  if (held.alt) {
    return 'alt';
  }
  if (held.shift) {
    return 'shift';
  }
  return 'default';
}
