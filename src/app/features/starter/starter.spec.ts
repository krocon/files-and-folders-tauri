import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { DispatchEvent, KeyboardDispatcher } from '../../core/actions/keyboard-dispatcher';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { MenuApi } from '../../core/menu/menu-api';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { SessionApi } from '../../core/session/session-api';
import { StarterApi } from '../../core/starter/starter-api';
import { StarterItem } from '../../core/starter/starter.models';
import { ThemeApi } from '../../core/theme/theme-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeMenuApi } from '../../../testing/fake-menu-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeStarterApi } from '../../../testing/fake-starter-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { resolveMenu, resolveMenuBar, toNativeSpec } from '../menus/menu-model';
import { MenuService } from '../menus/menu.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerStarterActions } from './starter-actions';
import { StarterDialog } from './starter-dialog';
import { StarterStore } from './starter.store';

const flush = () => new Promise((r) => setTimeout(r));

const ITEMS: StarterItem[] = [
  {
    id: 'code',
    kind: 'program',
    label: 'VS Code',
    program: 'code',
    params: '"%P%N"',
    shortcut: 'Alt+Shift+1',
  },
  { id: 'all', kind: 'program', label: 'Zip all', program: 'zip', params: 'x.zip %S' },
  { id: 'sep', kind: 'separator' },
  {
    id: 'm',
    kind: 'submenu',
    label: 'Projects',
    items: [{ id: 'p', kind: 'folder', label: 'Projekte ä', folder: '~/Projekte ä' }],
  },
  { id: 'bad', kind: 'program', label: 'Broken', program: './rel.sh' },
];

function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('starter menu (design 032)', () => {
  let api: FakeStarterApi;
  let actions: ActionService;
  let starter: StarterStore;
  let ws: WorkspaceStore;
  let left: FileBrowserStore;

  beforeEach(async () => {
    api = new FakeStarterApi();
    api.loaded = {
      items: ITEMS,
      warning: null,
      problems: [{ id: 'bad', code: 'program' }],
      file: '/cfg/starter.json',
    };
    const fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/src',
        parent: '/',
        segments: [{ name: '/', path: '/' }],
        entries: [
          entry('b.txt', { path: `${path ?? '/src'}/b.txt` }),
          entry('c d.txt', { path: `${path ?? '/src'}/c d.txt` }),
          dir('A Ordner', { path: `${path ?? '/src'}/A Ordner` }),
        ],
        unreadableEntries: 0,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: MenuApi, useValue: new FakeMenuApi() },
        { provide: StarterApi, useValue: api },
      ],
    });
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    ws = TestBed.inject(WorkspaceStore);
    starter = TestBed.inject(StarterStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const controller = {
      displayedEntries: () => left.visibleEntries(),
    } as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => controller });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerStarterActions(actions, starter, TestBed.inject(MenuService));
    await left.load('/src');
    await right.load('/target');
    await starter.init();
  });

  it('offers the entries as extra actions with shortcuts and as a menu tree', () => {
    expect(actions.extras().map((x) => x.id)).toEqual([
      'starter:code',
      'starter:all',
      'starter:p',
      'starter:bad',
    ]);
    expect(actions.extraShortcutLabel('starter:code')).toBe('Alt+Shift+1');
    // an entry with a problem is dimmed and says why
    expect(actions.extraReady('starter:bad')).toBe(false);
    const bar = resolveMenuBar(actions, 'linux');
    const start = bar.find((m) => m.id === 'start')!;
    expect(start.label).toBe('Start');
    expect(start.items.map((i) => i.label)).toEqual([
      'VS Code',
      'Zip all',
      '',
      'Projects',
      'Broken',
      '',
      'Change starter menu…',
    ]);
    expect(start.items[3].children!.map((c) => c.label)).toEqual(['Projekte ä']);
    expect(start.items[4]).toMatchObject({ disabled: true });
    expect(start.items[4].hint).toContain('absolute path');
    // the tools menu still lists only tools
    const tools = bar.find((m) => m.id === 'tools')!;
    expect(tools.items.some((i) => i.id.startsWith('starter:'))).toBe(false);
    // the native menu (macOS) has the same tree with accelerators
    const native = toNativeSpec(actions, 'linux', false);
    const nStart = native.menus.find((m) => m.kind === 'submenu' && m.label === 'Start')!;
    expect(nStart.kind === 'submenu' && nStart.items[0]).toMatchObject({
      kind: 'item',
      id: 'starter:code',
      accelerator: 'Alt+Shift+1',
      enabled: true,
    });
  });

  it('an empty starter menu says so and still offers the editor', async () => {
    api.loaded = { items: [], warning: null, problems: [], file: null };
    await starter.init();
    const items = resolveMenu(['@starter', '-', 'OPEN_STARTER_CONFIG_DLG'], actions, 'linux');
    expect(items.map((i) => [i.label, !!i.disabled])).toEqual([
      ['No entries yet', true],
      ['', false],
      ['Change starter menu…', false],
    ]);
  });

  it('runs a program with the cursor file, %S with all marked entries – by id only', async () => {
    left.setCursor('/src/c d.txt');
    expect(await actions.runExtra('starter:code')).toBe(true);
    expect(api.runs.at(-1)).toEqual({
      id: 'code',
      context: {
        files: ['/src/c d.txt'],
        cursor: '/src/c d.txt',
        dir: '/src',
        targetDir: '/target',
      },
      allowExecutable: false,
    });
    expect(starter.status()).toBe('VS Code started');
    left.setMarked(['/src/b.txt', '/src/c d.txt'], true);
    await actions.runExtra('starter:all');
    expect(api.runs.at(-1)!.context.files).toEqual(['/src/b.txt', '/src/c d.txt']);
    // the keyboard runs an entry by its own shortcut
    const evt: DispatchEvent = {
      key: '1',
      code: 'Digit1',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: true,
      repeat: false,
      target: null,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    };
    TestBed.inject(KeyboardDispatcher).handle(evt);
    await flush();
    expect(api.runs.at(-1)!.id).toBe('code');
  });

  it('a folder entry opens in the active panel; errors become messages', async () => {
    api.answers.set('p', { kind: 'folder', path: '/home/u/Projekte ä' });
    await actions.runExtra('starter:p');
    expect(ws.navigateRequest()).toMatchObject({ side: 'left', path: '/home/u/Projekte ä' });
    api.fail = { code: 'program_not_found', message: 'no', path: null };
    expect(await actions.runExtra('starter:code')).toBe(false);
    expect(actions.messages().at(-1)).toContain('VS Code');
  });

  it('Alt+S opens the starter menu as a popup at the active list', async () => {
    const menus = TestBed.inject(MenuService);
    expect(actions.shortcutLabel('OPEN_STARTER_MENU')).toBe('Alt+S');
    await actions.run('OPEN_STARTER_MENU');
    const ctx = menus.context()!;
    expect(ctx.label).toBe('Starter menu');
    expect(ctx.items.map((i) => i.label).at(0)).toBe('VS Code');
    expect(ctx.items.at(-1)!.label).toBe('Change starter menu…');
    menus.close('key');
    expect(menus.context()).toBeNull();
  });

  it('the editor: list with levels, add / arrange / edit, Rust problems per entry, save', async () => {
    const dialogs = TestBed.inject(DialogService);
    await actions.run('OPEN_STARTER_CONFIG_DLG');
    expect(dialogs.open()).toBe('starter-config');
    const fixture = TestBed.createComponent(StarterDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tree = el.querySelector<HTMLElement>('[role="tree"]')!;
    const items = () => [...el.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    expect(items().map((i) => i.getAttribute('aria-level'))).toEqual([
      '1',
      '1',
      '1',
      '1',
      '2',
      '1',
    ]);
    expect(items()[5].classList.contains('invalid')).toBe(true);
    // ↓ selects the next entry; the fields follow
    key(tree, 'ArrowDown');
    fixture.detectChanges();
    expect(items()[1].getAttribute('aria-selected')).toBe('true');
    key(tree, 'Home');
    fixture.detectChanges();
    const params = () =>
      [...el.querySelectorAll<HTMLInputElement>('.details input')].map((i) => i.value);
    expect(params()).toEqual(['VS Code', 'code', '"%P%N"', '', 'Alt+Shift+1']);
    // a shortcut that an action uses is refused before saving
    const inputs = [...el.querySelectorAll<HTMLInputElement>('.details input')];
    type(inputs[4], 'F5');
    fixture.detectChanges();
    expect(el.querySelector('.details')!.textContent).toContain('Already used by “Copy…”');
    type(inputs[4], 'Alt+Shift+2');
    // add a folder after the selection, move it into the submenu "Projects"
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.trim().endsWith(label),
      )!;
    button('Folder').click();
    fixture.detectChanges();
    expect(items()[1].textContent).toContain('New folder');
    const folderInputs = [...el.querySelectorAll<HTMLInputElement>('.details input')];
    type(folderInputs[1], '/data/Fotos 📷');
    // move it down past the separator, then into "Projects"
    key(tree, 'ArrowDown', { altKey: true });
    key(tree, 'ArrowDown', { altKey: true });
    key(tree, 'ArrowDown', { altKey: true });
    fixture.detectChanges();
    key(tree, 'ArrowRight', { altKey: true });
    fixture.detectChanges();
    const levels = items().map((i) => `${i.getAttribute('aria-level')}:${i.textContent?.trim()}`);
    expect(levels.slice(3, 6)).toEqual(['1:Projects(2)', '2:Projekte ä', '2:New folder']);
    // Rust reports a problem: nothing saved, the entry is selected and marked
    api.saveProblems = [{ id: 'bad', code: 'program' }];
    button('Save').click();
    await flush();
    fixture.detectChanges();
    expect(dialogs.open()).toBe('starter-config');
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('1 entry needs a fix');
    expect(el.querySelector('.details .notice')!.textContent).toContain('absolute path');
    // fix it and save
    type(el.querySelectorAll<HTMLInputElement>('.details input')[1], '/usr/local/bin/rel.sh');
    api.saveProblems = [];
    button('Save').click();
    await flush();
    expect(dialogs.open()).toBeNull();
    const saved = api.saved.at(-1)!;
    expect(saved[0]).toMatchObject({ id: 'code', shortcut: 'Alt+Shift+2' });
    expect(saved.find((i) => i.id === 'm')!.items!.map((i) => i.folder)).toEqual([
      '~/Projekte ä',
      '/data/Fotos 📷',
    ]);
    expect(actions.extraShortcutLabel('starter:code')).toBe('Alt+Shift+2');
  });

  it('quick entries from the panel: current folder and the file under the cursor', async () => {
    left.setCursor('/src/c d.txt');
    const fixture = TestBed.createComponent(StarterDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.trim().endsWith(label),
      )!;
    button('File under cursor').click();
    fixture.detectChanges();
    expect(
      [...el.querySelectorAll<HTMLInputElement>('.details input')].map((i) => i.value).slice(0, 2),
    ).toEqual(['c d.txt', '/src/c d.txt']);
    button('Current folder').click();
    fixture.detectChanges();
    expect(
      [...el.querySelectorAll<HTMLInputElement>('.details input')].map((i) => i.value)[1],
    ).toBe('/src');
  });
});
