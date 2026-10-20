import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { FileBrowserStore, refreshGapMs, SLOW_LOAD_MS } from './file-browser.store';

/** Design 029: the panel stays usable while a folder is slow. */
describe('FileBrowserStore – slow folders (design 029)', () => {
  let api: FakeFsApi;
  let store: FileBrowserStore;
  const a = entry('a.txt', { path: '/w/a.txt' });
  const b = entry('b.txt', { path: '/w/b.txt' });
  const sub = dir('Sub', { path: '/w/Sub' });

  beforeEach(async () => {
    api = new FakeFsApi();
    TestBed.configureTestingModule({
      providers: [
        FileBrowserStore,
        { provide: FsApi, useValue: api },
        { provide: JobsApi, useValue: new FakeJobsApi() },
      ],
    });
    store = TestBed.inject(FileBrowserStore);
    api.handler = () => Promise.resolve(listing('/w', [sub, a, b]));
    await store.load('/w');
  });

  afterEach(() => vi.useRealTimers());

  it('E1: a refresh keeps the list and shows no loading state', async () => {
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const reload = store.refresh();
    expect(store.loading()).toBe(false);
    expect(store.refreshing()).toBe(true);
    expect(store.entries().length).toBe(3);
    pending.resolve(listing('/w', [a]));
    await reload;
    expect(store.refreshing()).toBe(false);
    expect(store.entries().map((e) => e.name)).toEqual(['a.txt']);
  });

  it('E1: a navigation supersedes a running refresh; a refresh does not start during a navigation', async () => {
    const stale = deferred<DirectoryListing>();
    api.handler = () => stale.promise;
    const reload = store.refresh();
    api.handler = (p) => Promise.resolve(listing(p ?? '/', []));
    const nav = store.load('/x');
    expect(store.refreshing()).toBe(false);
    expect(store.loading()).toBe(true);
    const calls = api.calls.length;
    await store.refresh();
    expect(api.calls.length).toBe(calls);
    await nav;
    stale.resolve(listing('/w', [a]));
    await reload;
    expect(store.path()).toBe('/x');
  });

  it('E2: no gap after fast listings, 2× the listing time after slow ones', () => {
    expect(refreshGapMs(5)).toBe(0);
    expect(refreshGapMs(199)).toBe(0);
    expect(refreshGapMs(200)).toBe(1000);
    expect(refreshGapMs(3000)).toBe(6000);
    expect(refreshGapMs(60_000)).toBe(10_000);
  });

  it('E2: automatic reloads of a slow folder wait for the gap, one at a time', async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    // a slow listing: 1.5 s
    api.handler = () => {
      now += 1500;
      return Promise.resolve(listing('/w', [sub, a, b]));
    };
    await store.refresh();
    const calls = api.calls.length;
    store.requestRefresh();
    store.requestRefresh();
    expect(api.calls.length).toBe(calls);
    await vi.advanceTimersByTimeAsync(2999);
    expect(api.calls.length).toBe(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.calls.length).toBe(calls + 1);
    // a navigation drops the waiting reload
    store.requestRefresh();
    api.handler = (p) => Promise.resolve(listing(p ?? '/', []));
    await store.load('/elsewhere');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.calls.at(-1)).toBe('/elsewhere');
  });

  it('E4: a navigation is reported slow after 2 s and can be cancelled; the list stays', async () => {
    vi.useFakeTimers();
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const nav = store.load('/hanging');
    expect(store.slow()).toBe(false);
    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS);
    expect(store.slow()).toBe(true);
    expect(store.canGoUp()).toBe(store.parent() !== null);
    expect(store.cancelLoad()).toBe(true);
    expect(store.loading()).toBe(false);
    expect(store.slow()).toBe(false);
    pending.resolve(listing('/hanging', []));
    await nav;
    expect(store.path()).toBe('/w');
    expect(store.cancelLoad()).toBe(false);
  });

  it('E4: a refresh is never reported slow', async () => {
    vi.useFakeTimers();
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const reload = store.refresh();
    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS * 2);
    expect(store.slow()).toBe(false);
    pending.resolve(listing('/w', [a]));
    await reload;
  });

  it('E5: clearListing empties the panel', async () => {
    store.clearListing();
    expect(store.listing()).toBeNull();
    expect(store.path()).toBeNull();
  });

  it('review #5: the cursor moved while a slow navigation ran is the one Back restores', async () => {
    store.setCursor(a.path);
    const pending = deferred<DirectoryListing>();
    api.handler = (p) =>
      p === '/x' ? pending.promise : Promise.resolve(listing('/w', [sub, a, b]));
    const nav = store.load('/x');
    store.setCursor(b.path); // the old list stays usable (E3)
    pending.resolve(listing('/x', []));
    await nav;
    await store.back();
    expect(store.path()).toBe('/w');
    expect(store.cursorPath()).toBe(b.path);
  });

  describe('folder cache (design 030)', () => {
    const smb = (p: string, names: string[]) => ({
      ...listing(
        p,
        names.map((n) => entry(n, { path: `${p}/${n}` })),
      ),
      network: true,
    });

    it('a network folder visited before is shown at once, unchecked, then checked', async () => {
      api.handler = (p) => Promise.resolve(smb(p ?? '/', ['a.txt']));
      await store.load('/smb/serien');
      await store.load('/smb/serien/sub');
      const pending = deferred<DirectoryListing>();
      api.handler = () => pending.promise;
      const calls = api.calls.length;
      await store.load('/smb/serien');
      // at once, from the cache – in the history like a normal visit
      expect(store.path()).toBe('/smb/serien');
      expect(store.cachedAt()).not.toBeNull();
      expect(store.loading()).toBe(false);
      expect(store.refreshing()).toBe(true);
      expect(store.canGoBack()).toBe(true);
      expect(api.calls.slice(calls)).toEqual(['/smb/serien']);
      pending.resolve(smb('/smb/serien', ['a.txt', 'neu.txt']));
      await vi.waitFor(() => expect(store.cachedAt()).toBeNull());
      expect(store.entries().map((e) => e.name)).toEqual(['a.txt', 'neu.txt']);
    });

    it('back into a cached folder restores the cursor it had', async () => {
      api.handler = (p) =>
        Promise.resolve(p === '/smb' ? smb('/smb', ['x', 'y']) : smb(p ?? '/', []));
      await store.load('/smb');
      store.setCursor('/smb/y');
      await store.load('/smb/inner');
      api.handler = () => new Promise(() => undefined); // the server hangs
      await store.back();
      expect(store.path()).toBe('/smb');
      expect(store.cursorPath()).toBe('/smb/y');
      expect(store.cachedAt()).not.toBeNull();
    });

    it('a fast local folder is not kept; a gone one is forgotten', async () => {
      api.handler = (p) => Promise.resolve(listing(p ?? '/', []));
      await store.load('/lokal');
      await store.load('/w');
      const calls = api.calls.length;
      await store.load('/lokal');
      expect(store.cachedAt()).toBeNull();
      expect(api.calls.length).toBe(calls + 1);
      // a network folder that is gone now: error, and out of the cache
      api.handler = (p) => Promise.resolve(smb(p ?? '/', []));
      await store.load('/smb/weg');
      await store.load('/w');
      api.handler = (p) =>
        p === '/smb/weg'
          ? Promise.reject({ code: 'not_found', message: 'gone', path: p })
          : Promise.resolve(listing(p ?? '/', []));
      await store.load('/smb/weg');
      await vi.waitFor(() => expect(store.error()?.code).toBe('not_found'));
      await store.load('/w');
      const before = api.calls.length;
      void store.load('/smb/weg');
      expect(store.path()).toBe('/w'); // no cache hit any more
      expect(api.calls.length).toBe(before + 1);
    });

    it('review #2: a failed or cancelled navigation away does not leave the cached folder unchecked', async () => {
      api.handler = (p) => Promise.resolve(smb(p ?? '/', ['a']));
      await store.load('/smb/a');
      await store.load('/smb/b');
      const check = deferred<DirectoryListing>();
      api.handler = (p) =>
        p === '/smb/a'
          ? check.promise
          : Promise.reject({ code: 'permission_denied', message: 'no', path: p });
      await store.load('/smb/a'); // from the cache, check running
      await store.load('/locked'); // supersedes the check, fails
      expect(store.path()).toBe('/smb/a');
      check.resolve(smb('/smb/a', ['a']));
      await vi.waitFor(() => expect(store.cachedAt()).toBeNull());
      // the same after Esc
      api.handler = (p) => Promise.resolve(smb(p ?? '/', ['a']));
      await store.load('/smb/b');
      const check2 = deferred<DirectoryListing>();
      api.handler = (p) => (p === '/smb/a' ? check2.promise : new Promise(() => undefined));
      await store.load('/smb/a');
      void store.load('/haengt');
      store.cancelLoad();
      check2.resolve(smb('/smb/a', ['a']));
      await vi.waitFor(() => expect(store.cachedAt()).toBeNull());
    });
  });
});
