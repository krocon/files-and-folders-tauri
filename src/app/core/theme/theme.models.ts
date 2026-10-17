/**
 * Colour scheme DTOs (design 013 §4). Keep in sync with Rust `src-tauri/src/themes.rs`.
 */

/** A colour scheme: CSS values per token (`--color-…` → `#fff` | `var(--other)` | …). */
export interface Theme {
  /** `[a-z0-9-]`; built-in: `light`, `dark` (019: the old designs); own: `user-…`. */
  readonly id: string;
  readonly name: string;
  /** Dark scheme: `color-scheme`, `html[data-theme]` of the table, fallback scheme. */
  readonly dark: boolean;
  readonly tokens: Readonly<Record<string, string>>;
  /** Shipped with the app (read-only); never written to the file. */
  readonly builtIn?: boolean;
}

export type ThemeMode = 'system' | 'fixed';

export interface ThemeSelection {
  readonly mode: ThemeMode;
  /** Scheme for `fixed`. */
  readonly theme: string;
  /** Schemes `system` uses for a light / dark system. */
  readonly light: string;
  readonly dark: string;
}

export interface ThemesFile {
  readonly version: 1;
  readonly selection: ThemeSelection;
  readonly themes: readonly Theme[];
}

export interface LoadedThemes {
  readonly file: ThemesFile;
  readonly warning: string | null;
}

export const DEFAULT_SELECTION: ThemeSelection = {
  mode: 'system',
  theme: 'light',
  light: 'light',
  dark: 'dark',
};

export const EMPTY_THEMES_FILE: ThemesFile = {
  version: 1,
  selection: DEFAULT_SELECTION,
  themes: [],
};
