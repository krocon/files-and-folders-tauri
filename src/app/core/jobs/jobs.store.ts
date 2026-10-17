import { computed, inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../fs/fs-error';
import { JobsApi } from './jobs-api';
import { Decision, EMPTY_PROGRESS, isFinished, JobEvent, JobInfo, JobSpec } from './jobs.models';

/**
 * All jobs of the app (root): kept in sync with the Rust job manager through
 * one event subscription; the snapshot of `subscribe` restores the state after
 * a WebView reload. Closing the job list loses nothing – the state lives here.
 */
@Injectable({ providedIn: 'root' })
export class JobsStore {
  private readonly api = inject(JobsApi);
  private readonly waiters = new Map<string, ((job: JobInfo) => void)[]>();
  private seq = 0;
  private started = false;

  /** In start order. */
  readonly jobs = signal<readonly JobInfo[]>([]);
  /** Folders whose content changed (`seq` makes repeated changes distinct). */
  readonly changedDirs = signal<{ dirs: readonly string[]; seq: number } | null>(null);
  /** Rust asks to confirm quitting while jobs run. */
  readonly quitRequest = signal<{ running: number; seq: number } | null>(null);
  /** Messages for the user (failed start, …). */
  readonly messages = signal<readonly string[]>([]);

  /** Jobs that are not finished, without folder sizes (shown on the Tasks button). */
  readonly active = computed(() =>
    this.jobs().filter((j) => !isFinished(j.state) && j.spec.kind !== 'dirSize'),
  );
  /** Jobs of the current "batch" for the Tasks button: all not cleared, except folder sizes. */
  readonly visible = computed(() => this.jobs().filter((j) => j.spec.kind !== 'dirSize'));
  /** The first job waiting for an answer (asked in order of their conflicts). */
  readonly pendingConflict = computed(
    () => this.jobs().find((j) => j.state === 'waitingForDecision' && j.conflict !== null) ?? null,
  );
  /** Conflict hidden with "Later" (`jobId:conflictId`) – not shown again automatically. */
  readonly postponed = signal<string | null>(null);
  /** The conflict the dialog should show now (not postponed). */
  readonly conflictToShow = computed(() => {
    const job = this.pendingConflict();
    return job && job.conflict && `${job.id}:${job.conflict.conflictId}` !== this.postponed()
      ? job
      : null;
  });

  /** Overall progress of the unfinished jobs, 0 … 1 (null = none). */
  readonly overallProgress = computed(() => {
    const active = this.active();
    if (active.length === 0) {
      return null;
    }
    const done = active.reduce((n, j) => n + j.progress.bytesDone, 0);
    const total = active.reduce((n, j) => n + j.progress.bytesTotal, 0);
    return total > 0 ? Math.min(1, done / total) : 0;
  });

  async init(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    try {
      const jobs = await this.api.subscribe((e) => this.apply(e));
      // events that arrived while subscribing are newer than the snapshot
      const known = new Set(this.jobs().map((j) => j.id));
      this.jobs.update((current) => [...jobs.filter((j) => !known.has(j.id)), ...current]);
    } catch (err) {
      this.report(`Jobs are not available: ${toFsError(err).message}`);
    }
  }

  /** Starts a job; rejects with an `FsError` if Rust refuses it. */
  start(spec: JobSpec): Promise<string> {
    return this.api.start(spec);
  }

  /** Resolves when the job has finished (immediately if it already has). */
  whenFinished(id: string): Promise<JobInfo> {
    const job = this.find(id);
    if (job && isFinished(job.state)) {
      return Promise.resolve(job);
    }
    return new Promise((resolve) =>
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), resolve]),
    );
  }

  find(id: string): JobInfo | undefined {
    return this.jobs().find((j) => j.id === id);
  }

  postpone(id: string | null): void {
    const job = id === null ? undefined : this.find(id);
    this.postponed.set(job?.conflict ? `${job.id}:${job.conflict.conflictId}` : null);
  }

  /** Shows a postponed question again (job list → "Answer…"). */
  reopenConflict(): void {
    this.postponed.set(null);
  }

  cancel(id: string): Promise<void> {
    return this.api.cancel(id);
  }

  pause(id: string): Promise<void> {
    return this.api.pause(id);
  }

  resume(id: string): Promise<void> {
    return this.api.resume(id);
  }

  /** Answers a conflict; the job leaves `waitingForDecision` on its own. */
  resolveConflict(
    id: string,
    conflictId: number,
    decision: Decision,
    applyToAll: boolean,
  ): Promise<void> {
    // hide the question at once (a second click must not answer again)
    this.patch(id, (j) => (j.conflict?.conflictId === conflictId ? { ...j, conflict: null } : j));
    return this.api.resolveConflict(id, conflictId, decision, applyToAll);
  }

  clearFinished(): Promise<void> {
    return this.api.clearFinished();
  }

  cancelAllAndQuit(): Promise<void> {
    return this.api.cancelAllAndQuit();
  }

  dismiss(index: number): void {
    this.messages.update((m) => m.filter((_, i) => i !== index));
  }

  report(text: string): void {
    this.messages.update((m) => (m.includes(text) ? m : [...m, text]));
  }

  /** Applies one event from Rust (public for tests). */
  apply(event: JobEvent): void {
    switch (event.type) {
      case 'added':
        this.jobs.update((jobs) =>
          jobs.some((j) => j.id === event.job.id) ? jobs : [...jobs, event.job],
        );
        break;
      case 'state':
        this.patch(event.id, (j) => ({
          ...j,
          state: event.state,
          conflict: event.state === 'waitingForDecision' ? j.conflict : null,
        }));
        break;
      case 'progress':
        this.patch(event.id, (j) => ({ ...j, progress: event.progress }));
        break;
      case 'conflict':
        this.patch(event.id, (j) => ({ ...j, conflict: event.conflict }));
        break;
      case 'itemFailed':
        break; // the summary carries the list; live errors are only counted there
      case 'dirsChanged':
        this.changedDirs.set({ dirs: event.dirs, seq: ++this.seq });
        break;
      case 'finished': {
        this.patch(event.id, (j) => ({
          ...j,
          state: event.state,
          summary: event.summary,
          conflict: null,
          progress: { ...(j.progress ?? EMPTY_PROGRESS), current: null },
        }));
        const job = this.find(event.id);
        const waiting = this.waiters.get(event.id);
        this.waiters.delete(event.id);
        if (job) {
          waiting?.forEach((w) => w(job));
        }
        break;
      }
      case 'removed': {
        const ids = new Set(event.ids);
        this.jobs.update((jobs) => jobs.filter((j) => !ids.has(j.id)));
        break;
      }
      case 'quitRequested':
        this.quitRequest.set({ running: event.running, seq: ++this.seq });
        break;
    }
  }

  private patch(id: string, fn: (j: JobInfo) => JobInfo): void {
    this.jobs.update((jobs) => jobs.map((j) => (j.id === id ? fn(j) : j)));
  }
}
