import { FolderMemoryApi } from '../app/core/memory/folder-memory-api';
import {
  EMPTY_FOLDER_MEMORY,
  FolderMemoryFile,
  LoadedFolderMemory,
} from '../app/core/memory/folder-memory.models';

/** In-memory FolderMemoryApi: `loaded` is returned by `load`, every `save` is recorded. */
export class FakeFolderMemoryApi extends FolderMemoryApi {
  loaded: LoadedFolderMemory = { value: EMPTY_FOLDER_MEMORY, warning: null };
  readonly saved: FolderMemoryFile[] = [];
  failLoad = false;

  load(): Promise<LoadedFolderMemory> {
    if (this.failLoad) {
      return Promise.reject({ code: 'io', message: 'unreadable', path: null });
    }
    return Promise.resolve(structuredClone(this.loaded));
  }

  save(memory: FolderMemoryFile): Promise<void> {
    this.saved.push(structuredClone(memory));
    return Promise.resolve();
  }
}
