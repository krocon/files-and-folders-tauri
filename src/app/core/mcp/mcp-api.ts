import { Injectable } from '@angular/core';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { MCP_OFF, McpEvent, McpStatus, McpUiReply, McpUiState } from './mcp.models';

/**
 * Facade of the MCP commands (Rust `commands/mcp.rs`, design 071). The settings
 * (`mcp.enabled` …) are not sent: Rust reads them from `settings.json` – `sync` only
 * says "read them again". Rejects with an `FsError`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriMcpApi() })
export abstract class McpApi {
  /** Requests to the window and status changes; returns the current status. */
  abstract subscribe(onEvent: (event: McpEvent) => void): Promise<McpStatus>;
  /** The settings were saved: apply the `mcp.*` values. */
  abstract sync(): Promise<McpStatus>;
  abstract publishState(state: McpUiState): Promise<void>;
  abstract reply(id: number, reply: McpUiReply): Promise<void>;
  abstract status(): Promise<McpStatus>;
  /** One connection, or all (`null`). */
  abstract disconnect(connection: number | null): Promise<void>;
}

@Injectable()
export class TauriMcpApi extends McpApi {
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw toFsError(err);
    }
  }

  async subscribe(onEvent: (event: McpEvent) => void): Promise<McpStatus> {
    if (!isTauri()) {
      return MCP_OFF;
    }
    const channel = new Channel<McpEvent>();
    channel.onmessage = onEvent;
    return this.call('subscribe_mcp', { onEvent: channel });
  }

  sync(): Promise<McpStatus> {
    return isTauri() ? this.call('mcp_sync') : Promise.resolve(MCP_OFF);
  }

  publishState(state: McpUiState): Promise<void> {
    return isTauri() ? this.call('mcp_publish_state', { state }) : Promise.resolve();
  }

  reply(id: number, reply: McpUiReply): Promise<void> {
    return isTauri() ? this.call('mcp_reply', { id, reply }) : Promise.resolve();
  }

  status(): Promise<McpStatus> {
    return isTauri() ? this.call('mcp_status') : Promise.resolve(MCP_OFF);
  }

  disconnect(connection: number | null): Promise<void> {
    return isTauri() ? this.call('mcp_disconnect', { connection }) : Promise.resolve();
  }
}
