import { FsError } from '../app/core/fs/fs.models';
import { LegacyThemeFileContent, ThemeApi, ThemeFileContent } from '../app/core/theme/theme-api';
import { EMPTY_THEMES_FILE, LoadedThemes, ThemesFile } from '../app/core/theme/theme.models';

/** In-memory ThemeApi: `files` maps import paths to content (or an error). */
export class FakeThemeApi extends ThemeApi {
  loaded: LoadedThemes = { file: EMPTY_THEMES_FILE, warning: null };
  readonly saved: ThemesFile[] = [];
  readonly exported: {
    dir: string;
    name: string;
    theme: ThemeFileContent | LegacyThemeFileContent;
  }[] = [];
  files = new Map<string, unknown>();
  saveError: FsError | null = null;
  /** Calls of `setWindowChrome`, newest last. */
  readonly chrome: { color: string; dark: boolean }[] = [];

  load(): Promise<LoadedThemes> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  save(file: ThemesFile): Promise<void> {
    if (this.saveError) {
      return Promise.reject(this.saveError);
    }
    this.saved.push(structuredClone(file));
    this.loaded = { file: structuredClone(file), warning: null };
    return Promise.resolve();
  }

  importFile(path: string): Promise<unknown> {
    const v = this.files.get(path);
    if (v === undefined) {
      return Promise.reject({ code: 'not_found', message: 'No such file', path } as FsError);
    }
    return Promise.resolve(structuredClone(v));
  }

  exportFile(
    dir: string,
    name: string,
    theme: ThemeFileContent | LegacyThemeFileContent,
  ): Promise<string> {
    this.exported.push({ dir, name, theme: structuredClone(theme) });
    return Promise.resolve(`${dir}/${name}.theme.json`);
  }

  setWindowChrome(color: string, dark: boolean): Promise<void> {
    this.chrome.push({ color, dark });
    return Promise.resolve();
  }
}
