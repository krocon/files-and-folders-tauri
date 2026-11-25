import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { logTime } from './mcp-logic';
import { MCP_TEXTS } from './mcp-texts';
import { McpStore } from './mcp.store';

/** The log is read again this often while the dialog is open. */
export const LOG_POLL_MS = 1000;

/**
 * MCP_SHOW_LOG (design 071, rule 3): who is connected, "Disconnect", and the calls of
 * this session – tool, time, client, a count and the result. No paths (rule 9).
 */
@Component({
  selector: 'app-mcp-log-dialog',
  imports: [Modal, DialogKey],
  template: `
    <app-modal [heading]="t.logTitle" width="min(52rem, 94vw)" (closed)="dialogs.close()">
      <div class="body">
        <p class="state" role="status" data-testid="mcp-state">{{ stateText() }}</p>
        <h3>{{ t.clients }}</h3>
        @if (mcp.status().clients.length === 0) {
          <p class="muted">{{ t.noClients }}</p>
        } @else {
          <ul class="clients">
            @for (c of mcp.status().clients; track c.connection) {
              <li>
                <span class="name">{{ c.name }}</span>
                <span class="muted">
                  {{ t.since(time(c.sinceMs)) }} · {{ t.calls(c.calls) }}
                  @if (!c.paired) {
                    · {{ t.notPaired }}
                  }
                </span>
                <button
                  type="button"
                  class="btn"
                  data-no-dialog-key
                  [attr.aria-label]="t.disconnect + ': ' + c.name"
                  (click)="mcp.disconnect(c.connection)"
                >
                  {{ t.disconnect }}
                </button>
              </li>
            }
          </ul>
        }
        <h3>{{ t.log }}</h3>
        <p class="muted">{{ t.logNote }}</p>
        @if (lines().length === 0) {
          <p class="muted">{{ t.noCalls }}</p>
        } @else {
          <div class="log" tabindex="0" role="region" [attr.aria-label]="t.log">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ t.colTime }}</th>
                  <th scope="col">{{ t.colClient }}</th>
                  <th scope="col">{{ t.colTool }}</th>
                  <th scope="col" class="num">{{ t.colCount }}</th>
                  <th scope="col">{{ t.colOutcome }}</th>
                </tr>
              </thead>
              <tbody>
                @for (l of lines(); track $index) {
                  <tr>
                    <td>{{ time(l.atMs) }}</td>
                    <td>{{ l.client }}</td>
                    <td>{{ l.tool }}</td>
                    <td class="num">{{ l.count }}</td>
                    <td>{{ l.outcome }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <div class="buttons">
          <button
            type="button"
            class="btn"
            appDialogKey="secondary:D"
            data-testid="mcp-disconnect-all"
            [disabled]="mcp.status().clients.length === 0"
            (click)="mcp.disconnect(null)"
          >
            {{ t.disconnectAll }}
          </button>
          <button
            type="button"
            class="btn primary"
            appDialogKey="primary"
            data-autofocus
            (click)="dialogs.close()"
          >
            {{ t.close }}
          </button>
        </div>
      </div>
    </app-modal>
  `,
  styles: `
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
    }
    p,
    h3 {
      margin: 0;
    }
    h3 {
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-2);
    }
    .muted {
      color: var(--color-muted);
    }
    .clients {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      li {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
      }
      .name {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .btn {
        margin-left: auto;
      }
    }
    .log {
      max-height: 40vh;
      overflow: auto;
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-sm);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: 2px var(--spacing-2);
      text-align: left;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--color-surface);
    }
    .num {
      text-align: right;
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
export class McpLogDialog {
  protected readonly t = MCP_TEXTS;
  protected readonly mcp = inject(McpStore);
  protected readonly dialogs = inject(DialogService);
  protected readonly time = logTime;
  /** Newest first. */
  protected readonly lines = computed(() => [...this.mcp.status().log].reverse());
  protected readonly stateText = computed(() => {
    const s = this.mcp.status();
    if (!s.enabled) {
      return this.t.off;
    }
    if (s.listening) {
      return this.t.listening;
    }
    return this.t.notListening(this.t.reasons[s.error ?? ''] ?? this.t.unknownReason);
  });

  constructor() {
    const timer = setInterval(() => void this.mcp.refresh(), LOG_POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
