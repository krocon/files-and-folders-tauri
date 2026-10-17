import { TableApi } from '@guiexpert/table';
import { DirEntry } from '../../../core/fs/fs.models';
import { FileBodyModel } from './file-table-model';

/**
 * The few table operations the file list needs. Hides the GuiExpert API
 * (and its workarounds, see design 001 §3) behind a small interface that can
 * be faked in unit tests – jsdom has no layout, the real table is tested
 * end-to-end.
 */
export interface TableBridge {
  /** Replaces the rows, re-applies the current sort and repaints. */
  setRows(rows: readonly DirEntry[]): void;
  /** Rows in display order (sorted/filtered). */
  displayedRows(): readonly DirEntry[];
  /** Displayed index of the focused row, -1 if none. */
  focusedRow(): number;
  /** Moves the focus (cursor) to a displayed row and scrolls it into view. */
  setFocusedRow(index: number): void;
  repaint(): void;
  announce(text: string): void;
}

export function createTableBridge(api: TableApi, body: FileBodyModel): TableBridge {
  const scope = api.getTableScope();
  return {
    setRows(rows) {
      api.setRows([...rows]);
      // setRows resets the order (G4) – re-apply the sort of the header
      api.reSort();
      api.repaintHard();
    },
    displayedRows: () => body.getFilteredRows(),
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
