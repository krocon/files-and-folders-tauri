/**
 * DTOs of the starter menu (design 032). Keep in sync with Rust `starter.rs` and
 * `commands/starter.rs` by hand.
 */
import { ConfigWarning } from '../config/config.models';

export type StarterKind = 'program' | 'folder' | 'submenu' | 'separator';

/** One entry as stored in `starter.json` (empty strings are left out by Rust). */
export interface StarterItem {
  readonly id: string;
  readonly kind: StarterKind;
  readonly label?: string;
  /** Program or script: a name found in `PATH` or an absolute path (`~` allowed). */
  readonly program?: string;
  /** One line, Total Commander style (`"%P%N" -x`); every word is one argument. */
  readonly params?: string;
  /** Start folder (placeholders, `~`); empty = folder of the active panel. */
  readonly workingDir?: string;
  /** Folder entries: where the active panel goes. */
  readonly folder?: string;
  /** Keymap notation (`Alt+1`). */
  readonly shortcut?: string | null;
  readonly items?: readonly StarterItem[];
}

export type StarterProblemCode =
  | 'label'
  | 'program'
  | 'folder'
  | 'params_quote'
  | 'params_files'
  | 'working_dir'
  | 'too_deep'
  | 'too_long';

export interface StarterProblem {
  readonly id: string;
  readonly code: StarterProblemCode;
}

export interface LoadedStarter {
  readonly items: readonly StarterItem[];
  readonly warning: ConfigWarning | null;
  readonly problems: readonly StarterProblem[];
  /** Path of `starter.json` (may not exist yet). */
  readonly file: string | null;
}

export interface SavedStarter {
  /** False: nothing was written, see `problems`. */
  readonly saved: boolean;
  readonly items: readonly StarterItem[];
  readonly problems: readonly StarterProblem[];
}

/** What an entry works on; Rust checks every path. */
export interface StarterContext {
  /** Marked entries (else the cursor) in display order – `%S`. */
  readonly files: readonly string[];
  /** The entry under the cursor – `%P%N`, `%N`, `%O`, `%E`. */
  readonly cursor: string | null;
  readonly dir: string | null;
  readonly targetDir: string | null;
}

export type StarterRun =
  | { readonly kind: 'started'; readonly count: number }
  | { readonly kind: 'folder'; readonly path: string };

/** Same limits as Rust. */
export const MAX_STARTER_ITEMS = 500;
export const MAX_STARTER_DEPTH = 5;
export const MAX_STARTER_LABEL = 100;
