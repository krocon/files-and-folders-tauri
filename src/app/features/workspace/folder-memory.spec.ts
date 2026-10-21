import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FolderMemoryApi } from '../../core/memory/folder-memory-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { FakeFolderMemoryApi } from '../../../testing/fake-folder-memory-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import type { FileBrowserStore } from '../browser/file-browser.store';
import { recallFolder, rememberFolder } from '../browser/tab-memory';
import { MEMORY_SAVE_DEBOUNCE_MS, newTab, WorkspaceStore } from './workspace.store';

const saved = (path: string, marks: string[] = []) => ({
  path,
  cursor: `${path}/c`,
  marks,
  scrollTop: 12,
});

describe('folder memory across restarts (design 027)', () => {
  let memoryApi: FakeFolderMemoryApi;
  let settingsApi: FakeSettingsApi;
  let sessionApi: FakeSessionApi;

  async function start(): Promise<WorkspaceStore> {
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionApi, useValue: sessionApi },
        { provide: SettingsApi, useValue: settingsApi },
        { provide: FolderMemoryApi, useValue: memoryApi },
      ],
    });
    const ws = TestBed.inject(WorkspaceStore);
    await ws.init();
    TestBed.tick();
    return ws;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    memoryApi = new FakeFolderMemoryApi();
    settingsApi = new FakeSettingsApi();
    sessionApi = new FakeSessionApi();
    const left = { ...newTab('/a'), id: 'L' };
    const right = { ...newTab('/r'), id: 'R' };
    sessionApi.loaded = {
      ...sessionApi.loaded,
      session: {
        ...sessionApi.loaded.session,
        panels: {
          left: { activeTab: 0, tabs: [left, { ...newTab('/b'), id: 'L2' }] },
          right: { activeTab: 0, tabs: [right] },
        },
      },
    };
    memoryApi.loaded = {
      value: {
        version: 1,
        tabs: [
          { tabId: 'L', folders: [saved('/a/sub'), saved('/a', ['/a/1', '/a/2'])] },
          { tabId: 'L2', folders: [saved('/b')] },
          { tabId: 'closed', folders: [saved('/gone')] },
        ],
      },
      warning: null,
    };
  });

  afterEach(() => vi.useRealTimers());

  it('a tab starts with the folders the file kept for it', async () => {
    const ws = await start();
    const m = ws.memory('L');
    expect(recallFolder(m, '/a')).toEqual({
      cursor: '/a/c',
      marks: ['/a/1', '/a/2'],
      scrollTop: 12,
    });
    expect([...m.folders.keys()]).toEqual(['/a/sub', '/a']);
    expect(ws.memory('R').folders.size).toBe(0);
  });

  it('writes the open tabs (unopened ones as they were), the shown folder newest, closed tabs go', async () => {
    const ws = await start();
    ws.memory('L');
    const path = signal<string | null>('/a');
    const store = {
      path,
      searchKey: () => null,
      marked: signal(new Set<string>()),
      currentFolderState: () => ({
        path: '/a',
        state: { cursor: '/a/x', marks: ['/a/x'], scrollTop: 0 },
      }),
    } as unknown as FileBrowserStore;
    ws.registerPanel('left', { store, controller: () => undefined });
    await ws.flush();
    expect(memoryApi.saved.at(-1)).toEqual({
      version: 1,
      tabs: [
        {
          tabId: 'L',
          folders: [saved('/a/sub'), { path: '/a', cursor: '/a/x', marks: ['/a/x'], scrollTop: 0 }],
        },
        { tabId: 'L2', folders: [saved('/b')] },
      ],
    });
    // nothing changed: not written again
    const count = memoryApi.saved.length;
    await ws.flush();
    expect(memoryApi.saved).toHaveLength(count);
    // a panel still loading another folder does not count as "shown"
    path.set('/elsewhere');
    ws.memory('L').folders.clear();
    await ws.flush();
    expect(memoryApi.saved.at(-1)?.tabs.map((t) => t.tabId)).toEqual(['L2']);
  });

  it('saves debounced after a change of the session', async () => {
    const ws = await start();
    memoryApi.saved.length = 0;
    ws.memory('L').folders.clear();
    ws.setSplitter(0.3);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(MEMORY_SAVE_DEBOUNCE_MS - 100);
    expect(memoryApi.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(memoryApi.saved.at(-1)?.tabs.map((t) => t.tabId)).toEqual(['L2']);
  });

  it('switched off: nothing is restored and the file is emptied', async () => {
    settingsApi.loaded = { ...settingsApi.loaded, settings: { 'behavior.rememberFolders': false } };
    const ws = await start();
    expect(ws.memory('L').folders.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(memoryApi.saved.at(-1)).toEqual({ version: 1, tabs: [] });
  });

  it('switching off at runtime forgets what was kept', async () => {
    const ws = await start();
    TestBed.inject(SettingsStore).set('behavior.rememberFolders', false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10);
    expect(memoryApi.saved.at(-1)).toEqual({ version: 1, tabs: [] });
    expect(ws.memory('L2').folders.size).toBe(0);
  });

  it('a load that fails or answers nonsense never breaks the session start', async () => {
    memoryApi.loaded = null as never; // e.g. an old mock backend answering null
    let ws = await start();
    expect(ws.activeTab('left').id).toBe('L');
    expect(ws.memory('L').folders.size).toBe(0);
    TestBed.resetTestingModule();
    memoryApi = new FakeFolderMemoryApi();
    memoryApi.failLoad = true;
    ws = await start();
    expect(ws.activeTab('left').id).toBe('L');
    expect(ws.notices().some((n) => n.includes('could not be read'))).toBe(true);
  });

  it('a broken file is reported and replaced; an unreadable one is never written', async () => {
    memoryApi.loaded = {
      value: { version: 1, tabs: [] },
      warning: { code: 'broken', path: '/cfg/folder-memory.json.bad' },
    };
    let ws = await start();
    expect(ws.notices().some((n) => n.includes('folder-memory.json.bad'))).toBe(true);
    rememberFolder(ws.memory('L'), '/a', { cursor: null, marks: [], scrollTop: 0 });
    await ws.flush();
    expect(memoryApi.saved.at(-1)?.tabs.map((t) => t.tabId)).toEqual(['L']);

    TestBed.resetTestingModule();
    memoryApi = new FakeFolderMemoryApi();
    memoryApi.loaded = {
      value: { version: 1, tabs: [] },
      warning: { code: 'unreadable', path: null },
    };
    ws = await start();
    expect(ws.notices().some((n) => n.includes('could not be read'))).toBe(true);
    rememberFolder(ws.memory('L'), '/a', { cursor: null, marks: [], scrollTop: 0 });
    await ws.flush();
    expect(memoryApi.saved).toHaveLength(0);
  });
});
