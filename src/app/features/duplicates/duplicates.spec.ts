import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { DuplicatesApi } from '../../core/duplicates/duplicates-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobSpec } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { EMPTY_STATS, SearchHit } from '../../core/search/search.models';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeDuplicatesApi } from '../../../testing/fake-duplicates-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { registerArchiveActions } from '../archive/archive-actions';
import { ArchiveStore } from '../archive/archive.store';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { registerOpsActions } from '../ops/ops-actions';
import { OpsStore } from '../ops/ops.store';
import { SearchStore } from '../search/search.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { lastSetId, readRule, readSet, toFile, userSets, withUserSet } from './duplicates-presets';
import { DuplicatesStore } from './duplicates.store';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function hit(path: string, group: number, more: Partial<SearchHit> = {}): SearchHit {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return {
    ...entry(name, { path, size: 100, modifiedMs: 10 }),
    dir: path.slice(0, path.lastIndexOf('/')),
    relDir: '',
    parentNames: ['', '', ''],
    group,
    ...more,
  } as SearchHit;
}

const ROWS: SearchHit[] = [
  hit('/h/Archiv/a.jpg', 1, { modifiedMs: 1, order: 2 }),
  hit('/h/Downloads/a.jpg', 1, { modifiedMs: 3, order: 0 }),
  hit('/h/Bilder/Kopie von a.jpg', 1, { modifiedMs: 2, order: 1 }),
  hit('/h/x/orig.bin', 2, { links: 2, order: 3 }),
  hit('/h/x/hard.bin', 2, { links: 2, sameAs: '/h/x/orig.bin', order: 4 }),
  hit('/h/y/copy.bin', 2, { modifiedMs: 1, order: 5 }),
  hit('/h/t/one', 3, { modifiedMs: 7 }),
  hit('/h/t/two', 3, { modifiedMs: 7 }),
];

describe('duplicates in the frontend (design 042)', () => {
  let jobsApi: FakeJobsApi;
  let dupApi: FakeDuplicatesApi;
  let ws: WorkspaceStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  let dup: DuplicatesStore;
  let search: SearchStore;
  let actions: ActionService;
  let ops: OpsStore;
  let key: string;

  /** A list controller over `rows` in this order (displayed order of the table). */
  function controller(
    store: FileBrowserStore,
    rows: () => readonly SearchHit[],
  ): FileListController {
    return {
      displayedEntries: () => rows(),
      cursorEntry: () => rows().find((r) => r.path === store.cursorPath()),
      moveCursorTo: (p: string) => {
        store.setCursor(p);
        return true;
      },
    } as unknown as FileListController;
  }

  /** Runs a duplicate search on the left that finds `rows`. */
  async function searchFinds(rows: SearchHit[], mode: 'exact' | 'similarImages' = 'exact') {
    dup.open();
    dup.update({ mode });
    await dup.run();
    const started = jobsApi.started.at(-1)!;
    key = ws.activeTab('left').search!.key;
    jobsApi.emit({
      type: 'searchHits',
      id: started.id,
      hits: rows,
      stats: { ...EMPTY_STATS, hits: rows.length },
    });
    jobsApi.emit({
      type: 'finished',
      id: started.id,
      state: 'done',
      summary: {
        itemsDone: rows.length,
        itemsSkipped: 0,
        itemsFailed: 0,
        bytesDone: 0,
        errors: [],
        error: null,
        dirSize: null,
      },
    });
    await wait();
    const r = search.result(key)!;
    left.dupNav = dup.navigator('left');
    left.showSearch(key, r.hits, 'duplicates');
    await wait();
    await wait();
    return started.spec;
  }

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    dupApi = new FakeDuplicatesApi();
    const fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/h',
        parent: '/',
        segments: [{ name: '/', path: '/' }],
        entries: [],
        unreadableEntries: 0,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: jobsApi },
        { provide: FsApi, useValue: fsApi },
        { provide: DuplicatesApi, useValue: dupApi },
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
    const rows = () => search.result(key)?.hits ?? [];
    ws.registerPanel('left', { store: left, controller: () => controller(left, rows) });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    dup = TestBed.inject(DuplicatesStore);
    search = TestBed.inject(SearchStore);
    actions = TestBed.inject(ActionService);
    ops = TestBed.inject(OpsStore);
    registerOpsActions(actions, ops);
    registerArchiveActions(actions, TestBed.inject(ArchiveStore), dup);
    await left.load('/h');
    await right.load('/store');
    ws.setActive('left');
  });

  it('starts the search with mode, names and paranoid; the chosen set marks after the end', async () => {
    dup.open();
    dup.update({ names: '*.jpg', paranoid: true });
    const spec = await searchFinds(ROWS);
    expect(spec).toMatchObject({
      kind: 'duplicates',
      criteria: {
        mode: 'exact',
        name: '*.jpg',
        paranoid: true,
        threshold: null,
        compare: 'content',
      },
    });
    // default (Marc, 042 §8.2): copy names go, else the oldest stays
    expect([...left.marked()].sort()).toEqual([
      '/h/Bilder/Kopie von a.jpg',
      '/h/Downloads/a.jpg',
      '/h/y/copy.bin',
    ]);
    // the hard link and its file are never marked; the tie of group 3 stays unmarked
    const d = dup.decided().get(key)!;
    expect(d.undecided).toEqual([3]);
    expect(d.decisions.get('/h/x/orig.bin')?.decision).toBe('keep');
    expect(d.decisions.get('/h/x/hard.bin')?.decision).toBe('same');
    // the reason is the rule that finally decided (the copy name went first, then the age)
    expect(dup.reasonLabel(key, d.decisions.get('/h/Archiv/a.jpg')!.reason)).toBe('oldest');
    expect(dup.reasonLabel(key, d.decisions.get('/h/y/copy.bin')!.reason)).toBe('has hard links');
  });

  it('similar images: threshold in the criteria, resolution set by default', async () => {
    dup.open();
    dup.update({ threshold: 5, sameName: true });
    const spec = (await searchFinds(ROWS, 'similarImages')) as Extract<
      JobSpec,
      { kind: 'duplicates' }
    >;
    expect(spec.criteria).toMatchObject({
      mode: 'similarImages',
      threshold: 5,
      sameName: false,
      paranoid: false,
    });
    expect(dup.decided().get(key)?.id).toBe('b:resolution');
  });

  it('applies a set with "in folder" through Rust and keeps the user\'s choice', async () => {
    await searchFinds(ROWS);
    dup.userSets.set(
      withUserSet([], 'Archiv zuerst', {
        rules: [{ kind: 'inFolder', folder: '/h/Archiv', prefer: 'keep' }, { kind: 'newest' }],
      }),
    );
    await dup.apply('left', 'u:Archiv zuerst');
    expect(dupApi.classifyCalls).toBe(1);
    expect(left.marked().has('/h/Archiv/a.jpg')).toBe(false);
    expect(left.marked().has('/h/Downloads/a.jpg')).toBe(true);
    expect(dup.chosen()).toBe('u:Archiv zuerst');
    expect(lastSetId(dupApi.saved)).toBe('u:Archiv zuerst');
    // an invalid regex marks nothing and says why
    dup.userSets.set(
      withUserSet([], 'kaputt', {
        rules: [{ kind: 'pathPattern', pattern: '(', syntax: 'regex' }],
      }),
    );
    await dup.apply('left', 'u:kaputt');
    expect(dup.ruleError().get(key)).toContain('Rule 1');
  });

  it('Enter keeps the file under the cursor; hard links cannot be marked', async () => {
    await searchFinds(ROWS);
    await left.open(ROWS[1]); // Enter on /h/Downloads/a.jpg
    expect(left.marked().has('/h/Downloads/a.jpg')).toBe(false);
    expect(left.marked().has('/h/Archiv/a.jpg')).toBe(true);
    expect(left.marked().has('/h/Bilder/Kopie von a.jpg')).toBe(true);
    left.toggleMark('/h/x/hard.bin');
    left.setMarked(['/h/x/orig.bin'], true);
    expect(left.isMarked('/h/x/hard.bin') || left.isMarked('/h/x/orig.bin')).toBe(false);
    expect(left.isUnmarkable('/h/x/hard.bin')).toBe(true);
  });

  it('Alt+↓/↑ move to the next/previous group', async () => {
    await searchFinds(ROWS);
    left.setCursor('/h/Downloads/a.jpg');
    await actions.run('DUP_NEXT_GROUP');
    expect(left.cursorPath()).toBe('/h/x/orig.bin');
    await actions.run('DUP_NEXT_GROUP');
    expect(left.cursorPath()).toBe('/h/t/one');
    await actions.run('DUP_NEXT_GROUP'); // stays at the last group
    expect(left.cursorPath()).toBe('/h/t/one');
    await actions.run('DUP_PREV_GROUP');
    expect(left.cursorPath()).toBe('/h/x/orig.bin');
  });

  it('F8 opens the confirmation; the job checks the bytes; removed copies leave the result', async () => {
    await searchFinds(ROWS);
    await actions.run('OPEN_DELETE_DLG');
    expect(TestBed.inject(DialogService).open()).toBe('dedupe');
    const r = dup.dedupe()!;
    expect(r.plan.files).toBe(3);
    expect(r.plan.bytes).toBe(300);
    expect(r.undecided).toBe(1);
    expect(r.target).toBe('/store');
    await dup.runDedupe();
    const job = jobsApi.started.at(-1)!;
    expect(job.spec).toMatchObject({ kind: 'dedupe', action: 'trash', verify: 'content' });
    const spec = job.spec as Extract<JobSpec, { kind: 'dedupe' }>;
    expect(spec.groups[0].keep).toEqual({
      path: '/h/Archiv/a.jpg',
      kind: 'file',
      size: 100,
      modifiedMs: 1,
    });
    expect(spec.groups.flatMap((g) => g.remove.map((x) => x.path)).sort()).toEqual([
      '/h/Bilder/Kopie von a.jpg',
      '/h/Downloads/a.jpg',
      '/h/y/copy.bin',
    ]);
    jobsApi.emit({
      type: 'finished',
      id: job.id,
      state: 'doneWithErrors',
      summary: {
        itemsDone: 2,
        itemsSkipped: 0,
        itemsFailed: 1,
        bytesDone: 200,
        errors: [
          {
            path: '/h/y/copy.bin',
            error: { code: 'duplicate_changed', message: 'changed', path: '/h/y/copy.bin' },
          },
        ],
        error: null,
        dirSize: null,
      },
    });
    await wait();
    const left2 = search.result(key)!.hits.map((h) => h.path);
    expect(left2).not.toContain('/h/Downloads/a.jpg');
    expect(left2).toContain('/h/y/copy.bin');
  });

  it('permanent asks twice; move needs the other folder', async () => {
    await searchFinds(ROWS);
    dup.openDedupe('permanent');
    await dup.runDedupe();
    expect(dup.dedupe()?.confirmStep).toBe(true);
    expect(jobsApi.started.at(-1)!.spec.kind).toBe('duplicates');
    await dup.runDedupe();
    expect(jobsApi.started.at(-1)!.spec).toMatchObject({ kind: 'dedupe', action: 'permanent' });
    dup.openDedupe('trash');
    dup.updateDedupe({ action: 'move' });
    await dup.runDedupe();
    expect(jobsApi.started.at(-1)!.spec).toMatchObject({
      kind: 'dedupe',
      action: 'move',
      targetDir: '/store',
    });
  });

  it('nothing marked: F8 only explains', async () => {
    await searchFinds(ROWS);
    left.clearMarks();
    const reports: string[] = [];
    const jobs = TestBed.inject(JobsStore);
    const orig = jobs.report.bind(jobs);
    jobs.report = (t: string) => {
      reports.push(t);
      orig(t);
    };
    expect(dup.openDedupe('trash')).toBe(true);
    expect(dup.dedupe()).toBeNull();
    expect(reports.at(-1)).toContain('No copies are marked');
  });

  it('the rule editor saves, applies and deletes sets', async () => {
    await searchFinds(ROWS);
    dup.openRules('left');
    await wait();
    expect(TestBed.inject(DialogService).open()).toBe('duplicate-rules');
    dup.updateRules({
      rules: [
        { kind: 'pathPattern', pattern: '/Downloads/', prefer: 'delete' },
        { kind: 'oldest' },
      ],
    });
    expect(dup.previewRules(dup.rules()!.set, 'left')).toEqual({ decided: 2, undecided: 1 });
    dup.setRulesName('Downloads weg');
    await dup.applyRules();
    expect(userSets(dupApi.saved).map((u) => u.name)).toEqual(['Downloads weg']);
    expect(dup.decided().get(key)?.id).toBe('u:Downloads weg');
    expect(left.marked().has('/h/Downloads/a.jpg')).toBe(true);
    dup.openRules('left');
    await wait();
    dup.deleteUserSet('Downloads weg');
    expect(userSets(dupApi.saved)).toEqual([]);
  });
  it('renders the search dialog, the confirmation with pictures and the group view', async () => {
    const { DuplicatesDialog } = await import('./duplicates-dialog');
    const { DedupeDialog } = await import('./dedupe-dialog');
    const { DuplicateGroupView } = await import('./duplicate-group-view');
    const { DuplicateRulesDialog } = await import('./duplicate-rules-dialog');
    // the search dialog: similar images show the similarity slider, not the paranoid box
    dup.open();
    dup.update({ mode: 'similarImages' });
    const f = TestBed.createComponent(DuplicatesDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('input[type=range]')).not.toBeNull();
    expect(el.textContent).toContain('HEIC and AVIF are not supported');
    expect(el.querySelector('select option[value=none]')?.textContent).toContain('no rules');
    dup.close();
    await searchFinds(
      ROWS.map((r) =>
        r.group === 1
          ? { ...r, path: r.path.replace('.jpg', '.png'), name: r.name.replace('.jpg', '.png') }
          : r,
      ),
    );
    // the confirmation: names (from the rows), pictures of the page
    dup.openDedupe('trash');
    const d = TestBed.createComponent(DedupeDialog);
    d.detectChanges();
    await wait();
    d.detectChanges();
    const del = d.nativeElement as HTMLElement;
    expect(del.textContent).toContain('3 copies from 2 groups');
    expect(del.textContent).toContain('Kopie von a.png');
    expect(del.querySelector('img')?.getAttribute('src')).toMatch(/^url:thumb:/);
    expect(del.textContent).toContain('compared byte by byte');
    dup.closeDedupe();
    // the group view of the cursor's group
    left.setCursor('/h/Archiv/a.png');
    const g = TestBed.createComponent(DuplicateGroupView);
    g.componentRef.setInput('side', 'left');
    g.detectChanges();
    await wait();
    g.detectChanges();
    const gv = g.nativeElement as HTMLElement;
    expect(gv.textContent).toContain('Group 1 of 3');
    expect(gv.querySelectorAll('.tile')).toHaveLength(3);
    expect(gv.querySelector('.tile.cursor .badge')?.textContent).toContain('keep');
    (gv.querySelectorAll('.tile .pic')[1] as HTMLButtonElement).click();
    expect(left.cursorPath()).toBe('/h/Downloads/a.png');
    // the rule editor lists the rules of the set in use
    dup.openRules('left');
    await wait();
    const r = TestBed.createComponent(DuplicateRulesDialog);
    r.detectChanges();
    expect((r.nativeElement as HTMLElement).querySelectorAll('li.rule').length).toBe(3);
  });
});

describe('duplicate rule sets in a file (design 042 E2)', () => {
  it('reads only known rules and fields', () => {
    expect(readRule({ kind: 'nope' })).toBeNull();
    expect(readRule({ kind: 'oldest', pattern: 'x' })).toEqual({ kind: 'oldest' });
    expect(readRule({ kind: 'pathPattern', pattern: 5, syntax: 'perl', prefer: 'maybe' })).toEqual({
      kind: 'pathPattern',
      pattern: '',
      syntax: 'glob',
      caseSensitive: false,
      prefer: 'keep',
    });
    expect(readSet({ rules: 'x' })).toBeNull();
    expect(readSet({ rules: Array(20).fill({ kind: 'newest' }) })?.rules).toHaveLength(12);
  });

  it('round-trips through the presets shape', () => {
    const users = withUserSet([], ' B ', { rules: [{ kind: 'newest' }] });
    const file = toFile(withUserSet(users, 'A', { rules: [{ kind: 'oldest' }] }), 'u:B');
    expect(file.presets.map((p) => p.name)).toEqual(['A', 'B']);
    expect(userSets(file).map((u) => u.set.rules[0].kind)).toEqual(['oldest', 'newest']);
    expect(lastSetId(file)).toBe('u:B');
    expect(lastSetId({ ...file, last: { id: 'b:nope' } })).toBeNull();
    expect(lastSetId({ ...file, last: null })).toBeNull();
  });
});
