import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ProposalService } from '../../core/mcp/proposal.service';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { Modal } from '../../shared/dialog/modal';
import { MCP_TEXTS } from './mcp-texts';
import { McpStore } from './mcp.store';

/**
 * "‹client› wants to work with Files and Folders" (design 071 E4): deny / once / always.
 * No button takes Enter – the focus starts on Deny, Esc denies; allowing is a click on a
 * button that is locked for a moment (no shortcut: `Mod+L` and `Mod+O` are keys of the panel). The name is text from
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
            <span class="muted keys">{{ t.pairKeys }}</span>
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
            <!-- a yes is a click, never a key (review #3) – and not before the lock ran out -->
            <button
              type="button"
              class="btn"
              data-no-dialog-key
              data-testid="mcp-pair-always"
              [disabled]="!armed()"
              (click)="mcp.decide('always')"
            >
              {{ t.always }}
            </button>
            <button
              type="button"
              class="btn"
              data-no-dialog-key
              data-testid="mcp-pair-once"
              [disabled]="!armed()"
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
    .keys {
      flex: 1 1 10rem;
      align-self: center;
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
  /** The buttons that allow are locked until the keyboard was quiet for a moment. */
  protected readonly armed = inject(ProposalService).armed;
}
