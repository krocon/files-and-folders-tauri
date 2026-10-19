import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ThemeApi } from '../../core/theme/theme-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { ThemeService } from '../../core/theme/theme.service';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { CommandPalette } from './command-palette';

describe('CommandPalette', () => {
  async function render() {
    TestBed.configureTestingModule({
      imports: [CommandPalette],
      providers: [
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
      ],
    });
    const actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    let reloaded = 0;
    actions.register({ RELOAD_DIR: { run: () => void reloaded++ } });
    const dialogs = TestBed.inject(DialogService);
    dialogs.show('palette');
    const fixture = TestBed.createComponent(CommandPalette);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input')!;
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const key = (k: string) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      fixture.detectChanges();
    };
    return { el, input, type, key, dialogs, reloaded: () => reloaded };
  }

  it('is a combobox with a listbox of all actions and shortcuts', async () => {
    const { el, input } = await render();
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(input.getAttribute('role')).toBe('combobox');
    const options = el.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(20);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
  });

  it('lists the colour schemes and switches to one (design 013 E3)', async () => {
    const { el, type, key } = await render();
    type('colour scheme norton');
    const first = el.querySelector('[role="option"]')!;
    expect(first.textContent).toContain('Colour scheme: Norton');
    key('Enter');
    await new Promise((r) => setTimeout(r));
    expect(TestBed.inject(ThemeService).active().id).toBe('classic-norton');
  });

  it('filters fuzzily, shows the shortcut and runs with Enter', async () => {
    const { el, type, key, dialogs, reloaded } = await render();
    type('reload');
    const first = el.querySelector('[role="option"]')!;
    expect(first.textContent).toContain('Reload');
    expect(first.querySelector('kbd')?.textContent).toBe('Ctrl+R');
    key('Enter');
    expect(dialogs.open()).toBeNull();
    await new Promise((r) => setTimeout(r));
    expect(reloaded()).toBe(1);
  });

  it('marks actions of later prompts and moves with the arrow keys', async () => {
    const { el, type, key, input } = await render();
    type('copy');
    const copy = [...el.querySelectorAll('[role="option"]')].find((o) =>
      o.textContent?.includes('Copy…'),
    )!;
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(copy.textContent).toContain('prompt 006');
    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-1$/);
  });

  it('closes with Escape', async () => {
    const { input, dialogs } = await render();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialogs.open()).toBeNull();
  });
});
