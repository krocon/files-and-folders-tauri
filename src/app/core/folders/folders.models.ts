/**
 * DTOs of the folder tools (design 008). Keep in sync with
 * `src-tauri/src/clean.rs` and `fileops.rs` (`CreatedFolders`).
 */
import { FsError } from '../fs/fs.models';

export interface CleanOptions {
  /** Delete folders without entries (default on). */
  readonly emptyDirs: boolean;
  /** The start folders themselves may go, too. */
  readonly includeRoots: boolean;
  /** File names that do not count as content (`.DS_Store` …); empty = off. */
  readonly junk: readonly string[];
  /** Name patterns (`*`, `?`) of files to delete; empty = off. */
  readonly patterns: readonly string[];
}

export type CleanKind = 'dir' | 'file';

export interface CleanItem {
  readonly path: string;
  readonly kind: CleanKind;
  /** Junk files inside the folder (they go with it). */
  readonly junk?: number;
}

export interface CleanScan {
  /** Delete order: children before their parents. */
  readonly items: readonly CleanItem[];
  readonly unreadable: readonly FsError[];
  readonly unreadableMore: number;
  /** The scan stopped at a limit. */
  readonly truncated: boolean;
  /** The search was cancelled (review 008 #2); then `items` is empty. */
  readonly cancelled: boolean;
  readonly visited: number;
}

export interface CreatedFolders {
  readonly created: readonly string[];
  readonly errors: readonly { readonly name: string; readonly error: FsError }[];
}

export const DEFAULT_JUNK: readonly string[] = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
