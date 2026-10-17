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
import {
  ACTION_IDS,
  ACTIONS,
  ActionCategory,
  CATEGORY_LABELS,
} from '../../core/actions/action-catalog';
import { resolveMenu } from '../menus/menu-model';

const COLUMNS: readonly ActionCategory[] = ['navigation', 'selection', 'files', 'config'];

/**
 * Actions ▴ of the button bar (mr §1.8): four columns, every entry with its
 * shortcut. APG menu: ↑/↓ within a column, ←/→ to the neighbour column,
 * Enter/Space run, Esc/Tab close (focus back to the button).
 */
@Component({
  selector: 'app-actions-menu',
  template: `
    <div class="menu" role="menu" aria-label="Actions">
      @for (col of columns(); track col.category; let c = $index) {
        <div class="column" role="group" [attr.aria-label]="col.label">
          <div class="heading" aria-hidden="true">{{ col.label }}</div>
          @for (item of col.items; track item.id; let r = $index) {
            <div
              role="menuitem"
              tabindex="-1"
              [attr.data-col]="c"
              [attr.data-row]="r"
              [attr.aria-disabled]="item.ready ? null : 'true'"
              [attr.title]="item.hint"
              (click)="choose(item.id, item.ready)"
              (keydown.enter)="choose(item.id, item.ready)"
            >
              <span>{{ item.label }}</span>
              @if (item.shortcut) {
                <kbd>{{ item.shortcut }}</kbd>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './actions-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)', '(keydown)': 'onKeydown($event)' },
})
export class ActionsMenu {
  readonly closed = output<'key' | 'outside' | 'chosen'>();
  private readonly actions = inject(ActionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Same entries as every menu (design 014): label, badge, dimmed + hint. */
  protected readonly columns = computed(() =>
    COLUMNS.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: resolveMenu(
        [
          ...ACTION_IDS.filter(
            (id) => ACTIONS[id].category === category && !ACTIONS[id].hiddenInMenu,
          ),
          // the tools at the end of the configuration column (mr §1.8)
          ...(category === 'config' ? (['@tools'] as const) : []),
        ],
        this.actions,
        this.actions.platform(),
      ).map((item) => ({
        id: item.id,
        label: item.label,
        shortcut: item.shortcut ?? '',
        ready: !item.disabled,
        hint: item.hint ?? '',
      })),
    })),
  );

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
    const rows = (col: number) => this.columns()[col]?.items.length ?? 0;
    switch (evt.key) {
      case 'ArrowDown':
        this.item(c, (r + 1) % rows(c))?.focus();
        break;
      case 'ArrowUp':
        this.item(c, (r - 1 + rows(c)) % rows(c))?.focus();
        break;
      case 'ArrowRight': {
        const n = (c + 1) % COLUMNS.length;
        this.item(n, Math.min(r, rows(n) - 1))?.focus();
        break;
      }
      case 'ArrowLeft': {
        const n = (c - 1 + COLUMNS.length) % COLUMNS.length;
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
