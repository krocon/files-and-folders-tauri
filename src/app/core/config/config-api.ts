import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { ButtonSetsOverride, ButtonsOverride, FileType, Loaded } from './config.models';

/**
 * Facade for the user files of the button bar and the file types (design 022).
 * Root default = Tauri; outside Tauri there are no files (built-in values).
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriConfigApi() })
export abstract class ConfigApi {
  abstract loadButtons(): Promise<Loaded<ButtonsOverride>>;
  /** Rejects with an `FsError`. */
  abstract saveButtons(sets: ButtonSetsOverride): Promise<void>;
  /** `value: null` = no user file, the built-in categories apply. */
  abstract loadFileTypes(): Promise<Loaded<readonly FileType[] | null>>;
  /** `null` removes the user file. Rejects with an `FsError`. */
  abstract saveFileTypes(categories: readonly FileType[] | null): Promise<void>;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toFsError(err);
  }
}

@Injectable()
export class TauriConfigApi extends ConfigApi {
  loadButtons(): Promise<Loaded<ButtonsOverride>> {
    if (!isTauri()) {
      return Promise.resolve({ value: { sets: {} }, warning: null });
    }
    return call('load_buttons');
  }

  async saveButtons(sets: ButtonSetsOverride): Promise<void> {
    if (isTauri()) {
      await call<void>('save_buttons', { sets });
    }
  }

  loadFileTypes(): Promise<Loaded<readonly FileType[] | null>> {
    if (!isTauri()) {
      return Promise.resolve({ value: null, warning: null });
    }
    return call('load_file_types');
  }

  async saveFileTypes(categories: readonly FileType[] | null): Promise<void> {
    if (isTauri()) {
      await call<void>('save_file_types', { categories });
    }
  }
}
