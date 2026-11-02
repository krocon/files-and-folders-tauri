import { Component, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { JobsApi } from '../../core/jobs/jobs-api';
import { EMPTY_PROGRESS, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { LiveCount, liveCount } from './live-count';

const flush = () => new Promise((r) => setTimeout(r));

const summary = (files: number, bytes: number): Summary => ({
  itemsDone: files,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: bytes,
  errors: [],
  error: null,
  dirSize: { files, dirs: 5, bytes, unreadable: 0, cancelled: false },
});

let paths: readonly string[] | null = ['/a', '/b'];

@Component({ template: '' })
class Host {
  readonly count: Signal<LiveCount | null> = liveCount(paths);
}

describe('liveCount (058)', () => {
  let api: FakeJobsApi;

  beforeEach(async () => {
    paths = ['/a', '/b'];
    api = new FakeJobsApi();
    TestBed.configureTestingModule({ providers: [{ provide: JobsApi, useValue: api }] });
    await TestBed.inject(JobsStore).init();
  });

  it('a count that ends at once and leaves the store (Rust: finished, removed) keeps its total', async () => {
    // Marc's case: five nearly empty folders – the whole job is over before `start` resolves
    api.beforeResolve = (id) => {
      api.emit({ type: 'state', id, state: 'running' });
      api.emit({ type: 'finished', id, state: 'done', summary: summary(3, 120) });
      api.emit({ type: 'removed', ids: [id] });
    };
    const host = TestBed.createComponent(Host).componentInstance;
    expect(host.count()).toEqual({ state: 'counting', items: 0, bytes: 0 });
    await flush();
    expect(host.count()).toMatchObject({ state: 'done', size: { files: 3, bytes: 120 } });
  });

  it('the line is there at once and stays when the job is removed after it was seen', async () => {
    const host = TestBed.createComponent(Host).componentInstance;
    await flush();
    const id = api.started[0].id;
    api.emit({ type: 'progress', id, progress: { ...EMPTY_PROGRESS, itemsDone: 7, bytesDone: 9 } });
    expect(host.count()).toEqual({ state: 'counting', items: 7, bytes: 9 });
    api.emit({ type: 'finished', id, state: 'done', summary: summary(7, 9) });
    expect(host.count()).toMatchObject({ state: 'done' });
    // many other helper jobs push it out of the store's memory: the result stays
    for (let i = 0; i < 70; i++) {
      const other = await TestBed.inject(JobsStore).start({ kind: 'count', paths: ['/x'] });
      api.emit({ type: 'finished', id: other, state: 'done', summary: summary(1, 1) });
      api.emit({ type: 'removed', ids: [other] });
    }
    api.emit({ type: 'removed', ids: [id] });
    expect(host.count()).toMatchObject({ state: 'done', size: { files: 7 } });
  });

  it('a failed start or a count without result says "unknown" instead of nothing', async () => {
    api.refuse = { code: 'io', message: 'x', path: null };
    let host = TestBed.createComponent(Host).componentInstance;
    await flush();
    expect(host.count()).toEqual({ state: 'unknown' });
    api.refuse = null;
    host = TestBed.createComponent(Host).componentInstance;
    await flush();
    const id = api.started.at(-1)!.id;
    api.emit({
      type: 'finished',
      id,
      state: 'failed',
      summary: { ...summary(0, 0), dirSize: null },
    });
    expect(host.count()).toEqual({ state: 'unknown' });
  });

  it('no paths: no count; closing cancels a running count', async () => {
    paths = [];
    expect(TestBed.createComponent(Host).componentInstance.count()).toBeNull();
    paths = ['/a'];
    const fixture = TestBed.createComponent(Host);
    await flush();
    fixture.destroy();
    expect(api.cancelled).toEqual([api.started.at(-1)!.id]);
  });
});
