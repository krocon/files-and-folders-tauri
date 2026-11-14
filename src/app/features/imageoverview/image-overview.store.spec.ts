import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { ImageOverviewApi } from '../../core/imageoverview/image-overview-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { WatchApi } from '../../core/watch/watch-api';
import { FakeImageOverviewApi, overviewItem } from '../../../testing/fake-image-overview-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeWatchApi } from '../../../testing/fake-watch-api';
import { dir, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { OpsStore } from '../ops/ops.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { OVERVIEW_ACTIONS, registerImageOverviewActions } from './image-overview-actions';
import { ImageOverviewStore } from './image-overview.store';
import { IMAGE_OVERVIEW_TEXTS } from './image-overview-texts';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ImageOverviewStore (design 074)', () => {
  let api: FakeImageOverviewApi;
  let fs: FakeFsApi;
  let watch: FakeWatchApi;
  let store: ImageOverviewStore;

  const five = () => [
    overviewItem(0, 'a.jpg'),
    overviewItem(1, 'b.jpg'),
    overviewItem(2, 'c.jpg'),
    overviewItem(3, 'd.jpg'),
    overviewItem(4, 'e.jpg'),
  ];

  beforeEach(() => {
    api = new FakeImageOverviewApi();
    fs = new FakeFsApi();
    fs.handler = (path) =>
      Promise.resolve(listing(path ?? '/', [dir('Tag 1', { path: `${path}/Tag 1` })]));
    watch = new FakeWatchApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: ImageOverviewApi, useValue: api },
        { provide: FsApi, useValue: fs },
        { provide: WatchApi, useValue: watch },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    store = TestBed.inject(ImageOverviewStore);
  });

  const open = async (cursor: string | null = null) => {
    const shown = store.show({ side: 'left', folder: '/fotos', cursor });
    await tick();
    api.deliver(five());
    await shown;
  };

  it('opens on the panel folder, starts on the panel cursor, lists the subfolders', async () => {
    await open('/fotos/c.jpg');
    expect(api.last()).toMatchObject({ root: '/fotos', recursive: false });
    expect(store.isOpen()).toBe(true);
    expect(store.items().map((i) => i.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);
    expect(store.cursor()).toBe(2);
    expect(store.subfolders().map((d) => d.name)).toEqual(['Tag 1']);
    expect(store.load().loading).toBe(false);
  });

  it('starts on the first image when the panel cursor is no image', async () => {
    await open('/fotos/notes.txt');
    expect(store.cursorPath()).toBe('/fotos/a.jpg');
  });

  it('drops events of an older request', async () => {
    const first = store.show({ side: 'left', folder: '/fotos', cursor: null });
    await tick();
    const old = api.last();
    const second = store.openFolder('/other');
    await tick();
    old.emit({ kind: 'items', items: [overviewItem(0, 'stale.jpg')] });
    api.deliver([overviewItem(0, 'new.jpg', { dir: '/other' })]);
    await Promise.all([first, second]);
    expect(store.items().map((i) => i.name)).toEqual(['new.jpg']);
    expect(api.closed).toContain(old.id);
  });

  it('moves in two directions; Shift marks the range; Space toggles', async () => {
    await open();
    store.move('right', 2, 1);
    store.move('down', 2, 1);
    expect(store.cursor()).toBe(3);
    store.move('left', 2, 1, true);
    store.move('left', 2, 1, true);
    expect([...store.marked()].sort()).toEqual(['/fotos/b.jpg', '/fotos/c.jpg', '/fotos/d.jpg']);
    store.toggleMark('/fotos/c.jpg');
    expect(store.markedEntries().map((e) => e.name)).toEqual(['b.jpg', 'd.jpg']);
    expect(store.cursorEntry()?.name).toBe('b.jpg');
    store.toggleAll();
    expect(store.marked().size).toBe(5);
    store.toggleAll();
    expect(store.marked().size).toBe(0);
  });

  it('removes deleted images at once, the cursor goes to the next one', async () => {
    await open('/fotos/b.jpg');
    store.toggleMark('/fotos/b.jpg');
    store.toggleMark('/fotos/e.jpg');
    store.afterJob('/fotos', ['/fotos/b.jpg', '/fotos/c.jpg'], true);
    expect(store.items().map((i) => i.name)).toEqual(['a.jpg', 'd.jpg', 'e.jpg']);
    expect(store.cursorPath()).toBe('/fotos/d.jpg');
    expect([...store.marked()]).toEqual(['/fotos/e.jpg']);
    // a copy only unmarks
    store.afterJob('/fotos', ['/fotos/e.jpg'], false);
    expect(store.items()).toHaveLength(3);
    expect(store.marked().size).toBe(0);
    // another folder: nothing happens
    store.afterJob('/elsewhere', ['/fotos/a.jpg'], true);
    expect(store.items()).toHaveLength(3);
  });

  it('follows the watcher: gone images leave, new ones list again in the background', async () => {
    await open();
    watch.emit({ type: 'changes', dir: '/fotos', upserted: [], removed: ['/fotos/a.jpg'] });
    expect(store.items()).toHaveLength(4);
    const before = api.opened.length;
    watch.emit({ type: 'rescan', dir: '/fotos' });
    await tick();
    expect(api.opened.length).toBe(before + 1);
    expect(store.items()).toHaveLength(4); // the old list stays until the new one is in
    api.deliver(five());
    expect(store.items()).toHaveLength(5);
  });

  it('includes subfolders on request – a new overview', async () => {
    await open();
    const p = store.setRecursive(true);
    await tick();
    expect(api.last().recursive).toBe(true);
    api.deliver([overviewItem(0, 'x.jpg', { rel: 'Tag 1/x.jpg', dir: '/fotos/Tag 1' })]);
    await p;
    expect(store.items()[0].rel).toBe('Tag 1/x.jpg');
    expect(store.dirOf('/fotos/Tag 1/x.jpg')).toBe('/fotos/Tag 1');
  });

  it('pages in the large view; the cursor follows; Esc returns to that tile', async () => {
    await open();
    store.openLarge(3);
    store.step(1);
    store.step(1);
    expect(store.large()).toBe(4);
    store.step(-10);
    expect(store.large()).toBe(0);
    expect(store.cursorPath()).toBe('/fotos/a.jpg');
    store.closeLarge();
    expect(store.large()).toBeNull();
  });

  it('keeps the tile size in the settings, within the limits', async () => {
    const settings = TestBed.inject(SettingsStore);
    store.zoom(1);
    expect(settings.get('imageOverview.tileSize')).toBe(250);
    store.setTileSize(9999);
    expect(store.tileSize()).toBe(640);
  });

  it('reports a folder that cannot be read', async () => {
    api.failOpen = { code: 'permission_denied', message: 'no', path: '/fotos' };
    await store.show({ side: 'left', folder: '/fotos', cursor: null });
    expect(store.load().error?.code).toBe('permission_denied');
    expect(store.errorText()).toBeTruthy();
  });

  it('closes: Rust drops the overview, the watcher forgets its folder', async () => {
    await open();
    const id = store.overviewId();
    store.close();
    expect(store.isOpen()).toBe(false);
    expect(api.closed).toContain(id);
    expect(store.items()).toEqual([]);
  });

  it('is the selection of the operations while open (E15)', async () => {
    const ops = TestBed.inject(OpsStore);
    await open('/fotos/b.jpg');
    expect(ops.selection().map((e) => e.name)).toEqual(['b.jpg']);
    store.toggleMark('/fotos/d.jpg');
    expect(ops.selection().map((e) => e.name)).toEqual(['d.jpg']);
    expect(ops.location()).toBe('/fotos');
    expect(ops.folder()).toBe('/fotos');
    store.close();
    expect(ops.location()).toBeNull(); // the panels again (none in this test)
  });

  it('vetoes panel actions while open, keeps the operations', async () => {
    const actions = TestBed.inject(ActionService);
    const ws = TestBed.inject(WorkspaceStore);
    const off = registerImageOverviewActions(actions, ws, store);
    actions.register({
      NAVIGATE_PARENT: { run: () => undefined },
      OPEN_COPY_DLG: { run: () => undefined },
    });
    expect(actions.state('NAVIGATE_PARENT')).toBe('ready');
    await open();
    expect(actions.state('NAVIGATE_PARENT')).toBe('disabled');
    expect(actions.state('OPEN_COPY_DLG')).toBe('ready');
    expect(OVERVIEW_ACTIONS.has('TOGGLE_IMAGE_OVERVIEW')).toBe(true);
    // no local folder in the active panel: a note instead
    store.close();
    await actions.run('TOGGLE_IMAGE_OVERVIEW');
    expect(actions.messages()).toContain(IMAGE_OVERVIEW_TEXTS.notLocal);
    off();
  });
});
