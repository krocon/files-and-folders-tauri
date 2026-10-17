import { TestBed } from '@angular/core/testing';
import { FakeJobsApi, job } from '../../../testing/fake-jobs-api';
import { JobsApi } from './jobs-api';
import { HIT_BUFFER_GRACE_MS, JobsStore } from './jobs.store';
import { EMPTY_STATS } from '../search/search.models';
import { entry } from '../../../testing/fs-fixtures';
import { Summary } from './jobs.models';

const copy = { kind: 'copy' as const, sources: ['/a'], targetDir: '/b' };
const summary = (patch: Partial<Summary> = {}): Summary => ({
  itemsDone: 1,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 10,
  errors: [],
  error: null,
  dirSize: null,
  ...patch,
});
const conflict = (id: number) => ({
  conflictId: id,
  kind: 'exists' as const,
  source: '/a/x',
  target: '/b/x',
  sourceMeta: { size: 1, modifiedMs: 1, isDir: false },
  targetMeta: { size: 2, modifiedMs: 2, isDir: false },
  suggestedName: 'x (1)',
});

describe('JobsStore', () => {
  let api: FakeJobsApi;
  let store: JobsStore;

  beforeEach(async () => {
    api = new FakeJobsApi();
    api.snapshot = [job('j0', copy, { state: 'paused' })];
    TestBed.configureTestingModule({ providers: [{ provide: JobsApi, useValue: api }] });
    store = TestBed.inject(JobsStore);
    await store.init();
  });

  it('starts from the snapshot (state after a reload) and applies events', async () => {
    expect(store.jobs().map((j) => [j.id, j.state])).toEqual([['j0', 'paused']]);
    const id = await store.start(copy);
    api.emit({ type: 'state', id, state: 'running' });
    api.emit({
      type: 'progress',
      id,
      progress: {
        bytesDone: 5,
        bytesTotal: 20,
        itemsDone: 1,
        itemsTotal: 4,
        current: '/a/x',
        rateBps: 0,
      },
    });
    expect(store.find(id)?.state).toBe('running');
    expect(store.overallProgress()).toBe(0.25);
    expect(store.active().map((j) => j.id)).toEqual(['j0', id]);
  });

  it('resolves waiters when a job finishes and keeps the summary', async () => {
    const id = await store.start(copy);
    const done = store.whenFinished(id);
    api.emit({
      type: 'finished',
      id,
      state: 'doneWithErrors',
      summary: summary({ itemsFailed: 2 }),
    });
    const info = await done;
    expect(info.state).toBe('doneWithErrors');
    expect(info.summary?.itemsFailed).toBe(2);
    expect(await store.whenFinished(id)).toBe(info);
  });

  it('shows conflicts in order, answers once and can postpone a question', async () => {
    const id = await store.start(copy);
    api.emit({ type: 'conflict', id, conflict: conflict(1) });
    api.emit({ type: 'state', id, state: 'waitingForDecision' });
    expect(store.conflictToShow()?.id).toBe(id);
    store.postpone(id);
    expect(store.conflictToShow()).toBeNull();
    expect(store.pendingConflict()?.id).toBe(id);
    store.reopenConflict(id);
    await store.resolveConflict(id, 1, { type: 'skip' }, true);
    expect(api.answers).toEqual([
      { id, conflictId: 1, decision: { type: 'skip' }, applyToAll: true },
    ]);
    expect(store.pendingConflict()).toBeNull(); // hidden at once
    api.emit({ type: 'state', id, state: 'running' });
    expect(store.find(id)?.conflict).toBeNull();
  });

  it('publishes changed folders and quit requests, removes cleared jobs', async () => {
    api.emit({ type: 'dirsChanged', dirs: ['/b'] });
    expect(store.changedDirs()?.dirs).toEqual(['/b']);
    api.emit({ type: 'quitRequested', running: 2 });
    expect(store.quitRequest()?.running).toBe(2);
    api.emit({ type: 'removed', ids: ['j0'] });
    expect(store.jobs()).toEqual([]);
  });

  it('does not count folder sizes as tasks', async () => {
    await store.start({ kind: 'dirSize', path: '/x' });
    expect(store.visible().map((j) => j.spec.kind)).toEqual(['copy']);
  });

  it('asks the next job when one question was postponed', async () => {
    const a = await store.start(copy);
    const b = await store.start(copy);
    for (const [id, cid] of [
      [a, 1],
      [b, 2],
    ] as const) {
      api.emit({ type: 'conflict', id, conflict: conflict(cid) });
      api.emit({ type: 'state', id, state: 'waitingForDecision' });
    }
    expect(store.conflictToShow()?.id).toBe(a);
    store.postpone(a);
    expect(store.conflictToShow()?.id).toBe(b);
    store.postpone(b);
    expect(store.conflictToShow()).toBeNull();
    store.reopenConflict(b);
    expect(store.conflictToShow()?.id).toBe(b);
  });

  it('review 009 #1: search hits that arrive before the listener are buffered and replayed', async () => {
    const criteria = {
      roots: ['/r'],
      name: '',
      nameMode: 'glob' as const,
      caseSensitive: false,
      wholeName: true,
      kinds: { files: true, dirs: true, links: true },
      includeHidden: false,
      followLinks: false,
      excludes: [],
    };
    const stats = (hits: number) => ({ ...EMPTY_STATS, hits });
    const h = (name: string) => ({ ...entry(name, { path: `/r/${name}` }), dir: '/r' });
    // the hits overtake the id: Rust streams them before `start` resolved
    api.beforeResolve = (id) =>
      api.emit({ type: 'searchHits', id, hits: [h('early')], stats: stats(1) });
    const id = await store.start({ kind: 'search', criteria });
    api.beforeResolve = null;
    api.emit({ type: 'searchHits', id, hits: [h('second')], stats: stats(2) });
    const got: string[] = [];
    let last = 0;
    const off = store.onSearchHits(id, (hits, s) => {
      got.push(...hits.map((x) => x.name));
      last = s.hits;
    });
    expect(got).toEqual(['early', 'second']);
    expect(last).toBe(2);
    api.emit({ type: 'searchHits', id, hits: [h('live')], stats: stats(3) });
    expect(got).toEqual(['early', 'second', 'live']);
    off();
    // after unsubscribing nothing is kept
    api.emit({ type: 'searchHits', id, hits: [h('late')], stats: stats(4) });
    const again: string[] = [];
    store.onSearchHits(id, (hits) => again.push(...hits.map((x) => x.name)));
    expect(again).toEqual([]);
  });

  it('review 009 #1: the buffer of a job nobody listens to is dropped after its end', async () => {
    vi.useFakeTimers();
    try {
      api.emit({ type: 'searchHits', id: 'j9', hits: [], stats: { ...EMPTY_STATS, hits: 0 } });
      api.emit({ type: 'finished', id: 'j9', state: 'done', summary: summary() });
      vi.advanceTimersByTime(HIT_BUFFER_GRACE_MS + 1);
      const got: number[] = [];
      store.onSearchHits('j9', (_, s) => got.push(s.hits));
      expect(got).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('review 009 #10: a finished helper job removed by Rust still answers whenFinished and find', async () => {
    const id = await store.start({ kind: 'count', paths: ['/x'] });
    api.emit({ type: 'finished', id, state: 'done', summary: summary() });
    api.emit({ type: 'removed', ids: [id] });
    expect(store.jobs().some((j) => j.id === id)).toBe(false);
    expect(store.find(id)?.state).toBe('done');
    expect((await store.whenFinished(id)).summary?.itemsDone).toBe(1);
  });

  it('shows why a job paused itself (disk full) until it runs again', async () => {
    const id = await store.start(copy);
    const error = { code: 'disk_full' as const, message: 'No space left on device', path: '/b/x' };
    api.emit({ type: 'itemFailed', id, error: { path: '/b/x', error } });
    api.emit({ type: 'state', id, state: 'paused' });
    expect(store.find(id)?.pauseReason).toEqual(error);
    api.emit({ type: 'state', id, state: 'running' });
    expect(store.find(id)?.pauseReason).toBeNull();
  });
});

describe('JobsStore after a reload', () => {
  it('replays events that arrive while the snapshot is on its way', async () => {
    const api = new FakeJobsApi();
    api.snapshot = [job('j7', copy, { state: 'running' })];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const subscribe = api.subscribe.bind(api);
    api.subscribe = async (onEvent) => {
      const snapshot = await subscribe(onEvent);
      // the job finishes before the snapshot reaches the store
      onEvent({ type: 'finished', id: 'j7', state: 'done', summary: summary() });
      await gate;
      return snapshot;
    };
    TestBed.configureTestingModule({ providers: [{ provide: JobsApi, useValue: api }] });
    const store = TestBed.inject(JobsStore);
    const init = store.init();
    const waiter = store.whenFinished('j7');
    release();
    await init;
    expect(store.find('j7')?.state).toBe('done');
    expect((await waiter).state).toBe('done');
  });
});
