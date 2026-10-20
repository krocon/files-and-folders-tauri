import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  OnDestroy,
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
import { recordPerf, since } from '../../shared/perf';
import { matchesFilter, PreviewFilter, PreviewRow } from './multirename-logic';
import { MR_TEXTS } from './multirename-texts';

const ROW_HEIGHT = 24;
/** Id of the dialog's label of the preview (`aria-labelledby` of the table). */
export const PREVIEW_LABEL_ID = 'fnf-mr-preview-label';
const px = (v: number) => new Size(v, 'px');

/** Body model: row classes per status (the table only knows classes per cell). */
class PreviewBodyModel extends AreaModelObjectArrayWithColumndefs<PreviewRow> {
  constructor(columnDefs: ColumnDefIf[]) {
    super('body', [], columnDefs, ROW_HEIGHT);
  }

  override getCustomClassesAt(rowIndex: number, columnIndex: number): string[] {
    const row = this.getRowByIndex(rowIndex) as PreviewRow | undefined;
    if (!row) {
      return []; // G13: never ask the core for a missing row
    }
    const classes = super.getCustomClassesAt(rowIndex, columnIndex);
    if (row.status === 'error') {
      classes.push('fnf-mr-error');
    } else if (row.status === 'unchanged') {
      classes.push('fnf-mr-unchanged');
    } else if (row.status === 'ok' && this.columnDefs[columnIndex]?.property === 'newName') {
      classes.push('fnf-mr-new');
    }
    return classes;
  }
}

function columns(): ColumnDefIf[] {
  const start = ['ge-table-text-align-start'];
  return [
    ColumnDef.create({
      property: 'nr',
      headerLabel: MR_TEXTS.colNr,
      width: px(64),
      headerClasses: ['ge-table-text-align-end'],
      bodyClasses: ['ge-table-text-align-end'],
    }),
    ColumnDef.create({
      property: 'oldName',
      headerLabel: MR_TEXTS.colOld,
      width: new Size(1, 'weight'),
      minWidth: px(140),
      headerClasses: start,
      bodyClasses: start,
    }),
    ColumnDef.create({
      property: 'info',
      headerLabel: MR_TEXTS.colInfo,
      width: px(300),
      headerClasses: start,
      bodyClasses: start,
    }),
    ColumnDef.create({
      property: 'newName',
      headerLabel: MR_TEXTS.colNew,
      width: new Size(1, 'weight'),
      minWidth: px(140),
      headerClasses: start,
      bodyClasses: start,
    }),
  ];
}

/**
 * Read-only GuiExpert Table of the preview (virtual – 10 000 rows are cheap).
 * Model and options are created once; new rows are swapped in with
 * `setRows` + `repaintHard`, the filter runs as `externalFilterFunction`.
 */
@Component({
  selector: 'app-mr-preview-table',
  imports: [TableComponent],
  template: `
    <guiexpert-table
      class="table"
      [tableModel]="model"
      [tableOptions]="options"
      (tableReady)="onReady($event)"
    />
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
export class PreviewTable implements OnDestroy {
  readonly rows = input.required<readonly PreviewRow[]>();
  readonly filter = input<PreviewFilter>('all');

  private readonly columnDefs = columns();
  private readonly body = new PreviewBodyModel(this.columnDefs);
  protected readonly options: TableOptionsIf = {
    ...new TableOptions(),
    defaultRowHeights: { header: 26, body: ROW_HEIGHT, footer: 0 },
    hoverColumnVisible: false,
    hoverRowVisible: true,
    verticalBorderVisible: false,
    horizontalBorderVisible: false,
    headerSeparatorBorderVisible: true,
    getSelectionModel: () => new SelectionModel('none', 'single'),
    ariaLabelledBy: PREVIEW_LABEL_ID,
    externalFilterFunction: (row: PreviewRow) => matchesFilter(row, this.filter()),
    overlayOptions: { noRowsText: '–', loadingText: '…', loadingDelayInMs: 150 },
  };
  protected readonly model: TableModelIf = TableFactory.createTableModel({
    bodyAreaModel: this.body,
    columnDefs: this.columnDefs,
    tableOptions: this.options,
  });
  private api: TableApi | null = null;

  constructor() {
    effect(() => {
      const rows = this.rows();
      this.filter();
      untracked(() => this.show(rows));
    });
  }

  protected onReady(api: TableApi): void {
    this.api = api;
    this.show(this.rows());
  }

  private show(rows: readonly PreviewRow[]): void {
    const api = this.api;
    if (!api) {
      return;
    }
    const start = performance.now();
    api.setRows([...rows]);
    api.externalFilterChanged();
    api.repaintHard();
    if (rows.length >= 1000) {
      recordPerf('multi-rename preview table', since(start), `${rows.length} rows`);
    }
  }

  ngOnDestroy(): void {
    this.api = null;
  }
}
