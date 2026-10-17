import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { TableStateIf } from '@guiexpert/table';
import { FsApi } from '../../core/fs/fs-api';
import { describeFsError, toFsError } from '../../core/fs/fs-error';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { JobsStore } from '../../core/jobs/jobs.store';
import { WatchService } from '../../core/watch/watch.service';
import { WatchEvent } from '../../core/watch/watch.models';
import { DirEntry, DirectoryListing, PathSegment } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';
import { formatSize } from '../../shared/format';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileList } from '../browser/file-list/file-list';
import { QuickView } from '../preview/quick-view';
import { QuickViewStore } from '../preview/quick-view.store';
import { summarize } from './status';
import { TabBar } from './tab-bar';
import { TEXTS } from './texts';
import { WorkspaceStore } from './workspace.store';

let panelSeq = 0;

/**
 * One side of the window: path header, tab bar, file list and status line.
 * The host is `display: contents` – its four parts are items of the workspace
 * grid, so one splitter moves all rows. Owns the per-panel `FileBrowserStore`
 * and syncs it with the active tab of its side in the {@link WorkspaceStore}.
 */
@Component({
  selector: 'app-file-panel',
  imports: [FileList, TabBar, QuickView],
  providers: [FileBrowserStore],
  templateUrl: './file-panel.html',
  styleUrl: './file-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.side-left]': "side() === 'left'",
    '[class.side-right]': "side() === 'right'",
    '(pointerdown)': 'activate()',
    '(focusin)': 'activate()',
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
  /** This side shows the quick view of the other side's cursor (design 010 E4). */
  protected readonly quickView = computed(() => this.quick.shownOn() === this.side());
  protected readonly tab = computed(() => this.ws.activeTab(this.side()));
  private readonly tabId = computed(() => this.tab().id);

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
  private readonly fsApi = inject(FsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly jobs = inject(JobsStore);
  private readonly watch = inject(WatchService);
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

  constructor() {
    effect(() => {
      const id = this.tabId();
      untracked(() => void this.showTab(id));
    });
    effect(() => {
      const listing = this.store.listing();
      untracked(() => {
        const id = this.tabId();
        if (listing && this.ownsListing(id)) {
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
      });
    });
    // the shown folder is watched (design 012 E2)
    effect(() => {
      const path = this.store.path();
      untracked(() => this.watch.setPanelDir(this.side(), path));
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
          void this.store.refresh();
        }
      });
    });
  }

  ngOnInit(): void {
    this.store.confirmExecutable = (entry) =>
      this.confirm.ask({
        title: TEXTS.runProgramTitle,
        message: TEXTS.runProgramMessage,
        detail: entry.path,
        confirmLabel: TEXTS.runProgramConfirm,
      });
    // the side is fixed for the lifetime of a panel
    const unregister = this.ws.registerPanel(this.side(), {
      store: this.store,
      controller: () => this.list()?.listController,
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

  protected activate(): void {
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
    this.shownTabId = id;
    this.listingAtSwitch = this.store.listing();
    const tab = this.ws.activeTab(this.side());
    this.store.setMemory(this.ws.memory(id));
    this.store.setFilter(tab);
    this.store.setPendingTableState(tab.table);
    this.store.navigationLocked.set(true);
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
    if (listing === this.listingAtSwitch) {
      // folder not readable: keep showing what is there; navigation from here belongs to this tab
      this.store.setPendingTableState(null);
      return;
    }
    // the listing effect may have run before this point – report the folder now
    if (listing) {
      this.ws.navigated(id, listing.path, listing.segments.at(-1)?.name ?? listing.path);
    }
  }
}
