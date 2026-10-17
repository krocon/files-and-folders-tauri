import { computed, inject, Injectable, signal } from '@angular/core';
import type { TableStateIf } from '@guiexpert/table';
import { FsApi } from '../../core/fs/fs-api';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, DirectoryListing, FsError, isNavigableDir } from '../../core/fs/fs.models';
import { recordPerf, since } from '../../shared/perf';

const EMPTY_MARKS: ReadonlySet<string> = new Set<string>();

/**
 * State of one file panel. Provided per component (not root) so that a later
 * dual-pane / tab layout can create independent instances.
 *
 * - `cursorPath`: the one entry under the cursor (Total Commander "focus"),
 *   `null` = first displayed row.
 * - `marked`: entries marked for operations, keyed by path – survives sorting
 *   and filtering, cleared when the folder changes.
 *
 * The display order (sorting) belongs to the table; methods that depend on it
 * receive the displayed paths as an argument.
 */
@Injectable()
export class FileBrowserStore {
  private readonly api = inject(FsApi);
  /** Monotonic id to drop responses of superseded requests. */
  private requestSeq = 0;

  readonly listing = signal<DirectoryListing | null>(null);
  readonly loading = signal(false);
  readonly error = signal<FsError | null>(null);
  readonly cursorPath = signal<string | null>(null);
  readonly marked = signal<ReadonlySet<string>>(EMPTY_MARKS);

  /**
   * Table state (columns, sort, scroll) of a tab that is being opened; the file
   * list applies it together with the next listing (design 004 E2).
   */
  private pendingTableState: Partial<TableStateIf> | null = null;

  readonly path = computed(() => this.listing()?.path ?? null);
  readonly entries = computed<readonly DirEntry[]>(() => this.listing()?.entries ?? []);
  readonly parent = computed(() => this.listing()?.parent ?? null);
  readonly canGoUp = computed(() => this.parent() !== null && !this.loading());
  readonly cursorEntry = computed(() => {
    const path = this.cursorPath();
    return path === null ? null : (this.entries().find((e) => e.path === path) ?? null);
  });
  readonly markedEntries = computed(() => {
    const marked = this.marked();
    return marked.size === 0 ? [] : this.entries().filter((e) => marked.has(e.path));
  });

  /**
   * Loads a directory (home directory when `path` is omitted).
   * On failure the previous listing stays visible and `error` is set.
   * `cursor` = entry to put the cursor on (e.g. the folder we came from).
   */
  async load(path?: string, options: { cursor?: string | null } = {}): Promise<void> {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    try {
      const start = performance.now();
      const listing = await this.api.listDirectory(path);
      if (seq !== this.requestSeq) {
        return;
      }
      recordPerf('list_directory (Rust + IPC)', since(start), `${listing.entries.length} entries`);
      const samePath = listing.path === this.path();
      const paths = new Set(listing.entries.map((e) => e.path));
      this.listing.set(listing);
      this.error.set(null);
      const wanted = options.cursor ?? null;
      this.cursorPath.set(wanted !== null && paths.has(wanted) ? wanted : null);
      this.marked.set(samePath ? intersect(this.marked(), paths) : EMPTY_MARKS);
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

  /** Opens a directory entry; files only get the cursor in this version. */
  open(entry: DirEntry): Promise<void> {
    this.setCursor(entry.path);
    if (isNavigableDir(entry) && !entry.lossyName) {
      return this.load(entry.path);
    }
    return Promise.resolve();
  }

  /** Navigates to the parent and puts the cursor on the folder we came from. */
  up(): Promise<void> {
    const parent = this.parent();
    if (parent === null) {
      return Promise.resolve();
    }
    return this.load(parent, { cursor: this.path() });
  }

  /** Reloads the folder, keeping cursor and (still existing) marks. */
  refresh(): Promise<void> {
    const path = this.path();
    return this.load(path ?? undefined, { cursor: this.cursorPath() });
  }

  setCursor(path: string | null): void {
    this.cursorPath.set(path);
  }

  isMarked(path: string): boolean {
    return this.marked().has(path);
  }

  toggleMark(path: string): void {
    const next = new Set(this.marked());
    if (!next.delete(path)) {
      next.add(path);
    }
    this.marked.set(next);
  }

  setMarked(paths: readonly string[], marked: boolean): void {
    const next = new Set(this.marked());
    for (const p of paths) {
      if (marked) {
        next.add(p);
      } else {
        next.delete(p);
      }
    }
    this.marked.set(next);
  }

  /**
   * Marks all entries between `from` and `to` (inclusive) in the displayed
   * order – Shift+click. Unknown paths are ignored.
   */
  markRange(from: string, to: string, displayed: readonly string[]): void {
    const a = displayed.indexOf(from);
    const b = displayed.indexOf(to);
    if (a < 0 || b < 0) {
      return;
    }
    this.setMarked(displayed.slice(Math.min(a, b), Math.max(a, b) + 1), true);
  }

  markAll(displayed: readonly string[]): void {
    this.marked.set(new Set(displayed));
  }

  clearMarks(): void {
    this.marked.set(EMPTY_MARKS);
  }

  invertMarks(displayed: readonly string[]): void {
    const current = this.marked();
    this.marked.set(new Set(displayed.filter((p) => !current.has(p))));
  }

  setPendingTableState(state: Partial<TableStateIf> | null): void {
    this.pendingTableState = state;
  }

  takePendingTableState(): Partial<TableStateIf> | null {
    const state = this.pendingTableState;
    this.pendingTableState = null;
    return state;
  }

  dismissError(): void {
    this.error.set(null);
  }
}

function intersect(marks: ReadonlySet<string>, existing: Set<string>): ReadonlySet<string> {
  if (marks.size === 0) {
    return EMPTY_MARKS;
  }
  return new Set([...marks].filter((p) => existing.has(p)));
}
