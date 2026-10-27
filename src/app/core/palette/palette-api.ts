import { Injectable } from '@angular/core';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import {
  IndexStatus,
  NO_INDEX,
  PaletteConfig,
  PaletteEvent,
  PaletteRequest,
} from './palette.models';

/**
 * Facade for the palette commands (design 043, Rust `commands/palette.rs`). A query
 * streams its hits over its own channel; a new query cancels the running one in Rust.
 * Rejects with an `FsError`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriPaletteApi() })
export abstract class PaletteApi {
  abstract configure(config: PaletteConfig): Promise<IndexStatus>;
  abstract status(): Promise<IndexStatus>;
  /** Resolves with the query id once started; events carry that id. */
  abstract query(request: PaletteRequest, onEvent: (e: PaletteEvent) => void): Promise<number>;
  /** Cancels query `id` if it still runs (Rust ignores an id that is no longer current). */
  abstract cancel(id: number | null): Promise<void>;
  abstract rebuild(): Promise<IndexStatus>;
  abstract clear(): Promise<IndexStatus>;
}

@Injectable()
export class TauriPaletteApi extends PaletteApi {
  configure(config: PaletteConfig): Promise<IndexStatus> {
    return isTauri() ? call('palette_configure', { config }) : Promise.resolve(NO_INDEX);
  }

  status(): Promise<IndexStatus> {
    return isTauri() ? call('palette_status', {}) : Promise.resolve(NO_INDEX);
  }

  query(request: PaletteRequest, onEvent: (e: PaletteEvent) => void): Promise<number> {
    const channel = new Channel<PaletteEvent>();
    channel.onmessage = onEvent;
    return call('palette_query', { request, onEvent: channel });
  }

  cancel(id: number | null): Promise<void> {
    return isTauri() ? call('palette_cancel', { id }) : Promise.resolve();
  }

  rebuild(): Promise<IndexStatus> {
    return call('palette_rebuild', {});
  }

  clear(): Promise<IndexStatus> {
    return call('palette_clear', {});
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
