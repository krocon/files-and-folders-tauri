import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { DirEntry } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobState, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi, job } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerMultiRenameActions } from './multirename-actions';
import {
  insertAt,
  matchesFilter,
  parentNames,
  previewRows,
  selectionInDisplayOrder,
} from './multirename-logic';
import { ENGINE_DEBOUNCE_MS, MultiRenameStore } from './multirename.store';
import { DEFAULT_RULES } from './rename-engine';

const SUMMARY: Summary = {
  itemsDone: 2,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const flush = () => new Promise((r) => setTimeout(r));

describe('multi-rename logic', () => {
  const a = entry('a');
  const b = entry('b');
  const c = entry('c');

  it('takes the marked entries in display order, else the cursor entry', () => {
    expect(selectionInDisplayOrder([a, b, c], a, [c, a, b])).toEqual([c, a, b]);
    // hidden by a filter: at the end
    expect(selectionInDisplayOrder([a, b, c], a, [b])).toEqual([b, a, c]);
    expect(selectionInDisplayOrder([], b, [a, b])).toEqual([b]);
    expect(selectionInDisplayOrder([], null, null)).toEqual([]);
  });

  it('parent names from the breadcrumbs; the root has none', () => {
    const seg = (name: string) => ({ name, path: name });
    expect(parentNames([seg('/'), seg('home'), seg('marc'), seg('docs')])).toEqual([
      'docs',
      'marc',
      'home',
    ]);
    expect(parentNames([seg('/'), seg('tmp')])).toEqual(['tmp', '', '']);
    expect(parentNames([seg('C:\\')])).toEqual(['', '', '']);
  });

  it('preview rows use the plan only for the names it belongs to', () => {
    const sources = [{ path: '/d/a', name: 'a' }];
    const items = [{ path: '/d/a', newName: 'b' }];
    const plan = {
      rows: [{ status: 'ok' as const, error: null }],
      ok: 1,
      unchanged: 0,
      errors: 0,
    };
    expect(previewRows(sources, items, null, null)[0].status).toBe('pending');
    expect(previewRows(sources, items, null, { items, plan })[0].status).toBe('ok');
    expect(previewRows(sources, [...items], null, { items, plan })[0].status).toBe('pending');
    expect(previewRows(sources, null, 'bad', null)[0]).toMatchObject({
      status: 'error',
      info: 'bad',
      newName: 'a',
    });
  });

  it('filters and token insertion', () => {
    const row = { nr: 1, path: '', oldName: '', newName: '', info: '' };
    expect(matchesFilter({ ...row, status: 'unchanged' }, 'changed')).toBe(false);
    expect(matchesFilter({ ...row, status: 'error' }, 'changed')).toBe(true);
    expect(matchesFilter({ ...row, status: 'ok' }, 'errors')).toBe(false);
    expect(insertAt('[N].[E]', 3, 3, '_[C]')).toEqual({ value: '[N]_[C].[E]', caret: 7 });
    expect(insertAt('abc', 1, 2, 'X')).toEqual({ value: 'aXc', caret: 2 });
  });
});

describe('multi-rename store (design 007)', () => {
  let fsApi: FakeFsApi;
  let jobsApi: FakeJobsApi;
  let renameApi: FakeRenameApi;
  let actions: ActionService;
  let mr: MultiRenameStore;
  let dialogs: DialogService;
  let jobs: JobsStore;
  let left: FileBrowserStore;
  let names: string[];
  let displayed: DirEntry[] | null;

  const entries = () =>
    names.map((n) =>
      n.endsWith('/')
        ? dir(n.slice(0, -1), { path: `/src/${n.slice(0, -1)}` })
        : entry(n, { path: `/src/${n}` }),
    );

  beforeEach(async () => {
    names = ['a.txt', 'b.txt', 'Ordner/'];
    displayed = null;
    fsApi = new FakeFsApi();
    fsApi.handler = () =>
      Promise.resolve({
        path: '/src',
        parent: '/',
        segments: [
          { name: '/', path: '/' },
          { name: 'home', path: '/home' },
          { name: 'src', path: '/src' },
        ],
        entries: entries(),
        unreadableEntries: 0,
      });
    jobsApi = new FakeJobsApi();
    renameApi = new FakeRenameApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: jobsApi },
        { provide: RenameApi, useValue: renameApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    mr = TestBed.inject(MultiRenameStore);
    dialogs = TestBed.inject(DialogService);
    jobs = TestBed.inject(JobsStore);
    await jobs.init();
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    await left.load('/src');
    const controller = {
      displayedEntries: () => displayed ?? left.visibleEntries(),
    } as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => controller });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerMultiRenameActions(actions, mr, jobs);
  });

  afterEach(() => mr.close());

  function finish(index: number, state: JobState = 'done', summary: Partial<Summary> = {}) {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[index].id,
      state,
      summary: { ...SUMMARY, ...summary },
    });
  }

  async function openWith(paths: string[], rules = {}): Promise<void> {
    left.setMarked(paths, true);
    await mr.open();
    mr.update(rules);
    await mr.checkNow();
  }

  it('needs a folder and an entry', () => {
    expect(actions.state('OPEN_MULTIRENAME_DLG')).toBe('disabled');
    left.setCursor('/src/a.txt');
    expect(actions.state('OPEN_MULTIRENAME_DLG')).toBe('ready');
    expect(actions.state('UNDO_RENAME')).toBe('disabled');
  });

  it('opens with the selection in display order and the parent from the breadcrumbs', async () => {
    displayed = [...entries()].reverse();
    left.setMarked(['/src/a.txt', '/src/b.txt'], true);
    await actions.run('OPEN_MULTIRENAME_DLG');
    expect(dialogs.open()).toBe('multi-rename');
    const req = mr.request()!;
    expect(req.sources.map((s) => s.name)).toEqual(['b.txt', 'a.txt']);
    expect(req.sources[0].parents).toEqual(['src', 'home', '']);
    mr.update({ pattern: '[P]-[C].[E]' });
    expect(mr.items()!.map((i) => i.newName)).toEqual(['src-0001.txt', 'src-0002.txt']);
  });

  it('folders are not split and keep their name with the default pattern', async () => {
    await openWith(['/src/Ordner', '/src/a.txt']);
    expect(mr.rows().map((r) => r.status)).toEqual(['unchanged', 'unchanged']);
    expect(mr.canRun()).toBe(false); // nothing to do
  });

  it('enables Rename only after Rust checked exactly these names', async () => {
    left.setMarked(['/src/a.txt', '/src/b.txt'], true);
    await mr.open();
    mr.update({ pattern: '[N]-x.[E]' });
    expect(mr.rows()[0].status).toBe('pending');
    expect(mr.canRun()).toBe(false);
    await mr.checkNow();
    expect(mr.rows().map((r) => r.newName)).toEqual(['a-x.txt', 'b-x.txt']);
    expect(mr.canRun()).toBe(true);
    // duplicates: blocked
    mr.update({ pattern: 'same' });
    await mr.checkNow();
    expect(mr.summary().errors).toBe(2);
    expect(mr.canRun()).toBe(false);
  });

  it('drops answers of older checks', async () => {
    left.setMarked(['/src/a.txt'], true);
    await mr.open();
    await flush(); // the first check after opening
    renameApi.hold = true;
    mr.update({ pattern: 'one' });
    const first = mr.checkNow();
    mr.update({ pattern: 'two' });
    const second = mr.checkNow();
    renameApi.release('lifo'); // the newer answer arrives first
    await Promise.all([first, second]);
    expect(mr.rows()[0]).toMatchObject({ newName: 'two', status: 'ok' });
    expect(mr.checked()).toBe(true);
  });

  it('a broken expression shows an error and checks nothing', async () => {
    await openWith(['/src/a.txt']);
    const before = renameApi.plans.length;
    mr.update({
      replaceEnabled: true,
      replacements: DEFAULT_RULES.replacements.map((r, i) =>
        i === 0 ? { ...r, enabled: true, find: '/(/', regex: true } : r,
      ),
    });
    expect(mr.ruleErrors()[0].field).toBe('find0');
    expect(mr.rows()[0].status).toBe('error');
    await mr.checkNow();
    expect(renameApi.plans.length).toBe(before);
    expect(mr.canRun()).toBe(false);
  });

  it('runs a job with all pairs, unmarks, follows the cursor and remembers the rules', async () => {
    left.setCursor('/src/a.txt');
    await openWith(['/src/a.txt', '/src/b.txt'], { pattern: '[N]_new.[E]' });
    expect(mr.canRun()).toBe(true);
    await mr.run();
    expect(dialogs.open()).toBeNull();
    const spec = jobsApi.started[0].spec;
    expect(spec).toEqual({
      kind: 'rename',
      items: [
        { path: '/src/a.txt', newName: 'a_new.txt' },
        { path: '/src/b.txt', newName: 'b_new.txt' },
      ],
    });
    expect(renameApi.saved.at(-1)!.last).toMatchObject({ pattern: '[N]_new.[E]' });
    names = ['a_new.txt', 'b_new.txt', 'Ordner/'];
    finish(0);
    await flush();
    await flush();
    expect(left.marked().size).toBe(0);
    expect(left.cursorPath()).toBe('/src/a_new.txt');
    expect(jobs.messages().some((m) => m.startsWith('2 entries renamed'))).toBe(true);
    // the next dialog starts with the last rules
    left.setCursor('/src/a_new.txt');
    await mr.open();
    expect(mr.rules().pattern).toBe('[N]_new.[E]');
  });

  it('a refused job keeps the dialog open with the error', async () => {
    await openWith(['/src/a.txt'], { pattern: 'z' });
    jobsApi.refuse = { code: 'invalid_path', message: 'Nothing selected', path: null };
    await mr.run();
    expect(dialogs.open()).toBe('multi-rename');
    expect(mr.runError()?.message).toBe('Nothing selected');
  });

  it('presets: save, apply, delete', async () => {
    await openWith(['/src/a.txt'], { pattern: '[C]' });
    await mr.savePreset(' Zähler ');
    expect(mr.presets().presets.map((p) => p.name)).toEqual(['Zähler']);
    mr.reset();
    expect(mr.rules().pattern).toBe('[N].[E]');
    mr.applyPreset('Zähler');
    expect(mr.rules().pattern).toBe('[C]');
    await mr.deletePreset('Zähler');
    expect(renameApi.saved.at(-1)!.presets).toEqual([]);
  });

  it('undo: the action takes the last undoable job', async () => {
    jobsApi.emit({
      type: 'added',
      job: {
        ...job('j7', {
          kind: 'rename',
          items: [{ path: '/src/a', newName: 'b' }],
        }),
        state: 'done',
      },
    });
    expect(actions.state('UNDO_RENAME')).toBe('disabled');
    jobsApi.emit({ type: 'undoAvailable', id: 'j7', available: true });
    expect(actions.state('UNDO_RENAME')).toBe('ready');
    await actions.run('UNDO_RENAME');
    expect(renameApi.undos).toEqual(['j7']);
    renameApi.undoResult = {
      code: 'undo_unavailable',
      message: 'There is no rename to undo',
      path: null,
    };
    await mr.undo(null);
    expect(jobs.messages().at(-1)).toBe(
      'Undo failed: There is nothing to undo. (There is no rename to undo)',
    );
  });

  it('10 000 entries: names follow 80 ms after typing stops; preview is computed fast', async () => {
    const parents: [string, string, string] = ['src', '', ''];
    mr.request.set({
      side: 'left',
      folder: '/src',
      sources: Array.from({ length: 10_000 }, (_, i) => ({
        path: `/src/file ${i}.txt`,
        name: `file ${i}.txt`,
        isDir: false,
        modifiedMs: null,
        parents,
      })),
    });
    mr.update({ pattern: '[C]-[N].[E]' });
    expect(mr.items()![0].newName).toBe('file 0.txt'); // not yet
    expect(mr.canRun()).toBe(false);
    await new Promise((r) => setTimeout(r, ENGINE_DEBOUNCE_MS + 20));
    const start = performance.now();
    const rows = mr.rows();
    const ms = performance.now() - start;
    expect(rows[9999].newName).toBe('10000-file 9999.txt');
    await mr.checkNow();
    expect(mr.canRun()).toBe(true);
    // engine + rows for 10 000 entries (the table is measured in the window)
    console.debug('[fnf:perf] store 10 000 names + rows', Math.round(ms), 'ms');
    expect(ms).toBeLessThan(1000);
  });
});
