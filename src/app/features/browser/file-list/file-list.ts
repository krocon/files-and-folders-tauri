import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  untracked,
} from '@angular/core';
import { TableComponent } from '@guiexpert/angular-table';
import { TableApi } from '@guiexpert/table';
import { recordPerf, since } from '../../../shared/perf';
import { FileBrowserStore } from '../file-browser.store';
import { FileListController } from './file-list-controller';
import { createFileTable } from './file-table-model';
import { createTableBridge, removeConflictingShortcuts, TableBridge } from './table-bridge';

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
  },
})
export class FileList implements OnDestroy {
  protected readonly store = inject(FileBrowserStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Id of the element naming the list (the path display) – `aria-labelledby`. */
  readonly labelledBy = input.required<string>();

  /** Model and options are created once – a new object would re-create the table. */
  protected readonly table = computed(() => createFileTable(this.labelledBy()));

  private bridge?: TableBridge;
  private controller?: FileListController;
  private unsubscribe?: () => void;
  private focusedOnce = false;

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
          this.controller.showRows(listing.entries, listing.segments.at(-1)?.name ?? listing.path);
          const sync = since(start);
          requestAnimationFrame(() =>
            recordPerf(
              'table setRows + sort + render',
              since(start),
              `sync ${Math.round(sync)} ms, ${listing.entries.length} rows`,
            ),
          );
          this.focusTableOnce();
        }
      });
    });
    effect(() => {
      this.store.marked();
      untracked(() => this.bridge?.repaint());
    });
  }

  protected onTableReady(api: TableApi): void {
    const table = this.table();
    const bridge = createTableBridge(api, table.body);
    const controller = new FileListController(bridge, this.store);
    this.bridge = bridge;
    this.controller = controller;

    removeConflictingShortcuts(api);
    table.body.setRowState({
      cursorRow: () => bridge.focusedRow(),
      isMarked: (path) => this.store.isMarked(path),
    });
    api.getTableScope().shortcutService.addListener({
      onActionTriggered: (actionId) => controller.onAction(actionId),
    });
    this.unsubscribe = api.subscribe({
      onFocusChanged: (model) => controller.onFocusChanged(model.getFocus()[0]),
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

    const listing = this.store.listing();
    if (listing) {
      controller.showRows(listing.entries, listing.segments.at(-1)?.name ?? listing.path);
      this.focusTableOnce();
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (this.controller?.onKey(evt)) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  private focusTableOnce(): void {
    if (this.focusedOnce) {
      return;
    }
    this.focusedOnce = true;
    this.host.nativeElement.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }
}
