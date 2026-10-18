import { ACT_TEXTS } from './actions-texts';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ACTION_IDS, ACTIONS, ActionId, CATEGORY_LABELS } from '../../core/actions/action-catalog';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { ThemeService } from '../../core/theme/theme.service';
import { THEME_TEXTS } from '../themes/theme-texts';
import { fuzzyMatch } from './fuzzy';

interface Row {
  readonly key: string;
  /** What `id` names: an `ActionId`, an extra action (tool, design 011 E4) or a colour scheme (013 E3). */
  readonly kind: 'action' | 'extra' | 'theme';
  readonly id: string;
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
const TOOLS_CATEGORY = 'Tools';

/**
 * "Go to anything" (Mod+Shift+P) and "Call action" (F10): all actions, fuzzy
 * search, shortcut on the right. APG combobox with listbox; Enter runs, Esc
 * closes and returns the focus. Tools (design 011 E4) are listed too; `scope="tools"`
 * lists only them ("Open with tool…").
 */
@Component({
  selector: 'app-command-palette',
  imports: [Modal],
  template: `
    <app-modal [heading]="heading() ?? t.goToAnything" width="40rem" (closed)="dialogs.close()">
      <input
        data-autofocus
        class="query"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="rows().length ? optionId(active()) : null"
        [placeholder]="scope() === 'tools' ? t.searchTools : t.searchActions"
        spellcheck="false"
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
      />
      <ul class="list" role="listbox" [id]="listId" [attr.aria-label]="t.actions">
        @for (row of rows(); track row.key; let i = $index) {
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
            {{ scope() === 'tools' ? t.noTool : t.noAction }}
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
  protected readonly t = ACT_TEXTS;
  /** `null`: the palette's own heading (follows the language). */
  readonly heading = input<string | null>(null);
  readonly scope = input<'all' | 'tools'>('all');
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  private readonly theme = inject(ThemeService);
  protected readonly listId = 'fnf-palette-list';
  protected readonly query = signal('');
  protected readonly active = signal(0);

  protected readonly rows = computed<Row[]>(() => {
    const q = this.query();
    const rows: Row[] = [];
    const ids = this.scope() === 'tools' ? [] : ACTION_IDS;
    for (const id of ids) {
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
        key: id,
        id,
        kind: 'action',
        label: meta.label,
        category: CATEGORY_LABELS[meta.category],
        shortcut: this.actions.shortcutLabel(id),
        ready: state === 'ready',
        hint: state === 'unavailable' ? `prompt ${meta.availableIn}` : '',
        score: match.score + (state === 'unavailable' ? -100 : 0),
        parts: split(meta.label, match.positions),
      });
    }
    for (const x of this.actions.extras()) {
      const match = fuzzyMatch(q, x.label);
      if (!match) {
        continue;
      }
      rows.push({
        key: `extra:${x.id}`,
        kind: 'extra',
        id: x.id,
        label: x.label,
        category: TOOLS_CATEGORY,
        shortcut: this.actions.extraShortcutLabel(x.id),
        ready: x.enabled(),
        hint: '',
        score: match.score,
        parts: split(x.label, match.positions),
      });
    }
    const themes = this.scope() === 'tools' ? [] : this.theme.themes();
    for (const t of themes) {
      const label = THEME_TEXTS.paletteEntry(t.name);
      const match = fuzzyMatch(q, label);
      if (!match) {
        continue;
      }
      rows.push({
        key: `theme:${t.id}`,
        kind: 'theme',
        id: t.id,
        label,
        category: CATEGORY_LABELS.config,
        shortcut: '',
        ready: true,
        hint: '',
        score: match.score - 1,
        parts: split(label, match.positions),
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
    const { kind, id } = row;
    setTimeout(() => {
      if (kind === 'theme') {
        void this.theme.select(id);
      } else if (kind === 'extra') {
        void this.actions.runExtra(id);
      } else {
        void this.actions.run(id as ActionId);
      }
    });
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
