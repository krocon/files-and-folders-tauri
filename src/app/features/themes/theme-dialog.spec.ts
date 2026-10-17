import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ThemeApi } from '../../core/theme/theme-api';
import { ThemeService } from '../../core/theme/theme.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { ThemeDialog } from './theme-dialog';

describe('ThemeDialog', () => {
  let api: FakeThemeApi;
  let cursor: { path: string; kind: string } | null;
  const refresh = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    api = new FakeThemeApi();
    cursor = null;
    const ws = {
      source: () => 'left',
      panel: () => ({ store: { cursorEntry: () => cursor, path: () => '/t', refresh } }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeApi, useValue: api },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: WorkspaceStore, useValue: ws },
      ],
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('style');
  });

  async function open() {
    const service = TestBed.inject(ThemeService);
    await service.init();
    const fixture = TestBed.createComponent(ThemeDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === label,
      )!;
    const valueInput = (label: string) =>
      el.querySelector<HTMLInputElement>(`input[aria-label="${label}: value"]`)!;
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r));
      }
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, service, button, valueInput, settle };
  }

  it('lists the schemes (own first) and switches live by picking one', async () => {
    api.loaded = {
      file: {
        version: 1,
        selection: { mode: 'fixed', theme: 'light', light: 'light', dark: 'dark' },
        themes: [{ id: 'user-a', name: 'Aa', dark: false, tokens: {} }],
      },
      warning: null,
    };
    const { el, service, settle } = await open();
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['user-a', 'light', 'dark']);
    expect(el.textContent).toContain('All contrast checks pass');
    radios[2].click();
    await settle();
    expect(service.active().id).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('previews an edit, warns about contrast, refuses unsafe values and saves as a new scheme', async () => {
    const { el, service, button, valueInput, settle } = await open();
    const input = valueInput('Cursor background');
    input.value = '#8899aa';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(document.documentElement.style.getPropertyValue('--color-cursor-bg')).toBe('#8899aa');
    expect(el.textContent).toContain('contrast problem');
    expect(el.textContent).toContain('Cursor:');
    expect(button('Save').disabled).toBe(true); // built-in: read-only

    const bad = valueInput('Text');
    bad.value = 'red; background: url(x)';
    bad.dispatchEvent(new Event('change'));
    await settle();
    expect(bad.getAttribute('aria-invalid')).toBe('true');
    expect(button('Save as new').disabled).toBe(true);
    bad.value = '#000000';
    bad.dispatchEvent(new Event('change'));
    await settle();

    button('Save as new').click();
    await settle();
    expect(service.userThemes()).toHaveLength(1);
    expect(service.active().name).toBe('Light (2)');
    expect(api.saved.at(-1)?.themes[0].tokens['--color-cursor-bg']).toBe('#8899aa');
    expect(button('Delete').disabled).toBe(false);

    button('Delete').click();
    await settle();
    expect(service.userThemes()).toEqual([]);
  });

  it('resets unsaved changes and blocks switching while dirty', async () => {
    const { el, service, button, valueInput, settle } = await open();
    const input = valueInput('Window background');
    input.value = '#000000';
    input.dispatchEvent(new Event('change'));
    await settle();
    el.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();
    await settle();
    expect(service.active().id).toBe('light');
    expect(el.textContent).toContain('Save or reset your changes first');
    button('Reset').click();
    await settle();
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#f4f5f7');
  });

  it('imports the file under the cursor and exports into the active folder', async () => {
    api.files.set('/t/x.theme.json', { name: 'X', dark: true, tokens: { '--color-bg': '#000' } });
    const { el, service, button, settle } = await open();
    button('Import').click();
    await settle();
    expect(el.textContent).toContain('Put the cursor on a scheme file');
    cursor = { path: '/t/x.theme.json', kind: 'file' };
    button('Import').click();
    await settle();
    expect(service.active().name).toBe('X');
    expect(el.textContent).toContain('Imported “X”');

    button('Export').click();
    await settle();
    expect(api.exported[0]).toMatchObject({ dir: '/t', name: 'X' });
    expect(el.textContent).toContain('Exported to /t/X.theme.json');
    expect(refresh).toHaveBeenCalled();
  });
});
