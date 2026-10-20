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

export type ArchiveFormat = 'zip' | 'tar' | 'tarGz';

/** Set when a listing is a folder inside an archive (design 016 E1). Rust `archive::ArchiveInfo`. */
export interface ArchiveInfo {
  /** The archive file (a real path). */
  readonly path: string;
  /** Folder inside the archive, `/`-separated, `''` = root – display only. */
  readonly inner: string;
  readonly format: ArchiveFormat;
  /** Entries hidden because of an unsafe name (`..`, absolute, drive letter). */
  readonly unsafeEntries: number;
  readonly entries: number;
}

export interface DirectoryListing {
  readonly path: string;
  readonly parent: string | null;
  readonly segments: readonly PathSegment[];
  readonly entries: readonly DirEntry[];
  readonly unreadableEntries: number;
  /** Inside an archive: `path` and the entry paths are virtual (`…/a.zip/dir`). */
  readonly archive?: ArchiveInfo | null;
  /** On a network drive (design 030 E6): the listing is kept in the `ListingCache`. */
  readonly network?: boolean;
}

export type FsErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'not_a_directory'
  | 'not_a_file'
  | 'executable'
  | 'target_inside_source'
  | 'same_source_target'
  | 'disk_full'
  | 'already_exists'
  | 'invalid_name'
  | 'dangerous_path'
  | 'trash_failed'
  /** Two entries of a multi-rename would get the same name. */
  | 'duplicate_target'
  /** Nothing to undo (anymore). */
  | 'undo_unavailable'
  /** An external program (tool, terminal, file manager) is not installed. */
  | 'program_not_found'
  /** The tool id is not in the configuration (anymore). */
  | 'unknown_tool'
  /** More entries than the tool takes (`fileLimit`). */
  | 'too_many_files'
  /** More items than a command accepts (watched folders, dropped paths). */
  | 'too_many'
  /** A search pattern (regex, glob) is invalid (design 009). */
  | 'invalid_pattern'
  /** An archive is broken or uses an unsupported feature (design 016). */
  | 'archive_error'
  /** An archive entry would leave the target or is a link (zip slip, design 016 E3). */
  | 'unsafe_entry'
  /** An archive exceeds the limits (entries, size, ratio – zip bomb). */
  | 'archive_too_large'
  | 'invalid_menu'
  /** A file to import is no settings export (design 015). */
  | 'invalid_settings'
  /** Shell bar (design 021). */
  | 'shell_disabled'
  | 'shell_busy'
  | 'changed_since_listing'
  | 'invalid_command'
  | 'unquotable_name'
  /** A drag out of the window without a held mouse button (design 028 E2). */
  | 'drag_not_held'
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

/** A row of the file list: a directory entry or the synthetic ".." row (design 003 E1). */
export type ListRow = DirEntry & { readonly parentLink?: true };

export function parentRow(parentPath: string): ListRow {
  return {
    name: '..',
    path: parentPath,
    kind: 'directory',
    targetKind: null,
    size: null,
    modifiedMs: null,
    hidden: false,
    lossyName: false,
    parentLink: true,
  };
}

export function isParentRow(entry: DirEntry): boolean {
  return (entry as ListRow).parentLink === true;
}

/** Result of `calc_dir_size` (Rust `dirsize.rs`). */
export interface DirSize {
  readonly files: number;
  readonly dirs: number;
  readonly bytes: number;
  readonly unreadable: number;
  readonly cancelled: boolean;
}

/** Result of `resolve_location`: a folder, plus the file to select if a file was typed. */
export interface Location {
  readonly dir: string;
  readonly select: string | null;
}

export function isNavigableDir(entry: DirEntry): boolean {
  return (
    entry.kind === 'directory' || (entry.kind === 'symlink' && entry.targetKind === 'directory')
  );
}

/** Why a path needs a second confirmation (Rust `paths::Danger`). */
export type Danger = 'root' | 'home' | 'system';

/** Result of `check_paths`. */
export interface PathCheck {
  readonly path: string;
  readonly danger: Danger | null;
}
