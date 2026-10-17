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
import { FakeDragDropApi, FakeWatchApi } from '../../../testing/fake-watch-api';
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
  panelZoneHit,
  resolveDropTarget,
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

describe('DragStore', () => {
  let fs: FakeFsApi;
  let watch: FakeWatchApi;
  let osDrag: FakeDragDropApi;
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
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: WatchApi, useValue: watch },
        { provide: DragDropApi, useValue: osDrag },
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
      store.registerZone(side, {
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
    store.elementAt = (x, y) => {
      const el = document.createElement('span');
      el.dataset['row'] = String(y);
      (x < 100 ? zones.left : zones.right).append(el);
      return x < 0 ? null : el;
    };
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
});
