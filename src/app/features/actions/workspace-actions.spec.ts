import { JobsApi } from '../../core/jobs/jobs-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeTableBridge } from '../../../testing/fake-table-bridge';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { newTab, WorkspaceStore } from '../workspace/workspace.store';
import { registerWorkspaceActions } from './workspace-actions';

describe('workspace actions', () => {
  let actions: ActionService;
  let ws: WorkspaceStore;
  let dialogs: DialogService;
  let store: FileBrowserStore;
  let bridge: FakeTableBridge;
  let ctrl: FileListController;

  beforeEach(async () => {
    const fs = new FakeFsApi();
    fs.handler = (p) =>
      Promise.resolve(
        p === '/h/Sub'
          ? listing('/h/Sub', [], '/h')
          : listing(
              '/h',
              [dir('Sub', { path: '/h/Sub' }), entry('a.txt', { path: '/h/a.txt' })],
              '/',
            ),
      );
    TestBed.configureTestingModule({
      providers: [
        FileBrowserStore,
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    ws = TestBed.inject(WorkspaceStore);
    dialogs = TestBed.inject(DialogService);
    store = TestBed.inject(FileBrowserStore);
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [newTab('/h'), newTab('/x')] },
        right: { activeTab: 0, tabs: [newTab(null)] },
      },
    });
    bridge = new FakeTableBridge();
    ctrl = new FileListController(bridge, store, {
      openInNewTab: (e) => ws.openInNewTab('left', e.path, e.name),
    });
    await store.load('/h');
    ctrl.showRows(store.entries());
    ws.registerPanel('left', { store, controller: () => ctrl });
    registerWorkspaceActions(actions, ws, dialogs);
  });

  it('opens folders, goes up and reloads in the active panel', async () => {
    await actions.run('NAVIGATE_OPEN');
    await vi.waitFor(() => expect(store.path()).toBe('/h/Sub'));
    await actions.run('NAVIGATE_PARENT');
    expect(store.path()).toBe('/h');
    expect(await actions.run('RELOAD_DIR')).toBe(true);
  });

  it('moves and copies the active tab by keyboard (design 031 E5)', async () => {
    const paths = (side: 'left' | 'right') => ws.panels()[side].tabs.map((t) => t.path);
    expect(actions.state('MOVE_TAB_LEFT')).toBe('disabled');
    await actions.run('MOVE_TAB_RIGHT');
    expect(paths('left')).toEqual(['/x', '/h']);
    expect(ws.activeTab('left').path).toBe('/h');
    expect(actions.state('MOVE_TAB_RIGHT')).toBe('disabled');
    await actions.run('MOVE_TAB_LEFT');
    expect(paths('left')).toEqual(['/h', '/x']);
    await actions.run('COPY_TAB_TO_OTHER_SIDE');
    expect(paths('left')).toEqual(['/h', '/x']);
    expect(paths('right')).toEqual([null, '/h']);
    expect(ws.activeSide()).toBe('right');
    expect(ws.focusRequest()?.side).toBe('right');
    // the right side moves its tab back; then its last tab stays
    await actions.run('MOVE_TAB_TO_OTHER_SIDE');
    expect(paths('right')).toEqual([null]);
    expect(paths('left')).toEqual(['/h', '/x', '/h']);
    expect(ws.activeSide()).toBe('left');
    ws.setActive('right');
    expect(actions.state('MOVE_TAB_TO_OTHER_SIDE')).toBe('disabled');
    expect(actions.state('COPY_TAB_TO_OTHER_SIDE')).toBe('ready');
  });

  it('marks via actions', async () => {
    await actions.run('TOGGLE_MARK_AND_ADVANCE');
    expect(store.isMarked('/h/Sub')).toBe(true);
    await actions.run('INVERT_MARKS');
    expect([...store.marked()]).toEqual(['/h/a.txt']);
    await actions.run('SELECT_ALL');
    expect(store.marked().size).toBe(2);
    await actions.run('DESELECT_ALL');
    expect(store.marked().size).toBe(0);
  });

  it('switches panels and tabs, clones and closes tabs', async () => {
    await actions.run('TOGGLE_PANEL');
    expect(ws.activeSide()).toBe('right');
    await actions.run('SELECT_LEFT_PANEL');
    expect(ws.activeSide()).toBe('left');
    await actions.run('NEXT_TAB');
    expect(ws.panels().left.activeTab).toBe(1);
    await actions.run('CLONE_TAB');
    expect(ws.panels().left.tabs).toHaveLength(3);
    await actions.run('CLOSE_TAB');
    expect(ws.panels().left.tabs).toHaveLength(2);
    expect(ws.focusRequest()?.side).toBe('left');
  });

  it('opens the folder under the cursor in a new tab and toggles the favourite', async () => {
    await actions.run('OPEN_IN_NEW_TAB');
    expect(ws.panels().left.tabs.map((t) => t.path)).toEqual(['/h', '/h/Sub', '/x']);
    await actions.run('TOGGLE_FAVORITE');
    expect(ws.isFavorite('/h')).toBe(true);
  });

  it('opens the dialogs', async () => {
    await actions.run('OPEN_COMMAND_PALETTE');
    expect(dialogs.open()).toBe('palette');
    await actions.run('OPEN_MARK_PATTERN_DLG');
    expect(dialogs.open()).toBe('mark-pattern');
    await actions.run('OPEN_SHORTCUT_DLG');
    expect(dialogs.open()).toBe('shortcuts');
  });
});
