import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { LoadedTools, ToolContext, Volume } from './os.models';

/**
 * Facade for the OS integration of design 011 (Rust `platform/volumes.rs`,
 * `platform/desktop.rs`, `tools.rs`). Rejects with an `FsError`. Root default = Tauri
 * (outside Tauri every call rejects with `no_backend`), so components that only
 * read the drives need no provider in tests.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriOsApi() })
export abstract class OsApi {
  /** Drives / volumes / mount points; never hangs on a dead network mount. */
  abstract listVolumes(): Promise<readonly Volume[]>;
  /** Shows the entry in Finder / Explorer / the desktop's file manager. */
  abstract reveal(path: string): Promise<void>;
  /** Opens a terminal in the folder. */
  abstract openTerminal(dir: string): Promise<void>;
  /** (Re)loads `tools.json` (merged with the defaults of the OS). */
  abstract loadTools(): Promise<LoadedTools>;
  /** Starts a configured tool; returns the number of started processes. */
  abstract runTool(toolId: string, context: ToolContext): Promise<number>;
  /** Creates `tools.json` if needed and opens it with the default app; returns its path. */
  abstract openToolsConfig(): Promise<string>;
}

@Injectable()
export class TauriOsApi extends OsApi {
  listVolumes(): Promise<readonly Volume[]> {
    return call<Volume[]>('list_volumes', {});
  }

  reveal(path: string): Promise<void> {
    return call<void>('reveal_in_file_manager', { path });
  }

  openTerminal(dir: string): Promise<void> {
    return call<void>('open_terminal', { dir });
  }

  loadTools(): Promise<LoadedTools> {
    return call<LoadedTools>('load_tools', {});
  }

  runTool(toolId: string, context: ToolContext): Promise<number> {
    return call<number>('run_tool', { toolId, context });
  }

  openToolsConfig(): Promise<string> {
    return call<string>('open_tools_config', {});
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
