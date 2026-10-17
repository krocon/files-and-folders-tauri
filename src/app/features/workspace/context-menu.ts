import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * Small popup menu after the APG menu pattern: `role="menu"`, ↑/↓/Pos1/Ende move,
 * Enter/Space choose, Esc/Tab close. Focus goes to the first enabled item; the
 * opener gets it back (done by the owner on `closed`).
 */
@Component({
  selector: 'app-context-menu',
  template: `
    <ul
      class="menu"
      role="menu"
      [attr.aria-label]="label()"
      [style.left.px]="x()"
      [style.top.px]="y()"
    >
      @for (item of items(); track item.id) {
        <li
          role="menuitem"
          tabindex="-1"
          [attr.aria-disabled]="item.disabled ? 'true' : null"
          [attr.data-id]="item.id"
        >
          {{ item.label }}
        </li>
      }
    </ul>
  `,
  styleUrl: './context-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(keydown)': 'onKeydown($event)',
    '(click)': 'onClick($event)',
  },
})
export class ContextMenu {
  readonly items = input.required<readonly MenuItem[]>();
  readonly x = input(0);
  readonly y = input(0);
  readonly label = input('');
  readonly chosen = output<string>();
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      this.keepInViewport();
      this.focusItem(this.enabled()[0]);
    });
  }

  protected choose(item: MenuItem): void {
    if (!item.disabled) {
      this.chosen.emit(item.id);
    }
  }

  protected onClick(evt: MouseEvent): void {
    const id = (evt.target as HTMLElement | null)?.closest<HTMLElement>('[role="menuitem"]')
      ?.dataset['id'];
    const item = this.items().find((i) => i.id === id);
    if (item) {
      this.choose(item);
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    const enabled = this.enabled();
    const current = enabled.indexOf(document.activeElement as HTMLElement);
    switch (evt.key) {
      case 'ArrowDown':
        this.focusItem(enabled[(current + 1) % enabled.length]);
        break;
      case 'ArrowUp':
        this.focusItem(enabled[(current - 1 + enabled.length) % enabled.length]);
        break;
      case 'Home':
        this.focusItem(enabled[0]);
        break;
      case 'End':
        this.focusItem(enabled.at(-1));
        break;
      case 'Enter':
      case ' ': {
        const id = (document.activeElement as HTMLElement | null)?.dataset['id'];
        const item = this.items().find((i) => i.id === id);
        if (item) {
          this.choose(item);
        }
        break;
      }
      case 'Escape':
      case 'Tab':
        this.closed.emit();
        break;
      default:
        return;
    }
    evt.preventDefault();
    evt.stopPropagation();
  }

  protected onOutside(evt: PointerEvent): void {
    if (!this.host.nativeElement.contains(evt.target as Node)) {
      this.closed.emit();
    }
  }

  private enabled(): HTMLElement[] {
    return [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ),
    ];
  }

  private focusItem(el: HTMLElement | undefined): void {
    el?.focus();
  }

  private keepInViewport(): void {
    const menu = this.host.nativeElement.querySelector<HTMLElement>('.menu');
    if (!menu || typeof window === 'undefined') {
      return;
    }
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(0, window.innerWidth - rect.width - 4)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(0, window.innerHeight - rect.height - 4)}px`;
    }
  }
}
