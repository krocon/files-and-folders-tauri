import { USAGE_TEXTS } from '../../diskusage/disk-usage-texts';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TableSignalComponent } from '@guiexpert/angular-table';
import { TableApi, TableColumnStateIf, TableStateIf } from '@guiexpert/table';
import { DirEntry, DirectoryListing, parentRow } from '../../../core/fs/fs.models';
import { ActionService } from '../../../core/actions/action.service';
import { Side, ViewMode } from '../../../core/session/session.models';
import { ImageOverviewApi } from '../../../core/imageoverview/image-overview-api';
import { formatModified } from '../../../shared/format';
import { modifiersAfter } from '../../../core/actions/shortcut';
import {
  DRAG_THRESHOLD,
  dragKeyAction,
  dragKind,
  dragOriginDir,
  dragSources,
  leavingAtEdge,
  leftWindow,
  panelZoneHit,
} from '../../dnd/dnd-logic';
import { DragStore } from '../../dnd/drag.store';
import { recordPerf, since } from '../../../shared/perf';
import { EntryActivator } from '../entry-activator';
import { FileBrowserStore } from '../file-browser.store';
import { DuplicatesStore } from '../../duplicates/duplicates.store';
import { DUP_TEXTS } from '../../duplicates/duplicates-texts';
import { DecisionView } from '../../duplicates/duplicate-renderers';
import { markedGroups, shownDecision } from '../../duplicates/duplicates-rules';
import { SearchHit } from '../../../core/search/search.models';
import { FileListController } from './file-list-controller';
import { createFileTable, HEADER_HEIGHT } from './file-table-model';
import { TEXTS } from '../../workspace/texts';
import { SettingsStore } from '../../../core/settings/settings.store';
import { ROW_HEIGHTS } from '../../../core/settings/settings.models';
import { DISPLAY } from '../../../core/settings/display';
import { FILE_TYPES } from '../../../core/file-icon/file-icon.service';
import { locale } from '../../../core/i18n/i18n';
import { inPlaceUpdate } from './row-update';
import {
  ColumnContext,
  columnLayout,
  dateColumnWidth,
  roughTextWidth,
  sanitizeColumns,
  stripAutoWidths,
  WIDE_DATE_MS,
  widthsOf,
} from './column-layout';
import { FileGrid, GridClick } from '../file-grid/file-grid';
import { GridMode, listingStamp } from '../file-grid/grid-logic';
import { PanelThumbs } from '../file-grid/panel-thumbs';
import {
  createTableBridge,
  Presentation,
  removeConflictingShortcuts,
  TableBridge,
} from './table-bridge';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The file list of one panel: a GuiExpert Table showing the store's entries.
 * Behaviour lives in {@link FileListController}; this component only wires the
 * table, the store and DOM events.
 */
@Component({
  selector: 'app-file-list',
  imports: [TableSignalComponent, FileGrid],
  template: `
    <!-- brief / thumbnails (design 041 E7): the table stays behind the grid and keeps
         order, filter and cursor – the grid shows its rows -->
    <guiexpert-table-signal
      class="table"
      [class.covered]="gridMode() !== null"
      [attr.inert]="gridMode() !== null ? '' : null"
      [tableModel]="table().model"
      [tableOptions]="table().options"
      [loading]="store.loading()"
      [(tableApi)]="api"
    />
    @if (gridMode(); as mode) {
      <app-file-grid
        class="grid"
        [mode]="mode"
        [rows]="displayed()"
        [rowHeight]="rowHeight()"
        [labelledBy]="labelledBy()"
        [dropPath]="dropRow()"
        [thumbs]="thumbs"
        (ready)="onGridReady()"
        (cursorMoved)="onGridMove($event)"
        (tileClicked)="onGridClick($event)"
        (menuWanted)="onGridMenu($event)"
      />
    }
  `,
  styleUrl: './file-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
    '(mouseup)': 'onMouseUp($event)',
    '(pointerdown)': 'onPointerDown($event)',
    // no native HTML drag of icons/text: our own pointer drag (design 012 E5)
    '(dragstart)': '$event.preventDefault()',
    '[class.drop-target]': 'dropOnPanel()',
    // line box = row height: text vertically centred (ge-table-theme.css)
    '[style.--fnf-row-height.px]': 'rowHeight()',
    '[style.--fnf-header-height.px]': 'headerHeight',
  },
})
export class FileList implements OnDestroy {
  protected readonly store = inject(FileBrowserStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);
  /** Body row height from the density setting (also the line height of the cells). */
  protected readonly rowHeight = computed(() => ROW_HEIGHTS[this.settings.get('view.density')]);
  protected readonly headerHeight = HEADER_HEIGHT;

  /** Id of the element naming the list (the path display) – `aria-labelledby`. */
  readonly labelledBy = input.required<string>();
  /** The panel side (drag and drop); without it the list is no drag source or drop zone. */
  readonly side = input<Side | null>(null);
  /** How the tab shows its folder (design 041 E4). */
  readonly viewMode = input<ViewMode>('full');
  /** The tile view shown instead of the table, null in the full view. */
  protected readonly gridMode = computed<GridMode | null>(() => {
    const mode = this.viewMode();
    return mode === 'full' ? null : mode;
  });
  /** The rows the table displays (sorted, filtered) – what the tile views show. */
  protected readonly displayed = signal<readonly DirEntry[]>([]);
  private readonly grid = viewChild(FileGrid);
  /** Thumbnails of the folder for the thumbnail view (design 041 E6). */
  protected readonly thumbs = new PanelThumbs(inject(ImageOverviewApi));
  private thumbTimer: ReturnType<typeof setTimeout> | null = null;
  private thumbRoot: string | null = null;
  /** Measured widths of the date columns in the current format (design 041 E3). */
  private autoWidths: Readonly<Record<string, number>> = {};
  /** The column layout applied last, and what the shown tab needs. */
  private layoutKey = '';
  private columnContext: ColumnContext = {};

  private readonly dnd = inject(DragStore);
  private readonly dup = inject(DuplicatesStore);
  /** Duplicate tab: rows by path and the groups with marks, for the decision column. */
  private dupCache: {
    readonly rows: readonly DirEntry[];
    readonly marks: ReadonlySet<string>;
    readonly byPath: ReadonlyMap<string, SearchHit>;
    readonly groups: ReadonlySet<number>;
  } | null = null;
  /** The folder row of this list a drag would drop into. */
  protected readonly dropRow = computed(() => {
    const t = this.dnd.drag()?.target;
    return t && t.side === this.side() && !t.tabId ? t.rowPath : null;
  });
  /** A drag would drop into this panel's folder. */
  protected readonly dropOnPanel = computed(() => {
    const t = this.dnd.drag()?.target;
    return !!t && t.side === this.side() && t.rowPath === null && !t.tabId;
  });
  private press: { x: number; y: number; pointerId: number; row: DirEntry } | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private unregisterZone?: () => void;

  /** Strg/⌘+Enter on a folder. */
  readonly openInNewTab = output<DirEntry>();
  /** Right click in the body (`rowIndex` -1 = free space), design 014 E3. */
  readonly contextMenu = output<{ rowIndex: number; x: number; y: number }>();
  /** Right click on the column header: the column menu (design 041 E8). */
  readonly headerMenu = output<{ x: number; y: number }>();
  /** Column layout, sort or scroll changed by the user (debounced by the table). */
  readonly tableStateChanged = output<Partial<TableStateIf>>();

  /** Model and options are created once – a new object would re-create the table. */
  protected readonly table = computed(() =>
    createFileTable(this.labelledBy(), () => this.store.rowFilter()),
  );
  /** The API of the current table – set by `<guiexpert-table-signal>`, `undefined` before/after it. */
  protected readonly api = signal<TableApi | undefined>(undefined);
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
      () =>
        setTimeout(() => {
          this.controller?.restoreCursor();
          this.syncDisplayed();
        }),
      { capture: true },
    );
    // a (new) table: wire bridge, controller and listeners; released with the table or the list
    effect((onCleanup) => {
      const api = this.api();
      if (!api) {
        return;
      }
      untracked(() => this.onTableReady(api));
      onCleanup(() => this.releaseTable());
    });
    effect(() => {
      const listing = this.store.listing();
      untracked(() => {
        if (!listing && this.controller && this.shownListing) {
          // a tab's folder opens (design 029 E5): nothing of the old tab stays in the table
          this.clearRows();
          return;
        }
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
      this.dup.decided(); // the decision column (design 042)
      this.dropRow();
      this.store.animatedSizePaths();
      this.store.removingShown();
      untracked(() => this.bridge?.repaint());
    });
    // language, formats, name display and density (design 015): live, no new table
    effect(() => {
      const p = this.presentation();
      untracked(() => this.applyPresentation(p));
    });
    effect(() => {
      this.store.rowFilter();
      untracked(() => {
        if (this.bridge && this.controller) {
          this.bridge.filterChanged();
          this.controller.restoreCursor();
          this.syncDisplayed();
        }
      });
    });
    // the chosen columns (design 041 E1): order and visibility live, no new table
    effect(() => {
      this.settings.get('view.columns');
      untracked(() => this.reapplyLayout());
    });
    // full ↔ brief ↔ thumbnails (design 041 E7): cursor, marks, order and filter stay
    effect(() => {
      const mode = this.gridMode();
      untracked(() => this.onViewMode(mode));
    });
  }

  private onViewMode(mode: GridMode | null): void {
    const switched = !!this.bridge; // not the first run, before there is a table
    this.bridge?.setCovered(mode !== null);
    this.syncDisplayed();
    this.syncThumbs();
    if (mode === null) {
      // back in the table: the cursor row in view again
      requestAnimationFrame(() => this.controller?.restoreCursor());
    }
    if (switched) {
      // The element that had the focus is covered or gone – also the one a closing palette
      // or menu wants to give it back to. Whoever has no focus then, or one in this list,
      // lands in the view shown now (the view changes in the active panel only).
      const refocus = () => {
        const active = document.activeElement;
        if (!active || active === document.body || this.host.nativeElement.contains(active)) {
          this.focus();
        }
      };
      setTimeout(refocus);
      setTimeout(refocus, 80);
    }
  }

  /** The tile view has its table: a focus that waited for it moves in. */
  protected onGridReady(): void {
    if (this.focusWanted) {
      this.focus();
    }
  }

  /** The tile views show what the table displays: call after rows, sort or filter changed. */
  private syncDisplayed(): void {
    this.displayed.set(
      this.gridMode() !== null && this.bridge ? [...this.bridge.displayedRows()] : [],
    );
  }

  /** Thumbnails only for a local folder in the thumbnail view (design 041 E6). */
  private syncThumbs(): void {
    const l = this.shownListing;
    const local =
      this.gridMode() === 'thumbnails' &&
      l !== null &&
      this.store.searchKey() === null &&
      !l.archive &&
      !l.remote;
    const root = local ? l.path : null;
    const stamp = local ? listingStamp(l.path, l.entries) : '';
    if (this.thumbTimer !== null) {
      clearTimeout(this.thumbTimer);
      this.thumbTimer = null;
    }
    if (root !== null && root === this.thumbRoot) {
      // the same folder again (a copy writes into it): not a new list per change
      this.thumbTimer = setTimeout(() => {
        this.thumbTimer = null;
        this.thumbs.show(root, stamp);
      }, 400);
      return;
    }
    this.thumbRoot = root;
    this.thumbs.show(root, stamp);
  }

  protected onGridMove(index: number): void {
    this.controller?.moveCursorToIndex(index);
  }

  protected onGridClick(click: GridClick): void {
    const controller = this.controller;
    if (!controller) {
      return;
    }
    // as in the table: the focus moves first, then the click marks or opens
    controller.moveCursorToIndex(click.index);
    controller.onClick({
      area: 'body',
      rowIndex: click.index,
      clickCount: click.clickCount,
      shiftKey: click.shiftKey,
      toggleKey: click.toggleKey,
      altKey: click.altKey,
    });
  }

  protected onGridMenu(evt: { index: number; x: number; y: number }): void {
    if (this.dragging) {
      return;
    }
    this.endPress();
    this.contextMenu.emit({ rowIndex: evt.index, x: evt.x, y: evt.y });
  }

  /** Displayed index of the row (or tile) containing `element`, -1 if none. */
  private rowIndexAt(element: Element): number {
    if (this.gridMode() !== null) {
      return this.grid()?.indexAt(element) ?? -1;
    }
    return this.bridge?.rowIndexAt(element) ?? -1;
  }

  /** While rows, state or layout are applied, state events are ours, not the user's. */
  private guarded(apply: () => void): void {
    const seq = ++this.applySeq;
    this.applying = true;
    try {
      apply();
    } finally {
      // the table reports state changes debounced (300 ms)
      setTimeout(() => {
        if (seq === this.applySeq) {
          this.applying = false;
        }
      }, 400);
    }
  }

  /**
   * The column layout for the shown tab (design 041 E1): the chosen columns, what the
   * kind of tab adds, the widths of the tab (`pending` on a tab switch, else those the
   * table has) and the measured date widths. Null = as applied last.
   */
  private layoutFor(pending: Partial<TableStateIf> | null): TableColumnStateIf[] | null {
    if (!this.bridge) {
      return null;
    }
    const widths = pending?.columns
      ? widthsOf(pending)
      : widthsOf(stripAutoWidths(this.bridge.getTableState(), this.autoWidths));
    const layout = columnLayout(
      sanitizeColumns(untracked(() => this.settings.get('view.columns'))),
      this.columnContext,
      widths,
      this.autoWidths,
    );
    const key = JSON.stringify(layout);
    if (key === this.layoutKey && !pending?.columns) {
      return null;
    }
    this.layoutKey = key;
    return layout;
  }

  private reapplyLayout(): void {
    const layout = this.layoutFor(null);
    if (layout && this.bridge) {
      const bridge = this.bridge;
      this.guarded(() => bridge.applyColumns(layout));
    }
  }

  /** Width of `text` in the font of the list; a guess where nothing is laid out (tests). */
  private textWidth(text: string): number {
    const el = this.host.nativeElement;
    const probe = el.ownerDocument.createElement('span');
    probe.style.cssText =
      'position:absolute;visibility:hidden;white-space:nowrap;' +
      'font-family:var(--font-list);font-size:var(--font-size-list)';
    probe.textContent = text;
    el.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width > 0 ? width : roughTextWidth(text);
  }

  /** Column titles and row height from language and settings (read reactively). */
  private presentation(): Presentation {
    const c = TEXTS.columns;
    const headers = {
      name: c.name,
      ext: c.ext,
      size: c.size,
      modifiedMs: c.modified,
      dir: c.folder,
      relDir: c.path,
      group: c.group,
      createdMs: c.created,
      accessedMs: c.accessed,
      attrs: c.attrs,
      type: c.type,
      decision: DUP_TEXTS.decisionColumn,
      pixels: DUP_TEXTS.resolutionColumn,
      share: USAGE_TEXTS.shareColumn,
      items: USAGE_TEXTS.itemsColumn,
    };
    const rowHeight = this.rowHeight();
    // the renderers read these at paint time – a change needs a repaint
    DISPLAY.sizeFormat();
    DISPLAY.dateFormat();
    DISPLAY.folderBrackets();
    DISPLAY.hideExtension();
    FILE_TYPES(); // icons and their colours (design 022 E5)
    locale();
    void TEXTS.emptyFolder;
    return { headers, rowHeight };
  }

  private applyPresentation(p: Presentation): void {
    if (this.bridge) {
      this.bridge.setPresentation(p);
      // the date format may have changed: its columns follow (design 041 E3)
      const width = dateColumnWidth(
        untracked(() => formatModified(WIDE_DATE_MS)),
        (text) => this.textWidth(text),
      );
      this.autoWidths = { modifiedMs: width, createdMs: width, accessedMs: width };
      this.reapplyLayout();
      const l = this.shownListing;
      this.applyEmptyText(!!l && l.parent === null && l.entries.length === 0);
    }
  }

  /**
   * Own "no rows" text in the current language (the table copies its options once –
   * TODO(guiexpert): no API to change the overlay texts after creation).
   */
  private applyEmptyText(empty: boolean): void {
    this.bridge?.setEmptyText(
      empty ? (this.store.searchKey() !== null ? TEXTS.noHits : TEXTS.emptyFolder) : null,
    );
  }

  private releaseTable(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unregisterZone?.();
    this.unregisterZone = undefined;
  }

  private onTableReady(api: TableApi): void {
    const table = this.table();
    const bridge = createTableBridge(api, table.body, table.columnDefs);
    const controller = new FileListController(bridge, this.store, {
      openInNewTab: (entry) => this.openInNewTab.emit(entry),
      // the one chain rule → viewer → open (designs 072, 073, 079 E1)
      doubleClick: (entry, modifiers) =>
        this.injector.get(EntryActivator).decide(entry, modifiers, this.store),
    });
    this.bridge = bridge;
    this.controller = controller;
    // titles and row height of the current language/settings (the table starts with the defaults)
    this.applyPresentation(untracked(() => this.presentation()));

    removeConflictingShortcuts(api);
    table.body.setRowState({
      cursorRow: () => bridge.focusedRow(),
      isMarked: (path) => this.store.isMarked(path),
      isDropTarget: (path) => this.dropRow() === path,
      isCalculatingSize: (path) => this.store.isSizeAnimated(path),
      removing: (path) => this.store.removingOf(path),
      dupDecision: (path) => this.dupDecision(path),
    });
    const side = this.side();
    if (side) {
      this.unregisterZone = this.dnd.registerZone({
        element: this.host.nativeElement,
        hit: (el) => {
          const index = this.rowIndexAt(el);
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
          this.tableStateChanged.emit(stripAutoWidths(evt.state, this.autoWidths));
        }
      },
      onContextmenu: (evt) => {
        const e = evt.originalEvent;
        if (!e) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (evt.areaIdent === 'header') {
          this.headerMenu.emit({ x: e.clientX, y: e.clientY }); // design 041 E8
          return;
        }
        if (this.dragging) {
          return; // no menu in the middle of a drag (012 × 014)
        }
        // macOS Ctrl+click is a button-0 press: it must not turn into a drag behind the menu
        this.endPress();
        this.contextMenu.emit({
          rowIndex: evt.areaIdent === 'body' ? evt.rowIndex : -1,
          x: e.clientX,
          y: e.clientY,
        });
      },
      // core event, not the wrapper output: no 150 ms debounce (design E5)
      onMouseClicked: (evt) =>
        controller.onClick({
          area: evt.areaIdent,
          rowIndex: evt.rowIndex,
          clickCount: evt.clickCount,
          shiftKey: evt.originalEvent?.shiftKey ?? false,
          toggleKey: (IS_MAC ? evt.originalEvent?.metaKey : evt.originalEvent?.ctrlKey) ?? false,
          altKey: evt.originalEvent?.altKey ?? false,
        }),
    });

    this.store.scrollTop = () => bridge.getTableState().scroll?.top ?? 0;
    this.layoutKey = '';
    bridge.setCovered(this.gridMode() !== null);
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
      // a folder still opening: Esc gives it up (design 029 E4), else it ends type-ahead
      // … and stops a running search or flat listing (design 038 E6)
      if (this.store.loading() || this.store.resultBusy()) {
        evt.preventDefault();
        evt.stopPropagation();
        void this.injector.get(ActionService).run('CANCEL_LOADING');
        return;
      }
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
    const index = this.rowIndexAt(target);
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
    document.addEventListener('mouseout', this.onWindowOut, true);
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
        inArchive: !!this.store.listing()?.archive,
      });
    } else if (leftWindow(evt.clientX, evt.clientY, window.innerWidth, window.innerHeight)) {
      this.handOffToSystem(evt.buttons);
    } else {
      this.dnd.move(evt.clientX, evt.clientY, dragKind(evt, IS_MAC));
    }
    evt.preventDefault();
  };

  /** Fallback when moves outside the window are not reported (design 028 E1). */
  private readonly onWindowOut = (evt: MouseEvent): void => {
    if (this.dragging && leavingAtEdge(evt, window.innerWidth, window.innerHeight)) {
      this.handOffToSystem(evt.buttons);
    }
  };

  /**
   * Out of the window: the system takes over (design 028 E1). Capture and
   * listeners go first – the native drag needs the mouse.
   */
  private handOffToSystem(buttons: number): void {
    this.endPress();
    if (buttons & 1) {
      void this.dnd.handOff();
    } else {
      // released on the way out: no system drag without a held button (review 028 #1)
      this.dnd.cancel();
    }
  }

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
    document.removeEventListener('mouseout', this.onWindowOut, true);
  }

  /** Behaviour of this list for the panel's actions (undefined until the table is ready). */
  get listController(): FileListController | undefined {
    return this.controller;
  }

  /** The table state of the current tab (columns, sort, scroll). */
  captureTableState(): Partial<TableStateIf> | null {
    return this.bridge ? stripAutoWidths(this.bridge.getTableState(), this.autoWidths) : null;
  }

  /** Moves the keyboard focus into the table or the tile view (now, or as soon as it exists). */
  focus(): void {
    if (this.gridMode() !== null) {
      // false until the grid's table is built: `onGridReady` tries again
      this.focusWanted = !this.grid()?.focus();
      return;
    }
    // the table's host is the tab stop (not the grid's, which lies beside it)
    const target = this.host.nativeElement.querySelector<HTMLElement>('.table[tabindex="0"]');
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
    this.syncDisplayed();
    this.syncThumbs();
    return true;
  }

  /** Rows of a listing: the ".." row first (if there is a parent), then the entries. */
  private clearRows(): void {
    this.shownListing = null;
    this.shownPath = null;
    const seq = ++this.applySeq;
    this.applying = true;
    try {
      this.bridge?.setRows([]);
      this.syncDisplayed();
      this.syncThumbs();
    } finally {
      setTimeout(() => {
        if (seq === this.applySeq) {
          this.applying = false;
        }
      }, 400);
    }
  }

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
    const pending = this.store.takePendingTableState();
    // which columns this kind of tab shows (design 041 E1; rules of 009, 033, 038, 042)
    const usage = this.store.isUsage();
    const flat = this.store.flat();
    const result = this.store.searchKey() !== null;
    const dupTab = result && this.store.searchKind() === 'duplicates';
    this.columnContext = {
      usage,
      duplicates: dupTab,
      // decisions only where contents (or looks) were compared (design 042 E1)
      decision: dupTab && !this.dup.sizeOnlyKey(this.store.searchKey()),
      pixels: dupTab && rows.some((r) => (r as SearchHit).width !== undefined),
      // the folder column belongs to result tabs; the flat view shows the folder
      // relative to its root instead (design 038 E3)
      dir:
        result && !flat && (!usage || rows.some((r) => (r as { dir?: string }).dir !== undefined)),
      relDir: flat,
    };
    const layout = this.layoutFor(pending);
    let state: Partial<TableStateIf> | undefined;
    if (pending || layout) {
      // order and visibility of a stored tab state do not count: the layout does
      const rest = { ...pending };
      delete rest.columns;
      state = layout ? { ...rest, columns: layout } : rest;
    }

    const seq = ++this.applySeq;
    this.applying = true;
    try {
      this.controller?.showRows(rows, label, state);
      this.applyEmptyText(rows.length === 0);
      this.syncDisplayed();
      this.syncThumbs();
    } finally {
      // the table reports state changes debounced (300 ms) – ignore the ones caused by applying
      setTimeout(() => {
        if (seq === this.applySeq) {
          this.applying = false;
        }
      }, 400);
    }
  }

  /** The "Decision" cell of a duplicate row (design 042 E1): the marks are the truth. */
  private dupDecision(path: string): DecisionView | null {
    const key = this.store.searchKey();
    if (key === null || this.store.searchKind() !== 'duplicates') {
      return null;
    }
    const rows = this.store.entries();
    const marks = this.store.marked();
    let c = this.dupCache;
    if (!c || c.rows !== rows || c.marks !== marks) {
      const hits = rows as readonly SearchHit[];
      c = {
        rows,
        marks,
        byPath: new Map(hits.map((h) => [h.path, h])),
        groups: markedGroups(hits, marks),
      };
      this.dupCache = c;
    }
    const row = c.byPath.get(path);
    if (!row) {
      return null;
    }
    const d = shownDecision(
      row,
      marks.has(path),
      row.group !== undefined && c.groups.has(row.group),
      this.dup.decisionOf(key, path),
    );
    if (!d) {
      return null;
    }
    return {
      kind: d.decision,
      text: DUP_TEXTS.decision[d.decision] ?? d.decision,
      reason: this.dup.reasonLabel(key, d.reason),
      title: DUP_TEXTS.decisionTitle[d.decision] ?? null,
    };
  }

  ngOnDestroy(): void {
    this.releaseTable();
    if (this.thumbTimer !== null) {
      clearTimeout(this.thumbTimer);
    }
    this.thumbs.dispose();
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
