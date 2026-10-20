import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { ActionService } from '../actions/action.service';
import { KeymapApi } from '../actions/keymap-api';
// @ts-expect-error -- node types are not part of the app's tsconfig; vitest runs in node
import { readFileSync } from 'node:fs';
import { CLASSIC_ADJUSTMENTS, CLASSIC_THEMES, DARK, LIGHT } from './builtin-themes';
import { LegacyThemeFileContent, ThemeApi, ThemeFileContent } from './theme-api';
import { completeTokens } from './theme-logic';
import { ThemeService } from './theme.service';

/** A controllable `prefers-color-scheme: dark` query. */
function fakeMedia(dark: boolean) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches: dark,
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.push(l),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    set(next: boolean) {
      mql.matches = next;
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
    },
  };
}

const root = () => document.documentElement;

describe('ThemeService', () => {
  let api: FakeThemeApi;
  let media: ReturnType<typeof fakeMedia>;

  function create(): ThemeService {
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeApi, useValue: api },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    return TestBed.inject(ThemeService);
  }

  beforeEach(() => {
    api = new FakeThemeApi();
    // most tests check the 013 mechanics with the base pair light/dark (019 defaults: own test)
    api.loaded = {
      file: {
        version: 1,
        selection: { mode: 'system', theme: 'light', light: 'light', dark: 'dark' },
        themes: [],
      },
      warning: null,
    };
    media = fakeMedia(false);
  });

  it('starts with the old light design and follows the system with light/coffee (019)', async () => {
    api = new FakeThemeApi();
    const s = create();
    await s.init();
    expect(s.selection()).toEqual({
      mode: 'fixed',
      theme: 'classic-light',
      light: 'classic-light',
      dark: 'classic-coffee',
    });
    expect(s.active().id).toBe('classic-light');
    await s.followSystem();
    media.set(true);
    expect(s.active().id).toBe('classic-coffee');
    TestBed.tick();
    expect(root().dataset['theme']).toBe('dark');
    expect(root().style.getPropertyValue('--color-list-bg')).toBe('#1a1a1a');
  });

  it('imports an old file as the same scheme as the shipped design (019)', async () => {
    api.files.set(
      '/t/coffee.json',
      JSON.parse(readFileSync('docs/legacy-themes/coffee.json', 'utf8')),
    );
    const s = create();
    await s.init();
    const r = await s.importFile('/t/coffee.json');
    const shipped = CLASSIC_THEMES.find((t) => t.id === 'classic-coffee')!;
    expect(r).toMatchObject({ legacy: true, dark: true, selected: true, unknown: [] });
    expect(r.adjusted).toBe(CLASSIC_ADJUSTMENTS.get('classic-coffee')!.length);
    expect(s.active().id).toBe(r.id);
    expect(s.applied().tokens).toEqual(completeTokens(shipped, LIGHT, DARK));

    await s.exportLegacy('/t', s.applied());
    const out = api.exported[0].theme as LegacyThemeFileContent;
    expect(out.name).toBe('coffee');
    expect(Object.keys(out.colors)).toHaveLength(76);
    expect(out.colors['--fnf-table-bg-color']).toBe('#1a1a1a');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    root().removeAttribute('style');
    delete root().dataset['theme'];
  });

  it('follows the system live and sets tokens, data-theme and color-scheme on <html>', async () => {
    const s = create();
    await s.init();
    TestBed.tick();
    expect(s.active().id).toBe('light');
    expect(root().dataset['theme']).toBe('light');
    expect(root().style.getPropertyValue('--color-bg')).toBe(LIGHT.tokens['--color-bg']);
    media.set(true);
    TestBed.tick();
    expect(s.active().id).toBe('dark');
    expect(root().dataset['theme']).toBe('dark');
    expect(root().style.colorScheme).toBe('dark');
    expect(root().style.getPropertyValue('--color-bg')).toBe(DARK.tokens['--color-bg']);
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      DARK.tokens['--color-bg'],
    );
  });

  it('selects a fixed scheme, saves it and restores it after a restart', async () => {
    const s = create();
    await s.init();
    await s.select('dark');
    expect(api.saved.at(-1)?.selection).toMatchObject({ mode: 'fixed', theme: 'dark' });
    TestBed.resetTestingModule();
    const again = create();
    await again.init();
    expect(again.active().id).toBe('dark');
    await again.followSystem();
    expect(again.active().id).toBe('light');
  });

  it('saves an own scheme (own first in the list), replaces it and deletes it', async () => {
    const s = create();
    await s.init();
    const id = await s.saveTheme({
      name: 'Mein Schema',
      dark: true,
      tokens: { ...DARK.tokens, '--color-bg': '#000000' },
    });
    expect(id).toBe('user-mein-schema');
    expect(s.themes().map((t) => t.id)).toEqual([
      'user-mein-schema',
      ...CLASSIC_THEMES.map((t) => t.id),
      'light',
      'dark',
      'crimson',
    ]);
    expect(s.active().id).toBe(id);
    TestBed.tick();
    expect(root().style.getPropertyValue('--color-bg')).toBe('#000000');
    expect(api.saved.at(-1)?.themes[0]).toMatchObject({ id, name: 'Mein Schema', dark: true });
    expect('builtIn' in api.saved.at(-1)!.themes[0]).toBe(false);

    await s.saveTheme({ name: 'Mein Schema', dark: true, tokens: { '--color-bg': '#111111' } }, id);
    expect(s.userThemes()).toHaveLength(1);
    // a copy of a built-in scheme gets a unique name
    const copy = await s.saveTheme({ name: 'Modern dark', dark: true, tokens: {} }, 'dark');
    expect(s.find(copy)?.name).toBe('Modern dark (2)');

    await s.deleteTheme(copy);
    await s.deleteTheme(id);
    expect(s.userThemes()).toEqual([]);
    expect(s.selection()).toMatchObject({ mode: 'system', theme: 'classic-light' });
    await s.deleteTheme('light'); // built-in: ignored
    expect(s.find('light')).toBeDefined();
  });

  it('falls back to the default when the selected scheme is gone, completes missing tokens', async () => {
    api.loaded = {
      file: {
        version: 1,
        selection: { mode: 'system', theme: 'light', light: 'gone', dark: 'user-x' },
        themes: [{ id: 'user-x', name: 'X', dark: true, tokens: { '--color-bg': '#010101' } }],
      },
      warning: 'The colour scheme file was invalid',
    };
    const s = create();
    await s.init();
    expect(s.active().id).toBe('classic-light');
    expect(TestBed.inject(ActionService).messages()).toContain(
      'The colour scheme file was invalid',
    );
    media.set(true);
    expect(s.active().id).toBe('user-x');
    expect(s.applied().tokens['--color-text']).toBe(DARK.tokens['--color-text']);
  });

  it('previews a draft and drops it again', async () => {
    const s = create();
    await s.init();
    s.preview.set({ name: 'p', dark: true, tokens: { '--color-bg': '#123456' } });
    TestBed.tick();
    expect(root().style.getPropertyValue('--color-bg')).toBe('#123456');
    expect(root().dataset['theme']).toBe('dark');
    s.preview.set(null);
    TestBed.tick();
    expect(root().style.getPropertyValue('--color-bg')).toBe(LIGHT.tokens['--color-bg']);
  });

  it('applies only catalog tokens with a value of their kind (review 013 #1)', async () => {
    const s = create();
    await s.init();
    root().style.setProperty('--focus-ring-width', '2px');
    s.preview.set({
      name: 'p',
      dark: false,
      tokens: {
        '--color-bg': '#123456',
        '--focus-ring-width': '0',
        '--font-size-md': '0px',
        '--font-size-list': '1px',
        '--fnf-table-bg-color': '#000000',
      },
    });
    TestBed.tick();
    expect(root().style.getPropertyValue('--color-bg')).toBe('#123456');
    expect(root().style.getPropertyValue('--focus-ring-width')).toBe('2px');
    expect(root().style.getPropertyValue('--font-size-md')).toBe('');
    expect(root().style.getPropertyValue('--font-size-list')).toBe(
      LIGHT.tokens['--font-size-list'],
    );
    expect(root().style.getPropertyValue('--fnf-table-bg-color')).toBe('');
  });

  it('stores only what differs from the base scheme, so fixes of the base arrive (review 013 #11)', async () => {
    const s = create();
    await s.init();
    await s.saveTheme({
      name: 'Mine',
      dark: true,
      tokens: { ...DARK.tokens, '--color-bg': '#000000' },
    });
    expect(api.saved.at(-1)?.themes[0].tokens).toEqual({ '--color-bg': '#000000' });
    expect(s.applied().tokens['--color-text']).toBe(DARK.tokens['--color-text']);
  });

  it('imports a scheme with contrast problems without selecting it (review 013 #2)', async () => {
    api.files.set('/t/bad.json', {
      name: 'Pale',
      dark: false,
      tokens: { '--color-text': '#eeeeee' },
    });
    const s = create();
    await s.init();
    const r = await s.importFile('/t/bad.json');
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.selected).toBe(false);
    expect(s.find(r.id)?.name).toBe('Pale');
    expect(s.active().id).toBe('light');
    expect(api.saved.at(-1)?.themes.map((t) => t.name)).toEqual(['Pale']);
  });

  it('colours the native title bar like the tab bar (header background), once per change', async () => {
    const s = create();
    await s.init();
    TestBed.tick();
    expect(api.chrome.at(-1)).toEqual({ color: '#eef0f3', dark: false });
    await s.select('crimson');
    TestBed.tick();
    expect(api.chrome.at(-1)).toEqual({ color: '#212127', dark: true });
    const calls = api.chrome.length;
    await s.select('crimson');
    TestBed.tick();
    expect(api.chrome.length).toBe(calls);
  });

  it('cycles with next()', async () => {
    const s = create();
    await s.init();
    await s.next();
    expect(s.active().id).toBe('dark');
    await s.next();
    expect(s.active().id).toBe('crimson');
    await s.next();
    expect(s.active().id).toBe('classic-light');
    await s.next();
    expect(s.active().id).toBe('classic-paper');
  });

  it('imports own and old files and exports complete schemes', async () => {
    api.files.set('/t/old.json', {
      name: 'coffee',
      colors: { '--fnf-table-bg-color': '#1a1a1a', '--fnf-x': 'url(evil)' },
    });
    api.files.set('/t/bad.json', { foo: 1 });
    const s = create();
    await s.init();
    const r = await s.importFile('/t/old.json');
    expect(r).toMatchObject({
      name: 'coffee',
      dark: true,
      legacy: true,
      dropped: ['--fnf-x'],
      selected: true,
    });
    expect(s.active().id).toBe(r.id);
    await expect(s.importFile('/t/bad.json')).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(s.importFile('/t/missing.json')).rejects.toMatchObject({ code: 'not_found' });

    const path = await s.exportTheme('/t', {
      name: 'Mine',
      dark: false,
      tokens: { '--x': '#fff' },
    });
    expect(path).toBe('/t/Mine.theme.json');
    const out = api.exported[0].theme as ThemeFileContent;
    expect(out.tokens['--x']).toBe('#fff');
    expect(out.tokens['--color-bg']).toBe(LIGHT.tokens['--color-bg']);
  });

  it('reports a failed save', async () => {
    const s = create();
    await s.init();
    api.saveError = { code: 'io', message: 'disk on fire', path: null };
    await s.select('dark');
    expect(TestBed.inject(ActionService).messages().join()).toContain('disk on fire');
  });
});
