import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { eventKey, strokeFromEvent } from '../../core/actions/shortcut';
import type { DialogKey } from './dialog-key';
import { DIALOG_KEY_STYLE, DIALOG_PLATFORM, takesMnemonic } from './dialog-key';
import { assignMnemonics } from './mnemonic';

/** Order of the underlined letters: main button and Cancel get theirs first. */
const MNEMONIC_RANK = { primary: 0, cancel: 1, secondary: 2 } as Readonly<Record<string, number>>;

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
 * Dialog keys (design 057): buttons carry a role ({@link DialogKey}, `appDialogKey`);
 * Enter clicks the `primary` button wherever the focus is (except E2: a focused
 * button, textarea, list/grid/combobox/menu, IME, auto-repeat, another form, a
 * disabled button), `Mod+<letter>` a `secondary`, `Mod+Shift+<letter>` a
 * `destructive` one – never Enter. A `confirm` button (a proposal from outside, design
 * 071) takes `Mod+Enter` only. Esc closes unless an inner popup took it.
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
        [class.grows]="grows()"
        [style.width]="width()"
        [style.height]="fill() || grows() ? null : height()"
        [style.max-height]="!fill() && !grows() && height() ? '90vh' : null"
        [style.--dialog-min]="grows() ? minHeight() : null"
        [style.--dialog-grown]="grows() && grown() > 0 ? grown() + 'px' : null"
      >
        <h2 class="title" [class.compact]="compact()" [id]="titleId">{{ heading() }}</h2>
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
  },
})
export class Modal {
  readonly heading = input.required<string>();
  readonly width = input('34rem');
  /** Fixed height for large dialogs (multi-rename); default: as high as the content. */
  readonly height = input<string | null>(null);
  /**
   * At least this high – and as high as the content needs while the window has room, so
   * nothing scrolls that could be shown (the settings: tabs of very different length).
   * The height that was reached stays while the dialog is open. Not together with `fill`.
   */
  readonly minHeight = input<string | null>(null);
  /** The full height of the window (a small margin): large tool dialogs with a preview table. */
  readonly fill = input(false);
  /** Less space under the title (design 073 E23): dialogs whose content starts with an intro. */
  readonly compact = input(false);
  /** `alertdialog` for questions that interrupt work (conflicts). */
  readonly dialogRole = input<'dialog' | 'alertdialog'>('dialog');
  /** Id of the element that explains the question (`aria-describedby`). */
  readonly describedBy = input<string | null>(null);
  /**
   * Underlined letters with the setting `view.dialogKeys = underline` (design 076 E4);
   * off for a dialog with its own Alt letters (the conflict dialog).
   */
  readonly mnemonics = input(true);
  readonly closed = output<void>();
  protected readonly titleId = `fnf-modal-${++modalSeq}`;
  protected readonly grows = computed(() => this.minHeight() !== null && !this.fill());
  /** The largest height the dialog had (px) – it does not shrink below it again. */
  protected readonly grown = signal(0);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platform = inject(DIALOG_PLATFORM);
  private readonly keyStyle = inject(DIALOG_KEY_STYLE);
  private refreshPending = false;
  /** Buttons with a key role in this dialog (design 057). */
  private readonly keys = new Set<DialogKey>();

  constructor() {
    // labels change (language, state), buttons come and go: letters follow
    effect(() => {
      this.keyStyle();
      this.mnemonics();
      this.scheduleMnemonics();
    });
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => this.scheduleMnemonics());
      mo.observe(this.host.nativeElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['hidden', 'disabled', 'class'],
      });
      inject(DestroyRef).onDestroy(() => mo.disconnect());
    }
    const destroyRef = inject(DestroyRef);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.scheduleMnemonics());
      ro.observe(this.host.nativeElement);
      destroyRef.onDestroy(() => ro.disconnect());
    }
    afterNextRender(() => {
      const el = this.host.nativeElement;
      this.keepHeight(el.querySelector<HTMLElement>('.dialog'), destroyRef);
      const target = el.querySelector<HTMLElement>('[data-autofocus]') ?? this.focusables()[0];
      target?.focus();
      if (target instanceof HTMLInputElement) {
        target.select(); // typing replaces a suggested value
      }
    });
  }

  /**
   * A dialog with `minHeight` remembers the largest height it had: the style sheet
   * keeps it at least that high (and inside the window).
   */
  private keepHeight(dialog: HTMLElement | null, destroyRef: DestroyRef): void {
    if (!dialog || !this.grows() || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver(() => {
      const height = Math.round(dialog.offsetHeight);
      if (height > this.grown()) {
        this.grown.set(height);
      }
    });
    ro.observe(dialog);
    destroyRef.onDestroy(() => ro.disconnect());
  }

  protected onBackdrop(evt: PointerEvent): void {
    if (evt.target === evt.currentTarget) {
      this.closed.emit();
    }
  }

  register(key: DialogKey): void {
    this.keys.add(key);
    this.scheduleMnemonics();
  }

  unregister(key: DialogKey): void {
    this.keys.delete(key);
    this.scheduleMnemonics();
  }

  private scheduleMnemonics(): void {
    if (this.refreshPending) {
      return;
    }
    this.refreshPending = true;
    const run = (): void => {
      this.refreshPending = false;
      this.refreshMnemonics();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      setTimeout(run);
    }
  }

  /** Gives the visible buttons their underlined letters (design 076 E4). */
  refreshMnemonics(): void {
    const all = [...this.keys];
    if (this.keyStyle() !== 'underline' || !this.mnemonics()) {
      for (const k of all) {
        if (k.mnemonic()) {
          k.setMnemonic(null);
        }
      }
      return;
    }
    const chosen = all
      .filter((k) => takesMnemonic(k.role()) && this.visible(k))
      .sort(
        (a, b) =>
          MNEMONIC_RANK[a.role()!.role] - MNEMONIC_RANK[b.role()!.role] ||
          (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1),
      );
    const texts = chosen.map((k) => textNodes(k.el));
    const letters = assignMnemonics(texts.map((nodes) => nodes.map((n) => n.data).join('')));
    for (const k of all) {
      const i = chosen.indexOf(k);
      const m = i < 0 ? null : letters[i];
      if (!m) {
        k.setMnemonic(null);
        continue;
      }
      let offset = m.index;
      const node = texts[i].find((n) => {
        if (offset < n.data.length) {
          return true;
        }
        offset -= n.data.length;
        return false;
      });
      k.setMnemonic(m, node ?? null, offset);
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
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
      if (!this.onModEnter(evt)) {
        this.onEnter(evt);
      }
      return;
    }
    if (this.onMnemonic(evt)) {
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
        [...this.keys].some((k) => {
          const role = k.role()?.role;
          return (role === 'destructive' || role === 'confirm') && form.contains(k.el);
        })
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

  /**
   * `Mod+Enter` → the `confirm` button (design 071): the only key of a dialog that an
   * MCP client opened. A dialog that handles the key itself comes first (`defaultPrevented`).
   */
  private onModEnter(evt: KeyboardEvent): boolean {
    const mod = this.platform === 'macos' ? evt.metaKey : evt.ctrlKey;
    if (!mod || evt.altKey || evt.shiftKey || evt.isComposing) {
      return false;
    }
    if (evt.defaultPrevented) {
      return true;
    }
    const confirm = [...this.keys].find((k) => k.role()?.role === 'confirm' && this.visible(k));
    if (!confirm) {
      return false;
    }
    evt.preventDefault();
    evt.stopPropagation();
    if (!evt.repeat) {
      confirm.trigger();
    }
    return true;
  }

  /** `Alt+<letter>` → the button with that underlined letter (design 076 E4). */
  private onMnemonic(evt: KeyboardEvent): boolean {
    if (!evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey || evt.defaultPrevented) {
      return false;
    }
    if (this.keyStyle() !== 'underline' || !this.mnemonics()) {
      return false;
    }
    const key = eventKey(evt);
    const hit = [...this.keys].find((k) => k.mnemonic()?.letter === key && this.visible(k));
    if (!hit) {
      return false;
    }
    evt.preventDefault(); // no ∂ etc. in a text field on macOS
    evt.stopPropagation();
    if (!evt.repeat) {
      hit.trigger();
    }
    return true;
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

/** The text nodes of a button's label, in order (the keycap is CSS, not text). */
function textNodes(el: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    out.push(n as Text);
  }
  return out;
}
