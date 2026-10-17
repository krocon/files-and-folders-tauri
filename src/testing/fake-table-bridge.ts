import type { TableStateIf, TableStatePart } from '@guiexpert/table';
import { DirEntry } from '../app/core/fs/fs.models';
import { TableBridge } from '../app/features/browser/file-list/table-bridge';

/**
 * In-memory TableBridge: keeps rows in a display order given by an optional
 * sort function, records calls. Mirrors what the real table does that
 * matters to the controller (focus index survives setRows, clamped).
 */
export class FakeTableBridge implements TableBridge {
  rows: DirEntry[] = [];
  focus = -1;
  calls: string[] = [];
  announcements: string[] = [];
  sortFn: ((a: DirEntry, b: DirEntry) => number) | null = null;

  setRows(rows: readonly DirEntry[]): void {
    this.calls.push(`setRows(${rows.length})`);
    this.all = [...rows];
    const kept = this.all.filter(this.filter);
    this.rows = this.sortFn ? kept.sort(this.sortFn) : kept;
  }

  /** Rows hidden by the external filter (set by tests). */
  filter: (r: DirEntry) => boolean = () => true;
  private all: DirEntry[] = [];

  filterChanged(): void {
    this.calls.push('filterChanged');
    this.rows = this.all.filter(this.filter);
    if (this.sortFn) {
      this.rows.sort(this.sortFn);
    }
  }

  /** Simulates a header sort: order changes, focus index stays. */
  sort(fn: (a: DirEntry, b: DirEntry) => number): void {
    this.sortFn = fn;
    this.rows = [...this.rows].sort(fn);
  }

  displayedRows(): readonly DirEntry[] {
    return this.rows;
  }

  focusedRow(): number {
    return this.focus;
  }

  setFocusedRow(index: number): void {
    this.calls.push(`setFocusedRow(${index})`);
    this.focus = index;
  }

  repaint(): void {
    this.calls.push('repaint');
  }

  announce(text: string): void {
    this.announcements.push(text);
  }

  /** What `getTableState` returns; `applyTableState` records and merges into it. */
  tableState: Partial<TableStateIf> = { version: 1 };

  getTableState(): Partial<TableStateIf> {
    return structuredClone(this.tableState);
  }

  applyTableState(state: Partial<TableStateIf>, parts: readonly TableStatePart[]): void {
    const wanted = parts.filter((p) => p in state);
    if (wanted.length === 0) {
      return;
    }
    this.calls.push(`applyTableState(${wanted.join(',')})`);
    this.tableState = { ...this.tableState, ...structuredClone(state) };
  }

  /** The open in-place rename: `finish` simulates Enter (a name) or Escape (null). */
  rename: { path: string; selectEnd: number; finish: (value: string | null) => void } | null = null;
  canEdit = true;

  startRename(path: string, selectEnd: number, done: (value: string | null) => void): boolean {
    if (!this.canEdit || !this.rows.some((r) => r.path === path)) {
      return false;
    }
    this.rename = {
      path,
      selectEnd,
      finish: (value) => {
        this.rename = null;
        done(value);
      },
    };
    return true;
  }
}
