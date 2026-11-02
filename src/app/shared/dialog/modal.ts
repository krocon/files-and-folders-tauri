import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { modifiersAfter, strokeFromEvent } from '../../core/actions/shortcut';
import type { DialogKey } from './dialog-key';
import { DIALOG_PLATFORM } from './dialog-key';

let modalSeq = 0;

/**
 * Inside these the focused widget owns Enter (lists, grids, comboboxes, menus,
 * tables; `data-own-enter` for anything else) – design 057 E2.
 */
const OWN_ENTER = [
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="menuitem"]',
  '[role="tree"]',
  '[role="grid"]',
  '[role="treegrid"]',
  '[role="tablist"]',
  '[role="tab"]',
  '[aria-expanded="true"]',
  '[contenteditable]:not([contenteditable="false"])',
  'guiexpert-table',
  'guiexpert-table-signal',
  'app-preview-grid',
  '[data-own-enter]',
].join(', ');

/** The focus is on something that acts on Enter by itself (a button, a link). */
const CLICKABLE = [
  'button',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="link"]',
  'textarea',
].join(', ');

/**
 * Modal frame: `role="dialog"` + `aria-modal`, focus trap, Escape closes, focus
 * goes to the first `[data-autofocus]` (or first focusable) element. The opener gets
 * the focus back through {@link DialogService.close}.
 *
 * Dialog keys (design 057): buttons carry a role ({@link DialogKey}, `fnfDialogKey`);
 * Enter clicks the `primary` button wherever the focus is (except E2: a focused
 * button, textarea, list/grid/combobox/menu, IME, auto-repeat, another form, a
 * disabled button), `Mod+<letter>` a `secondary`, `Mod+Shift+<letter>` a
 * `destructive` one – never Enter. Esc closes unless an inner popup took it.
 */
@Component({
  selector: 'app-modal',
  template: `
    <div class="backdrop" [class.fill]="fill()" (pointerdown)="onBackdrop($event)">
      <div
        class="dialog"
        [attr.role]="dialogRole()"
        [attr.aria-describedby]="describedBy()"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        [style.width]="width()"
        [style.height]="fill() ? null : height()"
        [style.max-height]="!fill() && height() ? '90vh' : null"
      >
        <h2 class="title" [id]="titleId">{{ heading() }}</h2>
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
    '(document:keyup)': 'onKeyup($event)',
    '(window:blur)': 'modHeld.set(false)',
  },
})
export class Modal {
  readonly heading = input.required<string>();
  readonly width = input('34rem');
  /** Fixed height for large dialogs (multi-rename); default: as high as the content. */
  readonly height = input<string | null>(null);
  /** The full height of the window (a small margin): large tool dialogs with a preview table. */
  readonly fill = input(false);
  /** `alertdialog` for questions that interrupt work (conflicts). */
  readonly dialogRole = input<'dialog' | 'alertdialog'>('dialog');
  /** Id of the element that explains the question (`aria-describedby`). */
  readonly describedBy = input<string | null>(null);
  readonly closed = output<void>();
  protected readonly titleId = `fnf-modal-${++modalSeq}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platform = inject(DIALOG_PLATFORM);
  /** Buttons with a key role in this dialog (design 057). */
  private readonly keys = new Set<DialogKey>();
  /** ⌘ (macOS) / Ctrl is held: the buttons show their letters (E4). */
  readonly modHeld = signal(false);

  constructor() {
    afterNextRender(() => {
      const el = this.host.nativeElement;
      const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? this.focusables()[0];
      target?.focus();
      if (target instanceof HTMLInputElement) {
        target.select(); // typing replaces a suggested value
      }
    });
  }

  protected onBackdrop(evt: PointerEvent): void {
    if (evt.target === evt.currentTarget) {
      this.closed.emit();
    }
  }

  register(key: DialogKey): void {
    this.keys.add(key);
  }

  unregister(key: DialogKey): void {
    this.keys.delete(key);
  }

  protected onKeyup(evt: KeyboardEvent): void {
    const m = modifiersAfter(evt, 'keyup');
    this.modHeld.set(this.platform === 'macos' ? m.metaKey : m.ctrlKey);
  }

  protected onKeydown(evt: KeyboardEvent): void {
    this.modHeld.set(this.platform === 'macos' ? evt.metaKey : evt.ctrlKey);
    if (evt.key === 'Escape') {
      // an inner popup (combobox list, menu, template name) closes first
      if (evt.defaultPrevented || this.inside(evt.target, '[role="menu"]')) {
        return;
      }
      evt.preventDefault();
      evt.stopPropagation();
      this.closed.emit();
      return;
    }
    if (evt.key === 'Tab') {
      const items = this.focusables();
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (evt.shiftKey && document.activeElement === first) {
        last.focus();
        evt.preventDefault();
      } else if (!evt.shiftKey && document.activeElement === last) {
        first.focus();
        evt.preventDefault();
      }
      return;
    }
    if (evt.key === 'Enter') {
      this.onEnter(evt);
      return;
    }
    this.onLetter(evt);
  }

  /** Enter → the primary button (design 057 E2). */
  private onEnter(evt: KeyboardEvent): void {
    if (
      evt.defaultPrevented ||
      evt.isComposing ||
      evt.ctrlKey ||
      evt.metaKey ||
      evt.altKey ||
      evt.shiftKey
    ) {
      return;
    }
    const target = evt.target instanceof HTMLElement ? evt.target : null;
    if (!target || target.closest(CLICKABLE) || this.inside(target, OWN_ENTER)) {
      return;
    }
    const primary = this.primary();
    const form = target.closest('form');
    if (!primary) {
      // no main button (or only a destructive one): Enter does nothing here – and must
      // not submit a form whose button is destructive (implicit submission)
      if (
        form &&
        [...this.keys].some((k) => k.role()?.role === 'destructive' && form.contains(k.el))
      ) {
        evt.preventDefault();
      }
      return;
    }
    // a second form (quick connect, rename field) keeps its own submit
    if (form && !form.contains(primary.el)) {
      return;
    }
    evt.preventDefault(); // no implicit submit as well: exactly one click
    evt.stopPropagation();
    if (!evt.repeat) {
      primary.trigger();
    }
  }

  /** `Mod+<letter>` → secondary, `Mod+Shift+<letter>` → destructive (design 057 E3). */
  private onLetter(evt: KeyboardEvent): void {
    const stroke = strokeFromEvent(evt, this.platform);
    if (!stroke || !stroke.mod || stroke.ctrl || stroke.alt || !/^[A-Z]$/.test(stroke.key)) {
      return;
    }
    const hit = [...this.keys].find((k) => {
      const r = k.role();
      return (
        r?.letter === stroke.key && (r.role === 'destructive') === stroke.shift && this.visible(k)
      );
    });
    if (!hit) {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    if (!evt.repeat) {
      hit.trigger();
    }
  }

  /** The first visible primary button in document order. */
  private primary(): DialogKey | null {
    const all = [...this.keys].filter((k) => k.role()?.role === 'primary' && this.visible(k));
    all.sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    return all[0] ?? null;
  }

  private visible(k: DialogKey): boolean {
    return k.el.isConnected && !k.el.closest('[hidden]') && this.host.nativeElement.contains(k.el);
  }

  /** `target` lies inside `selector` within this dialog. */
  private inside(target: EventTarget | null, selector: string): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    const hit = target.closest(selector);
    return hit !== null && this.host.nativeElement.contains(hit);
  }

  private focusables(): HTMLElement[] {
    return [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]',
      ),
    ];
  }
}
