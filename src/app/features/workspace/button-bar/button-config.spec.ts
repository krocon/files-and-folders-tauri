import { BUTTON_META, BUTTON_SETS, buttonsFor, ModifierSet } from './button-config';

describe('button configuration', () => {
  it('has five buttons per modifier set, all with labels', () => {
    for (const set of Object.keys(BUTTON_SETS) as ModifierSet[]) {
      expect(BUTTON_SETS[set]).toHaveLength(5);
      for (const id of BUTTON_SETS[set]) {
        expect(BUTTON_META[id], `${set}: ${id}`).toBeDefined();
      }
    }
  });

  it('shows the default set in the order of docs/ui-layout.md', () => {
    expect(buttonsFor('default').map((b) => `${b.key} ${b.label}`)).toEqual([
      'F4 Edit',
      'F5 Copy',
      'F6 Move',
      'F7 MkDir',
      'F8 Delete',
    ]);
    expect(buttonsFor('shift').map((b) => b.label)).toEqual([
      'Create File',
      'Copy',
      'Rename',
      'MkDir',
      'Delete',
    ]);
    expect(buttonsFor('cmd')[2].label).toBe('Multi Rename');
  });
});
