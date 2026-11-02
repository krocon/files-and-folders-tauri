import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ActionService } from '../../core/actions/action.service';
import { ThemeApi } from '../../core/theme/theme-api';
import { ThemeService } from '../../core/theme/theme.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { matchesFilter, thumbStyle } from './theme-picker-logic';
import { ThemePicker } from './theme-picker';

describe('colour scheme picker (design 070)', () => {
  let theme: ThemeService;
  let dialogs: DialogService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    theme = TestBed.inject(ThemeService);
    dialogs = TestBed.inject(DialogService);
    await theme.select('light');
    dialogs.show('theme-picker');
  });

  async function render() {
    const fixture = TestBed.createComponent(ThemePicker);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    const el = fixture.nativeElement as HTMLElement;
    const card = (id: string) => el.querySelector<HTMLElement>(`[data-id="${id}"]`);
    const key = (k: string) =>
      el
        .querySelector('[role="listbox"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    return { fixture, el, card, key };
  }

  it('one card per scheme, „Follow the system“ first, the active one chosen and focused', async () => {
    const { el, card } = await render();
    const ids = [...el.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (c) => c.dataset['id'],
    );
    expect(ids[0]).toBe('system');
    expect(ids).toHaveLength(theme.themes().length + 1);
    expect(card('light')!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(card('light'));
    // every card has a thumbnail painted from its tokens
    expect(card('dark')!.querySelector('app-theme-thumb')).not.toBeNull();
    expect(card('system')!.querySelectorAll('app-theme-thumb')).toHaveLength(2);
  });

  it('arrow keys try a scheme at once, Enter keeps it', async () => {
    const { fixture, key } = await render();
    key('ArrowRight');
    fixture.detectChanges();
    const tried = theme.preview();
    expect(tried).not.toBeNull();
    expect(theme.applied().name).toBe(tried!.name);
    expect(theme.selection().theme).toBe('light'); // not kept yet
    key('Enter');
    await new Promise((r) => setTimeout(r));
    expect(theme.preview()).toBeNull();
    expect(theme.active().name).toBe(tried!.name);
    expect(dialogs.open()).toBeNull();
  });

  it('Esc / Cancel goes back to the scheme from before', async () => {
    const { fixture, key, el } = await render();
    key('End');
    fixture.detectChanges();
    expect(theme.preview()).not.toBeNull();
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Cancel')!
      .click();
    expect(theme.preview()).toBeNull();
    expect(theme.active().id).toBe('light');
    expect(dialogs.open()).toBeNull();
  });

  it('the filter narrows the cards (name, light/dark), with a count and a hint for none', async () => {
    const { fixture, el } = await render();
    const input = el.querySelector<HTMLInputElement>('#fnf-theme-filter')!;
    input.value = 'rainglow';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const names = [...el.querySelectorAll('[role="option"] .name')].map((n) => n.textContent);
    expect(names).toHaveLength(5);
    expect(el.querySelector('.count')!.textContent).toBe('5 schemes');
    input.value = 'nothing-like-this';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('.none')).not.toBeNull();
  });

  it('pure helpers: filter words and thumbnail colours (only #rrggbb gets in)', () => {
    const words = { light: 'hell', dark: 'dunkel', group: 'Eingebaut' };
    const card = { id: 'x', name: 'Matrix', dark: true, group: 'builtIn' as const };
    expect(matchesFilter(card, 'mat dark', words)).toBe(true);
    expect(matchesFilter(card, 'dunkel eingebaut', words)).toBe(true);
    expect(matchesFilter(card, 'light', words)).toBe(false);
    const style = thumbStyle({
      dark: true,
      tokens: { '--color-list-bg': 'url(evil)', '--color-cursor-bg': '#123456' },
    });
    expect(style['--thumb-cursor-bg']).toBe('#123456');
    expect(Object.values(style).every((v) => /^#[0-9a-f]{6}$/.test(v))).toBe(true);
  });

  it('the menu bar lists the schemes as radio entries; choosing one selects it', async () => {
    const actions = TestBed.inject(ActionService);
    TestBed.tick();
    const choices = actions.themeChoices();
    expect(choices[0].id).toBe('theme:system');
    expect(choices.find((c) => c.id === 'theme:light')!.checked).toBe(true);
    await actions.runAny('theme:dark');
    expect(theme.active().id).toBe('dark');
  });
});
