/**
 * Job DTOs. Keep in sync with `src-tauri/src/jobs/mod.rs`.
 */
import { DirSize, FsError } from '../fs/fs.models';
import { RenameItem } from '../rename/rename.models';

/** What happens when a target exists (copy/move dialog). */
export type ConflictDefault = 'ask' | 'overwrite' | 'skip' | 'overwriteIfNewer' | 'rename';

export interface CopyOptions {
  readonly conflictDefault?: ConflictDefault;
  /** New name of the single source in the target folder. */
  readonly renameTo?: string | null;
}

export type DeleteMode = 'trash' | 'permanent';

export type JobSpec =
  | {
      readonly kind: 'copy';
      readonly sources: readonly string[];
      readonly targetDir: string;
      readonly background?: boolean;
      readonly options?: CopyOptions;
    }
  | {
      readonly kind: 'move';
      readonly sources: readonly string[];
      readonly targetDir: string;
      readonly background?: boolean;
      readonly options?: CopyOptions;
      /** The user confirmed a root/home/system path a second time. */
      readonly allowDangerous?: boolean;
    }
  | {
      readonly kind: 'delete';
      readonly paths: readonly string[];
      readonly mode: DeleteMode;
      readonly background?: boolean;
      readonly allowDangerous?: boolean;
    }
  /** Multi-rename (design 007); `undoOf` = the job this one undoes. */
  | {
      readonly kind: 'rename';
      readonly items: readonly RenameItem[];
      readonly undoOf?: string | null;
    }
  /** Counts files, folders and bytes of a selection (copy dialog). */
  | { readonly kind: 'count'; readonly paths: readonly string[] }
  | { readonly kind: 'dirSize'; readonly path: string }
  /** Debug builds only (load tests). */
  | { readonly kind: 'simulate'; readonly items: number; readonly itemMs: number };

export type JobState =
  | 'queued'
  | 'planning'
  | 'running'
  | 'paused'
  | 'waitingForDecision'
  | 'done'
  | 'doneWithErrors'
  | 'failed'
  | 'cancelled';

export const FINISHED_STATES: ReadonlySet<JobState> = new Set<JobState>([
  'done',
  'doneWithErrors',
  'failed',
  'cancelled',
]);

export function isFinished(state: JobState): boolean {
  return FINISHED_STATES.has(state);
}

export interface Progress {
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly itemsDone: number;
  readonly itemsTotal: number;
  /** Full path of the item being processed. */
  readonly current: string | null;
  readonly rateBps: number;
}

export interface FileMeta {
  readonly size: number | null;
  readonly modifiedMs: number | null;
  readonly isDir: boolean;
}

/** `exists`: the target exists (copy/move); `readOnly`: permanent delete of a write-protected entry. */
export type ConflictKind = 'exists' | 'readOnly';

export interface Conflict {
  readonly conflictId: number;
  readonly kind: ConflictKind;
  readonly source: string;
  readonly target: string;
  readonly sourceMeta: FileMeta;
  readonly targetMeta: FileMeta;
  /** Free name in the target folder (`name (1).ext`). */
  readonly suggestedName: string;
}

export type Decision =
  | { readonly type: 'overwrite' }
  | { readonly type: 'skip' }
  | { readonly type: 'rename'; readonly newName: string | null }
  | { readonly type: 'overwriteIfNewer' }
  | { readonly type: 'cancel' };

export interface ItemError {
  readonly path: string;
  readonly error: FsError;
}

export interface Summary {
  readonly itemsDone: number;
  readonly itemsSkipped: number;
  readonly itemsFailed: number;
  readonly bytesDone: number;
  /** The first 1 000 errors (`itemsFailed` has the full count). */
  readonly errors: readonly ItemError[];
  /** Job-level error (planning failed, invalid target …). */
  readonly error: FsError | null;
  readonly dirSize: DirSize | null;
}

export interface JobInfo {
  readonly id: string;
  readonly spec: JobSpec;
  readonly state: JobState;
  readonly progress: Progress;
  readonly conflict: Conflict | null;
  readonly summary: Summary | null;
  /** Why the job paused itself (disk full) – cleared when it runs again. */
  readonly pauseReason: FsError | null;
  /** A finished rename job that can still be undone. */
  readonly undoAvailable: boolean;
}

export type JobEvent =
  | { readonly type: 'added'; readonly job: JobInfo }
  | { readonly type: 'state'; readonly id: string; readonly state: JobState }
  | { readonly type: 'progress'; readonly id: string; readonly progress: Progress }
  | { readonly type: 'conflict'; readonly id: string; readonly conflict: Conflict }
  | { readonly type: 'itemFailed'; readonly id: string; readonly error: ItemError }
  | { readonly type: 'dirsChanged'; readonly dirs: readonly string[] }
  | {
      readonly type: 'finished';
      readonly id: string;
      readonly state: JobState;
      readonly summary: Summary;
    }
  | { readonly type: 'removed'; readonly ids: readonly string[] }
  | { readonly type: 'undoAvailable'; readonly id: string; readonly available: boolean }
  | { readonly type: 'quitRequested'; readonly running: number };

export const EMPTY_PROGRESS: Progress = {
  bytesDone: 0,
  bytesTotal: 0,
  itemsDone: 0,
  itemsTotal: 0,
  current: null,
  rateBps: 0,
};
