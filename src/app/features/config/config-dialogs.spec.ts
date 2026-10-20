import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ConfigApi } from '../../core/config/config-api';
import { BUILT_IN_FILE_TYPES, FILE_TYPES } from '../../core/file-icon/file-icon.service';
import { indexFileTypes } from '../../core/file-icon/file-types-logic';
import { MenuApi } from '../../core/menu/menu-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeConfigApi } from '../../../testing/fake-config-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeMenuApi } from '../../../testing/fake-menu-api';
import { ButtonConfigDialog } from './button-config-dialog';
import { registerConfigActions } from './config-actions';
import { FileTypesDialog } from './file-types-dialog';

function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('configuration dialogs (design 022)', () => {
  let api: FakeConfigApi;

  beforeEach(() => {
    api = new FakeConfigApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigApi, useValue: api },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    TestBed.inject(ActionService).platform.set('linux');
  });

  afterEach(() => FILE_TYPES.set(indexFileTypes(BUILT_IN_FILE_TYPES)));

  function button(el: HTMLElement, label: string): HTMLButtonElement {
    return [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    )!;
  }

  it('buttons: tabs per set, keyboard in the slot list, combobox, save', async () => {
    TestBed.inject(DialogService).show('button-config');
    const fixture = TestBed.createComponent(ButtonConfigDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = [...el.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      'Without modifier',
      'With Shift',
      'With Ctrl',
      'With Alt',
    ]);
    // ArrowRight: the Shift set
    key(tabs[0], 'ArrowRight');
    fixture.detectChanges();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    const options = () =>
      [...el.querySelectorAll<HTMLElement>('.slots [role="option"]')].map((o) =>
        o.querySelector('.grow')?.textContent?.trim(),
      );
    expect(options()).toEqual([
      'Create file…',
      'Copy…',
      'Rename…',
      'Create folder…',
      'Delete permanently…',
    ]);
    const list = el.querySelector<HTMLElement>('.slots')!;
    key(list, 'ArrowDown');
    key(list, 'ArrowDown', { altKey: true });
    fixture.detectChanges();
    expect(options()[2]).toBe('Copy…');
    expect(list.getAttribute('aria-activedescendant')).toBe('fnf-btncfg-slot-2');
    key(list, 'Delete');
    fixture.detectChanges();
    expect(options()).toHaveLength(4);
    expect(tabs[1].textContent).toContain('changed');
    // combobox: type, choose with ↓/Enter, Enter again adds after the cursor
    const combo = el.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    type(combo, 'view');
    fixture.detectChanges();
    expect(combo.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('.popup [role="option"]')?.textContent).toContain('View');
    key(combo, 'Enter');
    fixture.detectChanges();
    expect(combo.getAttribute('aria-expanded')).toBe('false');
    expect(combo.value).toBe('View');
    key(combo, 'Enter');
    fixture.detectChanges();
    expect(options()).toContain('View');
    // Escape closes the suggestions first, not the dialog
    type(combo, 'xyz-nothing');
    fixture.detectChanges();
    expect(el.querySelector('.popup')?.textContent).toContain('No action found');
    key(combo, 'Escape');
    fixture.detectChanges();
    expect(el.querySelector('.popup')).toBeNull();
    expect(TestBed.inject(DialogService).open()).toBe('button-config');
    button(el, 'Save').click();
    await fixture.whenStable();
    expect(Object.keys(api.savedButtons[0])).toEqual(['shift']);
    expect(api.savedButtons[0]['shift']).toContain('OPEN_VIEW_DLG');
    expect(TestBed.inject(DialogService).open()).toBeNull();
  });

  it('buttons: reset this set brings the built-in buttons back', async () => {
    api.buttons = { value: { sets: { default: ['OPEN_VIEW_DLG'] } }, warning: null };
    const store = TestBed.inject((await import('./button-config.store')).ButtonConfigStore);
    await store.init();
    const fixture = TestBed.createComponent(ButtonConfigDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.slots [role="option"]')).toHaveLength(1);
    expect(el.querySelectorAll('.preview-bar .pbtn')).toHaveLength(1);
    button(el, 'Reset this set').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.slots [role="option"]')).toHaveLength(5);
    button(el, 'Save').click();
    await fixture.whenStable();
    expect(api.savedButtons).toEqual([{}]);
  });

  it('file types: add a category, check it, save; reset to defaults', async () => {
    TestBed.inject(DialogService).show('file-types');
    const fixture = TestBed.createComponent(FileTypesDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => [...el.querySelectorAll<HTMLElement>('.listbox [role="option"]')];
    expect(rows()).toHaveLength(11);
    expect(rows()[0].textContent).toContain('Movies');
    button(el, 'Add').click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(12);
    const name = el.querySelector<HTMLInputElement>('input.name')!;
    expect(name.value).toBe('New type');
    type(name, 'audio');
    type(el.querySelector('textarea')!, '*.CBZ, cbr a/b');
    fixture.detectChanges();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#fnf-ft-problem')?.textContent).toContain(
      'Another category has this name.',
    );
    expect(el.querySelector('#fnf-ft-problem')?.textContent).toContain('Not an extension: a/b');
    button(el, 'Save').click();
    fixture.detectChanges();
    expect(api.savedFileTypes).toEqual([]);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Correct the marked');
    type(name, 'Comics');
    type(el.querySelector('textarea')!, '*.CBZ, cbr');
    const icon = el.querySelectorAll<HTMLSelectElement>('select')[0];
    icon.value = 'fa-book';
    icon.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(rows()[1].textContent).toContain('Comics');
    expect(rows()[1].textContent).toContain('2 extensions');
    // Alt+↑ moves the new category to the top
    key(el.querySelector('.listbox')!, 'ArrowUp', { altKey: true });
    fixture.detectChanges();
    expect(rows()[0].textContent).toContain('Comics');
    button(el, 'Save').click();
    await fixture.whenStable();
    const saved = api.savedFileTypes[0]!;
    expect(saved[0]).toEqual({
      label: 'Comics',
      extensions: ['.cbz', '.cbr'],
      icon: 'fa-book',
      color: null,
    });
    expect(saved).toHaveLength(12);
    expect(TestBed.inject(DialogService).open()).toBeNull();
    // reset: the built-in list again, saved as "no user file"
    const again = TestBed.createComponent(FileTypesDialog);
    again.detectChanges();
    const el2 = again.nativeElement as HTMLElement;
    button(el2, 'Reset to defaults').click();
    button(el2, 'Save').click();
    await again.whenStable();
    expect(api.savedFileTypes.at(-1)).toBeNull();
  });

  it('actions: dialogs and full screen (J14)', async () => {
    const menu = new FakeMenuApi();
    const actions = TestBed.inject(ActionService);
    const dialogs = TestBed.inject(DialogService);
    const off = registerConfigActions(actions, dialogs, menu as unknown as MenuApi);
    expect(actions.state('TOGGLE_FULLSCREEN')).toBe('ready');
    await actions.run('OPEN_BUTTON_CONFIG_DLG');
    expect(dialogs.open()).toBe('button-config');
    await actions.run('OPEN_FILETYPE_CONFIG_DLG');
    expect(dialogs.open()).toBe('file-types');
    await actions.run('TOGGLE_FULLSCREEN');
    expect(menu.fullscreen).toBe(true);
    await actions.run('TOGGLE_FULLSCREEN');
    expect(menu.fullscreen).toBe(false);
    expect(actions.shortcuts('TOGGLE_FULLSCREEN')).toEqual(['F11']);
    off();
  });
});
