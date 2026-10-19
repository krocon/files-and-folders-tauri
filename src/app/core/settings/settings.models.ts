import schemaJson from './settings-schema.json';

/**
 * Settings DTOs and schema (design 015 E2). The schema JSON is shared with Rust
 * (`settings.rs` includes it); keep `SettingsValues` in sync with it (spec).
 */
export interface SettingsValues {
  'general.language': 'system' | 'en' | 'de';
  'general.startFolder': 'session' | 'home';
  'view.sizeFormat': 'binary' | 'decimal' | 'bytes';
  'view.dateFormat': 'locale' | 'iso';
  'view.density': 'condensed' | 'normal' | 'spacious';
  'view.folderBrackets': boolean;
  'view.hideExtension': boolean;
  'view.showHidden': boolean;
  'view.menuBar': boolean;
  'behavior.deleteToTrash': boolean;
  'behavior.confirmTrash': boolean;
  'behavior.doubleClick': 'open' | 'view';
  'behavior.spaceCalcSize': boolean;
  'watch.pollNetwork': boolean;
  'search.recent': readonly unknown[];
}

export type SettingKey = keyof SettingsValues;

export type SettingSpec =
  | { readonly type: 'bool'; readonly default: boolean }
  | { readonly type: 'enum'; readonly values: readonly string[]; readonly default: string }
  | { readonly type: 'int'; readonly min: number; readonly max: number; readonly default: number }
  | {
      readonly type: 'json';
      readonly default: unknown;
      readonly maxItems: number;
      readonly maxBytes: number;
    };

export const SCHEMA = schemaJson as unknown as Readonly<Record<SettingKey, SettingSpec>>;
export const SETTING_KEYS = Object.keys(SCHEMA) as SettingKey[];

export const DEFAULTS: SettingsValues = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, SCHEMA[k].default]),
) as unknown as SettingsValues;

/** Row height per density (px); `normal` = the list's `ROW_HEIGHT` (30 px), `spacious` = mr's 34 px. */
export const ROW_HEIGHTS: Readonly<Record<SettingsValues['view.density'], number>> = {
  condensed: 24,
  normal: 30,
  spacious: 34,
};

/** Same rules as Rust `Spec::accepts`. */
export function acceptsValue(spec: SettingSpec, v: unknown): boolean {
  switch (spec.type) {
    case 'bool':
      return typeof v === 'boolean';
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v);
    case 'int':
      return Number.isInteger(v) && (v as number) >= spec.min && (v as number) <= spec.max;
    case 'json':
      return (
        Array.isArray(v) &&
        v.length <= spec.maxItems &&
        new TextEncoder().encode(JSON.stringify(v)).length <= spec.maxBytes
      );
  }
}

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SCHEMA, key);
}

/** Equal by value (JSON) – a value equal to the default is not stored. */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export type SettingsWarningCode =
  | 'broken'
  | 'unreadable'
  | 'newer_version'
  | 'invalid_value'
  | 'unknown_dropped'
  | 'not_saved'
  | 'part_skipped'
  | 'part_failed';

export interface SettingsWarning {
  readonly code: SettingsWarningCode | string;
  readonly key: string | null;
  readonly path: string | null;
}

export interface LoadedSettings {
  /** Values that differ from the defaults (plus unknown keys of a newer version). */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly warnings: readonly SettingsWarning[];
  readonly persist: boolean;
}

export type SettingsPart = 'settings' | 'keymap' | 'themes' | 'renamePresets' | 'tools';
export const SETTINGS_PARTS: readonly SettingsPart[] = [
  'settings',
  'keymap',
  'themes',
  'renamePresets',
  'tools',
];

export interface ImportReport {
  readonly imported: readonly SettingsPart[];
  readonly warnings: readonly SettingsWarning[];
}
