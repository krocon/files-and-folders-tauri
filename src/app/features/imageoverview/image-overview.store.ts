import { computed, inject, Injectable, signal } from '@angular/core';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, PathSegment } from '../../core/fs/fs.models';
import { FsApi } from '../../core/fs/fs-api';
import { ImageOverviewApi } from '../../core/imageoverview/image-overview-api';
import { OverviewEvent, OverviewItem } from '../../core/imageoverview/image-overview.models';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { WatchEvent } from '../../core/watch/watch.models';
import { WatchService } from '../../core/watch/watch.service';
import { SelectionSource } from '../ops/ops-logic';
import { CursorMove, moveCursor } from './grid-math';
import {
  clampTile,
  filterItems,
  findByPrefix,
  indexOfPath,
  OverviewSort,
  rangePaths,
  sortItems,
  toEntry,
  withoutPaths,
  zoomTile,
} from './overview-logic';

/** Where the overview was opened from: the panel it covers and returns to. */
export interface OverviewOrigin {
  readonly side: Side;
  /** The folder of that panel's tab (opaque). */
  readonly folder: string;
  /** The panel's cursor – the overview starts on it if it is an image. */
  readonly cursor: string | null;
}

/** State of a running or finished collection. */
export interface OverviewLoad {
  readonly loading: boolean;
  readonly truncated: boolean;
  readonly cancelled: boolean;
  /** The folder could not be read at all. */
  readonly error: FsError | null;
  /** Subfolders that could not be read. */
  readonly unreadable: number;
}

const IDLE: OverviewLoad = {
  loading: false,
  truncated: false,
  cancelled: false,
  error: null,
  unreadable: 0,
};

/**
 * The image overview (design 074): open over both panels (E1), the images of one folder
 * (optionally below it), cursor and marks of its own (E2 – the cover grid has none) and the
 * large view. Root store: there is one overview per window. Implements `SelectionSource`, so
 * the normal operations (F5/F6/F8) work on its marks (E15).
 */
@Injectable({ providedIn: 'root' })
export class ImageOverviewStore implements SelectionSource {
  private readonly api = inject(ImageOverviewApi);
  private readonly settings = inject(SettingsStore);
  private readonly watch = inject(WatchService);
  private readonly fs = inject(FsApi);

  /** Open → the workspace shows the overview instead of the panels. */
  readonly origin = signal<OverviewOrigin | null>(null);
  readonly isOpen = computed(() => this.origin() !== null);
  /** The folder shown (the tree or the path bar may change it). */
  readonly folder = signal<string | null>(null);
  readonly recursive = signal(false);
  /** Path bar of the shown folder (Rust's segments) and its parent. */
  readonly segments = signal<readonly PathSegment[]>([]);
  readonly parent = signal<string | null>(null);
  /** Subfolders of the shown folder (root of the tree). */
  readonly subfolders = signal<readonly DirEntry[]>([]);
  /** Id of the overview in Rust (thumbnail URLs). */
  readonly overviewId = signal<string | null>(null);
  readonly load = signal<OverviewLoad>(IDLE);
  /** All images in Rust's order. */
  private readonly all = signal<readonly OverviewItem[]>([]);
  readonly filter = signal('');
  readonly sort = computed(() => this.settings.get('imageOverview.sort') as OverviewSort);
  readonly tileSize = computed(() => clampTile(this.settings.get('imageOverview.tileSize')));
  readonly treeVisible = computed(() => this.settings.get('imageOverview.tree'));
  /** The images shown: sorted, filtered. */
  readonly items = computed(() => filterItems(sortItems(this.all(), this.sort()), this.filter()));
  readonly total = computed(() => this.all().length);
  readonly cursorPath = signal<string | null>(null);
  readonly cursor = computed(() => indexOfPath(this.items(), this.cursorPath()));
  readonly cursorItem = computed(() => this.items()[this.cursor()] ?? null);
  readonly marked = signal<ReadonlySet<string>>(new Set());
  /** Index in `items` shown large, or null (E14). */
  readonly large = signal<number | null>(null);
  /** Counts a move of the user – the grid scrolls the cursor into view. */
  readonly revealTick = signal(0);
  /** Start of a Shift range (the cursor before the first Shift move). */
  private anchor: string | null = null;
  private seq = 0;
  private unwatch: (() => void) | null = null;

  /** Opens the overview for the panel `origin` (E2). */
  async show(origin: OverviewOrigin): Promise<void> {
    this.origin.set(origin);
    this.filter.set('');
    this.marked.set(new Set());
    this.large.set(null);
    this.cursorPath.set(origin.cursor);
    this.unwatch ??= this.watch.on((e) => this.onWatch(e));
    await this.openFolder(origin.folder, origin.cursor);
  }

  /** Closes the overview; the panels are shown again unchanged. */
  close(): void {
    const id = this.overviewId();
    this.seq += 1;
    if (id !== null) {
      void this.api.close(id);
    }
    this.watch.setPanelDir('overview', null);
    this.unwatch?.();
    this.unwatch = null;
    this.origin.set(null);
    this.overviewId.set(null);
    this.all.set([]);
    this.load.set(IDLE);
    this.large.set(null);
    this.folder.set(null);
    this.segments.set([]);
    this.subfolders.set([]);
  }

  /** Shows another folder (tree, path bar); `cursor` = the path to start on. */
  async openFolder(folder: string, cursor: string | null = null): Promise<void> {
    if (this.folder() !== folder) {
      this.marked.set(new Set());
      this.filter.set('');
    }
    this.folder.set(folder);
    this.watch.setPanelDir('overview', folder, Date.now());
    void this.loadFolderInfo(folder);
    await this.collect(cursor, false);
  }

  /** Path bar, parent and subfolders of `folder` (one listing; failures leave them empty). */
  private async loadFolderInfo(folder: string): Promise<void> {
    try {
      const listing = await this.fs.listDirectory(folder);
      if (this.folder() !== folder) {
        return;
      }
      this.segments.set(listing.segments);
      this.parent.set(listing.parent);
      this.subfolders.set(listing.entries.filter(isVisibleFolder));
    } catch {
      if (this.folder() === folder) {
        this.segments.set([]);
        this.parent.set(null);
        this.subfolders.set([]);
      }
    }
  }

  /** Subfolders of any folder for the tree (empty when unreadable). */
  async subfoldersOf(folder: string): Promise<readonly DirEntry[]> {
    try {
      return (await this.fs.listDirectory(folder)).entries.filter(isVisibleFolder);
    } catch {
      return [];
    }
  }

  /** "Include subfolders" on/off. */
  async setRecursive(on: boolean): Promise<void> {
    if (this.recursive() === on) {
      return;
    }
    this.recursive.set(on);
    await this.collect(this.cursorPath(), false);
  }

  /** Lists again (Ctrl+R, the watcher) – the images stay visible meanwhile. */
  async reload(): Promise<void> {
    await this.collect(this.cursorPath(), true);
  }

  /**
   * Asks Rust for the images of the shown folder. A newer request makes older events
   * stale (CLAUDE.md §4). `background`: the old images stay until the new list is complete.
   */
  private async collect(cursor: string | null, background: boolean): Promise<void> {
    const folder = this.folder();
    if (folder === null) {
      return;
    }
    const seq = ++this.seq;
    const before = this.overviewId();
    if (!background) {
      this.all.set([]);
    }
    this.load.set({ ...IDLE, loading: true });
    const parts: OverviewItem[] = [];
    let id: string;
    try {
      id = await this.api.open(folder, this.recursive(), (e) => {
        if (seq !== this.seq) {
          return;
        }
        this.onEvent(e, parts, background, cursor);
      });
    } catch (err) {
      if (seq === this.seq) {
        this.load.set({ ...IDLE, error: toFsError(err) });
      }
      return;
    }
    if (seq !== this.seq) {
      void this.api.close(id);
      return;
    }
    // the previous overview's thumbnails are not needed once the new one is shown
    if (!background && before !== null) {
      void this.api.close(before);
    }
    this.overviewId.set(id);
    this.pendingClose = background ? before : null;
  }

  /** In a background reload the old overview stays served until the new list is in. */
  private pendingClose: string | null = null;

  private onEvent(
    e: OverviewEvent,
    parts: OverviewItem[],
    background: boolean,
    cursor: string | null,
  ): void {
    switch (e.kind) {
      case 'items':
        parts.push(...e.items);
        if (!background) {
          this.all.set([...parts]);
          this.placeCursor(cursor);
        }
        return;
      case 'done': {
        const folderError = e.unreadable.length > 0 && parts.length === 0 && e.unreadable[0];
        this.all.set([...parts]);
        if (this.pendingClose !== null) {
          void this.api.close(this.pendingClose);
          this.pendingClose = null;
        }
        // marks of images that are gone go too
        const present = new Set(parts.map((p) => p.path));
        const marks = this.marked();
        if ([...marks].some((m) => !present.has(m))) {
          this.marked.set(new Set([...marks].filter((m) => present.has(m))));
        }
        this.placeCursor(cursor);
        this.load.set({
          loading: false,
          truncated: e.truncated,
          cancelled: false,
          error: folderError && folderError.path === this.folder() ? folderError : null,
          unreadable: e.unreadable.length + e.unreadableMore,
        });
        return;
      }
      case 'cancelled':
        this.load.set({ ...IDLE, cancelled: true });
        return;
    }
  }

  /** Puts the cursor on `wanted` if it is shown, else keeps a valid one (first image). */
  private placeCursor(wanted: string | null): void {
    const items = this.items();
    const current = this.cursorPath();
    if (wanted !== null && indexOfPath(items, wanted) >= 0) {
      if (current !== wanted) {
        this.cursorPath.set(wanted);
        this.revealTick.update((n) => n + 1);
      }
      return;
    }
    if (indexOfPath(items, current) < 0) {
      this.cursorPath.set(items[0]?.path ?? null);
    }
  }

  // ---- cursor and marks ----

  /** Moves the cursor (arrows, Home/End, PgUp/PgDn); `extend` = Shift marks the range. */
  move(m: CursorMove, cols: number, pageRows: number, extend = false): void {
    const items = this.items();
    const from = this.cursor();
    const to = moveCursor(from, m, cols, items.length, pageRows);
    if (to < 0) {
      return;
    }
    this.focusIndex(to, extend);
  }

  /** Puts the cursor on `index`; `extend` marks from the anchor to it. */
  focusIndex(index: number, extend = false): void {
    const items = this.items();
    const item = items[index];
    if (!item) {
      return;
    }
    if (extend) {
      this.anchor ??= this.cursorPath() ?? item.path;
      const a = indexOfPath(items, this.anchor);
      const next = new Set(this.marked());
      for (const p of rangePaths(items, a < 0 ? index : a, index)) {
        next.add(p);
      }
      this.marked.set(next);
    } else {
      this.anchor = null;
    }
    this.cursorPath.set(item.path);
    this.revealTick.update((n) => n + 1);
  }

  /** Space / Insert / Mod+click: marks or unmarks one image. */
  toggleMark(path: string | null = this.cursorPath()): void {
    if (path === null) {
      return;
    }
    const next = new Set(this.marked());
    if (!next.delete(path)) {
      next.add(path);
    }
    this.marked.set(next);
  }

  /** Marks all shown images, or none when all are marked. */
  toggleAll(): void {
    const items = this.items();
    const all = items.length > 0 && items.every((i) => this.marked().has(i.path));
    this.marked.set(all ? new Set() : new Set(items.map((i) => i.path)));
  }

  /** Type-ahead: the next image whose name starts with `prefix`. */
  jumpTo(prefix: string, fromNext: boolean): boolean {
    const i = findByPrefix(this.items(), prefix, this.cursor() + (fromNext ? 1 : 0));
    if (i >= 0) {
      this.focusIndex(i);
    }
    return i >= 0;
  }

  /** Mod+= / Mod+- / the slider. */
  zoom(direction: 1 | -1): void {
    this.setTileSize(zoomTile(this.tileSize(), direction));
  }

  setTileSize(width: number): void {
    this.settings.set('imageOverview.tileSize', clampTile(width));
  }

  setSort(sort: OverviewSort): void {
    this.settings.set('imageOverview.sort', sort);
  }

  toggleTree(): void {
    this.settings.set('imageOverview.tree', !this.treeVisible());
  }

  // ---- large view (E14) ----

  openLarge(index = this.cursor()): void {
    if (this.items()[index]) {
      this.large.set(index);
    }
  }

  /** ←/→ in the large view; the cursor follows (Esc returns to that tile). */
  step(delta: number): void {
    const i = this.large();
    const n = this.items().length;
    if (i === null || n === 0) {
      return;
    }
    const next = Math.min(n - 1, Math.max(0, i + delta));
    this.large.set(next);
    this.cursorPath.set(this.items()[next].path);
  }

  stepTo(index: number): void {
    const n = this.items().length;
    if (this.large() !== null && n > 0) {
      const next = Math.min(n - 1, Math.max(0, index));
      this.large.set(next);
      this.cursorPath.set(this.items()[next].path);
    }
  }

  closeLarge(): void {
    if (this.large() !== null) {
      this.large.set(null);
      this.revealTick.update((n) => n + 1);
    }
  }

  // ---- operations (E15) ----

  /** The folder of a shown image (rename works there), or null. */
  dirOf(path: string): string | null {
    return this.all().find((i) => i.path === path)?.dir ?? null;
  }

  markedEntries(): readonly DirEntry[] {
    const marks = this.marked();
    return this.items()
      .filter((i) => marks.has(i.path))
      .map(toEntry);
  }

  cursorEntry(): DirEntry | null {
    const i = this.cursorItem();
    return i ? toEntry(i) : null;
  }

  /**
   * A job of the operations ended (`folder` = the source folder it was started with):
   * processed images are unmarked; deleted/moved ones leave the overview at once – no
   * reload, no flicker (E16).
   */
  afterJob(folder: string, done: readonly string[], removes: boolean): void {
    if (!this.isOpen() || folder !== this.folder() || done.length === 0) {
      return;
    }
    const gone = new Set(done);
    const marks = this.marked();
    if ([...marks].some((m) => gone.has(m))) {
      this.marked.set(new Set([...marks].filter((m) => !gone.has(m))));
    }
    if (removes) {
      this.removePaths(gone);
    }
  }

  private removePaths(gone: ReadonlySet<string>): void {
    const before = this.items();
    const cursorIndex = this.cursor();
    const next = withoutPaths(this.all(), gone);
    if (next === this.all()) {
      return;
    }
    this.all.set(next);
    // the cursor stays at its place: the image after the removed one
    if (this.cursorPath() !== null && gone.has(this.cursorPath() ?? '')) {
      const after = before.slice(cursorIndex + 1).find((i) => !gone.has(i.path));
      const earlier = [...before.slice(0, cursorIndex)].reverse().find((i) => !gone.has(i.path));
      this.cursorPath.set(after?.path ?? earlier?.path ?? null);
    }
    const large = this.large();
    if (large !== null) {
      const n = this.items().length;
      this.large.set(n === 0 ? null : Math.min(large, n - 1));
    }
  }

  /** The watched folder changed (E16): gone images leave at once, new ones need a list. */
  private onWatch(e: WatchEvent): void {
    if (!this.isOpen() || e.dir !== this.folder() || e.type === 'gone') {
      return;
    }
    if (e.type === 'rescan') {
      void this.reload();
      return;
    }
    if (e.removed.length > 0) {
      this.removePaths(new Set(e.removed));
    }
    if (e.upserted.length > 0) {
      void this.reload();
    }
  }

  /** A text for a failed open (status line). */
  errorText(): string | null {
    const e = this.load().error;
    return e ? errorText(e) : null;
  }
}

/** A folder for the tree: a real folder (or a link to one) that is not hidden. */
function isVisibleFolder(e: DirEntry): boolean {
  const dir = e.kind === 'directory' || (e.kind === 'symlink' && e.targetKind === 'directory');
  return dir && !e.hidden;
}
