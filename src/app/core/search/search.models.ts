/**
 * Search DTOs (design 009). Keep in sync with `src-tauri/src/search.rs`.
 */
import { DirEntry } from '../fs/fs.models';

export type NameMode = 'glob' | 'regex' | 'text';

export interface Kinds {
  readonly files: boolean;
  readonly dirs: boolean;
  readonly links: boolean;
}

export interface ContentQuery {
  readonly text: string;
  readonly caseSensitive: boolean;
  /** Larger files are skipped (Rust default 10 MiB, max. 1 GiB). */
  readonly maxFileSize?: number | null;
}

export interface SearchCriteria {
  /** Folders to search in (opaque paths from Rust). */
  readonly roots: readonly string[];
  /** Empty = every name. Glob: several patterns separated by `;`. */
  readonly name: string;
  readonly nameMode: NameMode;
  readonly caseSensitive: boolean;
  /** The pattern must match the whole name (else a part). */
  readonly wholeName: boolean;
  readonly kinds: Kinds;
  /** Bytes, files only. */
  readonly minSize?: number | null;
  readonly maxSize?: number | null;
  readonly modifiedFromMs?: number | null;
  readonly modifiedToMs?: number | null;
  readonly includeHidden: boolean;
  readonly followLinks: boolean;
  /** 1 = only the entries of the roots; null = no limit (Rust: 256). */
  readonly maxDepth?: number | null;
  /** Glob names (without case) that are skipped – folders are not entered. */
  readonly excludes: readonly string[];
  readonly content?: ContentQuery | null;
  /** Default 10 000, max. 100 000. */
  readonly maxHits?: number | null;
  /** Linux: do not enter /proc, /sys, /dev (Rust default: true). */
  readonly skipVirtualFs?: boolean;
}

/**
 * A hit: an entry as in a listing plus the full path of its folder and the names
 * of that folder, its parent and grandparent (from Rust `paths::parent_names` – a
 * root or drive has no name; the frontend never splits paths), and `dir` relative to
 * the search root. A duplicate (design
 * 016 E6) also has its group (1 = most wasted bytes). Keep in sync with
 * `src-tauri/src/search.rs`.
 */
export type SearchHit = DirEntry & {
  readonly dir: string;
  /** `dir` relative to the search root (OS separators), "" directly in it – flat view (design 038 E2). */
  readonly relDir: string;
  readonly parentNames: readonly [string, string, string];
  readonly group?: number;
};

/** Duplicate search (design 016 E6). Keep in sync with `src-tauri/src/duplicates.rs`. */
export interface DuplicateCriteria {
  readonly roots: readonly string[];
  /** `content`: same size and SHA-256; `size`: same size only. */
  readonly compare: 'size' | 'content';
  /** Also the same name (without case). */
  readonly sameName: boolean;
  /** Smaller files are ignored (Rust default 1 – empty files). */
  readonly minSize?: number | null;
  readonly includeHidden: boolean;
  readonly excludes: readonly string[];
  /** Default 500 000, max. 2 000 000. */
  readonly maxFiles?: number | null;
  readonly skipVirtualFs?: boolean;
}

export interface SearchStats {
  readonly hits: number;
  readonly dirsScanned: number;
  readonly filesScanned: number;
  readonly unreadable: number;
  readonly elapsedMs: number;
  /** Stopped at `maxHits`. */
  readonly truncated: boolean;
  /** Duplicate search: groups, bytes to hash and hashed so far (0 otherwise). */
  readonly groups?: number;
  readonly bytesToHash?: number;
  readonly bytesHashed?: number;
}

export const EMPTY_STATS: SearchStats = {
  hits: 0,
  dirsScanned: 0,
  filesScanned: 0,
  unreadable: 0,
  elapsedMs: 0,
  truncated: false,
};

export const MAX_HITS = 100_000;
export const DEFAULT_MAX_HITS = 10_000;
