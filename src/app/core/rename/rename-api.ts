import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { LoadedPresets, RenameItem, RenamePlan, RenamePresets } from './rename.models';

/**
 * Facade for the multi-rename commands (Rust `jobs/rename.rs`, `rename_presets.rs`).
 * The rename itself is a job (`JobsStore.start({ kind: 'rename', … })`). Rejects with an `FsError`.
 */
export abstract class RenameApi {
  /** Checks the pairs against each other and the disk; writes nothing. */
  abstract plan(items: readonly RenameItem[]): Promise<RenamePlan>;
  /** Undoes a rename job (`null` = the last one); resolves with the id of the undo job. */
  abstract undo(jobId: string | null): Promise<string>;
  abstract loadPresets(): Promise<LoadedPresets>;
  abstract savePresets(presets: RenamePresets): Promise<void>;
}

@Injectable()
export class TauriRenameApi extends RenameApi {
  plan(items: readonly RenameItem[]): Promise<RenamePlan> {
    return call<RenamePlan>('plan_rename', { items });
  }

  undo(jobId: string | null): Promise<string> {
    return call<string>('undo_rename', { jobId });
  }

  loadPresets(): Promise<LoadedPresets> {
    return call<LoadedPresets>('load_rename_presets', {});
  }

  savePresets(presets: RenamePresets): Promise<void> {
    return call<void>('save_rename_presets', { presets });
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}
