import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { DiffApi } from '../../core/diff/diff-api';
import { DiffResult, DiffRow } from '../../core/diff/diff.models';
import { FsApi } from '../../core/fs/fs-api';
import { parentRow } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { OsApi } from '../../core/os/os-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { FakeDiffApi } from '../../../testing/fake-diff-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { OsStore } from '../osintegration/os.store';
import { cellText, changeStarts, hexLines, pickFiles } from './compare-files-logic';
import { registerDiffActions } from './diff-actions';
import { DiffDialog } from './diff-dialog';
import { CONTEXT_LINES, DiffStore } from './diff.store';

@Component({ selector: 'app-preview-grid', template: '{{ rows().length }} rows' })
class StubGrid {
  readonly rows = input.required<readonly unknown[]>();
  readonly columns = input<unknown>();
  readonly rowClass = input<unknown>();
  readonly activeIndex = input<number>(-1);
  readonly labelledBy = input<string | null>(null);
}

const flush = () => new Promise((r) => setTimeout(r));
const a = entry('a.txt', { path: '/l/a.txt' });
const b = entry('b.txt', { path: '/l/b.txt' });
const c = entry('c.txt', { path: '/r/c.txt' });
const sub = dir('sub', { path: '/l/sub' });

const row = (kind: DiffRow['kind'], l: string | null, r: string | null): DiffRow => ({
  kind,
  left: l === null ? null : [1, l],
  right: r === null ? null : [1, r],
});

describe('compare files: picking the two files (design 037)', () => {
  it('two marked files of the active side, else cursor against cursor', () => {
    expect(pickFiles({ side: 'right', marked: [a, b], cursor: c }, null)).toEqual({
      left: a,
      right: b,
    });
    // the left panel's file is shown left, whichever side is active
    expect(
      pickFiles({ side: 'right', marked: [], cursor: c }, { side: 'left', marked: [], cursor: a }),
    ).toEqual({ left: a, right: c });
    expect(
      pickFiles({ side: 'left', marked: [b], cursor: a }, { side: 'right', marked: [], cursor: c }),
    ).toEqual({ left: b, right: c });
  });

  it('names what is missing', () => {
    expect(pickFiles({ side: 'left', marked: [a, b, c], cursor: a }, null)).toEqual({
      problem: 'twoMarked',
    });
    expect(pickFiles({ side: 'left', marked: [a, sub], cursor: a }, null)).toEqual({
      problem: 'notFiles',
    });
    expect(
      pickFiles(
        { side: 'left', marked: [], cursor: a },
        { side: 'right', marked: [], cursor: sub },
      ),
    ).toEqual({ problem: 'noOtherFile' });
    expect(
      pickFiles(
        { side: 'left', marked: [], cursor: parentRow('/') },
        { side: 'right', marked: [], cursor: c },
      ),
    ).toEqual({ problem: 'notFiles' });
    expect(
      pickFiles({ side: 'left', marked: [], cursor: a }, { side: 'right', marked: [], cursor: a }),
    ).toEqual({ problem: 'same' });
  });

  it('finds the blocks of differences, keeps spaces and shows hex with absolute offsets', () => {
    const rows = [
      row('equal', 'x', 'x'),
      row('changed', 'a', 'b'),
      row('added', null, 'c'),
      row('skip', null, null),
      row('removed', 'd', null),
    ];
    expect(changeStarts(rows)).toEqual([1, 4]);
    expect(cellText('\tif  (x)')).toBe('    if  (x)');
    expect(hexLines([0x41, 0x00], 0x20)).toEqual([`00000020  41 00${' '.repeat(42)}  |A.|`]);
  });
});

describe('compare files: store and dialog (design 037)', () => {
  let api: FakeDiffApi;
  let os: FakeOsApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let diff: DiffStore;
  let leftCursor: string | null;
  let rightCursor: string | null;
  let left: FileBrowserStore;

  const text = (rows: DiffRow[], changes: number): DiffResult => ({
    kind: 'text',
    left: { size: 10, encoding: 'utf-8', eol: 'lf' },
    right: { size: 12, encoding: 'windows-1252', eol: 'crlf' },
    rows,
    changes,
    truncated: false,
  });

  beforeEach(async () => {
    const fs = new FakeFsApi();
    fs.handler = (p) =>
      Promise.resolve(p === '/r' ? listing('/r', [c], '/') : listing('/l', [a, b, sub], '/'));
    api = new FakeDiffApi();
    os = new FakeOsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: DiffApi, useValue: api },
        { provide: OsApi, useValue: os },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    TestBed.overrideComponent(DiffDialog, {
      remove: { imports: [PreviewGrid] },
      add: { imports: [StubGrid] },
    });
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    diff = TestBed.inject(DiffStore);
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    leftCursor = null;
    rightCursor = null;
    const ctl = (s: FileBrowserStore, cur: () => string | null) =>
      ({
        cursorEntry: () => s.entries().find((e) => e.path === cur()) ?? null,
      }) as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => ctl(left, () => leftCursor) });
    ws.registerPanel('right', { store: right, controller: () => ctl(right, () => rightCursor) });
    registerDiffActions(actions, diff);
    await left.load('/l');
    await right.load('/r');
  });

  it('compares the two cursor files, steps through the differences, reloads with options', async () => {
    expect(actions.state('COMPARE_FILES')).toBe('disabled');
    leftCursor = '/l/a.txt';
    rightCursor = '/r/c.txt';
    expect(actions.state('COMPARE_FILES')).toBe('ready');
    api.result = text(
      [row('changed', 'a', 'b'), row('equal', 'x', 'x'), row('added', null, '\tneu')],
      2,
    );
    await actions.run('COMPARE_FILES');
    await flush();
    expect(dialogs.open()).toBe('diff');
    expect(api.calls[0]).toEqual({
      left: '/l/a.txt',
      right: '/r/c.txt',
      options: { ignoreWhitespace: false, ignoreCase: false, context: CONTEXT_LINES },
    });
    expect(diff.starts()).toEqual([0, 2]);
    expect(diff.activeRow()).toBe(0);
    expect(diff.gridRows()[2].rt).toBe('    neu');
    diff.next();
    expect(diff.activeRow()).toBe(2);
    diff.next();
    expect(diff.activeRow()).toBe(2);
    diff.previous();
    expect(diff.activeRow()).toBe(0);

    // the dialog shows both sides and the count
    const f = TestBed.createComponent(DiffDialog);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('/l/a.txt');
    expect(el.textContent).toContain('WINDOWS-1252'.toLowerCase());
    expect(el.textContent).toContain('2 differences');
    // F7 / Shift+F7 inside the dialog
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true }));
    expect(diff.activeRow()).toBe(2);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', shiftKey: true, bubbles: true }));
    expect(diff.activeRow()).toBe(0);

    api.result = text([row('skip', null, null)], 0);
    diff.setOptions({ ignoreWhitespace: true, wholeFile: true });
    await flush();
    expect(api.calls[1].options).toEqual({
      ignoreWhitespace: true,
      ignoreCase: false,
      context: null,
    });
    f.detectChanges();
    expect(el.textContent).toContain('identical (with the chosen options)');
    diff.close();
    expect(dialogs.open()).toBeNull();
  });

  it('drops a stale answer and shows errors as text', async () => {
    left.setMarked(['/l/a.txt', '/l/b.txt'], true);
    api.fail = { code: 'too_many', message: 'big', path: '/l/a.txt' };
    diff.open();
    await flush();
    expect(diff.error()).not.toBeNull();
    expect(diff.result()).toBeNull();
  });

  it('binaries: counts and hex windows; the external tool gets both files', async () => {
    leftCursor = '/l/a.txt';
    rightCursor = '/r/c.txt';
    api.result = {
      kind: 'binary',
      left: { size: 100, encoding: null, eol: null },
      right: { size: 100, encoding: null, eol: null },
      identical: false,
      ranges: [{ offset: 5, len: 2 }],
      differingBytes: 2,
      windowOffset: 0,
      leftWindow: [1, 2, 3],
      rightWindow: [1, 9, 3],
    };
    TestBed.inject(OsStore).tools.set([
      {
        id: 'diff',
        label: 'Compare (Meld)',
        shortcut: null,
        perFile: false,
        fileLimit: 2,
        needsFiles: true,
        program: 'meld',
      },
    ] as never);
    diff.open();
    await flush();
    const f = TestBed.createComponent(DiffDialog);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('2 bytes differ in 1 range');
    expect(el.textContent).toContain('0x5');
    expect(el.querySelectorAll('pre')).toHaveLength(2);
    expect(el.textContent).toContain('Open in Compare (Meld)');
    await diff.openExternal();
    expect(os.runs[0]).toMatchObject({
      toolId: 'diff',
      context: { files: ['/l/a.txt', '/r/c.txt'] },
    });
    expect(dialogs.open()).toBeNull();
  });
});
