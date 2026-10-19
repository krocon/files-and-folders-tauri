import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { ShellRunResult } from './shell.models';

/**
 * The one way to run a shell command (design 021 E1): `run_shell` in Rust.
 * **Only `ShellBar` may import this file** – a spec scans the sources. Everything
 * else of the shell bar (quoting, history) is in `ShellSupportApi`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriShellApi() })
export abstract class ShellApi {
  /** Runs one typed line in `cwd` (`cd`/`clear` are answered without a shell). */
  abstract run(cwd: string, command: string): Promise<ShellRunResult>;
}

@Injectable()
export class TauriShellApi extends ShellApi {
  run(cwd: string, command: string): Promise<ShellRunResult> {
    return call<ShellRunResult>('run_shell', { cwd, command });
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
