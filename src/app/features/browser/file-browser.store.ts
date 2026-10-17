import { computed, inject, Injectable, signal } from '@angular/core';
import { FsApi } from '../../core/fs/fs-api';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, DirectoryListing, FsError, isNavigableDir } from '../../core/fs/fs.models';

/**
 * State of one file panel. Provided per component (not root) so that a later
 * dual-pane / tab layout can create independent instances.
 */
@Injectable()
export class FileBrowserStore {
  private readonly api = inject(FsApi);
  /** Monotonic id to drop responses of superseded requests. */
  private requestSeq = 0;

  readonly listing = signal<DirectoryListing | null>(null);
  readonly loading = signal(false);
  readonly error = signal<FsError | null>(null);
  readonly selectedPath = signal<string | null>(null);

  readonly path = computed(() => this.listing()?.path ?? null);
  readonly entries = computed<readonly DirEntry[]>(() => this.listing()?.entries ?? []);
  readonly parent = computed(() => this.listing()?.parent ?? null);
  readonly canGoUp = computed(() => this.parent() !== null && !this.loading());
  readonly selectedIndex = computed(() => {
    const sel = this.selectedPath();
    return sel === null ? -1 : this.entries().findIndex((e) => e.path === sel);
  });
  readonly selectedEntry = computed(() => this.entries()[this.selectedIndex()] ?? null);

  /**
   * Loads a directory (home directory when `path` is omitted).
   * On failure the previous listing stays visible and `error` is set.
   */
  async load(path?: string, options: { select?: string | null } = {}): Promise<void> {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    try {
      const listing = await this.api.listDirectory(path);
      if (seq !== this.requestSeq) {
        return;
      }
      this.listing.set(listing);
      this.error.set(null);
      const wanted = options.select ?? null;
      const keep = wanted !== null && listing.entries.some((e) => e.path === wanted);
      this.selectedPath.set(keep ? wanted : (listing.entries[0]?.path ?? null));
    } catch (err) {
      if (seq !== this.requestSeq) {
        return;
      }
      this.error.set(toFsError(err));
    } finally {
      if (seq === this.requestSeq) {
        this.loading.set(false);
      }
    }
  }

  /** Opens a directory entry; files are only selected in this version. */
  open(entry: DirEntry): Promise<void> {
    this.select(entry);
    if (isNavigableDir(entry) && !entry.lossyName) {
      return this.load(entry.path);
    }
    return Promise.resolve();
  }

  /** Navigates to the parent and re-selects the folder we came from. */
  up(): Promise<void> {
    const parent = this.parent();
    if (parent === null) {
      return Promise.resolve();
    }
    return this.load(parent, { select: this.path() });
  }

  refresh(): Promise<void> {
    const path = this.path();
    return this.load(path ?? undefined, { select: this.selectedPath() });
  }

  select(entry: DirEntry | null): void {
    this.selectedPath.set(entry?.path ?? null);
  }

  /** Moves the selection by `delta` rows, clamped to the list bounds. */
  moveSelection(delta: number): void {
    const entries = this.entries();
    if (entries.length === 0) {
      return;
    }
    const current = this.selectedIndex();
    const base = current < 0 ? (delta > 0 ? -1 : entries.length) : current;
    const next = Math.min(entries.length - 1, Math.max(0, base + delta));
    this.selectedPath.set(entries[next].path);
  }

  selectEdge(edge: 'first' | 'last'): void {
    const entries = this.entries();
    if (entries.length > 0) {
      this.selectedPath.set(entries[edge === 'first' ? 0 : entries.length - 1].path);
    }
  }

  dismissError(): void {
    this.error.set(null);
  }
}
