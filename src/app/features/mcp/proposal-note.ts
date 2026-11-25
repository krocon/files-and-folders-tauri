import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MCP_TEXTS } from './mcp-texts';

/**
 * "Proposal from ‹client›" at the top of a dialog an MCP client opened (design 071,
 * rule 4). The name is text from outside: interpolated, never HTML.
 */
@Component({
  selector: 'app-proposal-note',
  template: `
    <p class="note" role="note" data-testid="proposal-note">
      <i class="fa fa-exchange" aria-hidden="true"></i>
      <span>
        <strong>{{ t.proposalFrom(client()) }}</strong>
        {{ t.proposalCheck }}
      </span>
    </p>
  `,
  styles: `
    .note {
      display: flex;
      gap: var(--spacing-2);
      align-items: baseline;
      margin: 0 0 var(--spacing-2);
      padding: var(--spacing-2);
      border: 1px solid var(--color-accent);
      border-radius: var(--radius-sm, 4px);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: var(--font-size-sm);
    }
    strong {
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalNote {
  readonly client = input.required<string>();
  protected readonly t = MCP_TEXTS;
}
