import { TestBed } from '@angular/core/testing';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ActionService } from '../../core/actions/action.service';
import { DiskUsageApi } from '../../core/diskusage/disk-usage-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SessionApi } from '../../core/session/session-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { FakeDiskUsageApi, FakeNode } from '../../../testing/fake-disk-usage-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { registerOpsActions } from '../ops/ops-actions';
import { OpsStore } from '../ops/ops.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerDiskUsageActions } from './disk-usage-actions';
import { USAGE_TEXTS } from './disk-usage-texts';
import { DiskUsageStore } from './disk-usage.store';
import { isUsageKey, upPath, usageKey, UsageRow, usageOf } from './usage-rows';

const SUMMARY: Summary = {
  itemsDone: 0,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const TREE: FakeNode = {
  name: 'r',
  children: [
    {
      name: 'big',
      children: [
        { name: 'film.mkv', size: 500 },
        { name: 'sub', children: [{ name: 'deep', size: 50 }] },
      ],
    },
    { name: 'f.iso', size: 300 },
    { name: 'stick', kind: 'mount' },
  ],
};

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('DiskUsageStore and disk-usage tabs (design 033)', () => {
  let jobsApi: FakeJobsApi;
  let api: FakeDiskUsageApi;
  let usage: DiskUsageStore;
  let ws: WorkspaceStore;
  let jobs: JobsStore;
  let left: FileBrowserStore;

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    api = new FakeDiskUsageApi();
    const fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/r',
        parent: '/',
        segments: [{ name: 'r', path: path ?? '/r' }],
        entries: [dir('big', { path: '/r/big' })],
        unreadableEntries: 0,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: jobsApi },
        { provide: FsApi, useValue: fsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: DiskUsageApi, useValue: api },
      ],
    });
    jobs = TestBed.inject(JobsStore);
    await jobs.init();
    // the job id the fake hands out next is j1
    api.addScan('j1', '/r', TREE, true);
    usage = TestBed.inject(DiskUsageStore);
    usage.pollMs = 5;
    ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
  });

  /** Shows the scan's state in the left store like `FilePanel` does. */
  const show = (id = 'j1') => {
    left.usageNav = usage.navigator(id);
    const st = usage.state(id)!;
    left.showSearch(usageKey(id), st.rows, 'usage', {
      parent: usage.parentPath(id),
      marked: usage.levelMarks(id),
    });
    left.markedOverride.set(usage.basket(id).effective);
  };
  const names = () => usage.state('j1')!.rows.map((r) => r.name);
  const row = (name: string) => usage.state('j1')!.rows.find((r) => r.name === name)! as UsageRow;

  it('starts a scan job and opens a disk-usage tab with the first level', async () => {
    const settings = TestBed.inject(SettingsStore);
    settings.set('diskUsage.sizeMode', 'logical');
    expect(await usage.start('left', ['/r'], 'r')).toBeNull();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'diskUsage',
      roots: ['/r'],
      volume: false,
      options: { sizeMode: 'logical', crossFilesystems: false },
    });
    const tab = ws.activeTab('left');
    expect(tab.search?.key).toBe('usage:j1');
    expect(tab.search?.label).toBe(USAGE_TEXTS.tabLabel('r'));
    expect(ws.panels().left.tabs).toHaveLength(2);
    expect(names()).toEqual(['big', 'f.iso', 'stick']);
    expect(usage.parentPath('j1')).toBeNull();
    expect(usage.isRunning('j1')).toBe(true);
    // a helper job: no task of the user
    expect(jobs.visible()).toEqual([]);
  });

  it('reads the level again while the scan runs and once more when it ends', async () => {
    await usage.start('left', ['/r'], 'r');
    const before = api.calls.length;
    await wait(30);
    expect(api.calls.length).toBeGreaterThan(before);
    api.setRunning('j1', false);
    jobsApi.emit({ type: 'finished', id: 'j1', state: 'done', summary: SUMMARY });
    await wait(20);
    const after = api.calls.length;
    await wait(30);
    expect(api.calls.length).toBe(after);
    expect(usage.isRunning('j1')).toBe(false);
  });

  it('navigates inside the scan: into folders, up with the cursor on the folder, back and forward', async () => {
    await usage.start('left', ['/r'], 'r');
    show();
    await left.open(row('big'));
    expect(names()).toEqual(['film.mkv', 'sub']);
    expect(usage.parentPath('j1')).toBe(upPath('j1'));
    expect(usage.state('j1')!.cursor).toBeNull();
    show();
    expect(left.parent()).toBe(upPath('j1'));
    await left.up();
    expect(names()).toEqual(['big', 'f.iso', 'stick']);
    expect(usage.state('j1')!.cursor).toBe('/r/big');
    expect(left.canGoBack()).toBe(true);
    await left.back();
    expect(names()).toEqual(['film.mkv', 'sub']);
    await left.forward();
    expect(names()).toEqual(['big', 'f.iso', 'stick']);
    await usage.goTo('j1', 1);
    expect(names()).toEqual(['film.mkv', 'sub']);
    // Backspace on "..": up again
    show();
    await left.open({
      ...row('film.mkv'),
      name: '..',
      path: upPath('j1'),
      parentLink: true,
    } as never);
    expect(names()).toEqual(['big', 'f.iso', 'stick']);
  });

  it('another drive is not opened; a file is opened like everywhere', async () => {
    await usage.start('left', ['/r'], 'r');
    expect(await usage.open('j1', row('stick'))).toBe(true);
    expect(jobs.messages()).toContain(USAGE_TEXTS.mountNotScanned);
    expect(await usage.open('j1', row('f.iso'))).toBe(false);
  });

  it('"largest files" lists the files of the subtree; Enter goes to the file\'s folder', async () => {
    await usage.start('left', ['/r'], 'r');
    await usage.setMode('j1', 'largest');
    expect(names()).toEqual(['film.mkv', 'f.iso', 'deep']);
    expect(row('deep').dir).toBe('big/sub');
    await usage.open('j1', row('deep'));
    expect(usage.state('j1')!.mode).toBe('all');
    expect(names()).toEqual(['deep']);
    expect(usage.state('j1')!.cursor).toBe('/r/big/sub/deep');
  });

  it('marks of all levels form the basket; operations get its entries', async () => {
    await usage.start('left', ['/r'], 'r');
    show();
    left.toggleMark('/r/f.iso');
    usage.setLevelMarks('j1', left.marked());
    await usage.open('j1', row('big'));
    show();
    expect(left.marked().size).toBe(0);
    left.toggleMark('/r/big/film.mkv');
    usage.setLevelMarks('j1', left.marked());
    show();
    expect(left.markedEntries().map((e) => e.name)).toEqual(['f.iso', 'film.mkv']);
    // back up: f.iso is marked in the list again
    await usage.up('j1');
    show();
    expect([...left.marked()]).toEqual(['/r/f.iso']);
    // the folder covers the file inside
    left.toggleMark('/r/big');
    usage.setLevelMarks('j1', left.marked());
    const b = usage.basket('j1');
    expect(b.effective.map((r) => r.name)).toEqual(['f.iso', 'big']);
    expect(b.size).toBe(850);
    usage.unmark('j1', row('f.iso').usage.id);
    expect(usage.basket('j1').effective.map((r) => r.name)).toEqual(['big']);
    usage.clearBasket('j1');
    expect(usage.basket('j1').effective).toEqual([]);
  });

  it('the "12 smaller files" rows and ".." are never marked', async () => {
    api.addScan('j1', '/r', {
      name: 'r',
      children: [
        { name: '', kind: 'files', size: 10 },
        { name: 'a', size: 1 },
      ],
    });
    await usage.start('left', ['/r'], 'r');
    show();
    const agg = usage.state('j1')!.rows[0];
    expect(usageOf(agg)?.virtual).toBe(true);
    left.toggleMark(agg.path);
    expect(left.marked().size).toBe(0);
  });

  it('deleting compares with the scan (logical sizes) and prunes what went', async () => {
    await usage.start('left', ['/r'], 'r');
    const exp = usage.expected([row('f.iso'), row('big')]);
    expect(exp).toEqual([
      { path: '/r/f.iso', kind: 'file', size: 300, modifiedMs: 1000 },
      { path: '/r/big', kind: 'directory', size: null, modifiedMs: null },
    ]);
    show();
    left.toggleMark('/r/f.iso');
    usage.setLevelMarks('j1', left.marked());
    api.exists = (p) => p !== '/r/f.iso';
    await usage.afterRemoval('j1', ['/r/f.iso']);
    expect(api.calls).toContain('prune j1 /r/f.iso');
    expect(names()).toEqual(['big', 'stick']);
    expect(usage.basket('j1').effective).toEqual([]);
    expect(usage.ageMinutes('j1', usage.state('j1')!.view!.scannedAtMs + 3 * 60_000)).toBe(3);
  });

  it('F8 in a disk-usage tab deletes the basket with "expected" and prunes afterwards', async () => {
    const actions = TestBed.inject(ActionService);
    const ops = TestBed.inject(OpsStore);
    registerOpsActions(actions, ops);
    TestBed.inject(SettingsStore).set('behavior.confirmTrash', false);
    await usage.start('left', ['/r'], 'r');
    show();
    left.toggleMark('/r/f.iso');
    usage.setLevelMarks('j1', left.marked());
    show();
    await ops.openDelete('trash');
    const del = jobsApi.started.find((s) => s.spec.kind === 'delete')!;
    expect(del.spec).toMatchObject({
      kind: 'delete',
      paths: ['/r/f.iso'],
      expected: [{ path: '/r/f.iso', kind: 'file', size: 300, modifiedMs: 1000 }],
    });
    jobsApi.emit({ type: 'finished', id: del.id, state: 'done', summary: SUMMARY });
    await wait(10);
    expect(api.calls).toContain('prune j1 /r/f.iso');
  });

  it('rescans the shown folder; releases the scan with its tab', async () => {
    await usage.start('left', ['/r'], 'r');
    api.setRunning('j1', false);
    await usage.refresh('j1');
    await usage.open('j1', row('big'));
    const p = usage.rescan('j1');
    await wait();
    expect(jobsApi.started.at(-1)!.spec).toEqual({
      kind: 'diskUsage',
      roots: [],
      rescan: { scanId: 'j1', nodeId: 1 },
    });
    jobsApi.emit({ type: 'finished', id: 'j2', state: 'done', summary: SUMMARY });
    await p;
    ws.closeTab('left');
    await wait();
    expect(api.released).toEqual(['j1']);
    expect(usage.state('j1')).toBeUndefined();
  });

  it('a released scan shows the error instead of rows', async () => {
    await usage.start('left', ['/r'], 'r');
    api.scans.delete('j1');
    await usage.refresh('j1');
    expect(usage.state('j1')!.error?.code).toBe('scan_not_found');
  });

  it('actions: start from the marked folders; off-limits actions in a disk-usage tab', async () => {
    const actions = TestBed.inject(ActionService);
    registerDiskUsageActions(actions, ws, usage, jobs, TestBed.inject(SettingsStore));
    registerOpsActions(actions, TestBed.inject(OpsStore));
    await left.load('/r');
    left.toggleMark('/r/big');
    expect(await actions.run('OPEN_DISK_USAGE')).toBe(true);
    expect(jobsApi.started[0].spec).toMatchObject({ roots: ['/r/big'], volume: false });
    expect(isUsageKey(ws.activeTab('left').search?.key)).toBe(true);
    show();
    left.setCursor('/r/f.iso');
    expect(actions.state('OPEN_RENAME_DLG')).toBe('disabled');
    expect(actions.state('OPEN_DELETE_DLG')).toBe('ready');
    expect(actions.state('DISK_USAGE_LARGEST')).toBe('ready');
    await actions.run('DISK_USAGE_LARGEST');
    expect(usage.state('j1')!.mode).toBe('largest');
    const s = TestBed.inject(SettingsStore);
    await actions.run('DISK_USAGE_TOGGLE_CHART');
    expect(s.get('diskUsage.chart')).toBe('treemap');
  });
});
