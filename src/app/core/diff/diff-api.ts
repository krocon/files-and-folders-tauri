import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { DiffOptions, DiffResult } from './diff.models';

/** Facade for `diff_files` (design 037). */
@Injectable({ providedIn: 'root', useFactory: () => new TauriDiffApi() })
export abstract class DiffApi {
  /** Rejects with an `FsError`. */
  abstract diff(left: string, right: string, options: DiffOptions): Promise<DiffResult>;
}

@Injectable()
export class TauriDiffApi extends DiffApi {
  async diff(left: string, right: string, options: DiffOptions): Promise<DiffResult> {
    if (!isTauri()) {
      throw { code: 'unknown', message: 'desktop backend is not available', path: null };
    }
    try {
      return await invoke<DiffResult>('diff_files', { left, right, options });
    } catch (err) {
      throw toFsError(err);
    }
  }
}
