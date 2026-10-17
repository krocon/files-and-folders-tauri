import type { TableStateIf } from '@guiexpert/table';
import { stemLength } from '../../ops/ops-logic';
import { DirEntry, isNavigableDir, isParentRow } from '../../../core/fs/fs.models';
import { FileBrowserStore } from '../file-browser.store';
import { TableBridge } from './table-bridge';

/** Callbacks into the surrounding panel. */
export interface FileListHooks {
  /** Strg/⌘+Enter on a folder. */
  openInNewTab?(entry: DirEntry): void;
}

/** The store API the controller uses (keeps tests independent of Angular DI). */
export type FileListStore = Pick<
  FileBrowserStore,
  | 'cursorPath'
  | 'setCursor'
  | 'open'
  | 'up'
  | 'toggleMark'
  | 'setMarked'
  | 'markRange'
  | 'markAll'
  | 'clearMarks'
  | 'invertMarks'
  | 'isMarked'
>;

export interface ClickInput {
  area: 'header' | 'body' | 'footer' | undefined;
  rowIndex: number;
  clickCount: number;
  shiftKey: boolean;
  /** Ctrl (Windows/Linux) or ⌘ (macOS). */
  toggleKey: boolean;
}

/**
 * Behaviour of one file list, independent of Angular and of the real table
 * (talks to a {@link TableBridge}). The store is the source of truth for
 * cursor and marks; the table owns the display order.
 *
 * Keys reach it as actions (prompt 002: `ActionService` → `FilePanel`); the
 * methods here are what those actions do.
 */
export const TYPE_AHEAD_RESET_MS = 1500;

/** Case- and accent-insensitive form for type-ahead (`Ä` → `a`). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export class FileListController {
  /** Cursor before the latest focus change – anchor for Shift+click. */
  private previousCursor: string | null = null;

  constructor(
    private readonly bridge: TableBridge,
    private readonly store: FileListStore,
    private readonly hooks: FileListHooks = {},
  ) {}

  /**
   * New listing: rows to the table, cursor to the wanted entry (or the first row).
   * `tableState` (tab switch): columns and sort before the cursor, scroll last –
   * so the saved scroll position wins over "scroll the cursor into view".
   */
  showRows(rows: readonly DirEntry[], label?: string, tableState?: Partial<TableStateIf>): void {
    this.bridge.setRows(rows);
    if (tableState) {
      this.bridge.applyTableState(tableState, ['columns', 'sort']);
    }
    this.restoreCursor();
    if (tableState) {
      this.bridge.applyTableState(tableState, ['scroll']);
    }
    if (label !== undefined) {
      const n = rows.length;
      this.bridge.announce(`${label}, ${n} ${n === 1 ? 'entry' : 'entries'}`);
    }
  }

  /** Puts the table focus back on `store.cursorPath` (e.g. after sorting). */
  restoreCursor(): void {
    const rows = this.bridge.displayedRows();
    if (rows.length === 0) {
      return;
    }
    const wanted = this.store.cursorPath();
    const index = wanted === null ? -1 : rows.findIndex((r) => r.path === wanted);
    const target = index >= 0 ? index : 0;
    this.bridge.setFocusedRow(target);
    this.store.setCursor(rows[target].path);
  }

  /** Table → store: the focus moved (keyboard or mouse). */
  onFocusChanged(rowIndex: number): void {
    const row = this.bridge.displayedRows()[rowIndex];
    // the table also reports focus changes we made ourselves – only real moves count
    if (!row || row.path === this.store.cursorPath()) {
      return;
    }
    this.previousCursor = this.store.cursorPath();
    this.store.setCursor(row.path);
  }

  onClick(click: ClickInput): void {
    if (click.area !== 'body') {
      return;
    }
    const row = this.bridge.displayedRows()[click.rowIndex];
    if (!row) {
      return;
    }
    if (click.clickCount >= 2) {
      void this.store.open(row);
      return;
    }
    if (click.toggleKey) {
      this.store.toggleMark(row.path);
    } else if (click.shiftKey && this.previousCursor !== null) {
      this.store.markRange(this.previousCursor, row.path, this.displayedPaths());
    }
  }

  openCursor(): boolean {
    const row = this.cursorRow();
    if (!row) {
      return false;
    }
    void this.store.open(row);
    return true;
  }

  /** Strg/⌘+Enter: open the folder under the cursor in a new tab. */
  openCursorInNewTab(): boolean {
    const row = this.cursorRow();
    if (!row || !isNavigableDir(row) || row.lossyName || !this.hooks.openInNewTab) {
      return false;
    }
    this.hooks.openInNewTab(row);
    return true;
  }

  /** Space/Insert: toggle the mark of the cursor entry and move down (Total Commander). */
  toggleMarkAndAdvance(): void {
    const row = this.cursorRow();
    if (!row) {
      return;
    }
    this.store.toggleMark(row.path);
    this.move(1);
  }

  /** Shift+Pos1/Ende: mark from the cursor to the first/last entry and move there. */
  markToEdge(edge: 'start' | 'end'): void {
    const rows = this.bridge.displayedRows();
    const current = this.bridge.focusedRow();
    if (rows.length === 0 || current < 0) {
      return;
    }
    const target = edge === 'start' ? 0 : rows.length - 1;
    const [from, to] = current <= target ? [current, target] : [target, current];
    this.store.setMarked(
      rows.slice(from, to + 1).map((r) => r.path),
      true,
    );
    this.bridge.setFocusedRow(target);
    this.onFocusChanged(target);
    this.bridge.repaint();
  }

  markAll(): void {
    this.store.markAll(this.displayedPaths());
    this.bridge.repaint();
  }

  clearMarks(): void {
    this.store.clearMarks();
    this.bridge.repaint();
  }

  invertMarks(): void {
    this.store.invertMarks(this.displayedPaths());
    this.bridge.repaint();
  }

  /** Marks (or unmarks) every displayed entry whose name matches. Returns the number of matches. */
  markMatching(matches: (name: string) => boolean, mark: boolean): number {
    const paths = this.bridge
      .displayedRows()
      .filter((r) => matches(r.name))
      .map((r) => r.path);
    this.store.setMarked(paths, mark);
    this.bridge.repaint();
    return paths.length;
  }

  displayedEntries(): readonly DirEntry[] {
    return this.bridge.displayedRows();
  }

  cursorEntry(): DirEntry | undefined {
    return this.cursorRow();
  }

  /** Moves the cursor to `path` (viewer ←/→, design 010 E8); false if it is not displayed. */
  moveCursorTo(path: string): boolean {
    const index = this.bridge.displayedRows().findIndex((r) => r.path === path);
    if (index < 0) {
      return false;
    }
    this.bridge.setFocusedRow(index);
    this.onFocusChanged(index);
    return true;
  }

  /**
   * F2: edit the name of `entry` in place, the name without extension selected
   * (design 006 E3). False if the list cannot edit it now (the caller opens the dialog).
   */
  startRename(entry: DirEntry, done: (value: string | null) => void): boolean {
    return this.bridge.startRename(
      entry.path,
      stemLength(entry.name, entry.kind === 'directory'),
      done,
    );
  }

  /** Shift+↑/↓: mark the cursor entry and move. */
  markAndMove(delta: number): void {
    const row = this.cursorRow();
    if (!row) {
      return;
    }
    this.store.setMarked([row.path], true);
    this.move(delta);
  }

  private move(delta: number): void {
    const rows = this.bridge.displayedRows();
    const current = this.bridge.focusedRow();
    const next = Math.min(rows.length - 1, Math.max(0, current + delta));
    if (next !== current) {
      this.bridge.setFocusedRow(next);
      this.onFocusChanged(next);
    } else {
      this.bridge.repaint();
    }
  }

  private cursorRow(): DirEntry | undefined {
    return this.bridge.displayedRows()[this.bridge.focusedRow()];
  }

  private displayedPaths(): string[] {
    return this.bridge
      .displayedRows()
      .filter((r) => !isParentRow(r))
      .map((r) => r.path);
  }

  // ---- type-ahead (design 003 E6) ----

  private typed = '';
  private typedAt = 0;

  /**
   * A printable character typed in the list: extends the prefix (reset after
   * {@link TYPE_AHEAD_RESET_MS}) and moves the cursor to the first entry starting
   * with it (accent- and case-insensitive), otherwise to the first containing it.
   * Returns the name found, or null.
   */
  typeAhead(char: string, now = Date.now()): string | null {
    this.typed = now - this.typedAt > TYPE_AHEAD_RESET_MS ? char : this.typed + char;
    this.typedAt = now;
    const needle = fold(this.typed);
    const rows = this.bridge.displayedRows();
    let index = rows.findIndex((r) => !isParentRow(r) && fold(r.name).startsWith(needle));
    if (index < 0) {
      index = rows.findIndex((r) => !isParentRow(r) && fold(r.name).includes(needle));
    }
    if (index < 0) {
      return null;
    }
    this.bridge.setFocusedRow(index);
    this.onFocusChanged(index);
    return rows[index].name;
  }

  resetTypeAhead(): void {
    this.typed = '';
    this.typedAt = 0;
  }
}
