import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import {
  CleanOptions,
  CleanScan,
  CollectOptions,
  CreatedFolders,
  FileTree,
} from './folders.models';

/**
 * Facade for the folder tools of design 008/045 (Rust `clean.rs`, `collect.rs`,
 * `fileops::create_folders`).
 * Deleting and grouping are jobs (`JobsStore.start({ kind: 'clean' | 'group', … })`).
 * Rejects with an `FsError`.
 */
export abstract class FoldersApi {
  /**
   * Lists empty folders (and files matching a pattern) below the start folders; writes
   * nothing. `scanId` (unique per search) lets `cancelScan` stop it early.
   */
  abstract findEmptyDirs(
    scanId: string,
    roots: readonly string[],
    options: CleanOptions,
  ): Promise<CleanScan>;
  /**
   * Lists the files below `root` (design 045 E1): no links, no other file system,
   * no hidden entries; writes nothing. `cancelScan(scanId)` stops it as well.
   */
  abstract collectFiles(scanId: string, root: string, options: CollectOptions): Promise<FileTree>;
  /** Stops a running search (it answers `cancelled: true`, without items). */
  abstract cancelScan(scanId: string): Promise<void>;
  /** Creates one folder per name in `parent`; never touches an existing entry. */
  abstract createFolders(parent: string, names: readonly string[]): Promise<CreatedFolders>;
}

@Injectable()
export class TauriFoldersApi extends FoldersApi {
  findEmptyDirs(
    scanId: string,
    roots: readonly string[],
    options: CleanOptions,
  ): Promise<CleanScan> {
    return call<CleanScan>('find_empty_dirs', { scanId, roots, options });
  }

  collectFiles(scanId: string, root: string, options: CollectOptions): Promise<FileTree> {
    return call<FileTree>('collect_files', { scanId, root, options });
  }

  cancelScan(scanId: string): Promise<void> {
    return call<void>('cancel_clean_scan', { scanId });
  }

  createFolders(parent: string, names: readonly string[]): Promise<CreatedFolders> {
    return call<CreatedFolders>('create_folders', { parent, names });
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}
