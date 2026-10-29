/**
 * DTOs of the folder tools (design 008, 045). Keep in sync with
 * `src-tauri/src/clean.rs`, `collect.rs` and `fileops.rs` (`CreatedFolders`).
 */
import { FsError } from '../fs/fs.models';

export interface CleanOptions {
  /** Delete folders without entries (default on). */
  readonly emptyDirs: boolean;
  /** The start folders themselves may go, too. */
  readonly includeRoots: boolean;
  /**
   * File names that do not count as content (`.DS_Store` …); with `*`/`?` a name
   * pattern (`*.nfo`, design 045 E4). Junk goes with its folder. Empty = off.
   */
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

/** Options of `collect_files` (design 045 E1). */
export interface CollectOptions {
  /** 1 = only the files of the start folder; Rust clamps to 1…16. */
  readonly maxDepth: number;
}

/** A file below the start folder (`collect_files`, design 045 E1). */
export interface TreeFile {
  /** Full path (opaque). */
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedMs: number | null;
  /** Names of the folders between the start folder and the file (`[]` = directly in it). */
  readonly dirs: readonly string[];
  /** Full path of the first folder below the start folder (`null` for `dirs = []`). */
  readonly top: string | null;
  /** Relative path with the OS separators – for display only, never split. */
  readonly rel: string;
}

export interface FileTree {
  /** Depth first, the entries of a folder sorted by name. */
  readonly files: readonly TreeFile[];
  readonly unreadable: readonly FsError[];
  readonly unreadableMore: number;
  /** The walk stopped at a limit (20 000 files, 500 000 entries). */
  readonly truncated: boolean;
  /** Cancelled (`cancelScan`); then `files` is empty. */
  readonly cancelled: boolean;
  readonly visited: number;
}
