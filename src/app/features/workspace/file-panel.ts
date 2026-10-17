import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import type { TableStateIf } from '@guiexpert/table';
import { describeFsError } from '../../core/fs/fs-error';
import { DirEntry, DirectoryListing, PathSegment } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';
import { formatSize } from '../../shared/format';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileList } from '../browser/file-list/file-list';
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
  imports: [FileList, TabBar],
  providers: [FileBrowserStore],
  templateUrl: './file-panel.html',
  styleUrl: './file-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.side-left]': "side() === 'left'",
    '[class.side-right]': "side() === 'right'",
    '(pointerdown)': 'activate()',
    '(focusin)': 'activate()',
    '(keydown)': 'onKeydown($event)',
  },
})
export class FilePanel {
  readonly side = input.required<Side>();

  protected readonly store = inject(FileBrowserStore);
  protected readonly ws = inject(WorkspaceStore);
  protected readonly texts = TEXTS;
  protected readonly pathId = `fnf-path-${++panelSeq}`;
  private readonly list = viewChild(FileList);

  protected readonly active = computed(() => this.ws.activeSide() === this.side());
  protected readonly tab = computed(() => this.ws.activeTab(this.side()));
  private readonly tabId = computed(() => this.tab().id);

  protected readonly errorText = computed(() => {
    const err = this.store.error();
    return err ? describeFsError(err) : null;
  });
  protected readonly isFavorite = computed(() => this.ws.isFavorite(this.store.path()));
  protected readonly segments = computed(() => this.store.listing()?.segments ?? []);
  protected readonly summary = computed(() => summarize(this.store.entries(), this.store.marked()));
  protected readonly formatSize = formatSize;

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
    effect(() => {
      const req = this.ws.reloadRequest();
      untracked(() => {
        if (req?.side === this.side()) {
          void this.store.refresh();
        }
      });
    });
  }

  protected activate(): void {
    this.ws.setActive(this.side());
  }

  protected onKeydown(evt: KeyboardEvent): void {
    const plain = !evt.ctrlKey && !evt.metaKey && !evt.altKey && !evt.shiftKey;
    const inList = evt.target instanceof Element && evt.target.closest('app-file-list') !== null;
    if (evt.key === 'Tab' && plain && inList) {
      evt.preventDefault();
      this.ws.toggleActive();
    }
  }

  protected openSegment(segment: PathSegment): void {
    if (segment.path !== this.store.path()) {
      void this.store.load(segment.path, { cursor: this.childOf(segment) });
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
    this.shownTabId = id;
    this.listingAtSwitch = this.store.listing();
    const tab = this.ws.activeTab(this.side());
    this.store.setPendingTableState(tab.table);
    await this.store.load(tab.path ?? undefined, { cursor: tab.cursor });
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
