import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../../core/fs/fs-api';
import { DirEntry } from '../../../core/fs/fs.models';
import { FakeTableBridge } from '../../../../testing/fake-table-bridge';
import { dir, entry, FakeFsApi, listing } from '../../../../testing/fs-fixtures';
import { FileBrowserStore } from '../file-browser.store';
import { ClickInput, FileListController, KeyInput } from './file-list-controller';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});
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
      providers: [FileBrowserStore, { provide: FsApi, useValue: api }],
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

  it('opens the cursor folder with Enter and goes up with Backspace', async () => {
    expect(ctrl.onKey(key('Enter'))).toBe(true);
    await vi.waitFor(() => expect(store.path()).toBe('/h/Sub'));
    expect(ctrl.onKey(key('Backspace'))).toBe(true);
    await vi.waitFor(() => expect(store.path()).toBe('/h'));
    expect(store.cursorPath()).toBe('/h/Sub');
  });

  it('opens on double click, ignores header clicks', async () => {
    ctrl.onClick(click(0, { area: 'header', clickCount: 2 }));
    expect(api.calls).toEqual(['/h']);
    ctrl.onClick(click(0, { clickCount: 2 }));
    await vi.waitFor(() => expect(store.path()).toBe('/h/Sub'));
  });

  it('Space/Insert toggles the mark and moves the cursor down', () => {
    focusRow(1);
    expect(ctrl.onAction('TOGGLE_SELECTION')).toBe(true);
    expect(store.isMarked('/h/a.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/b.txt');
    expect(ctrl.onKey(key('Insert'))).toBe(true);
    expect(store.isMarked('/h/b.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/c.txt');
    ctrl.onAction('TOGGLE_SELECTION'); // last row: marks, cursor stays
    expect(store.isMarked('/h/c.txt')).toBe(true);
    expect(store.cursorPath()).toBe('/h/c.txt');
  });

  it('Shift+↓/↑ marks and moves', () => {
    expect(ctrl.onKey(key('ArrowDown', { shiftKey: true }))).toBe(true);
    expect(ctrl.onKey(key('ArrowDown', { shiftKey: true }))).toBe(true);
    expect([...store.marked()].sort()).toEqual(['/h/Sub', '/h/a.txt']);
    expect(ctrl.onKey(key('ArrowDown'))).toBe(false); // plain arrows belong to the table
  });

  it('select all / deselect all work on the displayed rows', () => {
    expect(ctrl.onAction('SELECT_ALL')).toBe(true);
    expect(store.marked().size).toBe(4);
    expect(ctrl.onAction('DESELECT_ALL')).toBe(true);
    expect(store.marked().size).toBe(0);
    expect(ctrl.onAction('NAVIGATE_DOWN')).toBe(false);
  });

  it('Ctrl/⌘+click toggles, Shift+click marks a range from the previous cursor', () => {
    ctrl.onClick(click(2, { toggleKey: true }));
    expect(store.isMarked('/h/b.txt')).toBe(true);
    focusRow(1); // plain click on a.txt moved the cursor
    focusRow(3); // shift+click on c.txt: the table moves the focus first …
    ctrl.onClick(click(3, { shiftKey: true })); // … then reports the click
    expect([...store.marked()].sort()).toEqual(['/h/a.txt', '/h/b.txt', '/h/c.txt']);
  });

  it('ignores keys with modifiers it does not own', () => {
    expect(ctrl.onKey(key('Enter', { ctrlKey: true }))).toBe(false);
    expect(ctrl.onKey(key('Backspace', { metaKey: true }))).toBe(false);
    expect(ctrl.onKey(key('a'))).toBe(false);
  });

  it('does nothing on an empty folder', () => {
    bridge.setRows([]);
    bridge.focus = -1;
    expect(ctrl.onKey(key('Enter'))).toBe(false);
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
    expect(withHooks.onKey(key('Enter', { ctrlKey: true, toggleKey: true }))).toBe(true);
    expect(opened).toEqual(['/h/Sub']);
    bridge.focus = 1; // a file: not a folder
    expect(withHooks.onKey(key('Enter', { ctrlKey: true, toggleKey: true }))).toBe(false);
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
