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
}

/** A hit: an entry as in a listing plus the full path of its folder. */
export type SearchHit = DirEntry & { readonly dir: string };

export interface SearchStats {
  readonly hits: number;
  readonly dirsScanned: number;
  readonly filesScanned: number;
  readonly unreadable: number;
  readonly elapsedMs: number;
  /** Stopped at `maxHits`. */
  readonly truncated: boolean;
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
