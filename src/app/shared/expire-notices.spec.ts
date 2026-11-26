import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expireNotices, NOTICE_MAX_MS, NOTICE_MIN_MS, noticeMs } from './expire-notices';

describe('expireNotices', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gives a notice seconds, not a minute – and a long text more of them', () => {
    expect(noticeMs('')).toBe(NOTICE_MIN_MS);
    expect(noticeMs('Download of 1 URL started.')).toBe(NOTICE_MIN_MS);
    const error = 'Download failed: the server did not answer (connection timed out after 30 s).';
    expect(noticeMs(error)).toBeGreaterThan(NOTICE_MIN_MS);
    expect(noticeMs(error)).toBeLessThan(NOTICE_MAX_MS);
    expect(noticeMs('x'.repeat(5000))).toBe(NOTICE_MAX_MS);
    expect(NOTICE_MAX_MS).toBeLessThanOrEqual(20_000);
  });

  it('removes each notice some seconds after it appeared, unless dismissed before', () => {
    const list = signal<readonly string[]>([]);
    TestBed.runInInjectionContext(() => expireNotices(list));
    const ms = noticeMs('a');
    expect(noticeMs('b')).toBe(ms);
    list.set(['a']);
    TestBed.tick();
    vi.advanceTimersByTime(ms / 2);
    list.update((m) => [...m, 'b']);
    TestBed.tick();
    vi.advanceTimersByTime(ms / 2);
    expect(list()).toEqual(['b']);
    // dismissed: its timer is gone; reported again: its time starts anew
    list.set([]);
    TestBed.tick();
    list.set(['b']);
    TestBed.tick();
    vi.advanceTimersByTime(ms - 1);
    expect(list()).toEqual(['b']);
    vi.advanceTimersByTime(1);
    expect(list()).toEqual([]);
  });

  it('a long notice outlives a short one reported at the same time', () => {
    const list = signal<readonly string[]>([]);
    TestBed.runInInjectionContext(() => expireNotices(list));
    const long = 'x'.repeat(200);
    list.set(['short', long]);
    TestBed.tick();
    vi.advanceTimersByTime(noticeMs('short'));
    expect(list()).toEqual([long]);
    vi.advanceTimersByTime(noticeMs(long) - noticeMs('short'));
    expect(list()).toEqual([]);
  });
});
