import { computed, Injectable, signal } from '@angular/core';
import { MCP_OFF, McpStatus } from './mcp.models';

/**
 * What the MCP interface does right now (design 071, rule 3): kept apart from the
 * `McpStore` so that small parts of the window (the button bar) can show it without
 * knowing the panels.
 */
@Injectable({ providedIn: 'root' })
export class McpStatusService {
  readonly status = signal<McpStatus>(MCP_OFF);
  /** Clients connected right now – shown as long as there is one. */
  readonly clients = computed(() => this.status().clients);
}
