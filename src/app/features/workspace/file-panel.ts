import { ARCHIVE_TEXTS } from '../archive/archive-texts';
import { isNotConnected, profileOf } from '../../core/remote/remote-connect-prompt';
import { displayPath, isRemotePath, isServerUrl } from '../../core/remote/remote-path';
import { REMOTE_TEXTS } from '../remote/remote-texts';
import { RemoteStore } from '../remote/remote.store';
import { duplicateSummary, KeepRule } from '../duplicates/duplicates-logic';
import { DUP_TEXTS } from '../duplicates/duplicates-texts';
import { DuplicatesStore } from '../duplicates/duplicates.store';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { TableStateIf } from '@guiexpert/table';
import { FsApi } from '../../core/fs/fs-api';
import { describeFsError, errorText as describeError, toFsError } from '../../core/fs/fs-error';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { JobsStore } from '../../core/jobs/jobs.store';
import { WatchService } from '../../core/watch/watch.service';
import { WatchEvent } from '../../core/watch/watch.models';
import { DirEntry, DirectoryListing, PathSegment } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';
import { formatSize } from '../../shared/format';
import { FileBrowserStore } from '../browser/file-browser.store';
import { SearchStore } from '../search/search.store';
import { FindStore } from '../search/find.store';
import { SEARCH_TEXTS } from '../search/search-texts';
import { FileList } from '../browser/file-list/file-list';
import { QuickView } from '../preview/quick-view';
import { QuickViewStore } from '../preview/quick-view.store';
import { summarize } from './status';
import { TabBar } from './tab-bar';
import { TEXTS } from './texts';
import { otherSide, WorkspaceStore } from './workspace.store';
import { MenuService } from '../menus/menu.service';
import { DiskUsageStore, UsageState } from '../diskusage/disk-usage.store';
import { DiskUsageChart } from '../diskusage/disk-usage-chart';
import { USAGE_TEXTS } from '../diskusage/disk-usage-texts';
import { isUsageKey, scanIdOf, usageKey } from '../diskusage/usage-rows';
import { formatCount } from '../../shared/format';
import { FLAT_TEXTS } from '../flat/flat-texts';
import { shouldRefresh } from '../flat/flat-logic';
import { FlatNavigator } from '../browser/file-browser.store';

let panelSeq = 0;

/**
 * One side of the window: path header, tab bar, file list and status line.
 * The host is `display: contents` – its four parts are items of the workspace
 * grid, so one splitter moves all rows. Owns the per-panel `FileBrowserStore`
 * and syncs it with the active tab of its side in the {@link WorkspaceStore}.
 */
@Component({
  selector: 'app-file-panel',
  imports: [FileList, TabBar, QuickView, DiskUsageChart],
  providers: [FileBrowserStore],
  templateUrl: './file-panel.html',
  styleUrl: './file-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.side-left]': "side() === 'left'",
    '[class.side-right]': "side() === 'right'",
    '(pointerdown)': 'activate($event)',
    '(focusin)': 'activate($event)',
    '(click)': 'onHeaderClick($event)',
  },
})
export class FilePanel implements OnInit {
  readonly side = input.required<Side>();

  protected readonly store = inject(FileBrowserStore);
  protected readonly ws = inject(WorkspaceStore);
  protected readonly texts = TEXTS;
  protected readonly pathId = `fnf-path-${++panelSeq}`;
  private readonly list = viewChild(FileList);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly active = computed(() => this.ws.activeSide() === this.side());
  private readonly quick = inject(QuickViewStore);
  protected readonly usage = inject(DiskUsageStore);
  protected readonly usageTexts = USAGE_TEXTS;
  /** Scan id when the active tab is a disk-usage tab (design 033). */
  protected readonly usageScan = computed(() => {
    const key = this.ws.activeTab(this.side()).search?.key;
    return isUsageKey(key) ? scanIdOf(key) : null;
  });
  protected readonly usageState = computed<UsageState | null>(() => {
    const id = this.usageScan();
    return id ? (this.usage.state(id) ?? null) : null;
  });
  /** This side shows the chart of the other side's disk-usage tab while that side is active. */
  protected readonly chartScan = computed(() => {
    const other = otherSide(this.side());
    if (this.ws.activeSide() !== other) {
      return null;
    }
    return this.usage.stateOn(other)?.scanId ?? null;
  });
  protected readonly otherSide = computed(() => otherSide(this.side()));
  /** This side shows the quick view of the other side's cursor (design 010 E4). */
  protected readonly quickView = computed(
    () => this.quick.shownOn() === this.side() && this.chartScan() === null,
  );
  protected readonly tab = computed(() => this.ws.activeTab(this.side()));
  private readonly tabId = computed(() => this.tab().id);
  protected readonly search = inject(SearchStore);
  private readonly find = inject(FindStore);
  protected readonly searchTexts = SEARCH_TEXTS;
  protected readonly flatTexts = FLAT_TEXTS;
  protected readonly dupTexts = DUP_TEXTS;
  protected readonly archiveTexts = ARCHIVE_TEXTS;
  private readonly dup = inject(DuplicatesStore);
  /** "12 groups, 31 files, 48 MB redundant" of the shown duplicate result. */
  protected readonly dupSummary = computed(() => {
    const s = duplicateSummary(this.searchResult()?.hits ?? []);
    return DUP_TEXTS.summary(s.groups, s.files, formatSize(s.redundant));
  });
  /** While a duplicate search runs: scanning, then comparing contents. */
  protected readonly dupProgress = computed(() => {
    const st = this.searchResult()?.stats;
    if (!st) {
      return '';
    }
    return st.bytesToHash
      ? DUP_TEXTS.hashing(formatSize(st.bytesHashed ?? 0), formatSize(st.bytesToHash))
      : DUP_TEXTS.scanning(st.filesScanned);
  });
  /** The result the active tab shows (result tab, design 009 E4). */
  protected readonly searchResult = computed(() => {
    const key = this.tab().search?.key;
    return key ? (this.search.results().get(key) ?? null) : null;
  });
  /** Live region of a result tab: only the start and the end are announced. */
  protected readonly searchStatus = computed(() => {
    const r = this.searchResult();
    if (!r) {
      return '';
    }
    if (r.running) {
      return r.kind === 'flat' ? FLAT_TEXTS.listing : SEARCH_TEXTS.searching;
    }
    if (r.error) {
      return SEARCH_TEXTS.failed(describeError(r.error));
    }
    if (r.kind === 'flat') {
      return r.stats.truncated
        ? FLAT_TEXTS.finishedTruncated(r.hits.length)
        : FLAT_TEXTS.finished(r.hits.length);
    }
    return r.kind === 'duplicates'
      ? this.dupSummary()
      : SEARCH_TEXTS.finished(r.stats.hits, r.stats.unreadable);
  });

  protected readonly errorText = computed(() => {
    const err = this.store.error();
    return err ? describeFsError(err) : null;
  });
  protected readonly isFavorite = computed(() => this.ws.isFavorite(this.store.path()));
  protected readonly segments = computed(() => this.store.listing()?.segments ?? []);
  protected readonly summary = computed(() =>
    summarize(this.store.visibleEntries(), this.store.marked()),
  );
  /** Path input (Strg/⌘+L, design 003 E8). */
  protected readonly editingPath = signal(false);
  protected readonly pathError = signal<string | null>(null);
  protected readonly sizeProgress = computed(() => {
    const jobs = this.store.sizeJobs();
    if (jobs.length === 0) {
      return null;
    }
    const bytes = jobs.reduce((n, j) => n + (j.progress?.bytes ?? 0), 0);
    return `${TEXTS.calculating(jobs.length)} ${formatSize(bytes)}`;
  });
  private readonly injector = inject(Injector);
  private readonly fsApi = inject(FsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly jobs = inject(JobsStore);
  private readonly watch = inject(WatchService);
  protected readonly remote = inject(RemoteStore);
  protected readonly remoteTexts = REMOTE_TEXTS;
  /** The tab shows a server folder that is not connected (design 034 §4.4). */
  protected readonly offline = computed(() => {
    const path = this.tab().path;
    return isRemotePath(path) && isNotConnected(this.store.error()) ? path : null;
  });
  protected readonly formatSize = formatSize;
  /** Shown when the folder is not watched natively (design 012 E2). */
  protected readonly watchHint = computed(() => {
    const status = this.watch.status(this.store.path());
    if (!status || status.mode === 'native') {
      return null;
    }
    return status.mode === 'poll' ? TEXTS.slowWatched : TEXTS.notWatched(status.reason);
  });

  /** Tab that is shown or being opened. */
  private shownTabId: string | null = null;
  /**
   * Listing that was visible when the tab was switched. Any other listing
   * belongs to the shown tab (the store drops stale responses), so path,
   * cursor and table state may be written back only once it changed.
   */
  private listingAtSwitch: DirectoryListing | null | undefined = undefined;
  /** "as of 10:05" of a listing shown from the cache and not checked yet (design 030 E3). */
  protected readonly cachedLabel = computed(() => {
    const at = this.store.cachedAt();
    return at === null ? null : TEXTS.cachedAt(new Date(at));
  });
  /** Tooltip with the full date and what waits for the check. */
  protected readonly cachedTitle = computed(() => {
    const at = this.store.cachedAt();
    return at === null ? null : TEXTS.cachedTitle(new Date(at));
  });
  /** The tab shown before the one being opened: Esc goes back there (design 029 E5). */
  private previousTabId: string | null = null;
  /** Opening this tab's folder was cancelled and nothing else could be shown. */
  protected readonly cancelledTab = signal<string | null>(null);
  /** The tab's own path while its folder opens (the list is empty then). */
  protected readonly openingPath = computed(() => {
    const path =
      this.store.listing() === null && !this.tab().search ? (this.tab().path ?? null) : null;
    // a server tab before connecting: `Name: /path`, never the internal `remote://id/…`
    return path && isRemotePath(path) ? displayPath(path, this.profileNames()) : path;
  });
  private readonly profileNames = computed(
    () => new Map(this.remote.profiles().map((p) => [p.id, p.name])),
  );
  /** The name of the server of an offline tab (banner). */
  protected readonly offlineName = computed(() => {
    const path = this.offline();
    const id = path ? profileOf(path) : null;
    return (id && this.profileNames().get(id)) ?? '';
  });

  constructor() {
    effect(() => {
      const id = this.tabId();
      untracked(() => void this.showTab(id));
    });
    // result tab: show the (growing) hits of its search
    effect(() => {
      const tab = this.tab();
      const key = tab.search?.key ?? null;
      const result = this.searchResult();
      untracked(() => {
        if (key !== null && !isUsageKey(key) && this.shownTabId === tab.id) {
          this.store.showSearch(key, result?.hits ?? [], result?.kind ?? kindOf(tab));
        }
      });
    });
    // a running search or flat listing: Esc stops it (design 038 E6)
    effect(() => {
      const busy = this.searchResult()?.running ?? false;
      untracked(() => this.store.resultBusy.set(busy));
    });
    // flat view: Hidden is part of the listing – hidden folders are entered or not (design 038 E4)
    effect(() => {
      const hidden = this.store.hiddenVisible();
      const r = this.searchResult();
      untracked(() => {
        if (r?.kind === 'flat' && this.tab().search?.flat && r.criteria.includeHidden !== hidden) {
          this.search.refresh(r.key, { includeHidden: hidden });
        }
      });
    });
    // marks of the shown level → the scan's basket (registered first: a Space press and a
    // poll result in the same flush must not lose the mark, review 033 #8)
    effect(() => {
      const marked = this.store.marked();
      untracked(() => {
        const id = this.usageScan();
        if (id !== null && this.store.isUsage()) {
          this.usage.setLevelMarks(id, marked);
        }
      });
    });
    // disk-usage tab (design 033): the shown level of its scan
    effect(() => {
      const tab = this.tab();
      const id = this.usageScan();
      const st = this.usageState();
      untracked(() => {
        if (id !== null && st && this.shownTabId === tab.id) {
          this.showUsage(id, st);
        }
      });
    });
    effect(() => {
      const listing = this.store.listing();
      untracked(() => {
        const id = this.tabId();
        if (listing?.archive) {
          this.ws.noteArchive(listing.archive.path);
        }
        if (listing && this.ownsListing(id) && this.store.searchKey() === null) {
          this.ws.navigated(id, listing.path, listing.segments.at(-1)?.name ?? listing.path);
        }
      });
    });
    effect(() => {
      const cursor = this.store.cursorPath();
      untracked(() => {
        const id = this.tabId();
        if (this.ownsListing(id) && this.tab().cursor !== cursor) {
          this.ws.updateTab(id, { cursor });
        }
      });
    });
    effect(() => {
      const req = this.ws.focusRequest();
      untracked(() => {
        if (req?.side === this.side()) {
          this.list()?.focus();
        }
      });
    });
    // filter and hidden state belong to the tab
    effect(() => {
      const state = {
        hiddenVisible: this.store.hiddenVisible(),
        filterActive: this.store.filterActive(),
        filterText: this.store.filterText(),
      };
      untracked(() => {
        const tab = this.tab();
        if (
          this.shownTabId === tab.id &&
          (tab.hiddenVisible !== state.hiddenVisible ||
            tab.filterActive !== state.filterActive ||
            tab.filterText !== state.filterText)
        ) {
          this.ws.updateTab(tab.id, state);
        }
      });
    });
    // a job changed the shown folder (copy target, …): reload, cursor and marks stay;
    // together with the watcher at most one reload at a time (design 012 E4)
    effect(() => {
      const change = this.jobs.changedDirs();
      untracked(() => {
        const path = this.store.path();
        if (change && path !== null && change.dirs.includes(path)) {
          this.store.requestRefresh();
        }
        // flat view: a job changed a folder at or below its root (design 038 E5)
        const ref = this.tab().search;
        if (change && ref?.flat && this.store.flat() && shouldRefresh(ref.flat.root, change.dirs)) {
          this.search.refresh(ref.key);
        }
      });
    });
    // the shown folder is watched (design 012 E2)
    effect(() => {
      // a flat view watches its root (not recursively, design 038 E5)
      const flatRoot = this.store.flat() ? (this.tab().search?.flat?.root ?? null) : null;
      const path = this.store.path() ?? flatRoot;
      // a folder inside an archive is virtual: nothing to watch (design 016 E1)
      const dir = this.store.archive() === null ? path : null;
      untracked(() => this.watch.setPanelDir(this.side(), dir, this.store.listedAt ?? undefined));
    });
    effect(() => {
      const req = this.ws.navigateRequest();
      untracked(() => {
        if (req?.side === this.side() && !this.store.navigationLocked()) {
          void this.store.load(req.path ?? undefined);
        }
      });
    });
    effect(() => {
      const req = this.ws.pathEditRequest();
      untracked(() => {
        if (req?.side === this.side()) {
          this.startPathEdit();
        }
      });
    });
    effect(() => {
      const req = this.ws.reloadRequest();
      untracked(() => {
        if (req?.side === this.side()) {
          const key = this.tab().search?.key;
          // a result tab "reloads" by searching again, a disk-usage tab scans the folder again
          void (isUsageKey(key)
            ? this.usage.rescan(scanIdOf(key))
            : key
              ? this.search.rerun(key)
              : this.store.refresh());
        }
      });
    });
  }

  ngOnInit(): void {
    this.store.openInNewTab = (path, cursor) => this.ws.openInNewTab(this.side(), path, '', cursor);
    this.store.confirmExecutable = (entry) =>
      this.confirm.ask({
        title: TEXTS.runProgramTitle,
        message: TEXTS.runProgramMessage,
        detail: entry.path,
        confirmLabel: TEXTS.runProgramConfirm,
      });
    // the side is fixed for the lifetime of a panel
    this.store.stopResult = () => this.stopSearch();
    const unregister = this.ws.registerPanel(this.side(), {
      store: this.store,
      controller: () => this.list()?.listController,
      cancelLoading: () => this.cancelLoading(),
      toggleFlat: () => this.toggleFlat(),
      setFlatDirs: (show) => this.setFlatDirs(show),
    });
    this.destroyRef.onDestroy(unregister);
    const unwatch = this.watch.on((event) => this.onWatchEvent(event));
    this.destroyRef.onDestroy(() => {
      unwatch();
      this.watch.setPanelDir(this.side(), null);
    });
  }

  /** Changes of the shown folder by other programs (design 012 E3). */
  private onWatchEvent(event: WatchEvent): void {
    const ref = this.tab().search;
    if (ref?.flat && this.store.flat()) {
      // something changed in the root of the flat view: list it again (throttled, design 038 E5)
      if (event.dir === ref.flat.root) {
        this.search.requestRefresh(ref.key);
      }
      return;
    }
    if (event.dir !== this.store.path() || this.store.navigationLocked()) {
      return;
    }
    switch (event.type) {
      case 'changes': {
        const displayed = this.list()?.listController?.displayedEntries();
        this.store.applyChanges(event.dir, event.upserted, event.removed, displayed);
        break;
      }
      case 'rescan':
        this.store.requestRefresh();
        break;
      case 'gone':
        void this.store.goToExistingAncestor();
        break;
    }
  }

  protected activate(evt?: Event): void {
    // the chart of the other side's disk-usage tab works for that side (design 033 E1):
    // clicking it must not make this side active (the chart would vanish under the pointer)
    const target = evt?.target;
    if (target instanceof Element && target.closest('app-disk-usage-chart')) {
      return;
    }
    this.ws.setActive(this.side());
  }

  protected openSegment(segment: PathSegment): void {
    if (segment.path !== this.store.path() && !this.store.navigationLocked()) {
      void this.store.load(segment.path, { cursor: this.childOf(segment) });
    }
  }

  protected startPathEdit(): void {
    this.pathError.set(null);
    this.editingPath.set(true);
    setTimeout(() => {
      const input = document.getElementById(`${this.pathId}-input`) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  /** Esc: close and give the focus back to the list. */
  protected cancelPathEdit(): void {
    this.closePathEdit();
    this.ws.requestFocus(this.side());
  }

  /** Focus left the input (Tab): close, but let the focus go where the user moved it. */
  protected closePathEdit(): void {
    this.editingPath.set(false);
    this.pathError.set(null);
  }

  protected async submitPath(evt: Event, value: string): Promise<void> {
    evt.preventDefault();
    // a server address opens the connection dialog with it (design 034 E8)
    if (isServerUrl(value)) {
      this.editingPath.set(false);
      this.pathError.set(null);
      void this.remote.openUrl(value.trim());
      return;
    }
    if (isRemotePath(value.trim())) {
      await this.store.load(value.trim());
      this.editingPath.set(false);
      this.pathError.set(null);
      return;
    }
    try {
      const loc = await this.fsApi.resolveLocation(value);
      await this.store.load(loc.dir, loc.select !== null ? { cursor: loc.select } : {});
      if (this.store.error()) {
        this.pathError.set(describeFsError(this.store.error()!));
        this.store.dismissError();
        return;
      }
      this.editingPath.set(false);
      this.pathError.set(null);
      this.ws.requestFocus(this.side());
    } catch (err) {
      this.pathError.set(describeFsError(toFsError(err)));
    }
  }

  /** "Connect" in the panel of a server tab that is not connected (design 034 §4.3). */
  protected connectServer(): void {
    const path = this.offline() ?? this.tab().path;
    const id = path ? profileOf(path) : null;
    if (path && id) {
      void this.remote.connect(id, { then: () => this.store.load(path) });
    }
  }

  protected disconnectServer(id: string): void {
    void this.remote.disconnect(id);
  }

  protected onPathKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.cancelPathEdit();
    }
  }

  /** Click on the free space of the path bar (not on a segment) opens the path input (keyboard: Strg/⌘+L). */
  protected onHeaderClick(evt: MouseEvent): void {
    if ((evt.target as Element).classList.contains('crumbs')) {
      this.startPathEdit();
    }
  }

  protected toggleFavorite(): void {
    const path = this.store.path();
    if (path !== null) {
      this.ws.toggleFavorite(path);
    }
  }

  protected openInNewTab(entry: DirEntry): void {
    this.ws.openInNewTab(this.side(), entry.path, entry.name);
  }

  /** Header of a result tab: double click opens the search with its values (ui-layout). */
  protected editSearch(): void {
    if (this.tab().search) {
      this.ws.setActive(this.side());
      if (this.searchResult()?.kind === 'duplicates') {
        this.dup.open();
      } else {
        this.find.open();
      }
    }
  }

  /** Selection helpers of a duplicate tab (design 016 E6). */
  protected keep(rule: KeepRule): void {
    this.ws.setActive(this.side());
    this.dup.markAllBut(rule);
  }

  protected rerunSearch(): void {
    const key = this.tab().search?.key;
    if (key) {
      void this.search.rerun(key);
    }
  }

  protected stopSearch(): void {
    const key = this.tab().search?.key;
    if (key) {
      this.search.stop(key);
    }
  }

  /** Right click in the list (design 014 E3); the menu service is root-wide, fetched lazily. */
  protected onListContextMenu(evt: { rowIndex: number; x: number; y: number }): void {
    this.injector.get(MenuService).openFromPointer(this.side(), evt.rowIndex, evt.x, evt.y);
  }

  protected onTableState(state: Partial<TableStateIf>): void {
    const id = this.tabId();
    if (this.ownsListing(id)) {
      this.ws.updateTab(id, { table: state });
    }
  }

  /** Separator before segment `i` – none after a root that ends with a separator (`/`, `C:\`). */
  protected needsSeparator(i: number): boolean {
    if (i === 0) {
      return false;
    }
    if (i > 1) {
      return true;
    }
    return !/[\\/]$/.test(this.segments()[0].name);
  }

  /** When going up via the breadcrumb, put the cursor on the folder we came from. */
  private childOf(segment: PathSegment): string | null {
    const segs = this.segments();
    const i = segs.findIndex((s) => s.path === segment.path);
    return i >= 0 && i + 1 < segs.length ? segs[i + 1].path : null;
  }

  /** True once the listing of tab `id` (or a folder navigated to from it) is shown. */
  private ownsListing(id: string): boolean {
    return this.shownTabId === id && this.store.listing() !== this.listingAtSwitch;
  }

  private async showTab(id: string): Promise<void> {
    const previous = this.shownTabId;
    if (previous !== null && previous !== id && this.ownsListing(previous)) {
      const table = this.list()?.captureTableState();
      this.ws.updateTab(previous, {
        cursor: this.store.cursorPath(),
        ...(table ? { table } : {}),
      });
    }
    this.store.rememberCurrent();
    this.store.cancelSizeJobs();
    if (previous !== id) {
      this.previousTabId = previous;
    }
    this.cancelledTab.set(null);
    this.shownTabId = id;
    this.listingAtSwitch = this.store.listing();
    const tab = this.ws.activeTab(this.side());
    this.store.setMemory(this.ws.memory(id));
    this.store.setFilter(tab);
    this.store.setPendingTableState(tab.table);
    if (tab.search && isUsageKey(tab.search.key)) {
      this.store.navigationLocked.set(false);
      this.store.setCursor(tab.cursor);
      const id = scanIdOf(tab.search.key);
      const st = this.usage.state(id);
      this.usageCursorSeq = st?.cursorSeq ?? -1;
      if (st) {
        this.showUsage(id, st);
      } else {
        // the scan is gone (released): an empty result with a hint
        this.store.leaveResult();
        this.store.showSearch(tab.search.key, [], 'usage', { parent: null, marked: new Set() });
      }
      return;
    }
    this.store.leaveResult();
    if (tab.search) {
      this.store.navigationLocked.set(false);
      this.store.setCursor(tab.cursor);
      if (tab.search.flat) {
        this.store.flatNav = this.flatNavigator();
      }
      const result = this.search.result(tab.search.key);
      this.store.showSearch(tab.search.key, result?.hits ?? [], result?.kind ?? kindOf(tab));
      return;
    }
    // a slow folder seen before comes from the cache at once (design 030 E1, replaces 029 E5)
    // nothing of another tab under this one: an empty list and this tab's path until it is read
    if (this.listingAtSwitch !== null && this.listingAtSwitch?.path !== tab.path) {
      this.store.clearListing();
      this.listingAtSwitch = null;
    }
    this.store.navigationLocked.set(true);
    const applied = this.store.appliedCount;
    try {
      await this.store.load(tab.path ?? undefined, {
        cursor: tab.cursor,
        history: 'none',
        remember: false,
      });
    } finally {
      if (this.shownTabId === id) {
        this.store.navigationLocked.set(false);
      }
    }
    if (this.shownTabId !== id) {
      return;
    }
    const listing = this.store.listing();
    // not "the same object as before": a cached listing can be exactly that (review 030 #3)
    if (this.store.appliedCount === applied) {
      // folder not readable: keep showing what is there; navigation from here belongs to this tab
      this.store.setPendingTableState(null);
      return;
    }
    // the listing effect may have run before this point – report the folder now
    if (listing) {
      this.ws.navigated(id, listing.path, listing.segments.at(-1)?.name ?? listing.path);
    }
  }

  // ---- flat view (design 038) ----

  /**
   * Mod+B: the active tab shows its folder flat – all entries below it – or, if it
   * does, the normal view again (E1). Same tab: id, path and history stay.
   */
  async toggleFlat(): Promise<void> {
    const tab = this.tab();
    if (tab.search?.flat) {
      return this.leaveFlat();
    }
    const root = this.store.path();
    if (
      tab.search ||
      root === null ||
      this.store.archive() !== null ||
      this.store.remote() !== null ||
      this.store.cachedAt() !== null ||
      this.store.loading()
    ) {
      return;
    }
    const id = tab.id;
    const cursorBefore = this.store.cursorPath();
    const tableBefore = this.list()?.captureTableState() ?? tab.table;
    const showDirs = this.search.flatShowDirs;
    const error = await this.search.startFlat(
      root,
      { includeHidden: this.store.hiddenVisible(), showDirs },
      (key) => {
        const now = this.ws.findTab(id);
        if (!now || now.search || now.path !== root) {
          return; // the tab went elsewhere meanwhile – the result is released
        }
        if (this.shownTabId === id) {
          this.store.rememberCurrent();
        }
        const title = now.title;
        this.ws.updateTab(id, {
          search: {
            key,
            label: title,
            rootTitle: title,
            flat: { root, cursorBefore, tableBefore, showDirs },
          },
          cursor: null,
          table: null,
        });
        if (this.shownTabId === id) {
          void this.showTab(id);
        }
      },
    );
    if (error) {
      this.store.error.set(error);
    }
  }

  /**
   * Back to the normal view of the root with the cursor where it was (E1); `then`
   * goes on into a folder from there (Enter on a folder, E6) – the root is history.
   */
  private async leaveFlat(then?: { navigate: string; cursor: string | null }): Promise<void> {
    const tab = this.tab();
    const flat = tab.search?.flat;
    if (!flat) {
      return;
    }
    const id = tab.id;
    // the result is released once no tab shows it (its listing is cancelled)
    this.ws.updateTab(id, {
      search: null,
      path: flat.root,
      cursor: then ? null : flat.cursorBefore,
      table: flat.tableBefore,
    });
    await this.showTab(id);
    if (then && this.shownTabId === id && this.store.path() === flat.root) {
      await this.store.load(then.navigate, { cursor: then.cursor });
    }
  }

  /** "Show folders" of the flat view (E4): listed again with or without folders. */
  private setFlatDirs(show: boolean): void {
    const tab = this.tab();
    const ref = tab.search;
    if (!ref?.flat) {
      return;
    }
    this.search.flatShowDirs = show;
    this.ws.updateTab(tab.id, { search: { ...ref, flat: { ...ref.flat, showDirs: show } } });
    this.search.refresh(ref.key, { showDirs: show });
  }

  private flatNavigator(): FlatNavigator {
    return {
      leave: (then) => this.leaveFlat(then),
      up: async () => {
        await this.leaveFlat();
        if (!this.store.flat()) {
          await this.store.up();
        }
      },
      refresh: () => {
        const key = this.tab().search?.key;
        if (key) {
          this.search.refresh(key);
        }
      },
    };
  }

  /** Header checkbox "Show folders". */
  protected onFlatDirs(evt: Event): void {
    this.setFlatDirs((evt.target as HTMLInputElement).checked);
  }

  /** Header button "Normal view". */
  protected normalView(): void {
    void this.leaveFlat().then(() => this.ws.requestFocus(this.side()));
  }

  /** Cursor request of the disk-usage store already applied (after a navigation). */
  private usageCursorSeq = -1;

  /** Shows the level of scan `id` in the list; marks come from its basket (design 033 E3). */
  private showUsage(id: string, st: UsageState): void {
    this.store.usageNav = this.usage.navigator(id);
    this.store.showSearch(usageKey(id), st.rows, 'usage', {
      parent: this.usage.parentPath(id),
      marked: this.usage.levelMarks(id),
    });
    this.store.markedOverride.set(this.usage.basket(id).effective);
    if (st.cursorSeq !== this.usageCursorSeq) {
      this.usageCursorSeq = st.cursorSeq;
      this.store.setCursor(st.cursor);
    }
  }

  protected usageObjects(st: UsageState): string {
    const n = st.view?.node;
    return n ? USAGE_TEXTS.objects(n.files + n.dirs) : '';
  }

  protected usageProgress(): string {
    const id = this.usageScan();
    const job = id ? this.jobs.find(id) : undefined;
    const p = job?.progress;
    return p ? USAGE_TEXTS.scanning(p.itemsDone, formatSize(p.bytesDone)) : '';
  }

  protected usageAsOf(st: UsageState): string {
    const at = st.view?.scannedAtMs;
    return at ? USAGE_TEXTS.asOf(new Date(at).toLocaleTimeString()) : '';
  }

  protected usageCrumb(id: number): void {
    const scan = this.usageScan();
    if (scan) {
      void this.usage.goTo(scan, id);
    }
  }

  protected usageStop(): void {
    const scan = this.usageScan();
    if (scan) {
      this.usage.stop(scan);
    }
  }

  protected usageRescan(): void {
    const scan = this.usageScan();
    if (scan) {
      void this.usage.rescan(scan);
    }
  }

  protected usageMode(mode: 'all' | 'largest'): void {
    const scan = this.usageScan();
    if (scan) {
      void this.usage.setMode(scan, mode);
      this.ws.requestFocus(this.side());
    }
  }

  protected readonly formatCount = formatCount;
  protected readonly fsErrorText = describeError;

  /**
   * Esc / "Cancel" while a folder opens (design 029 E4/E5): a navigation is given
   * up and the list stays; a tab whose folder never showed goes back to the tab
   * before it (at once from the cache if that folder is slow), else it offers "Try again".
   */
  cancelLoading(): boolean {
    const opening = this.store.navigationLocked() && this.store.listing() === null;
    if (!this.store.cancelLoad()) {
      return false;
    }
    // the given-up request may never come back (hanging drive): unlock now
    this.store.navigationLocked.set(false);
    if (!opening) {
      return true;
    }
    const tabs = this.ws.panels()[this.side()].tabs;
    const back = tabs.findIndex((t) => t.id === this.previousTabId);
    if (back >= 0 && this.previousTabId !== this.shownTabId) {
      this.ws.selectTab(this.side(), back);
    } else {
      this.cancelledTab.set(this.shownTabId);
    }
    return true;
  }

  /** "Try again" after a cancelled tab. */
  protected retryTab(): void {
    this.cancelledTab.set(null);
    void this.showTab(this.tabId());
  }
}

/** What a result tab shows while its result is gone (released): a flat view stays one. */
function kindOf(tab: { readonly search?: { readonly flat?: unknown } | null }): 'flat' | 'search' {
  return tab.search?.flat ? 'flat' : 'search';
}
