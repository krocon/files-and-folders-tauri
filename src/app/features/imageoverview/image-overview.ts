import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { MAX_IMAGES } from '../../core/imageoverview/image-overview.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { formatModified, formatSize } from '../../shared/format';
import { FolderTree } from './folder-tree';
import { ImageOverviewStore } from './image-overview.store';
import { IMAGE_OVERVIEW_TEXTS } from './image-overview-texts';
import { LargeView } from './large-view';
import { MAX_TILE, MIN_TILE, OverviewSort } from './overview-logic';
import { OverviewGrid } from './overview-grid';

const SORTS: readonly OverviewSort[] = ['name', 'date', 'size', 'type'];

/**
 * The image overview (design 074): over both panels of the window (E1). Header with the path
 * bar, "include subfolders", order, filter and the way back; left the folder tree (E13), in the
 * middle the tiles (E2), below the counts and the tile size (E12); the large view on top (E14).
 */
@Component({
  selector: 'app-image-overview',
  imports: [FolderTree, OverviewGrid, LargeView],
  templateUrl: './image-overview.html',
  styleUrl: './image-overview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', '[attr.aria-label]': 't.region' },
})
export class ImageOverview {
  protected readonly store = inject(ImageOverviewStore);
  private readonly settings = inject(SettingsStore);
  protected readonly t = IMAGE_OVERVIEW_TEXTS;
  protected readonly sorts = SORTS;
  protected readonly minTile = MIN_TILE;
  protected readonly maxTile = MAX_TILE;
  private readonly grid = viewChild(OverviewGrid);

  protected readonly treeWidth = computed(() => this.settings.get('imageOverview.treeWidth'));

  protected readonly countText = computed(() => {
    const items = this.store.items();
    const size = items.reduce((sum, i) => sum + i.size, 0);
    return this.t.count(items.length, this.store.total(), formatSize(size));
  });
  protected readonly markedText = computed(() => {
    const marks = this.store.marked();
    if (marks.size === 0) {
      return '';
    }
    const size = this.store
      .items()
      .filter((i) => marks.has(i.path))
      .reduce((sum, i) => sum + i.size, 0);
    return this.t.marked(marks.size, formatSize(size));
  });
  protected readonly cursorText = computed(() => {
    const i = this.store.cursorItem();
    return i ? [i.rel, formatSize(i.size), formatModified(i.modifiedMs)].join(' · ') : '';
  });
  /** The note in the middle when there is nothing to show. */
  protected readonly note = computed(() => {
    const load = this.store.load();
    if (load.error) {
      return this.t.failed(this.store.errorText() ?? '');
    }
    if (this.store.items().length > 0) {
      return null;
    }
    if (load.loading) {
      return this.t.loading;
    }
    if (this.store.total() > 0) {
      return this.t.emptyFilter;
    }
    return this.store.recursive() ? this.t.emptyRecursive : this.t.empty;
  });
  protected readonly flags = computed(() => {
    const load = this.store.load();
    const out: string[] = [];
    if (load.truncated) {
      out.push(this.t.truncated(MAX_IMAGES));
    }
    if (load.unreadable > 0) {
      out.push(this.t.unreadable(load.unreadable));
    }
    return out.join(' · ');
  });

  constructor() {
    // open and back from the large view: the tiles get the focus
    effect(() => {
      const open = this.store.isOpen();
      const large = this.store.large();
      untracked(() => {
        if (open && large === null) {
          queueMicrotask(() => this.grid()?.focus());
        }
      });
    });
  }

  protected back(): void {
    this.store.close();
  }

  protected setSort(e: Event): void {
    this.store.setSort((e.target as HTMLSelectElement).value as OverviewSort);
  }

  protected setFilter(e: Event): void {
    this.store.filter.set((e.target as HTMLInputElement).value);
  }

  protected filterKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.store.filter.set('');
      this.grid()?.focus();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.grid()?.focus();
    }
  }

  protected setRecursive(e: Event): void {
    void this.store.setRecursive((e.target as HTMLInputElement).checked);
  }

  protected setTile(e: Event): void {
    this.store.setTileSize(Number((e.target as HTMLInputElement).value));
  }

  protected goTo(path: string): void {
    if (path !== this.store.folder()) {
      void this.store.openFolder(path);
    }
  }

  // ---- width of the tree: drag its edge (pointer) or arrows on the handle ----
  private dragFrom: { x: number; width: number } | null = null;

  protected resizeDown(e: PointerEvent): void {
    this.dragFrom = { x: e.clientX, width: this.treeWidth() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  protected resizeMove(e: PointerEvent): void {
    if (this.dragFrom) {
      this.setTreeWidth(this.dragFrom.width + e.clientX - this.dragFrom.x);
    }
  }

  protected resizeUp(): void {
    this.dragFrom = null;
  }

  protected resizeKey(e: KeyboardEvent): void {
    const delta = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (delta !== 0) {
      e.preventDefault();
      this.setTreeWidth(this.treeWidth() + delta);
    }
  }

  private setTreeWidth(px: number): void {
    this.settings.set('imageOverview.treeWidth', Math.round(Math.min(600, Math.max(120, px))));
  }
}
