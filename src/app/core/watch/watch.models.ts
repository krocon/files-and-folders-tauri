import { DirEntry } from '../fs/fs.models';

/** How a folder is watched (design 012 E2). Keep in sync with Rust `watch/mod.rs`. */
export type WatchMode = 'native' | 'poll' | 'off';

export interface WatchStatus {
  readonly dir: string;
  readonly mode: WatchMode;
  /** `network`, or the watcher error (for `poll`/`off`). */
  readonly reason: string | null;
}

/** Debounced changes of a watched folder (design 012 E3). */
export type WatchEvent =
  | {
      readonly type: 'changes';
      readonly dir: string;
      /** Entries that exist now – new or changed. */
      readonly upserted: readonly DirEntry[];
      /** Paths that are gone. */
      readonly removed: readonly string[];
    }
  /** Too many changes or lost events: reload once. */
  | { readonly type: 'rescan'; readonly dir: string }
  /** The folder itself was deleted or renamed. */
  | { readonly type: 'gone'; readonly dir: string };

/** Paths dropped onto the window, described like listing entries (design 012 E6). */
export interface DescribedPaths {
  readonly entries: readonly DirEntry[];
  /** Common folder of all entries, null if they come from several folders. */
  readonly parent: string | null;
  readonly missing: number;
}
