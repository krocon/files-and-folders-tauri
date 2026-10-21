import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { isRemotePath } from '../remote/remote-path';
import { SettingsStore } from '../settings/settings.store';
import { Side } from '../session/session.models';
import { WatchApi } from './watch-api';
import { WatchEvent, WatchStatus } from './watch.models';

/**
 * A folder changed this long before its listing was requested still counts as
 * "maybe changed after the listing" (mtime granularity: FAT 2 s; review 012 #6).
 */
export const MTIME_SLACK_MS = 2000;

/**
 * Watches the folders shown by the two panels (design 012 E2): each panel
 * reports its folder, the union goes to Rust (`watch_dirs`) once per change,
 * events are handed to the panels.
 */
@Injectable({ providedIn: 'root' })
export class WatchService {
  /** Optional: specs without a backend simply do not watch. */
  private readonly api = inject(WatchApi, { optional: true });
  private readonly settings = inject(SettingsStore);
  private readonly dirs = new Map<Side, string | null>();
  /** When the panels' listings were requested (for the first watch of a folder). */
  private readonly listedAt = new Map<string, number>();
  private inFlight = false;
  private again = false;
  private readonly listeners = new Set<(event: WatchEvent) => void>();
  private subscribed: Promise<void> | null = null;

  constructor() {
    // switching the polling setting re-sends the folders
    let first = true;
    effect(() => {
      this.settings.get('watch.pollNetwork');
      untracked(() => {
        if (!first) {
          this.schedule();
        }
        first = false;
      });
    });
  }
  private sentKey: string | null = null;
  private scheduled = false;
  private seq = 0;

  /** How each watched folder is watched (for the status line). */
  readonly statuses = signal<ReadonlyMap<string, WatchStatus>>(new Map());

  /**
   * The folder a panel shows now (`null`: none / panel gone); `listedAt`: when
   * its listing was requested – a change between listing and watch triggers one reload.
   */
  setPanelDir(side: Side, folder: string | null, listedAt?: number): void {
    // server folders are not watched (design 034 §4.3): Ctrl+R reloads them
    const dir = isRemotePath(folder) ? null : folder;
    if (this.dirs.get(side) === dir) {
      return;
    }
    this.dirs.set(side, dir);
    if (dir !== null && listedAt !== undefined) {
      this.listedAt.set(dir, listedAt);
    }
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

  /**
   * One `watch_dirs` call at a time (review 012 #1): Rust handles the calls on
   * a thread pool, a newer set could otherwise be overtaken by an older one.
   * Changes meanwhile are sent once the running call is answered.
   */
  private async flush(): Promise<void> {
    const api = this.api;
    if (!api) {
      return;
    }
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const dirs = this.watchedDirs();
    // polling of network folders is a setting (design 012 E2 / 015)
    const poll = this.settings.get('watch.pollNetwork');
    const key = `${poll}\u0001${dirs.join('\0')}`;
    if (key === this.sentKey) {
      return;
    }
    this.inFlight = true;
    this.sentKey = key;
    const seq = ++this.seq;
    try {
      await this.ensureSubscribed();
      const result = await api.watchDirs(dirs, poll);
      if (seq === this.seq) {
        const before = this.statuses();
        this.statuses.set(new Map(result.map((s) => [s.dir, s])));
        this.reloadIfChanged(result, before);
      }
    } catch {
      // not watched: the panels still reload after jobs and on Ctrl+R
      if (seq === this.seq) {
        this.sentKey = null;
        this.statuses.set(new Map());
      }
    } finally {
      this.inFlight = false;
      if (this.again) {
        this.again = false;
        void this.flush();
      }
    }
  }

  /** A folder changed between its listing and its first watch: one reload (review 012 #6). */
  private reloadIfChanged(
    result: readonly WatchStatus[],
    before: ReadonlyMap<string, WatchStatus>,
  ): void {
    for (const s of result) {
      const listedAt = this.listedAt.get(s.dir);
      this.listedAt.delete(s.dir);
      const wasWatched = (before.get(s.dir)?.mode ?? 'off') !== 'off';
      if (
        !wasWatched &&
        s.mode !== 'off' &&
        listedAt !== undefined &&
        s.modifiedMs !== null &&
        s.modifiedMs >= listedAt - MTIME_SLACK_MS
      ) {
        for (const l of [...this.listeners]) {
          l({ type: 'rescan', dir: s.dir });
        }
      }
    }
  }
}
