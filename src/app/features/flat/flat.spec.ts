import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { EMPTY_STATS, MAX_HITS, SearchHit } from '../../core/search/search.models';
import { SessionApi } from '../../core/session/session-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore, FlatNavigator } from '../browser/file-browser.store';
import { compareRelDirs, fileComparators } from '../browser/file-list/file-columns';
import { SearchStore } from '../search/search.store';
import { newTab, WorkspaceStore } from '../workspace/workspace.store';
import { canShowFlat, registerFlatActions } from './flat-actions';
import { ACTIONS_MENU_COLUMNS } from '../actions/actions-menu-def';
import { ACT_TEXTS } from '../actions/actions-texts';
import { flatCriteria, flatOptionsOf, relDirOf, shouldRefresh } from './flat-logic';

const SUMMARY: Summary = {
  itemsDone: 0,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const hit = (name: string, relDir = '', root = '/r'): SearchHit => {
  const folder = relDir ? `${root}/${relDir}` : root;
  return {
    ...entry(name, { path: `${folder}/${name}` }),
    dir: folder,
    relDir,
    parentNames: ['', '', ''],
  };
};

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('flat view logic (design 038)', () => {
  it('lists everything below the root, links as entries that are never followed', () => {
    const c = flatCriteria('/r', { includeHidden: false, showDirs: false });
    expect(c).toMatchObject({
      roots: ['/r'],
      name: '',
      kinds: { files: true, dirs: false, links: true },
      includeHidden: false,
      followLinks: false,
      excludes: [],
      maxHits: MAX_HITS,
      skipVirtualFs: true,
    });
    const shown = flatCriteria('/r', { includeHidden: true, showDirs: true });
    expect(shown.kinds.dirs).toBe(true);
    expect(shown.includeHidden).toBe(true);
    expect(flatOptionsOf(shown)).toEqual({ includeHidden: true, showDirs: true });
  });

  it('sorts relative folders: the root first, then natural and without case', () => {
    const dirs = ['b', '', 'A/x10', 'a/x9', 'a'];
    expect([...dirs].sort(compareRelDirs)).toEqual(['', 'a', 'a/x9', 'A/x10', 'b']);
    const cmp = fileComparators.relDir;
    const rows = [hit('z', 'b'), hit('y', ''), hit('x', 'b'), hit('w', 'a')];
    rows.sort((p, q) => cmp(null, null, p, q, 1));
    expect(rows.map((r) => `${relDirOf(r)}/${r.name}`)).toEqual(['/y', 'a/w', 'b/x', 'b/z']);
    expect(relDirOf(entry('plain'))).toBe('');
  });

  it('refreshes on changes at or below the root (and above it), not next to it', () => {
    expect(shouldRefresh('/a/b', ['/a/b'])).toBe(true);
    expect(shouldRefresh('/a/b', ['/x', '/a/b/c/d'])).toBe(true);
    expect(shouldRefresh('/a/b', ['/a/bc'])).toBe(false);
    expect(shouldRefresh('/a/b', ['/a/c'])).toBe(false);
    expect(shouldRefresh('/a/b', ['/a'])).toBe(true);
    expect(shouldRefresh('C:\\d', ['C:\\d\\e'])).toBe(true);
    expect(shouldRefresh('/', ['/etc'])).toBe(true);
  });
});

describe('SearchStore: flat results (design 038)', () => {
  let jobsApi: FakeJobsApi;
  let search: SearchStore;
  let ws: WorkspaceStore;

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: jobsApi },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    await TestBed.inject(JobsStore).init();
    search = TestBed.inject(SearchStore);
    ws = TestBed.inject(WorkspaceStore);
  });

  const emitHits = (id: string, list: SearchHit[]) =>
    jobsApi.emit({
      type: 'searchHits',
      id,
      hits: list,
      stats: { ...EMPTY_STATS, hits: list.length },
    });
  const finish = (id: string, state: 'done' | 'cancelled' | 'failed' = 'done') =>
    jobsApi.emit({ type: 'finished', id, state, summary: SUMMARY });

  /** Starts a flat result shown by the active left tab. */
  async function startFlat(options = { includeHidden: false, showDirs: false }) {
    const tab = ws.activeTab('left');
    let key = '';
    const error = await search.startFlat('/r', options, (k) => {
      key = k;
      ws.updateTab(tab.id, {
        search: {
          key: k,
          label: 'r',
          flat: { root: '/r', cursorBefore: null, tableBefore: null, showDirs: false },
        },
      });
      return true;
    });
    expect(error).toBeNull();
    return key;
  }

  it('starts a search job without criteria and keeps the result while the tab shows it', async () => {
    const key = await startFlat();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'search',
      criteria: flatCriteria('/r', { includeHidden: false, showDirs: false }),
    });
    const r = search.result(key)!;
    expect(r.kind).toBe('flat');
    expect(r.running).toBe(true);
    emitHits('j1', [hit('a.txt'), hit('b.txt', 'sub')]);
    finish('j1');
    await wait();
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['a.txt', 'b.txt']);
    // the tab leaves the flat view: the result is released
    ws.updateTab(ws.activeTab('left').id, { search: null });
    TestBed.tick();
    expect(search.result(key)).toBeUndefined();
  });

  it('a refused start opens nothing', async () => {
    jobsApi.refuse = { code: 'not_found', message: 'gone', path: '/r' };
    const attach = vi.fn();
    const error = await search.startFlat('/r', { includeHidden: false, showDirs: false }, attach);
    expect(error?.code).toBe('not_found');
    expect(attach).not.toHaveBeenCalled();
  });

  it('refresh keeps the old rows until the new listing is complete', async () => {
    const key = await startFlat();
    emitHits('j1', [hit('a.txt'), hit('old.txt')]);
    finish('j1');
    await wait();
    search.refresh(key);
    await wait();
    expect(jobsApi.started).toHaveLength(2);
    expect(search.result(key)!.refreshing).toBe(true);
    expect(search.result(key)!.running).toBe(false);
    emitHits('j2', [hit('a.txt')]);
    await wait(400); // longer than the publish throttle: still the old rows
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['a.txt', 'old.txt']);
    emitHits('j2', [hit('new.txt', 'x')]);
    finish('j2');
    await wait();
    const r = search.result(key)!;
    expect(r.hits.map((h) => h.name)).toEqual(['a.txt', 'new.txt']);
    expect(r.refreshing).toBe(false);
  });

  it('a cancelled refresh keeps the old rows', async () => {
    const key = await startFlat();
    emitHits('j1', [hit('a.txt')]);
    finish('j1');
    await wait();
    search.refresh(key);
    await wait();
    emitHits('j2', []);
    finish('j2', 'cancelled');
    await wait();
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['a.txt']);
    expect(search.result(key)!.refreshing).toBe(false);
  });

  it('refreshes asked for while a listing runs: exactly one more, with the newest options', async () => {
    const key = await startFlat();
    search.refresh(key);
    search.refresh(key, { includeHidden: true });
    search.refresh(key);
    expect(jobsApi.started).toHaveLength(1);
    finish('j1');
    await wait();
    expect(jobsApi.started).toHaveLength(2);
    expect(jobsApi.started[1].spec).toEqual({
      kind: 'search',
      criteria: flatCriteria('/r', { includeHidden: true, showDirs: false }),
    });
    finish('j2');
    await wait();
    expect(jobsApi.started).toHaveLength(2);
    expect(search.result(key)!.criteria.includeHidden).toBe(true);
  });

  it('"Search again" (after rename, Ctrl+R) of a flat view is a background refresh', async () => {
    const key = await startFlat();
    emitHits('j1', [hit('a.txt')]);
    finish('j1');
    await wait();
    await search.rerun(key);
    await wait();
    expect(search.result(key)!.hits).toHaveLength(1);
    expect(search.result(key)!.refreshing).toBe(true);
  });

  it('watcher refreshes keep a gap after the last listing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      const key = await startFlat();
      finish('j1');
      await vi.advanceTimersByTimeAsync(0);
      search.requestRefresh(key);
      search.requestRefresh(key);
      expect(jobsApi.started).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(jobsApi.started).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('review B1: a result released while its refresh starts does not come back', async () => {
    const key = await startFlat();
    finish('j1');
    await wait();
    search.refresh(key); // job being started …
    ws.updateTab(ws.activeTab('left').id, { search: null }); // … the tab leaves the flat view
    TestBed.tick();
    await wait();
    expect(search.result(key)).toBeUndefined();
    expect(jobsApi.cancelled).toContain('j2');
  });

  it('review B2: a flat start nobody shows is released and cancelled', async () => {
    const error = await search.startFlat(
      '/r',
      { includeHidden: false, showDirs: false },
      () => false,
    );
    expect(error).toBeNull();
    expect([...search.results().keys()]).toEqual([]);
    expect(jobsApi.cancelled).toEqual(['j1']);
  });

  it('review B3: Esc during a listing also drops a queued refresh', async () => {
    const key = await startFlat();
    search.refresh(key);
    search.stop(key);
    finish('j1', 'cancelled');
    await wait();
    expect(jobsApi.started).toHaveLength(1);
    expect(search.result(key)!.cancelled).toBe(true);
  });

  it('review B7: after renaming, the cursor follows the new name', async () => {
    const key = await startFlat();
    emitHits('j1', [hit('a.txt', 'x')]);
    finish('j1');
    await wait();
    await search.rerun(key, '/r/x/b.txt');
    await wait();
    emitHits('j2', [hit('b.txt', 'x')]);
    finish('j2');
    await wait();
    expect(search.result(key)!.focus?.path).toBe('/r/x/b.txt');
  });

  it('removePaths drops deleted rows at once, also from a running refresh', async () => {
    const key = await startFlat();
    emitHits('j1', [hit('a.txt'), hit('b.txt', 'sub')]);
    finish('j1');
    await wait();
    search.refresh(key);
    await wait();
    emitHits('j2', [hit('a.txt'), hit('b.txt', 'sub')]);
    search.removePaths(key, ['/r/sub']);
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['a.txt']);
    finish('j2');
    await wait();
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['a.txt']);
  });
});

describe('FileBrowserStore in a flat view (design 038 E6)', () => {
  let store: FileBrowserStore;
  let nav: {
    leave: ReturnType<typeof vi.fn>;
    up: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
      ],
    });
    store = TestBed.runInInjectionContext(() => new FileBrowserStore());
    nav = {
      leave: vi.fn(() => Promise.resolve()),
      up: vi.fn(() => Promise.resolve()),
      refresh: vi.fn(),
    };
    store.flatNav = nav as unknown as FlatNavigator;
    const sub: SearchHit = {
      ...dir('sub', { path: '/r/sub' }),
      dir: '/r',
      relDir: '',
      parentNames: ['', '', ''],
    };
    store.showSearch('f1', [hit('a.txt'), sub], 'flat');
  });

  it('is a result without a folder: no path, sorted by path, no ".." row', () => {
    expect(store.flat()).toBe(true);
    expect(store.path()).toBeNull();
    expect(store.parent()).toBeNull();
    expect(store.takePendingTableState()).toEqual({
      sort: [{ property: 'relDir', sortState: 'asc' }],
    });
  });

  it('Back and "up" leave the flat view, Enter on a folder goes there in the same tab', async () => {
    expect(store.canGoBack()).toBe(true);
    expect(store.canGoUp()).toBe(true);
    await store.back();
    expect(nav.leave).toHaveBeenCalledWith();
    await store.up();
    expect(nav.up).toHaveBeenCalled();
    await store.open(store.entries()[1]);
    expect(nav.leave).toHaveBeenLastCalledWith({ navigate: '/r/sub', cursor: null });
  });

  it('Ctrl+R lists again in the background', async () => {
    await store.refresh();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('cursor and marks stay while the same flat result is refreshed', () => {
    store.setCursor('/r/a.txt');
    store.marked.set(new Set(['/r/a.txt', '/r/sub']));
    store.showSearch('f1', [hit('a.txt'), hit('c.txt')], 'flat');
    expect(store.cursorPath()).toBe('/r/a.txt');
    expect([...store.marked()]).toEqual(['/r/a.txt']);
  });
});

describe('flat view actions and session (design 038 E1/E7)', () => {
  let ws: WorkspaceStore;
  let store: FileBrowserStore;
  let actions: ActionService;
  let toggled = 0;
  let dirs: boolean[] = [];

  beforeEach(async () => {
    const fs = new FakeFsApi();
    fs.handler = (p) =>
      Promise.resolve({
        path: p ?? '/r',
        parent: '/',
        segments: [{ name: 'r', path: p ?? '/r' }],
        entries: [entry('a.txt', { path: '/r/a.txt' })],
        unreadableEntries: 0,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    ws = TestBed.inject(WorkspaceStore);
    actions = TestBed.inject(ActionService);
    store = TestBed.runInInjectionContext(() => new FileBrowserStore());
    toggled = 0;
    dirs = [];
    ws.registerPanel('left', {
      store,
      controller: () => undefined,
      toggleFlat: () => {
        toggled++;
        return Promise.resolve();
      },
      setFlatDirs: (v) => dirs.push(v),
    });
    ws.setActive('left');
    registerFlatActions(actions, ws);
    await store.load('/r');
  });

  it('Mod+B is on in a checked local folder, off in a result tab and while loading', async () => {
    expect(canShowFlat(ws)).toBe(true);
    expect(actions.state('TOGGLE_FLAT_VIEW')).toBe('ready');
    expect(actions.state('TOGGLE_FLAT_VIEW_DIRS')).toBe('disabled');
    await actions.run('TOGGLE_FLAT_VIEW');
    expect(toggled).toBe(1);
    // a search result tab: no flat view of it
    ws.updateTab(ws.activeTab('left').id, { search: { key: 's1', label: '*' } });
    expect(canShowFlat(ws)).toBe(false);
    expect(actions.state('TOGGLE_FLAT_VIEW')).toBe('disabled');
  });

  it('in a flat view Mod+B turns it off and "Show folders" toggles', async () => {
    const flat = { root: '/r', cursorBefore: '/r/a.txt', tableBefore: null, showDirs: false };
    ws.updateTab(ws.activeTab('left').id, { search: { key: 'f1', label: 'r', flat } });
    expect(actions.state('TOGGLE_FLAT_VIEW')).toBe('ready');
    expect(actions.state('TOGGLE_FLAT_VIEW_DIRS')).toBe('ready');
    await actions.run('TOGGLE_FLAT_VIEW_DIRS');
    expect(dirs).toEqual([true]);
  });

  it('the Actions menu lists Toggle Flat View under Toggle Hidden Files', () => {
    const first = ACTIONS_MENU_COLUMNS[0];
    expect(first[first.indexOf('TOGGLE_HIDDEN_FILES') + 1]).toBe('TOGGLE_FLAT_VIEW');
    expect(ACT_TEXTS.menu['TOGGLE_FLAT_VIEW']).toBe('Toggle Flat View');
  });

  it('the Actions menu lists Quick View under Toggle Shell', () => {
    const first = ACTIONS_MENU_COLUMNS[0];
    expect(first[first.indexOf('TOGGLE_SHELL') + 1]).toBe('QUICK_VIEW');
    expect(ACT_TEXTS.menu['QUICK_VIEW']).toBe('Toggle Quick View');
  });

  it('a flat view is saved as its folder with the cursor of the normal view', () => {
    const tab = { ...newTab('/r', 'r'), cursor: null };
    ws.restore({
      ...ws.snapshot(),
      panels: { left: { activeTab: 0, tabs: [tab] }, right: { activeTab: 0, tabs: [newTab('/')] } },
    });
    const flat = { root: '/r', cursorBefore: '/r/a.txt', tableBefore: null, showDirs: true };
    ws.updateTab(tab.id, { search: { key: 'f1', label: 'r', rootTitle: 'r', flat } });
    const saved = ws.snapshot().panels.left.tabs[0];
    expect(saved).toMatchObject({ id: tab.id, path: '/r', title: 'r', cursor: '/r/a.txt' });
    expect('search' in saved).toBe(false);
  });
});
