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
