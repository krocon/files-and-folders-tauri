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
import { recordPerf, since } from '../../../shared/perf';
import { FileBrowserStore } from '../file-browser.store';
import { FileListController } from './file-list-controller';
import { createFileTable } from './file-table-model';
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
  },
})
export class FileList implements OnDestroy {
  protected readonly store = inject(FileBrowserStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Id of the element naming the list (the path display) – `aria-labelledby`. */
  readonly labelledBy = input.required<string>();

  /** Strg/⌘+Enter on a folder. */
  readonly openInNewTab = output<DirEntry>();
  /** Column layout, sort or scroll changed by the user (debounced by the table). */
  readonly tableStateChanged = output<Partial<TableStateIf>>();

  /** Model and options are created once – a new object would re-create the table. */
  protected readonly table = computed(() =>
    createFileTable(this.labelledBy(), () => this.store.rowFilter()),
  );
  private shownPath: string | null = null;

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
    });
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

  /** Rows of a listing: the ".." row first (if there is a parent), then the entries. */
  private show(listing: DirectoryListing): void {
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
  }
}
