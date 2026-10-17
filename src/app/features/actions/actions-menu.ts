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
  ActionId,
  CATEGORY_LABELS,
} from '../../core/actions/action-catalog';

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
              (click)="choose(item.id, item.ready, item.extra)"
              (keydown.enter)="choose(item.id, item.ready, item.extra)"
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

  protected readonly columns = computed(() =>
    COLUMNS.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: [
        ...ACTION_IDS.filter(
          (id) => ACTIONS[id].category === category && !ACTIONS[id].hiddenInMenu,
        ).map((id) => {
          const state = this.actions.state(id);
          return {
            id: id as string,
            extra: false,
            label: ACTIONS[id].label,
            shortcut: this.actions.shortcutLabel(id),
            ready: state === 'ready',
            hint: state === 'unavailable' ? `Coming in prompt ${ACTIONS[id].availableIn}` : '',
          };
        }),
        // the tools at the end of the configuration column (mr §1.8)
        ...(category === 'config' ? this.actions.extras() : []).map((x) => ({
          id: x.id,
          extra: true,
          label: x.label,
          shortcut: this.actions.extraShortcutLabel(x.id),
          ready: x.enabled(),
          hint: '',
        })),
      ],
    })),
  );

  constructor() {
    afterNextRender(() => this.item(0, 0)?.focus());
  }

  protected choose(id: string, ready: boolean, extra = false): void {
    if (!ready) {
      return;
    }
    this.closed.emit('chosen');
    setTimeout(() =>
      extra ? void this.actions.runExtra(id) : void this.actions.run(id as ActionId),
    );
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
