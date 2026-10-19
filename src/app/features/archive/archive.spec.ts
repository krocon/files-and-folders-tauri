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
import { FileBrowserStore } from '../browser/file-browser.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { DuplicatesStore } from '../duplicates/duplicates.store';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { OsStore } from '../osintegration/os.store';
import { registerOpsActions } from '../ops/ops-actions';
import { OpsStore } from '../ops/ops.store';
import { SearchStore } from '../search/search.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { contextMenuFor, nativeEnabled, resolveMenu, toNativeSpec } from '../menus/menu-model';
import { registerArchiveActions } from './archive-actions';
import { ArchiveStore } from './archive.store';
import { ARCHIVE_TEXTS } from './archive-texts';

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
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
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
    expect(left.error()?.message).toBe(ARCHIVE_TEXTS.openInside);
    expect(fsApi.opened).toEqual([]);
    actions.register({ OPEN_VIEW_DLG: { run: () => undefined } });
    await left.up();
    expect(actions.state('OPEN_VIEW_DLG')).toBe('ready');
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
    // every action that needs real files is vetoed centrally (also those of other features)
    actions.register({ OPEN_VIEW_DLG: { run: () => undefined } });
    expect(actions.state('OPEN_VIEW_DLG')).toBe('disabled');
    expect(await actions.run('OPEN_VIEW_DLG')).toBe(false);
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

  it('the veto also dims menu and context-menu entries, tools included (merge 014)', async () => {
    actions.extras.set([
      { id: 'tool:edit', label: 'Edit', shortcut: null, enabled: () => true, run: () => undefined },
    ]);
    const states = () => {
      const items = resolveMenu(
        [...contextMenuFor('empty'), ...contextMenuFor('archive'), '@tools'],
        actions,
        'linux',
      );
      return new Map(items.map((i) => [i.id, i.disabled === true]));
    };
    expect(states().get('OPEN_MKDIR_DLG')).toBe(false);
    expect(states().get('tool:edit')).toBe(false);
    await left.load('/data/Fotos 📷.zip');
    left.setMarked(['/data/Fotos 📷.zip/Über'], true);
    const s = states();
    expect(s.get('OPEN_MKDIR_DLG')).toBe(true);
    expect(s.get('OPEN_CREATE_FILE_DLG')).toBe(true);
    expect(s.get('tool:edit')).toBe(true);
    expect(s.get('OPEN_UNPACK_DLG')).toBe(false);
    expect(s.get('OPEN_COPY_DLG')).toBe(false);
    const native = nativeEnabled(toNativeSpec(actions, 'linux', false));
    expect(native.get('OPEN_DELETE_DLG')).toBe(false);
    expect(native.get('tool:edit')).toBe(false);
    expect(native.get('OPEN_UNPACK_DLG')).toBe(true);
    expect(await actions.runAny('tool:edit')).toBe(false);
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

  it('archive folders are never suggested as targets; tools get no archive targetDir (review 016 #7)', async () => {
    await right.load('/data/Fotos 📷.zip');
    ws.toggleFavorite('/data/Fotos 📷.zip/Über');
    ws.toggleFavorite('/target');
    ws.addRecent('/data/Fotos 📷.zip');
    left.setCursor('/data/a.txt');
    await ops.openCopyMove('copy');
    const paths = ops.copyMove()!.targets.map((t) => t.path);
    expect(paths).toContain('/target');
    expect(paths.filter((p) => p.startsWith('/data/Fotos'))).toEqual([]);
    ops.close();
    archive.openPack();
    expect(
      archive
        .pack()!
        .targets.map((t) => t.path)
        .filter((p) => p.startsWith('/data/Fotos')),
    ).toEqual([]);
    archive.close();
    const os = TestBed.inject(OsStore);
    expect(os.context().targetDir).toBeNull();
    await right.load('/target');
    expect(os.context().targetDir).toBe('/target');
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

  it('duplicates by size only: no keep helpers, a warning when deleting (review 016 #6)', async () => {
    const search = TestBed.inject(SearchStore);
    const dup = TestBed.inject(DuplicatesStore);
    dup.open();
    dup.update({ compare: 'size' });
    await dup.run();
    const started = jobsApi.started.at(-1)!;
    expect(started.spec).toMatchObject({ kind: 'duplicates', criteria: { compare: 'size' } });
    const tab = ws.activeTab('left');
    const hit = (name: string): SearchHit => ({
      ...entry(name, { path: `/data/1/${name}`, size: 100 }),
      dir: '/data/1',
      parentNames: ['1', 'data', ''],
      group: 1,
    });
    jobsApi.emit({
      type: 'searchHits',
      id: started.id,
      hits: [hit('a.bin'), hit('b.bin')],
      stats: { ...EMPTY_STATS, hits: 2 },
    });
    await wait();
    const r = search.result(tab.search!.key)!;
    left.showSearch(r.key, r.hits, r.kind);
    expect(dup.sizeOnly()).toBe(true);
    expect(actions.state('DUP_MARK_KEEP_NEWEST')).toBe('disabled');
    expect(await actions.run('DUP_MARK_KEEP_FIRST')).toBe(false);
    expect(left.marked().size).toBe(0);
    left.setMarked(['/data/1/a.bin'], true);
    await ops.openDelete('trash');
    expect(ops.del()?.sizeOnly).toBe(true);
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
      parentNames: [`${group}`, 'data', ''],
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

describe('unpack and pack dialogs render (design 016)', () => {
  it('shows the request', async () => {
    const { UnpackDialog } = await import('./unpack-dialog');
    const { PackDialog } = await import('./pack-dialog');
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    const store = TestBed.inject(ArchiveStore);
    store.unpack.set({
      side: 'left',
      jobs: [{ archive: '/a.zip', entries: ['/a.zip/x'] }],
      archiveName: null,
      fromArchive: true,
      entryCount: 1,
      target: '/t',
      targets: [{ path: '/t', group: 'Other panel' }],
    });
    const f = TestBed.createComponent(UnpackDialog);
    f.detectChanges();
    expect(document.body.textContent).toContain('Extract from the archive');
    f.destroy();
    store.pack.set({
      side: 'left',
      sources: [entry('x.txt', { path: '/x.txt' })],
      folderName: null,
      target: '/t',
      targets: [],
    });
    const p = TestBed.createComponent(PackDialog);
    p.detectChanges();
    const name = document.body.querySelector<HTMLInputElement>('input[type="text"]');
    expect(name?.value).toBe('x.zip');
    p.destroy();
  });
});
