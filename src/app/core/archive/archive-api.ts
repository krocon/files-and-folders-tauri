import { inject, Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';

/**
 * Facade for archive passwords (design 025 E4). The password goes to Rust once,
 * is checked there and kept in memory for this run only – the frontend never
 * stores it. Rejects with an `FsError` (`archive_password_wrong`, …).
 */
@Injectable({ providedIn: 'root', useFactory: () => inject(TauriArchiveApi) })
export abstract class ArchiveApi {
  abstract setPassword(archive: string, password: string): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class TauriArchiveApi extends ArchiveApi {
  async setPassword(archive: string, password: string): Promise<void> {
    if (!isTauri()) {
      throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
    }
    try {
      await invoke<void>('set_archive_password', { archive, password });
    } catch (err) {
      throw toFsError(err);
    }
  }
}
