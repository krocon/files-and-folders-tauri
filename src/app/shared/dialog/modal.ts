import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

let modalSeq = 0;

/**
 * Modal frame: `role="dialog"` + `aria-modal`, focus trap, Escape closes, focus
 * goes to the first `[data-autofocus]` (or first focusable) element. The opener gets
 * the focus back through {@link DialogService.close}.
 */
@Component({
  selector: 'app-modal',
  template: `
    <div class="backdrop" (pointerdown)="onBackdrop($event)">
      <div
        class="dialog"
        [attr.role]="role()"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        [style.width]="width()"
      >
        <h2 class="title" [id]="titleId">{{ heading() }}</h2>
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class Modal {
  readonly heading = input.required<string>();
  readonly width = input('34rem');
  /** `alertdialog` for questions that interrupt work (conflicts). */
  readonly role = input<'dialog' | 'alertdialog'>('dialog');
  readonly closed = output<void>();
  protected readonly titleId = `fnf-modal-${++modalSeq}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Escape') {
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
    }
  }

  private focusables(): HTMLElement[] {
    return [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]',
      ),
    ];
  }
}
