import { inject, Injectable, signal } from '@angular/core';
import { Side } from '../session/session.models';
import { WatchApi } from './watch-api';
import { WatchEvent, WatchStatus } from './watch.models';

/** Polling of network folders – a setting of prompt 015; until then off (design 012 E2). */
export const POLL_NETWORK = false;

/**
 * Watches the folders shown by the two panels (design 012 E2): each panel
 * reports its folder, the union goes to Rust (`watch_dirs`) once per change,
 * events are handed to the panels.
 */
@Injectable({ providedIn: 'root' })
export class WatchService {
  /** Optional: specs without a backend simply do not watch. */
  private readonly api = inject(WatchApi, { optional: true });
  private readonly dirs = new Map<Side, string | null>();
  private readonly listeners = new Set<(event: WatchEvent) => void>();
  private subscribed: Promise<void> | null = null;
  private sentKey: string | null = null;
  private scheduled = false;
  private seq = 0;

  /** How each watched folder is watched (for the status line). */
  readonly statuses = signal<ReadonlyMap<string, WatchStatus>>(new Map());

  /** The folder a panel shows now (`null`: none / panel gone). */
  setPanelDir(side: Side, dir: string | null): void {
    if (this.dirs.get(side) === dir) {
      return;
    }
    this.dirs.set(side, dir);
    this.schedule();
  }

  /** Listens to the events of all watched folders. */
  on(listener: (event: WatchEvent) => void): () => void {
    this.listeners.add(listener);
    this.ensureSubscribed();
    return () => this.listeners.delete(listener);
  }

  status(dir: string | null): WatchStatus | null {
    return dir === null ? null : (this.statuses().get(dir) ?? null);
  }

  /** The folders to watch: both panels, each once. */
  watchedDirs(): string[] {
    return [...new Set([...this.dirs.values()].filter((d): d is string => d !== null))];
  }

  private ensureSubscribed(): Promise<void> {
    if (!this.subscribed && this.api) {
      this.subscribed = this.api
        .subscribe((event) => {
          for (const l of [...this.listeners]) {
            l(event);
          }
        })
        .catch(() => undefined);
    }
    return this.subscribed ?? Promise.resolve();
  }

  /** Several panels change at once (tab switch, start): one call to Rust. */
  private schedule(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const api = this.api;
    const dirs = this.watchedDirs();
    const key = dirs.join('\0');
    if (!api || key === this.sentKey) {
      return;
    }
    this.sentKey = key;
    const seq = ++this.seq;
    await this.ensureSubscribed();
    try {
      const result = await api.watchDirs(dirs, POLL_NETWORK);
      if (seq === this.seq) {
        this.statuses.set(new Map(result.map((s) => [s.dir, s])));
      }
    } catch {
      // not watched: the panels still reload after jobs and on Ctrl+R
      if (seq === this.seq) {
        this.sentKey = null;
        this.statuses.set(new Map());
      }
    }
  }
}
