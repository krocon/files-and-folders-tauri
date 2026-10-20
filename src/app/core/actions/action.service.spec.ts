import { TestBed } from '@angular/core/testing';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { ActionService } from './action.service';
import { KeymapApi } from './keymap-api';

describe('ActionService', () => {
  let api: FakeKeymapApi;
  let actions: ActionService;

  beforeEach(() => {
    api = new FakeKeymapApi();
    TestBed.configureTestingModule({ providers: [{ provide: KeymapApi, useValue: api }] });
    actions = TestBed.inject(ActionService);
    actions.platform.set('windows');
  });

  it('runs registered actions, explains missing ones, respects enabled()', async () => {
    let n = 0;
    let allowed = false;
    actions.register({ RELOAD_DIR: { run: () => void n++, enabled: () => allowed } });
    expect(actions.state('RELOAD_DIR')).toBe('disabled');
    expect(await actions.run('RELOAD_DIR')).toBe(false);
    allowed = true;
    expect(actions.state('RELOAD_DIR')).toBe('ready');
    expect(await actions.run('RELOAD_DIR')).toBe(true);
    expect(n).toBe(1);
    expect(actions.state('OPEN_COPY_DLG')).toBe('unavailable');
    await actions.run('OPEN_COPY_DLG');
    expect(actions.messages()).toEqual(['Copy – coming in prompt 006.']);
  });

  it('unregisters handlers', () => {
    const off = actions.register({ RELOAD_DIR: { run: () => undefined } });
    off();
    expect(actions.state('RELOAD_DIR')).toBe('unavailable');
  });

  it('reports errors thrown by an action', async () => {
    actions.register({
      RELOAD_DIR: { run: () => Promise.reject({ code: 'io', message: 'boom', path: null }) },
    });
    await actions.run('RELOAD_DIR');
    // the code's description first, Rust's message as detail (design 015)
    expect(actions.messages()).toEqual(['Reload: The folder could not be read. (boom)']);
  });

  it('loads the override, applies it and saves changes per action', async () => {
    api.loaded = {
      bindings: { OPEN_COPY_DLG: ['Mod+Alt+J'], NOPE: ['F1'] },
      warning: 'old file kept',
    };
    await actions.init();
    expect(actions.shortcuts('OPEN_COPY_DLG')).toEqual(['Mod+Alt+J']);
    expect(actions.shortcutLabel('OPEN_COPY_DLG')).toBe('Ctrl+Alt+J');
    expect(actions.messages()).toEqual([
      'old file kept',
      'Shortcut file: unknown action NOPE was ignored.',
    ]);
    await actions.setOverride('OPEN_DELETE_DLG', []);
    await actions.setOverride('OPEN_COPY_DLG', null);
    expect(api.saved.at(-1)).toEqual({ NOPE: ['F1'], OPEN_DELETE_DLG: [] });
    expect(actions.shortcuts('OPEN_COPY_DLG')).toEqual(['F5']);
  });

  it('several vetoes: the first reason wins, each can be removed alone (design 030 E4)', () => {
    const svc = TestBed.inject(ActionService);
    svc.register({ OPEN_DELETE_DLG: { run: () => undefined } });
    const a = svc.setVeto((id) => (id === 'OPEN_DELETE_DLG' ? 'archive' : null));
    const b = svc.setVeto(() => 'cache');
    expect(svc.state('OPEN_DELETE_DLG')).toBe('disabled');
    a();
    expect(svc.state('OPEN_DELETE_DLG')).toBe('disabled');
    b();
    expect(svc.state('OPEN_DELETE_DLG')).toBe('ready');
  });
});
