import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { DEFAULT_KEYMAPS } from '../../core/actions/keymap';
import { SessionApi } from '../../core/session/session-api';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { newTab, WorkspaceStore } from '../workspace/workspace.store';
import { registerColumnActions } from './columns-actions';
import { ColumnsStore } from './columns.store';

describe('columns and view modes (design 041)', () => {
  let settings: SettingsStore;
  let columns: ColumnsStore;
  let actions: ActionService;
  let dialogs: DialogService;
  let ws: WorkspaceStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsApi, useValue: new FakeSettingsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    settings = TestBed.inject(SettingsStore);
    columns = TestBed.inject(ColumnsStore);
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    ws = TestBed.inject(WorkspaceStore);
    TestBed.tick();
  });

  const ids = () => columns.items().map((i) => (i.visible ? i.id : `(${i.id})`));

  it('starts with name, extension, size and modified; a broken setting is the default', () => {
    expect(columns.chosen()).toEqual(['name', 'ext', 'size', 'modifiedMs']);
    settings.set('view.columns', ['size', 'bogus', 'size']);
    expect(columns.chosen()).toEqual(['name', 'size']);
  });

  it('the menus have a check entry per column except the name; choosing one toggles it', async () => {
    const choices = () => actions.columnChoices().map((c) => [c.id, c.checked]);
    expect(choices()).toEqual([
      ['column:ext', true],
      ['column:size', true],
      ['column:modifiedMs', true],
      ['column:createdMs', false],
      ['column:accessedMs', false],
      ['column:attrs', false],
      ['column:type', false],
    ]);
    expect(await actions.runAny('column:createdMs')).toBe(true);
    expect(await actions.runAny('column:size')).toBe(true);
    TestBed.tick();
    expect(settings.get('view.columns')).toEqual(['name', 'ext', 'modifiedMs', 'createdMs']);
    expect(actions.columnChoices().find((c) => c.id === 'column:size')?.checked).toBe(false);
    // the acceptance case of the prompt: "Created" in, "Size" out – and it is one setting for all tabs
    expect(columns.chosen()).toEqual(['name', 'ext', 'modifiedMs', 'createdMs']);
  });

  it('dialog: Space toggles, Alt+arrows move, every change shows at once', () => {
    columns.open();
    expect(dialogs.open()).toBe('columns');
    expect(ids()).toEqual([
      'name',
      'ext',
      'size',
      'modifiedMs',
      '(createdMs)',
      '(accessedMs)',
      '(attrs)',
      '(type)',
    ]);
    // the name cannot be hidden
    columns.toggleAt(0);
    expect(columns.chosen()).toContain('name');
    columns.toggleAt(2); // size off
    columns.toggleAt(4); // created on
    expect(settings.get('view.columns')).toEqual(['name', 'ext', 'modifiedMs', 'createdMs']);
    expect(columns.announcement()).toBe('Created: shown');
    // a hidden column keeps its line while the dialog is open
    expect(ids()[2]).toBe('(size)');
    // move "Created" up three places: in front of the extension
    columns.select(4);
    columns.moveSelected(-1);
    columns.moveSelected(-1);
    columns.moveSelected(-1);
    expect(columns.selected()).toBe(1);
    expect(settings.get('view.columns')).toEqual(['name', 'createdMs', 'ext', 'modifiedMs']);
    expect(columns.announcement()).toBe('Created: position 2 of 8');
    // the ends stop
    columns.select(0);
    expect(columns.canMove(-1)).toBe(false);
    columns.moveSelected(-1);
    expect(columns.selected()).toBe(0);
    columns.select(99);
    expect(columns.selected()).toBe(7);
    expect(columns.canMove(1)).toBe(false);
    columns.apply();
    expect(dialogs.open()).toBeNull();
    expect(columns.chosen()).toEqual(['name', 'createdMs', 'ext', 'modifiedMs']);
  });

  it('dialog: Cancel puts back the columns from before, Defaults the first four', () => {
    settings.set('view.columns', ['name', 'type']);
    columns.open();
    columns.toggleAt(1); // type off
    columns.moveSelected(1);
    columns.defaults();
    expect(columns.chosen()).toEqual(['name', 'ext', 'size', 'modifiedMs']);
    columns.cancel();
    expect(dialogs.open()).toBeNull();
    expect(columns.chosen()).toEqual(['name', 'type']);
  });

  it('actions: the three views belong to the active tab; the dialog opens', () => {
    const left = newTab('/a');
    const other = newTab('/b');
    ws.restore({
      ...ws.snapshot(),
      activeSide: 'left',
      panels: {
        left: { activeTab: 0, tabs: [left, other] },
        right: { activeTab: 0, tabs: [newTab('/c')] },
      },
    });
    const off = registerColumnActions(actions, ws, columns);
    const view = (id: string) => ws.findTab(id)?.view ?? 'full';
    void actions.run('VIEW_MODE_THUMBNAILS');
    expect(view(left.id)).toBe('thumbnails');
    expect(view(other.id)).toBe('full');
    expect(view(ws.activeTab('right').id)).toBe('full');
    void actions.run('VIEW_MODE_BRIEF');
    expect(view(left.id)).toBe('brief');
    // the view of a tab is saved with it
    expect(ws.snapshot().panels.left.tabs[0].view).toBe('brief');
    void actions.run('VIEW_MODE_FULL');
    expect(view(left.id)).toBe('full');
    // the disk usage keeps its columns: no other view there
    ws.updateTab(left.id, { search: { key: 'usage:1', label: 'Usage' } });
    expect(actions.state('VIEW_MODE_BRIEF')).toBe('disabled');
    ws.updateTab(left.id, { search: null });
    expect(actions.state('VIEW_MODE_BRIEF')).toBe('ready');
    void actions.run('OPEN_COLUMNS_DLG');
    expect(dialogs.open()).toBe('columns');
    off();
  });

  it('keys: Total Commander on Windows and Linux, the Finder’s on macOS', () => {
    for (const os of ['windows', 'linux'] as const) {
      expect(DEFAULT_KEYMAPS[os]['VIEW_MODE_FULL']).toEqual(['Mod+F2']);
      expect(DEFAULT_KEYMAPS[os]['VIEW_MODE_BRIEF']).toEqual(['Mod+F1']);
      expect(DEFAULT_KEYMAPS[os]['VIEW_MODE_THUMBNAILS']).toEqual(['Mod+Shift+F1']);
    }
    // Ctrl+F1/F2 belong to macOS (menu bar, Dock)
    expect(DEFAULT_KEYMAPS.macos['VIEW_MODE_FULL']).toEqual(['Mod+1']);
    expect(DEFAULT_KEYMAPS.macos['VIEW_MODE_BRIEF']).toEqual(['Mod+2']);
    expect(DEFAULT_KEYMAPS.macos['VIEW_MODE_THUMBNAILS']).toEqual(['Mod+3']);
  });
});
