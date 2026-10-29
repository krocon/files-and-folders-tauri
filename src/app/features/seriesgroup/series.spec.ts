import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FoldersApi } from '../../core/folders/folders-api';
import { FileTree, TreeFile } from '../../core/folders/folders.models';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobState, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { EMPTY_TREE, FakeFoldersApi } from '../../../testing/fake-folders-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { CleanFoldersStore, DEFAULT_CLEAN_FORM } from '../cleanfolders/clean.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerSeriesGroupActions } from './series-actions';
import { SeriesGroupStore } from './series.store';

const SUMMARY: Summary = {
  itemsDone: 3,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const flush = () => new Promise((r) => setTimeout(r));

function file(rel: string): TreeFile {
  const parts = rel.split('/');
  const name = parts.pop()!;
  return {
    path: `/src/${rel}`,
    name,
    size: 1,
    modifiedMs: 0,
    dirs: parts,
    top: parts.length > 0 ? `/src/${parts[0]}` : null,
    rel,
  };
}

function tree(rels: string[]): FileTree {
  return { ...EMPTY_TREE, files: rels.map(file) };
}

const RELEASES = [
  'Show.S01E01-GRP/show.s01e01.mkv',
  'Show.S01E01-GRP/show.s01e01.nfo',
  'Show.S01E01-GRP/Sample/show.s01e01-sample.mkv',
  'Show.S01E02-GRP/show.s01e02.mkv',
  'Show.S02E01-GRP/show.s02e01.mkv',
  'S01/show.s01e03.mkv',
];

describe('group series by season (design 045)', () => {
  let fsApi: FakeFsApi;
  let jobsApi: FakeJobsApi;
  let folders: FakeFoldersApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let sg: SeriesGroupStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;

  beforeEach(async () => {
    fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/src',
        parent: '/',
        segments: [
          { name: '/', path: '/' },
          { name: (path ?? '/src').slice(1), path: path ?? '/src' },
        ],
        entries: [entry('a.mkv', { path: `${path ?? '/src'}/a.mkv` })],
        unreadableEntries: 0,
      });
    jobsApi = new FakeJobsApi();
    folders = new FakeFoldersApi();
    folders.tree = tree(RELEASES);
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
    sg = TestBed.inject(SeriesGroupStore);
    await TestBed.inject(JobsStore).init();
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerSeriesGroupActions(actions, sg);
  });

  function finish(index: number, state: JobState = 'done', summary: Partial<Summary> = {}) {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[index].id,
      state,
      summary: { ...SUMMARY, ...summary },
    });
  }

  it('the action needs a local folder', async () => {
    expect(actions.state('OPEN_SERIES_GROUP_DLG')).toBe('disabled');
    await left.load('/src');
    expect(actions.state('OPEN_SERIES_GROUP_DLG')).toBe('ready');
  });

  it('collects below the folder, previews and copies into season folders of the series folder itself', async () => {
    await left.load('/src');
    await right.load('/dst');
    await actions.run('OPEN_SERIES_GROUP_DLG');
    expect(dialogs.open()).toBe('series-group');
    expect(folders.collects[0]).toMatchObject({ root: '/src', options: { maxDepth: 8 } });
    await flush();
    expect(sg.target()).toBe('other'); // Marc 29.10.2026: the default
    sg.update({ target: 'source' });
    expect(sg.plan().seasons.map((s) => [s.folder, s.count])).toEqual([
      ['S01', 2],
      ['S02', 1],
    ]);
    expect(sg.rows().map((r) => r.info)).toEqual([
      'OK',
      'extra',
      'in folder Sample',
      'OK',
      'OK',
      'already in its season folder',
    ]);
    expect(sg.rows()[0]).toMatchObject({ season: '1', episode: '1', target: 'S01' });
    sg.update({ showIgnored: false });
    expect(sg.rows().map((r) => r.nr)).toEqual([1, 4, 5, 6]);
    expect(sg.canRun()).toBe(true);
    await sg.run('copy');
    expect(dialogs.open()).toBeNull();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'group',
      root: '/src',
      transfer: 'copy',
      items: [
        { path: '/src/Show.S01E01-GRP/show.s01e01.mkv', group: 'S01' },
        { path: '/src/Show.S01E02-GRP/show.s01e02.mkv', group: 'S01' },
        { path: '/src/Show.S02E01-GRP/show.s02e01.mkv', group: 'S02' },
      ],
    });
    finish(0);
    await flush();
    expect(TestBed.inject(JobsStore).messages()).toContain('Series grouped: 3 files');
    expect(dialogs.open()).toBeNull(); // a copy never offers the cleanup
  });

  it('targets (design 045 E8): other side (default), series folder, other side + series name', async () => {
    await left.load('/src');
    await right.load('/dst');
    sg.open();
    await flush();
    // other side: nothing is in place there
    expect(sg.plans()[0]).toMatchObject({ root: '/dst', subdir: null });
    expect(sg.items().length).toBe(4);
    expect(sg.rows()[0].target).toBe('S01');
    sg.update({ target: 'otherSeries' });
    expect(sg.plans()[0]).toMatchObject({ root: '/dst', subdir: 'src' });
    expect(sg.rows()[0].target).toBe('src › S01');
    await sg.run('copy');
    expect(jobsApi.started[0].spec).toMatchObject({ kind: 'group', root: '/dst', subdir: 'src' });
    expect((jobsApi.started[0].spec as unknown as { items: unknown[] }).items.length).toBe(4);
  });

  it('without a folder on the other side the series folder is the target', async () => {
    await left.load('/src');
    sg.open();
    await flush();
    expect(sg.options().target).toBe('other');
    expect(sg.target()).toBe('source');
    expect(sg.plans()[0]).toMatchObject({ root: '/src', subdir: null });
    sg.close();
  });

  it('marked folders are the series folders; several never mix in one target (Marc 29.10.2026)', async () => {
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/filme',
        parent: '/',
        segments: [
          { name: '/', path: '/' },
          { name: 'filme', path: path ?? '/filme' },
        ],
        entries: [
          dir('Die Kirche', { path: '/filme/Die Kirche' }),
          dir('Cyberpunk', { path: '/filme/Cyberpunk' }),
          entry('notes.txt', { path: '/filme/notes.txt' }),
        ],
        unreadableEntries: 0,
      });
    const at = (root: string, rels: string[]): FileTree => ({
      ...EMPTY_TREE,
      files: rels.map((rel) => ({ ...file(rel), path: `${root}/${rel}`, top: null })),
    });
    folders.trees.set(
      '/filme/Die Kirche',
      at('/filme/Die Kirche', ['k.s01e01.mkv', 'k.s01e02.mkv']),
    );
    folders.trees.set('/filme/Cyberpunk', at('/filme/Cyberpunk', ['c.s01e01.mkv']));
    await left.load('/filme');
    await right.load('/dst');
    left.setMarked(['/filme/Die Kirche', '/filme/Cyberpunk', '/filme/notes.txt'], true);
    sg.open();
    await flush();
    expect(folders.collects.map((c) => c.root)).toEqual(['/filme/Die Kirche', '/filme/Cyberpunk']);
    expect(sg.rows().map((r) => r.source)).toEqual([
      'Die Kirche › k.s01e01.mkv',
      'Die Kirche › k.s01e02.mkv',
      'Cyberpunk › c.s01e01.mkv',
    ]);
    // both into /dst/S01 would mix the series
    expect(sg.blocked()).toContain('Several series would mix');
    expect(sg.canRun()).toBe(false);
    sg.update({ target: 'otherSeries' });
    expect(sg.blocked()).toBeNull();
    await sg.run('move');
    expect(jobsApi.started.map((j) => j.spec)).toMatchObject([
      { kind: 'group', root: '/dst', subdir: 'Die Kirche', transfer: 'move' },
      { kind: 'group', root: '/dst', subdir: 'Cyberpunk', transfer: 'move' },
    ]);
    finish(0, 'done', { itemsDone: 2 });
    finish(1, 'done', { itemsDone: 1 });
    await flush();
    expect(TestBed.inject(JobsStore).messages()).toContain('Series grouped: 3 files');
    // into the series folders themselves: one job each, no sub-folder
    sg.open();
    await flush();
    sg.update({ target: 'source' });
    await sg.run('copy');
    expect(jobsApi.started.slice(2).map((j) => j.spec)).toMatchObject([
      { root: '/filme/Die Kirche', transfer: 'copy' },
      { root: '/filme/Cyberpunk', transfer: 'copy' },
    ]);
    expect('subdir' in jobsApi.started[2].spec).toBe(false);
  });

  it('drops a stale scan, cancels it on close and shows a scan error', async () => {
    await left.load('/src');
    folders.hold = true;
    sg.open();
    expect(sg.scanning()).toBe(true);
    expect(sg.canRun()).toBe(false);
    sg.close();
    expect(folders.cancels).toEqual(['series-1-0']);
    folders.tree = tree(['x.s05e01.mkv']);
    sg.open();
    folders.release('lifo');
    await flush();
    expect(sg.plan().seasons.map((s) => s.folder)).toEqual(['S05']);
    sg.close();
    folders.hold = false;
    folders.collectError = { code: 'permission_denied', message: 'no', path: '/src' };
    sg.open();
    await flush();
    expect(sg.scanError()?.code).toBe('permission_denied');
    expect(sg.scanning()).toBe(false);
    sg.close();
  });

  it('a second run: everything is in place, nothing to do', async () => {
    folders.tree = tree(['S01/show.s01e01.mkv', 'S02/show.s02e01.mkv']);
    await left.load('/src');
    sg.open();
    await flush();
    expect(sg.items()).toEqual([]);
    expect(sg.canRun()).toBe(false);
    sg.close();
  });

  it('move + cleanup opens "clean folders" for the release folders of moved files', async () => {
    const cl = TestBed.inject(CleanFoldersStore);
    const settings = TestBed.inject(SettingsStore);
    cl.form.set({ ...DEFAULT_CLEAN_FORM, patternsText: '*.mine' });
    await left.load('/src');
    sg.open();
    await flush();
    sg.update({ cleanup: true, junk: '*.nfo; *-sample.*; *.jpg' });
    await sg.run('move');
    finish(0, 'doneWithErrors', {
      itemsDone: 2,
      itemsFailed: 1,
      errors: [
        {
          path: '/src/Show.S02E01-GRP/show.s02e01.mkv',
          error: { code: 'already_exists', message: 'x', path: null },
        },
      ],
    });
    await flush();
    expect(dialogs.open()).toBe('clean-folders');
    expect(cl.request()).toMatchObject({
      folder: '/src',
      roots: ['/src/Show.S01E01-GRP', '/src/Show.S01E02-GRP'],
    });
    // only real release extras – never the dialog's own list (`*.jpg`, `*.txt`: review 045 #2)
    expect(cl.options()).toEqual({
      emptyDirs: true,
      includeRoots: true,
      junk: [
        '*.nfo',
        '*.sfv',
        '*.srr',
        '*.md5',
        '*-sample.*',
        '*.sample.*',
        'sample-*',
        'sample.*',
        '.DS_Store',
        'Thumbs.db',
        'desktop.ini',
      ],
      patterns: [],
    });
    expect(cl.mode()).toBe('trash');
    // the dialog names the junk that leaves with a folder (review 045 #2)
    folders.scan = {
      ...folders.scan,
      items: [
        {
          path: '/src/Show.S01E01-GRP',
          kind: 'dir',
          junk: 7,
          junkNames: ['a.nfo', 'b.nfo', 'c.nfo', 'd.nfo', 'e.nfo'],
        },
      ],
    };
    await cl.scanNow();
    expect(cl.rows()[0].info).toBe('with 7 junk files: a.nfo, b.nfo, c.nfo, d.nfo, e.nfo …');
    // the prepared form is not kept as the user's last input, and goes on close
    cl.close();
    expect(cl.form().patternsText).toBe('*.mine');
    const kept = settings.get('dialogs.recent') as { dialog: string; value: object }[];
    expect(kept.map((k) => k.dialog)).toEqual(['seriesGroup']);
    expect(kept[0].value).toMatchObject({ cleanup: true, junk: '*.nfo; *-sample.*; *.jpg' });
    expect(JSON.stringify(kept[0].value)).not.toContain('move');
  });

  it('cleanup after a move into the other side: the start folders lie in the source folder (review 045 #3)', async () => {
    const cl = TestBed.inject(CleanFoldersStore);
    await left.load('/src');
    await right.load('/dst');
    sg.open();
    await flush();
    sg.update({ cleanup: true, target: 'other' });
    await sg.run('move');
    finish(0);
    await flush();
    expect(cl.request()).toMatchObject({ side: 'left', folder: '/src' });
    cl.close();
  });

  it('opens with the kept options, never with a kept transfer', async () => {
    const settings = TestBed.inject(SettingsStore);
    settings.set('dialogs.recent', [
      { dialog: 'seriesGroup', value: { template: 'Staffel {n}', transfer: 'move' } },
    ]);
    await left.load('/src');
    sg.open();
    await flush();
    expect(sg.options().template).toBe('Staffel {n}');
    expect(sg.plan().seasons.map((s) => s.folder)).toEqual(['Staffel 1', 'Staffel 2']);
    sg.close();
  });

  it('keeps a refused job in the dialog', async () => {
    await left.load('/src');
    sg.open();
    await flush();
    jobsApi.refuse = { code: 'dangerous_path', message: 'no', path: null };
    await sg.run('move');
    expect(dialogs.open()).toBe('series-group');
    expect(sg.runError()?.code).toBe('dangerous_path');
    sg.close();
  });
});
