import { SettingsApi } from '../app/core/settings/settings-api';
import {
  ImportReport,
  LoadedSettings,
  SettingsPart,
  SettingsWarning,
} from '../app/core/settings/settings.models';

/** In-memory SettingsApi: `loaded` is returned by `load`, every `save` is recorded. */
export class FakeSettingsApi extends SettingsApi {
  loaded: LoadedSettings = { settings: {}, warnings: [], persist: true };
  readonly saved: Record<string, unknown>[] = [];
  saveWarnings: SettingsWarning[] = [];
  failSave = false;
  readonly exports: string[] = [];
  readonly imports: { path: string; parts: readonly SettingsPart[] }[] = [];
  importReport: ImportReport = { imported: [], warnings: [] };

  load(): Promise<LoadedSettings> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  save(settings: Readonly<Record<string, unknown>>): Promise<readonly SettingsWarning[]> {
    if (this.failSave) {
      return Promise.reject({ code: 'io', message: 'disk full', path: null });
    }
    this.saved.push(structuredClone({ ...settings }));
    this.loaded = { ...this.loaded, settings: structuredClone({ ...settings }) };
    return Promise.resolve(this.saveWarnings);
  }

  exportAll(dir: string): Promise<string> {
    this.exports.push(dir);
    return Promise.resolve(`${dir}/files-and-folders-settings.json`);
  }

  importAll(path: string, parts: readonly SettingsPart[]): Promise<ImportReport> {
    this.imports.push({ path, parts });
    return Promise.resolve(this.importReport);
  }
}
