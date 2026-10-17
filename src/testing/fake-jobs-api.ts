import { JobsApi } from '../app/core/jobs/jobs-api';
import { Decision, EMPTY_PROGRESS, JobEvent, JobInfo, JobSpec } from '../app/core/jobs/jobs.models';

/**
 * In-memory JobsApi: records calls; tests drive the job through `emit`.
 * `autoFinishDirSize` finishes folder-size jobs at once with `sizes[path]`.
 */
export class FakeJobsApi extends JobsApi {
  private listener: (e: JobEvent) => void = () => undefined;
  private seq = 0;
  snapshot: JobInfo[] = [];
  readonly started: { id: string; spec: JobSpec }[] = [];
  readonly cancelled: string[] = [];
  readonly paused: string[] = [];
  readonly resumed: string[] = [];
  readonly answers: { id: string; conflictId: number; decision: Decision; applyToAll: boolean }[] =
    [];
  quitCalls = 0;
  clearCalls = 0;
  refuse: unknown = null;
  autoFinishDirSize = false;
  sizes: Record<string, number> = {};

  subscribe(onEvent: (event: JobEvent) => void): Promise<JobInfo[]> {
    this.listener = onEvent;
    return Promise.resolve(this.snapshot);
  }

  emit(event: JobEvent): void {
    this.listener(event);
  }

  start(spec: JobSpec): Promise<string> {
    if (this.refuse) {
      return Promise.reject(this.refuse);
    }
    const id = `j${++this.seq}`;
    this.started.push({ id, spec });
    this.emit({ type: 'added', job: job(id, spec) });
    if (this.autoFinishDirSize && spec.kind === 'dirSize') {
      const bytes = this.sizes[spec.path] ?? 0;
      queueMicrotask(() =>
        this.emit({
          type: 'finished',
          id,
          state: 'done',
          summary: {
            itemsDone: 1,
            itemsSkipped: 0,
            itemsFailed: 0,
            bytesDone: bytes,
            errors: [],
            error: null,
            dirSize: { files: 1, dirs: 0, bytes, unreadable: 0, cancelled: false },
          },
        }),
      );
    }
    return Promise.resolve(id);
  }

  cancel(id: string): Promise<void> {
    this.cancelled.push(id);
    return Promise.resolve();
  }

  pause(id: string): Promise<void> {
    this.paused.push(id);
    return Promise.resolve();
  }

  resume(id: string): Promise<void> {
    this.resumed.push(id);
    return Promise.resolve();
  }

  resolveConflict(
    id: string,
    conflictId: number,
    decision: Decision,
    applyToAll: boolean,
  ): Promise<void> {
    this.answers.push({ id, conflictId, decision, applyToAll });
    return Promise.resolve();
  }

  clearFinished(): Promise<void> {
    this.clearCalls++;
    return Promise.resolve();
  }

  cancelAllAndQuit(): Promise<void> {
    this.quitCalls++;
    return Promise.resolve();
  }
}

export function job(id: string, spec: JobSpec, patch: Partial<JobInfo> = {}): JobInfo {
  return {
    id,
    spec,
    state: 'queued',
    progress: EMPTY_PROGRESS,
    conflict: null,
    summary: null,
    pauseReason: null,
    ...patch,
  };
}
