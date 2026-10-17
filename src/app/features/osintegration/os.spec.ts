import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { DispatchEvent, KeyboardDispatcher } from '../../core/actions/keyboard-dispatcher';
import { FsApi } from '../../core/fs/fs-api';
import { DirEntry } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { ToolInfo } from '../../core/os/os.models';
import { SessionApi } from '../../core/session/session-api';
import { ThemeApi } from '../../core/theme/theme-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { CommandPalette } from '../actions/command-palette';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerOsActions } from './os-actions';
import { volumeLabel } from './os-texts';
import { OsStore } from './os.store';
import { VolumesStore } from './volumes.store';

const flush = () => new Promise((r) => setTimeout(r));

const tool = (id: string, over: Partial<ToolInfo> = {}): ToolInfo => ({
  id,
  label: id.toUpperCase(),
  shortcut: null,
  perFile: false,
  fileLimit: 10,
  needsFiles: true,
  program: id,
  ...over,
});

describe('OS integration (design 011)', () => {
  let osApi: FakeOsApi;
  let clip: FakeClipboardApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let os: OsStore;
  let left: FileBrowserStore;
  let displayed: DirEntry[] | null;

  beforeEach(async () => {
    displayed = null;
    osApi = new FakeOsApi();
    clip = new FakeClipboardApi();
    const fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/src',
        parent: '/',
        segments: [{ name: '/', path: '/' }],
        entries: [
          entry('b.txt', { path: `${path ?? '/src'}/b.txt` }),
          dir('A Ordner', { path: `${path ?? '/src'}/A Ordner` }),
          entry('"; rm -rf ~"', { path: `${path ?? '/src'}/"; rm -rf ~"` }),
        ],
        unreadableEntries: 0,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: OsApi, useValue: osApi },
        { provide: ClipboardApi, useValue: clip },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    dialogs = TestBed.inject(DialogService);
    os = TestBed.inject(OsStore);
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const controller = {
      displayedEntries: () => displayed ?? left.visibleEntries(),
    } as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => controller });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerOsActions(actions, os, dialogs);
    await left.load('/src');
    await right.load('/target');
  });

  it('copies names and paths as lines and JSON in display order, folders included', async () => {
    left.setMarked(['/src/b.txt', '/src/A Ordner'], true);
    // the table shows the folder first (sorted), the listing has it second
    displayed = [left.entries()[1], left.entries()[0], left.entries()[2]];
    expect(await actions.run('COPY_2_CLIPBOARD_NAMES')).toBe(true);
    expect(clip.written.at(-1)).toBe('A Ordner\nb.txt');
    await actions.run('COPY_2_CLIPBOARD_FULLNAMES_AS_JSON');
    expect(JSON.parse(clip.written.at(-1)!)).toEqual(['/src/A Ordner', '/src/b.txt']);
    expect(os.status()).toBe('2 paths copied as JSON.');
    // nothing marked: the cursor entry
    left.clearMarks();
    left.setCursor('/src/b.txt');
    await actions.run('COPY_2_CLIPBOARD_FULLNAMES');
    expect(clip.written.at(-1)).toBe('/src/b.txt');
    // a clipboard error becomes a message
    clip.fail = true;
    await actions.run('COPY_2_CLIPBOARD_NAMES_AS_JSON');
    expect(actions.messages().at(-1)).toContain('no clipboard');
  });

  it('copying needs an entry (the ".." row does not count)', async () => {
    left.setCursor(null);
    expect(actions.state('COPY_2_CLIPBOARD_NAMES')).toBe('disabled');
    left.setCursor('/src/b.txt');
    expect(actions.state('COPY_2_CLIPBOARD_NAMES')).toBe('ready');
  });

  it('tools become extra actions with shortcuts; the keymap wins, conflicts are reported', async () => {
    osApi.tools = {
      tools: [
        tool('edit'),
        tool('code', { shortcut: 'Mod+Shift+E' }),
        tool('taken', { shortcut: 'F5' }),
        tool('broken', { shortcut: 'Mod+Banana' }),
      ],
      warnings: ['Skipped a tool: tool x: …'],
      file: '/cfg/tools.json',
    };
    await os.init();
    expect(actions.extras().map((x) => x.id)).toEqual([
      'tool:edit',
      'tool:code',
      'tool:taken',
      'tool:broken',
    ]);
    expect(actions.extraShortcutLabel('tool:code')).toBe('Ctrl+Shift+E');
    expect(actions.extraShortcutLabel('tool:taken')).toBe('');
    const msgs = actions.messages();
    expect(msgs).toContain('Skipped a tool: tool x: …');
    expect(msgs.some((m) => m.includes('taken by "Copy…"'))).toBe(true);
    expect(msgs.some((m) => m.includes('"Mod+Banana" is not valid'))).toBe(true);

    // the dispatcher runs a tool by its shortcut
    const keys = TestBed.inject(KeyboardDispatcher);
    left.setCursor('/src/b.txt');
    const evt: DispatchEvent = {
      key: 'E',
      code: 'KeyE',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      repeat: false,
      target: null,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    };
    keys.handle(evt);
    await flush();
    expect(osApi.runs.at(-1)).toEqual({
      toolId: 'code',
      context: { files: ['/src/b.txt'], dir: '/src', targetDir: '/target' },
    });
  });

  it('sends the tool id and the context – never a command', async () => {
    osApi.tools = {
      tools: [tool('edit'), tool('dironly', { needsFiles: false })],
      warnings: [],
      file: null,
    };
    await os.loadTools();
    left.setMarked(['/src/"; rm -rf ~"', '/src/b.txt'], true);
    expect(await actions.run('OPEN_EDIT_DLG')).toBe(true);
    expect(osApi.runs.at(-1)).toEqual({
      toolId: 'edit',
      context: {
        files: ['/src/b.txt', '/src/"; rm -rf ~"'],
        dir: '/src',
        targetDir: '/target',
      },
    });
    expect(Object.keys(osApi.runs.at(-1)!.context).sort()).toEqual(['dir', 'files', 'targetDir']);
    // a tool that needs files, nothing selected: no call
    left.clearMarks();
    left.setCursor(null);
    const before = osApi.runs.length;
    expect(await actions.runExtra('tool:edit')).toBe(false);
    expect(osApi.runs.length).toBe(before);
    expect(actions.messages().at(-1)).toContain('Nothing selected');
    // a tool without file placeholders runs on the folder
    expect(await actions.runExtra('tool:dironly')).toBe(true);
    expect(osApi.runs.at(-1)!.context.files).toEqual([]);
    // backend errors are shown
    osApi.fail = {
      code: 'program_not_found',
      message: 'The program "code" was not found',
      path: null,
    };
    await actions.runExtra('tool:dironly');
    expect(actions.messages().at(-1)).toContain('was not found');
  });

  it('F4 (default app) asks before running a program, like Enter (review 011 #1)', async () => {
    osApi.tools = { tools: [tool('edit')], warnings: [], file: null };
    await os.loadTools();
    osApi.executables.add('/src/b.txt');
    const asked: string[] = [];
    let answer = false;
    left.confirmExecutable = (e) => (asked.push(e.path), Promise.resolve(answer));
    left.setCursor('/src/b.txt');
    await actions.run('OPEN_EDIT_DLG');
    expect(asked).toEqual(['/src/b.txt']);
    expect(osApi.runs).toHaveLength(0);
    expect(osApi.allowed).toEqual([false]);
    answer = true;
    await actions.run('OPEN_EDIT_DLG');
    expect(asked).toHaveLength(2);
    expect(osApi.allowed).toEqual([false, false, true]);
    expect(osApi.runs.at(-1)?.context.files).toEqual(['/src/b.txt']);
    // a plain document: no question
    osApi.executables.clear();
    await actions.run('OPEN_EDIT_DLG');
    expect(asked).toHaveLength(2);
  });

  it('F4 without an "edit" tool explains what is missing', async () => {
    osApi.tools = { tools: [], warnings: [], file: null };
    await os.loadTools();
    left.setCursor('/src/b.txt');
    await actions.run('OPEN_EDIT_DLG');
    expect(actions.messages().at(-1)).toContain('No tool "edit"');
  });

  it('reveals the cursor entry (else the folder) and opens the terminal in the folder', async () => {
    left.setCursor('/src/b.txt');
    await actions.run('REVEAL_IN_FILE_MANAGER');
    left.setCursor(null);
    await actions.run('REVEAL_IN_FILE_MANAGER');
    await actions.run('OPEN_TERMINAL_HERE');
    expect(osApi.reveals).toEqual(['/src/b.txt', '/src']);
    expect(osApi.terminals).toEqual(['/src']);
  });

  it('opens the tools palette and the configuration dialog', async () => {
    await actions.run('OPEN_TOOLS_DLG');
    expect(dialogs.open()).toBe('tools');
    dialogs.close();
    osApi.tools = { tools: [tool('edit')], warnings: [], file: '/cfg/tools.json' };
    await actions.run('OPEN_TOOL_CONFIG_DLG');
    expect(dialogs.open()).toBe('tool-config');
    expect(os.file()).toBe('/cfg/tools.json');
    await os.openConfigFile();
    expect(osApi.configOpened).toBe(1);
  });

  it('the palette in tools scope lists only the tools and runs one', async () => {
    osApi.tools = {
      tools: [tool('edit'), tool('code', { label: 'VS Code' })],
      warnings: [],
      file: null,
    };
    await os.loadTools();
    left.setCursor('/src/b.txt');
    dialogs.show('tools');
    const fixture = TestBed.createComponent(CommandPalette);
    fixture.componentRef.setInput('scope', 'tools');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const labels = [...el.querySelectorAll('[role="option"] .label')].map((o) => o.textContent);
    expect(labels).toEqual(['EDIT', 'VS Code']);
    const input = el.querySelector('input')!;
    input.value = 'vs';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    await flush();
    expect(osApi.runs.at(-1)?.toolId).toBe('code');
    expect(dialogs.open()).toBeNull();
  });

  it('drives: loading, then the list; a late older answer is dropped', async () => {
    const vs = TestBed.inject(VolumesStore);
    osApi.holdVolumes = true;
    osApi.volumes = [
      {
        path: '/',
        label: '/',
        kind: 'fixed',
        fsType: 'ext4',
        total: 2_000_000_000,
        free: 1_000_000_000,
        reachable: true,
      },
    ];
    const root = osApi.volumes;
    const first = vs.refresh();
    expect(vs.volumes()).toBeNull();
    osApi.volumes = [];
    const second = vs.refresh();
    // the newer answer comes first, the older one late: it must not win
    osApi.releaseVolumes('lifo');
    await Promise.all([first, second]);
    expect(vs.volumes()).toEqual([]);
    osApi.volumes = root;
    osApi.holdVolumes = false;
    await vs.refresh();
    expect(vs.volumes()).toEqual(root);
  });

  it('formats a volume line, unreachable ones without sizes', () => {
    expect(
      volumeLabel({
        path: '/mnt/nas',
        label: 'nas',
        kind: 'network',
        fsType: 'nfs4',
        total: null,
        free: null,
        reachable: false,
      }),
    ).toBe('nas – /mnt/nas  (nfs4 · not reachable)');
    expect(
      volumeLabel({
        path: '/',
        label: '/',
        kind: 'fixed',
        fsType: null,
        total: 1024,
        free: 512,
        reachable: true,
      }),
    ).toMatch(/^\/ {2}\(.+ free of .+\)$/);
  });
});
