import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isParentRow } from '../../core/fs/fs.models';
import { PreviewApi } from '../../core/preview/preview-api';
import { Preview } from '../../core/preview/preview.models';
import { otherSide, WorkspaceStore } from '../workspace/workspace.store';
import { DEFAULT_CONTEXT, PreviewContext } from './preview-providers';

/** Delay after a cursor move before the preview is read. */
export const QUICK_VIEW_DEBOUNCE_MS = 150;
/** Text limit of the quick view (smaller than the viewer's). */
export const QUICK_VIEW_TEXT_BYTES = 256 * 1024;

/**
 * Quick view (TC Strg+Q, design 010 E4): the target panel shows the preview of
 * the entry under the cursor of the active panel; debounced, stale answers
 * are dropped.
 */
@Injectable({ providedIn: 'root' })
export class QuickViewStore {
  private readonly api = inject(PreviewApi);
  private readonly ws = inject(WorkspaceStore);

  readonly on = signal(false);
  readonly entry = signal<DirEntry | null>(null);
  readonly preview = signal<Preview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<FsError | null>(null);
  readonly context: PreviewContext = { ...DEFAULT_CONTEXT, compact: true, wrap: true };
  /** The side that shows the preview (the inactive one) while on. */
  readonly shownOn = computed(() => (this.on() ? otherSide(this.ws.activeSide()) : null));
  debounceMs = QUICK_VIEW_DEBOUNCE_MS;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      if (!this.on()) {
        untracked(() => this.reset());
        return;
      }
      const cursor = this.ws.panel(this.ws.activeSide())?.store.cursorEntry() ?? null;
      untracked(() => this.schedule(cursor));
    });
  }

  toggle(): void {
    this.on.update((v) => !v);
  }

  private schedule(entry: DirEntry | null): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!entry || isParentRow(entry)) {
      this.seq++;
      this.entry.set(null);
      this.preview.set(null);
      this.error.set(null);
      this.loading.set(false);
      return;
    }
    // Back on the entry that is shown or still loading (e.g. ↓↑ within the
    // debounce): keep that answer valid instead of invalidating it (review 1).
    if (this.entry()?.path === entry.path && (this.preview() || this.loading())) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load(entry, ++this.seq);
    }, this.debounceMs);
  }

  private async load(entry: DirEntry, seq: number): Promise<void> {
    this.entry.set(entry);
    this.loading.set(true);
    this.error.set(null);
    try {
      const p = await this.api.readPreview(entry.path, {
        maxTextBytes: QUICK_VIEW_TEXT_BYTES,
        imageSlot: 'quick',
      });
      if (seq === this.seq) {
        this.preview.set(p);
      }
    } catch (err) {
      if (seq === this.seq) {
        this.preview.set(null);
        this.error.set(toFsError(err));
      }
    } finally {
      if (seq === this.seq) {
        this.loading.set(false);
      }
    }
  }

  private reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.seq++;
    this.entry.set(null);
    this.preview.set(null);
    this.error.set(null);
    this.loading.set(false);
  }
}
