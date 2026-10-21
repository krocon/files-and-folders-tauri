/**
 * DTOs of design 011 (OS integration, external tools). Keep in sync with Rust
 * `platform/volumes.rs` and `tools.rs`.
 */

export type VolumeKind = 'fixed' | 'removable' | 'network' | 'optical' | 'ram' | 'unknown';

export interface Volume {
  readonly path: string;
  readonly label: string;
  readonly kind: VolumeKind;
  readonly fsType: string | null;
  readonly total: number | null;
  readonly free: number | null;
  /** False: did not answer in time (dead network mount) or could not be read. */
  readonly reachable: boolean;
}

/** A configured tool as the frontend sees it – it never sends program or arguments back. */
export interface ToolInfo {
  readonly id: string;
  readonly label: string;
  /** Keymap notation (`Mod+Shift+E`), or null. */
  readonly shortcut: string | null;
  readonly perFile: boolean;
  readonly fileLimit: number;
  /** Uses `{file}`, `{files}`, `{name}`, `{stem}` or `{ext}`. */
  readonly needsFiles: boolean;
  /** For display only. */
  readonly program: string;
}

export interface LoadedTools {
  readonly tools: readonly ToolInfo[];
  readonly warnings: readonly string[];
  /** Path of `tools.json` (may not exist yet). */
  readonly file: string | null;
}

/** What a tool works on; the backend checks every path. */
export interface ToolContext {
  readonly files: readonly string[];
  readonly dir: string | null;
  readonly targetDir: string | null;
}
