import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';

/**
 * Shell bar helpers that never run anything (design 021 E12/E14): quoting of
 * inserted names for the shell Rust will use, and the history (Rust writes it
 * itself when a line runs).
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriShellSupportApi() })
export abstract class ShellSupportApi {
  /** Names (`names = true`, a leading `-` becomes `./-…`) or full paths, quoted and joined. */
  abstract quote(items: readonly string[], names: boolean): Promise<string>;
  /** Newest first. */
  abstract loadHistory(): Promise<readonly string[]>;
  abstract clearHistory(): Promise<void>;
}

@Injectable()
export class TauriShellSupportApi extends ShellSupportApi {
  quote(items: readonly string[], names: boolean): Promise<string> {
    return call<string>('shell_quote', { items, names });
  }

  loadHistory(): Promise<readonly string[]> {
    return call<string[]>('load_shell_history', {});
  }

  clearHistory(): Promise<void> {
    return call<void>('clear_shell_history', {});
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
