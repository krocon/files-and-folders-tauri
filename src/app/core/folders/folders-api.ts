import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { CleanOptions, CleanScan, CreatedFolders } from './folders.models';

/**
 * Facade for the folder tools of design 008 (Rust `clean.rs`, `fileops::create_folders`).
 * Deleting and grouping are jobs (`JobsStore.start({ kind: 'clean' | 'group', … })`).
 * Rejects with an `FsError`.
 */
export abstract class FoldersApi {
  /** Lists empty folders (and files matching a pattern) below the start folders; writes nothing. */
  abstract findEmptyDirs(roots: readonly string[], options: CleanOptions): Promise<CleanScan>;
  /** Creates one folder per name in `parent`; never touches an existing entry. */
  abstract createFolders(parent: string, names: readonly string[]): Promise<CreatedFolders>;
}

@Injectable()
export class TauriFoldersApi extends FoldersApi {
  findEmptyDirs(roots: readonly string[], options: CleanOptions): Promise<CleanScan> {
    return call<CleanScan>('find_empty_dirs', { roots, options });
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
