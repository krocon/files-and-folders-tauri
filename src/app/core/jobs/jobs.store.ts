import { expireNotices } from '../../shared/expire-notices';
import type { ShellChunk } from '../shell/shell.models';
import { computed, inject, Injectable, signal } from '@angular/core';
import { errorText, toFsError } from '../fs/fs-error';
import { JobsApi } from './jobs-api';
import { SearchHit, SearchStats } from '../search/search.models';
import { CompareRow, CompareStats } from '../sync/sync.models';
import {
  Decision,
  EMPTY_PROGRESS,
  isFinished,
  JobEvent,
  JobInfo,
  JobSpec,
  StartNowResult,
} from './jobs.models';
import { ACTION_TEXTS } from '../actions/action-texts';

/** Hits of a job without a listener are kept this long after its end (then dropped). */
export const HIT_BUFFER_GRACE_MS = 5_000;
/** At most this many hits are buffered per job without a listener (the search's own limit). */
const MAX_BUFFERED_HITS = 100_000;
/** Finished jobs removed by Rust (helper jobs) that `find`/`whenFinished` still know. */
const RETIRED_KEPT = 64;

interface HitBuffer {
  hits: SearchHit[];
  stats: SearchStats;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RowBuffer {
  rows: CompareRow[];
  stats: CompareStats;
}

/** At most this many comparison rows are buffered per job without a listener (Rust's limit). */
const MAX_BUFFERED_ROWS = 200_000;

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
  /** Search hits go to the listener of their job only (never into `jobs`). */
  private readonly hitListeners = new Map<
    string,
    (hits: readonly SearchHit[], stats: SearchStats) => void
  >();
  /**
   * Hits of jobs that have no listener yet (review 009 #1): Rust may stream hits
   * before `start` resolved. The listener gets them on `onSearchHits`; without
   * one they are dropped {@link HIT_BUFFER_GRACE_MS} after the job's end.
   */
  private readonly hitBuffers = new Map<string, HitBuffer>();
  /** Jobs whose listener unsubscribed: their late hits are dropped, not buffered. */
  private readonly hitsClosed = new Set<string>();
  /** Rows of folder comparisons (design 036) – same rules as the search hits. */
  private readonly rowListeners = new Map<
    string,
    (rows: readonly CompareRow[], stats: CompareStats) => void
  >();
  private readonly rowBuffers = new Map<string, RowBuffer>();
  private readonly rowsClosed = new Set<string>();
  /** In-flight dirSize starts to prevent concurrent duplicate calls. */
  private readonly startingDirSizes = new Map<string, Promise<string>>();
  /** Finished jobs Rust removed (helper jobs, review 009 #10), newest last. */
  private readonly retired = signal<readonly JobInfo[]>([]);
  /** Receivers of shell output (design 021) – the shell bar, which knows its job id. */
  private readonly shellListeners = new Set<
    (id: string, chunks: readonly ShellChunk[], dropped: number) => void
  >();
  /** Events received while the snapshot is on its way – replayed after it. */
  private buffer: JobEvent[] | null = null;

  /** In start order. */
  readonly jobs = signal<readonly JobInfo[]>([]);
  /** Folders whose content changed (`seq` makes repeated changes distinct). */
  readonly changedDirs = signal<{ dirs: readonly string[]; seq: number } | null>(null);
  /** Rust asks to confirm quitting while jobs run. */
  readonly quitRequest = signal<{ running: number; seq: number } | null>(null);
  /** Messages for the user (failed start, …). */
  readonly messages = signal<readonly string[]>([]);
  // messages go by themselves after a minute (or are dismissed before)
  private readonly expiring = expireNotices(this.messages);

  /** The newest rename job that can be undone (action UNDO_RENAME). */
  readonly lastUndoable = computed(
    () => [...this.jobs()].reverse().find((j) => j.undoAvailable) ?? null,
  );
  /** Jobs that are not finished, without helper jobs (shown on the Tasks button). */
  readonly active = computed(() =>
    this.jobs().filter((j) => !isFinished(j.state) && !isHelperJob(j)),
  );
  /**
   * Entries a running job takes away (delete, move, clean) with the job's progress
   * (0–1; `null` while it plans or for a single entry going to the trash) – the lists
   * show them as "being removed" (design 033, follow-up).
   */
  readonly removing = computed<ReadonlyMap<string, number | null>>(() => {
    const out = new Map<string, number | null>();
    for (const j of this.jobs()) {
      if (isFinished(j.state)) {
        continue;
      }
      const s = j.spec;
      const paths =
        s.kind === 'delete'
          ? s.paths
          : s.kind === 'move'
            ? s.sources
            : s.kind === 'clean'
              ? s.items.map((i) => i.path)
              : null;
      if (!paths) {
        continue;
      }
      const p = j.progress;
      const share =
        j.state === 'planning' || j.state === 'queued' || p.itemsTotal <= 1
          ? null
          : Math.min(1, p.itemsDone / p.itemsTotal);
      for (const path of paths) {
        out.set(path, share);
      }
    }
    return out;
  });
  /** Jobs of the current "batch" for the Tasks button: all not cleared, except helper jobs. */
  readonly visible = computed(() => this.jobs().filter((j) => !isHelperJob(j)));
  /** Jobs waiting for an answer, in start order. */
  readonly waitingForAnswer = computed(() =>
    this.jobs().filter((j) => j.state === 'waitingForDecision' && j.conflict !== null),
  );
  /** The first job waiting for an answer. */
  readonly pendingConflict = computed(() => this.waitingForAnswer()[0] ?? null);
  /** Questions hidden with "Later" (`jobId:conflictId`) – not shown again automatically. */
  readonly postponed = signal<ReadonlySet<string>>(new Set());
  /** The question the dialog shows now: the first one that is not postponed. */
  readonly conflictToShow = computed(() => {
    const postponed = this.postponed();
    return (
      this.waitingForAnswer().find((j) => !postponed.has(`${j.id}:${j.conflict!.conflictId}`)) ??
      null
    );
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
    this.buffer = [];
    try {
      const jobs = await this.api.subscribe((e) => this.apply(e));
      this.jobs.set(jobs);
    } catch (err) {
      this.report(ACTION_TEXTS.jobsUnavailable(errorText(toFsError(err))));
    }
    // events that arrived while subscribing are newer than the snapshot
    const pending = this.buffer ?? [];
    this.buffer = null;
    for (const e of pending) {
      this.apply(e);
    }
  }

  /** Starts a job; rejects with an `FsError` if Rust refuses it. */
  start(spec: JobSpec): Promise<string> {
    if (spec.kind === 'dirSize') {
      const existing = this.findActiveDirSize(spec.path);
      if (existing) {
        return Promise.resolve(existing.id);
      }
    }
    return this.api.start(spec);
  }

  /** Returns an active (not finished) job for `dirSize` of `path` if one is already running. */
  findActiveDirSize(path: string): JobInfo | undefined {
    return this.jobs().find(
      (j) => j.spec.kind === 'dirSize' && j.spec.path === path && !isFinished(j.state),
    );
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

  /**
   * Receives the output of every shell job (design 021 E3). Output can overtake
   * the job id (`run_shell` resolves after the job started) – the listener keeps
   * what belongs to its job.
   */
  onShellOutput(
    listener: (id: string, chunks: readonly ShellChunk[], dropped: number) => void,
  ): () => void {
    this.shellListeners.add(listener);
    return () => this.shellListeners.delete(listener);
  }

  /**
   * Receives the hits of search job `id` (design 009 E1); hits that arrived
   * before (buffered) are delivered at once. After unsubscribing, the job's
   * hits are dropped. Returns the unsubscribe function.
   */
  onSearchHits(
    id: string,
    listener: (hits: readonly SearchHit[], stats: SearchStats) => void,
  ): () => void {
    this.hitListeners.set(id, listener);
    this.hitsClosed.delete(id);
    const buffered = this.hitBuffers.get(id);
    if (buffered) {
      this.dropBuffer(id);
      listener(buffered.hits, buffered.stats);
    }
    return () => {
      if (this.hitListeners.get(id) === listener) {
        this.hitListeners.delete(id);
        this.hitsClosed.add(id);
        if (this.hitsClosed.size > RETIRED_KEPT * 16) {
          // ids of jobs that ended before the unsubscribe (oldest first)
          this.hitsClosed.delete(this.hitsClosed.values().next().value!);
        }
        this.dropBuffer(id);
      }
    };
  }

  /**
   * Receives the rows of comparison job `id` (design 036 E2); rows that arrived before
   * `start` resolved are delivered at once. After unsubscribing, late rows are dropped.
   */
  onCompareRows(
    id: string,
    listener: (rows: readonly CompareRow[], stats: CompareStats) => void,
  ): () => void {
    this.rowListeners.set(id, listener);
    this.rowsClosed.delete(id);
    const buffered = this.rowBuffers.get(id);
    if (buffered) {
      this.rowBuffers.delete(id);
      listener(buffered.rows, buffered.stats);
    }
    return () => {
      if (this.rowListeners.get(id) === listener) {
        this.rowListeners.delete(id);
        this.rowsClosed.add(id);
        if (this.rowsClosed.size > RETIRED_KEPT * 16) {
          this.rowsClosed.delete(this.rowsClosed.values().next().value!);
        }
        this.rowBuffers.delete(id);
      }
    };
  }

  private deliverRows(id: string, rows: readonly CompareRow[], stats: CompareStats): void {
    const listener = this.rowListeners.get(id);
    if (listener) {
      listener(rows, stats);
      return;
    }
    if (this.rowsClosed.has(id)) {
      return;
    }
    const b = this.rowBuffers.get(id) ?? { rows: [], stats };
    const room = MAX_BUFFERED_ROWS - b.rows.length;
    if (room > 0) {
      b.rows.push(...(rows.length > room ? rows.slice(0, room) : rows));
    }
    b.stats = stats;
    this.rowBuffers.set(id, b);
  }

  /** A job by id – also a finished one Rust has removed meanwhile (helper jobs). */
  find(id: string): JobInfo | undefined {
    return this.jobs().find((j) => j.id === id) ?? this.retired().find((j) => j.id === id);
  }

  postpone(id: string | null): void {
    const job = id === null ? undefined : this.find(id);
    if (job?.conflict) {
      this.postponed.update((p) => new Set(p).add(`${job.id}:${job.conflict!.conflictId}`));
    }
  }

  /** Shows a postponed question of a job again (job list → "Answer…"). */
  reopenConflict(id: string): void {
    this.postponed.update((p) => new Set([...p].filter((k) => !k.startsWith(`${id}:`))));
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

  /** Tasks → "Start now": a waiting job runs at once (`force` after an overlap question). */
  startNow(id: string, force = false): Promise<StartNowResult> {
    return this.api.startNow(id, force);
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
    if (this.buffer) {
      this.buffer.push(event);
      return;
    }
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
          pauseReason: event.state === 'paused' ? j.pauseReason : null,
        }));
        break;
      case 'progress':
        this.patch(event.id, (j) => ({ ...j, progress: event.progress }));
        break;
      case 'conflict':
        this.patch(event.id, (j) => ({ ...j, conflict: event.conflict }));
        break;
      case 'itemFailed':
        // the summary carries the list; only "disk full" matters live (job paused itself)
        if (event.error.error.code === 'disk_full') {
          this.patch(event.id, (j) => ({ ...j, pauseReason: event.error.error }));
        }
        break;
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
        this.expireHits(event.id);
        if (!this.rowListeners.has(event.id)) {
          // a comparison nobody listens to any more: its rows go after the grace time
          setTimeout(() => {
            if (!this.rowListeners.has(event.id)) {
              this.rowBuffers.delete(event.id);
            }
          }, HIT_BUFFER_GRACE_MS);
        }
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
        const gone = this.jobs().filter((j) => ids.has(j.id) && isFinished(j.state));
        if (gone.length > 0) {
          this.retired.update((r) => [...r, ...gone].slice(-RETIRED_KEPT));
        }
        this.jobs.update((jobs) => jobs.filter((j) => !ids.has(j.id)));
        break;
      }
      case 'undoAvailable':
        this.patch(event.id, (j) => ({ ...j, undoAvailable: event.available }));
        break;
      case 'searchHits':
        this.deliverHits(event.id, event.hits, event.stats);
        break;
      case 'compareRows':
        this.deliverRows(event.id, event.rows, event.stats);
        break;
      case 'shellOutput':
        this.shellListeners.forEach((l) => l(event.id, event.chunks, event.dropped));
        break;
      case 'quitRequested':
        this.quitRequest.set({ running: event.running, seq: ++this.seq });
        break;
    }
  }

  private deliverHits(id: string, hits: readonly SearchHit[], stats: SearchStats): void {
    const listener = this.hitListeners.get(id);
    if (listener) {
      listener(hits, stats);
      return;
    }
    if (this.hitsClosed.has(id)) {
      return;
    }
    const b = this.hitBuffers.get(id) ?? { hits: [], stats, timer: null };
    const room = MAX_BUFFERED_HITS - b.hits.length;
    if (room > 0) {
      b.hits.push(...(hits.length > room ? hits.slice(0, room) : hits));
    }
    b.stats = stats;
    this.hitBuffers.set(id, b);
  }

  /** A job ended: its buffered hits wait a little for the listener, then go. */
  private expireHits(id: string): void {
    this.hitsClosed.delete(id);
    const b = this.hitBuffers.get(id);
    if (b && b.timer === null) {
      b.timer = setTimeout(() => this.dropBuffer(id), HIT_BUFFER_GRACE_MS);
    }
  }

  private dropBuffer(id: string): void {
    const b = this.hitBuffers.get(id);
    if (b?.timer != null) {
      clearTimeout(b.timer);
    }
    this.hitBuffers.delete(id);
  }

  private patch(id: string, fn: (j: JobInfo) => JobInfo): void {
    this.jobs.update((jobs) => jobs.map((j) => (j.id === id ? fn(j) : j)));
  }
}

/**
 * Folder sizes, the copy dialog's count, searches, duplicate searches, disk-usage scans
 * and shell commands are not tasks of the user.
 */
export function isHelperJob(job: JobInfo): boolean {
  const k = job.spec.kind;
  return (
    k === 'dirSize' ||
    k === 'count' ||
    k === 'search' ||
    k === 'compare' ||
    k === 'duplicates' ||
    k === 'diskUsage' ||
    k === 'shell'
  );
}
