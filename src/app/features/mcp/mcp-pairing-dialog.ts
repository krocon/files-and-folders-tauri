import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { Modal } from '../../shared/dialog/modal';
import { MCP_TEXTS } from './mcp-texts';
import { McpStore } from './mcp.store';

/**
 * "‹client› wants to work with Files and Folders" (design 071 E4): deny / once / always.
 * No button takes Enter – the focus starts on Deny, Esc denies. The name is text from
 * outside and cannot be verified; the dialog says so.
 */
@Component({
  selector: 'app-mcp-pairing-dialog',
  imports: [Modal, DialogKey],
  template: `
    @if (mcp.pairing(); as p) {
      <app-modal
        [heading]="t.pairTitle"
        dialogRole="alertdialog"
        describedBy="fnf-mcp-pair-question"
        width="34rem"
        (closed)="mcp.decide('deny')"
      >
        <div class="body">
          <p id="fnf-mcp-pair-question" class="question" data-testid="mcp-pair-question">
            <strong>{{ t.pairQuestion(p.client) }}</strong>
          </p>
          <p>{{ t.pairWhat }}</p>
          <p>{{ mcp.status().allowContent ? t.pairContentOn : t.pairContentOff }}</p>
          <p class="muted">{{ t.pairName }}</p>
          <div class="buttons">
            <button
              type="button"
              class="btn"
              appDialogKey="cancel"
              data-autofocus
              data-testid="mcp-pair-deny"
              (click)="mcp.decide('deny')"
            >
              {{ t.deny }}
            </button>
            <button
              type="button"
              class="btn"
              appDialogKey="secondary:L"
              data-testid="mcp-pair-always"
              (click)="mcp.decide('always')"
            >
              {{ t.always }}
            </button>
            <button
              type="button"
              class="btn"
              appDialogKey="secondary:O"
              data-testid="mcp-pair-once"
              (click)="mcp.decide('once')"
            >
              {{ t.once }}
            </button>
          </div>
        </div>
      </app-modal>
    }
  `,
  styles: `
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
    }
    p {
      margin: 0;
    }
    .question {
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--color-muted);
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--spacing-2);
      margin-top: var(--spacing-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpPairingDialog {
  protected readonly t = MCP_TEXTS;
  protected readonly mcp = inject(McpStore);
}
