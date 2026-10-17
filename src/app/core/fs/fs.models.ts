/**
 * DTOs returned by the Rust backend. Keep in sync with `src-tauri/src/model.rs`
 * and `src-tauri/src/error.rs`.
 */

export type EntryKind = 'file' | 'directory' | 'symlink' | 'unknown';

export interface DirEntry {
  readonly name: string;
  /** Full platform path – treat as opaque, never split on '/' or '\\'. */
  readonly path: string;
  readonly kind: EntryKind;
  readonly targetKind: EntryKind | null;
  readonly size: number | null;
  readonly modifiedMs: number | null;
  readonly hidden: boolean;
  readonly lossyName: boolean;
}

export interface PathSegment {
  readonly name: string;
  readonly path: string;
}

export interface DirectoryListing {
  readonly path: string;
  readonly parent: string | null;
  readonly segments: readonly PathSegment[];
  readonly entries: readonly DirEntry[];
  readonly unreadableEntries: number;
}

export type FsErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'not_a_directory'
  | 'invalid_path'
  | 'no_home_directory'
  | 'io'
  /** Frontend-only: the Tauri runtime is not available (e.g. plain browser). */
  | 'no_backend'
  /** Frontend-only: the error had an unexpected shape. */
  | 'unknown';

export interface FsError {
  readonly code: FsErrorCode;
  readonly message: string;
  readonly path: string | null;
}

export function isNavigableDir(entry: DirEntry): boolean {
  return (
    entry.kind === 'directory' || (entry.kind === 'symlink' && entry.targetKind === 'directory')
  );
}
