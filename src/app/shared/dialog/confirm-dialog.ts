import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';
import { Modal } from './modal';
import { DialogKey, DialogKeySpec, letterFor } from './dialog-key';
import { ACTION_TEXTS } from '../../core/actions/action-texts';

@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal, DialogKey],
  template: `
    @if (confirm.request(); as r) {
      <app-modal [heading]="r.title" width="28rem" (closed)="confirm.answer(false)">
        <p class="message">{{ r.message }}</p>
        @if (r.detail) {
          <p class="detail">{{ r.detail }}</p>
        }
        <div class="buttons">
          @if (r.danger !== false) {
            <button
              appDialogKey="cancel"
              type="button"
              class="btn"
              data-autofocus
              (click)="confirm.answer(false)"
            >
              {{ t.cancel }}
            </button>
            <button
              [appDialogKey]="dangerKey()"
              type="button"
              class="btn danger"
              (click)="confirm.answer(true)"
            >
              {{ r.confirmLabel }}
            </button>
          } @else {
            <button appDialogKey="cancel" type="button" class="btn" (click)="confirm.answer(false)">
              {{ t.cancel }}
            </button>
            <button
              appDialogKey="primary"
              type="button"
              class="btn primary"
              data-autofocus
              (click)="confirm.answer(true)"
            >
              {{ r.confirmLabel }}
            </button>
          }
        </div>
      </app-modal>
    }
  `,
  styles: `
    .message {
      margin: 0;
    }
    .detail {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      word-break: break-all;
      color: var(--color-muted);
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-2);
    }
    .primary {
      color: var(--color-button-primary-text);
      background: var(--color-button-primary-bg);
      border-color: var(--color-button-primary-bg);
    }
    .danger {
      color: var(--color-danger-text);
      background: var(--color-danger-bg);
      border-color: var(--color-danger);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  protected readonly t = ACTION_TEXTS;
  protected readonly confirm = inject(ConfirmService);
  /**
   * A dangerous confirmation is never Enter (design 057 E2): Mod+Shift+<first letter
   * of its label>, e.g. ⇧⌘D for "Delete".
   */
  protected readonly dangerKey = computed<DialogKeySpec>(() => {
    const letter = letterFor(this.confirm.request()?.confirmLabel ?? '');
    return letter ? `destructive:${letter}` : null;
  });
}
