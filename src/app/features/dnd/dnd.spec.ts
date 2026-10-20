import { TestBed } from '@angular/core/testing';
import { KeymapApi } from '../../core/actions/keymap-api';
import { DragDropApi } from '../../core/dnd/drag-drop-api';
import { FsApi } from '../../core/fs/fs-api';
import { DirEntry, parentRow } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SessionApi } from '../../core/session/session-api';
import { Side } from '../../core/session/session.models';
import { WatchApi } from '../../core/watch/watch-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { OsDragApi } from '../../core/dnd/os-drag-api';
import { FakeDragDropApi, FakeOsDragApi, FakeWatchApi } from '../../../testing/fake-watch-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { OpsStore } from '../ops/ops.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  dragKeyAction,
  dragKind,
  dragOriginDir,
  dragSources,
  DragOrigin,
  leavingAtEdge,
  leftWindow,
  panelZoneHit,
  resolveDropTarget,
  tabZoneHit,
  ZoneHit,
} from './dnd-logic';
import { DragStore } from './drag.store';

const a = entry('a.txt', { path: '/src/a.txt' });
const b = entry('b.txt', { path: '/src/b.txt' });
const folder = dir('Ordner äö', { path: '/src/Ordner äö' });
const up = parentRow('/');

describe('dnd-logic (design 012 E5)', () => {
  it('drags the marking if the pressed row is marked, else only the row – never ".."', () => {
    const marked = new Set([a.path, b.path]);
    const isMarked = (p: string) => marked.has(p);
    expect(dragSources(a, isMarked, [a, b])).toEqual([a, b]);
    expect(dragSources(folder, isMarked, [a, b])).toEqual([folder]);
    expect(dragSources(up, isMarked, [a, b])).toBeNull();
    expect(dragSources(null, isMarked, [])).toBeNull();
  });

  it('copies by default; Shift moves (Windows/Linux), ⌘ moves (macOS)', () => {
    expect(dragKind({ shiftKey: false, metaKey: false }, false)).toBe('copy');
    expect(dragKind({ shiftKey: true, metaKey: false }, false)).toBe('move');
    expect(dragKind({ shiftKey: false, metaKey: true }, false)).toBe('copy');
    expect(dragKind({ shiftKey: false, metaKey: true }, true)).toBe('move');
    expect(dragKind({ shiftKey: true, metaKey: false }, true)).toBe('copy');
  });

  it('links with Ctrl+Shift (Windows/Linux) or ⌘⌥ (macOS) – design 031 E7', () => {
    const mods = (m: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey', boolean>>) => ({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...m,
    });
    expect(dragKind(mods({ ctrlKey: true, shiftKey: true }), false)).toBe('link');
    expect(dragKind(mods({ ctrlKey: true }), false)).toBe('copy');
    expect(dragKind(mods({ altKey: true, shiftKey: true }), false)).toBe('move');
    expect(dragKind(mods({ metaKey: true, altKey: true }), true)).toBe('link');
    expect(dragKind(mods({ altKey: true }), true)).toBe('copy');
    expect(dragKind(mods({ ctrlKey: true, shiftKey: true }), true)).toBe('copy');
  });

  const origin: DragOrigin = { side: 'left', dir: '/src', paths: new Set([a.path]) };
  const hit = (side: Side, panelDir: string | null, row: DirEntry | null): ZoneHit => ({
    side,
    panelDir,
    panelName: 'name',
    row,
  });

  it('a folder row is the target, otherwise the panel – not the own folder', () => {
    const sub = dir('Archiv', { path: '/dst/Archiv' });
    expect(resolveDropTarget(hit('right', '/dst', sub), origin)).toEqual({
      side: 'right',
      dir: '/dst/Archiv',
      rowPath: '/dst/Archiv',
      name: 'Archiv',
    });
    expect(resolveDropTarget(hit('right', '/dst', entry('f', { path: '/dst/f' })), origin)).toEqual(
      { side: 'right', dir: '/dst', rowPath: null, name: 'name' },
    );
    // same panel: only onto a folder row; ".." = the parent folder
    expect(resolveDropTarget(hit('left', '/src', b), origin)).toBeNull();
    expect(resolveDropTarget(hit('left', '/src', folder), origin)?.dir).toBe('/src/Ordner äö');
    expect(resolveDropTarget(hit('left', '/src', up), origin)).toMatchObject({
      dir: '/',
      name: '..',
    });
    expect(resolveDropTarget(null, origin)).toBeNull();
  });

  it('never into a dragged folder or a link to a lossy name', () => {
    const own: DragOrigin = { side: 'left', dir: '/src', paths: new Set([folder.path]) };
    expect(resolveDropTarget(hit('left', '/src', folder), own)).toBeNull();
    const lossy = dir('x', { path: '/dst/x', lossyName: true });
    expect(resolveDropTarget(hit('right', '/dst', lossy), own)?.rowPath).toBeNull();
    // the other panel shows the same folder: nothing to do there
    expect(resolveDropTarget(hit('right', '/src', null), own)).toBeNull();
  });
});

describe('dnd-logic – result tabs and keys (review 012)', () => {
  const hits = [entry('a.txt', { path: '/x/a.txt' })];
  const resultTab = {
    path: () => null,
    locationKey: () => 'search:k1',
    listing: () => listing('search:k1', hits),
  };
  const folder = {
    path: () => '/w',
    locationKey: () => '/w',
    listing: () => ({
      ...listing('/w', []),
      segments: [
        { name: '/', path: '/' },
        { name: 'w', path: '/w' },
      ],
    }),
  };

  it('a result tab is no drop folder; its drags come from its location key', () => {
    expect(panelZoneHit('left', resultTab, null).panelDir).toBeNull();
    expect(panelZoneHit('left', folder, null)).toEqual({
      side: 'left',
      panelDir: '/w',
      panelName: 'w',
      row: null,
    });
    expect(dragOriginDir(resultTab)).toBe('search:k1');
    expect(dragOriginDir(folder)).toBe('/w');
  });

  it('while dragging: Esc cancels, modifiers switch the kind, every other key is swallowed', () => {
    const key = (k: string, type = 'keydown') => dragKeyAction({ key: k, type });
    expect(key('Escape')).toBe('cancel');
    expect(key('Escape', 'keyup')).toBe('swallow');
    for (const m of ['Shift', 'Meta', 'Control', 'Alt']) {
      expect(key(m)).toBe('modifier');
      expect(key(m, 'keyup')).toBe('modifier');
    }
    for (const k of ['F5', 'Delete', 'Enter', 'ArrowDown', 'a', 'Tab']) {
      expect(key(k)).toBe('swallow');
    }
  });
});

describe('dnd-logic: tabs as drop targets', () => {
  const never = () => false;
  it('a folder tab is a target, also when it is not open', () => {
    expect(tabZoneHit('right', { id: 't1', path: '/x' }, 'x', never)).toEqual({
      side: 'right',
      panelDir: '/x',
      panelName: 'x',
      row: null,
      tabId: 't1',
    });
  });

  it('no result tab, no home tab before its listing, nothing inside an archive, no gap', () => {
    expect(
      tabZoneHit('left', { id: 's', path: '/x', search: { key: 'k' } }, 's', never),
    ).toBeNull();
    expect(tabZoneHit('left', { id: 'h', path: null }, 'home', never)).toBeNull();
    expect(tabZoneHit('left', { id: 'z', path: '/a.zip/d' }, 'd', () => true)).toBeNull();
    expect(tabZoneHit('left', undefined, '', never)).toBeNull();
  });

  it("the dragged entries' own folder is no target, as for the panel", () => {
    const hit = tabZoneHit('left', { id: 't', path: '/src' }, 'src', never);
    expect(resolveDropTarget(hit, { side: 'left', dir: '/src', paths: new Set() })).toBeNull();
  });
});

describe('dnd-logic: out of the window (design 028 E1)', () => {
  it('outside the viewport means the window was left', () => {
    expect(leftWindow(0, 0, 800, 600)).toBe(false);
    expect(leftWindow(799, 599, 800, 600)).toBe(false);
    expect(leftWindow(-1, 10, 800, 600)).toBe(true);
    expect(leftWindow(10, -3, 800, 600)).toBe(true);
    expect(leftWindow(800, 10, 800, 600)).toBe(true);
    expect(leftWindow(10, 600, 800, 600)).toBe(true);
  });

  it('a mouseout towards nothing counts only at the edge', () => {
    const out = (clientX: number, clientY: number, relatedTarget: unknown = null) =>
      leavingAtEdge({ clientX, clientY, relatedTarget }, 800, 600);
    expect(out(0, 300)).toBe(true);
    expect(out(799, 300)).toBe(true);
    expect(out(400, 599)).toBe(true);
    expect(out(400, 300)).toBe(false); // e.g. pointer capture moving the target
    expect(out(0, 300, document.body)).toBe(false);
  });
});

describe('DragStore', () => {
  let fs: FakeFsApi;
  let watch: FakeWatchApi;
  let osDrag: FakeDragDropApi;
  let toSystem: FakeOsDragApi;
  let store: DragStore;
  let ops: OpsStore;
  let dialogs: DialogService;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  let jobs: JobsStore;
  /** What lies under (x, y): x < 100 left panel, else right; y = row index (-1: none). */
  const zones: Record<Side, HTMLElement> = {
    left: document.createElement('div'),
    right: document.createElement('div'),
  };
  const tabBar = document.createElement('div');

  beforeEach(async () => {
    fs = new FakeFsApi();
    fs.handler = (p) =>
      Promise.resolve(
        p === '/src'
          ? listing('/src', [folder, a, b])
          : listing('/dst', [dir('Archiv', { path: '/dst/Archiv' })]),
      );
    watch = new FakeWatchApi();
    osDrag = new FakeDragDropApi();
    toSystem = new FakeOsDragApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: WatchApi, useValue: watch },
        { provide: DragDropApi, useValue: osDrag },
        { provide: OsDragApi, useValue: toSystem },
      ],
    });
    ops = TestBed.inject(OpsStore);
    dialogs = TestBed.inject(DialogService);
    jobs = TestBed.inject(JobsStore);
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    await left.load('/src');
    await right.load('/dst');
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    store = TestBed.inject(DragStore);
    for (const side of ['left', 'right'] as const) {
      const panel = side === 'left' ? left : right;
      const el = zones[side];
      store.registerZone({
        element: el,
        hit: (target) => {
          const row = Number((target as HTMLElement).dataset['row'] ?? -1);
          return {
            side,
            panelDir: panel.path(),
            panelName: panel.path() ?? '',
            row: row >= 0 ? (panel.entries()[row] ?? null) : null,
          };
        },
      });
    }
    // the right tab bar: y = 1000 is over the tab "Other" (not open), y = 1001 over an archive tab
    const tabs = [
      { id: 't-other', path: '/other', title: 'Other' },
      { id: 't-zip', path: '/dst/a.zip/in', title: 'in' },
    ];
    store.registerZone({
      element: tabBar,
      hit: (target) => {
        const tab = tabs.find((t) => t.id === (target as HTMLElement).dataset['tabId']);
        return tabZoneHit('right', tab, tab?.title ?? '', (p) => p.startsWith('/dst/a.zip'));
      },
    });
    store.elementAt = (x, y) => {
      const el = document.createElement('span');
      if (y >= 1000) {
        el.dataset['tabId'] = tabs[y - 1000]?.id ?? '';
        tabBar.append(el);
        return el;
      }
      el.dataset['row'] = String(y);
      (x < 100 ? zones.left : zones.right).append(el);
      return x < 0 ? null : el;
    };
  });

  it('a tab that is not open is a target of its own: its folder, highlighted as a tab', async () => {
    store.begin({ side: 'left', sourceDir: '/src', sources: [a], kind: 'copy', x: 10, y: 1 });
    store.move(150, 1000);
    expect(store.drag()?.target).toEqual({
      side: 'right',
      dir: '/other',
      rowPath: null,
      name: 'Other',
      tabId: 't-other',
    });
    expect(store.label(store.drag()!)).toBe('Copy a.txt → Other');
    store.move(150, 1001); // a folder inside an archive: read-only
    expect(store.drag()?.target).toBeNull();
    await store.drop(150, 1000);
    expect(dialogs.open()).toBe('copy-move');
    expect(ops.copyMove()).toMatchObject({ kind: 'copy', side: 'left', target: '/other' });
  });

  it('files from the system can be dropped onto a tab too', async () => {
    const outside = entry('x.txt', { path: '/ext/x.txt' });
    watch.described.set(outside.path, outside);
    osDrag.emit({ type: 'enter', paths: [outside.path], x: 150, y: 1000 });
    expect(store.drag()?.target).toMatchObject({ tabId: 't-other', dir: '/other' });
    osDrag.emit({ type: 'drop', paths: [outside.path], x: 150, y: 1000 });
    await new Promise((r) => setTimeout(r));
    expect(ops.copyMove()).toMatchObject({ kind: 'copy', side: 'right', target: '/other' });
  });

  it('drop on the other panel opens the copy dialog with that folder – nothing runs yet', async () => {
    store.begin({ side: 'left', sourceDir: '/src', sources: [a, b], kind: 'copy', x: 10, y: 1 });
    expect(store.drag()?.target).toBeNull(); // over a file of its own panel
    store.move(150, -1);
    expect(store.drag()?.target).toMatchObject({ side: 'right', dir: '/dst', rowPath: null });
    expect(store.label(store.drag()!)).toBe('Copy 2 entries → /dst');
    await store.drop(150, 0, 'move');
    expect(store.drag()).toBeNull();
    expect(dialogs.open()).toBe('copy-move');
    expect(ops.copyMove()).toMatchObject({
      kind: 'move',
      side: 'left',
      sourceDir: '/src',
      target: '/dst/Archiv',
    });
    expect(ops.copyMove()?.sources).toEqual([a, b]);
  });

  it('a link drag opens the dialog in link mode (design 031 E7)', async () => {
    store.begin({ side: 'left', sourceDir: '/src', sources: [a], kind: 'link', x: 10, y: 1 });
    store.move(150, -1);
    expect(store.label(store.drag()!)).toBe('Link to a.txt → /dst');
    await store.drop(150, -1, 'link');
    expect(dialogs.open()).toBe('copy-move');
    expect(ops.copyMove()).toMatchObject({ kind: 'link', side: 'left', target: '/dst' });
    expect(ops.copyMove()?.dangers).toEqual([]);
  });

  it('release without a target or Esc does nothing', async () => {
    store.begin({ side: 'left', sourceDir: '/src', sources: [a], kind: 'copy', x: 10, y: 1 });
    await store.drop(10, 2);
    expect(dialogs.open()).toBeNull();
    store.begin({ side: 'left', sourceDir: '/src', sources: [a], kind: 'copy', x: 10, y: 1 });
    store.move(150, -1);
    store.cancel();
    expect(store.drag()).toBeNull();
    expect(dialogs.open()).toBeNull();
  });

  it('files from the system: highlight while over, copy dialog on drop', async () => {
    const outside = entry('foto 😀.jpg', { path: '/ext/foto 😀.jpg' });
    watch.described.set(outside.path, outside);
    osDrag.emit({ type: 'enter', paths: [outside.path], x: 150, y: -1 });
    expect(store.drag()).toMatchObject({ fromSystem: true, target: { side: 'right' } });
    osDrag.emit({ type: 'over', x: 20, y: 0 });
    expect(store.drag()?.target).toMatchObject({ side: 'left', dir: '/src/Ordner äö' });
    osDrag.emit({ type: 'drop', paths: [outside.path, '/ext/gone'], x: 20, y: 0 });
    await new Promise((r) => setTimeout(r));
    expect(store.drag()).toBeNull();
    expect(ops.copyMove()).toMatchObject({
      kind: 'copy',
      side: 'left',
      sourceDir: 'parent-of-dropped',
      target: '/src/Ordner äö',
    });
    expect(jobs.messages().join(' ')).toContain('1 dropped item');
  });

  it('ignores system drags while a dialog is open, and drops that no longer exist', async () => {
    dialogs.show('copy-move');
    osDrag.emit({ type: 'enter', paths: ['/ext/x'], x: 150, y: -1 });
    expect(store.drag()).toBeNull();
    dialogs.close();
    osDrag.emit({ type: 'drop', paths: ['/ext/x'], x: 150, y: -1 });
    await new Promise((r) => setTimeout(r));
    expect(dialogs.open()).toBeNull();
  });

  it('out of the window the drag goes on as a system drag with the same entries (design 028)', async () => {
    store.begin({
      side: 'left',
      sourceDir: '/src',
      sources: [a, folder],
      kind: 'move',
      x: 10,
      y: 1,
    });
    await store.handOff();
    expect(store.drag()).toBeNull();
    expect(toSystem.started).toEqual([['/src/a.txt', '/src/Ordner äö']]);
    expect(dialogs.open()).toBeNull(); // nothing runs in the app
  });

  it('entries inside an archive are not handed to the system – a note instead', async () => {
    store.begin({
      side: 'left',
      sourceDir: '/src/a.zip',
      sources: [a],
      kind: 'copy',
      x: 10,
      y: 1,
      inArchive: true,
    });
    await store.handOff();
    expect(store.drag()).toBeNull();
    expect(toSystem.started).toEqual([]);
    expect(jobs.messages().join(' ')).toContain('archive');
  });

  it('a failed start is reported; without a drag nothing happens', async () => {
    await store.handOff();
    expect(toSystem.started).toEqual([]);
    toSystem.fail = { code: 'not_found', message: 'gone', path: '/src/a.txt' };
    store.begin({ side: 'left', sourceDir: '/src', sources: [a], kind: 'copy', x: 10, y: 1 });
    await store.handOff();
    expect(store.drag()).toBeNull();
    expect(jobs.messages().length).toBeGreaterThan(0);
  });

  it('released before the start: no message (review 028 #1)', async () => {
    toSystem.fail = { code: 'drag_not_held', message: 'up', path: null };
    store.begin({ side: 'left', sourceDir: '/src', sources: [a], kind: 'copy', x: 10, y: 1 });
    await store.handOff();
    expect(jobs.messages()).toEqual([]);
  });

  it('a drag from the system is never handed back to the system', async () => {
    osDrag.emit({ type: 'enter', paths: ['/ext/x'], x: 150, y: -1 });
    await store.handOff();
    expect(toSystem.started).toEqual([]);
    expect(store.drag()).toBeNull();
  });
});
