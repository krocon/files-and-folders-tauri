import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';
import { Modal } from './modal';

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
          <button type="button" class="btn" data-autofocus (click)="confirm.answer(false)">
            Cancel
          </button>
          <button type="button" class="btn danger" (click)="confirm.answer(true)">
            {{ r.confirmLabel }}
          </button>
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
    .danger {
      color: var(--color-danger-text);
      border-color: var(--color-danger);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  protected readonly confirm = inject(ConfirmService);
}
