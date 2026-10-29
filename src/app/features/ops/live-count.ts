import { computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { DirSize } from '../../core/fs/fs.models';
import { isFinished } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';

/** What a dialog shows of its live count. */
export type LiveCount =
  /** Still running: the totals so far (they only grow). */
  | { readonly state: 'counting'; readonly items: number; readonly bytes: number }
  /** Finished – or cancelled, then `size.cancelled` is set and the totals are a lower bound. */
  | { readonly state: 'done'; readonly size: DirSize };

/**
 * Counts `paths` as the helper job `count` (Rust `dirsize::count_paths`) while a
 * dialog is open: starts at once, the progress grows about every 100 ms, the
 * job is cancelled when the dialog closes – also when it closes before the job
 * started. `null` = no count (no paths, not started yet, failed). Must be called
 * in an injection context (a dialog's constructor or field initializer). The
 * dialog never waits for the count: its buttons work all the time.
 */
export function liveCount(paths: readonly string[] | null): Signal<LiveCount | null> {
  const jobs = inject(JobsStore);
  const id = signal<string | null>(null);
  // `find`: the count is a helper job that Rust removes right after its end
  const job = computed(() => {
    const i = id();
    return i === null ? undefined : jobs.find(i);
  });
  let destroyed = false;
  if (paths && paths.length > 0) {
    jobs
      .start({ kind: 'count', paths: [...paths] })
      .then((started) => {
        if (destroyed) {
          void jobs.cancel(started); // the dialog closed before the count started
        } else {
          id.set(started);
        }
      })
      .catch(() => undefined);
  }
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    const j = job();
    if (j && !isFinished(j.state)) {
      void jobs.cancel(j.id);
    }
  });
  return computed(() => {
    const j = job();
    if (!j) {
      return null;
    }
    const size = j.summary?.dirSize;
    if (size) {
      return { state: 'done', size };
    }
    if (isFinished(j.state)) {
      return null;
    }
    return { state: 'counting', items: j.progress.itemsDone, bytes: j.progress.bytesDone };
  });
}
