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

export type MenuCloseReason = 'key' | 'tab' | 'outside';

let menuCounter = 0;

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** A group heading (not selectable). */
  readonly heading?: boolean;
  /** Set = a radio item (`menuitemradio` + `aria-checked`, ✓ shown). */
  readonly checked?: boolean;
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
 * Popup menu after the APG menu pattern: `role="menu"`, ↑/↓/Pos1/Ende move (also
 * over dimmed entries, which say why via `aria-describedby`), a letter jumps to the
 * next entry starting with it, Enter/Space choose, → / Enter open a submenu, ← / Esc
 * close it, Esc/Tab close the menu. Focus goes to the first enabled item; the opener gets it back (done
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
          [attr.role]="item.checked === undefined ? 'menuitem' : 'menuitemradio'"
          [attr.aria-checked]="item.checked === undefined ? null : item.checked"
          tabindex="-1"
          [attr.aria-disabled]="item.disabled ? 'true' : null"
          [attr.aria-describedby]="item.disabled && item.hint ? hintId(item) : null"
          [attr.aria-haspopup]="item.children ? 'menu' : null"
          [attr.aria-expanded]="item.children ? openSub()?.id === item.id : null"
          [attr.title]="item.hint || null"
          [attr.data-id]="item.id"
          (mouseenter)="onHover($event, item)"
        >
          <span class="label">
            @if (item.checked !== undefined) {
              <span class="radio" aria-hidden="true">
                @if (item.checked) {
                  <i class="fa fa-check" aria-hidden="true"></i>
                }
              </span>
            }
            {{ item.label }}</span
          >
          @if (item.disabled && item.hint) {
            <span class="sr-only" [id]="hintId(item)">{{ item.hint }}</span>
          }
          @if (item.children) {
            <i class="fa fa-caret-right arrow" aria-hidden="true"></i>
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
  styleUrl: './context-menu.css',
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
  /** The opener: a press on it is not "outside" – its click toggles the menu (review 013 #10). */
  readonly anchor = input<Element | null>(null);
  /** A submenu of another menu (← closes it). */
  readonly submenu = input(false);
  /** Focus the first entry when shown (false when a submenu opens on hover). */
  readonly autofocus = input(true);
  readonly chosen = output<string>();
  /**
   * `key` = Escape (focus back to the opener), `tab` = Tab (the owner moves the focus on;
   * a menu bar leaves the bar, review 014 #5), `outside` = click elsewhere.
   */
  readonly closed = output<MenuCloseReason>();
  /** A submenu was left with ← or Esc (focus back to its parent entry). */
  readonly back = output<void>();
  /** ←/→ in a top-level menu where they mean nothing – a menu bar opens the neighbour. */
  readonly sideways = output<-1 | 1>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly uid = `fnf-menu-${++menuCounter}`;

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

  protected hintId(item: MenuItem): string {
    return `${this.uid}-hint-${this.items().indexOf(item)}`;
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
    el.focus(); // dimmed entries too (APG) – the hint is read
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
    // APG: dimmed entries stay focusable (their hint is announced), they just do nothing
    const all = this.ownItems();
    const active = document.activeElement as HTMLElement | null;
    const current = all.indexOf(active as HTMLElement);
    const item = active ? this.find(active.dataset['id']) : undefined;
    switch (evt.key) {
      case 'ArrowDown':
        this.focusItem(all[(current + 1) % all.length]);
        break;
      case 'ArrowUp':
        this.focusItem(all[(current - 1 + all.length) % all.length]);
        break;
      case 'Home':
        this.focusItem(all[0]);
        break;
      case 'End':
        this.focusItem(all.at(-1));
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
        this.closed.emit('tab');
        break;
      default: {
        const next = isTypeahead(evt) ? typeaheadIndex(this.labels(all), current, evt.key) : -1;
        if (next < 0) {
          return;
        }
        this.openSub.set(null);
        this.focusItem(all[next]);
      }
    }
    evt.preventDefault();
    evt.stopPropagation();
  }

  protected onSubClosed(reason: MenuCloseReason): void {
    this.openSub.set(null);
    if (reason !== 'outside') {
      this.closed.emit(reason);
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
    const target = evt.target as Node;
    if (!this.host.nativeElement.contains(target) && !this.anchor()?.contains(target)) {
      this.closed.emit('outside');
    }
  }

  private openChildren(item: MenuItem, focus: boolean): void {
    if (this.openSub()?.id === item.id) {
      if (focus) {
        // already open (hover): move into it
        this.openSub.set({ ...this.openSub()!, focus: true });
        const sub = this.host.nativeElement.querySelector<HTMLElement>(
          'app-context-menu [role^="menuitem"]:not([aria-disabled="true"])',
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

  private labels(els: readonly HTMLElement[]): string[] {
    return els.map((el) => this.find(el.dataset['id'])?.label ?? '');
  }

  private find(id: string | undefined): MenuItem | undefined {
    return id === undefined ? undefined : this.items().find((i) => i.id === id);
  }

  /** The menu item of this menu (not of a submenu) that contains `target`. */
  private ownItem(target: EventTarget | null): HTMLElement | null {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[role^="menuitem"]') ?? null;
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
    return menu ? [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : [];
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
    // never over the opener (its second click closes the menu): above it when it would cover it
    const anchor = this.anchor()?.getBoundingClientRect();
    const now = menu.getBoundingClientRect();
    if (anchor && now.bottom > anchor.top && now.top < anchor.bottom) {
      menu.style.top = `${Math.max(0, anchor.top - now.height - 2)}px`;
    }
  }
}

/** A printable character without command modifiers (APG typeahead). */
export function isTypeahead(evt: KeyboardEvent): boolean {
  return evt.key.length === 1 && evt.key !== ' ' && !evt.ctrlKey && !evt.metaKey && !evt.altKey;
}

/** Index of the next label after `current` starting with `char` (wraps), -1 if none. */
export function typeaheadIndex(labels: readonly string[], current: number, char: string): number {
  const c = char.toLocaleLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const i = (current + step + labels.length) % labels.length;
    if (labels[i].trim().toLocaleLowerCase().startsWith(c)) {
      return i;
    }
  }
  return -1;
}
