import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobState, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { FakeTableBridge } from '../../../testing/fake-table-bridge';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerOpsActions } from './ops-actions';
import { CopyMoveInput, OpsStore } from './ops.store';

const SUMMARY: Summary = {
  itemsDone: 1,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const INPUT: CopyMoveInput = {
  target: '/dst',
  name: null,
  conflictDefault: 'ask',
  background: false,
  allowDangerous: false,
};

const flush = () => new Promise((r) => setTimeout(r));

describe('file operations (design 006)', () => {
  let fs: FakeFsApi;
  let jobsApi: FakeJobsApi;
  let actions: ActionService;
  let ops: OpsStore;
  let dialogs: DialogService;
  let jobs: JobsStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  /** Entries the "backend" created meanwhile. */
  let created: string[];

  beforeEach(async () => {
    fs = new FakeFsApi();
    created = [];
    fs.handler = (p) =>
      Promise.resolve(
        p === '/src'
          ? listing('/src', [
              dir('Ordner', { path: '/src/Ordner' }),
              dir('S01', { path: '/src/S01' }),
              dir('S02', { path: '/src/S02' }),
              entry('a.txt', { path: '/src/a.txt' }),
              entry('b.txt', { path: '/src/b.txt' }),
              ...created.map((n) => entry(n, { path: `/src/${n}` })),
            ])
          : listing('/dst', []),
      );
    fs.locations = {
      '/dst': { dir: '/dst', select: null },
      '/src': { dir: '/src', select: null },
      '/src/a.txt': { dir: '/src', select: '/src/a.txt' },
    };
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    ops = TestBed.inject(OpsStore);
    dialogs = TestBed.inject(DialogService);
    jobs = TestBed.inject(JobsStore);
    await jobs.init();
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    await left.load('/src');
    await right.load('/dst');
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerOpsActions(actions, ops);
  });

  function finish(index: number, state: JobState = 'done', summary: Partial<Summary> = {}) {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[index].id,
      state,
      summary: { ...SUMMARY, ...summary },
    });
  }

  it('is disabled without a selection; rename needs exactly one entry', () => {
    expect(actions.state('OPEN_COPY_DLG')).toBe('disabled');
    expect(actions.state('OPEN_DELETE_DLG')).toBe('disabled');
    expect(actions.state('OPEN_MKDIR_DLG')).toBe('ready');
    left.setCursor('/src/a.txt');
    expect(actions.state('OPEN_COPY_DLG')).toBe('ready');
    expect(actions.state('RENAME_INLINE')).toBe('ready');
    left.setMarked(['/src/a.txt', '/src/b.txt'], true);
    expect(actions.state('OPEN_RENAME_DLG')).toBe('disabled');
  });

  it('F5: marked entries to the other panel, then unmarked', async () => {
    left.setMarked(['/src/Ordner', '/src/a.txt'], true);
    await actions.run('OPEN_COPY_DLG');
    expect(dialogs.open()).toBe('copy-move');
    const req = ops.copyMove()!;
    expect(req.kind).toBe('copy');
    expect(req.sources.map((e) => e.path)).toEqual(['/src/Ordner', '/src/a.txt']);
    expect(req.target).toBe('/dst');
    expect(req.targets[0]).toEqual({ path: '/dst', group: 'Other panel' });
    expect(await ops.runCopyMove(req, { ...INPUT, conflictDefault: 'skip' })).toBeNull();
    expect(dialogs.open()).toBeNull();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'copy',
      sources: ['/src/Ordner', '/src/a.txt'],
      targetDir: '/dst',
      background: false,
      options: { conflictDefault: 'skip', renameTo: null },
    });
    finish(0);
    await flush();
    expect(left.marked().size).toBe(0);
  });

  it('copy into the same folder needs a new name (single source)', async () => {
    left.setCursor('/src/a.txt');
    await ops.openCopyMove('copy');
    const req = ops.copyMove()!;
    expect((await ops.runCopyMove(req, { ...INPUT, target: '/src', name: 'a.txt' }))?.code).toBe(
      'same_source_target',
    );
    expect((await ops.runCopyMove(req, { ...INPUT, target: '/src/a.txt' }))?.code).toBe(
      'not_a_directory',
    );
    expect((await ops.runCopyMove(req, { ...INPUT, target: '/nix' }))?.code).toBe('not_found');
    expect((await ops.runCopyMove(req, { ...INPUT, target: '  ' }))?.code).toBe('invalid_path');
    expect(jobsApi.started).toEqual([]);
    expect(dialogs.open()).toBe('copy-move');
    expect(
      await ops.runCopyMove(req, { ...INPUT, target: '/src', name: 'Kopie von a.txt' }),
    ).toBeNull();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'copy',
      targetDir: '/src',
      options: { renameTo: 'Kopie von a.txt' },
    });
  });

  it('F6: dangerous sources are listed and need the extra confirmation', async () => {
    left.setCursor('/src/Ordner');
    fs.dangers['/src/Ordner'] = 'home';
    await actions.run('OPEN_MOVE_DLG');
    const req = ops.copyMove()!;
    expect(req.kind).toBe('move');
    expect(req.dangers).toEqual([{ path: '/src/Ordner', danger: 'home' }]);
    await ops.runCopyMove(req, { ...INPUT, allowDangerous: true });
    expect(jobsApi.started[0].spec).toMatchObject({ kind: 'move', allowDangerous: true });
  });

  it('a refused job stays in the dialog as an error', async () => {
    left.setCursor('/src/a.txt');
    await ops.openCopyMove('copy');
    jobsApi.refuse = { code: 'invalid_name', message: 'bad', path: null };
    expect((await ops.runCopyMove(ops.copyMove()!, INPUT))?.code).toBe('invalid_name');
    expect(dialogs.open()).toBe('copy-move');
  });

  it('F8: trash by default, the cursor moves to the next remaining entry', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('OPEN_DELETE_DLG');
    expect(dialogs.open()).toBe('delete');
    const req = ops.del()!;
    expect(req.mode).toBe('trash');
    expect(await ops.runDelete(req, false)).toBeNull();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'delete',
      paths: ['/src/a.txt'],
      mode: 'trash',
      allowDangerous: false,
    });
    expect(left.cursorPath()).toBe('/src/b.txt');
  });

  it('Shift+F8: permanent; failed entries stay marked and are reported', async () => {
    left.setMarked(['/src/a.txt', '/src/b.txt'], true);
    await actions.run('DELETE_PERMANENT');
    expect(ops.del()!.mode).toBe('permanent');
    await ops.runDelete(ops.del()!, false);
    finish(0, 'doneWithErrors', {
      itemsFailed: 1,
      errors: [
        { path: '/src/b.txt', error: { code: 'permission_denied', message: 'no', path: null } },
      ],
    });
    await flush();
    expect([...left.marked()]).toEqual(['/src/b.txt']);
    expect(jobs.messages().at(-1)).toContain('1 error');
  });

  it('F7: suggests the next name of a series, creates and puts the cursor on it', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('OPEN_MKDIR_DLG');
    const req = ops.name()!;
    expect(req.kind).toBe('mkdir');
    expect(req.initial).toBe('S03');
    created.push('Neu');
    expect(await ops.runName(req, ' Neu/Unter ', false)).toBeNull();
    await flush();
    expect(fs.ops).toEqual(['mkdir /src Neu/Unter']);
    expect(dialogs.open()).toBeNull();
    expect(left.cursorPath()).toBe('/src/Neu');
  });

  it('errors keep the name dialog open', async () => {
    await actions.run('OPEN_CREATE_FILE_DLG');
    const req = ops.name()!;
    expect(req.initial).toBe('');
    expect((await ops.runName(req, '   ', false))?.code).toBe('invalid_name');
    fs.failNext = { code: 'already_exists', message: 'exists', path: '/src/x' };
    expect((await ops.runName(req, 'x', false))?.code).toBe('already_exists');
    expect(dialogs.open()).toBe('name');
    expect(await ops.runName(req, 'x', false)).toBeNull();
    expect(fs.ops).toEqual(['touch /src x', 'touch /src x']);
  });

  it('Shift+F6: the name without extension is selected; rename moves the cursor', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('OPEN_RENAME_DLG');
    const req = ops.name()!;
    expect(req.initial).toBe('a.txt');
    expect(req.selectEnd).toBe(1);
    expect(await ops.runName(req, 'a.txt', false)).toBeNull();
    expect(fs.ops).toEqual([]);
    created.push('z.txt');
    await ops.runName(req, 'z.txt', true);
    await flush();
    expect(fs.ops).toEqual(['rename /src/a.txt z.txt !']);
    expect(left.cursorPath()).toBe('/src/z.txt');
  });

  it('F2 without a list falls back to the dialog', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('RENAME_INLINE');
    expect(dialogs.open()).toBe('name');
  });

  it('F2 renames in the list; a failed rename opens the dialog with the typed name', async () => {
    const bridge = new FakeTableBridge();
    bridge.rows = [...left.entries()];
    const list = new FileListController(bridge, left);
    TestBed.inject(WorkspaceStore).registerPanel('left', { store: left, controller: () => list });
    left.setCursor('/src/a.txt');
    await actions.run('RENAME_INLINE');
    expect(dialogs.open()).toBeNull();
    expect(bridge.rename).toMatchObject({ path: '/src/a.txt', selectEnd: 1 });
    bridge.rename!.finish(null); // Escape
    expect(fs.ops).toEqual([]);

    await actions.run('RENAME_INLINE');
    fs.failNext = { code: 'already_exists', message: 'exists', path: null };
    bridge.rename!.finish('b.txt');
    await flush();
    expect(fs.ops).toEqual(['rename /src/a.txt b.txt']);
    expect(dialogs.open()).toBe('name');
    expect(ops.name()).toMatchObject({ initial: 'b.txt', selectEnd: 1 });
    expect(ops.name()?.error?.code).toBe('already_exists');
    ops.close();

    created.push('c.txt');
    await actions.run('RENAME_INLINE');
    bridge.rename!.finish('c.txt');
    await flush();
    expect(left.cursorPath()).toBe('/src/c.txt');
  });

  it('delete and move put the table focus on the next entry before the job runs', async () => {
    const bridge = new FakeTableBridge();
    bridge.rows = [...left.entries()];
    const list = new FileListController(bridge, left);
    TestBed.inject(WorkspaceStore).registerPanel('left', { store: left, controller: () => list });
    left.setCursor('/src/a.txt');
    await ops.openDelete('trash');
    jobsApi.refuse = { code: 'io', message: 'x', path: null };
    await ops.runDelete(ops.del()!, false);
    expect(left.cursorPath()).toBe('/src/a.txt'); // refused: the cursor stays
    jobsApi.refuse = null;
    await ops.runDelete(ops.del()!, false);
    expect(left.cursorPath()).toBe('/src/b.txt');
    expect(bridge.rows[bridge.focusedRow()].path).toBe('/src/b.txt');
    await ops.openCopyMove('move');
    await ops.runCopyMove(ops.copyMove()!, INPUT);
    expect(left.cursorPath()).toBe('/src/a.txt'); // b.txt was the last one
  });

  it('reports a failed job', async () => {
    left.setCursor('/src/a.txt');
    await ops.openCopyMove('move');
    await ops.runCopyMove(ops.copyMove()!, INPUT);
    finish(0, 'failed', { error: { code: 'disk_full', message: 'voll', path: null } });
    await flush();
    expect(jobs.messages().at(-1)).toContain('failed: voll');
  });
});
