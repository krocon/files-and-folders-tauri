import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  OnDestroy,
  OnInit,
  output,
  untracked,
} from '@angular/core';
import { TableComponent } from '@guiexpert/angular-table';
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
  imports: [TableComponent],
  template: `
    @if (model) {
      <guiexpert-table
        class="table"
        [tableModel]="model"
        [tableOptions]="options"
        (tableReady)="onReady($event)"
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
export class PreviewGrid<T extends object> implements OnInit, OnDestroy {
  readonly columns = input.required<readonly GridColumn[]>();
  readonly rows = input.required<readonly T[]>();
  readonly rowClass = input<RowClassFn<T> | null>(null);
  /** Id of the element that labels the grid. */
  readonly labelledBy = input<string | null>(null);
  /** Highlighted row (a list driven from an input field, design 009 folder finder); -1 = none. */
  readonly activeIndex = input<number>(-1);
  /** Click on a body row (displayed index). */
  readonly rowClick = output<{ index: number; clickCount: number }>();
  private unsubscribe: (() => void) | null = null;

  protected options: TableOptionsIf = new TableOptions();
  protected model: TableModelIf | null = null;
  private api: TableApi | null = null;

  constructor() {
    effect(() => {
      const rows = this.rows();
      untracked(() => this.show(rows));
    });
    effect(() => {
      const index = this.activeIndex();
      untracked(() => {
        if (this.api && index >= 0) {
          this.api.ensureRowIsVisible(index);
        }
        this.api?.repaint();
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

  protected onReady(api: TableApi): void {
    this.api = api;
    this.unsubscribe = api.subscribe({
      onMouseClicked: (evt) => {
        if (evt.areaIdent === 'body' && evt.rowIndex >= 0) {
          this.rowClick.emit({ index: evt.rowIndex, clickCount: evt.clickCount });
        }
      },
    });
    this.show(this.rows());
  }

  private show(rows: readonly T[]): void {
    const api = this.api;
    if (!api) {
      return;
    }
    api.setRows([...rows]);
    api.repaintHard();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.api = null;
  }
}
