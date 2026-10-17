import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from './fs-error';
import { DirectoryListing } from './fs.models';

/**
 * Typed facade for all file-system commands. UI code depends on this
 * abstraction only; tests provide a fake implementation.
 * Rejects with an {@link FsError}.
 */
export abstract class FsApi {
  /** Lists `path`, or the user's home directory if `path` is omitted. */
  abstract listDirectory(path?: string): Promise<DirectoryListing>;
}

@Injectable()
export class TauriFsApi extends FsApi {
  async listDirectory(path?: string): Promise<DirectoryListing> {
    if (!isTauri()) {
      throw toFsError({
        code: 'no_backend',
        message: 'Tauri runtime not detected',
        path: null,
      });
    }
    try {
      return await invoke<DirectoryListing>('list_directory', { path: path ?? null });
    } catch (err) {
      throw toFsError(err);
    }
  }
}
