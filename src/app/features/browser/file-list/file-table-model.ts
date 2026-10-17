import {
  AreaModelObjectArrayWithColumndefs,
  SelectionModel,
  ShortcutActionIdMapping,
  TableFactory,
  TableModelIf,
  TableOptions,
  TableOptionsIf,
} from '@guiexpert/table';
import { DirEntry } from '../../../core/fs/fs.models';
import { createFileColumns } from './file-columns';
import { RenameEditor } from './rename-editor';

export const ROW_HEIGHT = 24;
export const HEADER_HEIGHT = 26;

/** What the body model needs to know to style rows (read at render time). */
export interface FileRowState {
  /** Displayed row index of the cursor (table focus), -1 if none. */
  cursorRow(): number;
  isMarked(path: string): boolean;
}

/**
 * Body model of the file list: adds row classes for cursor, marked, hidden and
 * symlink entries. The table only supports classes per cell, so every cell of
 * a row gets them.
 */
export class FileBodyModel extends AreaModelObjectArrayWithColumndefs<DirEntry> {
  constructor(
    rows: DirEntry[],
    columnDefs: ReturnType<typeof createFileColumns>,
    private state: FileRowState,
  ) {
    super('body', rows, columnDefs, ROW_HEIGHT);
  }

  setRowState(state: FileRowState): void {
    this.state = state;
  }

  /** In-place rename (F2): only this entry's name cell is editable, with this editor. */
  renaming: { readonly path: string; readonly editor: RenameEditor } | null = null;

  override isEditable(rowIndex: number, columnIndex: number): boolean {
    const r = this.renaming;
    if (!r || this.columnDefs[columnIndex]?.property !== 'name') {
      return false;
    }
    return (this.getRowByIndex(rowIndex) as DirEntry | undefined)?.path === r.path;
  }

  /** The table never writes a cell: renaming goes through Rust, then the folder reloads. */
  override setValue(): boolean {
    return false;
  }

  /** Used by the name renderer: marked rows show a check mark instead of the icon (as in the old version). */
  isMarkedAt(rowIndex: number): boolean {
    const entry = this.getRowByIndex(rowIndex) as DirEntry | undefined;
    return entry ? this.state.isMarked(entry.path) : false;
  }

  override getCustomClassesAt(rowIndex: number, columnIndex: number): string[] {
    const entry = this.getRowByIndex(rowIndex) as DirEntry | undefined;
    if (!entry) {
      // the core reads `row.selected` without a guard (G13) – never call it for a missing row
      return [];
    }
    const classes = super.getCustomClassesAt(rowIndex, columnIndex);
    if (rowIndex === this.state.cursorRow()) {
      classes.push('fnf-cursor');
    }
    if (this.state.isMarked(entry.path)) {
      classes.push('fnf-marked');
    }
    if (entry.hidden) {
      classes.push('fnf-hidden');
    }
    if (entry.kind === 'symlink') {
      classes.push('fnf-symlink');
    }
    if (entry.kind === 'unknown') {
      classes.push('fnf-unreadable');
    }
    return classes;
  }
}

const NO_STATE: FileRowState = { cursorRow: () => -1, isMarked: () => false };

export interface FileTable {
  readonly model: TableModelIf;
  readonly body: FileBodyModel;
  readonly options: TableOptionsIf;
}

/** Keys re-mapped for a file list (merged per key with the table defaults). */
export const FILE_LIST_SHORTCUTS: ShortcutActionIdMapping = {
  home: 'NAVIGATE_FIRST_CELL',
  end: 'NAVIGATE_LAST_CELL',
};

/**
 * Creates model + options once per panel. A new object would re-create the table.
 * `rowFilter` is read on every filter run (hidden files, quick filter – design 003 E5).
 */
export function createFileTable(
  labelledBy: string,
  rowFilter: () => (row: DirEntry) => boolean = () => () => true,
): FileTable {
  const columnDefs = createFileColumns();
  const body = new FileBodyModel([], columnDefs, NO_STATE);
  const options: TableOptionsIf = {
    ...new TableOptions(),
    defaultRowHeights: { header: HEADER_HEIGHT, body: ROW_HEIGHT, footer: 0 },
    hoverColumnVisible: false,
    hoverRowVisible: true,
    verticalBorderVisible: false,
    horizontalBorderVisible: false,
    headerSeparatorBorderVisible: true,
    getSelectionModel: () => new SelectionModel('none', 'single'),
    shortcutActionIdMapping: { ...FILE_LIST_SHORTCUTS },
    ariaLabelledBy: labelledBy,
    externalFilterFunction: (row: DirEntry) => rowFilter()(row),
    getEditRenderer: () => body.renaming?.editor,
    overlayOptions: {
      noRowsText: 'This folder is empty.',
      loadingText: 'Loading…',
      loadingDelayInMs: 150,
    },
  };
  const model = TableFactory.createTableModel({
    bodyAreaModel: body,
    columnDefs,
    tableOptions: options,
  });
  return { model, body, options };
}
