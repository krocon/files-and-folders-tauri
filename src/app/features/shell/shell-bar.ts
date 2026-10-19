import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ShellApi } from '../../core/shell/shell-api';
import { historyStep, HistoryNav, middleEllipsis, NO_NAV, suggestions } from './shell-logic';
import { OUTPUT_MAX, OUTPUT_MIN, ShellStore } from './shell.store';
import { SHELL_TEXTS } from './shell-texts';

let nextId = 0;

/**
 * Row 5 of the window (design 021): output area above the command line
 * `<folder>> [input]`. The input is an editable combobox (APG) with suggestions
 * from the history and handles its own keys (Enter, ↑/↓, Esc, Ctrl+C).
 *
 * **The only caller of `ShellApi.run`** (design 021 E1): a line runs only after
 * Enter in this field.
 */
@Component({
  selector: 'app-shell-bar',
  templateUrl: './shell-bar.html',
  styleUrl: './shell-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellBar {
  protected readonly t = SHELL_TEXTS;
  protected readonly store = inject(ShellStore);
  private readonly api = inject(ShellApi);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly output = viewChild<ElementRef<HTMLElement>>('output');
  private readonly cwdLabel = viewChild<ElementRef<HTMLElement>>('cwdLabel');
  /** Width of one character of the prompt font (measured once). */
  private charWidth = 0;

  private readonly uid = ++nextId;
  protected readonly inputId = `fnf-shell-input-${this.uid}`;
  protected readonly listId = `fnf-shell-list-${this.uid}`;

  protected readonly text = signal('');
  private nav: HistoryNav = NO_NAV;
  /** Suggestions are shown after typing, closed by Esc, Enter or ↑/↓ in the history. */
  private readonly listWanted = signal(false);
  protected readonly active = signal(-1);
  protected readonly suggestions = computed(() =>
    this.listWanted() ? suggestions(this.store.history(), this.text()) : [],
  );
  protected readonly listOpen = computed(() => this.suggestions().length > 0);
  protected readonly activeId = computed(() =>
    this.listOpen() && this.active() >= 0 ? `${this.listId}-${this.active()}` : null,
  );

  /** Characters the prompt may take (from the width of the bar). */
  private readonly promptChars = signal(40);
  protected readonly promptText = computed(() =>
    middleEllipsis(this.store.cwd() ?? '', this.promptChars()),
  );
  protected readonly placeholder = computed(() => {
    switch (this.store.locked()) {
      case 'disabled':
        return this.t.placeholderDisabled;
      case 'archive':
        return this.t.placeholderArchive;
      case 'noFolder':
        return this.t.placeholderNoFolder;
      default:
        return this.t.placeholder;
    }
  });

  /** Follows the end of the output unless the user scrolled up. */
  private stick = true;
  private drag: { y: number; height: number } | null = null;

  constructor() {
    // focus requests (TOGGLE_SHELL, inserting) – after the bar is rendered
    effect(() => {
      const n = this.store.focusRequest();
      if (n > 0) {
        afterNextRender(() => this.field()?.nativeElement.focus(), { injector: this.injector });
      }
    });
    effect(() => {
      const req = this.store.insertRequest();
      if (req) {
        untracked(() => {
          this.insertAtCaret(req.text);
          // consumed: a bar shown again later must not insert it once more (review 021 #4)
          this.store.insertRequest.set(null);
        });
      }
    });
    afterRenderEffect(() => {
      this.store.segments();
      const el = this.output()?.nativeElement;
      if (el && this.stick) {
        el.scrollTop = el.scrollHeight;
      }
    });
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // the prompt gets at most 40 % of the bar (`.cwd { max-width: 40% }`), minus "> "
      this.promptChars.set(Math.max(12, Math.floor((w * 0.4) / this.measureChar()) - 2));
    });
    ro.observe(this.host.nativeElement);
    inject(DestroyRef).onDestroy(() => {
      ro.disconnect();
      this.store.fieldFocused.set(false);
    });
  }

  /** Monospace: one character's width in the label's font (canvas, no layout needed). */
  private measureChar(): number {
    if (this.charWidth > 0) {
      return this.charWidth;
    }
    const label = this.cwdLabel()?.nativeElement;
    const ctx = label ? document.createElement('canvas').getContext('2d') : null;
    if (label && ctx) {
      ctx.font = getComputedStyle(label).font;
      const w = ctx.measureText('0000000000').width / 10;
      if (w > 0) {
        this.charWidth = w;
        return w;
      }
    }
    return 9;
  }

  // ---- input ----

  protected onInput(e: Event): void {
    this.text.set((e.target as HTMLInputElement).value);
    this.nav = NO_NAV;
    this.listWanted.set(true);
    this.active.set(-1);
  }

  protected onFocus(): void {
    this.store.fieldFocused.set(true);
  }

  protected onBlur(): void {
    this.store.fieldFocused.set(false);
    this.listWanted.set(false);
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.isComposing) {
      return;
    }
    switch (e.key) {
      case 'Enter':
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
          return; // Mod+Shift+Enter etc. are actions (inserting names)
        }
        e.preventDefault();
        if (this.listOpen() && this.active() >= 0) {
          this.accept(this.suggestions()[this.active()]);
        } else {
          void this.runLine();
        }
        return;
      case 'ArrowUp':
      case 'ArrowDown': {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
          return;
        }
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (this.listOpen()) {
          // -1 = the typed text; ↓ walks down the list and back to it
          const n = this.suggestions().length;
          this.active.update((a) => {
            const next = a + (dir === 1 ? 1 : -1);
            return next >= n ? -1 : next < -1 ? n - 1 : next;
          });
          return;
        }
        const step = historyStep(this.store.history(), this.nav, this.text(), dir);
        if (step) {
          this.nav = step.nav;
          this.setText(step.text);
        }
        return;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (this.listOpen()) {
          this.listWanted.set(false);
        } else if (this.store.busy()) {
          this.store.cancel();
        } else if (this.text()) {
          this.nav = NO_NAV;
          this.setText('');
        } else {
          this.store.focusList();
        }
        return;
      case 'c':
      case 'C': {
        // Ctrl+C (also on macOS: Ctrl, not ⌘) stops a running command when no text is selected
        const el = e.target as HTMLInputElement;
        if (
          e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          this.store.busy() &&
          el.selectionStart === el.selectionEnd
        ) {
          e.preventDefault();
          this.store.cancel();
        }
        return;
      }
    }
  }

  protected pick(value: string, e: MouseEvent): void {
    e.preventDefault(); // keep the focus in the field
    this.accept(value);
  }

  private accept(value: string): void {
    this.setText(value);
    this.listWanted.set(false);
    this.active.set(-1);
  }

  private setText(value: string): void {
    this.text.set(value);
    const el = this.field()?.nativeElement;
    if (el) {
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
  }

  /** Enter: the one place a typed line is handed to Rust. */
  private async runLine(): Promise<void> {
    const line = this.text().trim();
    const cwd = this.store.cwd();
    if (this.store.busy()) {
      this.store.busyHint();
      return;
    }
    if (!line || cwd === null || this.store.locked() !== null) {
      return;
    }
    this.nav = NO_NAV;
    this.setText('');
    this.listWanted.set(false);
    this.stick = true;
    this.store.beginRun(cwd, line);
    try {
      this.store.apply(await this.api.run(cwd, line));
    } catch (err) {
      this.store.fail(err);
    }
  }

  private insertAtCaret(text: string): void {
    const el = this.field()?.nativeElement;
    if (!el || el.disabled) {
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const pre = before && !before.endsWith(' ') ? ' ' : '';
    const post = after && !after.startsWith(' ') ? ' ' : after ? '' : ' ';
    const insert = `${pre}${text}${post}`;
    el.setRangeText(insert, start, end, 'end');
    this.text.set(el.value);
    this.nav = NO_NAV;
  }

  // ---- output ----

  protected onScroll(): void {
    const el = this.output()?.nativeElement;
    if (el) {
      this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    }
  }

  protected onGripDown(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.drag = { y: e.clientY, height: this.store.outputHeight() };
  }

  protected onGripMove(e: PointerEvent): void {
    if (this.drag) {
      this.store.setOutputHeight(this.drag.height + (this.drag.y - e.clientY));
    }
  }

  protected onGripUp(): void {
    this.drag = null;
  }

  protected onGripKey(e: KeyboardEvent): void {
    const h = this.store.outputHeight();
    const step = e.shiftKey ? 64 : 16;
    const next =
      e.key === 'ArrowUp'
        ? h + step
        : e.key === 'ArrowDown'
          ? h - step
          : e.key === 'Home'
            ? OUTPUT_MAX
            : e.key === 'End'
              ? OUTPUT_MIN
              : null;
    if (next !== null) {
      e.preventDefault();
      this.store.setOutputHeight(next);
    }
  }

  protected readonly min = OUTPUT_MIN;
  protected readonly max = OUTPUT_MAX;
}
