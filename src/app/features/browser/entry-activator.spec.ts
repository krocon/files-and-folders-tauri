// @ts-expect-error – node module in a spec (vitest runs in node)
import { readdirSync, readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FileActionsApi } from '../../core/fileactions/file-actions-api';
import { FileActionRule } from '../../core/fileactions/file-actions.models';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { MenuApi } from '../../core/menu/menu-api';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { ThemeApi } from '../../core/theme/theme-api';
import { FakeFileActionsApi } from '../../../testing/fake-file-actions-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeMenuApi } from '../../../testing/fake-menu-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileActionsStore } from '../fileactions/file-actions.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { EntryActivator } from './entry-activator';
import { FileBrowserStore } from './file-browser.store';

const flush = () => new Promise((r) => setTimeout(r));

const rule = (id: string, modifiers: FileActionRule['modifiers']): FileActionRule => ({
  id,
  trigger: 'doubleClick',
  modifiers,
  pattern: '*.mp4',
  confirm: false,
  command: 'player %N',
  terminal: false,
});

const MP4 = entry('clip.mp4', { path: '/src/clip.mp4' });
const TXT = entry('a.txt', { path: '/src/a.txt' });
const ZIP = entry('pack.zip', { path: '/src/pack.zip' });
const SUB = dir('sub', { path: '/src/sub' });

describe('EntryActivator: one place for "open like a double click" (design 079 E1)', () => {
  let fs: FakeFsApi;
  let rules: FakeFileActionsApi;
  let settings: SettingsStore;
  let actions: ActionService;
  let panel: FileBrowserStore;
  let activator: EntryActivator;
  let viewed: (string | null)[];

  beforeEach(async () => {
    fs = new FakeFsApi();
    fs.handler = (p) =>
      Promise.resolve(
        p === '/src'
          ? listing('/src', [SUB, TXT, MP4, ZIP])
          : listing(p ?? '/', [entry('in.txt', { path: `${p}/in.txt` })], '/src'),
      );
    rules = new FakeFileActionsApi();
    rules.loaded = {
      rules: [rule('shifted', ['shift']), rule('plain', [])],
      warning: null,
      problems: [],
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: MenuApi, useValue: new FakeMenuApi() },
        { provide: SettingsApi, useValue: new FakeSettingsApi() },
        { provide: FileActionsApi, useValue: rules },
      ],
    });
    settings = TestBed.inject(SettingsStore);
    await settings.init();
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    panel = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const other = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const ws = TestBed.inject(WorkspaceStore);
    ws.registerPanel('left', { store: panel, controller: () => undefined });
    ws.registerPanel('right', { store: other, controller: () => undefined });
    await panel.load('/src');
    await TestBed.inject(FileActionsStore).init();
    viewed = [];
    actions.register({ OPEN_VIEW_DLG: { run: () => void viewed.push(panel.cursorPath()) } });
    activator = TestBed.inject(EntryActivator);
  });

  it('decides in the order rule → viewer → open, with the keys held', async () => {
    settings.set('behavior.doubleClick', 'view');
    expect(activator.decide(MP4, [], panel)).toBe('rule');
    expect(activator.decide(MP4, ['shift'], panel)).toBe('rule');
    // no rule for these keys: the setting decides
    expect(activator.decide(MP4, ['alt'], panel)).toBe('handled');
    expect(activator.decide(TXT, [], panel)).toBe('handled');
    // a folder is entered whatever the setting says
    expect(activator.decide(SUB, [], panel)).toBe('open');
    settings.set('behavior.doubleClick', 'open');
    expect(activator.decide(TXT, [], panel)).toBe('open');
    await flush();
    expect(rules.runs.map((r) => r.id)).toEqual(['plain', 'shifted']);
    expect(viewed.length).toBe(2);
    // deciding never opens: that is the caller's part
    expect(fs.opened).toEqual([]);
  });

  it('activate = a double click without keys: the plain rule runs, never the one with Shift', async () => {
    panel.setMarked(['/src/a.txt'], true);
    expect(await activator.activate(MP4, panel)).toBe('rule');
    await flush();
    expect(rules.runs).toEqual([
      { id: 'plain', file: '/src/clip.mp4', targetDir: null, allowExecutable: false },
    ]);
    expect(fs.opened).toEqual([]);
    expect(panel.cursorPath()).toBe('/src/clip.mp4');
    // there was no click: the marks are untouched
    expect([...panel.marked()]).toEqual(['/src/a.txt']);
  });

  it('activate without a rule opens the file with its default application', async () => {
    expect(await activator.activate(TXT, panel)).toBe('open');
    expect(fs.opened).toEqual([{ path: '/src/a.txt', allowExecutable: false }]);
    expect(panel.cursorPath()).toBe('/src/a.txt');
  });

  it('activate with "double click views": the viewer gets the entry under the cursor', async () => {
    settings.set('behavior.doubleClick', 'view');
    panel.setCursor('/src/sub');
    expect(await activator.activate(TXT, panel)).toBe('handled');
    await flush();
    expect(viewed).toEqual(['/src/a.txt']);
    expect(fs.opened).toEqual([]);
  });

  it('activate enters an archive like a folder (design 016 E1)', async () => {
    expect(await activator.activate(ZIP, panel)).toBe('open');
    expect(panel.path()).toBe('/src/pack.zip');
    expect(fs.opened).toEqual([]);
  });

  it('a failing open reports like the double click: in the panel, cursor on the file', async () => {
    fs.openFile = () => Promise.reject({ code: 'not_found', message: 'gone', path: TXT.path });
    await activator.activate(TXT, panel);
    expect(panel.error()?.code).toBe('not_found');
    expect(panel.path()).toBe('/src');
    expect(panel.cursorPath()).toBe('/src/a.txt');
  });

  // design 079 §4: only Enter in the path field opens – nothing else may call `activate`
  it('has exactly one caller of activate: the path field of the panel', () => {
    const root = 'src/app';
    const callers: string[] = [];
    const walk = (folder: string) => {
      for (const e of readdirSync(folder, { withFileTypes: true })) {
        const p = `${folder}/${e.name}`;
        if (e.isDirectory()) {
          walk(p);
        } else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) {
          if (
            /\bactivator\b[^;]*\.activate\(|EntryActivator\)\s*\.activate\(/.test(
              readFileSync(p, 'utf8'),
            )
          ) {
            callers.push(p);
          }
        }
      }
    };
    walk(root);
    expect(callers).toEqual(['src/app/features/workspace/file-panel.ts']);
  });
});
