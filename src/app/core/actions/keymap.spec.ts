import { ACTION_IDS } from './action-catalog';
import { DEFAULT_KEYMAPS, RESERVED_MACOS, resolveKeymap, TABLE_NAVIGATION_KEYS } from './keymap';
import { Platform } from './platform';
import { canonicalShortcut } from './shortcut';

const PLATFORMS: Platform[] = ['macos', 'windows', 'linux'];

describe('default keymaps', () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: known ids, valid shortcuts, no double bindings, nothing reserved`, () => {
      const raw = DEFAULT_KEYMAPS[platform];
      for (const id of Object.keys(raw)) {
        expect(ACTION_IDS as readonly string[], id).toContain(id);
      }
      const seen = new Map<string, string>();
      const reserved = new Set(
        [...TABLE_NAVIGATION_KEYS, ...(platform === 'macos' ? RESERVED_MACOS : [])].map((s) =>
          canonicalShortcut(s, platform),
        ),
      );
      for (const [id, list] of Object.entries(raw)) {
        for (const s of list) {
          const c = canonicalShortcut(s, platform);
          expect(c, `${id}: ${s}`).not.toBeNull();
          expect(seen.get(c!), `${s} for ${id} and ${seen.get(c!)}`).toBeUndefined();
          expect(reserved.has(c), `${s} is reserved`).toBe(false);
          seen.set(c!, id);
        }
      }
      expect(resolveKeymap(platform).problems).toEqual([]);
    });
  }

  it('binds the Total Commander function keys and F7 = MkDir', () => {
    const b = resolveKeymap('windows').bindings;
    expect(b.OPEN_VIEW_DLG).toContain('F3');
    expect(b.OPEN_COPY_DLG).toContain('F5');
    expect(b.OPEN_RENAME_DLG).toContain('Shift+F6');
    expect(b.OPEN_MKDIR_DLG).toContain('F7');
    expect(b.OPEN_DELETE_DLG).toContain('F8');
    expect(b.TOGGLE_PANEL).toEqual(['Tab']);
  });

  it('keeps the shortcuts of the old version that really fired (018 J1–J6, mr defaults)', () => {
    const mac = resolveKeymap('macos').bindings;
    expect(mac.DESELECT_ALL).toContain('Mod+Ctrl+D');
    expect(mac.OPEN_CHDIR_DLG).toContain('Ctrl+Alt+D');
    expect(mac.OPEN_COPY_DLG).toContain('Mod+Ctrl+C');
    expect(mac.OPEN_MOVE_DLG).toContain('Mod+Ctrl+M');
    expect(mac.RELOAD_DIR).toContain('Mod+Ctrl+R');
    expect(mac.SELECT_ALL).toContain('Mod+Ctrl+A');
    expect(mac.OPEN_MKDIR_DLG).toContain('Ctrl+Alt+N');
    expect(mac.OPEN_GROUPFILES_DLG).toContain('Ctrl+Alt+G');
    expect(mac.OPEN_DELETE_EMPTY_FOLDERS_DLG).toContain('Ctrl+Alt+Shift+D');
    expect(mac.OPEN_FIND_DUPLICATES_DLG).toContain('Ctrl+Alt+Shift+F');
    expect(mac.OPEN_MARK_PATTERN_DLG).toContain('Ctrl+Alt+A');
    for (const p of ['windows', 'linux'] as const) {
      const b = resolveKeymap(p).bindings;
      expect(b.OPEN_CHDIR_DLG).toContain('Mod+Alt+D');
      expect(b.OPEN_MARK_PATTERN_DLG).toContain('Mod+Alt+A');
      expect(b.OPEN_FIND_DUPLICATES_DLG).toContain('Mod+Alt+Shift+F');
    }
  });
});

describe('resolveKeymap with an override', () => {
  it('replaces the list of an action and can remove all its shortcuts', () => {
    const r = resolveKeymap('linux', { OPEN_COPY_DLG: ['Mod+Alt+C'], OPEN_DELETE_DLG: [] });
    expect(r.bindings.OPEN_COPY_DLG).toEqual(['Mod+Alt+C']);
    expect(r.bindings.OPEN_DELETE_DLG).toEqual([]);
    expect(r.lookup.get('F5')).toBeUndefined();
    expect(r.lookup.get('Mod+Alt+C')).toBe('OPEN_COPY_DLG');
  });

  it('reports unknown ids, invalid and reserved shortcuts, and keeps the rest', () => {
    const r = resolveKeymap('macos', {
      NOPE: ['F1'],
      OPEN_COPY_DLG: ['Hyper+X', 'F9'],
      RELOAD_DIR: ['Mod+Q'],
    });
    expect(r.bindings.OPEN_COPY_DLG).toEqual(['F9']);
    expect(r.bindings.RELOAD_DIR).toEqual([]);
    expect(r.problems).toHaveLength(3);
  });

  it('gives an overridden shortcut to the overriding action', () => {
    const r = resolveKeymap('linux', { RELOAD_DIR: ['F5'] });
    expect(r.lookup.get('F5')).toBe('RELOAD_DIR');
    expect(r.bindings.OPEN_COPY_DLG).toEqual([]);
    expect(r.problems.some((p) => p.includes('F5'))).toBe(true);
  });

  it('reports a single stroke that blocks a chord', () => {
    const r = resolveKeymap('macos', { RELOAD_DIR: ['Ctrl+K'] });
    expect(r.problems.some((p) => p.includes('blocks the chord'))).toBe(true);
  });
});
