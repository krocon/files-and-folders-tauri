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
   * pattern (`*.nfo`, design 045 E4) – then only up to `junkMaxBytes`. Junk goes
   * with its folder. Empty = off.
   */
  readonly junk: readonly string[];
  /** Name patterns (`*`, `?`) of files to delete; empty = off. */
  readonly patterns: readonly string[];
  /** Junk patterns with the generous limit `largeJunkMaxBytes` (samples, design 077 E3). */
  readonly largeJunk: readonly string[];
  /** A file that only a pattern of `junk` makes an extra is content when it is larger. */
  readonly junkMaxBytes: number;
  readonly largeJunkMaxBytes: number;
  /** Below a folder that stays, folders holding only pattern extras go as well (default off). */
  readonly junkDirsBesideContent: boolean;
}

export type CleanKind = 'dir' | 'file';

export interface CleanItem {
  readonly path: string;
  readonly kind: CleanKind;
  /** Junk files inside the folder (they go with it). */
  readonly junk?: number;
  /** The first junk names (at most 5, design 045 review #2) – shown, not sent back. */
  readonly junkNames?: readonly string[];
  /** Bytes of the junk files directly inside the folder / of the file. */
  readonly bytes?: number;
  /** Path relative to its start folder, for display only ("" = the start folder). */
  readonly rel?: string;
  /** "Empty" only because of pattern extras somewhere inside. */
  readonly soft?: boolean;
}

/** What happens to a start folder (design 077). */
export type CleanVerdict = 'residue' | 'partial' | 'keep';

/** Why an entry counts as content (Rust `KeepReason`). */
export type KeepReason =
  | 'content'
  | 'tooLarge'
  | 'sampleTooLarge'
  | 'hidden'
  | 'link'
  | 'unreadable'
  | 'otherFs'
  | 'special'
  /** A folder the system shows as one file (`.app` …): never entered (review 077 #2). */
  | 'package';

export interface KeptEntry {
  /** Path relative to the start folder, for display only. */
  readonly rel: string;
  readonly bytes: number;
  readonly reason: KeepReason;
}

/** The verdict about one start folder (Rust `RootVerdict`). */
export interface RootVerdict {
  readonly path: string;
  readonly name: string;
  readonly verdict: CleanVerdict;
  /** Its entries are `items[first .. first + count]`. */
  readonly first: number;
  readonly count: number;
  readonly removeDirs: number;
  readonly removeFiles: number;
  readonly removeBytes: number;
  /** Files that count as content (also too large or hidden ones). */
  readonly keepFiles: number;
  readonly keepBytes: number;
  /** The most frequent extensions of the content (at most 3). */
  readonly keepExtensions: readonly string[];
  /** The first entries that stay (at most 20). */
  readonly keepSample: readonly KeptEntry[];
  readonly tooLarge: number;
  readonly sampleTooLarge: number;
  readonly hidden: number;
  readonly links: number;
  /** Unreadable folders, mount points, special files. */
  readonly blocked: number;
  /** Extras that stay because they lie next to content. */
  readonly junkKept: number;
  /** Root, home or system folder: never deleted as a whole. */
  readonly danger: 'root' | 'home' | 'system' | null;
  /** Reached through a link: never deleted as a whole. */
  readonly linked: boolean;
  /** The scan stopped before this folder was done. */
  readonly incomplete: boolean;
}

export interface CleanScan {
  /** Delete order: children before their parents; grouped by start folder. */
  readonly items: readonly CleanItem[];
  /** One verdict per start folder (nested and double ones merged). */
  readonly roots: readonly RootVerdict[];
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
