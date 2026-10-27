/**
 * DTOs of the folder comparison and sync (design 036). Keep in sync with
 * `src-tauri/src/compare/mod.rs` and `src-tauri/src/jobs/sync.rs`.
 */
import { EntryKind, FsError } from '../fs/fs.models';

/** Rust `compare::CompareOptions` (every field optional on the wire). */
export interface CompareOptions {
  readonly recursive: boolean;
  /** Byte-wise comparison of files with the same size. */
  readonly content: boolean;
  /** Only size (and content) count. */
  readonly ignoreDate: boolean;
  readonly toleranceSecs: number;
  /** Differences of exactly one hour (± tolerance) count as equal. */
  readonly ignoreHour: boolean;
  readonly ignoreCase: boolean;
  readonly hidden: boolean;
  /** Globs for file names, `;`-separated; empty = all. */
  readonly filter: string;
  /** Globs of names that are skipped. */
  readonly exclude: string;
  readonly maxRows?: number | null;
}

export type CompareStatus =
  'equal' | 'leftNewer' | 'rightNewer' | 'differs' | 'onlyLeft' | 'onlyRight' | 'kindMismatch';

export interface CompareSide {
  readonly path: string;
  readonly name: string;
  readonly kind: EntryKind;
  readonly size: number | null;
  readonly modifiedMs: number | null;
  /** Not valid UTF-8: shown lossy, never acted on (review 036 #8). */
  readonly lossy?: boolean;
}

export interface CompareRow {
  /** Relative path for display (`/`-separated, as Rust built it – never split here). */
  readonly rel: string;
  readonly depth: number;
  readonly left: CompareSide | null;
  readonly right: CompareSide | null;
  /** Where the entry is – or would be after a copy – on each side (built by Rust). */
  readonly leftPath: string;
  readonly rightPath: string;
  readonly status: CompareStatus;
  readonly contentChecked: boolean;
  /** Folders: everything directly inside was listed on both sides (files: true). */
  readonly complete: boolean;
  /** Folders: listing a side failed – nothing below may be deleted (review 036 #2). */
  readonly readError?: boolean;
}

export interface CompareStats {
  readonly dirs: number;
  readonly files: number;
  readonly rows: number;
  readonly differences: number;
  readonly bytesCompared: number;
  readonly truncated: boolean;
  readonly errors: readonly { readonly path: string; readonly error: FsError }[];
  readonly unreadable: number;
  /** The compared folders themselves (see `CompareRow.complete` / `readError`). */
  readonly rootComplete: boolean;
  readonly rootReadError: boolean;
}

export const EMPTY_COMPARE_STATS: CompareStats = {
  dirs: 0,
  files: 0,
  rows: 0,
  differences: 0,
  bytesCompared: 0,
  truncated: false,
  errors: [],
  unreadable: 0,
  rootComplete: true,
  rootReadError: false,
};

export type SyncAction = 'copyToRight' | 'copyToLeft' | 'deleteLeft' | 'deleteRight';

/** What the comparison saw (`null` = nothing there). Rust `jobs::sync::Seen`. */
export interface Seen {
  readonly kind: EntryKind;
  readonly size: number | null;
  readonly modifiedMs: number | null;
}

export interface SyncSide {
  readonly path: string;
  readonly seen: Seen | null;
}

export interface SyncOp {
  readonly action: SyncAction;
  readonly left: SyncSide;
  readonly right: SyncSide;
}
