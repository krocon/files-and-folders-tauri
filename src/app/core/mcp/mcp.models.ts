/**
 * DTOs of the MCP interface (design 071). Keep in sync with `src-tauri/src/mcp/`
 * (`mod.rs` status, `state.rs` mirror, `bridge.rs` requests and replies, `log.rs`).
 */
import { DirEntry } from '../fs/fs.models';
import { SearchHit } from '../search/search.models';
import { Side } from '../session/session.models';

export interface McpClient {
  readonly connection: number;
  /** What the client says about itself – not authentic. */
  readonly name: string;
  readonly sinceMs: number;
  readonly calls: number;
  readonly paired: boolean;
}

/** One call in the log – never a path, a name or content. */
export interface McpLogLine {
  readonly atMs: number;
  readonly client: string;
  readonly tool: string;
  readonly count: number;
  /** `ok`, `confirmed`, `cancelled`, `running`, `done` … or an error code. */
  readonly outcome: string;
}

export interface McpStatus {
  readonly enabled: boolean;
  readonly listening: boolean;
  /** Why it does not listen although it is on: `unsupported`, `in_use`, `socket_path_too_long`, `io`. */
  readonly error: string | null;
  readonly allowContent: boolean;
  readonly clients: readonly McpClient[];
  readonly log: readonly McpLogLine[];
}

export const MCP_OFF: McpStatus = {
  enabled: false,
  listening: false,
  error: null,
  allowContent: false,
  clients: [],
  log: [],
};

// ---- the mirror of the window ----

export type McpTabKind = 'folder' | 'search' | 'flat' | 'usage' | 'duplicates' | 'chart';

export interface McpEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: DirEntry['kind'];
  readonly size: number | null;
  readonly modifiedMs: number | null;
}

export interface McpTab {
  readonly id: string;
  readonly kind: McpTabKind;
  readonly title: string;
  readonly path: string | null;
}

export interface McpPanel {
  readonly tabs: readonly McpTab[];
  readonly activeTab: number;
  /** The folder shown; null for a result tab. */
  readonly folder: string | null;
  readonly cursor: McpEntry | null;
  readonly marked: readonly McpEntry[];
  readonly markedTotal: number;
  /** The listing comes from the cache and is not checked yet (design 030). */
  readonly unchecked: boolean;
}

export interface McpUiState {
  readonly activeSide: Side;
  readonly left: McpPanel;
  readonly right: McpPanel;
}

// ---- requests to the window ----

export interface McpRenamePair {
  readonly entry: DirEntry;
  readonly newName: string;
  readonly parentNames: readonly [string, string, string];
}

export type McpUiRequest =
  | { readonly kind: 'pair'; readonly client: string }
  | {
      readonly kind: 'navigate';
      readonly client: string;
      readonly side: Side;
      readonly path: string;
    }
  | {
      readonly kind: 'openTab';
      readonly client: string;
      readonly side: Side;
      readonly path: string;
      readonly title: string;
      readonly activate: boolean;
    }
  | {
      readonly kind: 'setCursor';
      readonly client: string;
      readonly side: Side;
      readonly path: string;
    }
  | {
      readonly kind: 'mark';
      readonly client: string;
      readonly side: Side;
      readonly paths: readonly string[];
      readonly mode: 'replace' | 'add' | 'remove';
    }
  | {
      readonly kind: 'quickView';
      readonly client: string;
      readonly side: Side;
      readonly path: string;
    }
  | {
      readonly kind: 'showResults';
      readonly client: string;
      readonly side: Side;
      readonly title: string;
      readonly hits: readonly SearchHit[];
      readonly roots: readonly string[];
    }
  | {
      readonly kind: 'proposeCopy' | 'proposeMove';
      readonly client: string;
      readonly entries: readonly DirEntry[];
      readonly sourceDir: string;
      readonly target: string;
    }
  | {
      readonly kind: 'proposeDelete';
      readonly client: string;
      readonly entries: readonly DirEntry[];
      readonly sourceDir: string;
    }
  | {
      readonly kind: 'proposeRename';
      readonly client: string;
      readonly folder: string;
      readonly pairs: readonly McpRenamePair[];
    }
  | {
      readonly kind: 'proposeMkdir';
      readonly client: string;
      readonly parent: string;
      readonly parentNames: readonly [string, string, string];
      readonly names: readonly string[];
    };

export type McpEvent =
  | { readonly type: 'request'; readonly id: number; readonly request: McpUiRequest }
  /** The request is over (time limit, the client gave up or was disconnected). */
  | { readonly type: 'withdraw'; readonly id: number }
  | { readonly type: 'status'; readonly status: McpStatus };

/** Codes the window may refuse a request with (Rust `bridge::REPLY_CODES`). */
export type McpReplyCode =
  'busy' | 'not_found' | 'invalid_arguments' | 'limit_exceeded' | 'not_available' | 'out_of_scope';

export type PairDecision = 'once' | 'always' | 'deny';

export interface McpUiReply {
  readonly ok: boolean;
  readonly code?: McpReplyCode;
  readonly outcome?: 'confirmed' | 'cancelled';
  readonly jobId?: string | null;
  readonly decision?: PairDecision;
}
