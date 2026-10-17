import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  untracked,
} from '@angular/core';
import { TableComponent } from '@guiexpert/angular-table';
import { TableApi, TableStateIf } from '@guiexpert/table';
import { DirEntry, DirectoryListing, parentRow } from '../../../core/fs/fs.models';
import { Side } from '../../../core/session/session.models';
import { modifiersAfter } from '../../../core/actions/shortcut';
import {
  DRAG_THRESHOLD,
  dragKeyAction,
  dragKind,
  dragOriginDir,
  dragSources,
  panelZoneHit,
} from '../../dnd/dnd-logic';
import { DragStore } from '../../dnd/drag.store';
import { recordPerf, since } from '../../../shared/perf';
import { FileBrowserStore } from '../file-browser.store';
import { FileListController } from './file-list-controller';
import { createFileTable } from './file-table-model';
import { inPlaceUpdate } from './row-update';
import { createTableBridge, removeConflictingShortcuts, TableBridge } from './table-bridge';

/** Empty result tab: own text instead of the table's "This folder is empty." (options are copied once). */
const NO_HITS = 'No hits (yet).';
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The file list of one panel: a GuiExpert Table showing the store's entries.
 * Behaviour lives in {@link FileListController}; this component only wires the
 * table, the store and DOM events.
 */
@Component({
  selector: 'app-file-list',
  imports: [TableComponent],
  template: `
    <guiexpert-table
      class="table"
      [tableModel]="table().model"
      [tableOptions]="table().options"
      [loading]="store.loading()"
      (tableReady)="onTableReady($event)"
    />
  `,
  styleUrl: './file-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
    '(mouseup)': 'onMouseUp($event)',
    '(pointerdown)': 'onPointerDown($event)',
    // no native HTML drag of icons/text: our own pointer drag (design 012 E5)
    '(dragstart)': '$event.preventDefault()',
    '[class.drop-target]': 'dropOnPanel()',
  },
})
export class FileList implements OnDestroy {
  protected readonly store = inject(FileBrowserStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Id of the element naming the list (the path display) – `aria-labelledby`. */
  readonly labelledBy = input.required<string>();
  /** The panel side (drag and drop); without it the list is no drag source or drop zone. */
  readonly side = input<Side | null>(null);

  private readonly dnd = inject(DragStore);
  /** The folder row of this list a drag would drop into. */
  private readonly dropRow = computed(() => {
    const t = this.dnd.drag()?.target;
    return t && t.side === this.side() ? t.rowPath : null;
  });
  /** A drag would drop into this panel's folder. */
  protected readonly dropOnPanel = computed(() => {
    const t = this.dnd.drag()?.target;
    return !!t && t.side === this.side() && t.rowPath === null;
  });
  private press: { x: number; y: number; pointerId: number; row: DirEntry } | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private unregisterZone?: () => void;

  /** Strg/⌘+Enter on a folder. */
  readonly openInNewTab = output<DirEntry>();
  /** Column layout, sort or scroll changed by the user (debounced by the table). */
  readonly tableStateChanged = output<Partial<TableStateIf>>();

  /** Model and options are created once – a new object would re-create the table. */
  protected readonly table = computed(() =>
    createFileTable(this.labelledBy(), () => this.store.rowFilter()),
  );
  private shownPath: string | null = null;
  /** The listing the table shows (for in-place row updates). */
  private shownListing: DirectoryListing | null = null;

  private bridge?: TableBridge;
  private controller?: FileListController;
  private unsubscribe?: () => void;
  private focusWanted = false;
  /** While rows/state are being applied, state events are ours, not the user's. */
  private applying = false;
  private applySeq = 0;

  constructor() {
    // A header double-click sorts synchronously and stops propagation (no "sorted" event, G14).
    // Capture phase + setTimeout: runs after the table's handler – keep the cursor on its entry.
    this.host.nativeElement.addEventListener(
      'dblclick',
      () => setTimeout(() => this.controller?.restoreCursor()),
      { capture: true },
    );
    effect(() => {
      const listing = this.store.listing();
      untracked(() => {
        if (listing && this.controller) {
          if (this.updateInPlace(listing)) {
            return;
          }
          const start = performance.now();
          this.show(listing);
          const sync = since(start);
          requestAnimationFrame(() =>
            recordPerf(
              'table setRows + sort + render',
              since(start),
              `sync ${Math.round(sync)} ms, ${listing.entries.length} rows`,
            ),
          );
        }
      });
    });
    effect(() => {
      this.store.marked();
      this.dropRow();
      untracked(() => this.bridge?.repaint());
    });
    effect(() => {
      this.store.rowFilter();
      untracked(() => {
        if (this.bridge && this.controller) {
          this.bridge.filterChanged();
          this.controller.restoreCursor();
        }
      });
    });
  }

  protected onTableReady(api: TableApi): void {
    const table = this.table();
    const bridge = createTableBridge(api, table.body);
    const controller = new FileListController(bridge, this.store, {
      openInNewTab: (entry) => this.openInNewTab.emit(entry),
    });
    this.bridge = bridge;
    this.controller = controller;

    removeConflictingShortcuts(api);
    table.body.setRowState({
      cursorRow: () => bridge.focusedRow(),
      isMarked: (path) => this.store.isMarked(path),
      isDropTarget: (path) => this.dropRow() === path,
    });
    const side = this.side();
    if (side) {
      this.unregisterZone = this.dnd.registerZone(side, {
        element: this.host.nativeElement,
        hit: (el) => {
          const index = bridge.rowIndexAt(el);
          const row = index >= 0 ? (bridge.displayedRows()[index] ?? null) : null;
          // a result tab is no folder to drop into (review 012 #4a)
          return panelZoneHit(side, this.store, row);
        },
      });
    }
    this.unsubscribe = api.subscribe({
      onFocusChanged: (model) => controller.onFocusChanged(model.getFocus()[0]),
      onStateChanged: (evt) => {
        if (!this.applying) {
          this.tableStateChanged.emit(evt.state);
        }
      },
      // core event, not the wrapper output: no 150 ms debounce (design E5)
      onMouseClicked: (evt) =>
        controller.onClick({
          area: evt.areaIdent,
          rowIndex: evt.rowIndex,
          clickCount: evt.clickCount,
          shiftKey: evt.originalEvent?.shiftKey ?? false,
          toggleKey: (IS_MAC ? evt.originalEvent?.metaKey : evt.originalEvent?.ctrlKey) ?? false,
        }),
    });

    this.store.scrollTop = () => bridge.getTableState().scroll?.top ?? 0;
    const listing = this.store.listing();
    if (listing) {
      this.show(listing);
    }
    if (this.focusWanted) {
      this.focus();
    }
  }

  /**
   * Type-ahead (design 003 E6): printable characters without Mod/Ctrl/Alt jump to
   * the first matching name. Keys bound to actions never get here (the dispatcher
   * runs in the capture phase); Space is an action.
   */
  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.ctrlKey || evt.metaKey || evt.altKey || !this.controller) {
      return;
    }
    if (evt.key === 'Escape') {
      this.controller.resetTypeAhead();
      return;
    }
    if (evt.key.length === 1 && evt.key !== ' ') {
      const found = this.controller.typeAhead(evt.key);
      evt.preventDefault();
      evt.stopPropagation();
      if (found && this.bridge) {
        this.bridge.announce(found);
      }
    }
  }

  /** Mouse buttons 4/5 (back/forward). */
  protected onMouseUp(evt: MouseEvent): void {
    if (evt.button === 3) {
      evt.preventDefault();
      void this.store.back();
    } else if (evt.button === 4) {
      evt.preventDefault();
      void this.store.forward();
    }
  }

  // ---- drag and drop (design 012 E5) ----

  protected onPointerDown(evt: PointerEvent): void {
    const target = evt.target as Element | null;
    if (
      evt.button !== 0 ||
      !this.bridge ||
      !this.side() ||
      !target ||
      target.closest('input, textarea') ||
      this.store.navigationLocked()
    ) {
      return;
    }
    const index = this.bridge.rowIndexAt(target);
    const row = index >= 0 ? this.bridge.displayedRows()[index] : undefined;
    if (!row) {
      return;
    }
    this.press = { x: evt.clientX, y: evt.clientY, pointerId: evt.pointerId, row };
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerCancel, true);
    window.addEventListener('keydown', this.onDragKey, true);
    window.addEventListener('keyup', this.onDragKey, true);
  }

  private readonly onPointerMove = (evt: PointerEvent): void => {
    const press = this.press;
    if (!press) {
      return;
    }
    this.lastPointer = { x: evt.clientX, y: evt.clientY };
    if (!this.dragging) {
      if (Math.hypot(evt.clientX - press.x, evt.clientY - press.y) < DRAG_THRESHOLD) {
        return;
      }
      const sources = dragSources(
        press.row,
        (p) => this.store.isMarked(p),
        this.store.markedEntries(),
      );
      const side = this.side();
      if (!sources || !side) {
        this.endPress();
        return;
      }
      this.dragging = true;
      try {
        this.host.nativeElement.setPointerCapture(press.pointerId);
      } catch {
        // the pointer may be gone already – the window listeners still see it
      }
      this.dnd.begin({
        side,
        // a result tab: its location key, as for F5/F6 (review 012 #4b)
        sourceDir: dragOriginDir(this.store),
        sources,
        kind: dragKind(evt, IS_MAC),
        x: evt.clientX,
        y: evt.clientY,
      });
    } else {
      this.dnd.move(evt.clientX, evt.clientY, dragKind(evt, IS_MAC));
    }
    evt.preventDefault();
  };

  private readonly onPointerUp = (evt: PointerEvent): void => {
    if (this.dragging) {
      swallowNextClick();
      void this.dnd.drop(evt.clientX, evt.clientY, dragKind(evt, IS_MAC));
    }
    this.endPress();
  };

  private readonly onPointerCancel = (): void => {
    if (this.dragging) {
      this.dnd.cancel();
    }
    this.endPress();
  };

  /**
   * Esc cancels; Shift/⌘ switch between copy and move without moving the mouse;
   * every other key is swallowed – F8 or Del must not act on the dragged rows (review 012 #9).
   */
  private readonly onDragKey = (evt: KeyboardEvent): void => {
    if (!this.dragging) {
      return;
    }
    const action = dragKeyAction(evt);
    if (action !== 'modifier') {
      evt.preventDefault();
      evt.stopPropagation();
    }
    if (action === 'cancel') {
      this.dnd.cancel();
      swallowNextClick();
      this.endPress();
      return;
    }
    if (action === 'swallow') {
      return;
    }
    this.dnd.move(
      this.lastPointer.x,
      this.lastPointer.y,
      dragKind(modifiersAfter(evt, evt.type), IS_MAC),
    );
  };

  private endPress(): void {
    const press = this.press;
    if (press && this.dragging) {
      try {
        this.host.nativeElement.releasePointerCapture(press.pointerId);
      } catch {
        // not captured
      }
    }
    this.press = null;
    this.dragging = false;
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerCancel, true);
    window.removeEventListener('keydown', this.onDragKey, true);
    window.removeEventListener('keyup', this.onDragKey, true);
  }

  /** Behaviour of this list for the panel's actions (undefined until the table is ready). */
  get listController(): FileListController | undefined {
    return this.controller;
  }

  /** The table state of the current tab (columns, sort, scroll). */
  captureTableState(): Partial<TableStateIf> | null {
    return this.bridge?.getTableState() ?? null;
  }

  /** Moves the keyboard focus into the table (now, or as soon as it exists). */
  focus(): void {
    const target = this.host.nativeElement.querySelector<HTMLElement>('[tabindex="0"]');
    this.focusWanted = !target;
    target?.focus();
  }

  /**
   * Only sizes/times of shown entries changed (a file being written): replace
   * those rows, without setRows, re-sort (unless sorted by them) or reopening
   * the F2 editor (review 012 #5). False = show the listing as usual.
   */
  private updateInPlace(listing: DirectoryListing): boolean {
    if (!this.bridge || this.store.hasPendingTableState()) {
      return false;
    }
    const update = inPlaceUpdate(this.shownListing, listing);
    if (!update || !this.bridge.updateRows(update.rows, update.columns)) {
      return false;
    }
    this.shownListing = listing;
    return true;
  }

  /** Rows of a listing: the ".." row first (if there is a parent), then the entries. */
  private show(listing: DirectoryListing): void {
    this.shownListing = listing;
    const rows: DirEntry[] =
      listing.parent !== null
        ? [parentRow(listing.parent), ...listing.entries]
        : [...listing.entries];
    // announce only a new folder, not a refresh or a calculated folder size
    // a result tab announces through its header (live region), not with its key
    const label =
      listing.path !== this.shownPath && this.store.searchKey() === null
        ? (listing.segments.at(-1)?.name ?? listing.path)
        : undefined;
    this.shownPath = listing.path;
    const state = this.store.takePendingTableState() ?? undefined;

    const seq = ++this.applySeq;
    this.applying = true;
    try {
      this.controller?.showRows(rows, label, state);
      // the folder column belongs to result tabs (after the state: it may carry column widths)
      this.bridge?.setColumnVisible('dir', this.store.searchKey() !== null);
      this.bridge?.setColumnVisible(
        'group',
        this.store.searchKey() !== null && this.store.searchKind() === 'duplicates',
      );
      this.bridge?.setEmptyText(
        this.store.searchKey() !== null && rows.length === 0 ? NO_HITS : null,
      );
    } finally {
      // the table reports state changes debounced (300 ms) – ignore the ones caused by applying
      setTimeout(() => {
        if (seq === this.applySeq) {
          this.applying = false;
        }
      }, 400);
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.unregisterZone?.();
    if (this.dragging) {
      this.dnd.cancel();
    }
    this.endPress();
  }
}

/** The click that follows releasing a drag must not move the cursor or open a row. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}
