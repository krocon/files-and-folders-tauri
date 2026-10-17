import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from './fs-error';
import { DirectoryListing, Location, PathCheck } from './fs.models';

/**
 * Typed facade for all file-system commands. UI code depends on this
 * abstraction only; tests provide a fake implementation.
 * Rejects with an {@link FsError}.
 */
export abstract class FsApi {
  /** Lists `path`, or the user's home directory if `path` is omitted. */
  abstract listDirectory(path?: string): Promise<DirectoryListing>;
  /** A typed path (`~` allowed): folder, or file → its folder + the file to select. */
  abstract resolveLocation(input: string): Promise<Location>;
  /** Opens with the default app; rejects with code `executable` unless allowed. */
  abstract openFile(path: string, allowExecutable: boolean): Promise<void>;
  /** Creates `parent/name` (`a/b/c` allowed); resolves to the topmost new path. */
  abstract makeDir(parent: string, name: string): Promise<string>;
  /** Creates an empty file (never overwrites); resolves to its path. */
  abstract createFile(parent: string, name: string): Promise<string>;
  /** Renames in place (never overwrites); resolves to the new path. */
  abstract renameEntry(path: string, newName: string, allowDangerous: boolean): Promise<string>;
  /** Root, home or system paths among `paths` (second confirmation). */
  abstract checkPaths(paths: readonly string[]): Promise<readonly PathCheck[]>;
}

@Injectable()
export class TauriFsApi extends FsApi {
  listDirectory(path?: string): Promise<DirectoryListing> {
    return call<DirectoryListing>('list_directory', { path: path ?? null });
  }

  resolveLocation(input: string): Promise<Location> {
    return call<Location>('resolve_location', { input });
  }

  openFile(path: string, allowExecutable: boolean): Promise<void> {
    return call<void>('open_file', { path, allowExecutable });
  }

  makeDir(parent: string, name: string): Promise<string> {
    return call<string>('make_dir', { parent, name });
  }

  createFile(parent: string, name: string): Promise<string> {
    return call<string>('create_file', { parent, name });
  }

  renameEntry(path: string, newName: string, allowDangerous: boolean): Promise<string> {
    return call<string>('rename_entry', { path, newName, allowDangerous });
  }

  checkPaths(paths: readonly string[]): Promise<readonly PathCheck[]> {
    return call<readonly PathCheck[]>('check_paths', { paths });
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
