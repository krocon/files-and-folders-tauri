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
import { ThemeApi } from '../../core/theme/theme-api';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeFileActionsApi } from '../../../testing/fake-file-actions-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeMenuApi } from '../../../testing/fake-menu-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { FileActionsDialog } from './file-actions-dialog';
import { FileActionsStore } from './file-actions.store';

const flush = () => new Promise((r) => setTimeout(r));

const NODE: FileActionRule = {
  id: 'node',
  trigger: 'doubleClick',
  modifiers: [],
  pattern: '*.js',
  confirm: true,
  command: 'node %N',
  terminal: false,
};
const QUIET: FileActionRule = {
  id: 'py',
  trigger: 'doubleClick',
  modifiers: [],
  pattern: '*.py',
  confirm: false,
  command: 'python3 %N',
  terminal: false,
};

describe('double-click actions (design 072)', () => {
  let api: FakeFileActionsApi;
  let store: FileActionsStore;
  let confirm: ConfirmService;
  let left: FileBrowserStore;

  beforeEach(async () => {
    api = new FakeFileActionsApi();
    api.loaded = { rules: [NODE, QUIET], warning: null, problems: [] };
    const fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/src',
        parent: '/',
        segments: [{ name: '/', path: '/' }],
        entries: [],
        unreadableEntries: 0,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: MenuApi, useValue: new FakeMenuApi() },
        { provide: FileActionsApi, useValue: api },
      ],
    });
    TestBed.inject(ActionService).platform.set('linux');
    const ws = TestBed.inject(WorkspaceStore);
    store = TestBed.inject(FileActionsStore);
    confirm = TestBed.inject(ConfirmService);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    await left.load('/src');
    await right.load('/target');
    await store.init();
  });

  it('runs only the rule with exactly the keys held (design 073)', async () => {
    api.loaded = {
      rules: [{ ...QUIET, id: 'shift', pattern: '*.js', modifiers: ['shift'] }, QUIET],
      warning: null,
      problems: [],
    };
    await store.init();
    expect(store.handleDoubleClick(entry('a.js'), ['shift'], left)).toBe(true);
    expect(store.handleDoubleClick(entry('a.js'), [], left)).toBe(false);
    expect(store.handleDoubleClick(entry('a.js'), ['mod'], left)).toBe(false);
    expect(store.handleDoubleClick(entry('a.py'), ['shift'], left)).toBe(false);
    await flush();
    expect(api.runs.map((r) => r.id)).toEqual(['shift']);
  });

  it('asks first if the rule says so and runs only on yes', async () => {
    const file = entry('a.js', { path: '/src/a.js' });
    expect(store.handleDoubleClick(file, [], left)).toBe(true);
    await flush();
    expect(confirm.request()?.message).toBe('node %N');
    expect(confirm.request()?.detail).toBe('/src/a.js');
    expect(api.runs).toEqual([]);
    confirm.answer(true);
    await flush();
    expect(api.runs).toEqual([
      { id: 'node', file: '/src/a.js', targetDir: expect.any(String), allowExecutable: false },
    ]);
    expect(store.status()).toContain('a.js');
  });

  it('does not run on no, and the double click stays taken', async () => {
    expect(store.handleDoubleClick(entry('a.js'), [], left)).toBe(true);
    await flush();
    confirm.answer(false);
    await flush();
    expect(api.runs).toEqual([]);
    expect(store.status()).toBe('');
  });

  it('runs at once without the question', async () => {
    expect(store.handleDoubleClick(entry('a.py'), [], left)).toBe(true);
    await flush();
    expect(confirm.request()).toBeNull();
    expect(api.runs.map((r) => r.id)).toEqual(['py']);
  });

  it('leaves everything else to the normal double click', () => {
    expect(store.handleDoubleClick(entry('a.txt'), [], left)).toBe(false);
    expect(store.handleDoubleClick(dir('b.js'), [], left)).toBe(false);
    expect(store.handleDoubleClick(entry('c.js', { path: 'remote://p/c.js' }), [], left)).toBe(
      false,
    );
    expect(api.runs).toEqual([]);
  });

  it('leaves a rule with a problem to the normal double click', async () => {
    api.loaded = {
      rules: [QUIET],
      warning: null,
      problems: [{ id: 'py', code: 'program' }],
    };
    await store.init();
    expect(store.handleDoubleClick(entry('a.py'), [], left)).toBe(false);
  });

  it('shows a failed start in the panel', async () => {
    api.fail = { code: 'program_not_found', message: 'no python3', path: null };
    store.handleDoubleClick(entry('a.py'), [], left);
    await flush();
    expect(left.error()?.code).toBe('program_not_found');
    expect(store.status()).toBe('');
  });

  it('asks like Enter before a launcher runs an executable', async () => {
    const answers: boolean[] = [];
    left.confirmExecutable = () => (answers.push(true), Promise.resolve(true));
    api.fail = { code: 'executable', message: 'exe', path: '/root/a.py' };
    store.handleDoubleClick(entry('a.py'), [], left);
    await flush();
    expect(answers).toEqual([true]);
    expect(api.runs.map((r) => r.allowExecutable)).toEqual([false, true]);
    expect(left.error()).toBeNull();
  });

  describe('dialog', () => {
    function open() {
      TestBed.inject(DialogService).show('file-actions');
      const fixture = TestBed.createComponent(FileActionsDialog);
      fixture.detectChanges();
      return { fixture, el: fixture.nativeElement as HTMLElement };
    }

    function buttons(el: HTMLElement, label: string): HTMLButtonElement {
      return [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
    }

    function type(el: HTMLElement, selector: string, value: string): void {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    it('adds a rule with trigger, pattern, question and command and saves it', async () => {
      api.loaded = { rules: [], warning: null, problems: [] };
      await store.init();
      const { fixture, el } = open();
      buttons(el, 'Add').click();
      fixture.detectChanges();
      expect(el.querySelector('select')?.value).toBe('doubleClick');
      const ask = el.querySelector<HTMLInputElement>('input.confirm')!;
      expect(ask.checked).toBe(true);
      type(el, 'input.pattern', '*.js');
      type(el, 'input.command', 'node %N');
      ask.checked = false;
      ask.dispatchEvent(new Event('change'));
      const terminal = el.querySelector<HTMLInputElement>('input.terminal')!;
      expect(terminal.checked).toBe(false);
      terminal.checked = true;
      terminal.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      buttons(el, 'Save').click();
      await flush();
      expect(api.saved).toEqual([
        [
          {
            id: expect.any(String),
            trigger: 'doubleClick',
            modifiers: [],
            pattern: '*.js',
            confirm: false,
            command: 'node %N',
            terminal: true,
          },
        ],
      ]);
      expect(store.rules()[0].command).toBe('node %N');
      expect(TestBed.inject(DialogService).open()).toBeNull();
    });

    it('keys held: checkboxes ↔ rule, shown before the pattern and in the heading (073)', async () => {
      const { fixture, el } = open();
      expect(el.querySelector('.rule-heading')?.textContent?.trim()).toBe('Double click on *.js');
      const shift = el.querySelector<HTMLInputElement>('input[data-modifier=shift]')!;
      const mod = el.querySelector<HTMLInputElement>('input[data-modifier=mod]')!;
      expect([shift.checked, mod.checked]).toEqual([false, false]);
      shift.checked = true;
      shift.dispatchEvent(new Event('change'));
      mod.checked = true;
      mod.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(el.querySelector('[aria-selected="true"] .keys')?.textContent).toBe('Ctrl+Shift');
      expect(el.querySelector('.rule-heading')?.textContent?.trim()).toBe(
        'Ctrl+Shift Double click on *.js',
      );
      buttons(el, 'Save').click();
      await flush();
      expect(api.saved[0][0].modifiers).toEqual(['mod', 'shift']);
    });

    it('has all buttons in the footer, Add/Remove/Up/Down with Mod+letter', () => {
      const { fixture, el } = open();
      const foot = el.querySelector('.foot')!;
      expect([...foot.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
        'Help',
        'Add',
        'Remove',
        'Up',
        'Down',
        'Cancel',
        'Save',
      ]);
      expect(buttons(el, 'Up').disabled).toBe(true);
      expect(buttons(el, 'Down').disabled).toBe(false);
      const key = (k: string) =>
        el
          .querySelector('.dialog')!
          .dispatchEvent(
            new KeyboardEvent('keydown', { key: k, ctrlKey: true, metaKey: true, bubbles: true }),
          );
      key('d'); // Down
      fixture.detectChanges();
      expect(el.querySelectorAll('[role=option]')[1].textContent).toContain('*.js');
      key('n'); // Add
      fixture.detectChanges();
      expect(el.querySelectorAll('[role=option]').length).toBe(3);
    });

    it('marks a rule that an identical one above hides, but saves it', async () => {
      api.loaded = {
        rules: [NODE, { ...NODE, id: 'copy', command: 'code %N' }],
        warning: null,
        problems: [],
      };
      await store.init();
      const { fixture, el } = open();
      const rows = el.querySelectorAll('[role=option]');
      expect(rows[1].classList.contains('shadowed')).toBe(true);
      expect(rows[0].classList.contains('shadowed')).toBe(false);
      el.querySelector('[role=listbox]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      fixture.detectChanges();
      expect(el.querySelector('.shadowed-hint')).not.toBeNull();
      buttons(el, 'Save').click();
      await flush();
      expect(api.saved[0].length).toBe(2);
    });

    it('shows an unknown trigger of a newer file as a problem', async () => {
      api.loaded = {
        rules: [{ ...NODE, trigger: 'middleClick' as 'doubleClick' }],
        warning: null,
        problems: [{ id: 'node', code: 'trigger' }],
      };
      await store.init();
      const { fixture, el } = open();
      expect(el.querySelector('#fnf-fa-problem')?.textContent).toContain('unknown');
      const select = el.querySelector<HTMLSelectElement>('select.trigger')!;
      select.value = 'doubleClick';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(el.querySelector('#fnf-fa-problem')?.textContent).toBe('');
    });

    it('opens the help on top of the dialog and Esc only closes the help', async () => {
      const { fixture, el } = open();
      expect(el.querySelector('app-file-actions-help')).toBeNull();
      buttons(el, 'Help').click();
      fixture.detectChanges();
      const help = el.querySelector('app-file-actions-help')!;
      expect(help.textContent).toContain('%P%N');
      expect(help.textContent).toContain('terminal');
      help
        .querySelector('.dialog')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('app-file-actions-help')).toBeNull();
      expect(TestBed.inject(DialogService).open()).toBe('file-actions');
    });

    it('stays open and shows the problem Rust found', async () => {
      const { fixture, el } = open();
      api.saveProblems = [{ id: 'py', code: 'program' }];
      buttons(el, 'Save').click();
      await flush();
      fixture.detectChanges();
      expect(api.saved).toEqual([]);
      expect(el.querySelector('[aria-selected="true"]')?.textContent).toContain('*.py');
      expect(el.querySelector('[aria-selected="true"]')?.getAttribute('aria-invalid')).toBe('true');
      expect(el.querySelector('#fnf-fa-problem')?.textContent).toContain('program name');
      // the edit may fix it: the mark goes until Rust checks again
      type(el, 'input.command', '/usr/bin/python3 %N');
      fixture.detectChanges();
      expect(el.querySelector('[aria-selected="true"]')?.getAttribute('aria-invalid')).toBeNull();
    });

    it('moves and removes rules; the order decides which one wins', async () => {
      const { fixture, el } = open();
      const list = el.querySelector('[role=listbox]')!;
      list.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      );
      fixture.detectChanges();
      expect([...el.querySelectorAll('[role=option]')].map((o) => o.textContent)).toEqual([
        expect.stringContaining('*.py'),
        expect.stringContaining('*.js'),
      ]);
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      fixture.detectChanges();
      buttons(el, 'Save').click();
      await flush();
      expect(api.saved[0].map((r) => r.id)).toEqual(['py']);
    });
  });
});
