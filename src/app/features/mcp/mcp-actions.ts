import { ActionService } from '../../core/actions/action.service';
import { McpStore } from './mcp.store';

/**
 * MCP_SHOW_LOG and MCP_DISCONNECT_ALL (design 071, rule 3) – palette and menu
 * "Configuration", no default shortcut. Disconnecting is offered while someone is connected.
 */
export function registerMcpActions(actions: ActionService, mcp: McpStore): () => void {
  return actions.register({
    MCP_SHOW_LOG: { run: () => mcp.showLog() },
    MCP_DISCONNECT_ALL: {
      run: () => void mcp.disconnect(null),
      enabled: () => mcp.status().clients.length > 0,
    },
  });
}
