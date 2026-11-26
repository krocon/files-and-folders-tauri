import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { DescribedPaths } from '../watch/watch.models';

/**
 * The files in the system clipboard – copied in Finder, Explorer or Files and
 * pasted into a panel (`PASTE_FILES`). Rust reads the clipboard and describes the
 * entries like dropped paths; nothing is copied by this call.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriFileClipboardApi() })
export abstract class FileClipboardApi {
  /** Empty `entries` when the clipboard holds no files. */
  abstract readFiles(): Promise<DescribedPaths>;
}

@Injectable()
export class TauriFileClipboardApi extends FileClipboardApi {
  async readFiles(): Promise<DescribedPaths> {
    if (!isTauri()) {
      throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
    }
    try {
      return await invoke<DescribedPaths>('clipboard_files');
    } catch (err) {
      throw toFsError(err);
    }
  }
}
