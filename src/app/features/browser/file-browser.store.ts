import { computed, inject, Injectable, signal } from '@angular/core';
import type { TableStateIf } from '@guiexpert/table';
import { FsApi } from '../../core/fs/fs-api';
import { toFsError } from '../../core/fs/fs-error';
import {
  DirEntry,
  DirectoryListing,
  DirSize,
  FsError,
  isNavigableDir,
  isParentRow,
} from '../../core/fs/fs.models';
import { recordPerf, since } from '../../shared/perf';
import { compilePattern } from '../actions/pattern';
import { createTabMemory, pushEntry, recallFolder, rememberFolder, TabMemory } from './tab-memory';

const EMPTY_MARKS: ReadonlySet<string> = new Set<string>();

export type HistoryMode = 'push' | 'back' | 'forward' | 'none';

export interface LoadOptions {
  /** Entry to put the cursor on; `undefined` = remembered cursor of that folder (or first row). */
  readonly cursor?: string | null;
  /** How the visit enters the back/forward history (default: push). */
  readonly history?: HistoryMode;
  /** Remember the folder being left in the current tab memory (default true; false on tab switch). */
  readonly remember?: boolean;
}

/** A folder size calculation of this panel. */
export interface SizeJob {
  readonly path: string;
  readonly jobId: string;
  readonly progress: DirSize | null;
}

let jobSeq = 0;

/**
 * State of one file panel. Provided per component (not root): two panels and
 * their tabs need independent instances.
 *
 * - `cursorPath`: the entry under the cursor (Total Commander "focus").
 * - `marked`: entries marked for operations, keyed by path; restored per folder.
 * - `memory`: back/forward and per-folder state of the shown tab (set by the panel).
 * - `hiddenVisible` / `filterText`: row filter of the shown tab (design 003 E5).
 * - folder sizes are written into the listing (`size` of directories).
 */
@Injectable()
export class FileBrowserStore {
  private readonly api = inject(FsApi);
  /** Monotonic id to drop responses of superseded requests. */
  private requestSeq = 0;
  private pendingTableState: Partial<TableStateIf> | null = null;
  private memoryRef: TabMemory = createTabMemory();
  /** Bumped whenever the history stacks change (they live in a plain object). */
  private readonly historyVersion = signal(0);

  readonly listing = signal<DirectoryListing | null>(null);
  readonly loading = signal(false);
  readonly error = signal<FsError | null>(null);
  readonly cursorPath = signal<string | null>(null);
  readonly marked = signal<ReadonlySet<string>>(EMPTY_MARKS);
  /** True while a tab's folder is being opened: navigation relative to the old listing is ignored. */
  readonly navigationLocked = signal(false);
  readonly hiddenVisible = signal(false);
  readonly filterActive = signal(false);
  readonly filterText = signal('');
  readonly sizeJobs = signal<readonly SizeJob[]>([]);

  /** Current vertical scroll position (provided by the file list). */
  scrollTop: () => number = () => 0;
  /** Asks the user whether to run an executable file (provided by the panel). */
  confirmExecutable: (entry: DirEntry) => Promise<boolean> = () => Promise.resolve(false);

  readonly path = computed(() => this.listing()?.path ?? null);
  readonly entries = computed<readonly DirEntry[]>(() => this.listing()?.entries ?? []);
  readonly parent = computed(() => this.listing()?.parent ?? null);
  readonly canGoUp = computed(() => this.parent() !== null && !this.loading());
  readonly canGoBack = computed(() => (this.historyVersion(), this.memoryRef.back.length > 0));
  readonly canGoForward = computed(
    () => (this.historyVersion(), this.memoryRef.forward.length > 0),
  );

  /** Row filter: hidden entries and the quick filter; the ".." row always passes. */
  readonly rowFilter = computed<(e: DirEntry) => boolean>(() => {
    const showHidden = this.hiddenVisible();
    const pattern = this.filterActive() ? compilePattern(this.filterText(), 'glob').matches : null;
    return (e) => isParentRow(e) || ((showHidden || !e.hidden) && (!pattern || pattern(e.name)));
  });
  readonly visibleEntries = computed(() => {
    const keep = this.rowFilter();
    return this.entries().filter(keep);
  });
  readonly cursorEntry = computed(() => {
    const path = this.cursorPath();
    return path === null ? null : (this.entries().find((e) => e.path === path) ?? null);
  });
  readonly markedEntries = computed(() => {
    const marked = this.marked();
    return marked.size === 0 ? [] : this.entries().filter((e) => marked.has(e.path));
  });
  /** Marked entries the filter currently hides (shown as a hint in the status line). */
  readonly hiddenMarkedCount = computed(() => {
    const keep = this.rowFilter();
    return this.markedEntries().filter((e) => !keep(e)).length;
  });

  /** Stores cursor, marks and scroll of the shown folder in the current tab memory (before a tab switch). */
  rememberCurrent(): void {
    const path = this.path();
    if (path !== null) {
      rememberFolder(this.memoryRef, path, this.captureFolderState());
    }
  }

  /** The tab whose navigation state this panel shows now. */
  setMemory(memory: TabMemory): void {
    this.memoryRef = memory;
    this.historyVersion.update((v) => v + 1);
  }

  /**
   * Loads a directory (home directory when `path` is omitted).
   * On failure the previous listing stays visible and `error` is set.
   */
  async load(path?: string, options: LoadOptions = {}): Promise<void> {
    const seq = ++this.requestSeq;
    const leaving = this.listing();
    const leavingState = leaving ? this.captureFolderState() : null;
    this.loading.set(true);
    try {
      const start = performance.now();
      const listing = await this.api.listDirectory(path);
      if (seq !== this.requestSeq) {
        return;
      }
      recordPerf('list_directory (Rust + IPC)', since(start), `${listing.entries.length} entries`);
      const samePath = leaving !== null && listing.path === leaving.path;
      if (leaving && leavingState && !samePath) {
        this.cancelSizeJobs();
        if (options.remember !== false) {
          this.leave(leaving.path, leavingState, options.history ?? 'push');
        }
      }
      const paths = new Set(listing.entries.map((e) => e.path));
      const remembered = samePath ? undefined : recallFolder(this.memoryRef, listing.path);
      this.listing.set(listing);
      this.error.set(null);
      const wanted = options.cursor !== undefined ? options.cursor : (remembered?.cursor ?? null);
      this.cursorPath.set(wanted !== null && paths.has(wanted) ? wanted : null);
      if (samePath) {
        this.marked.set(intersect(this.marked(), paths));
      } else {
        this.marked.set(remembered ? intersect(new Set(remembered.marks), paths) : EMPTY_MARKS);
        if (remembered && options.cursor === undefined && this.pendingTableState === null) {
          this.pendingTableState = { scroll: { left: 0, top: remembered.scrollTop } };
        }
      }
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

  /** Opens an entry: folder → into it, ".." → up, file → default application. */
  async open(entry: DirEntry): Promise<void> {
    if (this.navigationLocked()) {
      return;
    }
    if (isParentRow(entry)) {
      return this.up();
    }
    this.setCursor(entry.path);
    if (isNavigableDir(entry)) {
      if (!entry.lossyName) {
        await this.load(entry.path);
      }
      return;
    }
    await this.openFile(entry);
  }

  /** Navigates to the parent and puts the cursor on the folder we came from. */
  up(): Promise<void> {
    const parent = this.parent();
    if (parent === null || this.navigationLocked()) {
      return Promise.resolve();
    }
    return this.load(parent, { cursor: this.path() });
  }

  back(): Promise<void> {
    const entry = this.memoryRef.back.at(-1);
    if (!entry || this.navigationLocked()) {
      return Promise.resolve();
    }
    this.pendingTableState = { scroll: { left: 0, top: entry.scrollTop } };
    return this.load(entry.path, { cursor: entry.cursor, history: 'back' });
  }

  forward(): Promise<void> {
    const entry = this.memoryRef.forward.at(-1);
    if (!entry || this.navigationLocked()) {
      return Promise.resolve();
    }
    this.pendingTableState = { scroll: { left: 0, top: entry.scrollTop } };
    return this.load(entry.path, { cursor: entry.cursor, history: 'forward' });
  }

  /** Reloads the folder, keeping cursor and (still existing) marks. */
  refresh(): Promise<void> {
    if (this.navigationLocked()) {
      return Promise.resolve();
    }
    const path = this.path();
    return this.load(path ?? undefined, { cursor: this.cursorPath(), history: 'none' });
  }

  setCursor(path: string | null): void {
    this.cursorPath.set(path);
  }

  isMarked(path: string): boolean {
    return this.marked().has(path);
  }

  toggleMark(path: string): void {
    if (this.isParentPath(path)) {
      return;
    }
    const next = new Set(this.marked());
    if (!next.delete(path)) {
      next.add(path);
    }
    this.marked.set(next);
  }

  setMarked(paths: readonly string[], marked: boolean): void {
    const next = new Set(this.marked());
    for (const p of paths) {
      if (this.isParentPath(p)) {
        continue;
      }
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
    this.marked.set(new Set(displayed.filter((p) => !this.isParentPath(p))));
  }

  clearMarks(): void {
    this.marked.set(EMPTY_MARKS);
  }

  invertMarks(displayed: readonly string[]): void {
    const current = this.marked();
    this.marked.set(new Set(displayed.filter((p) => !current.has(p) && !this.isParentPath(p))));
  }

  dismissError(): void {
    this.error.set(null);
  }

  // ---- filter (design 003 E5) ----

  setFilter(state: { hiddenVisible: boolean; filterActive: boolean; filterText: string }): void {
    this.hiddenVisible.set(state.hiddenVisible);
    this.filterActive.set(state.filterActive);
    this.filterText.set(state.filterText);
  }

  // ---- folder sizes (design 003 E7) ----

  /** Starts the size calculation of a folder (no-op for files or if already running). */
  calcDirSize(entry: DirEntry): Promise<void> {
    if (!isNavigableDir(entry) || isParentRow(entry) || entry.kind === 'symlink') {
      return Promise.resolve();
    }
    if (this.sizeJobs().some((j) => j.path === entry.path)) {
      return Promise.resolve();
    }
    const jobId = `size-${++jobSeq}`;
    const folder = this.path();
    this.sizeJobs.update((jobs) => [...jobs, { path: entry.path, jobId, progress: null }]);
    return this.api
      .calcDirSize(entry.path, jobId, (progress) =>
        this.sizeJobs.update((jobs) =>
          jobs.map((j) => (j.jobId === jobId ? { ...j, progress } : j)),
        ),
      )
      .then((result) => {
        if (!result.cancelled && this.path() === folder) {
          this.applyDirSize(entry.path, result.bytes);
        }
      })
      .catch((err) => this.error.set(toFsError(err)))
      .finally(() => this.sizeJobs.update((jobs) => jobs.filter((j) => j.jobId !== jobId)));
  }

  cancelSizeJobs(): void {
    for (const j of this.sizeJobs()) {
      void this.api.cancelDirSize(j.jobId);
    }
  }

  /** Writes a computed folder size into the listing (size column, sorting, status line). */
  applyDirSize(path: string, bytes: number): void {
    const listing = this.listing();
    if (!listing) {
      return;
    }
    this.listing.set({
      ...listing,
      entries: listing.entries.map((e) => (e.path === path ? { ...e, size: bytes } : e)),
    });
  }

  // ---- table state handover ----

  setPendingTableState(state: Partial<TableStateIf> | null): void {
    this.pendingTableState = state;
  }

  takePendingTableState(): Partial<TableStateIf> | null {
    const state = this.pendingTableState;
    this.pendingTableState = null;
    return state;
  }

  private async openFile(entry: DirEntry): Promise<void> {
    try {
      await this.api.openFile(entry.path, false);
    } catch (err) {
      const e = toFsError(err);
      if (e.code !== 'executable') {
        this.error.set(e);
        return;
      }
      if (await this.confirmExecutable(entry)) {
        try {
          await this.api.openFile(entry.path, true);
        } catch (again) {
          this.error.set(toFsError(again));
        }
      }
    }
  }

  private captureFolderState(): { cursor: string | null; marks: string[]; scrollTop: number } {
    return { cursor: this.cursorPath(), marks: [...this.marked()], scrollTop: this.scrollTop() };
  }

  private leave(
    path: string,
    state: { cursor: string | null; marks: string[]; scrollTop: number },
    mode: HistoryMode,
  ): void {
    rememberFolder(this.memoryRef, path, state);
    const entry = { path, cursor: state.cursor, scrollTop: state.scrollTop };
    const m = this.memoryRef;
    switch (mode) {
      case 'push':
        pushEntry(m.back, entry);
        m.forward = [];
        break;
      case 'back':
        m.back.pop();
        pushEntry(m.forward, entry);
        break;
      case 'forward':
        m.forward.pop();
        pushEntry(m.back, entry);
        break;
      case 'none':
        break;
    }
    this.historyVersion.update((v) => v + 1);
  }

  private isParentPath(path: string): boolean {
    return path === this.parent();
  }
}

function intersect(marks: ReadonlySet<string>, existing: Set<string>): ReadonlySet<string> {
  if (marks.size === 0) {
    return EMPTY_MARKS;
  }
  return new Set([...marks].filter((p) => existing.has(p)));
}
