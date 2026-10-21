import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import {
  LoadedStarter,
  SavedStarter,
  StarterContext,
  StarterItem,
  StarterRun,
} from './starter.models';

/**
 * Facade for the starter menu (design 032, Rust `commands/starter.rs`). Rejects with an
 * `FsError`. Outside Tauri the menu is empty and nothing runs.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriStarterApi() })
export abstract class StarterApi {
  /** (Re)loads `starter.json`. */
  abstract load(): Promise<LoadedStarter>;
  /** Writes `starter.json` – only if no entry has a problem (`saved: false` otherwise). */
  abstract save(items: readonly StarterItem[]): Promise<SavedStarter>;
  /**
   * Runs the entry `id` (program and arguments come from the file only). A default-app
   * launcher rejects an executable with `executable` unless `allowExecutable`.
   */
  abstract run(id: string, context: StarterContext, allowExecutable?: boolean): Promise<StarterRun>;
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}

@Injectable()
export class TauriStarterApi extends StarterApi {
  load(): Promise<LoadedStarter> {
    if (!isTauri()) {
      return Promise.resolve({ items: [], warning: null, problems: [], file: null });
    }
    return call('load_starter', {});
  }

  save(items: readonly StarterItem[]): Promise<SavedStarter> {
    if (!isTauri()) {
      return Promise.reject(
        toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null }),
      );
    }
    return call('save_starter', { items });
  }

  run(id: string, context: StarterContext, allowExecutable = false): Promise<StarterRun> {
    if (!isTauri()) {
      return Promise.reject(
        toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null }),
      );
    }
    return call('run_starter', { id, context, allowExecutable });
  }
}
