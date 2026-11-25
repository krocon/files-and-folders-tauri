import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { Modal } from '../../shared/dialog/modal';
import { ColumnsStore } from './columns.store';
import { COLUMNS_TEXTS } from './columns-texts';

const OPTION_ID = 'fnf-cols-option-';

/**
 * "Columns…" (OPEN_COLUMNS_DLG, design 041 E9): the columns of the file list as a list
 * box (APG) – Space shows or hides, Alt+↑/↓ moves. Every change shows in the panels at
 * once; Cancel restores.
 */
@Component({
  selector: 'app-columns-dialog',
  imports: [Modal, DialogKey],
  template: `
    <app-modal [heading]="t.title" width="min(30rem, 92vw)" (closed)="cols.cancel()">
      <div class="tool">
        <p id="fnf-cols-help" class="help">{{ t.help }}</p>
        <div class="cols-body">
          <ul
            class="cols-list"
            role="listbox"
            tabindex="0"
            data-autofocus
            aria-describedby="fnf-cols-help"
            [attr.aria-label]="t.listLabel"
            [attr.aria-activedescendant]="optionId(cols.selected())"
            (keydown)="onKey($event)"
            (click)="onClick($event, false)"
            (dblclick)="onClick($event, true)"
          >
            @for (item of cols.items(); track item.id; let i = $index) {
              <li
                class="cols-item"
                role="option"
                [id]="optionId(i)"
                [class.selected]="i === cols.selected()"
                [attr.aria-selected]="i === cols.selected()"
                [attr.aria-checked]="item.visible"
                [attr.aria-disabled]="item.id === 'name' ? 'true' : null"
                [attr.data-index]="i"
              >
                <i
                  class="fa"
                  aria-hidden="true"
                  data-toggle
                  [class.fa-check-square-o]="item.visible"
                  [class.fa-square-o]="!item.visible"
                ></i>
                <span>{{ t.names[item.id] }}</span>
                @if (item.id === 'name') {
                  <span class="note">{{ t.always }}</span>
                }
              </li>
            }
          </ul>
          <div class="cols-side">
            <button
              appDialogKey="hint:Alt+ArrowUp"
              type="button"
              class="btn"
              [disabled]="!cols.canMove(-1)"
              (click)="cols.moveSelected(-1)"
            >
              {{ t.moveUp }}
            </button>
            <button
              appDialogKey="hint:Alt+ArrowDown"
              type="button"
              class="btn"
              [disabled]="!cols.canMove(1)"
              (click)="cols.moveSelected(1)"
            >
              {{ t.moveDown }}
            </button>
            <button appDialogKey="secondary:D" type="button" class="btn" (click)="cols.defaults()">
              {{ t.defaults }}
            </button>
          </div>
        </div>
        <div class="sr-only" aria-live="polite">{{ cols.announcement() }}</div>
        <div class="foot">
          <span></span>
          <div class="buttons">
            <button appDialogKey="cancel" type="button" class="btn" (click)="cols.cancel()">
              {{ t.cancel }}
            </button>
            <button appDialogKey="primary" type="button" class="btn primary" (click)="cols.apply()">
              {{ t.ok }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './columns-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnsDialog {
  protected readonly t = COLUMNS_TEXTS;
  protected readonly cols = inject(ColumnsStore);

  protected optionId(index: number): string {
    return `${OPTION_ID}${index}`;
  }

  /** A click selects the line; on the box (or a double click) it shows or hides the column. */
  protected onClick(evt: MouseEvent, double: boolean): void {
    const target = evt.target as Element | null;
    const line = target?.closest('[data-index]');
    if (!line) {
      return;
    }
    const index = Number(line.getAttribute('data-index'));
    this.cols.select(index);
    const onBox = !!target?.closest('[data-toggle]');
    if (double ? !onBox : onBox) {
      this.cols.toggleAt(index);
    }
  }

  /** Keys of the list box: the cursor, Space, Alt+↑/↓. Enter and Esc belong to the dialog. */
  protected onKey(evt: KeyboardEvent): void {
    if (evt.ctrlKey || evt.metaKey) {
      return;
    }
    const cols = this.cols;
    const last = cols.items().length - 1;
    if (evt.altKey) {
      if (evt.key === 'ArrowUp') {
        cols.moveSelected(-1);
      } else if (evt.key === 'ArrowDown') {
        cols.moveSelected(1);
      } else {
        return;
      }
    } else if (evt.key === 'ArrowUp') {
      cols.select(cols.selected() - 1);
    } else if (evt.key === 'ArrowDown') {
      cols.select(cols.selected() + 1);
    } else if (evt.key === 'Home') {
      cols.select(0);
    } else if (evt.key === 'End') {
      cols.select(last);
    } else if (evt.key === ' ') {
      cols.toggleAt(cols.selected());
    } else {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
  }
}
