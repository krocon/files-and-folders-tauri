import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FileBrowserStore } from '../browser/file-browser.store';
import { SessionApi } from '../../core/session/session-api';
import { Session } from '../../core/session/session.models';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { newTab, SAVE_DEBOUNCE_MS, WorkspaceStore } from './workspace.store';

describe('WorkspaceStore', () => {
  let api: FakeSessionApi;
  let ws: WorkspaceStore;

  const paths = (side: 'left' | 'right') => ws.panels()[side].tabs.map((t) => t.path);

  beforeEach(async () => {
    api = new FakeSessionApi();
    TestBed.configureTestingModule({ providers: [{ provide: SessionApi, useValue: api }] });
    ws = TestBed.inject(WorkspaceStore);
    await ws.init();
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [newTab('/a', 'a'), newTab('/b', 'b'), newTab('/c', 'c')] },
        right: { activeTab: 0, tabs: [newTab('/r', 'r')] },
      },
    });
  });

  afterEach(() => vi.useRealTimers());

  it('starts with one home tab per side and the left side active', async () => {
    const fresh = TestBed.inject(WorkspaceStore);
    fresh.restore(new FakeSessionApi().loaded.session);
    expect(fresh.activeTab('left').path).toBeNull();
    expect(fresh.activeTab('right').path).toBeNull();
    expect(fresh.source()).toBe('left');
    expect(fresh.target()).toBe('right');
  });

  it('gives tabs with empty or duplicate ids new ids on restore', () => {
    const t = { ...newTab('/x'), id: '' };
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [t, { ...t }] },
        right: { activeTab: 0, tabs: [{ ...t }] },
      },
    });
    const ids = [...ws.panels().left.tabs, ...ws.panels().right.tabs].map((x) => x.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain('');
  });

  it('switches the active side: source and target follow, the new side gets the focus', () => {
    ws.toggleActive();
    expect(ws.source()).toBe('right');
    expect(ws.target()).toBe('left');
    expect(ws.focusRequest()?.side).toBe('right');
    ws.setActive('left');
    expect(ws.source()).toBe('left');
  });

  it('review 021: panels registered later reach computeds that read them before (actionDir)', () => {
    const dir = computed(() => ws.actionDir('left'));
    expect(dir()).toBeNull(); // no panel yet – the shell bar reads this at start
    const path = signal<string | null>('/a');
    const store = { path, searchKey: () => null } as unknown as FileBrowserStore;
    const off = ws.registerPanel('left', { store, controller: () => undefined });
    expect(dir()).toBe('/a');
    path.set('/b');
    expect(dir()).toBe('/b');
    off();
    expect(dir()).toBeNull();
  });

  it('targetDir: the folder of the selected tab on the other side', () => {
    expect(ws.targetDir()).toBe('/r');
    expect(ws.targetDir('right')).toBe('/a');
    ws.selectTab('left', 2);
    expect(ws.targetDir('right')).toBe('/c');
    ws.setActive('right');
    expect(ws.targetDir()).toBe('/c');
  });

  it('clones the active tab next to it and selects the clone', () => {
    ws.selectTab('left', 1);
    ws.cloneTab('left');
    expect(paths('left')).toEqual(['/a', '/b', '/b', '/c']);
    expect(ws.panels().left.activeTab).toBe(2);
    const [, original, clone] = ws.panels().left.tabs;
    expect(clone.id).not.toBe(original.id);
  });

  it('closes tabs but always keeps the last one', () => {
    ws.selectTab('left', 2);
    ws.closeTab('left');
    expect(paths('left')).toEqual(['/a', '/b']);
    expect(ws.panels().left.activeTab).toBe(1);
    ws.closeTab('left', 0);
    expect(paths('left')).toEqual(['/b']);
    expect(ws.panels().left.activeTab).toBe(0);
    ws.closeTab('left');
    expect(paths('left')).toEqual(['/b']);
  });

  it('keeps the selected tab when a tab before it is closed', () => {
    ws.selectTab('left', 2);
    ws.closeTab('left', 0);
    expect(ws.activeTab('left').path).toBe('/c');
  });

  it('moves a tab to the other side and selects it there', () => {
    ws.moveTabToOther('left', 1);
    expect(paths('left')).toEqual(['/a', '/c']);
    expect(paths('right')).toEqual(['/r', '/b']);
    expect(ws.activeTab('right').path).toBe('/b');
    ws.moveTabToOther('right', 0);
    ws.moveTabToOther('right', 0);
    expect(paths('right')).toEqual(['/b']);
  });

  it('clones a tab into the other side', () => {
    ws.cloneTabToOther('left', 0);
    expect(paths('left')).toEqual(['/a', '/b', '/c']);
    expect(paths('right')).toEqual(['/r', '/a']);
    expect(ws.panels().right.tabs[1].id).not.toBe(ws.panels().left.tabs[0].id);
  });

  it('reorders tabs and keeps the selection on the same tab', () => {
    ws.selectTab('left', 0);
    ws.moveTab('left', 0, 1);
    expect(paths('left')).toEqual(['/b', '/a', '/c']);
    expect(ws.activeTab('left').path).toBe('/a');
    ws.moveTab('left', 0, -1);
    ws.moveTab('left', 2, 1);
    expect(paths('left')).toEqual(['/b', '/a', '/c']);
  });

  it('places tabs by id at an insertion position – reorder, other side, copy (design 031)', () => {
    const [a, b, c] = ws.panels().left.tabs;
    ws.selectTab('left', 1);
    expect(ws.placeTab(a.id, 'left', 3, false)).toBe(a.id);
    expect(paths('left')).toEqual(['/b', '/c', '/a']);
    expect(ws.activeTab('left').id).toBe(a.id); // the dragged tab is selected
    // its spot: nothing changes, but it is selected
    ws.selectTab('left', 0);
    expect(ws.placeTab(c.id, 'left', 2, false)).toBe(c.id);
    expect(paths('left')).toEqual(['/b', '/c', '/a']);
    expect(ws.activeTab('left').id).toBe(c.id);
    // to the other side, before "r"; the left side keeps a valid selection
    expect(ws.placeTab(b.id, 'right', 0, false)).toBe(b.id);
    expect(paths('left')).toEqual(['/c', '/a']);
    expect(paths('right')).toEqual(['/b', '/r']);
    expect(ws.activeTab('right').id).toBe(b.id);
    expect(ws.panels().left.activeTab).toBeLessThan(2);
    // a copy: new id, same folder; the original stays
    const copy = ws.placeTab(c.id, 'right', 99, true)!;
    expect(copy).not.toBe(c.id);
    expect(paths('right')).toEqual(['/b', '/r', '/c']);
    expect(paths('left')).toEqual(['/c', '/a']);
    // unknown ids: nothing
    expect(ws.placeTab('nope', 'left', 0, false)).toBeNull();
  });

  it('never moves the last tab of a side away and respects MAX_TABS', () => {
    const r = ws.panels().right.tabs[0];
    expect(ws.placeTab(r.id, 'left', 0, false)).toBeNull();
    expect(paths('right')).toEqual(['/r']);
    expect(ws.placeTab(r.id, 'left', 0, true)).not.toBeNull();
    expect(paths('left')).toEqual(['/r', '/a', '/b', '/c']);
    while (ws.panels().left.tabs.length < 50) {
      ws.cloneTab('left');
    }
    expect(ws.placeTab(r.id, 'left', 0, true)).toBeNull();
    expect(ws.panels().left.tabs).toHaveLength(50);
  });

  it('a result tab keeps its search when it changes sides; the result stays in use', () => {
    const id = ws.openSearchTab('left', { key: 's1', label: 'x' }, '/a')!;
    expect(ws.placeTab(id, 'right', 1, false)).toBe(id);
    expect(ws.activeTab('right').search?.key).toBe('s1');
    expect(ws.searchKeys().has('s1')).toBe(true);
    // saved: the result tab falls back to its folder on whichever side it is
    expect(ws.snapshot().panels.right.tabs.map((t) => t.path)).toEqual(['/r', '/a']);
  });

  it('cycles through tabs with wrap-around', () => {
    ws.cycleTab('left', -1);
    expect(ws.activeTab('left').path).toBe('/c');
    ws.cycleTab('left', 1);
    expect(ws.activeTab('left').path).toBe('/a');
  });

  it('opens a folder in a new tab after the active one', () => {
    ws.openInNewTab('left', '/a/Sub', 'Sub');
    expect(paths('left')).toEqual(['/a', '/a/Sub', '/b', '/c']);
    expect(ws.activeTab('left').title).toBe('Sub');
  });

  it('records navigation in the tab history (newest first, unique, max. 15)', () => {
    const id = ws.activeTab('left').id;
    for (let i = 0; i < 20; i++) {
      ws.navigated(id, `/n${i}`, `n${i}`);
    }
    ws.navigated(id, '/n5', 'n5');
    const tab = ws.activeTab('left');
    expect(tab.path).toBe('/n5');
    expect(tab.history).toHaveLength(15);
    expect(tab.history[0]).toBe('/n19');
    expect(tab.history).not.toContain('/n5');
  });

  it('toggles favourites', () => {
    ws.toggleFavorite('/Users/jörg/Mein Ordner');
    expect(ws.isFavorite('/Users/jörg/Mein Ordner')).toBe(true);
    ws.toggleFavorite('/Users/jörg/Mein Ordner');
    expect(ws.isFavorite('/Users/jörg/Mein Ordner')).toBe(false);
    expect(ws.isFavorite(null)).toBe(false);
  });

  it('bounds the splitter', () => {
    ws.setSplitter(0.01);
    expect(ws.splitter()).toBe(0.15);
    ws.setSplitter(Number.NaN);
    expect(ws.splitter()).toBe(0.5);
  });

  it('round-trips through the session format', () => {
    ws.setActive('right');
    ws.setSplitter(0.3);
    ws.toggleFavorite('/fav');
    ws.updateTab(ws.activeTab('left').id, {
      cursor: '/a/x',
      table: { version: 1, sort: [{ property: 'size', sortState: 'desc' }] },
    });
    const snapshot: Session = structuredClone(ws.snapshot());
    const other = TestBed.runInInjectionContext(() => new WorkspaceStore());
    other.restore(snapshot);
    expect(other.snapshot()).toEqual(snapshot);
  });

  it('saves debounced after a change', async () => {
    vi.useFakeTimers();
    api.saved.length = 0;
    ws.toggleFavorite('/x');
    TestBed.tick();
    ws.toggleFavorite('/y');
    TestBed.tick();
    expect(api.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    expect(api.saved).toHaveLength(1);
    expect(api.saved[0].favorites).toEqual(['/x', '/y']);
  });

  it('flush writes a pending change immediately', async () => {
    vi.useFakeTimers();
    api.saved.length = 0;
    ws.setSplitter(0.4);
    TestBed.tick();
    await ws.flush();
    expect(api.saved.at(-1)?.splitter).toBe(0.4);
  });

  it('shows warnings and replaced folders of the loaded session', async () => {
    api.loaded = {
      session: api.loaded.session,
      warning: 'The saved session was invalid',
      adjusted: [
        { from: '/gone', to: '/' },
        { from: '/x', to: null },
      ],
    };
    await ws.init();
    expect(ws.notices()).toEqual([
      'The saved session was invalid',
      'Folder no longer exists: /gone – showing / instead.',
      'Folder no longer exists: /x – showing home folder instead.',
    ]);
    ws.dismissNotice(0);
    expect(ws.notices()).toHaveLength(2);
  });

  it('reports a failed save once', async () => {
    vi.useFakeTimers();
    api.failSave = true;
    ws.setSplitter(0.6);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    ws.setSplitter(0.7);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    expect(ws.notices()).toEqual([
      'The session could not be saved: The folder could not be read. (disk full)',
    ]);
  });

  it('never saves after loading the session failed', async () => {
    vi.useFakeTimers();
    const failing = new FakeSessionApi();
    failing.load = () => Promise.reject({ code: 'io', message: 'locked', path: null });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: SessionApi, useValue: failing }] });
    const store = TestBed.inject(WorkspaceStore);
    await store.init();
    expect(store.ready()).toBe(true);
    expect(store.notices()[0]).toContain('could not be loaded');
    store.setSplitter(0.3);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    await store.flush();
    expect(failing.saved).toHaveLength(0);
  });
});
