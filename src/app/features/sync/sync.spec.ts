import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobState, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SessionApi } from '../../core/session/session-api';
import { SettingsStore } from '../../core/settings/settings.store';
import {
  CompareRow,
  CompareSide,
  CompareStatus,
  EMPTY_COMPARE_STATS,
} from '../../core/sync/sync.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { nameKey, quickCompare } from './quick-compare';
import { actionSymbol, SyncDialog } from './sync-dialog';
import { registerSyncActions } from './sync-actions';
import {
  allowedActions,
  buildOps,
  buildTree,
  defaultAction,
  defaultActions,
  DEFAULT_VIEW,
  nextAction,
  RowAction,
  setAction,
  sums,
  visibleIndexes,
} from './sync-logic';
import { defaultSyncForm, restoreSyncForm, SYNC_FLUSH_MS, SyncStore } from './sync.store';

const flush = () => new Promise((r) => setTimeout(r));

function side(name: string, root: string, over: Partial<CompareSide> = {}): CompareSide {
  return { path: `${root}/${name}`, name, kind: 'file', size: 10, modifiedMs: 1000, ...over };
}

/** A row; `rel` with `/` only in this test data (the app never splits it). */
function row(
  rel: string,
  status: CompareStatus,
  opts: { depth?: number; dir?: boolean; left?: boolean; right?: boolean; size?: number } = {},
): CompareRow {
  const kind = opts.dir ? 'directory' : 'file';
  const hasLeft = opts.left ?? status !== 'onlyRight';
  const hasRight = opts.right ?? status !== 'onlyLeft';
  const size = opts.dir ? null : (opts.size ?? 10);
  return {
    rel,
    depth: opts.depth ?? 0,
    left: hasLeft ? side(rel, '/L', { kind, size }) : null,
    right: hasRight ? side(rel, '/R', { kind, size }) : null,
    leftPath: `/L/${rel}`,
    rightPath: `/R/${rel}`,
    status,
    contentChecked: false,
  };
}

describe('quick compare (design 036 E1)', () => {
  const f = (name: string, size: number, modifiedMs: number, root = '/l') =>
    entry(name, { path: `${root}/${name}`, size, modifiedMs });

  it('marks what is missing and the newer file; same time, other size marks both', () => {
    const l = [
      f('same.txt', 1, 10_000),
      f('newer.txt', 1, 50_000),
      f('older.txt', 1, 10_000),
      f('size.txt', 1, 10_000),
      f('nur links.txt', 1, 0),
      dir('Ordner', { path: '/l/Ordner' }),
      dir('nur hier', { path: '/l/nur hier' }),
      f('within 2 s', 1, 10_000),
    ];
    const r = [
      f('same.txt', 1, 10_000, '/r'),
      f('newer.txt', 1, 10_000, '/r'),
      f('older.txt', 1, 50_000, '/r'),
      f('size.txt', 2, 10_000, '/r'),
      dir('Ordner', { path: '/r/Ordner' }),
      f('nur rechts.txt', 1, 0, '/r'),
      f('within 2 s', 1, 12_000, '/r'),
    ];
    const res = quickCompare(l, r, false);
    expect([...res.left].sort()).toEqual(
      ['/l/newer.txt', '/l/nur hier', '/l/nur links.txt', '/l/size.txt'].sort(),
    );
    expect([...res.right].sort()).toEqual(
      ['/r/nur rechts.txt', '/r/older.txt', '/r/size.txt'].sort(),
    );
  });

  it('pairs NFC with NFD and – where the OS ignores case – A with a', () => {
    const nfd = 'Müller.txt';
    const nfc = 'Müller.txt';
    expect(nameKey(nfd, false)).toBe(nameKey(nfc, false));
    const res = quickCompare([f(nfd, 1, 0)], [f(nfc, 1, 0, '/r')], false);
    expect(res).toEqual({ left: [], right: [] });
    expect(quickCompare([f('A.txt', 1, 0)], [f('a.txt', 1, 0, '/r')], true)).toEqual({
      left: [],
      right: [],
    });
    expect(quickCompare([f('A.txt', 1, 0)], [f('a.txt', 1, 0, '/r')], false).left).toEqual([
      '/l/A.txt',
    ]);
    // two names on one side that differ only in case are paired exactly
    const res2 = quickCompare([f('a.txt', 1, 0), f('A.txt', 1, 0)], [f('a.txt', 1, 0, '/r')], true);
    expect(res2).toEqual({ left: ['/l/A.txt'], right: [] });
  });

  it('a file against a folder marks both', () => {
    const res = quickCompare([f('x', 1, 0)], [dir('x', { path: '/r/x' })], false);
    expect(res).toEqual({ left: ['/l/x'], right: ['/r/x'] });
  });
});

describe('sync logic (design 036 E3)', () => {
  it('suggests actions per mode', () => {
    const cases: [CompareStatus, RowAction, RowAction, RowAction, RowAction][] = [
      // status, both, left→right, left→right + mirror, right→left
      ['leftNewer', 'copyToRight', 'copyToRight', 'copyToRight', 'none'],
      ['rightNewer', 'copyToLeft', 'none', 'copyToRight', 'copyToLeft'],
      ['onlyLeft', 'copyToRight', 'copyToRight', 'copyToRight', 'none'],
      ['onlyRight', 'copyToLeft', 'none', 'deleteRight', 'copyToLeft'],
      ['differs', 'none', 'none', 'copyToRight', 'none'],
      ['equal', 'none', 'none', 'none', 'none'],
      ['kindMismatch', 'none', 'none', 'none', 'none'],
    ];
    for (const [s, both, ltr, mirror, rtl] of cases) {
      const r = row('x', s);
      expect([s, defaultAction(r, 'both', false)]).toEqual([s, both]);
      expect([s, defaultAction(r, 'leftToRight', false)]).toEqual([s, ltr]);
      expect([s, defaultAction(r, 'leftToRight', true)]).toEqual([s, mirror]);
      expect([s, defaultAction(r, 'rightToLeft', false)]).toEqual([s, rtl]);
    }
    expect(defaultAction(row('x', 'onlyLeft'), 'rightToLeft', true)).toBe('deleteLeft');
  });

  it('allows only what makes sense and cycles through it', () => {
    expect(allowedActions(row('a', 'onlyLeft'))).toEqual(['copyToRight', 'deleteLeft', 'none']);
    expect(allowedActions(row('a', 'leftNewer'))).toEqual([
      'copyToRight',
      'copyToLeft',
      'deleteLeft',
      'deleteRight',
      'none',
    ]);
    expect(allowedActions(row('a', 'kindMismatch'))).toEqual(['deleteLeft', 'deleteRight', 'none']);
    // a folder on both sides is never copied
    expect(allowedActions(row('d', 'equal', { dir: true }))).toEqual([
      'deleteLeft',
      'deleteRight',
      'none',
    ]);
    const r = row('a', 'onlyRight');
    expect(nextAction(r, 'copyToLeft')).toBe('deleteRight');
    expect(nextAction(r, 'none')).toBe('copyToLeft');
  });

  /** d/ (only left) with d/x and d/sub/y, then z – preorder as Rust sends it. */
  const tree = () =>
    buildTree([
      row('d', 'onlyLeft', { dir: true }),
      row('d/x', 'onlyLeft', { depth: 1, size: 5 }),
      row('d/sub', 'onlyLeft', { depth: 1, dir: true }),
      row('d/sub/y', 'onlyLeft', { depth: 2, size: 7 }),
      row('z', 'rightNewer', { size: 3 }),
    ]);

  it('knows parents and subtrees from the preorder', () => {
    const t = tree();
    expect([...t.parent]).toEqual([-1, 0, 0, 2, -1]);
    expect([...t.end]).toEqual([4, 2, 4, 4, 5]);
  });

  it('a deleted folder takes its content; keeping something inside takes it back', () => {
    const t = tree();
    let a = defaultActions(t, 'both', false);
    expect(a).toEqual(['copyToRight', 'copyToRight', 'copyToRight', 'copyToRight', 'copyToLeft']);
    a = setAction(t, a, 0, 'deleteLeft');
    expect(a.slice(0, 4)).toEqual(['deleteLeft', 'deleteLeft', 'deleteLeft', 'deleteLeft']);
    // one delete for the folder, not four
    expect(buildOps(t, a).map((o) => o.left.path)).toEqual(['/L/d', '/L/z']);
    expect(sums(t, a)).toMatchObject({ deleteLeft: 1, toLeft: 1, toLeftBytes: 3 });
    // copying a file out of the deleted folder keeps the folders above it
    a = setAction(t, a, 3, 'copyToRight');
    expect(a).toEqual(['none', 'deleteLeft', 'none', 'copyToRight', 'copyToLeft']);
    // the folder kept by hand: its content no longer goes with its delete
    a = setAction(t, a, 0, 'deleteLeft');
    a = setAction(t, a, 0, 'none');
    expect(a.slice(0, 4)).toEqual(['none', 'none', 'none', 'none']);
    // not allowed: unchanged
    expect(setAction(t, a, 0, 'deleteRight')).toEqual(a);
  });

  it('builds ops with both paths and what was seen', () => {
    const t = buildTree([row('a', 'onlyLeft'), row('b', 'leftNewer')]);
    const ops = buildOps(t, ['copyToRight', 'copyToRight']);
    expect(ops[0]).toEqual({
      action: 'copyToRight',
      left: { path: '/L/a', seen: { kind: 'file', size: 10, modifiedMs: 1000 } },
      right: { path: '/R/a', seen: null },
    });
    expect(ops[1].right.seen).not.toBeNull();
  });

  it('filters the view', () => {
    const rows = [row('a', 'equal'), row('b', 'onlyLeft'), row('c', 'kindMismatch')];
    expect(visibleIndexes(rows, DEFAULT_VIEW)).toEqual([1, 2]);
    expect(visibleIndexes(rows, { ...DEFAULT_VIEW, equal: true, differs: false })).toEqual([0, 1]);
  });

  it('symbols show the action, else the status', () => {
    expect(actionSymbol(row('a', 'equal'), 'none')).toBe('=');
    expect(actionSymbol(row('a', 'differs'), 'none')).toBe('≠');
    expect(actionSymbol(row('a', 'onlyLeft'), 'copyToRight')).toBe('→');
    expect(actionSymbol(row('a', 'onlyLeft'), 'deleteLeft')).toBe('✕ ·');
  });

  it('restores the kept form field by field', () => {
    const fb = defaultSyncForm(true, false);
    expect(
      restoreSyncForm({ mode: 'leftToRight', toleranceSecs: 99999, content: 'x' }, fb),
    ).toEqual({
      ...fb,
      mode: 'leftToRight',
    });
  });
});

/** The GuiExpert Table needs a layout – jsdom has none. */
@Component({ selector: 'app-preview-grid', template: '{{ rows().length }} rows' })
class StubGrid {
  readonly rows = input.required<readonly unknown[]>();
  readonly columns = input<unknown>();
  readonly rowClass = input<unknown>();
  readonly labelledBy = input<string | null>(null);
  readonly activeIndex = input<number>(-1);
}

const SUMMARY: Summary = {
  itemsDone: 0,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

describe('sync store and dialog (design 036)', () => {
  let jobsApi: FakeJobsApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let sync: SyncStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;

  beforeEach(async () => {
    const fs = new FakeFsApi();
    fs.handler = (path) =>
      Promise.resolve(
        path === '/L'
          ? listing(
              '/L',
              [
                entry('a.txt', { path: '/L/a.txt', modifiedMs: 50_000 }),
                entry('nur.txt', { path: '/L/nur.txt' }),
              ],
              '/',
            )
          : listing('/R', [entry('a.txt', { path: '/R/a.txt', modifiedMs: 10_000 })], '/'),
      );
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    TestBed.overrideComponent(SyncDialog, {
      remove: { imports: [PreviewGrid] },
      add: { imports: [StubGrid] },
    });
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    sync = TestBed.inject(SyncStore);
    await TestBed.inject(JobsStore).init();
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const controller = { cursorEntry: () => null } as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => controller });
    ws.registerPanel('right', { store: right, controller: () => controller });
    registerSyncActions(actions, sync);
    await left.load('/L');
    await right.load('/R');
  });

  function finish(index: number, state: JobState, summary: Partial<Summary> = {}) {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[index].id,
      state,
      summary: { ...SUMMARY, ...summary },
    });
  }

  it('Shift+F2 replaces the marks of both panels with the differences', async () => {
    right.setMarked(['/R/a.txt'], true);
    await actions.run('COMPARE_DIRS');
    expect([...left.marked()].sort()).toEqual(['/L/a.txt', '/L/nur.txt']);
    expect([...right.marked()]).toEqual([]);
    expect(TestBed.inject(JobsStore).messages()).toContain('Marked: 2 left, 0 right');
  });

  it('compares as a job, streams rows, suggests actions and synchronises after the summary', async () => {
    await actions.run('OPEN_SYNC_DIRS_DLG');
    expect(dialogs.open()).toBe('sync');
    expect(sync.pair()).toEqual({ left: '/L', right: '/R' });
    const done = sync.compare();
    await flush();
    expect(jobsApi.started[0].spec).toMatchObject({ kind: 'compare', left: '/L', right: '/R' });
    const id = jobsApi.started[0].id;
    jobsApi.emit({
      type: 'compareRows',
      id,
      rows: [row('a.txt', 'leftNewer'), row('nur.txt', 'onlyLeft'), row('gleich', 'equal')],
      stats: { ...EMPTY_COMPARE_STATS, rows: 3, differences: 2 },
    });
    // rows of another job are not ours
    jobsApi.emit({
      type: 'compareRows',
      id: 'other',
      rows: [row('x', 'onlyLeft')],
      stats: EMPTY_COMPARE_STATS,
    });
    await new Promise((r) => setTimeout(r, SYNC_FLUSH_MS + 20));
    expect(sync.rows().length).toBe(3);
    expect(sync.canEdit()).toBe(false); // still running
    finish(0, 'done', { compare: { ...EMPTY_COMPARE_STATS, rows: 3, differences: 2 } });
    await done;
    expect(sync.compared()).toBe(true);
    expect(sync.shown()).toEqual([0, 1]); // equal rows hidden
    expect(sync.actions()).toEqual(['copyToRight', 'copyToRight', 'none']);
    sync.setAction(1, 'none');
    expect(sync.sums()).toMatchObject({ toRight: 1, toRightBytes: 10 });

    const fixture = TestBed.createComponent(SyncDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const list = fixture.nativeElement.querySelector('.list') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(sync.actions()[1]).toBe('deleteLeft');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(sync.actions()[1]).toBe('none');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(sync.actions()[1]).toBe('copyToRight');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('→ 2 entries');

    sync.askSync();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Copy 2 entries (20 B) to the right');
    await sync.runSync();
    expect(dialogs.open()).toBeNull();
    expect(jobsApi.started[1].spec).toEqual({
      kind: 'sync',
      left: '/L',
      right: '/R',
      deleteMode: 'trash',
      ops: [
        {
          action: 'copyToRight',
          left: { path: '/L/a.txt', seen: { kind: 'file', size: 10, modifiedMs: 1000 } },
          right: { path: '/R/a.txt', seen: { kind: 'file', size: 10, modifiedMs: 1000 } },
        },
        {
          action: 'copyToRight',
          left: { path: '/L/nur.txt', seen: { kind: 'file', size: 10, modifiedMs: 1000 } },
          right: { path: '/R/nur.txt', seen: null },
        },
      ],
    });
    finish(1, 'done', { itemsDone: 2 });
    await flush();
    expect(TestBed.inject(JobsStore).messages()).toContain('Synchronised: 2 entries');
    // opening again compares again (the old rows are stale)
    sync.open();
    await flush();
    expect(jobsApi.started[2].spec.kind).toBe('compare');
    expect(TestBed.inject(SettingsStore).get('dialogs.recent')[0]).toMatchObject({
      dialog: 'sync',
    });
  });

  it('a stopped comparison cannot be executed; changed options need a new comparison', async () => {
    sync.open();
    const done = sync.compare();
    await flush();
    sync.stop();
    expect(jobsApi.cancelled).toContain(jobsApi.started[0].id);
    finish(0, 'cancelled');
    await done;
    expect(sync.canEdit()).toBe(false);
    const again = sync.compare();
    await flush();
    finish(1, 'done', { compare: EMPTY_COMPARE_STATS });
    await again;
    expect(sync.compared()).toBe(true);
    sync.update({ content: true });
    expect(sync.compared()).toBe(false);
  });

  it('needs a folder on both sides', () => {
    expect(actions.state('OPEN_SYNC_DIRS_DLG')).toBe('ready');
    right.clearListing();
    expect(actions.state('OPEN_SYNC_DIRS_DLG')).toBe('disabled');
    expect(actions.state('COMPARE_DIRS')).toBe('disabled');
  });
});
