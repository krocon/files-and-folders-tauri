import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';

/** Facade for dragging entries out of the window into other programs (design 028). */
export abstract class OsDragApi {
  /** Starts a system drag ("copy") of these entries; Rust checks the paths. */
  abstract startOsDrag(paths: readonly string[]): Promise<void>;
}

@Injectable()
export class TauriOsDragApi extends OsDragApi {
  async startOsDrag(paths: readonly string[]): Promise<void> {
    if (!isTauri()) {
      throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
    }
    try {
      await invoke<void>('start_os_drag', { paths });
    } catch (err) {
      throw toFsError(err);
    }
  }
}
