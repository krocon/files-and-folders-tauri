import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ACTION_IDS, ACTIONS, ActionId, CATEGORY_LABELS } from '../../core/actions/action-catalog';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { fuzzyMatch } from './fuzzy';

interface Row {
  readonly id: ActionId;
  readonly label: string;
  readonly category: string;
  readonly shortcut: string;
  readonly ready: boolean;
  readonly hint: string;
  readonly score: number;
  /** Label split into highlighted / plain parts. */
  readonly parts: readonly { readonly text: string; readonly hit: boolean }[];
}

const MAX_ROWS = 50;

/**
 * "Go to anything" (Mod+Shift+P) and "Call action" (F10): all actions, fuzzy
 * search, shortcut on the right. APG combobox with listbox; Enter runs, Esc
 * closes and returns the focus. Favourites/history join in prompt 003, tools in 011.
 */
@Component({
  selector: 'app-command-palette',
  imports: [Modal],
  template: `
    <app-modal [heading]="heading()" width="40rem" (closed)="dialogs.close()">
      <input
        data-autofocus
        class="query"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="rows().length ? optionId(active()) : null"
        placeholder="Type to search actions…"
        spellcheck="false"
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
      />
      <ul class="list" role="listbox" [id]="listId" aria-label="Actions">
        @for (row of rows(); track row.id; let i = $index) {
          <li
            role="option"
            [id]="optionId(i)"
            [class.active]="i === active()"
            [class.unavailable]="!row.ready"
            [attr.aria-selected]="i === active()"
            [attr.aria-disabled]="row.ready ? null : 'true'"
            [attr.data-index]="i"
          >
            <span class="label">
              @for (p of row.parts; track $index) {
                <span [class.hit]="p.hit">{{ p.text }}</span>
              }
            </span>
            <span class="meta">
              @if (row.hint) {
                <span class="hint">{{ row.hint }}</span>
              } @else {
                <span class="cat">{{ row.category }}</span>
              }
              @if (row.shortcut) {
                <kbd>{{ row.shortcut }}</kbd>
              }
            </span>
          </li>
        } @empty {
          <li class="empty" role="option" aria-selected="false" aria-disabled="true">
            No matching action
          </li>
        }
      </ul>
    </app-modal>
  `,
  styleUrl: './command-palette.scss',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(click)': 'onClick($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPalette {
  readonly heading = input('Go to anything');
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly listId = 'fnf-palette-list';
  protected readonly query = signal('');
  protected readonly active = signal(0);

  protected readonly rows = computed<Row[]>(() => {
    const q = this.query();
    const rows: Row[] = [];
    for (const id of ACTION_IDS) {
      if (id === 'OPEN_COMMAND_PALETTE' || id === 'OPEN_CALL_ACTION_DLG') {
        continue;
      }
      const meta = ACTIONS[id];
      const match = fuzzyMatch(q, meta.label);
      if (!match) {
        continue;
      }
      const state = this.actions.state(id);
      rows.push({
        id,
        label: meta.label,
        category: CATEGORY_LABELS[meta.category],
        shortcut: this.actions.shortcutLabel(id),
        ready: state === 'ready',
        hint: state === 'unavailable' ? `prompt ${meta.availableIn}` : '',
        score: match.score + (state === 'unavailable' ? -100 : 0),
        parts: split(meta.label, match.positions),
      });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, MAX_ROWS);
  });

  /** Keep the focus in the input when an option is clicked. */
  protected onPointerDown(evt: PointerEvent): void {
    if ((evt.target as Element | null)?.closest?.('[role="option"]')) {
      evt.preventDefault();
    }
  }

  protected onClick(evt: MouseEvent): void {
    const option = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-index]');
    if (option) {
      this.choose(Number(option.dataset['index']));
    }
  }

  protected optionId(i: number): string {
    return `${this.listId}-${i}`;
  }

  protected onInput(evt: Event): void {
    this.query.set((evt.target as HTMLInputElement).value);
    this.active.set(0);
  }

  protected onKeydown(evt: KeyboardEvent): void {
    const n = this.rows().length;
    switch (evt.key) {
      case 'ArrowDown':
        this.move(n ? (this.active() + 1) % n : 0);
        break;
      case 'ArrowUp':
        this.move(n ? (this.active() - 1 + n) % n : 0);
        break;
      case 'PageDown':
        this.move(Math.min(n - 1, this.active() + 8));
        break;
      case 'PageUp':
        this.move(Math.max(0, this.active() - 8));
        break;
      case 'Enter':
        this.choose(this.active());
        break;
      default:
        return;
    }
    evt.preventDefault();
  }

  protected choose(i: number): void {
    const row = this.rows()[i];
    if (!row) {
      return;
    }
    this.dialogs.close();
    // after the dialog is gone, so a dialog opened by the action is not closed again
    setTimeout(() => void this.actions.run(row.id));
  }

  private move(i: number): void {
    this.active.set(Math.max(0, i));
    setTimeout(() =>
      document.getElementById(this.optionId(this.active()))?.scrollIntoView?.({ block: 'nearest' }),
    );
  }
}

function split(text: string, positions: readonly number[]): { text: string; hit: boolean }[] {
  const hits = new Set(positions);
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = parts.at(-1);
    if (last && last.hit === hit) {
      last.text += text[i];
    } else {
      parts.push({ text: text[i], hit });
    }
  }
  return parts;
}
