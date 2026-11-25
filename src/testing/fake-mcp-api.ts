import { McpApi } from '../app/core/mcp/mcp-api';
import { MCP_OFF, McpEvent, McpStatus, McpUiReply, McpUiState } from '../app/core/mcp/mcp.models';

/** In-memory MCP facade: records what the window reports and answers; tests send events. */
export class FakeMcpApi extends McpApi {
  statusNow: McpStatus = MCP_OFF;
  readonly published: McpUiState[] = [];
  readonly replies: { id: number; reply: McpUiReply }[] = [];
  readonly disconnected: (number | null)[] = [];
  syncs = 0;
  private listener: ((event: McpEvent) => void) | null = null;

  subscribe(onEvent: (event: McpEvent) => void): Promise<McpStatus> {
    this.listener = onEvent;
    return Promise.resolve(this.statusNow);
  }

  sync(): Promise<McpStatus> {
    this.syncs++;
    return Promise.resolve(this.statusNow);
  }

  publishState(state: McpUiState): Promise<void> {
    this.published.push(state);
    return Promise.resolve();
  }

  reply(id: number, reply: McpUiReply): Promise<void> {
    this.replies.push({ id, reply });
    return Promise.resolve();
  }

  status(): Promise<McpStatus> {
    return Promise.resolve(this.statusNow);
  }

  disconnect(connection: number | null): Promise<void> {
    this.disconnected.push(connection);
    return Promise.resolve();
  }

  /** An event from Rust. */
  emit(event: McpEvent): void {
    this.listener?.(event);
  }

  replyTo(id: number): McpUiReply | undefined {
    return this.replies.find((r) => r.id === id)?.reply;
  }
}
