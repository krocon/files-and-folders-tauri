// @ts-expect-error -- node types are not part of the app's tsconfig; vitest runs in node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { DispatchEvent, KeyboardDispatcher } from '../../core/actions/keyboard-dispatcher';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { EMPTY_PROGRESS, Summary } from '../../core/jobs/jobs.models';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { ShellApi } from '../../core/shell/shell-api';
import { ShellSupportApi } from '../../core/shell/shell-support-api';
import { ShellRunResult } from '../../core/shell/shell.models';
import { ThemeApi } from '../../core/theme/theme-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { FakeShellApi, FakeShellSupportApi } from '../../../testing/fake-shell-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { ShellBar } from './shell-bar';
import { registerShellActions } from './shell-actions';
import { ShellStore } from './shell.store';

const flush = () => new Promise((r) => setTimeout(r));

const SUMMARY: Summary = {
  itemsDone: 0,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

/** jsdom has no ResizeObserver (the bar measures its width for the prompt). */
class NoResizeObserver {
  observe(): void {
    // no layout in jsdom
  }
  disconnect(): void {
    // nothing observed
  }
}

/** All .ts files below `src/` (for the import rule). */
function sources(dirPath: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dirPath) as string[]) {
    const p = `${dirPath}/${name}`;
    if (statSync(p).isDirectory()) {
      out.push(...sources(p));
    } else if (p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('shell bar (design 021)', () => {
  let shellApi: FakeShellApi;
  let support: FakeShellSupportApi;
  let jobsApi: FakeJobsApi;
  let actions: ActionService;
  let shell: ShellStore;
  let ws: WorkspaceStore;
  let left: FileBrowserStore;
  let listing: Record<string, unknown>;

  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResizeObserver;
  });

  beforeEach(async () => {
    shellApi = new FakeShellApi();
    support = new FakeShellSupportApi();
    support.history = ['git status', 'ls -la'];
    jobsApi = new FakeJobsApi();
    listing = {};
    const fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/src',
        parent: '/',
        segments: [{ name: '/', path: '/' }],
        entries: [
          entry('b.txt', { path: `${path ?? '/src'}/b.txt` }),
          dir('A Ordner', { path: `${path ?? '/src'}/A Ordner` }),
        ],
        unreadableEntries: 0,
        ...listing,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: SettingsApi, useValue: new FakeSettingsApi() },
        { provide: ShellApi, useValue: shellApi },
        { provide: ShellSupportApi, useValue: support },
      ],
    });
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    await TestBed.inject(JobsStore).init();
    shell = TestBed.inject(ShellStore);
    ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const controller = {
      displayedEntries: () => left.visibleEntries(),
    } as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => controller });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerShellActions(actions, shell);
    await left.load('/src');
    await right.load('/target');
  });

  /** Renders the bar (as the workspace does when it is visible). */
  async function bar() {
    const fixture = TestBed.createComponent(ShellBar);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input') as HTMLInputElement;
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const key = (k: string, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
      input.dispatchEvent(e);
      fixture.detectChanges();
      return e;
    };
    const render = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, input, type, key, render };
  }

  const output = (el: HTMLElement) => el.querySelector('.output .text')?.textContent ?? '';

  function emitOutput(id: string, stdout: string, stderr = '') {
    jobsApi.emit({
      type: 'shellOutput',
      id,
      chunks: [
        ...(stdout ? [{ stream: 'stdout' as const, text: stdout }] : []),
        ...(stderr ? [{ stream: 'stderr' as const, text: stderr }] : []),
      ],
      dropped: 0,
    });
  }

  /** Rust announces every job it starts (`added`) – before its end. */
  function added(id: string) {
    if (TestBed.inject(JobsStore).find(id)) {
      return;
    }
    jobsApi.emit({
      type: 'added',
      job: {
        id,
        spec: { kind: 'shell', cwd: '/src', command: 'x' },
        state: 'running',
        progress: EMPTY_PROGRESS,
        conflict: null,
        summary: null,
        pauseReason: null,
        undoAvailable: false,
      },
    });
  }

  function finish(
    id: string,
    exitCode: number | null,
    state: 'done' | 'doneWithErrors' | 'cancelled' = 'done',
  ) {
    added(id);
    jobsApi.emit({
      type: 'finished',
      id,
      state,
      summary: { ...SUMMARY, shell: { exitCode, signal: null } },
    });
  }

  it('only ShellBar may import ShellApi (the one way to run a command)', () => {
    const importers = sources('src')
      .filter((f) => !f.endsWith('.spec.ts') && !f.startsWith('src/testing/'))
      .filter((f) => /from '[./]*\/?(core\/shell\/)?shell-api'/.test(readFileSync(f, 'utf8')))
      .filter((f) => !f.endsWith('core/shell/shell-api.ts'));
    expect(importers).toEqual(['src/app/features/shell/shell-bar.ts']);
  });

  it('TOGGLE_SHELL shows and focuses, then hides; it follows shell.enabled', async () => {
    expect(actions.state('TOGGLE_SHELL')).toBe('ready');
    await actions.run('TOGGLE_SHELL');
    expect(shell.visible()).toBe(true);
    await flush();
    expect(shell.history()).toEqual(['git status', 'ls -la']);
    expect(ws.snapshot().shell?.visible).toBe(true); // kept in the session
    // visible, focus elsewhere → focus
    const before = shell.focusRequest();
    await actions.run('TOGGLE_SHELL');
    expect(shell.visible()).toBe(true);
    expect(shell.focusRequest()).toBe(before + 1);
    // focused → hide, the list gets the focus back
    shell.fieldFocused.set(true);
    await actions.run('TOGGLE_SHELL');
    expect(shell.visible()).toBe(false);
    expect(ws.focusRequest()?.side).toBe('left');
    TestBed.inject(SettingsStore).set('shell.enabled', false);
    expect(actions.state('TOGGLE_SHELL')).toBe('disabled');
  });

  it('Enter runs the typed line in the active folder; output streams in, the exit code ends it', async () => {
    const { el, input, type, key, render } = await bar();
    expect(el.querySelector('.prompt')?.textContent).toContain('/src>');
    type('ls -la');
    const e = key('Enter');
    expect(e.defaultPrevented).toBe(true);
    await flush();
    expect(shellApi.runs).toEqual([{ cwd: '/src', command: 'ls -la' }]);
    expect(input.value).toBe('');
    expect(shell.running()).toBe('s1');
    emitOutput('s1', 'total 8\n', 'ls: x: No such file\n');
    emitOutput('other', 'not mine\n');
    await render();
    expect(output(el)).toBe('/src> ls -la\ntotal 8\nls: x: No such file\n');
    expect(el.querySelector('.seg.stderr')?.textContent).toBe('ls: x: No such file\n');
    expect(el.querySelector('.running')).not.toBeNull();
    // Enter while it runs does nothing
    type('pwd');
    key('Enter');
    await flush();
    expect(shellApi.runs).toHaveLength(1);
    finish('s1', 2, 'doneWithErrors');
    await flush();
    await render();
    expect(shell.running()).toBeNull();
    expect(output(el)).toContain('Exit code 2');
    expect(shell.announcement()).toBe('Command finished with exit code 2.');
    expect(shell.history()[0]).toBe('ls -la');
  });

  it('output that overtakes the answer of run_shell is kept', async () => {
    const { el, type, key, render } = await bar();
    shellApi.answer = () =>
      new Promise<ShellRunResult>((resolve) => {
        emitOutput('s7', 'früh\n');
        resolve({ type: 'started', jobId: 's7', notices: ['loginEnvUnavailable'] });
      });
    type('echo früh');
    key('Enter');
    await flush();
    await render();
    expect(output(el)).toContain('früh\n');
    expect(output(el)).toContain('PATH of the login shell');
  });

  it('cd navigates the active panel, cd - goes back, clear empties; errors appear in the output', async () => {
    const { el, type, key, render } = await bar();
    shellApi.answer = (_cwd, command): ShellRunResult =>
      command === 'cd A Ordner'
        ? { type: 'navigate', path: '/src/A Ordner' }
        : command === 'cd -'
          ? { type: 'back' }
          : { type: 'clear' };
    type('cd A Ordner');
    key('Enter');
    await flush();
    expect(ws.navigateRequest()).toMatchObject({ side: 'left', path: '/src/A Ordner' });
    const ran: string[] = [];
    actions.register({ NAVIGATE_BACK: { run: () => void ran.push('back') } });
    type('cd -');
    key('Enter');
    await flush();
    expect(ran).toEqual(['back']);
    type('clear');
    key('Enter');
    await flush();
    await render();
    expect(output(el)).toBe('');
    shellApi.answer = null;
    shellApi.fail = { code: 'not_found', message: 'gone', path: '/src/fehlt' };
    type('cd fehlt');
    key('Enter');
    await flush();
    await render();
    expect(el.querySelector('.seg.error')?.textContent).toContain('does not exist');
    expect(shell.busy()).toBe(false);
  });

  it('Esc: closes suggestions, stops a running command, clears the text, then returns to the list', async () => {
    const { input, type, key } = await bar();
    shell.history.set(['git status', 'git log']);
    type('git');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    key('Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('git');
    key('Enter');
    await flush();
    key('Escape');
    expect(jobsApi.cancelled).toEqual(['s1']);
    finish('s1', null, 'cancelled');
    await flush();
    type('etwas');
    key('Escape');
    expect(input.value).toBe('');
    const seq = ws.focusRequest()?.seq ?? 0;
    key('Escape');
    expect(ws.focusRequest()?.seq).toBe(seq + 1);
  });

  it('Ctrl+C stops a running command only without a text selection', async () => {
    const { input, type, key } = await bar();
    type('sleep 30');
    key('Enter');
    await flush();
    type('abc');
    input.setSelectionRange(0, 2);
    key('c', { ctrlKey: true });
    expect(jobsApi.cancelled).toEqual([]);
    input.setSelectionRange(3, 3);
    const e = key('c', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(jobsApi.cancelled).toEqual(['s1']);
  });

  it('↑/↓ walk the history (draft kept); the suggestions take Enter', async () => {
    const { input, type, key } = await bar();
    shell.history.set(['git status', 'ls -la']);
    type('ec');
    key('ArrowUp');
    expect(input.value).toBe('git status');
    key('ArrowUp');
    expect(input.value).toBe('ls -la');
    key('ArrowDown');
    key('ArrowDown');
    expect(input.value).toBe('ec');
    type('git');
    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-0$/);
    key('Enter');
    expect(input.value).toBe('git status');
    expect(shellApi.runs).toHaveLength(0);
  });

  it('the field is locked inside an archive and without a folder; a result tab runs in its search folder', async () => {
    const { input, render } = await bar();
    listing = { archive: { path: '/src/a.zip', inner: '', format: 'zip', unsafeEntries: 0 } };
    await left.load('/src/a.zip');
    await render();
    expect(shell.locked()).toBe('archive');
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Not available inside an archive');
    expect(actions.state('SHELL_INSERT_NAMES')).toBe('disabled');
    listing = {};
    await left.load('/src');
    ws.updateTab(ws.activeTab('left').id, { path: '/r', title: 'r' });
    left.showSearch('k1', [
      { ...entry('x.txt', { path: '/r/a/x.txt' }), dir: '/r/a', parentNames: ['a', 'r', ''] },
    ] as never);
    await render();
    expect(shell.cwd()).toBe('/r');
    expect(input.disabled).toBe(false);
  });

  it('inserts the marked names (or full paths), quoted by Rust, at the caret', async () => {
    const { input, type, render } = await bar();
    type('ls  -l');
    input.setSelectionRange(3, 3);
    left.setMarked(['/src/b.txt', '/src/A Ordner'], true);
    await actions.run('SHELL_INSERT_NAMES');
    await render();
    expect(support.quoted.at(-1)).toEqual({ items: ['b.txt', 'A Ordner'], names: true });
    expect(input.value).toBe("ls b.txt 'A Ordner' -l");
    left.clearMarks();
    left.setCursor('/src/b.txt');
    input.setSelectionRange(input.value.length, input.value.length);
    await actions.run('SHELL_INSERT_PATHS');
    await render();
    expect(support.quoted.at(-1)).toEqual({ items: ['/src/b.txt'], names: false });
    expect(input.value).toBe("ls b.txt 'A Ordner' -l /src/b.txt ");
    // nothing is run by inserting
    expect(shellApi.runs).toHaveLength(0);
  });

  it('the dispatcher lets only the insert shortcuts and F-keys through in the field', async () => {
    const { input } = await bar();
    const keys = TestBed.inject(KeyboardDispatcher);
    const evt = (over: Partial<DispatchEvent>): DispatchEvent => ({
      key: 'x',
      code: 'KeyX',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      target: input,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      ...over,
    });
    left.setCursor('/src/b.txt');
    expect(keys.handle(evt({ key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true }))).toBe(
      'SHELL_INSERT_NAMES',
    );
    expect(keys.handle(evt({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true }))).toBe(
      'SHELL_INSERT_PATHS',
    );
    // other shortcuts stay in the text field (Ctrl+A selects the text, not all entries)
    expect(keys.handle(evt({ key: 'a', code: 'KeyA', ctrlKey: true }))).toBeNull();
    expect(keys.handle(evt({ key: 'Tab', code: 'Tab' }))).toBeNull();
    expect(keys.handle(evt({ key: 'Escape', code: 'Escape' }))).toBeNull();
    // F-keys act on the panel as in Total Commander; Shift+F11 hides the bar
    expect(keys.handle(evt({ key: 'F11', code: 'F11', shiftKey: true }))).toBe('TOGGLE_SHELL');
  });

  it('the output area keeps its height and open state in the session', async () => {
    shell.setOutputHeight(5000);
    expect(shell.outputHeight()).toBe(800);
    shell.setOutputHeight(10);
    expect(shell.outputHeight()).toBe(60);
    shell.setOutputOpen(false);
    expect(ws.snapshot().shell).toMatchObject({ outputOpen: false, outputHeight: 60 });
    ws.restore({ ...ws.snapshot(), shell: undefined });
    expect(shell.outputOpen()).toBe(true);
    expect(shell.outputHeight()).toBe(160);
    const { el } = await bar();
    expect(el.querySelector('.output')).not.toBeNull();
    expect(el.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('160');
  });
});
