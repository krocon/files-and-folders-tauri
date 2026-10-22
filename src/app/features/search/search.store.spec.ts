import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { EMPTY_STATS, SearchCriteria, SearchHit } from '../../core/search/search.models';
import { SessionApi } from '../../core/session/session-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { registerOpsActions } from '../ops/ops-actions';
import { OpsStore } from '../ops/ops.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { DEFAULT_FORM } from './find-form';
import { FindStore } from './find.store';
import { FolderFinderStore } from './folder-finder.store';
import { registerSearchActions } from './search-actions';
import { SEARCH_TEXTS } from './search-texts';
import { MAX_TEMPLATES, PUBLISH_MS, restoreTemplates, SearchStore } from './search.store';
import { SettingsStore } from '../../core/settings/settings.store';

const CRITERIA: SearchCriteria = {
  roots: ['/r'],
  name: '*.mp3',
  nameMode: 'glob',
  caseSensitive: false,
  wholeName: true,
  kinds: { files: true, dirs: true, links: true },
  includeHidden: false,
  followLinks: false,
  excludes: [],
};

const SUMMARY: Summary = {
  itemsDone: 0,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const hit = (name: string, folder = '/r/a'): SearchHit => ({
  ...entry(name, { path: `${folder}/${name}` }),
  dir: folder,
  relDir: '',
  parentNames: ['', '', ''],
});

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('SearchStore and result tabs (design 009)', () => {
  let jobsApi: FakeJobsApi;
  let search: SearchStore;
  let ws: WorkspaceStore;
  let left: FileBrowserStore;

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    const fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) =>
      Promise.resolve({
        path: path ?? '/r',
        parent: '/',
        segments: [{ name: 'r', path: path ?? '/r' }],
        entries: [dir('a', { path: '/r/a' })],
        unreadableEntries: 0,
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: jobsApi },
        { provide: FsApi, useValue: fsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    await TestBed.inject(JobsStore).init();
    search = TestBed.inject(SearchStore);
    ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
  });

  const hits = (id: string, list: SearchHit[], n = list.length) =>
    jobsApi.emit({ type: 'searchHits', id, hits: list, stats: { ...EMPTY_STATS, hits: n } });

  const finish = (
    id: string,
    state: 'done' | 'cancelled' | 'failed' | 'doneWithErrors' = 'done',
    s: Partial<Summary> = {},
  ) => jobsApi.emit({ type: 'finished', id, state, summary: { ...SUMMARY, ...s } });

  it('starts a search job and opens a result tab after the active one', async () => {
    expect(await search.search(CRITERIA, 'left', null, DEFAULT_FORM)).toBeNull();
    expect(jobsApi.started[0].spec).toEqual({ kind: 'search', criteria: CRITERIA });
    const tab = ws.activeTab('left');
    expect(tab.search?.label).toBe('*.mp3');
    expect(ws.panels().left.tabs).toHaveLength(2);
    const r = search.result(tab.search!.key)!;
    expect(r.running).toBe(true);
    expect(r.form).toBe(DEFAULT_FORM);
    expect(search.recent()).toEqual([DEFAULT_FORM]);
  });

  it('remembered forms over the size limit: the oldest go, the new one stays (review 015 #7)', async () => {
    const big = (i: number) => ({ ...DEFAULT_FORM, name: `${i}${'x'.repeat(9_000)}` });
    for (let i = 0; i < 9; i++) {
      await search.search(CRITERIA, 'left', null, big(i));
    }
    const recent = search.recent();
    expect(recent[0]).toEqual(big(8));
    expect(recent.length).toBeGreaterThan(1);
    expect(recent.length).toBeLessThan(9);
  });

  it('own templates are kept in the settings, replaced by name and deleted (design 022 E8)', () => {
    const settings = TestBed.inject(SettingsStore);
    const form = { ...DEFAULT_FORM, name: '*.cbz' };
    expect(search.saveTemplate('  Comics ', form)).toBe(true);
    expect(search.saveTemplate('', form)).toBe(false);
    expect(settings.get('search.templates')).toEqual([{ label: 'Comics', form }]);
    const other = { ...form, name: '*.cbr' };
    expect(search.saveTemplate('Comics', other)).toBe(true);
    expect(search.templates()).toEqual([{ label: 'Comics', form: other }]);
    for (let i = 1; i < MAX_TEMPLATES; i++) {
      search.saveTemplate(`t${i}`, form);
    }
    expect(search.templates()).toHaveLength(MAX_TEMPLATES);
    expect(search.saveTemplate('one too many', form)).toBe(false);
    search.deleteTemplate('Comics');
    expect(search.templates().some((t) => t.label === 'Comics')).toBe(false);
  });

  it('restores templates from the settings: label and form checked, first of a name wins', () => {
    expect(
      restoreTemplates([
        { label: 'a', form: { name: '*.x' } },
        { label: 'a', form: {} },
        { label: ' ', form: {} },
        { label: 'b', form: 'nope' },
        'junk',
        null,
      ]),
    ).toEqual([{ label: 'a', form: { ...DEFAULT_FORM, name: '*.x' } }]);
  });

  it('a refused start opens nothing and returns the error', async () => {
    jobsApi.refuse = { code: 'invalid_pattern', message: 'bad (', path: null };
    const err = await search.search(CRITERIA, 'left');
    expect(err?.code).toBe('invalid_pattern');
    expect(ws.panels().left.tabs).toHaveLength(1);
    expect(search.results().size).toBe(0);
  });

  it('collects hits: the first at once, then throttled; foreign job ids are dropped', async () => {
    await search.search(CRITERIA, 'left');
    const key = ws.activeTab('left').search!.key;
    const id = jobsApi.started[0].id;
    hits(id, [hit('1.mp3')]);
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['1.mp3']);
    hits(id, [hit('2.mp3'), hit('3.mp3')], 3);
    hits('j999', [hit('foreign.mp3')]);
    expect(search.result(key)!.hits).toHaveLength(1);
    await wait(PUBLISH_MS + 50);
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['1.mp3', '2.mp3', '3.mp3']);
    hits(id, [hit('4.mp3')], 4);
    finish(id, 'doneWithErrors', {
      itemsFailed: 1,
      errors: [{ path: '/r/x', error: { code: 'permission_denied', message: 'no', path: '/r/x' } }],
      search: { ...EMPTY_STATS, hits: 4, unreadable: 1 },
    });
    await wait();
    const r = search.result(key)!;
    expect(r.running).toBe(false);
    expect(r.hits).toHaveLength(4);
    expect(r.stats.unreadable).toBe(1);
    expect(r.unreadable[0].path).toBe('/r/x');
  });

  it('search again cancels the old job and ignores its hits', async () => {
    await search.search(CRITERIA, 'left');
    const key = ws.activeTab('left').search!.key;
    const old = jobsApi.started[0].id;
    hits(old, [hit('old.mp3')]);
    await search.rerun(key);
    expect(jobsApi.cancelled).toContain(old);
    const fresh = jobsApi.started[1].id;
    hits(old, [hit('late.mp3')]);
    finish(old, 'cancelled');
    hits(fresh, [hit('new.mp3')]);
    await wait();
    const r = search.result(key)!;
    expect(r.hits.map((h) => h.name)).toEqual(['new.mp3']);
    expect(r.running).toBe(true);
  });

  it('Stop while the job is being started cancels it as soon as it has an id', async () => {
    await search.search(CRITERIA, 'left');
    const key = ws.activeTab('left').search!.key;
    const again = search.rerun(key);
    search.stop(key);
    await again;
    expect(jobsApi.cancelled).toContain(jobsApi.started[1].id);
  });

  it('closing the result tab releases the result and cancels its job', async () => {
    await search.search(CRITERIA, 'left');
    const id = jobsApi.started[0].id;
    ws.closeTab('left');
    TestBed.tick();
    expect(search.results().size).toBe(0);
    expect(jobsApi.cancelled).toContain(id);
  });

  it('removePaths drops deleted or moved hits', async () => {
    await search.search(CRITERIA, 'left');
    const key = ws.activeTab('left').search!.key;
    const id = jobsApi.started[0].id;
    hits(id, [hit('1.mp3'), hit('2.mp3')]);
    finish(id);
    await wait();
    search.removePaths(key, ['/r/a/1.mp3']);
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['2.mp3']);
  });

  it('result tabs are not saved: they become a tab of their first folder', async () => {
    await search.search(CRITERIA, 'left');
    const saved = ws.snapshot().panels.left.tabs[1];
    expect('search' in saved).toBe(false);
    expect(saved.path).toBe('/r');
    expect(saved.title).toBe('');
  });

  it('a saved result tab keeps the title of the folder it was started in (E2E 018: tab showed "…")', async () => {
    ws.updateTab(ws.activeTab('left').id, { path: '/r', title: 'r' });
    await search.search(CRITERIA, 'left');
    const saved = ws.snapshot().panels.left.tabs[1];
    expect(saved.path).toBe('/r');
    expect(saved.title).toBe('r');
  });

  it('a panel in result mode has no folder; Enter on a folder opens it in a new tab', async () => {
    const opened: [string, string | null][] = [];
    left.openInNewTab = (p, c) => opened.push([p, c]);
    const list = [
      hit('1.mp3'),
      {
        ...dir('sub', { path: '/r/a/sub' }),
        dir: '/r/a',
        relDir: '',
        parentNames: ['a', 'r', ''] as const,
      },
    ];
    left.showSearch('s9', list);
    expect(left.path()).toBeNull();
    expect(left.locationKey()).toBe('search:s9');
    expect(left.parent()).toBeNull();
    left.toggleMark('/r/a/1.mp3');
    left.showSearch('s9', list.slice(0, 1)); // the same result grew/shrank: marks stay
    expect(left.isMarked('/r/a/1.mp3')).toBe(true);
    await left.open(list[1]);
    expect(opened).toEqual([['/r/a/sub', null]]);
    left.showSearch('s10', list);
    expect(left.marked().size).toBe(0);
    await left.load('/r');
    expect(left.searchKey()).toBeNull();
    expect(left.path()).toBe('/r');
  });

  it('actions: find needs a folder, go to file opens the folder of the hit with the cursor on it', async () => {
    const actions = TestBed.inject(ActionService);
    registerSearchActions(
      actions,
      ws,
      TestBed.inject(FindStore),
      search,
      TestBed.inject(FolderFinderStore),
    );
    expect(actions.state('OPEN_FIND_DLG')).toBe('disabled');
    await left.load('/r');
    expect(actions.state('OPEN_FIND_DLG')).toBe('ready');
    expect(actions.state('OPEN_FOLDER_FINDER_DLG')).toBe('ready');
    expect(actions.state('GOTO_FILE')).toBe('disabled');
    await search.search(CRITERIA, 'left');
    left.showSearch(ws.activeTab('left').search!.key, [hit('1.mp3')]);
    left.setCursor('/r/a/1.mp3');
    expect(actions.state('GOTO_FILE')).toBe('ready');
    expect(actions.state('RERUN_SEARCH')).toBe('ready');
    await actions.run('GOTO_FILE');
    const tab = ws.activeTab('left');
    expect(tab.path).toBe('/r/a');
    expect(tab.cursor).toBe('/r/a/1.mp3');
    expect(tab.search).toBeUndefined();
  });

  it('delete and copy from a result tab: jobs with the hits; deleted hits leave the result', async () => {
    const ops = TestBed.inject(OpsStore);
    const actions = TestBed.inject(ActionService);
    registerOpsActions(actions, ops);
    await search.search(CRITERIA, 'left');
    const key = ws.activeTab('left').search!.key;
    const id = jobsApi.started[0].id;
    hits(id, [hit('1.mp3'), hit('2.mp3', '/r/b')]);
    finish(id);
    await wait();
    left.showSearch(key, search.result(key)!.hits);
    left.markAll(['/r/a/1.mp3', '/r/b/2.mp3']);
    expect(actions.state('OPEN_COPY_DLG')).toBe('ready');
    expect(actions.state('OPEN_DELETE_DLG')).toBe('ready');
    expect(actions.state('OPEN_MKDIR_DLG')).toBe('disabled');
    await ops.openCopyMove('copy');
    expect(ops.copyMove()!.sources.map((e) => e.path)).toEqual(['/r/a/1.mp3', '/r/b/2.mp3']);
    ops.close();
    left.setMarked(['/r/b/2.mp3'], false);
    await ops.openDelete('trash');
    expect(await ops.runDelete(ops.del()!, false)).toBeNull();
    const del = jobsApi.started.at(-1)!;
    expect(del.spec).toEqual({
      kind: 'delete',
      paths: ['/r/a/1.mp3'],
      mode: 'trash',
      allowDangerous: false,
    });
    finish(del.id, 'done', { itemsDone: 1 });
    await wait();
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['2.mp3']);
    expect(left.isMarked('/r/a/1.mp3')).toBe(false);
  });

  it('review 009 #1: hits (and the end) that overtake the job id reach the result', async () => {
    jobsApi.beforeResolve = (id, spec) => {
      if (spec.kind === 'search') {
        hits(id, [hit('early.mp3')]);
      }
    };
    await search.search(CRITERIA, 'left');
    const key = ws.activeTab('left').search!.key;
    await wait(PUBLISH_MS + 50);
    expect(search.result(key)!.hits.map((h) => h.name)).toEqual(['early.mp3']);
    // a tiny search: hits and end before `start` resolved
    jobsApi.beforeResolve = (id) => {
      hits(id, [hit('a.mp3'), hit('b.mp3')]);
      finish(id, 'done', { search: { ...EMPTY_STATS, hits: 2 } });
    };
    await search.rerun(key);
    jobsApi.beforeResolve = null;
    await wait();
    const r = search.result(key)!;
    expect(r.running).toBe(false);
    expect(r.hits.map((h) => h.name)).toEqual(['a.mp3', 'b.mp3']);
  });

  it('review 009 #2: a refused new search keeps the old one (no endless "running")', async () => {
    await search.search(CRITERIA, 'left');
    const tab = ws.activeTab('left');
    const key = tab.search!.key;
    const old = jobsApi.started[0].id;
    jobsApi.refuse = { code: 'invalid_pattern', message: 'bad (', path: null };
    const err = await search.search(
      { ...CRITERIA, name: '(' },
      'left',
      { tabId: tab.id, key },
      DEFAULT_FORM,
    );
    expect(err?.code).toBe('invalid_pattern');
    await search.rerun(key);
    jobsApi.refuse = null;
    expect(jobsApi.cancelled).not.toContain(old);
    hits(old, [hit('1.mp3')]);
    finish(old);
    await wait();
    const r = search.result(key)!;
    expect(r.running).toBe(false);
    expect(r.hits.map((h) => h.name)).toEqual(['1.mp3']);
  });

  it('review 009 #3: navigating in a result tab turns it into a folder tab and releases the result', async () => {
    await search.search(CRITERIA, 'left');
    const tab = ws.activeTab('left');
    const key = tab.search!.key;
    ws.navigated(tab.id, '/r/a', 'a');
    TestBed.tick();
    const now = ws.activeTab('left');
    expect(now.id).toBe(tab.id);
    expect(now.search ?? null).toBeNull();
    expect([now.path, now.title]).toEqual(['/r/a', 'a']);
    expect(search.results().has(key)).toBe(false);
    expect(jobsApi.cancelled).toContain(jobsApi.started[0].id);
  });

  it('review 009 #5: removePaths drops the entries below a removed folder too', async () => {
    await search.search(CRITERIA, 'left');
    const key = ws.activeTab('left').search!.key;
    const id = jobsApi.started[0].id;
    const folder = {
      ...dir('a', { path: '/r/a' }),
      dir: '/r',
      relDir: '',
      parentNames: ['r', '', ''] as const,
    };
    hits(id, [folder, hit('1.mp3'), hit('2.mp3', '/r/a/deep'), hit('3.mp3', '/r/ab')]);
    finish(id);
    await wait();
    search.removePaths(key, ['/r/a']);
    expect(search.result(key)!.hits.map((h) => h.path)).toEqual(['/r/ab/3.mp3']);
  });

  it('review 009 #9/#11: quick depth changes keep only the newest folder search; the end is announced', async () => {
    await left.load('/r');
    const ff = TestBed.inject(FolderFinderStore);
    ff.open();
    ff.setDepth(3);
    ff.setDepth(5);
    await wait();
    const ids = jobsApi.started.filter((j) => j.spec.kind === 'search').map((j) => j.id);
    expect(ids).toHaveLength(3);
    expect(jobsApi.cancelled).toEqual(expect.arrayContaining([ids[0], ids[1]]));
    expect(jobsApi.cancelled).not.toContain(ids[2]);
    const folder = (name: string) => ({
      ...dir(name, { path: `/r/${name}` }),
      dir: '/r',
      relDir: '',
      parentNames: ['r', '', ''] as const,
    });
    hits(ids[0], [folder('old')]);
    hits(ids[2], [folder('new')]);
    await wait(250);
    expect(ff.folders().map((f) => f.name)).toEqual(['new']);
    expect(ff.announcement()).toBe('');
    finish(ids[2]);
    await wait();
    expect(ff.running()).toBe(false);
    expect(ff.announcement()).toBe(SEARCH_TEXTS.finderCount(1, 1));
    ff.close();
  });
});
