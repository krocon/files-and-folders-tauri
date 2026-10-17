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
import { FakeFoldersApi } from '../../../testing/fake-folders-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { registerCleanFoldersActions } from '../cleanfolders/clean-actions';
import {
  cleanOptions,
  cleanRoots,
  CleanFoldersStore,
  DEFAULT_CLEAN_FORM,
} from '../cleanfolders/clean.store';
import { registerMultiMkdirActions } from '../multimkdir/multimkdir-actions';
import { MultiMkdirStore } from '../multimkdir/multimkdir.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerGroupFilesActions } from './groupfiles-actions';
import { groupSelection, GroupFilesStore } from './groupfiles.store';

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
    finish(0);
    await flush();
    expect(left.markedEntries()).toEqual([]);
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

  it('clean options and start folders', () => {
    expect(cleanOptions(DEFAULT_CLEAN_FORM)).toEqual({
      emptyDirs: true,
      includeRoots: false,
      junk: [],
      patterns: [],
    });
    expect(
      cleanOptions({
        ...DEFAULT_CLEAN_FORM,
        junkOn: true,
        patternsOn: true,
        patternsText: ' *.bak ; ;*.tmp',
      }),
    ).toEqual({
      emptyDirs: true,
      includeRoots: false,
      junk: ['.DS_Store', 'Thumbs.db', 'desktop.ini'],
      patterns: ['*.bak', '*.tmp'],
    });
    // without empty folders there is no junk and no start folder
    expect(
      cleanOptions({ ...DEFAULT_CLEAN_FORM, emptyDirs: false, junkOn: true, includeRoots: true }),
    ).toMatchObject({ junk: [], includeRoots: false });
    const [a, , , d] = entries('/src');
    expect(cleanRoots('/src', [a])).toEqual(['/src']);
    expect(cleanRoots('/src', [a, d])).toEqual(['/src/Ordner']);
  });

  it('searches on open, again on changes, drops stale answers and deletes to the trash', async () => {
    await left.load('/src');
    folders.scan = {
      items: [{ path: '/src/Ordner', kind: 'dir' }],
      unreadable: [],
      unreadableMore: 0,
      truncated: false,
      visited: 4,
    };
    await actions.run('OPEN_DELETE_EMPTY_FOLDERS_DLG');
    expect(dialogs.open()).toBe('clean-folders');
    expect(cl.scanning()).toBe(true);
    expect(cl.canRun()).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(folders.scans[0].roots).toEqual(['/src']);
    expect(cl.rows()).toHaveLength(1);
    expect(cl.canRun()).toBe(true);
    // a change: the old result no longer counts
    folders.hold = true;
    cl.update({ junkOn: true });
    expect(cl.canRun()).toBe(false);
    const first = cl.scanNow();
    folders.scan = { ...folders.scan, items: [] };
    const second = cl.scanNow();
    folders.release('lifo');
    await Promise.all([first, second]);
    expect(cl.counts()).toEqual({ dirs: 0, files: 0 });
    folders.hold = false;
    folders.scan = { ...folders.scan, items: [{ path: '/src/Ordner', kind: 'dir', junk: 1 }] };
    await cl.scanNow();
    expect(cl.rows()[0].info).toContain('1 junk file');
    expect(cl.mode()).toBe('trash');
    await cl.run();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'clean',
      roots: ['/src'],
      mode: 'trash',
      items: [{ path: '/src/Ordner', kind: 'dir', junk: 1 }],
      options: { junk: ['.DS_Store', 'Thumbs.db', 'desktop.ini'] },
    });
    expect(dialogs.open()).toBeNull();
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
