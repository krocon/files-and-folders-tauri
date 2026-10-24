import { Injectable } from '@angular/core';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { Decision, JobEvent, JobInfo, JobSpec, StartNowResult } from './jobs.models';

/** Facade for the job commands (Rust `jobs/`, `commands.rs`). Rejects with an `FsError`. */
export abstract class JobsApi {
  /** Listens to all job events; resolves with the current jobs. */
  abstract subscribe(onEvent: (event: JobEvent) => void): Promise<JobInfo[]>;
  abstract start(spec: JobSpec): Promise<string>;
  abstract cancel(id: string): Promise<void>;
  abstract pause(id: string): Promise<void>;
  abstract resume(id: string): Promise<void>;
  /** A waiting job runs at once, next to the others; `force` despite an overlap. */
  abstract startNow(id: string, force: boolean): Promise<StartNowResult>;
  abstract resolveConflict(
    id: string,
    conflictId: number,
    decision: Decision,
    applyToAll: boolean,
  ): Promise<void>;
  abstract clearFinished(): Promise<void>;
  /** The user confirmed quitting while jobs run. */
  abstract cancelAllAndQuit(): Promise<void>;
}

@Injectable()
export class TauriJobsApi extends JobsApi {
  subscribe(onEvent: (event: JobEvent) => void): Promise<JobInfo[]> {
    if (!isTauri()) {
      return Promise.resolve([]);
    }
    const channel = new Channel<JobEvent>();
    channel.onmessage = onEvent;
    return call<JobInfo[]>('subscribe_jobs', { onEvent: channel });
  }

  start(spec: JobSpec): Promise<string> {
    return call<string>('start_job', { spec });
  }

  cancel(id: string): Promise<void> {
    return call<void>('cancel_job', { id });
  }

  pause(id: string): Promise<void> {
    return call<void>('pause_job', { id });
  }

  resume(id: string): Promise<void> {
    return call<void>('resume_job', { id });
  }

  startNow(id: string, force: boolean): Promise<StartNowResult> {
    return call<StartNowResult>('start_job_now', { id, force });
  }

  resolveConflict(
    id: string,
    conflictId: number,
    decision: Decision,
    applyToAll: boolean,
  ): Promise<void> {
    return call<void>('resolve_conflict', { id, conflictId, decision, applyToAll });
  }

  clearFinished(): Promise<void> {
    return call<void>('clear_finished_jobs', {});
  }

  cancelAllAndQuit(): Promise<void> {
    return call<void>('cancel_all_and_quit', {});
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}
