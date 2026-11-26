// @ts-expect-error – node module in a spec (vitest runs in node)
import { readFileSync } from 'node:fs';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { PreviewApi } from '../../core/preview/preview-api';
import { ThemeApi } from '../../core/theme/theme-api';
import { FakePreviewApi } from '../../../testing/fake-preview-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TableStateIf } from '@guiexpert/table';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { SessionApi } from '../../core/session/session-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileList } from '../browser/file-list/file-list';
import { FilePanel } from './file-panel';
import { WatchApi } from '../../core/watch/watch-api';
import { FakeWatchApi } from '../../../testing/fake-watch-api';
import { newTab, WorkspaceStore } from './workspace.store';
import { By } from '@angular/platform-browser';
import { blankProfile } from '../remote/remote-logic';
import { RemoteStore } from '../remote/remote.store';
import { EMPTY_STATS } from '../../core/search/search.models';
import { ActionService } from '../../core/actions/action.service';
import { McpGuardService } from '../../core/mcp/mcp-guard.service';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FileActionsApi } from '../../core/fileactions/file-actions-api';
import { FileActionRule } from '../../core/fileactions/file-actions.models';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { FakeFileActionsApi } from '../../../testing/fake-file-actions-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FileActionsStore } from '../fileactions/file-actions.store';

/** jsdom has no layout – the real table is tested end-to-end; here a stand-in. */
@Component({ selector: 'app-file-list', template: '<div class="stub-list" tabindex="0"></div>' })
class FileListStub {
  readonly labelledBy = input.required<string>();
  readonly side = input<unknown>(null);
  readonly viewMode = input<string>('full');
  readonly headerMenu = output<{ x: number; y: number }>();
  readonly openInNewTab = output<unknown>();
  readonly tableStateChanged = output<Partial<TableStateIf>>();
}

function withSegments(l: DirectoryListing, names: string[]): DirectoryListing {
  let path = '';
  const segments = names.map((name, i) => {
    path = i === 0 ? name : `${path === '/' ? '' : path}/${name}`;
    return { name, path };
  });
  return { ...l, segments };
}

describe('FilePanel', () => {
  let fs: FakeFsApi;
  let ws: WorkspaceStore;
  let watch: FakeWatchApi;
  let fileActions: FakeFileActionsApi;

  beforeEach(() => {
    fs = new FakeFsApi();
    fileActions = new FakeFileActionsApi();
    watch = new FakeWatchApi();
    fs.handler = (p) => {
      switch (p) {
        case '/data':
          return Promise.resolve(
            withSegments(
              listing('/data', [
                dir('Übersicht', { path: '/data/Übersicht' }),
                entry('a.txt', { path: '/data/a.txt', size: 1536 }),
                entry('b.txt', { path: '/data/b.txt', size: 512 }),
              ]),
              ['/', 'data'],
            ),
          );
        case '/other':
          return Promise.resolve(
            withSegments(listing('/other', [entry('x', { path: '/other/x' })]), ['/', 'other']),
          );
        case '/data/Übersicht':
          return Promise.resolve(
            withSegments(listing('/data/Übersicht', [], '/data'), ['/', 'data', 'Übersicht']),
          );
        case '/':
          return Promise.resolve(
            withSegments(listing('/', [dir('data', { path: '/data' })], null), ['/']),
          );
        default:
          return Promise.reject({ code: 'not_found', message: 'gone', path: p ?? null });
      }
    };
    TestBed.configureTestingModule({
      imports: [FilePanel],
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: PreviewApi, useValue: new FakePreviewApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: WatchApi, useValue: watch },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: FileActionsApi, useValue: fileActions },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
      ],
    });
    TestBed.overrideComponent(FilePanel, {
      remove: { imports: [FileList] },
      add: { imports: [FileListStub] },
    });
    ws = TestBed.inject(WorkspaceStore);
    const first = newTab('/data');
    const second = {
      ...newTab('/other'),
      cursor: '/other/x',
      table: { version: 1 as const, sort: [] },
    };
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [first, second] },
        right: { activeTab: 0, tabs: [newTab('/data')] },
      },
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(FilePanel);
    fixture.componentRef.setInput('side', 'left');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const store = fixture.debugElement.injector.get(FileBrowserStore);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, store, el, settle };
  }

  // design 041 E4: the view mode belongs to the tab; the list gets it and keeps cursor and marks
  it('hands the view mode of the active tab to the list; cursor and marks stay on a switch', async () => {
    const { fixture, store, settle } = await render();
    await settle();
    const list = () => fixture.debugElement.query(By.directive(FileListStub)).componentInstance;
    expect(list().viewMode()).toBe('full');
    store.setCursor('/data/b.txt');
    store.toggleMark('/data/a.txt');
    const id = ws.activeTab('left').id;
    ws.updateTab(id, { view: 'thumbnails' });
    await settle();
    expect(list().viewMode()).toBe('thumbnails');
    expect(store.cursorPath()).toBe('/data/b.txt');
    expect([...store.marked()]).toEqual(['/data/a.txt']);
    // the same list component: nothing was built anew, no folder was read again
    const reads = fs.calls.length;
    ws.updateTab(id, { view: 'brief' });
    await settle();
    expect(list().viewMode()).toBe('brief');
    expect(fs.calls.length).toBe(reads);
    expect(store.cursorPath()).toBe('/data/b.txt');
    // the other tab has its own view
    ws.selectTab('left', 1);
    await settle();
    expect(list().viewMode()).toBe('full');
    // a disk-usage tab keeps its columns whatever the tab says
    ws.updateTab(ws.activeTab('left').id, {
      view: 'brief',
      search: { key: 'usage:9', label: 'Usage' },
    });
    await settle();
    expect(list().viewMode()).toBe('full');
  });

  it('watches its folder and applies changes from other programs (design 012)', async () => {
    watch.modes.set('/other', 'off');
    const { store, el, settle } = await render();
    await settle();
    expect(watch.calls.at(-1)).toEqual(['/data']);
    store.setCursor('/data/b.txt');
    watch.emit({
      type: 'changes',
      dir: '/data',
      upserted: [entry('neu.txt', { path: '/data/neu.txt' })],
      removed: ['/data/b.txt'],
    });
    expect(store.entries().map((e) => e.name)).toEqual(['Übersicht', 'a.txt', 'neu.txt']);
    expect(store.cursorPath()).toBe('/data/a.txt');
    // events of other folders are ignored
    watch.emit({ type: 'changes', dir: '/other', upserted: [], removed: ['/data/a.txt'] });
    expect(store.entries()).toHaveLength(3);
    // rescan reloads once
    const calls = fs.calls.length;
    watch.emit({ type: 'rescan', dir: '/data' });
    await settle();
    expect(fs.calls.length).toBe(calls + 1);
    // a folder that is not watched says so in the status line
    await store.load('/other');
    await settle();
    expect(watch.calls.at(-1)).toEqual(['/other']);
    await settle();
    expect(el.querySelector('.status .watch')?.textContent).toContain('network drive');
  });

  it('loads the active tab and writes the folder title back', async () => {
    const { el } = await render();
    expect(fs.calls).toEqual(['/data']);
    expect(ws.activeTab('left').title).toBe('data');
    const crumbs = [...el.querySelectorAll('.crumb')].map((c) => c.textContent?.trim());
    expect(crumbs).toEqual(['/', 'data']);
    expect(el.querySelectorAll('.sep')).toHaveLength(0);
    expect(el.querySelector('.crumb.current')?.getAttribute('aria-current')).toBe('location');
  });

  it('writes the folder back however late the listing arrives (both sides at once)', async () => {
    const pending: ReturnType<typeof deferred<DirectoryListing>>[] = [];
    fs.handler = () => {
      const d = deferred<DirectoryListing>();
      pending.push(d);
      return d.promise;
    };
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [newTab(null)] },
        right: { activeTab: 0, tabs: [newTab(null)] },
      },
    });
    const left = TestBed.createComponent(FilePanel);
    left.componentRef.setInput('side', 'left');
    const right = TestBed.createComponent(FilePanel);
    right.componentRef.setInput('side', 'right');
    left.detectChanges();
    right.detectChanges();
    await Promise.resolve();
    expect(fs.calls).toEqual([undefined, undefined]);
    const home = withSegments(listing('/home/u', []), ['/', 'home', 'u']);
    // resolve in reverse order, with change detection in between
    pending[1].resolve(home);
    await right.whenStable();
    right.detectChanges();
    pending[0].resolve(home);
    await left.whenStable();
    left.detectChanges();
    await right.whenStable();
    expect(ws.activeTab('left').title).toBe('u');
    expect(ws.activeTab('right').title).toBe('u');
    expect(ws.activeTab('right').path).toBe('/home/u');
  });

  it('shows the status line in the target format', async () => {
    const { el, store, settle } = await render();
    store.setMarked(['/data/a.txt', '/data/Übersicht'], true);
    await settle();
    const text = el.querySelector('.status')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(text).toBe('1.5 KB / 2.0 KB in 1 / 2 Files, 1 / 1 Folder');
    expect(el.querySelector('.status span')?.getAttribute('title')).toBe('1,536 / 2,048 bytes');
  });

  it('navigates via a breadcrumb segment, cursor on the folder it came from', async () => {
    const { el, store, settle } = await render();
    await store.load('/data/Übersicht');
    await settle();
    expect(ws.activeTab('left').path).toBe('/data/Übersicht');
    expect(ws.activeTab('left').history).toEqual(['/data']);
    const crumbs = [...el.querySelectorAll<HTMLButtonElement>('.crumb')];
    crumbs[1].click();
    await settle();
    expect(store.path()).toBe('/data');
    expect(store.cursorPath()).toBe('/data/Übersicht');
  });

  it('toggles the favourite star for the current folder', async () => {
    const { el, settle } = await render();
    const star = el.querySelector<HTMLButtonElement>('.star')!;
    expect(star.getAttribute('aria-pressed')).toBe('false');
    star.click();
    await settle();
    expect(ws.isFavorite('/data')).toBe(true);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.querySelector('i')?.classList.contains('fa-star')).toBe(true);
  });

  it('saves the cursor of the old tab and restores cursor and table state of the new one', async () => {
    const { store, settle } = await render();
    store.setCursor('/data/b.txt');
    await settle();
    ws.selectTab('left', 1);
    await settle();
    expect(fs.calls.at(-1)).toBe('/other');
    expect(store.cursorPath()).toBe('/other/x');
    expect(store.takePendingTableState()).toEqual({ version: 1, sort: [] });
    expect(ws.panels().left.tabs[0].cursor).toBe('/data/b.txt');
    ws.selectTab('left', 0);
    await settle();
    expect(store.cursorPath()).toBe('/data/b.txt');
  });

  it('activates its side on pointer down and registers itself for actions', async () => {
    const { el, store } = await render();
    ws.setActive('right');
    el.querySelector('.status')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(ws.activeSide()).toBe('left');
    expect(ws.panel('left')?.store).toBe(store);
  });

  it('navigates when requestNavigate is emitted for its side', async () => {
    const { store, settle } = await render();
    ws.requestNavigate('left', '/other');
    await settle();
    expect(store.path()).toBe('/other');
    expect(ws.panels().left.tabs[0].path).toBe('/other');
  });

  it('shows an error when the tab folder is gone and keeps the panel usable', async () => {
    ws.restore({
      ...ws.snapshot(),
      panels: { ...ws.snapshot().panels, left: { activeTab: 0, tabs: [newTab('/gone')] } },
    });
    const { el } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('does not exist');
  });

  it('shows a server tab after a restart as "not connected" with its name, not the internal path (034)', async () => {
    TestBed.inject(RemoteStore).profiles.set([
      { ...blankProfile('Mein Server'), id: 'srv1', host: 'example.org' },
    ]);
    fs.handler = () =>
      Promise.reject({ code: 'remote_not_connected', message: 'Not connected', path: 'srv1' });
    ws.restore({
      ...ws.snapshot(),
      panels: {
        ...ws.snapshot().panels,
        left: { activeTab: 0, tabs: [newTab('remote://srv1/home/fnf')] },
      },
    });
    const { el } = await render();
    const banner = el.querySelector('.error.offline')!;
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toContain('Not connected to Mein Server');
    expect(banner.querySelector('.btn.primary')?.textContent).toContain('Connect');
    expect(el.textContent).not.toContain('remote://');
    expect(el.textContent).not.toContain('srv1');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('marks its parts as the active panel', async () => {
    const { el, settle } = await render();
    ws.setActive('left');
    await settle();
    expect(el.querySelectorAll('.fnf-active-panel').length).toBe(4);
    ws.setActive('right');
    await settle();
    expect(el.querySelectorAll('.fnf-active-panel').length).toBe(0);
  });

  it('does not let a reload during a pending tab switch overwrite the new tab', async () => {
    const { store, settle } = await render();
    const slow = deferred<DirectoryListing>();
    const original = fs.handler;
    fs.handler = (p) => (p === '/other' ? slow.promise : original(p));
    ws.selectTab('left', 1);
    await settle();
    ws.requestReload('left'); // double click on the tab while /other is still loading
    await settle();
    expect(fs.calls.filter((c) => c === '/data')).toHaveLength(1);
    slow.resolve(
      withSegments(listing('/other', [entry('x', { path: '/other/x' })]), ['/', 'other']),
    );
    await settle();
    expect(store.path()).toBe('/other');
    expect(ws.panels().left.tabs[1].path).toBe('/other');
    expect(ws.panels().left.tabs[0].path).toBe('/data');
  });

  it('path input: Strg/⌘+L, errors stay in the field, a file opens its folder with the cursor on it', async () => {
    const { el, store, settle } = await render();
    fs.locations['~/other/x'] = { dir: '/other', select: '/other/x' };
    ws.requestPathEdit('left');
    await settle();
    const input = () => el.querySelector<HTMLInputElement>('.path-input');
    expect(input()?.value).toBe('/data');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    input()!.value = '/nope';
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.path-error')?.textContent).toContain('does not exist');
    input()!.value = '~/other/x';
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    await settle();
    expect(store.path()).toBe('/other');
    expect(store.cursorPath()).toBe('/other/x');
    expect(input()).toBeNull();
  });

  describe('079: a file path typed into the path field opens the file like a double click', () => {
    const CLIP = '/media/clip.mp4';
    const mediaListing = (extra: DirectoryListing['entries'] = []) =>
      withSegments(
        listing('/media', [
          dir('sub', { path: '/media/sub' }),
          entry('clip.mp4', { path: CLIP }),
          entry('.secret.txt', { path: '/media/.secret.txt', hidden: true }),
          entry('pack.zip', { path: '/media/pack.zip' }),
          entry('Ünï cödé 🎬 x.txt', { path: '/media/Ünï cödé 🎬 x.txt' }),
          ...extra,
        ]),
        ['/', 'media'],
      );
    let original: FakeFsApi['handler'];

    beforeEach(() => {
      original = fs.handler;
      fs.handler = (p) =>
        p === '/media'
          ? Promise.resolve(mediaListing())
          : p === '/media/pack.zip'
            ? Promise.resolve(
                withSegments(listing(p, [entry('in.txt', { path: `${p}/in.txt` })], '/media'), [
                  '/',
                  'media',
                  'pack.zip',
                ]),
              )
            : p === CLIP
              ? Promise.reject({ code: 'not_a_directory', message: 'a file', path: p })
              : original(p);
      const file = (path: string) => ({ dir: '/media', select: path });
      fs.locations = {
        [CLIP]: file(CLIP),
        // Rust drops a trailing separator (`normalize_lexically`)
        [`${CLIP}/`]: file(CLIP),
        '/media/.secret.txt': file('/media/.secret.txt'),
        '/media/pack.zip': file('/media/pack.zip'),
        '/media/Ünï cödé 🎬 x.txt': file('/media/Ünï cödé 🎬 x.txt'),
        '/media/late.txt': file('/media/late.txt'),
        '/media': { dir: '/media', select: null },
        '~/media/': { dir: '/media', select: null },
        '/data/a.txt': { dir: '/data', select: '/data/a.txt' },
      };
    });

    type Rendered = Awaited<ReturnType<typeof render>>;
    const input = (h: Rendered) => h.el.querySelector<HTMLInputElement>('.path-input');

    async function edit(h: Rendered): Promise<void> {
      ws.requestPathEdit('left');
      await h.settle();
    }

    /** Types `value` and presses Enter (`shift`: Shift+Enter). */
    async function enter(h: Rendered, value: string, shift = false): Promise<void> {
      if (!input(h)) {
        await edit(h);
      }
      input(h)!.value = value;
      if (shift) {
        input(h)!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        h.el.querySelector('form')!.dispatchEvent(new Event('submit'));
      }
      await h.settle();
      await h.settle();
    }

    it('goes to the folder, puts the cursor on the file and opens it once – after the listing', async () => {
      const h = await render();
      const hanging = deferred<DirectoryListing>();
      fs.handler = (p) => (p === '/media' ? hanging.promise : original(p));
      await enter(h, CLIP);
      // the folder is not listed yet: nothing runs, the field stays
      expect(fs.opened).toEqual([]);
      expect(input(h)).not.toBeNull();
      hanging.resolve(mediaListing());
      await h.settle();
      await h.settle();
      expect(h.store.path()).toBe('/media');
      expect(h.store.cursorPath()).toBe(CLIP);
      expect(fs.opened).toEqual([{ path: CLIP, allowExecutable: false }]);
      expect(input(h)).toBeNull();
      expect(ws.activeSide()).toBe('left');
      // the other tab is untouched, Back leads to the folder before
      expect(ws.panels().left.tabs[1].path).toBe('/other');
      expect(h.store.canGoBack()).toBe(true);
      await h.store.back();
      expect(h.store.path()).toBe('/data');
      expect(fs.opened.length).toBe(1);
    });

    it('spaces, umlauts and emoji in the name', async () => {
      const h = await render();
      await enter(h, '/media/Ünï cödé 🎬 x.txt');
      expect(fs.opened.map((o) => o.path)).toEqual(['/media/Ünï cödé 🎬 x.txt']);
    });

    it('a folder path, a path with a separator at the end and Shift+Enter only go there', async () => {
      const h = await render();
      await enter(h, '/media');
      expect(h.store.path()).toBe('/media');
      await enter(h, '~/media/');
      expect(h.store.path()).toBe('/media');
      await h.store.load('/data');
      // `…/clip.mp4/` reads as a folder: where it is, nothing starts
      await enter(h, `${CLIP}/`);
      expect(h.store.path()).toBe('/media');
      expect(h.store.cursorPath()).toBe(CLIP);
      await h.store.load('/data');
      await enter(h, CLIP, true);
      expect(h.store.path()).toBe('/media');
      expect(h.store.cursorPath()).toBe(CLIP);
      expect(input(h)).toBeNull();
      expect(fs.opened).toEqual([]);
    });

    it('names the key for "only go there" in the field', async () => {
      const h = await render();
      await edit(h);
      expect(input(h)!.placeholder).toContain('Shift+Enter');
      expect(input(h)!.title).toContain('Shift+Enter');
    });

    it('a typo in the name: the error stays in the field, the tab stays, nothing starts', async () => {
      const h = await render();
      await enter(h, '/media/clipp.mp4');
      expect(h.el.querySelector('.path-error')?.textContent).toContain('does not exist');
      expect(input(h)).not.toBeNull();
      expect(h.store.path()).toBe('/data');
      expect(fs.opened).toEqual([]);
    });

    it('an archive is entered like on a double click', async () => {
      const h = await render();
      await enter(h, '/media/pack.zip');
      expect(h.store.path()).toBe('/media/pack.zip');
      expect(fs.opened).toEqual([]);
    });

    it('E3: a hidden file opens although no row can show it; the filter stays', async () => {
      const h = await render();
      await enter(h, '/media/.secret.txt');
      expect(h.store.path()).toBe('/media');
      expect(h.store.hiddenVisible()).toBe(false);
      expect(h.store.visibleEntries().some((e) => e.hidden)).toBe(false);
      expect(fs.opened.map((o) => o.path)).toEqual(['/media/.secret.txt']);
    });

    it('a double-click rule without keys runs instead of the default app, one with Shift never', async () => {
      const rule = (id: string, modifiers: FileActionRule['modifiers']): FileActionRule => ({
        id,
        trigger: 'doubleClick',
        modifiers,
        pattern: '*.mp4',
        confirm: false,
        command: 'player %N',
        terminal: false,
      });
      fileActions.loaded = {
        rules: [rule('shifted', ['shift']), rule('plain', [])],
        warning: null,
        problems: [],
      };
      await TestBed.inject(FileActionsStore).init();
      const h = await render();
      h.store.setMarked(['/data/a.txt'], true);
      await enter(h, CLIP);
      expect(fileActions.runs.map((r) => [r.id, r.file])).toEqual([['plain', CLIP]]);
      expect(fs.opened).toEqual([]);
      expect(h.store.cursorPath()).toBe(CLIP);
    });

    it('"double click views": the viewer opens the file', async () => {
      const settings = TestBed.inject(SettingsStore);
      await settings.init();
      settings.set('behavior.doubleClick', 'view');
      const viewed: (string | null)[] = [];
      const h = await render();
      TestBed.inject(ActionService).register({
        OPEN_VIEW_DLG: { run: () => void viewed.push(ws.panel()?.store.cursorPath() ?? null) },
      });
      await enter(h, CLIP);
      expect(viewed).toEqual([CLIP]);
      expect(fs.opened).toEqual([]);
    });

    it('a failing open: the tab stays in the folder with the cursor on the file, the panel reports', async () => {
      const h = await render();
      fs.openFile = () => Promise.reject({ code: 'permission_denied', message: 'no', path: CLIP });
      await enter(h, CLIP);
      expect(h.store.path()).toBe('/media');
      expect(h.store.cursorPath()).toBe(CLIP);
      expect(h.store.error()?.code).toBe('permission_denied');
      expect(input(h)).toBeNull();
    });

    it('a tab switch while the folder is read: nothing opens, least of all in the other tab', async () => {
      const h = await render();
      const hanging = deferred<DirectoryListing>();
      fs.handler = (p) => (p === '/media' ? hanging.promise : original(p));
      await enter(h, CLIP);
      ws.selectTab('left', 1);
      await h.settle();
      hanging.resolve(mediaListing());
      await h.settle();
      await h.settle();
      expect(h.store.path()).toBe('/other');
      expect(fs.opened).toEqual([]);
    });

    it('a second Enter with another path: only the last input opens', async () => {
      const h = await render();
      const hanging = deferred<DirectoryListing>();
      fs.handler = (p) => (p === '/media' ? hanging.promise : original(p));
      await enter(h, CLIP);
      await enter(h, '/data/a.txt');
      hanging.resolve(mediaListing());
      await h.settle();
      await h.settle();
      expect(h.store.path()).toBe('/data');
      expect(fs.opened.map((o) => o.path)).toEqual(['/data/a.txt']);
    });

    it('E6: never opens from a kept listing – the folder is read first, a file gone since is an error', async () => {
      // /media is on a network drive: its listing is kept (design 030 E1)
      const net = (l: DirectoryListing): DirectoryListing => ({ ...l, network: true });
      fs.handler = (p) =>
        p === '/media'
          ? Promise.resolve(net(mediaListing([entry('late.txt', { path: '/media/late.txt' })])))
          : original(p);
      const h = await render();
      await h.store.load('/media');
      await h.store.load('/data');
      const hanging = deferred<DirectoryListing>();
      fs.handler = (p) => (p === '/media' ? hanging.promise : original(p));
      await enter(h, '/media/late.txt');
      // not shown from the cache: the panel waits for Rust
      expect(h.store.cachedAt()).toBeNull();
      expect(h.store.loading()).toBe(true);
      expect(fs.opened).toEqual([]);
      hanging.resolve(net(mediaListing()));
      await h.settle();
      await h.settle();
      expect(h.store.path()).toBe('/media');
      expect(fs.opened).toEqual([]);
      expect(h.el.querySelector('.path-error')?.textContent).toContain('does not exist');
    });

    describe('review 079', () => {
      /** Enter on `value` while the listing of /media hangs; `finish` delivers it. */
      async function enterHanging(h: Rendered, value = CLIP): Promise<() => Promise<void>> {
        const hanging = deferred<DirectoryListing>();
        fs.handler = (p) => (p === '/media' ? hanging.promise : original(p));
        await enter(h, value);
        return async () => {
          hanging.resolve(mediaListing());
          await h.settle();
          await h.settle();
        };
      }

      it('#1: another spelling of the name – Rust answers with the listed one, that entry opens', async () => {
        // what `resolve_location` returns for README-style input on a case-insensitive volume
        fs.locations['/media/CLIP.MP4'] = { dir: '/media', select: CLIP };
        const h = await render();
        await enter(h, '/media/CLIP.MP4');
        expect(h.store.cursorPath()).toBe(CLIP);
        expect(fs.opened.map((o) => o.path)).toEqual([CLIP]);
        expect(h.el.querySelector('.path-error')).toBeNull();
      });

      it('#2: Esc while the folder is read – this input does nothing more', async () => {
        const h = await render();
        const finish = await enterHanging(h);
        input(h)!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
        await h.settle();
        expect(input(h)).toBeNull();
        await finish();
        expect(fs.opened).toEqual([]);
        expect(h.el.querySelector('.path-error')).toBeNull();
      });

      it('#2: the focus left the field while the folder is read – it goes there, nothing opens', async () => {
        const h = await render();
        const finish = await enterHanging(h);
        input(h)!.dispatchEvent(new FocusEvent('blur'));
        await h.settle();
        const focus = ws.focusRequest();
        await finish();
        expect(h.store.path()).toBe('/media');
        expect(h.store.cursorPath()).toBe(CLIP);
        expect(fs.opened).toEqual([]);
        // the focus is where the user put it
        expect(ws.focusRequest()).toBe(focus);
      });

      it('#2: the other side became active meanwhile – nothing opens, the side stays active', async () => {
        const h = await render();
        const finish = await enterHanging(h);
        ws.setActive('right');
        const focus = ws.focusRequest();
        await finish();
        expect(h.store.path()).toBe('/media');
        expect(fs.opened).toEqual([]);
        expect(ws.activeSide()).toBe('right');
        expect(ws.focusRequest()).toBe(focus);
        expect(input(h)).toBeNull();
      });

      it('#3: a dialog opened while the folder is read – only goes there', async () => {
        const h = await render();
        const finish = await enterHanging(h);
        TestBed.inject(DialogService).show('settings');
        await finish();
        expect(h.store.path()).toBe('/media');
        expect(h.store.cursorPath()).toBe(CLIP);
        expect(fs.opened).toEqual([]);
        expect(TestBed.inject(DialogService).open()).toBe('settings');
      });

      it('#4: right after an MCP client changed the view nothing opens – no rule either – and the user is told', async () => {
        fileActions.loaded = {
          rules: [
            {
              id: 'plain',
              trigger: 'doubleClick',
              modifiers: [],
              pattern: '*.mp4',
              confirm: false,
              command: 'player %N',
              terminal: false,
            },
          ],
          warning: null,
          problems: [],
        };
        await TestBed.inject(FileActionsStore).init();
        const guard = TestBed.inject(McpGuardService);
        let now = 1_000;
        guard.now = () => now;
        const actions = TestBed.inject(ActionService);
        const h = await render();
        guard.changed('left', 'Claude', null);
        await enter(h, CLIP);
        expect(h.store.path()).toBe('/media');
        expect(h.store.cursorPath()).toBe(CLIP);
        expect(fs.opened).toEqual([]);
        expect(fileActions.runs).toEqual([]);
        expect(actions.messages().join('\n')).toContain('MCP client just changed the view');
        // the lock is over: the same input opens
        now += 2_000;
        await h.store.load('/data');
        await enter(h, CLIP);
        expect(fileActions.runs.map((r) => r.file)).toEqual([CLIP]);
      });

      it('#5: the unchanged field in the root of an archive does not "open" the archive again', async () => {
        fileActions.loaded = {
          rules: [
            {
              id: 'zip',
              trigger: 'doubleClick',
              modifiers: [],
              pattern: '*.zip',
              confirm: false,
              command: 'unzipper %N',
              terminal: false,
            },
          ],
          warning: null,
          problems: [],
        };
        await TestBed.inject(FileActionsStore).init();
        const h = await render();
        await h.store.load('/media/pack.zip');
        await edit(h);
        expect(input(h)!.value).toBe('/media/pack.zip');
        await enter(h, input(h)!.value);
        // like before 079: the folder of the archive, cursor on it
        expect(h.store.path()).toBe('/media');
        expect(h.store.cursorPath()).toBe('/media/pack.zip');
        expect(fileActions.runs).toEqual([]);
        expect(fs.opened).toEqual([]);
      });

      it('a program asks the same question as a double click before it runs', async () => {
        fs.executables.add(CLIP);
        const confirm = TestBed.inject(ConfirmService);
        const asked: string[] = [];
        let answer = false;
        confirm.ask = (q) => (asked.push(q.detail ?? ''), Promise.resolve(answer));
        const h = await render();
        await enter(h, CLIP);
        expect(asked).toEqual([CLIP]);
        expect(fs.opened).toEqual([]);
        answer = true;
        await h.store.load('/data');
        await enter(h, CLIP);
        expect(asked).toEqual([CLIP, CLIP]);
        expect(fs.opened).toEqual([{ path: CLIP, allowExecutable: true }]);
      });
    });

    it('navigating to a file path by any other way opens nothing', async () => {
      const h = await render();
      ws.requestNavigate('left', CLIP);
      await h.settle();
      ws.requestNavigate('left', '/media', CLIP);
      await h.settle();
      expect(h.store.cursorPath()).toBe(CLIP);
      ws.selectTab('left', 1);
      await h.settle();
      expect(fs.opened).toEqual([]);
      expect(fileActions.runs).toEqual([]);
    });
  });

  it('053: a click into the free area of the crumbs opens the field, the path stands once', async () => {
    const { el, store, settle } = await render();
    await store.load('/data/Übersicht');
    await settle();
    const click = (target: Element, detail = 1) =>
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
    const input = () => el.querySelector<HTMLInputElement>('.path-input');
    // a segment navigates, it does not open the field; a double click neither
    click(el.querySelector('.crumb.current')!);
    click(el.querySelector('.path-crumbs')!, 2);
    await settle();
    expect(input()).toBeNull();
    for (const sel of ['.path-crumbs', '.sep', '.path-hint']) {
      click(el.querySelector(sel)!);
      await settle();
      expect(input(), sel).not.toBeNull();
      // only the hidden label of the list is left – no second visible path
      const crumbs = [...el.querySelectorAll('.crumbs')];
      expect(crumbs.every((c) => c.hasAttribute('hidden'))).toBe(true);
      input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(input()).toBeNull();
    }
    // the tooltip names the full path and the shortcut of "Go to path…"
    expect(el.querySelector('.path-crumbs')!.getAttribute('title')).toMatch(
      /^\/data\/Übersicht\nClick to enter a path/,
    );
  });

  it('053: `hidden` beats the flex box of the crumbs', () => {
    const css = readFileSync('src/app/features/workspace/file-panel.css', 'utf8') as string;
    expect(css).toMatch(/\.crumbs\[hidden\] \{\s*display: none;/);
  });

  it('keeps hidden/filter per tab and opens folders from the folder menu', async () => {
    const { el, store, settle } = await render();
    (el.querySelector('[aria-label="Show hidden files"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Filter"]') as HTMLButtonElement).click();
    await settle();
    const filter = el.querySelector<HTMLInputElement>('.filter-input')!;
    filter.value = '*.txt';
    filter.dispatchEvent(new Event('input'));
    await settle();
    expect(ws.activeTab('left')).toMatchObject({
      hiddenVisible: true,
      filterActive: true,
      filterText: '*.txt',
    });
    expect(el.querySelector('.status')?.textContent).toContain('0 / 2 Files, 0 / 0 Folders');
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(store.filterActive()).toBe(false);

    ws.toggleFavorite('/other');
    (el.querySelector('.folder-menu') as HTMLButtonElement).click();
    await settle();
    const items = [...el.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(items.map((i) => i.textContent?.trim())).toContain('/other');
    items.find((i) => i.textContent?.trim() === '/other')!.click();
    await settle();
    await settle();
    expect(store.path()).toBe('/other');
    expect(ws.recent()[0]).toBe('/other');
  });

  it('reloads when a job changed the shown folder', async () => {
    const { settle } = await render();
    const jobs = TestBed.inject(JobsStore);
    await jobs.init();
    const before = fs.calls.length;
    (TestBed.inject(JobsApi) as FakeJobsApi).emit({ type: 'dirsChanged', dirs: ['/elsewhere'] });
    await settle();
    expect(fs.calls.length).toBe(before);
    (TestBed.inject(JobsApi) as FakeJobsApi).emit({ type: 'dirsChanged', dirs: ['/data'] });
    await settle();
    expect(fs.calls.slice(before)).toEqual(['/data']);
  });

  describe('slow folders (design 029 E5, 030)', () => {
    it('a slow tab shown before comes back at once from the cache, marked until checked (030)', async () => {
      const original = fs.handler;
      // /data is on a network drive: its listing is kept (design 030 E1)
      fs.handler = (p) =>
        p === '/data' ? original(p).then((l) => ({ ...l, network: true })) : original(p);
      const { store, el, settle } = await render();
      ws.selectTab('left', 1);
      await settle();
      const hanging = deferred<DirectoryListing>();
      fs.handler = (p) => (p === '/data' ? hanging.promise : original(p));
      ws.selectTab('left', 0);
      await settle();
      // the kept list, usable, while it is read again
      expect(store.path()).toBe('/data');
      expect(store.loading()).toBe(false);
      expect(store.navigationLocked()).toBe(false);
      expect(store.refreshing()).toBe(true);
      expect(store.cachedAt()).not.toBeNull();
      expect(el.querySelector('.header.unconfirmed')).not.toBeNull();
      expect(el.querySelector('.status .cached')?.textContent).toContain('checking');
      expect(fs.calls.at(-1)).toBe('/data');
      hanging.resolve({
        ...withSegments(listing('/data', [entry('neu.txt', { path: '/data/neu.txt' })]), [
          '/',
          'data',
        ]),
        network: true,
      });
      await settle();
      expect(store.entries().map((e) => e.name)).toEqual(['neu.txt']);
      expect(store.cachedAt()).toBeNull();
      expect(el.querySelector('.header.unconfirmed')).toBeNull();
    });

    it('a tab never shown: empty list and its own path while it opens, not the old tab', async () => {
      const { store, el, settle } = await render();
      const hanging = deferred<DirectoryListing>();
      const original = fs.handler;
      fs.handler = (p) => (p === '/other' ? hanging.promise : original(p));
      ws.selectTab('left', 1);
      await settle();
      expect(store.listing()).toBeNull();
      expect(store.loading()).toBe(true);
      expect(el.querySelector('.crumb.opening')?.textContent).toContain('/other');
      expect(ws.panels().left.tabs[0].path).toBe('/data');
      hanging.resolve(
        withSegments(listing('/other', [entry('x', { path: '/other/x' })]), ['/', 'other']),
      );
      await settle();
      expect(store.path()).toBe('/other');
      expect(el.querySelector('.crumb.opening')).toBeNull();
    });

    it('Esc while a tab opens goes back to the tab before (at once, from its last list)', async () => {
      const { store, settle } = await render();
      const hanging = deferred<DirectoryListing>();
      const original = fs.handler;
      fs.handler = (p) => (p === '/other' ? hanging.promise : original(p));
      ws.selectTab('left', 1);
      await settle();
      const calls = fs.calls.length;
      expect(ws.panel('left')?.cancelLoading?.()).toBe(true);
      await settle();
      expect(ws.panels().left.activeTab).toBe(0);
      expect(store.path()).toBe('/data');
      expect(store.loading()).toBe(false);
      // shown from the kept list; only a background refresh reads it
      expect(fs.calls.slice(calls)).toEqual(['/data']);
      hanging.resolve(withSegments(listing('/other', []), ['/', 'other']));
      await settle();
      expect(store.path()).toBe('/data');
      expect(ws.panels().left.tabs[1].path).toBe('/other');
    });

    it('a cancelled first tab offers "Try again"', async () => {
      ws.restore({
        ...ws.snapshot(),
        panels: { ...ws.snapshot().panels, left: { activeTab: 0, tabs: [newTab('/data')] } },
      });
      const hanging = deferred<DirectoryListing>();
      const original = fs.handler;
      fs.handler = (p) => (p === '/data' ? hanging.promise : original(p));
      const { store, el, settle } = await render();
      expect(store.loading()).toBe(true);
      expect(ws.panel('left')?.cancelLoading?.()).toBe(true);
      await settle();
      expect(el.querySelector('.slow')?.textContent).toContain('cancelled');
      fs.handler = original;
      (el.querySelector('.slow button') as HTMLButtonElement).click();
      await settle();
      expect(store.path()).toBe('/data');
      expect(el.querySelector('.slow')).toBeNull();
    });

    it('shows "slow to respond" with Cancel after 2 s of opening a folder', async () => {
      const { store, el, settle } = await render();
      const hanging = deferred<DirectoryListing>();
      fs.handler = () => hanging.promise;
      void store.load('/somewhere');
      store.slow.set(true); // the 2-s timer itself is covered by the store spec
      await settle();
      expect(el.querySelector('.slow')?.textContent).toContain('slow to respond');
      (el.querySelector('.slow button') as HTMLButtonElement).click();
      await settle();
      expect(store.loading()).toBe(false);
      expect(store.path()).toBe('/data');
      expect(el.querySelector('.slow')).toBeNull();
    });

    it('Esc on a tab of the same folder unlocks the panel at once (no wait for the old request)', async () => {
      const { store, settle } = await render();
      const hanging = deferred<DirectoryListing>();
      const original = fs.handler;
      ws.restore({
        ...ws.snapshot(),
        panels: {
          ...ws.snapshot().panels,
          left: { activeTab: 0, tabs: [...ws.snapshot().panels.left.tabs, newTab('/data')] },
        },
      });
      await settle();
      fs.handler = (p) => (p === '/data' ? hanging.promise : original(p));
      ws.selectTab('left', 2);
      await settle();
      expect(store.navigationLocked()).toBe(true);
      expect(ws.panel('left')?.cancelLoading?.()).toBe(true);
      expect(store.navigationLocked()).toBe(false);
      expect(store.path()).toBe('/data');
    });

    it('review #3: two tabs on the same cached folder keep their own table state', async () => {
      const original = fs.handler;
      fs.handler = (p) =>
        p === '/data' ? original(p).then((l) => ({ ...l, network: true })) : original(p);
      const table = {
        version: 1 as const,
        sort: [{ property: 'size', sortState: 'desc' as const }],
      };
      ws.restore({
        ...ws.snapshot(),
        panels: {
          ...ws.snapshot().panels,
          left: {
            activeTab: 0,
            tabs: [newTab('/data'), { ...newTab('/data'), table }],
          },
        },
      });
      const { store, settle } = await render();
      fs.handler = (p) => (p === '/data' ? new Promise(() => undefined) : original(p));
      ws.selectTab('left', 1);
      await settle();
      expect(store.takePendingTableState()).toEqual(table);
    });
  });
  describe('flat view (design 038)', () => {
    const SUM = {
      itemsDone: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
      bytesDone: 0,
      errors: [],
      error: null,
      dirSize: null,
    };
    const flatHit = (name: string, relDir: string) => ({
      ...entry(name, { path: relDir ? `/data/${relDir}/${name}` : `/data/${name}` }),
      dir: relDir ? `/data/${relDir}` : '/data',
      relDir,
      parentNames: ['', '', ''] as [string, string, string],
    });

    async function flatSetup() {
      const r = await render();
      await TestBed.inject(JobsStore).init();
      const jobsApi = TestBed.inject(JobsApi) as FakeJobsApi;
      const handle = ws.panel('left')!;
      return { ...r, jobsApi, handle };
    }

    it('Mod+B turns the same tab into a flat view and back, cursor where it was', async () => {
      const { store, el, settle, jobsApi, handle } = await flatSetup();
      await settle();
      const id = ws.activeTab('left').id;
      store.setCursor('/data/b.txt');
      await handle.toggleFlat!();
      await settle();
      const tab = ws.activeTab('left');
      expect(tab.id).toBe(id);
      expect(tab.path).toBe('/data');
      expect(tab.search?.flat).toMatchObject({ root: '/data', cursorBefore: '/data/b.txt' });
      expect(ws.panels().left.tabs).toHaveLength(2);
      expect(jobsApi.started.at(-1)!.spec).toMatchObject({
        kind: 'search',
        criteria: { roots: ['/data'], name: '', followLinks: false },
      });
      expect(store.flat()).toBe(true);
      expect(store.resultBusy()).toBe(true);
      const jobId = jobsApi.started.at(-1)!.id;
      jobsApi.emit({
        type: 'searchHits',
        id: jobId,
        hits: [flatHit('a.txt', ''), flatHit('deep.txt', 'Übersicht/x')],
        stats: { ...EMPTY_STATS, hits: 2 },
      });
      jobsApi.emit({ type: 'finished', id: jobId, state: 'done', summary: SUM });
      await settle();
      expect(store.entries().map((e) => e.name)).toEqual(['a.txt', 'deep.txt']);
      expect(store.resultBusy()).toBe(false);
      expect(el.textContent).toContain('Flat view: data');
      // back to the normal view
      await handle.toggleFlat!();
      await settle();
      expect(ws.activeTab('left').search ?? null).toBeNull();
      expect(ws.activeTab('left').id).toBe(id);
      expect(store.path()).toBe('/data');
      expect(store.cursorPath()).toBe('/data/b.txt');
    });

    it('Enter on a folder leaves the flat view into it, the root becomes history', async () => {
      const { store, settle, jobsApi, handle } = await flatSetup();
      await settle();
      await handle.toggleFlat!();
      await settle();
      const jobId = jobsApi.started.at(-1)!.id;
      jobsApi.emit({
        type: 'searchHits',
        id: jobId,
        hits: [
          { ...flatHit('Übersicht', ''), kind: 'directory' as const, path: '/data/Übersicht' },
        ],
        stats: { ...EMPTY_STATS, hits: 1 },
      });
      jobsApi.emit({ type: 'finished', id: jobId, state: 'done', summary: SUM });
      await settle();
      await store.open(store.entries()[0]);
      await settle();
      expect(store.flat()).toBe(false);
      expect(store.path()).toBe('/data/Übersicht');
      expect(ws.activeTab('left').history[0]).toBe('/data');
    });

    it('a job changing a folder below the root refreshes in the background; Hidden lists again', async () => {
      const { store, settle, jobsApi, handle } = await flatSetup();
      await settle();
      await handle.toggleFlat!();
      await settle();
      const first = jobsApi.started.at(-1)!.id;
      jobsApi.emit({ type: 'finished', id: first, state: 'done', summary: SUM });
      await settle();
      const n = jobsApi.started.length;
      jobsApi.emit({ type: 'dirsChanged', dirs: ['/other'] });
      await settle();
      expect(jobsApi.started).toHaveLength(n);
      jobsApi.emit({ type: 'dirsChanged', dirs: ['/data/Übersicht/x'] });
      await settle();
      expect(jobsApi.started).toHaveLength(n + 1);
      jobsApi.emit({
        type: 'finished',
        id: jobsApi.started.at(-1)!.id,
        state: 'done',
        summary: SUM,
      });
      await settle();
      store.hiddenVisible.set(true);
      await settle();
      expect(jobsApi.started).toHaveLength(n + 2);
      expect(jobsApi.started.at(-1)!.spec).toMatchObject({ criteria: { includeHidden: true } });
    });

    it('the root of a flat view is watched; Esc stops the listing', async () => {
      const { store, settle, jobsApi, handle } = await flatSetup();
      await settle();
      await handle.toggleFlat!();
      await settle();
      expect(watch.calls.at(-1)).toContain('/data');
      expect(store.resultBusy()).toBe(true);
      store.stopResult();
      expect(jobsApi.cancelled).toContain(jobsApi.started.at(-1)!.id);
    });
  });
});
