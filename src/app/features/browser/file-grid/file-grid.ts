import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TableSignalComponent } from '@guiexpert/angular-table';
import {
  CoverGridFactory,
  CoverGridTableModel,
  GeMouseEvent,
  GeScrollEvent,
  TableApi,
  TableOptions,
  TableOptionsIf,
} from '@guiexpert/table';
import { FILE_TYPES } from '../../../core/file-icon/file-icon.service';
import { DirEntry } from '../../../core/fs/fs.models';
import { DISPLAY } from '../../../core/settings/display';
import { SettingsStore } from '../../../core/settings/settings.store';
import { CursorMove, moveCursor, pageRows, scrollToShow } from '../../imageoverview/grid-math';
import { scrollbarWidth } from '../../imageoverview/overview-grid';
import { thumbStep } from '../../imageoverview/overview-logic';
import { TileRetries } from '../../imageoverview/tile-retries';
import { TEXTS } from '../../workspace/texts';
import { FileBrowserStore } from '../file-browser.store';
import { FileTileRenderer, TILE_INDEX_ATTR } from './file-tile-renderer';
import { cellIndex, GridMode, rowCount, tileLayout } from './grid-logic';
import { PanelThumbs } from './panel-thumbs';

/** A click on a tile, as the list controller wants it. */
export interface GridClick {
  readonly index: number;
  readonly clickCount: number;
  readonly shiftKey: boolean;
  readonly toggleKey: boolean;
  readonly altKey: boolean;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const MOVES: Readonly<Record<string, CursorMove>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
};

/**
 * The brief and the thumbnail view of a panel (design 041 E5–E7): a GuiExpert cover grid
 * showing the rows the (covered) detail table displays – same order, same filter. It
 * only paints and reports: cursor and marks live in the store, every change goes through
 * the list controller of the panel (`cursorMoved`, `tileClicked`).
 *
 * Keys of a grid widget (APG, CLAUDE.md §4 exception) are handled here: arrows,
 * Home/End, PageUp/PageDown – what the table does itself in the full view. Everything
 * else (Space, Insert, Enter, F-keys …) stays an action.
 */
@Component({
  selector: 'app-file-grid',
  imports: [TableSignalComponent],
  template: `
    <guiexpert-table-signal
      class="table"
      [tableModel]="grid().model"
      [tableOptions]="grid().options"
      [(tableApi)]="tableApi"
      (scroll)="onScroll($event)"
    />
  `,
  styleUrl: './file-grid.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKey($event)' },
})
export class FileGrid {
  private readonly store = inject(FileBrowserStore);
  private readonly settings = inject(SettingsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The rows in display order (sorted and filtered by the detail table). */
  readonly rows = input.required<readonly DirEntry[]>();
  readonly mode = input.required<GridMode>();
  /** Row height of the list (density): the height of a brief tile. */
  readonly rowHeight = input.required<number>();
  readonly labelledBy = input.required<string>();
  /** The folder a drag would drop into. */
  readonly dropPath = input<string | null>(null);
  readonly thumbs = input<PanelThumbs | null>(null);

  /** The grid's table exists: it can take the focus. */
  readonly ready = output<void>();
  /** An arrow key, Home/End or PageUp/PageDown: the cursor wants to be on this index. */
  readonly cursorMoved = output<number>();
  readonly tileClicked = output<GridClick>();
  /** Right click; `index` -1 = free space. */
  readonly menuWanted = output<{ index: number; x: number; y: number }>();

  protected readonly tableApi = signal<TableApi | undefined>(undefined);
  private readonly hostWidth = signal(0);
  private readonly viewHeight = signal(0);
  private scrollTop = 0;
  private readonly scrollbar = scrollbarWidth(this.host.nativeElement.ownerDocument);
  private readonly dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

  readonly layout = computed(() =>
    tileLayout(
      this.mode(),
      Math.max(0, this.hostWidth() - this.scrollbar),
      this.rowHeight(),
      this.settings.get('view.thumbnailSize'),
    ),
  );

  private readonly indexByPath = computed(() => {
    const map = new Map<string, number>();
    this.rows().forEach((r, i) => map.set(r.path, i));
    return map;
  });
  /** Index of the cursor entry in the shown rows, -1 if it is not among them. */
  readonly cursorIndex = computed(() => {
    const path = this.store.cursorPath();
    return path === null ? -1 : (this.indexByPath().get(path) ?? -1);
  });

  private readonly retries = new TileRetries(2000, () => this.repaintSoon());

  private thumbUrl(entry: DirEntry): string | null {
    const thumbs = untracked(this.thumbs);
    if (!thumbs || untracked(this.mode) !== 'thumbnails') {
      return null;
    }
    return thumbs.url(entry.path, thumbStep(untracked(this.layout).cellWidth, this.dpr));
  }

  private readonly renderer = new FileTileRenderer({
    mode: () => untracked(this.mode),
    cols: () => untracked(this.layout).cols,
    pictureHeight: () => untracked(this.layout).pictureHeight,
    isCursor: (e) => e.path === untracked(this.store.cursorPath),
    isMarked: (e) => this.store.isMarked(e.path),
    isDropTarget: (e) => e.path === untracked(this.dropPath),
    thumb: (e) => {
      const url = this.thumbUrl(e);
      return url === null ? null : this.retries.src(url);
    },
    thumbFailed: (e) => {
      const url = this.thumbUrl(e);
      if (url !== null) {
        this.retries.failed(url);
      }
    },
    markedText: () => TEXTS.marked,
  });

  /** Model and options are made once – a new object would re-create the table. */
  protected readonly grid = computed(() => {
    const labelledBy = this.labelledBy();
    return untracked(() => this.createGrid(labelledBy));
  });

  private repaintPending = false;

  constructor() {
    const el = this.host.nativeElement;
    const destroyRef = inject(DestroyRef);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) {
          this.hostWidth.set(Math.floor(r.width));
          this.viewHeight.set(Math.floor(r.height));
        }
      });
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    }
    destroyRef.onDestroy(() => this.retries.dispose());
    // rows, tile size, width → the model (no new table); the cursor stays in view
    effect(() => {
      const rows = this.rows();
      const layout = this.layout();
      const api = this.tableApi();
      const model = this.grid().model;
      untracked(() => {
        this.applyModel(model, rows, layout, api);
        this.reveal();
      });
    });
    // what a tile shows besides its entry: repaint once per frame
    effect(() => {
      this.store.cursorPath();
      this.store.marked();
      this.dropPath();
      this.thumbs()?.version();
      DISPLAY.folderBrackets();
      DISPLAY.hideExtension();
      FILE_TYPES();
      untracked(() => this.repaintSoon());
    });
    effect(() => {
      this.cursorIndex();
      untracked(() => this.reveal());
    });
    // clicks without the wrapper's debounce, as the list does (design 001 E5)
    effect((onCleanup) => {
      const api = this.tableApi();
      if (!api) {
        return;
      }
      const unsubscribe = api.subscribe({
        onMouseClicked: (evt) => this.onClick(evt),
        onContextmenu: (evt) => this.onContextMenu(evt),
      });
      onCleanup(unsubscribe);
      untracked(() => this.ready.emit());
    });
  }

  private createGrid(labelledBy: string): {
    model: CoverGridTableModel<DirEntry>;
    options: TableOptionsIf;
  } {
    const model = CoverGridFactory.createCoverGridModel<DirEntry>([], this.renderer, 220, 30, 0, 0);
    const body = model.bodyModel;
    // exactly the rows needed (the model adds an empty one when the last row is full)
    body.getRowCount = () => rowCount(body.filteredItems?.length ?? 0, body.getColumnCount());
    body.getUnfilteredRowCount = () => rowCount(body.items?.length ?? 0, body.getColumnCount());
    const options: TableOptionsIf = {
      ...new TableOptions(),
      horizontalBorderVisible: false,
      verticalBorderVisible: false,
      footerSeparatorBorderVisible: false,
      headerSeparatorBorderVisible: false,
      fixedEastSeparatorBorderVisible: false,
      fixedWestSeparatorBorderVisible: false,
      tableTopBorderVisible: false,
      tableBottomBorderVisible: false,
      hoverColumnVisible: false,
      hoverRowVisible: false,
      overflowY: 'scroll', // the width is computed without the scroll bar
      overflowX: 'auto',
      defaultRowHeights: { header: 0, body: 30, footer: 0 },
      shortcutActionsDisabled: true,
      overlayOptions: { autoNoRows: false },
      ariaLabelledBy: labelledBy,
    };
    return { model, options };
  }

  private applyModel(
    model: CoverGridTableModel<DirEntry>,
    rows: readonly DirEntry[],
    layout: { cols: number; cellWidth: number; rowHeight: number },
    api: TableApi | undefined,
  ): void {
    const body = model.bodyModel;
    const list = rows as DirEntry[]; // the model only reads it
    body.items = list;
    body.filteredItems = list;
    body.coverWidth = layout.cellWidth;
    body.coverHeight = layout.rowHeight;
    // exactly `cols` columns (the model computes floor(width / coverWidth))
    model.setParentWidth(layout.cols * layout.cellWidth);
    model.recalcHeightAndPadding();
    if (api && this.hostWidth() > 0) {
      api.repaintHard();
    }
  }

  private repaintSoon(): void {
    if (this.repaintPending) {
      return;
    }
    this.repaintPending = true;
    requestAnimationFrame(() => {
      this.repaintPending = false;
      this.tableApi()?.repaint();
    });
  }

  /** Scrolls the cursor tile into view. */
  private reveal(): void {
    const api = this.tableApi();
    if (!api || this.viewHeight() === 0) {
      return;
    }
    const l = this.layout();
    const top = scrollToShow(
      this.cursorIndex(),
      l.cols,
      l.rowHeight,
      0,
      this.viewHeight(),
      this.scrollTop,
    );
    if (top !== null) {
      this.scrollTop = top;
      api.scrollToPixel(0, top);
    }
  }

  protected onScroll(e: GeScrollEvent): void {
    this.scrollTop = e.scrollTop;
    if (e.clientHeight) {
      this.viewHeight.set(e.clientHeight);
    }
  }

  private indexOf(e: GeMouseEvent): number {
    return e.areaIdent === 'body'
      ? cellIndex(e.rowIndex, e.columnIndex, this.layout().cols, this.rows().length)
      : -1;
  }

  private onClick(e: GeMouseEvent): void {
    const index = this.indexOf(e);
    if (index < 0) {
      return;
    }
    const ev = e.originalEvent;
    this.tileClicked.emit({
      index,
      clickCount: e.clickCount,
      shiftKey: ev?.shiftKey ?? false,
      toggleKey: (IS_MAC ? ev?.metaKey : ev?.ctrlKey) ?? false,
      altKey: ev?.altKey ?? false,
    });
  }

  private onContextMenu(e: GeMouseEvent): void {
    const ev = e.originalEvent;
    if (!ev) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    this.menuWanted.emit({ index: this.indexOf(e), x: ev.clientX, y: ev.clientY });
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
      return; // with a modifier the key belongs to the actions (Shift+↓ marks …)
    }
    const move = MOVES[e.key];
    if (!move) {
      return;
    }
    const l = this.layout();
    const next = moveCursor(
      this.cursorIndex(),
      move,
      l.cols,
      this.rows().length,
      pageRows(this.viewHeight(), l.rowHeight, 0),
    );
    e.preventDefault();
    e.stopPropagation();
    if (next >= 0 && next !== this.cursorIndex()) {
      this.cursorMoved.emit(next);
    }
  }

  /** Index of the entry whose tile contains `element`, -1 if none (drag and drop). */
  indexAt(element: Element): number {
    const tile = element.closest(`[${TILE_INDEX_ATTR}]`);
    if (!tile || !this.host.nativeElement.contains(tile)) {
      return -1;
    }
    const index = Number(tile.getAttribute(TILE_INDEX_ATTR));
    return Number.isInteger(index) && index >= 0 && index < this.rows().length ? index : -1;
  }

  /** Focus into the grid (the table's host is the tab stop); false until the table exists. */
  focus(): boolean {
    const target = this.tableApi()?.getTableScope().hostElement;
    target?.focus({ preventScroll: true });
    return !!target;
  }
}
