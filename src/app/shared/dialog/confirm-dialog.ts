import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';
import { Modal } from './modal';
import { ACTION_TEXTS } from '../../core/actions/action-texts';

@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal],
  template: `
    @if (confirm.request(); as r) {
      <app-modal [heading]="r.title" width="28rem" (closed)="confirm.answer(false)">
        <p class="message">{{ r.message }}</p>
        @if (r.detail) {
          <p class="detail">{{ r.detail }}</p>
        }
        <div class="buttons">
          @if (r.danger !== false) {
            <button type="button" class="btn" data-autofocus (click)="confirm.answer(false)">
              {{ t.cancel }}
            </button>
            <button type="button" class="btn danger" (click)="confirm.answer(true)">
              {{ r.confirmLabel }}
            </button>
          } @else {
            <button type="button" class="btn" (click)="confirm.answer(false)">
              {{ t.cancel }}
            </button>
            <button type="button" class="btn primary" data-autofocus (click)="confirm.answer(true)">
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
      border-color: var(--color-danger);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  protected readonly t = ACTION_TEXTS;
  protected readonly confirm = inject(ConfirmService);
}
