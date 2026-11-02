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

/** Reason codes of a failed login environment read (design 061 E6b, `LoginEnvError::code`). */
export type LoginEnvReason =
  'notPosix' | 'spawn' | 'timeout' | 'noEof' | 'exitStatus' | 'incomplete' | 'noPath' | 'tooLarge';

/** Notice of `run_shell` when the login PATH could not be read: `loginEnvUnavailable:<reason>`. */
export const LOGIN_ENV_NOTICE = 'loginEnvUnavailable';

/** `shell_login_status` (design 061 E6b): no values, no paths. */
export interface LoginEnvStatus {
  readonly state: 'off' | 'notPosix' | 'running' | 'ok' | 'failed';
  readonly reason: LoginEnvReason | null;
  /** The mode that was used. */
  readonly mode: 'login' | 'loginInteractive' | null;
  readonly durationMs: number | null;
  /** File name of the shell program (`zsh`). */
  readonly shell: string;
  readonly pathEntries: number | null;
}

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
