import { WatchApi } from '../app/core/watch/watch-api';
import { DescribedPaths, WatchEvent, WatchStatus, WatchMode } from '../app/core/watch/watch.models';
import { DirEntry } from '../app/core/fs/fs.models';
import { DragDropApi, OsDragEvent } from '../app/core/dnd/drag-drop-api';
import { OsDragApi } from '../app/core/dnd/os-drag-api';
import { FsError } from '../app/core/fs/fs.models';

/** In-memory WatchApi: records `watchDirs` calls, `emit` simulates the backend. */
export class FakeWatchApi extends WatchApi {
  calls: string[][] = [];
  /** Mode per folder (default native). */
  modes = new Map<string, WatchMode>();
  described = new Map<string, DirEntry>();
  /** Folder mtime reported with the status (default null). */
  modified = new Map<string, number>();
  /** While set, `watchDirs` answers only once it resolves. */
  hold: Promise<void> | null = null;
  private listener: ((e: WatchEvent) => void) | null = null;

  subscribe(onEvent: (event: WatchEvent) => void): Promise<void> {
    this.listener = onEvent;
    return Promise.resolve();
  }

  async watchDirs(dirs: readonly string[]): Promise<WatchStatus[]> {
    this.calls.push([...dirs]);
    if (this.hold) {
      await this.hold;
    }
    return dirs.map((dir) => {
      const mode = this.modes.get(dir) ?? 'native';
      return {
        dir,
        mode,
        reason: mode === 'native' ? null : 'network',
        modifiedMs: this.modified.get(dir) ?? null,
      };
    });
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

/** OsDragApi that records the dragged paths; `fail` makes the next start fail. */
export class FakeOsDragApi extends OsDragApi {
  started: string[][] = [];
  fail: FsError | null = null;

  startOsDrag(paths: readonly string[]): Promise<void> {
    if (this.fail) {
      const err = this.fail;
      this.fail = null;
      return Promise.reject(err);
    }
    this.started.push([...paths]);
    return Promise.resolve();
  }
}
