import { TestBed } from '@angular/core/testing';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { ActionService } from './action.service';
import { KeymapApi } from './keymap-api';
import { CHORD_TIMEOUT_MS, DispatchEvent, KeyboardDispatcher } from './keyboard-dispatcher';

describe('KeyboardDispatcher', () => {
  let actions: ActionService;
  let keys: KeyboardDispatcher;
  let ran: string[];
  let list: HTMLElement;
  let button: HTMLButtonElement;
  let input: HTMLInputElement;

  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: KeymapApi, useValue: new FakeKeymapApi() }],
    });
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    keys = TestBed.inject(KeyboardDispatcher);
    ran = [];
    const handler = (id: string) => ({ run: () => void ran.push(id) });
    actions.register({
      TOGGLE_PANEL: handler('TOGGLE_PANEL'),
      TOGGLE_MARK_AND_ADVANCE: handler('TOGGLE_MARK_AND_ADVANCE'),
      OPEN_COMMAND_PALETTE: handler('OPEN_COMMAND_PALETTE'),
      MARK_DOWN: handler('MARK_DOWN'),
      CLOSE_TAB: handler('CLOSE_TAB'),
      OPEN_TASK_DLG: handler('OPEN_TASK_DLG'),
      OPEN_COPY_DLG: handler('OPEN_COPY_DLG'),
    });
    document.body.innerHTML =
      '<app-file-list><div tabindex="0"></div></app-file-list><button>b</button><input>';
    list = document.querySelector('app-file-list div')!;
    button = document.querySelector('button')!;
    input = document.querySelector('input')!;
  });

  function press(
    key: string,
    code: string,
    target: EventTarget | null,
    mods: Partial<DispatchEvent> = {},
  ): { id: string | null; prevented: boolean } {
    let prevented = false;
    const evt: DispatchEvent = {
      key,
      code,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      target,
      preventDefault: () => (prevented = true),
      stopPropagation: () => undefined,
      ...mods,
    };
    return { id: keys.handle(evt), prevented };
  }

  it('runs the bound action and stops the default', async () => {
    const r = press(' ', 'Space', list);
    expect(r).toEqual({ id: 'TOGGLE_MARK_AND_ADVANCE', prevented: true });
    await Promise.resolve();
    expect(ran).toEqual(['TOGGLE_MARK_AND_ADVANCE']);
  });

  it('leaves plain keys to buttons and other controls, but not shortcuts with modifiers', () => {
    expect(press(' ', 'Space', button).id).toBeNull();
    expect(press('Tab', 'Tab', button).id).toBeNull();
    expect(press('p', 'KeyP', button, { ctrlKey: true, shiftKey: true }).id).toBe(
      'OPEN_COMMAND_PALETTE',
    );
    expect(press('F5', 'F5', button).id).toBe('OPEN_COPY_DLG');
  });

  it('only lets function keys through in text inputs', () => {
    expect(press('p', 'KeyP', input, { ctrlKey: true, shiftKey: true }).id).toBeNull();
    expect(press('F5', 'F5', input).id).toBe('OPEN_COPY_DLG');
  });

  it('keys inside an open menu or the menu bar belong to the menu (review 014 #3)', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="menubar"><button role="menuitem" id="top">File</button></div>' +
        '<div role="menu"><div role="menuitem" tabindex="-1" id="item">Copy</div></div>',
    );
    const top = document.getElementById('top')!;
    const item = document.getElementById('item')!;
    expect(press('p', 'KeyP', item, { ctrlKey: true, shiftKey: true })).toEqual({
      id: null,
      prevented: true,
    });
    expect(press('F5', 'F5', item).id).toBeNull();
    expect(press('F5', 'F5', top).id).toBeNull();
    expect(ran).toEqual([]);
    expect(actions.handledByKeyRecently('OPEN_COPY_DLG')).toBe(true);
    // unbound keys stay with the menu (no preventDefault)
    expect(press('F12', 'F12', item, { altKey: true, shiftKey: true }).prevented).toBe(false);
  });

  it('a shortcut held back in a text input is noted, so its native menu echo is dropped (review 014 #1)', () => {
    expect(press('a', 'KeyA', input, { ctrlKey: true }).id).toBeNull();
    expect(actions.handledByKeyRecently('SELECT_ALL')).toBe(true);
    expect(actions.ranByKeyRecently('SELECT_ALL')).toBe(false);
    // Shift+F10 outside the list: the tab bar keeps it, the native accelerator must not open the menu
    expect(press('F10', 'F10', button, { shiftKey: true }).id).toBeNull();
    expect(actions.handledByKeyRecently('OPEN_CONTEXT_MENU')).toBe(true);
  });

  it('does nothing while a dialog is open', () => {
    TestBed.inject(DialogService).show('palette');
    expect(press('F5', 'F5', list).id).toBeNull();
  });

  it('leaves navigation keys to the table', () => {
    const r = press('ArrowDown', 'ArrowDown', list);
    expect(r).toEqual({ id: null, prevented: false });
    expect(press('ArrowDown', 'ArrowDown', list, { shiftKey: true }).id).toBe('MARK_DOWN');
  });

  it('ignores auto-repeat except for repeatable actions', () => {
    expect(press('w', 'KeyW', list, { ctrlKey: true, repeat: true })).toEqual({
      id: null,
      prevented: true,
    });
    expect(press('ArrowDown', 'ArrowDown', list, { shiftKey: true, repeat: true }).id).toBe(
      'MARK_DOWN',
    );
  });

  it('handles chords (macOS Ctrl+K F6) with a timeout', () => {
    vi.useFakeTimers();
    actions.platform.set('macos');
    expect(press('k', 'KeyK', list, { ctrlKey: true })).toEqual({ id: null, prevented: true });
    expect(press('F6', 'F6', list).id).toBe('OPEN_TASK_DLG');
    press('k', 'KeyK', list, { ctrlKey: true });
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS + 1);
    expect(press('F6', 'F6', list).id).toBe('OPEN_MOVE_DLG'); // F6 alone again
    vi.useRealTimers();
  });

  it('tracks held modifiers for the button bar', () => {
    const detach = keys.attach(document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    expect(keys.held().shift).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(keys.held().shift).toBe(false);
    detach();
  });

  it('opens the context menu with Shift+F10 only in the list (tabs keep their own, design 014 E4)', () => {
    actions.register({ OPEN_CONTEXT_MENU: { run: () => void ran.push('OPEN_CONTEXT_MENU') } });
    expect(press('F10', 'F10', button, { shiftKey: true })).toEqual({ id: null, prevented: false });
    expect(press('F10', 'F10', list, { shiftKey: true }).id).toBe('OPEN_CONTEXT_MENU');
    expect(press('ContextMenu', 'ContextMenu', list).id).toBe('OPEN_CONTEXT_MENU');
    expect(press('ContextMenu', 'ContextMenu', button).id).toBeNull();
    expect(actions.ranByKeyRecently('OPEN_CONTEXT_MENU')).toBe(true);
    expect(actions.ranByKeyRecently('OPEN_COPY_DLG')).toBe(false);
  });

  it('a released modifier is up even if the keyup still reports it (WebKitGTK, design 012)', () => {
    const detach = keys.attach(document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: true }));
    expect(keys.held().shift).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Alt', altKey: true, shiftKey: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Alt', altKey: true, shiftKey: true }),
    );
    expect(keys.held()).toMatchObject({ alt: false, shift: true });
    detach();
  });
});
