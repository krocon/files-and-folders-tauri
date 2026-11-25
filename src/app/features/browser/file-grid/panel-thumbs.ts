import { signal } from '@angular/core';
import { ImageOverviewApi } from '../../../core/imageoverview/image-overview-api';
import { OverviewItem } from '../../../core/imageoverview/image-overview.models';

interface Listed {
  readonly root: string;
  id: string | null;
  readonly items: Map<string, OverviewItem>;
  done: boolean;
}

/**
 * Thumbnails of a panel's folder (design 041 E6). Nothing of its own: it opens an image
 * overview of the folder (design 074, without subfolders) and hands out the `fnfthumb`
 * URLs of the images Rust listed – cache, pool and limits are those of the overview.
 * A folder listed again (a refresh) keeps showing the old thumbnails until the new list
 * is complete. One instance per panel; `dispose` closes what is open.
 */
export class PanelThumbs {
  /** Bumped when thumbnails became available or went away – the grid repaints. */
  readonly version = signal(0);

  private shown: Listed | null = null;
  private loading: Listed | null = null;
  private key: string | null = null;
  private seq = 0;

  constructor(private readonly api: ImageOverviewApi) {}

  /**
   * The folder whose images to show; `root` null = none (archives, servers, result
   * tabs). `stamp` changes when the folder may hold other pictures.
   */
  show(root: string | null, stamp: string): void {
    const key = root === null ? null : `${stamp}\n${root}`;
    if (key === this.key) {
      return;
    }
    this.key = key;
    const seq = ++this.seq;
    this.close(this.loading);
    this.loading = null;
    if (root === null) {
      this.close(this.shown);
      this.shown = null;
      this.version.update((v) => v + 1);
      return;
    }
    if (this.shown && this.shown.root !== root) {
      // another folder: its pictures are of no use here
      this.close(this.shown);
      this.shown = null;
      this.version.update((v) => v + 1);
    }
    const next: Listed = { root, id: null, items: new Map(), done: false };
    this.loading = next;
    this.api
      .open(root, false, (e) => {
        if (seq !== this.seq) {
          return;
        }
        if (e.kind === 'items') {
          for (const item of e.items) {
            next.items.set(item.path, item);
          }
          if (!this.shown) {
            this.version.update((v) => v + 1); // a first listing shows as it arrives
          }
        } else {
          next.done = true;
          this.promote(next);
        }
      })
      .then(
        (id) => {
          next.id = id;
          if (seq !== this.seq) {
            this.close(next);
          } else if (next.done) {
            this.promote(next);
          } else if (!this.shown) {
            this.version.update((v) => v + 1);
          }
        },
        () => {
          // no thumbnails (no backend, a folder that went away): the tiles keep their icons
          if (seq === this.seq) {
            this.loading = null;
          }
        },
      );
  }

  /** The new list is complete: it replaces the one shown. */
  private promote(next: Listed): void {
    if (this.loading !== next || next.id === null) {
      return;
    }
    this.close(this.shown);
    this.shown = next;
    this.loading = null;
    this.version.update((v) => v + 1);
  }

  /** URL of the thumbnail of `path` in `step`, null if Rust listed no picture for it. */
  url(path: string, step: number): string | null {
    const from = this.shown ?? this.loading;
    const item = from?.items.get(path);
    if (!from || from.id === null || !item || item.kind === 'unsupported') {
      return null;
    }
    return this.api.thumbUrl(from.id, item.index, step, item.modifiedMs);
  }

  private close(listed: Listed | null): void {
    if (listed?.id) {
      void this.api.close(listed.id).catch(() => undefined);
    }
  }

  dispose(): void {
    this.seq++;
    this.key = null;
    this.close(this.shown);
    this.close(this.loading);
    this.shown = null;
    this.loading = null;
  }
}
