import { JobsApi } from '../../core/jobs/jobs-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from './file-browser.store';

describe('FileBrowserStore', () => {
  let api: FakeFsApi;
  let store: FileBrowserStore;

  beforeEach(() => {
    api = new FakeFsApi();
    TestBed.configureTestingModule({
      providers: [
        FileBrowserStore,
        { provide: FsApi, useValue: api },
        { provide: JobsApi, useValue: new FakeJobsApi() },
      ],
    });
    store = TestBed.inject(FileBrowserStore);
  });

  it('loads the home directory; cursor null = first displayed row', async () => {
    api.handler = () => Promise.resolve(listing('/home/ä ö', [dir('Docs'), entry('a.txt')]));
    await store.load();
    expect(api.calls).toEqual([undefined]);
    expect(store.path()).toBe('/home/ä ö');
    expect(store.entries().length).toBe(2);
    expect(store.cursorPath()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('keeps the previous listing and exposes a typed error on failure', async () => {
    api.handler = () => Promise.resolve(listing('/home', [dir('Locked')]));
    await store.load();
    api.handler = () =>
      Promise.reject({ code: 'permission_denied', message: 'denied', path: '/home/Locked' });
    await store.open(store.entries()[0]);
    expect(store.path()).toBe('/home');
    expect(store.error()).toEqual({
      code: 'permission_denied',
      message: 'denied',
      path: '/home/Locked',
    });
    expect(store.loading()).toBe(false);
  });

  it('opens directories and symlinks to directories, files only get the cursor', async () => {
    const link = entry('link', { kind: 'symlink', targetKind: 'directory', path: '/home/link' });
    api.handler = (p) =>
      Promise.resolve(listing(p ?? '/home', [dir('Sub', { path: '/home/Sub' }), link, entry('f')]));
    await store.load();
    await store.open(store.entries()[0]);
    expect(api.calls.at(-1)).toBe('/home/Sub');
    await store.open(link);
    expect(api.calls.at(-1)).toBe('/home/link');
    const before = api.calls.length;
    await store.open(entry('f'));
    expect(api.calls.length).toBe(before);
    expect(store.cursorPath()).toBe('/root/f');
  });

  it('does not open lossy-named folders', async () => {
    api.handler = () => Promise.resolve(listing('/x', []));
    await store.open(dir('bad', { lossyName: true }));
    expect(api.calls).toEqual([]);
  });

  it('goes up and puts the cursor on the folder it came from', async () => {
    api.handler = (p) =>
      Promise.resolve(
        p === '/home'
          ? listing('/home', [dir('A', { path: '/home/A' }), dir('B', { path: '/home/B' })], '/')
          : listing('/home/B', [], '/home'),
      );
    await store.load('/home/B');
    expect(store.canGoUp()).toBe(true);
    await store.up();
    expect(store.path()).toBe('/home');
    expect(store.cursorEntry()?.name).toBe('B');
  });

  it('cannot go up at the root', async () => {
    api.handler = () => Promise.resolve(listing('/', [], null));
    await store.load();
    expect(store.canGoUp()).toBe(false);
    await store.up();
    expect(api.calls.length).toBe(1);
  });

  it('ignores responses of superseded requests', async () => {
    const slow = deferred<DirectoryListing>();
    const fast = deferred<DirectoryListing>();
    api.handler = (p) => (p === '/slow' ? slow.promise : fast.promise);
    const first = store.load('/slow');
    const second = store.load('/fast');
    fast.resolve(listing('/fast', []));
    await second;
    slow.resolve(listing('/slow', []));
    await first;
    expect(store.path()).toBe('/fast');
    expect(store.loading()).toBe(false);
  });

  describe('marks', () => {
    const rows = [
      entry('a', { path: '/x/a' }),
      entry('b', { path: '/x/b' }),
      entry('c', { path: '/x/c' }),
    ];
    const displayed = ['/x/c', '/x/a', '/x/b']; // e.g. sorted descending by size

    beforeEach(async () => {
      api.handler = (p) => Promise.resolve(listing(p ?? '/x', rows));
      await store.load('/x');
    });

    it('toggles, sets and clears marks', () => {
      store.toggleMark('/x/a');
      expect(store.isMarked('/x/a')).toBe(true);
      store.toggleMark('/x/a');
      expect(store.isMarked('/x/a')).toBe(false);
      store.setMarked(['/x/a', '/x/b'], true);
      expect(store.markedEntries().map((e) => e.name)).toEqual(['a', 'b']);
      store.clearMarks();
      expect(store.marked().size).toBe(0);
    });

    it('marks a range in the displayed order, in both directions', () => {
      store.markRange('/x/b', '/x/c', displayed);
      expect([...store.marked()].sort()).toEqual(['/x/a', '/x/b', '/x/c']);
      store.clearMarks();
      store.markRange('/x/c', '/x/a', displayed);
      expect([...store.marked()].sort()).toEqual(['/x/a', '/x/c']);
      store.markRange('/x/c', '/nope', displayed);
      expect(store.marked().size).toBe(2);
    });

    it('marks all and inverts', () => {
      store.markAll(displayed);
      expect(store.marked().size).toBe(3);
      store.toggleMark('/x/a');
      store.invertMarks(displayed);
      expect([...store.marked()]).toEqual(['/x/a']);
    });

    it('keeps existing marks on refresh, clears them on folder change', async () => {
      store.setMarked(['/x/a', '/x/b'], true);
      api.handler = () => Promise.resolve(listing('/x', [rows[0], rows[2]]));
      await store.refresh();
      expect([...store.marked()]).toEqual(['/x/a']);
      api.handler = () => Promise.resolve(listing('/y', [entry('a', { path: '/y/a' })]));
      await store.load('/y');
      expect(store.marked().size).toBe(0);
    });

    it('keeps the cursor on refresh if the entry still exists', async () => {
      store.setCursor('/x/b');
      await store.refresh();
      expect(store.cursorPath()).toBe('/x/b');
      api.handler = () => Promise.resolve(listing('/x', [rows[0]]));
      await store.refresh();
      expect(store.cursorPath()).toBeNull();
    });
  });

  it('hands a pending table state out exactly once', () => {
    const store = TestBed.inject(FileBrowserStore);
    store.setPendingTableState({ version: 1, sort: [] });
    expect(store.takePendingTableState()).toEqual({ version: 1, sort: [] });
    expect(store.takePendingTableState()).toBeNull();
  });

  it('ignores up/open/refresh while a tab folder is being opened', async () => {
    const store = TestBed.inject(FileBrowserStore);
    store.navigationLocked.set(true);
    const before = api.calls.length;
    await store.refresh();
    await store.open(dir('X', { path: '/x' }));
    await store.up();
    expect(api.calls.length).toBe(before);
  });
});
