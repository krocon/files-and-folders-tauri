import { TestBed } from '@angular/core/testing';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FakeWatchApi } from '../../../testing/fake-watch-api';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { WatchApi } from '../../core/watch/watch-api';
import { WatchService } from '../../core/watch/watch.service';
import { FileBrowserStore } from './file-browser.store';

/** Design 012 E3/E4: watcher deltas and coalesced reloads in the panel store. */
describe('FileBrowserStore – folder watching', () => {
  let api: FakeFsApi;
  let store: FileBrowserStore;
  const a = entry('a.txt', { path: '/w/a.txt' });
  const b = entry('b.txt', { path: '/w/b.txt' });
  const c = entry('c.txt', { path: '/w/c.txt' });
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
    api.handler = () => Promise.resolve(listing('/w', [sub, a, b, c]));
    await store.load('/w');
  });

  it('adds, replaces and removes entries by path; marks of removed ones go', () => {
    store.setMarked([a.path, b.path], true);
    const neu = entry('Neu 😀.txt', { path: '/w/Neu 😀.txt' });
    store.applyChanges('/w', [neu, { ...c, size: 99 }], [b.path]);
    expect(store.entries().map((e) => e.name)).toEqual(['Sub', 'a.txt', 'c.txt', 'Neu 😀.txt']);
    expect(store.entries().find((e) => e.path === c.path)?.size).toBe(99);
    expect([...store.marked()]).toEqual([a.path]);
  });

  it('moves the cursor from a removed entry to the next one in display order', () => {
    store.setCursor(b.path);
    const displayed = [sub, c, b, a]; // e.g. sorted by name descending
    store.applyChanges('/w', [], [b.path], displayed);
    expect(store.cursorPath()).toBe(a.path);
    store.setCursor(a.path);
    store.applyChanges('/w', [], [a.path], [sub, c, a]);
    expect(store.cursorPath()).toBe(c.path);
  });

  it('keeps the listing object when nothing changed (no repaint) and ignores other folders', () => {
    const before = store.listing();
    store.applyChanges('/w', [{ ...a }], []);
    store.applyChanges('/w', [], ['/w/never-existed']);
    store.applyChanges('/other', [entry('x', { path: '/other/x' })], [a.path]);
    expect(store.listing()).toBe(before);
  });

  it('keeps a calculated folder size when the watcher reports the folder', () => {
    store.applyDirSize(sub.path, 4096);
    store.applyChanges('/w', [{ ...sub, modifiedMs: 5 }], []);
    const s = store.entries().find((e) => e.path === sub.path);
    expect(s?.size).toBe(4096);
    expect(s?.modifiedMs).toBe(5);
  });

  it('applies deltas that arrived during a reload again to its (older) result', async () => {
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const reload = store.refresh();
    const d = entry('d.txt', { path: '/w/d.txt' });
    store.applyChanges('/w', [d], [a.path]);
    pending.resolve(listing('/w', [sub, a, b, c]));
    await reload;
    expect(store.entries().map((e) => e.name)).toEqual(['Sub', 'b.txt', 'c.txt', 'd.txt']);
    // afterwards deltas are not remembered any more
    api.handler = () => Promise.resolve(listing('/w', [a]));
    await store.refresh();
    expect(store.entries().map((e) => e.name)).toEqual(['a.txt']);
  });

  it('a cursor moved during a reload is kept (keys pressed while a flood reloads)', async () => {
    store.setCursor(a.path);
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const reload = store.refresh();
    store.setCursor(c.path);
    pending.resolve(listing('/w', [sub, a, b, c]));
    await reload;
    expect(store.cursorPath()).toBe(c.path);
  });

  it('queues one reload while a load runs, never several', async () => {
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const first = store.refresh();
    const calls = api.calls.length;
    store.requestRefresh();
    store.requestRefresh();
    store.requestRefresh();
    expect(api.calls.length).toBe(calls);
    api.handler = () => Promise.resolve(listing('/w', [a]));
    pending.resolve(listing('/w', [sub, a]));
    await first;
    await Promise.resolve();
    expect(api.calls.length).toBe(calls + 1);
    // no reload is queued for a folder that was left meanwhile
    const nav = deferred<DirectoryListing>();
    api.handler = () => nav.promise;
    const go = store.load('/elsewhere');
    store.requestRefresh();
    nav.resolve(listing('/elsewhere', []));
    await go;
    await Promise.resolve();
    expect(api.calls.at(-1)).toBe('/elsewhere');
  });

  it('deltas and a queued reload of a superseded load are dropped (review 012 #4c)', async () => {
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const stale = store.load('/w');
    store.applyChanges('/w', [entry('d.txt', { path: '/w/d.txt' })], []);
    store.requestRefresh();
    // a result tab replaces the folder that was still loading
    store.showSearch('k', [a]);
    pending.resolve(listing('/w', [sub, a]));
    await stale;
    const calls = api.calls.length;
    api.handler = () => Promise.resolve(listing('/w', [sub, a]));
    await store.load('/w');
    await Promise.resolve();
    expect(store.entries().map((e) => e.name)).toEqual(['Sub', 'a.txt']);
    expect(api.calls.length).toBe(calls + 1);
    // the same for a new load that supersedes an older one
    const older = deferred<DirectoryListing>();
    api.handler = () => older.promise;
    const first = store.load('/w');
    store.applyChanges('/w', [entry('e.txt', { path: '/w/e.txt' })], []);
    api.handler = () => Promise.resolve(listing('/w', [a]));
    await store.load('/w');
    older.resolve(listing('/w', []));
    await first;
    expect(store.entries().map((e) => e.name)).toEqual(['a.txt']);
  });

  it('a gone folder leads to the nearest existing ancestor', async () => {
    api.handler = (p) =>
      Promise.resolve({
        ...listing(p ?? '/', []),
        segments: [
          { name: '/', path: '/' },
          { name: 'w', path: '/w' },
          { name: 'x', path: '/w/x' },
          { name: 'y', path: '/w/x/y' },
        ],
      });
    await store.load('/w/x/y');
    api.handler = (p) =>
      p === '/w/x'
        ? Promise.reject({ code: 'not_found', message: 'gone', path: p })
        : Promise.resolve(listing(p ?? '/', []));
    await store.goToExistingAncestor();
    expect(store.path()).toBe('/w');
    expect(store.error()).toBeNull();
  });
});

describe('WatchService', () => {
  let api: FakeWatchApi;
  let service: WatchService;

  beforeEach(() => {
    api = new FakeWatchApi();
    TestBed.configureTestingModule({ providers: [{ provide: WatchApi, useValue: api }] });
    service = TestBed.inject(WatchService);
  });

  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  };

  it('watches the union of both panels once per change and keeps the status', async () => {
    api.modes.set('/net', 'off');
    service.setPanelDir('left', '/a');
    service.setPanelDir('right', '/a');
    await settle();
    expect(api.calls).toEqual([['/a']]);
    service.setPanelDir('right', '/net');
    await settle();
    expect(api.calls.at(-1)).toEqual(['/a', '/net']);
    expect(service.status('/net')?.mode).toBe('off');
    expect(service.status('/a')?.mode).toBe('native');
    service.setPanelDir('right', '/net');
    service.setPanelDir('left', null);
    await settle();
    expect(api.calls.at(-1)).toEqual(['/net']);
    expect(api.calls.length).toBe(3);
  });

  it('one watch_dirs call at a time; the last folders win (review 012 #1)', async () => {
    const gate = deferred<void>();
    api.hold = gate.promise;
    service.setPanelDir('left', '/a');
    await settle();
    service.setPanelDir('left', '/b');
    await settle();
    service.setPanelDir('left', '/c');
    await settle();
    expect(api.calls).toEqual([['/a']]);
    api.hold = null;
    gate.resolve();
    await settle();
    await settle();
    expect(api.calls).toEqual([['/a'], ['/c']]);
    expect([...service.statuses().keys()]).toEqual(['/c']);
  });

  it('reloads a newly watched folder once if it changed since it was listed (review 012 #6)', async () => {
    const got: string[] = [];
    service.on((e) => got.push(`${e.type}:${e.dir}`));
    api.modified.set('/a', 5_000);
    api.modified.set('/b', 1_000);
    service.setPanelDir('left', '/a', 9_000);
    service.setPanelDir('right', '/b', 9_000);
    await settle();
    expect(got).toEqual([]);
    api.modified.set('/a', 10_000);
    service.setPanelDir('right', '/c', 9_000);
    api.modified.set('/c', 9_500);
    await settle();
    // "/a" was watched already; "/c" changed after its listing started
    expect(got).toEqual(['rescan:/c']);
  });

  it('hands the events to every listener until it unsubscribes', async () => {
    const got: string[] = [];
    const off = service.on((e) => got.push(`1:${e.type}`));
    service.on((e) => got.push(`2:${e.type}`));
    await settle();
    api.emit({ type: 'rescan', dir: '/a' });
    off();
    api.emit({ type: 'gone', dir: '/a' });
    expect(got).toEqual(['1:rescan', '2:rescan', '2:gone']);
  });
});
