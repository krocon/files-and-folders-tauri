import { ACTION_IDS, ActionId } from '../../core/actions/action-catalog';
import { ActionState, ExtraAction } from '../../core/actions/action.service';
import { NativeMenuNode } from '../../core/menu/menu.models';
import {
  contextKind,
  contextMenuFor,
  MENU_BAR,
  MenuDef,
  MenuSource,
  resolveMenu,
  resolveMenuBar,
  toNativeSpec,
} from './menu-model';

function source(
  states: Partial<Record<ActionId, ActionState>> = {},
  extras: ExtraAction[] = [],
): MenuSource {
  return {
    state: (id) => states[id] ?? 'ready',
    shortcutLabel: (id) => (id === 'OPEN_COPY_DLG' ? 'F5' : ''),
    shortcuts: (id) =>
      id === 'OPEN_COPY_DLG' ? ['F5'] : id === 'OPEN_COMMAND_PALETTE' ? ['Mod+Shift+P'] : [],
    extras: () => extras,
    extraShortcutLabel: (id) => (id === 'tool:edit' ? 'Ctrl+E' : ''),
  };
}

const tool = (id: string, enabled = true, shortcut: string | null = null): ExtraAction => ({
  id,
  label: id.slice(5),
  shortcut,
  enabled: () => enabled,
  run: () => undefined,
});

function ids(defs: readonly MenuDef[], out = new Set<string>()): Set<string> {
  for (const d of defs) {
    if (typeof d === 'string') {
      out.add(d);
    } else if ('sub' in d || 'when' in d) {
      ids(d.items, out);
    }
  }
  return out;
}

describe('menu model', () => {
  it('has every action of the catalog in the menu bar (mouse reaches everything)', () => {
    const inBar = ids(MENU_BAR.flatMap((m) => m.items));
    // keys only (Shift+arrows, context menu itself, menu bar focus)
    const keysOnly: ActionId[] = [
      'MARK_DOWN',
      'MARK_UP',
      'MARK_TO_START',
      'MARK_TO_END',
      'OPEN_CONTEXT_MENU',
      'FOCUS_MENU_BAR',
    ];
    const missing = ACTION_IDS.filter((id) => !inBar.has(id) && !keysOnly.includes(id));
    expect(missing).toEqual([]);
  });

  it('builds the context per situation (design 014 E2/E3)', () => {
    const file = { kind: 'file' };
    expect(contextKind({ resultTab: false, markedCount: 0, entry: file })).toBe('file');
    expect(contextKind({ resultTab: false, markedCount: 0, entry: { kind: 'directory' } })).toBe(
      'folder',
    );
    expect(contextKind({ resultTab: false, markedCount: 2, entry: file })).toBe('marked');
    expect(contextKind({ resultTab: false, markedCount: 0, entry: null })).toBe('empty');
    expect(contextKind({ resultTab: true, markedCount: 0, entry: file })).toBe('result');
    expect(contextMenuFor('marked', 3)[0]).toEqual({ heading: '3 marked entries' });
    expect(ids(contextMenuFor('folder')).has('OPEN_IN_NEW_TAB')).toBe(true);
    expect(ids(contextMenuFor('file')).has('OPEN_IN_NEW_TAB')).toBe(false);
  });

  it('resolves labels, badges, dimmed entries with hints and the tools submenu', () => {
    const items = resolveMenu(
      contextMenuFor('file'),
      source({ OPEN_PACK_DLG: 'unavailable', OPEN_RENAME_DLG: 'disabled' }, [
        tool('tool:edit'),
        tool('tool:diff', false),
      ]),
      'linux',
    );
    const copy = items.find((i) => i.id === 'OPEN_COPY_DLG')!;
    expect(copy).toMatchObject({ label: 'Copy…', shortcut: 'F5', disabled: false });
    expect(items.find((i) => i.id === 'OPEN_RENAME_DLG')).toMatchObject({
      disabled: true,
      hint: undefined,
    });
    const withTool = items.find((i) => i.label === 'Open with tool')!;
    expect(withTool.children?.map((c) => [c.id, c.disabled ?? false, c.shortcut ?? ''])).toEqual([
      ['tool:edit', false, 'Ctrl+E'],
      ['tool:diff', true, ''],
      [expect.stringMatching(/^-/), false, ''],
      ['OPEN_TOOLS_DLG', false, ''],
    ]);
    const marked = resolveMenu(
      contextMenuFor('marked', 1),
      source({ OPEN_PACK_DLG: 'unavailable' }),
      'linux',
    );
    expect(marked[0]).toMatchObject({ heading: true, label: '1 marked entry' });
    expect(marked.find((i) => i.id === 'OPEN_PACK_DLG')).toMatchObject({
      disabled: true,
      hint: 'Coming in prompt 016',
    });
  });

  it('drops separators that would stand first, last or doubled (no tools)', () => {
    const items = resolveMenu(
      ['-', 'RELOAD_DIR', '-', '@tools', '-', 'OPEN_COPY_DLG', '-'],
      source(),
      'linux',
    );
    expect(items.map((i) => (i.separator ? '-' : i.id))).toEqual([
      'RELOAD_DIR',
      '-',
      'OPEN_COPY_DLG',
    ]);
    const sub = resolveMenu(
      [{ sub: 'X', items: ['RELOAD_DIR'] }],
      source({ RELOAD_DIR: 'disabled' }),
      'linux',
    );
    expect(sub[0].disabled).toBe(true);
  });

  it('shows the app menu only on macOS and Quit/About only elsewhere', () => {
    const linux = resolveMenuBar(source(), 'linux');
    expect(linux.map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Go',
      'Tools',
      'Window',
      'Help',
    ]);
    expect(linux[0].items.some((i) => i.id === 'QUIT_APP')).toBe(true);
    const mac = toNativeSpec(source(), 'macos', false);
    expect(mac.menus.length).toBe(8);
    const flat = (nodes: readonly NativeMenuNode[]): NativeMenuNode[] =>
      nodes.flatMap((n) => (n.kind === 'submenu' ? flat(n.items) : [n]));
    const all = flat(mac.menus);
    expect(all.some((n) => n.kind === 'item' && n.id === 'QUIT_APP')).toBe(false);
    for (const name of ['about', 'quit', 'copy', 'paste', 'selectAll', 'minimize']) {
      expect(
        all.some((n) => n.kind === 'predefined' && n.name === name),
        name,
      ).toBe(true);
    }
    expect(
      flat(toNativeSpec(source(), 'linux', false).menus).some((n) => n.kind === 'predefined'),
    ).toBe(false);
  });

  it('native spec: keymap shortcuts as accelerators, everything off while a dialog is open', () => {
    const src = source({ OPEN_PACK_DLG: 'unavailable' }, [tool('tool:edit', true, 'Mod+E')]);
    const items = (blocked: boolean) => {
      const out: NativeMenuNode[] = [];
      const walk = (n: readonly NativeMenuNode[]) =>
        n.forEach((x) => (x.kind === 'submenu' ? walk(x.items) : out.push(x)));
      walk(toNativeSpec(src, 'macos', blocked).menus);
      return out.filter((n): n is Extract<NativeMenuNode, { kind: 'item' }> => n.kind === 'item');
    };
    const open = items(false);
    expect(open.find((n) => n.id === 'OPEN_COPY_DLG')).toMatchObject({
      accelerator: 'F5',
      enabled: true,
    });
    expect(open.find((n) => n.id === 'OPEN_COMMAND_PALETTE')?.accelerator).toBe('Mod+Shift+P');
    expect(open.find((n) => n.id === 'OPEN_PACK_DLG')?.enabled).toBe(false);
    expect(open.find((n) => n.id === 'tool:edit')).toMatchObject({ accelerator: 'Mod+E' });
    expect(items(true).every((n) => !n.enabled)).toBe(true);
  });
});
