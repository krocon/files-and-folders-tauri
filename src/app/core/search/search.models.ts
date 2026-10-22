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
  /** Duplicates (design 042): position in the walk – rule "first found". */
  readonly order?: number;
  /** Duplicates (042 E4): a hard link of the file at this path – the same file, never a copy. */
  readonly sameAs?: string;
  /** Duplicates (042 E4): the file has this many names (> 1) – deleting one frees nothing. */
  readonly links?: number;
  /** Similar images (042 E6): pixels (comics: of the title page). */
  readonly width?: number;
  readonly height?: number;
  /** Comics (042 E7): number of pages. */
  readonly pages?: number;
  /** Similar images/comics: differing bits to the group's centre (0 = centre or identical). */
  readonly distance?: number;
};

/** What counts as a duplicate (design 042). */
export type DupMode = 'exact' | 'similarImages' | 'comics';
/** Rust `duplicates::DEFAULT_THRESHOLD` / `MAX_THRESHOLD`. */
export const DEFAULT_DUP_THRESHOLD = 8;
export const MAX_DUP_THRESHOLD = 16;

/** Duplicate search (design 016 E6, 042). Keep in sync with `src-tauri/src/duplicates/mod.rs`. */
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
  /** Default `exact` (design 042). */
  readonly mode?: DupMode;
  /** Name globs (`*.jpg;*.png`), empty = every file. */
  readonly name?: string;
  /** Exact: compare the bytes within each group as well. */
  readonly paranoid?: boolean;
  /** Similar images/comics: differing bits allowed (0–16, default 8). */
  readonly threshold?: number | null;
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
  /** Similar images/comics (design 042): files to fingerprint / done; HEIC/AVIF skipped. */
  readonly imagesTotal?: number;
  readonly imagesDone?: number;
  readonly skippedUnsupported?: number;
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
