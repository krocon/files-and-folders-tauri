import { NO_MODIFIERS } from '../../../core/actions/shortcut';
import { BUTTON_SETS, modifierSet, ModifierSet } from './button-config';

describe('button configuration', () => {
  it('has five known actions per modifier set', () => {
    for (const set of Object.keys(BUTTON_SETS) as ModifierSet[]) {
      expect(BUTTON_SETS[set], set).toHaveLength(5);
    }
    expect(BUTTON_SETS.default).toEqual([
      'OPEN_EDIT_DLG',
      'OPEN_COPY_DLG',
      'OPEN_MOVE_DLG',
      'OPEN_MKDIR_DLG',
      'OPEN_DELETE_DLG',
    ]);
    expect(BUTTON_SETS.shift[2]).toBe('OPEN_RENAME_DLG');
  });

  it('picks the set for the held modifiers (⌘ > Alt > Shift; Ctrl on Windows/Linux)', () => {
    expect(modifierSet(NO_MODIFIERS, 'macos')).toBe('default');
    expect(modifierSet({ ...NO_MODIFIERS, shift: true }, 'macos')).toBe('shift');
    expect(modifierSet({ ...NO_MODIFIERS, alt: true, shift: true }, 'linux')).toBe('alt');
    expect(modifierSet({ ...NO_MODIFIERS, mod: true, alt: true }, 'macos')).toBe('cmd');
    expect(modifierSet({ ...NO_MODIFIERS, mod: true }, 'windows')).toBe('ctrl');
  });
});
