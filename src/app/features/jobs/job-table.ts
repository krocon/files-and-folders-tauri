import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  ViewEncapsulation,
} from '@angular/core';
import { TableSignalComponent } from '@guiexpert/angular-table';
import {
  AreaIdent,
  AreaModelIf,
  AreaModelObjectArrayWithColumndefs,
  CellRendererIf,
  ColumnDef,
  ColumnDefIf,
  DomServiceIf,
  RendererCleanupFnType,
  SelectionModel,
  Size,
  TableApi,
  TableFactory,
  TableModelIf,
  TableOptions,
  TableOptionsIf,
} from '@guiexpert/table';
import { JOB_TEXTS } from './job-format';
import { JobAct, JobRow } from './job-rows';

/** Two lines of text per row (amount + speed, task + current file). */
const ROW_HEIGHT = 46;
const px = (v: number) => new Size(v, 'px');

function rowAt(areaModel: AreaModelIf, rowIndex: number): JobRow | undefined {
  return areaModel.getRowByIndex(rowIndex) as JobRow | undefined;
}

function line(dom: DomServiceIf, parent: HTMLElement, text: string, clazz: string): void {
  const span = dom.createElement<HTMLSpanElement>('span');
  dom.addClass(span, clazz);
  dom.appendChild(span, dom.createText(text));
  dom.setAttribute(span, 'title', text);
  dom.appendChild(parent, span);
}

/** Column 1: the state word, coloured for problems and questions (never colour alone). */
class StatusRenderer implements CellRendererIf {
  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _c: number,
    _a: AreaIdent,
    areaModel: AreaModelIf,
    _v: unknown,
    dom: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    const row = rowAt(areaModel, rowIndex);
    dom.addClass(cellDiv, 'fnf-cell');
    if (!row) {
      return undefined;
    }
    dom.addClass(cellDiv, `fnf-job-state-${row.state}`);
    if (row.problem) {
      dom.addClass(cellDiv, 'fnf-job-problem');
    }
    dom.appendChild(cellDiv, dom.createText(row.status));
    return undefined;
  }
}

/** Two lines: `first` above, `second` small below (text nodes only – paths are user data). */
class TwoLineRenderer implements CellRendererIf {
  constructor(
    private readonly first: (r: JobRow) => string,
    private readonly second: (r: JobRow) => string,
    private readonly mono = false,
  ) {}

  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _c: number,
    _a: AreaIdent,
    areaModel: AreaModelIf,
    _v: unknown,
    dom: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    const row = rowAt(areaModel, rowIndex);
    dom.addClass(cellDiv, 'fnf-cell');
    dom.addClass(cellDiv, 'fnf-job-2l');
    if (!row) {
      return undefined;
    }
    line(dom, cellDiv, this.first(row), 'fnf-job-l1');
    const second = this.second(row);
    if (second) {
      line(dom, cellDiv, second, this.mono ? 'fnf-job-l2 fnf-job-mono' : 'fnf-job-l2');
    }
    return undefined;
  }
}

/** Column 3: a progress bar as high as the row, the percentage inside. */
class BarRenderer implements CellRendererIf {
  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _c: number,
    _a: AreaIdent,
    areaModel: AreaModelIf,
    _v: unknown,
    dom: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    const row = rowAt(areaModel, rowIndex);
    dom.addClass(cellDiv, 'fnf-job-barcell');
    if (!row || (row.finished && row.percent === null)) {
      return undefined;
    }
    const track = dom.createElement<HTMLDivElement>('div');
    dom.addClass(track, 'fnf-job-track');
    dom.setAttribute(track, 'role', 'progressbar');
    dom.setAttribute(track, 'aria-label', row.action);
    dom.setAttribute(track, 'aria-valuemin', '0');
    dom.setAttribute(track, 'aria-valuemax', '100');
    const fill = dom.createElement<HTMLDivElement>('div');
    dom.addClass(fill, 'fnf-job-fill');
    if (row.percent === null) {
      dom.addClass(fill, 'fnf-job-indeterminate');
    } else {
      dom.setAttribute(track, 'aria-valuenow', String(row.percent));
      dom.setStyle(fill, 'width', `${row.percent}%`);
    }
    dom.appendChild(track, fill);
    if (row.percent !== null) {
      // twice: in the text colour over the empty part, in the accent text colour clipped to the
      // filled part – readable on both
      for (const on of [false, true]) {
        const label = dom.createElement<HTMLSpanElement>('span');
        dom.addClass(label, 'fnf-job-pct');
        dom.setAttribute(label, 'aria-hidden', 'true');
        if (on) {
          dom.addClass(label, 'fnf-job-pct-on');
          dom.setStyle(label, 'clip-path', `inset(0 ${100 - row.percent}% 0 0)`);
        }
        dom.appendChild(label, dom.createText(`${row.percent} %`));
        dom.appendChild(track, label);
      }
    }
    dom.appendChild(cellDiv, track);
    return undefined;
  }
}

/** Column 5: the buttons of a task; clicks go to `act`. */
class ButtonsRenderer implements CellRendererIf {
  constructor(private readonly act: (id: string, act: JobAct) => void) {}

  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _c: number,
    _a: AreaIdent,
    areaModel: AreaModelIf,
    _v: unknown,
    dom: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    const row = rowAt(areaModel, rowIndex);
    dom.addClass(cellDiv, 'fnf-job-buttons');
    if (!row) {
      return undefined;
    }
    const cleanups: (() => void)[] = [];
    for (const b of row.buttons) {
      const btn = dom.createElement<HTMLButtonElement>('button');
      dom.setAttribute(btn, 'type', 'button');
      dom.addClass(btn, 'btn');
      dom.addClass(btn, 'small');
      if (b.look !== 'normal') {
        dom.addClass(btn, b.look);
      }
      dom.setAttribute(btn, 'aria-label', b.ariaLabel);
      dom.setAttribute(btn, 'data-job', row.id);
      dom.setAttribute(btn, 'data-slot', b.slot);
      if (b.pressed !== undefined) {
        dom.setAttribute(btn, 'aria-pressed', String(b.pressed));
      }
      dom.appendChild(btn, dom.createText(b.label));
      const onClick = (evt: MouseEvent) => {
        evt.stopPropagation(); // not a row click
        this.act(row.id, b.act);
      };
      // Enter/Space belong to the button, not to the table's keyboard handling
      const onKey = (evt: KeyboardEvent) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.stopPropagation();
        }
      };
      btn.addEventListener('click', onClick);
      btn.addEventListener('keydown', onKey);
      cleanups.push(() => {
        btn.removeEventListener('click', onClick);
        btn.removeEventListener('keydown', onKey);
      });
      dom.appendChild(cellDiv, btn);
    }
    return () => cleanups.forEach((c) => c());
  }
}

class JobBodyModel extends AreaModelObjectArrayWithColumndefs<JobRow> {
  constructor(
    columnDefs: ColumnDefIf[],
    private readonly selected: () => string | null,
  ) {
    super('body', [], columnDefs, ROW_HEIGHT);
  }

  override getCustomClassesAt(rowIndex: number, columnIndex: number): string[] {
    const row = this.getRowByIndex(rowIndex) as JobRow | undefined;
    if (row === undefined) {
      return []; // G13: never ask the core for a missing row
    }
    const classes = super.getCustomClassesAt(rowIndex, columnIndex);
    if (row.finished) {
      classes.push('fnf-job-finished');
    }
    if (row.id === this.selected()) {
      classes.push('fnf-grid-active');
    }
    return classes;
  }
}

/**
 * The task list as a GuiExpert Table (Marc, 2026-10-24): status | amount + speed |
 * progress bar | task + current file | buttons. Rows are swapped in with `setRows`
 * (10×/s while copying); a focused button gets its focus back after each repaint.
 */
@Component({
  selector: 'app-job-table',
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
  styleUrl: './job-table.css',
  // the cells are built by the table core: component styles would not reach them
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobTable {
  readonly rows = input.required<readonly JobRow[]>();
  readonly selectedId = input<string | null>(null);
  /** A button of a row. */
  readonly act = output<{ id: string; act: JobAct }>();
  /** A click on a row (not on a button). */
  readonly rowClick = output<string>();

  protected readonly api = signal<TableApi | undefined>(undefined);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly model: TableModelIf;
  protected readonly options: TableOptionsIf;

  constructor() {
    const t = JOB_TEXTS;
    const start = ['ge-table-text-align-start'];
    const columnDefs = [
      ColumnDef.create({
        property: 'status',
        headerLabel: t.colStatus,
        width: px(150),
        bodyRenderer: new StatusRenderer(),
        headerClasses: start,
        bodyClasses: start,
      }),
      ColumnDef.create({
        property: 'amount',
        headerLabel: t.colProgress,
        width: px(200),
        bodyRenderer: new TwoLineRenderer(
          (r) => r.amount,
          (r) => r.speed,
        ),
        headerClasses: start,
        bodyClasses: start,
      }),
      ColumnDef.create({
        property: 'percent',
        headerLabel: t.colBar,
        width: px(170),
        bodyRenderer: new BarRenderer(),
        headerClasses: start,
        bodyClasses: start,
      }),
      ColumnDef.create({
        property: 'action',
        headerLabel: t.colAction,
        width: new Size(1, 'weight'),
        minWidth: px(220),
        bodyRenderer: new TwoLineRenderer(
          (r) => r.action,
          (r) => r.current,
          true,
        ),
        headerClasses: start,
        bodyClasses: start,
      }),
      ColumnDef.create({
        property: 'buttons',
        headerLabel: t.colButtons,
        // Room for three single-line buttons, also in German ("Sofort starten", "Fortsetzen", "Abbrechen").
        width: px(320),
        bodyRenderer: new ButtonsRenderer((id, act) => this.act.emit({ id, act })),
        headerClasses: ['ge-table-text-align-end'],
        bodyClasses: ['ge-table-text-align-end'],
      }),
    ];
    this.options = {
      ...new TableOptions(),
      defaultRowHeights: { header: 30, body: ROW_HEIGHT, footer: 0 },
      hoverColumnVisible: false,
      hoverRowVisible: true,
      verticalBorderVisible: false,
      horizontalBorderVisible: true,
      headerSeparatorBorderVisible: true,
      getSelectionModel: () => new SelectionModel('none', 'single'),
      overlayOptions: { noRowsText: JOB_TEXTS.noJobs, loadingText: '…', loadingDelayInMs: 150 },
    };
    const body = new JobBodyModel(columnDefs, () => this.selectedId());
    this.model = TableFactory.createTableModel({
      bodyAreaModel: body,
      columnDefs,
      tableOptions: this.options,
    });

    effect((onCleanup) => {
      const api = this.api();
      if (!api) {
        return;
      }
      const unsubscribe = api.subscribe({
        onMouseClicked: (evt) => {
          if (evt.areaIdent === 'body' && evt.rowIndex >= 0) {
            const row = untracked(this.rows)[evt.rowIndex];
            if (row) {
              this.rowClick.emit(row.id);
            }
          }
        },
      });
      onCleanup(unsubscribe);
    });
    effect(() => {
      const api = this.api();
      const rows = this.rows();
      this.selectedId();
      if (api) {
        untracked(() => this.swapRows(api, rows));
      }
    });
  }

  /** New rows, the keyboard focus stays on "the same" button (job + slot, Pause ⇄ Resume). */
  private swapRows(api: TableApi, rows: readonly JobRow[]): void {
    const el = this.host.nativeElement;
    const focused = document.activeElement as HTMLElement | null;
    const keep =
      focused && el.contains(focused) && focused.dataset['job']
        ? { job: focused.dataset['job'], slot: focused.dataset['slot'] }
        : null;
    api.setRows([...rows]);
    api.repaintHard();
    if (keep) {
      const again = [...el.querySelectorAll<HTMLButtonElement>('button[data-job]')].find(
        (b) => b.dataset['job'] === keep.job && b.dataset['slot'] === keep.slot,
      );
      again?.focus();
    }
  }
}
