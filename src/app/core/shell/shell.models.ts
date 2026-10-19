/**
 * Shell bar DTOs (design 021). Keep in sync with `src-tauri/src/commands/shell.rs`
 * and `src-tauri/src/jobs/shell.rs`.
 */

/** What `run_shell` did with a line. */
export type ShellRunResult =
  | { readonly type: 'started'; readonly jobId: string; readonly notices: readonly string[] }
  /** `cd`: the active panel goes there. */
  | { readonly type: 'navigate'; readonly path: string }
  /** `cd -`: the active panel goes back. */
  | { readonly type: 'back' }
  /** `clear` / `cls`. */
  | { readonly type: 'clear' };

export type ShellStream = 'stdout' | 'stderr';

/** Cleaned text of one stream (no ANSI, `\n` line ends). */
export interface ShellChunk {
  readonly stream: ShellStream;
  readonly text: string;
}

export interface ShellSummary {
  readonly exitCode: number | null;
  /** Unix: the signal that ended the shell. */
  readonly signal: number | null;
}
