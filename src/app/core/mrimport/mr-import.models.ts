import { RawBindings } from '../actions/keymap';
import { ButtonSetsOverride, FileType } from '../config/config.models';
import { SettingsPart, SettingsWarning } from '../settings/settings.models';

/**
 * DTOs of the mr import (design 026, Rust `mr_import/mod.rs`). Keep in sync by hand.
 */

/** Why an entry of the old configuration is not transferred (Rust + frontend codes). */
export type MrSkipReason =
  | 'table_navigation'
  | 'no_equivalent'
  | 'unknown_action'
  | 'never_fired'
  | 'meta_key'
  | 'unknown_key'
  | 'removed'
  | 'too_many'
  | 'old_script'
  | 'invalid'
  | 'not_applicable'
  | 'too_big'
  | 'broken'
  | 'unreadable'
  // frontend (planning against the keymap)
  | 'invalid_shortcut'
  | 'reserved';

export interface MrSkipped {
  /** What it was in mr, e.g. `cmd+alt+up → NAVIGATE_BACK`. */
  readonly item: string;
  readonly reason: MrSkipReason;
}

export interface MrArea<T> {
  readonly file: string;
  /** `broken` | `too_big` | `unreadable`: the file could not be used. */
  readonly error: MrSkipReason | null;
  readonly items: T;
  /** Entries equal to mr's defaults (not imported). */
  readonly unchanged: number;
  readonly skipped: readonly MrSkipped[];
}

export interface MrShortcut {
  readonly id: string;
  /** Our notation, still to be checked (`canonicalShortcut`). */
  readonly shortcut: string;
  readonly source: string;
}

export interface MrPattern {
  readonly label: string;
  readonly extensions: readonly string[];
}

/** A tool in our format (Rust `tools::Tool`) – sent back unchanged when applying. */
export interface MrTool {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string | null;
  readonly program: string;
  readonly args: readonly string[];
  readonly perFile: boolean;
  readonly fileLimit: number;
  readonly workingDir?: string | null;
  readonly defaultApp?: boolean;
}

export interface MrColorFile {
  readonly name: string;
  readonly path: string;
}

/** `null` = the area's file does not exist. */
export interface MrScan {
  /** The `assets` folder found. */
  readonly root: string;
  readonly os: 'osx' | 'windows' | 'linux';
  readonly shortcuts: MrArea<readonly MrShortcut[]> | null;
  readonly buttons: MrArea<ButtonSetsOverride> | null;
  readonly fileTypes: MrArea<readonly FileType[]> | null;
  readonly search: MrArea<readonly MrPattern[]> | null;
  readonly tools: MrArea<readonly MrTool[]> | null;
  readonly colors: MrArea<readonly MrColorFile[]> | null;
  readonly setup: MrArea<Readonly<Record<string, unknown>>> | null;
}

/** What to write; planned in the frontend against the current state. */
export interface MrApply {
  readonly keymap?: RawBindings;
  readonly buttons?: ButtonSetsOverride;
  readonly fileTypes?: readonly FileType[];
  /** Only the keys to set (merged into `settings.json`). */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The `assets` folder of the scan: Rust reads the tools there again (programs never come from here). */
  readonly toolsFrom?: string;
  readonly toolsReplace?: boolean;
  /** Colours follow through the theme import – only `themes.json` is backed up. */
  readonly backupThemes?: boolean;
}

export interface MrApplyReport {
  readonly imported: readonly SettingsPart[];
  readonly warnings: readonly SettingsWarning[];
  readonly backups: readonly string[];
}
