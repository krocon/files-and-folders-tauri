import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DirEntry } from '../../core/fs/fs.models';
import { ImageOverviewStore } from './image-overview.store';
import { IMAGE_OVERVIEW_TEXTS } from './image-overview-texts';

/** A row of the tree as shown. */
interface TreeRow {
  readonly path: string;
  readonly name: string;
  /** 1 = the shown folder. */
  readonly level: number;
  /** null = not looked at yet; [] = no subfolders. */
  readonly children: readonly DirEntry[] | null;
  readonly expanded: boolean;
}

/**
 * The folder tree of the image overview (design 074 E13): the shown folder and its subfolders,
 * opened lazily. APG tree view: one tab stop, ↑/↓ move, → opens / goes to the first child,
 * ← closes / goes to the parent, Enter or a click shows that folder in the overview.
 */
@Component({
  selector: 'app-folder-tree',
  templateUrl: './folder-tree.html',
  styleUrl: './folder-tree.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderTree {
  protected readonly store = inject(ImageOverviewStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly t = IMAGE_OVERVIEW_TEXTS;

  /** Subfolders of folders below the root, as far as opened. */
  private readonly children = signal<ReadonlyMap<string, readonly DirEntry[]>>(new Map());
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  /** The row with the tab stop. */
  protected readonly active = signal<string | null>(null);

  protected readonly rows = computed<TreeRow[]>(() => {
    const root = this.store.folder();
    if (root === null) {
      return [];
    }
    const seg = this.store.segments();
    const rootName = seg.at(-1)?.name ?? root;
    const out: TreeRow[] = [];
    const kids = this.children();
    const open = this.expanded();
    const add = (path: string, name: string, level: number, list: readonly DirEntry[] | null) => {
      const expanded = level === 1 || open.has(path);
      out.push({ path, name, level, children: list, expanded });
      if (expanded && list) {
        for (const c of list) {
          add(c.path, c.name, level + 1, kids.get(c.path) ?? null);
        }
      }
    };
    add(root, rootName, 1, this.store.subfolders());
    return out;
  });

  constructor() {
    // another folder shown: start again
    effect(() => {
      const root = this.store.folder();
      untracked(() => {
        this.children.set(new Map());
        this.expanded.set(new Set());
        this.active.set(root);
      });
    });
  }

  private async expand(row: TreeRow): Promise<void> {
    if (row.level === 1) {
      return;
    }
    if (!this.children().has(row.path)) {
      const list = await this.store.subfoldersOf(row.path);
      this.children.update((m) => new Map(m).set(row.path, list));
    }
    this.expanded.update((s) => new Set(s).add(row.path));
  }

  private collapse(row: TreeRow): void {
    this.expanded.update((s) => {
      const n = new Set(s);
      n.delete(row.path);
      return n;
    });
  }

  protected toggle(row: TreeRow, e: Event): void {
    e.stopPropagation();
    if (row.expanded) {
      this.collapse(row);
    } else {
      void this.expand(row);
    }
  }

  protected choose(row: TreeRow): void {
    this.active.set(row.path);
    if (row.level > 1) {
      void this.store.openFolder(row.path);
    }
  }

  protected hasChildren(row: TreeRow): boolean {
    return row.children === null || row.children.length > 0;
  }

  protected onKey(e: KeyboardEvent): void {
    const rows = this.rows();
    const i = Math.max(
      0,
      rows.findIndex((r) => r.path === this.active()),
    );
    const row = rows[i];
    if (!row) {
      return;
    }
    const parentIndex = () => {
      for (let k = i - 1; k >= 0; k--) {
        if (rows[k].level < row.level) {
          return k;
        }
      }
      return -1;
    };
    switch (e.key) {
      case 'ArrowDown':
        this.focusRow(rows[Math.min(rows.length - 1, i + 1)].path);
        break;
      case 'ArrowUp':
        this.focusRow(rows[Math.max(0, i - 1)].path);
        break;
      case 'Home':
        this.focusRow(rows[0].path);
        break;
      case 'End':
        this.focusRow(rows[rows.length - 1].path);
        break;
      case 'ArrowRight':
        if (!row.expanded && this.hasChildren(row)) {
          void this.expand(row);
        } else if (rows[i + 1]?.level === row.level + 1) {
          this.focusRow(rows[i + 1].path);
        }
        break;
      case 'ArrowLeft':
        if (row.expanded && row.level > 1) {
          this.collapse(row);
        } else if (parentIndex() >= 0) {
          this.focusRow(rows[parentIndex()].path);
        }
        break;
      case 'Enter':
        this.choose(row);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private focusRow(path: string): void {
    this.active.set(path);
    queueMicrotask(() => {
      const el = [
        ...this.host.nativeElement.querySelectorAll<HTMLElement>('[role="treeitem"]'),
      ].find((n) => n.dataset['path'] === path);
      el?.focus();
    });
  }
}
