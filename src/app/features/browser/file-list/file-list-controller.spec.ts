import { JobsApi } from '../../../core/jobs/jobs-api';
import { FakeJobsApi } from '../../../../testing/fake-jobs-api';
import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../../core/fs/fs-api';
import { DirEntry } from '../../../core/fs/fs.models';
import { FakeTableBridge } from '../../../../testing/fake-table-bridge';
import { dir, entry, FakeFsApi, listing } from '../../../../testing/fs-fixtures';
import { FileBrowserStore } from '../file-browser.store';
import { ClickInput, FileListController } from './file-list-controller';
const click = (rowIndex: number, mods: Partial<ClickInput> = {}): ClickInput => ({
  area: 'body',
  rowIndex,
  clickCount: 1,
  shiftKey: false,
  toggleKey: false,
  ...mods,
});

describe('FileListController', () => {
  let api: FakeFsApi;
  let store: FileBrowserStore;
  let bridge: FakeTableBridge;
  let ctrl: FileListController;
  const rows: DirEntry[] = [
    dir('Sub', { path: '/h/Sub' }),
    entry('a.txt', { path: '/h/a.txt', size: 3 }),
    entry('b.txt', { path: '/h/b.txt', size: 1 }),
    entry('c.txt', { path: '/h/c.txt', size: 2 }),
  ];

  /** Like the real table: the focus moves first, then the event is reported. */
  const focusRow = (i: number) => {
    bridge.focus = i;
    ctrl.onFocusChanged(i);
  };

  beforeEach(async () => {
    api = new FakeFsApi();
    api.handler = (p) =>
      Promise.resolve(
        p === '/h/Sub'
          ? listing('/h/Sub', [entry('x', { path: '/h/Sub/x' })], '/h')
          : listing('/h', rows, '/'),
      );
    TestBed.configureTestingModule({
      providers: [
        FileBrowserStore,
        { provide: FsApi, useValue: api },
        { provide: JobsApi, useValue: new FakeJobsApi() },
      ],
    });
    store = TestBed.inject(FileBrowserStore);
    bridge = new FakeTableBridge();
    ctrl = new FileListController(bridge, store);
    await store.load('/h');
    ctrl.showRows(store.entries(), 'h');
  });

  it('shows rows, focuses the first row and announces the folder', () => {
    expect(bridge.calls.slice(0, 2)).toEqual(['setRows(4)', 'setFocusedRow(0)']);
    expect(store.cursorPath()).toBe('/h/Sub');
    expect(bridge.announcements).toEqual(['h, 4 entries']);
  });

  it('puts the cursor on the wanted entry after loading (e.g. after "up")', () => {
    store.setCursor('/h/c.txt');
    ctrl.showRows(store.entries());
    expect(bridge.focus).toBe(3);
  });

  it('keeps the cursor on the same entry after the table re-sorted', () => {
    focusRow(1); // a.txt
    bridge.sort((x, y) => (x.size ?? -1) - (y.size ?? -1)); // Sub, b, c, a
    expect(bridge.rows[bridge.focus].name).not.toBe('a.txt'); // the table's index points elsewhere …
    ctrl.restoreCursor();
    expect(bridge.rows[bridge.focus].name).toBe('a.txt'); // … the controller fixes it by path
  });

  it('syncs table focus changes to the store', () => {
    focusRow(2);
    expect(store.cursorPath()).toBe('/h/b.txt');
    ctrl.onFocusChanged(99);
    expect(store.cursorPath()).toBe('/h/b.txt');
  });

  it('opens the cursor folder and goes up again', async () => {
    expect(ctrl.openCursor()).toBe(true);
    await vi.waitFor(() => expect(store.path()).toBe('/h/Sub'));
    await store.up();
    await vi.waitFor(() => expect(store.path()).toBe('/h'));
    expect(store.cursorPath()).toBe('/h/Sub');
  });

  it('opens on double click, ignores header clicks', async () => {
    ctrl.onClick(click(0, { area: 'header', clickCount: 2 }));
    expect(api.calls).toEqual(['/h']);
    ctrl.onClick(click(0, { clickCount: 2 }));
    await vi.waitFor(() => expect(store.path()).toBe('/h/Sub'));
  });

  it('toggles the mark and moves the cursor down (Space/Insert)', () => {
    focusRow(1);
    ctrl.toggleMarkAndAdvance();
    expect(store.isMarked('/h/a.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/b.txt');
    ctrl.toggleMarkAndAdvance();
    expect(store.isMarked('/h/b.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/c.txt');
    ctrl.toggleMarkAndAdvance(); // last row: marks, cursor stays
    expect(store.isMarked('/h/c.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/c.txt');
  });

  it('Shift+Space toggles and moves up, Mod+Shift+Space toggles in place (018 J10, mr)', () => {
    focusRow(2);
    ctrl.toggleMarkAndMove(-1);
    expect(store.isMarked('/h/b.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/a.txt');
    ctrl.toggleMarkAndMove(0);
    expect(store.isMarked('/h/a.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/a.txt');
    ctrl.toggleMarkAndMove(0);
    expect(store.isMarked('/h/a.txt')).toBe(false);
  });

  it('marks and moves (Shift+↓/↑)', () => {
    ctrl.markAndMove(1);
    ctrl.markAndMove(1);
    expect([...store.marked()].sort()).toEqual(['/h/Sub', '/h/a.txt']);
    expect(store.cursorPath()).toBe('/h/b.txt');
  });

  it('marks to the first/last entry (Shift+Pos1/Ende)', () => {
    focusRow(2);
    ctrl.markToEdge('end');
    expect([...store.marked()].sort()).toEqual(['/h/b.txt', '/h/c.txt']);
    expect(store.cursorPath()).toBe('/h/c.txt');
    ctrl.markToEdge('start');
    expect(store.marked().size).toBe(4);
    expect(store.cursorPath()).toBe('/h/Sub');
  });

  it('marks all, unmarks all and inverts on the displayed rows', () => {
    ctrl.markAll();
    expect(store.marked().size).toBe(4);
    ctrl.clearMarks();
    expect(store.marked().size).toBe(0);
    store.setMarked(['/h/a.txt'], true);
    ctrl.invertMarks();
    expect([...store.marked()].sort()).toEqual(['/h/Sub', '/h/b.txt', '/h/c.txt']);
  });

  it('marks and unmarks by a name predicate', () => {
    expect(ctrl.markMatching((n) => n.endsWith('.txt'), true)).toBe(3);
    expect(ctrl.markMatching((n) => n.startsWith('a'), false)).toBe(1);
    expect([...store.marked()].sort()).toEqual(['/h/b.txt', '/h/c.txt']);
  });

  it('Ctrl/⌘+click toggles, Shift+click marks a range from the previous cursor', () => {
    ctrl.onClick(click(2, { toggleKey: true }));
    expect(store.isMarked('/h/b.txt')).toBe(true);
    focusRow(1); // plain click on a.txt moved the cursor
    focusRow(3); // shift+click on c.txt: the table moves the focus first …
    ctrl.onClick(click(3, { shiftKey: true })); // … then reports the click
    expect([...store.marked()].sort()).toEqual(['/h/a.txt', '/h/b.txt', '/h/c.txt']);
  });

  it('does nothing on an empty folder', () => {
    bridge.setRows([]);
    bridge.focus = -1;
    expect(ctrl.openCursor()).toBe(false);
    ctrl.toggleMarkAndAdvance();
    ctrl.restoreCursor();
    expect(store.marked().size).toBe(0);
  });

  it('Ctrl/⌘+Enter opens the folder under the cursor in a new tab', () => {
    const opened: string[] = [];
    const withHooks = new FileListController(bridge, store, {
      openInNewTab: (e) => opened.push(e.path),
    });
    bridge.focus = 0;
    expect(withHooks.openCursorInNewTab()).toBe(true);
    expect(opened).toEqual(['/h/Sub']);
    bridge.focus = 1; // a file: not a folder
    expect(withHooks.openCursorInNewTab()).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('applies a tab table state around the cursor: columns + sort first, scroll last', () => {
    bridge.calls = [];
    ctrl.showRows(rows, 'h', { version: 1, sort: [], scroll: { left: 0, top: 48 } });
    expect(bridge.calls).toEqual([
      'setRows(4)',
      'applyTableState(sort)',
      'setFocusedRow(0)',
      'applyTableState(scroll)',
    ]);
  });
});
