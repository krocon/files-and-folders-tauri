import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { SessionApi } from '../../core/session/session-api';
import { MenuApi } from '../../core/menu/menu-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { FakeMenuApi } from '../../../testing/fake-menu-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { MenuBar } from './menu-bar';
import { registerMenuActions } from './menu-actions';
import { MenuService, NATIVE_DEBOUNCE_MS } from './menu.service';

describe('menus', () => {
  let api: FakeMenuApi;
  let actions: ActionService;
  let menus: MenuService;
  let ran: string[];

  beforeEach(() => {
    api = new FakeMenuApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: MenuApi, useValue: api },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    menus = TestBed.inject(MenuService);
    ran = [];
    const h = (id: string) => ({ run: () => void ran.push(id) });
    actions.register({
      OPEN_COPY_DLG: h('OPEN_COPY_DLG'),
      RELOAD_DIR: h('RELOAD_DIR'),
      NAVIGATE_OPEN: h('NAVIGATE_OPEN'),
    });
  });

  /** A panel with a store and a fake controller showing `rows`. */
  function panel(rows: ReturnType<typeof entry>[], marked: string[] = []) {
    const store = TestBed.runInInjectionContext(() => new FileBrowserStore());
    store.listing.set(listing('/root', rows));
    store.marked.set(new Set(marked));
    let cursor: string | null = null;
    const controller = {
      displayedEntries: () => rows,
      cursorEntry: () => rows.find((r) => r.path === cursor),
      moveCursorTo: (p: string) => {
        cursor = p;
        store.setCursor(p);
        return true;
      },
    };
    TestBed.inject(WorkspaceStore).registerPanel('left', {
      store,
      controller: () => controller as never,
    });
    return { store };
  }

  it('right click: the cursor moves to the row, marks stay, the menu fits the context', () => {
    const rows = [entry('a.txt'), dir('sub'), entry('b.txt')];
    const { store } = panel(rows);
    menus.openFromPointer('left', 0, 10, 20);
    expect(store.cursorPath()).toBe('/root/a.txt');
    expect(menus.context()?.items.some((i) => i.id === 'OPEN_VIEW_DLG')).toBe(true);
    menus.openFromPointer('left', 1, 10, 20);
    expect(menus.context()?.items.some((i) => i.id === 'OPEN_IN_NEW_TAB')).toBe(true);
    menus.openFromPointer('left', -1, 10, 20);
    expect(menus.context()?.items[0].id).toBe('OPEN_MKDIR_DLG');
    store.marked.set(new Set(['/root/b.txt']));
    menus.openFromPointer('left', 0, 10, 20);
    expect(store.cursorPath()).toBe('/root/a.txt');
    expect([...store.marked()]).toEqual(['/root/b.txt']);
    expect(menus.context()?.items[0]).toMatchObject({ heading: true, label: '1 marked entry' });
  });

  it('runs the chosen entry as an action and closes the menu', async () => {
    panel([entry('a.txt')]);
    menus.openFromPointer('left', 0, 0, 0);
    menus.choose('OPEN_COPY_DLG');
    expect(menus.context()).toBeNull();
    await new Promise((r) => setTimeout(r));
    expect(ran).toEqual(['OPEN_COPY_DLG']);
  });

  it('native: sends the spec, runs menu events, ignores them during dialogs and as echo of a key', async () => {
    api.native = true;
    menus.init();
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(menus.mode()).toBe('native');
    expect(api.specs.length).toBe(1);
    // a state change only toggles items, the menu is not rebuilt (review 014 #7)
    actions.register({ RELOAD_DIR: { run: () => undefined, enabled: () => false } });
    TestBed.tick();
    await new Promise((r) => setTimeout(r, NATIVE_DEBOUNCE_MS + 20));
    expect(api.specs.length).toBe(1);
    expect(api.enabledCalls.at(-1)).toEqual([{ id: 'RELOAD_DIR', enabled: false }]);
    actions.register({ RELOAD_DIR: { run: () => void ran.push('RELOAD_DIR') } });
    TestBed.tick();
    await new Promise((r) => setTimeout(r, NATIVE_DEBOUNCE_MS + 20));
    expect(api.enabledCalls.at(-1)).toEqual([{ id: 'RELOAD_DIR', enabled: true }]);
    expect(api.specs.length).toBe(1);
    api.emit('RELOAD_DIR');
    expect(ran).toEqual(['RELOAD_DIR']);
    actions.noteKeyRun('RELOAD_DIR');
    api.emit('RELOAD_DIR');
    expect(ran).toEqual(['RELOAD_DIR']);
    // the key was held back in a text field: its native accelerator must not run it (review 014 #1)
    actions.noteKeySuppressed('OPEN_COPY_DLG');
    api.emit('OPEN_COPY_DLG');
    expect(ran).toEqual(['RELOAD_DIR']);
    TestBed.inject(DialogService).show('palette');
    api.emit('OPEN_COPY_DLG');
    expect(ran).toEqual(['RELOAD_DIR']);
  });

  it('html: the menu bar opens with ↓, moves with →, closes with Esc; FOCUS_MENU_BAR focuses it', async () => {
    menus.init();
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(menus.mode()).toBe('html');
    registerMenuActions(actions, menus);
    const fixture = TestBed.createComponent(MenuBar);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    const tops = [...el.querySelectorAll<HTMLElement>('[role="menubar"] > [role="menuitem"]')];
    expect(tops.map((t) => t.textContent?.trim())).toEqual([
      'File',
      'Edit',
      'View',
      'Go',
      'Tools',
      'Window',
      'Help',
    ]);
    expect(actions.state('FOCUS_MENU_BAR')).toBe('ready');
    await actions.run('FOCUS_MENU_BAR');
    fixture.detectChanges();
    expect(document.activeElement).toBe(tops[0]);
    const key = async (k: string) => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    };
    await key('ArrowDown');
    expect(tops[0].getAttribute('aria-expanded')).toBe('true');
    const first = document.activeElement as HTMLElement;
    expect(first.textContent).toContain('Open');
    await key('ArrowRight');
    expect(tops[1].getAttribute('aria-expanded')).toBe('true');
    await key('Escape');
    expect(tops[1].getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(tops[1]);
    // typeahead on the bar (review 014 #5)
    await key('w');
    expect(document.activeElement).toBe(tops[5]);
    await key('h');
    expect(document.activeElement).toBe(tops[6]);
    // Tab in an open drop-down leaves the bar (review 014 #5)
    await key('ArrowDown');
    expect(tops[6].getAttribute('aria-expanded')).toBe('true');
    await key('Tab');
    expect(tops[6].getAttribute('aria-expanded')).toBe('false');
    expect(el.contains(document.activeElement)).toBe(false);
    el.remove();
  });
});
