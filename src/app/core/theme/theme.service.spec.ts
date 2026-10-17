import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { ActionService } from '../actions/action.service';
import { KeymapApi } from '../actions/keymap-api';
import { DARK, LIGHT } from './builtin-themes';
import { ThemeApi } from './theme-api';
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
    media = fakeMedia(false);
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
    expect(s.themes().map((t) => t.id)).toEqual(['user-mein-schema', 'light', 'dark']);
    expect(s.active().id).toBe(id);
    TestBed.tick();
    expect(root().style.getPropertyValue('--color-bg')).toBe('#000000');
    expect(api.saved.at(-1)?.themes[0]).toMatchObject({ id, name: 'Mein Schema', dark: true });
    expect('builtIn' in api.saved.at(-1)!.themes[0]).toBe(false);

    await s.saveTheme({ name: 'Mein Schema', dark: true, tokens: { '--color-bg': '#111111' } }, id);
    expect(s.userThemes()).toHaveLength(1);
    // a copy of a built-in scheme gets a unique name
    const copy = await s.saveTheme({ name: 'Dark', dark: true, tokens: {} }, 'dark');
    expect(s.find(copy)?.name).toBe('Dark (2)');

    await s.deleteTheme(copy);
    await s.deleteTheme(id);
    expect(s.userThemes()).toEqual([]);
    expect(s.selection()).toMatchObject({ mode: 'system', theme: 'light' });
    await s.deleteTheme('light'); // built-in: ignored
    expect(s.find('light')).toBeDefined();
  });

  it('falls back to light/dark when the selected scheme is gone, completes missing tokens', async () => {
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
    expect(s.active().id).toBe('light');
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

  it('cycles with next()', async () => {
    const s = create();
    await s.init();
    await s.next();
    expect(s.active().id).toBe('dark');
    await s.next();
    expect(s.active().id).toBe('light');
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
    expect(r).toMatchObject({ name: 'coffee', dark: true, legacy: true, dropped: ['--fnf-x'] });
    expect(s.active().id).toBe(r.id);
    await expect(s.importFile('/t/bad.json')).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(s.importFile('/t/missing.json')).rejects.toMatchObject({ code: 'not_found' });

    const path = await s.exportTheme('/t', {
      name: 'Mine',
      dark: false,
      tokens: { '--x': '#fff' },
    });
    expect(path).toBe('/t/Mine.theme.json');
    const out = api.exported[0].theme;
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
