/**
 * DTOs of the double-click actions (design 072). Keep in sync with Rust `file_actions.rs`
 * and `commands/file_actions.rs` by hand.
 */
import { ConfigWarning } from '../config/config.models';

/** What sets a rule off – for now only the double click on a file. */
export type FileActionTrigger = 'doubleClick';

/** The kinds the dialog offers (catalog, design 073 E18). */
export const FILE_ACTION_TRIGGERS: readonly FileActionTrigger[] = ['doubleClick'];

/**
 * A key held with the trigger (design 073 E11): `mod` is ⌘ on macOS and Ctrl elsewhere.
 * No own `ctrl`: on macOS Ctrl+click is the context menu (E12).
 */
export type FileActionModifier = 'mod' | 'alt' | 'shift';

/** Canonical order, as in Rust (`Mod+Alt+Shift`). */
export const MODIFIER_ORDER: readonly FileActionModifier[] = ['mod', 'alt', 'shift'];

/** One rule as stored in `file-actions.json`. */
export interface FileActionRule {
  readonly id: string;
  readonly trigger: FileActionTrigger;
  /** Keys held with the trigger, canonical order; empty = no key (design 073). */
  readonly modifiers: readonly FileActionModifier[];
  /** Globs on the file name, separated by `;` or spaces (`*.js *.mjs`). */
  readonly pattern: string;
  /** Ask before running. */
  readonly confirm: boolean;
  /** One line, program first (`node %N`); every word is one argument, no shell. */
  readonly command: string;
  /** Show it in a terminal window that stays open, instead of in the background. */
  readonly terminal: boolean;
}

export type FileActionProblemCode =
  'trigger' | 'pattern' | 'program' | 'params_quote' | 'params_files' | 'too_long';

export interface FileActionProblem {
  readonly id: string;
  readonly code: FileActionProblemCode;
}

export interface LoadedFileActions {
  readonly rules: readonly FileActionRule[];
  readonly warning: ConfigWarning | null;
  readonly problems: readonly FileActionProblem[];
}

export interface SavedFileActions {
  /** False: nothing was written, see `problems`. */
  readonly saved: boolean;
  readonly rules: readonly FileActionRule[];
  readonly problems: readonly FileActionProblem[];
}

/** Same limit as Rust. */
export const MAX_FILE_ACTIONS = 200;
