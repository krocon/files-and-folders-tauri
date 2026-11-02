import { computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { DirSize } from '../../core/fs/fs.models';
import { isFinished } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';

/** What a dialog shows of its live count. */
export type LiveCount =
  /** Still running (or not started yet): the totals so far (they only grow). */
  | { readonly state: 'counting'; readonly items: number; readonly bytes: number }
  /** Finished – or cancelled, then `size.cancelled` is set and the totals are a lower bound. */
  | { readonly state: 'done'; readonly size: DirSize }
  /** The count could not run or its result is lost (058): the dialog says so instead of nothing. */
  | { readonly state: 'unknown' };

const COUNTING: LiveCount = { state: 'counting', items: 0, bytes: 0 };

/**
 * Counts `paths` as the helper job `count` (Rust `dirsize::count_paths`) while a
 * dialog is open: starts at once, the progress grows about every 100 ms, the
 * job is cancelled when the dialog closes – also when it closes before the job
 * started. `null` only without paths; otherwise the line is there from the start
 * ("counting…") and never disappears (058): the last known value stays when the
 * helper job leaves the store, a failed start or a count without result is
 * `unknown`. Must be called in an injection context (a dialog's constructor or
 * field initializer). The dialog never waits for the count: its buttons work all
 * the time.
 */
export function liveCount(paths: readonly string[] | null): Signal<LiveCount | null> {
  const jobs = inject(JobsStore);
  const id = signal<string | null>(null);
  const failed = signal(false);
  // `find`: the count is a helper job that Rust removes right after its end
  const job = computed(() => {
    const i = id();
    return i === null ? undefined : jobs.find(i);
  });
  let destroyed = false;
  const counting = !!paths && paths.length > 0;
  if (counting) {
    jobs
      .start({ kind: 'count', paths: [...paths] })
      .then((started) => {
        if (destroyed) {
          void jobs.cancel(started); // the dialog closed before the count started
        } else {
          id.set(started);
        }
      })
      .catch(() => failed.set(true));
  }
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    const j = job();
    if (j && !isFinished(j.state)) {
      void jobs.cancel(j.id);
    }
  });
  // the last value seen, so a job that leaves the store keeps its result on screen
  let last: LiveCount = COUNTING;
  let seen = false;
  return computed(() => {
    if (!counting) {
      return null;
    }
    if (failed()) {
      return { state: 'unknown' };
    }
    const j = job();
    if (!j) {
      // not started yet / the id overtook the job's events: still counting; gone after it
      // was seen: what it showed last (a lost result is unknown, not "counting" forever)
      return seen && last.state === 'counting' ? { state: 'unknown' } : last;
    }
    seen = true;
    const size = j.summary?.dirSize;
    if (size) {
      last = { state: 'done', size };
    } else if (isFinished(j.state)) {
      last = { state: 'unknown' };
    } else {
      last = { state: 'counting', items: j.progress.itemsDone, bytes: j.progress.bytesDone };
    }
    return last;
  });
}
