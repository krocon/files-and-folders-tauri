import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { MrApply, MrApplyReport, MrScan } from './mr-import.models';

/**
 * Facade for the mr import (design 026, Rust `commands/mr_import.rs`). Rejects with an
 * `FsError`; outside Tauri there is nothing to read.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriMrImportApi() })
export abstract class MrImportApi {
  /** Finds mr's `assets` folder at or below `path` and translates its files. */
  abstract scan(path: string): Promise<MrScan>;
  /** Writes the planned parts (backups first). */
  abstract apply(plan: MrApply): Promise<MrApplyReport>;
}

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toFsError(err);
  }
}

@Injectable()
export class TauriMrImportApi extends MrImportApi {
  scan(path: string): Promise<MrScan> {
    return call<MrScan>('scan_old_config', { path });
  }

  apply(plan: MrApply): Promise<MrApplyReport> {
    return call<MrApplyReport>('apply_old_config', { plan });
  }
}
