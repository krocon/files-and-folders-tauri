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
