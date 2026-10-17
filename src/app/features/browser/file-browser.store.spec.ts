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
      providers: [FileBrowserStore, { provide: FsApi, useValue: api }],
    });
    store = TestBed.inject(FileBrowserStore);
  });

  it('loads the home directory and selects the first entry', async () => {
    api.handler = () => Promise.resolve(listing('/home/ä ö', [dir('Docs'), entry('a.txt')]));
    await store.load();
    expect(api.calls).toEqual([undefined]);
    expect(store.path()).toBe('/home/ä ö');
    expect(store.entries().length).toBe(2);
    expect(store.selectedEntry()?.name).toBe('Docs');
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

  it('opens directories and symlinks to directories, but not files', async () => {
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
    expect(store.selectedPath()).toBe('/root/f');
  });

  it('goes up and re-selects the folder it came from', async () => {
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
    expect(store.selectedEntry()?.name).toBe('B');
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

  it('moves the selection within bounds', async () => {
    api.handler = () => Promise.resolve(listing('/x', [entry('a'), entry('b'), entry('c')]));
    await store.load();
    store.moveSelection(1);
    expect(store.selectedEntry()?.name).toBe('b');
    store.moveSelection(10);
    expect(store.selectedEntry()?.name).toBe('c');
    store.moveSelection(-10);
    expect(store.selectedEntry()?.name).toBe('a');
    store.selectEdge('last');
    expect(store.selectedEntry()?.name).toBe('c');
  });
});
