import { untracked } from '@angular/core';
import {
  AreaModelObjectArrayWithColumndefs,
  ColumnDefIf,
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
import { TEXTS } from '../../workspace/texts';

export const ROW_HEIGHT = 30;
export const HEADER_HEIGHT = 30;

/** What the body model needs to know to style rows (read at render time). */
export interface FileRowState {
  /** Displayed row index of the cursor (table focus), -1 if none. */
  cursorRow(): number;
  isMarked(path: string): boolean;
  /** The folder row a drag would drop into (design 012 E5). */
  isDropTarget?(path: string): boolean;
  /** The folder's size is currently being calculated and > 2s elapsed. */
  isCalculatingSize?(path: string): boolean;
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

  isCalculatingSize(path: string): boolean {
    return this.state.isCalculatingSize?.(path) ?? false;
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

  /**
   * Replaces rows by path without touching order or filter (watcher updates of
   * sizes/times, review 012 #5). `visible`: one of them is displayed now.
   */
  replaceRows(changed: readonly DirEntry[]): { found: number; visible: boolean } {
    const byPath = new Map(changed.map((e) => [e.path, e]));
    let found = 0;
    let visible = false;
    for (let i = 0; i < this.rows.length; i++) {
      const next = byPath.get(this.rows[i].path);
      if (next) {
        this.rows[i] = next;
        found++;
      }
    }
    for (let i = 0; i < this.filteredRows.length; i++) {
      const next = byPath.get(this.filteredRows[i].path);
      if (next) {
        this.filteredRows[i] = next;
        visible = true;
      }
    }
    return { found, visible };
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
    if (this.state.isDropTarget?.(entry.path)) {
      classes.push('fnf-drop-target');
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
    // duplicate tab: every other group shaded (design 016 E6)
    const group = (entry as DirEntry & { group?: number }).group;
    if (group !== undefined && group % 2 === 0) {
      classes.push('fnf-group-alt');
    }
    return classes;
  }
}

const NO_STATE: FileRowState = { cursorRow: () => -1, isMarked: () => false };

export interface FileTable {
  readonly model: TableModelIf;
  readonly columnDefs: readonly ColumnDefIf[];
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
  // reads translated texts: untracked, so a language switch never re-creates the table
  // inside a computed (design 015) – titles and texts change in place
  return untracked(() => createUntracked(labelledBy, rowFilter));
}

function createUntracked(
  labelledBy: string,
  rowFilter: () => (row: DirEntry) => boolean,
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
    headerSeparatorBorderVisible: false,
    getSelectionModel: () => new SelectionModel('none', 'single'),
    shortcutActionIdMapping: { ...FILE_LIST_SHORTCUTS },
    ariaLabelledBy: labelledBy,
    externalFilterFunction: (row: DirEntry) => rowFilter()(row),
    getEditRenderer: () => body.renaming?.editor,
    overlayOptions: {
      noRowsText: TEXTS.emptyFolder,
      // TODO(guiexpert): overlay texts are copied at creation – the loading text keeps
      // the start language (the empty text is drawn by us, see FileList.applyEmptyText)
      loadingText: TEXTS.loading,
      loadingDelayInMs: 150,
      // the old list stays usable while the next folder loads (design 029 E3)
      blockInteractionWhileLoading: false,
    },
  };
  const model = TableFactory.createTableModel({
    bodyAreaModel: body,
    columnDefs,
    tableOptions: options,
  });
  return { model, columnDefs, body, options };
}
