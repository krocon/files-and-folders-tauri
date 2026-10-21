import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { EMPTY_FOLDER_MEMORY, FolderMemoryFile, LoadedFolderMemory } from './folder-memory.models';

/** Facade for `folder-memory.json` (design 027). Outside Tauri nothing is kept. */
@Injectable({ providedIn: 'root', useFactory: () => new TauriFolderMemoryApi() })
export abstract class FolderMemoryApi {
  abstract load(): Promise<LoadedFolderMemory>;
  /** Replaces the file (empty = forget everything). Rejects with an `FsError`. */
  abstract save(memory: FolderMemoryFile): Promise<void>;
}

@Injectable()
export class TauriFolderMemoryApi extends FolderMemoryApi {
  async load(): Promise<LoadedFolderMemory> {
    if (!isTauri()) {
      return { value: EMPTY_FOLDER_MEMORY, warning: null };
    }
    try {
      return await invoke<LoadedFolderMemory>('load_folder_memory');
    } catch (err) {
      throw toFsError(err);
    }
  }

  async save(memory: FolderMemoryFile): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke<void>('save_folder_memory', { memory });
    } catch (err) {
      throw toFsError(err);
    }
  }
}
