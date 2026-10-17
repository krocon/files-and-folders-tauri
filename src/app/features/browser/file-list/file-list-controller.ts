import { DirEntry } from '../../../core/fs/fs.models';
import { FileBrowserStore } from '../file-browser.store';
import { TableBridge } from './table-bridge';

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
  | 'isMarked'
>;

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

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
 * Interim keyboard handling for prompt 001 – moves into the action system in
 * prompt 002.
 */
export class FileListController {
  /** Cursor before the latest focus change – anchor for Shift+click. */
  private previousCursor: string | null = null;

  constructor(
    private readonly bridge: TableBridge,
    private readonly store: FileListStore,
  ) {}

  /** New listing: rows to the table, cursor to the wanted entry (or the first row). */
  showRows(rows: readonly DirEntry[], label?: string): void {
    this.bridge.setRows(rows);
    this.restoreCursor();
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

  /** Keys the table does not consume (they bubble to the list). Returns true if handled. */
  onKey(key: KeyInput): boolean {
    const plain = !key.ctrlKey && !key.metaKey && !key.altKey;
    switch (key.key) {
      case 'Enter':
        if (plain && !key.shiftKey) {
          return this.openCursor();
        }
        return false;
      case 'Backspace':
        if (plain && !key.shiftKey) {
          void this.store.up();
          return true;
        }
        return false;
      case 'Insert':
        if (plain) {
          this.toggleMarkAndAdvance();
          return true;
        }
        return false;
      case 'ArrowDown':
      case 'ArrowUp':
        if (plain && key.shiftKey) {
          this.markAndMove(key.key === 'ArrowDown' ? 1 : -1);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  /** Table actions (keys the table maps itself). Returns true if consumed. */
  onAction(actionId: string): boolean {
    switch (actionId) {
      case 'TOGGLE_SELECTION':
        this.toggleMarkAndAdvance();
        return true;
      case 'SELECT_ALL':
        this.store.markAll(this.displayedPaths());
        this.bridge.repaint();
        return true;
      case 'DESELECT_ALL':
        this.store.clearMarks();
        this.bridge.repaint();
        return true;
      default:
        return false;
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

  /** Space/Insert: toggle the mark of the cursor entry and move down (Total Commander). */
  toggleMarkAndAdvance(): void {
    const row = this.cursorRow();
    if (!row) {
      return;
    }
    this.store.toggleMark(row.path);
    this.move(1);
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
    return this.bridge.displayedRows().map((r) => r.path);
  }
}
