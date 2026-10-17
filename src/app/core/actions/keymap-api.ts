import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { RawBindings } from './keymap';

export interface LoadedOverride {
  readonly bindings: RawBindings;
  readonly warning: string | null;
}

/** Facade for the shortcut override file (Rust `keymap.rs`). */
export abstract class KeymapApi {
  abstract load(): Promise<LoadedOverride>;
  /** Rejects with an `FsError`. */
  abstract save(bindings: RawBindings): Promise<void>;
}

@Injectable()
export class TauriKeymapApi extends KeymapApi {
  async load(): Promise<LoadedOverride> {
    if (!isTauri()) {
      return { bindings: {}, warning: null };
    }
    try {
      return await invoke<LoadedOverride>('load_keymap_override');
    } catch (err) {
      throw toFsError(err);
    }
  }

  async save(bindings: RawBindings): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke<void>('save_keymap_override', { bindings });
    } catch (err) {
      throw toFsError(err);
    }
  }
}
