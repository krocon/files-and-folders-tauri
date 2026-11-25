import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FoldersApi } from '../../core/folders/folders-api';
import { FsApi } from '../../core/fs/fs-api';
import { DirEntry } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobState, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { cleanScan, FakeFoldersApi } from '../../../testing/fake-folders-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { registerCleanFoldersActions } from '../cleanfolders/clean-actions';
import { CleanFoldersStore } from '../cleanfolders/clean.store';
import { McpGuardService } from '../../core/mcp/mcp-guard.service';
import { ProposalService } from '../../core/mcp/proposal.service';
import { registerMultiMkdirActions } from '../multimkdir/multimkdir-actions';
import { MultiMkdirStore } from '../multimkdir/multimkdir.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerGroupFilesActions } from './groupfiles-actions';
import { groupSelection, GroupFilesStore } from './groupfiles.store';
import { SettingsStore } from '../../core/settings/settings.store';

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

describe('folder tools (design 008)', () => {
  let fsApi: FakeFsApi;
  let jobsApi: FakeJobsApi;
  let folders: FakeFoldersApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let gf: GroupFilesStore;
  let cl: CleanFoldersStore;
  let mm: MultiMkdirStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  let displayed: DirEntry[] | null;
  const names = ['Band - Titel 01.mp3', 'Band - Titel 02.mp3', 'Solo 1.mp3', 'Ordner/'];

  const entries = (base: string) =>
    names.map((n) =>
      n.endsWith('/')
        ? dir(n.slice(0, -1), { path: `${base}/${n.slice(0, -1)}` })
        : entry(n, { path: `${base}/${n}` }),
    );

  beforeEach(async () => {
    displayed = null;
    fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/src',
        parent: '/',
        segments: [
          { name: '/', path: '/' },
          { name: 'home', path: '/home' },
          { name: (path ?? '/src').slice(1), path: path ?? '/src' },
        ],
        entries: entries(path ?? '/src'),
        unreadableEntries: 0,
      });
    jobsApi = new FakeJobsApi();
    folders = new FakeFoldersApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: jobsApi },
        { provide: RenameApi, useValue: new FakeRenameApi() },
        { provide: FoldersApi, useValue: folders },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    gf = TestBed.inject(GroupFilesStore);
    cl = TestBed.inject(CleanFoldersStore);
    mm = TestBed.inject(MultiMkdirStore);
    const jobs = TestBed.inject(JobsStore);
    await jobs.init();
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const controller = {
      displayedEntries: () => displayed ?? left.visibleEntries(),
    } as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => controller });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerGroupFilesActions(actions, gf);
    registerCleanFoldersActions(actions, cl);
    registerMultiMkdirActions(actions, mm);
  });

  function finish(index: number, state: JobState = 'done', summary: Partial<Summary> = {}) {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[index].id,
      state,
      summary: { ...SUMMARY, ...summary },
    });
  }

  it('the actions need a folder', async () => {
    for (const id of [
      'OPEN_GROUPFILES_DLG',
      'OPEN_DELETE_EMPTY_FOLDERS_DLG',
      'OPEN_MULTIMKDIR_DLG',
    ] as const) {
      expect(actions.state(id)).toBe('disabled');
    }
    await left.load('/src');
    for (const id of [
      'OPEN_GROUPFILES_DLG',
      'OPEN_DELETE_EMPTY_FOLDERS_DLG',
      'OPEN_MULTIMKDIR_DLG',
    ] as const) {
      expect(actions.state(id)).toBe('ready');
    }
  });

  // ---- group files ----

  it('groups the marked entries, otherwise all shown ones', () => {
    const [a, b, c] = entries('/src');
    expect(groupSelection([b, a], [a, b, c])).toEqual([a, b]);
    expect(groupSelection([], [a, b, c])).toEqual([a, b, c]);
  });

  it('previews, uses the other side as root and starts one group job', async () => {
    await left.load('/src');
    await right.load('/dst');
    await actions.run('OPEN_GROUPFILES_DLG');
    expect(dialogs.open()).toBe('group-files');
    expect(gf.root()).toBe('/dst');
    expect(gf.rows().map((r) => r.status)).toEqual(['ok', 'ok', 'small', 'none']);
    expect(gf.outcome().groupCount).toBe(1);
    gf.update({ useSourceDir: true });
    expect(gf.root()).toBe('/src');
    gf.update({ useSourceDir: false, minSize: 0 });
    expect(gf.items().map((i) => i.group)).toEqual(['Band - Titel', 'Band - Titel', 'Solo']);
    left.setMarked(['/src/Band - Titel 01.mp3'], true);
    await gf.run('move');
    expect(dialogs.open()).toBeNull();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'group',
      root: '/dst',
      transfer: 'move',
      items: [
        { path: '/src/Band - Titel 01.mp3', group: 'Band - Titel' },
        { path: '/src/Band - Titel 02.mp3', group: 'Band - Titel' },
        { path: '/src/Solo 1.mp3', group: 'Solo' },
      ],
    });
    finish(0, 'done', { itemsDone: 2, itemsSkipped: 1 });
    await flush();
    expect(left.markedEntries()).toEqual([]);
    // the report counts what happened, not what was asked for (E2E finding)
    expect(TestBed.inject(JobsStore).messages()).toContain('Grouped 2 entries');
  });

  it('without a folder on the other side the source folder is the root', async () => {
    await left.load('/src');
    gf.open();
    expect(gf.root()).toBe('/src');
    gf.update({ mode: 'newFolder', newFolder: '' });
    expect(gf.canRun()).toBe(false);
    gf.update({ newFolder: 'a:b' });
    expect(gf.rows()[0].status).toBe('error');
    expect(gf.canRun()).toBe(false);
    gf.update({ newFolder: 'Alle' });
    expect(gf.canRun()).toBe(true);
    gf.close();
  });

  it('keeps a refused job in the dialog', async () => {
    await left.load('/src');
    gf.open();
    jobsApi.refuse = { code: 'dangerous_path', message: 'no', path: null };
    await gf.run('copy');
    expect(dialogs.open()).toBe('group-files');
    expect(gf.runError()?.code).toBe('dangerous_path');
    gf.close();
  });

  // ---- clean folders ----

  it('searches on open, again on changes, drops stale answers and deletes to the trash', async () => {
    await left.load('/src');
    left.setCursor('/src/Solo 1.mp3'); // a file under the cursor: the panel's folder is cleaned
    folders.scan = cleanScan([{ path: '/src', items: [{ path: '/src/Ordner', kind: 'dir' }] }]);
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    expect(dialogs.open()).toBe('clean-folders');
    expect(cl.scanning()).toBe(true);
    expect(cl.canRun()).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(folders.scans[0].roots).toEqual(['/src']);
    // the panel's own folder never goes as a whole (design 077 E5)
    expect(folders.scans[0].options).toMatchObject({ includeRoots: false, patterns: [] });
    expect(cl.rows()).toHaveLength(1);
    expect(cl.rows()[0]).toMatchObject({ check: '☑', verdict: 'partly' });
    expect(cl.canRun()).toBe(true);
    // a change: the old result no longer counts
    folders.hold = true;
    cl.update({ profile: 'release' });
    expect(cl.canRun()).toBe(false);
    const first = cl.scanNow();
    folders.scan = cleanScan([{ path: '/src' }]);
    const second = cl.scanNow();
    folders.release('lifo');
    await Promise.all([first, second]);
    expect(cl.sums()).toEqual({ roots: 0, dirs: 0, files: 0, bytes: 0 });
    expect(cl.rows()[0]).toMatchObject({ check: '–', verdict: 'stays' });
    folders.hold = false;
    folders.scan = cleanScan([
      { path: '/src', items: [{ path: '/src/Ordner', kind: 'dir', junk: 1, bytes: 7 }] },
    ]);
    await cl.scanNow();
    expect(cl.sums()).toEqual({ roots: 1, dirs: 1, files: 1, bytes: 7 });
    expect(cl.mode()).toBe('trash');
    await cl.run();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'clean',
      roots: ['/src'],
      mode: 'trash',
      // path and kind only: the job decides everything else again
      items: [{ path: '/src/Ordner', kind: 'dir' }],
      options: {
        includeRoots: false,
        largeJunk: ['*-sample.*', '*.sample.*', 'sample-*', 'sample.*'],
      },
    });
    expect(dialogs.open()).toBeNull();
    // only a run keeps the form – and never the delete mode
    expect(TestBed.inject(SettingsStore).get('dialogs.recent')[0]).toMatchObject({
      dialog: 'clean',
      value: { profile: 'release' },
    });
    expect(JSON.stringify(TestBed.inject(SettingsStore).get('dialogs.recent'))).not.toContain(
      'trash',
    );
  });

  it('marked folders: a verdict per folder, deselecting, the job gets only the selected ones', async () => {
    await left.load('/src');
    left.setMarked(['/src/Ordner', '/src/Solo 1.mp3'], true);
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    expect(cl.request()).toMatchObject({ roots: ['/src/Ordner'], includeRoots: true, ignored: 1 });
    // the first time: nothing but empty folders (design 077 E4)
    expect(cl.form().profile).toBe('empty');
    await new Promise((r) => setTimeout(r, 5));
    expect(folders.scans[0].options).toMatchObject({
      includeRoots: true,
      junk: ['.DS_Store', 'Thumbs.db', 'desktop.ini'],
      largeJunk: [],
    });
    // three folders answered: one stays, two are leftovers
    folders.scan = cleanScan([
      { path: '/src/Comics', over: { keepFiles: 3, keepBytes: 10 } },
      {
        path: '/src/A',
        items: [{ path: '/src/A', kind: 'dir', bytes: 5 }],
        over: { verdict: 'residue' },
      },
      {
        path: '/src/B',
        items: [{ path: '/src/B', kind: 'dir', bytes: 6 }],
        over: { verdict: 'residue' },
      },
    ]);
    // only empty folders found nothing before, but files lie around: a hint
    expect(cl.suggestRelease()).toBe(false);
    await cl.scanNow();
    expect(cl.rows().map((r) => r.check)).toEqual(['–', '☑', '☑']);
    expect(cl.sums()).toMatchObject({ roots: 2, bytes: 11 });
    // a folder that stays cannot be selected
    cl.toggle(0);
    expect(cl.rows()[0].check).toBe('–');
    cl.toggle(2);
    expect(cl.rows().map((r) => r.check)).toEqual(['–', '☑', '☐']);
    expect(cl.sums()).toMatchObject({ roots: 1, bytes: 5 });
    // the choice survives a new search …
    cl.update({ junkMaxMb: 2 });
    await cl.scanNow();
    expect(cl.rows()[2].check).toBe('☐');
    // … the cursor of the table drives the details
    cl.moveActive(99);
    expect(cl.active()).toBe(2);
    expect(cl.activeRoot()?.path).toBe('/src/B');
    cl.moveActive(-5);
    expect(cl.active()).toBe(0);
    // nothing selected: no run
    cl.toggle(1);
    expect(cl.canRun()).toBe(false);
    await cl.run();
    expect(jobsApi.started).toEqual([]);
    cl.toggle(1);
    cl.mode.set('permanent');
    await cl.run();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'clean',
      roots: ['/src/A'],
      items: [{ path: '/src/A', kind: 'dir' }],
      mode: 'permanent',
    });
    // the message names the freed space; the marks are left to the reload
    finish(0, 'done', { itemsDone: 1, bytesDone: 5 });
    await flush();
    expect(TestBed.inject(JobsStore).messages().at(-1)).toBe('Cleaned up 1 entry – 5 B freed');
    expect(left.isMarked('/src/Ordner')).toBe(true);
    // the next opening starts with the trash again
    left.clearMarks();
    left.setCursor('/src/Ordner');
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    expect(cl.mode()).toBe('trash');
    expect(cl.request()).toMatchObject({ roots: ['/src/Ordner'], includeRoots: true, ignored: 0 });
    cl.close();
  });

  it('"only empty folders" finds nothing in folders with files: points to the release profile', async () => {
    await left.load('/src');
    left.setMarked(['/src/Ordner'], true);
    folders.scan = cleanScan([{ path: '/src/Ordner', over: { keepFiles: 1, keepBytes: 736 } }]);
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    await new Promise((r) => setTimeout(r, 5));
    expect(cl.offers()).toBe(false);
    expect(cl.canRun()).toBe(false);
    expect(cl.suggestRelease()).toBe(true);
    cl.update({ profile: 'release' });
    expect(cl.suggestRelease()).toBe(false);
    await cl.scanNow();
    expect(cl.suggestRelease()).toBe(false); // the hint belongs to the first profile only
    cl.close();
    // an empty folder without files: nothing to suggest
    folders.scan = cleanScan([{ path: '/src/Ordner' }]);
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    await new Promise((r) => setTimeout(r, 5));
    expect(cl.suggestRelease()).toBe(false);
    cl.close();
  });

  it('marks set by an MCP client: the dialog is guarded like a proposal (design 071, 077 E9)', async () => {
    const guard = TestBed.inject(McpGuardService);
    const proposals = TestBed.inject(ProposalService);
    let time = 1000;
    guard.now = () => time;
    await left.load('/src');
    left.setMarked(['/src/Ordner'], true);
    guard.changed('left', 'Claude Code', left.marked());
    time += 5000;
    folders.scan = cleanScan([
      {
        path: '/src/Ordner',
        items: [{ path: '/src/Ordner', kind: 'dir' }],
        over: { verdict: 'residue' },
      },
    ]);
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    await new Promise((r) => setTimeout(r, 5));
    expect(cl.request()?.changedBy).toBe('Claude Code');
    // locked until the keyboard was quiet
    expect(cl.locked()).toBe(true);
    expect(cl.canRun()).toBe(false);
    await cl.run();
    expect(jobsApi.started).toEqual([]);
    proposals.armed.set(true);
    expect(cl.canRun()).toBe(true);
    await cl.run();
    expect(jobsApi.started).toHaveLength(1);
    // the user confirmed knowingly: the selection is theirs now
    expect(guard.client()).toBeNull();
    expect(proposals.armed()).toBe(false);
    // the user's own marks: an ordinary dialog
    left.setMarked(['/src/Ordner'], false);
    left.setMarked(['/src/Ordner'], true);
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    expect(cl.request()?.changedBy).toBeUndefined();
    expect(cl.locked()).toBe(false);
    cl.close();
  });

  it('cancels a running search when a newer one starts and when the dialog closes', async () => {
    // review 008 #2
    await left.load('/src');
    folders.hold = true;
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    await new Promise((r) => setTimeout(r, 5));
    expect(folders.scans).toHaveLength(1);
    const first = folders.scans[0].scanId;
    expect(folders.cancels).toEqual([]);
    const next = cl.scanNow();
    expect(folders.cancels).toEqual([first]);
    const second = folders.scans[1].scanId;
    expect(second).not.toBe(first);
    cl.close();
    expect(folders.cancels).toEqual([first, second]);
    folders.release();
    await next;
    expect(cl.scan()).toBeNull();
    // a finished search is not cancelled again
    folders.hold = false;
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    await new Promise((r) => setTimeout(r, 5));
    cl.close();
    expect(folders.cancels).toHaveLength(2);
  });

  it('the three dialogs open with the inputs of their last run, also after a restart (design 027 E5)', async () => {
    const settings = TestBed.inject(SettingsStore);
    // as if read from settings.json at start
    settings.set('dialogs.recent', [
      { dialog: 'groupFiles', value: { mode: 'firstWord', minSize: 0, useSourceDir: true } },
      { dialog: 'clean', value: { junkOn: true, patternsOn: true, patternsText: '*.tmp' } },
      { dialog: 'multiMkdir', value: { template: 'Teil [C]', end: 2, digits: 1 } },
    ]);
    await left.load('/src');
    gf.open();
    expect(gf.options()).toMatchObject({ mode: 'firstWord', minSize: 0, useSourceDir: true });
    gf.update({ mode: 'firstLetter' });
    await gf.run('copy');
    expect(settings.get('dialogs.recent')[0]).toEqual({
      dialog: 'groupFiles',
      value: { ...gf.options(), mode: 'firstLetter' },
    });
    // an unfinished change is not kept: only a run counts
    gf.open();
    gf.update({ mode: 'twoLetters' });
    gf.close();
    expect(JSON.stringify(settings.get('dialogs.recent'))).not.toContain('twoLetters');

    cl.open();
    // kept before design 077: what was switched on then is the profile "custom" now
    expect(cl.form()).toMatchObject({
      profile: 'custom',
      junkOn: true,
      patternsOn: true,
      patternsText: '*.tmp',
    });
    expect(cl.mode()).toBe('trash'); // never kept
    cl.close();

    mm.open();
    expect(mm.rows().map((r) => r.name)).toEqual(['Teil 1', 'Teil 2']);
    await mm.run();
    expect(settings.get('dialogs.recent')[0]).toMatchObject({
      dialog: 'multiMkdir',
      value: { template: 'Teil [C]', end: 2, digits: 1 },
    });
  });

  // ---- multi mkdir ----

  it('creates the folders and keeps failed names in the dialog', async () => {
    await left.load('/src');
    await actions.run('OPEN_MULTIMKDIR_DLG');
    expect(dialogs.open()).toBe('multi-mkdir');
    mm.update({ template: '[P] [C]', end: 3 });
    expect(mm.rows().map((r) => r.name)).toEqual(['src 01', 'src 02', 'src 03']);
    folders.existing.add('src 02');
    await mm.run();
    expect(folders.creates[0]).toEqual({ parent: '/src', names: ['src 01', 'src 02', 'src 03'] });
    expect(dialogs.open()).toBe('multi-mkdir');
    expect(mm.runError()).toContain('src 02');
    // review 008 #6: no second Create with the same names until something changes
    expect(mm.canRun()).toBe(false);
    await mm.run();
    expect(folders.creates).toHaveLength(1);
    mm.update({ start: 4, end: 5 });
    await mm.run();
    expect(dialogs.open()).toBeNull();
    // invalid names block Create
    mm.open();
    mm.update({ template: 'a/[C]' });
    expect(mm.canRun()).toBe(false);
    mm.close();
  });
});
