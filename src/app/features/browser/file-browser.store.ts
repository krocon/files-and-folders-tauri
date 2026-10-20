import { computed, effect, inject, Injectable, OnDestroy, signal, untracked } from '@angular/core';
import type { TableStateIf } from '@guiexpert/table';
import { FsApi } from '../../core/fs/fs-api';
import { ListingCache } from '../../core/fs/listing-cache';
import { toFsError } from '../../core/fs/fs-error';
import {
  DirEntry,
  DirectoryListing,
  FsError,
  isNavigableDir,
  isParentRow,
} from '../../core/fs/fs.models';
import { isArchiveEntry } from '../../core/archive/archive-names';
import { JobsStore } from '../../core/jobs/jobs.store';
import { isFinished, JobInfo } from '../../core/jobs/jobs.models';
import { recordPerf, since } from '../../shared/perf';
import { compilePattern } from '../actions/pattern';
import { cursorAfterRemoval } from '../ops/ops-logic';
import { createTabMemory, pushEntry, recallFolder, rememberFolder, TabMemory } from './tab-memory';
import { ARCHIVE_TEXTS } from '../archive/archive-texts';

const EMPTY_MARKS: ReadonlySet<string> = new Set<string>();

/** Changes of a watched folder (design 012 E3). */
interface FolderDelta {
  readonly dir: string;
  readonly upserted: readonly DirEntry[];
  readonly removed: readonly string[];
}

/** Cursor, marks and scroll of a folder being left. */
interface FolderState {
  cursor: string | null;
  marks: string[];
  scrollTop: number;
}

export type HistoryMode = 'push' | 'back' | 'forward' | 'none';

export interface LoadOptions {
  /** Entry to put the cursor on; `undefined` = remembered cursor of that folder (or first row). */
  readonly cursor?: string | null;
  /** How the visit enters the back/forward history (default: push). */
  readonly history?: HistoryMode;
  /** Remember the folder being left in the current tab memory (default true; false on tab switch). */
  readonly remember?: boolean;
  /**
   * Reload of the shown folder: the cursor is the one at the time the answer
   * arrives (the user may have moved it meanwhile), not the one at the request.
   */
  readonly keepCursor?: boolean;
  /** Scroll position to restore once the listing is shown (back/forward). */
  readonly scrollTop?: number;
  /**
   * Refresh of the shown folder (design 029 E1): the list stays usable, no
   * loading overlay – `refreshing` instead of `loading`.
   */
  readonly background?: boolean;
}

/** A folder size calculation of this panel (a `dirSize` job of the engine). */
export interface SizeJob {
  readonly path: string;
  readonly jobId: string;
  readonly progress: { readonly bytes: number } | null;
}

/** If a folder size calculation takes longer than 2 seconds, show animation. */
export const DIR_SIZE_ANIMATION_DELAY_MS = 2000;
/** Live folder sizes during a copy/move are written at most this often (each write re-sorts the table). */
export const TRANSFER_SIZE_INTERVAL_MS = 500;
/** A navigation that takes longer is reported as slow, with a way to cancel it (design 029 E4). */
export const SLOW_LOAD_MS = 2000;

/**
 * Pause between automatic reloads (watcher, jobs) after a listing that took
 * `lastMs` (design 029 E2): none for fast folders, 2× the listing time for slow
 * ones (1–10 s) – a busy drive is not kept busier by reloading it non-stop.
 */
export function refreshGapMs(lastMs: number): number {
  if (lastMs < 200) {
    return 0;
  }
  return Math.min(10_000, Math.max(1000, 2 * lastMs));
}

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
export class FileBrowserStore implements OnDestroy {
  private readonly api = inject(FsApi);
  /** Listings of slow folders, shared by both panels (design 030 E1). */
  private readonly cache = inject(ListingCache);
  /** Monotonic id to drop responses of superseded requests. */
  private requestSeq = 0;
  private pendingTableState: Partial<TableStateIf> | null = null;
  private memoryRef: TabMemory = createTabMemory();
  /** Bumped whenever the history stacks change (they live in a plain object). */
  private readonly historyVersion = signal(0);
  /** Watcher deltas that arrived while a load ran – applied again to its result (design 012 E3). */
  private deltasDuringLoad: FolderDelta[] = [];
  /** A reload was requested while another load ran (design 012 E4). */
  private refreshAfterLoad: string | null = null;
  /** An automatic reload waits for the gap after the last listing (design 029 E2). */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long the last listing took and when it ended (ms). */
  private lastListMs = 0;
  private lastLoadEnd = 0;
  /** Wall-clock time (ms) the shown listing was requested – changes after it may be missing. */
  listedAt: number | null = null;

  readonly listing = signal<DirectoryListing | null>(null);
  /** A navigation runs: the folder shown is about to be replaced (overlay, never blocking). */
  readonly loading = signal(false);
  /** The shown folder is being read again in the background (design 029 E1). */
  readonly refreshing = signal(false);
  /** The running navigation takes longer than {@link SLOW_LOAD_MS} (design 029 E4). */
  readonly slow = signal(false);
  /**
   * The shown listing comes from the cache and is not checked yet (design 030 E2):
   * when it was listed (ms). Destructive actions wait for the check (E4).
   */
  readonly cachedAt = signal<number | null>(null);
  readonly error = signal<FsError | null>(null);
  readonly cursorPath = signal<string | null>(null);
  readonly marked = signal<ReadonlySet<string>>(EMPTY_MARKS);
  /** True while a tab's folder is being opened: navigation relative to the old listing is ignored. */
  readonly navigationLocked = signal(false);
  readonly hiddenVisible = signal(false);
  readonly filterActive = signal(false);
  readonly filterText = signal('');
  private readonly jobs = inject(JobsStore);
  /** Size jobs started by this panel: job id → folder path. */
  private readonly ownSizeJobs = signal<ReadonlyMap<string, string>>(new Map());
  /** Folder path → start timestamp for size calculations started by this panel. */
  private readonly calculatingSizes = new Map<string, number>();
  /** Set of folder paths where calculation has exceeded 2 seconds and should show animation. */
  readonly animatedSizePaths = signal<ReadonlySet<string>>(new Set());
  /** Timers waiting for the 2-second threshold: path → timer ID. */
  private readonly sizeAnimationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Folders of this panel whose shown size follows a running copy/move into them: path → job id. */
  private readonly activeTransferPaths = new Map<string, string>();
  /** When live transfer sizes were last written into the listing. */
  private lastTransferSizeUpdate = 0;
  readonly sizeJobs = computed<readonly SizeJob[]>(() => {
    const own = this.ownSizeJobs();
    return this.jobs
      .jobs()
      .filter((j) => own.has(j.id) && !isFinished(j.state))
      .map((j) => ({
        path: own.get(j.id)!,
        jobId: j.id,
        progress: j.state === 'running' ? { bytes: j.progress.bytesDone } : null,
      }));
  });

  /** Current vertical scroll position (provided by the file list). */
  scrollTop: () => number = () => 0;
  /** Asks the user whether to run an executable file (provided by the panel). */
  confirmExecutable: (entry: DirEntry) => Promise<boolean> = () => Promise.resolve(false);

  constructor() {
    // a kept folder keeps the newest state it was shown in (watcher deltas, folder sizes)
    effect(() => {
      const listing = this.listing();
      untracked(() => {
        if (listing && this.searchKey() === null) {
          this.cache.update(listing, this.listedAt);
        }
      });
    });
    // sizes of folders a copy/move is writing into follow the job's progress (no watcher needed)
    effect(() => {
      const jobs = this.jobs.jobs();
      untracked(() => this.syncTransferSizes(jobs));
    });
  }

  /** Set while the panel shows a search result (design 009 E4) – then there is no folder. */
  readonly searchKey = signal<string | null>(null);
  /** What the result tab shows: hits of a search, or groups of duplicates (design 016 E6). */
  readonly searchKind = signal<'search' | 'duplicates'>('search');
  /** Set while the panel shows a folder inside an archive (design 016 E1): read-only, virtual paths. */
  readonly archive = computed(() =>
    this.searchKey() !== null ? null : (this.listing()?.archive ?? null),
  );
  /** Opens a folder in a new tab (result tab: Enter on a folder, "go to file"; set by the panel). */
  openInNewTab: (path: string, cursor: string | null) => void = () => undefined;

  readonly path = computed(() =>
    this.searchKey() !== null ? null : (this.listing()?.path ?? null),
  );
  /** Identity of what the panel shows: the folder path, or `search:<key>` (operations, design 009). */
  readonly locationKey = computed(() => {
    const key = this.searchKey();
    return key !== null ? `search:${key}` : this.path();
  });
  readonly entries = computed<readonly DirEntry[]>(() => this.listing()?.entries ?? []);
  readonly parent = computed(() => this.listing()?.parent ?? null);
  readonly canGoUp = computed(() => this.parent() !== null);
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
    const seq = this.supersede();
    const startedAt = Date.now();
    const background = options.background === true;
    // a slow folder seen before: at once from the cache, then checked (design 030 E2)
    const hit = !background && path !== undefined ? this.cache.get(path) : null;
    if (hit) {
      const leaving = this.searchKey() === null ? this.listing() : null;
      const leavingState = leaving ? this.captureFolderState() : null;
      this.endLoad();
      this.apply(hit.listing, options, leaving, leavingState, hit.listedAt);
      this.cachedAt.set(hit.listedAt);
      void this.load(hit.listing.path, {
        cursor: this.cursorPath(),
        keepCursor: true,
        history: 'none',
        background: true,
      });
      return;
    }
    this.loading.set(!background);
    this.refreshing.set(background);
    if (this.slowTimer !== null) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
    if (!background) {
      this.slowTimer = setTimeout(() => {
        this.slowTimer = null;
        if (seq === this.requestSeq && this.loading()) {
          this.slow.set(true);
        }
      }, SLOW_LOAD_MS);
    }
    let recheck = false;
    try {
      const start = performance.now();
      const listing = await this.api.listDirectory(path);
      if (seq !== this.requestSeq) {
        return;
      }
      this.lastListMs = since(start);
      recordPerf(
        'list_directory (Rust + IPC)',
        this.lastListMs,
        `${listing.entries.length} entries`,
      );
      this.cache.remember(listing, startedAt, this.lastListMs);
      this.cachedAt.set(null);
      // the folder being left as it is now: it stayed usable while this one loaded (review 029 #5)
      const leaving = this.searchKey() === null ? this.listing() : null;
      const leavingState = leaving ? this.captureFolderState() : null;
      this.apply(listing, options, leaving, leavingState, startedAt);
    } catch (err) {
      if (seq !== this.requestSeq) {
        return;
      }
      // a failed navigation away superseded the check of a cached folder (review 030 #2)
      recheck = !background && this.cachedAt() !== null;
      const error = toFsError(err);
      this.error.set(error);
      if (error.code === 'not_found' && path !== undefined) {
        this.cache.forget(path);
      }
      // a deleted history target must not block the history forever
      if (
        error.code === 'not_found' &&
        (options.history === 'back' || options.history === 'forward')
      ) {
        (options.history === 'back' ? this.memoryRef.back : this.memoryRef.forward).pop();
        this.historyVersion.update((v) => v + 1);
      }
    } finally {
      if (seq === this.requestSeq) {
        this.endLoad();
        this.lastLoadEnd = Date.now();
        this.deltasDuringLoad = [];
        const again = this.refreshAfterLoad;
        this.refreshAfterLoad = null;
        if (again !== null && again === this.path()) {
          this.requestRefresh();
        }
        if (recheck) {
          this.recheckCached();
        }
      }
    }
  }

  /** Reads a folder shown from the cache (still unchecked) again in the background. */
  private recheckCached(): void {
    const path = this.path();
    if (this.cachedAt() === null || path === null) {
      return;
    }
    void this.load(path, {
      cursor: this.cursorPath(),
      keepCursor: true,
      history: 'none',
      background: true,
    });
  }

  /** The panel goes away: no timer may reload into a dead store (review 029 #7). */
  ngOnDestroy(): void {
    this.supersede();
    this.endLoad();
  }

  /** Clears the list while a tab's folder opens (design 029 E5): nothing old is shown under the new tab. */
  clearListing(): void {
    this.supersede();
    this.endLoad();
    this.cachedAt.set(null);
    this.listing.set(null);
    this.error.set(null);
  }

  /** Gives up a running navigation; the shown list stays (design 029 E4). */
  cancelLoad(): boolean {
    if (!this.loading()) {
      return false;
    }
    this.supersede();
    this.endLoad();
    // the given-up navigation had superseded the check of a cached folder (review 030 #2)
    this.recheckCached();
    return true;
  }

  private endLoad(): void {
    this.loading.set(false);
    this.refreshing.set(false);
    this.slow.set(false);
    if (this.slowTimer !== null) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }

  /** Bumped whenever a listing is shown – a tab switch sees whether its load showed one (review 030 #3). */
  appliedCount = 0;

  private apply(
    listing: DirectoryListing,
    options: LoadOptions,
    leaving: DirectoryListing | null,
    leavingState: FolderState | null,
    startedAt: number,
  ): void {
    // a tab switch to the same folder is still "another folder": the other tab's marks must not leak
    const samePath =
      leaving !== null && listing.path === leaving.path && options.remember !== false;
    if (leaving && leavingState && !samePath) {
      this.cancelSizeJobs();
      if (options.remember !== false) {
        this.leave(leaving.path, leavingState, options.history ?? 'push');
      }
    }
    this.appliedCount++;
    const paths = new Set(listing.entries.map((e) => e.path));
    const remembered = samePath ? undefined : recallFolder(this.memoryRef, listing.path);
    this.searchKey.set(null);
    this.listedAt = startedAt;
    this.listing.set(listing);
    this.error.set(null);
    const wanted =
      options.keepCursor && samePath
        ? this.cursorPath()
        : options.cursor !== undefined
          ? options.cursor
          : (remembered?.cursor ?? null);
    this.cursorPath.set(wanted !== null && paths.has(wanted) ? wanted : null);
    if (samePath) {
      this.marked.set(intersect(this.marked(), paths));
    } else {
      this.marked.set(remembered ? intersect(new Set(remembered.marks), paths) : EMPTY_MARKS);
      if (remembered && options.cursor === undefined && this.pendingTableState === null) {
        this.pendingTableState = { scroll: { left: 0, top: remembered.scrollTop } };
      }
    }
    if (options.scrollTop !== undefined) {
      this.pendingTableState = { scroll: { left: 0, top: options.scrollTop } };
    }
    // the listing may be older than changes reported meanwhile – they win
    for (const d of this.deltasDuringLoad) {
      if (d.dir === listing.path) {
        this.applyDelta(d, null);
      }
    }
  }

  /**
   * Shows the hits of search result `key` (design 009 E4): no ".." row, no
   * breadcrumbs. Cursor and marks stay while the same result grows or shrinks.
   */
  showSearch(
    key: string,
    hits: readonly DirEntry[],
    kind: 'search' | 'duplicates' = 'search',
  ): void {
    this.supersede(); // a folder still loading must not replace the result
    const same = this.searchKey() === key;
    if (!same) {
      this.cancelSizeJobs();
      // duplicates are read group by group (design 016 E6)
      if (kind === 'duplicates' && this.pendingTableState === null) {
        this.pendingTableState = { sort: [{ property: 'group', sortState: 'asc' }] };
      }
    }
    this.searchKind.set(kind);
    this.endLoad();
    this.cachedAt.set(null);
    const paths = new Set(hits.map((h) => h.path));
    this.searchKey.set(key);
    this.listing.set({
      path: `search:${key}`,
      parent: null,
      segments: [],
      entries: hits,
      unreadableEntries: 0,
    });
    if (!same) {
      this.error.set(null);
    }
    const cursor = this.cursorPath();
    this.cursorPath.set(cursor !== null && paths.has(cursor) ? cursor : null);
    this.marked.set(same ? intersect(this.marked(), paths) : EMPTY_MARKS);
  }

  /** Opens an entry: folder → into it, ".." → up, file → default application. */
  async open(entry: DirEntry): Promise<void> {
    if (this.navigationLocked()) {
      return;
    }
    if (this.searchKey() !== null) {
      // result tab: a folder opens in a new tab, the result stays
      this.setCursor(entry.path);
      if (isNavigableDir(entry) || isArchiveEntry(entry)) {
        if (!entry.lossyName) {
          this.openInNewTab(entry.path, null);
        }
        return;
      }
      return this.openFile(entry);
    }
    if (isParentRow(entry)) {
      return this.up();
    }
    this.setCursor(entry.path);
    // an archive opens like a folder (design 016 E1); an archive inside an archive is not opened (E3.4)
    const inArchive = this.archive() !== null;
    if (isNavigableDir(entry) || (isArchiveEntry(entry) && !inArchive)) {
      if (!entry.lossyName) {
        await this.load(entry.path);
      }
      return;
    }
    if (inArchive) {
      this.error.set({
        code: 'archive_error',
        message: ARCHIVE_TEXTS.openInside,
        path: entry.path,
      });
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
    if (!entry || this.navigationLocked() || this.searchKey() !== null) {
      return Promise.resolve();
    }
    return this.load(entry.path, {
      cursor: entry.cursor,
      history: 'back',
      scrollTop: entry.scrollTop,
    });
  }

  forward(): Promise<void> {
    const entry = this.memoryRef.forward.at(-1);
    if (!entry || this.navigationLocked() || this.searchKey() !== null) {
      return Promise.resolve();
    }
    return this.load(entry.path, {
      cursor: entry.cursor,
      history: 'forward',
      scrollTop: entry.scrollTop,
    });
  }

  /**
   * Reloads the folder in the background (design 029 E1), keeping cursor and
   * (still existing) marks. Not while a navigation replaces the folder anyway.
   */
  refresh(): Promise<void> {
    if (this.navigationLocked() || this.searchKey() !== null || this.loading()) {
      return Promise.resolve();
    }
    const path = this.path();
    return this.load(path ?? undefined, {
      cursor: this.cursorPath(),
      keepCursor: true,
      history: 'none',
      background: true,
    });
  }

  /**
   * Starts a new request: older responses are dropped, and so are the watcher
   * deltas and the queued reload that belonged to them (review 012 #4c) – the
   * new listing is read after them anyway.
   */
  private supersede(): number {
    this.deltasDuringLoad = [];
    this.refreshAfterLoad = null;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    return ++this.requestSeq;
  }

  /**
   * Reload requested by the watcher or a finished job (design 012 E4): while
   * any load runs, one reload is queued instead (never several); after a slow
   * listing it waits {@link refreshGapMs} (design 029 E2).
   */
  requestRefresh(): void {
    const path = this.path();
    if (path === null || this.navigationLocked()) {
      return;
    }
    if (this.loading() || this.refreshing()) {
      this.refreshAfterLoad = path;
      return;
    }
    if (this.refreshTimer !== null) {
      return;
    }
    const wait = refreshGapMs(this.lastListMs) - (Date.now() - this.lastLoadEnd);
    if (wait > 0) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      return;
    }
    void this.refresh();
  }

  /**
   * Applies a watcher delta of `dir` (design 012 E3): entries by path, marks of
   * removed ones dropped, a removed cursor moves to the next entry of
   * `displayed` (display order). Without a real change the listing stays the
   * same object – no repaint.
   */
  applyChanges(
    dir: string,
    upserted: readonly DirEntry[],
    removed: readonly string[],
    displayed: readonly DirEntry[] = this.visibleEntries(),
  ): void {
    const delta: FolderDelta = { dir, upserted, removed };
    if (this.loading() || this.refreshing()) {
      this.deltasDuringLoad.push(delta);
    }
    if (dir === this.path()) {
      this.applyDelta(delta, displayed);
    }
  }

  /** Navigates to the nearest folder above the shown one that still exists (watched folder gone). */
  async goToExistingAncestor(): Promise<void> {
    const listing = this.listing();
    if (!listing || this.navigationLocked()) {
      return;
    }
    const ancestors = listing.segments.slice(0, -1).reverse();
    for (const seg of ancestors) {
      await this.load(seg.path, { history: 'none' });
      if (this.path() !== listing.path) {
        return;
      }
    }
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

  /** True if this folder is currently calculating its size (or queued). */
  isCalculatingSize(path: string): boolean {
    return (
      this.calculatingSizes.has(path) ||
      [...this.ownSizeJobs().values()].includes(path) ||
      this.jobs.findActiveDirSize(path) !== undefined
    );
  }

  /** True if the calculation has been running for > 2 seconds and should display an animation. */
  isSizeAnimated(path: string): boolean {
    return this.animatedSizePaths().has(path);
  }

  /** Starts the size calculation of a folder as a job (no-op for files or if already running). */
  async calcDirSize(entry: DirEntry): Promise<void> {
    // inside an archive Rust lists folder sizes already
    if (
      !isNavigableDir(entry) ||
      isParentRow(entry) ||
      entry.kind === 'symlink' ||
      this.archive() !== null
    ) {
      return;
    }
    if (this.isCalculatingSize(entry.path)) {
      return;
    }
    const transfer = this.findActiveTransfer(entry.path);
    if (transfer) {
      this.activeTransferPaths.set(entry.path, transfer.job.id);
      this.lastTransferSizeUpdate = Date.now();
      this.applyDirSize(entry.path, transfer.bytes);
      return;
    }
    const folder = this.locationKey();
    this.calculatingSizes.set(entry.path, Date.now());
    const timer = setTimeout(() => {
      this.sizeAnimationTimers.delete(entry.path);
      if (this.calculatingSizes.has(entry.path)) {
        this.animatedSizePaths.update((s) => new Set(s).add(entry.path));
      }
    }, DIR_SIZE_ANIMATION_DELAY_MS);
    this.sizeAnimationTimers.set(entry.path, timer);

    let id: string;
    try {
      id = await this.jobs.start({ kind: 'dirSize', path: entry.path });
    } catch (err) {
      this.cleanUpCalculating(entry.path);
      this.error.set(toFsError(err));
      return;
    }
    this.ownSizeJobs.update((m) => new Map(m).set(id, entry.path));
    const job = await this.jobs.whenFinished(id);
    this.cleanUpCalculating(entry.path);
    this.ownSizeJobs.update((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
    if (this.locationKey() !== folder) {
      return;
    }
    const size = job.summary?.dirSize;
    if (job.state === 'done' && size) {
      this.applyDirSize(entry.path, size.bytes);
    } else if (job.state === 'failed' && job.summary?.error) {
      this.error.set(job.summary.error);
    }
  }

  private cleanUpCalculating(path: string): void {
    this.calculatingSizes.delete(path);
    const timer = this.sizeAnimationTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.sizeAnimationTimers.delete(path);
    }
    if (this.animatedSizePaths().has(path)) {
      this.animatedSizePaths.update((s) => {
        const next = new Set(s);
        next.delete(path);
        return next;
      });
    }
  }

  cancelSizeJobs(): void {
    for (const timer of this.sizeAnimationTimers.values()) {
      clearTimeout(timer);
    }
    this.sizeAnimationTimers.clear();
    this.calculatingSizes.clear();
    this.activeTransferPaths.clear();
    if (this.animatedSizePaths().size > 0) {
      this.animatedSizePaths.set(new Set());
    }
    for (const id of this.ownSizeJobs().keys()) {
      void this.jobs.cancel(id);
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

  /** Like `applyDirSize` for several folders; the listing changes only if a size did. */
  private applyDirSizes(sizes: ReadonlyMap<string, number>): void {
    const listing = this.listing();
    if (!listing || sizes.size === 0) {
      return;
    }
    let changed = false;
    const entries = listing.entries.map((e) => {
      const bytes = sizes.get(e.path);
      if (bytes === undefined || bytes === e.size) {
        return e;
      }
      changed = true;
      return { ...e, size: bytes };
    });
    if (changed) {
      this.listing.set({ ...listing, entries });
    }
  }

  // ---- table state handover ----

  setPendingTableState(state: Partial<TableStateIf> | null): void {
    this.pendingTableState = state;
  }

  hasPendingTableState(): boolean {
    return this.pendingTableState !== null;
  }

  takePendingTableState(): Partial<TableStateIf> | null {
    const state = this.pendingTableState;
    this.pendingTableState = null;
    return state;
  }

  /** Opens a file with the default app; programs only after `confirmExecutable` (F4, Enter). */
  async openFile(entry: DirEntry): Promise<void> {
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

  private applyDelta(delta: FolderDelta, displayed: readonly DirEntry[] | null): void {
    const listing = this.listing();
    if (!listing) {
      return;
    }
    const removed = new Set(delta.removed);
    const byPath = new Map(delta.upserted.map((e) => [e.path, e]));
    let changed = false;
    const entries: DirEntry[] = [];
    for (const e of listing.entries) {
      if (removed.has(e.path)) {
        changed = true;
        continue;
      }
      const next = byPath.get(e.path);
      if (next) {
        byPath.delete(e.path);
        // a calculated folder size stays (the watcher reports folders without a size)
        const merged =
          next.size === null && isNavigableDir(next) && e.size !== null
            ? { ...next, size: e.size }
            : next;
        if (!sameEntry(e, merged)) {
          changed = true;
          entries.push(merged);
          continue;
        }
      }
      entries.push(e);
    }
    for (const e of byPath.values()) {
      if (!removed.has(e.path)) {
        changed = true;
        entries.push(e);
      }
    }
    if (!changed) {
      return;
    }
    if (removed.size > 0) {
      const cursor = this.cursorPath();
      if (cursor !== null && removed.has(cursor)) {
        this.cursorPath.set(displayed ? cursorAfterRemoval(displayed, removed, cursor) : null);
      }
      const marks = this.marked();
      if ([...removed].some((p) => marks.has(p))) {
        this.marked.set(new Set([...marks].filter((p) => !removed.has(p))));
      }
    }
    this.listing.set({ ...listing, entries });
  }

  private captureFolderState(): FolderState {
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

  /**
   * A running copy/move that creates the folder `path` and reports how much arrived there
   * (Rust only reports new folders – a merged one holds more than the job wrote).
   */
  private findActiveTransfer(path: string): { job: JobInfo; bytes: number } | null {
    for (const j of this.jobs.jobs()) {
      if (isFinished(j.state) || (j.spec.kind !== 'copy' && j.spec.kind !== 'move')) {
        continue;
      }
      const bytes = j.progress.destBytes?.[path];
      if (bytes !== undefined) {
        return { job: j, bytes };
      }
    }
    return null;
  }

  /**
   * Writes the progress of the tracked transfers into the listing: at most every
   * TRANSFER_SIZE_INTERVAL_MS, the final value as soon as a job has finished.
   */
  private syncTransferSizes(jobs: readonly JobInfo[]): void {
    if (this.activeTransferPaths.size === 0) {
      return;
    }
    const sizes = new Map<string, number>();
    let finished = false;
    for (const [path, jobId] of this.activeTransferPaths) {
      const job = jobs.find((j) => j.id === jobId);
      const bytes = job?.summary?.destBytes?.[path] ?? job?.progress.destBytes?.[path];
      if (bytes !== undefined) {
        sizes.set(path, bytes);
      }
      if (!job || isFinished(job.state)) {
        this.activeTransferPaths.delete(path);
        finished = true;
      }
    }
    const now = Date.now();
    if (!finished && now - this.lastTransferSizeUpdate < TRANSFER_SIZE_INTERVAL_MS) {
      return;
    }
    this.lastTransferSizeUpdate = now;
    this.applyDirSizes(sizes);
  }

  private isParentPath(path: string): boolean {
    return path === this.parent();
  }
}

function sameEntry(a: DirEntry, b: DirEntry): boolean {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.targetKind === b.targetKind &&
    a.size === b.size &&
    a.modifiedMs === b.modifiedMs &&
    a.hidden === b.hidden &&
    a.lossyName === b.lossyName
  );
}

function intersect(marks: ReadonlySet<string>, existing: Set<string>): ReadonlySet<string> {
  if (marks.size === 0) {
    return EMPTY_MARKS;
  }
  return new Set([...marks].filter((p) => existing.has(p)));
}
