import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { LoadedThemes, ThemesFile } from './theme.models';

/** Scheme content as written to an export file (no `id`, no `builtIn`). */
export interface ThemeFileContent {
  readonly name: string;
  readonly dark: boolean;
  readonly tokens: Readonly<Record<string, string>>;
}

/** The old format (design 019): `{ name, colors: { "--fnf-…": … } }`. */
export interface LegacyThemeFileContent {
  readonly name: string;
  readonly colors: Readonly<Record<string, string>>;
}

/**
 * Facade for the colour scheme commands (Rust `themes.rs`, design 013 §4).
 * Rejects with an `FsError`.
 */
export abstract class ThemeApi {
  abstract load(): Promise<LoadedThemes>;
  abstract save(file: ThemesFile): Promise<void>;
  /** Reads a scheme file (≤ 256 KiB JSON object); the caller normalises it. */
  abstract importFile(path: string): Promise<unknown>;
  /** Writes `<name>.theme.json` into `dir` (never overwrites); resolves with the path. */
  abstract exportFile(
    dir: string,
    name: string,
    theme: ThemeFileContent | LegacyThemeFileContent,
  ): Promise<string>;
}

@Injectable()
export class TauriThemeApi extends ThemeApi {
  load(): Promise<LoadedThemes> {
    return call<LoadedThemes>('load_themes', {});
  }

  save(file: ThemesFile): Promise<void> {
    return call<void>('save_themes', { file });
  }

  importFile(path: string): Promise<unknown> {
    return call<unknown>('import_theme', { path });
  }

  exportFile(
    dir: string,
    name: string,
    theme: ThemeFileContent | LegacyThemeFileContent,
  ): Promise<string> {
    return call<string>('export_theme', { dir, name, theme });
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}
