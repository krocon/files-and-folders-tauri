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
import { Side } from '../../core/session/session.models';
import { MenuCloseReason, MenuItem } from './context-menu';
import { folderColumns, splitLabel } from './folder-menu-logic';
import { TEXTS } from './texts';

let folderMenuCounter = 0;

/** Below this window width the two columns become one (same value in folder-menu.css). */
const ONE_COLUMN_QUERY = '(max-width: 720px)';

/**
 * The folder menu ▾ of the tab row: a filter field over two columns across the window, so the
 * drives, servers, favourites (left) and the recent folders (right) fit without scrolling.
 * APG combobox with a listbox popup: the focus stays in the field, ↑/↓ move the active entry
 * through both columns, ←/→ change the column, Enter opens, Esc/Tab close. Typing filters all
 * sections (every word, without case); long paths are cut in the middle, the tooltip has all.
 */
@Component({
  selector: 'app-folder-menu',
  templateUrl: './folder-menu.html',
  styleUrl: './folder-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(click)': 'onClick($event)',
    // not mouseenter: a list scrolled by the keys under a resting pointer must not move the mark
    '(mousemove)': 'onMove($event)',
  },
})
export class FolderMenu {
  /** Flat list as for a context menu: headings start a section. */
  readonly items = input.required<readonly MenuItem[]>();
  /** Id of the heading the right column starts with. */
  readonly columnBreak = input('');
  /** Top edge (below the opener). */
  readonly y = input(0);
  /** A wide window: the menu stays on the side of its panel. */
  readonly side = input<Side>('left');
  readonly label = input('');
  /** The opener: a press on it is not "outside" – its click closes the menu. */
  readonly anchor = input<Element | null>(null);
  readonly chosen = output<string>();
  readonly closed = output<MenuCloseReason>();

  protected readonly texts = TEXTS;
  protected readonly uid = `fnf-folder-menu-${++folderMenuCounter}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly filter = signal('');
  private readonly activeId = signal<string | null>(null);

  protected readonly columns = computed(() =>
    folderColumns(this.items(), this.columnBreak(), this.filter()),
  );
  /** The entries a key can reach, column by column. */
  private readonly selectable = computed(() =>
    this.columns().map((col) => col.flatMap((g) => g.items).filter((i) => !i.disabled)),
  );
  private readonly order = computed(() => this.selectable().flat());
  /** The highlighted entry: the first one until a key or the mouse says otherwise. */
  protected readonly active = computed(() => {
    const order = this.order();
    return order.find((i) => i.id === this.activeId()) ?? order[0] ?? null;
  });
  protected readonly empty = computed(() => this.columns().every((col) => col.length === 0));

  constructor() {
    afterNextRender(() => this.input()?.focus());
  }

  protected optionId(item: MenuItem): string {
    return `${this.uid}-opt-${this.items().indexOf(item)}`;
  }

  protected parts(item: MenuItem): { head: string; tail: string } {
    return splitLabel(item.label);
  }

  protected onInput(value: string): void {
    this.filter.set(value);
    this.activeId.set(null); // the first hit
  }

  protected onMove(evt: MouseEvent): void {
    const item = this.itemAt(evt.target);
    if (item && !item.disabled) {
      this.activeId.set(item.id);
    }
  }

  protected onClick(evt: MouseEvent): void {
    this.choose(this.itemAt(evt.target));
  }

  private choose(item: MenuItem | null): void {
    if (item && !item.disabled) {
      this.chosen.emit(item.id);
    }
  }

  /** A click in the menu must not take the focus out of the field. */
  protected keepFocus(evt: Event): void {
    if (evt.target !== this.input()) {
      evt.preventDefault();
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    const order = this.order();
    const active = this.active();
    const at = active ? order.indexOf(active) : -1;
    switch (evt.key) {
      case 'ArrowDown':
        this.activate(order[(at + 1) % order.length]);
        break;
      case 'ArrowUp':
        this.activate(order[(at - 1 + order.length) % order.length]);
        break;
      case 'ArrowRight':
      case 'ArrowLeft':
        if (!this.changeColumn(evt.key === 'ArrowRight' ? 1 : 0)) {
          return; // the caret moves in the text
        }
        break;
      case 'Home':
      case 'End':
        if (this.filter() !== '') {
          return; // the caret
        }
        this.activate(evt.key === 'Home' ? order[0] : order.at(-1));
        break;
      case 'Enter':
        this.choose(active);
        break;
      case 'Escape':
        this.closed.emit('key');
        break;
      case 'Tab':
        this.closed.emit('tab');
        break;
      default:
        return;
    }
    evt.preventDefault();
    evt.stopPropagation();
  }

  protected onOutside(evt: PointerEvent): void {
    const target = evt.target as Node;
    if (!this.host.nativeElement.contains(target) && !this.anchor()?.contains(target)) {
      this.closed.emit('outside');
    }
  }

  /**
   * ←/→ go to the entry at the same height in the other column. → only with the caret at the end
   * of the text, ← only from the right column – otherwise the keys belong to the text.
   */
  private changeColumn(to: 0 | 1): boolean {
    const active = this.active();
    const [left, right] = this.selectable();
    const target = to === 1 ? right : left;
    const from = to === 1 ? left : right;
    if (!active || !from.includes(active) || target.length === 0 || this.oneColumn()) {
      return false;
    }
    const field = this.input();
    if (to === 1 && field && field.selectionStart !== field.value.length) {
      return false;
    }
    const top = (item: MenuItem) => this.element(item)?.getBoundingClientRect().top ?? 0;
    const y = top(active);
    let best = target[0];
    for (const item of target) {
      if (Math.abs(top(item) - y) < Math.abs(top(best) - y)) {
        best = item;
      }
    }
    this.activate(best);
    return true;
  }

  private activate(item: MenuItem | undefined): void {
    if (!item) {
      return;
    }
    this.activeId.set(item.id);
    this.element(item)?.scrollIntoView?.({ block: 'nearest' });
  }

  private oneColumn(): boolean {
    return typeof matchMedia === 'function' && matchMedia(ONE_COLUMN_QUERY).matches;
  }

  private itemAt(target: EventTarget | null): MenuItem | null {
    const id = (target as HTMLElement | null)?.closest?.<HTMLElement>('[role="option"]')?.dataset[
      'id'
    ];
    return this.items().find((i) => i.id === id) ?? null;
  }

  private element(item: MenuItem): HTMLElement | null {
    return document.getElementById(this.optionId(item));
  }

  private input(): HTMLInputElement | null {
    return this.host.nativeElement.querySelector<HTMLInputElement>('input');
  }
}
