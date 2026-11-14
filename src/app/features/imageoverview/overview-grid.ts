import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
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
import { ImageOverviewApi } from '../../core/imageoverview/image-overview-api';
import { OverviewItem } from '../../core/imageoverview/image-overview.models';
import { formatSize } from '../../shared/format';
import {
  CursorMove,
  gridLayout,
  pageRows,
  scrollForTop,
  scrollToShow,
  topIndex,
} from './grid-math';
import { ImageOverviewStore } from './image-overview.store';
import { IMAGE_OVERVIEW_TEXTS } from './image-overview-texts';
import { NAME_LINE, thumbStep, tileHeight } from './overview-logic';
import { TileRenderer } from './tile-renderer';
import { TileRetries } from './tile-retries';

/** Pause after which a typed prefix starts again (like the list's type-ahead). */
const TYPE_AHEAD_MS = 1000;

/** Width of a vertical scroll bar (0 with overlay scroll bars, e.g. macOS). */
function scrollbarWidth(doc: Document): number {
  const probe = doc.createElement('div');
  probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll';
  doc.body.appendChild(probe);
  const w = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return Number.isFinite(w) ? w : 0;
}

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
 * The tiles of the image overview (design 074 E2): GuiExpert `CoverGridTableModel` with a
 * plain DOM renderer, stretched to the width, built like Comic Commander's `CoverGrid`. The
 * model is made once; new images, another size or width go into it without a new table.
 *
 * Keys are those of a grid widget (APG, CLAUDE.md §4 exception): arrows, Home/End, PgUp/PgDn
 * (with Shift: mark the range), Space/Insert mark, Enter = large view, Mod+= / Mod+- size,
 * letters = type-ahead, Esc = clear the filter / close. F-keys and other shortcuts go to the
 * actions (F5/F6/F8 work on the marks, design 074 E15). Screen readers hear the cursor
 * through a live region – the cover grid resets `aria-activedescendant` (CC 004 E8).
 */
@Component({
  selector: 'app-overview-grid',
  imports: [TableSignalComponent],
  templateUrl: './overview-grid.html',
  styleUrl: './overview-grid.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKey($event)',
    '(wheel)': 'onWheel($event)',
  },
})
export class OverviewGrid {
  protected readonly store = inject(ImageOverviewStore);
  private readonly api = inject(ImageOverviewApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly t = IMAGE_OVERVIEW_TEXTS;

  /** Esc without a filter: close the overview. */
  readonly escape = output<void>();

  protected readonly tableApi = signal<TableApi | undefined>(undefined);
  private readonly hostWidth = signal(0);
  private readonly viewHeight = signal(0);
  private scrollTop = 0;
  private readonly scrollbar = scrollbarWidth(this.host.nativeElement.ownerDocument);
  private readonly dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

  /** Columns and cell size: as many tiles of the chosen width as fit, stretched (CC E6). */
  readonly layout = computed(() => {
    const width = Math.max(0, this.hostWidth() - this.scrollbar);
    const size = this.store.tileSize();
    const g = gridLayout(width, { width: size, height: tileHeight(size) });
    return { cols: g.cols, cellWidth: g.coverWidth, rowHeight: tileHeight(g.coverWidth) };
  });
  private readonly step = computed(() => thumbStep(this.layout().cellWidth, this.dpr));

  /** Thumbnails dropped by the busy pool (503) or not readable yet are asked for again. */
  private readonly retries = new TileRetries(2000, () => this.repaintSoon());

  private thumbUrl(i: OverviewItem): string {
    return this.api.thumbUrl(
      untracked(this.store.overviewId) ?? '',
      i.index,
      untracked(this.step),
      i.modifiedMs,
    );
  }

  private readonly renderer = new TileRenderer({
    src: (i) => this.retries.src(this.thumbUrl(i)),
    failed: (i) => this.retries.failed(this.thumbUrl(i)),
    isCursor: (i) => i.path === untracked(this.store.cursorPath),
    isMarked: (i) => untracked(this.store.marked).has(i.path),
    pictureHeight: () => untracked(this.layout).rowHeight - NAME_LINE,
    title: (i) => `${i.rel}\n${formatSize(i.size)}`,
    noPreview: () => this.t.noPreview,
  });

  protected readonly model: CoverGridTableModel<OverviewItem> =
    CoverGridFactory.createCoverGridModel([], this.renderer, 200, tileHeight(200), 0, 0);
  protected readonly options: TableOptionsIf = {
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
    defaultRowHeights: { header: 0, body: tileHeight(200), footer: 0 },
    shortcutActionsDisabled: true,
    overlayOptions: { autoNoRows: false }, // the overview shows its own notes
    ariaLabel: IMAGE_OVERVIEW_TEXTS.region,
  };

  protected readonly announcement = computed(() => {
    const i = this.store.cursorItem();
    if (!i) {
      return '';
    }
    return this.t.focused(
      i.name,
      this.store.cursor() + 1,
      this.store.items().length,
      this.store.marked().has(i.path),
    );
  });

  private repaintPending = false;
  private lastLayoutKey = '';
  private typed = '';
  private typedAt = 0;

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
    destroyRef.onDestroy(() => this.retries.dispose());
    // images, size, width → the model (no new table)
    effect(() => {
      const list = this.store.items();
      const layout = this.layout();
      const api = this.tableApi();
      this.store.overviewId();
      this.step();
      untracked(() => this.applyModel(list as OverviewItem[], layout, api));
    });
    // cursor and marks: repaint once per frame
    effect(() => {
      this.store.cursorPath();
      this.store.marked();
      untracked(() => this.repaintSoon());
    });
    // a move of the user keeps the cursor visible
    effect(() => {
      this.store.revealTick();
      untracked(() => this.reveal(this.store.cursor()));
    });
  }

  private applyModel(
    list: OverviewItem[],
    layout: { cols: number; cellWidth: number; rowHeight: number },
    api: TableApi | undefined,
  ): void {
    const body = this.model.bodyModel;
    body.items = list;
    body.filteredItems = list;
    body.coverWidth = layout.cellWidth;
    body.coverHeight = layout.rowHeight;
    // exactly `cols` columns (the model computes floor(width / coverWidth))
    this.model.setParentWidth(layout.cols * layout.cellWidth);
    this.model.recalcHeightAndPadding();
    if (!api || this.hostWidth() === 0) {
      return;
    }
    // TODO(guiexpert): CoverGridBodyModel.getRowCount() adds an empty row when the last row is full
    api.repaintHard();
    const key = `${layout.cols}x${layout.rowHeight}`;
    if (key !== this.lastLayoutKey && this.lastLayoutKey !== '') {
      // other size or width: the cursor image stays in view (CC E10)
      const i = this.store.cursor();
      if (i >= 0) {
        this.scrollTo(scrollForTop(i, layout.cols, layout.rowHeight));
      }
    }
    this.lastLayoutKey = key;
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

  private reveal(index: number): void {
    if (!this.tableApi() || this.viewHeight() === 0) {
      return;
    }
    const l = this.layout();
    const top = scrollToShow(index, l.cols, l.rowHeight, 0, this.viewHeight(), this.scrollTop);
    if (top !== null) {
      this.scrollTo(top);
    }
  }

  private scrollTo(top: number): void {
    const api = this.tableApi();
    if (!api) {
      return;
    }
    this.scrollTop = top;
    api.scrollToPixel(0, top);
  }

  protected onScroll(e: GeScrollEvent): void {
    this.scrollTop = e.scrollTop;
    if (e.clientHeight) {
      this.viewHeight.set(e.clientHeight);
    }
  }

  /** The first image in view (to keep the place, e.g. after the tree changed width). */
  topItem(): OverviewItem | undefined {
    const l = this.layout();
    return this.store.items()[topIndex(this.scrollTop, l.cols, l.rowHeight)];
  }

  /** Focus into the grid (the table's host is the tab stop). */
  focus(): void {
    const target = this.tableApi()?.getTableScope().hostElement ?? this.host.nativeElement;
    target.focus({ preventScroll: true });
  }

  private indexAt(e: GeMouseEvent): number {
    if (e.areaIdent !== 'body' || e.rowIndex < 0 || e.columnIndex < 0) {
      return -1;
    }
    const i = e.rowIndex * this.layout().cols + e.columnIndex;
    return i < this.store.items().length ? i : -1;
  }

  protected onClick(e: GeMouseEvent): void {
    const i = this.indexAt(e);
    if (i < 0) {
      return;
    }
    const ev = e.originalEvent;
    const mod = !!ev && (ev.metaKey || ev.ctrlKey);
    if (mod) {
      this.store.focusIndex(i);
      this.store.toggleMark();
    } else {
      this.store.focusIndex(i, !!ev?.shiftKey);
    }
    if (e.clickCount >= 2 && !mod) {
      this.store.openLarge(i);
    }
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey) {
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const l = this.layout();
    const move = MOVES[e.key];
    if (move && !mod) {
      this.store.move(move, l.cols, pageRows(this.viewHeight(), l.rowHeight, 0), e.shiftKey);
    } else if (mod && (e.key === '+' || e.key === '=')) {
      this.store.zoom(1);
    } else if (mod && e.key === '-') {
      this.store.zoom(-1);
    } else if (mod) {
      return; // other shortcuts belong to the actions
    } else if (e.key === 'Enter') {
      this.store.openLarge();
    } else if (e.key === ' ') {
      this.store.toggleMark();
    } else if (e.key === 'Insert') {
      this.store.toggleMark();
      this.store.move('right', l.cols, 1);
    } else if (e.key === 'Escape') {
      if (this.store.filter() !== '') {
        this.store.filter.set('');
      } else {
        this.escape.emit();
      }
    } else if (e.key.length === 1 && e.key.trim() !== '') {
      this.typeAhead(e.key);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private typeAhead(char: string): void {
    const now = Date.now();
    const again = now - this.typedAt < TYPE_AHEAD_MS;
    this.typed = again ? this.typed + char : char;
    this.typedAt = now;
    // the same letter again: the next image with it
    const repeat = again && this.typed.length > 1 && [...this.typed].every((c) => c === char);
    if (repeat) {
      this.typed = char;
    }
    this.store.jumpTo(this.typed, !again || repeat);
  }

  protected onWheel(e: WheelEvent): void {
    if (!(e.metaKey || e.ctrlKey) || e.deltaY === 0) {
      return;
    }
    e.preventDefault();
    this.store.zoom(e.deltaY < 0 ? 1 : -1);
  }
}
