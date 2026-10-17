import { TableApi, TableStateIf, TableStatePart } from '@guiexpert/table';
import { DirEntry } from '../../../core/fs/fs.models';
import { FileBodyModel } from './file-table-model';
import { RenameEditor } from './rename-editor';

/**
 * The few table operations the file list needs. Hides the GuiExpert API
 * (and its workarounds, see design 001 §3) behind a small interface that can
 * be faked in unit tests – jsdom has no layout, the real table is tested
 * end-to-end.
 */
export interface TableBridge {
  /** Replaces the rows, re-applies filter and sort and repaints. */
  setRows(rows: readonly DirEntry[]): void;
  /** The external row filter changed (hidden files, quick filter). */
  filterChanged(): void;
  /** Rows in display order (sorted/filtered). */
  displayedRows(): readonly DirEntry[];
  /** Displayed index of the focused row, -1 if none. */
  focusedRow(): number;
  /** Moves the focus (cursor) to a displayed row and scrolls it into view. */
  setFocusedRow(index: number): void;
  repaint(): void;
  announce(text: string): void;
  /** Shows or hides a column (the folder column of a result tab, design 009). */
  setColumnVisible(property: string, visible: boolean): void;
  /** An own "no rows" text over the empty list (result tab), `null` = the table's default. */
  setEmptyText(text: string | null): void;
  /** Column layout, sort and scroll position (per tab, design 004 E2). */
  getTableState(): Partial<TableStateIf>;
  /** Applies parts of a saved table state (sort also re-sorts the rows). */
  applyTableState(state: Partial<TableStateIf>, parts: readonly TableStatePart[]): void;
  /**
   * Opens the in-place editor on the name of `path` (design 006 E3); `selectEnd`
   * = selected part of the name. `done` gets the typed name, or null if cancelled.
   * False if the entry is not displayed or the table cannot edit now.
   */
  startRename(path: string, selectEnd: number, done: (value: string | null) => void): boolean;
  /** Displayed index of the body row containing `element` (drag and drop), -1 if none. */
  rowIndexAt(element: Element): number;
}

/** The parts of the table state that belong to a tab. */
export const TAB_TABLE_PARTS: readonly TableStatePart[] = ['columns', 'sort', 'scroll'];

export function createTableBridge(api: TableApi, body: FileBodyModel): TableBridge {
  const scope = api.getTableScope();
  let manualOverlay = false;
  const stopRename = () => {
    body.renaming?.editor.cancel();
  };
  return {
    setRows(rows) {
      // a reload under the F2 editor (e.g. a background copy into this folder): close it
      // while the rows change, then reopen it with the typed text if the entry is still there
      const renaming = body.renaming;
      if (renaming) {
        body.renaming = null;
        api.stopEditing(true);
      }
      api.setRows([...rows]);
      api.externalFilterChanged();
      // setRows resets the order (G4) – re-apply the sort of the header
      api.reSort();
      api.repaintHard();
      if (renaming) {
        const index = body.getFilteredRows().findIndex((r) => r.path === renaming.path);
        body.renaming = renaming;
        if (index < 0 || !api.startEditing(index, 'name')) {
          renaming.editor.cancel();
        }
      }
    },
    filterChanged() {
      api.externalFilterChanged();
      api.reSort();
      api.repaintHard();
    },
    displayedRows: () => body.getFilteredRows(),
    setEmptyText(text) {
      if (text !== null) {
        api.showNoRowsOverlay(text);
        manualOverlay = true;
      } else if (manualOverlay) {
        api.hideOverlay();
        manualOverlay = false;
      }
    },
    setColumnVisible(property, visible) {
      if (api.isColumnVisible(property) !== visible) {
        api.setColumnVisible(property, visible);
      }
    },
    focusedRow() {
      const focus = scope.focusModel()?.getFocus();
      return focus ? focus[0] : -1;
    },
    setFocusedRow(index) {
      // no public setFocus on TableApi (G1)
      scope.focusModel()?.setFocus(index, 0);
      api.ensureRowIsVisible(index);
      api.repaint();
    },
    repaint: () => api.repaint(),
    announce: (text) => api.announce(text),
    getTableState: () => api.getState([...TAB_TABLE_PARTS]),
    startRename(path, selectEnd, done) {
      stopRename();
      const rows = body.getFilteredRows();
      const index = rows.findIndex((r) => r.path === path);
      if (index < 0) {
        return false;
      }
      const editor = new RenameEditor(rows[index].name, selectEnd, (value) => {
        if (body.renaming?.editor === editor) {
          body.renaming = null;
          api.stopEditing(true); // closes the cell editor, focus back to the table
        }
        done(value);
      });
      body.renaming = { path, editor };
      if (!api.startEditing(index, 'name')) {
        body.renaming = null;
        return false;
      }
      return true;
    },
    rowIndexAt(element) {
      // TODO(guiexpert): no "row at point" API (G18): body cells carry data-area="body" and the displayed row index
      const cell = element.closest('[data-area="body"][data-row-index]');
      if (!cell || !scope.hostElement.contains(cell)) {
        return -1;
      }
      const index = Number(cell.getAttribute('data-row-index'));
      return Number.isInteger(index) && index >= 0 && index < body.getFilteredRows().length
        ? index
        : -1;
    },
    applyTableState(state, parts) {
      const wanted = parts.filter((p) => p in state);
      if (wanted.length === 0) {
        return;
      }
      api.applyState(state, wanted);
      if (wanted.includes('sort')) {
        // applyState sets the sort icons; the rows follow with reSort (as after setRows, G4)
        api.reSort();
        api.repaintHard();
      }
    },
  };
}

/**
 * Removes default bindings that clash with file-manager keys
 * (Ctrl/⌘+X = DESELECT_ALL in the table, later "cut"). The mapping cannot be
 * unbound through options (G5), but the live object can be changed.
 */
export function removeConflictingShortcuts(api: TableApi): void {
  const mapping = api.getShortcutActionMapping() as Record<string, string>;
  for (const key of Object.keys(mapping)) {
    const isCut = /(^|[+ ])x$/.test(key) && /(ctrl|meta|cmd)/.test(key);
    if (isCut && mapping[key] === 'DESELECT_ALL') {
      delete mapping[key];
    }
  }
}
