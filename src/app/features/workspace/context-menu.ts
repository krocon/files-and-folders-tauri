import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** A group heading (not selectable). */
  readonly heading?: boolean;
  /** A separator line (`role="separator"`). */
  readonly separator?: boolean;
  /** Shortcut badge (display text from the keymap, design 014). */
  readonly shortcut?: string;
  /** Tooltip, e.g. why an entry is dimmed. */
  readonly hint?: string;
  /** Entries of a submenu (→ / Enter opens it, ← / Esc closes it). */
  readonly children?: readonly MenuItem[];
}

/**
 * Popup menu after the APG menu pattern: `role="menu"`, ↑/↓/Pos1/Ende move,
 * Enter/Space choose, → / Enter open a submenu, ← / Esc close it, Esc/Tab close
 * the menu. Focus goes to the first enabled item; the opener gets it back (done
 * by the owner on `closed`). Generic: ids in, `chosen(id)` out – also for the
 * entries of submenus.
 */
@Component({
  selector: 'app-context-menu',
  template: `
    <div
      class="menu"
      role="menu"
      [class.sub]="submenu()"
      [attr.aria-label]="label()"
      [style.left.px]="x()"
      [style.top.px]="y()"
    >
      @for (group of groups(); track $index) {
        @if (group.heading; as h) {
          <div role="group" [attr.aria-label]="h">
            <div class="heading" aria-hidden="true">{{ h }}</div>
            @for (item of group.items; track item.id) {
              <ng-container *ngTemplateOutlet="entry; context: { $implicit: item }" />
            }
          </div>
        } @else {
          @for (item of group.items; track item.id) {
            <ng-container *ngTemplateOutlet="entry; context: { $implicit: item }" />
          }
        }
      }
    </div>

    <ng-template #entry let-item>
      @if (item.separator) {
        <div role="separator" class="separator"></div>
      } @else {
        <div
          role="menuitem"
          tabindex="-1"
          [attr.aria-disabled]="item.disabled ? 'true' : null"
          [attr.aria-haspopup]="item.children ? 'menu' : null"
          [attr.aria-expanded]="item.children ? openSub()?.id === item.id : null"
          [attr.title]="item.hint || null"
          [attr.data-id]="item.id"
          (mouseenter)="onHover($event, item)"
        >
          <span class="label">{{ item.label }}</span>
          @if (item.children) {
            <span class="arrow" aria-hidden="true">▸</span>
          } @else if (item.shortcut) {
            <kbd>{{ item.shortcut }}</kbd>
          }
        </div>
      }
    </ng-template>

    @if (openSub(); as s) {
      <app-context-menu
        [items]="s.items"
        [x]="s.x"
        [xAlt]="s.xAlt"
        [y]="s.y"
        [label]="s.label"
        [submenu]="true"
        [autofocus]="s.focus"
        (chosen)="chosen.emit($event)"
        (closed)="onSubClosed($event)"
        (back)="onSubBack()"
      />
    }
  `,
  styleUrl: './context-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(document:pointerup)': 'onPointerUp($event)',
    '(keydown)': 'onKeydown($event)',
    '(click)': 'onClick($event)',
  },
})
export class ContextMenu {
  readonly items = input.required<readonly MenuItem[]>();
  readonly x = input(0);
  readonly y = input(0);
  /** Submenu: right edge of the alternative position (left of the parent) when it does not fit. */
  readonly xAlt = input(0);
  readonly label = input('');
  /** A submenu of another menu (← closes it). */
  readonly submenu = input(false);
  /** Focus the first entry when shown (false when a submenu opens on hover). */
  readonly autofocus = input(true);
  readonly chosen = output<string>();
  /** `key` = Escape/Tab (focus back to the opener), `outside` = click elsewhere. */
  readonly closed = output<'key' | 'outside'>();
  /** A submenu was left with ← or Esc (focus back to its parent entry). */
  readonly back = output<void>();
  /** ←/→ in a top-level menu where they mean nothing – a menu bar opens the neighbour. */
  readonly sideways = output<-1 | 1>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly openSub = signal<{
    id: string;
    label: string;
    items: readonly MenuItem[];
    x: number;
    xAlt: number;
    y: number;
    focus: boolean;
  } | null>(null);

  /** Items split at headings into groups (`role="group"` with the heading as label). */
  protected readonly groups = computed(() => {
    const groups: { heading: string | null; items: MenuItem[] }[] = [];
    for (const item of this.items()) {
      if (item.heading) {
        groups.push({ heading: item.label, items: [] });
      } else {
        if (groups.length === 0) {
          groups.push({ heading: null, items: [] });
        }
        groups[groups.length - 1].items.push(item);
      }
    }
    return groups;
  });

  constructor() {
    afterNextRender(() => {
      this.keepInViewport();
      if (this.autofocus()) {
        this.focusItem(this.enabled()[0]);
      }
    });
  }

  protected choose(item: MenuItem): void {
    if (item.disabled) {
      return;
    }
    if (item.children) {
      this.openChildren(item, true);
      return;
    }
    this.chosen.emit(item.id);
  }

  protected onClick(evt: MouseEvent): void {
    const el = this.ownItem(evt.target);
    const item = el ? this.find(el.dataset['id']) : undefined;
    if (item) {
      evt.stopPropagation();
      this.choose(item);
    }
  }

  /** Mouse: the entry gets the focus (keyboard goes on from there); submenus open on hover. */
  protected onHover(evt: MouseEvent, item: MenuItem): void {
    const el = evt.currentTarget as HTMLElement;
    if (!item.disabled) {
      el.focus();
    }
    if (item.children && !item.disabled) {
      this.openChildren(item, false);
    } else if (this.openSub()) {
      this.openSub.set(null);
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (this.openSub() && this.inSubmenu(evt.target)) {
      return; // the submenu handles its own keys
    }
    const enabled = this.enabled();
    const active = document.activeElement as HTMLElement | null;
    const current = enabled.indexOf(active as HTMLElement);
    const item = active ? this.find(active.dataset['id']) : undefined;
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
      case 'ArrowRight':
        if (item?.children && !item.disabled) {
          this.openChildren(item, true);
        } else if (!this.submenu()) {
          this.sideways.emit(1);
        }
        break;
      case 'ArrowLeft':
        if (this.submenu()) {
          this.back.emit();
        } else {
          this.sideways.emit(-1);
        }
        break;
      case 'Enter':
      case ' ':
        if (item) {
          this.choose(item);
        }
        break;
      case 'Escape':
        if (this.submenu()) {
          this.back.emit();
        } else {
          this.closed.emit('key');
        }
        break;
      case 'Tab':
        this.closed.emit('key');
        break;
      default:
        return;
    }
    evt.preventDefault();
    evt.stopPropagation();
  }

  protected onSubClosed(reason: 'key' | 'outside'): void {
    this.openSub.set(null);
    if (reason === 'key') {
      this.closed.emit('key');
    }
  }

  protected onSubBack(): void {
    const id = this.openSub()?.id;
    this.openSub.set(null);
    this.focusItem(this.itemElement(id));
  }

  /**
   * The release of the right click that opened the menu: the list under it takes the
   * focus back (GuiExpert focuses its host) – the menu keeps it.
   */
  protected onPointerUp(evt: PointerEvent): void {
    const host = this.host.nativeElement;
    if (this.autofocus() && !this.submenu() && !host.contains(evt.target as Node)) {
      setTimeout(() => {
        if (!host.contains(document.activeElement)) {
          this.focusItem(this.enabled()[0]);
        }
      });
    }
  }

  protected onOutside(evt: PointerEvent): void {
    if (!this.host.nativeElement.contains(evt.target as Node)) {
      this.closed.emit('outside');
    }
  }

  private openChildren(item: MenuItem, focus: boolean): void {
    if (this.openSub()?.id === item.id) {
      if (focus) {
        // already open (hover): move into it
        this.openSub.set({ ...this.openSub()!, focus: true });
        const sub = this.host.nativeElement.querySelector<HTMLElement>(
          'app-context-menu [role="menuitem"]:not([aria-disabled="true"])',
        );
        sub?.focus();
      }
      return;
    }
    const rect = this.itemElement(item.id)?.getBoundingClientRect();
    this.openSub.set({
      id: item.id,
      label: item.label,
      items: item.children ?? [],
      x: rect ? rect.right - 2 : this.x() + 200,
      xAlt: rect ? rect.left + 2 : this.x(),
      y: rect ? rect.top - 4 : this.y(),
      focus,
    });
  }

  private find(id: string | undefined): MenuItem | undefined {
    return id === undefined ? undefined : this.items().find((i) => i.id === id);
  }

  /** The menu item of this menu (not of a submenu) that contains `target`. */
  private ownItem(target: EventTarget | null): HTMLElement | null {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[role="menuitem"]') ?? null;
    return el && !this.inSubmenu(el) ? el : null;
  }

  private inSubmenu(target: EventTarget | null): boolean {
    const sub = this.host.nativeElement.querySelector('app-context-menu');
    return !!sub && sub.contains(target as Node);
  }

  private itemElement(id: string | undefined): HTMLElement | undefined {
    return this.ownItems().find((el) => el.dataset['id'] === id);
  }

  private ownItems(): HTMLElement[] {
    const menu = this.host.nativeElement.querySelector(':scope > .menu');
    return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
  }

  /** Enabled entries; if none is enabled, all (APG: disabled items stay focusable – Esc must work). */
  private enabled(): HTMLElement[] {
    const all = this.ownItems();
    const enabled = all.filter((el) => el.getAttribute('aria-disabled') !== 'true');
    return enabled.length > 0 ? enabled : all;
  }

  private focusItem(el: HTMLElement | undefined): void {
    el?.focus();
  }

  private keepInViewport(): void {
    const menu = this.host.nativeElement.querySelector<HTMLElement>(':scope > .menu');
    if (!menu || typeof window === 'undefined') {
      return;
    }
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      // a submenu flips to the left of its parent
      const left = this.submenu() ? this.xAlt() - rect.width : window.innerWidth - rect.width - 4;
      menu.style.left = `${Math.max(0, left)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(0, window.innerHeight - rect.height - 4)}px`;
    }
  }
}
