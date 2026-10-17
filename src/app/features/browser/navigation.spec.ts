import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing, parentRow } from '../../core/fs/fs.models';
import { FakeTableBridge } from '../../../testing/fake-table-bridge';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from './file-browser.store';
import { fileComparators } from './file-list/file-columns';
import { FileListController, TYPE_AHEAD_RESET_MS } from './file-list/file-list-controller';
import { createTabMemory, MAX_BACK, MAX_FOLDERS, pushEntry, rememberFolder } from './tab-memory';

const tree: Record<string, DirectoryListing> = {
  '/h': listing(
    '/h',
    [
      dir('A', { path: '/h/A' }),
      dir('B', { path: '/h/B' }),
      entry('x.txt', { path: '/h/x.txt' }),
      entry('.secret', { path: '/h/.secret', hidden: true }),
    ],
    '/',
  ),
  '/h/A': listing(
    '/h/A',
    [entry('a1', { path: '/h/A/a1' }), entry('a2', { path: '/h/A/a2' })],
    '/h',
  ),
  '/h/B': listing('/h/B', [entry('b1', { path: '/h/B/b1' })], '/h'),
};

describe('navigation (prompt 003)', () => {
  let api: FakeFsApi;
  let store: FileBrowserStore;
  let scroll = 0;

  beforeEach(async () => {
    api = new FakeFsApi();
    api.handler = (p) =>
      tree[p ?? '/h']
        ? Promise.resolve(tree[p ?? '/h'])
        : Promise.reject({ code: 'not_found', message: 'x', path: p });
    TestBed.configureTestingModule({
      providers: [FileBrowserStore, { provide: FsApi, useValue: api }],
    });
    store = TestBed.inject(FileBrowserStore);
    store.scrollTop = () => scroll;
    await store.load('/h');
  });

  it('goes back and forward with cursor and scroll position', async () => {
    store.setCursor('/h/A');
    scroll = 120;
    await store.load('/h/A');
    store.setCursor('/h/A/a2');
    scroll = 0;
    await store.load('/h/B');
    expect(store.canGoBack()).toBe(true);
    await store.back();
    expect(store.path()).toBe('/h/A');
    expect(store.cursorPath()).toBe('/h/A/a2');
    await store.back();
    expect(store.path()).toBe('/h');
    expect(store.cursorPath()).toBe('/h/A');
    expect(store.takePendingTableState()).toEqual({ scroll: { left: 0, top: 120 } });
    expect(store.canGoBack()).toBe(false);
    await store.forward();
    expect(store.path()).toBe('/h/A');
    await store.forward();
    expect(store.path()).toBe('/h/B');
    expect(store.canGoForward()).toBe(false);
  });

  it('a new visit clears forward; refresh does not enter the history', async () => {
    await store.load('/h/A');
    await store.back();
    await store.load('/h/B');
    expect(store.canGoForward()).toBe(false);
    await store.refresh();
    await store.back();
    expect(store.path()).toBe('/h');
  });

  it('restores cursor and marks when coming back to a folder', async () => {
    await store.load('/h/A');
    store.setCursor('/h/A/a2');
    store.setMarked(['/h/A/a1'], true);
    await store.up();
    expect(store.cursorPath()).toBe('/h/A');
    expect(store.marked().size).toBe(0);
    await store.load('/h/A');
    expect(store.cursorPath()).toBe('/h/A/a2');
    expect([...store.marked()]).toEqual(['/h/A/a1']);
  });

  it('remembers per tab memory: switching memory does not mix folders', async () => {
    await store.load('/h/A');
    store.setCursor('/h/A/a2');
    store.rememberCurrent();
    store.setMemory(createTabMemory());
    await store.load('/h/B', { history: 'none', remember: false });
    await store.load('/h/A');
    expect(store.cursorPath()).toBeNull(); // the other tab's memory is not visible here
  });

  it('filters hidden files and by pattern; ".." always passes', () => {
    const keep = () => store.rowFilter();
    const secret = tree['/h'].entries[3];
    expect(keep()(secret)).toBe(false);
    store.hiddenVisible.set(true);
    expect(keep()(secret)).toBe(true);
    store.setFilter({ hiddenVisible: true, filterActive: true, filterText: '*.txt' });
    expect(store.visibleEntries().map((e) => e.name)).toEqual(['x.txt']);
    expect(keep()(parentRow('/'))).toBe(true);
    store.setMarked(['/h/A'], true);
    expect(store.hiddenMarkedCount()).toBe(1);
  });

  it('filters 100 000 entries quickly', () => {
    const many = Array.from({ length: 100_000 }, (_, i) =>
      entry(`file ${i}.txt`, { path: `/big/${i}` }),
    );
    store.setFilter({ hiddenVisible: false, filterActive: true, filterText: '*9.txt' });
    const keep = store.rowFilter();
    const start = performance.now();
    const n = many.filter(keep).length;
    expect(n).toBe(10_000);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('never marks the ".." row', () => {
    store.toggleMark('/');
    store.setMarked(['/', '/h/A'], true);
    store.markAll(['/', '/h/A', '/h/x.txt']);
    expect([...store.marked()].sort()).toEqual(['/h/A', '/h/x.txt']);
    store.invertMarks(['/', '/h/A', '/h/B', '/h/x.txt']);
    expect([...store.marked()]).toEqual(['/h/B']);
  });

  it('calculates a folder size, shows it and cancels jobs when leaving', async () => {
    api.sizes['/h/A'] = 4096;
    await store.calcDirSize(tree['/h'].entries[0]);
    expect(store.entries()[0].size).toBe(4096);
    const gate = deferred<void>();
    api.sizeGate = gate.promise;
    const running = store.calcDirSize(tree['/h'].entries[1]);
    expect(store.sizeJobs()).toHaveLength(1);
    await store.load('/h/A');
    expect(api.cancelled).toHaveLength(1);
    gate.resolve();
    await running;
    expect(store.sizeJobs()).toHaveLength(0);
  });

  it('opens files with the default app and asks before running programs', async () => {
    await store.open(entry('x.txt', { path: '/h/x.txt' }));
    expect(api.opened).toEqual([{ path: '/h/x.txt', allowExecutable: false }]);
    api.executables.add('/h/tool');
    let asked = 0;
    store.confirmExecutable = () => (asked++, Promise.resolve(false));
    await store.open(entry('tool', { path: '/h/tool' }));
    expect(asked).toBe(1);
    expect(api.opened).toHaveLength(1);
    store.confirmExecutable = () => Promise.resolve(true);
    await store.open(entry('tool', { path: '/h/tool' }));
    expect(api.opened.at(-1)).toEqual({ path: '/h/tool', allowExecutable: true });
  });

  it('".." opens the parent', async () => {
    await store.load('/h/A');
    await store.open(parentRow('/h'));
    expect(store.path()).toBe('/h');
    expect(store.cursorPath()).toBe('/h/A');
  });
});

describe('tab memory', () => {
  it('bounds stacks without direct duplicates and keeps the last folders', () => {
    const m = createTabMemory();
    for (let i = 0; i < MAX_BACK + 10; i++) {
      pushEntry(m.back, { path: `/p${i}`, cursor: null, scrollTop: 0 });
    }
    pushEntry(m.back, { path: m.back.at(-1)!.path, cursor: 'c', scrollTop: 5 });
    expect(m.back).toHaveLength(MAX_BACK);
    expect(m.back.at(-1)?.cursor).toBe('c');
    for (let i = 0; i < MAX_FOLDERS + 5; i++) {
      rememberFolder(m, `/f${i}`, { cursor: null, marks: [], scrollTop: 0 });
    }
    expect(m.folders.size).toBe(MAX_FOLDERS);
    expect(m.folders.has('/f0')).toBe(false);
  });
});

describe('".." row and type-ahead in the list', () => {
  let store: FileBrowserStore;
  let bridge: FakeTableBridge;
  let ctrl: FileListController;

  beforeEach(async () => {
    const api = new FakeFsApi();
    api.handler = () =>
      Promise.resolve(
        listing('/h', [
          dir('Ärger', { path: '/h/Ärger' }),
          entry('alpha.txt', { path: '/h/alpha.txt' }),
          entry('beta.txt', { path: '/h/beta.txt' }),
          entry('my alpine.md', { path: '/h/alpine' }),
        ]),
      );
    TestBed.configureTestingModule({
      providers: [FileBrowserStore, { provide: FsApi, useValue: api }],
    });
    store = TestBed.inject(FileBrowserStore);
    await store.load('/h');
    bridge = new FakeTableBridge();
    ctrl = new FileListController(bridge, store);
    ctrl.showRows([parentRow('/'), ...store.entries()]);
  });

  it('keeps ".." on top in both sort directions', () => {
    const up = parentRow('/');
    const a = store.entries()[0];
    expect(fileComparators.name(null, null, up, a, 1)).toBe(-1);
    expect(-1 * fileComparators.name(null, null, up, a, -1)).toBe(-1);
    expect(fileComparators.size(null, null, a, up, -1) * -1).toBe(1);
  });

  it('does not mark ".." with Space or "mark all"', () => {
    expect(store.cursorPath()).toBe('/');
    ctrl.toggleMarkAndAdvance();
    expect(store.marked().size).toBe(0);
    ctrl.markAll();
    expect(store.marked().size).toBe(4);
  });

  it('jumps to the first name with the typed prefix, accent- and case-insensitive', () => {
    expect(ctrl.typeAhead('a', 0)).toBe('Ärger');
    expect(ctrl.typeAhead('l', 100)).toBe('alpha.txt');
    expect(ctrl.typeAhead('p', 200)).toBe('alpha.txt');
    expect(ctrl.typeAhead('i', 300)).toBe('my alpine.md'); // "alpi" only inside a name
    expect(ctrl.typeAhead('b', 300 + TYPE_AHEAD_RESET_MS + 1)).toBe('beta.txt');
    expect(store.cursorPath()).toBe('/h/beta.txt');
    expect(ctrl.typeAhead('z', 10_000)).toBeNull();
  });
});
