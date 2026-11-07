import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { FileActionRule, LoadedFileActions, SavedFileActions } from './file-actions.models';

/**
 * Facade for the double-click actions (design 072, Rust `commands/file_actions.rs`). Rejects
 * with an `FsError`. Outside Tauri there are no rules and nothing runs.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriFileActionsApi() })
export abstract class FileActionsApi {
  /** (Re)loads `file-actions.json`. */
  abstract load(): Promise<LoadedFileActions>;
  /** Writes `file-actions.json` – only if no rule has a problem (`saved: false` otherwise). */
  abstract save(rules: readonly FileActionRule[]): Promise<SavedFileActions>;
  /**
   * Runs rule `id` on `file` (program and arguments come from the file only). A default-app
   * launcher rejects an executable with `executable` unless `allowExecutable`.
   */
  abstract run(
    id: string,
    file: string,
    targetDir: string | null,
    allowExecutable?: boolean,
  ): Promise<number>;
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}

function noBackend<T>(): Promise<T> {
  return Promise.reject(
    toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null }),
  );
}

@Injectable()
export class TauriFileActionsApi extends FileActionsApi {
  load(): Promise<LoadedFileActions> {
    if (!isTauri()) {
      return Promise.resolve({ rules: [], warning: null, problems: [] });
    }
    return call('load_file_actions', {});
  }

  save(rules: readonly FileActionRule[]): Promise<SavedFileActions> {
    return isTauri() ? call('save_file_actions', { rules }) : noBackend();
  }

  run(
    id: string,
    file: string,
    targetDir: string | null,
    allowExecutable = false,
  ): Promise<number> {
    return isTauri()
      ? call('run_file_action', { id, file, targetDir, allowExecutable })
      : noBackend();
  }
}
