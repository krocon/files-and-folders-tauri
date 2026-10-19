import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { FakeJobsApi, job } from '../../../testing/fake-jobs-api';
import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore, TRANSFER_SIZE_INTERVAL_MS } from './file-browser.store';
import { afterEach, vi } from 'vitest';

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

  describe('size of a folder a copy is writing into', () => {
    let jobsApi: FakeJobsApi;
    let now: number;

    const progress = (bytesDone: number, destBytes: Record<string, number>) => ({
      bytesDone,
      bytesTotal: 4_300_000_000,
      itemsDone: 50,
      itemsTotal: 100,
      current: '/src/dalai/file.bin',
      rateBps: 50_000_000,
      destBytes,
    });

    const startCopy = (destBytes: Record<string, number>) =>
      jobsApi.emit({
        type: 'added',
        job: job(
          'copy1',
          { kind: 'copy', sources: ['/src/dalai'], targetDir: '/target' },
          { state: 'running', progress: progress(3_300_000_000, destBytes) },
        ),
      });

    beforeEach(async () => {
      jobsApi = TestBed.inject(JobsApi) as FakeJobsApi;
      await TestBed.inject(JobsStore).init();
      now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      api.handler = () =>
        Promise.resolve(listing('/target', [dir('dalai', { path: '/target/dalai' })]));
      await store.load('/target');
    });

    afterEach(() => vi.restoreAllMocks());

    it('follows the running copy instead of starting a size job', async () => {
      startCopy({ '/target/dalai': 3_300_000_000 });
      await store.calcDirSize(store.entries()[0]);
      expect(jobsApi.started.filter((s) => s.spec.kind === 'dirSize')).toHaveLength(0);
      expect(store.entries()[0].size).toBe(3_300_000_000);

      // within the interval the listing is left alone (each write re-sorts the table)
      jobsApi.emit({
        type: 'progress',
        id: 'copy1',
        progress: progress(3_500_000_000, { '/target/dalai': 3_500_000_000 }),
      });
      TestBed.flushEffects();
      expect(store.entries()[0].size).toBe(3_300_000_000);

      now += TRANSFER_SIZE_INTERVAL_MS;
      jobsApi.emit({
        type: 'progress',
        id: 'copy1',
        progress: progress(3_800_000_000, { '/target/dalai': 3_800_000_000 }),
      });
      TestBed.flushEffects();
      expect(store.entries()[0].size).toBe(3_800_000_000);

      // the final size comes at once
      jobsApi.emit({
        type: 'finished',
        id: 'copy1',
        state: 'done',
        summary: {
          itemsDone: 100,
          itemsSkipped: 0,
          itemsFailed: 0,
          bytesDone: 4_300_000_000,
          errors: [],
          error: null,
          dirSize: null,
          destBytes: { '/target/dalai': 4_300_000_000 },
        },
      });
      TestBed.flushEffects();
      expect(store.entries()[0].size).toBe(4_300_000_000);
    });

    it('calculates a folder the copy merges into (no live size reported) as usual', async () => {
      startCopy({});
      void store.calcDirSize(store.entries()[0]);
      await Promise.resolve();
      expect(jobsApi.started.filter((s) => s.spec.kind === 'dirSize')).toHaveLength(1);
    });
  });
});
