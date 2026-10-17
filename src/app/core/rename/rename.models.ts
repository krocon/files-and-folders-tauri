/**
 * Multi-rename DTOs (design 007). Keep in sync with `src-tauri/src/jobs/rename.rs`
 * and `src-tauri/src/rename_presets.rs`.
 */
import { FsError } from '../fs/fs.models';

/** One entry and the name it should get in its folder (`path` stays opaque). */
export interface RenameItem {
  readonly path: string;
  readonly newName: string;
}

export type PlanStatus = 'ok' | 'unchanged' | 'error';

export interface PlanRow {
  readonly status: PlanStatus;
  readonly error: FsError | null;
}

/** Result of `plan_rename`: one row per pair, same order. */
export interface RenamePlan {
  readonly rows: readonly PlanRow[];
  readonly ok: number;
  readonly unchanged: number;
  readonly errors: number;
}

export interface RenamePreset {
  readonly name: string;
  /** `RenameRules` – Rust stores them without looking inside. */
  readonly rules: unknown;
}

export interface RenamePresets {
  readonly version: 1;
  readonly last: unknown | null;
  readonly presets: readonly RenamePreset[];
}

export interface LoadedPresets {
  readonly presets: RenamePresets;
  readonly warning: string | null;
}

export const EMPTY_PRESETS: RenamePresets = { version: 1, last: null, presets: [] };
