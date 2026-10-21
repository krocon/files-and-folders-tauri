import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  OnInit,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TableSignalComponent } from '@guiexpert/angular-table';
import {
  AreaModelObjectArrayWithColumndefs,
  ColumnDef,
  ColumnDefIf,
  SelectionModel,
  Size,
  TableApi,
  TableFactory,
  TableModelIf,
  TableOptions,
  TableOptionsIf,
} from '@guiexpert/table';

const ROW_HEIGHT = 24;
const px = (v: number) => new Size(v, 'px');

/** A column of the grid: `width` in px, or `null` = takes the rest (weight 1). */
export interface GridColumn {
  readonly property: string;
  readonly label: string;
  readonly width: number | null;
  readonly align?: 'start' | 'end';
}

/** Row class per row (e.g. `fnf-mr-error`, `fnf-mr-unchanged` from the table theme). */
export type RowClassFn<T> = (row: T) => string | null;

class GridBodyModel<T> extends AreaModelObjectArrayWithColumndefs<T> {
  constructor(
    columnDefs: ColumnDefIf[],
    private readonly rowClass: () => RowClassFn<T> | null,
    private readonly activeIndex: () => number,
  ) {
    super('body', [], columnDefs, ROW_HEIGHT);
  }

  override getCustomClassesAt(rowIndex: number, columnIndex: number): string[] {
    const row = this.getRowByIndex(rowIndex) as T | undefined;
    if (row === undefined) {
      return []; // G13: never ask the core for a missing row
    }
    const classes = super.getCustomClassesAt(rowIndex, columnIndex);
    const extra = this.rowClass()?.(row);
    if (extra) {
      classes.push(extra);
    }
    if (rowIndex === this.activeIndex()) {
      classes.push('fnf-grid-active');
    }
    return classes;
  }
}

/**
 * Read-only GuiExpert Table for previews (design 008 E5): columns and row
 * class as inputs, the model is built once (columns are read on creation),
 * new rows are swapped in with `setRows` + `repaintHard`. Cell texts are
 * rendered as text by the core – file names never go into `innerHTML`.
 */
@Component({
  selector: 'app-preview-grid',
  imports: [TableSignalComponent],
  template: `
    @if (model) {
      <guiexpert-table-signal
        class="table"
        [tableModel]="model"
        [tableOptions]="options"
        [(tableApi)]="api"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
      min-width: 0;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
      /* = defaultRowHeights: text vertically centred (ge-table-theme.css) */
      --fnf-row-height: 24px;
      --fnf-header-height: 26px;
    }
    .table {
      display: block;
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreviewGrid<T extends object> implements OnInit {
  readonly columns = input.required<readonly GridColumn[]>();
  readonly rows = input.required<readonly T[]>();
  readonly rowClass = input<RowClassFn<T> | null>(null);
  /** Id of the element that labels the grid. */
  readonly labelledBy = input<string | null>(null);
  /** Highlighted row (a list driven from an input field, design 009 folder finder); -1 = none. */
  readonly activeIndex = input<number>(-1);
  /** Click on a body row (displayed index). */
  readonly rowClick = output<{ index: number; clickCount: number }>();

  protected options: TableOptionsIf = new TableOptions();
  protected model: TableModelIf | null = null;
  /** Set by `<guiexpert-table-signal>`; `undefined` before the table exists and after it is gone. */
  protected readonly api = signal<TableApi | undefined>(undefined);

  constructor() {
    // core event, not the debounced output: every click with its clickCount
    effect((onCleanup) => {
      const api = this.api();
      if (!api) {
        return;
      }
      const unsubscribe = api.subscribe({
        onMouseClicked: (evt) => {
          if (evt.areaIdent === 'body' && evt.rowIndex >= 0) {
            this.rowClick.emit({ index: evt.rowIndex, clickCount: evt.clickCount });
          }
        },
      });
      onCleanup(unsubscribe);
    });
    effect(() => {
      const api = this.api();
      const rows = this.rows();
      if (api) {
        untracked(() => {
          api.setRows([...rows]);
          api.repaintHard();
        });
      }
    });
    effect(() => {
      const api = this.api();
      const index = this.activeIndex();
      untracked(() => {
        if (api && index >= 0) {
          api.ensureRowIsVisible(index);
        }
        api?.repaint();
      });
    });
  }

  /** Inputs are set now – the model is built once, before the first render. */
  ngOnInit(): void {
    const columnDefs = this.columns().map((c) => {
      const align = [c.align === 'end' ? 'ge-table-text-align-end' : 'ge-table-text-align-start'];
      return ColumnDef.create({
        property: c.property,
        headerLabel: c.label,
        width: c.width === null ? new Size(1, 'weight') : px(c.width),
        minWidth: c.width === null ? px(140) : undefined,
        headerClasses: align,
        bodyClasses: align,
      });
    });
    this.options = {
      ...new TableOptions(),
      defaultRowHeights: { header: 26, body: ROW_HEIGHT, footer: 0 },
      hoverColumnVisible: false,
      hoverRowVisible: true,
      verticalBorderVisible: false,
      horizontalBorderVisible: false,
      headerSeparatorBorderVisible: true,
      getSelectionModel: () => new SelectionModel('none', 'single'),
      ariaLabelledBy: this.labelledBy() ?? undefined,
      overlayOptions: { noRowsText: '–', loadingText: '…', loadingDelayInMs: 150 },
    };
    const body = new GridBodyModel<T>(
      columnDefs,
      () => this.rowClass(),
      () => this.activeIndex(),
    );
    this.model = TableFactory.createTableModel({
      bodyAreaModel: body,
      columnDefs,
      tableOptions: this.options,
    });
  }
}
