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
    // the 013 mechanics on the base scheme `light` (019 default: the old light design)
    api.loaded = {
      file: {
        version: 1,
        selection: { mode: 'fixed', theme: 'light', light: 'light', dark: 'dark' },
        themes: [],
      },
      warning: null,
    };
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
    expect(radios.map((r) => r.value)).toEqual([
      'user-a',
      'classic-light',
      'classic-paper',
      'classic-bitbucket',
      'classic-cypress',
      'classic-blackboard',
      'classic-coffee',
      'classic-combat',
      'classic-norton',
      'light',
      'dark',
    ]);
    expect(el.textContent).toContain('All contrast checks pass');
    radios.find((r) => r.value === 'dark')!.click();
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
    expect(service.active().name).toBe('Modern light (2)');
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
    // the radio group keeps showing the scheme in the editor (review 013 #4)
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['light']);
    button('Reset').click();
    await settle();
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#f4f5f7');
  });

  it('keeps the alpha when a colour is picked and offers no picker for transparent (review 013 #7)', async () => {
    const { el, service, settle } = await open();
    const picker = (label: string) =>
      el.querySelector<HTMLInputElement>(`input[aria-label="${label}: pick a colour"]`)!;
    expect(picker('Marked background').disabled).toBe(true);
    const backdrop = picker('Dialog backdrop');
    expect(backdrop.disabled).toBe(false);
    backdrop.value = '#112233';
    backdrop.dispatchEvent(new Event('input'));
    await settle();
    expect(service.preview()?.tokens['--color-backdrop']).toBe('rgb(17 34 51 / 0.25)');
  });

  it('opens an imported scheme with contrast problems in the editor instead of selecting it (review 013 #2)', async () => {
    api.files.set('/t/pale.theme.json', {
      name: 'Pale',
      dark: false,
      tokens: { '--color-text': '#eeeeee' },
    });
    cursor = { path: '/t/pale.theme.json', kind: 'file' };
    const { el, service, button, settle } = await open();
    button('Import').click();
    await settle();
    expect(service.active().id).toBe('light');
    expect(el.querySelector<HTMLInputElement>('.row.head input[type="text"]')!.value).toBe('Pale');
    expect(el.textContent).toContain('not selected');
    expect(el.textContent).toContain('contrast problem');
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
