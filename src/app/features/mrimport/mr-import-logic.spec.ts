import { describe, expect, it } from 'vitest';
import { FileType } from '../../core/config/config.models';
import { area, emptyScan } from '../../../testing/fake-mr-import-api';
import { DEFAULT_FORM } from '../search/find-form';
import {
  combine,
  defaultSelection,
  ImportState,
  planAll,
  planButtons,
  planColors,
  planFileTypes,
  planSearch,
  planSetup,
  planShortcuts,
  planTools,
} from './mr-import-logic';

const ft = (label: string, ...extensions: string[]): FileType => ({
  label,
  extensions,
  icon: null,
  color: null,
});

function state(over: Partial<ImportState> = {}): ImportState {
  return {
    platform: 'linux',
    override: {},
    buttons: {},
    fileTypes: null,
    builtInFileTypes: [{ ...ft('movies', '.mp4', '.mkv'), icon: 'fa-film', color: 'video' }],
    templates: [],
    builtInPresets: [{ label: 'Movies', extensions: ['.mkv', '.mp4'] }],
    toolIds: ['edit', 'vscode'],
    themeNames: ['Light', 'Dark', 'Norton', 'Mine'],
    ownThemeNames: ['Mine'],
    settings: { 'view.density': 'normal', 'behavior.spaceCalcSize': true },
    ...over,
  };
}

const sc = (id: string, shortcut: string) => ({ id, shortcut, source: `${shortcut} → ${id}` });

describe('mr import planning (design 026)', () => {
  it('shortcuts: new, already there, conflicts win, unknown and reserved are skipped', () => {
    const source = area(
      [
        sc('OPEN_COMMAND_PALETTE', 'Mod+F'),
        sc('CLONE_TAB', 'Mod+T'),
        sc('COPY_2_CLIPBOARD_FULLNAMES', 'Mod+K Mod+C'),
        sc('OPEN_FOO_DLG', 'F9'),
        sc('OPEN_SETUP_DLG', 'Mod+ArrowUp'),
        sc('OPEN_SETUP_DLG', 'Mod+Hyper'),
      ],
      { unchanged: 3, skipped: [{ item: 'cmd+alt+up → NAVIGATE_BACK', reason: 'never_fired' }] },
    );
    const p = planShortcuts(source, state({ override: { OPEN_SETUP_DLG: ['F12'] } }), 'merge');
    expect(p.count).toBe(2);
    expect(p.unchanged).toBe(4);
    expect(p.conflicts).toEqual([
      { kind: 'shortcut', shortcut: 'Mod+F', from: 'OPEN_FIND_DLG', to: 'OPEN_COMMAND_PALETTE' },
    ]);
    expect(p.skipped.map((s) => s.reason)).toEqual([
      'never_fired',
      'unknown_action',
      'reserved',
      'invalid_shortcut',
    ]);
    expect(p.apply?.keymap).toEqual({
      OPEN_SETUP_DLG: ['F12'],
      OPEN_FIND_DLG: ['Alt+F7'],
      OPEN_COMMAND_PALETTE: ['Mod+Shift+P', 'Mod+F'],
      COPY_2_CLIPBOARD_FULLNAMES: ['Mod+Alt+C', 'Mod+K Mod+C'],
    });
  });

  it('shortcuts: replace starts from the defaults; nothing new = nothing to write', () => {
    const source = area([sc('OPEN_SETUP_DLG', 'F12')]);
    const own = state({ override: { OPEN_SETUP_DLG: ['F12'], CLONE_TAB: [] } });
    expect(planShortcuts(source, own, 'merge').apply).toBeNull();
    const p = planShortcuts(source, own, 'replace');
    expect(p.apply?.keymap).toEqual({ OPEN_SETUP_DLG: ['Mod+,', 'F12'] });
    // the own entries that replace drops are listed
    expect(p.conflicts).toEqual([
      { kind: 'action', id: 'OPEN_SETUP_DLG' },
      { kind: 'action', id: 'CLONE_TAB' },
    ]);
    // macOS: Mod+Q is reserved by the app menu
    const mac = planShortcuts(
      area([sc('OPEN_SETUP_DLG', 'Mod+Q')]),
      state({ platform: 'macos' }),
      'merge',
    );
    expect(mac.skipped[0].reason).toBe('reserved');
    // a broken file: nothing planned, the error stays
    const broken = planShortcuts({ ...area([]), error: 'broken' }, state(), 'merge');
    expect(broken.error).toBe('broken');
    expect(broken.apply).toBeNull();
  });

  it('buttons: a set replaces the one of the same name; unknown ids are reported', () => {
    const source = area({
      shift: ['OPEN_CREATE_FILE_DLG', 'OPEN_COMMAND_PALETTE', 'NOT_AN_ACTION'],
      alt: ['OPEN_VIEW_DLG'],
    });
    const p = planButtons(
      source,
      state({ buttons: { shift: ['OPEN_COPY_DLG'], ctrl: [] } }),
      'merge',
    );
    expect(p.count).toBe(2);
    expect(p.conflicts).toEqual([{ kind: 'name', name: 'shift' }]);
    expect(p.skipped).toEqual([{ item: 'shift: NOT_AN_ACTION', reason: 'unknown_action' }]);
    expect(p.apply?.buttons).toEqual({
      shift: ['OPEN_CREATE_FILE_DLG', 'OPEN_COMMAND_PALETTE'],
      ctrl: [],
      alt: ['OPEN_VIEW_DLG'],
    });
    const r = planButtons(source, state({ buttons: { ctrl: [] } }), 'replace');
    expect(Object.keys(r.apply?.buttons ?? {})).toEqual(['shift', 'alt']);
    expect(r.conflicts).toEqual([{ kind: 'name', name: 'ctrl' }]);
    const same = planButtons(
      area({ alt: ['OPEN_VIEW_DLG'] }),
      state({ buttons: { alt: ['OPEN_VIEW_DLG'] } }),
      'merge',
    );
    expect(same.apply).toBeNull();
    expect(same.unchanged).toBe(1);
  });

  it('file types: merged by name keeping icon and colour, or the mr list as it is', () => {
    const source = area([ft('Movies', '.mkv', '.mp4'), ft('movies', '.avi'), ft('Comics', '.cbz')]);
    // first "Movies" equals the built-in one; the second replaces it (same name, other extensions)
    const p = planFileTypes(source, state(), 'merge');
    expect(p.count).toBe(2);
    expect(p.unchanged).toBe(1);
    expect(p.conflicts).toEqual([]); // the built-in list is no own data
    expect(p.apply?.fileTypes).toEqual([
      { label: 'movies', extensions: ['.avi'], icon: 'fa-film', color: 'video' },
      ft('Comics', '.cbz'),
    ]);
    const own = state({ fileTypes: [ft('Comics', '.cbr'), ft('Mine', '.x')] });
    const m = planFileTypes(area([ft('comics', '.cbz')]), own, 'merge');
    expect(m.conflicts).toEqual([{ kind: 'name', name: 'Comics' }]);
    expect(m.apply?.fileTypes?.map((c) => c.label)).toEqual(['comics', 'Mine']);
    const r = planFileTypes(area([ft('comics', '.cbz')]), own, 'replace');
    expect(r.apply?.fileTypes).toEqual([ft('comics', '.cbz')]);
    expect(r.conflicts.length).toBe(2);
  });

  it('search: own templates by name, built-in patterns are left out', () => {
    const source = area([
      { label: 'movies', extensions: ['.mp4', '.mkv'] },
      { label: 'Comics & covers', extensions: ['.cbz', '.jpg'] },
      { label: 'Bücher', extensions: ['.epub'] },
    ]);
    const old = { label: 'Bücher', form: { ...DEFAULT_FORM, name: '*.pdf' } };
    const p = planSearch(source, state({ templates: [old] }), 'merge');
    expect(p.count).toBe(2);
    expect(p.unchanged).toBe(1);
    expect(p.conflicts).toEqual([{ kind: 'name', name: 'Bücher' }]);
    const templates = p.apply?.settings?.['search.templates'] as {
      label: string;
      form: { name: string; nameMode: string; wholeName: boolean };
    }[];
    expect(templates.map((t) => t.label)).toEqual(['Bücher', 'Comics & covers']);
    expect(templates[1].form).toMatchObject({
      name: '*.cbz;*.jpg',
      nameMode: 'glob',
      wholeName: true,
    });
    const full = state({
      templates: Array.from({ length: 50 }, (_, i) => ({ label: `t${i}`, form: DEFAULT_FORM })),
    });
    expect(
      planSearch(area([{ label: 'x', extensions: ['.x'] }]), full, 'merge').skipped[0].reason,
    ).toBe('too_many');
    // review 026 #3: what does not fit into the setting (128 KiB) is skipped, own templates stay
    const big = Array.from({ length: 45 }, (_, i) => ({
      label: `p${i}`,
      extensions: Array.from({ length: 200 }, (_, j) => `.long-extension-${i}-${j}`),
    }));
    const tooBig = planSearch(area(big), state({ templates: [old] }), 'merge');
    const kept = tooBig.apply?.settings?.['search.templates'] as { label: string }[];
    expect(kept[0].label).toBe('Bücher');
    expect(new TextEncoder().encode(JSON.stringify(kept)).length).toBeLessThanOrEqual(131072);
    expect(tooBig.skipped.some((x) => x.reason === 'too_big')).toBe(true);
    expect(tooBig.count + tooBig.skipped.length).toBe(45);
    const replaced = planSearch(area([{ label: 'x', extensions: ['.x'] }]), full, 'replace');
    expect(replaced.count).toBe(1);
    expect(replaced.conflicts.length).toBe(50);
  });

  it('tools, colours and settings', () => {
    const tool = {
      id: 'vscode',
      label: 'VS Code',
      program: 'code',
      args: ['{file}'],
      perFile: true,
      fileLimit: 4,
    };
    const tools = area([tool, { ...tool, id: 'meld', label: 'Meld' }], { digest: 'd1' });
    // review 026 #1: only the chosen tools, with the digest of the preview (#2)
    const none = planTools(tools, state(), 'merge', '/old/assets', new Set());
    expect(none.count).toBe(0);
    expect(none.apply).toBeNull();
    const t = planTools(tools, state(), 'replace', '/old/assets', new Set(['vscode', 'meld']));
    expect(t.count).toBe(2);
    expect(t.conflicts).toEqual([{ kind: 'name', name: 'VS Code' }]);
    expect(t.apply).toEqual({
      tools: { from: '/old/assets', digest: 'd1', ids: ['vscode', 'meld'], replace: true },
    });
    const one = planTools(tools, state(), 'merge', '/old/assets', new Set(['meld']));
    expect(one.apply?.tools?.ids).toEqual(['meld']);
    expect(one.conflicts).toEqual([]);
    // review 026 #10: a tool shortcut that is taken or invalid is shown
    const keyed = area(
      [
        { ...tool, id: 'a', label: 'A', shortcut: 'Mod+F' },
        { ...tool, id: 'b', label: 'B', shortcut: 'Mod+Hyper' },
      ],
      { digest: 'd2' },
    );
    const k = planTools(keyed, state(), 'merge', '/old/assets', new Set(['a', 'b']));
    expect(k.conflicts).toEqual([
      { kind: 'toolShortcut', tool: 'A', shortcut: 'Mod+F', owner: 'OPEN_FIND_DLG' },
    ]);
    expect(k.skipped).toEqual([{ item: 'B: Mod+Hyper', reason: 'invalid_shortcut' }]);

    const c = planColors(
      area([
        { name: 'norton', path: '/old/norton.json' },
        { name: 'Mine', path: '/old/m.json' },
      ]),
      state(),
    );
    // "Mine" is an own scheme already: imported before, no second copy
    expect(c.count).toBe(1);
    expect(c.unchanged).toBe(1);
    expect(c.conflicts).toEqual([{ kind: 'name', name: 'norton' }]);
    expect(c.colorPaths).toEqual(['/old/norton.json']);
    expect(c.apply).toEqual({ backupThemes: true });

    const s = planSetup(
      area({ 'view.density': 'condensed', 'behavior.spaceCalcSize': true, 'no.such': 1 }),
      state(),
    );
    expect(s.count).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.apply).toEqual({ settings: { 'view.density': 'condensed' } });
    const changed = planSetup(
      area({ 'view.density': 'condensed' }),
      state({ settings: { 'view.density': 'spacious' } }),
    );
    expect(changed.conflicts).toEqual([{ kind: 'name', name: 'view.density' }]);
  });

  it('plans every area, checks all but tools and merges the settings of search and setup', () => {
    const scan = emptyScan({
      search: area([{ label: 'Own', extensions: ['.own'] }]),
      setup: area({ 'view.density': 'condensed' }),
      tools: area([
        { id: 'meld', label: 'Meld', program: 'meld', args: [], perFile: false, fileLimit: 10 },
      ]),
    });
    const plans = planAll(scan, state(), 'merge');
    expect(plans.map((p) => p.area)).toEqual([
      'shortcuts',
      'buttons',
      'fileTypes',
      'search',
      'tools',
      'colors',
      'setup',
    ]);
    expect(plans[0].file).toBeNull();
    const chosen = defaultSelection(plans);
    expect([...chosen]).toEqual(['search', 'setup']);
    const apply = combine(plans, chosen);
    expect(Object.keys(apply.settings ?? {}).sort()).toEqual(['search.templates', 'view.density']);
    expect(apply.tools).toBeUndefined();
    const withTools = planAll(scan, state(), 'merge', new Set(['meld']));
    expect(combine(withTools, new Set(['tools'])).tools?.from).toBe('/old/apps/fnf-api/src/assets');
  });
});
