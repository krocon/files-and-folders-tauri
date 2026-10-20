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

  it('E5: showListing shows a known listing at once with the given cursor; clearListing empties', async () => {
    const known = listing('/k', [entry('x', { path: '/k/x' }), entry('y', { path: '/k/y' })]);
    store.showListing(known, { cursor: '/k/y', history: 'none', remember: false });
    expect(store.path()).toBe('/k');
    expect(store.cursorPath()).toBe('/k/y');
    expect(store.loading()).toBe(false);
    store.clearListing();
    expect(store.listing()).toBeNull();
    expect(store.path()).toBeNull();
  });
});
