import { Injectable } from '@angular/core';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { DescribedPaths, WatchEvent, WatchStatus } from './watch.models';

/** Facade for the watch commands (Rust `commands/watch.rs`). Rejects with an `FsError`. */
export abstract class WatchApi {
  /** Receives the events of all watched folders. */
  abstract subscribe(onEvent: (event: WatchEvent) => void): Promise<void>;
  /** Watches exactly these folders (replaces the previous set). */
  abstract watchDirs(dirs: readonly string[], pollNetwork: boolean): Promise<WatchStatus[]>;
  /** Describes absolute paths (dropped from the system). */
  abstract describePaths(paths: readonly string[]): Promise<DescribedPaths>;
}

@Injectable()
export class TauriWatchApi extends WatchApi {
  async subscribe(onEvent: (event: WatchEvent) => void): Promise<void> {
    if (!isTauri()) {
      return;
    }
    const channel = new Channel<WatchEvent>();
    channel.onmessage = onEvent;
    await call<void>('subscribe_watch', { onEvent: channel });
  }

  watchDirs(dirs: readonly string[], pollNetwork: boolean): Promise<WatchStatus[]> {
    if (!isTauri()) {
      return Promise.resolve([]);
    }
    return call<WatchStatus[]>('watch_dirs', { dirs, pollNetwork });
  }

  describePaths(paths: readonly string[]): Promise<DescribedPaths> {
    return call<DescribedPaths>('describe_paths', { paths });
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
