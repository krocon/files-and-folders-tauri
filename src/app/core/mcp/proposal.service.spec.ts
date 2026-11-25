import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROPOSAL_ARM_MS, ProposalOutcome, ProposalService } from './proposal.service';

describe('ProposalService (design 071, tier 2)', () => {
  let svc: ProposalService;

  beforeEach(() => {
    vi.useFakeTimers();
    svc = TestBed.inject(ProposalService);
  });
  afterEach(() => vi.useRealTimers());

  function open(dialog: 'delete' | 'copy-move' = 'delete') {
    const seen: ProposalOutcome[] = [];
    void svc.begin({ id: 7, client: 'Claude', dialog }).then((o) => seen.push(o));
    return seen;
  }

  const press = (key: string, init: KeyboardEventInit = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));

  it('locks the confirm button for a moment after the dialog appeared', () => {
    expect(svc.locked('Claude')).toBe(true);
    open();
    expect(svc.locked('Claude')).toBe(true);
    vi.advanceTimersByTime(PROPOSAL_ARM_MS - 1);
    expect(svc.locked('Claude')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(svc.locked('Claude')).toBe(false);
    // a dialog the user opened is never locked
    expect(svc.locked(undefined)).toBe(false);
  });

  it('review #4: the lock counts from the last key, not from the appearance', () => {
    open();
    vi.advanceTimersByTime(PROPOSAL_ARM_MS - 100);
    press('Enter', { metaKey: true }); // the ⌘+Enter the user was about to press in the panel
    vi.advanceTimersByTime(200);
    expect(svc.armed()).toBe(false);
    // a key held down (auto-repeat) keeps it locked
    for (let i = 0; i < 20; i++) {
      press('Enter', { repeat: true });
      vi.advanceTimersByTime(100);
    }
    expect(svc.armed()).toBe(false);
    // holding a modifier is no typing
    press('Meta');
    vi.advanceTimersByTime(PROPOSAL_ARM_MS);
    expect(svc.armed()).toBe(true);
    // armed: this key may confirm – and the lock is back right after it
    press('Enter', { metaKey: true });
    expect(svc.armed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(svc.armed()).toBe(false);
    vi.advanceTimersByTime(PROPOSAL_ARM_MS);
    expect(svc.armed()).toBe(true);
  });

  it('watch/unwatch guard a dialog without a proposal; keys outside do nothing', () => {
    press('a');
    expect(svc.armed()).toBe(false);
    svc.watch();
    vi.advanceTimersByTime(PROPOSAL_ARM_MS);
    expect(svc.armed()).toBe(true);
    svc.release(); // no proposal open: the lock ends
    expect(svc.armed()).toBe(false);
    vi.advanceTimersByTime(PROPOSAL_ARM_MS * 2);
    expect(svc.armed()).toBe(false);
    // a proposal keeps its lock when another store closes its own dialog
    open();
    vi.advanceTimersByTime(PROPOSAL_ARM_MS);
    svc.release();
    expect(svc.armed()).toBe(true);
  });

  it('ends as confirmed with the job, once', async () => {
    const seen = open();
    svc.confirmed('delete', 'j5');
    svc.cancelled('delete'); // the store closes its dialog afterwards
    await Promise.resolve();
    expect(seen).toEqual([{ outcome: 'confirmed', jobId: 'j5' }]);
    expect(svc.current()).toBeNull();
    expect(svc.armed()).toBe(false);
  });

  it('ends as cancelled when its dialog closes – not when another one does', async () => {
    const seen = open('delete');
    svc.cancelled('multi-rename');
    svc.confirmed('copy-move', 'j1');
    await Promise.resolve();
    expect(seen).toEqual([]);
    svc.cancelled('delete');
    await Promise.resolve();
    expect(seen).toEqual([{ outcome: 'cancelled' }]);
  });

  it('a new proposal ends the old one, and the lock starts again', async () => {
    const first = open();
    vi.advanceTimersByTime(PROPOSAL_ARM_MS);
    const second = open('copy-move');
    await Promise.resolve();
    expect(first).toEqual([{ outcome: 'cancelled' }]);
    expect(svc.locked('x')).toBe(true);
    svc.abandon();
    await Promise.resolve();
    expect(second).toEqual([{ outcome: 'cancelled' }]);
    // the timer of an ended proposal never arms the next dialog
    vi.advanceTimersByTime(PROPOSAL_ARM_MS * 2);
    expect(svc.armed()).toBe(false);
  });
});
