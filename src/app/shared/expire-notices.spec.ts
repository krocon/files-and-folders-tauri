import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expireNotices, NOTICE_MS } from './expire-notices';

describe('expireNotices', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('removes each notice a minute after it appeared, unless dismissed before', () => {
    const list = signal<readonly string[]>([]);
    TestBed.runInInjectionContext(() => expireNotices(list));
    list.set(['a']);
    TestBed.tick();
    vi.advanceTimersByTime(NOTICE_MS / 2);
    list.update((m) => [...m, 'b']);
    TestBed.tick();
    vi.advanceTimersByTime(NOTICE_MS / 2);
    expect(list()).toEqual(['b']);
    // dismissed: its timer is gone; reported again: a new minute
    list.set([]);
    TestBed.tick();
    list.set(['b']);
    TestBed.tick();
    vi.advanceTimersByTime(NOTICE_MS - 1);
    expect(list()).toEqual(['b']);
    vi.advanceTimersByTime(1);
    expect(list()).toEqual([]);
  });
});
