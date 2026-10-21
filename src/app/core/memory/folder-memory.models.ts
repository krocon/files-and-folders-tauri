import { ConfigWarning } from '../config/config.models';

/**
 * `folder-memory.json` (design 027, Rust `folder_memory.rs`): cursor, marks and
 * scroll of the last folders per tab, kept across restarts. Paths are opaque.
 */
export interface SavedFolder {
  readonly path: string;
  readonly cursor: string | null;
  readonly marks: readonly string[];
  readonly scrollTop: number;
}

export interface SavedTabFolders {
  readonly tabId: string;
  /** Oldest first. */
  readonly folders: readonly SavedFolder[];
}

export interface FolderMemoryFile {
  readonly version: 1;
  readonly tabs: readonly SavedTabFolders[];
}

export interface LoadedFolderMemory {
  readonly value: FolderMemoryFile;
  readonly warning: ConfigWarning | null;
}

export const EMPTY_FOLDER_MEMORY: FolderMemoryFile = { version: 1, tabs: [] };
