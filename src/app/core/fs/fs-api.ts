import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from './fs-error';
import { DirectoryListing, Location } from './fs.models';

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
