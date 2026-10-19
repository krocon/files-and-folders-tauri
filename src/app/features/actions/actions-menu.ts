import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  output,
} from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { badgeStrokes } from '../../core/actions/shortcut-badge';
import { resolveMenu } from '../menus/menu-model';
import { ACTIONS_MENU_COLUMNS } from './actions-menu-def';
import { ACT_TEXTS } from './actions-texts';
import { ShortcutBadges } from './shortcut-badges';

interface MenuEntry {
  readonly id: string;
  readonly separator: boolean;
  readonly label: string;
  /** Plain shortcut text for screen readers (`⌘⇧P`). */
  readonly shortcut: string;
  readonly badges: string[][];
  readonly ready: boolean;
  readonly hint: string;
  /** Index among the items of the column (dividers have none). */
  readonly row: number;
}

/**
 * Actions ▴ of the button bar as in the old version (mr §1.8, design 020): four
 * fixed columns with dividers, no headings, short labels, shortcut badges. APG
 * menu: ↑/↓ within a column (dividers skipped), ←/→ to the neighbour column,
 * Home/End, Enter/Space run, Esc/Tab close (focus back to the button).
 */
@Component({
  selector: 'app-actions-menu',
  imports: [ShortcutBadges],
  template: `
    <div class="menu" role="menu" [attr.aria-label]="t.actions">
      @for (col of columns(); track $index; let c = $index) {
        <div class="column" role="group">
          @for (item of col; track item.id) {
            @if (item.separator) {
              <div class="divider" role="separator"></div>
            } @else {
              <div
                role="menuitem"
                tabindex="-1"
                [attr.data-col]="c"
                [attr.data-row]="item.row"
                [attr.data-id]="item.id"
                [attr.aria-disabled]="item.ready ? null : 'true'"
                [attr.aria-keyshortcuts]="item.shortcut || null"
                [attr.title]="item.hint || null"
                (click)="choose(item.id, item.ready)"
                (keydown.enter)="choose(item.id, item.ready)"
              >
                <span class="label">{{ item.label }}</span>
                @if (item.badges.length > 0) {
                  <app-shortcut-badges [strokes]="item.badges" />
                }
              </div>
            }
          }
        </div>
      }
    </div>
  `,
  styleUrl: './actions-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)', '(keydown)': 'onKeydown($event)' },
})
export class ActionsMenu {
  protected readonly t = ACT_TEXTS;
  readonly closed = output<'key' | 'outside' | 'chosen'>();
  private readonly actions = inject(ActionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** State, hint and tools as in every menu (design 014); labels and badges of 020. */
  protected readonly columns = computed<MenuEntry[][]>(() => {
    const platform = this.actions.platform();
    const labels = this.t.menu;
    return ACTIONS_MENU_COLUMNS.map((defs) => {
      let row = 0;
      return resolveMenu(defs, this.actions, platform).map((item) => {
        if (item.separator) {
          return { ...EMPTY, id: item.id, separator: true };
        }
        const extra = this.actions.extras().find((x) => x.id === item.id);
        const raw = extra
          ? item.shortcut
            ? extra.shortcut
            : null
          : (this.actions.shortcuts(item.id as ActionId)[0] ?? null);
        return {
          id: item.id,
          separator: false,
          label: labels[item.id] ?? item.label,
          shortcut: item.shortcut ?? '',
          badges: badgeStrokes(raw, platform),
          ready: !item.disabled,
          hint: item.hint ?? '',
          row: row++,
        };
      });
    });
  });

  constructor() {
    afterNextRender(() => this.item(0, 0)?.focus());
  }

  protected choose(id: string, ready: boolean): void {
    if (!ready) {
      return;
    }
    this.closed.emit('chosen');
    setTimeout(() => void this.actions.runAny(id));
  }

  protected onKeydown(evt: KeyboardEvent): void {
    const el = document.activeElement as HTMLElement | null;
    const c = Number(el?.dataset['col'] ?? 0);
    const r = Number(el?.dataset['row'] ?? 0);
    const cols = this.columns().length;
    const rows = (col: number) => this.columns()[col]?.filter((i) => !i.separator).length ?? 0;
    switch (evt.key) {
      case 'ArrowDown':
        this.item(c, (r + 1) % rows(c))?.focus();
        break;
      case 'ArrowUp':
        this.item(c, (r - 1 + rows(c)) % rows(c))?.focus();
        break;
      case 'ArrowRight': {
        const n = (c + 1) % cols;
        this.item(n, Math.min(r, rows(n) - 1))?.focus();
        break;
      }
      case 'ArrowLeft': {
        const n = (c - 1 + cols) % cols;
        this.item(n, Math.min(r, rows(n) - 1))?.focus();
        break;
      }
      case 'Home':
        this.item(c, 0)?.focus();
        break;
      case 'End':
        this.item(c, rows(c) - 1)?.focus();
        break;
      case ' ':
        el?.click();
        break;
      case 'Escape':
      case 'Tab':
        this.closed.emit('key');
        break;
      default:
        return;
    }
    evt.preventDefault();
    evt.stopPropagation();
  }

  protected onOutside(evt: PointerEvent): void {
    const target = evt.target as Element | null;
    if (!this.host.nativeElement.contains(target) && !target?.closest?.('.actions-toggle')) {
      this.closed.emit('outside');
    }
  }

  private item(col: number, row: number): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(
      `[data-col="${col}"][data-row="${row}"]`,
    );
  }
}

const EMPTY: MenuEntry = {
  id: '',
  separator: true,
  label: '',
  shortcut: '',
  badges: [],
  ready: false,
  hint: '',
  row: -1,
};
