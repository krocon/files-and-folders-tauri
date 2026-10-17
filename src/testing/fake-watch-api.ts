import { WatchApi } from '../app/core/watch/watch-api';
import { DescribedPaths, WatchEvent, WatchStatus, WatchMode } from '../app/core/watch/watch.models';
import { DirEntry } from '../app/core/fs/fs.models';
import { DragDropApi, OsDragEvent } from '../app/core/dnd/drag-drop-api';

/** In-memory WatchApi: records `watchDirs` calls, `emit` simulates the backend. */
export class FakeWatchApi extends WatchApi {
  calls: string[][] = [];
  /** Mode per folder (default native). */
  modes = new Map<string, WatchMode>();
  described = new Map<string, DirEntry>();
  private listener: ((e: WatchEvent) => void) | null = null;

  subscribe(onEvent: (event: WatchEvent) => void): Promise<void> {
    this.listener = onEvent;
    return Promise.resolve();
  }

  watchDirs(dirs: readonly string[]): Promise<WatchStatus[]> {
    this.calls.push([...dirs]);
    return Promise.resolve(
      dirs.map((dir) => {
        const mode = this.modes.get(dir) ?? 'native';
        return { dir, mode, reason: mode === 'native' ? null : 'network' };
      }),
    );
  }

  describePaths(paths: readonly string[]): Promise<DescribedPaths> {
    const entries = paths.map((p) => this.described.get(p)).filter((e) => e !== undefined);
    return Promise.resolve({
      entries,
      parent: entries.length > 0 ? 'parent-of-dropped' : null,
      missing: paths.length - entries.length,
    });
  }

  emit(event: WatchEvent): void {
    this.listener?.(event);
  }
}

/** DragDropApi whose events tests fire with `emit`. */
export class FakeDragDropApi extends DragDropApi {
  private handler: ((e: OsDragEvent) => void) | null = null;

  listen(handler: (event: OsDragEvent) => void): Promise<() => void> {
    this.handler = handler;
    return Promise.resolve(() => (this.handler = null));
  }

  emit(event: OsDragEvent): void {
    this.handler?.(event);
  }
}
