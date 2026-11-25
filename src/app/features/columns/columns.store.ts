import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import {
  allColumnsInOrder,
  DEFAULT_COLUMNS,
  moveItem,
  sanitizeColumns,
  toggleColumn,
  UserColumn,
} from '../browser/file-list/column-layout';
import { COLUMNS_TEXTS } from './columns-texts';

/** Menu id of a column's check entry (design 041 E8). */
export const COLUMN_CHOICE_PREFIX = 'column:';

/** A line of the column dialog. */
export interface ColumnItem {
  readonly id: UserColumn;
  readonly visible: boolean;
}

/**
 * The columns of the file list (design 041 E1, root): the choice is the setting
 * `view.columns` – both panels and every tab follow it at once. The dialog works on the
 * setting itself (a live preview); Cancel puts back what was there when it opened.
 */
@Injectable({ providedIn: 'root' })
export class ColumnsStore {
  private readonly settings = inject(SettingsStore);
  private readonly dialogs = inject(DialogService);
  private readonly actions = inject(ActionService);

  /** The shown columns in their order. */
  readonly chosen = computed(() => sanitizeColumns(this.settings.get('view.columns')));

  /** Order of the dialog: the hidden columns keep their place while it is open. */
  private readonly order = signal<readonly UserColumn[]>(allColumnsInOrder(DEFAULT_COLUMNS));
  readonly items = computed<readonly ColumnItem[]>(() => {
    const chosen = this.chosen();
    return this.order().map((id) => ({ id, visible: chosen.includes(id) }));
  });
  /** The line with the cursor. */
  readonly selected = signal(0);
  /** What the last change did (live region). */
  readonly announcement = signal('');
  private before: readonly UserColumn[] | null = null;

  constructor() {
    // the check entries of the menus (header menu, View → Columns)
    effect(() => {
      const chosen = this.chosen();
      const names = COLUMNS_TEXTS.names;
      const choices = allColumnsInOrder(chosen)
        .filter((id) => id !== 'name')
        .map((id) => ({
          id: `${COLUMN_CHOICE_PREFIX}${id}`,
          label: names[id],
          checked: chosen.includes(id),
          run: () => this.toggle(id),
        }));
      untracked(() => this.actions.columnChoices.set(choices));
    });
  }

  private write(columns: readonly UserColumn[]): void {
    this.settings.set('view.columns', [...columns]);
  }

  /** Shows or hides a column (menus). */
  toggle(column: UserColumn): void {
    this.write(toggleColumn(this.chosen(), column));
  }

  open(): void {
    this.before = this.chosen();
    this.order.set(allColumnsInOrder(this.chosen()));
    this.selected.set(0);
    this.announcement.set('');
    this.dialogs.show('columns');
  }

  select(index: number): void {
    this.selected.set(Math.max(0, Math.min(this.order().length - 1, index)));
  }

  /** Space on a line: show or hide it (the name stays). */
  toggleAt(index: number): void {
    const item = this.items()[index];
    if (!item || item.id === 'name') {
      return;
    }
    const order = this.order();
    this.write(order.filter((id) => (id === item.id ? !item.visible : this.chosen().includes(id))));
    const name = COLUMNS_TEXTS.names[item.id];
    this.announcement.set(item.visible ? COLUMNS_TEXTS.hidden(name) : COLUMNS_TEXTS.shown(name));
  }

  canMove(delta: number): boolean {
    const to = this.selected() + delta;
    return to >= 0 && to < this.order().length;
  }

  /** Alt+↑/↓: moves the selected line; the columns follow at once. */
  moveSelected(delta: number): void {
    if (!this.canMove(delta)) {
      return;
    }
    const from = this.selected();
    const order = moveItem(this.order(), from, delta);
    const chosen = this.chosen();
    this.order.set(order);
    this.selected.set(from + delta);
    this.write(order.filter((id) => chosen.includes(id)));
    this.announcement.set(
      COLUMNS_TEXTS.moved(COLUMNS_TEXTS.names[order[from + delta]], from + delta + 1, order.length),
    );
  }

  /** Back to name, extension, size, modified. */
  defaults(): void {
    this.write(DEFAULT_COLUMNS);
    this.order.set(allColumnsInOrder(DEFAULT_COLUMNS));
    this.selected.set(0);
  }

  /** OK: what the preview shows stays. */
  apply(): void {
    this.before = null;
    this.dialogs.close();
  }

  /** Esc / Cancel: the columns as they were when the dialog opened. */
  cancel(): void {
    if (this.before) {
      this.write(this.before);
      this.before = null;
    }
    this.dialogs.close();
  }
}
