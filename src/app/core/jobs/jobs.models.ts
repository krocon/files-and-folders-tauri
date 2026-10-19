/**
 * Job DTOs. Keep in sync with `src-tauri/src/jobs/mod.rs`.
 */
import type { ShellChunk, ShellSummary } from '../shell/shell.models';
import { ArchiveFormat, DirSize, FsError } from '../fs/fs.models';
import { CleanItem, CleanOptions } from '../folders/folders.models';
import { RenameItem } from '../rename/rename.models';
import { DuplicateCriteria, SearchCriteria, SearchHit, SearchStats } from '../search/search.models';

/** What happens when a target exists (copy/move dialog). */
export type ConflictDefault = 'ask' | 'overwrite' | 'skip' | 'overwriteIfNewer' | 'rename';

export interface CopyOptions {
  readonly conflictDefault?: ConflictDefault;
  /** New name of the single source in the target folder. */
  readonly renameTo?: string | null;
}

export type DeleteMode = 'trash' | 'permanent';

/** One entry of a group job: the source and the name of its group folder. */
export interface GroupItem {
  readonly path: string;
  readonly group: string;
}

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
  /** Group files (design 008): every entry to `<root>/<group>/<name>`. */
  | {
      readonly kind: 'group';
      readonly root: string;
      readonly items: readonly GroupItem[];
      readonly transfer: 'copy' | 'move';
      readonly options?: CopyOptions;
    }
  /** Clean folders (design 008): deletes what `findEmptyDirs` listed, checked again. */
  | {
      readonly kind: 'clean';
      readonly roots: readonly string[];
      readonly items: readonly CleanItem[];
      readonly mode: DeleteMode;
      readonly options: CleanOptions;
    }
  /** Recursive search (design 009); hits come as `searchHits` events. */
  | { readonly kind: 'search'; readonly criteria: SearchCriteria }
  /**
   * Extract from an archive (design 016 E4): `entries` are virtual paths (`…/a.zip/dir`),
   * empty = everything; `intoSubfolder` = into `<target>/<archive name without extension>`.
   */
  | {
      readonly kind: 'extract';
      readonly archive: string;
      readonly entries: readonly string[];
      readonly targetDir: string;
      readonly intoSubfolder?: boolean;
      readonly options?: CopyOptions;
    }
  /** Pack into `<targetDir>/<name>` (design 016 E5); level 1–9 (default 6). */
  | {
      readonly kind: 'pack';
      readonly sources: readonly string[];
      readonly targetDir: string;
      readonly name: string;
      readonly format: ArchiveFormat;
      readonly level?: number | null;
    }
  /** Duplicate files (design 016 E6); groups come as `searchHits` events. */
  | { readonly kind: 'duplicates'; readonly criteria: DuplicateCriteria }
  /** Counts files, folders and bytes of a selection (copy dialog). */
  | { readonly kind: 'count'; readonly paths: readonly string[] }
  | { readonly kind: 'dirSize'; readonly path: string }
  /** Debug builds only (load tests). */
  | { readonly kind: 'simulate'; readonly items: number; readonly itemMs: number }
  /** Shell bar (design 021): only Rust creates it (`run_shell`), never `start`. */
  | { readonly kind: 'shell'; readonly cwd: string; readonly command: string };

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
  /** Bytes copied/moved into each top-level target destination so far. */
  readonly destBytes?: Readonly<Record<string, number>>;
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
  /** Search job: final statistics (`errors` = unreadable folders). */
  readonly search?: SearchStats | null;
  /** Shell job: exit code / signal (design 021). */
  readonly shell?: ShellSummary | null;
  /** Final bytes copied/moved into each top-level target destination. */
  readonly destBytes?: Readonly<Record<string, number>>;
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
  | {
      readonly type: 'searchHits';
      readonly id: string;
      readonly hits: readonly SearchHit[];
      readonly stats: SearchStats;
    }
  | {
      readonly type: 'shellOutput';
      readonly id: string;
      readonly chunks: readonly ShellChunk[];
      /** Bytes left out by the flood protection since the last event. */
      readonly dropped: number;
    }
  | { readonly type: 'quitRequested'; readonly running: number };

export const EMPTY_PROGRESS: Progress = {
  bytesDone: 0,
  bytesTotal: 0,
  itemsDone: 0,
  itemsTotal: 0,
  current: null,
  rateBps: 0,
};
