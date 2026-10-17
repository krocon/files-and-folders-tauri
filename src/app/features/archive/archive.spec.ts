import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { EMPTY_STATS, SearchHit } from '../../core/search/search.models';
import { SessionApi } from '../../core/session/session-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore, IN_ARCHIVE_OPEN } from '../browser/file-browser.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { DuplicatesStore } from '../duplicates/duplicates.store';
import { registerOpsActions } from '../ops/ops-actions';
import { OpsStore } from '../ops/ops.store';
import { SearchStore } from '../search/search.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerArchiveActions } from './archive-actions';
import { ArchiveStore } from './archive.store';

/** `/data` with an archive, and the root of that archive (virtual paths from "Rust"). */
const DATA: DirectoryListing = {
  path: '/data',
  parent: '/',
  segments: [
    { name: '/', path: '/' },
    { name: 'data', path: '/data' },
  ],
  entries: [
    entry('Fotos 📷.zip', { path: '/data/Fotos 📷.zip' }),
    entry('a.txt', { path: '/data/a.txt' }),
  ],
  unreadableEntries: 0,
};
const IN_ZIP: DirectoryListing = {
  path: '/data/Fotos 📷.zip',
  parent: '/data',
  segments: [...DATA.segments, { name: 'Fotos 📷.zip', path: '/data/Fotos 📷.zip' }],
  entries: [
    dir('Über', { path: '/data/Fotos 📷.zip/Über', size: 3 }),
    entry('bild.jpg', { path: '/data/Fotos 📷.zip/bild.jpg' }),
  ],
  unreadableEntries: 0,
  archive: { path: '/data/Fotos 📷.zip', inner: '', format: 'zip', unsafeEntries: 1, entries: 4 },
};

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('archives and duplicates in the frontend (design 016)', () => {
  let jobsApi: FakeJobsApi;
  let fsApi: FakeFsApi;
  let ws: WorkspaceStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  let actions: ActionService;
  let archive: ArchiveStore;
  let ops: OpsStore;

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) => {
      if (path === '/data/Fotos 📷.zip') {
        return Promise.resolve(IN_ZIP);
      }
      if (path === '/data' || path === undefined) {
        return Promise.resolve(DATA);
      }
      return Promise.resolve({ ...DATA, path: path, entries: [] });
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: jobsApi },
        { provide: FsApi, useValue: fsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    await TestBed.inject(JobsStore).init();
    ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    actions = TestBed.inject(ActionService);
    archive = TestBed.inject(ArchiveStore);
    ops = TestBed.inject(OpsStore);
    registerOpsActions(actions, ops);
    registerArchiveActions(actions, archive, TestBed.inject(DuplicatesStore));
    await left.load('/data');
    await right.load('/target');
    ws.setActive('left');
  });

  it('Enter on an archive opens it as a folder; files inside are not opened', async () => {
    await left.open(left.entries()[0]);
    expect(left.path()).toBe('/data/Fotos 📷.zip');
    expect(left.archive()?.format).toBe('zip');
    await left.open(left.entries()[1]);
    expect(left.error()?.message).toBe(IN_ARCHIVE_OPEN);
    expect(fsApi.opened).toEqual([]);
    await left.up();
    expect(left.path()).toBe('/data');
    expect(left.cursorPath()).toBe('/data/Fotos 📷.zip');
    expect(left.archive()).toBeNull();
  });

  it('inside an archive only copying (= extracting) is possible', async () => {
    await left.load('/data/Fotos 📷.zip');
    left.setMarked(['/data/Fotos 📷.zip/Über'], true);
    expect(actions.state('OPEN_COPY_DLG') === 'ready').toBe(true);
    expect(actions.state('OPEN_MOVE_DLG') === 'ready').toBe(false);
    expect(actions.state('OPEN_DELETE_DLG') === 'ready').toBe(false);
    expect(actions.state('OPEN_MKDIR_DLG') === 'ready').toBe(false);
    expect(actions.state('OPEN_RENAME_DLG') === 'ready').toBe(false);
    expect(actions.state('OPEN_PACK_DLG') === 'ready').toBe(false);
    await ops.openCopyMove('copy');
    const req = archive.unpack()!;
    expect(TestBed.inject(DialogService).open()).toBe('unpack');
    expect(req.fromArchive).toBe(true);
    expect(req.target).toBe('/target');
    expect(req.jobs).toEqual([
      { archive: '/data/Fotos 📷.zip', entries: ['/data/Fotos 📷.zip/Über'] },
    ]);
    fsApi.locations = { '/target': { dir: '/target', select: null } };
    expect(
      await archive.runUnpack(req, {
        target: '/target',
        intoSubfolder: false,
        conflictDefault: 'skip',
      }),
    ).toBeNull();
    expect(jobsApi.started.at(-1)?.spec).toEqual({
      kind: 'extract',
      archive: '/data/Fotos 📷.zip',
      entries: ['/data/Fotos 📷.zip/Über'],
      targetDir: '/target',
      intoSubfolder: false,
      options: { conflictDefault: 'skip' },
    });
    await expect(ops.openCopyMove('move')).rejects.toBeTruthy();
    await expect(ops.openDelete('trash')).rejects.toBeTruthy();
  });

  it('a panel inside an archive is never a copy target', async () => {
    await right.load('/data/Fotos 📷.zip');
    left.setCursor('/data/a.txt');
    await ops.openCopyMove('copy');
    expect(ops.copyMove()?.target).toBe('/data'); // not the virtual folder
    await expect(
      ops.openCopyMoveFor({
        kind: 'copy',
        side: 'left',
        sourceDir: '/data',
        sources: [left.entries()[1]],
        target: '/data/Fotos 📷.zip/Über',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('into an archive') });
  });

  it('Alt+F9 unpacks the selected archives, Alt+F5 packs the selection', async () => {
    left.setCursor('/data/Fotos 📷.zip');
    expect(actions.state('OPEN_UNPACK_DLG') === 'ready').toBe(true);
    archive.openUnpack();
    const u = archive.unpack()!;
    expect(u.fromArchive).toBe(false);
    expect(u.archiveName).toBe('Fotos 📷');
    expect(u.jobs).toEqual([{ archive: '/data/Fotos 📷.zip', entries: [] }]);
    archive.close();

    left.setMarked(['/data/a.txt', '/data/Fotos 📷.zip'], true);
    expect(actions.state('OPEN_PACK_DLG') === 'ready').toBe(true);
    archive.openPack();
    const p = archive.pack()!;
    expect(p.folderName).toBe('data');
    expect(p.target).toBe('/target');
    fsApi.locations = { '/target': { dir: '/target', select: null } };
    expect(
      await archive.runPack(p, { name: ' ', format: 'zip', level: 6, target: '/target' }),
    ).not.toBeNull();
    expect(
      await archive.runPack(p, {
        name: 'data.tar.gz',
        format: 'tarGz',
        level: 9,
        target: '/target',
      }),
    ).toBeNull();
    expect(jobsApi.started.at(-1)?.spec).toEqual({
      kind: 'pack',
      sources: ['/data/Fotos 📷.zip', '/data/a.txt'],
      targetDir: '/target',
      name: 'data.tar.gz',
      format: 'tarGz',
      level: 9,
    });
  });

  it('a non-archive file cannot be unpacked', () => {
    left.setCursor('/data/a.txt');
    expect(actions.state('OPEN_UNPACK_DLG') === 'ready').toBe(false);
    expect(() => archive.openUnpack()).toThrow();
  });

  it('duplicates: a result tab with groups, selection helpers and the delete warning', async () => {
    const search = TestBed.inject(SearchStore);
    const dup = TestBed.inject(DuplicatesStore);
    dup.open();
    expect(dup.request()?.folder).toEqual(['/data']);
    await dup.run();
    const started = jobsApi.started.at(-1)!;
    expect(started.spec).toMatchObject({
      kind: 'duplicates',
      criteria: { roots: ['/data'], compare: 'content', minSize: 1, maxFiles: 500000 },
    });
    const tab = ws.activeTab('left');
    expect(tab.search?.label).toBe('Duplicates');
    const h = (name: string, group: number, modifiedMs: number): SearchHit => ({
      ...entry(name, { path: `/data/${group}/${name}`, modifiedMs, size: 100 }),
      dir: `/data/${group}`,
      group,
    });
    const rows = [h('a.jpg', 1, 10), h('b.jpg', 1, 20), h('c.mp3', 2, 5), h('d.mp3', 2, 1)];
    jobsApi.emit({
      type: 'searchHits',
      id: started.id,
      hits: rows,
      stats: { ...EMPTY_STATS, hits: 4 },
    });
    jobsApi.emit({
      type: 'finished',
      id: started.id,
      state: 'done',
      summary: {
        itemsDone: 4,
        itemsSkipped: 0,
        itemsFailed: 0,
        bytesDone: 0,
        errors: [],
        error: null,
        dirSize: null,
      },
    });
    await wait();
    const r = search.result(tab.search!.key)!;
    expect(r.kind).toBe('duplicates');
    expect(r.hits).toHaveLength(4);
    left.showSearch(r.key, r.hits, r.kind);
    expect(left.searchKind()).toBe('duplicates');
    expect(left.takePendingTableState()).toEqual({
      sort: [{ property: 'group', sortState: 'asc' }],
    });

    expect(actions.state('DUP_MARK_KEEP_NEWEST') === 'ready').toBe(true);
    await actions.run('DUP_MARK_KEEP_NEWEST');
    expect([...left.marked()].sort()).toEqual(['/data/1/a.jpg', '/data/2/d.mp3']);

    await ops.openDelete('trash');
    expect(ops.del()?.wholeGroups).toBe(0);
    ops.close();
    left.setMarked(['/data/1/b.jpg'], true); // group 1 complete now
    await ops.openDelete('trash');
    expect(ops.del()?.wholeGroups).toBe(1);
    expect(ops.del()?.mode).toBe('trash');
  });
});
